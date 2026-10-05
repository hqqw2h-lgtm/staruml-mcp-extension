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

import { pathOf } from "./refs.js";
import type { Element, MetaAttribute } from "./types.js";

/**
 * The only element → JSON conversion in the extension. Which fields an element
 * has and how each is stored come from its metamodel attributes, the same
 * table Element.save() walks when StarUML writes a .mdj (core/core.js, 7.1.1),
 * so the output uses the .mdj conventions: `{$ref: id}` for references.
 */

export interface Ref {
  $ref: string;
}

/**
 * The default shape of an element in every response. The keys carry an
 * underscore, as in .mdj files, because `id` and `type` are attribute names in
 * the 7.1.1 metamodel (BPMNBaseElement.id, UMLStructuralFeature.type, ...).
 */
export interface ElementSummary {
  _id: string;
  /** Metamodel class name, e.g. "UMLClass". */
  _type: string;
  /** Null for elements without a name attribute, such as views. */
  name: string | null;
  /** Owner id; null for the project. */
  _parent: string | null;
  /** Path that resolves back to the element (refs.ts); absent where none does. */
  path?: string;
}

/** Summary, full or field-projected element; see `serialize`. */
export interface ElementJson {
  _id: string;
  _type: string;
  name?: string | null;
  _parent?: string | null;
  [attribute: string]: unknown;
}

export interface Projection {
  /** Default true. Ignored when `fields` is given. */
  summary?: boolean;
  /** Attribute names to return besides `_id` and `_type`; "_parent" is accepted too. */
  fields?: readonly string[];
  /** Levels of owned elements (obj/objs attributes) to expand; 0 returns them as refs. */
  depth?: number;
}

export const MAX_DEPTH = 8;

export function isElement(value: unknown): value is Element {
  return value instanceof type.Element;
}

export function ref(elem: Element): Ref {
  return { $ref: elem._id };
}

export function summarize(elem: Element): ElementSummary {
  const path = pathOf(elem);
  return {
    _id: elem._id,
    _type: elem.constructor.name,
    name: typeof elem.name === "string" ? elem.name : null,
    _parent: elem._parent ? elem._parent._id : null,
    ...(path !== null && { path }),
  };
}

/**
 * `_id` and `_parent` are metamodel attributes of Element itself, reported as
 * plain ids rather than as a `{$ref}` attribute. Transient attributes (View.selected,
 * LabelView.direction, ...) are UI state that StarUML does not save either.
 */
function reported(attr: MetaAttribute): boolean {
  return attr.name !== "_id" && attr.name !== "_parent" && !attr.transient;
}

export function serialize(
  elem: Element,
  projection: Projection = {},
): ElementJson {
  const { fields } = projection;
  if (!fields && projection.summary !== false) return { ...summarize(elem) };

  const out: ElementJson = {
    _id: elem._id,
    _type: elem.constructor.name,
  };
  const wanted = fields ? new Set(fields) : null;
  if (!wanted || wanted.has("_parent")) {
    out._parent = elem._parent ? elem._parent._id : null;
  }
  const depth = projection.depth ?? 0;
  for (const attr of app.metamodels.getMetaAttributes(out._type)) {
    if (!reported(attr) || (wanted && !wanted.has(attr.name))) continue;
    const value = elem[attr.name];
    if (value === undefined) continue;
    out[attr.name] = convert(attr, value, { ...projection, depth });
  }
  return out;
}

function convert(
  attr: MetaAttribute,
  value: unknown,
  projection: Projection & { depth: number },
): unknown {
  const owned = (child: Element): unknown =>
    projection.depth > 0
      ? serialize(child, { ...projection, depth: projection.depth - 1 })
      : ref(child);
  switch (attr.kind) {
    case "ref":
      return isElement(value) ? ref(value) : null;
    case "refs":
      return Array.isArray(value) ? value.filter(isElement).map(ref) : [];
    case "obj":
      return isElement(value) ? owned(value) : null;
    case "objs":
      return Array.isArray(value) ? value.filter(isElement).map(owned) : [];
    case "var":
      return isElement(value) ? ref(value) : value;
    case "custom":
      // Font and Points store themselves as strings through __write (core/graphics.js).
      return hasWrite(value) ? value.__write() : null;
    default:
      return value;
  }
}

function hasWrite(value: unknown): value is { __write(): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { __write?: unknown }).__write === "function"
  );
}

/**
 * For values of unknown shape, such as command results: elements are
 * projected, arrays are mapped, and anything JSON.stringify cannot represent
 * (functions, cyclic objects) becomes a marker string.
 */
export function serializeValue(
  value: unknown,
  projection: Projection = {},
): unknown {
  if (value === undefined || value === null) return null;
  if (isElement(value)) return serialize(value, projection);
  if (Array.isArray(value))
    return value.map((item) => serializeValue(item, projection));
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "[non-serializable]";
  }
}
