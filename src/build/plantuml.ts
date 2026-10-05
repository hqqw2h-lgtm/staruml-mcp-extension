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
import { readC4, type TextLine } from "./c4.js";
import { readStructure } from "./plantuml-structure.js";
import { isOperation, multiline } from "./members.js";
import {
  CLASS_ARROWS,
  LEFT_CARD,
  type Parsed,
  RIGHT_CARD,
  unquote,
} from "./mermaid.js";
import type { Direction, Kind, ViewStyle } from "./spec.js";

/*
 * A PlantUML front end for /build_diagram (plantuml.com), reading each
 * supported diagram into the spec of a kind:
 * - class: class, abstract class, interface, enum, entity, struct and
 *   exception declarations ("Name" as Alias, <<stereotype>>, generics,
 *   #colour, extends/implements, member bodies with {static} and
 *   {abstract}), package and namespace blocks, relations (<|-- <|.. *--
 *   o-- --> ..> -- .. and their reverses, "cardinalities", : labels) and
 *   notes;
 * - sequence: participant, actor, boundary, control, entity, database,
 *   collections and queue; -> ->> --> <- <-- ->x messages, create and
 *   destroy; alt/else, opt, loop, par, break, critical and group blocks;
 *   notes beside or over participants;
 * - usecase: actor, :Actor:, usecase and (Use case) with aliases, one
 *   rectangle or package as the system boundary, associations,
 *   generalizations and <<include>>/<<extend>> dependencies, notes;
 * - activity: start, stop, end, kill, detach, :action;, if/elseif/else/
 *   endif, while/endwhile, repeat/repeat while, fork/fork again/end fork,
 *   split/split again/end split, |swimlanes|, -> labels and notes; and the
 *   legacy (*) --> "Action" as A1 graph /export_text writes;
 * - statemachine: [*], state "Name" as X { }, <<choice>>, <<fork>>,
 *   <<join>>, <<start>>, <<end>>, transitions with event [guard] / effect,
 *   notes;
 * - erd: entity blocks of columns (* mandatory, <<PK>>, <<FK>>, <<UK>>)
 *   joined by crow's foot relations, as /export_text writes them;
 * - mindmap: @startmindmap with * or OrgMode +/- levels;
 * - package, component and deployment: plantuml-structure.ts;
 * - c4: the C4-PlantUML macros.
 * Other PlantUML diagrams (object, timing, gantt,
 * wireframe, ...) and constructs StarUML cannot hold (found and lost
 * messages, ref, history states, concurrent regions, goto) are refused as
 * UNSUPPORTED_SYNTAX; skinparam, hide, show, scale and similar styling are
 * skipped.
 */

type Code = "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX";

const fail = (
  no: number,
  message: string,
  code: Code = "INVALID_ARGUMENT",
): never => {
  throw new ApiError(code, `plantuml line ${no}: ${message}`);
};
const refuse = (no: number, message: string): never =>
  fail(no, message, "UNSUPPORTED_SYNTAX");

interface Source {
  type: string;
  no: number;
  lines: TextLine[];
  title?: string;
  direction?: Direction;
  includes: string[];
}

/** Statements that only style or annotate the picture. */
const STYLING =
  /^(skinparam|hide|show|scale|caption|header|footer|!theme|!pragma|!define|!undef|!option|!procedure|!function|!endprocedure|!endfunction|!\$|autonumber|newpage|allowmixing|set\s+namespaceSeparator|mainframe|sprite|together)\b/i;

/** The lines between @start... and @end..., comments and styling removed. */
export function preprocess(source: string): Source {
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  const start = raw.findIndex((l) => /^\s*@start\w+/i.test(l));
  if (start < 0) fail(1, "no @startuml line");
  const type = /@start(\w+)/i.exec(raw[start]!)![1]!.toLowerCase();
  const lines: TextLine[] = [];
  const includes: string[] = [];
  let title: string | undefined;
  let direction: Direction | undefined;
  let comment = false;
  let skipUntil: RegExp | null = null;
  for (let i = start + 1; i < raw.length; i++) {
    let text = raw[i]!.trim();
    if (/^@end\w+/i.test(text)) break;
    if (comment) {
      const end = text.indexOf("'/");
      if (end < 0) continue;
      comment = false;
      text = text.slice(end + 2).trim();
    }
    if (text.startsWith("/'")) {
      const end = text.indexOf("'/", 2);
      if (end < 0) {
        comment = true;
        continue;
      }
      text = text.slice(end + 2).trim();
    }
    if (skipUntil) {
      if (skipUntil.test(text)) skipUntil = null;
      continue;
    }
    if (!text || text.startsWith("'")) continue;
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.+)$/i.exec(text))) {
      title = multiline(unquote(m[1]!));
    } else if (/^(skinparam\b.*|style)\s*\{$|^<style>$/i.test(text)) {
      skipUntil = /^(\}|<\/style>)$/;
    } else if (
      /^legend\b/i.test(text) ||
      /^(title|header|footer)$/i.test(text)
    ) {
      skipUntil = /^end\s*(legend|title|header|footer)$/i;
    } else if (/^left to right direction$/i.test(text)) {
      direction = "LR";
    } else if (/^top to bottom direction$/i.test(text)) {
      direction = "TB";
    } else if ((m = /^!include(?:url|sub)?\s+(.+)$/i.exec(text))) {
      includes.push(m[1]!);
    } else if (!STYLING.test(text)) {
      lines.push({ no: i + 1, text });
    }
  }
  return {
    type,
    no: start + 1,
    lines,
    ...(title !== undefined && { title }),
    ...(direction && { direction }),
    includes,
  };
}

const ID = String.raw`"[^"]+"|[\w.$:]+`;

/** "Long name" as A, A as "Long name", A or "Long name": key and name. */
function named(text: string): { key: string; name: string } {
  let m = /^"([^"]+)"\s+as\s+([\w.$:]+)$/.exec(text);
  if (m) return { key: m[2]!, name: multiline(m[1]!) };
  m = /^([\w.$:]+)\s+as\s+"([^"]+)"$/.exec(text);
  if (m) return { key: m[1]!, name: multiline(m[2]!) };
  m = /^([\w.$:]+)\s+as\s+([\w.$:]+)$/.exec(text);
  if (m) return { key: m[2]!, name: m[1]! };
  const plain = unquote(text);
  return { key: plain, name: multiline(plain) };
}

