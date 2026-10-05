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
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { byId, pathOf } from "../refs.js";
import { ref } from "../schemas.js";
import type { Element } from "../types.js";
import {
  counted,
  countsSchema,
  limitField,
  pickRules,
  SEVERITIES,
  type Severity,
} from "./lint.js";

/*
 * /uml_lint: modelling mistakes StarUML's own rules (app.validator, see
 * /validate_model) do not look for, each with a rule id and a one-line fix.
 */

export const UML_RULES = {
  U001: "association-end-multiplicity",
  U002: "association-navigability",
  U003: "attribute-type",
  U004: "dangling-relationship",
  U005: "abstract-without-subclass",
  U006: "interface-not-realized",
  U007: "message-without-operation",
  U008: "use-case-without-actor",
  U009: "state-machine-without-initial",
  U010: "state-machine-without-final",
  U011: "entity-without-primary-key",
  U012: "naming",
} as const;
type UmlRule = keyof typeof UML_RULES;

const DEFAULT_SEVERITY: Record<UmlRule, Severity> = {
  U001: "warning",
  U002: "info",
  U003: "warning",
  U004: "error",
  U005: "warning",
  U006: "warning",
  U007: "warning",
  U008: "warning",
  U009: "warning",
  U010: "info",
  U011: "warning",
  U012: "info",
};

export interface UmlFinding {
  rule: UmlRule;
  name: string;
  severity: Severity;
  message: string;
  id: string;
  path: string | null;
  fix: string;
}

/** Name patterns by convention name; anything else is a regular expression. */
const PRESETS: Record<string, RegExp> = {
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  UPPER_CASE: /^[A-Z][A-Z0-9_]*$/,
  snake_case: /^[a-z][a-z0-9_]*$/,
  lowercase: /^[a-z][a-z0-9.]*$/,
};

const NAMING_KINDS = {
  classifier: ["UMLClass", "UMLInterface", "UMLEnumeration", "UMLSignal"],
  attribute: ["UMLAttribute"],
  operation: ["UMLOperation"],
  literal: ["UMLEnumerationLiteral"],
  package: ["UMLPackage"],
} as const;
type NamingKind = keyof typeof NAMING_KINDS;

const DEFAULT_NAMING: Record<NamingKind, string | false> = {
  classifier: "PascalCase",
  attribute: "camelCase",
  operation: "camelCase",
  literal: "UPPER_CASE",
  package: false,
};

function compileNaming(
  given: Partial<Record<NamingKind, string | false>> | undefined,
): [NamingKind, string, RegExp][] {
  const naming = { ...DEFAULT_NAMING, ...given };
  return (Object.keys(NAMING_KINDS) as NamingKind[]).flatMap((k) => {
    const pattern = naming[k];
    if (pattern === false) return [];
    try {
      const re = Object.hasOwn(PRESETS, pattern)
        ? PRESETS[pattern]!
        : new RegExp(pattern, "u");
      return [[k, pattern, re]];
    } catch (err) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `naming.${k}: ${pattern} is neither ${Object.keys(PRESETS).join(", ")} nor a regular expression (${(err as Error).message})`,
      );
    }
  });
}

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];
const quoted = (e: Element) =>
  typeof e.name === "string" && e.name ? `"${e.name}"` : e.constructor.name;

function within(elem: Element, scope: Element): boolean {
  for (let e: Element | null | undefined = elem; e; e = e._parent) {
    if (e === scope) return true;
  }
  return false;
}

class Lint {
  readonly findings: UmlFinding[] = [];
  constructor(
    readonly scope: Element,
    private readonly severity: Map<UmlRule, Severity>,
  ) {}
  all(typeName: string): Element[] {
    return app.repository
      .getInstancesOf(typeName)
      .filter((e) => within(e, this.scope));
  }
  on(rule: UmlRule): boolean {
    return this.severity.has(rule);
  }
  add(rule: UmlRule, elem: Element, message: string, fix: string): void {
    this.findings.push({
      rule,
      name: UML_RULES[rule],
      severity: this.severity.get(rule)!,
      message,
      id: elem._id,
      path: pathOf(elem),
      fix,
    });
  }
}

/** Directed relationships of one of `typeNames` whose target is `elem`. */
function targetsOf(elem: Element, ...typeNames: string[]): Element[] {
  return app.repository
    .getRelationshipsOf(elem)
    .filter((r) => typeNames.includes(r.constructor.name) && r.target === elem);
}

