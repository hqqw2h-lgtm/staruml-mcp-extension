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

/*
 * Naming conventions of the style profile (issue #31): a pattern a name
 * must match and a fixer that rewrites a name that does not. A fixed name
 * always matches its built-in pattern, so normalising twice changes nothing,
 * and no name normalises to the empty string.
 */

/** Built-in conventions by name; any other pattern is a regular expression. */
export const CONVENTIONS = {
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  UPPER_CASE: /^[A-Z][A-Z0-9_]*$/,
  snake_case: /^[a-z][a-z0-9_]*$/,
  lowercase: /^[a-z][a-z0-9.]*$/,
  /** A use case: a verb and its object in sentence case, "Place order". */
  "Verb noun": /^[A-Z][a-z0-9]*(?: [^\s]+)+$/,
} as const;
export type Convention = keyof typeof CONVENTIONS;

export const FIXES = [
  "pascal",
  "camel",
  "upperSnake",
  "snake",
  "lower",
  "sentence",
  "none",
] as const;
export type Fix = (typeof FIXES)[number];

/** The fixer that makes a name match a built-in convention. */
export const FIX_FOR: Record<Convention, Fix> = {
  PascalCase: "pascal",
  camelCase: "camel",
  UPPER_CASE: "upperSnake",
  snake_case: "snake",
  lowercase: "lower",
  "Verb noun": "sentence",
};

/** What a fixer answers for a name with no letter or digit at all. */
const FALLBACK: Record<Exclude<Fix, "none">, string> = {
  pascal: "Element",
  camel: "element",
  upperSnake: "ELEMENT",
  snake: "element",
  lower: "element",
  sentence: "Name element",
};

/**
 * The words of a name: ASCII letters and digits, split at separators and
 * at lower-to-upper case changes. Accents are dropped (Größe → Grosse is
 * not attempted; ö becomes o) because the built-in patterns are ASCII.
 */
export function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((w) => w.length > 0);
}

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
const lowerFirst = (w: string) => w[0]!.toLowerCase() + w.slice(1);
/** Patterns start with a letter; a leading digit gets one in front. */
const letterFirst = (s: string, letter: string) =>
  /^[0-9]/.test(s) ? letter + s : s;

/** `name` rewritten by `fix`; "none" answers it unchanged. */
export function applyFix(name: string, fix: Fix): string {
  if (fix === "none") return name;
  const ws = words(name);
  if (ws.length === 0) return FALLBACK[fix];
  switch (fix) {
    case "pascal":
      return letterFirst(ws.map(cap).join(""), "N");
    case "camel":
      return letterFirst(
        lowerFirst(ws[0]!) + ws.slice(1).map(cap).join(""),
        "n",
      );
    case "upperSnake":
      return letterFirst(ws.map((w) => w.toUpperCase()).join("_"), "N");
    case "snake":
      return letterFirst(ws.map((w) => w.toLowerCase()).join("_"), "n");
    case "lower":
      return letterFirst(ws.map((w) => w.toLowerCase()).join(""), "n");
    case "sentence": {
      const lowered = ws.map((w) => w.toLowerCase());
      // A sentence starts with a word; a leading number gets one in front.
      if (/^[0-9]/.test(lowered[0]!)) lowered.unshift("n");
      const [first, ...rest] = lowered;
      // One word is a verb without its object; the object is not ours to
      // invent, so the name keeps one placeholder word.
      return [cap(first!), ...(rest.length > 0 ? rest : ["element"])].join(" ");
    }
  }
}

export interface NamingRule {
  /** A built-in convention or a regular expression. */
  pattern: string;
  /** How a name off the pattern is rewritten; none reports it only. */
  fix: Fix;
}

/** The pattern a rule's text stands for; an invalid expression is refused. */
export function compilePattern(pattern: string, field: string): RegExp {
  if (Object.hasOwn(CONVENTIONS, pattern)) {
    return CONVENTIONS[pattern as Convention];
  }
  try {
    return new RegExp(pattern, "u");
  } catch (err) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${field}: ${pattern} is neither ${Object.keys(CONVENTIONS).join(", ")} nor a regular expression (${(err as Error).message})`,
    );
  }
}

export interface Normalized {
  name: string;
  /** The name broke the rule. */
  violated: boolean;
  /** The fixed name matches the rule; false leaves the name as it was. */
  fixed: boolean;
}

/**
 * A name checked against a rule and, if it breaks it, fixed. A fix that
 * still breaks a custom pattern is not applied, so the result either
 * matches the rule or is the name unchanged: normalising is idempotent.
 */
export function normalize(name: string, rule: NamingRule): Normalized {
  const re = compilePattern(rule.pattern, "pattern");
  if (re.test(name)) return { name, violated: false, fixed: false };
  const candidate = applyFix(name, rule.fix);
  if (rule.fix !== "none" && re.test(candidate)) {
    return { name: candidate, violated: true, fixed: true };
  }
  return { name, violated: true, fixed: false };
}

/**
 * Names after a rename that stay distinct: names not renamed keep theirs,
 * a renamed one that meets a taken name gets the lowest free number, in
 * order, so the same list always gives the same names and a rename never
 * takes the name of an element that kept its own.
 */
export function settle(
  names: readonly { from: string; to: string }[],
): string[] {
  const taken = new Set(names.filter((n) => n.from === n.to).map((n) => n.to));
  return names.map((n) => {
    if (n.from === n.to) return n.to;
    let name = n.to;
    for (let i = 2; taken.has(name); i++) name = `${n.to}${i}`;
    taken.add(name);
    return name;
  });
}
