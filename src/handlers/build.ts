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
import { multiline } from "../build/members.js";
import { parseMermaid } from "../build/mermaid.js";
import { place } from "../build/place.js";
import {
  DIAGRAM_TYPES,
  type Direction,
  KINDS,
  type Kind,
  type ColumnSpec,
  type Plan,
  type PlanEdge,
  type PlanNode,
  planFor,
} from "../build/spec.js";
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError, type ErrorCode } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { id } from "../schemas.js";
import { summarize } from "../serialize.js";
import { diagramOf } from "../create.js";
import { resolveCreateType } from "../toolbox.js";
import type { Element, View } from "../types.js";
import { modelTypeOf } from "./elements.js";
import { type LayoutPresetName, PRESET_NAMES } from "./views.js";

/*
 * /build_diagram turns a compact spec (or Mermaid) into one /batch: the
 * diagram, its nodes with their members, its edges and a layout, so the
 * whole diagram is one undo step and a failure leaves nothing behind.
 */

const DIRECTIONS = ["TB", "BT", "LR", "RL"] as const;

interface Op {
  path: string;
  body: Record<string, unknown>;
  as?: string;
}

interface Ref {
  model: string | null;
  view: string;
}

/** Whether `elem` is `ancestor` or owned by it, directly or not. */
function within(elem: Element, ancestor: Element): boolean {
  for (let e: Element | null | undefined = elem; e; e = e._parent) {
    if (e === ancestor) return true;
  }
  return false;
}

/**
 * The model class a create id makes, with the pseudostate kind for the
 * toolbox's pseudostate items (UMLInitialState is UMLPseudostate with
 * pseudostateKind initial, stored as the model's `kind`).
 */
function signatureOf(type: string): string {
  const { id: createId, preset } = resolveCreateType(type);
  const kind = preset.pseudostateKind;
  return `${modelTypeOf(createId)}:${typeof kind === "string" ? kind : ""}`;
}

function modelSignature(model: Element): string {
  const name = model.constructor.name;
  return `${name}:${name === "UMLPseudostate" ? String(model.kind) : ""}`;
}

/** Hands out existing elements by signature, each at most once, in diagram order. */
class Pool<T> {
  private readonly bySignature = new Map<string, T[]>();
  add(signature: string, item: T): void {
    const list = this.bySignature.get(signature) ?? [];
    list.push(item);
    this.bySignature.set(signature, list);
  }
  take(signature: string): T | undefined {
    return this.bySignature.get(signature)?.shift();
  }
}

const isEdge = (v: View) => "tail" in v && "head" in v;

/**
 * Views already on `diagram`, keyed for upsert: nodes and edges that show
 * a model, notes by their text and note links by their ends. A frame
 * showing the diagram itself (sequence and SysML diagrams) and other views
 * without a model are not the spec's, so they are neither matched nor
 * pruned.
 */
function existing(diagram: Element) {
  const nodes = new Pool<View>();
  const edges = new Pool<View>();
  const all: View[] = [];
  for (const view of diagram.ownedViews as View[]) {
    const model = view.model;
    if (model instanceof type.Diagram) continue;
    if (!model) {
      if (view instanceof type.UMLNoteView) {
        nodes.add(`Note|${String(view.text)}`, view);
      } else if (view instanceof type.UMLNoteLinkView) {
        const ends = [view.tail, view.head] as View[];
        edges.add(`NoteLink|${ends[0]!._id}|${ends[1]!._id}`, view);
      } else {
        continue;
      }
    } else if (isEdge(view)) {
      const tail = (view.tail as View).model;
      const head = (view.head as View).model;
      edges.add(
        `${modelSignature(model)}|${model.name}|${tail?._id}|${head?._id}`,
        view,
      );
    } else {
      nodes.add(`${modelSignature(model)}|${model.name}`, view);
    }
    all.push(view);
  }
  return { nodes, edges, all };
}

const names = (list: unknown) =>
  new Set((Array.isArray(list) ? (list as Element[]) : []).map((e) => e.name));

/**
 * Members a node declares that its model lacks, as ops on `owner`. Members
 * are matched by name, so a repeated name in the spec is added once.
 */