function associations(l: Lint): void {
  for (const a of l.all("UMLAssociation")) {
    const ends = [a.end1, a.end2] as Element[];
    if (l.on("U001")) {
      const missing = ends.filter((e) => !e.multiplicity);
      if (missing.length > 0) {
        l.add(
          "U001",
          a,
          `The association ${quoted(a)} between ${ends.map((e) => quoted(e.reference as Element)).join(" and ")} has ${missing.length === 2 ? "no multiplicity on either end" : "an end without multiplicity"}`,
          "Set each end's multiplicity, e.g. /update_element {ref: <end id>, field: 'multiplicity', value: '1'}.",
        );
      }
    }
    if (l.on("U002") && ends.every((e) => e.navigable === "unspecified")) {
      l.add(
        "U002",
        a,
        `The association ${quoted(a)} does not say which way it is navigable`,
        "Set navigable on the end that can be reached, or build it as a directed association.",
      );
    }
  }
}

function attributes(l: Lint): void {
  for (const attr of l.all("UMLAttribute")) {
    if (!list(attr._parent?.attributes).includes(attr)) continue;
    if (attr.type) continue;
    l.add(
      "U003",
      attr,
      `The attribute ${quoted(attr)} of ${quoted(attr._parent!)} has no type`,
      "Give it a type, e.g. /update_element {ref: <path>, field: 'type', value: 'String'}.",
    );
  }
}

/** A reference to an element still in the project. */
const present = (value: unknown) =>
  !!value && byId((value as Element)._id) === value;

function dangling(l: Lint): void {
  for (const r of l.all("DirectedRelationship")) {
    if (present(r.source) && present(r.target)) continue;
    l.add(
      "U004",
      r,
      `The ${r.constructor.name} ${quoted(r)} is missing its ${present(r.source) ? "target" : "source"}`,
      "Delete it or reconnect it with /update_element (source/target).",
    );
  }
  for (const r of l.all("UndirectedRelationship")) {
    const ends = [r.end1, r.end2] as Element[];
    if (ends.every((e) => present(e.reference))) continue;
    l.add(
      "U004",
      r,
      `The ${r.constructor.name} ${quoted(r)} has an end that refers to nothing`,
      "Delete it or set the end's reference with /update_element.",
    );
  }
}

function hierarchy(l: Lint): void {
  if (l.on("U005")) {
    for (const cls of l.all("UMLClass")) {
      if (!cls.isAbstract || targetsOf(cls, "UMLGeneralization").length > 0) {
        continue;
      }
      l.add(
        "U005",
        cls,
        `The abstract class ${quoted(cls)} has no subclass`,
        "Add a subclass (generalization to it), or make it concrete.",
      );
    }
  }
  if (l.on("U006")) {
    for (const i of l.all("UMLInterface")) {
      const users = targetsOf(
        i,
        "UMLInterfaceRealization",
        "UMLRealization",
        "UMLGeneralization",
      );
      if (users.length > 0) continue;
      l.add(
        "U006",
        i,
        `The interface ${quoted(i)} is realized by no class`,
        "Add an interface realization from the class that implements it, or remove the interface.",
      );
    }
  }
}

/** Operations of a classifier and of what it specializes. */
function operationsOf(cls: Element, seen = new Set<Element>()): Element[] {
  if (seen.has(cls)) return [];
  seen.add(cls);
  const parents = app.repository
    .getRelationshipsOf(cls)
    .filter((r) => r instanceof type.UMLGeneralization && r.source === cls)
    .map((r) => r.target as Element);
  return [
    ...list(cls.operations),
    ...parents.flatMap((p) => operationsOf(p, seen)),
  ];
}

const CALLS = new Set(["synchCall", "asynchCall"]);

