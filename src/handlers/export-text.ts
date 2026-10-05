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
import { ref } from "../schemas.js";
import { summarize } from "../serialize.js";
import {
  type MermaidExtracted,
  NO_MERMAID,
  toMermaid,
} from "../text/mermaid-writer.js";
import { FAMILY_KINDS, type FamilyKind } from "../build/families.js";
import { extractFamily } from "../text/families.js";
import { extract, kindOf } from "../text/model.js";

const isFamily = (kind: string): kind is FamilyKind =>
  (FAMILY_KINDS as readonly string[]).includes(kind);
import { toPlantUml } from "../text/plantuml-writer.js";

export const exportText = defineEndpoint({
  path: "/export_text",
  description:
    "Write a diagram as Mermaid or PlantUML text: class, sequence, use case, activity, state machine, ERD, flowchart, mind map, requirement and C4 diagrams, as PlantUML only package, component and deployment diagrams, and every other diagram family (composite structure, object, communication, timing, interaction overview, information flow, profile, DFD, SysML block definition, internal block and parametric, BPMN, wireframe, AWS, Azure, GCP) as its /build_diagram spec in JSON (format spec). Mermaid comes out in the form /build_diagram reads (pass the answer's kind with it), so a diagram can be exported, edited as text and built again. warnings name what the text cannot carry.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagram: ref("Diagram."),
    format: doc(
      z.enum(["mermaid", "plantuml", "spec"]),
      "Text format. spec: the /build_diagram spec as JSON, the text form of the kinds no Mermaid or PlantUML diagram holds (composite, object, communication, timing, overview, infoflow, profile, dfd, bdd, ibd, parametric, bpmn, wireframe, aws, azure, gcp); build it again with that kind.",
    ),
  }),
  aliases: { diagramId: "diagram" },
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
    const diagram = requireDiagram(input.diagram);
    const kind = kindOf(diagram);
    if (!kind) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${diagram.constructor.name} cannot be written as text; supported: ${KINDS.join(", ")} diagrams`,
      );
    }
    const { _id, _type, name } = summarize(diagram);
    if (isFamily(kind)) {
      if (input.format !== "spec") {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `Neither Mermaid nor PlantUML has a ${kind} diagram; export it as spec`,
        );
      }
      const { spec, warnings } = extractFamily(diagram, kind);
      return {
        diagram: { _id, _type, name },
        kind,
        format: input.format,
        text: `${JSON.stringify(spec, null, 2)}\n`,
        warnings,
      };
    }
    if (input.format === "spec") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec is the text of the diagram families (${FAMILY_KINDS.join(", ")}); export a ${kind} diagram as mermaid or plantuml`,
      );
    }
    if (
      input.format === "mermaid" &&
      (NO_MERMAID as readonly string[]).includes(kind)
    ) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `Mermaid has no ${kind} diagram; export it as plantuml`,
      );
    }
    const { extracted, warnings } = extract(diagram, kind);
    // Every diagram has a name, "" when unnamed (core/core.js).
    const out =
      input.format === "mermaid"
        ? toMermaid(extracted as MermaidExtracted, diagram.name!)
        : toPlantUml(extracted, diagram.name!);
    return {
      diagram: { _id, _type, name },
      kind,
      format: input.format,
      text: out.text,
      warnings: [...warnings, ...out.warnings],
    };
  },
});