const HEX = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i;

/** Takes <<stereotypes>> and a #colour off a declaration. */
function adornments(text: string): {
  rest: string;
  stereotype?: string;
  fill?: string;
} {
  let rest = text;
  let stereotype: string | undefined;
  rest = rest.replace(/<<\s*([^>]+?)\s*>>/g, (_, s: string) => {
    stereotype ??= s;
    return "";
  });
  const color = HEX.exec(rest);
  rest = rest.replace(/#[\w|/\\-]+/g, "").trim();
  return {
    rest,
    ...(stereotype !== undefined && { stereotype }),
    ...(color && { fill: `#${color[1]}` }),
  };
}

/** An arrow without colour, direction and length: "-[#red]up->" is "-->". */
function arrowCore(arrow: string): string {
  return arrow
    .replace(/\[[^\]]*\]/g, "")
    .replace(/(up|down|left|right|u|d|l|r)/g, "")
    .replace(/-+/g, "--")
    .replace(/\.+/g, "..");
}

/** A relation line: two ends, an arrow, optional "cardinalities" and : label. */
const RELATION = new RegExp(
  String.raw`^(${ID})\s*(?:"([^"]*)"\s*)?((?:<\||[<*o#x+^}])?[-.]+(?:\[[^\]]*\])?[-.]*(?:(?:up|down|left|right|u|d|l|r)[-.]+)?(?:\|>|[>*o#x+^{])?)\s*(?:"([^"]*)"\s*)?(${ID})\s*(?::\s*(.*))?$`,
);

/** A label without PlantUML's reading-direction marks. */
const label = (text: string | undefined) =>
  text?.replace(/^\s*[<>]\s*|\s*[<>]\s*$/g, "").trim() || undefined;

interface Note {
  text: string;
  on?: string[];
  side?: "left" | "right" | "over";
  at?: number;
}

/**
 * Note statements: `note ... : text` on one line or `note ...` up to
 * `end note`. Answers the note's head, text and the index of the line
 * after it, or null for any other line.
 */
function readNote(
  lines: readonly TextLine[],
  i: number,
): { head: string; text: string; next: number } | null {
  const { text } = lines[i]!;
  const m = /^[hr]?note\b\s*(.*?)\s*(?::\s*(.*))?$/i.exec(text);
  if (!m) return null;
  if (m[2] !== undefined) return { head: m[1]!, text: m[2], next: i + 1 };
  const quoted = /^"(.*)"(.*)$/.exec(m[1]!);
  if (quoted) return { head: quoted[2]!.trim(), text: quoted[1]!, next: i + 1 };
  const body: string[] = [];
  let j = i + 1;
  for (; j < lines.length && !/^end\s*[hr]?note$/i.test(lines[j]!.text); j++) {
    body.push(lines[j]!.text);
  }
  if (j === lines.length)
    fail(lines[i]!.no, "note is never closed with end note");
  return { head: m[1]!, text: body.join("\n"), next: j + 1 };
}

// ---------------------------------------------------------------- class

interface ClassEntry {
  name: string;
  kind?: string;
  stereotype?: string;
  package?: string;
  attributes: string[];
  operations: string[];
  literals: string[];
}

const CLASS_KINDS: Record<string, string | undefined> = {
  "abstract class": "abstract",
  abstract: "abstract",
  class: undefined,
  interface: "interface",
  enum: "enum",
  entity: undefined,
  struct: undefined,
  exception: undefined,
};

