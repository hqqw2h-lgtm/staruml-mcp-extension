import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint } from "../../../src/endpoint.js";
import { endpoints } from "../../../src/routes.js";
import {
  isTrusted,
  saveChecks,
  saveGated,
  STYLE_ENDPOINTS,
  styleLocked,
  trusted,
  viewFieldLocked,
} from "../../../src/style/guard.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

// Issue #31/#33 enforcement contract: in a strict profile every free-form
// style or geometry endpoint answers STYLE_LOCKED, directly and inside a
// client's /batch; override: true and the extension's own calls pass; with
// blockSaveOnErrors every save and export answers SAVE_BLOCKED while the
// lints report errors.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;

beforeEach(() => {
  env = installMockApp();
});

async function strict(patch: Record<string, unknown> = { strict: true }) {
  await ok(ep("/set_style_profile"), { patch });
}

/** A class diagram with two classes and an association, by build. */
async function diagram(name = "D") {
  const built = await ok<{
    diagram: { _id: string };
    ids: Record<string, { model: string; view: string }>;
    edges: { view: string }[];
  }>(ep("/build_diagram"), {
    kind: "class",
    viewpoint: "code",
    name,
    result: "full",
    spec: {
      classes: [{ name: "A" }, { name: "B" }],
      relations: [{ from: "A", to: "B", type: "association" }],
    },
  });
  return built;
}

/** A request each locked endpoint accepts in a non-strict profile. */
function requests(d: Awaited<ReturnType<typeof diagram>>) {
  const a = d.ids.A!.view;
  return {
    "/set_view_style": { refs: [a], fillColor: "#ff0000" },
    "/apply_theme": { ref: d.diagram._id, theme: "monochrome" },
    "/move_views": { refs: [a], dx: 10, dy: 0 },
    "/resize_node": { ref: a, width: 300 },
    "/route_edges": { diagram: d.diagram._id, lineStyle: "oblique" },
    "/set_z_order": { refs: [a], position: "front" },
    "/divide_fragment": { ref: a, at: [1] },
  } satisfies Record<(typeof STYLE_ENDPOINTS)[number], unknown>;
}

