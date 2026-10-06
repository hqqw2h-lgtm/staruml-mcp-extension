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
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireDiagram } from "../lookup.js";
import { pathOf } from "../refs.js";
import { elementSchema, ref } from "../schemas.js";
import { serialize } from "../serialize.js";
import { offProfile, styledViews } from "../style/apply.js";
import { effectiveProfile, type Profile } from "../style/profile.js";
import type { Element, View } from "../types.js";

/*
 * /lint_diagram reads a diagram's geometry the way a reviewer looks at the
 * picture: boxes on top of each other, lines through unrelated boxes, names
 * wider than their box. Each finding carries a request that fixes it.
 */

export const SEVERITIES = ["error", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const LAYOUT_RULES = {
  L001: "stacked",
  L002: "overlap",
  L003: "out-of-canvas",
  L004: "edge-crosses-node",
  L005: "label-overflow",
  L006: "disconnected",
  L007: "dense",
  L008: "too-many-elements",
  L009: "off-profile",
} as const;
export type LayoutRule = keyof typeof LAYOUT_RULES;

/** Request that fixes a finding, as the endpoint takes it. */
export interface Autofix {
  path: string;
  body: Record<string, unknown>;
}

export interface LayoutFinding {
  rule: LayoutRule;
  name: string;
  severity: Severity;
  message: string;
  ids: string[];
  paths: (string | null)[];
  fix: string;
  autofix: Autofix | null;
}

interface Box {
  view: View;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Views that stand for an area rather than a thing: they hold other views
 * or span them by design (a combined fragment over lifelines, a lane, a
 * system boundary, a frame), so overlapping them is not a defect.
 */
const AREA =
  /Frame|Subject|Swimlane|Partition|CombinedFragment|Operand|Region|Boundary|Lane|Pool/;
/** Messages run across every lifeline between their ends. */
const PASSED_THROUGH = /Lifeline/;
/** Views drawing their name outside the shape (an actor's under its figure). */
export const NAME_OUTSIDE =
  /Actor|Pseudostate|InitialState|FinalState|Port|Pin|Point/;

/** Arial 13px, StarUML's default font, averages under 7px per character. */
const CHAR_WIDTH = 7;
const LABEL_PADDING = 20;
/** A cell of the density grid and the node centres that make it crowded. */
const CELL = 300;
const CROWDED = 7;
const GAP = 20;

const kind = (v: View) => v.constructor.name;
/** NodeView keeps left, top, width and height as numbers (core/core.js). */
function boxOf(view: View): Box {
  const [left, top, width, height] = [
    view.left,
    view.top,
    view.width,
    view.height,
  ] as number[];
  return { view, left, top, right: left + width, bottom: top + height };
}

/** Node views drawn on their own: no sub-views, no hidden ones, no diagram frame. */
function nodeBoxes(diagram: Element): Box[] {
  return (diagram.ownedViews as View[])
    .filter(
      (v) =>
        v instanceof type.NodeView &&
        v.visible !== false &&
        !(v.model instanceof type.Diagram),
    )
    .map(boxOf);
}

function edgeViews(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) => v instanceof type.EdgeView && v.visible !== false,
  );
}

const inside = (a: Box, b: Box) =>
  a.left >= b.left &&
  a.top >= b.top &&
  a.right <= b.right &&
  a.bottom <= b.bottom;

/** Whether `a` is held by `b`: drawn inside it, or its container chain reaches it. */
function heldBy(a: Box, b: Box): boolean {
  if (inside(a, b)) return true;
  for (
    let c = a.view.containerView as View | null | undefined;
    c;
    c = c.containerView as View | null | undefined
  ) {
    if (c === b.view) return true;
  }
  return false;
}

const area = (b: Box) => AREA.test(kind(b.view));

/** The polyline an edge is drawn along: its points, else centre to centre. */
export function edgePoints(edge: View): { x: number; y: number }[] {
  const points = (edge.points as { points?: { x: number; y: number }[] })
    ?.points;
  if (Array.isArray(points) && points.length >= 2) return points;
  const centre = (v: unknown) => {
    const b = boxOf(v as View);
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  };
  return [centre(edge.tail), centre(edge.head)];
}

