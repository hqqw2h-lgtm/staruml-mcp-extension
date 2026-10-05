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

import { ApiError } from "./errors.js";

/**
 * Thrown in place of opening a dialog. Callers see an exception at the point
 * the dialog would have opened, which ends most command handlers there.
 */
export class DialogRefused extends Error {
  constructor(readonly dialog: string) {
    super(`Refused to open ${dialog}`);
    this.name = "DialogRefused";
  }
}

type Host = Record<string, unknown>;

/**
 * Where dialogs are opened from: every show* method of app.dialogs
 * (dialogs/dialog-manager.js, the modal, message, file and colour dialogs,
 * native ones included) and showDialog of the picker and editor dialogs
 * StarUML hangs on app, e.g. app.elementPickerDialog
 * (dialogs/element-picker-dialog.js), which code generators open when no
 * base element is passed.
 */
function dialogMethods(): [Host, string, string][] {
  const found: [Host, string, string][] = [];
  const dialogs = app.dialogs as unknown as Host;
  for (const name of methodNames(dialogs)) {
    if (name.startsWith("show")) found.push([dialogs, name, `dialogs.${name}`]);
  }
  for (const [key, value] of Object.entries(app)) {
    const host = value as Host | null;
    if (
      key !== "dialogs" &&
      host !== null &&
      typeof host === "object" &&
      typeof host.showDialog === "function"
    ) {
      found.push([host, "showDialog", `${key}.showDialog`]);
    }
  }
  return found;
}

function methodNames(host: Host): string[] {
  const names = new Set(Object.keys(host));
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(host))) {
    names.add(name);
  }
  return [...names].filter((n) => typeof host[n] === "function");
}

/**
 * Runs `run` with every dialog entry point replaced by one that throws
 * DialogRefused, so a command that would wait for someone at StarUML fails
 * instead of holding the request until the timeout (or, for the synchronous
 * native file dialogs, freezing the renderer and with it this server). The
 * replacements are own properties shadowing the prototype methods, removed
 * when `run` settles; a dialog opened by StarUML's UI in that window is
 * refused too.
 */
export async function withoutDialogs<T>(
  what: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const attempted: string[] = [];
  const restore: (() => void)[] = [];
  for (const [host, name, label] of dialogMethods()) {
    const own = Object.getOwnPropertyDescriptor(host, name);
    host[name] = () => {
      attempted.push(label);
      throw new DialogRefused(label);
    };
    restore.push(() => {
      if (own) Object.defineProperty(host, name, own);
      else delete host[name];
    });
  }
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await run() };
  } catch (error) {
    outcome = { error };
  } finally {
    for (const undo of restore) undo();
  }
  if (attempted.length > 0) {
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${what} opens a dialog (${attempted[0]}) that would wait for someone at StarUML; pass the arguments that avoid it or use a dedicated endpoint`,
      { dialogs: attempted },
    );
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
