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
import { inStarUML } from "../errors.js";

const state = () =>
  z.object({
    modified: doc(
      z.boolean(),
      "Whether the project has changes not yet saved to its file.",
    ),
  });

/*
 * Repository.undo/redo swallow what fails while reverting and do nothing on
 * an empty stack (core/repository.js, 7.1.1), so neither can report whether
 * a step was taken; the modified flag is the observable result.
 */

export const undo = defineEndpoint({
  path: "/undo",
  description:
    "Undo the last change (Edit > Undo). Every endpoint that changes the model is one step; an atomic /batch is one step.",
  readOnly: false,
  destructive: true,
  request: z.object({}),
  response: state(),
  handle: () => {
    inStarUML(() => app.repository.undo());
    return { modified: app.repository.isModified() };
  },
});

export const redo = defineEndpoint({
  path: "/redo",
  description: "Redo the last undone change (Edit > Redo).",
  readOnly: false,
  destructive: true,
  request: z.object({}),
  response: state(),
  handle: () => {
    inStarUML(() => app.repository.redo());
    return { modified: app.repository.isModified() };
  },
});

export const isModified = defineEndpoint({
  path: "/is_modified",
  description: "Whether the project has unsaved changes.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: state(),
  handle: () => ({ modified: app.repository.isModified() }),
});
