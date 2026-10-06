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
import type { Kind } from "../build/spec.js";
import { doc } from "../endpoint.js";
import { inStarUML } from "../errors.js";
import {
  LAYOUT_RULES,
  type LayoutRule,
  labelWidth,
  lintLayout,
  NAME_OUTSIDE,
  SEVERITIES,
} from "../handlers/lint.js";
import {
  applyLayout,
  editorShowing,
  labelSeparations,
  LAYOUT_PRESETS,
  LINE_STYLES,
  type LayoutPresetName,
} from "../handlers/views.js";
import {
  limitsFor,
  presetFor,
  type Profile,
  thresholdFor,
} from "../style/profile.js";
import type { Element, View } from "../types.js";
import { record } from "../undo.js";
import {
  AREA,
  box,
  edgeViewsOf,
  geometryOf,
  kindOf,
  nodeViews,
  ownerNode,
} from "./geometry.js";
import {
  failures,
  labelProblems,
  type Limits,
  measure,
  type Point,
  sharedEdges,
  type Metrics,
  ratingOf,
  scoreOf,
} from "./metric.js";

/*
 * The quality loop (issue #32): StarUML's dagre layout gives ranks, the
 * rest is ours. A diagram goes through post-processing for its kind, then
 * /lint_diagram's autofixes, measured after each step; a step that lowers
 * the score is undone, and the loop stops at the profile's threshold, when
 * a round gains nothing, or after maxIterations rounds.
 */

const GAP = 40;
const MARGIN = 40;

type Box = { left: number; top: number; width: number; height: number };

const centre = (b: Box) => ({
  x: b.left + b.width / 2,
  y: b.top + b.height / 2,
});

/** Top-level views that are not areas: what post-processing moves. */
function solids(diagram: Element): View[] {
  return nodeViews(diagram).filter(
    (v) => !AREA.test(v.constructor.name) && !v.containerView,
  );
}

export class Mover {
  private editor: unknown = null;
  constructor(private readonly diagram: Element) {}
  private ed(): unknown {
    this.editor ??= editorShowing(this.diagram);
    return this.editor;
  }
  move(views: View[], dx: number, dy: number): void {
    if (views.length === 0 || (dx === 0 && dy === 0)) return;
    inStarUML(() => app.engine.moveViews(this.ed(), views, dx, dy));
  }
  resize(view: View, b: Box): void {
    const c = box(view);
    if (
      c.left === b.left &&
      c.top === b.top &&
      c.width === b.width &&
      c.height === b.height
    ) {
      return;
    }
    inStarUML(() =>
      app.engine.resizeNode(
        this.ed(),
        view,
        b.left,
        b.top,
        b.left + b.width,
        b.top + b.height,
      ),
    );
  }
  modifyEdge(edge: View, points: unknown): void {
    inStarUML(() => app.engine.modifyEdge(this.ed(), edge, points));
  }
  assign(view: View, field: string, value: unknown): void {
    const builder = app.repository.getOperationBuilder();
    builder.begin(`set ${field}`);
    builder.fieldAssign(view, field, value);
    builder.end();
    inStarUML(() => app.repository.doOperation(builder.getOperation()));
  }
}

/** Kinds whose placement is the build's own: dagre would undo it. */
const PLACED_KINDS = new Set<Kind | null>([
  "sequence",
  "usecase",
  "mindmap",
  "timing",
  "ibd",
  "parametric",
  "communication",
  "overview",
  "bdd",
]);

/** Whether engine layout would scatter what holds the picture together: lanes, a boundary, a frame. */
export function placedByBuild(diagram: Element, kind: Kind | null): boolean {
  return (
    PLACED_KINDS.has(kind) ||
    nodeViews(diagram).some((v) =>
      // BPMN pools and lanes, cloud groups and zones and wireframe frames
      // hold their nodes as lanes do.
      /Swimlane|Partition|Subject|Pool|Lane|Group|Zone|WF\w*Frame/.test(
        v.constructor.name,
      ),
    )
  );
}

// ------------------------------------------------------------ post-processing

/** Names wider than their box get the width they need, wrapped past the profile's labelWrap. */
function fitLabels(diagram: Element, profile: Profile, m: Mover): void {
  for (const v of nodeViews(diagram)) {
    const name = v.model?.name;
    if (
      typeof name !== "string" ||
      !name ||
      NAME_OUTSIDE.test(v.constructor.name) ||
      AREA.test(v.constructor.name)
    ) {
      continue;
    }
    const b = box(v);
    const need = labelWidth(name);
    if (need <= b.width) continue;
    const wrap = profile.layout.labelWrap;
    if (need > wrap && typeof v.wordWrap === "boolean") {
      if (!v.wordWrap) m.assign(v, "wordWrap", true);
      if (b.width < wrap) m.resize(v, { ...b, width: wrap });
      // Wrapped lines need height; StarUML computes minHeight on repaint
      // (View.sizeConstraints, core/core.js 7.1.1).
      app.diagrams.repaint();
      const min = v.minHeight;
      if (typeof min === "number" && min > box(v).height) {
        m.resize(v, { ...box(v), height: min });
      }
    } else {
      m.resize(v, { ...b, width: need });
    }
  }
}