function classDiagram(lines: TextLine[]) {
  const classes = new Map<string, ClassEntry>();
  const packages: string[] = [];
  const relations: Record<string, unknown>[] = [];
  const notes: Note[] = [];
  const noteAliases = new Map<string, Note>();
  const styles: Record<string, ViewStyle> = {};
  const warnings: string[] = [];
  const open: string[] = [];
  let last: string | undefined;
  const entry = (key: string, name = key) => {
    let e = classes.get(key);
    if (!e) {
      e = { name, attributes: [], operations: [], literals: [] };
      if (open.length > 0) e.package = open.at(-1)!;
      classes.set(key, e);
    }
    return e;
  };
  const member = (e: ClassEntry, text: string) => {
    if (/^(--|\.\.|==|__)/.test(text)) return;
    const clean = text
      .replace(/\{(field|method)\}\s*/g, "")
      .replace(/^\{static\}\s*(.*)$/, "$1$")
      .replace(/^\{abstract\}\s*(.*)$/, "$1*")
      .replace(/[;,]$/, "");
    if (e.kind === "enum") e.literals.push(clean.trim());
    else if (isOperation(clean)) e.operations.push(clean);
    else e.attributes.push(clean);
  };
  let body: ClassEntry | null = null;
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    if (body) {
      if (text === "}") body = null;
      else member(body, text);
      continue;
    }
    let m: RegExpExecArray | null;
    const note = readNote(lines, i);
    if (note) {
      i = note.next - 1;
      const as = /^as\s+(\w+)$/.exec(note.head);
      const of = /^(?:left|right|top|bottom)(?:\s+of\s+(.+))?$/.exec(note.head);
      const n: Note = { text: note.text };
      if (as) noteAliases.set(as[1]!, n);
      else if (of) {
        const target = of[1] ? named(of[1]).key : last;
        if (target !== undefined) n.on = [target];
      } else if (/^on\s+link/.test(note.head)) continue;
      else if (note.head) fail(no, `cannot read "${text}"`);
      notes.push(n);
    } else if (
      (m =
        /^(abstract\s+class|abstract|class|interface|enum|entity|struct|exception)\s+(.+?)\s*(\{)?$/.exec(
          text,
        ))
    ) {
      const { rest, stereotype, fill } = adornments(m[2]!);
      const parents = {
        generalization: /\s+extends\s+(.+?)(?=\s+implements\s|$)/.exec(rest),
        realization: /\s+implements\s+(.+?)(?=\s+extends\s|$)/.exec(rest),
      };
      const decl = rest
        .replace(/\s+(extends|implements)\s.*$/, "")
        .replace(/<[^<>]*>$/, "")
        .trim();
      const { key, name } = named(decl);
      const e = entry(key, name);
      e.name = name;
      const kind = CLASS_KINDS[m[1]!.replace(/\s+/g, " ")];
      if (kind) e.kind = kind;
      if (stereotype !== undefined) e.stereotype = stereotype;
      if (fill) styles[key] = { fillColor: fill };
      for (const [type, found] of Object.entries(parents)) {
        for (const parent of found?.[1]!.split(/\s*,\s*/) ?? []) {
          entry(parent);
          relations.push({ from: key, to: parent, type });
        }
      }
      // A note without a target is on the class declared last.
      last = key;
      if (m[3]) body = e;
    } else if (
      (m =
        /^(annotation|protocol|metaclass|stereotype|circle|diamond|object|map|json|component|node|artifact|usecase)\s/.exec(
          text,
        ))
    ) {
      refuse(no, `${m[1]} is not part of a class diagram build_diagram reads`);
    } else if ((m = /^(package|namespace)\s+(.+?)\s*\{$/.exec(text))) {
      const { rest } = adornments(m[2]!);
      const { name } = named(rest);
      if (open.length > 0) {
        warnings.push(
          `package ${name} is nested in ${open.at(-1)}; StarUML gets it at the top level`,
        );
      }
      if (!packages.includes(name)) packages.push(name);
      open.push(name);
    } else if (text === "}" && open.length > 0) {
      open.pop();
    } else if ((m = RELATION.exec(text))) {
      const [, a, aCard, arrow, bCard, b, text2] = m;
      const [ka, kb] = [named(a!).key, named(b!).key];
      const core = arrowCore(arrow!);
      if (noteAliases.has(ka) || noteAliases.has(kb)) {
        const [n, other] = noteAliases.has(ka)
          ? [noteAliases.get(ka)!, kb]
          : [noteAliases.get(kb)!, ka];
        n.on = [...(n.on ?? []), other];
        continue;
      }
      const found =
        CLASS_ARROWS.find(([re]) => re.test(core)) ??
        CLASS_ARROWS.find(([re]) => re.test(core.replace(/^--$|^-$/, "--")));
      if (!found) refuse(no, `the ${arrow} arrow has no StarUML relation`);
      const [, type, reversed] = found!;
      entry(ka);
      entry(kb);
      const [from, to, fromMul, toMul] = reversed
        ? [kb, ka, bCard, aCard]
        : [ka, kb, aCard, bCard];
      const name = label(text2);
      relations.push({
        from,
        to,
        type,
        ...(name && { name }),
        ...(fromMul !== undefined && { fromMultiplicity: fromMul }),
        ...(toMul !== undefined && { toMultiplicity: toMul }),
      });
    } else if ((m = new RegExp(String.raw`^(${ID})\s*:\s*(.+)$`).exec(text))) {
      member(entry(named(m[1]!).key), m[2]!.trim());
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  const nameOf = (key: string) => classes.get(key)?.name ?? key;
  const colors = Object.fromEntries(
    Object.entries(styles).map(([k, v]) => [nameOf(k), v]),
  );
  return {
    spec: {
      ...(packages.length > 0 && { packages }),
      classes: [...classes.values()].map((e) => ({
        name: e.name,
        ...(e.kind && { kind: e.kind }),
        ...(e.stereotype !== undefined && { stereotype: e.stereotype }),
        ...(e.package !== undefined && { package: e.package }),
        ...(e.attributes.length > 0 && { attributes: e.attributes }),
        ...(e.operations.length > 0 && { operations: e.operations }),
        ...(e.literals.length > 0 && { literals: e.literals }),
      })),
      relations: relations.map((r) => ({
        ...r,
        from: nameOf(r.from as string),
        to: nameOf(r.to as string),
      })),
      ...(notes.length > 0 && {
        notes: notes.map((n) => ({
          text: n.text,
          ...(n.on && { on: n.on.map(nameOf) }),
        })),
      }),
      ...(Object.keys(colors).length > 0 && { styles: colors }),
    },
    warnings,
  };
}

// ---------------------------------------------------------------- sequence

const PARTICIPANT =
  /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/;

const MESSAGE = new RegExp(
  String.raw`^(${ID}|\[|\])?\s*(<?<?-{1,2}(?:\[[^\]]*\])?-?(?:>>?|\\\\?|//?)?[xo]?)\s*(${ID}|\[|\])?\s*(!!)?\s*(?::\s*(.*))?$`,
);

const OPERATORS = new Set([
  "alt",
  "opt",
  "loop",
  "par",
  "break",
  "critical",
  "neg",
  "strict",
  "seq",
  "ignore",
  "consider",
  "assert",
]);

function sequenceDiagram(lines: TextLine[]) {
  const participants: { name: string; kind?: string }[] = [];
  const keys = new Map<string, string>();
  const messages: Record<string, unknown>[] = [];
  const fragments: Record<string, unknown>[] = [];
  const notes: Note[] = [];
  const open: {
    operator: string;
    guard?: string;
    from: number;
    no: number;
    operands: string[];
    starts: number[];
  }[] = [];
  const creating = new Set<string>();
  const who = (ref: string) => {
    const key = named(ref).key;
    if (!keys.has(key)) keys.set(key, named(ref).name);
    return keys.get(key)!;
  };
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    let m: RegExpExecArray | null;
    const note = readNote(lines, i);
    if (note) {
      i = note.next - 1;
      const at = /^(left|right|over)(?:\s+of)?\s*(.*)$/i.exec(note.head);
      if (!at) {
        if (/^(across|on\s+link)/i.test(note.head)) continue;
        fail(no, `cannot read "${text}"`);
      }
      const side = at![1]!.toLowerCase() as Note["side"];
      const on = at![2]
        ? at![2].split(",").map((p) => who(p.trim()))
        : messages.length > 0
          ? [String(messages.at(-1)!.from)]
          : [];
      notes.push({ text: note.text, on, side, at: messages.length });
    } else if (
      (m =
        /^create\s+(?:(participant|actor|boundary|control|entity|database|collections|queue)\s+)?(.+)$/.exec(
          text,
        ))
    ) {
      const { key, name } = named(adornments(m[2]!).rest);
      if (!keys.has(key)) {
        keys.set(key, name);
        participants.push({ name, ...(m[1] === "actor" && { kind: "actor" }) });
      }
      creating.add(keys.get(key)!);
    } else if ((m = PARTICIPANT.exec(text))) {
      const rest = adornments(m[2]!).rest.replace(/\s+order\s+-?\d+$/, "");
      const { key, name } = named(rest);
      keys.set(key, name);
      participants.push({ name, ...(m[1] === "actor" && { kind: "actor" }) });
    } else if ((m = /^destroy\s+(.+)$/.exec(text))) {
      const target = who(m[1]!);
      const last = [...messages].reverse().find((x) => x.to === target);
      if (last) last.kind = "delete";
    } else if (
      (m = /^(alt|opt|loop|par2?|break|critical|group)\b\s*(.*)$/.exec(text))
    ) {
      let operator = m[1]!.replace("par2", "par");
      let guard = m[2]!.trim();
      if (operator === "group") {
        const word = /^(\w+)\s*(.*)$/.exec(guard);
        if (word && OPERATORS.has(word[1]!)) {
          operator = word[1]!;
          guard = word[2]!;
        } else {
          operator = "seq";
        }
      }
      open.push({
        operator,
        ...(guard && { guard }),
        from: messages.length,
        no,
        operands: [],
        starts: [],
      });
    } else if ((m = /^else\b\s*(.*)$/.exec(text))) {
      const f = open.at(-1) ?? fail(no, "else outside a group");
      f.operands.push(m[1]!.trim());
      f.starts.push(messages.length);
    } else if (text === "end") {
      const f = open.pop() ?? fail(no, "end without a group");
      const to = messages.length - 1;
      if (to >= f.from) {
        const divided = f.starts.every(
          (s, k) => s > (k === 0 ? f.from : f.starts[k - 1]!) && s <= to,
        );
        fragments.push({
          operator: f.operator,
          ...(f.guard && { guard: f.guard }),
          ...(f.operands.length > 0 && { operands: f.operands }),
          ...(f.starts.length > 0 && divided && { operandStarts: f.starts }),
          from: f.from,
          to,
        });
      }
    } else if (/^(ref\s+over|return)\b/.test(text)) {
      refuse(
        no,
        `${text.split(/\s/)[0]} has no StarUML sequence element build_diagram makes`,
      );
    } else if (
      /^(activate|deactivate|autoactivate|box\b|end\s+box|\.\.\.|\|\|\||\|\|\d+\|\||==.*==$|delay\b|space\b)/.test(
        text,
      )
    ) {
      // Lifeline activation, grouping boxes, spacing and dividers.
    } else if ((m = MESSAGE.exec(text)) && m[1] && m[3]) {
      if ("[]".includes(m[1]) || "[]".includes(m[3])) {
        refuse(
          no,
          "found and lost messages have no StarUML sequence element build_diagram makes",
        );
      }
      const arrow = m[2]!.replace(/\[[^\]]*\]/g, "");
      const reversed = arrow.startsWith("<");
      const [from, to] = reversed
        ? [who(m[3]), who(m[1])]
        : [who(m[1]), who(m[3])];
      const dotted = /--/.test(arrow);
      const head = arrow.replace(/^<+/, "").replace(/^-+/, "");
      const kind =
        m[4] || head.includes("x")
          ? "delete"
          : creating.delete(to)
            ? "create"
            : /^(>>|\\|\/)/.test(head) || /^<</.test(arrow)
              ? "async"
              : dotted
                ? "reply"
                : "sync";
      messages.push({
        from,
        to,
        kind,
        ...(m[5] !== undefined && { text: m[5].trim() }),
      });
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (open.length > 0) {
    fail(open.at(-1)!.no, `${open.at(-1)!.operator} is never closed with end`);
  }
  return {
    spec: {
      participants,
      messages,
      fragments,
      ...(notes.length > 0 && { notes }),
    },
    warnings: [],
  };
}

// ---------------------------------------------------------------- use case

const UC_ARROW = String.raw`(?:<\||<)?[-.]+(?:\[[^\]]*\])?[-.]*(?:(?:up|down|left|right|u|d|l|r)[-.]+)?(?:\|>|>)?`;
const UC_END = String.raw`\([^)]+\)(?:\s+as\s+[\w.]+)?|:[^:]+:|"[^"]+"|[\w.]+`;
const UC_RELATION = new RegExp(
  String.raw`^(${UC_END})\s*(${UC_ARROW})\s*(${UC_END})\s*(?::\s*(.*))?$`,
);

function usecaseDiagram(lines: TextLine[]) {
  const actors: string[] = [];
  const useCases: string[] = [];
  const names = new Map<string, string>();
  const relations: Record<string, unknown>[] = [];
  const notes: Note[] = [];
  const noteAliases = new Map<string, Note>();
  const warnings: string[] = [];
  let system: string | undefined;
  let depth = 0;
  const declare = (list: string[], key: string, name: string) => {
    names.set(key, name);
    if (!actors.includes(name) && !useCases.includes(name)) list.push(name);
    return name;
  };
  /** An end: (Use case), :Actor:, or a declared alias or name. */
  const end = (ref: string): string => {
    let m = /^\((.+)\)(?:\s+as\s+([\w.]+))?$/.exec(ref);
    if (m) return declare(useCases, m[2] ?? m[1]!, multiline(m[1]!));
    m = /^:(.+):$/.exec(ref);
    if (m) return declare(actors, m[1]!, multiline(m[1]!));
    const key = unquote(ref);
    return names.get(key) ?? declare(actors, key, multiline(key));
  };
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    let m: RegExpExecArray | null;
    const note = readNote(lines, i);
    if (note) {
      i = note.next - 1;
      const as = /^as\s+(\w+)$/.exec(note.head);
      const of = /^(?:left|right|top|bottom)\s+of\s+(.+)$/.exec(note.head);
      const n: Note = { text: note.text };
      if (as) noteAliases.set(as[1]!, n);
      else if (of) n.on = [end(of[1]!)];
      notes.push(n);
    } else if (
      (m = /^actor\/?\s+(.+)$/.exec(text)) ||
      (m = /^(:[^:]+:(?:\s+as\s+\S+)?)$/.exec(text))
    ) {
      const rest = adornments(m[1]!).rest;
      const colon = /^:(.+):(?:\s+as\s+(\S+))?$/.exec(rest);
      const { key, name } = colon
        ? { key: colon[2] ?? colon[1]!, name: multiline(colon[1]!) }
        : named(rest);
      declare(actors, key, name);
    } else if (
      (m = /^usecase\/?\s+(.+)$/.exec(text)) ||
      (m = /^(\([^)]+\)(?:\s+as\s+\S+)?)$/.exec(text))
    ) {
      const rest = adornments(m[1]!).rest;
      const paren = /^\((.+)\)(?:\s+as\s+(\S+))?$/.exec(rest);
      const { key, name } = paren
        ? { key: paren[2] ?? paren[1]!, name: multiline(paren[1]!) }
        : named(rest);
      declare(useCases, key, name);
    } else if ((m = /^(rectangle|package)\s+(.+?)\s*\{$/.exec(text))) {
      const name = named(adornments(m[2]!).rest).name;
      if (system === undefined) system = name;
      else warnings.push(`only one system boundary is drawn; ${name} is not`);
      depth++;
    } else if (text === "}" && depth > 0) {
      depth--;
    } else if ((m = UC_RELATION.exec(text))) {
      const [, a, arrow, b, text2] = m;
      if (noteAliases.has(a!) || noteAliases.has(b!)) {
        const [n, other] = noteAliases.has(a!)
          ? [noteAliases.get(a!)!, b!]
          : [noteAliases.get(b!)!, a!];
        n.on = [...(n.on ?? []), end(other)];
        continue;
      }
      const core = arrowCore(arrow!);
      const tag = label(text2)
        ?.replace(/[«»<>]/g, "")
        .trim()
        .toLowerCase();
      const general = core.includes("|>") || core.includes("<|");
      const reversed = core.startsWith("<");
      const [from, to] = reversed ? [end(b!), end(a!)] : [end(a!), end(b!)];
      const type = general
        ? "generalization"
        : tag === "include" || tag === "extend"
          ? tag
          : "association";
      const name = label(text2);
      relations.push({
        from,
        to,
        type,
        ...(type === "association" && name && { name }),
      });
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  return {
    spec: {
      ...(system !== undefined && { system }),
      actors,
      useCases,
      relations,
      ...(notes.length > 0 && { notes }),
    },
    warnings,
  };
}

// ---------------------------------------------------------------- activity

interface Tail {
  key: string;
  guard?: string;
}

/**
 * The current activity syntax, compiled into a graph: each statement adds
 * nodes and joins them to the tails left by the one before. A decision
 * (if, while, repeat while) is a decision node whose outgoing flows carry
 * the branch labels; branches meet again in a merge node, forks in a join.
 */
function activityDiagram(lines: TextLine[]) {
  const nodes: Record<string, unknown>[] = [];
  const flows: Record<string, unknown>[] = [];
  const lanes: string[] = [];
  const notes: Note[] = [];
  let lane: string | undefined;
  let tails: Tail[] = [];
  let pending: string | undefined;
  let lastNode: string | undefined;
  const stack: {
    kind: "if" | "while" | "repeat" | "fork";
    node: string;
    ends: Tail[];
    otherwise: boolean;
    no: number;
  }[] = [];
  const node = (type: string, name?: string) => {
    const id = `${type}${nodes.length}`;
    nodes.push({
      id,
      ...(name !== undefined && { name: multiline(name) }),
      type,
      ...(lane !== undefined && { lane }),
    });
    for (const t of tails) {
      const guard = t.guard ?? pending;
      flows.push({ from: t.key, to: id, ...(guard && { guard }) });
    }
    pending = undefined;
    tails = [{ key: id }];
    lastNode = id;
    return id;
  };
  const top = (no: number, kind: string) => {
    const f = stack.at(-1);
    if (f?.kind !== kind) fail(no, `no open ${kind}`);
    return f!;
  };
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    let m: RegExpExecArray | null;
    const note = readNote(lines, i);
    if (note) {
      i = note.next - 1;
      notes.push({ text: note.text, ...(lastNode && { on: [lastNode] }) });
      continue;
    }
    if (text.startsWith(":")) {
      // An action, which may run over several lines up to its ;.
      let body = text.slice(1);
      while (!/[;|<>\]}/]$/.test(body) && i + 1 < lines.length) {
        body += `\n${lines[++i]!.text}`;
      }
      if (!/[;|<>\]}/]$/.test(body)) fail(no, "action is never closed with ;");
      node("action", body.slice(0, -1));
    } else if (/^start$/.test(text)) {
      node("initial");
    } else if (/^(stop|end)$/.test(text)) {
      node("final");
      tails = [];
    } else if (/^(kill|detach)$/.test(text)) {
      node("flowFinal");
      tails = [];
    } else if ((m = /^->\s*(.*?);?$/.exec(text))) {
      pending = m[1] || undefined;
    } else if (
      (m = /^if\s*\((.*?)\)\s*(?:then\s*(?:\((.*)\))?)?$/.exec(text))
    ) {
      const d = node("decision", m[1]!);
      stack.push({ kind: "if", node: d, ends: [], otherwise: false, no });
      tails = [{ key: d, ...(m[2] && { guard: m[2] }) }];
    } else if (
      (m = /^else\s*if\s*\((.*?)\)\s*(?:then\s*(?:\((.*)\))?)?$/.exec(text))
    ) {
      const f = top(no, "if");
      f.ends.push(...tails);
      tails = [{ key: f.node, guard: m[2] || m[1]! }];
    } else if ((m = /^else\s*(?:\((.*)\))?$/.exec(text))) {
      const f = top(no, "if");
      f.ends.push(...tails);
      f.otherwise = true;
      tails = [{ key: f.node, ...(m[1] && { guard: m[1] }) }];
    } else if (/^end\s*if$/.test(text)) {
      const f = top(no, "if");
      stack.pop();
      const ends = [
        ...f.ends,
        ...tails,
        ...(f.otherwise ? [] : [{ key: f.node }]),
      ];
      tails = ends;
      if (ends.length > 0) node("merge");
    } else if ((m = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/.exec(text))) {
      const d = node("decision", m[1]!);
      stack.push({ kind: "while", node: d, ends: [], otherwise: false, no });
      tails = [{ key: d, ...(m[2] && { guard: m[2] }) }];
    } else if ((m = /^end\s*while\s*(?:\((.*)\))?$/.exec(text))) {
      const f = top(no, "while");
      stack.pop();
      for (const t of tails) {
        flows.push({
          from: t.key,
          to: f.node,
          ...(t.guard && { guard: t.guard }),
        });
      }
      tails = [{ key: f.node, ...(m[1] && { guard: m[1] }) }];
    } else if (/^repeat$/.test(text)) {
      const r = node("merge");
      stack.push({ kind: "repeat", node: r, ends: [], otherwise: false, no });
    } else if (
      (m =
        /^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*)\))?$/.exec(
          text,
        ))
    ) {
      const f = top(no, "repeat");
      stack.pop();
      const d = node("decision", m[1]!);
      flows.push({ from: d, to: f.node, ...(m[2] && { guard: m[2] }) });
      tails = [{ key: d, ...(m[3] && { guard: m[3] }) }];
    } else if (/^(fork|split)$/.test(text)) {
      const f = node("fork");
      stack.push({ kind: "fork", node: f, ends: [], otherwise: false, no });
    } else if (/^(fork|split)\s+again$/.test(text)) {
      const f = top(no, "fork");
      f.ends.push(...tails);
      tails = [{ key: f.node }];
    } else if (/^end\s*(fork|merge|split)(\s*\{.*\})?$/.test(text)) {
      const f = top(no, "fork");
      stack.pop();
      tails = [...f.ends, ...tails];
      node("join");
    } else if ((m = /^\|(?:[^|]*\|)?([^|]+)\|$/.exec(text))) {
      lane = multiline(m[1]!.trim());
      if (!lanes.includes(lane)) lanes.push(lane);
    } else if (/^(partition|group)\b.*\{$/.test(text) || text === "}") {
      // Partitions and groups only frame actions.
    } else if (/^(goto|label|backward|break)\b/.test(text)) {
      refuse(
        no,
        `${text.split(/\s/)[0]} has no activity element build_diagram makes`,
      );
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (stack.length > 0)
    fail(stack.at(-1)!.no, `${stack.at(-1)!.kind} is never closed`);
  return {
    spec: {
      ...(lanes.length > 0 && { lanes }),
      nodes,
      flows,
      ...(notes.length > 0 && { notes }),
    },
    warnings: [],
  };
}

/** The legacy activity syntax: (*), ===bars===, "Action" as A and arrows. */
const LEGACY_END = String.raw`\(\*(?:top)?\)|===[^=]+===|"[^"]+"(?:\s+as\s+\w+)?|[\w.]+`;
const LEGACY = new RegExp(
  String.raw`^(${LEGACY_END})?\s*-+(?:\[[^\]]*\])?-*(?:(?:up|down|left|right|u|d|l|r)-+)?>\s*(?:\[([^\]]*)\]\s*)?(${LEGACY_END})$`,
);

function legacyActivity(lines: TextLine[]) {
  const nodes = new Map<string, Record<string, unknown>>();
  const flows: Record<string, unknown>[] = [];
  let last: string | undefined;
  let starts = 0;
  let ends = 0;
  const ref = (text: string, side: "from" | "to"): string => {
    if (/^\(\*/.test(text)) {
      const id = side === "from" ? `start${++starts}` : `end${++ends}`;
      nodes.set(id, { id, type: side === "from" ? "initial" : "final" });
      return id;
    }
    let m = /^===([^=]+)===$/.exec(text);
    if (m) {
      const id = m[1]!.trim();
      if (!nodes.has(id)) nodes.set(id, { id, type: "fork" });
      return id;
    }
    m = /^"([^"]+)"(?:\s+as\s+(\w+))?$/.exec(text);
    const id = m ? (m[2] ?? m[1]!) : text;
    if (!nodes.has(id)) {
      nodes.set(id, { id, name: multiline(m ? m[1]! : text), type: "action" });
    }
    return id;
  };
  for (const { no, text } of lines) {
    const m = LEGACY.exec(text) ?? fail(no, `cannot read "${text}"`);
    const from = m[1]
      ? ref(m[1], "from")
      : (last ?? fail(no, "an arrow needs a start"));
    const to = ref(m[3]!, "to");
    flows.push({ from, to, ...(m[2] && { guard: m[2] }) });
    last = to;
  }
  // A bar with several incoming flows joins them.
  for (const n of nodes.values()) {
    if (n.type === "fork" && flows.filter((f) => f.to === n.id).length > 1) {
      n.type = "join";
    }
  }
  return { spec: { nodes: [...nodes.values()], flows }, warnings: [] };
}

