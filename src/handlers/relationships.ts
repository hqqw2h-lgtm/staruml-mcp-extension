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
import {
  center,
  createModelAndView,
  endView,
  initialValues,
  instantiate,
} from "../create.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireElement, requireView } from "../lookup.js";
import {
  attributeOf,
  isMetaClass,
  ownerField,
  relationshipKind,
  resolveOwnerField,
  type RelationshipKind,
} from "../metamodel.js";
import {
  ATTRIBUTE_VALUES_HELP,
  coordinate,
  elementSchema,
  id,
  projectionShape,
  properties,
  text,
  typeName,
} from "../schemas.js";
import { serialize } from "../serialize.js";
import type { Element, ModelAndViewOptions, View } from "../types.js";
import { resolveCreateType } from "../toolbox.js";
import { toModelValues } from "../values.js";
import { created, createdSchema, modelTypeOf, valuesFor } from "./elements.js";

interface EndValues {
  tail: Record<string, unknown>;
  head: Record<string, unknown>;
}

/**
 * Undirected relationships own two end elements (end1 at the tail, end2 at
 * the head), created by the relationship's constructor with its own end
 * class, e.g. UMLAssociationEnd; directed ones only reference source and
 * target (core metamodel and the extensions' elements.js in 7.1.1).
 */
function endTypes(modelType: string): { tail: string; head: string } {
  const probe = instantiate(modelType);
  return {
    tail: (probe.end1 as Element).constructor.name,
    head: (probe.end2 as Element).constructor.name,
  };
}

function endValues(
  modelType: string | null,
  kind: RelationshipKind | null,
  tailEnd: Record<string, unknown> | undefined,
  headEnd: Record<string, unknown> | undefined,
): EndValues {
  if (tailEnd === undefined && headEnd === undefined) {
    return { tail: {}, head: {} };
  }
  if (kind !== "undirected") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `tailEnd/headEnd apply to undirected relationships (end1/end2); ${String(modelType)} has none`,
    );
  }
  const types = endTypes(modelType!);
  return {
    tail: toModelValues(types.tail, tailEnd ?? {}),
    head: toModelValues(types.head, headEnd ?? {}),
  };
}

function assignEnds(model: Element, ends: EndValues): void {
  if (model.end1) Object.assign(model.end1, ends.tail);
  if (model.end2) Object.assign(model.end2, ends.head);
}

/** Geometry for an edge; unspecified points default to the centres of its end views. */
function edgeGeometry(
  tail: View,
  head: View,
  input: { x1?: number; y1?: number; x2?: number; y2?: number },
): Pick<ModelAndViewOptions, "x1" | "y1" | "x2" | "y2"> {
  const from = center(tail);
  const to = center(head);
  return {
    x1: input.x1 ?? from?.x ?? 0,
    y1: input.y1 ?? from?.y ?? 0,
    x2: input.x2 ?? to?.x ?? 0,
    y2: input.y2 ?? to?.y ?? 0,
  };
}

const geometryShape = () => ({
  x1: coordinate(
    "Edge start in diagram coordinates; default the tail view's centre. For a sequence message, y1/y2 place it on the lifelines.",
  ),
  y1: coordinate("See x1."),
  x2: coordinate("Edge end; default the head view's centre."),
  y2: coordinate("See x2."),
});

const endShape = () => ({
  tailEnd: properties(
    "Undirected relationships only: attributes of end1, e.g. {name, navigable, aggregation, multiplicity} for a UMLAssociation.",
  ),
  headEnd: properties("Undirected relationships only: attributes of end2."),
});

