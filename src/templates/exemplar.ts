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

import { ownerNode } from "../quality/geometry.js";
import type { Element, View } from "../types.js";
import exemplars from "./exemplars.json";
import type { Template } from "./schema.js";

/*
 * Acceptance against golden exemplars (issue #43). Each template has a
 * diagram a person rated 4 or 5 out of 5 (tests/fixtures/exemplars, see
 * approved.json); its structural fingerprint and score are kept in
 * exemplars.json, which a unit test derives from the .mdj. A diagram made
 * with the template is accepted when its own fingerprint is close enough
 * to the exemplar's and its score not far below. Exemplars are the
 * engine's own yardstick: no endpoint returns them.
 */

/** Scale-free features of a drawing: what it shows, its shape, its flow. */
export interface Fingerprint {
  /** Share of each node model type. */
  nodes: Record<string, number>;
  /** Share of each relationship type. */
  edges: Record<string, number>;
  /** Width over height of the drawing. */
  aspect: number;
  /** Share of edges running mainly up or down. */
  flow: number;
  /** Edges per node. */
  density: number;
}

export interface Exemplar {
  diagram: string;
  score: number;
  fingerprint: Fingerprint;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function shares(types: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of [...types].sort()) out[t] = (out[t] ?? 0) + 1;
  for (const t of Object.keys(out)) out[t] = round(out[t]! / types.length);
  return out;
}

const centre = (v: View) => ({
  x: Number(v.left) + Number(v.width) / 2,
  y: Number(v.top) + Number(v.height) / 2,
});

/** The fingerprint of `diagram`, leaving out the views in `skip` (its parts). */
export function fingerprint(
  diagram: Element,
  skip: ReadonlySet<string>,
): Fingerprint {
  const views = (diagram.ownedViews as View[]).filter(
    (v) =>
      v.visible !== false &&
      v.model &&
      !(v.model instanceof type.Diagram) &&
      !skip.has(v._id),
  );
  const related = views.filter((v) => v.model instanceof type.Relationship);
  const nodes = views.filter(
    (v) => !related.includes(v) && v instanceof type.NodeView,
  );
  const lines = related.filter(
    (v) => v instanceof type.EdgeView && v.tail && v.head,
  );
  const left = Math.min(...nodes.map((v) => Number(v.left)));
  const top = Math.min(...nodes.map((v) => Number(v.top)));
  const right = Math.max(...nodes.map((v) => Number(v.left) + Number(v.width)));
  const bottom = Math.max(
    ...nodes.map((v) => Number(v.top) + Number(v.height)),
  );
  const upright = lines.filter((e) => {
    const a = centre(ownerNode(e.tail as View));
    const b = centre(ownerNode(e.head as View));
    return Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
  });
  return {
    nodes: shares(nodes.map((v) => v.model!.constructor.name)),
    edges: shares(related.map((v) => v.model!.constructor.name)),
    aspect: nodes.length > 0 ? round((right - left) / (bottom - top)) : 1,
    flow: lines.length > 0 ? round(upright.length / lines.length) : 0.5,
    density: round(related.length / Math.max(1, nodes.length)),
  };
}

/** 1 for two equal distributions, 0 for two with nothing in common. */
function overlap(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let diff = 0;
  for (const k of keys) diff += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return keys.size === 0 ? 1 : 1 - diff / 2;
}

const ratio = (a: number, b: number) => Math.min(a, b) / Math.max(a, b);

/** How alike two drawings are in structure, 0 to 1. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  return round(
    0.3 * overlap(a.nodes, b.nodes) +
      0.15 * overlap(a.edges, b.edges) +
      0.2 * ratio(a.aspect, b.aspect) +
      0.2 * (1 - Math.abs(a.flow - b.flow)) +
      0.15 * ratio(a.density + 0.1, b.density + 0.1),
  );
}

/** Similarity a diagram needs to its template's exemplar. */
export const MIN_SIMILARITY = 0.6;
/** Points a diagram's score may stay below its exemplar's, never under FLOOR. */
export const SCORE_TOLERANCE = 15;
export const SCORE_FLOOR = 60;

const KNOWN = exemplars as Record<string, Exemplar>;

/** The exemplar of a template, if one was approved. */
export const exemplarOf = (t: Template): Exemplar | undefined =>
  Object.hasOwn(KNOWN, t.name) ? KNOWN[t.name] : undefined;

/**
 * Whether a diagram made with `t` passes as its kind: structurally like
 * the exemplar and scoring near it. A template with no exemplar accepts
 * any diagram that reaches the floor.
 */
export function accepts(
  t: Template,
  diagram: Element,
  score: number,
  skip: ReadonlySet<string>,
  known: (t: Template) => Exemplar | undefined = exemplarOf,
): boolean {
  const ex = known(t);
  if (!ex) return score >= SCORE_FLOOR;
  return (
    similarity(fingerprint(diagram, skip), ex.fingerprint) >= MIN_SIMILARITY &&
    score >= Math.max(SCORE_FLOOR, ex.score - SCORE_TOLERANCE)
  );
}
