/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

import type { Severity } from "../handlers/lint.js";
import { kindOf } from "../quality/geometry.js";
import { pathOf } from "../refs.js";
import type { Element, View } from "../types.js";
import { elementLimit, viewpointCatalogue } from "./index.js";
import { partViews, readMark } from "./mark.js";
import type { Viewpoint, ViewpointName } from "./schema.js";

/*
 * Whether a diagram keeps to its viewpoint (issue #42): what it shows,
 * how much, and the parts it must carry. The rules read the model types
 * behind the views, never the picture, so they hold for a diagram however
 * it was drawn.
 */

export const VIEWPOINT_RULES = {
  V001: "outside-viewpoint",
  V002: "mixed-viewpoints",
  V003: "no-initiator",
  V004: "lifecycle-of-non-entity",
  V005: "context-shows-internals",
  V006: "missing-part",
  V007: "too-many-elements",
  V008: "no-viewpoint",
  V009: "kind-outside-viewpoint",
} as const;
export type ViewpointRule = keyof typeof VIEWPOINT_RULES;

export const DEFAULT_SEVERITY: Record<ViewpointRule, Severity> = {
  V001: "error",
  V002: "warning",
  V003: "error",
  V004: "error",
  V005: "error",
  V006: "warning",
  V007: "warning",
  V008: "warning",
  V009: "error",
};

export interface Suggestion {
  viewpoint: ViewpointName;
  kind?: string;
  count?: number;
}

export interface ViewpointFinding {
  rule: ViewpointRule;
  name: string;
  severity: Severity;
  message: string;
  diagram: string;
  path: string | null;
  viewpoint: string | null;
  ids: string[];
  fix: string;
  suggest?: Suggestion[];
}

/** Views that hold or frame others: a boundary, a lane, a fragment. */
const AREA = /Subject|Partition|Swimlane|CombinedFragment|Operand|Region/;
/** Model types a context view must not show: the system's inside. */
const INTERNALS = new Set([
  "UMLClass",
  "UMLInterface",
  "UMLEnumeration",
  "UMLPackage",
  "UMLComponent",
  "C4Container",
  "C4Component",
]);

const typeOf = (v: View) => v.model!.constructor.name;

/** Node and edge views showing a model element, the diagram's frame aside. */
function shown(diagram: Element) {
  const views = (diagram.ownedViews as View[]).filter(
    (v) =>
      v.visible !== false &&
      v.model !== null &&
      v.model !== undefined &&
      !(v.model instanceof type.Diagram),
  );
  // A communication diagram draws a message as a node view hosted on its
  // connector (UMLCommMessageView, uml/elements.js 7.1.1): what counts is
  // the model, a relationship or not.
  const isEdge = (v: View) => v.model instanceof type.Relationship;
  return {
    nodes: views.filter((v) => !isEdge(v)),
    edges: views.filter(isEdge),
  };
}

/** Viewpoints whose element list has `typeName`, in catalogue order. */
function viewpointsOf(typeName: string): ViewpointName[] {
  return viewpointCatalogue()
    .viewpoints.filter((v) => v.elements.includes(typeName))
    .map((v) => v.name);
}

/** "3 UMLClass, 1 UMLActor": types and how often, most frequent first. */
function tally(views: readonly View[]): string {
  const count = new Map<string, number>();
  for (const v of views) count.set(typeOf(v), (count.get(typeOf(v)) ?? 0) + 1);
  return [...count]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
}

/** A default name StarUML gives a new diagram: "ClassDiagram1", "Main". */
const DEFAULT_NAME = /^(?:[A-Z][A-Za-z0-9]*?Diagram\d*|Main)$/;

const isNote = (v: View) => v instanceof type.UMLNoteView;
const LEGEND = /^\s*legend\b/i;

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

/** Whether a sequence or communication diagram shows who starts its scenario, and why not. */
function initiatorProblem(diagram: Element, edges: View[], nodes: View[]) {
  const messages = edges.filter((e) => typeOf(e) === "UMLMessage");
  if (messages.length === 0)
    return "it shows no message, so nothing starts the scenario";
  const order = list(diagram._parent?.messages);
  const first = messages
    .map((e) => e.model!)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]!;
  if (!String(first.name ?? "").trim()) {
    return "its first message has no text, so the trigger is not said";
  }
  if (diagram instanceof type.UMLSequenceDiagram) {
    const source = first.source as Element | null;
    // A found message comes from outside the diagram: that is the trigger.
    if (!(source instanceof type.UMLLifeline)) return null;
    const lifelines = nodes
      .filter((v) => typeOf(v) === "UMLLifeline")
      .sort((a, b) => Number(a.left) - Number(b.left));
    if (lifelines[0]?.model !== source) {
      return `its first message comes from ${String(source!.name)}, which is not the leftmost lifeline, so the reader starts in the middle`;
    }
  }
  return null;
}

