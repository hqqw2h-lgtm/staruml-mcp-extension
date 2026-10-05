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

import {
  formatAttribute,
  formatOperation,
  typeText,
} from "../build/members.js";
import { DIAGRAM_TYPES, FLOWCHART_SHAPES, type Kind } from "../build/spec.js";
import { edgeViews, list, nodeViews } from "../handlers/describe.js";
import type { Element, View } from "../types.js";

/*
 * Reads a diagram back into the /build_diagram spec of its kind, from the
 * views on it: what the diagram shows, in the order it shows it. The text
 * writers work on these specs, so a diagram exported as Mermaid and built
 * again goes through the same spec both ways.
 */

export type Direction = "TD" | "LR" | "BT" | "RL";

export interface ClassSpec {
  packages: string[];
  classes: {
    name: string;
    kind: "class" | "interface" | "enum" | "abstract";
    package?: string;
    attributes: string[];
    operations: string[];
    literals: string[];
  }[];
  relations: {
    from: string;
    to: string;
    type: string;
    name?: string;
    fromMultiplicity?: string;
    toMultiplicity?: string;
  }[];
}

export interface SequenceSpec {
  participants: string[];
  messages: { from: string; to: string; text: string; kind: string }[];
  fragments: {
    operator: string;
    guard?: string;
    operands: string[];
    from: number;
    to: number;
  }[];
}

export interface UsecaseSpec {
  system?: string;
  actors: string[];
  useCases: { name: string; inSystem: boolean }[];
  relations: { from: string; to: string; type: string; name?: string }[];
}

export interface FlowNode {
  id: string;
  name: string;
  /** Activity node type, state type or flowchart shape. */
  type: string;
  lane?: string;
}

export interface ActivitySpec {
  lanes: string[];
  nodes: FlowNode[];
  flows: { from: string; to: string; guard?: string }[];
}

export interface StateSpec {
  states: FlowNode[];
  transitions: { from: string; to: string; trigger?: string; guard?: string }[];
}

export interface ErdSpec {
  entities: { name: string; columns: Column[] }[];
  relationships: {
    from: string;
    to: string;
    fromCardinality: string;
    toCardinality: string;
    identifying: boolean;
    name?: string;
  }[];
}

export interface Column {
  name: string;
  type: string;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
}

export interface FlowchartSpec {
  nodes: FlowNode[];
  flows: { from: string; to: string; label?: string }[];
}

export interface MindNode {
  name: string;
  children: MindNode[];
}

export type Extracted =
  | { kind: "class"; spec: ClassSpec }
  | { kind: "sequence"; spec: SequenceSpec }
  | { kind: "usecase"; spec: UsecaseSpec; direction: Direction }
  | { kind: "activity"; spec: ActivitySpec; direction: Direction }
  | { kind: "statemachine"; spec: StateSpec; direction: Direction }
  | { kind: "erd"; spec: ErdSpec }
  | { kind: "flowchart"; spec: FlowchartSpec; direction: Direction }
  | { kind: "mindmap"; spec: { roots: MindNode[] } };

