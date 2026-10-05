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

import { multiline } from "./members.js";
import type { ViewStyle } from "./spec.js";

/*
 * The C4 macros Mermaid's C4 diagrams and C4-PlantUML share
 * (mermaid.js.org/syntax/c4, github.com/plantuml-stdlib/C4-PlantUML), read
 * into the c4 spec. StarUML's C4 profile (7.1.1) has people, software
 * systems, containers and components joined by relationships, but no
 * boundary element: a boundary's elements are read and the boundary is
 * reported in warnings. Deployment nodes have no StarUML counterpart and
 * are refused.
 */

export interface TextLine {
  no: number;
  text: string;
}

/** Reports a problem at a line; `syntax` names the source format. */
export type Fail = (
  no: number,
  message: string,
  code?: "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX",
) => never;

/** Positional and $named arguments of a macro call, quotes removed. */
export function macroArgs(text: string): {
  positional: string[];
  named: Record<string, string>;
} {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const raw of parts.map((p) => p.trim())) {
    const m = /^\$(\w+)\s*=\s*(.*)$/.exec(raw);
    if (m) named[m[1]!] = m[2]!;
    else positional.push(raw);
  }
  return { positional, named };
}

const ELEMENT =
  /^(Person|System|SystemDb|SystemQueue|Container|ContainerDb|ContainerQueue|Component|ComponentDb|ComponentQueue)(_Ext)?\s*\((.*)\)$/;
const BOUNDARY =
  /^(Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary)\s*\((.*)\)\s*\{?$/;
const RELATION =
  /^(Rel|BiRel|Rel_Back|Rel_Neighbor|Rel_Back_Neighbor|Rel_U|Rel_Up|Rel_D|Rel_Down|Rel_L|Rel_Left|Rel_R|Rel_Right)\s*\((.*)\)$/;
/** Layout and legend macros, which change nothing StarUML stores. */
const IGNORED =
  /^(UpdateRelStyle|UpdateLayoutConfig|UpdateBoundaryStyle|AddElementTag|AddRelTag|AddBoundaryTag|SHOW_LEGEND|SHOW_FLOATING_LEGEND|LAYOUT_\w+|HIDE_\w+|SHOW_\w+|Lay_\w+)\b/;
const DEPLOYMENT = /^(Deployment_Node|Node|Node_L|Node_R)(_L|_R)?\s*\(/;

const TYPES: Record<string, "person" | "system" | "container" | "component"> = {
  Person: "person",
  System: "system",
  Container: "container",
  Component: "component",
};

const STYLE_ARGS: Record<string, keyof ViewStyle> = {
  bgColor: "fillColor",
  borderColor: "lineColor",
  fontColor: "fontColor",
};

/**
 * Reads C4 macro lines (the header already taken) into the c4 spec. A line
 * none of the macros match is passed to `other`, which answers whether it
 * was the caller's to skip.
 */
export function readC4(
  lines: readonly TextLine[],
  fail: Fail,
  other: (text: string) => boolean,
): { spec: Record<string, unknown>; warnings: string[] } {
  const elements: Record<string, unknown>[] = [];
  const relations: Record<string, unknown>[] = [];
  const styles: Record<string, ViewStyle> = {};
  const warnings: string[] = [];
  let boundaries = 0;
  let open = 0;
  const value = (s: string | undefined) => (s ? multiline(s) : undefined);
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if ((m = ELEMENT.exec(text))) {
      const [, macro, ext, body] = m;
      const base = macro!.replace(/(Db|Queue)$/, "");
      const type = TYPES[base]!;
      const { positional: p, named } = macroArgs(body!);
      if (!p[0] || !p[1]) fail(no, `${macro} needs an alias and a label`);
      const technical = type === "container" || type === "component";
      const technology = named.techn ?? (technical ? p[2] : undefined);
      const description = named.descr ?? (technical ? p[3] : p[2]);
      elements.push({
        id: p[0],
        name: multiline(p[1]!),
        type,
        ...(type === "container" &&
          macro!.endsWith("Db") && { kind: "database" }),
        ...(value(technology) && { technology: value(technology) }),
        ...(value(description) && { description: value(description) }),
        ...(ext && { external: true }),
      });
    } else if ((m = RELATION.exec(text))) {
      const { positional: p, named } = macroArgs(m[2]!);
      if (!p[0] || !p[1]) fail(no, `${m[1]} needs two aliases`);
      const back = m[1]!.startsWith("Rel_Back");
      if (m[1] === "BiRel") {
        warnings.push(
          `line ${no}: BiRel is drawn one way, ${p[0]} to ${p[1]}; StarUML's C4 relationship is directed`,
        );
      }
      const technology = value(named.techn ?? p[3]);
      const description = value(named.descr ?? p[4]);
      relations.push({
        from: back ? p[1] : p[0],
        to: back ? p[0] : p[1],
        ...(p[2] && { label: p[2] }),
        ...(technology && { technology }),
        ...(description && { description }),
      });
    } else if ((m = BOUNDARY.exec(text))) {
      boundaries++;
      if (text.endsWith("{")) open++;
    } else if (text === "}") {
      if (open === 0) fail(no, "} without a boundary");
      open--;
    } else if ((m = /^UpdateElementStyle\s*\((.*)\)$/.exec(text))) {
      const { positional: p, named } = macroArgs(m[1]!);
      const style: ViewStyle = {};
      for (const [arg, field] of Object.entries(STYLE_ARGS)) {
        const color = named[arg];
        if (color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
          style[field] = color;
        }
      }
      if (Object.keys(style).length > 0) {
        styles[p[0]!] = { ...styles[p[0]!], ...style };
      }
    } else if (DEPLOYMENT.test(text)) {
      fail(
        no,
        "C4 deployment nodes have no StarUML 7.1.1 element",
        "UNSUPPORTED_SYNTAX",
      );
    } else if (!IGNORED.test(text) && !other(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (open > 0) fail(lines.at(-1)!.no, "a boundary is never closed with }");
  if (boundaries > 0) {
    warnings.push(
      `${boundaries} boundar${boundaries === 1 ? "y is" : "ies are"} not drawn; StarUML 7.1.1 has no C4 boundary element`,
    );
  }
  return {
    spec: {
      elements,
      relations,
      ...(Object.keys(styles).length > 0 && { styles }),
    },
    warnings,
  };
}
