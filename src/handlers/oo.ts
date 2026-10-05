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

import * as z from "zod/mini";
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import {
  DERIVED_KINDS,
  type Derived,
  type DerivedKind,
  derive,
} from "../model/derive.js";
import { pathOf } from "../refs.js";
import { ref } from "../schemas.js";
import { saveChecks } from "../style/guard.js";
import {
  effectiveProfile,
  mergePatch,
  parseProfile,
} from "../style/profile.js";
import type { Element, View } from "../types.js";
import { oneStep } from "../undo.js";
import { type BuildInput, buildDiagram } from "./build.js";
import {
  counted,
  countsSchema,
  limitField,
  pickRules,
  SEVERITIES,
  type Severity,
} from "./lint.js";

/*
 * Model-first authoring (issue #33): /derive_diagrams draws the diagrams a
 * model implies, by rule and the style profile's policy; /explain_model
 * reads the model back as compact text; /model_lint reviews the object
 * design.
 */

/** An ApiError with `prefix` in its message; anything else, a defect, as it is. */
export function naming(prefix: string, err: unknown): unknown {
  return err instanceof ApiError
    ? new ApiError(err.code, `${prefix}: ${err.message}`, err.details)
    : err;
}

interface Built {
  diagram: { _id: string; name: string | null };
  created: number;
  updated: number;
  unchanged: number;
  deleted?: number;
  quality?: { score: number; rating: number; passes: boolean };
  plan?: { ops: unknown[] };
}

const derivedSchema = () =>
  z.object({
    kind: z.string(),
    name: z.string(),
    diagram: doc(z.string(), "Its id; '$diagram' on a dry run that makes it."),
    created: z.int(),
    updated: z.int(),
    unchanged: z.int(),
    deleted: z.optional(z.int()),
    ops: z.optional(doc(z.int(), "With dryRun: the ops applying it runs.")),
    quality: z.optional(
      z.object({ score: z.int(), rating: z.int(), passes: z.boolean() }),
    ),
  });

/** Classes showing only accessors keep their operations folded (policy.hideGetters). */
function hideAccessors(diagram: Element, classes: readonly Element[]): void {
  const views = (diagram.ownedViews as View[]).filter(
    (v) =>
      classes.includes(v.model!) &&
      typeof v.suppressOperations === "boolean" &&
      !v.suppressOperations,
  );
  if (views.length === 0) return;
  const builder = app.repository.getOperationBuilder();
  builder.begin("hide accessors");
  for (const v of views) builder.fieldAssign(v, "suppressOperations", true);
  builder.end();
  app.repository.doOperation(builder.getOperation());
}

