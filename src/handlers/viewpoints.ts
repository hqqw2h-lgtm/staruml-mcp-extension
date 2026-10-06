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
  classNeighbourhood,
  countNodes,
  type Derived,
  type DerivedKind,
  derive,
  modelOf,
} from "../model/derive.js";
import { pathOf } from "../refs.js";
import { ref } from "../schemas.js";
import { effectiveProfile, type Profile } from "../style/profile.js";
import type { Element } from "../types.js";
import { findTemplate, templates } from "../templates/index.js";
import { decide, normalizeIntent } from "../viewpoints/decide.js";
import {
  elementLimit,
  findViewpoint,
  viewpointCatalogue,
} from "../viewpoints/index.js";
import {
  DEFAULT_SEVERITY,
  lintViewpoint,
  VIEWPOINT_RULES,
  type ViewpointFinding,
  type ViewpointRule,
} from "../viewpoints/lint.js";
import {
  AUDIENCES,
  type ScopeKind,
  VIEWPOINT_NAMES,
  type ViewpointName,
} from "../viewpoints/schema.js";
import {
  counted,
  countsSchema,
  limitField,
  pickRules,
  SEVERITIES,
  type Severity,
} from "./lint.js";
import {
  buildDerived,
  derivedCountsSchema,
  derivedQualitySchema,
  derivedSchema,
} from "./oo.js";

/*
 * Viewpoints (issue #42): the catalogue read back, the conformance lint,
 * and /request_diagram, where an agent states what it wants to know and
 * the engine picks the view by the committed decision table, draws it
 * from the model, or refuses with the views that fit.
 */

const summaryOf = (name: ViewpointName) => {
  const v = findViewpoint(name);
  return {
    name: v.name,
    title: v.title,
    question: v.question,
    kinds: [...v.kinds],
    stakeholders: [...v.stakeholders],
    required: [...v.required],
  };
};

const summarySchema = () =>
  z.object({
    name: z.enum(VIEWPOINT_NAMES),
    title: z.string(),
    question: z.string(),
    kinds: z.array(z.string()),
    stakeholders: z.array(z.string()),
    required: z.array(z.string()),
  });

export const listViewpoints = defineEndpoint({
  path: "/list_viewpoints",
  description:
    "The viewpoint catalogue: each kind of view the engine draws, the question it answers, the diagram kinds that show it, who it is written for and the parts it requires. /request_diagram picks one from an intent; /describe_viewpoint gives one in full. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({
    viewpoints: z.array(summarySchema()),
    decisions: doc(
      z.object({ version: z.int(), rules: z.int() }),
      "The decision table /request_diagram applies.",
    ),
  }),
  handle: () => {
    const c = viewpointCatalogue();
    return {
      viewpoints: c.viewpoints.map((v) => summaryOf(v.name)),
      decisions: { version: c.table.version, rules: c.table.rules.length },
    };
  },
});

export const describeViewpoint = defineEndpoint({
  path: "/describe_viewpoint",
  description:
    "One viewpoint in full: what it shows, its question, concerns and stakeholders, the model element and relationship types it allows, its limits, its required parts and legend, how a view past its limits is split, and the decision rules that lead to it. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    name: doc(z.enum(VIEWPOINT_NAMES), "The viewpoint."),
  }),
  response: z.object({
    viewpoint: doc(
      z.record(z.string(), z.unknown()),
      "name, title, summary, question, concerns, stakeholders, kinds, elements, relationships, limits, required, legend, split.",
    ),
    rules: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        template: z.string(),
        phrases: z.array(z.string()),
        scopes: z.array(z.string()),
      }),
    ),
    templates: doc(
      z.array(z.string()),
      "Templates drawing it (see /describe_template).",
    ),
  }),
  handle: (input) => {
    const { $schema: _, ...viewpoint } = findViewpoint(input.name);
    return {
      viewpoint,
      rules: viewpointCatalogue()
        .table.rules.filter((r) => r.viewpoint === input.name)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          template: r.template,
          phrases: [...r.phrases],
          scopes: [...r.scopes],
        })),
      templates: templates()
        .filter((t) => t.viewpoint === input.name)
        .map((t) => t.name),
    };
  },
});

// ---------------------------------------------------------------- lint

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

/** Diagrams at or under `scope`, owners first. */
function diagramsUnder(scope: Element): Element[] {
  if (scope instanceof type.Diagram) return [scope];
  const out: Element[] = [];
  const walk = (e: Element) => {
    if (e instanceof type.Diagram) out.push(e);
    for (const c of list(e.ownedElements)) walk(c);
  };
  walk(scope);
  return out;
}

