import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import { call, describeLive } from "./support.js";

interface Quality {
  score: number;
  before: number;
  target: number;
  passes: boolean;
  steps: string[];
}

const ok = <T>(res: { success: boolean; data: T }, what: string): T => {
  expect(res.success, `${what}: ${JSON.stringify(res).slice(0, 600)}`).toBe(
    true,
  );
  return res.data;
};

const box = async (id: string) =>
  ok(
    await call<{ left: number; top: number }>("/get_element_by_id", {
      ref: id,
      fields: ["left", "top"],
    }),
    "box",
  );

// Issue #32 on StarUML 7.1.1: every build runs the quality loop and reaches
// the profile's threshold; /diagram_quality scores any diagram;
// /improve_diagram repairs a scrambled one in one undo step.
describeLive("quality loop", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("brings every golden build of a kind to its threshold", async () => {
    const low: string[] = [];
    for (const [name, spec] of Object.entries(
      cases as Record<string, Record<string, unknown>>,
    )) {
      if (name.startsWith("p-activity")) continue; // lanes keep the build's placement
      const built = ok(
        await call<{ quality: Quality }>("/build_diagram", spec),
        name,
      );
      if (!built.quality.passes) low.push(`${name} ${built.quality.score}`);
    }
    expect(low).toEqual([]);
  }, 300_000);

  it("scores a scrambled diagram low and repairs it, dry run first, in one undo step", async () => {
    const built = ok(
      await call<{
        diagram: { _id: string };
        ids: Record<string, { view: string }>;
      }>("/build_diagram", {
        kind: "class",
        name: "Scrambled",
        result: "ids",
        spec: {
          classes: ["Base", "Left", "Right", "Leaf"].map((name) => ({ name })),
          relations: [
            { from: "Left", to: "Base", type: "generalization" },
            { from: "Right", to: "Base", type: "generalization" },
            { from: "Leaf", to: "Left", type: "association" },
          ],
        },
      }),
      "build",
    );
    const views = Object.values(built.ids).map((r) => r.view);
    for (const v of views) {
      const b = await box(v);
      ok(
        await call("/move_views", {
          refs: [v],
          dx: 300 - b.left,
          dy: 300 - b.top,
        }),
        "stack",
      );
    }
    const scored = ok(
      await call<{ score: number; findings: { rule: string }[] }>(
        "/diagram_quality",
        { ref: built.diagram._id },
      ),
      "score",
    );
    expect(scored.findings.map((f) => f.rule)).toContain("L001");
    const dry = ok(
      await call<{ quality: Quality }>("/improve_diagram", {
        ref: built.diagram._id,
        dryRun: true,
      }),
      "dry",
    );
    expect(dry.quality.score).toBeGreaterThan(scored.score);
    expect(await box(views[1]!)).toMatchObject({ left: 300, top: 300 });
    const done = ok(
      await call<{ quality: Quality }>("/improve_diagram", {
        ref: built.diagram._id,
      }),
      "improve",
    );
    expect(done.quality.score).toBeGreaterThanOrEqual(80);
    expect(done.quality.score).toBe(dry.quality.score);
    ok(await call("/undo"), "undo");
    expect(await box(views[1]!)).toMatchObject({ left: 300, top: 300 });
    const laid = ok(
      await call<{ quality: Quality }>("/layout_diagram", {
        diagram: built.diagram._id,
        preset: "hierarchy-down",
      }),
      "layout",
    );
    expect(laid.quality.score).toBeGreaterThanOrEqual(80);
  });

  it("restores a snapshot taken before the loop runs", async () => {
    const built = ok(
      await call<{ diagram: { _id: string } }>("/build_diagram", {
        kind: "class",
        spec: {
          classes: [{ name: "P" }, { name: "Q" }, { name: "R" }],
          relations: [{ from: "Q", to: "P", type: "generalization" }],
        },
      }),
      "build",
    );
    ok(await call("/snapshot", { label: "loop" }), "snapshot");
    ok(
      await call("/improve_diagram", { ref: built.diagram._id, dryRun: true }),
      "dry",
    );
    ok(await call("/improve_diagram", { ref: built.diagram._id }), "improve");
    ok(await call("/layout_diagram", { diagram: built.diagram._id }), "layout");
    const restored = ok(
      await call<{ undone: number; remaining: Record<string, number> }>(
        "/restore_snapshot",
        { snapshot: "loop" },
      ),
      "restore",
    );
    expect(restored.undone).toBeLessThanOrEqual(2);
    expect(restored.remaining).toEqual({ added: 0, changed: 0, removed: 0 });
  });

  it("is how a strict profile rearranges a diagram", async () => {
    ok(await call("/set_style_profile", { patch: { strict: true } }), "strict");
    const built = ok(
      await call<{ diagram: { _id: string } }>("/build_diagram", {
        kind: "class",
        viewpoint: "code",
        spec: { classes: [{ name: "A" }, { name: "B" }] },
      }),
      "build",
    );
    ok(await call("/improve_diagram", { ref: built.diagram._id }), "improve");
    ok(await call("/set_style_profile", { reset: true }), "reset");
  });
});
