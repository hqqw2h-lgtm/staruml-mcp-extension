import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir } from "./support.js";

// Issue #28 against StarUML 7.1.1: what was only reachable through its
// windows.
describeLive(
  "preferences, fragments, XMI, templates, find, tabs, extensions, metadata",
  () => {
    const dir = liveDir();

    beforeAll(async () => {
      await call("/new_project");
    });

    afterAll(async () => {
      await call("/new_project");
    });

    it("reads and sets an allowed preference, and keeps the token and server keys out", async () => {
      const grid = await call<{
        value: boolean;
        type: string;
        settable: boolean;
      }>("/get_preference", { key: "diagramEditor.showGrid" });
      expect(grid.data).toMatchObject({ type: "check", settable: true });
      const set = await call<{ value: boolean; previous: boolean }>(
        "/set_preference",
        { key: "diagramEditor.showGrid", value: !grid.data.value },
      );
      expect(set.data).toMatchObject({
        value: !grid.data.value,
        previous: grid.data.value,
      });
      await call("/set_preference", {
        key: "diagramEditor.showGrid",
        value: grid.data.value,
      });
      expect(
        (await call("/get_preference", { key: "mcp-ext.token" })).code,
      ).toBe("NOT_FOUND");
      expect(
        (
          await call("/set_preference", {
            key: "mcp-ext.server.port",
            value: 1,
          })
        ).code,
      ).toBe("INVALID_ARGUMENT");
      const limit = await call<{ value: number }>("/get_preference", {
        key: "mcp-ext.limits.maxBatchOps",
      });
      expect(limit.data.value).toBeGreaterThan(0);
    });

    it("exports a package as a fragment and imports it again", async () => {
      const built = await call<{ ids: Record<string, { model: string }> }>(
        "/build_diagram",
        {
          kind: "package",
          name: "Fragments",
          result: "ids",
          spec: { packages: ["Exported"] },
        },
      );
      const file = join(dir, "exported.mfj");
      const out = await call("/export_fragment", {
        ref: built.data.ids.Exported!.model,
        filename: file,
      });
      expect(out.success, JSON.stringify(out)).toBe(true);
      expect(JSON.parse(readFileSync(file, "utf-8"))._type).toBe("UMLPackage");
      const back = await call<{ element: { name: string; _id: string } }>(
        "/import_fragment",
        { filename: file },
      );
      expect(back.data.element.name).toBe("Exported");
      expect(back.data.element._id).not.toBe(built.data.ids.Exported!.model);
    });

    it("says XMI needs the staruml-xmi extension, which this StarUML lacks", async () => {
      const res = await call("/export_xmi", { filename: join(dir, "m.xmi") });
      expect(res.code).toBe("NOT_FOUND");
      expect(res.error).toMatch(/needs the staruml-xmi extension/);
      expect(existsSync(join(dir, "m.xmi"))).toBe(false);
    });

    it("finds elements by name and documentation", async () => {
      await call("/build_diagram", {
        kind: "class",
        name: "Find",
        spec: {
          classes: [{ name: "Quarterly", documentation: "zebra report" }],
        },
      });
      const byName = await call<{
        matches: { element: { name: string }; field: string }[];
      }>("/quick_find", { text: "quarterl" });
      expect(byName.data.matches.map((m) => [m.element.name, m.field])).toEqual(
        [["Quarterly", "name"]],
      );
      const byDoc = await call<{ total: number }>("/quick_find", {
        text: "ZEBRA",
      });
      expect(byDoc.data.total).toBe(1);
    });

    it("lists the open tabs and closes them", async () => {
      const d = await call<{ _id: string }>("/create_diagram", {
        type: "UMLClassDiagram",
        parent: "@project",
        name: "Tab",
      });
      await call("/switch_diagram", { diagram: d.data._id });
      const open = await call<{
        diagrams: { _id: string; current: boolean }[];
      }>("/list_working_diagrams");
      expect(open.data.diagrams).toContainEqual(
        expect.objectContaining({ _id: d.data._id, current: true }),
      );
      const closed = await call<{ closed: string[] }>("/close_diagrams", {
        diagrams: [d.data._id],
      });
      expect(closed.data.closed).toEqual([d.data._id]);
      const after = await call<{ diagrams: { _id: string }[] }>(
        "/list_working_diagrams",
      );
      expect(after.data.diagrams.map((x) => x._id)).not.toContain(d.data._id);
    });

    it("lists the extensions with their versions and commands", async () => {
      const res = await call<{
        extensions: {
          name: string;
          source: string;
          version: string;
          commands: string[];
        }[];
      }>("/list_extensions");
      // Essential extensions' package.json carries only an order (7.1.1).
      const uml = res.data.extensions.find(
        (e) => e.source === "essential" && e.name === "uml",
      );
      expect(uml!.commands.length).toBeGreaterThan(0);
      const ours = res.data.extensions.find(
        (e) => e.name === "staruml-mcp-extension",
      );
      expect(ours).toMatchObject({ source: "user" });
      expect(ours!.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("sets the project's metadata as one undo step", async () => {
      const set = await call<{ author: string; version: string }>(
        "/set_project_metadata",
        { author: "Ada", version: "2.1" },
      );
      expect(set.data).toMatchObject({ author: "Ada", version: "2.1" });
      await call("/undo");
      const now = await call<{ author: string }>("/get_project_metadata");
      expect(now.data.author).toBe("");
    });

    it("starts a project from a shipped template", async () => {
      const list = await call<{
        templates: { name: string; source: string }[];
      }>("/list_templates");
      expect(list.data.templates.map((t) => t.name)).toContain(
        "UMLConventional",
      );
      const made = await call<{ project: { _type: string } }>(
        "/new_from_template",
        { template: "UMLConventional" },
      );
      expect(made.success, JSON.stringify(made)).toBe(true);
      const info = await call<{ filename: string | null }>("/get_project_info");
      expect(info.data.filename).toBeNull();
      const models = await call<{ elements: unknown[] }>("/find_elements", {
        type: "UMLModel",
      });
      expect(models.data.elements.length).toBeGreaterThan(1);
    });
  },
);