const typeOf = (elem: Element) => elem.constructor.name;
/** Every model element has a name, "" when unnamed (core/core.js). */
const nameOf = (elem: Element | null) => elem!.name!;
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** The build kind whose diagram type `diagram` is, if any. */
export function kindOf(diagram: Element): Kind | null {
  const name = typeOf(diagram);
  const found = Object.entries(DIAGRAM_TYPES).find(([, t]) => t === name);
  return found ? (found[0] as Kind) : null;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const box = (view: View) => view as unknown as Box;
const centre = (view: View) => ({
  x: box(view).left + box(view).width / 2,
  y: box(view).top + box(view).height / 2,
});

function inside(view: View, container: View): boolean {
  const c = centre(view);
  const b = box(container);
  return (
    c.x >= b.left &&
    c.x <= b.left + b.width &&
    c.y >= b.top &&
    c.y <= b.top + b.height
  );
}

/**
 * The way edges mostly run, from tail to head centres, so a flow drawn left
 * to right is written LR. Ties and edgeless diagrams read top down.
 */
export function flowDirection(edges: readonly View[]): Direction {
  let dx = 0;
  let dy = 0;
  for (const e of edges) {
    const t = centre(e.tail as View);
    const h = centre(e.head as View);
    dx += h.x - t.x;
    dy += h.y - t.y;
  }
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "LR" : "RL";
  return dy < 0 ? "BT" : "TD";
}

/** Node views by model type, the rest reported as skipped. */
class Views {
  readonly skipped = new Map<string, number>();
  constructor(
    readonly nodes: View[],
    readonly edges: View[],
  ) {}

  skip(view: View): void {
    const t = typeOf(view.model!);
    this.skipped.set(t, (this.skipped.get(t) ?? 0) + 1);
  }

  warnings(): string[] {
    return [...this.skipped].map(
      ([t, n]) => `${n} ${t} ${n === 1 ? "view is" : "views are"} not written`,
    );
  }
}

const ends = (edge: View) => ({
  tail: (edge.tail as View).model!,
  head: (edge.head as View).model!,
});

function classSpec(v: Views): ClassSpec {
  const kinds: Record<string, ClassSpec["classes"][number]["kind"]> = {
    UMLClass: "class",
    UMLInterface: "interface",
    UMLEnumeration: "enum",
  };
  const packages = v.nodes
    .filter((n) => typeOf(n.model!) === "UMLPackage")
    .map((n) => n.model!);
  const classes: ClassSpec["classes"] = [];
  for (const view of v.nodes) {
    const m = view.model!;
    const kind = kinds[typeOf(m)];
    if (typeOf(m) === "UMLPackage") continue;
    if (!kind) {
      v.skip(view);
      continue;
    }
    const pkg = packages.find((p) => p === m._parent);
    classes.push({
      name: nameOf(m),
      kind: kind === "class" && m.isAbstract ? "abstract" : kind,
      ...(pkg && { package: nameOf(pkg) }),
      attributes: list(m.attributes).map((a) => formatAttribute(a)),
      operations: list(m.operations).map((o) => formatOperation(o)),
      literals: list(m.literals).map(nameOf),
    });
  }
  const relations: ClassSpec["relations"] = [];
  for (const edge of v.edges) {
    const m = edge.model!;
    const t = typeOf(m);
    const named = m.name ? { name: nameOf(m) } : {};
    if (t === "UMLGeneralization" || t === "UMLInterfaceRealization") {
      relations.push({
        from: nameOf(m.source as Element),
        to: nameOf(m.target as Element),
        type: t === "UMLGeneralization" ? "generalization" : "realization",
        ...named,
      });
    } else if (t === "UMLDependency") {
      relations.push({
        from: nameOf(m.source as Element),
        to: nameOf(m.target as Element),
        type: "dependency",
        ...named,
      });
    } else if (t === "UMLAssociation") {
      relations.push(association(m, named));
    } else {
      v.skip(edge);
    }
  }
  return { packages: packages.map(nameOf), classes, relations };
}

/** The relation build_diagram would make this association from. */
function association(m: Element, named: { name?: string }) {
  let [a, b] = [m.end1 as Element, m.end2 as Element];
  // build_diagram's whole is `to`, which StarUML marks on that end.
  if (a.aggregation !== "none" && b.aggregation === "none") [a, b] = [b, a];
  const type =
    b.aggregation === "composite"
      ? "composition"
      : b.aggregation === "shared"
        ? "aggregation"
        : b.navigable === "navigable" && a.navigable !== "navigable"
          ? "directed"
          : "association";
  return {
    from: nameOf(a.reference as Element),
    to: nameOf(b.reference as Element),
    type,
    ...named,
    ...(str(a.multiplicity) && { fromMultiplicity: str(a.multiplicity) }),
    ...(str(b.multiplicity) && { toMultiplicity: str(b.multiplicity) }),
  };
}

const MESSAGE_KINDS: Record<string, string> = {
  synchCall: "sync",
  asynchCall: "async",
  asynchSignal: "async",
  reply: "reply",
  createMessage: "create",
  deleteMessage: "delete",
};

/** First point of an edge view: Points.points in core/graphics.js. */
function edgeY(view: View): number {
  const points = (view.points as { points?: { y: number }[] } | undefined)
    ?.points;
  return points?.[0]?.y ?? Number.POSITIVE_INFINITY;
}

function sequenceSpec(v: Views): SequenceSpec {
  const lifelines = v.nodes
    .filter((n) => typeOf(n.model!) === "UMLLifeline")
    .sort((a, b) => box(a).left - box(b).left);
  // Every edge a sequence diagram holds between lifelines is a message.
  const messages = [...v.edges].sort((a, b) => edgeY(a) - edgeY(b));
  const fragments: SequenceSpec["fragments"] = [];
  for (const view of v.nodes) {
    const m = view.model!;
    if (typeOf(m) === "UMLLifeline") continue;
    if (typeOf(m) !== "UMLCombinedFragment") {
      v.skip(view);
      continue;
    }
    const b = box(view);
    const covered = messages
      .map((e, i) => [edgeY(e), i] as const)
      .filter(([y]) => y >= b.top && y <= b.top + b.height)
      .map(([, i]) => i);
    if (covered.length === 0) {
      v.skip(view);
      continue;
    }
    const operands = list(m.operands).map((o) => str(o.guard));
    fragments.push({
      operator: str(m.interactionOperator),
      ...(operands[0] && { guard: operands[0] }),
      operands: operands.slice(1),
      from: covered[0]!,
      to: covered.at(-1)!,
    });
  }
  return {
    participants: lifelines.map((l) => nameOf(l.model)),
    messages: messages.map((e) => {
      const { tail, head } = ends(e);
      return {
        from: nameOf(tail),
        to: nameOf(head),
        text: nameOf(e.model),
        kind: MESSAGE_KINDS[str(e.model!.messageSort)] ?? "sync",
      };
    }),
    // Outer fragments open first.
    fragments: fragments.sort((a, b) => a.from - b.from || b.to - a.to),
  };
}

const USECASE_RELATIONS: Record<string, string> = {
  UMLAssociation: "association",
  UMLInclude: "include",
  UMLExtend: "extend",
  UMLGeneralization: "generalization",
};

function usecaseSpec(v: Views): UsecaseSpec {
  const subject = v.nodes.find((n) => typeOf(n.model!) === "UMLUseCaseSubject");
  const actors: string[] = [];
  const useCases: UsecaseSpec["useCases"] = [];
  for (const view of v.nodes) {
    const t = typeOf(view.model!);
    if (t === "UMLActor") actors.push(nameOf(view.model));
    else if (t === "UMLUseCase") {
      useCases.push({
        name: nameOf(view.model),
        inSystem: subject !== undefined && inside(view, subject),
      });
    } else if (view !== subject) v.skip(view);
  }
  const relations: UsecaseSpec["relations"] = [];
  for (const edge of v.edges) {
    const type = USECASE_RELATIONS[typeOf(edge.model!)];
    if (!type) {
      v.skip(edge);
      continue;
    }
    const { tail, head } = ends(edge);
    relations.push({
      from: nameOf(tail),
      to: nameOf(head),
      type,
      ...(type === "association" && edge.model!.name
        ? { name: nameOf(edge.model) }
        : {}),
    });
  }
  return {
    ...(subject && { system: nameOf(subject.model) }),
    actors,
    useCases,
    relations,
  };
}

const ACTIVITY_TYPES: Record<string, string> = {
  UMLAction: "action",
  UMLOpaqueAction: "action",
  UMLInitialNode: "initial",
  UMLActivityFinalNode: "final",
  UMLFlowFinalNode: "flowFinal",
  UMLDecisionNode: "decision",
  UMLMergeNode: "merge",
  UMLForkNode: "fork",
  UMLJoinNode: "join",
  UMLObjectNode: "object",
  UMLCentralBufferNode: "object",
};

/** Flow nodes keyed N0, N1, ... in diagram order; edges between them. */
function flowGraph(
  v: Views,
  typeFor: (model: Element) => string | undefined,
  edgeTypes: readonly string[],
  lanes: View[] = [],
) {
  const ids = new Map<Element, string>();
  const nodes: FlowNode[] = [];
  for (const view of v.nodes) {
    if (lanes.includes(view)) continue;
    const type = typeFor(view.model!);
    if (type === undefined) {
      v.skip(view);
      continue;
    }
    const id = `N${nodes.length}`;
    ids.set(view.model!, id);
    const lane = lanes.find((l) => inside(view, l));
    nodes.push({
      id,
      name: nameOf(view.model),
      type,
      ...(lane && { lane: nameOf(lane.model) }),
    });
  }
  const edges: { from: string; to: string; edge: Element }[] = [];
  for (const view of v.edges) {
    const { tail, head } = ends(view);
    const known = ids.has(tail) && ids.has(head);
    if (!edgeTypes.includes(typeOf(view.model!)) || !known) {
      v.skip(view);
      continue;
    }
    edges.push({ from: ids.get(tail)!, to: ids.get(head)!, edge: view.model! });
  }
  return { nodes, edges };
}

function activitySpec(v: Views): ActivitySpec {
  const lanes = v.nodes.filter(
    (n) => typeOf(n.model!) === "UMLActivityPartition",
  );
  const { nodes, edges } = flowGraph(
    v,
    (m) => ACTIVITY_TYPES[typeOf(m)],
    ["UMLControlFlow", "UMLObjectFlow"],
    lanes,
  );
  return {
    lanes: lanes.map((l) => nameOf(l.model)),
    nodes,
    flows: edges.map(({ from, to, edge }) => ({
      from,
      to,
      ...(str(edge.guard) && { guard: str(edge.guard) }),
    })),
  };
}

/** Pseudostate kinds Mermaid and PlantUML draw; others become choices. */
const PSEUDO_KINDS = ["initial", "choice", "fork", "join"];

function stateType(model: Element): string | undefined {
  const t = typeOf(model);
  if (t === "UMLState") return "state";
  if (t === "UMLFinalState") return "final";
  if (t !== "UMLPseudostate") return undefined;
  const kind = str(model.kind);
  return PSEUDO_KINDS.includes(kind) ? kind : "choice";
}

function stateSpec(v: Views): StateSpec {
  const { nodes, edges } = flowGraph(v, stateType, ["UMLTransition"]);
  return {
    states: nodes,
    transitions: edges.map(({ from, to, edge }) => ({
      from,
      to,
      ...(edge.name ? { trigger: nameOf(edge) } : {}),
      ...(str(edge.guard) && { guard: str(edge.guard) }),
    })),
  };
}

function erdSpec(v: Views): ErdSpec {
  const entities: ErdSpec["entities"] = [];
  for (const view of v.nodes) {
    const m = view.model!;
    if (typeOf(m) !== "ERDEntity") {
      v.skip(view);
      continue;
    }
    entities.push({
      name: nameOf(m),
      columns: list(m.columns).map((c) => ({
        name: nameOf(c),
        type:
          typeText(c.type) +
          (str(c.length) && str(c.length) !== "0" ? `(${str(c.length)})` : ""),
        primaryKey: c.primaryKey === true,
        foreignKey: c.foreignKey === true,
        unique: c.unique === true,
      })),
    });
  }
  const relationships: ErdSpec["relationships"] = [];
  for (const edge of v.edges) {
    const m = edge.model!;
    if (typeOf(m) !== "ERDRelationship") {
      v.skip(edge);
      continue;
    }
    const [a, b] = [m.end1 as Element, m.end2 as Element];
    relationships.push({
      from: nameOf(a.reference as Element),
      to: nameOf(b.reference as Element),
      fromCardinality: str(a.cardinality),
      toCardinality: str(b.cardinality),
      identifying: m.identifying !== false,
      ...(m.name ? { name: nameOf(m) } : {}),
    });
  }
  return { entities, relationships };
}

const SHAPES = Object.fromEntries(
  Object.entries(FLOWCHART_SHAPES).map(([shape, t]) => [t, shape]),
) as Record<string, string>;

function flowchartSpec(v: Views): FlowchartSpec {
  const { nodes, edges } = flowGraph(v, (m) => SHAPES[typeOf(m)], ["FCFlow"]);
  return {
    nodes,
    flows: edges.map(({ from, to, edge }) => ({
      from,
      to,
      ...(edge.name ? { label: nameOf(edge) } : {}),
    })),
  };
}

function mindmapSpec(v: Views): { roots: MindNode[] } {
  const children = new Map<Element, Element[]>();
  const hasParent = new Set<Element>();
  for (const edge of v.edges) {
    const { tail, head } = ends(edge);
    if (typeOf(edge.model!) !== "MMEdge" || hasParent.has(head)) {
      v.skip(edge);
      continue;
    }
    children.set(tail, [...(children.get(tail) ?? []), head]);
    hasParent.add(head);
  }
  // A node has at most one parent and a root none, so no tree revisits one.
  const tree = (m: Element): MindNode => ({
    name: nameOf(m),
    children: (children.get(m) ?? []).map(tree),
  });
  const models = v.nodes.map((n) => n.model!);
  return { roots: models.filter((m) => !hasParent.has(m)).map(tree) };
}

/** The spec of `diagram`'s kind with a warning per kind of view left out. */
export function extract(
  diagram: Element,
  kind: Kind,
): { extracted: Extracted; warnings: string[] } {
  const nodes = nodeViews(diagram);
  const edges = edgeViews(diagram);
  const v = new Views(nodes, edges);
  const direction = flowDirection(edges);
  const extracted: Extracted = (() => {
    switch (kind) {
      case "class":
        return { kind, spec: classSpec(v) };
      case "sequence":
        return { kind, spec: sequenceSpec(v) };
      case "usecase":
        return { kind, spec: usecaseSpec(v), direction };
      case "activity":
        return { kind, spec: activitySpec(v), direction };
      case "statemachine":
        return { kind, spec: stateSpec(v), direction };
      case "erd":
        return { kind, spec: erdSpec(v) };
      case "flowchart":
        return { kind, spec: flowchartSpec(v), direction };
      default:
        return { kind, spec: mindmapSpec(v) };
    }
  })();
  return { extracted, warnings: v.warnings() };
}
