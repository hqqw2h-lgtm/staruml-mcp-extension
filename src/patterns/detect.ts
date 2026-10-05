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

import { pathOf } from "../refs.js";
import type { Element } from "../types.js";
import type {
  Pattern,
  PatternCheck,
  PatternRelationship,
  Role,
} from "./schema.js";

/*
 * Structural matching of the pattern library against a model (issue #30).
 * A role binds the classifiers its relationships to roles already bound
 * lead to, starting from an anchor role tried on every classifier; each
 * binding is scored by the share of what the pattern prescribes that the
 * model has: element types and properties, members with theirs,
 * relationships with their ends. Member names count, so an instance made
 * by /apply_pattern scores 1 and a hand-made one somewhat less.
 */

export type Binding = Map<string, Element[]>;

export interface Detection {
  pattern: string;
  variant?: string;
  confidence: number;
  roles: Record<string, { _id: string; path: string | null }[]>;
  /** What the pattern prescribes that the model lacks, at most ten. */
  missing: string[];
  binding: Binding;
}

/** Owned lists of classifiers and operations, which every instance has. */
const list = (v: unknown) => v as Element[];

/** Whether `elem` can play a role of `type`: an abstract class stands for an interface. */
function fits(role: Role, elem: Element): boolean {
  const t = elem.constructor.name;
  if (t === role.type) return true;
  return (
    role.type === "UMLInterface" && t === "UMLClass" && elem.isAbstract === true
  );
}

const ends = (r: Element): [Element | undefined, Element | undefined] =>
  "source" in r
    ? [r.source as Element, r.target as Element]
    : [
        (r.end1 as Element | undefined)?.reference as Element | undefined,
        (r.end2 as Element | undefined)?.reference as Element | undefined,
      ];

/**
 * Relationships of an element, read once per detection run: every pattern
 * and every anchor asks again for the same elements' relationships.
 */
let memo: Map<Element, Element[]> | null = null;

function relationshipsOf(elem: Element): Element[] {
  const known = memo?.get(elem);
  if (known) return known;
  const found = app.repository.getRelationshipsOf(elem);
  memo?.set(elem, found);
  return found;
}

/** Runs `detection` with relationship reads shared across its patterns. */
export function sharingRelationships<T>(detection: () => T): T {
  memo = new Map();
  try {
    return detection();
  } finally {
    memo = null;
  }
}

const RELATION_TYPES: Record<PatternRelationship["type"], string> = {
  association: "UMLAssociation",
  aggregation: "UMLAssociation",
  composition: "UMLAssociation",
  generalization: "UMLGeneralization",
  realization: "UMLInterfaceRealization",
  dependency: "UMLDependency",
};

/** The model relationships that can stand for `r` from `from` to `to`. */
export function relationsFor(
  r: PatternRelationship,
  from: Element,
  to: Element,
): Element[] {
  const type = RELATION_TYPES[r.type];
  return relationshipsOf(from).filter((m) => {
    if (m.constructor.name !== type) return false;
    const [a, b] = ends(m);
    // An association's ends may be drawn either way round.
    return (
      (a === from && b === to) ||
      (type === "UMLAssociation" && a === to && b === from)
    );
  });
}

/** Elements related to `elem` as `r` relates its from side to its to side. */
function neighbours(
  r: PatternRelationship,
  elem: Element,
  fromSide: boolean,
): Element[] {
  const type = RELATION_TYPES[r.type];
  const out: Element[] = [];
  for (const m of relationshipsOf(elem)) {
    if (m.constructor.name !== type) continue;
    const [a, b] = ends(m);
    if (fromSide && a === elem && b) out.push(b);
    else if (!fromSide && b === elem && a) out.push(a);
    else if (type === "UMLAssociation") {
      // Either way round.
      if (a === elem && b) out.push(b);
      else if (b === elem && a) out.push(a);
    }
  }
  return [...new Set(out)];
}

const roleName = (name: string, self: Element) =>
  /^\{[^{}]+\}$/.test(name) ? (self.name as string) : name;

/** Scores of one pattern binding: weights met and in all, and what is missing. */
class Score {
  met = 0;
  total = 0;
  readonly missing: string[] = [];
  add(weight: number, ok: boolean, what: () => string): void {
    this.total += weight;
    if (ok) this.met += weight;
    else if (this.missing.length < 10) this.missing.push(what());
  }
}

const typeName = (value: unknown) =>
  value && typeof value === "object" ? (value as Element) : value;

