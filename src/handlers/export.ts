/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import * as z from "zod/mini";
import { diagramExport } from "../app-modules.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireProject } from "../lookup.js";
import type { Element } from "../types.js";

/** engine/diagram-export.js BOUNDING_BOX_EXPAND and the +30 its getImageData adds. */
const BOUNDING_BOX_EXPAND = 10;
const RASTER_MARGIN = 30;

/**
 * diagram-export.js PRO_DIAGRAM_TYPES (7.1.1): diagrams StarUML watermarks
 * "PRO ONLY" when exported without a PRO licence. Copied rather than
 * bypassed, so this export watermarks exactly when File > Export does.
 */
export const PRO_DIAGRAM_TYPES = [
  "SysMLRequirementDiagram",
  "SysMLBlockDefinitionDiagram",
  "SysMLInternalBlockDiagram",
  "SysMLParametricDiagram",
  "BPMNDiagram",
  "WFWireframeDiagram",
  "AWSDiagram",
  "GCPDiagram",
];

export const MAX_SCALE = 4;

const MIME = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml" };

type Format = keyof typeof MIME;

/** The parts of core/graphics.js and core/core.js the raster path drives. */
interface Box {
  x1: number;
  y1: number;
  expand(margin: number): void;
  getWidth(): number;
  getHeight(): number;
}
interface GraphicsCanvas {
  origin: unknown;
  zoomFactor: unknown;
  ratio: number;
}
interface DrawableDiagram extends Element {
  getBoundingBoxWithChildren(canvas: GraphicsCanvas): Box;
  arrangeDiagram(canvas: GraphicsCanvas): void;
  drawDiagram(canvas: GraphicsCanvas, drawSelection?: boolean): void;
  drawWatermark(
    canvas: GraphicsCanvas,
    width: number,
    height: number,
    xstep: number,
    ystep: number,
    text: string,
  ): void;
  selectedViews: Element[];
}

type Ctor<T> = new (...args: unknown[]) => T;

/** What diagram-export.js draws over a diagram for the running licence. */
export function watermarkFor(
  diagram: Element,
): [number, number, string] | null {
  const status = app.licenseStore.getLicenseStatus();
  if (status.trial) return [70, 12, "UNREGISTERED"];
  if (
    status.edition !== "PRO" &&
    PRO_DIAGRAM_TYPES.includes(diagram.constructor.name)
  ) {
    return [45, 12, "PRO ONLY"];
  }
  return null;
}

