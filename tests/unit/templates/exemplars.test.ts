import { resolve } from "node:path";
import { format } from "prettier";
import { beforeAll, describe, expect, it } from "vitest";
import approved from "../../fixtures/exemplars/approved.json";
import {
  accepts,
  type Exemplar,
  exemplarOf,
  fingerprint,
  similarity,
} from "../../../src/templates/exemplar.js";
import { templates } from "../../../src/templates/index.js";
import type { Element } from "../../../src/types.js";
import { partViews, readMark } from "../../../src/viewpoints/mark.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";

// Issue #43: each template's golden exemplar is a diagram rated 4 or 5 out
// of 5 from its rendering (approved.json), kept in thingsboard.mdj; the
// engine's yardstick, exemplars.json, is derived from it here.

const MDJ = resolve("tests/fixtures/exemplars/thingsboard.mdj");
const APPROVED = approved as Record<
  string,
  { diagram: string; rating: number; score: number; notes: string }
>;

let env: MockEnvironment;
const diagramNamed = (name: string) =>
  env.app.repository
    .getInstancesOf("Diagram")
    .find((d) => d.name === name) as Element;
const partsOf = (d: Element) =>
  new Set(partViews(d, readMark(d)).map((v) => v._id));

beforeAll(() => {
  env = installMockApp();
  env.app.project.loadAsTemplate(MDJ);
});

describe("golden exemplars", () => {
  it("approves one diagram rated 4 or better for every template, drawn with it", () => {
    expect(Object.keys(APPROVED).sort()).toEqual(
      templates()
        .map((t) => t.name)
        .sort(),
    );
    for (const [name, a] of Object.entries(APPROVED)) {
      expect(a.rating, name).toBeGreaterThanOrEqual(4);
      const d = diagramNamed(a.diagram);
      expect(readMark(d), name).toMatchObject({ template: name });
    }
  });

  it("keeps the engine's fingerprints in step with the approved .mdj", async () => {
    const out: Record<string, Exemplar> = {};
    for (const [name, a] of Object.entries(APPROVED)) {
      const d = diagramNamed(a.diagram);
      out[name] = {
        diagram: a.diagram,
        score: a.score,
        fingerprint: fingerprint(d, partsOf(d)),
      };
    }
    await expect(
      await format(JSON.stringify(out), { parser: "json" }),
    ).toMatchFileSnapshot("../../../src/templates/exemplars.json");
  });

  it("accepts each exemplar as one of its own template, and not of the others", () => {
    for (const t of templates()) {
      const a = APPROVED[t.name]!;
      const d = diagramNamed(a.diagram);
      const ex = exemplarOf(t)!;
      expect(similarity(fingerprint(d, partsOf(d)), ex.fingerprint)).toBe(1);
      expect(accepts(t, d, a.score, partsOf(d)), t.name).toBe(true);
    }
    const seq = templates().find((t) => t.name === "runtime-sequence")!;
    const erd = diagramNamed(APPROVED["data-erd"]!.diagram);
    expect(accepts(seq, erd, 100, partsOf(erd))).toBe(false);
  });
});