/** Pushes overlapping boxes apart along the shorter way out. */
function separate(diagram: Element, m: Mover): void {
  for (let pass = 0; pass < 3; pass++) {
    const views = solids(diagram).sort(
      (a, b) => box(a).left - box(b).left || box(a).top - box(b).top,
    );
    let moved = false;
    for (let i = 0; i < views.length; i++) {
      for (let j = i + 1; j < views.length; j++) {
        const [a, b] = [box(views[i]!), box(views[j]!)];
        const w =
          Math.min(a.left + a.width, b.left + b.width) -
          Math.max(a.left, b.left);
        const h =
          Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        if (w <= 1 || h <= 1) continue;
        if (w <= h) m.move([views[j]!], Math.round(w + GAP / 2), 0);
        else m.move([views[j]!], 0, Math.round(h + GAP / 2));
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/**
 * Overlapping boxes in lanes pushed apart downwards only, so each stays in
 * its lane (the lane is the column that says who acts).
 */
function separateInLanes(diagram: Element, m: Mover): void {
  const views = nodeViews(diagram)
    .filter((v) => !AREA.test(v.constructor.name))
    .sort((a, b) => box(a).top - box(b).top || box(a).left - box(b).left);
  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const [a, b] = [box(views[i]!), box(views[j]!)];
      const w =
        Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const h =
        Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) m.move([views[j]!], 0, Math.round(h + GAP / 2));
    }
  }
}

/** Whether a box's centre is inside another's (a class still in its package). */
function insideBox(view: View, holder: View): boolean {
  const c = centre(box(view));
  const b = box(holder);
  return (
    c.x > b.left &&
    c.x < b.left + b.width &&
    c.y > b.top &&
    c.y < b.top + b.height
  );
}

/** The lane (or partition) a box's centre is in, if any. */
function laneOf(diagram: Element, view: View): View | undefined {
  const c = centre(box(view));
  return nodeViews(diagram).find((l) => {
    if (!/Swimlane|Partition/.test(l.constructor.name)) return false;
    const b = box(l);
    return (
      c.x > b.left &&
      c.x < b.left + b.width &&
      c.y > b.top &&
      c.y < b.top + b.height
    );
  });
}

/** Every top-level box on the profile's grid. */
function snap(diagram: Element, profile: Profile, m: Mover): void {
  const { size, snap } = profile.visuals.grid;
  if (!snap) return;
  for (const v of nodeViews(diagram).filter((v) => !v.containerView)) {
    const b = box(v);
    m.move(
      [v],
      Math.round(b.left / size) * size - b.left,
      Math.round(b.top / size) * size - b.top,
    );
  }
}

/** The drawing moved to a margin from the canvas origin. */
function trim(diagram: Element, m: Mover): void {
  const top = nodeViews(diagram).filter((v) => !v.containerView);
  if (top.length === 0) return;
  const minX = Math.min(...top.map((v) => box(v).left));
  const minY = Math.min(...top.map((v) => box(v).top));
  m.move(top, MARGIN - minX, MARGIN - minY);
}

/** Rows of boxes by centre height, top first. */
function rows(views: readonly View[]): View[][] {
  const sorted = [...views].sort((a, b) => centre(box(a)).y - centre(box(b)).y);
  const out: View[][] = [];
  for (const v of sorted) {
    const row = out.at(-1);
    const first = row?.[0];
    if (
      row &&
      first &&
      centre(box(v)).y - centre(box(first)).y <= box(first).height / 2
    ) {
      row.push(v);
    } else out.push([v]);
  }
  return out;
}

/**
 * Barycenter ordering: within each rank, below the first, nodes sorted by
 * the mean x of their neighbours in the ranks above, then packed at equal
 * spacing from the rank's left edge.
 */
function orderRanks(diagram: Element, m: Mover): void {
  const views = solids(diagram);
  const geometry = geometryOf(diagram);
  const neighbours = new Map<string, string[]>();
  for (const e of geometry.edges) {
    const [a, b] = e.ends;
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const placed = new Map<string, number>();
  for (const row of rows(views)) {
    const bary = (v: View) => {
      const xs = (neighbours.get(v._id) ?? [])
        .map((id) => placed.get(id))
        .filter((x) => x !== undefined);
      return xs.length > 0
        ? xs.reduce((n, x) => n + x, 0) / xs.length
        : centre(box(v)).x;
    };
    const current = [...row].sort((a, b) => box(a).left - box(b).left);
    const wanted = [...row].sort(
      (a, b) => bary(a) - bary(b) || box(a).left - box(b).left,
    );
    if (wanted.some((v, i) => v !== current[i])) {
      let x = box(current[0]!).left;
      for (const v of wanted) {
        m.move([v], x - box(v).left, 0);
        x += box(v).width + GAP;
      }
    }
    for (const v of row) placed.set(v._id, centre(box(v)).x);
  }
}

/** Lifelines in order of their first message, at one pitch; the frame around them all. */
function sequence(diagram: Element, m: Mover): void {
  const lifelines = nodeViews(diagram).filter(
    (v) => v instanceof type.UMLSeqLifelineView,
  );
  if (lifelines.length === 0) return;
  const ownerOf = (end: View) =>
    lifelines.find((l) => l === end || end._parent === l);
  const order: View[] = [];
  const messages = edgeViewsOf(diagram).sort((a, b) => edgeY(a) - edgeY(b));
  for (const msg of messages) {
    for (const end of [msg.tail, msg.head] as View[]) {
      const l = ownerOf(end);
      if (l && !order.includes(l)) order.push(l);
    }
  }
  const rest = lifelines
    .filter((l) => !order.includes(l))
    .sort((a, b) => box(a).left - box(b).left);
  const wanted = [...order, ...rest];
  const current = [...lifelines].sort((a, b) => box(a).left - box(b).left);
  // A note's place says which lifeline it is about, so lifelines stay put
  // on a diagram with notes; otherwise they take their order in time, at
  // one pitch, when the build's order differs.
  const notes = nodeViews(diagram).some((v) => v instanceof type.UMLNoteView);
  // StarUML widens a lifeline to its name when it draws it, so heads the
  // build placed at one pitch can run into each other.
  const crowded = current.some(
    (l, i) =>
      i > 0 &&
      box(l).left <
        box(current[i - 1]!).left + box(current[i - 1]!).width + GAP / 2,
  );
  if (!notes && (crowded || wanted.some((l, i) => l !== current[i]))) {
    let x = box(current[0]!).left;
    for (const l of wanted) {
      m.move([l], Math.round(x - box(l).left), 0);
      x += box(l).width + GAP * 1.5;
    }
  }
  fitFragments(diagram, lifelines, m);
  const frame = (diagram.ownedViews as View[]).find(
    (v) => v.model === diagram && v instanceof type.UMLFrameView,
  );
  if (frame) {
    const inner = nodeViews(diagram);
    const right = Math.max(...inner.map((v) => box(v).left + box(v).width));
    const bottom = Math.max(...inner.map((v) => box(v).top + box(v).height));
    const f = box(frame);
    m.resize(frame, {
      left: f.left,
      top: f.top,
      width: Math.max(f.width, right - f.left + 20),
      height: Math.max(f.height, bottom - f.top + 20),
    });
  }
}

/**
 * Each combined fragment spans the lifelines of the messages it holds
 * (those whose line runs between its top and bottom), 30 beyond the
 * outermost, 10 further in per fragment around it: moving the lifelines
 * apart otherwise leaves a fragment over the wrong ones.
 */
export function fitFragments(
  diagram: Element,
  lifelines: View[],
  m: Mover,
): void {
  const fragments = nodeViews(diagram).filter(
    (v) => v instanceof type.UMLCombinedFragmentView,
  );
  const ownerOf = (end: View) =>
    lifelines.find((l) => l === end || end._parent === l);
  const messages = edgeViewsOf(diagram);
  for (const f of fragments) {
    const b = box(f);
    const inside = messages.filter((e) => {
      const y = edgeY(e);
      return y > b.top && y < b.top + b.height;
    });
    const held = inside
      .flatMap((e) => [ownerOf(e.tail as View), ownerOf(e.head as View)])
      .filter((l): l is View => l !== undefined);
    if (held.length === 0) continue;
    const outer = fragments.filter((g) => {
      const o = box(g);
      return (
        g !== f &&
        o.top <= b.top &&
        o.top + o.height >= b.top + b.height &&
        o.height > b.height
      );
    }).length;
    const left = Math.min(...held.map((l) => box(l).left)) - 30 + 10 * outer;
    const right =
      Math.max(...held.map((l) => box(l).left + box(l).width)) +
      30 -
      10 * outer;
    m.resize(f, { ...b, left, width: right - left });
  }
}

/** A message's height on the diagram: where its line runs. */
function edgeY(edge: View): number {
  const points = (edge.points as { points?: { y: number }[] } | null)?.points;
  return points && points.length > 0 ? points[0]!.y : 0;
}

/** The system boundary around its use cases, actors outside it on the left. */
function usecase(diagram: Element, m: Mover): void {
  const views = nodeViews(diagram);
  for (const subject of views.filter(
    (v) => v instanceof type.UMLUseCaseSubjectView,
  )) {
    const s = box(subject);
    const inside = (v: View) => {
      const c = centre(box(v));
      return (
        c.x > s.left &&
        c.x < s.left + s.width &&
        c.y > s.top &&
        c.y < s.top + s.height
      );
    };
    const cases = views.filter(
      (v) =>
        v instanceof type.UMLUseCaseView &&
        (v.containerView === subject || inside(v)),
    );
    if (cases.length > 0) {
      const left = Math.min(...cases.map((v) => box(v).left)) - GAP / 2;
      const top = Math.min(...cases.map((v) => box(v).top)) - GAP;
      const right =
        Math.max(...cases.map((v) => box(v).left + box(v).width)) + GAP / 2;
      const bottom =
        Math.max(...cases.map((v) => box(v).top + box(v).height)) + GAP / 2;
      m.resize(subject, {
        left: Math.min(s.left, left),
        top: Math.min(s.top, top),
        width: Math.max(s.left + s.width, right) - Math.min(s.left, left),
        height: Math.max(s.top + s.height, bottom) - Math.min(s.top, top),
      });
    }
    const b = box(subject);
    for (const actor of views.filter(
      (v) => v instanceof type.UMLActorView && inside(v),
    )) {
      const a = box(actor);
      m.move([actor], b.left - GAP - a.width - a.left, 0);
    }
  }
}

/**
 * Straight chains in a flow: a node with one way in, from a node with one
 * way out, lines up with it along the flow (decisions and merges keep
 * their branches apart).
 */
function alignChains(diagram: Element, vertical: boolean, m: Mover): void {
  const g = geometryOf(diagram);
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of g.edges) {
    out.set(e.ends[0], [...(out.get(e.ends[0]) ?? []), e.ends[1]]);
    into.set(e.ends[1], [...(into.get(e.ends[1]) ?? []), e.ends[0]]);
  }
  const byId = new Map(nodeViews(diagram).map((v) => [v._id, v]));
  for (const [from, tos] of out) {
    if (tos.length !== 1) continue;
    const to = tos[0]!;
    if (into.get(to)!.length !== 1 || to === from) continue;
    const [a, b] = [byId.get(from), byId.get(to)];
    if (!a || !b || a.containerView || b.containerView) continue;
    const [ca, cb] = [centre(box(a)), centre(box(b))];
    if (vertical) m.move([b], Math.round(ca.x - cb.x), 0);
    else m.move([b], 0, Math.round(ca.y - cb.y));
  }
}

/**
 * Where StarUML may put an edge's label (EdgeParasiticView in core/core.js
 * 7.1.1: at the head, middle or tail, `distance` from the edge at angle
 * `alpha`), in the order tried: the side away from the edge first, then
 * further out, then towards an end.
 */
const LABEL_SPOTS: { edgePosition: number; distance: number; alpha: number }[] =
  [1, 2, 0].flatMap((edgePosition) =>
    [15, 30, 45].flatMap((distance) =>
      [Math.PI / 2, -Math.PI / 2].map((alpha) => ({
        edgePosition,
        distance,
        alpha,
      })),
    ),
  );

/**
 * Each edge label printed over text, crossed by an edge or far from its
 * edge tried at the other spots StarUML offers; the first that raises the
 * score stays.
 */
export function placeLabels(
  diagram: Element,
  score: () => number,
  strip: () => boolean,
  m: Mover,
): void {
  // A label pushed out past the drawing's edge may make a strip of it.
  const wasStrip = strip();
  for (const id of labelProblems(geometryOf(diagram))) {
    const label = app.repository.get(id) as View;
    const was = {
      edgePosition: label.edgePosition,
      distance: label.distance,
      alpha: label.alpha,
    };
    let best = score();
    for (const spot of LABEL_SPOTS) {
      if (
        spot.edgePosition === was.edgePosition &&
        spot.distance === was.distance &&
        spot.alpha === was.alpha
      ) {
        continue;
      }
      const r = record();
      for (const [field, value] of Object.entries(spot)) {
        m.assign(label, field, value);
      }
      app.diagrams.repaint();
      const now = score();
      if (now > best && (wasStrip || !strip())) {
        best = now;
        r.stop();
        if (!labelProblems(geometryOf(diagram)).includes(id)) break;
      } else r.revert();
    }
  }
}

/**
 * Edges drawn along another edge to a different end, straightened: a
 * rectilinear router sends fan-outs through one bus line, where no reader
 * can follow which line goes where (ThingsBoard's rule engine: 26 pairs).
 * Edges into one target keep their shared trunk.
 */
export function unbundle(diagram: Element): void {
  const g = geometryOf(diagram);
  const views = new Map(edgeViewsOf(diagram).map((e) => [e._id, e]));
  const straighten = sharedEdges(g).filter(
    (id) => views.get(id)!.lineStyle === LINE_STYLES.rectilinear,
  );
  if (straighten.length === 0) return;
  inStarUML(() =>
    app.engine.setLineStyle(
      editorShowing(diagram),
      straighten.map((id) => views.get(id)!),
      LINE_STYLES.oblique,
    ),
  );
}

/** Lanes widened and lengthened to hold their nodes, the lanes after them moved over. */
export function fitLanes(diagram: Element, m: Mover): void {
  const lanes = nodeViews(diagram)
    .filter((v) => /Swimlane|Partition/.test(v.constructor.name))
    .sort((a, b) => box(a).left - box(b).left);
  if (lanes.length === 0) return;
  const nodes = nodeViews(diagram).filter(
    (v) => !AREA.test(v.constructor.name),
  );
  const PAD = 20;
  const members = new Map(lanes.map((l) => [l, [] as View[]]));
  for (const v of nodes) {
    const lane = laneOf(diagram, v);
    if (lane) members.get(lane)!.push(v);
  }
  let shift = 0;
  for (const lane of lanes) {
    const own = members.get(lane)!;
    // A copy: box() is the view itself, which the resize below changes.
    const l = { ...box(lane) };
    const left = l.left + shift;
    if (shift !== 0) m.move(own, shift, 0);
    for (const v of own) {
      const b = box(v);
      if (b.left < left + PAD) m.move([v], Math.round(left + PAD - b.left), 0);
    }
    const right = Math.max(
      left + l.width,
      ...own.map((v) => box(v).left + box(v).width + PAD),
    );
    m.resize(lane, { ...l, left, width: Math.round(right - left) });
    shift = Math.round(right - (l.left + l.width));
  }
  const bottom = Math.max(...nodes.map((v) => box(v).top + box(v).height)) + 40;
  for (const lane of lanes) {
    const l = box(lane);
    if (l.top + l.height < bottom)
      m.resize(lane, { ...l, height: bottom - l.top });
  }
}

/** The preset that lays the same ranks out across the other axis. */
const TURNED: Record<LayoutPresetName, LayoutPresetName> = {
  "flow-down": "flow-right",
  "flow-up": "flow-left",
  "flow-right": "flow-down",
  "flow-left": "flow-up",
  "hierarchy-down": "hierarchy-right",
  "hierarchy-up": "hierarchy-left",
  "hierarchy-right": "hierarchy-down",
  "hierarchy-left": "hierarchy-up",
};

/**
 * A wide drawing's widest rows broken into staggered sub-rows, the rows
 * below moved down to make room: the hierarchy stays top to bottom where
 * folding would cut it, and eight subclasses under one interface become
 * three short rows rather than one 1600 wide.
 */
export function wrapRows(diagram: Element, m: Mover): void {
  const views = solids(diagram);
  const g = measure(geometryOf(diagram));
  if (views.length < 2 || g.width <= g.height) return;
  const width = g.width / Math.ceil(g.aspect / 1.5);
  let pushed = 0;
  for (const row of rows(views)) {
    if (pushed !== 0) m.move(row, 0, pushed);
    const sorted = [...row].sort((a, b) => box(a).left - box(b).left);
    const left = box(sorted[0]!).left;
    const span = box(sorted.at(-1)!).left + box(sorted.at(-1)!).width - left;
    if (span <= width || sorted.length < 2) continue;
    const pitch = Math.max(...sorted.map((v) => box(v).height)) + GAP;
    const chunks: View[][] = [[]];
    let x = 0;
    for (const v of sorted) {
      if (x > 0 && x + box(v).width > width) {
        chunks.push([]);
        x = 0;
      }
      chunks.at(-1)!.push(v);
      x += box(v).width + GAP;
    }
    chunks.forEach((chunk, j) => {
      // Every other sub-row half a cell over, so lines from the lower ones
      // pass between the boxes above.
      let at = left + (j % 2 === 1 ? GAP * 2 : 0);
      for (const v of chunk) {
        m.move([v], Math.round(at - box(v).left), Math.round(j * pitch));
        at += box(v).width + GAP;
      }
    });
    pushed += (chunks.length - 1) * pitch;
  }
  straighten(diagram, new Set(views), m);
}

/**
 * A strip made into a picture: laid out again across the other axis
 * (eight rule nodes under one interface are a row 1608 wide in ranks down,
 * a column beside it in ranks right), folded into bands, or both. Each is
 * tried and undone; the one kept is the best scored of those within
 * maxAspect, else the least strip-like.
 */
export function unstrip(
  diagram: Element,
  preset: LayoutPresetName | null,
  limits: Required<Limits>,
  score: () => number,
  m: Mover,
): void {
  const maxAspect = limits.maxAspect;
  // Laid out again, the edges' labels need the room the build gave them.
  const labels = geometryOf(diagram).nodes.filter((n) => n.edge !== undefined);
  const widest = Math.max(0, ...labels.map((l) => l.width));
  const turn = () =>
    applyLayout(diagram, {
      preset: TURNED[preset!],
      fit: true,
      ...labelSeparations(widest, TURNED[preset!]),
    });
  const ways: (() => void)[] = [
    () => fold(diagram, limits, m),
    () => wrapRows(diagram, m),
    ...(preset
      ? [
          turn,
          () => {
            turn();
            fold(diagram, limits, m);
          },
        ]
      : []),
  ];
  const tried = ways.map((way, i) => {
    const r = record();
    way();
    app.diagrams.repaint();
    const result = {
      i,
      aspect: measure(geometryOf(diagram)).aspect,
      score: score(),
    };
    r.revert();
    return result;
  });
  const now = score();
  const within = tried.filter((t) => t.aspect <= maxAspect);
  // Just past the limit, a relayout that loses more than 15 points is a
  // worse picture than the slightly wide one (ThingsBoard's transport
  // classes: 84 at 3.05:1, 69 turned).
  if (
    measure(geometryOf(diagram)).aspect <= maxAspect * 1.15 &&
    within.every((t) => t.score < now - 15)
  ) {
    return;
  }
  // Sorting is stable: of equals, the way tried first.
  const best =
    within.length > 0
      ? within.sort((a, b) => b.score - a.score)[0]!
      : tried.sort((a, b) => a.aspect - b.aspect)[0]!;
  ways[best.i]!();
}

/** Kinds whose long axis means something: time on a sequence or timing diagram, a mind map's tree. */
const UNFOLDED = new Set<Kind | null>(["sequence", "timing", "mindmap"]);

/** Whether a strip of this diagram may be folded: not along time or a tree, nothing held in lanes or a boundary. */
function foldable(diagram: Element, kind: Kind | null): boolean {
  return !UNFOLDED.has(kind) && !placedByBuild(diagram, null);
}

/**
 * Edges of moved boxes drawn again from end to end: moveViews carries an
 * edge's bends along only when both its ends move by the same offset, so
 * an edge into a mirrored or another band kept the bends of the strip it
 * left (curves looping out to where the boxes had been).
 */
function straighten(diagram: Element, moved: ReadonlySet<View>, m: Mover) {
  for (const e of edgeViewsOf(diagram)) {
    if (
      !moved.has(ownerNode(e.tail as View)) &&
      !moved.has(ownerNode(e.head as View))
    ) {
      continue;
    }
    // An edge drawn straight, or not drawn yet, has no bends to drop.
    const points = e.points as
      { points?: Point[]; copy(): { points: Point[] } } | null | undefined;
    if ((points?.points?.length ?? 0) <= 2) continue;
    // One bend, half way: a curve is drawn through its middle points and
    // throws on fewer than three (EdgeView.drawObject, core/core.js 7.1.1);
    // a rectilinear edge is routed again from it.
    const next = points!.copy();
    const [a, b] = [next.points[0]!, next.points.at(-1)!];
    const mid = next.points[1]!;
    mid.x = Math.round((a.x + b.x) / 2);
    mid.y = Math.round((a.y + b.y) / 2);
    next.points.splice(2, next.points.length - 3);
    m.modifyEdge(e, next);
  }
}

/** Gap between the bands a folded strip is cut into. */
const BAND_GAP = 80;

/**
 * Where a strip can be cut across its long axis without cutting a box:
 * the middles of the gaps between the boxes' merged extents.
 */
function cuts(spans: readonly [number, number][]): number[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  let end = sorted[0]![1];
  for (const [from, to] of sorted.slice(1)) {
    if (from > end) out.push((from + end) / 2);
    end = Math.max(end, to);
  }
  return out;
}

/**
 * A strip longer than the profile's maxAspect folded into bands, the way
 * text wraps: cut where no box is cut, the bands stacked across the long
 * axis, every other band mirrored so a chain runs on where the band
 * before it ended (a state machine reads as a snake rather than a row
 * 3552 px wide). The number of bands is the one that comes closest to the
 * page's own aspect without passing maxAspect.
 */
export function fold(
  diagram: Element,
  limits: Required<Limits>,
  m: Mover,
): void {
  const views = nodeViews(diagram).filter((v) => !v.containerView);
  const g = measure(geometryOf(diagram));
  const maxAspect = limits.maxAspect;
  if (views.length < 2 || g.aspect <= maxAspect) return;
  const wide = g.width >= g.height;
  // Along the strip's long axis: a box's start, its length, its extent across.
  const along = (v: View) => (wide ? box(v).left : box(v).top);
  const size = (v: View) => (wide ? box(v).width : box(v).height);
  const across = (v: View) => (wide ? box(v).top : box(v).left);
  const depth = (v: View) => (wide ? box(v).height : box(v).width);
  const places = cuts(views.map((v) => [along(v), along(v) + size(v)]));
  const start = Math.min(...views.map(along));
  const end = Math.max(...views.map((v) => along(v) + size(v)));
  const target =
    Math.max(limits.width, limits.height) /
    Math.min(limits.width, limits.height);
  type Band = {
    views: View[];
    from: number;
    to: number;
    lo: number;
    hi: number;
  };
  const bandsFor = (k: number): Band[] => {
    const chosen: number[] = [];
    for (let i = 1; i < k; i++) {
      const ideal = start + ((end - start) * i) / k;
      const best = places
        .filter((c) => c > (chosen.at(-1) ?? -Infinity))
        .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
      if (best !== undefined) chosen.push(best);
    }
    const edges = [-Infinity, ...chosen, Infinity];
    // Every cut lies in a gap between boxes, so each band holds some.
    return edges.slice(1).map((to, i) => {
      const inBand = views.filter((v) => {
        const c = along(v) + size(v) / 2;
        return c > edges[i]! && c < to;
      });
      return {
        views: inBand,
        from: Math.min(...inBand.map(along)),
        to: Math.max(...inBand.map((v) => along(v) + size(v))),
        lo: Math.min(...inBand.map(across)),
        hi: Math.max(...inBand.map((v) => across(v) + depth(v))),
      };
    });
  };
  const shape = (bands: Band[]) => {
    const long = Math.max(...bands.map((b) => b.to - b.from));
    const thick =
      bands.reduce((n, b) => n + b.hi - b.lo, 0) +
      BAND_GAP * (bands.length - 1);
    return Math.max(long, thick) / Math.min(long, thick);
  };
  let best: Band[] | null = null;
  for (let k = 2; k <= Math.min(8, places.length + 1); k++) {
    const bands = bandsFor(k);
    const a = shape(bands);
    const fits = (b: Band[]) => shape(b) <= maxAspect;
    if (
      best === null ||
      (fits(bands) && !fits(best)) ||
      (fits(bands) === fits(best) &&
        Math.abs(a - target) < Math.abs(shape(best) - target))
    ) {
      best = bands;
    }
  }
  if (best === null) return;
  let offset = Math.min(...views.map(across));
  best.forEach((band, i) => {
    for (const v of band.views) {
      // Odd bands run back the other way, so the flow turns rather than jumps.
      const pos =
        i % 2 === 1 ? band.to - (along(v) - band.from) - size(v) : along(v);
      const d = Math.round(start + (pos - band.from) - along(v));
      const e = Math.round(offset + (across(v) - band.lo) - across(v));
      m.move([v], wide ? d : e, wide ? e : d);
    }
    offset += band.hi - band.lo + BAND_GAP;
  });
  straighten(diagram, new Set(views), m);
}

/** The preset a kind is laid out with: asked, the profile's, else the build's default. */
function presetOf(
  kind: Kind | null,
  profile: Profile,
  asked: LayoutPresetName | undefined,
): LayoutPresetName {
  return (
    asked ??
    (kind ? presetFor(profile, kind) : undefined) ??
    (kind === "class" || kind === "package" ? "hierarchy-down" : "flow-down")
  );
}

/** Whether a kind's flow runs down (else to the right), by its preset. */
function vertical(kind: Kind, profile: Profile): boolean {
  const preset = presetFor(profile, kind);
  const direction =
    preset === undefined ? "BT" : LAYOUT_PRESETS[preset].direction;
  return direction === "TB" || direction === "BT";
}

// --------------------------------------------------------------- the loop

export interface QualityOptions {
  /** Score to stop at; the profile's threshold for the kind by default. */
  target?: number;
  maxIterations?: number;
  /** Run the layout preset first (an existing diagram; a build has just run it). */
  relayout?: boolean;
  preset?: LayoutPresetName;
}

export interface QualityFinding {
  rule: string;
  name: string;
  severity: (typeof SEVERITIES)[number];
  count: number;
}

export interface Quality {
  score: number;
  rating: number;
  /** The score before the loop. */
  before: number;
  target: number;
  passes: boolean;
  iterations: number;
  /** Steps that were kept, in order. */
  steps: string[];
  findings: QualityFinding[];
  /** Hard limits broken (aspect, size): the diagram fails whatever its score. */
  failures?: string[];
}

/** The score and the /lint_diagram findings of a diagram as it is. */
export function assess(diagram: Element, profile: Profile) {
  const metrics = measure(geometryOf(diagram));
  const limits = limitsFor(profile);
  const score = scoreOf(metrics, limits);
  const counts = new Map<LayoutRule, number>();
  const lint = lintLayout(
    diagram,
    new Set(Object.keys(LAYOUT_RULES) as LayoutRule[]),
  );
  for (const f of lint) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const findings: QualityFinding[] = [...counts].map(([rule, count]) => ({
    rule,
    name: LAYOUT_RULES[rule],
    severity: lint.find((f) => f.rule === rule)!.severity,
    count,
  }));
  return { metrics, score, findings, failures: failures(metrics, limits) };
}

/** The loop's answer for a built diagram left as it is: its score, no steps. */
export function scoredAsIs(diagram: Element, profile: Profile): Quality {
  const { score, findings, failures } = assess(diagram, profile);
  // Only a build calls it, and a build's diagram is of a kind it builds.
  const target = thresholdFor(profile, kindOf(diagram)!);
  return {
    score,
    rating: ratingOf(score),
    before: score,
    target,
    passes: score >= target && failures.length === 0,
    iterations: 0,
    steps: [],
    findings,
    ...(failures.length > 0 && { failures }),
  };
}

const AUTOFIXED = new Set<LayoutRule>(["L001", "L002", "L003", "L004", "L005"]);

/**
 * Runs the loop on `diagram`. Synchronous: every change is an engine call,
 * recorded on the undo stack, so a caller wraps it in one step.
 */
export function improve(
  diagram: Element,
  profile: Profile,
  options: QualityOptions = {},
): Quality {
  const kind = kindOf(diagram);
  const m = new Mover(diagram);
  const limits = limitsFor(profile);
  // Edge labels take their place when the diagram is drawn (EdgeLabelView
  // arranges itself on repaint, core/core.js 7.1.1); measured before that,
  // a label sits where the edge was, and a borderline strip reads either
  // side of maxAspect from one run to the next.
  editorShowing(diagram);
  const score = () => {
    app.diagrams.repaint();
    return scoreOf(measure(geometryOf(diagram)), limits);
  };
  const target =
    options.target ??
    (kind ? thresholdFor(profile, kind) : profile.quality.minScore);
  const max = options.maxIterations ?? profile.quality.maxIterations;
  const placed = placedByBuild(diagram, kind);
  const steps: string[] = [];
  const before = score();
  // Two states side by side are no strip: past maxAspect only counts once
  // the long side passes half the page's short one.
  const strip = () => {
    app.diagrams.repaint();
    const g = measure(geometryOf(diagram));
    return (
      g.aspect > limits.maxAspect &&
      Math.max(g.width, g.height) > Math.min(limits.width, limits.height) / 2
    );
  };
  /**
   * Runs one step and keeps it only if the score did not drop; a rule of
   * the notation (lifelines in time order, actors outside the boundary) is
   * kept whatever the score says.
   */
  const attempt = (name: string, step: () => void, rule = false) => {
    const recording = record();
    const s0 = score();
    let changed = false;
    const listener = () => (changed = true);
    app.repository.on("operationExecuted", listener);
    try {
      step();
    } finally {
      app.repository.off("operationExecuted", listener);
    }
    if (!rule && score() < s0) recording.revert();
    else {
      recording.stop();
      if (changed) steps.push(name);
    }
  };
  if (options.relayout && !placed && solids(diagram).length > 1) {
    const preset = presetOf(kind, profile, options.preset);
    attempt(`layout ${preset}`, () =>
      applyLayout(diagram, { preset, fit: true }),
    );
  }
  /**
   * Boxes an edge runs through step aside, each by the smallest of a few
   * moves that raises the score and keeps the box in its lane.
   */
  const dodge = () => {
    for (const f of lintLayout(diagram, new Set<LayoutRule>(["L004"]))) {
      const view = app.repository.get(f.ids[1]!) as View;
      // A port or pin sits on its holder's border and moves with it.
      if (/Port|Pin/.test(view.constructor.name)) continue;
      const holder = view.containerView as View | null;
      const b = box(view);
      const lane = laneOf(diagram, view);
      for (const [dx, dy] of [
        [b.width / 2 + GAP / 2, 0],
        [-(b.width / 2 + GAP / 2), 0],
        [b.width + GAP, 0],
        [-(b.width + GAP), 0],
        [0, b.height + GAP],
      ] as const) {
        const s0 = score();
        const r = record();
        m.move([view], Math.round(dx), Math.round(dy));
        if (
          score() > s0 &&
          laneOf(diagram, view) === lane &&
          (!holder || insideBox(view, holder))
        ) {
          r.stop();
          break;
        }
        r.revert();
      }
    }
  };
  let iterations = 0;
  while (iterations < max) {
    iterations++;
    const start = score();
    attempt("fit labels", () => fitLabels(diagram, profile, m));
    if (kind === "sequence") {
      attempt("lifelines", () => sequence(diagram, m), true);
    } else if (kind === "usecase") {
      attempt("boundary", () => usecase(diagram, m), true);
    } else if (placed) {
      // Lanes and a mind map's tree carry meaning in where nodes sit.
    } else if (
      kind === "activity" ||
      kind === "statemachine" ||
      kind === "flowchart"
    ) {
      // A chain drawn straight is how a flow reads; the score, which
      // weighs alignment lightly since the calibration, would let a 37 unit
      // kink stand.
      attempt(
        "align chains",
        () => alignChains(diagram, vertical(kind, profile), m),
        true,
      );
    } else {
      attempt("order ranks", () => orderRanks(diagram, m));
    }
    // Where a note sits on a sequence diagram says which lifeline it is
    // about, and a lane says who acts; a placed diagram keeps its boxes.
    if (placed && kind === "activity") {
      attempt("separate in lanes", () => separateInLanes(diagram, m));
    }
    if (kind !== "sequence" && kind !== "mindmap") {
      attempt("dodge", dodge);
    }
    if (!placed) {
      attempt("separate", () => separate(diagram, m));
      attempt("autofix", () => autofix(diagram, iterations > 1, m));
      if (
        (kind === "class" || kind === "package") &&
        iterations === 1 &&
        measure(geometryOf(diagram)).nodeEdgeCrossings > 0
      ) {
        // Edges through boxes on a class diagram's layout are long edges
        // StarUML routes straight; more room between ranks and nodes
        // often frees them.
        attempt("spread", () =>
          applyLayout(diagram, {
            preset: presetOf(kind, profile, options.preset),
            fit: true,
            nodeSeparation: 100,
            rankSeparation: 120,
          }),
        );
      }
      attempt("snap", () => snap(diagram, profile, m));
      attempt("trim", () => trim(diagram, m));
    }
    // A node across a lane's border belongs to neither lane.
    attempt("fit lanes", () => fitLanes(diagram, m), true);
    if (kind !== "sequence") {
      attempt("unbundle", () => unbundle(diagram));
      attempt("place labels", () => placeLabels(diagram, score, strip, m));
    }
    // Last, so nothing after it widens the drawing again; a strip is a rule
    // broken, not a matter of taste, so this is kept whatever the finer
    // measures say.
    if (foldable(diagram, kind) && strip()) {
      attempt(
        "unstrip",
        () =>
          unstrip(
            diagram,
            placed ? null : presetOf(kind, profile, options.preset),
            limits,
            score,
            m,
          ),
        true,
      );
      // A foldable diagram is never a sequence diagram.
      attempt("unbundle", () => unbundle(diagram));
      attempt("place labels", () => placeLabels(diagram, score, strip, m));
    }
    const now = score();
    if (now >= target || now <= start) break;
  }
  app.diagrams.repaint();
  const after = assess(diagram, profile);
  return {
    score: after.score,
    rating: ratingOf(after.score),
    before,
    target,
    passes: after.score >= target && after.failures.length === 0,
    iterations,
    steps,
    findings: after.findings,
    ...(after.failures.length > 0 && { failures: after.failures }),
  };
}

/** /lint_diagram's autofixes for the geometry rules, relayouts only when allowed. */
export function autofix(diagram: Element, noRelayout: boolean, m: Mover): void {
  const findings = lintLayout(diagram, AUTOFIXED);
  let relaid = false;
  for (const f of findings) {
    // Every geometry rule's finding carries a request that fixes it.
    const fix = f.autofix!;
    const b = fix.body;
    if (fix.path === "/layout_diagram") {
      if (noRelayout || relaid) continue;
      relaid = true;
      applyLayout(diagram, { preset: "hierarchy-down", fit: true });
    } else if (fix.path === "/move_views") {
      const view = app.repository.get((b.refs as string[])[0]!) as View;
      m.move([view], b.dx as number, b.dy as number);
    } else {
      const view = app.repository.get(b.ref as string) as View;
      m.resize(view, { ...box(view), width: b.width as number });
    }
  }
}

export const qualitySchema = () =>
  doc(
    z.object({
      score: doc(z.int(), "0–100 from view geometry, see /diagram_quality."),
      rating: doc(z.int(), "1–5; 4 needs a score of 80."),
      before: doc(z.int(), "The score before the loop."),
      target: z.int(),
      passes: doc(z.boolean(), "score reached target."),
      iterations: z.int(),
      steps: doc(z.array(z.string()), "Post-processing steps kept, in order."),
      findings: doc(
        z.array(
          z.object({
            rule: z.string(),
            name: z.string(),
            severity: z.enum(SEVERITIES),
            count: z.int(),
          }),
        ),
        "/lint_diagram findings left, by rule.",
      ),
      failures: z.optional(
        doc(
          z.array(z.string()),
          "Hard limits broken: aspect past the profile's maxAspect on a diagram larger than the page, more boxes than maxNodes.",
        ),
      ),
    }),
    "The quality loop's result: layout preset, post-processing, lint, autofix, re-lint (issue #32).",
  );

export type { Metrics };
