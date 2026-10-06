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
 * The objective quality metric of a diagram (issues #32, #38), computed from
 * view geometry alone so it needs no rendering. Pure: the same geometry
 * always scores the same, and more overlap or more crossings never score
 * higher.
 *
 * The weights are fitted to two sets of human 1–5 ratings of ThingsBoard
 * diagrams (tests/fixtures/quality/human-ratings.json, 50 diagrams); the
 * unit suite keeps the score's Spearman rank correlation with them at 0.7
 * or more. What separated the ratings was what a reader sees first: text
 * printed over text, labels far from their edge, one box on another, edges
 * sharing a line, boxes straddling a lane or fragment border, and a strip
 * or poster no screen shows whole. Those carry most of the weight now; edge
 * length variation and bends, which no reviewer mentioned, carry little.
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
  /** For a label, the edge it names; its distance to that edge is measured. */
  edge?: string;
  /** Nodes of one group may overlap: activations stacked on one lifeline. */
  group?: string;
}

export interface GEdge {
  id: string;
  points: Point[];
  ends: [string, string];
}

export interface Geometry {
  nodes: GNode[];
  edges: GEdge[];
  /** Views selected in the editor: an export draws their handles. */
  selected?: number;
}

export interface Metrics {
  nodes: number;
  edges: number;
  /** Area where solid nodes overlap, in square diagram units. */
  overlapArea: number;
  overlapPairs: number;
  /** Overlap area over the solid nodes' total area. */
  overlapRatio: number;
  /** Pairs where a quarter or more of the smaller box is covered. */
  severeOverlaps: number;
  /** Labels printed over another label or over a box. */
  labelOverlaps: number;
  /** Labels further than LABEL_REACH from the edge they name. */
  detachedLabels: number;
  /** Edges drawn through another edge's label. */
  labelCrossings: number;
  /** Edge segments running through a node that is not an end. */
  nodeEdgeCrossings: number;
  edgeCrossings: number;
  /** Pairs of edges drawn on the same line for more than SHARED_MIN units. */
  sharedSegments: number;
  /** Boxes and labels cut by the border of a lane, fragment or boundary. */
  borderCrossings: number;
  /** Views selected in the editor, whose handles an export draws. */
  selected: number;
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
  overlap: 18,
  labels: 18,
  nodeEdge: 13,
  edgeEdge: 12,
  shared: 5,
  borders: 8,
  selection: 6,
  length: 3,
  bends: 1,
  alignment: 2,
  whitespace: 4,
  aspect: 4,
  page: 6,
} as const;

/** A label's gap to its edge past which a reader cannot tell which edge it names. */
export const LABEL_REACH = 24;
/** Collinear run, in units, from which two edges read as one line. */
export const SHARED_MIN = 16;

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

const intersection = (a: GNode, b: GNode) => {
  const w =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 1 && h > 1 ? w * h : 0;
};

/** Overlap of two solid nodes not drawn one in the other. */
function overlapOf(
  a: GNode,
  b: GNode,
  byId: ReadonlyMap<string, GNode>,
): number {
  if (nestedIn(a, b, byId) || nestedIn(b, a, byId)) return 0;
  if (a.attachedTo?.includes(b.id) || b.attachedTo?.includes(a.id)) return 0;
  if (a.group !== undefined && a.group === b.group) return 0;
  // Notes and fragments sit over a lifeline's line by design; only two
  // lifelines on each other are a defect.
  if (a.through !== b.through) return 0;
  if (contains(a, b) || contains(b, a)) {
    // A box fully on another is the worst overlap, not a container.
    return Math.min(a.width * a.height, b.width * b.height);
  }
  return intersection(a, b);
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

/** Distance from point `p` to segment a–b. */
function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Gap between a label's box and a polyline: 0 when the line runs through
 * the box, else the least distance from the box's corners and edge
 * midpoints to the line, or from the line's points to the box.
 */
export function labelGap(
  label: { left: number; top: number; width: number; height: number },
  points: readonly Point[],
): number {
  // An edge with no points has no place a label could be near.
  if (points.length === 0) return Infinity;
  const segs =
    points.length > 1 ? segments(points) : [[points[0]!, points[0]!]];
  if (segs.some(([p, q]) => segmentCrossesBox(p, q, label))) return 0;
  const { left: l, top: t, width: w, height: h } = label;
  const probes = [
    { x: l, y: t },
    { x: l + w, y: t },
    { x: l, y: t + h },
    { x: l + w, y: t + h },
    { x: l + w / 2, y: t },
    { x: l + w / 2, y: t + h },
    { x: l, y: t + h / 2 },
    { x: l + w, y: t + h / 2 },
  ];
  const fromBox = Math.min(
    ...probes.flatMap((p) => segs.map(([a, b]) => pointToSegment(p, a, b))),
  );
  const toBox = Math.min(
    ...points.map((p) =>
      Math.hypot(
        Math.max(l - p.x, 0, p.x - (l + w)),
        Math.max(t - p.y, 0, p.y - (t + h)),
      ),
    ),
  );
  return Math.min(fromBox, toBox);
}

type Run = { axis: "h" | "v"; at: number; from: number; to: number };

/** The horizontal and vertical segments of a polyline, as runs on a line. */
function runs(points: readonly Point[]): Run[] {
  return segments(points).flatMap(([p, q]): Run[] => {
    if (Math.abs(p.y - q.y) <= 1 && Math.abs(p.x - q.x) > 1) {
      return [
        {
          axis: "h",
          at: p.y,
          from: Math.min(p.x, q.x),
          to: Math.max(p.x, q.x),
        },
      ];
    }
    if (Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) > 1) {
      return [
        {
          axis: "v",
          at: p.x,
          from: Math.min(p.y, q.y),
          to: Math.max(p.y, q.y),
        },
      ];
    }
    return [];
  });
}

