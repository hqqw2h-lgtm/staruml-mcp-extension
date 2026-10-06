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
import type { Parsed } from "./mermaid.js";
import type { ColumnSpec } from "./spec.js";

/*
 * SQL DDL into an ERD: each CREATE TABLE is an entity with its columns
 * (type, length, NOT NULL, PRIMARY KEY, UNIQUE, inline REFERENCES) and
 * table constraints (PRIMARY KEY, UNIQUE, FOREIGN KEY ... REFERENCES), and
 * ALTER TABLE ... ADD COLUMN, ADD PRIMARY KEY and ADD FOREIGN KEY extend
 * it, as pg_dump and mysqldump write them. Each foreign key becomes an
 * ERDRelationship from the referenced table to the referencing one: one
 * (or zero or one when the key columns may be null) to many (or zero or one
 * when they are unique), identifying when they are part of the primary
 * key. Statements that change no table structure (indexes, sequences,
 * grants, comments, inserts, settings) are skipped and counted in
 * warnings; views, types, functions, triggers and domains are refused as
 * UNSUPPORTED_SYNTAX, since an ERD cannot show them.
 */

const fail = (
  line: number,
  message: string,
  code: "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX" = "INVALID_ARGUMENT",
): never => {
  throw new ApiError(code, `sql line ${line}: ${message}`);
};

interface Statement {
  line: number;
  text: string;
}

/** Statements with comments removed, split at semicolons outside quotes. */
export function statements(source: string): Statement[] {
  const out: Statement[] = [];
  let text = "";
  let line = 1;
  let start = 1;
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "\n") line++;
    if (quote) {
      text += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < source.length && source[i] !== "\n") i++;
      i--;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      line += (source.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop - 1;
      continue;
    }
    if (ch === ";") {
      if (text.trim()) out.push({ line: start, text: text.trim() });
      text = "";
      continue;
    }
    if (!text.trim()) start = line;
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    if (ch === "[") quote = "]";
    text += ch;
  }
  if (text.trim()) out.push({ line: start, text: text.trim() });
  return out;
}

