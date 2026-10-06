import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import {
  create,
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const proc = process as { resourcesPath?: string };

beforeEach(() => {
  env = installMockApp();
  env.app.preferences.register({
    id: "test",
    name: "Test",
    schema: {
      "diagramEditor.showGrid": { text: "Grid", type: "check", default: true },
      "diagramEditor.gridSize": { text: "Size", type: "number", default: 5 },
      "view.lineStyle": {
        text: "Line",
        type: "dropdown",
        default: 0,
        options: [
          { value: 0, text: "Rectilinear" },
          { value: 1, text: "Oblique" },
        ],
      },
      "view.font": { text: "Font", type: "font", default: "Arial" },
      "view.fillColor": { text: "Fill", type: "color", default: "#ffffff" },
      "uml.class.size": {
        text: "Size",
        type: "combo",
        default: 10,
        options: [{ value: 10, text: "10" }],
      },
      "general.working-file": { text: "File", type: "string", default: "" },
      "mcp-ext.token": { text: "Token", type: "string", default: "" },
      general: { text: "General", type: "section" },
    },
  });
});

afterEach(() => {
  delete proc.resourcesPath;
});

describe("/get_preference and /set_preference (issue #28)", () => {
  it("reads a preference with its default, type and options", async () => {
    expect(await ok(ep("/get_preference"), { key: "view.lineStyle" })).toEqual({
      key: "view.lineStyle",
      value: 0,
      default: 0,
      type: "dropdown",
      settable: true,
      options: [0, 1],
    });
    expect(
      await ok(ep("/get_preference"), { key: "general.working-file" }),
    ).toMatchObject({ settable: false, default: "" });
  });

  it("refuses unknown keys, sections and the token", async () => {
    await fails(
      ep("/get_preference"),
      { key: "nope" },
      "NOT_FOUND",
      "No preference nope; File > Preferences lists the keys",
    );
    await fails(ep("/get_preference"), { key: "general" }, "NOT_FOUND");
    await fails(
      ep("/get_preference"),
      { key: "mcp-ext.token" },
      "NOT_FOUND",
      /is a secret/,
    );
  });

  it("sets allowed keys to values of their type and answers the previous one", async () => {
    expect(
      await ok(ep("/set_preference"), {
        key: "diagramEditor.showGrid",
        value: false,
      }),
    ).toMatchObject({ value: false, previous: true });
    for (const [key, value] of [
      ["diagramEditor.gridSize", 10],
      ["view.lineStyle", 1],
      ["view.font", "Helvetica"],
      ["view.fillColor", "#ffcc00"],
      ["uml.class.size", 12],
    ] as const) {
      expect(await ok(ep("/set_preference"), { key, value })).toMatchObject({
        value,
      });
    }
    for (const [key, value, takes] of [
      ["diagramEditor.showGrid", 1, "true or false"],
      ["diagramEditor.gridSize", "x", "a number"],
      ["view.lineStyle", 7, "one of 0, 1"],
      ["view.font", 3, "a string"],
      ["view.fillColor", "red", "a colour such as '#ffcc00'"],
      ["uml.class.size", "big", "a number"],
    ] as const) {
      await fails(
        ep("/set_preference"),
        { key, value },
        "INVALID_ARGUMENT",
        `value: ${key} takes ${takes}`,
      );
    }
    await fails(
      ep("/set_preference"),
      { key: "general.working-file", value: "/x" },
      "INVALID_ARGUMENT",
      /is not changed through the API/,
    );
  });

  it("answers no preference where StarUML has no item map", async () => {
    (env.app.preferences as unknown as { getItem?: unknown }).getItem =
      undefined;
    await fails(ep("/get_preference"), { key: "view.font" }, "NOT_FOUND");
  });
});

describe("/export_fragment and /import_fragment", () => {
  it("writes an element's tree and reads it back under another owner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fragment-"));
    const file = join(dir, "model.mfj");
    const out = await ok<{ element: { _id: string } }>(ep("/export_fragment"), {
      ref: env.model._id,
      filename: file,
    });
    expect(out.element._id).toBe(env.model._id);
    const back = await ok<{ element: { _id: string; name: string } }>(
      ep("/import_fragment"),
      { filename: file },
    );
    expect(back.element.name).toBe("Model");
    expect(back.element._id).not.toBe(env.model._id);
    const under = await ok<{ element: { _parent: string } }>(
      ep("/import_fragment"),
      { filename: file, parent: env.model._id },
    );
    expect(under.element._parent).toBe(env.model._id);
  });

  it("refuses the project, a missing file and an empty one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fragment-"));
    await fails(
      ep("/export_fragment"),
      { ref: env.project._id, filename: join(dir, "p.mfj") },
      "INVALID_ARGUMENT",
      /^ref: the project itself/,
    );
    await fails(
      ep("/import_fragment"),
      { filename: join(dir, "none.mfj") },
      "NOT_FOUND",
    );
    writeFileSync(join(dir, "empty.mfj"), "");
    await fails(
      ep("/import_fragment"),
      { filename: join(dir, "empty.mfj") },
      "STARUML_ERROR",
      /is empty$/,
    );
    await fails(
      ep("/export_fragment"),
      { ref: env.model._id, filename: "relative.mfj" },
      "INVALID_ARGUMENT",
    );
  });
});

