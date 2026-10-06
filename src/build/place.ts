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

import { FRAME } from "./plan.js";
import type { Box, Direction, Plan, PlanEdge, PlanNode } from "./spec.js";
import { PORT } from "./structure.js";

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

/** Room around and between use cases in the boundary, and its name band. */
const CASE = { gap: 50, row: 80, header: 50, pad: 30, actorStep: 130 };

/**
 * The classic use case layout: actors in a column on the left, the use
 * cases they take part in in one column inside the boundary (so no actor's
 * line passes through another use case, as a grid's did), the use cases
 * only reached by «include» or «extend» in a second column beside the
 * first use case that reaches them, and use cases of other systems under
 * the boundary, where the actors' lines reach them without crossing it.
 */
function usecaseBoxes(plan: Plan): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const actors = plan.nodes.filter((n) => n.type === "UMLActor");
  const all = plan.nodes.filter((n) => n.type === "UMLUseCase");
  const subject = plan.nodes.find((n) => n.type === "UMLUseCaseSubject")!;
  const actorKeys = new Set(actors.map((a) => a.key));
  const associated = new Set(
    plan.edges
      .filter((e) => actorKeys.has(e.from) || actorKeys.has(e.to))
      .flatMap((e) => [e.from, e.to]),
  );
  // The use case that reaches each secondary one: the includer, or the
  // base an extension extends.
  const reachedBy = new Map<string, string>();
  for (const e of plan.edges) {
    if (e.type === "UMLInclude" && !reachedBy.has(e.to)) {
      reachedBy.set(e.to, e.from);
    }
    if (e.type === "UMLExtend" && !reachedBy.has(e.from)) {
      reachedBy.set(e.from, e.to);
    }
  }
  const inside = all.filter((n) => !n.outside);
  const secondary = inside.filter(
    (n) => !associated.has(n.key) && reachedBy.has(n.key),
  );
  const primary = inside.filter((n) => !secondary.includes(n));
  const width1 = Math.max(160, ...primary.map((c) => c.width));
  const width2 = Math.max(0, ...secondary.map((c) => c.width));
  const left = MARGIN + 200;
  const rowOf = new Map<string, number>();
  primary.forEach((c, i) => rowOf.set(c.key, i));
  const taken = new Set<number>();
  for (const c of secondary) {
    let row = rowOf.get(reachedBy.get(c.key)!) ?? 0;
    while (taken.has(row)) row++;
    taken.add(row);
    rowOf.set(c.key, row);
  }
  const rows = Math.max(1, ...[...rowOf.values()].map((r) => r + 1));
  const width = Math.max(
    subject.width,
    2 * CASE.pad + width1 + (secondary.length > 0 ? CASE.gap + width2 : 0),
  );
  const height = CASE.header + rows * CASE.row + CASE.pad / 2;
  boxes.set(subject.key, { x: left, y: MARGIN, width, height });
  const column2 = left + CASE.pad + width1 + CASE.gap;
  for (const c of inside) {
    const second = secondary.includes(c);
    boxes.set(c.key, {
      // Left-aligned, so an actor's line reaches its use case before it
      // comes near any other in the column.
      x: second ? column2 : left + CASE.pad,
      y: MARGIN + CASE.header + rowOf.get(c.key)! * CASE.row,
      width: c.width,
      height: c.height,
    });
  }
  // Each actor level with the middle of its use cases, in that order down
  // the column, at least actorStep apart.
  const middle = (a: PlanNode) => {
    const rows = plan.edges
      .filter((e) => e.from === a.key || e.to === a.key)
      .map((e) => rowOf.get(e.from === a.key ? e.to : e.from))
      .filter((r) => r !== undefined);
    return rows.length > 0
      ? MARGIN +
          CASE.header +
          (rows.reduce((n, r) => n + r, 0) / rows.length) * CASE.row -
          15
      : MARGIN + height / 2 - 40;
  };
  let next = MARGIN;
  [...actors]
    .map((a) => ({ a, y: middle(a) }))
    .sort((p, q) => p.y - q.y)
    .forEach(({ a, y }) => {
      const top = Math.max(y, next);
      boxes.set(a.key, { x: MARGIN, y: top, width: a.width, height: a.height });
      next = top + CASE.actorStep;
    });
  all
    .filter((n) => n.outside)
    .forEach((c, i) =>
      boxes.set(c.key, {
        x: left + CASE.pad + (width1 - c.width) / 2,
        y: MARGIN + height + CASE.gap + i * CASE.row,
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

/** A pool's name band, a lane's, and the cell a BPMN flow node gets. */
const POOL = { header: 30, lane: 30, column: 170, row: 90, minHeight: 110 };

/**
 * Pools one under the other, their lanes stacked inside, and every flow
 * node in its lane's band at its rank's column, so the process reads left
 * to right across lanes as BPMN draws it (BPMN 2.0.2 §9.3, §10.8). Flow
 * nodes outside every pool sit in a band below.
 */
function bpmnBoxes(plan: Plan): Map<string, Box> {
  const isPool = (n: PlanNode) => n.type === "BPMNParticipant";
  const isLane = (n: PlanNode) => n.type === "BPMNLane";
  const flow = plan.nodes.filter((n) => !isPool(n) && !isLane(n));
  const keys = new Set(flow.map((n) => n.key));
  const rank = ranks(
    flow.map((n) => n.key),
    plan.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
  );
  const columns = Math.max(0, ...rank.values()) + 1;
  const pools = plan.nodes.filter(isPool);
  const lanesOf = (pool: PlanNode) =>
    plan.nodes.filter((n) => isLane(n) && n.container === pool.key);
  // The band a flow node sits in: its lane, its pool's first lane, its
  // pool, or the band outside the pools.
  const bandOf = (n: PlanNode): string => {
    const holder = plan.nodes.find((h) => h.key === n.container);
    if (!holder) return "";
    return isPool(holder)
      ? (lanesOf(holder)[0]?.key ?? holder.key)
      : holder.key;
  };
  const boxes = new Map<string, Box>();
  const width = POOL.header + POOL.lane + columns * POOL.column;
  let y = MARGIN;
  /** Lays out one band at `top` from `left`; answers its height. */
  const band = (key: string, top: number, left: number): number => {
    const slots = new Map<number, PlanNode[]>();
    for (const n of flow.filter((f) => bandOf(f) === key)) {
      const r = rank.get(n.key)!;
      slots.set(r, [...(slots.get(r) ?? []), n]);
    }
    const rows = Math.max(1, ...[...slots.values()].map((s) => s.length));
    const height = Math.max(POOL.minHeight, rows * POOL.row);
    for (const [r, nodes] of slots) {
      nodes.forEach((n, i) =>
        boxes.set(n.key, {
          x: left + r * POOL.column + (POOL.column - n.width) / 2,
          y:
            top +
            (height - nodes.length * POOL.row) / 2 +
            i * POOL.row +
            (POOL.row - n.height) / 2,
          width: n.width,
          height: n.height,
        }),
      );
    }
    return height;
  };
  for (const pool of pools) {
    const top = y;
    const lanes = lanesOf(pool);
    for (const lane of lanes) {
      const h = band(lane.key, y, MARGIN + POOL.header + POOL.lane);
      boxes.set(lane.key, {
        x: MARGIN + POOL.header,
        y,
        width: width - POOL.header,
        height: h,
      });
      y += h;
    }
    if (lanes.length === 0) y += band(pool.key, y, MARGIN + POOL.header);
    boxes.set(pool.key, { x: MARGIN, y: top, width, height: y - top });
    y += GAP;
  }
  band("", y, MARGIN);
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
    // Ranks across (LR) put a level's unconnected nodes in one column.
    const local = grid(
      members,
      plan.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
      plan.stack && container !== undefined ? "LR" : direction,
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

/** Room a framed diagram's frame keeps around what it holds, its name tab on top. */
const FRAME_PAD = { side: 20, top: 50 };

/**
 * The frame's bounds around `boxes`, moving them down first so the frame's
 * name tab sits above them; an empty frame keeps a size to drop into.
 */
function frameAround(boxes: Map<string, Box>): Box {
  if (boxes.size === 0) {
    return { x: FRAME_PAD.side, y: FRAME_PAD.side, width: 400, height: 240 };
  }
  const top = Math.min(...[...boxes.values()].map((b) => b.y));
  const dy = Math.max(0, FRAME_PAD.top + FRAME_PAD.side - top);
  for (const [key, b] of boxes) boxes.set(key, { ...b, y: b.y + dy });
  const all = [...boxes.values()];
  const left = Math.min(...all.map((b) => b.x));
  const right = Math.max(...all.map((b) => b.x + b.width));
  const bottom = Math.max(...all.map((b) => b.y + b.height));
  return {
    x: left - FRAME_PAD.side,
    y: top + dy - FRAME_PAD.top,
    width: right - left + 2 * FRAME_PAD.side,
    height: bottom - (top + dy) + FRAME_PAD.top + FRAME_PAD.side,
  };
}

/**
 * Where each node's view goes, by node key; a framed plan also gets the
 * frame's bounds under FRAME, wrapped around the rest.
 */
export function place(plan: Plan, direction: Direction): Map<string, Box> {
  const onBorder = (n: PlanNode) => n.host !== undefined && !n.inside;
  const hosted = plan.nodes.filter(onBorder);
  // An edge to a hosted view ranks its host: a connector between two ports
  // places their components.
  const hostOf = new Map(hosted.map((n) => [n.key, n.host!]));
  const boxes = placeNodes(
    {
      ...plan,
      // A view made inside its host is placed as one moved into it.
      nodes: plan.nodes
        .filter((n) => !onBorder(n))
        .map((n) => {
          if (!n.inside) return n;
          const { host, ...rest } = n;
          return host === FRAME ? rest : { ...rest, container: host };
        }),
      // An edge to a port on the frame ranks nothing.
      edges: plan.edges
        .map((e) => ({
          ...e,
          from: hostOf.get(e.from) ?? e.from,
          to: hostOf.get(e.to) ?? e.to,
        }))
        .filter((e) => e.from !== FRAME && e.to !== FRAME),
    },
    direction,
  );
  if (plan.framed) boxes.set(FRAME, frameAround(boxes));
  // A hosted view (a port) sits on its host's right border, one under the
  // other, as StarUML draws a port dropped on a component.
  const count = new Map<string, number>();
  for (const n of hosted) {
    const host = boxes.get(n.host!)!;
    const k = count.get(n.host!) ?? 0;
    count.set(n.host!, k + 1);
    boxes.set(n.key, {
      x: host.x + host.width - n.width / 2,
      y: host.y + PORT.first - PORT.size + k * PORT.step,
      width: n.width,
      height: n.height,
    });
  }
  return boxes;
}

function placeNodes(plan: Plan, direction: Direction): Map<string, Box> {
  let boxes: Map<string, Box>;
  if (plan.kind === "usecase" && plan.fixed) boxes = usecaseBoxes(plan);
  else if (plan.kind === "activity" && plan.fixed) boxes = activityBoxes(plan);
  else if (plan.kind === "bpmn") boxes = bpmnBoxes(plan);
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