export function deriveDiagramsEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/derive_diagrams",
    description:
      "Draw the diagrams a model implies, by rule, as one undo step: an overview of its packages and their dependencies, a class diagram per class view (or per package, with its direct collaborators), a sequence diagram per collaboration, a use case diagram per use case view (or per system), a state machine per lifecycle, and the activities, ERD, C4 containers, deployments and feature mind map /build_model stored with the model. Each diagram shows the model's own elements (never copies), is laid out by the style profile and goes through the quality loop. Running it again after a model change updates the diagrams in place: what is new is shown, what is gone loses its view, the rest is left as it is. kinds limits which; policy overrides the profile's policy for this call; dryRun answers what each diagram would change.",
    readOnly: false,
    destructive: false,
    request: z.object({
      scope: ref(
        "The model (or a package of it) to derive from; its model's stored views apply.",
      ),
      kinds: z.optional(
        doc(
          z.array(z.enum(DERIVED_KINDS)).check(z.minLength(1)),
          "Only these diagram kinds; default all.",
        ),
      ),
      policy: z.optional(
        doc(
          z.record(z.string(), z.unknown()),
          "Fields of the style profile's policy for this call: classDiagrams (views|perPackage), hideGetters, neighbours, packageOverview.",
        ),
      ),
      dryRun: z.optional(z.boolean()),
    }),
    aliases: { ref: "scope" },
    response: z.object({
      model: z.nullable(z.string()),
      diagrams: z.array(derivedSchema()),
      counts: z.object({
        diagrams: z.int(),
        created: z.int(),
        updated: z.int(),
        unchanged: z.int(),
        deleted: z.int(),
      }),
      quality: z.optional(
        doc(
          z.object({
            min: z.int(),
            mean: z.int(),
            passing: z.int(),
            failing: z.array(z.string()),
          }),
          "Over the diagrams built: lowest and mean score, how many reach their threshold, which do not.",
        ),
      ),
      dryRun: z.optional(z.boolean()),
    }),
    handle: async (input) => {
      const scope = requireElement(input.scope, "Scope");
      const base = effectiveProfile().profile;
      const profile =
        input.policy === undefined
          ? base
          : parseProfile(mergePatch(base, { policy: input.policy }), "policy");
      const kinds = input.kinds && new Set<DerivedKind>(input.kinds);
      const derived = derive(scope, profile, kinds);
      const one = async (d: Derived): Promise<Built> => {
        const body = {
          kind: d.kind,
          spec: d.spec,
          name: d.name,
          parent: d.parent._id,
          upsert: true,
          prune: true,
          // Elements a section draws are its model's own; another model's
          // namesake is not shown in their place.
          reuse: false,
          ...(input.dryRun && { dryRun: true }),
        } as BuildInput;
        try {
          return (await buildDiagram(body, endpoints, {
            bind: d.bind,
            bindEdges: d.bindEdges,
            pruneViewsOnly: true,
            opsOnly: true,
          })) as Built;
        } catch (err) {
          throw naming(`derive_diagrams: ${d.kind} diagram ${d.name}`, err);
        }
      };
      const results: Built[] = [];
      const run = async () => {
        for (const d of derived) {
          const built = await one(d);
          if (
            !input.dryRun &&
            profile.policy.hideGetters &&
            d.kind === "class"
          ) {
            hideAccessors(requireElement(built.diagram._id), d.accessorsOnly);
          }
          results.push(built);
        }
      };
      if (input.dryRun) await run();
      else await oneStep("derive diagrams", run);
      const diagrams = derived.map((d, i) => {
        const b = results[i]!;
        return {
          kind: d.kind,
          name: d.name,
          diagram: b.diagram._id,
          created: b.created,
          updated: b.updated,
          unchanged: b.unchanged,
          ...(b.deleted !== undefined && { deleted: b.deleted }),
          ...(b.plan && { ops: b.plan.ops.length }),
          ...(b.quality && {
            quality: {
              score: b.quality.score,
              rating: b.quality.rating,
              passes: b.quality.passes,
            },
          }),
        };
      });
      const sum = (f: (d: (typeof diagrams)[number]) => number) =>
        diagrams.reduce((n, d) => n + f(d), 0);
      const scored = diagrams.filter((d) => d.quality);
      return {
        model: pathOf(scope),
        diagrams,
        counts: {
          diagrams: diagrams.length,
          created: sum((d) => d.created),
          updated: sum((d) => d.updated),
          unchanged: sum((d) => d.unchanged),
          // Every derived build prunes, so each answers what it deleted.
          deleted: sum((d) => d.deleted!),
        },
        ...(scored.length > 0 && {
          quality: {
            min: Math.min(...scored.map((d) => d.quality!.score)),
            mean: Math.round(
              scored.reduce((n, d) => n + d.quality!.score, 0) / scored.length,
            ),
            passing: scored.filter((d) => d.quality!.passes).length,
            failing: scored
              .filter((d) => !d.quality!.passes)
              .map((d) => `${d.name} ${d.quality!.score}`),
          },
        }),
        ...(input.dryRun && { dryRun: true }),
      };
    },
  });
}

// ------------------------------------------------------------- explain

const lines = (text: unknown) =>
  String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

function within(elem: Element, scope: Element): boolean {
  for (let e: Element | null | undefined = elem; e; e = e._parent) {
    if (e === scope) return true;
  }
  return false;
}

const VERBS: Record<string, string> = {
  UMLGeneralization: "is a",
  UMLInterfaceRealization: "implements",
  UMLDependency: "uses",
};

/** A relationship from `c` in the spec's verbs: owns, has, knows, is a, implements, uses. */
function verbOf(r: Element, c: Element): string | null {
  if (r.constructor.name in VERBS) {
    return r.source === c
      ? `${VERBS[r.constructor.name]} ${String((r.target as Element).name)}`
      : null;
  }
  if (r.constructor.name !== "UMLAssociation") return null;
  const [e1, e2] = [r.end1 as Element, r.end2 as Element];
  if (e1.reference !== c) return null;
  const other = String((e2.reference as Element | null)?.name);
  const verb =
    e1.aggregation === "composite"
      ? "owns"
      : e1.aggregation === "shared"
        ? "has"
        : "knows";
  return `${verb} ${other}${e2.multiplicity ? ` [${String(e2.multiplicity)}]` : ""}`;
}