export interface Rendered {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * diagram-export.js getImageData (7.1.1) with the device pixel ratio replaced
 * by `scale` and the background made a parameter: it fills only JPEGs, white.
 * Selection handles are not drawn, where exportToPNG deselects all first and
 * so would change what the user has selected.
 */
export function renderRaster(
  diagram: DrawableDiagram,
  format: "png" | "jpeg",
  scale: number,
  background: string | undefined,
): Rendered {
  const element = document.createElement("canvas");
  const Canvas = type.Canvas as unknown as Ctor<GraphicsCanvas>;
  const Point = type.Point as unknown as Ctor<unknown>;
  const ZoomFactor = type.ZoomFactor as unknown as Ctor<unknown>;
  const canvas = new Canvas(element.getContext("2d"));
  const box = diagram.getBoundingBoxWithChildren(canvas);
  box.expand(BOUNDING_BOX_EXPAND);
  canvas.origin = new Point(-box.x1, -box.y1);
  canvas.zoomFactor = new ZoomFactor(1, 1);
  canvas.ratio = scale;
  element.width = Math.ceil((box.getWidth() + RASTER_MARGIN) * scale);
  element.height = Math.ceil((box.getHeight() + RASTER_MARGIN) * scale);

  const fill = background ?? (format === "jpeg" ? "#ffffff" : undefined);
  if (fill) {
    const context = element.getContext("2d")!;
    context.fillStyle = fill;
    context.fillRect(0, 0, element.width, element.height);
  }
  const mark = watermarkFor(diagram);
  if (mark) {
    diagram.drawWatermark(canvas, element.width, element.height, ...mark);
  }
  diagram.arrangeDiagram(canvas);
  diagram.drawDiagram(canvas, false);
  const base64 = element
    .toDataURL(MIME[format])
    .replace(/^data:image\/(png|jpeg);base64,/, "");
  return {
    data: Buffer.from(base64, "base64"),
    width: element.width,
    height: element.height,
  };
}

/**
 * diagram-export.js getSVGImageData, which watermarks itself. It draws the
 * diagram's selection, so the selection is cleared for the call and put back.
 */
export function renderSvg(
  diagram: DrawableDiagram,
  background: string | undefined,
): Rendered {
  const selected = diagram.selectedViews;
  diagram.selectedViews = [];
  let svg: string;
  try {
    svg = diagramExport().getSVGImageData(diagram);
  } finally {
    diagram.selectedViews = selected;
  }
  if (background) {
    // svgcanvas paints nothing behind the diagram; a first child is the backdrop.
    svg = svg.replace(
      /<svg\b[^>]*>/,
      (open) =>
        `${open}<rect width="100%" height="100%" fill="${background}"/>`,
    );
  }
  const size = (attr: string) =>
    Number(new RegExp(`<svg\\b[^>]*\\b${attr}="([\\d.]+)`).exec(svg)?.[1] ?? 0);
  return {
    data: Buffer.from(svg, "utf-8"),
    width: size("width"),
    height: size("height"),
  };
}

const absolutePath = (description: string) =>
  doc(
    z
      .string()
      .check(z.refine((p) => isAbsolute(p), "must be an absolute path")),
    description,
  );

function currentOr(id: string | undefined): Element {
  if (id !== undefined) return requireDiagram(id);
  const current = app.diagrams.getCurrentDiagram();
  if (!current)
    throw new ApiError("NOT_FOUND", "No diagram is open; pass 'id'");
  return current;
}

export const exportDiagram = defineEndpoint({
  path: "/export_diagram",
  description:
    "Render a diagram as PNG, JPEG or SVG, as File > Export Diagram As does, and return it base64-encoded or write it to a file.",
  readOnly: false,
  destructive: true,
  request: z.object({
    id: z.optional(doc(z.string(), "Diagram id; default the current diagram.")),
    format: z.optional(
      doc(z.enum(["png", "jpeg", "svg"]), "Image format; default png."),
    ),
    scale: z.optional(
      doc(
        z.number().check(z.positive(), z.maximum(MAX_SCALE)),
        `Pixels per diagram unit for PNG and JPEG, up to ${MAX_SCALE}; default 1. File > Export uses the display's pixel ratio. SVG is unscaled.`,
      ),
    ),
    background: z.optional(
      doc(
        z.string().check(z.regex(/^(#[0-9a-f]{3,8}|[a-z]+)$/i)),
        "CSS colour behind the diagram, e.g. '#ffffff'. Default transparent, white for JPEG.",
      ),
    ),
    path: z.optional(
      absolutePath(
        "Absolute file to write; overwritten, parent directories created. Omit to receive the image in the response.",
      ),
    ),
  }),
  response: z.object({
    diagram: z.string(),
    format: z.string(),
    mimeType: z.string(),
    width: doc(z.number(), "Pixels; SVG user units for svg."),
    height: z.number(),
    bytes: doc(z.int(), "Size of the encoded image."),
    path: z.optional(
      doc(z.string(), "The file written, when 'path' was given."),
    ),
    base64: z.optional(
      doc(z.string(), "The image, when 'path' was not given."),
    ),
  }),
  handle: (input) => {
    const diagram = currentOr(input.id) as DrawableDiagram;
    const format: Format = input.format ?? "png";
    const image = inStarUML(() =>
      format === "svg"
        ? renderSvg(diagram, input.background)
        : renderRaster(diagram, format, input.scale ?? 1, input.background),
    );
    const meta = {
      diagram: diagram._id,
      format,
      mimeType: MIME[format],
      width: image.width,
      height: image.height,
      bytes: image.data.length,
    };
    if (input.path === undefined) {
      return { ...meta, base64: image.data.toString("base64") };
    }
    writeFile(input.path, image.data);
    return { ...meta, path: input.path };
  },
});

function writeFile(path: string, data: Buffer): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  } catch (err) {
    throw new ApiError(
      "STARUML_ERROR",
      `Cannot write ${path}: ${(err as Error).message}`,
    );
  }
}

/** pdfkit writes "%%EOF" last (PDFDocument.end), so its presence means the stream was flushed. */
export const PDF_WAIT_MS = 30_000;
const PDF_POLL_MS = 50;

export async function waitForPdf(
  path: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (
      existsSync(path) &&
      readFileSync(path).subarray(-32).includes("%%EOF")
    ) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new ApiError(
        "STARUML_ERROR",
        `PDF was not completed within ${timeoutMs} ms: ${path}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PDF_POLL_MS));
  }
}

export const exportPdf = defineEndpoint({
  path: "/export_pdf",
  description:
    "Write diagrams to a PDF file, one page each, as File > Print to PDF and the CLI's pdf command do.",
  readOnly: false,
  destructive: true,
  request: z.object({
    path: absolutePath("Absolute .pdf file to write; overwritten."),
    ids: z.optional(
      doc(
        z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
        "Diagram ids in page order; default every diagram in the project.",
      ),
    ),
    size: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "pdfkit page size, e.g. 'A4' (default), 'LETTER', 'A3'.",
      ),
    ),
    layout: z.optional(
      doc(z.enum(["landscape", "portrait"]), "Default landscape."),
    ),
    showName: z.optional(
      doc(z.boolean(), "Print each diagram's path name; default true."),
    ),
  }),
  response: z.object({
    path: z.string(),
    pages: z.int(),
    bytes: z.int(),
  }),
  handle: async (input) => {
    requireProject();
    const diagrams = input.ids
      ? input.ids.map((i) => requireDiagram(i))
      : app.repository.getInstancesOf("Diagram");
    if (diagrams.length === 0) {
      throw new ApiError("NOT_FOUND", "The project has no diagrams");
    }
    writeFile(input.path, Buffer.alloc(0));
    inStarUML(() =>
      diagramExport().exportToPDF(diagrams, input.path, {
        size: input.size ?? "A4",
        layout: input.layout ?? "landscape",
        showName: input.showName ?? true,
      }),
    );
    await waitForPdf(input.path, PDF_WAIT_MS);
    return {
      path: input.path,
      pages: diagrams.length,
      bytes: readFileSync(input.path).length,
    };
  },
});

export const exportHtml = defineEndpoint({
  path: "/export_html",
  description:
    "Write HTML documentation of the whole project, with diagram images, into a directory (File > Export > HTML Docs).",
  readOnly: false,
  destructive: true,
  request: z.object({
    path: absolutePath(
      "Absolute directory to write into; created if missing. index.html is its entry page.",
    ),
  }),
  response: z.object({ path: z.string(), index: z.string() }),
  handle: async (input) => {
    requireProject();
    const command = "html-export:export";
    if (!Object.hasOwn(app.commands.commands, command)) {
      throw new ApiError(
        "STARUML_ERROR",
        "The bundled html-export extension is not loaded",
      );
    }
    // The command reports failure only as a toast (extensions/default/
    // html-export/main.js), so success is judged by the entry page existing.
    const index = join(input.path, "index.html");
    rmSync(index, { force: true });
    await app.commands.execute(command, input.path);
    if (!existsSync(index)) {
      throw new ApiError("STARUML_ERROR", `HTML export wrote no ${index}`);
    }
    return { path: input.path, index };
  },
});