describe("/import_xmi and /export_xmi", () => {
  it("say the staruml-xmi extension is needed when it is not installed", async () => {
    await fails(
      ep("/export_xmi"),
      { filename: "/tmp/a.xmi" },
      "NOT_FOUND",
      "XMI export needs the staruml-xmi extension (Tools > Extension Manager > XMI); no xmi:export command is registered",
    );
    const dir = mkdtempSync(join(tmpdir(), "xmi-"));
    await fails(
      ep("/import_xmi"),
      { filename: join(dir, "none.xmi") },
      "NOT_FOUND",
      /^No file /,
    );
    writeFileSync(join(dir, "a.xmi"), "<xmi/>");
    await fails(
      ep("/import_xmi"),
      { filename: join(dir, "a.xmi") },
      "NOT_FOUND",
      /needs the staruml-xmi extension/,
    );
  });

  it("run the extension's commands with the file", async () => {
    const calls: unknown[][] = [];
    env.app.commands.register("xmi:import-xmi21", (...args: unknown[]) => {
      calls.push(["import", ...args]);
    });
    env.app.commands.register("xmi:export-xmi21", (...args: unknown[]) => {
      calls.push(["export", ...args]);
    });
    const dir = mkdtempSync(join(tmpdir(), "xmi-"));
    writeFileSync(join(dir, "a.xmi"), "<xmi/>");
    expect(
      await ok(ep("/export_xmi"), { filename: join(dir, "b.xmi") }),
    ).toEqual({ filename: join(dir, "b.xmi"), command: "xmi:export-xmi21" });
    expect(
      await ok(ep("/import_xmi"), { filename: join(dir, "a.xmi") }),
    ).toMatchObject({ command: "xmi:import-xmi21" });
    expect(calls).toEqual([
      ["export", join(dir, "b.xmi")],
      ["import", join(dir, "a.xmi")],
    ]);
  });
});

/** A fake StarUML app folder with templates and extensions. */
function resources(): string {
  const root = mkdtempSync(join(tmpdir(), "resources-"));
  const app = join(root, "app");
  mkdirSync(join(app, "resources", "templates"), { recursive: true });
  writeFileSync(
    join(app, "resources", "templates", "Default.mdj"),
    JSON.stringify({ _type: "Project", _id: "T1", name: "From template" }),
  );
  writeFileSync(join(app, "resources", "templates", "notes.txt"), "x");
  const uml = join(app, "extensions", "essential", "uml");
  mkdirSync(join(uml, "templates"), { recursive: true });
  mkdirSync(join(uml, "menus"), { recursive: true });
  writeFileSync(
    join(uml, "package.json"),
    JSON.stringify({ name: "uml", title: "UML", version: "1.0.0" }),
  );
  writeFileSync(join(uml, "templates", "UMLConventional.mdj"), "");
  writeFileSync(
    join(uml, "menus", "menu.json"),
    JSON.stringify({
      menu: [{ submenu: [{ command: "uml:x" }, { command: "uml:gone" }] }],
    }),
  );
  writeFileSync(join(uml, "menus", "bad.json"), "{");
  writeFileSync(join(uml, "menus", "readme.txt"), "x");
  const broken = join(app, "extensions", "default", "broken");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "package.json"), "{");
  mkdirSync(join(app, "extensions", "default", "nopackage"));
  proc.resourcesPath = root;
  return root;
}

describe("templates", () => {
  it("lists the templates of the resources and the extensions, and starts a project from one", async () => {
    const root = resources();
    const user = mkdtempSync(join(tmpdir(), "user-"));
    mkdirSync(join(user, "mine"));
    writeFileSync(join(user, "mine", "package.json"), "{}");
    (env.app as { extensionLoader?: unknown }).extensionLoader = {
      getUserExtensionPath: () => user,
    };
    const { templates, diagramTemplates } = await ok<{
      templates: { name: string }[];
      diagramTemplates: { name: string; default: boolean }[];
    }>(ep("/list_templates"));
    expect(templates.map((t) => t.name)).toEqual([
      "Default",
      "UMLConventional",
    ]);
    // The diagram templates of issue #43 come along.
    expect(diagramTemplates).toHaveLength(14);
    expect(diagramTemplates.every((t) => t.default)).toBe(true);
    const made = await ok<{
      template: { source: string };
      project: { name: string };
    }>(ep("/new_from_template"), { template: "Default" });
    expect(made).toMatchObject({
      template: { source: "core" },
      project: { name: "From template" },
    });
    expect(env.app.project.getFilename()).toBeNull();
    const byPath = await ok<{ template: { source: string } }>(
      ep("/new_from_template"),
      { template: join(root, "app", "resources", "templates", "Default.mdj") },
    );
    expect(byPath.template.source).toBe("file");
    await fails(
      ep("/new_from_template"),
      { template: "UMLConventional" },
      "STARUML_ERROR",
      /is empty$/,
    );
    await fails(
      ep("/new_from_template"),
      { template: "Nope" },
      "NOT_FOUND",
      "No template Nope; templates: Default, UMLConventional",
    );
    await fails(
      ep("/new_from_template"),
      { template: join(root, "none.mdj") },
      "NOT_FOUND",
    );
  });

  it("refuse outside StarUML", async () => {
    await fails(
      ep("/list_templates"),
      {},
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML",
    );
  });
});