export interface LintOptions {
  strict: boolean;
}

/** The findings of `diagram` under the rules in `severity` (the others are off). */
export function lintViewpoint(
  diagram: Element,
  severity: ReadonlyMap<ViewpointRule, Severity>,
  options: LintOptions,
): ViewpointFinding[] {
  const out: ViewpointFinding[] = [];
  const mark = readMark(diagram);
  const declared = mark?.viewpoint ?? null;
  const add = (
    rule: ViewpointRule,
    views: readonly View[],
    message: string,
    fix: string,
    suggest?: Suggestion[],
  ) => {
    if (!severity.has(rule)) return;
    out.push({
      rule,
      name: VIEWPOINT_RULES[rule],
      severity:
        rule === "V008" && options.strict ? "error" : severity.get(rule)!,
      message,
      diagram: diagram._id,
      path: pathOf(diagram),
      viewpoint: declared,
      ids: views.map((v) => v._id),
      fix,
      ...(suggest && { suggest }),
    });
  };
  const { nodes, edges } = shown(diagram);
  const kind = kindOf(diagram);
  const solid = nodes.filter((v) => !AREA.test(v.constructor.name));

  // V002: no single viewpoint covers every node of a catalogued type.
  const catalogued = nodes.filter((v) => viewpointsOf(typeOf(v)).length > 0);
  const common = catalogued.reduce<ViewpointName[] | null>((acc, v) => {
    const vps = viewpointsOf(typeOf(v));
    return acc === null ? vps : acc.filter((x) => vps.includes(x));
  }, null);
  if (common !== null && common.length === 0) {
    const groups = new Map<ViewpointName, number>();
    for (const v of catalogued) {
      const vps = viewpointsOf(typeOf(v));
      const home = vps.includes(declared as ViewpointName)
        ? (declared as ViewpointName)
        : vps[0]!;
      groups.set(home, (groups.get(home) ?? 0) + 1);
    }
    add(
      "V002",
      catalogued,
      `${tally(catalogued)} belong to ${groups.size} viewpoints (${[...groups.keys()].join(", ")}); no single view answers one question about them`,
      "Split it, one diagram per viewpoint (/request_diagram or /derive_diagrams draw them so).",
      [...groups].map(([viewpoint, count]) => ({ viewpoint, count })),
    );
  }

  if (declared === null) {
    add(
      "V008",
      [],
      "The diagram declares no viewpoint, so nothing says which question it answers",
      "Draw it through /request_diagram or /derive_diagrams, or pass viewpoint to /build_diagram.",
    );
    return out;
  }
  const vp = viewpointCatalogue().byName.get(declared as ViewpointName);
  if (!vp) {
    add(
      "V008",
      [],
      `The diagram declares the viewpoint ${declared}, which is not in the catalogue`,
      `Use one of ${viewpointCatalogue()
        .viewpoints.map((v) => v.name)
        .join(", ")}.`,
    );
    return out;
  }
  checkDeclared(diagram, vp, { nodes, edges, solid, kind, mark }, add);
  return out;
}

type Add = (
  rule: ViewpointRule,
  views: readonly View[],
  message: string,
  fix: string,
  suggest?: Suggestion[],
) => void;

