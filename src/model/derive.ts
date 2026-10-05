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

import type { Kind } from "../build/spec.js";
import type { Profile } from "../style/profile.js";
import type { Element } from "../types.js";
import { VIEWS_TAG } from "./plan.js";
import type { ModelViews } from "./spec.js";

/*
 * The rules that derive diagrams from a model (issue #33): which elements
 * each diagram shows, as a /build_diagram spec whose nodes and edges are
 * bound to the model elements they show, so a build shows the model rather
 * than copying it and a second derivation finds every view again.
 */

export const DERIVED_KINDS = [
  "package",
  "class",
  "sequence",
  "usecase",
  "statemachine",
  "activity",
  "erd",
  "c4",
  "deployment",
  "mindmap",
] as const satisfies readonly Kind[];
export type DerivedKind = (typeof DERIVED_KINDS)[number];

export interface Derived {
  kind: DerivedKind;
  name: string;
  /** Owner of the diagram: the package, interaction or state machine it shows. */
  parent: Element;
  spec: Record<string, unknown>;
  bind: Map<string, Element>;
  bindEdges: Map<number, Element>;
  /** Classes whose operations are all accessors, for policy.hideGetters. */
  accessorsOnly: Element[];
}

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

const is = (e: Element | null | undefined, typeName: string) =>
  !!e && e.constructor.name === typeName;

/** `root` and everything it owns through ownedElements, owners first. */
function owned(root: Element): Element[] {
  return [root, ...list(root.ownedElements).flatMap(owned)];
}

/** The model a scope belongs to: itself, or its nearest UMLModel owner. */
export function modelOf(scope: Element): Element | null {
  for (let e: Element | null | undefined = scope; e; e = e._parent) {
    if (is(e, "UMLModel")) return e;
  }
  return null;
}

/** The view sections /build_model stored with the model, if any. */
export function viewsOf(model: Element | null): ModelViews {
  const tag = list(model?.tags).find((t) => t.name === VIEWS_TAG);
  if (!tag) return {};
  try {
    return JSON.parse(String(tag.value)) as ModelViews;
  } catch {
    // A tag edited by hand into something else is no view at all.
    return {};
  }
}

const CLASSIFIERS = ["UMLClass", "UMLInterface", "UMLEnumeration"];
const ACCESSOR = /^(get|set|is)[A-Z]/;

/** The ends of a relationship, source first. */
function ends(r: Element): [Element | null, Element | null] {
  if ("source" in r) return [r.source as Element, r.target as Element];
  return [
    (r.end1 as Element).reference as Element,
    (r.end2 as Element).reference as Element,
  ];
}

/** A relationship as a class diagram spec writes it, by node keys. */
function classRelation(r: Element, key: (e: Element) => string) {
  const [a, b] = ends(r) as [Element, Element];
  switch (r.constructor.name) {
    case "UMLGeneralization":
      return { from: key(a), to: key(b), type: "generalization" };
    case "UMLInterfaceRealization":
      return { from: key(a), to: key(b), type: "realization" };
    case "UMLDependency":
      return { from: key(a), to: key(b), type: "dependency" };
    default: {
      const [e1, e2] = [r.end1 as Element, r.end2 as Element];
      const type =
        e1.aggregation === "composite"
          ? "composition"
          : e1.aggregation === "shared"
            ? "aggregation"
            : e2.navigable === "navigable" && e1.navigable !== "navigable"
              ? "directed"
              : "association";
      return {
        from: key(a),
        to: key(b),
        type,
        ...(r.name ? { name: String(r.name) } : {}),
        ...(e1.multiplicity
          ? { fromMultiplicity: String(e1.multiplicity) }
          : {}),
        ...(e2.multiplicity ? { toMultiplicity: String(e2.multiplicity) } : {}),
      };
    }
  }
}

const CLASS_RELATIONS = new Set([
  "UMLAssociation",
  "UMLGeneralization",
  "UMLInterfaceRealization",
  "UMLDependency",
]);

