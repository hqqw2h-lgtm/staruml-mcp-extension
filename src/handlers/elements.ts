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
import {
  assertUniqueName,
  createModelAndView,
  createOwned,
  initialValues,
  requireModelId,
} from "../create.js";
import { ApiError, inStarUML } from "../errors.js";
import {
  requireDiagram,
  requireElement,
  requireTypeName,
  requireView,
} from "../lookup.js";
import { isMetaClass } from "../metamodel.js";
import { byId, tryResolve } from "../refs.js";
import { resolveCreateType } from "../toolbox.js";
import {
  ATTRIBUTE_VALUES_HELP,
  coordinate,
  duplicateShape,
  elementSchema,
  projectionShape,
  properties,
  ref,
  text,
  typeName,
} from "../schemas.js";
import { serialize, type Projection } from "../serialize.js";
import type { Element, MetaAttribute, View } from "../types.js";
import { refId, settableAttribute, toModelValue } from "../values.js";

export const getElementById = defineEndpoint({
  path: "/get_element_by_id",
  description:
    "Read one element by id or path ('Model/Shop/Order', 'Order.total', 'Order#pay()', a diagram name, '@current').",
  readOnly: true,
  destructive: false,
  request: z.object({ ref: ref("Element."), ...projectionShape() }),
  aliases: { id: "ref" },
  response: elementSchema(),
  handle: (input) => serialize(requireElement(input.ref), input),
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

export const createElement = defineEndpoint({
  path: "/create_element",
  description:
    "Create a model element (no view) under an owner, e.g. a UMLClass in a UMLModel or an ERDColumn in an ERDEntity.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A model id of /introspect factory.modelIds, e.g. 'UMLClass'.",
    ),
    parent: ref("Owner element."),
    name: z.optional(text("Element name; StarUML generates one if omitted.")),
    field: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Owner list to add to; default the owner's list typed most specifically for the element, e.g. 'attributes' for a UMLAttribute in a class, else 'ownedElements'.",
      ),
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...duplicateShape(),
    ...projectionShape(),
  }),
  aliases: { parentId: "parent" },
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parent, "Parent element");
    requireModelId(input.type);
    assertUniqueName(parent, input.type, input.name, input.allowDuplicateNames);
    const values = initialValues(input.type, input.name, input.properties);
    return serialize(
      createOwned(parent, input.type, input.field, values),
      input,
    );
  },
});

const UPDATE_OPS = ["set", "add", "remove", "reorder", "relocate"] as const;

export const updateElement = defineEndpoint({
  path: "/update_element",
  description:
    "Change an element: set an attribute (references by id), add to or remove from a reference list, move an item within a list, or relocate the element to another owner. Each call is one undo step.",
  readOnly: false,
  destructive: true,
  request: z.object({
    ref: ref("Element."),
    op: z.optional(
      doc(
        z.enum(UPDATE_OPS),
        "set (default): field = value. add/remove: value is one or more element ids for the reference list `field`. reorder: move the item `value` of list `field` to `index`. relocate: move the element to owner `parent`, keeping its list field.",
      ),
    ),
    field: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Attribute name; required except for relocate.",
      ),
    ),
    value: z.optional(
      doc(
        z.unknown(),
        "set: the new value; an id or {$ref: id} for references, null to clear. add/remove: an id, {$ref: id} or an array of them. reorder: the item to move.",
      ),
    ),
    index: z.optional(
      doc(
        z.int().check(z.minimum(0)),
        "reorder: target position, counted after the item is taken out.",
      ),
    ),
    parent: z.optional(ref("relocate: the new owner.")),
    ...projectionShape(),
  }),
  aliases: { id: "ref", parentId: "parent" },
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.ref);
    const op = input.op ?? "set";
    if (op === "relocate") {
      if (input.parent === undefined) {
        throw new ApiError("INVALID_ARGUMENT", "relocate needs parent");
      }
      relocate(elem, requireElement(input.parent, "Parent"), input.field);
      return serialize(elem, input);
    }
    if (input.field === undefined) {
      throw new ApiError("INVALID_ARGUMENT", `${op} needs field`);
    }
    if (input.value === undefined) {
      throw new ApiError("INVALID_ARGUMENT", `${op} needs value`);
    }
    const typeName = elem.constructor.name;
    const attr = settableAttribute(typeName, input.field);
    if (op === "set") {
      const value = toModelValue(typeName, attr, input.value);
      inStarUML(() => app.engine.setProperty(elem, attr.name, value));
    } else if (op === "reorder") {
      reorder(elem, attr, input.value, input.index);
    } else {
      changeReferences(elem, attr, op, input.value);
    }
    return serialize(elem, input);
  },
});

