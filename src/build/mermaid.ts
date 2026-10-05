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
import { isOperation, multiline } from "./members.js";
import type { Direction, Kind } from "./spec.js";

/*
 * A Mermaid front end for /build_diagram: each supported diagram type is
 * read into the JSON spec of a kind, so names, line breaks and layout are
 * ours rather than the built-in generate_diagram's. Syntax follows
 * mermaid.js.org/syntax (classDiagram, sequenceDiagram, flowchart,
 * erDiagram, stateDiagram); what a StarUML diagram cannot show (styles,
 * notes, click handlers, activations) is skipped.
 */

export interface Parsed {
  kind: Kind;
  title?: string;
  direction?: Direction;
  spec: Record<string, unknown>;
}

const fail = (line: number, message: string): never => {
  throw new ApiError("INVALID_ARGUMENT", `mermaid line ${line}: ${message}`);
};

interface Line {
  no: number;
  text: string;
}

/** Strips front matter (keeping its title), %% comments and blank lines. */
export function preprocess(source: string): { title?: string; lines: Line[] } {
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  let title: string | undefined;
  let start = 0;
  if (raw[0]?.trim() === "---") {
    const end = raw.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end < 0) fail(1, "front matter is not closed with ---");
    for (const l of raw.slice(1, end)) {
      const m = /^\s*title\s*:\s*(.+?)\s*$/.exec(l);
      if (m) title = unquote(m[1]!);
    }
    start = end + 1;
  }
  const lines: Line[] = [];
  raw.forEach((text, i) => {
    if (i < start) return;
    const t = text.replace(/%%.*$/, "").trim();
    if (t) lines.push({ no: i + 1, text: t });
  });
  return { ...(title !== undefined && { title }), lines };
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");

/** A `title ...` line, which several Mermaid diagram types accept. */
function takeTitle(lines: Line[]): string | undefined {
  const i = lines.findIndex((l) => /^title\s+/i.test(l.text));
  if (i < 0) return undefined;
  const [line] = lines.splice(i, 1);
  return unquote(line!.text.replace(/^title\s+/i, ""));
}

// ---------------------------------------------------------------- class

const CLASS_ARROWS: [RegExp, string, boolean][] = [
  // [arrow, relation type, whether the arrow points from the second name]
  [/^<\|--$/, "generalization", true],
  [/^--\|>$/, "generalization", false],
  [/^<\|\.\.$/, "realization", true],
  [/^\.\.\|>$/, "realization", false],
  [/^\*--$/, "composition", true],
  [/^--\*$/, "composition", false],
  [/^o--$/, "aggregation", true],
  [/^--o$/, "aggregation", false],
  [/^-->$/, "directed", false],
  [/^<--$/, "directed", true],
  [/^\.\.>$/, "dependency", false],
  [/^<\.\.$/, "dependency", true],
  [/^--$/, "association", false],
  [/^\.\.$/, "dependency", false],
];