/** Longest stretch two polylines draw on the same line. */
function sharedRun(a: readonly Point[], b: readonly Point[]): number {
  let best = 0;
  const rb = runs(b);
  for (const r of runs(a)) {
    for (const s of rb) {
      if (r.axis !== s.axis || Math.abs(r.at - s.at) > 2) continue;
      best = Math.max(best, Math.min(r.to, s.to) - Math.max(r.from, s.from));
    }
  }
  return best;
}

/**
 * Whether two edges are drawn on one line for more than SHARED_MIN. Edges
 * into one target may merge into one arrowhead (a generalization tree,
 * UML 2.5.1 §9.9.7); any other pair on one line hides where each goes.
 */
const shares = (a: GEdge, b: GEdge) =>
  a.ends[1] !== b.ends[1] && sharedRun(a.points, b.points) > SHARED_MIN;

/** The edges drawn along another edge to a different end. */
export function sharedEdges(g: Geometry): string[] {
  const out = new Set<string>();
  g.edges.forEach((a, i) => {
    for (const b of g.edges.slice(i + 1)) {
      if (shares(a, b)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  });
  return [...out];
}

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

/**
 * Boxes and labels an area's border cuts: partly in a lane, a fragment or
 * an operand, so the reader cannot say which one they belong to. A box
 * holding the area (a package around a boundary) and lifelines, which run
 * through every fragment by design, do not count.
 */
function borderCrossingsOf(nodes: readonly GNode[]): number {
  const areas = nodes.filter((n) => n.area);
  let n = 0;
  for (const v of nodes) {
    if (v.area || v.through) continue;
    for (const a of areas) {
      if (intersection(a, v) > 0 && !contains(a, v) && !contains(v, a)) n++;
    }
  }
  return n;
}

/**
 * Edge labels a reader cannot read or place: printed over a box or another
 * label, crossed by another edge, or too far from their own edge. What
 * the quality loop moves; measure counts the same things.
 */
export function labelProblems(g: Geometry): string[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(g.edges.map((e) => [e.id, e]));
  const solid = g.nodes.filter((n) => !n.area);
  return solid
    .filter((l) => l.edge !== undefined)
    .filter((l) => {
      const own = edgeById.get(l.edge!);
      if (own && labelGap(l, own.points) > LABEL_REACH) return true;
      if (
        g.edges.some(
          (e) =>
            e.id !== l.edge &&
            segments(e.points).some(([p, q]) => segmentCrossesBox(p, q, l)),
        )
      ) {
        return true;
      }
      return solid.some((o) => o !== l && overlapOf(l, o, byId) > 0);
    })
    .map((l) => l.id);
}

/** Measures `g`; nodes are the views drawn, edges their polylines. */
export function measure(g: Geometry): Metrics {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const solid = g.nodes.filter((n) => !n.area);
  let overlapArea = 0;
  let overlapPairs = 0;
  let severeOverlaps = 0;
  let labelOverlaps = 0;
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const [a, b] = [solid[i]!, solid[j]!];
      const o = overlapOf(a, b, byId);
      if (o <= 0) continue;
      if (a.label || b.label) {
        labelOverlaps++;
        continue;
      }
      overlapArea += o;
      overlapPairs++;
      if (o >= 0.25 * Math.min(a.width * a.height, b.width * b.height)) {
        severeOverlaps++;
      }
    }
  }
  const boxes = solid.filter((n) => !n.label);
  const solidArea = boxes.reduce((n, b) => n + b.width * b.height, 0);
  const edgeById = new Map(g.edges.map((e) => [e.id, e]));
  const detachedLabels = solid.filter((n) => {
    const e = n.edge === undefined ? undefined : edgeById.get(n.edge);
    return e !== undefined && labelGap(n, e.points) > LABEL_REACH;
  }).length;
  const named = solid.filter((n) => n.edge !== undefined);
  let labelCrossings = 0;
  for (const e of g.edges) {
    for (const l of named) {
      if (l.edge === e.id) continue;
      if (segments(e.points).some(([p, q]) => segmentCrossesBox(p, q, l))) {
        labelCrossings++;
      }
    }
  }
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
  let sharedSegments = 0;
  for (let i = 0; i < g.edges.length; i++) {
    for (let j = i + 1; j < g.edges.length; j++) {
      const [a, b] = [g.edges[i]!, g.edges[j]!];
      if (shares(a, b)) sharedSegments++;
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
    // Labels are drawn for edges; the size of a diagram is its boxes.
    nodes: g.nodes.filter((n) => !n.label).length,
    edges: g.edges.length,
    overlapArea: Math.round(overlapArea),
    overlapPairs,
    overlapRatio: solidArea > 0 ? overlapArea / solidArea : 0,
    severeOverlaps,
    labelOverlaps,
    detachedLabels,
    labelCrossings,
    nodeEdgeCrossings,
    edgeCrossings,
    sharedSegments,
    borderCrossings: borderCrossingsOf(g.nodes),
    selected: g.selected ?? 0,
    lengthVariation: mean > 0 ? sd / mean : 0,
    bends: g.edges.reduce((n, e) => n + Math.max(0, e.points.length - 2), 0),
    // Labels sit where their edges put them; boxes are what lines up.
    alignment: alignmentOf(boxes),
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

/**
 * What the score holds a diagram to: the page it should fit, and the
 * hard limits past which it fails whatever else it does well.
 */
export interface Limits extends Page {
  /** Longer side over shorter side; default DEFAULT_LIMITS.maxAspect. */
  maxAspect?: number;
  /** Boxes on one diagram; default DEFAULT_LIMITS.maxNodes. */
  maxNodes?: number;
}

export const DEFAULT_LIMITS = { maxAspect: 3, maxNodes: 60 } as const;

/**
 * The hard limits a diagram breaks: a strip past maxAspect cannot be read
 * at any zoom that shows it whole (the 1020×8292 mind map rated 1/5), and
 * more than maxNodes boxes is a poster, not a diagram. Each fails the
 * diagram whatever its score.
 */
export function failures(m: Metrics, limits: Limits): string[] {
  const maxAspect = limits.maxAspect ?? DEFAULT_LIMITS.maxAspect;
  const maxNodes = limits.maxNodes ?? DEFAULT_LIMITS.maxNodes;
  // A wide diagram that fits the page whole (three use cases in a row)
  // reads fine; reviewers rated 645×180 at 5/5.
  const fits =
    Math.max(m.width, m.height) <= 2 * Math.max(limits.width, limits.height);
  return [
    ...(m.aspect > maxAspect && !fits
      ? [
          `aspect ${m.aspect.toFixed(1)}:1 over ${maxAspect}:1 (${Math.round(m.width)}×${Math.round(m.height)})`,
        ]
      : []),
    ...(m.nodes > maxNodes ? [`${m.nodes} nodes over ${maxNodes}`] : []),
  ];
}

/** Score a failing diagram stays below: under the 60 a 3/5 needs. */
export const FAIL_CAP = 59;

/** Points lost per measure; each grows with its measure and stops at its weight. */
export function penalties(m: Metrics, page: Limits) {
  const capped = (weight: number, x: number) => Math.min(weight, weight * x);
  const edges = Math.max(1, m.edges);
  const maxAspect = page.maxAspect ?? DEFAULT_LIMITS.maxAspect;
  const over = Math.max(
    0,
    m.width / page.width - 1.5,
    m.height / page.height - 1.5,
  );
  return {
    overlap: capped(
      WEIGHTS.overlap,
      // One box on another hides what it covers: the whole weight.
      0.5 * (1 - Math.exp(-4 * m.overlapRatio)) +
        0.1 * m.overlapPairs +
        m.severeOverlaps,
    ),
    labels: capped(
      WEIGHTS.labels,
      (m.labelOverlaps + m.detachedLabels + m.labelCrossings) / 6,
    ),
    nodeEdge: capped(WEIGHTS.nodeEdge, m.nodeEdgeCrossings / 3),
    edgeEdge: capped(
      WEIGHTS.edgeEdge,
      1 - Math.exp((-3 * m.edgeCrossings) / edges),
    ),
    shared: capped(WEIGHTS.shared, m.sharedSegments / 8),
    borders: capped(WEIGHTS.borders, m.borderCrossings / 6),
    selection: capped(WEIGHTS.selection, m.selected),
    length: capped(WEIGHTS.length, m.lengthVariation / 1.5),
    bends: capped(WEIGHTS.bends, m.bends / edges / 4),
    alignment: WEIGHTS.alignment * (1 - m.alignment),
    whitespace: WEIGHTS.whitespace * (1 - m.whitespace),
    // Up to two thirds of the limit costs nothing; the rest of the weight
    // is spent by the time the limit is reached.
    aspect: capped(
      WEIGHTS.aspect,
      Math.max(0, m.aspect - maxAspect) / maxAspect,
    ),
    page: capped(WEIGHTS.page, over),
  };
}

/** 0 to 100, higher is better; at most FAIL_CAP when a hard limit is broken. */
export function scoreOf(m: Metrics, page: Limits): number {
  const lost = Object.values(penalties(m, page)).reduce((n, p) => n + p, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - lost)));
  return failures(m, page).length > 0 ? Math.min(FAIL_CAP, score) : score;
}

/** The 1–5 rating reviewers use: 4 needs a score of 80. */
export const ratingOf = (score: number): number =>
  score >= 90 ? 5 : score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1;
