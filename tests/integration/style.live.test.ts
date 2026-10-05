import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir } from "./support.js";

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
  edges: { model: string; view: string }[];
  style?: { renamed?: { from: string; to: string }[]; styled?: number };
  warnings?: string[];
}

const ok = <T>(res: { success: boolean; data: T }, what: string): T => {
  expect(res.success, `${what}: ${JSON.stringify(res).slice(0, 600)}`).toBe(
    true,
  );
  return res.data;
};

const view = async (id: string) =>
  ok(
    await call<Record<string, unknown>>("/get_element_by_id", {
      ref: id,
      fields: ["fillColor", "lineColor", "font", "left", "top", "name"],
    }),
    "get view",
  );

const SPEC = {
  classes: [
    { name: "order line", attributes: ["+Total: int"], stereotype: "entity" },
    { name: "Payable", kind: "interface", operations: ["pay()"] },
  ],
  relations: [{ from: "order line", to: "Payable", type: "realization" }],
};

// Issue #31 on StarUML 7.1.1: the profile is stored in the project, every
// build applies it, a strict profile refuses free-form styling with
// STYLE_LOCKED, blockSaveOnErrors gates saving, and builds are deterministic.
describeLive("style profile", () => {
  const dir = liveDir();

  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("travels with the .mdj", async () => {
    ok(await call("/set_style_profile", { profile: "presentation" }), "set");
    const file = join(dir, "profile.mdj");
    ok(await call("/save_project", { filename: file }), "save");
    await call("/new_project");
    expect(
      ok(await call<{ source: string }>("/get_style_profile"), "get").source,
    ).toBe("preferences");
    ok(await call("/open_project", { filename: file }), "open");
    const got = ok(
      await call<{ source: string; profile: { name: string } }>(
        "/get_style_profile",
      ),
      "get",
    );
    expect(got).toMatchObject({
      source: "project",
      profile: { name: "presentation" },
    });
    await call("/new_project");
  });

  it("names and styles what a build makes, and one undo takes it all back", async () => {
    ok(await call("/set_style_profile", { profile: "presentation" }), "set");
    const built = ok(
      await call<Built>("/build_diagram", {
        kind: "class",
        name: "S",
        spec: SPEC,
      }),
      "build",
    );
    expect(built.style!.renamed).toEqual([
      { kind: "classifier", from: "order line", to: "OrderLine" },
      { kind: "attribute", from: "Total", to: "total" },
    ]);
    const order = await view(built.ids["order line"]!.view);
    expect(order.fillColor).toBe("#fdf6e3");
    expect(String(order.font)).toContain("15");
    ok(await call("/undo"), "undo");
    const after = await call("/get_element_by_id", { ref: built.diagram._id });
    expect(after.code).toBe("NOT_FOUND");
    await call("/new_project");
  });

  it("refuses free-form style and geometry under a strict profile, unless overridden", async () => {
    ok(
      await call("/set_style_profile", {
        profile: "print",
        patch: { strict: true },
      }),
      "set",
    );
    const built = ok(
      await call<Built>("/build_diagram", { kind: "class", spec: SPEC }),
      "build",
    );
    const a = built.ids["order line"]!.view;
    for (const [path, body] of [
      ["/set_view_style", { refs: [a], fillColor: "#ff0000" }],
      ["/move_views", { refs: [a], dx: 5, dy: 5 }],
      ["/resize_node", { ref: a, width: 400 }],
      ["/apply_theme", { ref: built.diagram._id, theme: "blueprint" }],
      ["/route_edges", { diagram: built.diagram._id, lineStyle: "curve" }],
      ["/set_z_order", { refs: [a], position: "back" }],
      ["/update_element", { ref: a, field: "fillColor", value: "#ff0000" }],
    ] as const) {
      const res = await call(path, body);
      expect(res, path).toMatchObject({ status: 403, code: "STYLE_LOCKED" });
    }
    const forced = ok(
      await call<{ views: { fillColor: string }[] }>("/set_view_style", {
        refs: [a],
        fillColor: "#ff0000",
        override: true,
      }),
      "override",
    );
    expect(forced.views[0]!.fillColor).toBe("#ff0000");
    const linted = ok(
      await call<{ findings: { rule: string; severity: string }[] }>(
        "/lint_diagram",
        { diagram: built.diagram._id, rules: ["L009"] },
      ),
      "lint",
    );
    expect(linted.findings[0]).toMatchObject({
      rule: "L009",
      severity: "error",
    });
    const applied = ok(
      await call<{ styled: number }>("/apply_style_profile", {
        scope: built.diagram._id,
      }),
      "apply",
    );
    expect(applied.styled).toBe(1);
    expect((await view(a)).fillColor).toBe("#ffffff");
    await call("/new_project");
  });

  it("blocks saving and exporting while the lints report errors", async () => {
    ok(
      await call("/set_style_profile", {
        profile: "uml-standard",
        patch: { strict: true, blockSaveOnErrors: true },
      }),
      "set",
    );
    const project = ok(
      await call<{ project: { _id: string } }>("/get_project_info"),
      "project",
    ).project;
    ok(
      await call("/create_element", {
        type: "UMLModel",
        parent: project._id,
        name: "Model",
      }),
      "model",
    );
    ok(
      await call("/create_element", {
        type: "UMLClass",
        parent: "Model",
        name: "bad_name",
      }),
      "create",
    );
    const file = join(dir, "blocked.mdj");
    const refused = await call("/save_project", { filename: file });
    expect(refused).toMatchObject({ status: 409, code: "SAVE_BLOCKED" });
    const exported = await call("/export_text", {
      diagram: "@current",
      format: "mermaid",
    });
    expect(exported.code).toBe("SAVE_BLOCKED");
    ok(
      await call("/save_project", { filename: file, override: true }),
      "override",
    );
    const explained = ok(
      await call<{
        violations: {
          expected: string;
          autofix: { path: string; body: Record<string, unknown> };
        }[];
      }>("/explain_style_violation", { ref: "Model/bad_name" }),
      "explain",
    );
    const fix = explained.violations[0]!.autofix;
    expect(explained.violations[0]!.expected).toBe("BadName");
    ok(await call(fix.path, fix.body), "fix");
    ok(await call("/save_project", { filename: file }), "save");
    await call("/new_project");
  });

  it("builds the same spec on the same profile to the same picture and text, twice", async () => {
    const runs: string[] = [];
    for (let i = 0; i < 2; i++) {
      await call("/new_project");
      ok(await call("/set_style_profile", { profile: "print" }), "set");
      const built = ok(
        await call<Built>("/build_diagram", {
          kind: "class",
          name: "Det",
          spec: SPEC,
        }),
        "build",
      );
      const geometry = await Promise.all(
        Object.values(built.ids).map(async (r) => {
          const v = await view(r.view);
          return `${v.left},${v.top},${v.fillColor},${v.font}`;
        }),
      );
      const text = ok(
        await call<{ text: string }>("/export_text", {
          diagram: built.diagram._id,
          format: "mermaid",
        }),
        "text",
      ).text;
      runs.push(`${geometry.join("|")}\n${text}`);
    }
    expect(runs[1]).toBe(runs[0]);
  });
});