const RELATION =
  /^([\w.]+)\s*(?:"([^"]*)"\s*)?(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|--|\.\.)\s*(?:"([^"]*)"\s*)?([\w.]+)\s*(?::\s*(.*))?$/;

interface ClassEntry {
  name: string;
  kind?: string;
  attributes: string[];
  operations: string[];
  literals: string[];
}

function classDiagram(lines: Line[]): Record<string, unknown> {
  const classes = new Map<string, ClassEntry>();
  const relations: Record<string, unknown>[] = [];
  const entry = (name: string) => {
    const key = name.replace(/~.*~$/, "");
    let e = classes.get(key);
    if (!e) {
      e = { name: key, attributes: [], operations: [], literals: [] };
      classes.set(key, e);
    }
    return e;
  };
  const annotate = (e: ClassEntry, annotation: string) => {
    const a = annotation.toLowerCase();
    if (a === "interface") e.kind = "interface";
    else if (a === "enumeration" || a === "enum") e.kind = "enum";
    else if (a === "abstract") e.kind = "abstract";
  };
  const member = (e: ClassEntry, text: string) => {
    if (/^<<(.+)>>$/.test(text)) annotate(e, text.slice(2, -2));
    else if (e.kind === "enum") e.literals.push(text);
    else if (isOperation(text)) e.operations.push(text);
    else e.attributes.push(text);
  };
  let open: ClassEntry | null = null;
  for (const { no, text } of lines) {
    if (open) {
      if (text === "}") open = null;
      else member(open, text);
      continue;
    }
    let m: RegExpExecArray | null;
    if (
      (m = /^class\s+([\w.~]+)\s*(?:\["([^"]*)"\])?\s*(\{)?\s*$/.exec(text))
    ) {
      const e = entry(m[1]!);
      if (m[3]) open = e;
    } else if ((m = /^<<(.+)>>\s+([\w.]+)$/.exec(text))) {
      annotate(entry(m[2]!), m[1]!);
    } else if ((m = RELATION.exec(text))) {
      const [, a, aCard, arrow, bCard, b, label] = m;
      const [, type, reversed] = CLASS_ARROWS.find(([re]) => re.test(arrow!))!;
      entry(a!);
      entry(b!);
      const [from, to, fromMul, toMul] = reversed
        ? [b!, a!, bCard, aCard]
        : [a!, b!, aCard, bCard];
      relations.push({
        from,
        to,
        type,
        ...(label && { name: label.trim() }),
        ...(fromMul !== undefined && { fromMultiplicity: fromMul }),
        ...(toMul !== undefined && { toMultiplicity: toMul }),
      });
    } else if ((m = /^([\w.]+)\s*:\s*(.+)$/.exec(text))) {
      member(entry(m[1]!), m[2]!.trim());
    } else if (
      !/^(direction\s|note\b|style\b|classDef\b|cssClass\b|click\b|link\b|callback\b|namespace\b|})/.test(
        text,
      )
    ) {
      fail(no, `cannot read "${text}"`);
    }
  }
  return {
    classes: [...classes.values()].map((e) => ({
      name: e.name,
      ...(e.kind && { kind: e.kind }),
      ...(e.attributes.length > 0 && { attributes: e.attributes }),
      ...(e.operations.length > 0 && { operations: e.operations }),
      ...(e.literals.length > 0 && { literals: e.literals }),
    })),
    relations,
  };
}

// ---------------------------------------------------------------- sequence

const MESSAGE_ARROWS: [string, string][] = [
  ["-->>", "reply"],
  ["->>", "sync"],
  ["--x", "async"],
  ["-x", "async"],
  ["--)", "async"],
  ["-)", "async"],
  ["-->", "reply"],
  ["->", "sync"],
];

const MESSAGE =
  /^([^\s:+-][^:]*?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::\s*(.*))?$/;

function sequenceDiagram(lines: Line[]): Record<string, unknown> {
  const participants: { name: string; kind?: string }[] = [];
  const aliases = new Map<string, string>();
  const messages: Record<string, unknown>[] = [];
  const fragments: Record<string, unknown>[] = [];
  const open: {
    operator: string;
    guard?: string;
    from: number;
    no: number;
    operands: string[];
  }[] = [];
  const who = (id: string) => aliases.get(id.trim()) ?? id.trim();
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(text))) {
      const name = multiline(m[3] ?? m[2]!);
      aliases.set(m[2]!, name);
      participants.push({ name, ...(m[1] === "actor" && { kind: "actor" }) });
    } else if (
      (m = /^create\s+(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(text))
    ) {
      const name = multiline(m[3] ?? m[2]!);
      aliases.set(m[2]!, name);
      participants.push({ name, ...(m[1] === "actor" && { kind: "actor" }) });
    } else if (
      (m = /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/.exec(text))
    ) {
      open.push({
        operator: m[1]!,
        ...(m[2] && { guard: m[2] }),
        from: messages.length,
        no,
        operands: [],
      });
    } else if ((m = /^(else|and|option)\b\s*(.*)$/.exec(text))) {
      const f = open.at(-1) ?? fail(no, `${m[1]} outside a block`);
      f.operands.push(m[2] || m[1]!);
    } else if (text === "end") {
      const f = open.pop() ?? fail(no, "end without a block");
      if (messages.length > f.from) {
        fragments.push({
          operator: f.operator,
          ...(f.guard && { guard: f.guard }),
          ...(f.operands.length > 0 && { operands: f.operands }),
          from: f.from,
          to: messages.length - 1,
        });
      }
    } else if ((m = MESSAGE.exec(text))) {
      const kind = MESSAGE_ARROWS.find(([a]) => a === m![2])![1];
      messages.push({
        from: who(m[1]!),
        to: who(m[4]!),
        kind,
        ...(m[5] !== undefined && { text: m[5].trim() }),
      });
    } else if (
      !/^(autonumber|activate|deactivate|note\b|Note\b|rect\b|box\b|destroy\b|link\b|links\b)/.test(
        text,
      )
    ) {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (open.length > 0)
    fail(open.at(-1)!.no, `${open.at(-1)!.operator} is never closed with end`);
  return { participants, messages, fragments };
}

// ---------------------------------------------------------------- flowchart

interface FlowNode {
  id: string;
  name: string;
  shape: string;
  lane?: string;
}

/** Node shapes, longest delimiters first; the shape names are FLOWCHART_SHAPES keys. */
const SHAPES: [string, string, string][] = [
  ["([", "])", "terminator"],
  ["[[", "]]", "predefined"],
  ["[(", ")]", "database"],
  ["((", "))", "connector"],
  ["{{", "}}", "preparation"],
  ["[/", "/]", "data"],
  ["[\\", "\\]", "data"],
  ["[/", "\\]", "manualInput"],
  ["(", ")", "alternate"],
  ["[", "]", "process"],
  ["{", "}", "decision"],
  [">", "]", "document"],
];

const LINK =
  /^\s*(?:(-->|---|-\.->|-\.-|==>|===|--o|--x|<-->)(?:\|([^|]*)\|)?|--\s+([^-]+?)\s+-->|-\.\s+([^.]+?)\s+\.->|==\s+([^=]+?)\s+==>)\s*/;

function flowchart(lines: Line[]): {
  direction?: Direction;
  nodes: FlowNode[];
  flows: { from: string; to: string; label?: string }[];
} {
  const nodes = new Map<string, FlowNode>();
  const flows: { from: string; to: string; label?: string }[] = [];
  let direction: Direction | undefined;
  const lanes: string[] = [];
  const header = lines.shift()!;
  const dir = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i.exec(header.text);
  if (dir) direction = dir[1]!.toUpperCase().replace("TD", "TB") as Direction;

  /** Reads one node reference at the start of `rest`; returns its id and the remainder. */
  const node = (rest: string, no: number): [string, string] => {
    const id = /^[\w.][\w.-]*?(?=$|[\s[({>&]|--|==|-\.)/.exec(rest)?.[0];
    if (!id) return fail(no, `expected a node at "${rest}"`);
    let after = rest.slice(id.length);
    let shape: string | undefined;
    let label: string | undefined;
    for (const [open, close, s] of SHAPES) {
      if (after.startsWith(open)) {
        const end = after.indexOf(close, open.length);
        if (end < 0) continue;
        shape = s;
        label = unquote(after.slice(open.length, end));
        after = after.slice(end + close.length);
        break;
      }
    }
    const existing = nodes.get(id);
    if (!existing) {
      nodes.set(id, {
        id,
        name: multiline(label ?? id),
        shape: shape ?? "process",
        ...(lanes.length > 0 && { lane: lanes.at(-1)! }),
      });
    } else if (shape !== undefined) {
      existing.name = multiline(label!);
      existing.shape = shape;
    }
    return [id, after.trimStart()];
  };

  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^subgraph\s+(?:([\w-]+)\s*\[(.+)\]|(.+))$/.exec(text))) {
      lanes.push(multiline(unquote(m[2] ?? m[3]!)));
      continue;
    }
    if (text === "end") {
      if (lanes.pop() === undefined) fail(no, "end without a subgraph");
      continue;
    }
    if (
      /^(direction\s|classDef\b|class\s|style\b|linkStyle\b|click\b)/.test(text)
    )
      continue;
    let [from, rest] = node(text, no);
    while (rest) {
      const link = LINK.exec(rest);
      if (!link) fail(no, `expected a link at "${rest}"`);
      const label = link![2] ?? link![3] ?? link![4] ?? link![5];
      const [to, after] = node(rest.slice(link![0].length), no);
      flows.push({ from, to, ...(label && { label: label.trim() }) });
      from = to;
      rest = after;
    }
  }
  if (lanes.length > 0)
    fail(lines.at(-1)!.no, "subgraph is never closed with end");
  return { ...(direction && { direction }), nodes: [...nodes.values()], flows };
}

function flowchartSpec(lines: Line[]) {
  const { direction, nodes, flows } = flowchart(lines);
  return {
    ...(direction && { direction }),
    spec: {
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, shape: n.shape })),
      flows,
    },
  };
}