/** Whether a member's type is what the pattern writes: {Role} is that role's element. */
function sameType(written: string, actual: unknown, binding: Binding): boolean {
  const role = /^\{([^{}]+)\}$/.exec(written)?.[1];
  const elem = typeName(actual);
  if (role !== undefined)
    return (binding.get(role) ?? []).includes(elem as Element);
  return (
    (typeof elem === "object" && elem !== null
      ? (elem as Element).name
      : elem) === written
  );
}

function scoreRole(
  s: Score,
  role: Role,
  elem: Element,
  binding: Binding,
  share: number,
) {
  const at = pathOf(elem)!;
  s.add(
    share,
    fits(role, elem),
    () => `${at} is a ${elem.constructor.name}, not a ${role.type}`,
  );
  for (const [k, v] of Object.entries(role.properties ?? {})) {
    s.add(share, elem[k] === v, () => `${at}.${k} is not ${String(v)}`);
  }
  if (role.stereotype !== undefined) {
    const st = typeName(elem.stereotype);
    const name =
      typeof st === "object" && st !== null ? (st as Element).name : st;
    s.add(
      share,
      name === role.stereotype,
      () => `${at} is not «${role.stereotype}»`,
    );
  }
  for (const a of role.attributes ?? []) {
    const found = list(elem.attributes).find((x) => x.name === a.name);
    s.add(share, found !== undefined, () => `${at} has no attribute ${a.name}`);
    for (const [k, v] of Object.entries(a)) {
      if (k === "name" || k === "documentation" || k === "defaultValue")
        continue;
      const ok =
        found !== undefined &&
        (k === "type"
          ? sameType(v as string, found.type, binding)
          : found[k] === v);
      s.add(share / 2, ok, () => `${at}.${a.name} ${k} is not ${String(v)}`);
    }
  }
  for (const o of role.operations ?? []) {
    const name = roleName(o.name, elem);
    const found = list(elem.operations).find((x) => x.name === name);
    s.add(share, found !== undefined, () => `${at} has no operation ${name}()`);
    for (const [k, v] of Object.entries(o)) {
      if (k === "name" || k === "documentation" || k === "parameters") continue;
      let ok = false;
      if (found && k === "returnType") {
        const ret = list(found.parameters).find(
          (x) => x.direction === "return",
        );
        ok = ret !== undefined && sameType(v as string, ret.type, binding);
      } else if (found && k === "stereotype") {
        const st = typeName(found.stereotype);
        ok =
          (typeof st === "object" && st !== null
            ? (st as Element).name
            : st) === v;
      } else if (found) ok = found[k] === v;
      s.add(share / 2, ok, () => `${at}#${name}() ${k} is not ${String(v)}`);
    }
  }
}

function scoreRelationship(s: Score, r: PatternRelationship, binding: Binding) {
  const froms = binding.get(r.from) ?? [];
  const tos = binding.get(r.to) ?? [];
  if (froms.length === 0 || tos.length === 0) {
    s.add(2, false, () => `no ${r.type} from ${r.from} to ${r.to}`);
    return;
  }
  const pairs = froms.length * tos.length;
  for (const from of froms) {
    for (const to of tos) {
      const found = relationsFor(r, from, to)[0];
      s.add(
        2 / pairs,
        found !== undefined,
        () => `no ${r.type} from ${from.name} to ${to.name}`,
      );
      if (found === undefined || found.constructor.name !== "UMLAssociation")
        continue;
      const flipped = (found.end1 as Element).reference !== from;
      const fromEnd = (flipped ? found.end2 : found.end1) as Element;
      const toEnd = (flipped ? found.end1 : found.end2) as Element;
      const aggregation = { aggregation: "shared", composition: "composite" }[
        r.type as "aggregation" | "composition"
      ];
      const want: [Element, Record<string, unknown>][] = [
        [fromEnd, { ...r.fromEnd, ...(aggregation && { aggregation }) }],
        [toEnd, { ...r.toEnd }],
      ];
      for (const [end, props] of want) {
        for (const [k, v] of Object.entries(props)) {
          s.add(
            1 / (2 * pairs),
            end[k] === v,
            () => `${r.from} -> ${r.to} end ${k} is not ${String(v)}`,
          );
        }
      }
    }
  }
}

