import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

// Issue #27: the endpoints no other live suite answers with success, so
// the recorded request examples (tests/fixtures/requests.json) cover the
// whole manifest.
describeLive("endpoints otherwise reached only through others", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("lists the patterns and reads the editor's state", async () => {
    const patterns = await call<{ patterns: unknown[] }>("/list_patterns");
    expect(patterns.success).toBe(true);
    expect(patterns.data.patterns.length).toBeGreaterThan(5);
    const state = await call("/get_editor_state");
    expect(state.success).toBe(true);
  });

  it("divides a fragment where asked", async () => {
    const seq = await call<{
      ids: Record<string, { view: string }>;
    }>("/build_diagram", {
      mermaid:
        "sequenceDiagram\n  alt a\n  A->>B: 1\n  else b\n  A->>B: 2\n  end",
      result: "ids",
    });
    const fragment = seq.data.ids["fragment 0"]!.view;
    const view = await call<{ top: number; height: number }>(
      "/get_element_by_id",
      { ref: fragment, fields: ["top", "height"] },
    );
    const res = await call("/divide_fragment", {
      ref: fragment,
      at: [Math.round(view.data.top + view.data.height * 0.6)],
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
  });
});
