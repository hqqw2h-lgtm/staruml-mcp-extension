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
import { ApiError, inStarUML } from "../errors.js";
import {
  requireDiagram,
  requireElement,
  requireTypeName,
  requireView,
} from "../lookup.js";
import {
  coordinate,
  elementSchema,
  id,
  projectionShape,
  text,
  typeName,
} from "../schemas.js";
import { serialize, type ElementJson, type Projection } from "../serialize.js";
import type { Element, ModelAndViewOptions, View } from "../types.js";

export const getElementById = defineEndpoint({
  path: "/get_element_by_id",
  description: "Read one element by id.",
  readOnly: true,
  destructive: false,
  request: z.object({ id: id("Element id."), ...projectionShape() }),
  response: elementSchema(),
  handle: (input) => serialize(requireElement(input.id), input),
});

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;

/**
 * Pages are cut from the matches sorted by id, and the cursor is the last id
 * returned, so paging stays consistent while elements are added or deleted
 * between calls (an offset would skip or repeat elements).
 */
export const findElements = defineEndpoint({
  path: "/find_elements",
  description:
    "Find elements by metamodel type (including subtypes) and/or exact name, a page at a time.",
  readOnly: true,
  destructive: false,
  request: z.object({
    type: z.optional(
      typeName("Metamodel class, e.g. 'UMLClass'; subtypes match too."),
    ),
    name: z.optional(text("Exact element name.")),
    limit: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(MAX_PAGE_SIZE)),
        `Page size, default ${DEFAULT_PAGE_SIZE}.`,
      ),
    ),
    cursor: z.optional(
      doc(z.string().check(z.minLength(1)), "nextCursor of the previous page."),
    ),
    ...projectionShape(),
  }),
  response: z.object({
    count: doc(z.int(), "Matches across all pages."),
    elements: z.array(elementSchema()),
    nextCursor: doc(
      z.nullable(z.string()),
      "Pass as 'cursor' for the next page; null on the last page.",
    ),
  }),
  handle: (input) => {
    const { name, cursor } = input;
    let pool: Element[];
    if (input.type !== undefined) {
      requireTypeName(input.type);
      pool = app.repository.getInstancesOf(input.type);
    } else {
      pool = app.repository.findAll(() => true);
    }
    const matches = (
      name === undefined ? pool : pool.filter((e) => e.name === name)
    ).sort((a, b) => compare(a._id, b._id));
    const rest =
      cursor === undefined
        ? matches
        : matches.filter((e) => compare(e._id, cursor) > 0);
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    const page = rest.slice(0, limit);
    return {
      count: matches.length,
      elements: page.map((e) => serialize(e, input)),
      nextCursor: rest.length > limit ? page[limit - 1]!._id : null,
    };
  },
});

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Applies a name given in a create request; factories otherwise generate one. */
function nameInitializer(
  name: string | undefined,
): Pick<ModelAndViewOptions, "modelInitializer"> {
  if (name === undefined) return {};
  return {
    modelInitializer: (m: Element) => {
      m.name = name;
    },
  };
}

export const createElement = defineEndpoint({
  path: "/create_element",
  description:
    "Create a model element (no view) under a parent, e.g. a UMLClass in a UMLModel.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName("A model id of app.factory.getModelIds(), e.g. 'UMLClass'."),
    parentId: id("Owner element id."),
    name: z.optional(text("Element name; StarUML generates one if omitted.")),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent element");
    const elem = inStarUML(() =>
      app.factory.createModel({
        id: input.type,
        parent,
        ...nameInitializer(input.name),
      }),
    );
    if (!elem) {
      throw new ApiError("UNKNOWN_TYPE", `Unknown model type: ${input.type}`);
    }
    return serialize(elem, input);
  },
});

