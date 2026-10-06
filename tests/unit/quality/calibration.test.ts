import { describe, expect, it } from "vitest";
import data from "../../fixtures/quality/human-ratings.json";
import {
  type Metrics,
  ratingOf,
  scoreOf,
} from "../../../src/quality/metric.js";

/** Ranks with ties sharing their mean rank, as Spearman's rho needs. */
function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const mean = (xs: readonly number[]) =>
    xs.reduce((n, x) => n + x, 0) / xs.length;
  const [ma, mb] = [mean(a), mean(b)];
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i]! - mb);
    da += (x - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
}

const spearman = (a: readonly number[], b: readonly number[]) =>
  pearson(ranks(a), ranks(b));

describe("quality metric calibration (#38)", () => {
  const rows = data.diagrams.map((d) => ({
    ...d,
    score: scoreOf(d.metrics as Metrics, data.page),
  }));

  it("ranks the 50 human-rated ThingsBoard diagrams as the reviewers did (Spearman >= 0.7)", () => {
    expect(rows).toHaveLength(50);
    const rho = spearman(
      rows.map((r) => r.score),
      rows.map((r) => r.human),
    );
    expect(rho).toBeGreaterThanOrEqual(0.7);
    for (const set of ["oo", "hand"]) {
      const sub = rows.filter((r) => r.set === set);
      // Each set alone still agrees more than it disagrees.
      expect(
        spearman(
          sub.map((r) => r.score),
          sub.map((r) => r.human),
        ),
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("no longer passes the 8:1 mind map the reviewer rated 1", () => {
    const map = rows.find((r) => r.set === "oo" && r.human === 1)!;
    expect(map.name).toBe("ThingsBoard Features");
    expect(ratingOf(map.score)).toBeLessThanOrEqual(2);
  });

  it("ranks the clean three-use-case diagram above the strip and the overlap", () => {
    const score = (name: string) =>
      rows.find((r) => r.set === "oo" && r.name === name)!.score;
    expect(score("Use Cases - System Administrator")).toBeGreaterThan(
      score("Class - Actor System"),
    );
    expect(score("Class - Actor System")).toBeLessThan(90);
  });
});