/** Engine.addItem/removeItem, one call per element; existing items are not added twice. */
function changeReferences(
  elem: Element,
  attr: MetaAttribute,
  op: "add" | "remove",
  value: unknown,
): void {
  const typeName = elem.constructor.name;
  if (attr.kind !== "refs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${op} needs a reference list; ${typeName}.${attr.name} is ${attr.kind}. Owned elements are created with /create_element and moved with op 'relocate'.`,
    );
  }
  const items = toModelValue(
    typeName,
    attr,
    Array.isArray(value) ? value : [value],
  ) as Element[];
  const list = elem[attr.name] as Element[];
  for (const item of items) {
    if (op === "add" && !list.includes(item)) {
      inStarUML(() => app.engine.addItem(elem, attr.name, item));
    } else if (op === "remove" && list.includes(item)) {
      inStarUML(() => app.engine.removeItem(elem, attr.name, item));
    }
  }
}

/**
 * Moves one item of a list to an index as a single operation. Engine.moveUp
 * and moveDown only step by one and skip by type ordering, so the operation
 * is built the way they build theirs (engine/engine.js in 7.1.1).
 */
function reorder(
  elem: Element,
  attr: MetaAttribute,
  value: unknown,
  index: number | undefined,
): void {
  const typeName = elem.constructor.name;
  if (attr.kind !== "refs" && attr.kind !== "objs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `reorder needs a list; ${typeName}.${attr.name} is ${attr.kind}`,
    );
  }
  if (index === undefined) {
    throw new ApiError("INVALID_ARGUMENT", "reorder needs index");
  }
  const list = elem[attr.name] as Element[];
  const itemRef = refId(value);
  const itemId =
    itemRef === null || byId(itemRef)
      ? itemRef
      : (tryResolve(itemRef)?._id ?? itemRef);
  const item = list.find((e) => e._id === itemId);
  if (!item) {
    throw new ApiError(
      "NOT_FOUND",
      `${String(itemId)} is not in ${typeName}.${attr.name}`,
    );
  }
  if (index >= list.length) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `index ${index} is past the end of ${typeName}.${attr.name} (${list.length} items)`,
    );
  }
  const builder = app.repository.getOperationBuilder();
  builder.begin("reorder");
  builder.fieldReorder(elem, attr.name, item, index);
  builder.end();
  inStarUML(() => app.repository.doOperation(builder.getOperation()));
}

/** The list field of the element's owner that holds it, if any. */
function containingField(elem: Element): string | null {
  const owner = elem._parent;
  if (!owner) return null;
  for (const attr of app.metamodels.getMetaAttributes(owner.constructor.name)) {
    const value = owner[attr.name];
    if (Array.isArray(value) && value.includes(elem)) return attr.name;
  }
  return null;
}

/**
 * Engine.relocate keeps the field name and silently does nothing when the
 * element is not in that field of its owner or the new owner lacks it, so
 * both are checked first and the result is verified.
 */
function relocate(
  elem: Element,
  newOwner: Element,
  field: string | undefined,
): void {
  const current = containingField(elem);
  if (!current) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${elem.constructor.name} ${elem._id} is not in a list of its owner and cannot be relocated`,
    );
  }
  if (field !== undefined && field !== current) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `relocate keeps the list field: ${elem._id} is in '${current}', not '${field}'`,
    );
  }
  if (!Array.isArray(newOwner[current])) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${newOwner.constructor.name} has no list field '${current}'`,
    );
  }
  for (let e: Element | null | undefined = newOwner; e; e = e._parent) {
    if (e === elem) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${newOwner._id} is ${elem._id} itself or inside it`,
      );
    }
  }
  if (elem._parent === newOwner) return;
  inStarUML(() => app.engine.relocate(elem, newOwner, current));
  if (elem._parent !== newOwner) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not relocate ${elem._id} to ${newOwner._id}`,
    );
  }
}

