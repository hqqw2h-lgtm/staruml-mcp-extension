import { describe, expect, it } from "vitest";
import { place, ranks } from "../../../src/build/place.js";
import type { Plan, PlanNode } from "../../../src/build/spec.js";

const node = (key: string, extra: Partial<PlanNode> = {}): PlanNode => ({
  key,
  type: "FCProcess",
  name: key,
  width: 100,
  height: 40,
  ...extra,
});
const edge = (from: string, to: string) => ({ type: "FCFlow", from, to });

describe("ranks", () => {
  it("ranks by longest path and stops on cycles and self loops", () => {
    const r = ranks(
      ["a", "b", "c"],
      [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("b", "b")],
    );
    expect(Math.max(...r.values())).toBeLessThan(3);
    expect(r.get("b")).toBeGreaterThan(r.get("a")!);
  });
});

describe("place", () => {
  const plan = (nodes: PlanNode[], edges = [edge("a", "b")]): Plan => ({
    kind: "flowchart",
    nodes,
    edges,
    fixed: false,
  });

  it("puts ranks in rows top down, or bottom up", () => {
    const tb = place(plan([node("a"), node("b"), node("c")]), "TB");
    expect(tb.get("b")!.y).toBeGreaterThan(tb.get("a")!.y);
    expect(tb.get("c")!.x).toBeGreaterThan(tb.get("a")!.x);
    const bt = place(plan([node("a"), node("b")]), "BT");
    expect(bt.get("b")!.y).toBeLessThan(bt.get("a")!.y);
  });

  it("puts ranks in columns left to right, or right to left", () => {
    const lr = place(plan([node("a"), node("b")]), "LR");
    expect(lr.get("b")!.x).toBeGreaterThan(lr.get("a")!.x);
    const rl = place(plan([node("a"), node("b")]), "RL");
    expect(rl.get("b")!.x).toBeLessThan(rl.get("a")!.x);
  });

  it("keeps fixed boxes and needs no grid when every box is fixed", () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    const boxes = place(plan([node("a", { box })], []), "TB");
    expect(boxes.get("a")).toEqual(box);
  });

  it("widens a lane for nodes that share a row and adds a column outside lanes", () => {
    const boxes = place(
      {
        kind: "activity",
        fixed: true,
        nodes: [
          node("L", { type: "UMLSwimlaneVert" }),
          node("a", { lane: "L" }),
          node("b", { lane: "L" }),
          node("c", { lane: "L" }),
          node("out"),
        ],
        edges: [edge("a", "b"), edge("a", "c")],
      },
      "TB",
    );
    expect(boxes.get("L")!.width).toBe(260);
    expect(boxes.get("b")!.y).toBe(boxes.get("c")!.y);
    expect(boxes.get("c")!.x).toBe(boxes.get("b")!.x + 120);
    expect(boxes.get("out")!.x).toBeGreaterThan(boxes.get("L")!.x + 260);
  });
});
