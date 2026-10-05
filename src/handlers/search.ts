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
import { lineage, relationshipKind } from "../metamodel.js";
import { COMMANDS } from "./commands.js";

/*
 * /search_types answers "which type do I pass?" without the full /introspect
 * catalogue. Every entry is derived from what the running app registered:
 * the metamodel (`meta`), the factory's ids, the toolbox palette and the
 * command catalogue. Descriptions are generated from that metadata, so an
 * extension's types are found the same way as the core's.
 */

export const CATEGORIES = [
  "diagram",
  "palette",
  "relationship",
  "model",
  "enum",
  "command",
] as const;
type Category = (typeof CATEGORIES)[number];

interface Example {
  path: string;
  body: Record<string, unknown>;
}

export interface TypeEntry {
  id: string;
  category: Category;
  title?: string;
  description: string;
  example?: Example;
}

const nodeExample = (type: string): Example => ({
  path: "/create_element_with_view",
  body: { type, diagram: "<diagram>", name: "<name>", x: 100, y: 100 },
});

const edgeExample = (type: string): Example => ({
  path: "/create_relationship",
  body: {
    type,
    tail: "<source>",
    head: "<target>",
    diagram: "<diagram>",
  },
});

/** "UMLClass < UMLClassifier < UMLPackageableElement" up to three ancestors. */
function ancestry(name: string): string {
  const supers = lineage(name).slice(1, 4);
  return supers.length > 0 ? `kind of ${supers.join(" < ")}` : "root type";
}

function ownAttributes(name: string): string {
  const attrs = (meta[name]!.attributes ?? [])
    .filter((a) => !a.transient)
    .map((a) => a.name);
  if (attrs.length === 0) return "";
  const shown = attrs.slice(0, 6).join(", ");
  return `; own attributes: ${shown}${attrs.length > 6 ? ", ..." : ""}`;
}

function relationshipText(model: string): string {
  return relationshipKind(model) === "directed"
    ? "directed relationship (source -> target)"
    : "undirected relationship (end1 -- end2)";
}

const article = (text: string) => (/^[aeiou]/.test(text) ? "an" : "a");

/** Diagram type names of each palette group, from the toolbox. */
function groupDiagrams(groupId: string): string {
  const group = app.toolbox.groups[groupId];
  if (!group) return "";
  const diagrams = group.diagramTypes?.map((t) => t.name);
  return ` in "${group.title}"${diagrams ? ` (${diagrams.join(", ")})` : ""}`;
}

function modelTypeOfId(id: string): string | null {
  const candidate = app.factory.modelAndViewOptions[id]?.modelType ?? id;
  return meta[candidate]?.kind === "class" ? candidate : null;
}