/** Splits at commas outside parentheses and quotes. */
function items(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const NAME = String.raw`(?:"[^"]+"|\`[^\`]+\`|\[[^\]]+\]|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|\`[^\`]+\`|\[[^\]]+\]|[\w$]+))*`;

/** A name without quotes or schema: "public"."Orders" is Orders. */
export function bare(name: string): string {
  const last = name
    .split(/\s*\.\s*(?=(?:"|`|\[|[\w$]))/)
    .at(-1)!
    .trim();
  return last.replace(/^["`[]|["`\]]$/g, "");
}

const names = (list: string) => items(list).map(bare);

interface Table {
  name: string;
  columns: ColumnSpec[];
  primaryKey: string[];
  unique: string[][];
}

interface ForeignKey {
  line: number;
  table: string;
  columns: string[];
  references: string;
  referenced: string[];
}

/** Keywords that end a column's type and start its constraints. */
const CONSTRAINT =
  /\s+(?=(?:not\s+null|null|primary\s+key|unique|references|default|check|constraint|generated|auto_increment|autoincrement|identity|collate|comment|on\s+update)\b)/i;

const SKIPPED =
  /^(create\s+(unique\s+)?index|create\s+sequence|create\s+extension|create\s+schema|create\s+database|alter\s+sequence|alter\s+(database|schema|default)|set\s|select\s|comment\s+on|grant\s|revoke\s|insert\s|update\s|delete\s|drop\s|begin|commit|start\s+transaction|use\s|lock\s|unlock\s|analyze|vacuum|pragma|copy\s|\\)/i;

const REFUSED =
  /^create\s+(or\s+replace\s+)?(view|materialized\s+view|type|function|procedure|trigger|domain|rule|policy|event|aggregate|operator|cast)\b/i;

export function parseSql(source: string): Parsed {
  const tables = new Map<string, Table>();
  const keys: ForeignKey[] = [];
  const skipped = new Map<string, number>();
  const table = (name: string) => tables.get(name.toLowerCase());
  const column = (t: Table, def: string, line: number) => {
    const m =
      new RegExp(String.raw`^(${NAME})\s+([\s\S]+)$`).exec(def) ??
      fail(line, `cannot read column "${def}"`);
    const [typeText, ...rest] = m[2]!.split(CONSTRAINT);
    const constraints = rest.join(" ");
    const sized = /^([^(]+?)\s*\(([^)]*)\)\s*(.*)$/.exec(typeText!.trim());
    const c: ColumnSpec = {
      name: bare(m[1]!),
      type: sized
        ? `${sized[1]!}${sized[3] ? ` ${sized[3]}` : ""}`
        : typeText!.trim(),
      ...(sized && { length: sized[2]!.replace(/\s+/g, "") }),
    };
    if (/primary\s+key/i.test(constraints)) t.primaryKey.push(c.name);
    if (/\bunique\b/i.test(constraints)) c.unique = true;
    if (!/not\s+null|primary\s+key/i.test(constraints)) c.nullable = true;
    const ref = new RegExp(
      String.raw`references\s+(${NAME})\s*(?:\(([^)]*)\))?`,
      "i",
    ).exec(constraints);
    if (ref) {
      keys.push({
        line,
        table: t.name,
        columns: [c.name],
        references: bare(ref[1]!),
        referenced: ref[2] ? names(ref[2]) : [],
      });
    }
    t.columns.push(c);
  };
  const constraint = (t: Table, def: string, line: number): boolean => {
    const body = def.replace(
      new RegExp(String.raw`^constraint\s+${NAME}\s+`, "i"),
      "",
    );
    let m: RegExpExecArray | null;
    if ((m = /^primary\s+key\s*\(([^)]*)\)/i.exec(body))) {
      t.primaryKey.push(...names(m[1]!));
    } else if (
      (m = /^unique(?:\s+(?:key|index))?(?:\s+[\w$`"]+)?\s*\(([^)]*)\)/i.exec(
        body,
      ))
    ) {
      t.unique.push(names(m[1]!));
    } else if (
      (m = new RegExp(
        String.raw`^foreign\s+key(?:\s+[\w$\`"]+)?\s*\(([^)]*)\)\s*references\s+(${NAME})\s*(?:\(([^)]*)\))?`,
        "i",
      ).exec(body))
    ) {
      keys.push({
        line,
        table: t.name,
        columns: names(m[1]!),
        references: bare(m[2]!),
        referenced: m[3] ? names(m[3]) : [],
      });
    } else if (!/^(check|exclude|key|index|fulltext|spatial)\b/i.test(body)) {
      return false;
    }
    return true;
  };
  for (const { line, text } of statements(source)) {
    let m: RegExpExecArray | null;
    if (
      (m = new RegExp(
        String.raw`^create\s+(?:(?:global\s+|local\s+)?(?:temporary|temp)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${NAME})\s*\(([\s\S]*)\)[^)]*$`,
        "i",
      ).exec(text))
    ) {
      const name = bare(m[1]!);
      const t: Table = { name, columns: [], primaryKey: [], unique: [] };
      if (table(name)) fail(line, `table ${name} is created twice`);
      tables.set(name.toLowerCase(), t);
      for (const def of items(m[2]!)) {
        if (
          /^(constraint|primary\s+key|foreign\s+key|unique|check|exclude|key|index|fulltext|spatial)\b/i.test(
            def,
          )
        ) {
          if (!constraint(t, def, line)) fail(line, `cannot read "${def}"`);
        } else if (/^like\s/i.test(def)) {
          fail(
            line,
            "CREATE TABLE ... LIKE copies a table build_diagram cannot see",
            "UNSUPPORTED_SYNTAX",
          );
        } else {
          column(t, def, line);
        }
      }
    } else if (
      (m = new RegExp(
        String.raw`^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(${NAME})\s+([\s\S]+)$`,
        "i",
      ).exec(text))
    ) {
      const t =
        table(bare(m[1]!)) ??
        fail(line, `ALTER TABLE ${bare(m[1]!)} before CREATE TABLE`);
      for (const action of items(m[2]!)) {
        const add =
          /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(
            action,
          );
        if (!add) {
          skipped.set("ALTER TABLE", (skipped.get("ALTER TABLE") ?? 0) + 1);
        } else if (!constraint(t, add[1]!, line)) {
          column(t, add[1]!, line);
        }
      }
    } else if (REFUSED.test(text)) {
      fail(
        line,
        `${text
          .split(/\s+/)
          .slice(0, text.match(/^create\s+or\s+replace/i) ? 4 : 2)
          .join(" ")
          .toUpperCase()} has no ERD element; only tables and their keys are drawn`,
        "UNSUPPORTED_SYNTAX",
      );
    } else if (SKIPPED.test(text)) {
      const what = text.split(/\s+/).slice(0, 2).join(" ").toUpperCase();
      skipped.set(what, (skipped.get(what) ?? 0) + 1);
    } else {
      fail(line, `cannot read "${text.split("\n")[0]}"`);
    }
  }
  if (tables.size === 0) fail(1, "no CREATE TABLE statement");
  const warnings = [...skipped].map(
    ([what, n]) => `${n} ${what} statement${n === 1 ? " is" : "s are"} skipped`,
  );
  const relationships: Record<string, unknown>[] = [];
  for (const k of keys) {
    const child = table(k.table)!;
    let parent = table(k.references);
    if (!parent) {
      warnings.push(
        `line ${k.line}: ${k.table} references ${k.references}, which is not created here; it is drawn without columns`,
      );
      parent = { name: k.references, columns: [], primaryKey: [], unique: [] };
      tables.set(k.references.toLowerCase(), parent);
    }
    const cols = k.columns.map(
      (name) =>
        child.columns.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        ) ?? fail(k.line, `${k.table} has no column ${name}`),
    );
    for (const c of cols) c.foreignKey = true;
    const same = (a: string[], b: string[]) =>
      a.length === b.length &&
      a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));
    const unique =
      same(k.columns, child.primaryKey) ||
      child.unique.some((u) => same(k.columns, u)) ||
      (cols.length === 1 && cols[0]!.unique === true);
    const inKey = k.columns.every((c) =>
      child.primaryKey.some((p) => p.toLowerCase() === c.toLowerCase()),
    );
    relationships.push({
      from: parent.name,
      to: child.name,
      fromCardinality: cols.some((c) => c.nullable && !inKey) ? "0..1" : "1",
      toCardinality: unique ? "0..1" : "0..*",
      identifying: inKey,
    });
  }
  const entities = [...tables.values()].map((t) => {
    for (const c of t.columns) {
      if (t.primaryKey.some((p) => p.toLowerCase() === c.name.toLowerCase())) {
        c.primaryKey = true;
        delete c.nullable;
      }
    }
    for (const u of t.unique) {
      if (u.length !== 1) continue;
      const c = t.columns.find(
        (x) => x.name.toLowerCase() === u[0]!.toLowerCase(),
      );
      if (c) c.unique = true;
    }
    return {
      name: t.name,
      ...(t.columns.length > 0 && { columns: t.columns }),
    };
  });
  return {
    kind: "erd",
    spec: { entities, relationships },
    ...(warnings.length > 0 && { warnings }),
  };
}