export const deleteElement = defineEndpoint({
  path: "/delete_element",
  description:
    "Delete an element with everything it owns, the views showing them, and edges attached to those views.",
  readOnly: false,
  destructive: true,
  request: z.object({ ref: ref("Element.") }),
  aliases: { id: "ref" },
  response: z.object({
    deleted: doc(z.string(), "Id of the element deleted."),
    models_deleted: z.int(),
    views_deleted: z.int(),
  }),
  handle: (input) => {
    const elem = requireElement(input.ref);
    const { models, views } = collectDeletionTargets(elem);
    inStarUML(() => app.engine.deleteElements(models, views));
    return {
      deleted: elem._id,
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

export const createdSchema = () =>
  z.object({
    view: elementSchema(),
    model: doc(
      z.nullable(elementSchema()),
      "Null for view-only ids such as Note or NoteLink.",
    ),
  });

export function created(view: View, projection: Projection) {
  return {
    view: serialize(view, projection),
    model: view.model ? serialize(view.model, projection) : null,
  };
}

export const createElementWithView = defineEndpoint({
  path: "/create_element_with_view",
  description:
    "Create a model element and its view on a diagram, e.g. a UMLClass shown on a UMLClassDiagram. Pass container for elements placed on or inside another view: ports and parts on a class, pins on an action, tasks in a BPMN lane, lifelines in a timing frame.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A model-and-view id of /introspect factory.modelAndViewIds, e.g. 'UMLClass', 'ERDEntity', or a toolbox item id, which applies the item's presets, e.g. 'UMLInitialState', 'UMLCompositeState', 'C4ContainerDatabase'.",
    ),
    diagram: ref("Diagram to place the view on."),
    parent: z.optional(
      ref(
        "Owner of the new model element; default the diagram's owner, as the diagram editor does. Items placed on a host view (toolbox option parasitic, e.g. ports and pins) are filed under the host's model by StarUML regardless.",
      ),
    ),
    container: z.optional(
      ref(
        "View that hosts or contains the new view; a model stands for its view on the diagram.",
      ),
    ),
    name: z.optional(text("Element name; StarUML generates one if omitted.")),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    x: coordinate("Left edge in diagram coordinates, default 100."),
    y: coordinate("Top edge, default 100."),
    x2: coordinate("Right edge, default x + 100."),
    y2: coordinate("Bottom edge, default y + 50."),
    ...duplicateShape(),
    ...projectionShape(),
  }),
  aliases: {
    diagramId: "diagram",
    parentId: "parent",
    containerViewId: "container",
  },
  response: createdSchema(),
  handle: (input) => {
    const diagram = requireDiagram(input.diagram);
    const container =
      input.container === undefined
        ? undefined
        : requireView(input.container, "Container view", diagram);
    const parent =
      input.parent === undefined
        ? diagram._parent!
        : requireElement(input.parent, "Parent");
    const { id: createId, preset } = resolveCreateType(input.type);
    const values = valuesFor(createId, input.name, input.properties);
    const modelType = modelTypeOf(createId);
    // A view hosted by another (a port, a pin) is filed under the host's
    // model by StarUML, so its siblings are not the parent's.
    if (modelType && !container) {
      assertUniqueName(
        parent,
        modelType,
        input.name,
        input.allowDuplicateNames,
      );
    }
    const x1 = input.x ?? 100;
    const y1 = input.y ?? 100;
    const view = createModelAndView({
      ...preset,
      id: createId,
      parent,
      diagram,
      x1,
      y1,
      x2: input.x2 ?? x1 + 100,
      y2: input.y2 ?? y1 + 50,
      // The toolbox's "parasitic" and "container-views" options make the
      // view under the cursor the head view and container (engine/factory.js).
      ...(container && {
        containerView: container,
        headView: container,
        headModel: container.model,
        tailView: container,
        tailModel: container.model,
      }),
      modelInitializer: (m: Element) => {
        Object.assign(m, values);
      },
    });
    return created(view, input);
  },
});

/** Initial values for the model a model-and-view id creates; view-only ids take none. */
export function valuesFor(
  id: string,
  name: string | undefined,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const modelType = modelTypeOf(id);
  if (modelType) return initialValues(modelType, name, props);
  if (name !== undefined || props !== undefined) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${id} creates only a view; name and properties do not apply`,
    );
  }
  return {};
}

/** The model class a model-and-view id creates, or null for view-only ids. */
export function modelTypeOf(id: string): string | null {
  const candidate = app.factory.modelAndViewOptions[id]?.modelType ?? id;
  return isMetaClass(candidate) ? candidate : null;
}
