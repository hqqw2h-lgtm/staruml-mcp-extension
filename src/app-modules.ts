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

import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ApiError } from "./errors.js";
import type { Element } from "./types.js";

/** engine/diagram-export.js; what the CLI's image and pdf commands call. */
export interface DiagramExportModule {
  /** Base64 PNG or JPEG at window.devicePixelRatio; draws the selection. */
  getImageData(diagram: Element, mime: string): string;
  /** Draws the diagram's current selection unless the caller clears it. */
  getSVGImageData(diagram: Element): string;
  /** Streams the PDF; the file is complete only after pdfkit flushes it. */
  exportToPDF(
    diagrams: Element[],
    fullPath: string,
    options: { size: string; layout: string; showName: boolean },
  ): void;
}

/**
 * Loads one of StarUML's own modules. They are not reachable through `app`,
 * and extensions are loaded with their own require, so the module is resolved
 * from the app sources under Electron's process.resourcesPath. Node caches by
 * resolved path, so this returns the instance StarUML already loaded.
 */
export function appModule<T>(relative: string): T {
  const appRequire = createRequire(join(appRoot(), "src", "index.js"));
  return appRequire(`./${relative}`) as T;
}

function appRoot(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (!resources) {
    throw new ApiError(
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML",
    );
  }
  return join(resources, "app");
}

/** Every `<dir>/<extension>/rules.js` under `dir`. */
function extensionRules(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name, "rules.js"))
    .filter((file) => existsSync(file));
}

/**
 * Loads the validation rules into this window's `rules` global and answers
 * the files read. StarUML loads rules.js only in the main process
 * (extension-loader.js leaves 'rules' out of DEFAULT_FEATURES; Model >
 * Validate saves the file and asks the main process over IPC), so the
 * renderer's app.validator starts with none. The files are the ones the
 * main process reads: resources/default/rules.js and the rules.js of every
 * extension under essential, default, dev and the user extension directory
 * (main-process/application.js in 7.1.1). Each file pushes into `rules`
 * when first required; Node's module cache keeps a second call from adding
 * them again.
 */
export function loadValidationRules(userExtensions: string | null): string[] {
  const root = appRoot();
  const files = [
    join(root, "resources", "default", "rules.js"),
    ...["essential", "default", "dev"].flatMap((d) =>
      extensionRules(join(root, "extensions", d)),
    ),
    ...(userExtensions ? extensionRules(userExtensions) : []),
  ].filter((file) => existsSync(file));
  const load = createRequire(join(root, "src", "index.js"));
  for (const file of files) load(file);
  return files;
}

/**
 * Where StarUML 7.1.1 keeps what File > New From Template and the
 * extension loader read: its resources, then the essential, default and
 * dev extension folders under the app and the user's extension folder
 * (extensibility/extension-loader.js).
 */
export function extensionRoots(): { source: string; dir: string }[] {
  const root = appRoot();
  const user = app.extensionLoader?.getUserExtensionPath() ?? null;
  return [
    { source: "core", dir: join(root, "resources") },
    ...["essential", "default", "dev"].map((source) => ({
      source,
      dir: join(root, "extensions", source),
    })),
    ...(user ? [{ source: "user", dir: user }] : []),
  ];
}

/** The bounds StarUML's views report: Rect in core/graphics.js. */
export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** core/graphics.js: the Canvas views measure and draw themselves with. */
export interface GraphicsModule {
  Canvas: new (context: unknown) => unknown;
}

export function graphics(): GraphicsModule {
  return appModule<GraphicsModule>("core/graphics.js");
}

export function diagramExport(): DiagramExportModule {
  return appModule<DiagramExportModule>("engine/diagram-export.js");
}
