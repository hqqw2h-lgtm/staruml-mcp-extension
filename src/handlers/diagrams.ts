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
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireElement } from "../lookup.js";
import { assertUniqueName } from "../create.js";
import {
  duplicateShape,
  elementSchema,
  ref,
  projectionShape,
  text,
  typeName,
} from "../schemas.js";
import { serialize } from "../serialize.js";
import type { Element } from "../types.js";

export const createDiagram = defineEndpoint({
  path: "/create_diagram",
  description: "Create a diagram under a model element.",
  readOnly: false,
  destructive: false,
  request: z.object({
    type: typeName(
      "A diagram id of app.factory.getDiagramIds(), e.g. 'UMLClassDiagram', 'UMLSequenceDiagram', 'ERDDiagram'.",
    ),
    parent: ref("Owner, usually a UMLModel or UMLPackage."),
    name: z.optional(text("Diagram name; StarUML generates one if omitted.")),
    ...duplicateShape(),
    ...projectionShape(),
  }),
  aliases: { parentId: "parent" },
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parent, "Parent element");
    const { name } = input;
    if (app.factory.getDiagramIds().includes(input.type)) {
      assertUniqueName(parent, input.type, name, input.allowDuplicateNames);
    }
    const diagram = inStarUML(() =>
      app.factory.createDiagram({
        id: input.type,
        parent,
        ...(name !== undefined && {
          diagramInitializer: (d: Element) => {
            d.name = name;
          },
        }),
      }),
    );
    if (!diagram) {
      throw new ApiError("UNKNOWN_TYPE", `Unknown diagram type: ${input.type}`);
    }
    return serialize(diagram, input);
  },
});

const diagramRequest = () => z.object({ diagram: ref("Diagram.") });

export const switchDiagram = defineEndpoint({
  path: "/switch_diagram",
  description: "Open a diagram in the editor and make it the current one.",
  readOnly: false,
  destructive: false,
  request: diagramRequest(),
  aliases: { id: "diagram" },
  response: z.object({ _id: z.string() }),
  handle: (input) => {
    const diagram = requireDiagram(input.diagram);
    inStarUML(() => app.diagrams.setCurrentDiagram(diagram));
    return { _id: diagram._id };
  },
});

export const closeDiagram = defineEndpoint({
  path: "/close_diagram",
  description: "Close a diagram's editor tab; the diagram stays in the model.",
  readOnly: false,
  destructive: false,
  request: diagramRequest(),
  aliases: { id: "diagram" },
  response: z.object({ closed: z.string() }),
  handle: (input) => {
    const diagram = requireDiagram(input.diagram);
    inStarUML(() => app.diagrams.closeDiagram(diagram));
    return { closed: diagram._id };
  },
});
