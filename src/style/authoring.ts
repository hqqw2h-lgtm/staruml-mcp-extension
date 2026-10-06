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
import type { Endpoint } from "../endpoint.js";
import { diagramOf } from "../create.js";
import { resolveCreateType } from "../toolbox.js";
import { modelTypeOf } from "../handlers/elements.js";
import type { View } from "../types.js";
import { oneStep } from "../undo.js";
import {
  namingKindOf,
  Renames,
  styleReport,
  styleReportSchema,
  styleViews,
} from "./apply.js";
import { isTrusted } from "./guard.js";
import { effectiveProfile } from "./profile.js";

/*
 * The single-element authoring endpoints under the style profile (issue
 * #31): /create_element_with_view and /create_edge_with_view name the new
 * element by the naming rules and give its view the profile's look, in the
 * same undo step. Inside a build the build applies the profile once for
 * the whole diagram, so its own calls pass through unchanged.
 */

type Body = Record<string, unknown>;

/** The naming rule for a create request's type. */
function kindFor(body: Body) {
  const typeName = body.type;
  if (typeof typeName !== "string") return null;
  try {
    const { id } = resolveCreateType(typeName);
    return namingKindOf(modelTypeOf(id));
  } catch {
    // An unknown type fails in the endpoint itself, with its own message.
    return null;
  }
}

export function profiled(endpoint: Endpoint): Endpoint {
  const response = z.extend(endpoint.response as z.ZodMiniObject, {
    style: z.optional(styleReportSchema()),
  });
  return {
    ...endpoint,
    response,
    handler: async (body) => {
      if (isTrusted() || !body || typeof body !== "object") {
        return endpoint.handler(body);
      }
      const given = body as Body;
      const profile = effectiveProfile().profile;
      const renames = new Renames(profile);
      const name =
        typeof given.name === "string"
          ? renames.name(given.name, kindFor(given))
          : given.name;
      return oneStep(`create ${String(given.type)}`, async () => {
        const result = await endpoint.handler(
          name === given.name ? given : { ...given, name },
        );
        if (!result.success) return result;
        const data = result.data as { view: { _id: string } };
        const view = app.repository.get(data.view._id) as View;
        const styled = styleViews(diagramOf(view)!, [view], profile);
        return {
          success: true,
          data: { ...data, style: styleReport(profile, renames, styled) },
        };
      });
    },
  };
}
