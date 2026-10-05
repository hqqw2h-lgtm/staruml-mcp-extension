import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type GEdge,
  type GNode,
  type Geometry,
  measure,
  type Metrics,
  penalties,
  ratingOf,
  scoreOf,
  segmentCrossesBox,
  segmentsCross,
  WEIGHTS,
} from "../../../src/quality/metric.js";

const PAGE = { width: 1600, height: 1200 };

const node = (
  id: string,
  left: number,
  top: number,
  w = 100,
  h = 50,
): GNode => ({
  id,
  left,
  top,
  width: w,
  height: h,
  area: false,
  through: false,
  parent: null,
});

const edge = (
  id: string,
  a: GNode,
  b: GNode,
  bends: { x: number; y: number }[] = [],
): GEdge => ({
  id,
  points: [
    { x: a.left + a.width / 2, y: a.top + a.height / 2 },
    ...bends,
    { x: b.left + b.width / 2, y: b.top + b.height / 2 },
  ],
  ends: [a.id, b.id],
});

describe("segments", () => {
  it("cross a box only through its inside", () => {
    const b = { left: 0, top: 0, width: 100, height: 100 };
    expect(segmentCrossesBox({ x: -10, y: 50 }, { x: 110, y: 50 }, b)).toBe(
      true,
    );
    expect(segmentCrossesBox({ x: -10, y: 1 }, { x: 110, y: 1 }, b)).toBe(
      false,
    );
    expect(segmentCrossesBox({ x: 50, y: -10 }, { x: 50, y: -5 }, b)).toBe(
      false,
    );
    expect(segmentCrossesBox({ x: 50, y: 50 }, { x: 50, y: 50 }, b)).toBe(true);
    expect(
      segmentCrossesBox(
        { x: 0, y: 0 },
        { x: 9, y: 9 },
        { left: 0, top: 0, width: 3, height: 3 },
      ),
    ).toBe(false);
    expect(segmentCrossesBox({ x: 200, y: 50 }, { x: 300, y: 60 }, b)).toBe(
      false,
    );
  });

  it("cross each other only at an inner point", () => {
    const p = (x: number, y: number) => ({ x, y });
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsCross(p(0, 0), p(10, 10), p(10, 10), p(20, 0))).toBe(false);
    expect(segmentsCross(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
    expect(segmentsCross(p(0, 10), p(10, 0), p(0, 0), p(10, 10))).toBe(true);
  });
});

describe("measure", () => {
  it("scores a tidy row of boxes high", () => {
    const a = node("a", 0, 0);
    const b = node("b", 200, 0);
    const m = measure({ nodes: [a, b], edges: [edge("e", a, b)] });
    expect(m).toMatchObject({
      overlapPairs: 0,
      nodeEdgeCrossings: 0,
      edgeCrossings: 0,
      bends: 0,
      alignment: 1,
      width: 300,
      height: 50,
    });
    expect(scoreOf(m, PAGE)).toBeGreaterThanOrEqual(90);
    expect(ratingOf(scoreOf(m, PAGE))).toBe(5);
  });

  it("counts overlap, a box on another, crossings and bends", () => {
    const a = node("a", 0, 0);
    const b = node("b", 50, 25);
    const c = node("c", 0, 200);
    const d = node("d", 10, 210, 20, 20); // fully on c
    const e = node("e", 300, 100);
    const f = node("f", 300, 300);
    const g: Geometry = {
      nodes: [a, b, c, d, e, f],
      edges: [
        edge("ac", a, c),
        edge("ef", e, f),
        edge("bf", b, f, [{ x: 100, y: 400 }]),
        edge("ce", c, e),
      ],
    };
    const m = measure(g);
    expect(m.overlapPairs).toBe(2);
    expect(m.overlapArea).toBe(50 * 25 + 20 * 20);
    expect(m.bends).toBe(1);
    expect(m.edgeCrossings).toBeGreaterThan(0);
    expect(scoreOf(m, PAGE)).toBeLessThan(90);
  });

  it("ignores containment, areas, labels on their edge's ends and notes over lifelines", () => {
    const pkg: GNode = { ...node("p", 0, 0, 400, 300) };
    const inner: GNode = { ...node("i", 20, 20), parent: "p" };
    const deeper: GNode = { ...node("j", 30, 30, 10, 10), parent: "i" };
    const frame: GNode = { ...node("f", 0, 0, 600, 600), area: true };
    const lifeline: GNode = { ...node("l", 500, 0, 40, 500), through: true };
    const note: GNode = node("n", 480, 100, 80, 40);
    const label: GNode = {
      ...node("lab", 15, 15, 30, 10),
      attachedTo: ["i", "x"],
      label: true,
    };
    const orphan: GNode = { ...node("o", 700, 700), parent: "gone" };
    const m = measure({
      nodes: [pkg, inner, deeper, frame, lifeline, note, label, orphan],
      edges: [
        {
          id: "msg",
          points: [
            { x: 0, y: 450 },
            { x: 600, y: 450 },
          ],
          ends: ["l", "l"],
        },
        {
          id: "in",
          points: [
            { x: 25, y: 25 },
            { x: 35, y: 35 },
          ],
          ends: ["j", "p"],
        },
      ],
    });
    expect(m.overlapPairs).toBe(1); // the label on the package's border box
    expect(m.nodeEdgeCrossings).toBe(0);
  });

  it("answers neutral measures for an empty diagram", () => {
    const m = measure({ nodes: [], edges: [] });
    expect(m).toMatchObject({
      width: 0,
      height: 0,
      aspect: 1,
      whitespace: 1,
      alignment: 1,
      lengthVariation: 0,
    });
    expect(scoreOf(m, PAGE)).toBe(100);
  });

  it("penalises a strip, a sparse or a crowded canvas, and a drawing past the page", () => {
    const strip = measure({
      nodes: Array.from({ length: 10 }, (_, i) => node(`n${i}`, i * 400, 0)),
      edges: [],
    });
    expect(penalties(strip, PAGE).aspect).toBeGreaterThan(0);
    expect(penalties(strip, PAGE).page).toBeGreaterThan(0);
    const sparse = measure({
      nodes: [node("a", 0, 0), node("b", 2000, 1500)],
      edges: [],
    });
    expect(sparse.whitespace).toBeLessThan(1);
    const crowded = measure({
      nodes: [node("a", 0, 0, 100, 100), node("b", 100, 0, 100, 100)],
      edges: [],
    });
    expect(crowded.whitespace).toBeLessThan(1);
  });
});

const metrics = (): fc.Arbitrary<Metrics> =>
  fc.record({
    nodes: fc.nat(50),
    edges: fc.nat(50),
    overlapArea: fc.nat(100_000),
    overlapPairs: fc.nat(20),
    overlapRatio: fc.double({ min: 0, max: 3, noNaN: true }),
    nodeEdgeCrossings: fc.nat(30),
    edgeCrossings: fc.nat(30),
    lengthVariation: fc.double({ min: 0, max: 5, noNaN: true }),
    bends: fc.nat(50),
    alignment: fc.double({ min: 0, max: 1, noNaN: true }),
    whitespace: fc.double({ min: 0, max: 1, noNaN: true }),
    aspect: fc.double({ min: 1, max: 20, noNaN: true }),
    width: fc.nat(10_000),
    height: fc.nat(10_000),
  });

describe("score (properties)", () => {
  it("never rises with more overlap or more crossings", () => {
    fc.assert(
      fc.property(
        metrics(),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.nat(10),
        fc.nat(10),
        fc.nat(10),
        (m, ratio, pairs, nodeEdge, edgeEdge) => {
          const worse: Metrics = {
            ...m,
            overlapRatio: m.overlapRatio + ratio,
            overlapPairs: m.overlapPairs + pairs,
            nodeEdgeCrossings: m.nodeEdgeCrossings + nodeEdge,
            edgeCrossings: m.edgeCrossings + edgeEdge,
          };
          expect(scoreOf(worse, PAGE)).toBeLessThanOrEqual(scoreOf(m, PAGE));
          for (const field of [
            "overlapRatio",
            "overlapPairs",
            "nodeEdgeCrossings",
            "edgeCrossings",
          ] as const) {
            const one = { ...m, [field]: worse[field] };
            expect(scoreOf(one, PAGE)).toBeLessThanOrEqual(scoreOf(m, PAGE));
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("stays within 0..100 and within each weight", () => {
    fc.assert(
      fc.property(metrics(), (m) => {
        const s = scoreOf(m, PAGE);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
        const p = penalties(m, PAGE);
        for (const [k, w] of Object.entries(WEIGHTS)) {
          expect(p[k as keyof typeof p]).toBeLessThanOrEqual(w + 1e-9);
          expect(p[k as keyof typeof p]).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("drops when a box is laid on another (geometry)", () => {
    const box = fc.record({
      left: fc.integer({ min: 0, max: 2000 }),
      top: fc.integer({ min: 0, max: 2000 }),
    });
    fc.assert(
      fc.property(fc.array(box, { minLength: 1, maxLength: 8 }), (boxes) => {
        const nodes = boxes.map((b, i) => node(`n${i}`, b.left, b.top));
        const before = measure({ nodes, edges: [] });
        const stacked = measure({
          nodes: [...nodes, node("dup", nodes[0]!.left, nodes[0]!.top)],
          edges: [],
        });
        expect(stacked.overlapArea).toBeGreaterThan(before.overlapArea);
        expect(stacked.overlapPairs).toBeGreaterThan(before.overlapPairs);
      }),
    );
  });

  it("never throws or answers NaN on any geometry (fuzz)", () => {
    const num = fc.double({ min: -1e5, max: 1e5, noNaN: true });
    const gnode = fc.record({
      id: fc.string({ maxLength: 3 }),
      left: num,
      top: num,
      width: fc.double({ min: 0, max: 1e4, noNaN: true }),
      height: fc.double({ min: 0, max: 1e4, noNaN: true }),
      area: fc.boolean(),
      through: fc.boolean(),
      parent: fc.option(fc.string({ maxLength: 3 }), { nil: null }),
    });
    const gedge = fc.record({
      id: fc.string({ maxLength: 3 }),
      points: fc.array(fc.record({ x: num, y: num }), { maxLength: 5 }),
      ends: fc.tuple(fc.string({ maxLength: 3 }), fc.string({ maxLength: 3 })),
    });
    fc.assert(
      fc.property(
        fc.array(gnode, { maxLength: 8 }),
        fc.array(gedge, { maxLength: 6 }),
        (nodes, edges) => {
          const m = measure({ nodes, edges });
          const s = scoreOf(m, PAGE);
          expect(Number.isFinite(s)).toBe(true);
          for (const v of Object.values(m)) expect(Number.isNaN(v)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("rates by the reviewers' scale", () => {
    expect([95, 85, 65, 45, 10].map(ratingOf)).toEqual([5, 4, 3, 2, 1]);
  });
});
