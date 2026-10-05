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
import catalogue from "../command-catalogue.json";
import { withoutDialogs } from "../dialog-guard.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, errorMessage } from "../errors.js";
import { id, projectionShape } from "../schemas.js";
import { serializeValue } from "../serialize.js";

/**
 * `commands` holds every registered command; `commandNames` only those
 * registered with a display name (engine/command-manager.js), so it undercounts.
 */
export const getAllCommands = defineEndpoint({
  path: "/get_all_commands",
  description: "Ids of every registered command.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({ count: z.int(), ids: z.array(z.string()) }),
  handle: () => {
    const ids = Object.keys(app.commands.commands).sort();
    return { count: ids.length, ids };
  },
});

/**
 * How a command behaves without someone at StarUML, from reading each
 * handler in the 7.1.1 sources (src/engine/default-commands.js,
 * src/views/*, extensions/essential and extensions/default) and the
 * staruml-java 0.9.7 commands; docs/commands.md is generated from it.
 * "always" opens a dialog whatever it is given; "without-args" opens one
 * unless given its first `avoidWith` arguments; "confirm" may open one
 * depending on state (unsaved changes, selection); "external" opens a URL in
 * the system browser.
 */
export type DialogClass =
  "never" | "always" | "without-args" | "confirm" | "external";

export interface CommandInfo {
  dialog: DialogClass;
  effect: string;
  args: { name: string; type: string; optional: boolean; note?: string }[];
  needs?: string;
  async?: boolean;
  note?: string;
  source: string;
  avoidWith?: number;
}

export const CATALOGUE_VERSION = catalogue.version;
export const COMMANDS = catalogue.commands as Record<string, CommandInfo>;

export function commandInfo(id: string): CommandInfo | undefined {
  return Object.hasOwn(COMMANDS, id) ? COMMANDS[id] : undefined;
}

/** Refuses up front what is known to open a dialog for these arguments. */
export function refuseDialog(id: string, args: readonly unknown[]): void {
  const info = commandInfo(id);
  if (info?.dialog === "always") {
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${id} always opens a dialog that would wait for someone at StarUML (${info.effect})${info.note ? ` ${info.note}` : ""}`,
      { dialog: "always" },
    );
  }
  const needed = info?.avoidWith ?? 0;
  if (info?.dialog === "without-args" && args.length < needed) {
    const names = info.args.slice(0, needed).map((a) => a.name);
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${id} opens a dialog unless given ${names.join(", ")}; pass ${needed} argument${needed === 1 ? "" : "s"}`,
      { dialog: "without-args", args: names },
    );
  }
}

const argSchema = () =>
  z.object({
    name: z.string(),
    type: z.string(),
    optional: z.boolean(),
    note: z.optional(z.string()),
  });

export const describeCommands = defineEndpoint({
  path: "/describe_commands",
  description:
    "Arguments, effect and dialog behaviour of registered commands (docs/commands.md), so /execute_command can be called without opening a dialog.",
  readOnly: true,
  destructive: false,
  request: z.object({
    ids: z.optional(
      doc(
        z.array(z.string().check(z.minLength(1))),
        "Command ids; default every registered and every catalogued command.",
      ),
    ),
  }),
  response: z.object({
    catalogue: doc(z.string(), "StarUML version the catalogue was read from."),
    count: z.int(),
    commands: z.array(
      z.object({
        id: z.string(),
        registered: z.boolean(),
        dialog: doc(
          z.string(),
          "never, always, without-args, confirm, external, or unknown for a command not in the catalogue.",
        ),
        effect: z.optional(z.string()),
        args: z.optional(z.array(argSchema())),
        avoidWith: z.optional(
          doc(z.int(), "without-args: arguments that avoid the dialog."),
        ),
        needs: z.optional(z.string()),
        async: z.optional(z.boolean()),
        note: z.optional(z.string()),
        source: z.optional(z.string()),
      }),
    ),
  }),
  handle: (input) => {
    const ids =
      input.ids ??
      [
        ...new Set([
          ...Object.keys(app.commands.commands),
          ...Object.keys(COMMANDS),
        ]),
      ].sort();
    const commands = ids.map((id) => {
      const info = commandInfo(id);
      return {
        id,
        registered: Object.hasOwn(app.commands.commands, id),
        ...(info ?? { dialog: "unknown" }),
      };
    });
    return { catalogue: CATALOGUE_VERSION, count: commands.length, commands };
  },
});

export const executeCommand = defineEndpoint({
  path: "/execute_command",
  description:
    "Run a registered StarUML command (see /describe_commands for arguments). Commands can do anything the UI can, including deleting data. A command that would open a dialog is refused with DIALOG_REQUIRED instead of waiting for someone at StarUML.",
  readOnly: false,
  destructive: true,
  request: z.object({
    id: id("Command id, e.g. 'edit.undo'."),
    args: z.optional(doc(z.array(z.unknown()), "Positional arguments.")),
    ...projectionShape(),
  }),
  response: z.object({
    id: z.string(),
    result: doc(
      z.unknown(),
      "The command's return value; elements are projected like any element.",
    ),
  }),
  handle: async (input) => {
    // execute() returns false for an unknown id, which is indistinguishable from a
    // command that legitimately returns false, so check registration first.
    if (!Object.hasOwn(app.commands.commands, input.id)) {
      throw new ApiError("NOT_FOUND", `Command not registered: ${input.id}`);
    }
    const args = input.args ?? [];
    refuseDialog(input.id, args);
    let result: unknown;
    try {
      result = await withoutDialogs(`Command ${input.id}`, () =>
        app.commands.execute(input.id, ...args),
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        "STARUML_ERROR",
        `Command ${input.id} threw: ${errorMessage(err)}`,
      );
    }
    return { id: input.id, result: serializeValue(result, input) };
  },
});