function checkDeclared(
  diagram: Element,
  vp: Viewpoint,
  d: {
    nodes: View[];
    edges: View[];
    solid: View[];
    kind: string | null;
    mark: ReturnType<typeof readMark>;
  },
  add: Add,
): void {
  if (d.kind === null || !(vp.kinds as string[]).includes(d.kind)) {
    add(
      "V009",
      [],
      `A ${d.kind ?? diagram.constructor.name} diagram cannot show the ${vp.name} viewpoint, which is drawn as ${vp.kinds.join(", ")}`,
      `Draw it as ${vp.kinds[0]}, or declare the viewpoint this diagram answers.`,
      vp.kinds.map((k) => ({ viewpoint: vp.name, kind: k })),
    );
  }
  const internal =
    vp.name === "context"
      ? d.nodes.filter((v) => INTERNALS.has(typeOf(v)))
      : [];
  if (internal.length > 0) {
    add(
      "V005",
      internal,
      `A context view shows the system as one box, and this one shows its inside: ${tally(internal)}`,
      "Show those on a container, component or code view; keep people and systems here.",
      [
        { viewpoint: "container", kind: "c4" },
        { viewpoint: "code", kind: "class" },
      ],
    );
  }
  const outsideNodes = d.nodes.filter(
    (v) => !vp.elements.includes(typeOf(v)) && !internal.includes(v),
  );
  const outsideEdges = d.edges.filter(
    (v) => !vp.relationships.includes(typeOf(v)),
  );
  const outside = [...outsideNodes, ...outsideEdges];
  if (outside.length > 0) {
    add(
      "V001",
      outside,
      `${tally(outside)} lie outside the ${vp.name} viewpoint, which shows ${vp.elements.join(", ")}`,
      "Remove them from this diagram, or show them on a view of their own viewpoint.",
      [...new Set(outsideNodes.flatMap((v) => viewpointsOf(typeOf(v))))].map(
        (viewpoint) => ({ viewpoint }),
      ),
    );
  }
  if (vp.required.includes("trigger")) {
    const problem =
      d.kind === "activity"
        ? d.nodes.some((v) => typeOf(v) === "UMLInitialNode")
          ? null
          : "it has no initial node, so nothing says where the steps start"
        : initiatorProblem(diagram, d.edges, d.nodes);
    if (problem !== null) {
      add(
        "V003",
        [],
        `The runtime view has no clear initiator: ${problem}`,
        "Start the scenario with a labelled message from its initiator, drawn leftmost (an activity: from an initial node).",
      );
    }
  }
  if (
    vp.name === "lifecycle" &&
    diagram._parent instanceof type.UMLStateMachine
  ) {
    const owner = diagram._parent!._parent ?? null;
    if (!(owner instanceof type.UMLClass)) {
      add(
        "V004",
        [],
        `The lifecycle belongs to ${owner ? `${owner.constructor.name} ${String(owner.name)}` : "nothing"}, not to a class whose objects go through it`,
        "Make the state machine the behaviour of the entity class whose states it shows (lifecycles.subject in /build_model).",
      );
    }
  }
  const notes = (diagram.ownedViews as View[]).filter(isNote);
  const missing = vp.required.filter((part) => {
    if (part === "title") {
      const name = String(diagram.name ?? "").trim();
      return !name || DEFAULT_NAME.test(name);
    }
    if (part === "legend") {
      return (
        partViews(diagram, d.mark).filter(
          (v) => v._id === d.mark?.parts?.legend,
        ).length === 0 && !notes.some((n) => LEGEND.test(String(n.text)))
      );
    }
    return false;
  });
  if (missing.length > 0) {
    add(
      "V006",
      [],
      `The ${vp.name} viewpoint requires ${missing.join(" and ")}, which the diagram lacks`,
      missing
        .map((p) =>
          p === "title"
            ? "Name the diagram for the question it answers."
            : "Add a note starting 'Legend' that explains its notation (/derive_diagrams adds it).",
        )
        .join(" "),
    );
  }
  const limit = elementLimit(vp, d.kind ?? "");
  const lifelines = d.solid.filter((v) => typeOf(v) === "UMLLifeline");
  if (d.solid.length > limit) {
    add(
      "V007",
      d.solid,
      `${d.solid.length} elements, more than the ${limit} a ${vp.name} view holds`,
      vp.split,
    );
  } else if (
    vp.limits.maxLifelines !== undefined &&
    lifelines.length > vp.limits.maxLifelines
  ) {
    add(
      "V007",
      lifelines,
      `${lifelines.length} lifelines, more than the ${vp.limits.maxLifelines} a scenario stays readable with`,
      vp.split,
      [{ viewpoint: "runtime", kind: "activity" }],
    );
  }
}

/** Every rule at its default severity. */
export const allRules = (): Map<ViewpointRule, Severity> =>
  new Map(Object.entries(DEFAULT_SEVERITY) as [ViewpointRule, Severity][]);

/**
 * Whether a diagram conforms to its viewpoint: no error and no warning of
 * the viewpoint rules. Answered with the first findings, for a build's
 * response.
 */
export function conformity(diagram: Element) {
  const findings = lintViewpoint(diagram, allRules(), { strict: false });
  const blocking = findings.filter((f) => f.severity !== "info");
  return {
    conforms: blocking.length === 0,
    findings: blocking
      .slice(0, 10)
      .map((f) => ({ rule: f.rule, message: f.message })),
  };
}
