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

import type { Kind } from "../build/spec.js";
import { viewpointCatalogue } from "./index.js";
import type {
  Audience,
  DecisionRule,
  DecisionTable,
  ScopeKind,
  Viewpoint,
  ViewpointName,
} from "./schema.js";

/*
 * Picks the viewpoint and diagram kind for a stated intent (issue #42),
 * by the committed decision table alone: every phrase of a rule found in
 * the intent scores its word count (a weak one a quarter, so "how does"
 * never outweighs a word that names a view), the best-scoring
 * rule drawn for the scope wins, the earlier rule on a tie. It is a total
 * function of its input: it never throws, and the same intent, audience
 * and scope always give the same answer. A request it cannot serve is
 * refused with the views it can serve instead.
 */

export interface DecisionInput {
  intent: string;
  audience?: Audience;
  scope: ScopeKind;
}

export interface Alternative {
  viewpoint: ViewpointName;
  kind: Kind;
  rule: string;
  /** Scope kinds that view is drawn for. */
  scopes: ScopeKind[];
  why: string;
}

export type Decision =
  | {
      ok: true;
      rule: string;
      viewpoint: ViewpointName;
      kind: Kind;
      reason: string;
      /** The table's phrases found in the intent, strongest rule's only. */
      matched: string[];
    }
  | {
      ok: false;
      /** unclear: no phrase matched; scope: not drawn for this scope; audience: not written for it. */
      problem: "unclear" | "scope" | "audience";
      reason: string;
      /** The rule the intent asked for, where it named one. */
      wanted?: { viewpoint: ViewpointName; kind: Kind; rule: string };
      alternatives: Alternative[];
    };

/** Lower case ASCII words separated by single spaces. */
export function normalizeIntent(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const wordCount = (phrase: string) => phrase.split(" ").length;

/**
 * Whether `phrase` (normalised) occurs in `intent` as whole words. Plurals
 * are phrases of their own in the table, so a word is never counted twice.
 */
const occurs = (intent: string, phrase: string): boolean =>
  phrase !== "" && ` ${intent} `.includes(` ${phrase} `);

interface Scored {
  rule: DecisionRule;
  index: number;
  score: number;
  matched: string[];
}

function score(rule: DecisionRule, index: number, intent: string): Scored {
  let total = 0;
  const matched: string[] = [];
  for (const [list, weight] of [
    [rule.phrases, 1],
    [rule.weak ?? [], 0.25],
  ] as const) {
    for (const phrase of list) {
      const p = normalizeIntent(phrase);
      if (!occurs(intent, p)) continue;
      total += wordCount(p) * weight;
      matched.push(phrase);
    }
  }
  return { rule, index, score: total, matched };
}

const article = (word: string) =>
  `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;

const fits = (rule: DecisionRule, scope: ScopeKind) =>
  (rule.scopes as string[]).includes(scope);

const alternative = (rule: DecisionRule, why: string): Alternative => ({
  viewpoint: rule.viewpoint,
  kind: rule.kind,
  rule: rule.id,
  scopes: [...rule.scopes],
  why,
});

/** One alternative per viewpoint and kind, first come first kept. */
function distinct(list: Alternative[]): Alternative[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = `${a.viewpoint}|${a.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The table's decision for `input`; see the module comment. */
export function decide(
  input: DecisionInput,
  table: DecisionTable = viewpointCatalogue().table,
  byName: ReadonlyMap<ViewpointName, Viewpoint> = viewpointCatalogue().byName,
): Decision {
  const intent = normalizeIntent(input.intent);
  const scored = table.rules
    .map((r, i) => score(r, i, intent))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const forScope = table.rules.filter((r) => fits(r, input.scope));
  const question = (r: DecisionRule) => byName.get(r.viewpoint)!.question;
  let chosen: Scored | undefined;
  if (scored.length === 0) {
    const fallback = table.rules.find(
      (r) => r.id === table.defaults[input.scope],
    );
    if (!fallback) {
      return {
        ok: false,
        problem: "unclear",
        reason: `the intent names no view the table knows; say what the diagram should answer, e.g. one of these questions`,
        alternatives: distinct(
          (forScope.length > 0 ? forScope : table.rules).map((r) =>
            alternative(r, question(r)),
          ),
        ),
      };
    }
    chosen = { rule: fallback, index: -1, score: 0, matched: [] };
  } else {
    const best = scored[0]!;
    const fitting = scored.filter((s) => fits(s.rule, input.scope));
    if (
      fitting.length === 0 ||
      (!fits(best.rule, input.scope) && best.score > fitting[0]!.score)
    ) {
      return {
        ok: false,
        problem: "scope",
        reason: `a ${byName.get(best.rule.viewpoint)!.title.toLowerCase()} view (${best.rule.kind}) is drawn for a ${best.rule.scopes.join(", ")} scope, not ${article(input.scope)}`,
        wanted: {
          viewpoint: best.rule.viewpoint,
          kind: best.rule.kind,
          rule: best.rule.id,
        },
        alternatives: distinct([
          alternative(
            best.rule,
            `the same view, for a ${best.rule.scopes.join(" or ")} scope`,
          ),
          ...[...fitting.map((s) => s.rule), ...forScope].map((r) =>
            alternative(r, `drawn for ${article(input.scope)}: ${question(r)}`),
          ),
        ]),
      };
    }
    chosen = fitting[0]!;
  }
  const rule = chosen.rule;
  const viewpoint = byName.get(rule.viewpoint)!;
  if (
    input.audience !== undefined &&
    !viewpoint.stakeholders.includes(input.audience)
  ) {
    const audience = input.audience;
    const forAudience = (r: DecisionRule) =>
      byName.get(r.viewpoint)!.stakeholders.includes(audience);
    const candidates = distinct(
      [...scored.map((s) => s.rule), ...forScope, ...table.rules]
        .filter(forAudience)
        .map((r) => alternative(r, `written for ${audience}: ${question(r)}`)),
    ).slice(0, 4);
    return {
      ok: false,
      problem: "audience",
      reason: `a ${viewpoint.title.toLowerCase()} view is written for ${viewpoint.stakeholders.join(", ")}, not ${audience}`,
      wanted: { viewpoint: rule.viewpoint, kind: rule.kind, rule: rule.id },
      alternatives: candidates,
    };
  }
  return {
    ok: true,
    rule: rule.id,
    viewpoint: rule.viewpoint,
    kind: rule.kind,
    reason:
      chosen.matched.length > 0
        ? `${rule.reason} (the intent says ${chosen.matched.map((m) => `'${m}'`).join(", ")})`
        : `${rule.reason} (no phrase of the table is in the intent; a ${input.scope} scope is shown so by default)`,
    matched: chosen.matched,
  };
}
