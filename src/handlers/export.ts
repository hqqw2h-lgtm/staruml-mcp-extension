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

export const MAX_SCALE = 4;

const MIME = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml" };

type Format = keyof typeof MIME;

interface SelectableDiagram extends Element {
  selectedViews: Element[];
}

export interface Rendered {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * StarUML's exporters draw the diagram's selection handles. Clearing the
 * selection for the call, rather than calling deselectAll as File > Export
 * does, leaves what the user has selected untouched.
 */
function withoutSelection<T>(diagram: SelectableDiagram, run: () => T): T {
  const selected = diagram.selectedViews;
  diagram.selectedViews = [];
  try {
    return run();
  } finally {
    diagram.selectedViews = selected;
  }
}

/**
 * getImageData (see engine/diagram-export.js) renders at
 * window.devicePixelRatio, its only resolution input. The HTML spec marks
 * that attribute [Replaceable], so an own property shadows it for the
 * synchronous call and the original descriptor is put back afterwards.
 */
export function withPixelRatio<T>(ratio: number, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: ratio,
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(window, "devicePixelRatio", original);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  }
}

/**
 * Pixel size from the encoded image: the PNG IHDR chunk follows the 8-byte
 * signature (RFC 2083 section 3.2); a JPEG's frame header is the first SOFn
 * marker, 0xC0 to 0xCF other than DHT (C4), JPG (C8) and DAC (CC) (ITU T.81
 * table B.1).
 */
export function imageSize(data: Buffer): { width: number; height: number } {
  if (data.length >= 24 && data.readUInt32BE(12) === 0x49484452) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  let at = 2;
  while (at + 9 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1]!;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        width: data.readUInt16BE(at + 7),
        height: data.readUInt16BE(at + 5),
      };
    }
    at += 2 + data.readUInt16BE(at + 2);
  }
  return { width: 0, height: 0 };
}

/** Paints `background` and the transparent PNG over it, then encodes `mime`. */
async function composite(
  png: Buffer,
  background: string,
  mime: string,
): Promise<Buffer> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(png)], { type: "image/png" }),
  );
  const element = document.createElement("canvas");
  element.width = bitmap.width;
  element.height = bitmap.height;
  const context = element.getContext("2d")!;
  context.fillStyle = background;
  context.fillRect(0, 0, element.width, element.height);
  context.drawImage(bitmap, 0, 0);
  return dataUrlBytes(element.toDataURL(mime));
}

const dataUrlBytes = (url: string) =>
  Buffer.from(url.slice(url.indexOf(",") + 1), "base64");

/**
 * StarUML's own getImageData renders the raster, watermark included, at
 * `scale` device pixels per diagram unit. It fills only JPEGs (white), so a
 * requested background is painted under a transparent PNG rendering here.
 */
export async function renderRaster(
  diagram: SelectableDiagram,
  format: "png" | "jpeg",
  scale: number,
  background: string | undefined,
): Promise<Rendered> {
  const mime = background === undefined ? MIME[format] : MIME.png;
  const base64 = inStarUML(() =>
    withoutSelection(diagram, () =>
      withPixelRatio(scale, () => diagramExport().getImageData(diagram, mime)),
    ),
  );
  let data: Buffer = Buffer.from(base64, "base64");
  if (background !== undefined) {
    data = await composite(data, background, MIME[format]);
  }
  return { data, ...imageSize(data) };
}

/** getSVGImageData (see engine/diagram-export.js) watermarks itself. */
export function renderSvg(
  diagram: SelectableDiagram,
  background: string | undefined,
): Rendered {
  let svg = withoutSelection(diagram, () =>
    diagramExport().getSVGImageData(diagram),
  );
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
  handle: async (input) => {
    const diagram = currentOr(input.id) as SelectableDiagram;
    const format: Format = input.format ?? "png";
    const image =
      format === "svg"
        ? inStarUML(() => renderSvg(diagram, input.background))
        : await renderRaster(
            diagram,
            format,
            input.scale ?? 1,
            input.background,
          );
    return deliver(
      {
        diagram: diagram._id,
        format,
        mimeType: MIME[format],
        width: image.width,
        height: image.height,
        bytes: image.data.length,
      },
      image.data,
      input.path,
    );
  },
});

function deliver<M extends object>(
  meta: M,
  data: Buffer,
  path: string | undefined,
): M & { base64?: string; path?: string } {
  if (path === undefined) return { ...meta, base64: data.toString("base64") };
  writeFile(path, data);
  return { ...meta, path };
}

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