// ---------------------------------------------------------------- state

const STATE_REF = String.raw`\[\*\]|[\w.]+`;
const TRANSITION = new RegExp(
  String.raw`^(${STATE_REF})\s*(-+(?:\[[^\]]*\])?-*(?:(?:up|down|left|right|u|d|l|r)-+)?>)\s*(${STATE_REF})\s*(?::\s*(.*))?$`,
);

function stateDiagram(lines: TextLine[]) {
  const states = new Map<string, Record<string, unknown>>();
  const transitions: Record<string, unknown>[] = [];
  const notes: Note[] = [];
  const blocks: string[] = [];
  const warnings: string[] = [];
  let starts = 0;
  let ends = 0;
  const declare = (id: string, fields: Record<string, unknown>) => {
    const known = states.get(id);
    if (known) Object.assign(known, fields);
    else {
      states.set(id, {
        id,
        ...fields,
        ...(blocks.length > 0 && { parent: blocks.at(-1)! }),
      });
    }
  };
  const state = (id: string, side: "from" | "to") => {
    if (id === "[*]") {
      const key =
        side === "from" ? `[*] start ${++starts}` : `[*] end ${++ends}`;
      declare(key, { type: side === "from" ? "initial" : "final" });
      return key;
    }
    if (!states.has(id)) declare(id, { name: multiline(id) });
    return id;
  };
  const PSEUDO: Record<string, Record<string, string>> = {
    choice: { type: "choice" },
    fork: { type: "fork" },
    join: { type: "join" },
    start: { type: "initial" },
    end: { type: "final" },
  };
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    let m: RegExpExecArray | null;
    const note = readNote(lines, i);
    if (note) {
      i = note.next - 1;
      const of = /^(?:left|right|top|bottom)\s+of\s+([\w.]+)$/.exec(note.head);
      if (/^on\s+link/.test(note.head)) continue;
      if (of) state(of[1]!, "to");
      notes.push({ text: note.text, ...(of && { on: [of[1]!] }) });
    } else if (
      (m =
        /^state\s+(?:"([^"]+)"\s+as\s+)?([\w.]+)(?:\s+as\s+"([^"]+)")?\s*(<<\s*\w+\s*>>)?\s*(#\S+)?\s*(\{)?$/.exec(
          text,
        ))
    ) {
      const id = m[2]!;
      const stereotype = m[4]?.replace(/[<>\s]/g, "");
      if (stereotype !== undefined) {
        const pseudo =
          PSEUDO[stereotype] ??
          refuse(
            no,
            `<<${stereotype}>> states have no StarUML element build_diagram makes`,
          );
        declare(id, pseudo);
      } else {
        const label = m[1] ?? m[3];
        declare(
          id,
          label !== undefined || !states.has(id)
            ? { name: multiline(label ?? id) }
            : {},
        );
      }
      if (m[6]) blocks.push(id);
    } else if (text === "}") {
      if (blocks.pop() === undefined) fail(no, "} without a state block");
    } else if (text === "--" || text === "||") {
      refuse(
        no,
        "concurrent regions are not built; a composite state gets one region",
      );
    } else if ((m = TRANSITION.exec(text))) {
      const from = state(m[1]!, "from");
      const to = state(m[3]!, "to");
      const labelText = m[4]?.trim() ?? "";
      const guard = /\[([^\]]*)\]/.exec(labelText);
      const [event, effect] = labelText
        .replace(/\[[^\]]*\]/, "")
        .split("/")
        .map((s) => s.trim());
      transitions.push({
        from,
        to,
        ...(event && { trigger: event }),
        ...(guard && { guard: guard[1] }),
        ...(effect && { effect }),
      });
    } else if (/^\[H\*?\]/.test(text) || /\[H\*?\]/.test(text)) {
      refuse(no, "history states have no StarUML element build_diagram makes");
    } else if ((m = /^([\w.]+)$/.exec(text))) {
      state(m[1]!, "to");
    } else if ((m = /^([\w.]+)\s*:\s*(.+)$/.exec(text))) {
      state(m[1]!, "to");
      warnings.push(
        `line ${no}: the description of ${m[1]} is not written to StarUML`,
      );
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (blocks.length > 0) {
    fail(lines.at(-1)!.no, `state ${blocks.at(-1)} is never closed with }`);
  }
  return {
    spec: {
      states: [...states.values()],
      transitions,
      ...(notes.length > 0 && { notes }),
    },
    warnings,
  };
}