/**
 * Whether the segment p–q passes through the inside of `box`, shrunk by
 * 2px so an edge running along a border or ending on it does not count
 * (Liang–Barsky clipping).
 */
export function crosses(
  p: { x: number; y: number },
  q: { x: number; y: number },
  box: { left: number; top: number; right: number; bottom: number },
): boolean {
  const [x0, y0, x1, y1] = [
    box.left + 2,
    box.top + 2,
    box.right - 2,
    box.bottom - 2,
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

/** The widest line of a name in px, by the average character width. */
export function labelWidth(name: string): number {
  const widest = Math.max(...name.split("\n").map((l) => l.length));
  return widest * CHAR_WIDTH + LABEL_PADDING;
}

/** The view and everything drawn inside it, for edge ends. */
function attached(edge: View, box: Box): boolean {
  for (const end of [edge.tail, edge.head] as (View | null)[]) {
    for (let v: View | null | undefined = end; v; v = v._parent as View) {
      if (v === box.view) return true;
      if (!(v._parent instanceof type.View)) break;
    }
  }
  return false;
}

class Findings {
  readonly list: LayoutFinding[] = [];
  constructor(
    private readonly enabled: ReadonlySet<LayoutRule>,
    private readonly diagram: Element,
  ) {}
  on(rule: LayoutRule): boolean {
    return this.enabled.has(rule);
  }
  add(
    rule: LayoutRule,
    severity: Severity,
    views: View[],
    message: string,
    fix: string,
    autofix: Autofix | null,
  ): void {
    this.list.push({
      rule,
      name: LAYOUT_RULES[rule],
      severity,
      message,
      ids: views.map((v) => v._id),
      paths: views.map(pathOf),
      fix,
      autofix,
    });
  }
  relayout(options: Record<string, unknown> = {}): Autofix {
    return {
      path: "/layout_diagram",
      body: { diagram: this.diagram._id, ...options },
    };
  }
}

const label = (v: View) => {
  const name = v.model?.name;
  return typeof name === "string" && name
    ? `"${name.replace(/\n/g, " ")}"`
    : kind(v);
};

function stacked(f: Findings, boxes: Box[]): Set<View> {
  const byOrigin = new Map<string, Box[]>();
  for (const b of boxes) {
    const key = `${Math.round(b.left)},${Math.round(b.top)}`;
    byOrigin.set(key, [...(byOrigin.get(key) ?? []), b]);
  }
  const seen = new Set<View>();
  for (const [origin, group] of byOrigin) {
    if (group.length < 2) continue;
    for (const b of group) seen.add(b.view);
    f.add(
      "L001",
      "error",
      group.map((b) => b.view),
      `${group.length} views start at the same point (${origin}): ${group.map((b) => label(b.view)).join(", ")}`,
      "Lay the diagram out again.",
      f.relayout(),
    );
  }
  return seen;
}

function overlaps(f: Findings, boxes: Box[], skip: Set<View>): void {
  const solid = boxes.filter((b) => !area(b));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const [a, b] = [solid[i]!, solid[j]!];
      if (skip.has(a.view) && skip.has(b.view)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= 1 || h <= 1 || heldBy(a, b) || heldBy(b, a)) continue;
      f.add(
        "L002",
        "warning",
        [a.view, b.view],
        `${label(a.view)} and ${label(b.view)} overlap by ${Math.round(w)}x${Math.round(h)}`,
        `Move ${label(b.view)} ${Math.round(w + GAP)} to the right, or lay the diagram out again.`,
        {
          path: "/move_views",
          body: { refs: [b.view._id], dx: Math.round(w + GAP), dy: 0 },
        },
      );
    }
  }
}

function outOfCanvas(f: Findings, boxes: Box[]): void {
  for (const b of boxes) {
    if (b.left >= 0 && b.top >= 0) continue;
    const dx = b.left < 0 ? Math.round(GAP - b.left) : 0;
    const dy = b.top < 0 ? Math.round(GAP - b.top) : 0;
    f.add(
      "L003",
      "warning",
      [b.view],
      `${label(b.view)} starts outside the canvas at (${Math.round(b.left)}, ${Math.round(b.top)})`,
      `Move it by (${dx}, ${dy}).`,
      { path: "/move_views", body: { refs: [b.view._id], dx, dy } },
    );
  }
}