function severities(
  given: Record<string, string>,
): Map<ViewpointRule, Severity> {
  const out = new Map<ViewpointRule, Severity>();
  for (const id of Object.keys(VIEWPOINT_RULES) as ViewpointRule[]) {
    const setting = Object.entries(given).find(
      ([k]) => k === id || k === VIEWPOINT_RULES[id],
    )?.[1];
    if (setting === "off") continue;
    out.set(id, (setting as Severity | undefined) ?? DEFAULT_SEVERITY[id]);
  }
  return out;
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const viewpointLint = defineEndpoint({
  path: "/viewpoint_lint",
  description:
    "Check that diagrams keep to the viewpoint they declare (issue #42): V001 elements or relationships outside the viewpoint, V002 elements of several viewpoints on one diagram (split it), V003 a runtime view with no initiator (no labelled first message from the leftmost lifeline, no initial node), V004 a lifecycle owned by something other than a class, V005 a context view showing the system's inside, V006 a required part missing (a real title, a legend), V007 more elements or lifelines than the viewpoint holds, V008 no viewpoint declared (an error under a strict profile), V009 a diagram kind the viewpoint is not drawn as. Each finding names the diagram, its viewpoint, the views involved and a fix; suggest lists the views to draw instead. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(
      ref(
        "A diagram, or a model or package whose diagrams to check; default the project.",
      ),
    ),
    rules: z.optional(
      doc(
        z.record(z.string(), z.enum(["off", ...SEVERITIES])),
        "Per rule id or name: off, or the severity to report it with.",
      ),
    ),
    limit: limitField(),
  }),
  aliases: { diagram: "scope", ref: "scope" },
  response: z.object({
    diagrams: doc(z.int(), "Diagrams checked."),
    count: z.int(),
    counts: countsSchema(),
    truncated: z.boolean(),
    findings: z.array(
      z.object({
        rule: z.string(),
        name: z.string(),
        severity: z.enum(SEVERITIES),
        message: z.string(),
        diagram: z.string(),
        path: z.nullable(z.string()),
        viewpoint: z.nullable(z.string()),
        ids: z.array(z.string()),
        fix: z.string(),
        suggest: z.optional(
          z.array(
            z.object({
              viewpoint: z.enum(VIEWPOINT_NAMES),
              kind: z.optional(z.string()),
              count: z.optional(z.int()),
            }),
          ),
        ),
      }),
    ),
  }),
  handle: (input) => {
    const given = input.rules ?? {};
    pickRules(VIEWPOINT_RULES, Object.keys(given), "rules");
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    const diagrams = diagramsUnder(scope);
    const severity = severities(given);
    const strict = effectiveProfile().profile.strict;
    const findings: ViewpointFinding[] = diagrams
      .flatMap((d) => lintViewpoint(d, severity, { strict }))
      .sort(
        (a, b) =>
          RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule),
      );
    return { diagrams: diagrams.length, ...counted(findings, input.limit) };
  },
});

// ------------------------------------------------------------- request

const SCOPE_TYPES: Record<string, ScopeKind> = {
  UMLModel: "model",
  UMLPackage: "package",
  UMLSubsystem: "package",
  UMLClass: "class",
  UMLInterface: "class",
  UMLEnumeration: "class",
  UMLCollaboration: "interaction",
  UMLInteraction: "interaction",
  UMLStateMachine: "statemachine",
  UMLActor: "actor",
  UMLUseCase: "usecase",
  UMLUseCaseSubject: "usecase",
};

interface Scope {
  elem: Element;
  kind: ScopeKind;
  model: Element;
}

/**
 * What a scope is. The project stands for its model when only one of its
 * models holds anything but diagrams (a new project's "Model" with its
 * empty "Main" aside); with
 * several, the request is refused with each of them to ask about.
 */
function scopeOf(elem: Element, intent: string): Scope {
  if (elem === app.project.getProject()) {
    const models = list(elem.ownedElements).filter(
      (e) =>
        e instanceof type.UMLModel &&
        list(e.ownedElements).some((x) => !(x instanceof type.Diagram)),
    );
    if (models.length === 1) {
      return { elem: models[0]!, kind: "model", model: models[0]! };
    }
    const choice = decide({ intent, scope: "model" });
    throw mismatch(
      `the project holds ${models.length} models; pass the one the diagram is about as scope`,
      {
        reason: "scope",
        alternatives: choice.ok
          ? models.map((m) => ({
              viewpoint: choice.viewpoint,
              kind: choice.kind,
              why: `the same view of ${String(m.name)}`,
              candidates: [pathOf(m)!],
            }))
          : [],
      },
    );
  }
  return {
    elem,
    kind: SCOPE_TYPES[elem.constructor.name] ?? "other",
    model: modelOf(elem) ?? elem,
  };
}

/**
 * Scopes of the model that have something to show in the view: the model
 * itself, and what the views it derives to are drawn in (a state machine
 * and its class, a collaboration), at most ten, by path. Empty when the
 * model has no such view at all.
 */