function memberOps(node: PlanNode, owner: string, model?: Element): Op[] {
  const ops: Op[] = [];
  const add = (
    field: string,
    members: readonly { name: string }[] | undefined,
    op: (member: { name: string }) => Op,
  ) => {
    const have = names(model?.[field]);
    for (const member of members ?? []) {
      if (have.has(member.name)) continue;
      have.add(member.name);
      ops.push(op(member));
    }
  };
  add("attributes", node.attributes, (a) => ({
    path: "/add_attribute",
    body: { ownerId: owner, ...a },
  }));
  add("operations", node.operations, (o) => ({
    path: "/add_operation",
    body: { ownerId: owner, ...o },
  }));
  add(
    "literals",
    node.literals?.map((name) => ({ name })),
    ({ name }) => ({
      path: "/add_enumeration_literal",
      body: { enumerationId: owner, name },
    }),
  );
  add("columns", node.columns, (c) => {
    const { name, ...properties } = c as ColumnSpec;
    return {
      path: "/create_element",
      body: { type: "ERDColumn", parentId: owner, name, properties },
    };
  });
  return ops;
}

/** Property updates for an existing model whose values differ from the spec. */
function propertyOps(node: PlanNode, model: Element): Op[] {
  return Object.entries(node.properties ?? {})
    .filter(([field, value]) => model[field] !== value)
    .map(([field, value]) => ({
      path: "/update_element",
      body: { id: model._id, field, value },
    }));
}

/** The /set_view_style op giving `view` the node's style, if it differs. */
function styleOps(node: PlanNode, view: string, current?: View): Op[] {
  const changed = Object.entries(node.style ?? {}).filter(
    ([field, value]) => current?.[field] !== value,
  );
  return changed.length === 0
    ? []
    : [
        {
          path: "/set_view_style",
          body: { ids: [view], ...Object.fromEntries(changed) },
        },
      ];
}

/** Diagram kinds whose nodes show model elements other diagrams may show too. */
const SHARED_KINDS = new Set<Kind>(["class", "usecase", "erd"]);

/**
 * Whether `model` sits at `path` (outermost first, the model's own name
 * last), counting only the nearest owners.
 */
function atPath(model: Element, path: readonly string[]): boolean {
  let e: Element | null | undefined = model;
  for (let i = path.length - 1; i >= 0; i--) {
    if (!e || e.name !== path[i]) return false;
    e = e._parent;
  }
  return true;
}

/**
 * An element elsewhere in the project that a node names, by name or by a
 * path such as "Billing::Invoice": the one candidate, else the one under
 * the diagram's owner. Several leave a warning and a new element; a path
 * that names nothing is an error, since it cannot be created as written.
 */