interface EdgeRequest {
  type: string;
  parent: Element;
  diagram: Element;
  tail: View;
  head: View;
  name?: string;
  properties?: Record<string, unknown>;
  tailEnd?: Record<string, unknown>;
  headEnd?: Record<string, unknown>;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/**
 * A relationship and its edge view, through createModelAndView as the diagram
 * editor creates them, so StarUML's preconditions and special cases apply
 * (message lines on lifelines, transitions, flows, ...).
 */
function createEdge(request: EdgeRequest): View {
  const { id: createId, preset } = resolveCreateType(request.type);
  const modelType = modelTypeOf(createId);
  const kind = modelType ? relationshipKind(modelType) : null;
  const values = valuesFor(createId, request.name, request.properties);
  const ends = endValues(modelType, kind, request.tailEnd, request.headEnd);
  return createModelAndView({
    ...preset,
    id: createId,
    parent: request.parent,
    diagram: request.diagram,
    tailView: request.tail,
    headView: request.head,
    tailModel: request.tail.model,
    headModel: request.head.model,
    ...edgeGeometry(request.tail, request.head, request),
    modelInitializer: (m: Element) => {
      Object.assign(m, values);
      assignEnds(m, ends);
    },
  });
}

export const createEdgeWithView = defineEndpoint({
  path: "/create_edge_with_view",
  description:
    "Create a relationship (UMLAssociation, UMLControlFlow, ...) between the models of two views, and the edge view connecting them. /create_relationship does the same and also accepts model ids and end attributes.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A model-and-view id of /introspect factory.modelAndViewIds whose entry has a relationship kind, e.g. 'UMLAssociation', an edge id such as 'NoteLink', or a toolbox item id such as 'UMLComposition' or 'UMLAsyncMessage'.",
    ),
    diagramId: id("Diagram to place the edge on."),
    parentId: z.optional(
      id(
        "Passed to the factory as the diagram editor does; default the diagram's owner. Most relationship factories file the relationship under the tail model regardless.",
      ),
    ),
    tailViewId: id("View at the source end."),
    headViewId: id("View at the target end."),
    name: z.optional(text("Relationship name.")),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...endShape(),
    ...geometryShape(),
    ...projectionShape(),
  }),
  response: createdSchema(),
  handle: (input) => {
    const diagram = requireDiagram(input.diagramId);
    const parent =
      input.parentId === undefined
        ? diagram._parent!
        : requireElement(input.parentId, "Parent");
    const view = createEdge({
      ...input,
      parent,
      diagram,
      tail: requireView(input.tailViewId, "Tail view"),
      head: requireView(input.headViewId, "Head view"),
    });
    return created(view, input);
  },
});

/**
 * Without a diagram no factory function applies, so the relationship is
 * constructed and added with Engine.addModel, one operation like the
 * factory's. StarUML's preconditions (which ends a relationship may connect)
 * live in the factory functions and are not applied on this path.
 */