/**
 * A flowchart read as an activity: a stadium ([...]) or circle ((...)) with
 * no incoming flow is the initial node and one with no outgoing flow a final
 * node, a rhombus {...} a decision (a merge when it has several incoming
 * flows and one outgoing), a hexagon {{...}} a fork (a join when it has
 * several incoming), anything else an action; subgraphs are swimlanes and
 * link labels guards.
 */
function activitySpec(lines: Line[]) {
  const { direction, nodes, flows } = flowchart(lines);
  const count = (id: string, end: "from" | "to") =>
    flows.filter((f) => f[end] === id).length;
  const type = (n: FlowNode) => {
    const ins = count(n.id, "to");
    const outs = count(n.id, "from");
    switch (n.shape) {
      case "terminator":
      case "connector":
        return ins === 0 ? "initial" : outs === 0 ? "final" : "action";
      case "decision":
        return ins > 1 && outs <= 1 ? "merge" : "decision";
      case "preparation":
        return ins > 1 ? "join" : "fork";
      default:
        return "action";
    }
  };
  const lanes = [...new Set(nodes.flatMap((n) => (n.lane ? [n.lane] : [])))];
  return {
    ...(direction && { direction }),
    spec: {
      ...(lanes.length > 0 && { lanes }),
      nodes: nodes.map((n) => {
        const t = type(n);
        return {
          id: n.id,
          ...(t === "action" || t === "decision" || t === "merge"
            ? { name: n.name }
            : {}),
          type: t,
          ...(n.lane && { lane: n.lane }),
        };
      }),
      flows: flows.map((f) => ({
        from: f.from,
        to: f.to,
        ...(f.label && { guard: f.label }),
      })),
    },
  };
}

