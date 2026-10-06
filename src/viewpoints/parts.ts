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

import { noteHeight } from "../build/spec.js";
import type { Endpoint } from "../endpoint.js";
import { batchRunner } from "../handlers/batch.js";
import { labelWidth } from "../handlers/lint.js";
import type { Element, View } from "../types.js";
import { type Mark, markOps, partViews, readMark } from "./mark.js";

/*
 * The parts a viewpoint or template requires besides the elements (issues
 * #42, #43): a title block and a legend, kept as notes below the drawing
 * so they never sit between its nodes. Their ids go into the diagram's
 * mark, so a rebuild finds them again instead of pruning them, and moves
 * them when the drawing has grown.
 */

export interface PartTexts {
  title?: string;
  legend?: string;
}

/** Space between the drawing and its parts, and between two parts. */
const GAP = 30;

/** The drawing's extent: every visible node view but the parts. */
function extent(diagram: Element, skip: ReadonlySet<View>) {
  const boxes = (diagram.ownedViews as View[])
    .filter(
      (v) => v instanceof type.NodeView && v.visible !== false && !skip.has(v),
    )
    .map((v) => ({
      left: Number(v.left),
      top: Number(v.top),
      right: Number(v.left) + Number(v.width),
      bottom: Number(v.top) + Number(v.height),
    }));
  if (boxes.length === 0) return { left: 20, bottom: 20 - GAP };
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** A note's box for `text`: as wide as its widest line, as tall as its lines. */
export function noteBox(text: string) {
  return {
    width: Math.max(140, Math.min(420, labelWidth(text))),
    height: noteHeight(text),
  };
}

type Op = { path: string; body: Record<string, unknown>; as?: string };

/**
 * Gives `diagram` the parts in `texts` and the mark `mark` with their ids,
 * as /batch ops run now: a missing part is made, one whose text or place
 * differs is changed, one no longer asked for is deleted. Answers whether
 * anything changed.
 */
export async function placeParts(
  diagram: Element,
  texts: PartTexts,
  mark: Mark,
  endpoints: () => readonly Endpoint[],
): Promise<boolean> {
  const before = readMark(diagram);
  const kept = partViews(diagram, before);
  const byPart = (part: keyof PartTexts) =>
    kept.find((v) => v._id === before?.parts?.[part]);
  const at = extent(diagram, new Set(kept));
  const ops: Op[] = [];
  const ids: Record<string, string> = {};
  let x = at.left;
  for (const part of ["title", "legend"] as const) {
    const view = byPart(part);
    const text = texts[part];
    if (text === undefined) {
      if (view) ops.push({ path: "/delete_element", body: { ref: view._id } });
      continue;
    }
    const size = noteBox(text);
    const place = {
      left: Math.round(x),
      top: Math.round(at.bottom + GAP),
      width: size.width,
      height: size.height,
    };
    x += size.width + GAP;
    if (!view) {
      const as = `part_${part}`;
      ops.push(
        {
          path: "/create_element_with_view",
          as,
          body: {
            type: "Note",
            diagram: diagram._id,
            x: place.left,
            y: place.top,
            x2: place.left + place.width,
            y2: place.top + place.height,
          },
        },
        {
          path: "/update_element",
          body: { ref: `$${as}.view`, field: "text", value: text },
        },
      );
      ids[part] = `$${as}`;
      continue;
    }
    ids[part] = view._id;
    if (String(view.text) !== text) {
      ops.push({
        path: "/update_element",
        body: { ref: view._id, field: "text", value: text },
      });
    }
    for (const [field, value] of Object.entries(place)) {
      if (Number(view[field]) !== value) {
        ops.push({
          path: "/update_element",
          body: { ref: view._id, field, value },
        });
      }
    }
  }
  let made: Map<string, string> = new Map();
  if (ops.length > 0) {
    const data = await batchRunner.run(endpoints(), ops);
    made = new Map(
      data.results.flatMap((r) =>
        r.as
          ? [[`$${r.as}`, (r.data as { view: { _id: string } }).view._id]]
          : [],
      ),
    );
  }
  const parts = Object.fromEntries(
    Object.entries(ids).map(([part, id]) => [part, made.get(id) ?? id]),
  );
  const next: Mark = {
    ...mark,
    ...(Object.keys(parts).length > 0 && { parts }),
  };
  const tagOps = markOps(diagram, next);
  if (tagOps.length > 0) await batchRunner.run(endpoints(), tagOps);
  return ops.length > 0;
}