function messages(l: Lint): void {
  for (const m of l.all("UMLMessage")) {
    const name = (m.name as string).trim();
    if (!name || m.signature || !CALLS.has(String(m.messageSort))) continue;
    const role = (m.target as Element | null)?.represent as Element | null;
    const receiver = role?.type;
    // Without a classifier behind the receiving lifeline there is nothing to check against.
    if (!receiver || typeof receiver !== "object") continue;
    const called = name.replace(/\(.*$/s, "").trim();
    if (operationsOf(receiver as Element).some((o) => o.name === called)) {
      continue;
    }
    l.add(
      "U007",
      m,
      `The message ${quoted(m)} names no operation of ${quoted(receiver as Element)}`,
      `Add the operation (/add_operation {ref: '${pathOf(receiver as Element)}', name: '${called}'}) or rename the message.`,
    );
  }
}

function useCases(l: Lint): void {
  for (const uc of l.all("UMLUseCase")) {
    const related = app.repository.getRelationshipsOf(uc);
    const actor = related.some(
      (r) =>
        r instanceof type.UMLAssociation &&
        [r.end1, r.end2].some(
          (e) => (e as Element).reference instanceof type.UMLActor,
        ),
    );
    // Included and extending use cases are reached through another one.
    const reached = related.some(
      (r) =>
        (r instanceof type.UMLInclude && r.target === uc) ||
        (r instanceof type.UMLExtend && r.source === uc),
    );
    if (actor || reached) continue;
    l.add(
      "U008",
      uc,
      `The use case ${quoted(uc)} has no actor`,
      "Associate an actor with it, or include it from a use case that has one.",
    );
  }
}

function stateMachines(l: Lint): void {
  for (const sm of l.all("UMLStateMachine")) {
    const inner = (typeName: string) =>
      app.repository.getInstancesOf(typeName).filter((e) => within(e, sm));
    if (
      l.on("U009") &&
      !inner("UMLPseudostate").some((p) => p.kind === "initial")
    ) {
      l.add(
        "U009",
        sm,
        `The state machine ${quoted(sm)} has no initial state`,
        "Add an initial pseudostate with a transition to the first state.",
      );
    }
    if (l.on("U010") && inner("UMLFinalState").length === 0) {
      l.add(
        "U010",
        sm,
        `The state machine ${quoted(sm)} has no final state`,
        "Add a final state, unless the machine runs forever.",
      );
    }
  }
}

function entities(l: Lint): void {
  for (const e of l.all("ERDEntity")) {
    if (list(e.columns).some((c) => c.primaryKey)) continue;
    l.add(
      "U011",
      e,
      `The entity ${quoted(e)} has no primary key`,
      "Mark a column primaryKey, e.g. /update_element {ref: '<entity>.id', field: 'primaryKey', value: true}.",
    );
  }
}

function naming(l: Lint, patterns: [NamingKind, string, RegExp][]): void {
  for (const [k, pattern, re] of patterns) {
    for (const typeName of NAMING_KINDS[k]) {
      for (const e of l.all(typeName)) {
        // Exact kinds only: a UMLModel is a package, a primitive a classifier.
        if (e.constructor.name !== typeName) continue;
        const name = e.name as string;
        if (!name || re.test(name)) continue;
        l.add(
          "U012",
          e,
          `The ${k} name ${quoted(e)} is not ${pattern}`,
          `Rename it to fit ${pattern}, or pass naming.${k} to change the convention.`,
        );
      }
    }
  }
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function lintModel(
  scope: Element,
  severity: Map<UmlRule, Severity>,
  patterns: [NamingKind, string, RegExp][],
): UmlFinding[] {
  const l = new Lint(scope, severity);
  if (l.on("U001") || l.on("U002")) associations(l);
  if (l.on("U003")) attributes(l);
  if (l.on("U004")) dangling(l);
  hierarchy(l);
  if (l.on("U007")) messages(l);
  if (l.on("U008")) useCases(l);
  stateMachines(l);
  if (l.on("U011")) entities(l);
  if (l.on("U012")) naming(l, patterns);
  return l.findings.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule),
  );
}

const ruleSetting = () => z.enum(["off", ...SEVERITIES]);
const pattern = () => z.optional(z.union([z.string(), z.literal(false)]));

export const umlLint = defineEndpoint({
  path: "/uml_lint",
  description:
    "Check the model for modelling mistakes StarUML's own validation does not look for: association ends without multiplicity (U001) or navigability (U002), attributes without a type (U003), relationships missing an end (U004), abstract classes without a subclass (U005), interfaces nobody realizes (U006), sequence messages that name no operation of the receiver (U007), use cases without an actor (U008), state machines without an initial (U009) or final state (U010), ERD entities without a primary key (U011) and names off the naming convention (U012). Each finding has a rule id, the element's id and path, and a one-line fix. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(
      ref("Only this element and what it owns; default the project."),
    ),
    rules: z.optional(
      doc(
        z.record(z.string(), ruleSetting()),
        "Per rule id or name: off, or the severity to report it with, e.g. {U002: 'off', naming: 'warning'}.",
      ),
    ),
    naming: z.optional(
      doc(
        z.object({
          classifier: pattern(),
          attribute: pattern(),
          operation: pattern(),
          literal: pattern(),
          package: pattern(),
        }),
        "Naming convention per kind: PascalCase, camelCase, UPPER_CASE, snake_case, lowercase, a regular expression, or false to skip. Defaults: classifier PascalCase, attribute and operation camelCase, literal UPPER_CASE, package skipped.",
      ),
    ),
    limit: limitField(),
  }),
  response: z.object({
    count: doc(z.int(), "Findings in all."),
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
    pickRules(UML_RULES, Object.keys(given), "rules");
    const severity = new Map<UmlRule, Severity>();
    for (const id of Object.keys(UML_RULES) as UmlRule[]) {
      const setting = Object.entries(given).find(
        ([k]) => k === id || k === UML_RULES[id],
      )?.[1];
      if (setting === "off") continue;
      severity.set(
        id,
        (setting as Severity | undefined) ?? DEFAULT_SEVERITY[id],
      );
    }
    const patterns = compileNaming(input.naming);
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    return counted(lintModel(scope, severity, patterns), input.limit);
  },
});