function findModel(
  node: PlanNode,
  owner: Element,
  claimed: Set<Element>,
  warnings: string[],
): Element | null {
  if (node.type === "Note") return null;
  const modelType = modelTypeOf(resolveCreateType(node.type).id)!;
  const signature = signatureOf(node.type);
  const path = node.name.split("::").map((p) => p.trim());
  const candidates = app.repository
    .getInstancesOf(modelType)
    .filter(
      (m) =>
        modelSignature(m) === signature && !claimed.has(m) && atPath(m, path),
    );
  const near = candidates.filter((m) => within(m, owner));
  const found =
    candidates.length === 1
      ? candidates[0]!
      : near.length === 1
        ? near[0]!
        : null;
  if (found) return found;
  if (candidates.length > 1) {
    warnings.push(
      `${candidates.length} ${modelType} elements are named ${node.name}; made a new one (name it by its path, Owner::${path.at(-1)}, to show one of them)`,
    );
  } else if (path.length > 1) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec: no ${modelType} at ${node.name}`,
    );
  }
  return null;
}

/** A relationship like `edge` between two existing models, if there is one. */
function findRelationship(
  edge: PlanEdge,
  tail: Element,
  head: Element,
): Element | undefined {
  const signature = signatureOf(edge.type);
  return app.repository.getRelationshipsOf(tail).find((r) => {
    const [from, to] =
      "source" in r
        ? [r.source, r.target]
        : [(r.end1 as Element).reference, (r.end2 as Element).reference];
    return (
      modelSignature(r) === signature &&
      r.name === (edge.name ?? "") &&
      from === tail &&
      to === head
    );
  });
}

/** Whether the spec-less view's model goes with it, or only the view. */
function pruneTarget(
  view: View,
  diagram: Element,
  keep: readonly Element[],
): Element {
  const model = view.model;
  if (!model) return view;
  const elsewhere = app.repository
    .getViewsOf(model)
    .some((v) => diagramOf(v) !== diagram);
  // A model owning the diagram or one the spec keeps (a package holding a
  // kept class) stays; only its view goes.
  return elsewhere ||
    within(diagram, model) ||
    keep.some((k) => within(k, model))
    ? view
    : model;
}
export interface Built {
  ops: Op[];
  /** Node keys by op name, and the existing elements reused. */
  created: Map<string, string>;
  reused: Map<string, Ref>;
  edgeOps: { key: string; as: string }[];
  updated: number;
  unchanged: number;
  /** Nodes shown from model elements that existed elsewhere. */
  shown: number;
  deleted: number;
  warnings: string[];
  layout: "engine" | "placed";
  preset?: LayoutPresetName;
}

export interface BuildOptions {
  /** Delete what the diagram shows that the plan does not. */
  prune?: boolean;
  /** Show existing model elements a node names instead of making new ones. */
  reuse?: boolean;
}

export interface Target {
  diagram: Element | null;
  parent: Element;
  name: string | undefined;
}

/** The ops that build `plan` on the target, reusing what is already there. */
export function opsFor(
  plan: Plan,
  target: Target,
  direction: Direction,
  autoLayout: boolean,
  preset: LayoutPresetName = defaultPreset(plan.kind, direction),
  options: BuildOptions = {},
): Built {
  const ops: Op[] = [];
  const diagramRef = target.diagram?._id ?? "$diagram";
  if (!target.diagram) {
    ops.push({
      path: "/create_diagram",
      as: "diagram",
      body: {
        type: DIAGRAM_TYPES[plan.kind],
        parentId: target.parent._id,
        ...(target.name !== undefined && { name: target.name }),
      },
    });
  }
  // A new sequence diagram's frame shows its interaction's name, which
  // StarUML generates ("Interaction1"); it takes the diagram's instead.
  if (
    !target.diagram &&
    plan.kind === "sequence" &&
    target.name !== undefined
  ) {
    ops.push({
      path: "/update_element",
      body: { id: "$diagram._parent", field: "name", value: target.name },
    });
  }
  const pools = target.diagram ? existing(target.diagram) : null;
  const boxes = place(plan, direction);
  const refs = new Map<string, Ref>();
  const created = new Map<string, string>();
  const reused = new Map<string, Ref>();
  const kept = new Set<View>();
  const claimed = new Set<Element>();
  const warnings: string[] = [];
  const reuse = options.reuse === true && SHARED_KINDS.has(plan.kind);
  let updated = 0;
  let unchanged = 0;
  let shown = 0;
  /** Nodes whose view is new, so containment and dividers apply to them. */
  const fresh = new Set<string>();
  plan.nodes.forEach((node, i) => {
    const found = pools?.nodes.take(
      node.type === "Note"
        ? `Note|${node.text}`
        : `${signatureOf(node.type)}|${node.name}`,
    );
    if (found) {
      kept.add(found);
      const model = found.model;
      const ref = { model: model?._id ?? null, view: found._id };
      refs.set(node.key, ref);
      reused.set(node.key, ref);
      if (model) claimed.add(model);
      const more = [
        ...(model
          ? [...propertyOps(node, model), ...memberOps(node, model._id, model)]
          : []),
        ...styleOps(node, found._id, found),
      ];
      if (more.length > 0) updated++;
      else unchanged++;
      ops.push(...more);
      return;
    }
    const as = `n${i}`;
    const box = boxes.get(node.key)!;
    created.set(as, node.key);
    fresh.add(node.key);
    const model = reuse
      ? findModel(
          node,
          target.diagram?._parent ?? target.parent,
          claimed,
          warnings,
        )
      : null;
    if (model) {
      claimed.add(model);
      shown++;
      refs.set(node.key, { model: model._id, view: `$${as}.view` });
      ops.push({
        path: "/create_view_of",
        as,
        body: {
          modelId: model._id,
          diagramId: diagramRef,
          x: Math.round(box.x),
          y: Math.round(box.y),
        },
      });
      // A view of an existing model starts at its minimum size; a placed
      // diagram needs the planned one, e.g. a system boundary holding its
      // use cases.
      ops.push({
        path: "/resize_node",
        body: {
          id: `$${as}.view`,
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      });
      ops.push(
        ...propertyOps(node, model),
        ...memberOps(node, model._id, model),
      );
      ops.push(...styleOps(node, `$${as}.view`));
      return;
    }
    const note = node.type === "Note";
    refs.set(node.key, {
      model: note ? null : `$${as}.model`,
      view: `$${as}.view`,
    });
    ops.push({
      path: "/create_element_with_view",
      as,
      body: {
        type: node.type,
        diagramId: diagramRef,
        ...(node.owner !== undefined && {
          parentId: refs.get(node.owner)!.model,
        }),
        // A note is a view without a model, so it takes neither.
        ...(!note && { name: node.name }),
        ...(node.properties && { properties: node.properties }),
        x: Math.round(box.x),
        y: Math.round(box.y),
        x2: Math.round(box.x + box.width),
        y2: Math.round(box.y + box.height),
        ...(node.guard !== undefined && { fields: ["operands"] }),
      },
    });
    if (note) {
      ops.push({
        path: "/update_element",
        body: { id: `$${as}.view`, field: "text", value: node.text },
      });
    }
    ops.push(...memberOps(node, `$${as}.model`));
    ops.push(...styleOps(node, `$${as}.view`));
    for (const guard of node.operands ?? []) {
      ops.push({
        path: "/create_element",
        body: {
          type: "UMLInteractionOperand",
          parentId: `$${as}.model`,
          name: "",
          properties: { guard },
        },
      });
    }
    if (node.guard !== undefined) {
      ops.push({
        path: "/update_element",
        body: {
          id: `$${as}.model.operands.0`,
          field: "guard",
          value: node.guard,
        },
      });
    }
    if (node.operandAt) {
      ops.push({
        path: "/divide_fragment",
        body: { id: `$${as}.view`, at: node.operandAt },
      });
    }
  });
  // Nested nodes go into their container's view once both exist.
  const nested = new Map<string, string[]>();
  for (const node of plan.nodes) {
    if (node.container === undefined) continue;
    if (!fresh.has(node.key) && !fresh.has(node.container)) continue;
    nested.set(node.container, [
      ...(nested.get(node.container) ?? []),
      refs.get(node.key)!.view,
    ]);
  }
  for (const [container, views] of nested) {
    ops.push({
      path: "/move_views",
      body: {
        ids: views,
        dx: 0,
        dy: 0,
        containerViewId: refs.get(container)!.view,
      },
    });
  }
  const edgeOps: { key: string; as: string }[] = [];
  plan.edges.forEach((edge, i) => {
    const tail = refs.get(edge.from)!;
    const head = refs.get(edge.to)!;
    const noteLink = edge.type === "NoteLink";
    const found = pools?.edges.take(
      noteLink
        ? `NoteLink|${tail.view}|${head.view}`
        : `${signatureOf(edge.type)}|${edge.name ?? ""}|${tail.model}|${head.model}`,
    );
    const key = `${edge.from} -> ${edge.to}`;
    if (found) {
      kept.add(found);
      unchanged++;
      return;
    }
    const as = `e${i}`;
    edgeOps.push({ key, as });
    if (noteLink) {
      ops.push({
        path: "/create_edge_with_view",
        as,
        body: {
          type: "NoteLink",
          diagramId: diagramRef,
          tailViewId: tail.view,
          headViewId: head.view,
        },
      });
      return;
    }
    const existingEnds =
      reuse && !tail.model!.startsWith("$") && !head.model!.startsWith("$");
    const relationship = existingEnds
      ? findRelationship(
          edge,
          app.repository.get(tail.model!)!,
          app.repository.get(head.model!)!,
        )
      : undefined;
    if (relationship) {
      ops.push({
        path: "/create_view_of",
        as,
        body: { modelId: relationship._id, diagramId: diagramRef },
      });
      return;
    }
    ops.push({
      path: "/create_relationship",
      as,
      body: {
        type: edge.type,
        tailId: tail.view,
        headId: head.view,
        diagramId: diagramRef,
        ...(edge.name !== undefined && { name: edge.name }),
        ...(edge.properties && { properties: edge.properties }),
        ...(edge.tailEnd && { tailEnd: edge.tailEnd }),
        ...(edge.headEnd && { headEnd: edge.headEnd }),
        ...edge.geometry,
      },
    });
  });
  let deleted = 0;
  if (options.prune && pools) {
    // Edges first: deleting a node takes its edges along, and an op on an
    // edge already gone would fail the batch.
    const gone = pools.all
      .filter((v) => !kept.has(v))
      .sort((a, b) => Number(isEdge(b)) - Number(isEdge(a)));
    const keep = [...kept].flatMap((v) => (v.model ? [v.model] : []));
    const targets = gone.map((v) => pruneTarget(v, target.diagram!, keep));
    const models = targets.filter((t) => !(t instanceof type.View));
    for (const [i, t] of targets.entries()) {
      // What a pruned model owns, and the views showing it, go with it.
      const owned = t instanceof type.View ? (t as View).model : t;
      const covered =
        owned !== null && models.some((m) => m !== owned && within(owned, m));
      if (covered || targets.indexOf(t) !== i) continue;
      deleted++;
      ops.push({ path: "/delete_element", body: { id: t._id } });
    }
  }
  // Engine layout rearranges every node; on an upsert that added nothing it
  // would only undo the user's own arrangement.
  const engine =
    autoLayout &&
    !plan.fixed &&
    typeof app.engine.layoutDiagram === "function" &&
    (created.size > 0 || edgeOps.length > 0);
  if (engine) {
    ops.push({
      path: "/layout_diagram",
      body: { id: diagramRef, preset },
    });
  }
  return {
    ops,
    created,
    reused,
    edgeOps,
    updated,
    unchanged,
    shown,
    deleted,
    warnings,
    layout: engine ? "engine" : "placed",
    ...(engine && { preset }),
  };
}

const SIDES = { TB: "down", BT: "up", LR: "right", RL: "left" } as const;

/**
 * The layout preset for a kind built in `direction`. Class diagrams read as
 * hierarchies, with generalization targets on top; every other kind reads
 * along its edges, so a flowchart drawn TB starts at the top (issue #12).
 */
export function defaultPreset(kind: Kind, direction: Direction) {
  const family = kind === "class" ? "hierarchy" : "flow";
  return `${family}-${SIDES[direction]}` as LayoutPresetName;
}

/** The diagram an upsert updates: same type and name, under the parent. */
function findDiagram(kind: Kind, name: string | undefined, parent: Element) {
  if (name === undefined) return null;
  return (
    app.repository
      .getInstancesOf(DIAGRAM_TYPES[kind])
      .find((d) => d.name === name && within(d, parent)) ?? null
  );
}

interface BatchData {
  results: { as?: string; data?: unknown }[];
}

const refSchema = () =>
  z.object({
    model: z.nullable(z.string()),
    view: z.string(),
  });

export function buildDiagramEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/build_diagram",
    description:
      "Build a whole diagram in one call from a compact spec per kind (class, sequence, usecase, activity, statemachine, erd, flowchart, mindmap) or from Mermaid (classDiagram, sequenceDiagram, flowchart, erDiagram, stateDiagram with composite state blocks, mindmap; notes and classDef/style colours; a flowchart also as activity or usecase; /export_text writes this Mermaid back). One undo step; laid out by Format > Layout where the kind allows. Elements named like existing ones are shown again rather than copied (reuse). upsert updates the diagram of the same name instead of adding another, and prune removes what the spec no longer has. Answers the ids of what it made, not the model.",
    readOnly: false,
    destructive: false,
    request: z.object({
      kind: z.optional(
        doc(
          z.enum(KINDS),
          "Diagram kind; required with spec. With mermaid it is read from the header, and 'activity' or 'usecase' reads a flowchart as that kind.",
        ),
      ),
      spec: z.optional(
        doc(
          z.record(z.string(), z.unknown()),
          "class: {packages, classes: [{name, kind: class|interface|enum|abstract, package, stereotype, attributes: ['+id: long'], operations: ['+total(): double'], literals}], relations: [{from, to, type: association|directed|aggregation|composition|generalization|realization|dependency, name, fromMultiplicity, toMultiplicity}]}. sequence: {participants, messages: [{from, to, text, kind: sync|async|reply|create|delete}], fragments: [{operator: alt|opt|loop|..., guard, operands: ['else'], operandStarts, from, to}] (message indices)}. usecase: {system, actors, useCases, relations: [{from, to, type: association|include|extend|generalization}]}. activity: {lanes, nodes: [{id, name, type: action|initial|final|flowFinal|decision|merge|fork|join|object, lane}], flows: [{from, to, guard}]}. statemachine: {states: [{id, name, type: state|initial|final|choice|fork|join, parent: composite state}], transitions: [{from, to, trigger, guard, effect}]}. erd: {entities: [{name, columns: ['id int PK', ...]}], relationships: [{from, to, fromCardinality, toCardinality: '0..1'|'1'|'0..*'|'1..*', name, identifying}]}. flowchart: {nodes: [{id, name, shape: process|decision|terminator|data|document|predefined|alternate|database|manualInput|preparation|connector|delay|display}], flows: [{from, to, label}]}. mindmap: {root: {name, children: [...]}}. Every kind also takes notes: [{text, on: node(s); sequence: side: left|right|over, at: message index}] and styles: {node: {fillColor, lineColor, fontColor}}. Names may contain '\\n' or '<br/>' for line breaks; edges name nodes by name, or by id where nodes have one.",
        ),
      ),
      mermaid: z.optional(
        doc(
          z.string().check(z.minLength(1)),
          "Mermaid source instead of spec. The diagram is named by 'name', else front matter 'title:' or a 'title' line.",
        ),
      ),
      name: z.optional(doc(z.string(), "Diagram name.")),
      parentId: z.optional(
        id(
          "Owner of the diagram; default the project, where StarUML adds the container the kind needs (a model, interaction, activity, state machine, data model, flowchart or mind map).",
        ),
      ),
      direction: z.optional(
        doc(z.enum(DIRECTIONS), "Layout direction; default TB, or Mermaid's."),
      ),
      layout: z.optional(
        doc(
          z.enum(PRESET_NAMES),
          "Layout preset for Format > Layout (see /layout_diagram); default flow-<direction>, hierarchy-<direction> for class diagrams.",
        ),
      ),
      autoLayout: z.optional(
        doc(
          z.boolean(),
          "Default true: Format > Layout after building. Sequence diagrams, lanes and a system boundary keep the computed placement.",
        ),
      ),
      upsert: z.optional(
        doc(
          z.boolean(),
          "Update the diagram with this name and kind under the parent if there is one: nodes already on it (same type and name) gain missing members, changed properties and colours, missing nodes and edges are added, and nothing is removed unless prune is set.",
        ),
      ),
      prune: z.optional(
        doc(
          z.boolean(),
          "With upsert: delete the nodes, notes and edges on the diagram that the spec does not have, in the same undo step. An element shown on other diagrams too, or owning one the spec keeps, loses only its view here.",
        ),
      ),
      reuse: z.optional(
        doc(
          z.boolean(),
          "Default true: a class, interface, enum, package, actor, use case or entity named like one elsewhere in the project is that element shown again (Model Explorer drag and drop), not a copy; 'Owner::Name' picks one by its owners. false always makes new elements.",
        ),
      ),
    }),
    response: z.object({
      diagram: doc(
        z.object({
          _id: z.string(),
          name: z.nullable(z.string()),
          _type: z.string(),
        }),
        "The diagram built or updated.",
      ),
      kind: z.string(),
      upserted: doc(z.boolean(), "An existing diagram was updated."),
      created: doc(z.int(), "Nodes and edges added."),
      updated: doc(z.int(), "Existing nodes given members or properties."),
      unchanged: doc(z.int(), "Existing nodes and edges left as they were."),
      shown: z.optional(
        doc(
          z.int(),
          "Nodes among created that show elements which existed elsewhere in the project.",
        ),
      ),
      deleted: z.optional(
        doc(z.int(), "With prune: elements and views deleted."),
      ),
      warnings: z.optional(
        doc(z.array(z.string()), "What was built differently than written."),
      ),
      layout: doc(
        z.enum(["engine", "placed"]),
        "engine: Format > Layout arranged it; placed: the computed placement stands.",
      ),
      preset: z.optional(doc(z.string(), "The layout preset applied.")),
      ids: doc(
        z.record(z.string(), refSchema()),
        "Model and view ids of each node, by its name (or id) in the spec.",
      ),
      edges: z.array(
        z.object({
          key: doc(z.string(), "'from -> to'."),
          model: z.nullable(z.string()),
          view: z.string(),
        }),
      ),
    }),
    handle: async (input) => {
      if ((input.spec === undefined) === (input.mermaid === undefined)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          "Pass either spec (with kind) or mermaid",
        );
      }
      let kind: Kind;
      let spec: unknown;
      let title: string | undefined;
      let direction: Direction | undefined = input.direction;
      if (input.mermaid !== undefined) {
        const parsed = parseMermaid(input.mermaid, input.kind);
        kind = parsed.kind;
        spec = parsed.spec;
        title = parsed.title;
        direction ??= parsed.direction;
      } else if (input.kind === undefined) {
        throw new ApiError("INVALID_ARGUMENT", "kind: required with spec");
      } else {
        kind = input.kind;
        spec = input.spec;
      }
      const plan = planFor(kind, spec);
      const parent =
        input.parentId === undefined
          ? requireProject()
          : requireElement(input.parentId, "Parent");
      const raw = input.name ?? title;
      const name = raw === undefined ? undefined : multiline(raw);
      if (input.prune && !input.upsert) {
        throw new ApiError("INVALID_ARGUMENT", "prune: needs upsert");
      }
      const diagram = input.upsert ? findDiagram(kind, name, parent) : null;
      const built = opsFor(
        plan,
        { diagram, parent, name },
        direction ?? "TB",
        input.autoLayout ?? true,
        input.layout,
        { prune: input.prune, reuse: input.reuse ?? true },
      );
      const batch = endpoints().find((e) => e.path === "/batch")!;
      let data: BatchData = { results: [] };
      if (built.ops.length > 0) {
        const result = await batch.handler({ ops: built.ops });
        if (!result.success) {
          throw new ApiError(
            result.code as ErrorCode,
            `build_diagram: ${result.error}`,
            result.details,
          );
        }
        data = result.data as BatchData;
      }
      const byName = new Map(
        data.results.flatMap((r) => (r.as ? [[r.as, r.data]] : [])),
      ) as Map<
        string,
        { _id?: string; view?: { _id: string }; model?: { _id: string } | null }
      >;
      const ids: Record<string, { model: string | null; view: string }> = {};
      for (const [key, ref] of built.reused) ids[key] = ref;
      for (const [as, key] of built.created) {
        const r = byName.get(as)!;
        ids[key] = { model: r.model?._id ?? null, view: r.view!._id };
      }
      const edges = built.edgeOps.map(({ key, as }) => {
        const r = byName.get(as)!;
        return { key, model: r.model?._id ?? null, view: r.view!._id };
      });
      const target = diagram ?? requireElement(byName.get("diagram")!._id!);
      const { _id, _type, name: diagramName } = summarize(target);
      return {
        diagram: { _id, _type, name: diagramName },
        kind,
        upserted: diagram !== null,
        created: built.created.size + edges.length,
        updated: built.updated,
        unchanged: built.unchanged,
        layout: built.layout,
        ...(built.preset && { preset: built.preset }),
        ...(built.shown > 0 && { shown: built.shown }),
        ...(input.prune && { deleted: built.deleted }),
        ...(built.warnings.length > 0 && { warnings: built.warnings }),
        ids,
        edges,
      };
    },
  });
}