// ---------------------------------------------------------------- erd

const ERD_RELATION = new RegExp(
  String.raw`^(${ID})\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+(${ID})\s*(?::\s*(.*))?$`,
);

function erDiagram(lines: TextLine[]) {
  const entities = new Map<
    string,
    { name: string; columns: Record<string, unknown>[] }
  >();
  const relationships: Record<string, unknown>[] = [];
  let open: { name: string; columns: Record<string, unknown>[] } | null = null;
  const entity = (ref: string) => {
    const { key, name } = named(ref);
    if (!entities.has(key)) entities.set(key, { name, columns: [] });
    return entities.get(key)!;
  };
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if (open) {
      if (text === "}") open = null;
      else if (!/^(--|\.\.|==|__)/.test(text)) {
        m =
          /^(\*)?\s*([\w$]+)\s*(?::\s*([^<]*?))?\s*((?:<<\s*\w+\s*>>\s*)*)$/.exec(
            text,
          ) ?? fail(no, `cannot read column "${text}"`);
        const flags = m[4]!;
        const type = m[3]?.trim();
        const sized = type ? /^([^(]+)\(([^)]*)\)$/.exec(type) : null;
        open.columns.push({
          name: m[2]!,
          ...(type && { type: sized ? sized[1]! : type }),
          ...(sized && { length: sized[2]! }),
          ...(/PK/.test(flags) && { primaryKey: true }),
          ...(/FK/.test(flags) && { foreignKey: true }),
          ...(/UK/.test(flags) && { unique: true }),
          ...(!m[1] && !/PK/.test(flags) && { nullable: true }),
        });
      }
      continue;
    }
    if ((m = /^entity\s+(.+?)\s*(\{)?$/.exec(text))) {
      const e = entity(adornments(m[1]!).rest);
      if (m[2]) open = e;
    } else if ((m = ERD_RELATION.exec(text))) {
      const from = entity(m[1]!).name;
      const to = entity(m[5]!).name;
      relationships.push({
        from,
        to,
        fromCardinality: LEFT_CARD[m[2]!],
        toCardinality: RIGHT_CARD[m[4]!],
        identifying: m[3] === "--",
        ...(label(m[6]) && { name: label(m[6]) }),
      });
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  return {
    spec: {
      entities: [...entities.values()].map((e) => ({
        name: e.name,
        ...(e.columns.length > 0 && { columns: e.columns }),
      })),
      relationships,
    },
    warnings: [],
  };
}

// ---------------------------------------------------------------- mindmap

interface MindEntry {
  name: string;
  children: MindEntry[];
}

/** * or OrgMode + and - levels; a level's count of its marker is its depth. */
function mindmap(lines: TextLine[]) {
  const stack: MindEntry[] = [];
  let root: MindEntry | undefined;
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    const m =
      /^([*+-]+)(?:\[[^\]]*\])?(_)?\s*(.*)$/.exec(text) ??
      fail(no, `cannot read "${text}"`);
    const depth = m[1]!.length;
    let name = m[3]!;
    if (name.startsWith(":")) {
      // A multi-line node runs from : up to ;.
      name = name.slice(1);
      while (!name.endsWith(";") && i + 1 < lines.length) {
        name += `\n${lines[++i]!.text}`;
      }
      name = name.replace(/;$/, "");
    }
    const node: MindEntry = { name: multiline(name), children: [] };
    if (depth === 1) {
      if (root) refuse(no, "a mind map has one root in StarUML");
      root = node;
    } else {
      const parent = stack[depth - 2] ?? fail(no, "a level is skipped");
      parent.children.push(node);
    }
    stack[depth - 1] = node;
    stack.length = depth;
  }
  const strip = (n: MindEntry): Record<string, unknown> => ({
    name: n.name,
    ...(n.children.length > 0 && { children: n.children.map(strip) }),
  });
  // The first line has depth one, or a level was skipped.
  return { spec: { root: strip(root!) }, warnings: [] };
}