/**
 * A flowchart read as a use case diagram: round shapes ((...)), (...) and
 * ([...]) are use cases, other nodes actors; a subgraph is the system
 * boundary; a link labelled include, extend or generalization is that
 * relationship, other links associations.
 */
function usecaseSpec(lines: Line[]) {
  const { direction, nodes, flows } = flowchart(lines);
  const round = new Set(["connector", "alternate", "terminator"]);
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  const system = nodes.find((n) => n.lane)?.lane;
  return {
    ...(direction && { direction }),
    spec: {
      ...(system && { system }),
      actors: nodes.filter((n) => !round.has(n.shape)).map((n) => n.name),
      useCases: nodes.filter((n) => round.has(n.shape)).map((n) => n.name),
      relations: flows.map((f) => {
        const label = f.label
          ?.replace(/[«»<>]/g, "")
          .trim()
          .toLowerCase();
        const type =
          label === "include" ||
          label === "extend" ||
          label === "generalization"
            ? label
            : "association";
        return {
          from: names.get(f.from)!,
          to: names.get(f.to)!,
          type,
          ...(type === "association" && f.label && { name: f.label }),
        };
      }),
    },
  };
}

// ---------------------------------------------------------------- erDiagram

const LEFT_CARD: Record<string, string> = {
  "|o": "0..1",
  "||": "1",
  "}o": "0..*",
  "}|": "1..*",
};
const RIGHT_CARD: Record<string, string> = {
  "o|": "0..1",
  "||": "1",
  "o{": "0..*",
  "|{": "1..*",
};

