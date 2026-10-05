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
import { doc, type Endpoint } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { tryResolve } from "../refs.js";
import { profile } from "./profile.js";

/*
 * Enforcement of the style profile (issues #31, #33), on the server so a
 * client that skips the MCP tiers cannot get around it: in a strict
 * profile the free-form style and geometry endpoints answer STYLE_LOCKED
 * unless the call says override: true, and with blockSaveOnErrors saving
 * and exporting answer SAVE_BLOCKED while the lints report errors. Calls the
 * extension makes for itself (a build applying the profile, the quality
 * loop) are trusted; only requests from outside are checked.
 */

let trustedDepth = 0;

/** Runs `run` as the extension's own work, which the guards let through. */
export async function trusted<T>(run: () => Promise<T>): Promise<T> {
  trustedDepth++;
  try {
    return await run();
  } finally {
    trustedDepth--;
  }
}

export const isTrusted = (): boolean => trustedDepth > 0;

/** Endpoints that only draw: position, size, colour, font, line style, z-order. */
export const STYLE_ENDPOINTS = [
  "/set_view_style",
  "/apply_theme",
  "/move_views",
  "/resize_node",
  "/route_edges",
  "/set_z_order",
  "/divide_fragment",
] as const;

/** View attributes /update_element would set past the profile. */
export const VIEW_STYLE_FIELDS = new Set([
  "left",
  "top",
  "width",
  "height",
  "points",
  "fillColor",
  "lineColor",
  "fontColor",
  "font",
  "lineStyle",
  "stereotypeDisplay",
  "autoResize",
  "showVisibility",
  "showOperationSignature",
  "showProperty",
  "showType",
  "showMultiplicity",
  "suppressAttributes",
  "suppressOperations",
  "wordWrap",
  "showNamespace",
]);

const overrideField = (what: string) =>
  z.optional(
    doc(
      z.boolean(),
      `Do it although the style profile ${what}; the call is still made as asked.`,
    ),
  );

type Body = Record<string, unknown>;

/**
 * `endpoint` with an `override` field, refusing with `code` when `refuses`
 * answers a reason for a body without override.
 */
function guarded(
  endpoint: Endpoint,
  what: string,
  refuses: (body: Body) => ApiError | null,
): Endpoint {
  const request = z.extend(endpoint.request as z.ZodMiniObject, {
    override: overrideField(what),
  });
  return {
    ...endpoint,
    request,
    handler: async (body) => {
      const given =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Body)
          : {};
      const { override, ...rest } = given;
      if (override !== true && !isTrusted()) {
        const refusal = refuses(rest);
        if (refusal) return refusal.toBody();
      }
      return endpoint.handler(body === given ? rest : body);
    },
  };
}

const locked = (path: string) =>
  new ApiError(
    "STYLE_LOCKED",
    `${path}: the style profile '${profile().name}' is strict, so views are styled and placed by the profile and the quality loop; use /improve_diagram or /apply_style_profile, or pass override: true`,
    { profile: profile().name, endpoint: path },
  );

/** A style or geometry endpoint, refused while the profile is strict. */
export function styleLocked(endpoint: Endpoint): Endpoint {
  return guarded(endpoint, "is strict", () =>
    profile().strict ? locked(endpoint.path) : null,
  );
}

/** /update_element, refused in a strict profile for a view's style or geometry. */
export function viewFieldLocked(endpoint: Endpoint): Endpoint {
  return guarded(endpoint, "is strict", (body) => {
    if (!profile().strict) return null;
    const field = body.field;
    if (typeof field !== "string" || !VIEW_STYLE_FIELDS.has(field)) {
      return null;
    }
    const ref = body.ref ?? body.id ?? body.elementId;
    let target;
    try {
      target = typeof ref === "string" ? tryResolve(ref) : null;
    } catch {
      // An ambiguous ref fails in the endpoint itself, with its candidates.
      return null;
    }
    return target instanceof type.View
      ? locked(`${endpoint.path} ${field}`)
      : null;
  });
}

export interface LintError {
  rule: string;
  message: string;
  path: string | null;
}

/** Errors the lints report that block saving; set by the lint modules. */
export const saveChecks: (() => LintError[])[] = [];

/** Saving and exporting, refused while blockSaveOnErrors and the lints report errors. */
export function saveGated(endpoint: Endpoint): Endpoint {
  return guarded(endpoint, "blocks saving on lint errors", () => {
    if (!profile().blockSaveOnErrors || !app.project.getProject()) return null;
    const errors = saveChecks.flatMap((check) => check());
    if (errors.length === 0) return null;
    return new ApiError(
      "SAVE_BLOCKED",
      `${endpoint.path}: the style profile '${profile().name}' blocks saving and exporting while the lints report errors (${errors.length}); fix them (see /uml_lint, /model_lint) or pass override: true`,
      { count: errors.length, findings: errors.slice(0, 20) },
    );
  });
}
