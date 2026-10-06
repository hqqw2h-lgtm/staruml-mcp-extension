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
  /**
   * Older request field names, each mapped to the canonical field it stands
   * for (issue #36). The manifest lists them marked `x-alias-of`.
   */
  aliases?: Readonly<Record<string, string>>;
  handler: Handler;
}

export interface EndpointSpec<
  Req extends z.ZodMiniType,
  Res extends z.ZodMiniType,
> extends Omit<Endpoint, "handler" | "request" | "response"> {
  request: Req;
  response: Res;
  handle(input: z.output<Req>): z.output<Res> | Promise<z.output<Res>>;
  /**
   * Said after an unknown-field error: what such a field usually is and
   * where the accepted ones are listed.
   */
  unknownKeyHint?: string;
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
  const { handle, unknownKeyHint, ...endpoint } = spec;
  const handler: Handler = async (body) => {
    let renamed: Renamed;
    try {
      renamed = renameAliases(body, spec.aliases);
    } catch (err) {
      return (err as ApiError).toBody();
    }
    const parsed = z.safeParse(spec.request, renamed.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => toIssue(i, renamed.used));
      const unknown =
        unknownKeyHint !== undefined &&
        parsed.error.issues.some((i) => i.code === "unrecognized_keys");
      return new ApiError(
        "INVALID_ARGUMENT",
        issues.map((i) => `${i.path}: ${i.message}`).join("; ") +
          (unknown ? `; ${unknownKeyHint}` : ""),
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

/**
 * The body with each alias renamed to its canonical field. Both spellings
 * of one field in the same body are refused rather than one silently
 * winning.
 */
export function renameAliases(
  body: unknown,
  aliases: Readonly<Record<string, string>> | undefined,
): Renamed {
  const used = new Map<string, string>();
  if (!aliases || !body || typeof body !== "object" || Array.isArray(body)) {
    return { body, used };
  }
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!Object.hasOwn(out, alias)) continue;
    if (Object.hasOwn(out, canonical)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${alias}: an alias of ${canonical}, which is given too; pass ${canonical} only`,
      );
    }
    out[canonical] = out[alias];
    delete out[alias];
    used.set(canonical, alias);
  }
  return { body: out, used };
}

export interface Renamed {
  body: unknown;
  /** The alias the caller wrote, by the canonical field it was renamed to. */
  used: Map<string, string>;
}

/** An issue under the field name the caller wrote, alias or canonical. */
function toIssue(issue: z.core.$ZodIssue, used: Map<string, string>): Issue {
  const [head, ...rest] = issue.path.map(String);
  const path = [
    ...(head === undefined ? [] : [used.get(head) ?? head]),
    ...rest,
  ].join(".");
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