function corpus(): TypeEntry[] {
  const entries: TypeEntry[] = [];
  const diagramIds = new Set(app.factory.getDiagramIds());
  const modelAndView = app.factory.getModelAndViewIds();
  const modelIds = new Set(app.factory.getModelIds());
  const palette = new Set<string>();

  for (const item of Object.values(app.toolbox.items)) {
    palette.add(item.id);
    const arg = item.commandArg ?? {};
    const creates = typeof arg.id === "string" ? arg.id : item.id;
    const model = modelTypeOfId(creates);
    const edge = item.rubberband === "line";
    const custom =
      item.command !== undefined &&
      item.command !== "factory:create-model-and-view";
    const preset = Object.entries(arg)
      .filter(([k, v]) => k !== "id" && typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`);
    entries.push({
      id: item.id,
      // A palette edge is what /create_relationship takes.
      category: edge ? "relationship" : "palette",
      title: item.title,
      description:
        `Palette ${edge ? "edge" : "node"} "${item.title}"${groupDiagrams(item.groupId)}` +
        (custom
          ? `; runs ${item.command}`
          : `; creates ${model ?? creates}${preset.length > 0 ? ` with ${preset.join(", ")}` : ""}`) +
        (model && relationshipKind(model)
          ? `, ${article(relationshipText(model))} ${relationshipText(model)}`
          : ""),
      ...(!custom && {
        example: edge ? edgeExample(item.id) : nodeExample(item.id),
      }),
    });
  }

  for (const id of modelAndView) {
    if (palette.has(id)) continue;
    const model = modelTypeOfId(id);
    if (!model || !relationshipKind(model)) continue;
    entries.push({
      id,
      category: "relationship",
      description: `${relationshipText(model)}${model === id ? "" : ` creating ${model}`}, ${ancestry(model)}`,
      example: edgeExample(id),
    });
  }

  for (const name of Object.keys(meta).sort()) {
    const metaType = meta[name]!;
    if (metaType.kind === "enum") {
      entries.push({
        id: name,
        category: "enum",
        description: `Enumeration: ${(metaType.literals ?? []).join(" | ")}`,
      });
      continue;
    }
    if (app.metamodels.isKindOf(name, "View")) continue;
    if (diagramIds.has(name)) {
      entries.push({
        id: name,
        category: "diagram",
        description: `Diagram, ${ancestry(name)}; holds ${app.metamodels.getAvailableViewTypes(name).length} view types`,
        example: {
          path: "/create_diagram",
          body: { type: name, parent: "<owner>", name: "<name>" },
        },
      });
      continue;
    }
    if (app.metamodels.isKindOf(name, "Diagram")) continue;
    const ways = [
      modelAndView.includes(name) && "with a view",
      modelIds.has(name) && "as a model",
    ].filter(Boolean);
    entries.push({
      id: name,
      category: "model",
      description: `Model element, ${ancestry(name)}${ownAttributes(name)}${ways.length > 0 ? `; creatable ${ways.join(" or ")}` : "; not creatable directly"}`,
      example: modelAndView.includes(name)
        ? relationshipKind(name)
          ? edgeExample(name)
          : nodeExample(name)
        : modelIds.has(name)
          ? {
              path: "/create_element",
              body: { type: name, parent: "<owner>", name: "<name>" },
            }
          : { path: "/find_elements", body: { type: name } },
    });
  }

  for (const [id, info] of Object.entries(COMMANDS)) {
    entries.push({
      id,
      category: "command",
      description: `Command: ${info.effect}${info.dialog === "never" ? "" : ` (dialog: ${info.dialog})`}`,
      example: {
        path: "/execute_command",
        body: {
          id,
          ...(info.args.length > 0 && {
            args: info.args
              .filter((a) => !a.optional)
              .map((a) => `<${a.name}: ${a.type}>`),
          }),
        },
      },
    });
  }
  return entries;
}

let cache: { key: unknown[]; entries: TypeEntry[] } | null = null;

/**
 * The corpus is rebuilt when the app's registries are replaced; they are
 * filled once while extensions load and do not change afterwards.
 */
export function typeCorpus(): TypeEntry[] {
  const key = [meta, app.toolbox.items, app.factory];
  if (!cache || cache.key.some((k, i) => k !== key[i])) {
    cache = { key, entries: corpus() };
  }
  return cache.entries;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Characters of `q` in order in `s`; fewer gaps score higher, 0 if absent. */
function subsequence(q: string, s: string): number {
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = s.indexOf(ch, at + 1);
    if (next < 0) return 0;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return Math.max(1, 100 - gaps);
}

/**
 * Ranks an entry: the id matched as a whole beats a prefix, a prefix beats
 * a substring, then every query word found in id, title or description,
 * then the query's letters in order in the id ("clsdgm" finds
 * UMLClassDiagram).
 */
export function scoreEntry(entry: TypeEntry, query: string): number {
  const q = squash(query);
  const id = squash(entry.id);
  const title = squash(entry.title ?? "");
  if (!q) return 0;
  if (id === q || title === q) return 1000;
  if (id.startsWith(q)) return 900 - (id.length - q.length);
  if (id.includes(q) || title.includes(q)) return 800 - (id.length - q.length);
  // q is not empty, so the query has at least one word.
  const words = query.toLowerCase().match(/[a-z0-9]+/g)!;
  const hay =
    `${entry.id} ${entry.title ?? ""} ${entry.description}`.toLowerCase();
  const found = words.filter((w) => hay.includes(w)).length;
  if (found === words.length) return 500 + found;
  const fuzzy = subsequence(q, id);
  return fuzzy > 0 ? 200 + fuzzy : 0;
}

export const searchTypes = defineEndpoint({
  path: "/search_types",
  description:
    "Find the type, palette item, relationship or command id to use, by a fuzzy query ('composition', 'state machine', 'erd entity', 'align'). Each hit has a one-line description and a minimal example request.",
  readOnly: true,
  destructive: false,
  request: z.object({
    query: doc(
      z.string().check(z.minLength(1)),
      "Words or part of an id; case and punctuation are ignored.",
    ),
    limit: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(50)),
        "Most hits to return; default 10.",
      ),
    ),
    categories: z.optional(
      doc(
        z.array(z.enum(CATEGORIES)),
        "Only these categories: diagram, palette, relationship, model, enum, command.",
      ),
    ),
  }),
  response: z.object({
    query: z.string(),
    total: doc(z.int(), "Entries that matched, before the limit."),
    results: z.array(
      z.object({
        id: z.string(),
        category: z.enum(CATEGORIES),
        title: z.optional(z.string()),
        description: z.string(),
        example: z.optional(
          doc(
            z.object({
              path: z.string(),
              body: z.record(z.string(), z.unknown()),
            }),
            "A minimal request; replace the <placeholders>.",
          ),
        ),
        score: z.number(),
      }),
    ),
  }),
  handle: (input) => {
    const only = input.categories && new Set(input.categories);
    const order = (c: Category) => CATEGORIES.indexOf(c);
    const hits = typeCorpus()
      .filter((e) => !only || only.has(e.category))
      .map((e) => ({ ...e, score: scoreEntry(e, input.query) }))
      .filter((e) => e.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          order(a.category) - order(b.category) ||
          a.id.localeCompare(b.id),
      );
    return {
      query: input.query,
      total: hits.length,
      results: hits.slice(0, input.limit ?? 10),
    };
  },
});