// ---------------------------------------------------------------- entry

const C4_MACRO = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?\s*\(/;

/** Which kind a @startuml diagram is, from what its statements look like. */
function detect(src: Source): Kind | "legacy" {
  const texts = src.lines.map((l) => l.text);
  const has = (re: RegExp) => texts.some((t) => re.test(t));
  if (src.includes.some((i) => /C4/i.test(i)) || has(C4_MACRO)) return "c4";
  if (has(/^state\s/) || has(/\[\*\]/)) return "statemachine";
  if (
    has(/^entity\s/) &&
    (has(/(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)/) ||
      has(/<<\s*(PK|FK)\s*>>/))
  ) {
    return "erd";
  }
  if (has(/\(\*(top)?\)|^===/)) return "legacy";
  if (has(/^(node|artifact)\s/)) return "deployment";
  if (has(/^(component|port|portin|portout)\s|^\[(?!\*\])[^\]]+\]|^\(\)\s/)) {
    return "component";
  }
  if (
    has(
      /^(start|stop|kill|detach|repeat|fork|split)$|^:.*[;|<>\]}/]$|^if\s*\(|^while\s*\(|^\|(?:#\w+\|)?[^|]+\|$/,
    )
  ) {
    return "activity";
  }
  if (
    has(/^(usecase|rectangle)\s|^\(.+\)|^:[^:]+:|^actor\//) ||
    has(/[-.]>?\s*\([^)]+\)(\s*:.*)?$/)
  ) {
    return "usecase";
  }
  if (
    has(
      /^(abstract\s+class|abstract|class|interface|enum|entity|struct|exception|namespace)\s/,
    ) ||
    has(/<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o/)
  ) {
    return "class";
  }
  if (has(/^package\s/)) return "package";
  const other =
    /^(cloud|frame|folder|storage|card|agent|hexagon|object|map|json|robust|concise|clock|binary|analog)\s/;
  const found = src.lines.find((l) => other.test(l.text));
  if (found) {
    refuse(
      found.no,
      `${found.text.split(/\s/)[0]} diagrams are not built; class, sequence, use case, activity, state, IE entity, package, component, deployment and C4 diagrams are`,
    );
  }
  if (has(PARTICIPANT) || has(/-{1,2}>|<-{1,2}/)) return "sequence";
  return fail(src.no, "cannot tell which kind of diagram this is; pass kind");
}

