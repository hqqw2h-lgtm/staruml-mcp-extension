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
import { diagramOf } from "../create.js";
import { doc, type Endpoint } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { pathOf, tryResolve } from "../refs.js";
import { isTrusted } from "../style/guard.js";
import { profile } from "../style/profile.js";
import type { Element } from "../types.js";
import { readMark } from "../viewpoints/mark.js";

/*
 * Derived diagrams are the engine's (issue #43): what they show follows
 * the model, so an edit made on the diagram itself (a view moved, added,
 * restyled or deleted, the diagram renamed or retagged) is refused with
 * DIAGRAM_DERIVED. The model stays editable; deriving again redraws. Calls
 * the extension makes for itself (a derivation, the quality loop) are
 * trusted; outside a strict profile override: true lets an edit through.
 */

/** Request fields that name the views, diagrams or tags a call acts on, with their aliases. */
const REF_FIELDS = [
  "ref",
  "refs",
  "id",
  "ids",
  "elementId",
  "diagram",
  "diagramId",
  "container",
  "containerViewId",
  "tail",
  "head",
  "tailViewId",
  "headViewId",
  "tailId",
  "headId",
] as const;

/** Fields naming the diagram itself; without them some calls act on the current one. */
const DIAGRAM_FIELDS = ["diagram", "diagramId", "id"];

type Body = Record<string, unknown>;

/** Every string a ref field of `body` holds. */
function refsIn(body: Body): string[] {
  return REF_FIELDS.flatMap((f) => {
    const v = body[f];
    if (typeof v === "string") return [v];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  });
}

/** The derived diagram an element belongs to: a view's, the diagram, or its tag's. */
export function derivedDiagramOf(elem: Element): Element | null {
  const diagram =
    elem instanceof type.View
      ? diagramOf(elem)
      : elem instanceof type.Diagram
        ? elem
        : elem instanceof type.Tag && elem._parent instanceof type.Diagram
          ? elem._parent
          : null;
  return diagram && readMark(diagram)?.derived ? diagram : null;
}

/** The DIAGRAM_DERIVED refusal for a call on `diagram`. */
export function derivedRefusal(path: string, diagram: Element): ApiError {
  const mark = readMark(diagram)!;
  const strict = profile().strict;
  return new ApiError(
    "DIAGRAM_DERIVED",
    `${path}: ${pathOf(diagram)!} is derived from the model${mark.template ? ` with the template ${mark.template}` : ""}; change the model and derive it again (/derive_diagrams or /request_diagram)${strict ? "" : ", or pass override: true"}`,
    {
      diagram: diagram._id,
      path: pathOf(diagram),
      ...(mark.template !== undefined && { template: mark.template }),
    },
  );
}

/** Whether an override is honoured: given, and the profile is not strict. */
export const overridden = (override: unknown): boolean =>
  override === true && !profile().strict;

export interface LockOptions {
  /** With no diagram named the call acts on the current one (layout, routing). */
  current?: boolean;
  /** Deleting the diagram itself is allowed: deriving again makes it anew. */
  deletes?: boolean;
}

/** `endpoint`, refused on a derived diagram's views, the diagram and its tags. */
export function derivedLocked(
  endpoint: Endpoint,
  options: LockOptions = {},
): Endpoint {
  const shape = (endpoint.request as z.ZodMiniObject).shape;
  const takesOverride = Object.hasOwn(shape, "override");
  const request = takesOverride
    ? endpoint.request
    : z.extend(endpoint.request as z.ZodMiniObject, {
        override: z.optional(
          doc(
            z.boolean(),
            "Edit a diagram derived from the model anyway; refused under a strict profile.",
          ),
        ),
      });
  const refuses = (body: Body): ApiError | null => {
    if (overridden(body.override)) return null;
    const targets: Element[] = refsIn(body).flatMap((r) => {
      try {
        const e = tryResolve(r);
        return e ? [e] : [];
      } catch {
        // An ambiguous ref fails in the endpoint itself, with its candidates.
        return [];
      }
    });
    if (options.current && !DIAGRAM_FIELDS.some((f) => body[f] !== undefined)) {
      const current = app.diagrams.getCurrentDiagram();
      if (current) targets.push(current);
    }
    for (const t of targets) {
      if (options.deletes && t instanceof type.Diagram) continue;
      const derived = derivedDiagramOf(t);
      if (derived) return derivedRefusal(endpoint.path, derived);
    }
    return null;
  };
  return {
    ...endpoint,
    request,
    handler: async (body) => {
      const given =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Body)
          : {};
      if (!isTrusted()) {
        const refusal = refuses(given);
        if (refusal) return refusal.toBody();
      }
      if (takesOverride || body !== given) return endpoint.handler(body);
      const { override: _, ...rest } = given;
      return endpoint.handler(rest);
    },
  };
}