export const updateElement = defineEndpoint({
  path: "/update_element",
  description: "Set one attribute of an element.",
  readOnly: false,
  destructive: true,
  request: z.object({
    id: id("Element id."),
    field: doc(z.string().check(z.minLength(1)), "Attribute name."),
    value: doc(z.unknown(), "New value."),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.id);
    // Engine.setProperty only logs and returns for a field the element lacks,
    // which would otherwise be reported to the caller as a successful update.
    if (typeof elem[input.field] === "undefined") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${elem.constructor.name} has no field '${input.field}'`,
      );
    }
    inStarUML(() => app.engine.setProperty(elem, input.field, input.value));
    return serialize(elem, input);
  },
});

export const deleteElement = defineEndpoint({
  path: "/delete_element",
  description:
    "Delete an element with everything it owns, the views showing them, and edges attached to those views.",
  readOnly: false,
  destructive: true,
  request: z.object({ id: id("Element id.") }),
  response: z.object({
    deleted: z.string(),
    models_deleted: z.int(),
    views_deleted: z.int(),
  }),
  handle: (input) => {
    const elem = requireElement(input.id);
    const { models, views } = collectDeletionTargets(elem);
    inStarUML(() => app.engine.deleteElements(models, views));
    return {
      deleted: input.id,
      models_deleted: models.length,
      views_deleted: views.length,
    };
  },
});

/**
 * The element, everything it owns, and the views that depict any of them, split
 * the way Engine.deleteElements(models, views) takes them. getRefsTo is avoided
 * because it follows references up to the Project and would delete everything.
 */
function collectDeletionTargets(root: Element): {
  models: Element[];
  views: Element[];
} {
  const seen = new Set<string>();
  const models: Element[] = [];
  const views: Element[] = [];
  const stack: Element[] = [root];

  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    if (seen.has(e._id)) continue;
    seen.add(e._id);

    if (e instanceof type.View) {
      views.push(e);
      stack.push(...app.repository.getEdgeViewsOf(e));
    } else {
      models.push(e);
      stack.push(...app.repository.getViewsOf(e));
    }
    for (const field of ["ownedElements", "ownedViews", "subViews"]) {
      const owned = e[field];
      if (Array.isArray(owned)) stack.push(...(owned as Element[]));
    }
  }
  return { models, views };
}

const createdSchema = () =>
  z.object({ view: elementSchema(), model: elementSchema() });

/**
 * createModelAndView takes one options object and returns the view, whose
 * `model` is the new model element; it returns null for an id that has no
 * model-and-view factory function (engine/factory.js in 7.1.1, docs:
 * developing-extensions/creating-deleting-and-modifying-elements).
 */
function createModelAndView(
  options: ModelAndViewOptions,
  projection: Projection,
): { view: ElementJson; model: ElementJson } {
  const view = inStarUML(() => app.factory.createModelAndView(options));
  if (!view) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `Unknown model-and-view type: ${options.id}`,
    );
  }
  return {
    view: serialize(view, projection),
    model: serialize(view.model as Element, projection),
  };
}

const placementShape = () => ({
  parentId: id("Owner of the new model element."),
  diagramId: id("Diagram to place the view on."),
});

export const createElementWithView = defineEndpoint({
  path: "/create_element_with_view",
  description:
    "Create a model element and its view on a diagram, e.g. a UMLClass shown on a UMLClassDiagram.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A model-and-view id of app.factory.getModelAndViewIds(), e.g. 'UMLClass', 'UMLUseCase'.",
    ),
    ...placementShape(),
    name: z.optional(text("Element name; StarUML generates one if omitted.")),
    x: coordinate("Left edge in diagram coordinates, default 100."),
    y: coordinate("Top edge, default 100."),
    x2: coordinate("Right edge, default x + 100."),
    y2: coordinate("Bottom edge, default y + 50."),
    ...projectionShape(),
  }),
  response: createdSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent");
    const diagram = requireDiagram(input.diagramId);
    const x1 = input.x ?? 100;
    const y1 = input.y ?? 100;
    return createModelAndView(
      {
        id: input.type,
        parent,
        diagram,
        x1,
        y1,
        x2: input.x2 ?? x1 + 100,
        y2: input.y2 ?? y1 + 50,
        ...nameInitializer(input.name),
      },
      input,
    );
  },
});

export const createEdgeWithView = defineEndpoint({
  path: "/create_edge_with_view",
  description:
    "Create a relationship (UMLAssociation, UMLControlFlow, ...) between the models of two views, and the edge view connecting them.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A relationship id of app.factory.getModelAndViewIds(), e.g. 'UMLAssociation'.",
    ),
    ...placementShape(),
    tailViewId: id("View at the source end."),
    headViewId: id("View at the target end."),
    name: z.optional(text("Relationship name.")),
    ...projectionShape(),
  }),
  response: createdSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent");
    const diagram = requireDiagram(input.diagramId);
    const tailView: View = requireView(input.tailViewId, "Tail view");
    const headView: View = requireView(input.headViewId, "Head view");
    return createModelAndView(
      {
        id: input.type,
        parent,
        diagram,
        tailView,
        headView,
        tailModel: tailView.model,
        headModel: headView.model,
        ...nameInitializer(input.name),
      },
      input,
    );
  },
});