const READERS = {
  class: classDiagram,
  sequence: sequenceDiagram,
  usecase: usecaseDiagram,
  statemachine: stateDiagram,
  erd: erDiagram,
};

/**
 * Reads PlantUML into a kind and its spec. `as` picks the reader where the
 * statements alone do not tell, e.g. activity for an arrow-only graph.
 */
export function parsePlantUml(source: string, as?: Kind): Parsed {
  const src = preprocess(source);
  if (src.lines.length === 0) fail(src.no, "no diagram");
  const titled = {
    ...(src.title !== undefined && { title: src.title }),
    ...(src.direction && { direction: src.direction }),
  };
  const done = (
    kind: Kind,
    read: { spec: Record<string, unknown>; warnings: string[] },
  ) => ({
    kind,
    ...titled,
    spec: read.spec,
    ...(read.warnings.length > 0 && { warnings: read.warnings }),
  });
  if (src.type === "mindmap") return done("mindmap", mindmap(src.lines));
  if (src.type !== "uml") {
    refuse(
      src.no,
      `@start${src.type} diagrams are not built; @startuml (class, sequence, use case, activity, state, IE entity, package, component, deployment, C4) and @startmindmap are`,
    );
  }
  const detected = detect(src);
  if (detected === "c4") {
    return done(
      "c4",
      readC4(
        src.lines,
        (no, message, code) => fail(no, message, code),
        () => false,
      ),
    );
  }
  const kind = as ?? (detected === "legacy" ? "activity" : detected);
  if (kind === "activity") {
    return done(
      kind,
      detected === "activity"
        ? activityDiagram(src.lines)
        : legacyActivity(src.lines),
    );
  }
  if (kind === "package" || kind === "component" || kind === "deployment") {
    return done(
      kind,
      readStructure(src.lines, kind, (no, message, code) =>
        fail(no, message, code),
      ),
    );
  }
  const reader = READERS[kind as keyof typeof READERS];
  if (!reader) {
    refuse(src.no, `PlantUML is not read as ${kind}`);
  }
  return done(kind, reader(src.lines));
}
