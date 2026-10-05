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
  imageSize,
  waitForPdf,
} from "../../../src/handlers/export.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

const svgExport = vi.hoisted(() => ({
  getImageData: vi.fn(),
  getSVGImageData: vi.fn(),
  exportToPDF: vi.fn(),
}));
vi.mock("../../../src/app-modules.js", () => ({
  diagramExport: () => svgExport,
}));

let env: MockEnvironment;
let dir: string;
let painted: unknown[][];
let seen: { ratio: unknown; selection: unknown; mime: string }[];

/** A PNG holding only its signature and IHDR, which is all the size needs. */
function png(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

/** SOI, an APP0 segment, then a baseline SOF0 frame header. */
function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 0, 0, 0]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]),
    sof,
  ]);
}

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  env = installMockApp();
  dir = mkdtempSync(join(tmpdir(), "export-test-"));
  painted = [];
  seen = [];
  g.window = { devicePixelRatio: 2 };
  g.createImageBitmap = async (blob: Blob) => {
    painted.push(["decode", blob.type, (await blob.arrayBuffer()).byteLength]);
    return { width: 300, height: 120 };
  };
  g.document = {
    createElement: () => {
      const element = {
        width: 0,
        height: 0,
        getContext: () => ({
          set fillStyle(v: string) {
            painted.push(["fill", v]);
          },
          fillRect: (...a: number[]) => painted.push(["rect", ...a]),
          drawImage: (_b: unknown, x: number, y: number) =>
            painted.push(["draw", x, y]),
        }),
        toDataURL: (mime: string) =>
          `data:${mime};base64,${(mime === "image/png"
            ? png(element.width, element.height)
            : jpeg(element.width, element.height)
          ).toString("base64")}`,
      };
      return element;
    },
  };
  env.mainDiagram.selectedViews = ["selected"];
  svgExport.getImageData.mockReset();
  svgExport.getImageData.mockImplementation(
    (d: { selectedViews: unknown }, mime: string) => {
      const ratio = (g.window as { devicePixelRatio: number }).devicePixelRatio;
      seen.push({ ratio, selection: d.selectedViews, mime });
      const image =
        mime === "image/png"
          ? png(100 * ratio, 50 * ratio)
          : jpeg(100 * ratio, 50 * ratio);
      return image.toString("base64");
    },
  );
  svgExport.getSVGImageData.mockReset();
  svgExport.exportToPDF.mockReset();
});

afterEach(() => {
  delete g.document;
  delete g.window;
  delete g.createImageBitmap;
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
  it("calls StarUML's getImageData at scale 1 with the selection hidden", async () => {
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const data = await ok<Image>(exportDiagram, {});
    expect(data).toMatchObject({
      diagram: env.mainDiagram._id,
      format: "png",
      mimeType: "image/png",
      width: 100,
      height: 50,
      bytes: 24,
      base64: png(100, 50).toString("base64"),
    });
    expect(seen).toEqual([{ ratio: 1, selection: [], mime: "image/png" }]);
    expect(env.mainDiagram.selectedViews).toEqual(["selected"]);
    expect(g.window).toEqual({ devicePixelRatio: 2 });
    expect(painted).toEqual([]);
  });

  it("scales a JPEG through the pixel ratio and writes a file", async () => {
    delete (g.window as Record<string, unknown>).devicePixelRatio;
    const path = join(dir, "nested", "out.jpg");
    const data = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      format: "jpeg",
      scale: 2,
      path,
    });
    expect(data).toMatchObject({
      mimeType: "image/jpeg",
      width: 200,
      height: 100,
      path,
    });
    expect(data.base64).toBeUndefined();
    expect(readFileSync(path)).toEqual(jpeg(200, 100));
    expect(seen[0]).toMatchObject({ ratio: 2, mime: "image/jpeg" });
    expect("devicePixelRatio" in (g.window as object)).toBe(false);
  });

  it("paints a background under a transparent rendering", async () => {
    const pngData = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      background: "#000",
    });
    expect(seen[0]!.mime).toBe("image/png");
    expect(painted).toEqual([
      ["decode", "image/png", 24],
      ["fill", "#000"],
      ["rect", 0, 0, 300, 120],
      ["draw", 0, 0],
    ]);
    expect(pngData).toMatchObject({ width: 300, height: 120 });
    const jpegData = await ok<Image>(exportDiagram, {
      id: env.mainDiagram._id,
      format: "jpeg",
      background: "white",
    });
    expect(seen[1]!.mime).toBe("image/png");
    expect(jpegData).toMatchObject({
      mimeType: "image/jpeg",
      width: 300,
      height: 120,
    });
  });

  it("restores the selection and pixel ratio when StarUML throws", async () => {
    svgExport.getImageData.mockImplementation(() => {
      throw new Error("raster failed");
    });
    await fails(
      exportDiagram,
      { id: env.mainDiagram._id, scale: 3 },
      "STARUML_ERROR",
      "raster failed",
    );
    expect(env.mainDiagram.selectedViews).toEqual(["selected"]);
    expect(g.window).toEqual({ devicePixelRatio: 2 });
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

describe("imageSize", () => {
  const seg = (marker: number) => [0xff, marker, 0, 2];
  it("skips JPEG segments that are not frame headers", () => {
    const tail = jpeg(7, 9).subarray(2);
    for (const marker of [0x01, 0xc4, 0xc8, 0xcc, 0xdb]) {
      const data = Buffer.concat([
        Buffer.from([0xff, 0xd8, ...seg(marker)]),
        tail,
      ]);
      expect(imageSize(data)).toEqual({ width: 7, height: 9 });
    }
    expect(imageSize(jpeg(3, 4))).toEqual({ width: 3, height: 4 });
  });

  it("gives zero for data it cannot read", () => {
    expect(imageSize(Buffer.alloc(30))).toEqual({ width: 0, height: 0 });
    expect(
      imageSize(
        Buffer.from([0xff, 0xd8, ...seg(0xe0), 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toEqual({ width: 0, height: 0 });
    expect(imageSize(Buffer.from([0xff, 0xd8, ...seg(0xe0)]))).toEqual({
      width: 0,
      height: 0,
    });
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
