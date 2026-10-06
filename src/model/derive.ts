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
import { limitsFor, type Profile } from "../style/profile.js";
import type { Element } from "../types.js";
import type { ViewpointName } from "../viewpoints/schema.js";
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
  "communication",
] as const satisfies readonly Kind[];
export type DerivedKind = (typeof DERIVED_KINDS)[number];

export interface Derived {
  kind: DerivedKind;
  /** The viewpoint the diagram is a view of (issue #42). */
  viewpoint: ViewpointName;
  name: string;
  /** Owner of the diagram: the package, interaction or state machine it shows. */
  parent: Element;
  spec: Record<string, unknown>;
  bind: Map<string, Element>;
  bindEdges: Map<number, Element>;
  /** Classes whose operations are all accessors, for policy.hideGetters. */
  accessorsOnly: Element[];
  /**
   * The package under the model a section's diagram and the elements it
   * makes live in, so they share no namespace with the object model (a C4
   * person "Device" beside the actor "Device" is UML002) and two
   * deployments find each other's nodes.
   */
  home?: string;
}

/** The package each view section's elements live in. */
export const SECTION_HOMES = {
  c4: "Containers",
  deployment: "Deployment",
} as const;

const SHARED_TYPES = new Set(["UMLNode", "UMLArtifact"]);

/** The C4 element type a c4 spec element makes (C4_TYPES in build/spec.ts). */
const C4_MODEL_TYPES: Record<string, string> = {
  person: "C4Person",
  system: "C4SoftwareSystem",
  container: "C4Container",
  component: "C4Component",
};

/**
 * The elements a section spec names that its home already holds, bound so
 * the diagram shows them rather than making namesakes: a PostgreSQL node
 * drawn on two deployments is one node, and a person on the context view
 * is the one on the container view.
 */
