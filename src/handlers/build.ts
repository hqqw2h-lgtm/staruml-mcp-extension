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
  type PlanNode,
  planFor,
} from "../build/spec.js";
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError, type ErrorCode } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { id } from "../schemas.js";
import { summarize } from "../serialize.js";
import { resolveCreateType } from "../toolbox.js";
import type { Element, View } from "../types.js";
import { modelTypeOf } from "./elements.js";

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
  model: string;
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

/** Node and edge views already on `diagram`, keyed for upsert. */
function existing(diagram: Element) {
  const nodes = new Pool<View>();
  const edges = new Pool<View>();
  for (const view of diagram.ownedViews as View[]) {
    const model = view.model;
    if (!model) continue;
    const name = model.name as string;
    if (isEdge(view)) {
      const tail = (view.tail as View).model;
      const head = (view.head as View).model;
      edges.add(
        `${modelSignature(model)}|${name}|${tail?._id}|${head?._id}`,
        view,
      );
    } else {
      nodes.add(`${modelSignature(model)}|${name}`, view);
    }
  }
  return { nodes, edges };
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

export interface Built {
  ops: Op[];
  /** Node keys by op name, and the existing elements reused. */
  created: Map<string, string>;
  reused: Map<string, Ref>;
  edgeOps: { key: string; as: string }[];
  updated: number;
  unchanged: number;
  layout: "engine" | "placed";
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
  let updated = 0;
  let unchanged = 0;
  plan.nodes.forEach((node, i) => {
    const found = pools?.nodes.take(`${signatureOf(node.type)}|${node.name}`);
    if (found) {
      const model = found.model!;
      const ref = { model: model._id, view: found._id };
      refs.set(node.key, ref);
      reused.set(node.key, ref);
      const more = [
        ...propertyOps(node, model),
        ...memberOps(node, model._id, model),
      ];
      if (more.length > 0) updated++;
      else unchanged++;
      ops.push(...more);
      return;
    }
    const as = `n${i}`;
    const box = boxes.get(node.key)!;
    refs.set(node.key, { model: `$${as}.model`, view: `$${as}.view` });
    created.set(as, node.key);
    ops.push({
      path: "/create_element_with_view",
      as,
      body: {
        type: node.type,
        diagramId: diagramRef,
        ...(node.owner !== undefined && {
          parentId: refs.get(node.owner)!.model,
        }),
        name: node.name,
        ...(node.properties && { properties: node.properties }),
        x: Math.round(box.x),
        y: Math.round(box.y),
        x2: Math.round(box.x + box.width),
        y2: Math.round(box.y + box.height),
        ...(node.guard !== undefined && { fields: ["operands"] }),
      },
    });
    ops.push(...memberOps(node, `$${as}.model`));
    if (node.style) {
      ops.push({
        path: "/set_view_style",
        body: { ids: [`$${as}.view`], ...node.style },
      });
    }
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
  });
  const edgeOps: { key: string; as: string }[] = [];
  plan.edges.forEach((edge, i) => {
    const tail = refs.get(edge.from)!;
    const head = refs.get(edge.to)!;
    const found = pools?.edges.take(
      `${signatureOf(edge.type)}|${edge.name ?? ""}|${tail.model}|${head.model}`,
    );
    const key = `${edge.from} -> ${edge.to}`;
    if (found) {
      unchanged++;
      return;
    }
    const as = `e${i}`;
    edgeOps.push({ key, as });
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
      body: { id: diagramRef, direction },
    });
  }
  return {
    ops,
    created,
    reused,
    edgeOps,
    updated,
    unchanged,
    layout: engine ? "engine" : "placed",
  };
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
      "Build a whole diagram in one call from a compact spec per kind (class, sequence, usecase, activity, statemachine, erd, flowchart, mindmap) or from Mermaid (classDiagram, sequenceDiagram, flowchart, erDiagram, stateDiagram; a flowchart also as activity or usecase). One undo step; laid out by Format > Layout where the kind allows. upsert updates the diagram of the same name instead of adding another. Answers the ids of what it made, not the model.",
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
          "class: {packages, classes: [{name, kind: class|interface|enum|abstract, package, stereotype, attributes: ['+id: long'], operations: ['+total(): double'], literals}], relations: [{from, to, type: association|directed|aggregation|composition|generalization|realization|dependency, name, fromMultiplicity, toMultiplicity}]}. sequence: {participants, messages: [{from, to, text, kind: sync|async|reply|create|delete}], fragments: [{operator: alt|opt|loop|..., guard, from, to}] (message indices)}. usecase: {system, actors, useCases, relations: [{from, to, type: association|include|extend|generalization}]}. activity: {lanes, nodes: [{id, name, type: action|initial|final|flowFinal|decision|merge|fork|join|object, lane}], flows: [{from, to, guard}]}. statemachine: {states: [{id, name, type: state|initial|final|choice|fork|join}], transitions: [{from, to, trigger, guard, effect}]}. erd: {entities: [{name, columns: ['id int PK', ...]}], relationships: [{from, to, fromCardinality, toCardinality: '0..1'|'1'|'0..*'|'1..*', name, identifying}]}. flowchart: {nodes: [{id, name, shape: process|decision|terminator|data|document|predefined|alternate|database|manualInput|preparation|connector|delay|display}], flows: [{from, to, label}]}. mindmap: {root: {name, children: [...]}}. Names may contain '\\n' or '<br/>' for line breaks; edges name nodes by name, or by id where nodes have one.",
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
      autoLayout: z.optional(
        doc(
          z.boolean(),
          "Default true: Format > Layout after building. Sequence diagrams, lanes and a system boundary keep the computed placement.",
        ),
      ),
      upsert: z.optional(
        doc(
          z.boolean(),
          "Update the diagram with this name and kind under the parent if there is one: nodes already on it (same type and name) gain missing members and changed properties, missing nodes and edges are added, nothing is removed.",
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
      layout: doc(
        z.enum(["engine", "placed"]),
        "engine: Format > Layout arranged it; placed: the computed placement stands.",
      ),
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
      const diagram = input.upsert ? findDiagram(kind, name, parent) : null;
      const built = opsFor(
        plan,
        { diagram, parent, name },
        direction ?? "TB",
        input.autoLayout ?? true,
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
        ids[key] = { model: r.model!._id, view: r.view!._id };
      }
      const edges = built.edgeOps.map(({ key, as }) => {
        const r = byName.get(as)!;
        return { key, model: r.model!._id, view: r.view!._id };
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
        ids,
        edges,
      };
    },
  });
}
