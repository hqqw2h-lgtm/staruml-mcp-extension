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
import data from "./presets.json";
import { attributeSchema } from "./schema.js";

/*
 * Element presets for /apply_preset: the properties a kind of class, and
 * its members, carry. Data like the patterns, checked on first use.
 */

const props = () =>
  z.optional(z.record(z.string(), z.union([z.string(), z.boolean()])));

export const presetSchema = () =>
  z.object({
    description: z.string(),
    appliesTo: z.array(z.enum(["UMLClass", "UMLInterface", "UMLEnumeration"])),
    element: props(),
    attributes: props(),
    operations: props(),
    ensureAttributes: z.optional(z.array(attributeSchema())),
    ensureConstructor: z.optional(
      z.object({
        visibility: z.enum(["public", "protected", "private", "package"]),
      }),
    ),
    reportSetters: z.optional(z.boolean()),
  });

export type Preset = z.output<ReturnType<typeof presetSchema>>;

let presets: Record<string, Preset> | null = null;

export function allPresets(): Record<string, Preset> {
  presets ??= z.parse(z.record(z.string(), presetSchema()), data);
  return presets;
}

export const PRESET_NAMES = Object.keys(data) as [string, ...string[]];
