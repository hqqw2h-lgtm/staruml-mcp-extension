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

import { failure } from "../errors.js";
import type { Handler, HandlerResult } from "../http-server.js";
import type { Element, ModelAndViewOptions, View } from "../types.js";

export const getElementById: Handler = (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' (string) missing" };
  }
  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  return { success: true, data: shallow(elem) };
};

export const findElements: Handler = (body) => {
  const typeName = typeof body.type === "string" ? body.type : null;
  const nameFilter = typeof body.name === "string" ? body.name : null;

  try {
    const pool = typeName
      ? app.repository.getInstancesOf(typeName)
      : app.repository.findAll(() => true);
    const filtered =
      nameFilter === null ? pool : pool.filter((e) => e.name === nameFilter);
    return {
      success: true,
      data: { count: filtered.length, elements: filtered.map(shallow) },
    };
  } catch (err) {
    return failure(err);
  }
};

export const createElement: Handler = (body) => {
  const typeName = body.type;
  const parentId = body.parentId;
  const name = typeof body.name === "string" ? body.name : undefined;

  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error: "Required field 'type' (string) missing, e.g. 'UMLClass'",
    };
  }
  if (typeof parentId !== "string" || parentId.length === 0) {
    return {
      success: false,
      error: "Required field 'parentId' (string) missing",
    };
  }

  const parent = app.repository.get(parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${parentId}` };
  }

  try {
    const elem = app.factory.createModel({
      id: typeName,
      parent,
      ...(name !== undefined && {
        modelInitializer: (m: Element) => {
          m.name = name;
        },
      }),
    });
    if (!elem) {
      return { success: false, error: `Unknown model type: ${typeName}` };
    }
    return { success: true, data: shallow(elem) };
  } catch (err) {
    return failure(err);
  }
};

export const updateElement: Handler = (body) => {
  const id = body.id;
  const field = body.field;
  const value = body.value;

  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' missing" };
  }
  if (typeof field !== "string" || field.length === 0) {
    return { success: false, error: "Required field 'field' missing" };
  }

  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  // Engine.setProperty only logs and returns for a field the element lacks,
  // which would otherwise be reported to the caller as a successful update.
  if (typeof elem[field] === "undefined") {
    return {
      success: false,
      error: `${elem.constructor.name} has no field '${field}'`,
    };
  }

  try {
    app.engine.setProperty(elem, field, value);
    return { success: true, data: shallow(elem) };
  } catch (err) {
    return failure(err);
  }
};

export const deleteElement: Handler = (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' missing" };
  }
  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  try {
    const { models, views } = collectDeletionTargets(elem);
    app.engine.deleteElements(models, views);
    return {
      success: true,
      data: {
        deleted: id,
        models_deleted: models.length,
        views_deleted: views.length,
      },
    };
  } catch (err) {
    return failure(err);
  }
};

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

/**
 * Resolves the ids shared by both create-with-view handlers. createModelAndView
 * hands `diagram` to the registered factory function without checking its type
 * (engine/factory.js in 7.1.1), so that is checked here.
 */
function resolveParentAndDiagram(
  body: Record<string, unknown>,
): { parent: Element; diagram: Element } | string {
  const { parentId, diagramId } = body;
  if (typeof parentId !== "string" || parentId.length === 0) {
    return "Required field 'parentId' missing";
  }
  if (typeof diagramId !== "string" || diagramId.length === 0) {
    return "Required field 'diagramId' missing";
  }
  const parent = app.repository.get(parentId);
  if (!parent) return `Parent not found: ${parentId}`;
  const diagram = app.repository.get(diagramId);
  if (!diagram || !(diagram instanceof type.Diagram)) {
    return `Diagram not found: ${diagramId}`;
  }
  return { parent, diagram };
}

/**
 * createModelAndView takes one options object and returns the view, whose
 * `model` is the new model element; it returns null for an id that has no
 * model-and-view factory function (engine/factory.js in 7.1.1, docs:
 * developing-extensions/creating-deleting-and-modifying-elements).
 */
function createModelAndView(options: ModelAndViewOptions): HandlerResult {
  const view = app.factory.createModelAndView(options);
  if (!view) {
    return {
      success: false,
      error: `Unknown model-and-view type: ${options.id}`,
    };
  }
  const model = view.model as Element;
  return {
    success: true,
    data: {
      view: { _id: view._id },
      model: { _id: model._id, name: model.name },
    },
  };
}

function nameInitializer(
  name: unknown,
): Pick<ModelAndViewOptions, "modelInitializer"> {
  if (typeof name !== "string") return {};
  return {
    modelInitializer: (m: Element) => {
      m.name = name;
    },
  };
}

/** Creates a model element and its view on a diagram, e.g. a UMLClass and its UMLClassView. */
export const createElementWithView: Handler = (body) => {
  const typeName = body.type;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error:
        "Required field 'type' missing (e.g. 'UMLUseCase', 'UMLActor', 'UMLAction')",
    };
  }
  const resolved = resolveParentAndDiagram(body);
  if (typeof resolved === "string") return { success: false, error: resolved };

  // x1/y1/x2/y2 are the view's bounding box in diagram coordinates.
  const x1 = typeof body.x === "number" ? body.x : 100;
  const y1 = typeof body.y === "number" ? body.y : 100;
  const x2 = typeof body.x2 === "number" ? body.x2 : x1 + 100;
  const y2 = typeof body.y2 === "number" ? body.y2 : y1 + 50;

  try {
    return createModelAndView({
      id: typeName,
      ...resolved,
      x1,
      y1,
      x2,
      y2,
      ...nameInitializer(body.name),
    });
  } catch (err) {
    return failure(err);
  }
};

/**
 * Creates a relationship (UMLAssociation, UMLControlFlow, ...) between the models
 * of two existing views and the edge view connecting them.
 */
export const createEdgeWithView: Handler = (body) => {
  const { type: typeName, tailViewId, headViewId } = body;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error:
        "Required field 'type' missing (e.g. 'UMLAssociation', 'UMLControlFlow')",
    };
  }
  const resolved = resolveParentAndDiagram(body);
  if (typeof resolved === "string") return { success: false, error: resolved };
  if (typeof tailViewId !== "string" || typeof headViewId !== "string") {
    return {
      success: false,
      error: "Required fields 'tailViewId' and 'headViewId' missing",
    };
  }
  const tailView = app.repository.get(tailViewId);
  if (!tailView || !(tailView instanceof type.View)) {
    return { success: false, error: `Tail view not found: ${tailViewId}` };
  }
  const headView = app.repository.get(headViewId);
  if (!headView || !(headView instanceof type.View)) {
    return { success: false, error: `Head view not found: ${headViewId}` };
  }

  try {
    return createModelAndView({
      id: typeName,
      ...resolved,
      tailView: tailView as View,
      headView: headView as View,
      tailModel: (tailView as View).model,
      headModel: (headView as View).model,
      ...nameInitializer(body.name),
    });
  } catch (err) {
    return failure(err);
  }
};

function shallow(elem: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(elem)) {
    if (key.startsWith("_") && key !== "_id" && key !== "_parent") continue;
    if (val === null || val === undefined) {
      out[key] = val;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === "object" && "_id" in item
          ? {
              _id: (item as { _id: string })._id,
              name: (item as { name?: string }).name,
            }
          : item,
      );
    } else if (typeof val === "object" && "_id" in val) {
      out[key] = {
        _id: (val as { _id: string })._id,
        name: (val as { name?: string }).name,
      };
    } else {
      out[key] = val;
    }
  }
  return out;
}
