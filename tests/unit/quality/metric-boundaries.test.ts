import { describe, expect, it } from "vitest";
import {
  type GEdge,
  type GNode,
  measure,
  ratingOf,
  segmentCrossesBox,
  segmentsCross,
} from "../../../src/quality/metric.js";

/*
 * The metric's boundaries, one assertion per edge case the mutation run of
 * issue #27 found unchecked: where a box counts as on another, where a
 * segment counts as through a box or across another, and how lengths,
 * labels, shared ends and degenerate bounds count.
 */

const box = (
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  more: Partial<GNode> = {},
): GNode => ({
  id,
  left,
  top,
  width,
  height,
  area: false,
  through: false,
  parent: null,
  ...more,
});

const edge = (id: string, ends: [string, string], ...pts: number[]): GEdge => ({
  id,
  ends,
  points: Array.from({ length: pts.length / 2 }, (_, i) => ({
    x: pts[2 * i]!,
    y: pts[2 * i + 1]!,
  })),
});

const overlap = (...nodes: GNode[]) => measure({ nodes, edges: [] });

describe("overlap boundaries", () => {
  it("counts a box on another flush with any edge as fully on it", () => {
    const big = box("big", 0, 0, 100, 100);
    for (const [x, y] of [
      [0, 0],
      [99, 99],
      [10, 10],
    ] as const) {
      expect(overlap(big, box("t", x, y, 1, 1))).toMatchObject({
        overlapArea: 1,
        overlapPairs: 1,
      });
    }
    // Off its far edge by one unit it is a one-unit sliver, not on it.
    expect(overlap(big, box("t", 100, 50, 1, 1)).overlapPairs).toBe(0);
  });

  it("ignores slivers one unit wide or high, and counts two units", () => {
    const a = box("a", 0, 0, 10, 10);
    expect(overlap(a, box("b", 9, 0, 10, 10)).overlapArea).toBe(0);
    expect(overlap(a, box("b", 9, 5, 10, 10)).overlapArea).toBe(0);
    expect(overlap(a, box("b", 0, 9, 10, 10)).overlapArea).toBe(0);
    expect(overlap(a, box("b", 8, 8, 10, 10)).overlapArea).toBe(4);
  });

  it("ends a container chain that loops", () => {
    const m = overlap(
      box("a", 0, 0, 50, 50, { parent: "b" }),
      box("b", 0, 0, 50, 50, { parent: "a" }),
      box("c", 10, 10, 50, 50),
    );
    expect(m.overlapPairs).toBe(2);
  });
});

describe("segments through boxes", () => {
  const b = { left: 0, top: 0, width: 10, height: 10 };

  it("keeps two units inside the border", () => {
    expect(segmentCrossesBox({ x: 9, y: -5 }, { x: 9, y: 15 }, b)).toBe(false);
    expect(segmentCrossesBox({ x: -5, y: 9 }, { x: 15, y: 9 }, b)).toBe(false);
    expect(segmentCrossesBox({ x: 8, y: -5 }, { x: 8, y: 15 }, b)).toBe(true);
    expect(segmentCrossesBox({ x: 2, y: -5 }, { x: 2, y: 15 }, b)).toBe(true);
  });

  it("finds nothing inside a box narrower or lower than its border", () => {
    const thin = { left: 0, top: 0, width: 4, height: 10 };
    expect(segmentCrossesBox({ x: 2, y: -5 }, { x: 2, y: 15 }, thin)).toBe(
      false,
    );
    const flat = { left: 0, top: 0, width: 10, height: 4 };
    expect(segmentCrossesBox({ x: -5, y: 2 }, { x: 15, y: 2 }, flat)).toBe(
      false,
    );
  });
});