function explain(scope: Element): string {
  const all = app.repository
    .findAll((e) => within(e, scope))
    .filter((e) => !(e instanceof type.View) && !(e instanceof type.Diagram));
  const of = (t: string) => all.filter((e) => e.constructor.name === t);
  const classes = all.filter((e) =>
    ["UMLClass", "UMLInterface", "UMLEnumeration"].includes(e.constructor.name),
  );
  const out: string[] = [
    `${String(scope.name)}: ${of("UMLPackage").length} packages, ${classes.length} classifiers, ${of("UMLActor").length} actors, ${of("UMLUseCase").length} use cases, ${of("UMLCollaboration").length} collaborations, ${of("UMLStateMachine").length} lifecycles`,
  ];
  const doc = lines(scope.documentation)[0];
  if (doc) out.push(doc);
  const owners = [scope, ...of("UMLPackage")];
  for (const owner of owners) {
    const own = classes.filter((c) => c._parent === owner);
    if (own.length === 0) continue;
    out.push("", `## ${owner === scope ? String(scope.name) : pathOf(owner)}`);
    const d = owner === scope ? undefined : lines(owner.documentation)[0];
    if (d) out.push(d);
    for (const c of own) {
      const kind =
        c.constructor.name === "UMLClass"
          ? c.isAbstract
            ? "abstract"
            : "class"
          : c.constructor.name.slice(3).toLowerCase();
      const relations = app.repository
        .getRelationshipsOf(c)
        .flatMap((r) => verbOf(r, c) ?? []);
      const ops = list(c.operations).map((o) => `${String(o.name)}()`);
      out.push(
        `- ${String(c.name)} (${kind})${lines(c.documentation).length > 0 ? `: ${lines(c.documentation).join(" ")}` : ""}`,
        ...(relations.length > 0 ? [`  ${relations.join("; ")}`] : []),
        ...(ops.length > 0 ? [`  does: ${ops.join(", ")}`] : []),
      );
    }
  }
  const collaborations = of("UMLCollaboration");
  if (collaborations.length > 0) out.push("", "## Collaborations");
  for (const c of collaborations) {
    const interaction = list(c.ownedElements).find(
      (e) => e.constructor.name === "UMLInteraction",
    );
    const messages = list(interaction?.messages).map(
      (m) =>
        `${String((m.source as Element).name)} -> ${String((m.target as Element).name)}: ${String(m.name)}`,
    );
    out.push(`- ${String(c.name)}: ${messages.join("; ")}`);
  }
  const machines = of("UMLStateMachine");
  if (machines.length > 0) out.push("", "## Lifecycles");
  for (const m of machines) {
    const transitions = list(list(m.regions)[0]?.transitions).map((t) => {
      const name = (e: unknown) =>
        String((e as Element).name) || (e as Element).constructor.name.slice(3);
      return `${name(t.source)} -> ${name(t.target)}${t.name ? ` on ${String(t.name)}` : ""}`;
    });
    out.push(
      `- ${String(m.name)}${m._parent !== scope ? ` (of ${String(m._parent!.name)})` : ""}: ${transitions.join("; ")}`,
    );
  }
  const cases = of("UMLUseCase");
  if (cases.length > 0) {
    out.push("", "## Use cases");
    for (const a of of("UMLActor")) {
      const goals = app.repository.getRelationshipsOf(a).flatMap((r) => {
        if (r.constructor.name !== "UMLAssociation") return [];
        const other = [
          (r.end1 as Element).reference,
          (r.end2 as Element).reference,
        ].find((e) => e !== a) as Element | undefined;
        return other && cases.includes(other) ? [String(other.name)] : [];
      });
      out.push(`- ${String(a.name)}: ${goals.join(", ") || "(no use case)"}`);
    }
  }
  return out.join("\n");
}

