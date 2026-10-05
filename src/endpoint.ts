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
import en from "zod/v4/locales/en.js";
import { ApiError } from "./errors.js";
import type { Handler } from "./http-server.js";

// zod/mini ships without messages; English is the one locale bundled. Without
// jitless, zod probes for eval support with new Function(), which StarUML's
// renderer may refuse under a content security policy.
z.config(en());
z.config({ jitless: true });

export interface Endpoint {
  path: `/${string}`;
  description: string;
  /** Only reads; MCP's readOnlyHint. */
  readOnly: boolean;
  /**
   * May delete or overwrite existing model data, files or the open project,
   * as opposed to only adding to it; MCP's destructiveHint.
   */
  destructive: boolean;
  request: z.ZodMiniType;
  /** Schema of `data` in a successful response. */
  response: z.ZodMiniType;
  handler: Handler;
}

export interface EndpointSpec<
  Req extends z.ZodMiniType,
  Res extends z.ZodMiniType,
> extends Omit<Endpoint, "handler" | "request" | "response"> {
  request: Req;
  response: Res;
  handle(input: z.output<Req>): z.output<Res> | Promise<z.output<Res>>;
}

export interface Issue {
  path: string;
  message: string;
}

/**
 * Wraps `handle` so the body is parsed against `request` first and an
 * ApiError becomes its error body. Anything else that escapes is a defect and
 * is left to the HTTP server, which answers 500 and logs the stack.
 */
export function defineEndpoint<
  Req extends z.ZodMiniType,
  Res extends z.ZodMiniType,
>(spec: EndpointSpec<Req, Res>): Endpoint {
  const { handle, ...endpoint } = spec;
  const handler: Handler = async (body) => {
    const parsed = z.safeParse(spec.request, body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(toIssue);
      return new ApiError(
        "INVALID_ARGUMENT",
        issues.map((i) => `${i.path}: ${i.message}`).join("; "),
        issues,
      ).toBody();
    }
    try {
      return { success: true, data: await handle(parsed.data) };
    } catch (err) {
      if (err instanceof ApiError) return err.toBody();
      throw err;
    }
  };
  return { ...endpoint, handler };
}

function toIssue(issue: z.core.$ZodIssue): Issue {
  const path = issue.path.map(String).join(".");
  return { path: path || "(body)", message: issue.message };
}

/** Attaches a description that the manifest's JSON Schema carries. */
export function doc<T extends z.ZodMiniType>(
  schema: T,
  description: string,
): T {
  z.globalRegistry.add(schema as z.core.$ZodType, { description });
  return schema;
}
