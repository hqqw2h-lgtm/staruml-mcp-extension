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
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { requireDiagram } from "../lookup.js";
import { pathOf } from "../refs.js";
import { ref } from "../schemas.js";
import data from "../themes.json";
import type { Element, View } from "../types.js";
import { batchRunner } from "./batch.js";
import { planOf, planSchema } from "./build.js";
import { MODEL_MAX_OPS } from "./model.js";

/*
 * /apply_theme (issue #24): a diagram's views coloured by a preset, through
 * /set_view_style, one op per colour set, run as one batch so the theme is
 * one undo step.
 */

const colour = () => z.string().check(z.regex(/^#[0-9a-f]{6}$/i));
const style = () =>
  z.object({
    fillColor: z.optional(colour()),
    lineColor: colour(),
    fontColor: colour(),
  });

const themeSchema = () =>
  z.object({
    description: z.string(),
    groupBy: z.optional(z.enum(["stereotype", "package"])),
    nodes: z.record(z.string(), style()),
    edges: z.optional(style()),
    palette: z.optional(z.array(style()).check(z.minLength(1))),
  });

type Theme = z.output<ReturnType<typeof themeSchema>>;
type Style = z.output<ReturnType<typeof style>>;

let themes: Record<string, Theme> | null = null;

export function allThemes(): Record<string, Theme> {
  themes ??= z.parse(z.record(z.string(), themeSchema()), data);
  return themes;
}

const THEME_NAMES = Object.keys(data) as [string, ...string[]];

/** The stereotype or owning package a node is grouped by, if any. */
function groupOf(view: View, by: "stereotype" | "package"): string | null {
  const model = view.model;
  if (!model) return null;
  if (by === "package") {
    const owner = model._parent as Element;
    return owner instanceof type.UMLPackage ? pathOf(owner)! : null;
  }
  const st = model.stereotype;
  if (typeof st === "string") return st || null;
  return st && typeof st === "object" ? String((st as Element).name) : null;
}

/** The node style for a view: its kind's, else the theme's default. */
function nodeStyle(
  theme: Theme,
  view: View,
  groups: Map<string, number>,
): Style {
  if (theme.groupBy && theme.palette) {
    const key = groupOf(view, theme.groupBy);
    if (key !== null) {
      if (!groups.has(key)) groups.set(key, groups.size);
      return theme.palette[groups.get(key)! % theme.palette.length]!;
    }
  }
  // A node view showing no model is a note or a text box.
  const kind = view.model?.constructor.name ?? "UMLNote";
  return theme.nodes[kind] ?? theme.nodes["*"]!;
}

export function applyThemeEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/apply_theme",
    description:
      "Colour a diagram's views by a theme preset through /set_view_style, as one undo step: monochrome, blueprint, by-stereotype (one colour per stereotype), by-package (one per owning package). Answers the colour sets applied and how many views each took; dryRun answers the ops without changing anything.",
    readOnly: false,
    destructive: false,
    request: z.object({
      ref: ref("Diagram."),
      theme: doc(
        z.enum(THEME_NAMES),
        "monochrome, blueprint, by-stereotype or by-package.",
      ),
      dryRun: z.optional(z.boolean()),
    }),
    aliases: { diagram: "ref" },
    response: z.object({
      diagram: z.string(),
      theme: z.string(),
      description: z.string(),
      styles: z.array(
        z.object({
          fillColor: z.optional(z.string()),
          lineColor: z.string(),
          fontColor: z.string(),
          views: doc(z.int(), "Views given this style."),
          group: z.optional(
            doc(z.string(), "The stereotype or package it stands for."),
          ),
        }),
      ),
      dryRun: z.optional(z.boolean()),
      plan: z.optional(planSchema()),
    }),
    handle: async (input) => {
      const diagram = requireDiagram(input.ref);
      const theme = allThemes()[input.theme]!;
      const groups = new Map<string, number>();
      const sets = new Map<
        string,
        { style: Style; views: string[]; group?: string }
      >();
      const add = (s: Style, view: View, group?: string) => {
        const key = JSON.stringify(s);
        const known = sets.get(key);
        if (known) known.views.push(view._id);
        else
          sets.set(key, {
            style: s,
            views: [view._id],
            ...(group !== undefined && { group }),
          });
      };
      for (const view of diagram.ownedViews as View[]) {
        if (view.model instanceof type.Diagram) continue;
        if (view instanceof type.EdgeView) {
          if (theme.edges) add(theme.edges, view);
        } else {
          const group = theme.groupBy ? groupOf(view, theme.groupBy) : null;
          add(nodeStyle(theme, view, groups), view, group ?? undefined);
        }
      }
      const ops = [...sets.values()].map(({ style, views }) => ({
        path: "/set_view_style",
        body: { refs: views, ...style },
      }));
      const answer = {
        diagram: diagram._id,
        theme: input.theme,
        description: theme.description,
        styles: [...sets.values()].map(({ style, views, group }) => ({
          ...style,
          views: views.length,
          ...(group !== undefined && { group }),
        })),
      };
      if (input.dryRun) return { ...answer, dryRun: true, plan: planOf(ops) };
      if (ops.length > 0)
        await batchRunner.run(endpoints(), ops, true, MODEL_MAX_OPS);
      return answer;
    },
  });
}
