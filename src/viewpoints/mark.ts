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

import type { Element, View } from "../types.js";

/*
 * What a diagram declares about itself (issues #42, #43), kept in one
 * hidden Tag on the diagram so it travels with the .mdj: its viewpoint,
 * the template it was made with, whether /derive_diagrams owns it, and
 * the note views the engine added as its required parts.
 */

export const MARK_TAG = "mcp.viewpoint";

export interface Mark {
  viewpoint: string;
  template?: string;
  version?: number;
  /** Drawn by /derive_diagrams or /request_diagram; direct edits are refused. */
  derived?: boolean;
  /** Ids of the note views the engine keeps as the diagram's parts. */
  parts?: { title?: string; legend?: string };
}

const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

export const markTag = (diagram: Element): Element | null =>
  list(diagram.tags).find((t) => t.name === MARK_TAG) ?? null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The diagram's mark: the tag's JSON, or its text as a bare viewpoint name
 * (a tag typed by hand); null when it has none or the JSON says nothing
 * usable.
 */
export function readMark(diagram: Element): Mark | null {
  const tag = markTag(diagram);
  if (!tag) return null;
  const text = String(tag.value ?? "").trim();
  if (!text.startsWith("{")) return text ? { viewpoint: text } : null;
  // Text opening with a brace parses to an object or not at all.
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof value.viewpoint !== "string") return null;
  const parts = isObject(value.parts) ? value.parts : {};
  const id = (v: unknown) => (typeof v === "string" ? v : undefined);
  const title = id(parts.title);
  const legend = id(parts.legend);
  return {
    viewpoint: value.viewpoint,
    ...(typeof value.template === "string" && { template: value.template }),
    ...(typeof value.version === "number" && { version: value.version }),
    ...(value.derived === true && { derived: true }),
    ...((title !== undefined || legend !== undefined) && {
      parts: {
        ...(title !== undefined && { title }),
        ...(legend !== undefined && { legend }),
      },
    }),
  };
}

/** The mark as the tag stores it: fields in a fixed order, so equal marks are equal text. */
export function writeMark(mark: Mark): string {
  return JSON.stringify({
    viewpoint: mark.viewpoint,
    ...(mark.template !== undefined && { template: mark.template }),
    ...(mark.version !== undefined && { version: mark.version }),
    ...(mark.derived && { derived: true }),
    ...(mark.parts &&
      Object.keys(mark.parts).length > 0 && {
        parts: {
          ...(mark.parts.title !== undefined && { title: mark.parts.title }),
          ...(mark.parts.legend !== undefined && {
            legend: mark.parts.legend,
          }),
        },
      }),
  });
}

/** The /batch op that stores `mark` on `diagram` (an id or "$name"), if it changes anything. */
export function markOps(
  diagram: Element | string,
  mark: Mark,
): { path: string; body: Record<string, unknown> }[] {
  const value = writeMark(mark);
  const tag = typeof diagram === "string" ? null : markTag(diagram);
  if (tag) {
    return String(tag.value) === value
      ? []
      : [
          {
            path: "/update_element",
            body: { ref: tag._id, field: "value", value },
          },
        ];
  }
  return [
    {
      path: "/add_tag",
      body: {
        ref: typeof diagram === "string" ? diagram : diagram._id,
        name: MARK_TAG,
        kind: "string",
        value,
        hidden: true,
      },
    },
  ];
}

/** The note views a mark names that are still on the diagram. */
export function partViews(diagram: Element, mark: Mark | null): View[] {
  const ids = Object.values(mark?.parts ?? {});
  return (diagram.ownedViews as View[]).filter((v) => ids.includes(v._id));
}