function createModelOnly(
  modelType: string,
  kind: RelationshipKind,
  input: {
    parentId?: string;
    field?: string;
    name?: string;
    properties?: Record<string, unknown>;
    tailEnd?: Record<string, unknown>;
    headEnd?: Record<string, unknown>;
  },
  tail: Element,
  head: Element,
): Element {
  const values = initialValues(modelType, input.name, input.properties);
  const ends = endValues(modelType, kind, input.tailEnd, input.headEnd);
  const parent =
    input.parentId === undefined
      ? defaultOwner(tail, modelType)
      : requireElement(input.parentId, "Parent");
  const field = resolveOwnerField(parent, modelType, input.field);
  const model = instantiate(modelType);
  if (kind === "directed") {
    model.source = tail;
    model.target = head;
  } else {
    (model.end1 as Element).reference = tail;
    (model.end2 as Element).reference = head;
  }
  Object.assign(model, values);
  assignEnds(model, ends);
  const stored = inStarUML(() => app.engine.addModel(parent, field, model));
  if (!stored) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not add ${modelType} to ${parent.constructor.name}.${field}`,
    );
  }
  return stored;
}

/**
 * Where StarUML would file the relationship: the tail's owner when that has a
 * list typed for it (an interaction's `messages`, an activity's `edges`, a
 * region's `transitions`), else the tail model itself, which is where the
 * generic relationship factory functions put it
 * (defaultDirectedRelationshipFn(options.tailModel, ...) in uml-factory.js).
 */
function defaultOwner(tail: Element, modelType: string): Element {
  const owner = tail._parent;
  const field = owner ? ownerField(owner, modelType) : null;
  if (owner && field) {
    const attr = attributeOf(owner.constructor.name, field)!;
    if (attr.type !== "Element") return owner;
  }
  return tail;
}

/** A model for a model-only relationship end; a view id stands for its model. */
function endModel(id: string, role: string): Element {
  const elem = requireElement(id, role);
  const model = elem instanceof type.View ? (elem as View).model : elem;
  if (!model) {
    throw new ApiError("INVALID_ARGUMENT", `${role} ${id} shows no model`);
  }
  return model;
}

export const createRelationship = defineEndpoint({
  path: "/create_relationship",
  description:
    "Create a relationship between two elements with its ends set: source/target for directed kinds (Generalization, Dependency, Realization, InterfaceRealization, Include, Extend, Transition, ControlFlow, ObjectFlow, Message, flows of the other diagram families), end1/end2 for undirected ones (Association with end name, navigability, aggregation, multiplicity; Link; ERD relationship; connectors). With diagramId the edge view is created too, through StarUML's own factory and its connection rules; tail/head may then be view ids or ids of models shown on that diagram.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "With diagramId: a model-and-view id (see /introspect factory.modelAndView) or a toolbox item id that presets one, e.g. 'UMLComposition', 'UMLReplyMessage', 'ERDRelationshipOneToMany'. Without: a metamodel class whose relationship kind is directed or undirected.",
    ),
    tailId: id("Source end: a model, or a view on the diagram."),
    headId: id("Target end: a model, or a view on the diagram."),
    diagramId: z.optional(id("Diagram to draw the relationship on.")),
    parentId: z.optional(
      id(
        "Owner of the relationship. With a diagram it is passed to the factory as the diagram editor does (default the diagram's owner); most relationship factories file the relationship under the tail model regardless. Without a diagram the default is the tail's owner when that has a list for this type (messages, edges, transitions), else the tail model.",
      ),
    ),
    field: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Without a diagram: owner list to add to; default the list typed for the relationship, e.g. 'messages' of a UMLInteraction.",
      ),
    ),
    name: z.optional(text("Relationship name.")),
    properties: properties(
      `${ATTRIBUTE_VALUES_HELP} E.g. {messageSort: "asynchCall"} for a UMLMessage, {guard: "x > 0"} for a UMLControlFlow.`,
    ),
    ...endShape(),
    ...geometryShape(),
    ...projectionShape(),
  }),
  response: z.object({
    view: doc(z.nullable(elementSchema()), "Null without a diagram."),
    model: doc(
      z.nullable(elementSchema()),
      "Null for view-only edge ids such as NoteLink.",
    ),
  }),
  handle: (input) => {
    if (input.diagramId !== undefined) {
      const diagram = requireDiagram(input.diagramId);
      if (input.field !== undefined) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          "field applies without a diagram; the factory function decides where a drawn relationship goes",
        );
      }
      const view = createEdge({
        ...input,
        parent:
          input.parentId === undefined
            ? diagram._parent!
            : requireElement(input.parentId, "Parent"),
        diagram,
        tail: endView(input.tailId, diagram, "Tail"),
        head: endView(input.headId, diagram, "Head"),
      });
      return created(view, input);
    }
    const kind = isMetaClass(input.type) ? relationshipKind(input.type) : null;
    if (!kind) {
      throw new ApiError(
        "UNKNOWN_TYPE",
        `Not a relationship type: ${input.type}`,
      );
    }
    const model = createModelOnly(
      input.type,
      kind,
      input,
      endModel(input.tailId, "Tail"),
      endModel(input.headId, "Head"),
    );
    return { view: null, model: serialize(model, input) };
  },
});
