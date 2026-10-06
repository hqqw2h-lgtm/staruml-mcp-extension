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
import { FORMATS, parseSource } from "../build/source.js";
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
import { type Box, FRAME } from "../build/plan.js";
import { familyGrammar } from "../build/families.js";
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError } from "../errors.js";
import {
  normalizePlan,
  Renames,
  styledViews,
  styleReport,
  styleReportSchema,
  styleViews,
} from "../style/apply.js";
import { effectiveProfile, presetFor, type Profile } from "../style/profile.js";
import { oneStep } from "../undo.js";
import { deselect } from "../quality/geometry.js";
import {
  improve,
  type Quality,
  qualitySchema,
  scoredAsIs,
} from "../quality/loop.js";
import { batchRunner } from "./batch.js";
import { byId, pathOf, tryResolve } from "../refs.js";
import { requireElement, requireProject } from "../lookup.js";
import { duplicateShape, ref } from "../schemas.js";
import { summarize } from "../serialize.js";
import { diagramOf } from "../create.js";
import { resolveCreateType } from "../toolbox.js";
import type { Element, View } from "../types.js";
import { findViewpoint } from "../viewpoints/index.js";
import { conformity } from "../viewpoints/lint.js";
import { type Mark, partViews, readMark } from "../viewpoints/mark.js";
import { accepts } from "../templates/exemplar.js";
import {
  defaultTemplate,
  findTemplate,
  templateParts,
  templateProfile,
} from "../templates/index.js";
import { derivedRefusal, overridden } from "../templates/lock.js";
import type { Template } from "../templates/schema.js";
import { type PartTexts, placeParts } from "../viewpoints/parts.js";
import { VIEWPOINT_NAMES } from "../viewpoints/schema.js";
import { isTrusted } from "../style/guard.js";
import { modelTypeOf } from "./elements.js";
import {
  labelSeparations,
  type LayoutPresetName,
  PRESET_NAMES,
} from "./views.js";

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
  private readonly taken = new Set<T>();
  add(signature: string, item: T): void {
    const list = this.bySignature.get(signature) ?? [];
    list.push(item);
    this.bySignature.set(signature, list);
  }
  /** The next item under `signature` not yet taken under any signature. */
  take(signature: string): T | undefined {
    const list = this.bySignature.get(signature);
    while (list && list.length > 0) {
      const item = list.shift()!;
      if (this.taken.has(item)) continue;
      this.taken.add(item);
      return item;
    }
    return undefined;
  }
}

const isEdge = (v: View) => "tail" in v && "head" in v;

/** Edges drawn without a model, by view type: their create ids. */
const VIEW_ONLY_EDGES: Record<string, string> = {
  UMLNoteLinkView: "NoteLink",
  UMLContainmentView: "UMLContainment",
};
const viewOnly = (type: string) =>
  Object.values(VIEW_ONLY_EDGES).includes(type);

/**
 * Views already on `diagram`, keyed for upsert: nodes and edges that show
 * a model, notes by their text and note links by their ends. A frame
 * showing the diagram itself (sequence and SysML diagrams) and other views
 * without a model are not the spec's, so they are neither matched nor
 * pruned.
 */
function existing(diagram: Element, skip: ReadonlySet<string> = new Set()) {
  const nodes = new Pool<View>();
  const edges = new Pool<View>();
  const all: View[] = [];
  for (const view of diagram.ownedViews as View[]) {
    const model = view.model;
    // The engine's own parts (a legend, a title block) are not the spec's.
    if (model instanceof type.Diagram || skip.has(view._id)) continue;
    if (!model) {
      if (view instanceof type.UMLNoteView) {
        nodes.add(`Note|${String(view.text)}`, view);
      } else if (VIEW_ONLY_EDGES[view.constructor.name]) {
        const ends = [view.tail, view.head] as View[];
        edges.add(
          `${VIEW_ONLY_EDGES[view.constructor.name]}|${ends[0]!._id}|${ends[1]!._id}`,
          view,
        );
      } else {
        continue;
      }
    } else if (view.hostEdge) {
      // A communication message is drawn on its connector, not between
      // two ends of its own (UMLCommMessageView, uml/elements.js).
      edges.add(`id|${model._id}`, view);
    } else if (isEdge(view)) {
      const tail = (view.tail as View).model;
      const head = (view.head as View).model;
      edges.add(
        `${modelSignature(model)}|${model.name}|${tail?._id}|${head?._id}`,
        view,
      );
      edges.add(`id|${model._id}`, view);
    } else {
      nodes.add(`${modelSignature(model)}|${model.name}`, view);
      nodes.add(`id|${model._id}`, view);
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
    body: { ref: owner, ...a },
  }));
  add("operations", node.operations, (o) => ({
    path: "/add_operation",
    body: { ref: owner, ...o },
  }));
  add(
    "literals",
    node.literals?.map((name) => ({ name })),
    ({ name }) => ({
      path: "/add_enumeration_literal",
      body: { ref: owner, name },
    }),
  );
  add("slots", node.slots, (slot) => ({
    path: "/add_slot",
    body: { ref: owner, ...slot },
  }));
  add("columns", node.columns, (c) => {
    const { name, ...properties } = c as ColumnSpec;
    return {
      path: "/create_element",
      body: { type: "ERDColumn", parent: owner, name, properties },
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
      body: { ref: model._id, field, value },
    }));
}

/** /update_element ops giving `view` the node's view attributes that differ. */
function viewPropertyOps(node: PlanNode, view: string, current?: View): Op[] {
  const ops: Op[] = Object.entries(node.viewProperties ?? {})
    .filter(([field, value]) => current?.[field] !== value)
    .map(([field, value]) => ({
      path: "/update_element",
      body: { ref: view, field, value },
    }));
  // A view drawn before its attributes changed keeps the size it grew to
  // (a wrapped name's height, View.sizeConstraints in core/core.js 7.1.1);
  // a placed node gets its planned size back.
  if (ops.length > 0 && node.box && !current) {
    ops.push({
      path: "/resize_node",
      body: {
        ref: view,
        width: Math.round(node.box.width),
        height: Math.round(node.box.height),
      },
    });
  }
  return ops;
}

/**
 * Whether a view of `model` draws "(from Owner)" when shown on a diagram
 * under another owner: Factory.createViewAndRelationships turns on
 * showNamespace of a UMLGeneralNodeView then (engine/factory.js, 7.1.1).
 */
