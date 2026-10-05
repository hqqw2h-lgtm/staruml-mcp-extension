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

import { ApiError, inStarUML } from "./errors.js";
import { requireElement } from "./lookup.js";
import { isMetaClass, resolveOwnerField } from "./metamodel.js";
import type { Element, ModelAndViewOptions, View } from "./types.js";
import { toModelValues } from "./values.js";

/*
 * Element creation shared by the element, feature and relationship
 * endpoints. Attribute values are converted before StarUML is called and
 * assigned in the model initializer, so a creation with its initial values is
 * one operation and one undo step (Factory.defaultModelFn applies the
 * initializer before Engine.addModel, engine/factory.js in 7.1.1).
 */

/** Values to assign on creation; `name` joins the other attributes. */
export function initialValues(
  typeName: string,
  name: string | undefined,
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return toModelValues(typeName, {
    ...properties,
    ...(name !== undefined && { name }),
  });
}

/**
 * A registered model id with a metamodel class to instantiate. 7.1.1
 * registers SysMLOperation with the factory but defines no such class, and
 * Factory.defaultModelFn would fail on `new type[id]()`.
 */
export function requireModelId(id: string): void {
  if (!app.factory.getModelIds().includes(id)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown model type: ${id}`);
  }
  if (!isMetaClass(id)) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `${id} is registered with the factory but has no metamodel class, so StarUML cannot create it`,
    );
  }
}

/**
 * Creates a `typeName` model in `owner[field]`, `field` defaulting to the
 * owner list that fits the type (see ownerField).
 */
export function createOwned(
  owner: Element,
  typeName: string,
  field: string | undefined,
  values: Record<string, unknown>,
  initialize: (model: Element) => void = () => {},
): Element {
  requireModelId(typeName);
  const into = resolveOwnerField(owner, typeName, field);
  const elem = inStarUML(() =>
    app.factory.createModel({
      id: typeName,
      parent: owner,
      field: into,
      modelInitializer: (m: Element) => {
        Object.assign(m, values);
        initialize(m);
      },
    }),
  );
  if (!elem) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not create ${typeName} in ${owner.constructor.name}.${into}`,
    );
  }
  return elem;
}

/**
 * A detached instance, for owned parts built inside an initializer (such as
 * an operation's parameters) and for relationships without a view, which no
 * factory function creates. StarUML's own factory functions construct
 * elements the same way, e.g. lifelineFn's role attribute (uml-factory.js).
 */
export function instantiate(typeName: string): Element {
  if (!isMetaClass(typeName) || !Object.hasOwn(type, typeName)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown element type: ${typeName}`);
  }
  const Ctor = type[typeName] as unknown as new () => Element;
  return new Ctor();
}

/** The diagram a view belongs to; sub-views are owned by their parent view. */
export function diagramOf(view: Element): Element | null {
  let e: Element | null | undefined = view;
  while (e && !(e instanceof type.Diagram)) e = e._parent;
  return e ?? null;
}

/**
 * A view for one end of an edge: the id itself when it is a view on
 * `diagram`, or the first view on `diagram` of the model it names.
 */
export function endView(id: string, diagram: Element, role: string): View {
  const elem = requireElement(id, role);
  if (elem instanceof type.View) {
    if (diagramOf(elem) !== diagram) {
      throw new ApiError(
        "NOT_FOUND",
        `${role} ${id} is not on diagram ${diagram._id}`,
      );
    }
    return elem as View;
  }
  const view = app.repository
    .getViewsOf(elem)
    .find((v) => diagramOf(v) === diagram);
  if (!view) {
    throw new ApiError(
      "NOT_FOUND",
      `${role}: no view of ${id} on diagram ${diagram._id}`,
    );
  }
  return view;
}

/** Centre of a node view; edges default to running between the centres of their ends. */
export function center(view: View): { x: number; y: number } | null {
  const { left, top, width, height } = view as unknown as Record<
    string,
    unknown
  >;
  if (
    typeof left !== "number" ||
    typeof top !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }
  return { x: left + width / 2, y: top + height / 2 };
}

/**
 * createModelAndView, reporting the null it returns for an unregistered id.
 * The editor is passed as the diagram UI does, because some factory
 * functions measure against its canvas.
 */
export function createModelAndView(
  options: Omit<ModelAndViewOptions, "editor">,
): View {
  if (!app.factory.getModelAndViewIds().includes(options.id)) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `Unknown model-and-view type: ${options.id}`,
    );
  }
  const view = inStarUML(() =>
    app.factory.createModelAndView({
      ...options,
      editor: app.diagrams.getEditor(),
    }),
  );
  if (!view) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not create ${options.id} on diagram ${options.diagram._id}`,
    );
  }
  return view;
}