function erDiagram(lines: Line[]): Record<string, unknown> {
  const entities = new Map<string, string[]>();
  const relationships: Record<string, unknown>[] = [];
  const entity = (name: string) => {
    const key = unquote(name);
    if (!entities.has(key)) entities.set(key, []);
    return entities.get(key)!;
  };
  let open: string[] | null = null;
  for (const { no, text } of lines) {
    if (open) {
      if (text === "}") open = null;
      else {
        // type name [PK|FK|UK, ...] ["comment"]: a StarUML column is name type flags.
        const m =
          /^(\S+)\s+(\S+)((?:\s+(?:PK|FK|UK)\s*,?)*)/.exec(text) ??
          fail(no, `cannot read attribute "${text}"`);
        open.push(
          [
            m[2],
            m[1],
            ...m[3]!.replace(/,/g, " ").split(/\s+/).filter(Boolean),
          ].join(" "),
        );
      }
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^("[^"]+"|[\w-]+)\s*\{$/.exec(text))) {
      open = entity(m[1]!);
    } else if (
      (m =
        /^("[^"]+"|[\w-]+)\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+("[^"]+"|[\w-]+)\s*(?::\s*(.*))?$/.exec(
          text,
        ))
    ) {
      entity(m[1]!);
      entity(m[5]!);
      relationships.push({
        from: unquote(m[1]!),
        to: unquote(m[5]!),
        fromCardinality: LEFT_CARD[m[2]!],
        toCardinality: RIGHT_CARD[m[4]!],
        identifying: m[3] === "--",
        ...(m[6] && { name: unquote(m[6]) }),
      });
    } else if ((m = /^("[^"]+"|[\w-]+)$/.exec(text))) {
      entity(m[1]!);
    } else if (!/^direction\s/.test(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  return {
    entities: [...entities].map(([name, columns]) => ({
      name,
      ...(columns.length > 0 && { columns }),
    })),
    relationships,
  };
}

// ---------------------------------------------------------------- state

function stateDiagram(lines: Line[]): Record<string, unknown> {
  const states = new Map<string, Record<string, unknown>>();
  const transitions: Record<string, unknown>[] = [];
  let starts = 0;
  let ends = 0;
  const state = (id: string, side: "from" | "to") => {
    if (id === "[*]") {
      const key =
        side === "from" ? `[*] start ${++starts}` : `[*] end ${++ends}`;
      states.set(key, { id: key, type: side === "from" ? "initial" : "final" });
      return key;
    }
    if (!states.has(id)) states.set(id, { id, name: id });
    return id;
  };
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^state\s+"([^"]+)"\s+as\s+([\w-]+)$/.exec(text))) {
      states.set(m[2]!, { id: m[2]!, name: multiline(m[1]!) });
    } else if ((m = /^state\s+([\w-]+)\s+<<(choice|fork|join)>>$/.exec(text))) {
      states.set(m[1]!, { id: m[1]!, type: m[2]! });
    } else if (
      (m = /^(\[\*\]|[\w-]+)\s*-->\s*(\[\*\]|[\w-]+)\s*(?::\s*(.*))?$/.exec(
        text,
      ))
    ) {
      const from = state(m[1]!, "from");
      const to = state(m[2]!, "to");
      const label = m[3]?.trim();
      const guard = label ? /\[([^\]]*)\]/.exec(label) : null;
      const trigger = label?.replace(/\[[^\]]*\]/, "").trim();
      transitions.push({
        from,
        to,
        ...(trigger && { trigger }),
        ...(guard && { guard: guard[1] }),
      });
    } else if ((m = /^([\w-]+)\s*:\s*(.+)$/.exec(text))) {
      state(m[1]!, "to");
      states.get(m[1]!)!.name = multiline(m[2]!);
    } else if (
      (m = /^state\s+([\w-]+)$/.exec(text)) ||
      (m = /^(\w[\w-]*)$/.exec(text))
    ) {
      state(m[1]!, "to");
    } else if (!/^(direction\s|note\b|classDef\b|class\s|--$)/.test(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  return { states: [...states.values()], transitions };
}

// ---------------------------------------------------------------- entry

const HEADERS: [RegExp, Kind][] = [
  [/^classDiagram(-v2)?\b/, "class"],
  [/^sequenceDiagram\b/, "sequence"],
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^erDiagram\b/, "erd"],
  [/^stateDiagram(-v2)?\b/, "statemachine"],
];

/**
 * Reads Mermaid into a kind and its spec. A flowchart is read as a
 * flowchart unless `as` asks for an activity or use case diagram.
 */
export function parseMermaid(source: string, as?: Kind): Parsed {
  const { title: front, lines } = preprocess(source);
  if (lines.length === 0) fail(1, "no diagram");
  const title = front ?? takeTitle(lines);
  const header = lines[0]!;
  const found = HEADERS.find(([re]) => re.test(header.text));
  if (!found) {
    return fail(
      header.no,
      `unsupported diagram "${header.text.split(/\s/)[0]}"; expected classDiagram, sequenceDiagram, flowchart, erDiagram or stateDiagram`,
    );
  }
  let kind = found[1];
  if (kind === "flowchart" && (as === "activity" || as === "usecase"))
    kind = as;
  else if (as !== undefined && as !== kind) {
    fail(header.no, `${header.text.split(/\s/)[0]} cannot be built as ${as}`);
  }
  const titled = title !== undefined ? { title: multiline(title) } : {};
  const body = () => lines.slice(1);
  switch (kind) {
    case "class":
      return { kind, ...titled, spec: classDiagram(body()) };
    case "sequence":
      return { kind, ...titled, spec: sequenceDiagram(body()) };
    case "erd":
      return { kind, ...titled, spec: erDiagram(body()) };
    case "statemachine":
      return { kind, ...titled, spec: stateDiagram(body()) };
    case "activity":
      return { kind, ...titled, ...activitySpec(lines) };
    case "usecase":
      return { kind, ...titled, ...usecaseSpec(lines) };
    default:
      return { kind, ...titled, ...flowchartSpec(lines) };
  }
}
