import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportDiagram,
  exportHtml,
  exportPdf,
  waitForPdf,
} from "../../../src/handlers/export.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

const svgExport = vi.hoisted(() => ({
  getSVGImageData: vi.fn(),
  exportToPDF: vi.fn(),
}));
vi.mock("../../../src/app-modules.js", () => ({
  diagramExport: () => svgExport,
}));

let env: MockEnvironment;
let dir: string;
let fills: string[];
let drawn: { selection: unknown; ratio: number; origin: unknown }[];
let watermarks: unknown[][];

/** The pixel bytes a fake canvas element encodes. */
const PIXELS = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

class FakeCanvas {
  ratio = 1;
  origin: unknown;
  zoomFactor: unknown;
  constructor(readonly context: unknown) {}
}
class FakePoint {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

beforeEach(() => {
  env = installMockApp();
  dir = mkdtempSync(join(tmpdir(), "export-test-"));
  fills = [];
  drawn = [];
  watermarks = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    createElement: () => {
      const element = {
        width: 0,
        height: 0,
        getContext: () => ({
          set fillStyle(v: string) {
            fills.push(v);
          },
          fillRect: () => {},
        }),
        toDataURL: (mime: string) =>
          `data:${mime};base64,${PIXELS.toString("base64")}`,
      };
      return element;
    },
  };
  const t = g.type as Record<string, unknown>;
  t.Canvas = FakeCanvas;
  t.Point = FakePoint;
  t.ZoomFactor = FakePoint;
  Object.assign(env.mainDiagram, {
    selectedViews: ["selected"],
    getBoundingBoxWithChildren: () => ({
      x1: 40,
      y1: 60,
      w: 200,
      h: 100,
      expand(m: number) {
        this.x1 -= m;
        this.y1 -= m;
        this.w += 2 * m;
        this.h += 2 * m;
      },
      getWidth() {
        return this.w;
      },
      getHeight() {
        return this.h;
      },
    }),
    arrangeDiagram: () => {},
    drawDiagram: (canvas: FakeCanvas, selection: unknown) =>
      drawn.push({ selection, ratio: canvas.ratio, origin: canvas.origin }),
    drawWatermark: (...args: unknown[]) => watermarks.push(args.slice(1)),
  });
  svgExport.getSVGImageData.mockReset();
  svgExport.exportToPDF.mockReset();
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.document;
  const t = g.type as Record<string, unknown>;
  delete t.Canvas;
  delete t.Point;
  delete t.ZoomFactor;
});

interface Image {
  width: number;
  height: number;
  bytes: number;
  base64?: string;
  path?: string;
  mimeType: string;
}

describe("/export_diagram raster", () => {
  it("renders the current diagram as PNG at scale 1 without a background", async () => {
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const data = await ok<Image>(exportDiagram, {});
    expect(data).toMatchObject({
      diagram: env.mainDiagram._id,
      format: "png",
      mimeType: "image/png",
      width: 250,
      height: 150,
      bytes: PIXELS.length,
      base64: PIXELS.toString("base64"),
    });
    expect(fills).toEqual([]);
    expect(drawn).toEqual([
      { selection: false, ratio: 1, origin: new FakePoint(-30, -50) },
    ]);
    expect(watermarks).toEqual([]);
  });

  it("scales, fills JPEG white and writes a file", async () => {
    const path = join(dir, "nested", "out.jpg");
    const data = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      format: "jpeg",
      scale: 2,
      path,
    });
    expect(data).toMatchObject({ width: 500, height: 300, path });
    expect(data.base64).toBeUndefined();
    expect(readFileSync(path)).toEqual(PIXELS);
    expect(fills).toEqual(["#ffffff"]);
    expect(drawn[0]!.ratio).toBe(2);
  });

  it("paints a requested background", async () => {
    await ok(exportDiagram, { id: env.mainDiagram._id, background: "#000" });
    expect(fills).toEqual(["#000"]);
  });

  it("watermarks as StarUML does for the licence", async () => {
    env.app.licenseStore.status = { trial: true };
    await ok(exportDiagram, { id: env.mainDiagram._id });
    env.app.licenseStore.status = { edition: "STD" };
    await ok(exportDiagram, { id: env.mainDiagram._id });
    const bpmn = create("BPMNDiagram");
    Object.assign(bpmn, env.mainDiagram, { _id: "BPMN1" });
    bpmn._parent = env.model;
    env.app.repository.index(bpmn);
    await ok(exportDiagram, { id: "BPMN1" });
    expect(watermarks).toEqual([
      [250, 150, 70, 12, "UNREGISTERED"],
      [250, 150, 45, 12, "PRO ONLY"],
    ]);
  });

  it("needs a diagram", async () => {
    await fails(
      exportDiagram,
      {},
      "NOT_FOUND",
      "No diagram is open; pass 'id'",
    );
    await fails(exportDiagram, { id: env.model._id }, "NOT_FOUND");
  });

  it("validates scale, background and path", async () => {
    const id = env.mainDiagram._id;
    await fails(exportDiagram, { id, scale: 5 }, "INVALID_ARGUMENT", /^scale/);
    await fails(
      exportDiagram,
      { id, background: "url(x)" },
      "INVALID_ARGUMENT",
      /^background/,
    );
    await fails(
      exportDiagram,
      { id, path: "rel.png" },
      "INVALID_ARGUMENT",
      "path: must be an absolute path",
    );
  });

  it("reports an unwritable path", async () => {
    const file = join(dir, "file");
    writeFileSync(file, "");
    await fails(
      exportDiagram,
      { id: env.mainDiagram._id, path: join(file, "x.png") },
      "STARUML_ERROR",
      /^Cannot write /,
    );
  });
});

