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
  labelProblems,
  sharedEdges,
  labelGap,
  failures,
  FAIL_CAP,
  LABEL_REACH,
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
    // The label on the package's border box is printed over it.
    expect(m.overlapPairs).toBe(0);
    expect(m.labelOverlaps).toBe(1);
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
    severeOverlaps: fc.nat(10),
    labelOverlaps: fc.nat(20),
    detachedLabels: fc.nat(20),
    labelCrossings: fc.nat(20),
    nodeEdgeCrossings: fc.nat(30),
    edgeCrossings: fc.nat(30),
    sharedSegments: fc.nat(30),
    borderCrossings: fc.nat(30),
    selected: fc.nat(5),
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
        fc.nat(10),
        (m, ratio, pairs, nodeEdge, edgeEdge, more) => {
          const worse: Metrics = {
            ...m,
            overlapRatio: m.overlapRatio + ratio,
            overlapPairs: m.overlapPairs + pairs,
            nodeEdgeCrossings: m.nodeEdgeCrossings + nodeEdge,
            edgeCrossings: m.edgeCrossings + edgeEdge,
            severeOverlaps: m.severeOverlaps + more,
            labelOverlaps: m.labelOverlaps + more,
            detachedLabels: m.detachedLabels + more,
            labelCrossings: m.labelCrossings + more,
            sharedSegments: m.sharedSegments + more,
            borderCrossings: m.borderCrossings + more,
            selected: m.selected + more,
          };
          expect(scoreOf(worse, PAGE)).toBeLessThanOrEqual(scoreOf(m, PAGE));
          for (const field of [
            "overlapRatio",
            "overlapPairs",
            "nodeEdgeCrossings",
            "edgeCrossings",
            "severeOverlaps",
            "labelOverlaps",
            "detachedLabels",
            "labelCrossings",
            "sharedSegments",
            "borderCrossings",
            "selected",
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
      label: fc.boolean(),
      edge: fc.option(fc.string({ maxLength: 3 }), { nil: undefined }),
      group: fc.option(fc.string({ maxLength: 3 }), { nil: undefined }),
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
          labelProblems({ nodes, edges });
          sharedEdges({ nodes, edges });
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

describe("what a reader sees (#38)", () => {
  const label = (
    id: string,
    left: number,
    top: number,
    onEdge: string,
  ): GNode => ({
    ...node(id, left, top, 60, 14),
    label: true,
    edge: onEdge,
    attachedTo: [],
  });

  it("counts a box laid over a quarter of another as severe", () => {
    const m = measure({
      nodes: [node("a", 0, 0), node("b", 10, 10), node("c", 105, 55)],
      edges: [],
    });
    expect(m.overlapPairs).toBe(2);
    expect(m.severeOverlaps).toBe(1);
    expect(penalties(m, PAGE).overlap).toBe(WEIGHTS.overlap);
  });

  it("finds labels over text, crossed by another edge or far from their own", () => {
    const a = node("a", 0, 0);
    const b = node("b", 400, 0);
    const c = node("c", 0, 300);
    const ab = edge("ab", a, b);
    const ac = edge("ac", a, c);
    const near = label("near", 170, 5, "ab");
    const far = label("far", 170, 200, "ab");
    const over = label("over", 175, 8, "ab");
    const crossed = label("crossed", 20, 150, "ab");
    const g: Geometry = {
      nodes: [a, b, c, near, far, over, crossed],
      edges: [ab, ac],
    };
    const m = measure(g);
    expect(m.labelOverlaps).toBe(1);
    expect(m.detachedLabels).toBe(2);
    expect(m.labelCrossings).toBe(1);
    expect(labelProblems(g).sort()).toEqual(
      ["crossed", "far", "near", "over"].sort(),
    );
    expect(labelProblems({ nodes: [a, b, near], edges: [ab] })).toEqual([]);
    // Close to its own edge yet crossed by another.
    expect(
      labelProblems({
        nodes: [a, b, c, label("x2", 30, 30, "ab")],
        edges: [ab, ac],
      }),
    ).toEqual(["x2"]);
    // A label whose edge is not drawn is judged by what it covers alone.
    expect(
      labelProblems({ nodes: [a, label("lost", 300, 300, "gone")], edges: [] }),
    ).toEqual([]);
  });

  it("measures a label's gap to its edge", () => {
    const box = { left: 0, top: 0, width: 10, height: 10 };
    expect(labelGap(box, [])).toBe(Infinity);
    expect(
      labelGap(box, [
        { x: 5, y: -5 },
        { x: 5, y: 20 },
      ]),
    ).toBe(0);
    expect(labelGap(box, [{ x: 20, y: 5 }])).toBe(10);
    expect(
      labelGap(box, [
        { x: 5, y: 40 },
        { x: 5, y: 40 },
      ]),
    ).toBe(30);
    expect(
      labelGap(box, [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]),
    ).toBeGreaterThan(LABEL_REACH);
  });

  it("counts edges drawn on one line unless they share their target", () => {
    const run = (id: string, y: number, ends: [string, string]) => ({
      id,
      points: [
        { x: 0, y },
        { x: 100, y },
        { x: 100, y: y + 50 },
      ],
      ends,
    });
    const g = {
      nodes: [],
      edges: [
        run("p", 0, ["a", "t"]),
        run("q", 1, ["b", "u"]),
        run("r", 0, ["c", "t"]),
        {
          id: "s",
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          ends: ["d", "v"] as [string, string],
        },
        {
          id: "d",
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
          ],
          ends: ["d", "w"] as [string, string],
        },
      ],
    };
    const m = measure(g);
    // p–q and q–r share a run; p–r end at one target.
    expect(m.sharedSegments).toBe(2);
    expect(sharedEdges(g).sort()).toEqual(["p", "q", "r"]);
  });

  it("counts boxes and labels cut by an area's border, not lifelines", () => {
    const lane: GNode = { ...node("lane", 0, 0, 200, 400), area: true };
    const m = measure({
      nodes: [
        lane,
        node("in", 20, 20),
        node("across", 150, 100),
        { ...node("life", 100, -50, 20, 500), through: true },
        { ...node("big", -10, -10, 300, 500) },
      ],
      edges: [],
    });
    expect(m.borderCrossings).toBe(1);
  });

  it("charges selection handles an export would draw", () => {
    const m = measure({ nodes: [node("a", 0, 0)], edges: [], selected: 2 });
    expect(m.selected).toBe(2);
    expect(penalties(m, PAGE).selection).toBe(WEIGHTS.selection);
    expect(measure({ nodes: [], edges: [] }).selected).toBe(0);
  });

  it("lets activations of one lifeline stack", () => {
    const act = (id: string, top: number): GNode => ({
      ...node(id, 0, top, 14, 60),
      label: true,
      group: "life",
    });
    expect(
      measure({ nodes: [act("x", 0), act("y", 20)], edges: [] }).labelOverlaps,
    ).toBe(0);
  });

  it("fails a strip larger than twice the page and a poster, whatever else", () => {
    const strip = measure({
      nodes: Array.from({ length: 12 }, (_, i) => node(`n${i}`, i * 400, 0)),
      edges: [],
    });
    expect(failures(strip, PAGE)[0]).toMatch(/^aspect .* over 3:1/);
    expect(scoreOf(strip, PAGE)).toBeLessThanOrEqual(FAIL_CAP);
    expect(failures(strip, { ...PAGE, maxAspect: 100 })).toEqual([]);
    // Small enough to show whole: wide is fine.
    const row = measure({
      nodes: [node("a", 0, 0), node("b", 300, 0), node("c", 600, 0)],
      edges: [],
    });
    expect(failures(row, PAGE)).toEqual([]);
    const poster = measure({
      nodes: Array.from({ length: 61 }, (_, i) =>
        node(`n${i}`, (i % 8) * 150, Math.floor(i / 8) * 100),
      ),
      edges: [],
    });
    expect(failures(poster, PAGE)).toEqual(["61 nodes over 60"]);
    expect(failures(poster, { ...PAGE, maxNodes: 61 })).toEqual([]);
  });
});