function scopesWith(
  scope: Scope,
  alt: { viewpoint: ViewpointName; kind: string; scopes: readonly ScopeKind[] },
  profile: Profile,
): string[] {
  const shown = derive(
    scope.model,
    profile,
    new Set([alt.kind as DerivedKind]),
    {
      context: alt.viewpoint === "context",
    },
  ).filter((d) => d.viewpoint === alt.viewpoint);
  if (shown.length === 0) return [];
  const out = new Set<string>();
  const offer = (e: Element | null | undefined) => {
    const kind = e && SCOPE_TYPES[e.constructor.name];
    if (kind && alt.scopes.includes(kind)) out.add(pathOf(e)!);
  };
  offer(scope.model);
  for (const d of shown) {
    offer(d.parent);
    offer(d.parent._parent);
  }
  return [...out].slice(0, 10);
}

const typed = (e: Element) =>
  (e.represent as Element | null | undefined)?.type as Element | undefined;

/** The diagrams the chosen view of `scope` has, before the intent narrows them. */
function candidatesFor(
  viewpoint: ViewpointName,
  kind: DerivedKind,
  scope: Scope,
  base: Profile,
): Derived[] {
  // Asked for by name, an overview is drawn whatever the policy says.
  const profile = {
    ...base,
    policy: { ...base.policy, packageOverview: true },
  };
  const kinds = new Set([kind]);
  const of = (root: Element, p: Profile = profile) =>
    derive(root, p, kinds, { context: viewpoint === "context" }).filter(
      (d) => d.viewpoint === viewpoint,
    );
  switch (scope.kind) {
    case "model":
    case "interaction":
    case "statemachine":
      return of(scope.elem);
    case "package":
      // A package's classes are drawn by package: its stored class views
      // span other packages.
      return of(scope.elem, {
        ...profile,
        policy: { ...profile.policy, classDiagrams: "perPackage" },
      });
    case "class":
      if (kind === "class") return [classNeighbourhood(scope.elem)];
      if (kind === "statemachine") return of(scope.elem);
      return of(scope.model).filter((d) =>
        [...d.bind.values()].some((l) => typed(l) === scope.elem),
      );
    default:
      return of(scope.model).filter((d) =>
        [...d.bind.values()].includes(scope.elem),
      );
  }
}