export const explainModel = defineEndpoint({
  path: "/explain_model",
  description:
    "The model as compact text to reason about: per package each class with its responsibilities (documentation), what it owns, has, knows, is, implements and uses, and its operations; each collaboration's messages; each lifecycle's transitions; each actor's use cases. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(ref("A model or package; default the project.")),
    maxChars: z.optional(
      doc(z.int().check(z.minimum(200)), "Default 20000; longer text is cut."),
    ),
  }),
  aliases: { ref: "scope" },
  response: z.object({
    text: z.string(),
    truncated: z.boolean(),
  }),
  handle: (input) => {
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    const text = explain(scope);
    const max = input.maxChars ?? 20_000;
    return {
      text: text.length > max ? text.slice(0, max) : text,
      truncated: text.length > max,
    };
  },
});

// ---------------------------------------------------------------- lint

export const MODEL_RULES = {
  M001: "god-class",
  M002: "feature-envy",
  M003: "cyclic-packages",
  M004: "anaemic-entity",
  M005: "single-implementation-interface",
  M006: "unused-class",
  M007: "uncalled-operation",
} as const;
type ModelRule = keyof typeof MODEL_RULES;

const DEFAULT_SEVERITY: Record<ModelRule, Severity> = {
  M001: "warning",
  M002: "info",
  M003: "error",
  M004: "info",
  M005: "info",
  M006: "warning",
  M007: "info",
};

/** Members above which a class does too much (Riel's heuristics put it near 20). */
export const GOD_CLASS_MEMBERS = 20;

interface ModelFinding {
  rule: ModelRule;
  name: string;
  severity: Severity;
  message: string;
  id: string;
  path: string | null;
  fix: string;
}

const typeRef = (t: unknown) =>
  t !== null && typeof t === "object" ? (t as Element) : null;

function lintModelDesign(
  scope: Element,
  severity: ReadonlyMap<ModelRule, Severity>,
): ModelFinding[] {
  const out: ModelFinding[] = [];
  const add = (rule: ModelRule, e: Element, message: string, fix: string) => {
    if (!severity.has(rule)) return;
    out.push({
      rule,
      name: MODEL_RULES[rule],
      severity: severity.get(rule)!,
      message,
      id: e._id,
      path: pathOf(e),
      fix,
    });
  };
  const all = app.repository.findAll((e) => within(e, scope));
  const classes = all.filter((e) => e.constructor.name === "UMLClass");
  const interfaces = all.filter((e) => e.constructor.name === "UMLInterface");
  const classifiers = [
    ...classes,
    ...interfaces,
    ...all.filter((e) => e.constructor.name === "UMLEnumeration"),
  ];
  const messages = all.filter((e) => e.constructor.name === "UMLMessage");
  const called = new Set(
    messages.map((m) => typeRef(m.signature)).filter(Boolean),
  );
  const typed = new Set<Element>();
  for (const e of all) {
    for (const t of [e.type, e.represent && (e.represent as Element).type]) {
      const r = typeRef(t);
      if (r) typed.add(r);
    }
  }
  for (const c of classes) {
    const members = list(c.attributes).length + list(c.operations).length;
    if (members > GOD_CLASS_MEMBERS) {
      add(
        "M001",
        c,
        `${String(c.name)} has ${members} attributes and operations`,
        "Split its responsibilities into collaborating classes.",
      );
    }
    for (const o of list(c.operations)) {
      const types = list(o.parameters)
        .map((p) => typeRef(p.type))
        .filter((t): t is Element => t !== null);
      const others = new Set(types.filter((t) => t !== c));
      if (
        types.length >= 2 &&
        others.size === 1 &&
        types.every((t) => t !== c) &&
        list(c.attributes).length === 0
      ) {
        const [other] = [...others];
        add(
          "M002",
          o,
          `${String(c.name)}.${String(o.name)} works only on ${String(other!.name)}'s data`,
          `Move it to ${String(other!.name)}.`,
        );
      }
      if (messages.length > 0 && !called.has(o) && o.visibility !== "private") {
        add(
          "M007",
          o,
          `${String(c.name)}.${String(o.name)} is called by no collaboration`,
          "Call it in a collaboration, or drop it.",
        );
      }
    }
    const attrs = list(c.attributes).length;
    if (
      attrs >= 3 &&
      list(c.operations).length === 0 &&
      !/dto|value/i.test(String(c.stereotype ?? ""))
    ) {
      add(
        "M004",
        c,
        `${String(c.name)} has ${attrs} attributes and no behaviour`,
        "Give it the operations that use its data, or mark it a DTO.",
      );
    }
  }
  for (const i of interfaces) {
    const realizations = app.repository
      .getRelationshipsOf(i)
      .filter(
        (r) =>
          r.constructor.name === "UMLInterfaceRealization" && r.target === i,
      );
    if (realizations.length === 1) {
      add(
        "M005",
        i,
        `${String(i.name)} has one implementation, ${String((realizations[0]!.source as Element).name)}`,
        "Keep it only if it is a seam (tests, plug-ins); otherwise use the class.",
      );
    }
  }
  for (const c of classifiers) {
    const related = app.repository.getRelationshipsOf(c).length > 0;
    if (!related && !typed.has(c)) {
      add(
        "M006",
        c,
        `${String(c.name)} takes part in no relationship, type or collaboration`,
        "Relate it to what uses it, or remove it.",
      );
    }
  }
  // Package dependency cycles, by a depth-first walk in model order.
  const packages = all.filter((e) => e.constructor.name === "UMLPackage");
  const deps = new Map<Element, Element[]>(
    packages.map((p) => [
      p,
      app.repository
        .getRelationshipsOf(p)
        .filter((r) => r.constructor.name === "UMLDependency" && r.source === p)
        .map((r) => r.target as Element)
        .filter((t) => packages.includes(t)),
    ]),
  );
  const state = new Map<Element, "open" | "done">();
  const reported = new Set<string>();
  const walk = (p: Element, stack: Element[]) => {
    state.set(p, "open");
    for (const q of deps.get(p)!) {
      if (state.get(q) === "open") {
        const cycle = [...stack.slice(stack.indexOf(q)), p, q];
        const key = [...cycle.slice(0, -1)]
          .map((e) => e._id)
          .sort()
          .join();
        if (!reported.has(key)) {
          reported.add(key);
          add(
            "M003",
            q,
            `Packages depend on each other in a cycle: ${cycle.map((e) => String(e.name)).join(" -> ")}`,
            "Break the cycle: move the shared part into a package both depend on, or invert one dependency.",
          );
        }
      } else if (!state.has(q)) walk(q, [...stack, p]);
    }
    state.set(p, "done");
  };
  for (const p of packages) if (!state.has(p)) walk(p, []);
  const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule),
  );
}

