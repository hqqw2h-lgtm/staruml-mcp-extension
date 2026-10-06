import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir, type Summary } from "./support.js";

interface Generated {
  count: number;
  files: string[];
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Issue #11: command catalogue and dialog refusal, code generation with the
// installed staruml.java, reverse engineering and multi-diagram export.
describeLive("commands, code generation and export", () => {
  const dir = liveDir();
  let pkgId = "";
  let installed = false;

  beforeAll(async () => {
    await call("/new_project");
    const info = await call<{ project: Summary }>("/get_project_info");
    const res = await call<{ results: { data: Summary }[] }>("/batch", {
      ops: [
        {
          path: "/create_element",
          as: "pkg",
          body: {
            type: "UMLPackage",
            parentId: info.data.project._id,
            name: "shop",
          },
        },
        {
          path: "/create_diagram",
          as: "dgm",
          body: { type: "UMLClassDiagram", parentId: "$pkg", name: "Shop" },
        },
        {
          path: "/create_element_with_view",
          as: "order",
          body: { type: "UMLClass", diagramId: "$dgm", name: "Order", x: 40 },
        },
        {
          path: "/create_element_with_view",
          as: "payable",
          body: {
            type: "UMLInterface",
            diagramId: "$dgm",
            name: "Payable",
            x: 300,
          },
        },
        {
          path: "/create_element_with_view",
          body: {
            type: "UMLEnumeration",
            diagramId: "$dgm",
            name: "Status",
            x: 40,
            y: 300,
          },
        },
        {
          path: "/add_attribute",
          body: { ownerId: "$order.model", name: "total", type: "double" },
        },
        {
          path: "/add_operation",
          body: { ownerId: "$order.model", name: "place", returnType: "void" },
        },
        {
          path: "/create_relationship",
          body: {
            type: "UMLInterfaceRealization",
            tailId: "$order.model",
            headId: "$payable.model",
            diagramId: "$dgm",
          },
        },
      ],
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    pkgId = res.data.results[0]!.data._id;
    const gens = await call<{
      generators: { language: string; installed: boolean }[];
    }>("/list_code_generators");
    installed = gens.data.generators.find(
      (g) => g.language === "java",
    )!.installed;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("describes commands, with what is registered", async () => {
    const res = await call<{
      commands: { id: string; registered: boolean; dialog: string }[];
    }>("/describe_commands", {
      ids: ["edit:undo", "project:save-as", "project:open"],
    });
    expect(res.data.commands).toMatchObject([
      { id: "edit:undo", registered: true, dialog: "never" },
      { id: "project:save-as", registered: true, dialog: "always" },
      { id: "project:open", registered: true, dialog: "without-args" },
    ]);
  });

  it("refuses dialog commands instead of hanging", async () => {
    const about = await call("/execute_command", { id: "help:about" });
    expect(about).toMatchObject({ status: 422, code: "DIALOG_REQUIRED" });
    const open = await call("/execute_command", { id: "project:open" });
    expect(open).toMatchObject({ status: 422, code: "DIALOG_REQUIRED" });
    // Static entry "without-args (0)": the untitled project makes the handler
    // reach for the save dialog, which the run-time guard refuses.
    const started = Date.now();
    const save = await call("/execute_command", { id: "project:save" });
    expect(save).toMatchObject({ status: 422, code: "DIALOG_REQUIRED" });
    expect(save.error).toMatch(/dialogs\.show/);
    expect(Date.now() - started).toBeLessThan(5_000);
    // StarUML still answers, so nothing is left open.
    expect((await call("/get_project_info")).success).toBe(true);
  });

  it("generates Java from the fixture model", async ({ skip }) => {
    if (!installed) skip("staruml.java is not installed");
    const out = join(dir, "java");
    const res = await call<Generated>("/generate_code", {
      language: "java",
      baseId: pkgId,
      path: out,
      options: { javaDoc: false },
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.data.files).toEqual([
      join("shop", "Order.java"),
      join("shop", "Payable.java"),
      join("shop", "Status.java"),
    ]);
    const order = readFileSync(join(out, "shop", "Order.java"), "utf-8");
    expect(order).toMatch(/class Order implements Payable/);
    expect(order).toMatch(/double total;/);
    expect(order).toMatch(/void place\(\)/);
    expect(order).not.toMatch(/\/\*\*/);
    expect(readFileSync(join(out, "shop", "Status.java"), "utf-8")).toMatch(
      /enum Status/,
    );
    // The generator creates the package directory with a plain mkdir.
    const again = await call("/generate_code", {
      language: "java",
      baseId: pkgId,
      path: out,
    });
    expect(again).toMatchObject({ status: 422, code: "STARUML_ERROR" });
    expect(again.error).toMatch(/EEXIST/);
    const picker = await call("/execute_command", { id: "java:generate" });
    expect(picker).toMatchObject({ code: "DIALOG_REQUIRED" });
  });

  it("reverse-engineers the generated sources", async ({ skip }) => {
    if (!installed) skip("staruml.java is not installed");
    const res = await call<{
      created: number;
      roots: Summary[];
    }>("/reverse_code", {
      language: "java",
      path: join(dir, "java"),
      options: { typeHierarchy: false, packageOverview: false },
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.data.created).toBeGreaterThan(3);
    const found = await call<{ count: number }>("/find_elements", {
      type: "UMLClass",
      name: "Order",
    });
    expect(found.data.count).toBe(2);
  });

  it("writes every diagram as a PNG file", async () => {
    const res = await call<{
      count: number;
      files: { file: string; width: number }[];
    }>("/export_diagrams", { path: join(dir, "images") });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.data.count).toBeGreaterThanOrEqual(1);
    const shop = res.data.files.find((f) => f.file.endsWith("Shop.png"))!;
    expect(existsSync(shop.file)).toBe(true);
    expect(readFileSync(shop.file).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(shop.width).toBeGreaterThan(300);
  });
});