describe("/list_extensions", () => {
  it("lists each extension with its package fields and the registered commands its menus name", async () => {
    resources();
    env.app.commands.register("uml:x", () => undefined);
    const { extensions } = await ok<{ extensions: unknown[] }>(
      ep("/list_extensions"),
    );
    expect(extensions).toEqual([
      {
        name: "uml",
        title: "UML",
        version: "1.0.0",
        description: null,
        source: "essential",
        // Native separators: the path is what StarUML's extension loader returns on the host OS.
        path: expect.stringMatching(/essential[\\/]uml$/),
        commands: ["uml:x"],
      },
      {
        name: "broken",
        title: null,
        version: null,
        description: null,
        source: "default",
        path: expect.stringMatching(/broken$/),
        commands: [],
      },
    ]);
  });
});

describe("/quick_find", () => {
  it("finds names, documentation and tags case-insensitively, with paths and context, up to a limit", async () => {
    const add = (name: string, doc = "") => {
      const c = create("UMLClass");
      c.name = name;
      c.documentation = doc;
      c._parent = env.model;
      (env.model.ownedElements as MockElement[]).push(c);
      env.app.repository.index(c);
      return c;
    };
    add("InvoiceLine");
    add("Order", `${"x".repeat(50)} holds the invoice total ${"y".repeat(50)}`);
    const tagged = add("Payment");
    const tag = create("Tag");
    tag.name = "domain";
    tag.value = "invoices";
    tag._parent = tagged;
    (tagged.tags as MockElement[]).push(tag);
    const t2 = create("Tag");
    t2.name = "invoice-ref";
    t2._parent = tagged;
    const bare = add("Other");
    delete bare.tags;
    delete bare.documentation;
    const res = await ok<{
      matches: {
        element: { name: string; path: string };
        field: string;
        text: string;
      }[];
      total: number;
      truncated: boolean;
    }>(ep("/quick_find"), { text: "INVOICE" });
    expect(res.total).toBe(3);
    expect(res.truncated).toBe(false);
    expect(res.matches.map((m) => [m.element.name, m.field])).toEqual([
      ["InvoiceLine", "name"],
      ["Order", "documentation"],
      ["Payment", "tag domain"],
    ]);
    expect(res.matches[1]!.text).toMatch(/^….*invoice total.*…$/);
    expect(res.matches[0]!.element.path).toBe("Model/InvoiceLine");
    const capped = await ok<{ matches: unknown[]; truncated: boolean }>(
      ep("/quick_find"),
      { text: "invoice", limit: 1 },
    );
    expect(capped).toMatchObject({ truncated: true });
    expect(capped.matches).toHaveLength(1);
  });
});

describe("working diagrams", () => {
  it("lists the open tabs with the current one, and closes some or all but kept ones", async () => {
    const other = create("UMLClassDiagram");
    other.name = "Other";
    other._parent = env.model;
    (env.model.ownedElements as MockElement[]).push(other);
    env.app.repository.index(other);
    await ok(ep("/switch_diagram"), { diagram: env.mainDiagram._id });
    await ok(ep("/switch_diagram"), { diagram: other._id });
    const listed = await ok<{ diagrams: { name: string; current: boolean }[] }>(
      ep("/list_working_diagrams"),
    );
    expect(listed.diagrams.map((d) => [d.name, d.current])).toEqual([
      ["Main", false],
      ["Other", true],
    ]);
    expect(await ok(ep("/close_diagrams"), { keep: [other._id] })).toEqual({
      closed: [env.mainDiagram._id],
    });
    expect(await ok(ep("/close_diagrams"), { diagrams: ["Other"] })).toEqual({
      closed: [other._id],
    });
    expect(await ok(ep("/close_diagrams"), {})).toEqual({ closed: [] });
  });
});

describe("project metadata", () => {
  it("reads and sets the project's own fields", async () => {
    expect(await ok(ep("/get_project_metadata"))).toEqual({
      name: "Untitled",
      author: "",
      company: "",
      copyright: "",
      version: "",
      documentation: "",
    });
    const set = await ok(ep("/set_project_metadata"), {
      name: "Shop",
      author: "Ann",
      version: "1.0",
    });
    expect(set).toMatchObject({ name: "Shop", author: "Ann", version: "1.0" });
    // Unchanged fields run no operation; the live suite checks the undo step.
    expect(
      await ok(ep("/set_project_metadata"), {
        name: "Shop",
        documentation: "d",
      }),
    ).toMatchObject({ name: "Shop", documentation: "d" });
  });
});
