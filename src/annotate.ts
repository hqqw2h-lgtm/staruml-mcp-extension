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

import { graphics, type Rect } from "./app-modules.js";
import { edgeViews, nodeViews } from "./handlers/describe.js";
import { escapeName, pathOf, resolveRef } from "./refs.js";
import type { Element, View } from "./types.js";

/*
 * Labels drawn over an exported image (issue #24): each view's element id
 * or shortest path, at the view's top-left corner (an edge's: its middle),
 * so an agent can name what it sees. They are painted on the image, never
 * added to the model.
 */

export const ANNOTATE = ["none", "ids", "paths"] as const;
export type Annotate = (typeof ANNOTATE)[number];

/** A label in image pixels. */
export interface Label {
  text: string;
  /** The element's id. */
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** BOUNDING_BOX_EXPAND in engine/diagram-export.js (7.1.1): the margin around the diagram. */
const MARGIN = 10;
/** Label font size and colours, at one pixel per diagram unit. */
export const LABEL = {
  font: 10,
  padding: 2,
  height: 13,
  fill: "#ffe066",
  line: "#8a6d00",
  text: "#000000",
};

/**
 * The shortest trailing part of an element's path that names it alone,
 * else its full path; its id when it has no name to write.
 */
export function alias(model: Element): string {
  const full = pathOf(model);
  if (!full || !model.name) return model._id;
  let suffix = escapeName(model.name);
  for (let e: Element | null | undefined = model; ;) {
    try {
      if (resolveRef(suffix) === model) return suffix;
    } catch {
      // AMBIGUOUS_REF: several elements end so; a longer suffix may not.
    }
    e = e!._parent;
    if (!e?._parent) return full;
    suffix = `${escapeName(String(e.name))}/${suffix}`;
  }
}

/**
 * The labels of a diagram's views in image pixels at `scale`, with the
 * offset of the diagram's origin; later labels move down off earlier ones.
 */
export function labelsFor(
  diagram: Element,
  mode: Exclude<Annotate, "none">,
  scale: number,
): Label[] {
  const element = document.createElement("canvas");
  const context = element.getContext("2d") as unknown as Context2D;
  const canvas = new (graphics().Canvas)(context);
  // Views measuring themselves set the context's font, so it is set again.
  const measure = (text: string) => {
    context.font = `${LABEL.font}px sans-serif`;
    return context.measureText(text).width;
  };
  const box = (v: Element) =>
    (v as unknown as { getBoundingBox(c: unknown): Rect }).getBoundingBox(
      canvas,
    );
  const bounds = (
    diagram as unknown as { getBoundingBoxWithChildren(c: unknown): Rect }
  ).getBoundingBoxWithChildren(canvas);
  const left = bounds.x1 - MARGIN;
  const top = bounds.y1 - MARGIN;
  const placed: Label[] = [];
  const views: [View, boolean][] = [
    ...nodeViews(diagram).map((v) => [v, false] as [View, boolean]),
    ...edgeViews(diagram).map((v) => [v, true] as [View, boolean]),
  ];
  for (const [view, edge] of views) {
    const model = view.model!;
    const text = mode === "ids" ? model._id : alias(model);
    const r = box(view);
    const label: Label = {
      text,
      ref: model._id,
      x: Math.round(((edge ? (r.x1 + r.x2) / 2 : r.x1) - left) * scale),
      y: Math.round(((edge ? (r.y1 + r.y2) / 2 : r.y1) - top) * scale),
      width: Math.ceil((measure(text) + 2 * LABEL.padding) * scale),
      height: Math.ceil(LABEL.height * scale),
    };
    while (placed.some((p) => overlaps(p, label))) label.y += label.height + 1;
    placed.push(label);
  }
  return placed;
}

const overlaps = (a: Label, b: Label) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** The subset of CanvasRenderingContext2D the labels are painted with. */
export interface Context2D {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/** Paints `labels` on a raster at `scale`. */
export function paint(
  context: Context2D,
  labels: readonly Label[],
  scale: number,
): void {
  context.font = `${LABEL.font * scale}px sans-serif`;
  context.lineWidth = Math.max(1, scale);
  for (const l of labels) {
    context.fillStyle = LABEL.fill;
    context.fillRect(l.x, l.y, l.width, l.height);
    context.strokeStyle = LABEL.line;
    context.strokeRect(l.x, l.y, l.width, l.height);
    context.fillStyle = LABEL.text;
    context.fillText(
      l.text,
      l.x + LABEL.padding * scale,
      l.y + (LABEL.height - 3) * scale,
    );
  }
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** The labels as SVG drawn last, so above the diagram. */
export function svgLabels(svg: string, labels: readonly Label[]): string {
  const marks = labels
    .map(
      (l) =>
        `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" fill="${LABEL.fill}" stroke="${LABEL.line}"/>` +
        `<text x="${l.x + LABEL.padding}" y="${l.y + LABEL.height - 3}" font-family="sans-serif" font-size="${LABEL.font}" fill="${LABEL.text}">${xml(l.text)}</text>`,
    )
    .join("");
  return svg.replace(
    /<\/svg>\s*$/,
    `<g class="annotations">${marks}</g></svg>`,
  );
}