/** How well `binding` realizes `pattern`, 0 to 1. */
export function score(pattern: Pattern, binding: Binding): Score {
  const s = new Score();
  for (const role of pattern.roles) {
    const elems = binding.get(role.name) ?? [];
    if (elems.length === 0) {
      if (role.optional) continue;
      s.add(1, false, () => `nothing plays ${role.name}`);
      continue;
    }
    for (const elem of elems)
      scoreRole(s, role, elem, binding, 1 / elems.length);
  }
  for (const r of pattern.relationships) {
    const optional = [r.from, r.to].some(
      (x) =>
        pattern.roles.find((role) => role.name === x)?.optional &&
        !binding.get(x)?.length,
    );
    if (!optional) scoreRelationship(s, r, binding);
  }
  return s;
}

const MAX_BRANCH = 6;

/** A way from a bound role's element to candidates for another role. */
interface Edge {
  from: string;
  to: string;
  /** Candidates for `to` (or `from`, with toSide false) next to `elem`. */
  next(elem: Element, toSide: boolean): Element[];
  /** A member type leads only from the member's owner to its type. */
  forwardOnly?: boolean;
}

const ROLE_TYPE = /^\{([^{}]+)\}$/;

/** The classifier a member's type names, if it is one. */
const typeElement = (value: unknown): Element[] =>
  value instanceof type.Model ? [value as Element] : [];

/**
 * The pattern's relationships, and the member types that name roles: an
 * operation returning {Product} leads from its role to Product's, which
 * tells two product kinds apart where a dependency would not.
 */
function edgesOf(pattern: Pattern): Edge[] {
  const edges: Edge[] = pattern.relationships.map((r) => ({
    from: r.from,
    to: r.to,
    next: (elem, toSide) => neighbours(r, elem, toSide),
  }));
  for (const role of pattern.roles) {
    const typed = (
      text: string | undefined,
      read: (e: Element) => unknown[],
    ) => {
      const target = text === undefined ? undefined : ROLE_TYPE.exec(text)?.[1];
      if (target === undefined || target === role.name) return;
      edges.push({
        from: role.name,
        to: target,
        next: (elem) => read(elem).flatMap(typeElement),
        forwardOnly: true,
      });
    };
    for (const a of role.attributes ?? []) {
      typed(a.type, (e) =>
        list(e.attributes)
          .filter((x) => x.name === a.name)
          .map((x) => x.type),
      );
    }
    for (const o of role.operations ?? []) {
      const ops = (e: Element) =>
        list(e.operations).filter((x) => x.name === roleName(o.name, e));
      typed(o.returnType, (e) =>
        ops(e).flatMap((x) =>
          list(x.parameters)
            .filter((y) => y.direction === "return")
            .map((y) => y.type),
        ),
      );
      for (const param of o.parameters ?? []) {
        typed(param.type, (e) =>
          ops(e).flatMap((x) =>
            list(x.parameters)
              .filter((y) => y.name === param.name)
              .map((y) => y.type),
          ),
        );
      }
    }
  }
  return edges;
}

/**
 * Bindings that extend `binding` along the pattern's edges. The role
 * next bound is the one its edges narrow to the fewest candidates (all
 * its edges from bound roles must agree where they can): a one-element
 * role tries each candidate, a many role takes them all.
 */
function extend(
  pattern: Pattern,
  edges: readonly Edge[],
  binding: Binding,
  inScope: (e: Element) => boolean,
  out: Binding[],
): void {
  const used = new Set([...binding.values()].flat());
  let best: { role: Role; candidates: Element[] } | null = null;
  const empty: Role[] = [];
  for (const role of pattern.roles) {
    if (binding.has(role.name)) continue;
    const sets: Element[][] = [];
    for (const e of edges) {
      if (e.to === role.name && binding.has(e.from)) {
        sets.push(binding.get(e.from)!.flatMap((x) => e.next(x, true)));
      } else if (e.from === role.name && binding.has(e.to) && !e.forwardOnly) {
        sets.push(binding.get(e.to)!.flatMap((x) => e.next(x, false)));
      }
    }
    if (sets.length === 0) continue;
    const ok = (x: Element) => !used.has(x) && inScope(x) && fits(role, x);
    const nonEmpty = sets
      .map((set) => [...new Set(set)].filter(ok))
      .filter((set) => set.length > 0);
    if (nonEmpty.length === 0) {
      empty.push(role);
      continue;
    }
    const common = nonEmpty.reduce((a, b) => a.filter((x) => b.includes(x)));
    const candidates =
      common.length > 0
        ? common
        : nonEmpty.sort((a, b) => a.length - b.length)[0]!;
    if (
      !best ||
      candidates.length < best.candidates.length ||
      (candidates.length === best.candidates.length &&
        role.cardinality === "1" &&
        best.role.cardinality === "many")
    ) {
      best = { role, candidates };
    }
  }
  if (!best) {
    if (empty.length === 0) {
      out.push(binding);
      return;
    }
    // Roles nothing leads to: an empty list marks them tried, and the
    // search goes on from the roles binding them would have reached.
    const tried = new Map(binding);
    for (const role of empty) tried.set(role.name, []);
    extend(pattern, edges, tried, inScope, out);
    return;
  }
  const { role, candidates } = best;
  if (role.cardinality === "many") {
    extend(
      pattern,
      edges,
      new Map([...binding, [role.name, candidates]]),
      inScope,
      out,
    );
    return;
  }
  for (const c of candidates.slice(0, MAX_BRANCH)) {
    extend(
      pattern,
      edges,
      new Map([...binding, [role.name, [c]]]),
      inScope,
      out,
    );
  }
}

