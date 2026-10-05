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

export function typeName(description: string) {
  return doc(z.string().check(z.minLength(1)), description);
}

export function text(description: string) {
  return doc(z.string(), description);
}

export function coordinate(description: string) {
  return z.optional(doc(z.number(), description));
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
    }),
    "Element projection. Reference attributes are {$ref: id}; owned elements are {$ref: id} or, with depth > 0, nested elements.",
  );
}
