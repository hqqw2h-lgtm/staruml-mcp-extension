import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { decodePng, type Pixels } from "./png.js";
import { call, describeLive } from "./support.js";

/** StarUML's own API server (58321), whose image draws the selection. */
const BUILT_IN = process.env.STARUML_API_URL ?? "http://localhost:58321";

/** Pixels in StarUML's selection handle colour (GraphicUtils.SELECTION_COLOR, #4f99ff). */
function handlePixels(p: Pixels): number {
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const [r, g, b] = [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
    if (Math.abs(r - 0x4f) < 24 && Math.abs(g - 0x99) < 24 && b > 0xe0) n++;
  }
  return n;
}

// Issue #39 on StarUML 7.1.1: derived diagrams reuse what other derived
// diagrams made, view sections keep out of the object model's namespace,
// and no write leaves a selection for a renderer to draw.
describeLive("reuse and clean exports (#39)", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("derives ThingsBoard twice with no UML001 or UML002 problem", async () => {
    const built = await call<{ model: { _id: string } }>("/build_model", {
      spec: tb,
    });
    expect(built.success).toBe(true);
    for (let i = 0; i < 2; i++) {
      const d = await call("/derive_diagrams", { scope: built.data.model._id });
      expect(d.success).toBe(true);
    }
    const v = await call<{ problems: { ruleId: string; name: string }[] }>(
      "/validate_model",
    );
    expect(
      v.data.problems
        .filter((p) => p.ruleId === "UML001" || p.ruleId === "UML002")
        .map((p) => `${p.ruleId} ${p.name}`),
    ).toEqual([]);
  }, 600_000);

  it("leaves nothing selected after apply_pattern, so no image draws handles", async () => {
    await call("/new_project");
    // A new 7.1.1 project holds no model.
    await call("/create_element", {
      type: "UMLModel",
      parent: "@project",
      name: "Model",
    });
    await call("/create_element", {
      type: "UMLPackage",
      parent: "Model",
      name: "Handles",
    });
    const applied = await call<{ diagram: string }>("/apply_pattern", {
      pattern: "Strategy",
      parent: "Model/Handles",
      diagram: "Handles",
    });
    expect(applied.success, JSON.stringify(applied).slice(0, 400)).toBe(true);
    const id = applied.data.diagram;
    const exported = await call<{ base64: string }>("/export_diagram", {
      diagram: id,
      background: "#ffffff",
    });
    expect(
      handlePixels(decodePng(Buffer.from(exported.data.base64, "base64"))),
    ).toBe(0);
    const res = await fetch(`${BUILT_IN}/get_diagram_image_by_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagramId: id }),
    });
    const image = (await res.json()) as { success: boolean; data: string };
    expect(image.success).toBe(true);
    expect(handlePixels(decodePng(Buffer.from(image.data, "base64")))).toBe(0);
  }, 120_000);
});
