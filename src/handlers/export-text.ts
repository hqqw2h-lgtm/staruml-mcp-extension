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
import { KINDS } from "../build/spec.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireDiagram } from "../lookup.js";
import { id } from "../schemas.js";
import { summarize } from "../serialize.js";
import { toMermaid } from "../text/mermaid-writer.js";
import { extract, kindOf } from "../text/model.js";
import { toPlantUml } from "../text/plantuml-writer.js";

export const exportText = defineEndpoint({
  path: "/export_text",
  description:
    "Write a diagram as Mermaid or PlantUML text: class, sequence, use case, activity, state machine, ERD, flowchart and mind map diagrams. Mermaid comes out in the form /build_diagram reads (pass the answer's kind with it), so a diagram can be exported, edited as text and built again. warnings name what the text cannot carry.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagramId: id("Diagram id."),
    format: doc(z.enum(["mermaid", "plantuml"]), "Text format."),
  }),
  response: z.object({
    diagram: z.object({
      _id: z.string(),
      _type: z.string(),
      name: z.nullable(z.string()),
    }),
    kind: doc(
      z.enum(KINDS),
      "The /build_diagram kind; use case and activity diagrams are written as Mermaid flowcharts and need it to be built again.",
    ),
    format: z.string(),
    text: z.string(),
    warnings: doc(
      z.array(z.string()),
      "Views or details the text leaves out or changes.",
    ),
  }),
  handle: (input) => {
    const diagram = requireDiagram(input.diagramId);
    const kind = kindOf(diagram);
    if (!kind) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${diagram.constructor.name} cannot be written as text; supported: ${KINDS.join(", ")} diagrams`,
      );
    }
    const { extracted, warnings } = extract(diagram, kind);
    const { _id, _type, name } = summarize(diagram);
    const write = input.format === "mermaid" ? toMermaid : toPlantUml;
    // Every diagram has a name, "" when unnamed (core/core.js).
    const out = write(extracted, diagram.name!);
    return {
      diagram: { _id, _type, name },
      kind,
      format: input.format,
      text: out.text,
      warnings: [...warnings, ...out.warnings],
    };
  },
});