function crossings(f: Findings, boxes: Box[], edges: View[]): void {
  const obstacles = boxes.filter(
    (b) => !area(b) && !PASSED_THROUGH.test(kind(b.view)),
  );
  for (const edge of edges) {
    const points = edgePoints(edge);
    for (const b of obstacles) {
      if (attached(edge, b)) continue;
      const ends = [edge.tail, edge.head].map((e) => boxOf(e as View));
      if (ends.some((e) => heldBy(e, b))) continue;
      if (!points.some((p, i) => i > 0 && crosses(points[i - 1]!, p, b))) {
        continue;
      }
      f.add(
        "L004",
        "warning",
        [edge, b.view],
        `The ${kind(edge)} from ${label(edge.tail as View)} to ${label(edge.head as View)} runs through ${label(b.view)}`,
        "Lay the diagram out again, or move the node off the line.",
        f.relayout(),
      );
    }
  }
}

function overflows(f: Findings, boxes: Box[]): void {
  for (const b of boxes) {
    const name = b.view.model?.name;
    if (typeof name !== "string" || !name || NAME_OUTSIDE.test(kind(b.view))) {
      continue;
    }
    // A view with wordWrap breaks its name over lines (the style profile's
    // labelWrap turns it on for long names), so its width is not the limit.
    if (b.view.wordWrap === true) continue;
    const width = labelWidth(name);
    if (width <= b.right - b.left) continue;
    f.add(
      "L005",
      "warning",
      [b.view],
      `The name of ${label(b.view)} needs about ${width}px and its box is ${Math.round(b.right - b.left)}px wide, so it wraps or is cut`,
      `Widen it to ${width}.`,
      {
        path: "/resize_node",
        body: {
          ref: b.view._id,
          width,
          height: Math.round(b.bottom - b.top),
        },
      },
    );
  }
}

function disconnected(f: Findings, boxes: Box[], edges: View[]): void {
  if (edges.length === 0) return;
  for (const b of boxes) {
    if (!b.view.model || area(b)) continue;
    if (edges.some((e) => attached(e, b))) continue;
    if (boxes.some((o) => o !== b && heldBy(o, b))) continue;
    f.add(
      "L006",
      "info",
      [b.view],
      `${label(b.view)} has no edge on this diagram`,
      "Connect it, or show it on a diagram where it relates to something.",
      null,
    );
  }
}

function dense(f: Findings, boxes: Box[]): void {
  const cells = new Map<string, Box[]>();
  for (const b of boxes) {
    if (area(b)) continue;
    const cx = Math.floor((b.left + b.right) / 2 / CELL);
    const cy = Math.floor((b.top + b.bottom) / 2 / CELL);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), b]);
  }
  for (const [cell, group] of cells) {
    if (group.length < CROWDED) continue;
    const [cx, cy] = cell.split(",").map((n) => Number(n) * CELL);
    f.add(
      "L007",
      "info",
      group.map((b) => b.view),
      `${group.length} nodes are centred in the ${CELL}x${CELL} area at (${cx}, ${cy})`,
      "Lay the diagram out with more spacing.",
      f.relayout({ nodeSeparation: 60, rankSeparation: 80 }),
    );
  }
}

/** More nodes than the style profile's layout.maxElements: suggest a split. */
function tooMany(f: Findings, boxes: Box[], profile: Profile): void {
  const nodes = boxes.filter((b) => b.view.model && !area(b));
  const max = profile.layout.maxElements;
  if (nodes.length <= max) return;
  f.add(
    "L008",
    "info",
    nodes.map((b) => b.view),
    `${nodes.length} nodes, more than the ${max} the style profile '${profile.name}' allows on one diagram`,
    `Split it, e.g. one diagram per package (/derive_diagrams does), or raise layout.maxElements.`,
    null,
  );
}

