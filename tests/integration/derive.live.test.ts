import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { BASE_URL, call, describeLive, headers, liveDir } from "./support.js";

interface Derived {
  diagrams: {
    kind: string;
    name: string;
    diagram: string;
    created: number;
    deleted?: number;
    quality?: { score: number; rating: number; passes: boolean };
  }[];
  counts: { diagrams: number; created: number; deleted: number };
  quality?: { min: number; mean: number; failing: string[] };
}

/** A call as an MCP client makes it, with the size of what it answers. */
async function measured(path: string, body: Record<string, unknown>) {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, chars: text.length, json: JSON.parse(text) };
}

// Issue #33 acceptance on StarUML 7.1.1: the ThingsBoard object spec,
// written before any drawing, becomes the model in one call and every
// diagram kind of the ThingsBoard validation in a second, each reaching
// quality 4 (score 80) after the loop, with no verb mapping by the caller
// and the responsibilities in the documentation. A second derivation
// changes nothing.
describeLive("model first: build_model + derive_diagrams", () => {
  const sizes: Record<string, number> = {};
  let derived: Derived;
  let model = "";

  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("refuses a spec that tries to draw, before anything is made", async () => {
    const res = await call("/build_model", {
      spec: { classes: [{ name: "A", x: 10, fillColor: "#ff0000" }] },
    });
    expect(res).toMatchObject({ status: 400, code: "INVALID_ARGUMENT" });
    expect(res.error).toMatch(/^spec\.classes\.0: Unrecognized keys?/);
  });

  it("reproduces every diagram kind of the ThingsBoard validation in two calls", async () => {
    const built = await measured("/build_model", { spec: tb });
    expect(built.json.success, JSON.stringify(built.json).slice(0, 500)).toBe(
      true,
    );
    sizes.build_model = built.chars;
    model = built.json.data.model._id;
    const out = await measured("/derive_diagrams", { scope: model });
    expect(out.json.success, JSON.stringify(out.json).slice(0, 800)).toBe(true);
    sizes.derive_diagrams = out.chars;
    derived = out.json.data;
    const kinds: Record<string, number> = {};
    for (const d of derived.diagrams) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    expect(kinds).toEqual({
      package: 1,
      class: 6,
      sequence: 5,
      usecase: 4,
      statemachine: 3,
      activity: 1,
      erd: 1,
      c4: 1,
      deployment: 2,
      mindmap: 1,
    });
    const report = {
      calls: 2,
      resultChars: sizes,
      approxResultTokens: Math.round(
        (sizes.build_model! + sizes.derive_diagrams!) / 4,
      ),
      diagrams: derived.diagrams.map((d) => ({
        kind: d.kind,
        name: d.name,
        score: d.quality?.score,
        rating: d.quality?.rating,
      })),
    };
    writeFileSync(
      join(liveDir(), "thingsboard-acceptance.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    const low = derived.diagrams.filter((d) => (d.quality?.score ?? 0) < 80);
    expect(low.map((d) => `${d.name} ${d.quality?.score}`)).toEqual([]);
  }, 600_000);

  it("keeps responsibilities in documentation and binds lifelines to their classes", async () => {
    const tenant = await call<{ documentation: string }>("/get_element_by_id", {
      ref: "ThingsBoard/Domain Model \\(common\\.data\\)/Tenant",
      fields: ["documentation"],
    });
    expect(tenant.data.documentation).toMatch(/^Isolation boundary/);
    const explained = await call<{ text: string }>("/explain_model", {
      scope: model,
      maxChars: 400_000,
    });
    expect(explained.data.text).toContain(
      "- Tenant (class): Isolation boundary",
    );
    expect(explained.data.text).toMatch(/owns Customer/);
  });

  it("derives again to the same diagrams, changing nothing", async () => {
    const again = await call<Derived>("/derive_diagrams", { scope: model });
    expect(again.success).toBe(true);
    expect(again.data.counts).toMatchObject({ created: 0, deleted: 0 });
    expect(again.data.diagrams.map((d) => d.diagram)).toEqual(
      derived.diagrams.map((d) => d.diagram),
    );
  }, 600_000);

  it("lints the object design and hides drawing from a strict oo client", async () => {
    const lint = await call<{ count: number; findings: { rule: string }[] }>(
      "/model_lint",
      { scope: model, limit: 1000 },
    );
    expect(lint.success).toBe(true);
    expect(lint.data.count).toBeGreaterThan(0);
    await call("/set_style_profile", { patch: { strict: true } });
    const oo = await call<{ endpoints: { path: string }[] }>("/introspect", {
      include: ["endpoints"],
      capabilities: "oo",
    });
    const paths = oo.data.endpoints.map((e) => e.path);
    expect(paths).toContain("/derive_diagrams");
    expect(paths).not.toContain("/move_views");
    expect(paths).not.toContain("/build_diagram");
    await call("/set_style_profile", { reset: true });
  });
});