describe("/export_diagram svg", () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="110.5"><g/></svg>';

  it("uses StarUML's SVG export with the selection hidden", async () => {
    svgExport.getSVGImageData.mockImplementation(
      (d: { selectedViews: unknown[] }) => {
        expect(d.selectedViews).toEqual([]);
        return SVG;
      },
    );
    const data = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      format: "svg",
    });
    expect(data).toMatchObject({
      mimeType: "image/svg+xml",
      width: 210,
      height: 110.5,
    });
    expect(Buffer.from(data.base64!, "base64").toString()).toBe(SVG);
    expect(env.mainDiagram.selectedViews).toEqual(["selected"]);
  });

  it("adds a background rectangle and tolerates a missing size", async () => {
    svgExport.getSVGImageData.mockReturnValue("<svg><g/></svg>");
    const data = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      format: "svg",
      background: "white",
    });
    expect(Buffer.from(data.base64!, "base64").toString()).toBe(
      '<svg><rect width="100%" height="100%" fill="white"/><g/></svg>',
    );
    expect(data.width).toBe(0);
  });

  it("restores the selection when StarUML throws", async () => {
    svgExport.getSVGImageData.mockImplementation(() => {
      throw new Error("svg failed");
    });
    await fails(
      exportDiagram,
      { id: env.mainDiagram._id, format: "svg" },
      "STARUML_ERROR",
      "svg failed",
    );
    expect(env.mainDiagram.selectedViews).toEqual(["selected"]);
  });
});

describe("/export_pdf", () => {
  const writePdf = (_d: unknown, path: string) =>
    setTimeout(() => writeFileSync(path, "%PDF-1.3\n...\n%%EOF\n"), 60);

  it("exports every diagram with the CLI's defaults and waits for the file", async () => {
    svgExport.exportToPDF.mockImplementation(writePdf);
    const path = join(dir, "sub", "out.pdf");
    const data = await ok(exportPdf, { path });
    expect(data).toEqual({ path, pages: 1, bytes: 19 });
    expect(svgExport.exportToPDF).toHaveBeenCalledWith(
      [env.mainDiagram],
      path,
      {
        size: "A4",
        layout: "landscape",
        showName: true,
      },
    );
  });

  it("passes chosen diagrams and options", async () => {
    svgExport.exportToPDF.mockImplementation(writePdf);
    const path = join(dir, "out.pdf");
    await ok(exportPdf, {
      path,
      ids: [env.mainDiagram._id],
      size: "LETTER",
      layout: "portrait",
      showName: false,
    });
    expect(svgExport.exportToPDF.mock.calls[0]![2]).toEqual({
      size: "LETTER",
      layout: "portrait",
      showName: false,
    });
  });

  it("refuses a project without diagrams, and unknown ids", async () => {
    env.app.repository.unindex(env.mainDiagram);
    await fails(
      exportPdf,
      { path: join(dir, "x.pdf") },
      "NOT_FOUND",
      "The project has no diagrams",
    );
    await fails(
      exportPdf,
      { path: join(dir, "x.pdf"), ids: ["nope"] },
      "NOT_FOUND",
    );
  });

  it("gives up on a PDF that is never completed", async () => {
    const path = join(dir, "never.pdf");
    await expect(waitForPdf(path, 120)).rejects.toThrow(
      `PDF was not completed within 120 ms: ${path}`,
    );
  });
});

describe("/export_html", () => {
  it("runs the html-export command into the directory", async () => {
    const target = join(dir, "html");
    mkdirSync(target);
    writeFileSync(join(target, "index.html"), "stale");
    env.app.commands.register("html-export:export", async (path: unknown) => {
      expect(existsSync(join(target, "index.html"))).toBe(false);
      writeFileSync(join(path as string, "index.html"), "<html>");
    });
    const data = await ok(exportHtml, { path: target });
    expect(data).toEqual({ path: target, index: join(target, "index.html") });
  });

  it("reports an export that wrote nothing", async () => {
    env.app.commands.register("html-export:export", () => {});
    await fails(
      exportHtml,
      { path: join(dir, "none") },
      "STARUML_ERROR",
      /^HTML export wrote no /,
    );
  });

  it("needs the bundled extension", async () => {
    await fails(
      exportHtml,
      { path: dir },
      "STARUML_ERROR",
      "The bundled html-export extension is not loaded",
    );
  });
});