function namespaced(model: Element): boolean {
  const viewType = app.metamodels.getViewTypeOf(model.constructor.name);
  return (
    viewType !== null && app.metamodels.isKindOf(viewType, "UMLGeneralNodeView")
  );
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
          body: { refs: [view], ...Object.fromEntries(changed) },
        },
      ];
}

/** Diagram kinds whose nodes show model elements other diagrams may show too. */
const SHARED_KINDS = new Set<Kind>([
  "class",
  "usecase",
  "erd",
  "requirement",
  "c4",
  "package",
  "component",
  "deployment",
  "composite",
  "object",
  "infoflow",
  "profile",
  "bdd",
  "dfd",
]);

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
  // What sits in or on another node is that node's: a part, a port.
  if (node.host !== undefined) return null;
  // Every node type of a kind that reuses makes a model of a known type.
  const modelType = modelTypeOf(resolveCreateType(node.type).id)!;
  const signature = signatureOf(node.type);
  // A path ("Model/Billing/Invoice") names one element as every endpoint
  // reads it; a name with "/" that names nothing is still just a name.
  if (node.name.includes("/")) {
    const byPath = tryResolve(node.name);
    if (
      byPath &&
      modelSignature(byPath) === signature &&
      !claimed.has(byPath)
    ) {
      return byPath;
    }
  }
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
  /** Nodes already on the diagram that the plan changes, with the ops that do. */
  changes: { key: string; view: View; ops: Op[] }[];
  /** What prune deletes. */
  removed: Element[];
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
  /** Let new elements take a sibling's name (the DUPLICATE_NAME policy). */
  allowDuplicateNames?: boolean;
  /** Keep StarUML's "(from Owner)" on elements shown from another owner. */
  showNamespace?: boolean;
  /**
   * The model element each node shows, by node key: a derived diagram
   * shows the model it was derived from, never a copy (issue #33).
   */
  bind?: ReadonlyMap<string, Element>;
  /** The relationship each edge shows, by its index in the plan. */
  bindEdges?: ReadonlyMap<number, Element>;
  /** Prune removes views only, never the elements they show. */
  pruneViewsOnly?: boolean;
  /** Views of the diagram that are neither matched nor pruned: its parts. */
  skip?: ReadonlySet<string>;
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
    const owner = ownerOps(plan, target.parent);
    ops.push(...owner.ops);
    ops.push({
      path: "/create_diagram",
      as: "diagram",
      body: {
        type: DIAGRAM_TYPES[plan.kind],
        parent: owner.parent,
        ...(target.name !== undefined && { name: target.name }),
        ...(options.allowDuplicateNames && { allowDuplicateNames: true }),
        // The frame StarUML adds to a sequence diagram is its first view.
        ...((plan.frame || plan.framed) && {
          fields: ["_parent", "ownedViews"],
        }),
      },
    });
  }
  // A new sequence diagram's frame shows its interaction's name, which
  // StarUML generates ("Interaction1"); it takes the diagram's instead.
  if (
    !target.diagram &&
    plan.kind === "sequence" &&
    target.name !== undefined &&
    // A diagram made in an existing interaction leaves that one's name alone.
    !(target.parent instanceof type.UMLInteraction)
  ) {
    ops.push({
      path: "/update_element",
      body: { ref: "$diagram._parent", field: "name", value: target.name },
    });
  }
  const pools = target.diagram ? existing(target.diagram, options.skip) : null;
  const boxes = place(plan, direction);
  const refs = new Map<string, Ref>();
  if (plan.framed) {
    refs.set(FRAME, {
      model: null,
      view: target.diagram
        ? frameOf(target.diagram)._id
        : "$diagram.ownedViews.0",
    });
  }
  const created = new Map<string, string>();
  const reused = new Map<string, Ref>();
  const kept = new Set<View>();
  const claimed = new Set<Element>();
  const warnings: string[] = [];
  const reuse = options.reuse === true && SHARED_KINDS.has(plan.kind);
  const changes: Built["changes"] = [];
  const removed: Element[] = [];
  let updated = 0;
  let unchanged = 0;
  let shown = 0;
  /** Nodes whose view is new, so containment and dividers apply to them. */
  const fresh = new Set<string>();
  plan.nodes.forEach((node, i) => {
    const bound = options.bind?.get(node.key);
    const found = pools?.nodes.take(
      bound
        ? `id|${bound._id}`
        : node.type === "Note"
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
        ...viewPropertyOps(node, found._id, found),
      ];
      if (more.length > 0) {
        updated++;
        changes.push({ key: node.key, view: found, ops: more });
      } else unchanged++;
      ops.push(...more);
      return;
    }
    const as = `n${i}`;
    const box = boxes.get(node.key)!;
    created.set(as, node.key);
    fresh.add(node.key);
    const warned = warnings.length;
    const model =
      bound ??
      (reuse
        ? findModel(
            node,
            target.diagram?._parent ?? target.parent,
            claimed,
            warnings,
          )
        : null);
    // Without reuse, or when several elements have the name, a new element
    // of the same name is what was asked for.
    const duplicate =
      options.allowDuplicateNames === true ||
      options.reuse === false ||
      warnings.length > warned;
    if (model) {
      claimed.add(model);
      shown++;
      refs.set(node.key, { model: model._id, view: `$${as}.view` });
      ops.push({
        path: "/create_view_of",
        as,
        body: {
          ref: model._id,
          diagram: diagramRef,
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
          ref: `$${as}.view`,
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      });
      ops.push(
        ...propertyOps(node, model),
        ...memberOps(node, model._id, model),
      );
      ops.push(...styleOps(node, `$${as}.view`));
      ops.push(...viewPropertyOps(node, `$${as}.view`));
      // An element shown from another owner reads "Name (from Owner)" by
      // StarUML's default; the build shows the plain name unless asked
      // (issue #34).
      if (!options.showNamespace && namespaced(model)) {
        ops.push({
          path: "/update_element",
          body: { ref: `$${as}.view`, field: "showNamespace", value: false },
        });
      }
      ops.push(...lifelineOps(model, `$${as}.view`));
      // A shown fragment keeps its operands; its dividers still go between
      // the messages the plan put in each (issue #38).
      if (node.operandAt) {
        ops.push({
          path: "/divide_fragment",
          body: { ref: `$${as}.view`, at: node.operandAt },
        });
      }
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
        diagram: diagramRef,
        ...(node.owner !== undefined && {
          parent: refs.get(node.owner)!.model,
        }),
        ...(node.host !== undefined && {
          container: refs.get(node.host)!.view,
        }),
        // A note is a view without a model, so it takes neither.
        ...(!note && { name: node.name }),
        ...(node.properties && { properties: node.properties }),
        x: Math.round(box.x),
        y: Math.round(box.y),
        x2: Math.round(box.x + box.width),
        y2: Math.round(box.y + box.height),
        ...(node.operandNames && { fields: ["operands"] }),
        ...(duplicate && { allowDuplicateNames: true }),
      },
    });
    if (note) {
      ops.push({
        path: "/update_element",
        body: { ref: `$${as}.view`, field: "text", value: node.text },
      });
    }
    ops.push(...memberOps(node, `$${as}.model`));
    ops.push(...styleOps(node, `$${as}.view`));
    ops.push(...viewPropertyOps(node, `$${as}.view`));
    (node.operands ?? []).forEach((guard, k) => {
      ops.push({
        path: "/create_element",
        body: {
          type: "UMLInteractionOperand",
          parent: `$${as}.model`,
          name: node.operandNames![k + 1],
          properties: { guard },
        },
      });
    });
    if (node.operandNames) {
      // StarUML makes the first operand with the fragment, unnamed.
      ops.push({
        path: "/update_element",
        body: {
          ref: `$${as}.model.operands.0`,
          field: "name",
          value: node.operandNames[0],
        },
      });
    }
    if (node.guard !== undefined) {
      ops.push({
        path: "/update_element",
        body: {
          ref: `$${as}.model.operands.0`,
          field: "guard",
          value: node.guard,
        },
      });
    }
    if (node.operandAt) {
      ops.push({
        path: "/divide_fragment",
        body: { ref: `$${as}.view`, at: node.operandAt },
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
        refs: views,
        dx: 0,
        dy: 0,
        container: refs.get(container)!.view,
      },
    });
  }
  const edgeOps: { key: string; as: string }[] = [];
  /** Each edge's view, by plan index, for the edges drawn along it. */
  const edgeViews: string[] = [];
  const boundOf = (edge: PlanEdge, i: number) =>
    options.bindEdges?.get(edge.source ?? i);
  // A connector made for messages that are all shown from the model is
  // StarUML's to make: viewForCommunicationDiagramFn draws a message's
  // connector with it (uml-factory.js, 7.1.1).
  const carried = (i: number) =>
    plan.edges.flatMap((r, k) => (r.along === i ? [boundOf(r, k)] : []));
  plan.edges.forEach((edge, i) => {
    if (edge.implicit && carried(i).every((b) => b !== undefined)) {
      edgeViews.push("");
      return;
    }
    const tail = refs.get(edge.from)!;
    const head = refs.get(edge.to)!;
    edgeViews.push(`$e${i}.view`);
    const noteLink = viewOnly(edge.type);
    const boundEdge = boundOf(edge, i);
    const found = pools?.edges.take(
      boundEdge
        ? `id|${boundEdge._id}`
        : noteLink
          ? `${edge.type}|${tail.view}|${head.view}`
          : `${signatureOf(edge.type)}|${edge.name ?? ""}|${tail.model}|${head.model}`,
    );
    const key = `${edge.from} -> ${edge.to}`;
    if (found) {
      kept.add(found);
      edgeViews[i] = found._id;
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
          type: edge.type,
          diagram: diagramRef,
          tail: tail.view,
          head: head.view,
        },
      });
      return;
    }
    const existingEnds =
      reuse && !tail.model!.startsWith("$") && !head.model!.startsWith("$");
    const relationship =
      boundEdge ??
      (existingEnds
        ? findRelationship(
            edge,
            app.repository.get(tail.model!)!,
            app.repository.get(head.model!)!,
          )
        : undefined);
    if (relationship) {
      ops.push({
        path: "/create_view_of",
        as,
        body: {
          ref: relationship._id,
          diagram: diagramRef,
          // A message is shown at its place in time.
          ...(edge.geometry && {
            x: Math.round(edge.geometry.x1),
            y: Math.round(edge.geometry.y1),
          }),
        },
      });
      return;
    }
    // A message on a communication diagram is drawn along its connector,
    // which is both its ends (messageFn in uml-factory.js, 7.1.1).
    const along = edge.along === undefined ? null : edgeViews[edge.along]!;
    ops.push({
      path: "/create_relationship",
      as,
      body: {
        type: edge.type,
        tail: along ?? tail.view,
        head: along ?? head.view,
        diagram: diagramRef,
        ...(edge.name !== undefined && { name: edge.name }),
        ...(edge.properties && { properties: edge.properties }),
        ...(edge.tailEnd && { tailEnd: edge.tailEnd }),
        ...(edge.headEnd && { headEnd: edge.headEnd }),
        ...edge.geometry,
      },
    });
  });
  // A kept message keeps the connector it is drawn on.
  for (const v of [...kept]) if (v.hostEdge) kept.add(v.hostEdge as View);
  ops.push(...frameOps(plan, target.diagram, boxes.get(FRAME)));
  let deleted = 0;
  if (options.prune && pools) {
    // Edges first: deleting a node takes its edges along, and an op on an
    // edge already gone would fail the batch.
    const gone = pools.all
      .filter((v) => !kept.has(v))
      .sort((a, b) => Number(isEdge(b)) - Number(isEdge(a)));
    const keep = [...kept].flatMap((v) => (v.model ? [v.model] : []));
    const targets = gone.map((v) =>
      options.pruneViewsOnly ? v : pruneTarget(v, target.diagram!, keep),
    );
    const models = targets.filter((t) => !(t instanceof type.View));
    for (const [i, t] of targets.entries()) {
      // What a pruned model owns, and the views showing it, go with it.
      const owned = t instanceof type.View ? (t as View).model : t;
      const covered =
        owned !== null && models.some((m) => m !== owned && within(owned, m));
      if (covered || targets.indexOf(t) !== i) continue;
      deleted++;
      removed.push(t);
      ops.push({ path: "/delete_element", body: { ref: t._id } });
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
      body: {
        diagram: diagramRef,
        preset,
        ...(plan.fit && { fit: true }),
        ...labelRoom(plan, preset),
      },
    });
  }
  return {
    ops,
    changes,
    removed,
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

/**
 * Separations giving edge labels room: dagre places a label beside its
 * edge, so between the nodes of a rank when ranks run down and across the
 * rank gap when they run sideways.
 */
function labelRoom(
  plan: Plan,
  preset: LayoutPresetName,
): { nodeSeparation?: number; rankSeparation?: number } {
  if (plan.edgeLabelWidth === undefined) return {};
  return labelSeparations(plan.edgeLabelWidth, preset);
}

/**
 * The frame StarUML draws on a diagram showing the diagram itself
 * (sequence, timing, internal block and parametric diagrams): a view whose
 * model is the diagram.
 */
function frameOf(diagram: Element): View {
  const frame = (diagram.ownedViews as View[]).find((v) => v.model === diagram);
  if (!frame) {
    throw new ApiError(
      "STARUML_ERROR",
      `${diagram.constructor.name} ${diagram._id} has lost its frame; nodes that sit in it cannot be added`,
    );
  }
  return frame;
}

/**
 * Finds the element the diagram is drawn for by name under the parent, or
 * makes it, unless the parent is one (plan.owner).
 */
function ownerOps(plan: Plan, parent: Element): { ops: Op[]; parent: string } {
  const owner = plan.owner;
  if (!owner || app.metamodels.isKindOf(parent.constructor.name, owner.type)) {
    return { ops: [], parent: parent._id };
  }
  if (owner.name === undefined) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec.block: a ${plan.kind} diagram shows the inside of a ${owner.type}; name it in spec.block, or pass one as parent`,
    );
  }
  // The block is where the diagram goes, as a parent is, so one of that
  // name is used whatever reuse says.
  const found = app.repository
    .getInstancesOf(owner.type)
    .find((e) => e.name === owner.name && within(e, parent));
  if (found) return { ops: [], parent: found._id };
  return {
    ops: [
      {
        path: "/create_element",
        as: "owner",
        body: { type: owner.type, parent: parent._id, name: owner.name },
      },
    ],
    parent: "$owner",
  };
}

/** Sizes the frame of a diagram that has one to the plan's, if it differs. */
function frameOps(
  plan: Plan,
  diagram: Element | null,
  placed: Box | undefined,
): Op[] {
  const planned = plan.frame ?? placed;
  if (!planned) return [];
  const frame = diagram
    ? (diagram.ownedViews as View[]).find((v) => v.model === diagram)
    : undefined;
  if (diagram && !frame) return [];
  const { x, y, width, height } = planned;
  const bounds = { left: x, top: y, width, height };
  if (
    frame &&
    Object.entries(bounds).every(([k, v]) => (frame as Element)[k] === v)
  ) {
    return [];
  }
  return [
    {
      path: "/resize_node",
      body: { ref: frame?._id ?? "$diagram.ownedViews.0", ...bounds },
    },
  ];
}

const SIDES = { TB: "down", BT: "up", LR: "right", RL: "left" } as const;

/**
 * The layout preset for a kind built in `direction`. Class diagrams read as
 * hierarchies, with generalization targets on top; every other kind reads
 * along its edges, so a flowchart drawn TB starts at the top (issue #12).
 */
export function defaultPreset(kind: Kind, direction: Direction) {
  // A package diagram's dependencies point at what is used, which reads
  // best on top, as a superclass does.
  const family = kind === "class" || kind === "package" ? "hierarchy" : "flow";
  return `${family}-${SIDES[direction]}` as LayoutPresetName;
}

/**
 * A mind map grows sideways from its root; drawn top down, every leaf
 * lands in one row (14740 px wide for the ThingsBoard map, issue #35).
 */
export const defaultDirection = (kind: Kind): Direction =>
  kind === "mindmap" || kind === "communication" ? "LR" : "TB";

/**
 * How a lifeline of the model is drawn: one representing an actor as the
 * actor's figure (UMLSeqLifelineView.drawIcon in the 7.1.1 uml
 * elements.js draws it only for the icon display), and one named like its
 * type by its name alone, not "Device: Device".
 */
export function lifelineOps(model: Element, view: string) {
  if (!(model instanceof type.UMLLifeline)) return [];
  const represent = model.represent as Element | null;
  const typed = represent?.type as Element | null | undefined;
  if (!typed || typeof typed !== "object") return [];
  return [
    ...(typed instanceof type.UMLActor
      ? [
          {
            path: "/update_element",
            body: { ref: view, field: "stereotypeDisplay", value: "icon" },
          },
        ]
      : []),
    ...(typed.name === model.name
      ? [
          {
            path: "/update_element",
            body: { ref: view, field: "showType", value: false },
          },
        ]
      : []),
  ];
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

export interface SourceInput {
  kind?: Kind;
  spec?: Record<string, unknown>;
  mermaid?: string;
  text?: string;
  format?: (typeof FORMATS)[number];
  direction?: Direction;
}

/** The kind and spec a request describes, from its spec or its text. */
export function readSource(input: SourceInput): {
  kind: Kind;
  spec: unknown;
  title: string | undefined;
  direction: Direction | undefined;
  parsed: ReturnType<typeof parseSource> | undefined;
} {
  const given = [input.spec, input.mermaid, input.text].filter(
    (x) => x !== undefined,
  );
  if (given.length !== 1) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      "Pass one of spec (with kind), mermaid and text",
    );
  }
  if (
    input.mermaid !== undefined &&
    (input.format ?? "mermaid") !== "mermaid"
  ) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `format: mermaid holds Mermaid; pass ${input.format} source as text`,
    );
  }
  const source = input.mermaid ?? input.text;
  if (source !== undefined) {
    const parsed = parseSource(
      source,
      input.mermaid !== undefined ? "mermaid" : input.format,
      input.kind,
    );
    return {
      kind: parsed.kind,
      spec: parsed.spec,
      title: parsed.title,
      direction: input.direction ?? parsed.direction,
      parsed,
    };
  }
  if (input.kind === undefined) {
    throw new ApiError("INVALID_ARGUMENT", "kind: required with spec");
  }
  return {
    kind: input.kind,
    spec: input.spec,
    title: undefined,
    direction: input.direction,
    parsed: undefined,
  };
}

const CREATES = new Set([
  "/create_diagram",
  "/create_element",
  "/create_element_with_view",
  "/create_relationship",
  "/create_edge_with_view",
  "/create_view_of",
  "/add_attribute",
  "/add_operation",
  "/add_enumeration_literal",
]);

/**
 * An id an op names, as its path ("@project" for the project); a "$name"
 * placeholder, or an id of nothing, stays as written.
 */
function where(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const elem = ref.startsWith("$") ? undefined : byId(ref);
  if (!elem) return ref;
  return pathOf(elem) ?? (elem === app.project.getProject() ? "@project" : ref);
}

export interface PlanStep {
  op: string;
  /** The element the op acts on or files under: a path, or a "$name" placeholder. */
  target: string | null;
  as?: string;
  type?: string;
  name?: string;
  /** What changes, for updates: "field = value", style properties. */
  change?: string;
}

/** One op of a build, as a reader would say it. */
export function describeOp(op: Op): PlanStep {
  const b = op.body;
  const target = where(
    b.ref ?? b.parent ?? b.diagram ?? (b.refs as unknown[] | undefined)?.[0],
  );
  const extra = Object.entries(b).filter(
    ([k]) => !["ref", "refs", "parent", "diagram", "type", "name"].includes(k),
  );
  return {
    op: op.path,
    target,
    ...(op.as !== undefined && { as: op.as }),
    ...(typeof b.type === "string" && { type: b.type }),
    ...(typeof b.name === "string" && { name: b.name }),
    ...(!CREATES.has(op.path) &&
      extra.length > 0 && {
        change: extra.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", "),
      }),
  };
}

/** The ops of a build sorted into what they create, change and delete. */
export function planOf(ops: Op[]) {
  const steps = ops.map((op) => ({ op, step: describeOp(op) }));
  return {
    ops,
    creates: steps.filter((s) => CREATES.has(s.op.path)).map((s) => s.step),
    updates: steps
      .filter((s) => !CREATES.has(s.op.path) && s.op.path !== "/delete_element")
      .map((s) => s.step),
    deletes: steps
      .filter((s) => s.op.path === "/delete_element")
      .map((s) => s.step),
  };
}

const stepSchema = () =>
  z.object({
    op: z.string(),
    target: z.nullable(z.string()),
    as: z.optional(z.string()),
    type: z.optional(z.string()),
    name: z.optional(z.string()),
    change: z.optional(z.string()),
  });

export const planSchema = () =>
  z.object({
    ops: doc(
      z.array(
        z.object({
          path: z.string(),
          body: z.record(z.string(), z.unknown()),
          as: z.optional(z.string()),
        }),
      ),
      "The /batch ops applying the plan runs, in order.",
    ),
    creates: z.array(stepSchema()),
    updates: z.array(stepSchema()),
    deletes: z.array(stepSchema()),
  });

export const RESULT_MODES = ["terse", "ids", "full"] as const;
export type ResultMode = (typeof RESULT_MODES)[number];

export const resultField = (description: string) =>
  z.optional(doc(z.enum(RESULT_MODES), description));

/**
 * The id echo a result mode keeps: none by default, since a mind map's
 * echo alone ran to 15 KB (issue #35).
 */
function shaped<I, E>(mode: ResultMode | undefined, ids: I, edges: E) {
  return {
    ...(mode !== undefined && mode !== "terse" && { ids }),
    ...(mode === "full" && { edges }),
  };
}

interface BuiltRef {
  _id?: string;
  view?: { _id: string };
  model?: { _id: string } | null;
}

/** The view id a plan node ended up with: reused, or made by its op. */
function viewIdOf(
  key: string,
  built: Built,
  byName: ReadonlyMap<string, BuiltRef>,
): string | undefined {
  const reused = built.reused.get(key);
  if (reused) return reused.view;
  const as = [...built.created].find(([, k]) => k === key)![0];
  return byName.get(as)!.view!._id;
}

/**
 * A plan without the colours its spec gives: under a strict profile the
 * profile alone styles views (issue #31).
 */
const COLOURS = ["fillColor", "lineColor", "fontColor"];

/** Whether a node's spec gives it colours (rather than only a display such as an interface's). */
const coloured = (n: PlanNode) =>
  Object.keys(n.style ?? {}).some((k) => COLOURS.includes(k));

/**
 * A plan without the colours its spec gives: under a strict profile the
 * profile alone colours views (issue #31). Display settings the kind needs,
 * such as an interface drawn as a box, stay.
 */
function withoutStyles(plan: Plan, warnings: string[]): Plan {
  const styled = plan.nodes.filter(coloured);
  if (styled.length === 0) return plan;
  warnings.push(
    `the style profile is strict: the colours the spec gives ${styled.length} node(s) were not applied`,
  );
  return {
    ...plan,
    nodes: plan.nodes.map((n) => {
      if (!coloured(n)) return n;
      const { style, ...rest } = n;
      const kept = Object.fromEntries(
        Object.entries(style!).filter(([k]) => !COLOURS.includes(k)),
      );
      return Object.keys(kept).length > 0 ? { ...rest, style: kept } : rest;
    }),
  };
}

const buildRequest = () =>
  z.object({
    kind: z.optional(
      doc(
        z.enum(KINDS),
        "Diagram kind; required with spec. With text it is read from the source; 'activity' or 'usecase' reads a Mermaid flowchart as that kind, 'erd' JSON Schema as an ERD, and any kind picks the PlantUML reader.",
      ),
    ),
    spec: z.optional(
      doc(
        z.record(z.string(), z.unknown()),
        "class: {packages, classes: [{name, kind: class|interface|enum|abstract, package, stereotype, attributes: ['+id: long'], operations: ['+total(): double'], literals}], relations: [{from, to, type: association|directed|aggregation|composition|generalization|realization|dependency, name, fromMultiplicity, toMultiplicity}] (an aggregation or composition's from is the whole, which gets the diamond)}. sequence: {participants, messages: [{from, to, text, kind: sync|async|reply|create|delete}], fragments: [{operator: alt|opt|loop|..., guard, operands: ['else'], operandStarts, from, to}] (message indices)}. usecase: {system, actors, useCases, relations: [{from, to, type: association|include|extend|generalization}]}. activity: {lanes, nodes: [{id, name, type: action|initial|final|flowFinal|decision|merge|fork|join|object, lane}], flows: [{from, to, guard}]}. statemachine: {states: [{id, name, type: state|initial|final|choice|fork|join, parent: composite state}], transitions: [{from, to, trigger, guard, effect}]}. erd: {entities: [{name, columns: ['id int PK', ...]}], relationships: [{from, to, fromCardinality, toCardinality: '0..1'|'1'|'0..*'|'1..*', name, identifying}]}. flowchart: {nodes: [{id, name, shape: process|decision|terminator|data|document|predefined|alternate|database|manualInput|preparation|connector|delay|display}], flows: [{from, to, label}]}. mindmap: {root: {name, children: [...]}}. requirement: {requirements: [{name, type: requirement|functional|interface|performance|physical|design, id, text, risk, verifyMethod}], elements: [{name, type, docRef}], relations: [{from, to, type: contains|copies|derives|satisfies|verifies|refines|traces}]}. c4: {elements: [{id, name, type: person|system|container|component, kind (container kind, e.g. database), technology, description, external}], relations: [{from, to, label, technology, description}]}. Every kind also takes notes: [{text, on: node(s); sequence: side: left|right|over, at: message index}] and styles: {node: {fillColor, lineColor, fontColor}}. Names may contain '\\n' or '<br/>' for line breaks; edges name nodes by name, or by id where nodes have one. " +
          familyGrammar() +
          ".",
      ),
    ),
    mermaid: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Mermaid source instead of spec. The diagram is named by 'name', else front matter 'title:' or a 'title' line.",
      ),
    ),
    text: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Diagram source instead of spec, in format: Mermaid, PlantUML (class, sequence, use case, activity, state, IE entity, mind map, C4-PlantUML), SQL DDL (an ERD from CREATE TABLE and foreign keys) or JSON Schema (a class diagram, or an ERD with kind erd). Constructs a StarUML diagram cannot hold are refused as UNSUPPORTED_SYNTAX.",
      ),
    ),
    format: z.optional(
      doc(
        z.enum(FORMATS),
        "Format of text (or mermaid); detected when omitted: @start... is PlantUML, a JSON object JSON Schema, CREATE TABLE SQL, anything else Mermaid.",
      ),
    ),
    name: z.optional(doc(z.string(), "Diagram name.")),
    parent: z.optional(
      ref(
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
    ...duplicateShape(),
    dryRun: z.optional(
      doc(
        z.boolean(),
        "Answer what the build would do, with plan listing its creates, updates and deletes (paths, or '$name' placeholders for what it makes) and the exact /batch ops, and change nothing. ids and the diagram carry the placeholders.",
      ),
    ),
    reuse: z.optional(
      doc(
        z.boolean(),
        "Default true: a class, interface, enum, package, actor, use case, entity, requirement or C4 element named like one elsewhere in the project is that element shown again (Model Explorer drag and drop), not a copy; a path ('Model/Billing/Invoice') or 'Owner::Name' picks one by its owners. false always makes new elements.",
      ),
    ),
    showNamespace: z.optional(
      doc(
        z.boolean(),
        "Default false: an element shown from another package (reuse) is drawn with its plain name. true keeps StarUML's '(from Owner)' line under it.",
      ),
    ),
    viewpoint: z.optional(
      doc(
        z.enum(VIEWPOINT_NAMES),
        "The viewpoint the diagram is a view of (see /list_viewpoints): stored on the diagram, its required parts (a legend) added, its conformance answered. The kind must be one the viewpoint is drawn as.",
      ),
    ),
    template: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "A diagram template (see /list_templates): its viewpoint and kind (kind may be left out), house style, layout preset, title block and legend, and its content limits. Required under a strict profile.",
      ),
    ),
    override: z.optional(
      doc(
        z.boolean(),
        "Rebuild a diagram /derive_diagrams owns anyway; refused under a strict profile.",
      ),
    ),
    result: resultField(
      "terse (default): counts, the diagram and warnings. ids: also the model and view ids of each node. full: also each edge's ids.",
    ),
  });

const buildResponse = () =>
  z.object({
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
    format: z.optional(doc(z.enum(FORMATS), "The format text was read as.")),
    layout: doc(
      z.enum(["engine", "placed"]),
      "engine: Format > Layout arranged it; placed: the computed placement stands.",
    ),
    preset: z.optional(doc(z.string(), "The layout preset applied.")),
    ids: z.optional(
      doc(
        z.record(z.string(), refSchema()),
        "With result ids or full: model and view ids of each node, by its name (or id) in the spec.",
      ),
    ),
    edges: z.optional(
      doc(
        z.array(
          z.object({
            key: doc(z.string(), "'from -> to'."),
            model: z.nullable(z.string()),
            view: z.string(),
          }),
        ),
        "With result full: each edge's model and view ids.",
      ),
    ),
    dryRun: z.optional(doc(z.boolean(), "Set when nothing was changed.")),
    plan: z.optional(doc(planSchema(), "With dryRun: what applying runs.")),
    style: z.optional(styleReportSchema()),
    quality: z.optional(qualitySchema()),
    viewpoint: z.optional(viewpointReportSchema()),
    template: z.optional(templateReportSchema()),
  });

export const viewpointReportSchema = () =>
  doc(
    z.object({
      name: z.string(),
      conforms: doc(
        z.boolean(),
        "No error or warning of /viewpoint_lint on the diagram.",
      ),
      findings: z.array(z.object({ rule: z.string(), message: z.string() })),
    }),
    "The viewpoint the diagram declares and whether it keeps to it (issue #42).",
  );

export const templateReportSchema = () =>
  doc(
    z.object({
      name: z.string(),
      version: z.int(),
      accepted: doc(
        z.boolean(),
        "The diagram passes as one of its template: structurally like the template's approved exemplar, and scoring near it.",
      ),
    }),
    "The template the diagram was made with (issue #43).",
  );

/** Request fields that style or lay out a diagram, which a strict profile leaves to templates. */
const FREE_FORM = [
  "layout",
  "direction",
  "autoLayout",
  "showNamespace",
] as const;

/**
 * A build request refused before anything is made (issues #42, #43): under
 * a strict profile a diagram is built only through a template, from
 * content alone; a template draws one viewpoint as one kind; a viewpoint
 * is drawn only as its kinds; a derived diagram is not rebuilt from
 * outside. Answers the template, if any.
 */
export function checkBuild(input: BuildInput): Template | undefined {
  const profile = effectiveProfile().profile;
  const strict = profile.strict && !isTrusted();
  const t =
    input.template === undefined ? undefined : findTemplate(input.template);
  if (strict) {
    const fields = [
      ...FREE_FORM.filter((f) => input[f] !== undefined),
      ...(input.spec && "styles" in input.spec ? ["spec.styles"] : []),
    ];
    if (t === undefined || fields.length > 0) {
      throw new ApiError(
        "TEMPLATE_ONLY",
        `build_diagram: the style profile '${profile.name}' is strict, so diagrams are built through a template from content alone${fields.length > 0 ? `, without ${fields.join(", ")}` : "; pass template (see /list_templates)"}`,
        { profile: profile.name, fields },
      );
    }
  }
  const kind = input.kind ?? t?.kind;
  if (t && kind !== t.kind) {
    throw mismatch(
      `the template ${t.name} draws ${t.kind}, not ${kind}`,
      t.viewpoint,
      [t.kind],
    );
  }
  if (t && input.viewpoint !== undefined && input.viewpoint !== t.viewpoint) {
    throw mismatch(
      `the template ${t.name} draws the ${t.viewpoint} viewpoint, not ${input.viewpoint}`,
      t.viewpoint,
      [t.kind],
    );
  }
  const viewpoint = t?.viewpoint ?? input.viewpoint;
  if (viewpoint !== undefined) {
    const vp = findViewpoint(viewpoint);
    const drawn = readSource({ ...input, kind }).kind;
    if (!(vp.kinds as string[]).includes(drawn)) {
      throw mismatch(
        `the ${vp.name} viewpoint is drawn as ${vp.kinds.join(", ")}, not ${drawn}`,
        vp.name,
        vp.kinds,
      );
    }
  }
  if (input.upsert && !isTrusted() && !overridden(input.override)) {
    const { kind: drawn, title } = readSource({ ...input, kind });
    const raw = input.name ?? title;
    const parent =
      input.parent === undefined
        ? requireProject()
        : requireElement(input.parent, "Parent");
    const found = findDiagram(
      drawn,
      raw === undefined ? undefined : multiline(raw),
      parent,
    );
    if (found && readMark(found)?.derived) {
      throw derivedRefusal("/build_diagram", found);
    }
  }
  return t;
}

function mismatch(message: string, viewpoint: string, kinds: readonly Kind[]) {
  const vp = findViewpoint(viewpoint);
  return new ApiError("VIEWPOINT_MISMATCH", `build_diagram: ${message}`, {
    reason: "kind",
    alternatives: kinds.map((k) => ({
      viewpoint: vp.name,
      kind: k,
      why: vp.question,
      template: defaultTemplate(vp.name, k).name,
    })),
  });
}

/** The parts a viewpoint requires that the engine draws: its legend. */
export function partsFor(viewpoint: string): PartTexts {
  const vp = findViewpoint(viewpoint);
  return vp.required.includes("legend") && vp.legend
    ? { legend: ["Legend", ...vp.legend].join("\n") }
    : {};
}

export function buildDiagramEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/build_diagram",
    description:
      "Build a whole diagram in one call from a compact spec per kind (class, sequence, usecase, activity, statemachine, erd, flowchart, mindmap, requirement, c4, package, component, deployment, and the families composite, object, communication, timing, overview, infoflow, profile, dfd, bdd, ibd, parametric, bpmn, wireframe, aws, azure, gcp) or from text: Mermaid (classDiagram, sequenceDiagram, flowchart, erDiagram, stateDiagram with composite state blocks, mindmap, requirementDiagram, C4Context/C4Container/C4Component; notes and classDef/style colours; a flowchart also as activity or usecase; /export_text writes this Mermaid back), PlantUML, SQL DDL or JSON Schema. One undo step; laid out by Format > Layout where the kind allows. Elements named like existing ones are shown again rather than copied (reuse). upsert updates the diagram of the same name instead of adding another, and prune removes what the spec no longer has. template (see /list_templates) draws it as that template's viewpoint and kind, in its house style and layout, with its title block and legend, and refuses content past its limits; under a strict profile a template is required and layout, direction, autoLayout, showNamespace and spec.styles are refused (TEMPLATE_ONLY). A diagram /derive_diagrams owns is not rebuilt from here (DIAGRAM_DERIVED). Answers the ids of what it made, not the model.",
    readOnly: false,
    destructive: false,
    request: buildRequest(),
    aliases: { parentId: "parent" },
    response: buildResponse(),
    handle: (input) => {
      const template = checkBuild(input);
      return buildDiagram(
        { ...input, kind: input.kind ?? template?.kind },
        endpoints,
        { enforce: true },
      );
    },
  });
}

/** Binding a build to existing model elements, for /derive_diagrams. */
export interface BuildExtras {
  bind?: ReadonlyMap<string, Element>;
  bindEdges?: ReadonlyMap<number, Element>;
  pruneViewsOnly?: boolean;
  /**
   * A dry run answers the ops only, without describing each by path:
   * /derive_diagrams counts them, and naming every target walks the
   * repository once per op.
   */
  opsOnly?: boolean;
  /** The template, when the caller picked it rather than the request. */
  template?: Template;
  /** The diagram is the model's, derived: marked so, and locked (issue #43). */
  derived?: boolean;
  /** Refuse content past the template's limits (a request; a derivation reports them). */
  enforce?: boolean;
}

export type BuildInput = z.output<ReturnType<typeof buildRequest>>;

/** Content past a template's limits, refused as VIEWPOINT_MISMATCH. */
function checkContent(t: Template, plan: Plan): void {
  const nodes = plan.nodes.filter((n) => n.type !== "Note");
  const lifelines = nodes.filter((n) => n.type === "UMLLifeline").length;
  const over =
    nodes.length > t.content.maxElements
      ? `${nodes.length} elements, more than the ${t.content.maxElements}`
      : t.content.maxLifelines !== undefined &&
          lifelines > t.content.maxLifelines
        ? `${lifelines} lifelines, more than the ${t.content.maxLifelines}`
        : null;
  if (over === null) return;
  const vp = findViewpoint(t.viewpoint);
  throw new ApiError(
    "VIEWPOINT_MISMATCH",
    `build_diagram: ${over} the template ${t.name} holds`,
    {
      reason: "limits",
      alternatives: [{ viewpoint: vp.name, kind: t.kind, why: vp.split }],
    },
  );
}

/** /build_diagram's work, which /derive_diagrams runs once per diagram. */
export async function buildDiagram(
  input: BuildInput,
  endpoints: () => readonly Endpoint[],
  extras: BuildExtras = {},
) {
  const { kind, spec, title, direction, parsed } = readSource(input);
  const template =
    extras.template ??
    (input.template === undefined ? undefined : findTemplate(input.template));
  const base = effectiveProfile().profile;
  const profile = template ? templateProfile(base, template) : base;
  const renames = new Renames(profile);
  const styleWarnings: string[] = [];
  const plan = normalizePlan(
    profile.strict
      ? withoutStyles(planFor(kind, spec), styleWarnings)
      : planFor(kind, spec),
    renames,
  );
  if (template && extras.enforce) checkContent(template, plan);
  const parent =
    input.parent === undefined
      ? requireProject()
      : requireElement(input.parent, "Parent");
  const raw = input.name ?? title;
  const name = raw === undefined ? undefined : multiline(raw);
  if (input.prune && !input.upsert) {
    throw new ApiError("INVALID_ARGUMENT", "prune: needs upsert");
  }
  const diagram = input.upsert ? findDiagram(kind, name, parent) : null;
  const viewpoint = template?.viewpoint ?? input.viewpoint;
  const mark: Mark | undefined =
    viewpoint === undefined
      ? undefined
      : {
          viewpoint,
          ...(template && {
            template: template.name,
            version: template.version,
          }),
          ...(extras.derived && { derived: true }),
        };
  const parts =
    mark &&
    (template
      ? templateParts(template, name, parent)
      : partsFor(mark.viewpoint));
  const skip = new Set(
    diagram ? partViews(diagram, readMark(diagram)).map((v) => v._id) : [],
  );
  const built = opsFor(
    plan,
    { diagram, parent, name },
    direction ?? defaultDirection(kind),
    input.autoLayout ?? true,
    input.layout ??
      template?.layout.preset ??
      (input.direction === undefined && parsed?.direction === undefined
        ? presetFor(profile, kind)
        : undefined),
    {
      prune: input.prune,
      reuse: input.reuse ?? true,
      allowDuplicateNames: input.allowDuplicateNames,
      showNamespace: input.showNamespace,
      skip,
      ...extras,
    },
  );
  const warnings = [
    ...(parsed?.warnings ?? []),
    ...built.warnings,
    ...styleWarnings,
  ];
  const summary = {
    kind,
    upserted: diagram !== null,
    updated: built.updated,
    unchanged: built.unchanged,
    layout: built.layout,
    ...(built.preset && { preset: built.preset }),
    ...(built.shown > 0 && { shown: built.shown }),
    ...(input.prune && { deleted: built.deleted }),
    ...(parsed && input.text !== undefined && { format: parsed.format }),
    ...(warnings.length > 0 && { warnings }),
  };
  if (input.dryRun) {
    // What applying would answer, with "$name" placeholders for what
    // does not exist yet; nothing is run.
    const ids: Record<string, { model: string | null; view: string }> =
      Object.fromEntries(built.reused);
    for (const [as, key] of built.created) {
      ids[key] = { model: `$${as}.model`, view: `$${as}.view` };
    }
    return {
      diagram: diagram
        ? (({ _id, _type, name }) => ({ _id, _type, name }))(summarize(diagram))
        : {
            _id: "$diagram",
            _type: DIAGRAM_TYPES[kind],
            name: name ?? null,
          },
      ...summary,
      created: built.created.size + built.edgeOps.length,
      ...shaped(
        input.result,
        ids,
        built.edgeOps.map(({ key, as }) => ({
          key,
          model: `$${as}.model`,
          view: `$${as}.view`,
        })),
      ),
      style: styleReport(profile, renames, 0),
      dryRun: true,
      plan: extras.opsOnly
        ? { ops: built.ops, creates: [], updates: [], deletes: [] }
        : planOf(built.ops),
    };
  }
  const specStyled = plan.nodes.filter(coloured).map((n) => n.key);
  const { byName, target, styled, quality, accepted } = await oneStep(
    "build diagram",
    async () => {
      let data: BatchData = { results: [] };
      if (built.ops.length > 0) {
        try {
          data = await batchRunner.run(endpoints(), built.ops);
        } catch (err) {
          const e = err as ApiError;
          throw new ApiError(e.code, `build_diagram: ${e.message}`, e.details);
        }
      }
      const byName = new Map(
        data.results.flatMap((r) => (r.as ? [[r.as, r.data]] : [])),
      ) as Map<string, BuiltRef>;
      const target = diagram ?? requireElement(byName.get("diagram")!._id!);
      // Colours the spec gives a node win over the profile's, unless
      // the profile is strict (then the spec's were dropped above).
      const keep = new Set(
        specStyled.map((key) => viewIdOf(key, built, byName)),
      );
      const styled = styleViews(
        target,
        styledViews(target).filter((v) => !keep.has(v._id)),
        profile,
      );
      // An upsert that changed nothing leaves the picture as it was
      // arranged; it is only scored.
      const loop =
        built.ops.length > 0
          ? improve(target, profile)
          : scoredAsIs(target, profile);
      deselect(target);
      const placed = async () => {
        if (!mark || !(await placeParts(target, parts!, mark, endpoints))) {
          return loop;
        }
        // Notes the engine adds take the profile's look like the rest.
        styleViews(target, partViews(target, readMark(target)), profile);
        return withParts(loop, target, profile);
      };
      let quality = await placed();
      if (!template) return { byName, target, styled, quality };
      const partIds = () =>
        new Set(partViews(target, readMark(target)).map((v) => v._id));
      let accepted = accepts(template, target, quality.score, partIds());
      if (!accepted && built.ops.length > 0) {
        // Once more from the template's own layout: a first pass that
        // misses its exemplar is often a crossing the preset resolves.
        improve(target, profile, {
          relayout: true,
          preset: template.layout.preset,
        });
        deselect(target);
        await placeParts(target, parts!, mark!, endpoints);
        quality = withParts(loop, target, profile);
        accepted = accepts(template, target, quality.score, partIds());
      }
      return { byName, target, styled, quality, accepted };
    },
  );
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
  const { _id, _type, name: diagramName } = summarize(target);
  return {
    diagram: { _id, _type, name: diagramName },
    ...summary,
    created: built.created.size + edges.length,
    ...shaped(input.result, ids, edges),
    style: styleReport(profile, renames, styled),
    quality,
    ...(mark && {
      viewpoint: { name: mark.viewpoint, ...conformity(target) },
    }),
    ...(template && {
      template: {
        name: template.name,
        version: template.version,
        accepted: accepted!,
      },
    }),
  };
}

/**
 * The loop's result scored again with the parts drawn: the score is of
 * what is shown, the loop's own record (before, steps) as it left it.
 */
function withParts(loop: Quality, target: Element, profile: Profile): Quality {
  const {
    before: _before,
    target: _target,
    iterations: _iterations,
    steps: _steps,
    ...now
  } = scoredAsIs(target, profile);
  const { failures: _failures, ...rest } = loop;
  return { ...rest, ...now };
}
