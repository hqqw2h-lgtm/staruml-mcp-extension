import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir, type Summary } from "./support.js";

interface Created {
  view: Summary;
  model: Summary;
}
interface List {
  count: number;
  elements: Summary[];
}
interface Image {
  width: number;
  height: number;
  bytes: number;
  base64?: string;
  path?: string;
}

/** Width and height from a PNG's IHDR chunk, which always follows the 8-byte signature. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Issue #6: view editing, reverse lookups, selection, editor state, export
// and undo against the running StarUML.
describeLive("views, export and history", () => {
  const dir = liveDir();
  let diagramId = "";
  let a: Created;
  let b: Created;
  let edge: Created;

  beforeAll(async () => {
    await call("/new_project");
    const info = await call<{ project: Summary }>("/get_project_info");
    const model = await call<Summary>("/create_element", {
      type: "UMLModel",
      parentId: info.data.project._id,
      name: "Views",
    });
    diagramId = (
      await call<Summary>("/create_diagram", {
        type: "UMLClassDiagram",
        parentId: model.data._id,
        name: "Shapes",
      })
    ).data._id;
    const node = async (name: string, x: number) =>
      (
        await call<Created>("/create_element_with_view", {
          type: "UMLClass",
          diagramId,
          name,
          x,
          y: 100,
        })
      ).data;
    a = await node("Shape", 100);
    b = await node("Circle", 400);
    edge = (
      await call<Created>("/create_edge_with_view", {
        type: "UMLGeneralization",
        diagramId,
        tailViewId: b.view._id,
        headViewId: a.view._id,
      })
    ).data;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("moves, resizes and undoes a view edit", async () => {
    const moved = await call<{ views: Record<string, number>[] }>(
      "/move_views",
      { ids: [a.view._id], dx: 20, dy: 30 },
    );
    expect(moved.data.views[0]).toMatchObject({ left: 120, top: 130 });
    const resized = await call<Record<string, number>>("/resize_node", {
      id: a.view._id,
      width: 220,
      height: 120,
    });
    expect(resized.data).toMatchObject({ width: 220, height: 120 });
    expect((await call("/is_modified")).data).toEqual({ modified: true });
    await call("/undo");
    const back = await call<Record<string, number>>("/get_element_by_id", {
      id: a.view._id,
      fields: ["width"],
    });
    expect(back.data.width).not.toBe(220);
    await call("/redo");
    const again = await call<Record<string, number>>("/get_element_by_id", {
      id: a.view._id,
      fields: ["width"],
    });
    expect(again.data.width).toBe(220);
  });

  it("styles views", async () => {
    const styled = await call<{ views: Record<string, unknown>[] }>(
      "/set_view_style",
      {
        ids: [a.view._id, b.view._id],
        fillColor: "#ffcc00",
        lineColor: "#336699",
        fontColor: "#990000",
        fontFace: "Helvetica",
        fontSize: 15,
        stereotypeDisplay: "label",
        autoResize: false,
      },
    );
    expect(styled.data.views[1]).toMatchObject({
      fillColor: "#ffcc00",
      lineColor: "#336699",
      fontColor: "#990000",
      stereotypeDisplay: "label",
      autoResize: false,
    });
    expect(styled.data.views[1]!.font).toMatch(/^Helvetica;15;/);
    const line = await call<{ views: Record<string, unknown>[] }>(
      "/set_view_style",
      { ids: [edge.view._id], lineStyle: "rectilinear" },
    );
    expect(line.data.views[0]).toMatchObject({ lineStyle: 0 });
  });

  it("lays out and reorders", async () => {
    const before = await call<Record<string, number>>("/get_element_by_id", {
      id: b.view._id,
      fields: ["left", "top"],
    });
    const layout = await call("/layout_diagram", {
      id: diagramId,
      direction: "TB",
    });
    expect(layout.data).toEqual({ _id: diagramId, direction: "TB" });
    const after = await call<Record<string, number>>("/get_element_by_id", {
      id: b.view._id,
      fields: ["left", "top"],
    });
    expect(after.data).not.toEqual(before.data);
    const back = await call<{ order: string[] }>("/set_z_order", {
      ids: [b.view._id],
      position: "back",
    });
    expect(back.data.order[0]).toBe(b.view._id);
    const front = await call<{ order: string[] }>("/set_z_order", {
      ids: [b.view._id],
      position: "front",
    });
    expect(front.data.order.at(-1)).toBe(b.view._id);
  });

  it("answers reverse lookups", async () => {
    // A class's compartment views show the class too, so they are its views.
    const views = await call<List>("/get_views_of", {
      id: a.model._id,
      fields: ["model"],
    });
    expect(views.data.elements.map((e) => e._id)).toContain(a.view._id);
    for (const v of views.data.elements) {
      expect(v).toMatchObject({ model: { $ref: a.model._id } });
    }
    const edges = await call<List>("/get_edge_views_of", { id: a.view._id });
    expect(edges.data.elements.map((e) => e._id)).toEqual([edge.view._id]);
    const rels = await call<List>("/get_relationships_of", {
      id: a.model._id,
    });
    expect(rels.data.elements.map((e) => e._id)).toEqual([edge.model._id]);
    const refs = await call<List>("/get_refs_to", { id: a.model._id });
    expect(refs.data.elements.map((e) => e._id)).toEqual(
      expect.arrayContaining([a.view._id, edge.model._id]),
    );
    const linked = await call<List>("/get_connected_node_views", {
      id: a.view._id,
      edgeType: "UMLGeneralizationView",
    });
    expect(linked.data.elements.map((e) => e._id)).toEqual([b.view._id]);
  });

  it("sets and reads the selection", async () => {
    const set = await call<{ models: Summary[]; views: Summary[] }>(
      "/set_selection",
      { viewIds: [a.view._id, b.view._id] },
    );
    expect(set.data.views.map((v) => v._id)).toEqual([a.view._id, b.view._id]);
    const got = await call<{ models: Summary[] }>("/get_selection");
    expect(got.data.models.map((m) => m._id).sort()).toEqual(
      [a.model._id, b.model._id].sort(),
    );
    const cleared = await call("/set_selection", {});
    expect(cleared.data).toEqual({ models: [], views: [] });
  });

  it("zooms, scrolls and toggles the grid without touching the model", async () => {
    const modified = (await call<{ modified: boolean }>("/is_modified")).data;
    const state = await call<Record<string, unknown>>("/set_editor_state", {
      diagramId,
      zoom: 1.5,
      gridVisible: false,
    });
    expect(state.data).toMatchObject({
      currentDiagram: diagramId,
      zoom: 1.5,
      gridVisible: false,
    });
    expect(state.data.workingDiagrams).toContain(diagramId);
    const restored = await call<Record<string, unknown>>("/set_editor_state", {
      zoom: 1,
      gridVisible: true,
      center: { x: 0, y: 0 },
    });
    expect(restored.data).toMatchObject({
      zoom: 1,
      gridVisible: true,
      topLeft: { x: 0, y: 0 },
    });
    expect((await call("/is_modified")).data).toEqual(modified);
  });

  it("renders a PNG whose bytes are a PNG of the reported size", async () => {
    const one = await call<Image>("/export_diagram", { id: diagramId });
    const png = Buffer.from(one.data.base64!, "base64");
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(png.length).toBe(one.data.bytes);
    expect(pngSize(png)).toEqual({
      width: one.data.width,
      height: one.data.height,
    });
    // Two class boxes plus margins cannot fit in less than 200 pixels.
    expect(one.data.width).toBeGreaterThan(200);
    const two = await call<Image>("/export_diagram", {
      id: diagramId,
      scale: 2,
      background: "#ffffff",
    });
    const big = pngSize(Buffer.from(two.data.base64!, "base64"));
    expect(Math.abs(big.width - 2 * one.data.width)).toBeLessThanOrEqual(1);
  });

  it("writes PNG, JPEG and SVG files", async () => {
    const png = join(dir, "img", "shapes.png");
    const res = await call<Image>("/export_diagram", {
      id: diagramId,
      path: png,
    });
    expect(res.data.path).toBe(png);
    expect(readFileSync(png).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const jpeg = await call<Image>("/export_diagram", {
      id: diagramId,
      format: "jpeg",
    });
    const jpg = Buffer.from(jpeg.data.base64!, "base64");
    expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // The same canvas as the PNG; the size is read from the JPEG frame header.
    expect(jpeg.data.width).toBe(res.data.width);
    const shaded = await call<Image>("/export_diagram", {
      id: diagramId,
      format: "jpeg",
      background: "#336699",
    });
    expect(shaded.data.height).toBe(res.data.height);
    const svg = await call<Image>("/export_diagram", {
      id: diagramId,
      format: "svg",
      background: "#ffffff",
    });
    const text = Buffer.from(svg.data.base64!, "base64").toString("utf-8");
    expect(text).toMatch(/<svg[\s\S]*Shape[\s\S]*Circle[\s\S]*<\/svg>/);
    expect(text).toContain('fill="#ffffff"');
    expect(svg.data.width).toBeGreaterThan(200);
  });

  it("writes a PDF and HTML docs", async () => {
    const pdf = join(dir, "shapes.pdf");
    const res = await call<{ pages: number; bytes: number }>("/export_pdf", {
      path: pdf,
      ids: [diagramId],
    });
    expect(res.data.pages).toBe(1);
    const bytes = readFileSync(pdf);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBe(res.data.bytes);
    const html = join(dir, "html");
    const docs = await call<{ index: string }>("/export_html", { path: html });
    expect(docs.data.index).toBe(join(html, "index.html"));
    expect(existsSync(docs.data.index)).toBe(true);
  });

  it("rejects a relative export path", async () => {
    const res = await call("/export_diagram", {
      id: diagramId,
      path: "x.png",
    });
    expect(res).toMatchObject({ status: 400, code: "INVALID_ARGUMENT" });
  });
});
