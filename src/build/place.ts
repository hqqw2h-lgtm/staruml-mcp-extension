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
 * Longest-path rank from the sources along the edges, ignoring the edges
 * that close a cycle (back edges of a depth-first walk in spec order), so a
 * loop such as a while's way back does not push the nodes it returns to
 * below the ones it comes from.
 */
export function ranks(
  keys: readonly string[],
  edges: readonly PlanEdge[],
): Map<string, number> {
  const out = new Map<string, PlanEdge[]>(keys.map((k) => [k, []]));
  for (const e of edges) out.get(e.from)!.push(e);
  const state = new Map<string, "open" | "done">();
  const back = new Set<PlanEdge>();
  const walk = (key: string) => {
    state.set(key, "open");
    for (const e of out.get(key)!) {
      const s = state.get(e.to);
      if (s === "open") back.add(e);
      else if (s === undefined) walk(e.to);
    }
    state.set(key, "done");
  };
  for (const k of keys) if (!state.has(k)) walk(k);
  const forward = edges.filter((e) => !back.has(e));
  const rank = new Map(keys.map((k) => [k, 0]));
  // A DAG's longest paths settle within as many rounds as it has nodes.
  for (let round = 0; round < keys.length; round++) {
    let changed = false;
    for (const e of forward) {
      const next = rank.get(e.from)! + 1;
      if (next > rank.get(e.to)!) {
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

const INSET = 20;
const HEADER = 40;

/**
 * Nodes nested in container nodes (composite states): each container's
 * nodes in a grid of their own, the container grown to hold it below its
 * name, and every level placed like a flat diagram.
 */
function nestedBoxes(plan: Plan, direction: Direction): Map<string, Box> {
  const relative = new Map<string, Box>();
  const level = (container?: string) => {
    const members = plan.nodes
      .filter((n) => n.container === container)
      .map((n) => {
        if (!plan.nodes.some((c) => c.container === n.key)) return n;
        const inner = level(n.key);
        return {
          ...n,
          width: Math.max(n.width, inner.width + 2 * INSET),
          height: Math.max(n.height, inner.height + HEADER + INSET),
        };
      });
    const keys = new Set(members.map((n) => n.key));
    const local = grid(
      members,
      plan.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
      direction,
      { x: 0, y: 0 },
    );
    let width = 0;
    let height = 0;
    for (const [key, box] of local) {
      relative.set(key, box);
      width = Math.max(width, box.x + box.width);
      height = Math.max(height, box.y + box.height);
    }
    return { width, height };
  };
  level();
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const boxes = new Map<string, Box>();
  const absolute = (key: string): Box => {
    const known = boxes.get(key);
    if (known) return known;
    const box = relative.get(key)!;
    const container = byKey.get(key)!.container;
    const origin =
      container === undefined
        ? { x: MARGIN, y: MARGIN }
        : {
            x: absolute(container).x + INSET,
            y: absolute(container).y + HEADER,
          };
    const placed = { ...box, x: box.x + origin.x, y: box.y + origin.y };
    boxes.set(key, placed);
    return placed;
  };
  for (const n of plan.nodes) absolute(n.key);
  return boxes;
}

/** Where each node's view goes, by node key. */
export function place(plan: Plan, direction: Direction): Map<string, Box> {
  let boxes: Map<string, Box>;
  if (plan.kind === "usecase" && plan.fixed) boxes = usecaseBoxes(plan);
  else if (plan.kind === "activity" && plan.fixed) boxes = activityBoxes(plan);
  else if (plan.nodes.some((n) => n.container !== undefined)) {
    boxes = nestedBoxes(plan, direction);
  } else {
    const free = plan.nodes.filter((n) => n.box === undefined);
    boxes =
      free.length === 0
        ? new Map()
        : grid(free, plan.edges, direction, { x: MARGIN, y: MARGIN });
  }
  for (const n of plan.nodes) if (n.box) boxes.set(n.key, n.box);
  return boxes;
}