/** The role most relationships touch, preferring one-element roles. */
function anchorOf(pattern: Pattern): Role {
  const degree = (role: Role) =>
    pattern.relationships.filter(
      (r) => r.from === role.name || r.to === role.name,
    ).length + (role.cardinality === "1" ? 0.5 : 0);
  return [...pattern.roles].sort((a, b) => degree(b) - degree(a))[0]!;
}

const signature = (binding: Binding) =>
  [...binding]
    .map(
      ([role, elems]) =>
        `${role}=${elems
          .map((e) => e._id)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join(";");

/** Instances of `pattern` among `classifiers`, best first, at or above `min`. */
export function detect(
  pattern: Pattern,
  classifiers: readonly Element[],
  min: number,
  variant?: string,
): Detection[] {
  const scope = new Set(classifiers);
  const anchor = anchorOf(pattern);
  const edges = edgesOf(pattern);
  const found = new Map<string, Detection>();
  // An anchor with none of the relationships its role has binds no other
  // role, and alone scores far below any useful confidence.
  const optional = new Set(
    pattern.roles.filter((r) => r.optional).map((r) => r.name),
  );
  const needed = new Set(
    pattern.relationships
      .filter(
        (r) =>
          (r.from === anchor.name && !optional.has(r.to)) ||
          (r.to === anchor.name && !optional.has(r.from)),
      )
      .map((r) => RELATION_TYPES[r.type]),
  );
  for (const elem of classifiers) {
    if (!fits(anchor, elem)) continue;
    if (
      needed.size > 0 &&
      !relationshipsOf(elem).some((r) => needed.has(r.constructor.name))
    ) {
      continue;
    }
    const bindings: Binding[] = [];
    extend(
      pattern,
      edges,
      new Map([[anchor.name, [elem]]]),
      (e) => scope.has(e),
      bindings,
    );
    for (const binding of bindings) {
      const s = score(pattern, binding);
      const confidence = Math.round((s.met / s.total) * 100) / 100;
      if (confidence < min) continue;
      // Each anchor element starts bindings of its own, so none repeats.
      const key = signature(binding);
      found.set(key, {
        pattern: pattern.name,
        ...(variant !== undefined && { variant }),
        confidence,
        roles: Object.fromEntries(
          [...binding].map(([role, elems]) => [
            role,
            elems.map((e) => ({ _id: e._id, path: pathOf(e) })),
          ]),
        ),
        missing: s.missing,
        binding,
      });
    }
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

export interface Violation {
  check: PatternCheck;
  element: Element;
}

/** The checks of `pattern` a detected binding fails. */
export function violations(pattern: Pattern, binding: Binding): Violation[] {
  const out: Violation[] = [];
  for (const check of pattern.checks ?? []) {
    for (const elem of binding.get(check.role) ?? []) {
      let targets: Element[];
      if (check.relationship !== undefined) {
        const r = pattern.relationships[check.relationship]!;
        targets = (binding.get(r.to) ?? []).flatMap((to) =>
          relationsFor(r, elem, to).map((m) => {
            if (!check.end) return m;
            const flipped = (m.end1 as Element | undefined)?.reference !== elem;
            const fromEnd = (flipped ? m.end2 : m.end1) as Element;
            const toEnd = (flipped ? m.end1 : m.end2) as Element;
            return check.end === "from" ? fromEnd : toEnd;
          }),
        );
      } else if (check.member !== undefined) {
        const name = roleName(check.member, elem);
        targets = [...list(elem.attributes), ...list(elem.operations)].filter(
          (m) => m.name === name,
        );
      } else if (check.members !== undefined) {
        targets = list(elem[check.members]);
      } else {
        targets = [elem];
      }
      for (const t of targets) {
        if (t[check.property] !== check.equals) out.push({ check, element: t });
      }
    }
  }
  return out;
}
