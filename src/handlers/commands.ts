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

export const executeCommand = defineEndpoint({
  path: "/execute_command",
  description:
    "Run a registered StarUML command (see /get_all_commands). Commands can do anything the UI can, including deleting data.",
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
    let result: unknown;
    try {
      result = await app.commands.execute(input.id, ...(input.args ?? []));
    } catch (err) {
      throw new ApiError(
        "STARUML_ERROR",
        `Command ${input.id} threw: ${errorMessage(err)}`,
      );
    }
    return { id: input.id, result: serializeValue(result, input) };
  },
});
