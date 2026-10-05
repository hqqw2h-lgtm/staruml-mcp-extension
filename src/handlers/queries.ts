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
import { defineEndpoint } from "../endpoint.js";
import { inStarUML } from "../errors.js";
import { requireElement, requireTypeName, requireView } from "../lookup.js";
import { elementSchema, id, projectionShape, typeName } from "../schemas.js";
import { serialize, type Projection } from "../serialize.js";
import type { Element } from "../types.js";

/*
 * Reverse lookups over core/repository.js's reference index. Unlike
 * /find_elements they are not paged: their results are bounded by one
 * element's connections, not by the size of the model.
 */

const listResult = () =>
  z.object({ count: z.int(), elements: z.array(elementSchema()) });

function listOf(elements: readonly Element[], projection: Projection) {
  return {
    count: elements.length,
    elements: elements.map((e) => serialize(e, projection)),
  };
}

export const getViewsOf = defineEndpoint({
  path: "/get_views_of",
  description:
    "Every view of a model element, on any diagram; empty for a model that is in no diagram.",
  readOnly: true,
  destructive: false,
  request: z.object({ id: id("Model element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) =>
    listOf(app.repository.getViewsOf(requireElement(input.id)), input),
});

export const getEdgeViewsOf = defineEndpoint({
  path: "/get_edge_views_of",
  description: "Edge views attached to a view at either end.",
  readOnly: true,
  destructive: false,
  request: z.object({ id: id("View id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) =>
    listOf(app.repository.getEdgeViewsOf(requireView(input.id)), input),
});

export const getRelationshipsOf = defineEndpoint({
  path: "/get_relationships_of",
  description:
    "Relationships (generalizations, associations, dependencies, ...) that have the element at an end.",
  readOnly: true,
  destructive: false,
  request: z.object({ id: id("Model element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) =>
    listOf(app.repository.getRelationshipsOf(requireElement(input.id)), input),
});

export const getRefsTo = defineEndpoint({
  path: "/get_refs_to",
  description:
    "Every element holding a reference to the element: typed attributes, relationship ends, views showing it. Check before deleting.",
  readOnly: true,
  destructive: false,
  request: z.object({ id: id("Element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) =>
    listOf(app.repository.getRefsTo(requireElement(input.id)), input),
});

export const getConnectedNodeViews = defineEndpoint({
  path: "/get_connected_node_views",
  description:
    "Node views at the other end of a view's edges, optionally only edges of one view type.",
  readOnly: true,
  destructive: false,
  request: z.object({
    id: id("View id."),
    edgeType: z.optional(
      typeName(
        "Edge view type to follow, e.g. 'UMLAssociationView'; default every EdgeView.",
      ),
    ),
    ...projectionShape(),
  }),
  response: listResult(),
  handle: (input) => {
    const view = requireView(input.id);
    const edgeType = input.edgeType ?? "EdgeView";
    requireTypeName(edgeType);
    const nodes = inStarUML(() =>
      app.repository.getConnectedNodeViews(view, type[edgeType]!),
    );
    return listOf(nodes, input);
  },
});