export function bindShared(d: Derived, home: Element): void {
  const held = owned(home);
  if (d.kind === "c4") {
    const spec = d.spec as {
      elements: { id?: string; name: string; type: string }[];
    };
    for (const el of spec.elements) {
      const found = held.find(
        (e) =>
          e.constructor.name === C4_MODEL_TYPES[el.type] && e.name === el.name,
      );
      if (found) d.bind.set(el.id ?? el.name, found);
    }
    return;
  }
  const spec = d.spec as { nodes: { name: string }[]; artifacts: string[] };
  const names = new Set([...spec.nodes.map((n) => n.name), ...spec.artifacts]);
  for (const e of held) {
    const name = String(e.name);
    if (SHARED_TYPES.has(e.constructor.name) && names.has(name)) {
      d.bind.set(name, e);
    }
  }
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
    viewpoint: "code",
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
  // A package outside any model is its own model here: one group, not two.
  const groups: [Element, Element[]][] = [
    [s.model, classes.filter((c) => c._parent === s.model)],
    ...packages
      .filter((p) => p !== s.model)
      .map((p): [Element, Element[]] => [
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

/** Whether `p` is a view section's home, which holds no part of the object model. */
const isHome = (p: Element, model: Element) =>
  p._parent === model &&
  (Object.values(SECTION_HOMES) as string[]).includes(String(p.name));

function packageOverview(s: Scope): Derived[] {
  const packages = s.all.filter(
    (e) => is(e, "UMLPackage") && !isHome(e, s.model),
  );
  if (!s.profile.policy.packageOverview || packages.length < 2) return [];
  const key = keys(packages);
  const deps = relationsAmong(packages, new Set(["UMLDependency"]));
  return [
    {
      kind: "package",
      viewpoint: "component",
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
    .filter((e) => is(e, "UMLInteraction"))
    .flatMap((interaction) => {
      const collab = interaction._parent!;
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
          viewpoint: "runtime" as const,
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

/**
 * A collaboration's interaction drawn as a communication diagram: the
 * same lifelines and messages as its sequence diagram, each shown from the
 * model, StarUML drawing the connectors the messages run along
 * (viewForCommunicationDiagramFn, uml-factory.js in 7.1.1). Asked for by
 * kind only: the sequence diagram already shows the interaction.
 */
function communicationDiagrams(s: Scope): Derived[] {
  return s.all
    .filter((e) => is(e, "UMLInteraction"))
    .flatMap((interaction) => {
      const collab = interaction._parent!;
      const lifelines = list(interaction.participants).filter((l) =>
        is(l, "UMLLifeline"),
      );
      const shown = new Set(lifelines);
      const messages = list(interaction.messages).filter(
        (m) =>
          shown.has(m.source as Element) &&
          shown.has(m.target as Element) &&
          m.source !== m.target,
      );
      return [
        {
          kind: "communication" as const,
          viewpoint: "runtime" as const,
          name: `${String(collab.name)} communication`,
          parent: interaction,
          spec: {
            nodes: lifelines.map((l) => String(l.name)),
            edges: messages.map((m) => ({
              from: String((m.source as Element).name),
              to: String((m.target as Element).name),
              name: String(m.name),
            })),
          },
          bind: new Map(lifelines.map((l) => [String(l.name), l])),
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
        viewpoint: "lifecycle" as const,
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
  systemOf: (u: Element) => string | undefined,
): Derived {
  const shown = [...actors, ...cases];
  const outside = subject
    ? cases.filter((u) => systemOf(u) !== subject.name)
    : [];
  const relations = relationsAmong(
    shown,
    new Set(Object.keys(USECASE_RELATIONS)),
  );
  const bind = new Map<string, Element>(shown.map((e) => [String(e.name), e]));
  if (subject) bind.set(String(subject.name), subject);
  return {
    kind: "usecase",
    viewpoint: "actors-goals",
    name,
    parent,
    spec: {
      ...(subject && { system: String(subject.name) }),
      actors: actors.map((a) => String(a.name)),
      useCases: cases.map((u) => String(u.name)),
      ...(outside.length > 0 && {
        outside: outside.map((u) => String(u.name)),
      }),
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
  const systemOf = (u: Element) => s.views.subjects?.[String(u.name)];
  /**
   * The boundary a diagram draws: the system most of its use cases belong
   * to (the first on a tie); the others are drawn beside it.
   */
  const subjectOf = (shown: Element[]) => {
    const count = new Map<string, number>();
    for (const u of shown) {
      const name = systemOf(u);
      if (name !== undefined) count.set(name, (count.get(name) ?? 0) + 1);
    }
    const [top] = [...count].sort((a, b) => b[1] - a[1]);
    return top && subjects.find((x) => x.name === top[0]);
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
      return usecaseDiagram(
        v.name,
        s.model,
        people,
        shown,
        subjectOf(shown),
        systemOf,
      );
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
      systemOf,
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

interface Tree {
  name: string;
  children?: Tree[];
}

const size = (t: Tree): number =>
  1 + (t.children ?? []).reduce((n, c) => n + size(c), 0);

/**
 * A tree of more than `max` nodes as several, each the root with as many
 * whole branches as fit, named "Name (i/n)"; a branch larger than `max`
 * on its own goes alone. A 109-view mind map is a poster, not a diagram.
 */
export function splitTree(root: Tree, max: number) {
  if (size(root) <= max) return [{ name: root.name, root }];
  const parts: Tree[][] = [];
  let count = 1;
  for (const branch of root.children ?? []) {
    const last = parts.at(-1);
    if (last && count + size(branch) <= max) {
      last.push(branch);
      count += size(branch);
    } else {
      parts.push([branch]);
      count = 1 + size(branch);
    }
  }
  return parts.map((children, i) => ({
    name: `${root.name} (${i + 1}/${parts.length})`,
    root: { ...root, children },
  }));
}

type C4Element = NonNullable<ModelViews["components"]>["elements"][number];
interface C4Relation {
  from: string;
  to: string;
  label?: string;
  technology?: string;
  description?: string;
}

const RELATION_FIELDS = ["from", "to", "label", "technology", "description"];
const keyOfC4 = (e: { id?: string; name: string }) => e.id ?? e.name;

/**
 * The C4 section as views: people, systems and containers on the
 * container view; components, when there are any besides, on a view of
 * their own, since a component lives inside one container and a container
 * view shows none (issue #42).
 */
function c4Diagrams(s: Scope, plain: Plain): Derived[] {
  const c = s.views.components;
  if (!c) return [];
  const name = c.name ?? `${String(s.model.name)} containers`;
  const relations = (c.relations ?? []).map((r) =>
    tuple<C4Relation & Record<string, unknown>>(r, RELATION_FIELDS),
  );
  const parts = c.elements.filter((e) => e.type === "component");
  const rest = c.elements.filter((e) => e.type !== "component");
  const view = (
    viewpoint: ViewpointName,
    title: string,
    elements: C4Element[],
  ): Derived => {
    const keys = new Set(elements.map(keyOfC4));
    return {
      ...plain("c4", title, {
        elements,
        relations:
          elements.length === c.elements.length
            ? relations
            : relations.filter((r) => keys.has(r.from) && keys.has(r.to)),
      }),
      viewpoint,
      home: SECTION_HOMES.c4,
    };
  };
  if (parts.length === 0) return [view("container", name, rest)];
  if (rest.length === 0) return [view("component", name, parts)];
  return [
    view("container", name, rest),
    view("component", `${name} components`, parts),
  ];
}

/** The key the system in scope takes on a context view when the section names none. */
export const SYSTEM_KEY = "system in scope";

/**
 * The C4 section as a system context: its people and outside systems
 * around one box for the system, which every container and component of
 * the section collapses into, a relationship kept once per pair of ends.
 */
function contextDiagram(s: Scope, plain: Plain): Derived[] {
  const c = s.views.components;
  if (!c) return [];
  const own = c.elements.filter(
    (e) => e.type === "system" && e.external !== true,
  );
  const system: C4Element = own[0] ?? {
    id: SYSTEM_KEY,
    name: String(s.model.name),
    type: "system",
  };
  const inside = new Set(
    c.elements
      .filter((e) => e.type === "container" || e.type === "component")
      .map(keyOfC4),
  );
  const elements = [
    ...c.elements.filter((e) => e.type === "person"),
    ...(own.length > 0 ? [] : [system]),
    ...c.elements.filter((e) => e.type === "system"),
  ];
  // Relations the system's inside had with one neighbour become one,
  // labelled as the first and carrying every technology used.
  const merged = new Map<string, C4Relation & { techs: string[] }>();
  for (const r of (c.relations ?? []).map((r) =>
    tuple<C4Relation & Record<string, unknown>>(r, RELATION_FIELDS),
  )) {
    const at = (k: string) => (inside.has(k) ? keyOfC4(system) : k);
    const [from, to] = [at(r.from), at(r.to)];
    if (from === to) continue;
    const key = `${from}|${to}`;
    const known = merged.get(key) ?? { ...r, from, to, techs: [] };
    if (r.technology && !known.techs.includes(r.technology)) {
      known.techs.push(r.technology);
    }
    merged.set(key, known);
  }
  const relations = [...merged.values()].map(({ techs, ...r }) => ({
    ...r,
    ...(techs.length > 0 && { technology: techs.join(", ") }),
  }));
  return [
    {
      ...plain("c4", `${String(s.model.name)} context`, {
        elements,
        relations,
      }),
      viewpoint: "context",
      home: SECTION_HOMES.c4,
    },
  ];
}

type Plain = (
  kind: DerivedKind,
  name: string,
  spec: Record<string, unknown>,
) => Derived;

/** Viewpoints of the kinds a section draws in one way only. */
const SECTION_VIEWPOINTS = {
  activity: "runtime",
  erd: "data",
  deployment: "deployment",
  mindmap: "actors-goals",
} as const satisfies Partial<Record<DerivedKind, ViewpointName>>;

/** Diagrams drawn from the view sections, made by the build the first time. */
function sectionDiagrams(s: Scope, context: boolean): Derived[] {
  const v = s.views;
  const plain: Plain = (kind, name, spec) => ({
    kind,
    viewpoint:
      SECTION_VIEWPOINTS[kind as keyof typeof SECTION_VIEWPOINTS] ??
      "container",
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
    ...(context ? contextDiagram(s, plain) : []),
    ...c4Diagrams(s, plain),
    ...(v.deployments ?? []).map((d) => ({
      home: SECTION_HOMES.deployment,
      ...plain("deployment", d.name, {
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
    })),
    ...(v.features
      ? splitTree(v.features, limitsFor(s.profile).maxNodes).map((part) =>
          plain("mindmap", part.name, { root: part.root }),
        )
      : []),
  ];
}

export interface DeriveOptions {
  /** Also a system context from the C4 section, which only a request for one draws. */
  context?: boolean;
}

/**
 * Every diagram the model in `scope` derives to, by the policy, in a fixed
 * order: package overview, class, sequence, use case, state machine, then
 * the view sections' activities, ERD, C4 context (when asked) and
 * containers, deployments and mind map.
 */
export function derive(
  scope: Element,
  profile: Profile,
  kinds?: ReadonlySet<DerivedKind>,
  options: DeriveOptions = {},
): Derived[] {
  const model = modelOf(scope) ?? scope;
  const s: Scope = { model, all: owned(scope), views: viewsOf(model), profile };
  return [
    ...packageOverview(s),
    ...classDiagrams(s),
    ...sequenceDiagrams(s),
    ...usecaseDiagrams(s),
    ...stateDiagrams(s),
    ...sectionDiagrams(s, options.context === true),
    ...(kinds?.has("communication") ? communicationDiagrams(s) : []),
  ].filter((d) => !kinds || kinds.has(d.kind));
}

/**
 * A class with every classifier it is directly related to, as one class
 * diagram: the code view of a single class (issue #42).
 */
export function classNeighbourhood(cls: Element): Derived {
  const related = app.repository
    .getRelationshipsOf(cls)
    .filter((r) => CLASS_RELATIONS.has(r.constructor.name))
    .flatMap(ends)
    .filter(
      (e): e is Element =>
        !!e && e !== cls && CLASSIFIERS.includes(e.constructor.name),
    );
  const shown = [cls, ...related].filter((c, i, all) => all.indexOf(c) === i);
  return classDiagram(
    `${String(cls.name)} and its collaborators`,
    cls._parent!,
    shown,
  );
}

const treeSize = (t: Tree | undefined): number => (t ? size(t) : 0);

/**
 * How many nodes a derived diagram draws, and how many of them are
 * lifelines, by its spec: what a viewpoint's limits are held to.
 */
export function countNodes(d: Derived): { nodes: number; lifelines: number } {
  const spec = d.spec as Record<string, unknown[] | undefined> & {
    root?: Tree;
  };
  const n = (field: string) => spec[field]?.length ?? 0;
  switch (d.kind) {
    case "sequence":
      return { nodes: n("participants"), lifelines: n("participants") };
    case "communication":
      return { nodes: n("nodes"), lifelines: n("nodes") };
    case "class":
      return { nodes: n("classes"), lifelines: 0 };
    case "package":
      return { nodes: n("packages"), lifelines: 0 };
    case "usecase":
      return { nodes: n("actors") + n("useCases"), lifelines: 0 };
    case "statemachine":
      return { nodes: n("states"), lifelines: 0 };
    case "erd":
      return { nodes: n("entities"), lifelines: 0 };
    case "c4":
      return { nodes: n("elements"), lifelines: 0 };
    case "deployment":
      return { nodes: n("nodes") + n("artifacts"), lifelines: 0 };
    case "mindmap":
      return { nodes: treeSize(spec.root), lifelines: 0 };
    default:
      return { nodes: n("nodes"), lifelines: 0 };
  }
}
