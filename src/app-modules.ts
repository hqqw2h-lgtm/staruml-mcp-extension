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
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (!resources) {
    throw new ApiError(
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML",
    );
  }
  const appRequire = createRequire(join(resources, "app", "src", "index.js"));
  return appRequire(`./${relative}`) as T;
}

export function diagramExport(): DiagramExportModule {
  return appModule<DiagramExportModule>("engine/diagram-export.js");
}
