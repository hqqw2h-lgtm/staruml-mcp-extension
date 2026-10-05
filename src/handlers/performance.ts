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

import * as z from "zod/mini";
import { defineEndpoint, doc } from "../endpoint.js";
import { type ModelExplorer, quiet } from "../quiet.js";

/*
 * What the write path's cost depends on in StarUML 7.1.1 (issue #26), read
 * without changing anything: who listens to the repository, how much
 * history it keeps, how many elements it indexes, the tabs open and the
 * model explorer's queued animations.
 */

/** Repository events the app and the extensions listen to (app-context.js). */
const EVENTS = [
  "beforeExecuteOperation",
  "operationExecuted",
  "created",
  "updated",
  "deleted",
] as const;

interface Counted {
  listenerCount?(event: string): number;
  _undoStack?: { stack: unknown[] };
  _redoStack?: { stack: unknown[] };
}

export const performanceStats = defineEndpoint({
  path: "/performance_stats",
  description:
    "Diagnostics of the write path: repository listeners per event, undo and redo depth, elements indexed, editor tabs open, animations queued in the model explorer, and the renderer's heap. A count that grows over a session while the model does not points at what slows it.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({
    listeners: doc(
      z.record(z.string(), z.int()),
      "Repository listeners by event.",
    ),
    undo: z.int(),
    redo: z.int(),
    elements: doc(z.int(), "Elements, views and diagrams indexed by id."),
    workingDiagrams: z.int(),
    explorerAnimations: doc(
      z.int(),
      "Scroll animations queued in the model explorer (jQuery fx queue).",
    ),
    heapUsedMiB: z.number(),
    quiet: doc(z.boolean(), "A writing request is running."),
  }),
  handle: () => {
    const repo = app.repository as unknown as Counted;
    const explorer = app.modelExplorer as ModelExplorer | undefined;
    return {
      listeners: Object.fromEntries(
        EVENTS.map((e) => [e, repo.listenerCount?.(e) ?? 0]),
      ),
      undo: repo._undoStack?.stack.length ?? 0,
      redo: repo._redoStack?.stack.length ?? 0,
      elements: Object.keys(app.repository.getIdMap()).length,
      workingDiagrams: app.diagrams.getWorkingDiagrams().length,
      explorerAnimations: explorer?.$viewContent?.queue?.("fx").length ?? 0,
      heapUsedMiB:
        Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
      quiet: quiet(),
    };
  },
});
