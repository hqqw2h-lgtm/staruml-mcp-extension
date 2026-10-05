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
import { doc } from "./endpoint.js";
import { MAX_DEPTH } from "./serialize.js";

/*
 * Schema fragments shared by endpoints. Each is a factory because a
 * description is attached to the schema instance, and the same fragment is
 * described differently where it is used.
 */

export function id(description: string) {
  return doc(z.string().check(z.minLength(1)), description);
}

/**
 * An element, view or diagram reference: an id or a path such as
 * 'Model/Shop/Order', 'Order.total', 'Order#pay()', a diagram name or
 * '@current' (refs.ts).
 */
export function ref(description: string) {
  return doc(z.string().check(z.minLength(1)), `${description} Id or path.`);
}

export function typeName(description: string) {
  return doc(z.string().check(z.minLength(1)), description);
}

export function text(description: string) {
  return doc(z.string(), description);
}

export function coordinate(description: string) {
  return z.optional(doc(z.number(), description));
}

/** The duplicate-name policy's opt-out, on endpoints that create named elements. */
export function duplicateShape() {
  return {
    allowDuplicateNames: z.optional(
      doc(
        z.boolean(),
        "Default false: a classifier, package, diagram, attribute, literal, entity or column named like a sibling of its kind is refused with DUPLICATE_NAME, since paths could not tell them apart.",
      ),
    ),
  };
}

/** Request properties every endpoint that returns elements accepts. */
export function projectionShape() {
  return {
    summary: z.optional(
      doc(
        z.boolean(),
        "Default true: each element is {_id, _type, name, _parent}. False returns every saved attribute. Ignored when 'fields' is given.",
      ),
    ),
    fields: z.optional(
      doc(
        z.array(z.string().check(z.minLength(1))),
        "Attribute names to return besides _id and _type, e.g. ['name', 'attributes']; '_parent' is accepted. Names an element lacks are omitted.",
      ),
    ),
    depth: z.optional(
      doc(
        z.int().check(z.minimum(0), z.maximum(MAX_DEPTH)),
        "Levels of owned elements (ownedElements, attributes, ownedViews, ...) to expand with the same projection. Default 0: owned elements are {$ref: id}.",
      ),
    ),
  };
}

/**
 * An element as returned by the serializer: always _id and _type; the summary
 * adds name and _parent; a full or field-projected element adds attributes.
 */
export function elementSchema() {
  return doc(
    z.looseObject({
      _id: z.string(),
      _type: doc(z.string(), "Metamodel class name."),
      name: z.optional(z.nullable(z.string())),
      _parent: z.optional(
        doc(z.nullable(z.string()), "Owner id; null for the project."),
      ),
      path: z.optional(
        doc(
          z.string(),
          "Summary only: a path any id field accepts, e.g. 'Model/Shop/Order', 'Model/Shop/Order.total', 'Model/Shop/Order#pay()', and 'model path@diagram path' for a view. Absent for the project and for views without a model.",
        ),
      ),
    }),
    "Element projection. Reference attributes are {$ref: id}; owned elements are {$ref: id} or, with depth > 0, nested elements.",
  );
}

export function properties(description: string) {
  return z.optional(doc(z.record(z.string(), z.unknown()), description));
}

/** A reference as responses carry it, or a bare id. */
export function reference(description: string) {
  return doc(
    z.union([
      z.string().check(z.minLength(1)),
      z.object({ $ref: z.string().check(z.minLength(1)) }),
    ]),
    description,
  );
}

/** A var attribute value: a plain type name such as "String", or a reference to a classifier. */
export function typeValue(description: string) {
  return doc(
    z.union([z.string(), z.object({ $ref: z.string().check(z.minLength(1)) })]),
    description,
  );
}

export const ATTRIBUTE_VALUES_HELP =
  "Initial attribute values by name, as /introspect lists them: plain values for prim/enum attributes, an id or {$ref: id} for references, arrays of those for reference lists.";
