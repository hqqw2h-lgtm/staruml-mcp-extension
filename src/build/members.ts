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

/*
 * Text forms of names and class members accepted by /build_diagram, shared by
 * the JSON spec and the Mermaid front end.
 */

/**
 * Line breaks as Mermaid and Markdown write them become real newlines, which
 * StarUML draws as separate lines of the name (upstream staruml-mcp-server
 * issue #3).
 */
export function multiline(name: string): string {
  return name
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

export type Visibility = "public" | "private" | "protected" | "package";

const VISIBILITY: Record<string, Visibility> = {
  "+": "public",
  "-": "private",
  "#": "protected",
  "~": "package",
};

export interface AttributeSpec {
  name: string;
  type?: string;
  visibility?: Visibility;
  isStatic?: boolean;
  defaultValue?: string;
  multiplicity?: string;
}

export interface ParameterSpec {
  name: string;
  type?: string;
}

export interface OperationSpec {
  name: string;
  parameters?: ParameterSpec[];
  returnType?: string;
  visibility?: Visibility;
  isStatic?: boolean;
  isAbstract?: boolean;
}

/** Mermaid classifier modifiers: a trailing $ is static, * abstract. */
function modifiers(text: string): {
  text: string;
  isStatic?: boolean;
  isAbstract?: boolean;
} {
  const last = text.at(-1);
  if (last === "$") return { text: text.slice(0, -1).trim(), isStatic: true };
  if (last === "*") return { text: text.slice(0, -1).trim(), isAbstract: true };
  return { text };
}

function visibility(text: string): { text: string; visibility?: Visibility } {
  const v = VISIBILITY[text.charAt(0)];
  return v ? { text: text.slice(1).trim(), visibility: v } : { text };
}

/** "name: Type" or Mermaid's "Type name"; a lone word is the name. */
function typedName(text: string): { name: string; type?: string } {
  const colon = text.indexOf(":");
  if (colon >= 0) {
    const type = text.slice(colon + 1).trim();
    return { name: text.slice(0, colon).trim(), ...(type && { type }) };
  }
  const space = text.lastIndexOf(" ");
  if (space < 0) return { name: text };
  return {
    name: text.slice(space + 1),
    type: text
      .slice(0, space)
      .trim()
      .replace(/~([^~]*)~/g, "<$1>"),
  };
}

/** "+total: double = 0", "-String owner", "count: int[0..*]$". */
export function parseAttribute(source: string): AttributeSpec {
  const mod = modifiers(source.trim());
  const vis = visibility(mod.text);
  let text = vis.text;
  let defaultValue: string | undefined;
  const eq = text.indexOf("=");
  if (eq >= 0) {
    defaultValue = text.slice(eq + 1).trim();
    text = text.slice(0, eq).trim();
  }
  let multiplicity: string | undefined;
  const mult = /\[([^\]]*)\]$/.exec(text);
  if (mult) {
    multiplicity = mult[1];
    text = text.slice(0, mult.index).trim();
  }
  return {
    ...typedName(text),
    ...(vis.visibility && { visibility: vis.visibility }),
    ...(mod.isStatic && { isStatic: true }),
    ...(defaultValue !== undefined && { defaultValue }),
    ...(multiplicity !== undefined && { multiplicity }),
  };
}

/** "+place(qty: int, Item item): Order", Mermaid "+deposit(amount) bool$". */
export function parseOperation(source: string): OperationSpec {
  const mod = modifiers(source.trim());
  const vis = visibility(mod.text);
  const open = vis.text.indexOf("(");
  const close = vis.text.lastIndexOf(")");
  const name = vis.text.slice(0, open).trim();
  const params = vis.text.slice(open + 1, close).trim();
  const returnType = vis.text
    .slice(close + 1)
    .replace(/^\s*:/, "")
    .trim();
  return {
    name,
    ...(params && {
      parameters: params.split(",").map((p) => typedName(p.trim())),
    }),
    ...(returnType && { returnType }),
    ...(vis.visibility && { visibility: vis.visibility }),
    ...(mod.isStatic && { isStatic: true }),
    ...(mod.isAbstract && { isAbstract: true }),
  };
}

/** A member line is an operation when it has a parameter list. */
export function isOperation(source: string): boolean {
  return /\(.*\)/.test(source);
}

const SIGIL: Record<string, string> = {
  public: "+",
  private: "-",
  protected: "#",
  package: "~",
};

/** A type held as text or as a reference to a classifier. */
export function typeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  return "";
}

interface MemberFields {
  name?: unknown;
  visibility?: unknown;
  isStatic?: unknown;
  isAbstract?: unknown;
  type?: unknown;
  multiplicity?: unknown;
  defaultValue?: unknown;
  direction?: unknown;
  parameters?: unknown;
}

const sigil = (m: MemberFields) => SIGIL[String(m.visibility)] ?? "";

/** The inverse of parseAttribute: "+total: double[0..1] = 0$". */
export function formatAttribute(a: MemberFields): string {
  const type = typeText(a.type);
  const mult = typeof a.multiplicity === "string" ? a.multiplicity : "";
  const def = typeof a.defaultValue === "string" ? a.defaultValue : "";
  return (
    `${sigil(a)}${String(a.name ?? "")}` +
    (type ? `: ${type}` : "") +
    (mult ? `[${mult}]` : "") +
    (def ? ` = ${def}` : "") +
    (a.isStatic ? "$" : "")
  );
}

/** The inverse of parseOperation: "+place(qty: int): Order*". */
export function formatOperation(o: MemberFields): string {
  const params = (
    Array.isArray(o.parameters) ? o.parameters : []
  ) as MemberFields[];
  const ret = params.find((p) => p.direction === "return");
  const args = params
    .filter((p) => p !== ret)
    .map((p) => {
      const type = typeText(p.type);
      return `${String(p.name ?? "")}${type ? `: ${type}` : ""}`;
    });
  const returns = ret ? typeText(ret.type) : "";
  return (
    `${sigil(o)}${String(o.name ?? "")}(${args.join(", ")})` +
    (returns ? `: ${returns}` : "") +
    (o.isStatic ? "$" : o.isAbstract ? "*" : "")
  );
}
