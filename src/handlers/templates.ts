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
import { findTemplate } from "../templates/index.js";
import { findViewpoint } from "../viewpoints/index.js";

/*
 * /describe_template (issue #43): one diagram template as an agent needs
 * it to pick content for it. Its golden exemplar is the engine's
 * yardstick and is never part of an answer.
 */

export const describeTemplate = defineEndpoint({
  path: "/describe_template",
  description:
    "One diagram template (see /list_templates): the viewpoint it draws and the question that viewpoint answers, the diagram kind, the content it takes (element and lifeline limits), its house style (the project's style profile or a built-in), its layout preset, and the parts every diagram made with it carries (title block, legend). /build_diagram {template, spec}, /derive_diagrams {template} and /request_diagram draw with it. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    name: doc(z.string().check(z.minLength(1)), "The template."),
  }),
  aliases: { template: "name" },
  response: z.object({
    template: doc(
      z.record(z.string(), z.unknown()),
      "name, version, title, description, viewpoint, kind, default, content, style, layout, parts.",
    ),
    question: doc(z.string(), "What a diagram made with it answers."),
  }),
  handle: (input) => {
    const { $schema: _, ...template } = findTemplate(input.name);
    return {
      template,
      question: findViewpoint(template.viewpoint).question,
    };
  },
});
