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

import type { Operation } from "./types.js";

/*
 * One undo step around a composite call: a build followed by its style
 * profile and quality loop, a derivation of many diagrams. The operations
 * StarUML records meanwhile are merged into one, as /batch merges its own;
 * a nested step leaves the merge to the outermost one.
 */

interface UndoStack {
  stack: Operation[];
  pop(): Operation | undefined;
  push(operation: Operation): void;
}

/** core/repository.js keeps its history in two Stack fields with no public accessors. */
interface History {
  _undoStack: UndoStack;
  _redoStack: { clear(): void };
}

const history = () => app.repository as unknown as History;

let depth = 0;

/** Whether a step is open, so an inner batch leaves its operations unmerged. */
export const insideStep = (): boolean => depth > 0;

/**
 * The recorded operations still on top of the undo stack, oldest first.
 * Membership rather than a count: StarUML's Stack drops its oldest entry
 * past MAX_STACK_SIZE, and a batch rolled back inside the step has already
 * taken its own operations off.
 */
function takeRecorded(recorded: ReadonlySet<Operation>): Operation[] {
  const { _undoStack } = history();
  const taken: Operation[] = [];
  while (_undoStack.stack.length > 0) {
    const top = _undoStack.stack[_undoStack.stack.length - 1]!;
    if (!recorded.has(top)) break;
    taken.unshift(_undoStack.pop()!);
  }
  return taken;
}

function merge(name: string, recorded: ReadonlySet<Operation>): void {
  const taken = takeRecorded(recorded);
  if (taken.length === 0) return;
  const builder = app.repository.getOperationBuilder();
  builder.begin(name);
  builder.end();
  const merged = builder.getOperation();
  merged.ops = taken.flatMap((o) => o.ops);
  history()._undoStack.push(merged);
}

/** Undoes what the step recorded, newest first, leaving nothing to redo. */
function revert(recorded: ReadonlySet<Operation>): void {
  const { _undoStack } = history();
  while (_undoStack.stack.length > 0) {
    const top = _undoStack.stack[_undoStack.stack.length - 1]!;
    if (!recorded.has(top)) break;
    app.repository.undo();
  }
  history()._redoStack.clear();
}

/**
 * Runs `run` as one undo step named `name`; when it throws, what it did is
 * undone before the error goes on.
 */
export async function oneStep<T>(
  name: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const recorded = new Set<Operation>();
  const listener = (operation: Operation) => recorded.add(operation);
  const outermost = depth === 0;
  app.repository.on("operationExecuted", listener);
  depth++;
  try {
    const value = await run();
    if (outermost) merge(name, recorded);
    return value;
  } catch (err) {
    revert(recorded);
    throw err;
  } finally {
    depth--;
    app.repository.off("operationExecuted", listener);
  }
}

/**
 * Runs `run`, then undoes everything it did: a dry run that needs the
 * model changed to measure the result (a quality loop's score).
 */
export async function rehearse<T>(run: () => Promise<T> | T): Promise<T> {
  const recorded = new Set<Operation>();
  const listener = (operation: Operation) => recorded.add(operation);
  app.repository.on("operationExecuted", listener);
  depth++;
  try {
    return await run();
  } finally {
    depth--;
    app.repository.off("operationExecuted", listener);
    revert(recorded);
  }
}
