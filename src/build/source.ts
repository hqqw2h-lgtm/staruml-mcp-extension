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

import { ApiError } from "../errors.js";
import { parseJsonSchema } from "./jsonschema.js";
import { type Parsed, parseMermaid } from "./mermaid.js";
import { parsePlantUml } from "./plantuml.js";
import type { Kind } from "./spec.js";
import { parseSql } from "./sql.js";

/*
 * The text formats /build_diagram reads, and which one a text is when the
 * request does not say: PlantUML starts with @start..., JSON Schema is a
 * JSON object, SQL creates tables, and anything else is taken as Mermaid.
 */

export const FORMATS = ["mermaid", "plantuml", "sql", "jsonschema"] as const;
export type Format = (typeof FORMATS)[number];

export function detectFormat(text: string): Format {
  const body = text.replace(/^\s*(?:(?:'|--|%%).*\n\s*)*/, "");
  if (/^@start\w+/im.test(text)) return "plantuml";
  if (body.startsWith("{")) return "jsonschema";
  if (/\bcreate\s+(?:\w+\s+)*?table\b/i.test(text)) return "sql";
  return "mermaid";
}

/** Reads `text` in `format` (detected when omitted) into a kind and spec. */
export function parseSource(
  text: string,
  format: Format = detectFormat(text),
  kind?: Kind,
): Parsed & { format: Format } {
  switch (format) {
    case "plantuml":
      return { ...parsePlantUml(text, kind), format };
    case "sql":
      if (kind !== undefined && kind !== "erd") {
        throw new ApiError(
          "UNSUPPORTED_SYNTAX",
          `sql: DDL is read as an ERD, not ${kind}`,
        );
      }
      return { ...parseSql(text), format };
    case "jsonschema":
      return { ...parseJsonSchema(text, kind), format };
    default:
      return { ...parseMermaid(text, kind), format };
  }
}