function severities(given: Record<string, string>): Map<ModelRule, Severity> {
  const out = new Map<ModelRule, Severity>();
  for (const id of Object.keys(MODEL_RULES) as ModelRule[]) {
    const setting = Object.entries(given).find(
      ([k]) => k === id || k === MODEL_RULES[id],
    )?.[1];
    if (setting === "off") continue;
    out.set(id, (setting as Severity | undefined) ?? DEFAULT_SEVERITY[id]);
  }
  return out;
}

saveChecks.push(() =>
  lintModelDesign(requireProject(), severities({}))
    .filter((f) => f.severity === "error")
    .map((f) => ({ rule: f.rule, message: f.message, path: f.path })),
);

export const modelLint = defineEndpoint({
  path: "/model_lint",
  description:
    "Review the object design: god classes (M001, more than 20 members), feature envy (M002, an operation working only on another class's data), cyclic package dependencies (M003), anaemic entities (M004, data without behaviour), interfaces with one implementation (M005), unused classes (M006), operations no collaboration calls (M007, when the scope has collaborations). Each finding has a rule id, the element's id and path and a one-line fix. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(ref("A model or package; default the project.")),
    rules: z.optional(
      doc(
        z.record(z.string(), z.enum(["off", ...SEVERITIES])),
        "Per rule id or name: off, or the severity to report it with.",
      ),
    ),
    limit: limitField(),
  }),
  aliases: { ref: "scope" },
  response: z.object({
    count: z.int(),
    counts: countsSchema(),
    truncated: z.boolean(),
    findings: z.array(
      z.object({
        rule: z.string(),
        name: z.string(),
        severity: z.enum(SEVERITIES),
        message: z.string(),
        id: z.string(),
        path: z.nullable(z.string()),
        fix: z.string(),
      }),
    ),
  }),
  handle: (input) => {
    const given = input.rules ?? {};
    pickRules(MODEL_RULES, Object.keys(given), "rules");
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    return counted(lintModelDesign(scope, severities(given)), input.limit);
  },
});
