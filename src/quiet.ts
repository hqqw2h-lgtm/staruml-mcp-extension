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

import type { Endpoint } from "./endpoint.js";
import { PREF } from "./settings.js";
import type { Element } from "./types.js";

/*
 * The write path's UI work, held back while a request runs (issue #26).
 * On every created model StarUML 7.1.1 adds it to the model explorer and
 * selects it, scrolling with a 500 ms jQuery animation (app-context.js
 * setupRepository, views/model-explorer-view.js select). The selection is
 * what slows a session down: each selection change costs a little more
 * than the one before for the rest of the session. 600 create-and-delete
 * cycles took a create from 15 to 75 ms with the selection and kept it at
 * 3 ms without (docs/performance.md). A quiet request therefore selects
 * nothing (or, with mcp-ext.ui.selectCreated, its last created element,
 * without scrolling).
 *
 * Repaint is not suspended: StarUML fits views to their content and routes
 * edges when it paints (View.arrange in core/core.js), and the layout and
 * quality steps that follow each operation read that geometry; with
 * DiagramManager.suspendRepaint the golden diagrams came out shifted.
 */

/** views/model-explorer-view.js; $viewContent is the jQuery-wrapped panel. */
export interface ModelExplorer {
  select(elem: Element, scrollTo?: boolean): void;
  $viewContent?: {
    stop?(clearQueue: boolean, jumpToEnd: boolean): unknown;
    queue?(name: string): unknown[];
  };
}

let depth = 0;

/** Whether a quiet request is running. */
export const quiet = (): boolean => depth > 0;

/**
 * Runs `run` with explorer selection held back to its end; nested calls
 * leave it to the outermost.
 */
export async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
  const explorer =
    depth === 0 ? (app.modelExplorer as ModelExplorer | undefined) : undefined;
  const own = explorer && Object.getOwnPropertyDescriptor(explorer, "select");
  let last: Element | null = null;
  if (explorer) {
    explorer.select = (elem) => {
      last = elem;
    };
  }
  depth++;
  try {
    return await run();
  } finally {
    depth--;
    if (explorer) {
      if (own) Object.defineProperty(explorer, "select", own);
      else delete (explorer as { select?: unknown }).select;
      // A queue left by the UI or an older version is dropped, not played.
      explorer.$viewContent?.stop?.(true, true);
      if (
        last &&
        app.preferences.get(PREF.selectCreated, false) === true &&
        app.repository.get((last as Element)._id)
      ) {
        explorer.select(last, false);
      }
    }
  }
}

/** `endpoint` run quietly, for every endpoint that writes. */
export function quieted(endpoint: Endpoint): Endpoint {
  if (endpoint.readOnly) return endpoint;
  return {
    ...endpoint,
    handler: (body) => quietly(() => endpoint.handler(body)),
  };
}
