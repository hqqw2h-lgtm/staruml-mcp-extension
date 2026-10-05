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

import type { Box, Direction, Plan, PlanEdge, PlanNode } from "./spec.js";

/*
 * Deterministic placement: the positions /build_diagram creates views at.
 * Engine layout (Format > Layout) rearranges them afterwards where the kind
 * allows; where it does not (sequence diagrams, lanes, a system boundary) or
 * when it is turned off, these positions are the result, and the same spec
 * always gives the same picture.
 */

const MARGIN = 40;
const GAP = 60;

/**
 * Longest-path rank from the sources along the edges. Cycles stop growing
 * after as many rounds as there are nodes, so every rank is finite.
 */
export function ranks(
  keys: readonly string[],
  edges: readonly PlanEdge[],
): Map<string, number> {
  const rank = new Map(keys.map((k) => [k, 0]));
  for (let round = 0; round < keys.length; round++) {
    let changed = false;
    for (const e of edges) {
      const next = rank.get(e.from)! + 1;
      if (e.from !== e.to && next > rank.get(e.to)! && next < keys.length) {
        rank.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

/** Nodes in rows by rank (columns for LR and RL), in spec order within a rank. */
function grid(
  nodes: readonly PlanNode[],
  edges: readonly PlanEdge[],
  direction: Direction,
  origin: { x: number; y: number },
): Map<string, Box> {
  const rank = ranks(
    nodes.map((n) => n.key),
    edges,
  );
  const deepest = Math.max(0, ...rank.values());
  const cellW = Math.max(...nodes.map((n) => n.width)) + GAP;
  const cellH = Math.max(...nodes.map((n) => n.height)) + GAP;
  const used = new Map<number, number>();
  const boxes = new Map<string, Box>();
  for (const node of nodes) {
    let r = rank.get(node.key)!;
    if (direction === "BT" || direction === "RL") r = deepest - r;
    const i = used.get(r) ?? 0;
    used.set(r, i + 1);
    const [col, row] =
      direction === "TB" || direction === "BT" ? [i, r] : [r, i];
    boxes.set(node.key, {
      x: origin.x + col * cellW + (cellW - GAP - node.width) / 2,
      y: origin.y + row * cellH + (cellH - GAP - node.height) / 2,
      width: node.width,
      height: node.height,
    });
  }
  return boxes;
}

/** Actors in a column on the left, use cases stacked inside the boundary. */
function usecaseBoxes(plan: Plan): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const actors = plan.nodes.filter((n) => n.type === "UMLActor");
  const cases = plan.nodes.filter((n) => n.type === "UMLUseCase");
  const subject = plan.nodes.find((n) => n.type === "UMLUseCaseSubject")!;
  actors.forEach((a, i) =>
    boxes.set(a.key, {
      x: MARGIN,
      y: MARGIN + 40 + i * 140,
      width: a.width,
      height: a.height,
    }),
  );
  const left = MARGIN + 200;
  boxes.set(subject.key, {
    x: left,
    y: MARGIN,
    width: subject.width,
    height: subject.height,
  });
  cases.forEach((c, i) =>
    boxes.set(c.key, {
      x: left + (subject.width - c.width) / 2,
      y: MARGIN + 60 + i * 80,
      width: c.width,
      height: c.height,
    }),
  );
  return boxes;
}

const LANE_WIDTH = 220;
const LANE_HEADER = 50;
const ROW = 90;
const SIDE_GAP = 20;

/**
 * Lanes side by side; each node in its lane's column at its rank's row.
 * Nodes sharing a lane and a rank sit next to each other, and the lane is
 * widened to hold them.
 */
function activityBoxes(plan: Plan): Map<string, Box> {
  const lanes = plan.nodes.filter((n) => n.type === "UMLSwimlaneVert");
  const others = plan.nodes.filter((n) => n.type !== "UMLSwimlaneVert");
  const rank = ranks(
    others.map((n) => n.key),
    plan.edges,
  );
  const deepest = Math.max(0, ...rank.values());
  const height = LANE_HEADER + (deepest + 1) * ROW + GAP / 2;
  // Nodes outside every lane go in a column after the last lane.
  const column = (n: PlanNode) =>
    n.lane === undefined
      ? lanes.length
      : lanes.findIndex((l) => l.key === n.lane);
  const slots = new Map<string, PlanNode[]>();
  for (const n of others) {
    const slot = `${column(n)}:${rank.get(n.key)}`;
    slots.set(slot, [...(slots.get(slot) ?? []), n]);
  }
  const widths = Array.from({ length: lanes.length + 1 }, () => LANE_WIDTH);
  for (const [slot, nodes] of slots) {
    const c = Number(slot.split(":")[0]);
    const needed =
      nodes.reduce((sum, n) => sum + n.width + SIDE_GAP, 0) + SIDE_GAP;
    widths[c] = Math.max(widths[c]!, needed);
  }
  const lefts = widths.map(
    (_, c) => MARGIN + widths.slice(0, c).reduce((a, w) => a + w, 0),
  );
  const boxes = new Map<string, Box>();
  lanes.forEach((lane, i) =>
    boxes.set(lane.key, {
      x: lefts[i]!,
      y: MARGIN,
      width: widths[i]!,
      height,
    }),
  );
  for (const [slot, nodes] of slots) {
    const [c, r] = slot.split(":").map(Number) as [number, number];
    const total = nodes.reduce((sum, n) => sum + n.width + SIDE_GAP, -SIDE_GAP);
    let x = lefts[c]! + (widths[c]! - total) / 2;
    for (const n of nodes) {
      boxes.set(n.key, {
        x,
        y: MARGIN + LANE_HEADER + r * ROW + (ROW - n.height) / 2,
        width: n.width,
        height: n.height,
      });
      x += n.width + SIDE_GAP;
    }
  }
  return boxes;
}

/** Where each node's view goes, by node key. */
export function place(plan: Plan, direction: Direction): Map<string, Box> {
  let boxes: Map<string, Box>;
  if (plan.kind === "usecase" && plan.fixed) boxes = usecaseBoxes(plan);
  else if (plan.kind === "activity" && plan.fixed) boxes = activityBoxes(plan);
  else {
    const free = plan.nodes.filter((n) => n.box === undefined);
    boxes =
      free.length === 0
        ? new Map()
        : grid(free, plan.edges, direction, { x: MARGIN, y: MARGIN });
  }
  for (const n of plan.nodes) if (n.box) boxes.set(n.key, n.box);
  return boxes;
}