const STOP = new Set(
  "the and for with from into over that this what when where which who how does show draw diagram view about".split(
    " ",
  ),
);
const tokens = (text: string) =>
  normalizeIntent(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * The candidates whose names share most words with the intent, or all of
 * them when none shares any: "how does telemetry ingestion work" keeps
 * the telemetry ingestion scenario of five.
 */
function narrow(candidates: Derived[], intent: string): Derived[] {
  const wanted = new Set(tokens(intent));
  const scores = candidates.map(
    (d) => new Set(tokens(d.name).filter((w) => wanted.has(w))).size,
  );
  const best = Math.max(0, ...scores);
  return best === 0
    ? candidates
    : candidates.filter((_, i) => scores[i] === best);
}

function mismatch(
  message: string,
  details: {
    reason: string;
    wanted?: { viewpoint: string; kind: string; rule?: string };
    alternatives: {
      viewpoint: string;
      kind: string;
      why: string;
      rule?: string;
      scopes?: string[];
      candidates?: string[];
    }[];
  },
): ApiError {
  return new ApiError(
    "VIEWPOINT_MISMATCH",
    `request_diagram: ${message}; details.alternatives lists the views that fit`,
    details,
  );
}

/** What the model in scope can show, by viewpoint and kind, for a refusal. */
function available(scope: Scope, profile: Profile) {
  const counts = new Map<
    string,
    { viewpoint: string; kind: string; n: number }
  >();
  for (const d of derive(scope.model, profile, undefined, { context: true })) {
    const key = `${d.viewpoint}|${d.kind}`;
    const c = counts.get(key) ?? { viewpoint: d.viewpoint, kind: d.kind, n: 0 };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.values()].map((c) => ({
    viewpoint: c.viewpoint,
    kind: c.kind,
    why: `${pathOf(scope.model)!} has ${c.n} such view${c.n === 1 ? "" : "s"}: ${findViewpoint(c.viewpoint).question}`,
    candidates: [pathOf(scope.model)!].filter(Boolean),
  }));
}

export function requestDiagramEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/request_diagram",
    description:
      "Ask for the diagram that answers a question, and let the engine choose it: intent says what the reader wants to know ('how does a device publish telemetry', 'which states can an alarm be in'), audience who reads it, scope the model element it is about. A committed decision table maps the intent and the kind of scope to a viewpoint and a diagram kind (see /list_viewpoints); the answer gives the choice with its rule and reason, and the diagram is derived from the model as /derive_diagrams does (bound to the model, marked with its viewpoint, quality loop). A view that does not fit is refused with VIEWPOINT_MISMATCH and the views that do: an intent drawn for another kind of scope, a viewpoint not written for the audience, nothing to show in the scope, or more lifelines or elements than the viewpoint holds (then an activity or a split). Kinds, styles and layouts are never parameters.",
    readOnly: false,
    destructive: false,
    request: z.object({
      intent: doc(
        z.string().check(z.minLength(1), z.maxLength(500)),
        "What the diagram should answer, in plain words.",
      ),
      audience: z.optional(
        doc(
          z.enum(AUDIENCES),
          "Who reads it; a view not written for them is refused.",
        ),
      ),
      scope: ref(
        "What it is about: a model, package, class, collaboration, state machine, actor or use case (the project stands for its only model).",
      ),
      dryRun: z.optional(z.boolean()),
    }),
    aliases: { ref: "scope" },
    response: z.object({
      choice: doc(
        z.object({
          viewpoint: z.enum(VIEWPOINT_NAMES),
          kind: z.string(),
          template: doc(z.string(), "The template it is drawn with."),
          rule: doc(z.string(), "The decision rule applied."),
          reason: z.string(),
          question: doc(z.string(), "What the view answers."),
          matched: doc(
            z.array(z.string()),
            "Phrases of the rule found in the intent.",
          ),
        }),
        "The view the decision table picked.",
      ),
      scope: z.nullable(z.string()),
      diagrams: z.array(derivedSchema()),
      counts: derivedCountsSchema(),
      quality: derivedQualitySchema(),
      dryRun: z.optional(z.boolean()),
    }),
    handle: async (input) => {
      const scope = scopeOf(requireElement(input.scope, "Scope"), input.intent);
      const decision = decide({
        intent: input.intent,
        scope: scope.kind,
        ...(input.audience !== undefined && { audience: input.audience }),
      });
      const profile = effectiveProfile().profile;
      if (!decision.ok) {
        const wanted = decision.wanted;
        // Only views the model has are offered; with none of them, what it has.
        const offered = decision.alternatives
          .map((a) => ({ ...a, candidates: scopesWith(scope, a, profile) }))
          .filter((a) => a.candidates.length > 0);
        throw mismatch(decision.reason, {
          reason: decision.problem,
          ...(wanted && { wanted }),
          alternatives:
            offered.length > 0 ? offered : available(scope, profile),
        });
      }
      const vp = findViewpoint(decision.viewpoint);
      const found = candidatesFor(
        decision.viewpoint,
        decision.kind as DerivedKind,
        scope,
        profile,
      );
      if (found.length === 0) {
        throw mismatch(
          `${pathOf(scope.elem)!} holds nothing a ${vp.title.toLowerCase()} view (${decision.kind}) draws`,
          {
            reason: "empty",
            wanted: { viewpoint: vp.name, kind: decision.kind },
            alternatives: available(scope, profile),
          },
        );
      }
      const chosen = narrow(found, input.intent);
      for (const d of chosen) {
        const { nodes, lifelines } = countNodes(d);
        const max = vp.limits.maxLifelines;
        if (max !== undefined && lifelines > max) {
          throw mismatch(
            `${d.name} has ${lifelines} lifelines, more than the ${max} a ${vp.title.toLowerCase()} view stays readable with`,
            {
              reason: "limits",
              wanted: { viewpoint: vp.name, kind: d.kind },
              alternatives: [
                {
                  viewpoint: "runtime",
                  kind: "activity",
                  why: "the steps as an activity, a lane per part, which grows by steps rather than by participants",
                },
                {
                  viewpoint: "runtime",
                  kind: d.kind,
                  why: `split ${d.name} into scenarios of at most ${max} participants, one collaboration each`,
                },
              ],
            },
          );
        }
        const limit = elementLimit(vp, d.kind);
        if (nodes > limit) {
          throw mismatch(
            `${d.name} has ${nodes} elements, more than the ${limit} a ${vp.title.toLowerCase()} view holds`,
            {
              reason: "limits",
              wanted: { viewpoint: vp.name, kind: d.kind },
              alternatives: [
                { viewpoint: vp.name, kind: d.kind, why: vp.split },
              ],
            },
          );
        }
      }
      const out = await buildDerived(chosen, endpoints, {
        dryRun: input.dryRun,
        profile,
        template: findTemplate(decision.template),
      });
      return {
        choice: {
          viewpoint: decision.viewpoint,
          kind: decision.kind,
          template: decision.template,
          rule: decision.rule,
          reason: decision.reason,
          question: vp.question,
          matched: decision.matched,
        },
        scope: pathOf(scope.elem),
        ...out,
        ...(input.dryRun && { dryRun: true }),
      };
    },
  });
}
