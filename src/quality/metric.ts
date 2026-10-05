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

/*
 * The objective quality metric of a diagram (issue #32), computed from view
 * geometry alone so it needs no rendering: overlap, node-edge and edge-edge
 * crossings, edge length variation, bends, alignment, whitespace balance
 * and aspect ratio, weighted into a score from 0 to 100. Pure: the same
 * geometry always scores the same, and more overlap or more crossings
 * never score higher.
 */

export interface Point {
  x: number;
  y: number;
}

export interface GNode {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Stands for an area (a frame, a boundary, a lane): overlapping it is by design. */
  area: boolean;
  /** Edges run through it by design, as messages through lifelines. */
  through: boolean;
  /** The node it is drawn in, if any. */
  parent: string | null;
  /** Nodes it may touch by design: an edge label and its edge's ends. */
  attachedTo?: readonly string[];
  /** An edge's label: no obstacle for other edges, which may pass it. */
  label?: boolean;
}

export interface GEdge {
  id: string;
  points: Point[];
  ends: [string, string];
}

export interface Geometry {
  nodes: GNode[];
  edges: GEdge[];
}

export interface Metrics {
  nodes: number;
  edges: number;
  /** Area where solid nodes overlap, in square diagram units. */
  overlapArea: number;
  overlapPairs: number;
  /** Overlap area over the solid nodes' total area. */
  overlapRatio: number;
  /** Edge segments running through a node that is not an end. */
  nodeEdgeCrossings: number;
  edgeCrossings: number;
  /** Standard deviation of edge lengths over their mean. */
  lengthVariation: number;
  bends: number;
  /** Share of nodes sharing a centre line or a top with another, 0 to 1. */
  alignment: number;
  /** 1 when the nodes fill between a sixth and half of their bounding box. */
  whitespace: number;
  /** The bounding box's longer side over its shorter one. */
  aspect: number;
  width: number;
  height: number;
}

/** Weights, in score points; they add up to 100. */
export const WEIGHTS = {
  overlap: 30,
  nodeEdge: 20,
  edgeEdge: 15,
  length: 5,
  bends: 5,
  alignment: 10,
  whitespace: 5,
  aspect: 5,
  page: 5,
} as const;

const EPS = 1e-6;

/** Whether `a` is drawn inside `b` by the container chain. */
function nestedIn(
  a: GNode,
  b: GNode,
  byId: ReadonlyMap<string, GNode>,
): boolean {
  // A chain that loops (a view listed as its own container) ends where it
  // repeats rather than running forever.
  const seen = new Set<string>();
  for (
    let p = a.parent;
    p !== null && !seen.has(p);
    p = byId.get(p)?.parent ?? null
  ) {
    if (p === b.id) return true;
    seen.add(p);
  }
  return false;
}

const contains = (outer: GNode, inner: GNode) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.left + inner.width <= outer.left + outer.width &&
  inner.top + inner.height <= outer.top + outer.height;

/** Overlap of two solid nodes not drawn one in the other. */
function overlapOf(
  a: GNode,
  b: GNode,
  byId: ReadonlyMap<string, GNode>,
): number {
  if (nestedIn(a, b, byId) || nestedIn(b, a, byId)) return 0;
  if (a.attachedTo?.includes(b.id) || b.attachedTo?.includes(a.id)) return 0;
  // Notes and fragments sit over a lifeline's line by design; only two
  // lifelines on each other are a defect.
  if (a.through !== b.through) return 0;
  if (contains(a, b) || contains(b, a)) {
    // A box fully on another is the worst overlap, not a container.
    return Math.min(a.width * a.height, b.width * b.height);
  }
  const w =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 1 && h > 1 ? w * h : 0;
}

/**
 * Whether the segment p–q passes through the inside of `box` shrunk by
 * 2 units, so an edge along a border or ending on it does not count
 * (Liang–Barsky clipping).
 */