/** Views off the profile's look; an error under a strict profile. */
function offStyle(f: Findings, diagram: Element, profile: Profile): void {
  const off = styledViews(diagram).filter(
    (v) => offProfile(v, profile).length > 0,
  );
  if (off.length === 0) return;
  const fields = [...new Set(off.flatMap((v) => offProfile(v, profile)))];
  f.add(
    "L009",
    profile.strict ? "error" : "warning",
    off,
    `${off.length} view(s) are drawn off the style profile '${profile.name}' (${fields.join(", ")})`,
    "Apply the profile to the diagram.",
    {
      path: "/apply_style_profile",
      body: { scope: diagram._id, names: false },
    },
  );
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function lintLayout(
  diagram: Element,
  enabled: ReadonlySet<LayoutRule>,
): LayoutFinding[] {
  const f = new Findings(enabled, diagram);
  const boxes = nodeBoxes(diagram);
  const edges = edgeViews(diagram).filter((e) => e.tail && e.head);
  const piled = f.on("L001") ? stacked(f, boxes) : new Set<View>();
  if (f.on("L002")) overlaps(f, boxes, piled);
  if (f.on("L003")) outOfCanvas(f, boxes);
  if (f.on("L004")) crossings(f, boxes, edges);
  if (f.on("L005")) overflows(f, boxes);
  if (f.on("L006")) disconnected(f, boxes, edges);
  if (f.on("L007")) dense(f, boxes);
  const profile = effectiveProfile().profile;
  if (f.on("L008")) tooMany(f, boxes, profile);
  if (f.on("L009")) offStyle(f, diagram, profile);
  return f.list.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** Rule ids for a request's rule names or ids; unknown ones are refused. */
export function pickRules<R extends string>(
  table: Record<R, string>,
  wanted: readonly string[] | undefined,
  field: string,
): Set<R> {
  const ids = Object.keys(table) as R[];
  if (wanted === undefined) return new Set(ids);
  return new Set(
    wanted.map((w) => {
      const id = ids.find((i) => i === w || table[i] === w);
      if (!id) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${field}: no rule ${w}; rules are ${ids.map((i) => `${i} ${table[i]}`).join(", ")}`,
        );
      }
      return id;
    }),
  );
}

export const limitField = () =>
  z.optional(
    doc(
      z.int().check(z.minimum(1), z.maximum(1000)),
      "Most findings to list, most severe first; default 100. count is always the full number.",
    ),
  );

export function counted<T extends { severity: Severity }>(
  findings: T[],
  limit: number | undefined,
) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const shown = findings.slice(0, limit ?? 100);
  return {
    count: findings.length,
    counts,
    truncated: shown.length < findings.length,
    findings: shown,
  };
}

export const countsSchema = () =>
  z.object({ error: z.int(), warning: z.int(), info: z.int() });

export const lintDiagram = defineEndpoint({
  path: "/lint_diagram",
  description:
    "Check how a diagram reads: node views stacked at one point (L001) or overlapping (L002), outside the canvas (L003), edges running through unrelated nodes (L004), names wider than their box (L005), nodes with no edge (L006), crowded areas (L007), more nodes than the style profile allows (L008) and views drawn off the style profile (L009, an error when it is strict). Each finding names the views by id and path, with a severity, a one-line fix and an autofix request to send as is.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagram: z.optional(ref("Diagram; default the current diagram.")),
    rules: z.optional(
      doc(
        z.array(z.string().check(z.minLength(1))),
        "Rules to run, by id (L001) or name (overlap); default all.",
      ),
    ),
    limit: limitField(),
  }),
  aliases: { diagramId: "diagram", id: "diagram" },
  response: z.object({
    diagram: elementSchema(),
    count: doc(z.int(), "Findings in all."),
    counts: countsSchema(),
    truncated: z.boolean(),
    findings: z.array(
      z.object({
        rule: z.string(),
        name: z.string(),
        severity: z.enum(SEVERITIES),
        message: z.string(),
        ids: doc(z.array(z.string()), "Views the finding is about."),
        paths: z.array(z.nullable(z.string())),
        fix: z.string(),
        autofix: doc(
          z.nullable(
            z.object({
              path: z.string(),
              body: z.record(z.string(), z.unknown()),
            }),
          ),
          "A request that fixes it: POST body to path. Null where only a person can decide.",
        ),
      }),
    ),
  }),
  handle: (input) => {
    const enabled = pickRules(LAYOUT_RULES, input.rules, "rules");
    const diagram = requireDiagram(input.diagram ?? "@current");
    return {
      diagram: serialize(diagram),
      ...counted(lintLayout(diagram, enabled), input.limit),
    };
  },
});
