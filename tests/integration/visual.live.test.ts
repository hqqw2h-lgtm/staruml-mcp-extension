import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import {
  type Baseline,
  dhash,
  hamming,
  MAX_HASH_DISTANCE,
  MAX_PIXEL_DIFF,
  pixelDiff,
} from "../visual/compare.js";
import { decodePng } from "./png.js";
import { call, describeLive } from "./support.js";

// Issue #32 visual regression on StarUML 7.1.1: each golden spec is built,
// exported as PNG on white and compared with its baseline in tests/visual
// by difference hash and by pixels; its quality score may not fall below
// the baseline's. VISUAL_UPDATE=1 (npm run visual:update) records the
// baselines instead; a failing image is written to tests/visual/failures.

// Live tests run from the repository root (vitest.config.mts).
const VISUAL = join(process.cwd(), "tests/visual");
const BASELINES = join(VISUAL, "baselines.json");
const UPDATE = process.env.VISUAL_UPDATE === "1";

/** One golden case per diagram kind. */
const CASES = [
  "class",
  "sequence",
  "usecase",
  "activity",
  "statemachine",
  "erd",
  "flowchart",
  "mindmap",
  "requirement",
  "c4",
  "package",
  "component",
  "deployment",
] as const;

const read = (): Record<string, Baseline> => {
  try {
    return JSON.parse(readFileSync(BASELINES, "utf-8"));
  } catch {
    return {};
  }
};

describeLive("visual regression", () => {
  const baselines = read();
  const recorded: Record<string, Baseline> = {};

  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
    if (UPDATE) {
      writeFileSync(
        BASELINES,
        `${JSON.stringify({ ...baselines, ...recorded }, null, 2)}\n`,
      );
    }
  });

  for (const name of CASES) {
    it(`${name} looks as its baseline and scores no lower`, async () => {
      const spec = (cases as Record<string, Record<string, unknown>>)[name]!;
      const built = await call<{
        diagram: { _id: string };
        quality: { score: number };
      }>("/build_diagram", { ...spec, name: `visual-${name}` });
      expect(built.success, JSON.stringify(built).slice(0, 400)).toBe(true);
      const image = await call<{ base64: string }>("/export_diagram", {
        diagram: built.data.diagram._id,
        background: "#ffffff",
      });
      expect(image.success).toBe(true);
      const png = Buffer.from(image.data.base64, "base64");
      const pixels = decodePng(png);
      const now: Baseline = {
        hash: dhash(pixels),
        score: built.data.quality.score,
        width: pixels.width,
        height: pixels.height,
      };
      const file = join(VISUAL, "baselines", `${name}.png`);
      if (UPDATE) {
        writeFileSync(file, png);
        recorded[name] = now;
        return;
      }
      const base = baselines[name];
      expect(
        base,
        `${name}: no baseline; run npm run visual:update`,
      ).toBeDefined();
      const diff = pixelDiff(pixels, decodePng(readFileSync(file)));
      const distance = hamming(now.hash, base!.hash);
      if (distance > MAX_HASH_DISTANCE || diff > MAX_PIXEL_DIFF) {
        mkdirSync(join(VISUAL, "failures"), { recursive: true });
        writeFileSync(join(VISUAL, "failures", `${name}.png`), png);
      }
      expect(
        distance,
        `${name}: hash distance; see tests/visual/failures/${name}.png`,
      ).toBeLessThanOrEqual(MAX_HASH_DISTANCE);
      expect(
        diff,
        `${name}: differing pixels; see tests/visual/failures/${name}.png`,
      ).toBeLessThanOrEqual(MAX_PIXEL_DIFF);
      expect(now.score).toBeGreaterThanOrEqual(base!.score);
    });
  }
});
