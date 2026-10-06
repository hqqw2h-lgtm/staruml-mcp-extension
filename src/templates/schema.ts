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
import { KINDS } from "../build/spec.js";
import { doc } from "../endpoint.js";
import { PRESET_NAMES } from "../handlers/views.js";
import { BUILT_IN_NAMES } from "../style/profile.js";
import { VIEWPOINT_NAMES } from "../viewpoints/schema.js";

/*
 * The shape of a diagram template (issue #43): which viewpoint it draws
 * and as what kind, what content it takes, the house style and layout it
 * is drawn with, and the parts every diagram made with it carries.
 * src/templates holds one JSON file per template; template.schema.json is
 * this schema as JSON Schema, which the files name in $schema.
 */

const text = () => z.string().check(z.minLength(1));

export const templateSchema = () =>
  z.strictObject({
    $schema: z.optional(z.string()),
    name: doc(
      z.string().check(z.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)),
      "Lower case words joined by hyphens.",
    ),
    version: doc(
      z.int().check(z.minimum(1)),
      "Raised when what the template draws changes; stored on each diagram made with it.",
    ),
    title: text(),
    description: text(),
    viewpoint: z.enum(VIEWPOINT_NAMES),
    kind: z.enum(KINDS),
    default: doc(
      z.boolean(),
      "The template /derive_diagrams and /request_diagram use for its viewpoint and kind.",
    ),
    content: doc(
      z.strictObject({
        maxElements: z.int().check(z.minimum(1), z.maximum(500)),
        maxLifelines: z.optional(z.int().check(z.minimum(1), z.maximum(100))),
        hideAccessors: z.optional(
          doc(
            z.boolean(),
            "Classes whose operations are all accessors keep them folded.",
          ),
        ),
      }),
      "What a diagram made with it may hold; /build_diagram refuses more.",
    ),
    style: doc(
      z.enum(["project", ...BUILT_IN_NAMES]),
      "The house style: project (the project's style profile) or a built-in profile, whose visuals, layout and quality settings apply while naming, rules and policy stay the project's.",
    ),
    layout: z.strictObject({ preset: z.enum(PRESET_NAMES) }),
    parts: doc(
      z.strictObject({
        titleBlock: doc(
          z.boolean(),
          "A note below the drawing naming it, its viewpoint's question and the template.",
        ),
        legend: doc(
          z.array(text()),
          "Lines of a legend note under 'Legend'; none for no legend.",
        ),
      }),
      "Notes the engine adds and keeps, below or beside the drawing.",
    ),
  });
export type Template = z.output<ReturnType<typeof templateSchema>>;