export function segmentCrossesBox(
  p: Point,
  q: Point,
  box: { left: number; top: number; width: number; height: number },
): boolean {
  const [x0, y0, x1, y1] = [
    box.left + 2,
    box.top + 2,
    box.left + box.width - 2,
    box.top + box.height - 2,
  ];
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [pk, qk] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ] as const) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const r = qk / pk;
    if (pk < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether two segments cross at a point inside both (touching ends do not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
}

const segments = (points: readonly Point[]): [Point, Point][] =>
  points.slice(1).map((p, i) => [points[i]!, p]);

const length = (points: readonly Point[]) =>
  segments(points).reduce(
    (n, [a, b]) => n + Math.hypot(b.x - a.x, b.y - a.y),
    0,
  );

/** Whether `node` is an end of `edge`, holds one, or sits in one. */
function endOf(
  edge: GEdge,
  node: GNode,
  byId: ReadonlyMap<string, GNode>,
): boolean {
  return edge.ends.some((id) => {
    if (id === node.id) return true;
    const end = byId.get(id);
    return (
      end !== undefined &&
      (nestedIn(end, node, byId) || nestedIn(node, end, byId))
    );
  });
}

/** Share of nodes that line up with another: centre x, centre y or top. */
function alignmentOf(nodes: readonly GNode[]): number {
  if (nodes.length < 2) return 1;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const lines = (n: GNode) => [
    n.left + n.width / 2,
    n.top + n.height / 2,
    n.top,
    n.left,
  ];
  const aligned = nodes.filter((n) =>
    nodes.some(
      (o) => o !== n && lines(n).some((v, i) => near(v, lines(o)[i]!)),
    ),
  );
  return aligned.length / nodes.length;
}

/** Measures `g`; nodes are the views drawn, edges their polylines. */
export function measure(g: Geometry): Metrics {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const solid = g.nodes.filter((n) => !n.area);
  let overlapArea = 0;
  let overlapPairs = 0;
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const o = overlapOf(solid[i]!, solid[j]!, byId);
      if (o > 0) {
        overlapArea += o;
        overlapPairs++;
      }
    }
  }
  const solidArea = solid.reduce((n, b) => n + b.width * b.height, 0);
  let nodeEdgeCrossings = 0;
  const obstacles = solid.filter((n) => !n.through && !n.label);
  for (const e of g.edges) {
    for (const n of obstacles) {
      if (endOf(e, n, byId)) continue;
      if (segments(e.points).some(([p, q]) => segmentCrossesBox(p, q, n))) {
        nodeEdgeCrossings++;
      }
    }
  }
  let edgeCrossings = 0;
  for (let i = 0; i < g.edges.length; i++) {
    for (let j = i + 1; j < g.edges.length; j++) {
      const [a, b] = [g.edges[i]!, g.edges[j]!];
      if (a.ends.some((id) => b.ends.includes(id))) continue;
      for (const [p, q] of segments(a.points)) {
        for (const [r, s] of segments(b.points)) {
          if (segmentsCross(p, q, r, s)) edgeCrossings++;
        }
      }
    }
  }
  const lengths = g.edges.map((e) => length(e.points));
  const mean = lengths.reduce((n, l) => n + l, 0) / Math.max(1, lengths.length);
  const sd = Math.sqrt(
    lengths.reduce((n, l) => n + (l - mean) ** 2, 0) /
      Math.max(1, lengths.length),
  );
  const all = g.nodes;
  const minX = Math.min(...all.map((n) => n.left));
  const minY = Math.min(...all.map((n) => n.top));
  const maxX = Math.max(...all.map((n) => n.left + n.width));
  const maxY = Math.max(...all.map((n) => n.top + n.height));
  const width = all.length > 0 ? maxX - minX : 0;
  const height = all.length > 0 ? maxY - minY : 0;
  const density = solidArea / Math.max(1, width * height);
  const whitespace =
    density >= 1 / 6 && density <= 0.5
      ? 1
      : density < 1 / 6
        ? density * 6
        : Math.max(0, 1 - (density - 0.5) * 2);
  return {
    nodes: g.nodes.length,
    edges: g.edges.length,
    overlapArea: Math.round(overlapArea),
    overlapPairs,
    overlapRatio: solidArea > 0 ? overlapArea / solidArea : 0,
    nodeEdgeCrossings,
    edgeCrossings,
    lengthVariation: mean > 0 ? sd / mean : 0,
    bends: g.edges.reduce((n, e) => n + Math.max(0, e.points.length - 2), 0),
    // Labels sit where their edges put them; boxes are what lines up.
    alignment: alignmentOf(solid.filter((n) => !n.label)),
    whitespace: all.length > 0 ? whitespace : 1,
    aspect:
      width > 0 && height > 0
        ? Math.max(width, height) / Math.min(width, height)
        : 1,
    width,
    height,
  };
}

/** Diagram size the score expects at most, in diagram units. */
export interface Page {
  width: number;
  height: number;
}

/** Points lost per measure; each grows with its measure and stops at its weight. */
export function penalties(m: Metrics, page: Page) {
  const capped = (weight: number, x: number) => Math.min(weight, weight * x);
  const edges = Math.max(1, m.edges);
  // Wider than the page's own aspect is fine up to 3:1; beyond, it reads as a strip.
  const over = Math.max(
    0,
    m.width / page.width - 1.5,
    m.height / page.height - 1.5,
  );
  return {
    overlap: capped(
      WEIGHTS.overlap,
      0.5 * (1 - Math.exp(-4 * m.overlapRatio)) + 0.1 * m.overlapPairs,
    ),
    nodeEdge: capped(WEIGHTS.nodeEdge, m.nodeEdgeCrossings / 4),
    edgeEdge: capped(WEIGHTS.edgeEdge, 1 - Math.exp(-m.edgeCrossings / edges)),
    length: capped(WEIGHTS.length, m.lengthVariation / 1.5),
    bends: capped(WEIGHTS.bends, m.bends / edges / 4),
    alignment: WEIGHTS.alignment * (1 - m.alignment),
    whitespace: WEIGHTS.whitespace * (1 - m.whitespace),
    aspect: capped(WEIGHTS.aspect, Math.max(0, m.aspect - 3) / 3),
    page: capped(WEIGHTS.page, over),
  };
}

/** 0 to 100, higher is better. */
export function scoreOf(m: Metrics, page: Page): number {
  const lost = Object.values(penalties(m, page)).reduce((n, p) => n + p, 0);
  return Math.max(0, Math.min(100, Math.round(100 - lost)));
}

/** The 1–5 rating reviewers use: 4 needs a score of 80. */
export const ratingOf = (score: number): number =>
  score >= 90 ? 5 : score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1;