describe("strict profile (STYLE_LOCKED)", () => {
  it("refuses every style and geometry endpoint, directly and in a batch", async () => {
    const d = await diagram();
    await strict();
    expect(Object.keys(requests(d)).sort()).toEqual(
      [...STYLE_ENDPOINTS].sort(),
    );
    for (const [path, body] of Object.entries(requests(d))) {
      const refused = await fails(ep(path), body, "STYLE_LOCKED");
      expect(refused.error).toMatch(/uml-standard' is strict/);
      expect(refused.details).toEqual({
        profile: "uml-standard",
        endpoint: path,
      });
      const run = await ok<{ results: { code?: string }[] }>(ep("/batch"), {
        ops: [{ path, body }],
        atomic: false,
      });
      expect(run.results[0]!.code).toBe("STYLE_LOCKED");
    }
  });

  it("lets override: true through, and does nothing when not strict", async () => {
    const d = await diagram();
    const r = requests(d);
    await ok(ep("/set_view_style"), r["/set_view_style"]);
    await strict();
    const done = await ok<{ views: { fillColor: string }[] }>(
      ep("/set_view_style"),
      { ...r["/set_view_style"], fillColor: "#00ff00", override: true },
    );
    expect(done.views[0]!.fillColor).toBe("#00ff00");
    await ok(ep("/move_views"), { ...r["/move_views"], override: true });
  });

  it("refuses /update_element on a view's style or geometry only", async () => {
    const d = await diagram();
    await strict();
    const update = ep("/update_element");
    await fails(
      update,
      { ref: d.ids.A!.view, field: "left", value: 5 },
      "STYLE_LOCKED",
    );
    await fails(
      update,
      { id: d.ids.A!.view, field: "fillColor", value: "#000000" },
      "STYLE_LOCKED",
    );
    await ok(update, { ref: d.ids.A!.model, field: "name", value: "Aa" });
    await ok(update, { ref: d.ids.A!.view, field: "visible", value: true });
    await ok(update, {
      ref: d.ids.A!.view,
      field: "left",
      value: 5,
      override: true,
    });
    // Refs that resolve to nothing or to several are the endpoint's to report.
    await fails(
      update,
      { ref: "Nothing/Here", field: "left", value: 1 },
      "NOT_FOUND",
    );
    await fails(update, { field: "left", value: 1 }, "INVALID_ARGUMENT");
  });

  it("leaves ambiguous refs to the endpoint", async () => {
    for (let i = 0; i < 2; i++) {
      await ok(ep("/create_element"), {
        type: "UMLModel",
        parent: env.project._id,
        name: "Twin",
        allowDuplicateNames: true,
      });
    }
    await strict();
    await fails(
      ep("/update_element"),
      { ref: "Twin", field: "left", value: 1 },
      "AMBIGUOUS_REF",
    );
  });

  it("lets the extension's own calls through: builds still style and place views", async () => {
    await strict();
    const d = await diagram();
    expect(d.diagram._id).toBeTruthy();
    expect(isTrusted()).toBe(false);
    await trusted(async () => {
      expect(isTrusted()).toBe(true);
      await ok(ep("/move_views"), { refs: [d.ids.A!.view], dx: 1, dy: 1 });
    });
  });

  it("passes non-object bodies to the endpoint, which refuses them", async () => {
    await strict();
    const res = await styleLocked(ep("/move_views")).handler(
      null as unknown as Record<string, unknown>,
    );
    expect(res).toMatchObject({ success: false, code: "STYLE_LOCKED" });
    const raw = defineEndpoint({
      path: "/raw",
      description: "",
      readOnly: true,
      destructive: false,
      request: z.object({}),
      response: z.unknown(),
      handle: () => 1,
    });
    const guarded = viewFieldLocked(raw);
    expect(
      await guarded.handler([] as unknown as Record<string, unknown>),
    ).toMatchObject({ success: false, code: "INVALID_ARGUMENT" });
  });
});

describe("blockSaveOnErrors (SAVE_BLOCKED)", () => {
  const SAVES: [string, Record<string, unknown>][] = [
    ["/save_project", { filename: "/tmp/x.mdj" }],
    ["/save_project_as", { filename: "/tmp/x.mdj" }],
    ["/export_diagram", { diagram: "@current" }],
    ["/export_diagrams", { folder: "/tmp/out" }],
    ["/export_pdf", { filename: "/tmp/x.pdf" }],
    ["/export_html", { folder: "/tmp/html" }],
    ["/export_text", { diagram: "@current" }],
  ];

  /** A relationship without its end: U004, an error by default. */
  async function lintError(name = "D") {
    const d = await diagram(name);
    const rel = env.app.repository.getInstancesOf("UMLAssociation")[0]!;
    (rel.end2 as { reference: unknown }).reference = null;
    return d;
  }

  it("refuses every save and export while the lints report errors", async () => {
    await lintError();
    await strict({ blockSaveOnErrors: true });
    for (const [path, body] of SAVES) {
      const refused = await fails(ep(path), body, "SAVE_BLOCKED");
      expect(refused.error).toMatch(/blocks saving and exporting/);
      expect(refused.details).toMatchObject({
        count: 1,
        findings: [{ rule: "U004" }],
      });
    }
  });

  it("saves with override, without errors, or without the option", async () => {
    await diagram();
    await strict({ blockSaveOnErrors: true });
    await ok(ep("/save_project"), { filename: "/tmp/ok.mdj" });
    await lintError("E");
    await ok(ep("/save_project"), { filename: "/tmp/ok.mdj", override: true });
    await strict({ blockSaveOnErrors: false });
    await ok(ep("/save_project"), { filename: "/tmp/ok.mdj" });
  });

  it("counts naming as an error under a strict profile", async () => {
    await ok(ep("/build_diagram"), {
      kind: "class",
      spec: { classes: [{ name: "Shop", attributes: ["+Total: int"] }] },
    });
    await ok(ep("/update_element"), {
      ref: "Shop",
      field: "name",
      value: "shop",
    });
    await strict({ strict: true, blockSaveOnErrors: true });
    const refused = await fails(
      ep("/save_project"),
      { filename: "/tmp/x.mdj" },
      "SAVE_BLOCKED",
    );
    expect(refused.details).toMatchObject({ findings: [{ rule: "U012" }] });
  });

  it("checks nothing without a project, and runs every registered check", async () => {
    await strict({ blockSaveOnErrors: true });
    expect(saveChecks.length).toBeGreaterThan(0);
    env.app.project.getProject = () => null as never;
    const gated = saveGated(ep("/get_project_info"));
    expect(await gated.handler({})).toMatchObject({ success: true });
  });
});