/** Relationships among `shown`, each once, in the order the model holds them. */
function relationsAmong(
  shown: readonly Element[],
  types: Set<string>,
): Element[] {
  const set = new Set(shown);
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const e of shown) {
    for (const r of app.repository.getRelationshipsOf(e)) {
      if (seen.has(r) || !types.has(r.constructor.name)) continue;
      const [a, b] = ends(r);
      if (!a || !b || !set.has(a) || !set.has(b)) continue;
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Unique node keys: the name, or the name and its owner where names repeat. */
function keys(elements: readonly Element[]): Map<Element, string> {
  const count = new Map<string, number>();
  for (const e of elements) {
    count.set(String(e.name), (count.get(String(e.name)) ?? 0) + 1);
  }
  const out = new Map<Element, string>();
  for (const e of elements) {
    const name = String(e.name);
    out.set(
      e,
      count.get(name)! > 1 ? `${name} (${String(e._parent!.name)})` : name,
    );
  }
  return out;
}

const classKind = (c: Element) =>
  is(c, "UMLInterface")
    ? "interface"
    : is(c, "UMLEnumeration")
      ? "enum"
      : c.isAbstract === true
        ? "abstract"
        : "class";

/** A class diagram showing `classes`, in packages when `boxed`. */
function classDiagram(
  name: string,
  parent: Element,
  classes: readonly Element[],
): Derived {
  // Classes are drawn free of package boxes: dagre lays out what a box
  // holds as one wide block, which on the ThingsBoard views measured
  // 4200 units wide with edges through boxes (score 78 against 82 free).
  // Packages and their dependencies have the overview diagram.
  const key = keys(classes);
  // StarUML draws every relationship between elements a diagram shows
  // (Factory.createViewAndRelationships), so the spec lists them all and a
  // second derivation finds each one.
  const relations = relationsAmong(classes, CLASS_RELATIONS);
  const bind = new Map<string, Element>();
  for (const [e, k] of key) bind.set(k, e);
  return {
    kind: "class",
    name,
    parent,
    spec: {
      classes: classes.map((c) => ({ name: key.get(c), kind: classKind(c) })),
      relations: relations.map((r) => classRelation(r, (e) => key.get(e)!)),
    },
    bind,
    bindEdges: new Map(relations.map((r, i) => [i, r])),
    accessorsOnly: classes.filter((c) => {
      const ops = list(c.operations);
      return ops.length > 0 && ops.every((o) => ACCESSOR.test(String(o.name)));
    }),
  };
}

/** Parts of at most `max`, in order, named "Name (i/n)" when there are several. */
function split<T>(name: string, items: readonly T[], max: number) {
  const parts = Math.max(1, Math.ceil(items.length / max));
  return Array.from({ length: parts }, (_, i) => ({
    name: parts > 1 ? `${name} (${i + 1}/${parts})` : name,
    items: items.slice(i * max, (i + 1) * max),
  }));
}

interface Scope {
  model: Element;
  all: Element[];
  views: ModelViews;
  profile: Profile;
}

function classDiagrams(s: Scope): Derived[] {
  const classes = s.all.filter((e) => CLASSIFIERS.includes(e.constructor.name));
  const packages = s.all.filter((e) => is(e, "UMLPackage"));
  const max = s.profile.layout.maxElements;
  const byName = new Map(classes.map((c) => [String(c.name), c]));
  const packageOf = (ref: string) => {
    const name = s.views.contexts?.[ref] ?? ref;
    return packages.find((p) => p.name === name);
  };
  if (s.profile.policy.classDiagrams === "views" && s.views.classViews) {
    return s.views.classViews.flatMap((v) => {
      const contexts = (v.contexts ?? []).flatMap((c) => {
        const p = packageOf(c);
        return p ? [p] : [];
      });
      const exclude = new Set(v.exclude ?? []);
      const shown = [
        ...classes.filter(
          (c) => contexts.includes(c._parent!) && !exclude.has(String(c.name)),
        ),
        ...[...(v.classes ?? []), ...(v.also ?? [])].flatMap((n) => {
          const c = byName.get(n);
          return c ? [c] : [];
        }),
      ].filter((c, i, all) => all.indexOf(c) === i);
      return split(v.name, shown, max).map((part) =>
        classDiagram(part.name, s.model, part.items),
      );
    });
  }
  const groups: [Element, Element[]][] = [
    [s.model, classes.filter((c) => c._parent === s.model)],
    ...packages.map((p): [Element, Element[]] => [
      p,
      classes.filter((c) => c._parent === p),
    ]),
  ];
  return groups
    .filter(([, own]) => own.length > 0)
    .flatMap(([owner, own]) => {
      // Direct collaborators from elsewhere, shown so the package's
      // relationships to the rest of the model are visible.
      const neighbours = s.profile.policy.neighbours
        ? own.flatMap((c) =>
            app.repository
              .getRelationshipsOf(c)
              .filter((r) => CLASS_RELATIONS.has(r.constructor.name))
              .flatMap(ends)
              .filter(
                (e): e is Element =>
                  !!e && classes.includes(e) && !own.includes(e),
              ),
          )
        : [];
      const shown = [...own, ...neighbours].filter(
        (c, i, all) => all.indexOf(c) === i,
      );
      return split(String(owner.name), shown, max).map((part) =>
        classDiagram(part.name, owner, part.items),
      );
    });
}

function packageOverview(s: Scope): Derived[] {
  const packages = s.all.filter((e) => is(e, "UMLPackage"));
  if (!s.profile.policy.packageOverview || packages.length < 2) return [];
  const key = keys(packages);
  const deps = relationsAmong(packages, new Set(["UMLDependency"]));
  return [
    {
      kind: "package",
      name: `${String(s.model.name)} packages`,
      parent: s.model,
      spec: {
        packages: packages.map((p) => ({
          name: key.get(p),
          ...(key.has(p._parent!) && { parent: key.get(p._parent!) }),
        })),
        dependencies: deps.map((d) => {
          const [a, b] = ends(d) as [Element, Element];
          return { from: key.get(a), to: key.get(b) };
        }),
      },
      bind: new Map([...key].map(([e, k]) => [k, e])),
      bindEdges: new Map(deps.map((d, i) => [i, d])),
      accessorsOnly: [],
    },
  ];
}

const SORTS: Record<string, string> = {
  asynchCall: "async",
  asynchSignal: "async",
  reply: "reply",
  createMessage: "create",
  deleteMessage: "delete",
};

function sequenceDiagrams(s: Scope): Derived[] {
  return s.all
    .filter((e) => is(e, "UMLCollaboration"))
    .flatMap((collab) => {
      const interaction = list(collab.ownedElements).find((e) =>
        is(e, "UMLInteraction"),
      );
      if (!interaction) return [];
      const lifelines = list(interaction.participants);
      const messages = list(interaction.messages);
      const ranges = s.views.fragments?.[String(collab.name)] ?? [];
      const fragments = list(interaction.fragments);
      const bind = new Map<string, Element>(
        lifelines.map((l) => [String(l.name), l]),
      );
      fragments.forEach((f, i) => {
        if (ranges[i]) bind.set(`fragment ${i}`, f);
      });
      return [
        {
          kind: "sequence" as const,
          name: String(collab.name),
          parent: interaction,
          spec: {
            participants: lifelines.map((l) => String(l.name)),
            messages: messages.map((m) => ({
              from: String((m.source as Element).name),
              to: String((m.target as Element).name),
              text: String(m.name),
              kind: SORTS[String(m.messageSort)] ?? "sync",
            })),
            ...(ranges.length > 0 && {
              fragments: ranges.slice(0, fragments.length),
            }),
          },
          bind,
          bindEdges: new Map(messages.map((m, i) => [i, m])),
          accessorsOnly: [],
        },
      ];
    });
}

const PSEUDO: Record<string, string> = {
  initial: "initial",
  choice: "choice",
  fork: "fork",
  join: "join",
};

function stateDiagrams(s: Scope): Derived[] {
  return s.all
    .filter((e) => is(e, "UMLStateMachine"))
    .map((machine) => {
      const states: Record<string, unknown>[] = [];
      const transitions: Element[] = [];
      const bind = new Map<string, Element>();
      const keyOf = new Map<Element, string>();
      const visit = (region: Element, parent: string | undefined) => {
        for (const v of list(region.vertices)) {
          const pseudo = is(v, "UMLPseudostate")
            ? (PSEUDO[String(v.kind)] ?? "choice")
            : is(v, "UMLFinalState")
              ? "final"
              : "state";
          const key = `s${keyOf.size}`;
          keyOf.set(v, key);
          bind.set(key, v);
          states.push({
            id: key,
            ...(pseudo === "state" && { name: String(v.name) }),
            type: pseudo,
            ...(parent !== undefined && { parent }),
          });
          for (const r of list(v.regions)) visit(r, key);
        }
        transitions.push(...list(region.transitions));
      };
      for (const r of list(machine.regions)) visit(r, undefined);
      const shown = transitions.filter(
        (t) => keyOf.has(t.source as Element) && keyOf.has(t.target as Element),
      );
      return {
        kind: "statemachine" as const,
        name: String(machine.name),
        parent: machine,
        spec: {
          states,
          transitions: shown.map((t) => ({
            from: keyOf.get(t.source as Element),
            to: keyOf.get(t.target as Element),
            ...(t.name ? { trigger: String(t.name) } : {}),
            ...(t.guard ? { guard: String(t.guard) } : {}),
          })),
        },
        bind,
        bindEdges: new Map(shown.map((t, i) => [i, t])),
        accessorsOnly: [],
      };
    });
}

const USECASE_RELATIONS: Record<string, string> = {
  UMLAssociation: "association",
  UMLInclude: "include",
  UMLExtend: "extend",
  UMLGeneralization: "generalization",
};

function usecaseDiagram(
  name: string,
  parent: Element,
  actors: Element[],
  cases: Element[],
  subject: Element | undefined,
): Derived {
  const shown = [...actors, ...cases];
  const relations = relationsAmong(
    shown,
    new Set(Object.keys(USECASE_RELATIONS)),
  );
  const bind = new Map<string, Element>(shown.map((e) => [String(e.name), e]));
  if (subject) bind.set(String(subject.name), subject);
  return {
    kind: "usecase",
    name,
    parent,
    spec: {
      ...(subject && { system: String(subject.name) }),
      actors: actors.map((a) => String(a.name)),
      useCases: cases.map((u) => String(u.name)),
      relations: relations.map((r) => {
        const [a, b] = ends(r) as [Element, Element];
        return {
          from: String(a.name),
          to: String(b.name),
          type: USECASE_RELATIONS[r.constructor.name],
        };
      }),
    },
    bind,
    bindEdges: new Map(relations.map((r, i) => [i, r])),
    accessorsOnly: [],
  };
}

function usecaseDiagrams(s: Scope): Derived[] {
  const actors = s.all.filter((e) => is(e, "UMLActor"));
  const cases = s.all.filter((e) => is(e, "UMLUseCase"));
  const subjects = s.all.filter((e) => is(e, "UMLUseCaseSubject"));
  if (cases.length === 0) return [];
  const named = (pool: Element[], names: string[] = []) =>
    names.flatMap((n) => pool.filter((e) => e.name === n).slice(0, 1));
  const subjectOf = (shown: Element[]) => {
    const names = new Set(shown.map((u) => s.views.subjects?.[String(u.name)]));
    const [only] = [...names];
    return names.size === 1 && only !== undefined
      ? subjects.find((x) => x.name === only)
      : undefined;
  };
  const actorsOf = (shown: Element[]) =>
    actors.filter(
      (a) =>
        relationsAmong([a, ...shown], new Set(["UMLAssociation"])).length > 0,
    );
  if (s.views.useCaseViews) {
    return s.views.useCaseViews.map((v) => {
      const shown = named(cases, v.cases);
      const people = named(actors, [
        ...(v.actor !== undefined ? [v.actor] : []),
        ...(v.actors ?? []),
        ...(v.extraActors ?? []),
      ]);
      return usecaseDiagram(v.name, s.model, people, shown, subjectOf(shown));
    });
  }
  const groups = new Map<string, Element[]>();
  for (const u of cases) {
    const group = s.views.subjects?.[String(u.name)] ?? "";
    groups.set(group, [...(groups.get(group) ?? []), u]);
  }
  return [...groups].map(([group, shown]) =>
    usecaseDiagram(
      group || `${String(s.model.name)} use cases`,
      s.model,
      actorsOf(shown),
      shown,
      subjectOf(shown),
    ),
  );
}

/** [from, to, a, b, c] as an object with those field names. */
function tuple<T extends Record<string, unknown>>(
  value: unknown,
  fields: readonly string[],
): T {
  if (!Array.isArray(value)) return value as T;
  return Object.fromEntries(
    value.flatMap((v, i) =>
      v === undefined || !fields[i] ? [] : [[fields[i], v]],
    ),
  ) as T;
}

/** Diagrams drawn from the view sections, made by the build the first time. */
function sectionDiagrams(s: Scope): Derived[] {
  const v = s.views;
  const plain = (
    kind: DerivedKind,
    name: string,
    spec: Record<string, unknown>,
  ): Derived => ({
    kind,
    name,
    parent: s.model,
    spec,
    bind: new Map(),
    bindEdges: new Map(),
    accessorsOnly: [],
  });
  return [
    ...(v.activities ?? []).map((a) =>
      plain("activity", a.name, {
        ...(a.lanes && { lanes: a.lanes }),
        nodes: a.nodes,
        flows: a.flows.map((f) => tuple(f, ["from", "to", "guard"])),
      }),
    ),
    ...(v.erd
      ? [
          plain("erd", v.erd.name ?? `${String(s.model.name)} data model`, {
            entities: v.erd.entities,
            relationships: (v.erd.relationships ?? []).map((r) =>
              tuple(r, [
                "from",
                "to",
                "fromCardinality",
                "toCardinality",
                "name",
              ]),
            ),
          }),
        ]
      : []),
    ...(v.components
      ? [
          plain(
            "c4",
            v.components.name ?? `${String(s.model.name)} containers`,
            {
              elements: v.components.elements,
              relations: (v.components.relations ?? []).map((r) =>
                tuple(r, ["from", "to", "label", "technology", "description"]),
              ),
            },
          ),
        ]
      : []),
    ...(v.deployments ?? []).map((d) =>
      plain("deployment", d.name, {
        nodes: d.nodes.map((n) => ({
          name: n.name,
          ...(n.kind !== undefined &&
            n.kind !== "node" && { stereotype: n.kind }),
          ...(n.parent !== undefined && { parent: n.parent }),
          ...(n.contains && { deploys: n.contains }),
        })),
        artifacts: [...new Set(d.nodes.flatMap((n) => n.contains ?? []))],
        paths: (d.links ?? []).map((l) => tuple(l, ["from", "to", "name"])),
      }),
    ),
    ...(v.features
      ? [plain("mindmap", v.features.name, { root: v.features })]
      : []),
  ];
}

/**
 * Every diagram the model in `scope` derives to, by the policy, in a fixed
 * order: package overview, class, sequence, use case, state machine, then
 * the view sections' activities, ERD, C4, deployments and mind map.
 */
export function derive(
  scope: Element,
  profile: Profile,
  kinds?: ReadonlySet<DerivedKind>,
): Derived[] {
  const model = modelOf(scope) ?? scope;
  const s: Scope = { model, all: owned(scope), views: viewsOf(model), profile };
  return [
    ...packageOverview(s),
    ...classDiagrams(s),
    ...sequenceDiagrams(s),
    ...usecaseDiagrams(s),
    ...stateDiagrams(s),
    ...sectionDiagrams(s),
  ].filter((d) => !kinds || kinds.has(d.kind));
}
