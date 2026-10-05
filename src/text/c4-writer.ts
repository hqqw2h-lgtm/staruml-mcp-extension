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

import type { C4Spec } from "./model.js";

/*
 * C4 elements and relationships as the macros Mermaid's C4 diagrams and
 * C4-PlantUML share (mermaid.js.org/syntax/c4,
 * github.com/plantuml-stdlib/C4-PlantUML): Person(alias, label, descr),
 * Container(alias, label, techn, descr), Rel(from, to, label, techn,
 * descr), with _Ext for external elements and Db for database containers.
 */

/** The deepest C4 level the elements need: Context, Container or Component. */
export function c4Level(spec: C4Spec): "Context" | "Container" | "Component" {
  if (spec.elements.some((e) => e.type === "component")) return "Component";
  if (spec.elements.some((e) => e.type === "container")) return "Container";
  return "Context";
}

const MACROS = {
  person: "Person",
  system: "System",
  container: "Container",
  component: "Component",
} as const;

/** A macro call, with trailing empty arguments left out. */
function call(name: string, alias: string[], args: string[]): string {
  while (args.length > 0 && args.at(-1) === "") args.pop();
  const quoted = args.map(
    (a) => `"${a.replace(/"/g, "'").replace(/\r?\n/g, " ")}"`,
  );
  return `${name}(${[...alias, ...quoted].join(", ")})`;
}

export function c4Macros(spec: C4Spec): string[] {
  const lines = spec.elements.map((e) => {
    const db = e.kind === "database" && e.type !== "person" ? "Db" : "";
    const name = `${MACROS[e.type]}${db}${e.external ? "_Ext" : ""}`;
    const technology =
      e.type === "container" || e.type === "component" ? [e.technology] : [];
    return call(name, [e.id], [e.name, ...technology, e.description]);
  });
  for (const r of spec.relations) {
    lines.push(
      call("Rel", [r.from, r.to], [r.label, r.technology, r.description]),
    );
  }
  return lines;
}
