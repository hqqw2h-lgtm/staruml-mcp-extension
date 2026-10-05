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

import { ApiError } from "./errors.js";
import { attributeOf } from "./metamodel.js";
import type { Element, MetaAttribute } from "./types.js";

/*
 * Converts attribute values from requests into model values, following the
 * attribute's metamodel kind. References are given the way responses carry
 * them, `{$ref: id}`, or for ref/refs attributes also as a bare id.
 */

const PRIM_CHECKS: Record<string, (v: unknown) => boolean> = {
  String: (v) => typeof v === "string",
  Image: (v) => typeof v === "string",
  Boolean: (v) => typeof v === "boolean",
  Integer: (v) => Number.isInteger(v),
  Real: (v) => typeof v === "number" && Number.isFinite(v),
};

export function refId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { $ref?: unknown }).$ref === "string"
  ) {
    return (value as { $ref: string }).$ref;
  }
  return null;
}

function invalid(owner: string, attr: MetaAttribute, expected: string): never {
  throw new ApiError(
    "INVALID_ARGUMENT",
    `${owner}.${attr.name} (${attr.kind} ${attr.type}) expects ${expected}`,
  );
}

/** The element `value` names, which must be a kind of the attribute's type. */
function referenced(
  owner: string,
  attr: MetaAttribute,
  value: unknown,
): Element {
  const id = refId(value);
  if (id === null) invalid(owner, attr, "an element id or {$ref: id}");
  const elem = app.repository.get(id);
  if (!elem) {
    throw new ApiError(
      "NOT_FOUND",
      `${owner}.${attr.name}: element not found: ${id}`,
    );
  }
  if (!app.metamodels.isKindOf(elem.constructor.name, attr.type)) {
    invalid(owner, attr, `a ${attr.type}, got ${elem.constructor.name} ${id}`);
  }
  return elem;
}

export function toModelValue(
  owner: string,
  attr: MetaAttribute,
  value: unknown,
): unknown {
  switch (attr.kind) {
    case "prim": {
      const check = PRIM_CHECKS[attr.type];
      if (check && !check(value)) invalid(owner, attr, `a ${attr.type}`);
      return value;
    }
    case "enum": {
      const literals = meta[attr.type]?.literals ?? [];
      if (!literals.includes(value as string))
        invalid(owner, attr, `one of ${literals.join(", ")}`);
      return value;
    }
    case "ref":
      return value === null ? null : referenced(owner, attr, value);
    case "refs":
      if (!Array.isArray(value))
        invalid(owner, attr, "an array of element ids");
      return value.map((v) => referenced(owner, attr, v));
    case "var":
      // A var holds either an element or a plain value, e.g. UMLAttribute.type
      // is a UMLClassifier or a type name such as "String".
      if (refId(value) !== null && typeof value === "object")
        return referenced(owner, attr, value);
      if (value !== null && typeof value === "object")
        invalid(owner, attr, "a string, number, boolean, null or {$ref: id}");
      return value;
    default:
      // obj/objs are owned elements, created with their own endpoints;
      // custom values (Font, Points) are view styling.
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${owner}.${attr.name} is a ${attr.kind} attribute and cannot be set here`,
      );
  }
}

/** Looks up a settable attribute of `typeName`, rejecting unknown names and the identity fields. */
export function settableAttribute(
  typeName: string,
  name: string,
): MetaAttribute {
  const attr =
    name === "_id" || name === "_parent"
      ? undefined
      : attributeOf(typeName, name);
  if (!attr) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${typeName} has no field '${name}'`,
    );
  }
  return attr;
}

/** Converts a `properties` object for an element of `typeName`. */
export function toModelValues(
  typeName: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    out[name] = toModelValue(
      typeName,
      settableAttribute(typeName, name),
      value,
    );
  }
  return out;
}