describe("segments across segments", () => {
  const p = (x: number, y: number) => ({ x, y });

  it("counts a proper crossing in every orientation, away from the origin", () => {
    expect(
      segmentsCross(p(100, 100), p(110, 110), p(100, 110), p(110, 100)),
    ).toBe(true);
    expect(
      segmentsCross(p(110, 110), p(100, 100), p(100, 110), p(110, 100)),
    ).toBe(true);
    expect(
      segmentsCross(p(100, 100), p(110, 110), p(110, 100), p(100, 110)),
    ).toBe(true);
    expect(
      segmentsCross(p(110, 110), p(100, 100), p(110, 100), p(100, 110)),
    ).toBe(true);
  });

  it("does not count touching, collinear or merely aimed segments", () => {
    // An end on the other segment.
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 0), p(5, 10))).toBe(false);
    expect(segmentsCross(p(5, 0), p(5, 10), p(0, 0), p(10, 0))).toBe(false);
    // The second would cross the first's line, but the first stops short.
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 1), p(5, 10))).toBe(false);
    expect(segmentsCross(p(5, 1), p(5, 10), p(0, 0), p(10, 0))).toBe(false);
    expect(segmentsCross(p(0, 0), p(10, 0), p(20, -5), p(20, 5))).toBe(false);
    expect(segmentsCross(p(20, -5), p(20, 5), p(0, 0), p(10, 0))).toBe(false);
    expect(segmentsCross(p(0, 0), p(10, 0), p(2, 0), p(8, 0))).toBe(false);
  });
});

describe("edges against boxes and each other", () => {
  it("lets edges pass labels and lifelines, and counts a crossing once per segment that crosses", () => {
    const m = measure({
      nodes: [
        box("A", 0, 0, 20, 20),
        box("B", 200, 0, 20, 20),
        box("label", 90, -10, 20, 40, { label: true }),
        box("line", 140, -10, 20, 40, { through: true }),
        box("wall", 50, -10, 20, 40),
      ],
      edges: [
        edge("e", ["A", "B"], 10, 10, 60, 10, 60, 100, 210, 100, 210, 10),
      ],
    });
    // Only the first segment runs through the wall; the label and the
    // lifeline are no obstacles.
    expect(m.nodeEdgeCrossings).toBe(1);
  });

  it("does not count edges that share an end as crossing", () => {
    const nodes = [
      box("A", 0, 0, 10, 10),
      box("B", 100, 100, 10, 10),
      box("C", 100, 0, 10, 10),
      box("D", 0, 100, 10, 10),
    ];
    const shared = measure({
      nodes,
      edges: [
        edge("e1", ["A", "B"], 0, 0, 100, 100),
        edge("e2", ["A", "C"], 100, 0, 0, 100),
      ],
    });
    expect(shared.edgeCrossings).toBe(0);
    const apart = measure({
      nodes,
      edges: [
        edge("e1", ["A", "B"], 0, 0, 100, 100),
        edge("e2", ["C", "D"], 100, 0, 0, 100),
      ],
    });
    expect(apart.edgeCrossings).toBe(1);
  });

  it("measures length variation as the deviation over the mean", () => {
    const m = measure({
      nodes: [box("A", 0, 0, 10, 10), box("B", 100, 0, 10, 10)],
      edges: [
        edge("e1", ["A", "B"], 0, 0, 10, 0),
        edge("e2", ["A", "B"], 0, 0, 0, 30),
      ],
    });
    expect(m.lengthVariation).toBeCloseTo(0.5);
  });

  it("aligns boxes, not labels", () => {
    const m = measure({
      nodes: [
        box("A", 0, 0, 10, 10),
        box("B", 47, 33, 10, 10),
        box("label", 0, 0, 10, 10, { label: true }),
      ],
      edges: [],
    });
    expect(m.alignment).toBe(0);
  });

  it("gives a flat or narrow drawing the neutral aspect", () => {
    expect(overlap(box("a", 0, 0, 0, 10)).aspect).toBe(1);
    expect(overlap(box("a", 0, 0, 10, 0)).aspect).toBe(1);
  });
});

describe("ratings", () => {
  it("starts each rating at its score", () => {
    expect([90, 89, 80, 79, 60, 59, 40, 39].map(ratingOf)).toEqual([
      5, 4, 4, 3, 3, 2, 2, 1,
    ]);
  });
});
