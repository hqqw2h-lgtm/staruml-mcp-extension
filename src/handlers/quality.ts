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
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { requireDiagram } from "../lookup.js";
import { kindOf } from "../quality/geometry.js";
import {
  assess,
  improve,
  qualitySchema,
  type Quality,
} from "../quality/loop.js";
import { penalties, ratingOf, WEIGHTS } from "../quality/metric.js";
import { ref } from "../schemas.js";
import { isTrusted } from "../style/guard.js";
import { effectiveProfile, thresholdFor } from "../style/profile.js";
import type { Element } from "../types.js";
import { oneStep, rehearse } from "../undo.js";
import { PRESET_NAMES } from "./views.js";

/*
 * /diagram_quality scores a diagram from its view geometry; /improve_diagram
 * runs the quality loop on it as one undo step (issue #32).
 */

const diagramSchema = () =>
  z.object({
    _id: z.string(),
    name: z.nullable(z.string()),
    _type: z.string(),
  });

const summary = (d: Element) => ({
  _id: d._id,
  name: typeof d.name === "string" ? d.name : null,
  _type: d.constructor.name,
});

export const diagramQuality = defineEndpoint({
  path: "/diagram_quality",
  description:
    "Score a diagram 0–100 from its view geometry, no rendering: overlap of boxes, edges through nodes, crossing edges, edge length variation, bends, alignment, whitespace balance, aspect ratio and size against the style profile's page. rating is 1–5 (4 needs 80); target is the profile's threshold for the kind. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    ref: z.optional(ref("Diagram; default the current one.")),
  }),
  aliases: { diagram: "ref", id: "ref" },
  response: z.object({
    diagram: diagramSchema(),
    kind: z.nullable(z.string()),
    score: z.int(),
    rating: z.int(),
    target: z.int(),
    passes: z.boolean(),
    metrics: doc(
      z.record(z.string(), z.number()),
      "overlapArea, overlapPairs, overlapRatio, nodeEdgeCrossings, edgeCrossings, lengthVariation, bends, alignment, whitespace, aspect, width, height, nodes, edges.",
    ),
    penalties: doc(
      z.record(z.string(), z.number()),
      `Points lost per measure, at most: ${Object.entries(WEIGHTS)
        .map(([k, w]) => `${k} ${w}`)
        .join(", ")}.`,
    ),
    findings: qualitySchema().shape.findings,
  }),
  handle: (input) => {
    const diagram = requireDiagram(input.ref ?? "@current");
    const profile = effectiveProfile().profile;
    const kind = kindOf(diagram);
    const { metrics, score, findings } = assess(diagram, profile);
    const target = kind
      ? thresholdFor(profile, kind)
      : profile.quality.minScore;
    const lost = penalties(metrics, profile.layout.page);
    return {
      diagram: summary(diagram),
      kind,
      score,
      rating: ratingOf(score),
      target,
      passes: score >= target,
      metrics: { ...metrics },
      penalties: Object.fromEntries(
        Object.entries(lost).map(([k, v]) => [k, Math.round(v * 10) / 10]),
      ),
      findings,
    };
  },
});

export const improveDiagram = defineEndpoint({
  path: "/improve_diagram",
  description:
    "Run the quality loop on an existing diagram as one undo step: the profile's layout preset (unless the kind's placement is the build's own: sequence, use case with a boundary, lanes), post-processing for the kind (rank ordering, lifeline order and spacing, boundary around use cases, straight flow chains, label room, overlap removal, grid, margin), then /lint_diagram's autofixes, measured after each step and undone if a step lowers the score, until target, no gain, or maxIterations. Allowed under a strict profile: it is how a strict diagram is rearranged. dryRun answers the score it would reach and leaves the diagram as it was.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ref: z.optional(ref("Diagram; default the current one.")),
    target: z.optional(
      doc(
        z.int().check(z.minimum(0), z.maximum(100)),
        "Score to stop at; default the profile's threshold for the kind.",
      ),
    ),
    maxIterations: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(10)),
        "Default the profile's (3).",
      ),
    ),
    relayout: z.optional(
      doc(z.boolean(), "Default true: run the layout preset first."),
    ),
    preset: z.optional(doc(z.enum(PRESET_NAMES), "Preset for that layout.")),
    dryRun: z.optional(z.boolean()),
  }),
  aliases: { diagram: "ref", id: "ref" },
  response: z.object({
    diagram: diagramSchema(),
    kind: z.nullable(z.string()),
    quality: qualitySchema(),
    dryRun: z.optional(z.boolean()),
  }),
  handle: async (input) => {
    const diagram = requireDiagram(input.ref ?? "@current");
    const profile = effectiveProfile().profile;
    const run = () =>
      improve(diagram, profile, {
        relayout: input.relayout ?? true,
        ...(input.target !== undefined && { target: input.target }),
        ...(input.maxIterations !== undefined && {
          maxIterations: input.maxIterations,
        }),
        ...(input.preset !== undefined && { preset: input.preset }),
      });
    const quality = input.dryRun
      ? await rehearse(run)
      : await oneStep("improve diagram", run);
    return {
      diagram: summary(diagram),
      kind: kindOf(diagram),
      quality,
      ...(input.dryRun && { dryRun: true }),
    };
  },
});

/**
 * /layout_diagram from outside runs the loop after the layout, in the same
 * undo step; the builds' own layout ops do not, the build runs it once.
 */
export function withQuality(endpoint: Endpoint): Endpoint {
  const response = z.extend(endpoint.response as z.ZodMiniObject, {
    quality: z.optional(qualitySchema()),
  });
  return {
    ...endpoint,
    response,
    handler: async (body) => {
      if (isTrusted()) return endpoint.handler(body);
      return oneStep("layout diagram", async () => {
        const result = await endpoint.handler(body);
        if (!result.success) return result;
        const data = result.data as { _id: string };
        const diagram = requireDiagram(data._id);
        const quality: Quality = improve(diagram, effectiveProfile().profile);
        return { success: true, data: { ...data, quality } };
      });
    },
  };
}
