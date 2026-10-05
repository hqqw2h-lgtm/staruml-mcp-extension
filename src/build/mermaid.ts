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
import { readC4 } from "./c4.js";
import { isOperation, multiline } from "./members.js";
import type { Direction, Kind, ViewStyle } from "./spec.js";

/*
 * A Mermaid front end for /build_diagram: each supported diagram type is
 * read into the JSON spec of a kind, so names, line breaks and layout are
 * ours rather than the built-in generate_diagram's. Syntax follows
 * mermaid.js.org/syntax (classDiagram, sequenceDiagram, flowchart,
 * erDiagram, stateDiagram, mindmap). Notes become UMLNotes, and the fill,
 * stroke and color of classDef, class, ::: and style become view colours;
 * what a StarUML diagram cannot show (other CSS, click handlers,
 * activations) is skipped.
 */

export interface Parsed {
  kind: Kind;
  title?: string;
  direction?: Direction;
  spec: Record<string, unknown>;
  /** What the text says that the diagram does not show. */
  warnings?: string[];
}

const fail = (
  line: number,
  message: string,
  code: "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX" = "INVALID_ARGUMENT",
): never => {
  throw new ApiError(code, `mermaid line ${line}: ${message}`);
};

interface Line {
  no: number;
  text: string;
  /** Leading whitespace, which only mindmap reads. */
  indent: number;
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
    if (t) {
      const indent = text.length - text.trimStart().length;
      lines.push({ no: i + 1, text: t, indent });
    }
  });
  return { ...(title !== undefined && { title }), lines };
}

export const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");

const CSS: Record<string, keyof ViewStyle> = {
  fill: "fillColor",
  stroke: "lineColor",
  color: "fontColor",
};

/** The colours of a CSS list such as "fill:#f9f,stroke:#333,stroke-width:4px". */
function cssColors(css: string): ViewStyle {
  const style: ViewStyle = {};
  for (const part of css.split(/[,;]/)) {
    const [key, value] = part.split(":").map((p) => p.trim());
    const field = CSS[key!];
    if (field && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value ?? "")) {
      style[field] = value!;
    }
  }
  return style;
}

/**
 * classDef, class, ::: and style statements, resolved at the end since a
 * class may be defined after it is used. classDef default styles every node
 * no class was given to, as in Mermaid.
 */
class Styles {
  private readonly defs = new Map<string, ViewStyle>();
  private readonly classes = new Map<string, string[]>();
  private readonly inline = new Map<string, ViewStyle>();

  /** Reads a classDef, class or style line; false for any other line. */
  line(text: string): boolean {
    let m: RegExpExecArray | null;
    if ((m = /^classDef\s+([\w,-]+)\s+(.+?);?$/.exec(text))) {
      for (const name of m[1]!.split(","))
        this.defs.set(name, cssColors(m[2]!));
    } else if (
      (m = /^(?:class|cssClass)\s+"?([\w,\s-]+?)"?\s+([\w-]+);?$/.exec(text))
    ) {
      for (const id of m[1]!.split(",")) this.use(id.trim(), m[2]!);
    } else if ((m = /^style\s+([\w-]+)\s+(.+?);?$/.exec(text))) {
      this.inline.set(m[1]!, {
        ...this.inline.get(m[1]!),
        ...cssColors(m[2]!),
      });
    } else {
      return false;
    }
    return true;
  }

  use(id: string, cls: string): void {
    this.classes.set(id, [...(this.classes.get(id) ?? []), cls]);
  }

  /** Strips a trailing :::class from `ref`, recording it for the id. */
  suffix(ref: string): string {
    const m = /^(.*?):::([\w-]+)$/.exec(ref.trim());
    if (!m) return ref.trim();
    this.use(m[1]!, m[2]!);
    return m[1]!;
  }

  /** Colours by spec key, for the node ids `keyOf` knows. */
  resolve(
    ids: readonly string[],
    keyOf: (id: string) => string,
  ): Record<string, ViewStyle> | undefined {
    const out: Record<string, ViewStyle> = {};
    for (const id of ids) {
      const classes = this.classes.get(id) ?? ["default"];
      const style = Object.assign(
        {},
        ...classes.map((c) => this.defs.get(c)),
        this.inline.get(id),
      ) as ViewStyle;
      if (Object.keys(style).length > 0) out[keyOf(id)] = style;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

interface Note {
  text: string;
  on?: string[];
  side?: "left" | "right" | "over";
  at?: number;
}

/** A note's lines up to "end note", for the multi-line form. */
function noteBody(lines: Line[], from: number): { text: string; next: number } {
  const body: string[] = [];
  let i = from;
  for (; i < lines.length && !/^end\s*note$/i.test(lines[i]!.text); i++) {
    body.push(lines[i]!.text);
  }
  if (i === lines.length)
    fail(lines[from - 1]!.no, "note is never closed with end note");
  return { text: body.join("\n"), next: i + 1 };
}

/** A `title ...` line, which several Mermaid diagram types accept. */
function takeTitle(lines: Line[]): string | undefined {
  const i = lines.findIndex((l) => /^title\s+/i.test(l.text));
  if (i < 0) return undefined;
  const [line] = lines.splice(i, 1);
  return unquote(line!.text.replace(/^title\s+/i, ""));
}

// ---------------------------------------------------------------- class

export const CLASS_ARROWS: [RegExp, string, boolean][] = [
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
  package?: string;
  attributes: string[];
  operations: string[];
  literals: string[];
}

/**
 * Classes are keyed by their Mermaid id; a label (class Id["Label"]) is the
 * name, as it is what Mermaid draws. A namespace becomes a package that owns
 * the classes declared in it.
 */
function classDiagram(lines: Line[]): Record<string, unknown> {
  const classes = new Map<string, ClassEntry>();
  const packages: string[] = [];
  const relations: { from: string; to: string; [k: string]: unknown }[] = [];
  const notes: Note[] = [];
  const styles = new Styles();
  let namespace: string | undefined;
  const entry = (name: string) => {
    const key = name.replace(/~.*~$/, "");
    let e = classes.get(key);
    if (!e) {
      e = { name: key, attributes: [], operations: [], literals: [] };
      if (namespace !== undefined) e.package = namespace;
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
      (m =
        /^class\s+([\w.~]+)\s*(?:\["([^"]*)"\])?\s*(?::::([\w-]+))?\s*(\{)?\s*$/.exec(
          text,
        ))
    ) {
      const e = entry(m[1]!);
      if (m[2] !== undefined) e.name = multiline(m[2]);
      if (m[3]) styles.use(m[1]!.replace(/~.*~$/, ""), m[3]);
      if (m[4]) open = e;
    } else if ((m = /^note\s+(?:for\s+([\w.]+)\s+)?"(.*)"$/.exec(text))) {
      if (m[1] !== undefined) entry(m[1]);
      notes.push({ text: m[2]!, ...(m[1] !== undefined && { on: [m[1]] }) });
    } else if (styles.line(text)) {
      // classDef, cssClass and style
    } else if ((m = /^namespace\s+([\w.]+)\s*\{$/.exec(text))) {
      namespace = m[1]!;
      if (!packages.includes(namespace)) packages.push(namespace);
    } else if (text === "}" && namespace !== undefined) {
      namespace = undefined;
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
    } else if (!/^(direction\s|click\b|link\b|callback\b|})/.test(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  const nameOf = (key: string) => classes.get(key)!.name;
  const colors = styles.resolve([...classes.keys()], nameOf);
  return {
    ...(packages.length > 0 && { packages }),
    ...(notes.length > 0 && {
      notes: notes.map((n) => ({
        ...n,
        ...(n.on && { on: n.on.map(nameOf) }),
      })),
    }),
    ...(colors && { styles: colors }),
    classes: [...classes.values()].map((e) => ({
      name: e.name,
      ...(e.kind && { kind: e.kind }),
      ...(e.package !== undefined && { package: e.package }),
      ...(e.attributes.length > 0 && { attributes: e.attributes }),
      ...(e.operations.length > 0 && { operations: e.operations }),
      ...(e.literals.length > 0 && { literals: e.literals }),
    })),
    relations: relations.map((r) => ({
      ...r,
      from: nameOf(r.from),
      to: nameOf(r.to),
    })),
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
  const notes: Note[] = [];
  const open: {
    operator: string;
    /** rect or box, which group messages without a fragment. */
    block?: string;
    guard?: string;
    from: number;
    no: number;
    operands: string[];
    starts: number[];
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
        starts: [],
      });
    } else if ((m = /^(rect|box)\b/.exec(text))) {
      // Highlighting and grouping; their end closes nothing StarUML draws.
      open.push({
        operator: "",
        block: m[1]!,
        from: 0,
        no,
        operands: [],
        starts: [],
      });
    } else if ((m = /^(else|and|option)\b\s*(.*)$/.exec(text))) {
      const f = open.at(-1) ?? fail(no, `${m[1]} outside a block`);
      f.operands.push(m[2] || m[1]!);
      f.starts.push(messages.length);
    } else if (text === "end") {
      const f = open.pop() ?? fail(no, "end without a block");
      const to = messages.length - 1;
      if (f.operator && to >= f.from) {
        // An operand without messages of its own has no place to start, and
        // StarUML then divides the fragment evenly.
        const divided = f.starts.every(
          (s, i) => s > (i === 0 ? f.from : f.starts[i - 1]!) && s <= to,
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
    } else if (
      (m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(text))
    ) {
      const side = m[1]!.toLowerCase().split(" ")[0] as Note["side"];
      notes.push({
        text: m[3]!,
        on: m[2]!.split(",").map(who),
        side,
        at: messages.length,
      });
    } else if ((m = MESSAGE.exec(text))) {
      const kind = MESSAGE_ARROWS.find(([a]) => a === m![2])![1];
      messages.push({
        from: who(m[1]!),
        to: who(m[4]!),
        kind,
        ...(m[5] !== undefined && { text: m[5].trim() }),
      });
    } else if (
      !/^(autonumber|activate|deactivate|destroy\b|link\b|links\b)/.test(text)
    ) {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (open.length > 0)
    fail(
      open.at(-1)!.no,
      `${open.at(-1)!.block ?? open.at(-1)!.operator} is never closed with end`,
    );
  return {
    participants,
    messages,
    fragments,
    ...(notes.length > 0 && { notes }),
  };
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
  styles: Styles;
} {
  const styles = new Styles();
  const nodes = new Map<string, FlowNode>();
  const flows: { from: string; to: string; label?: string }[] = [];
  let direction: Direction | undefined;
  const lanes: string[] = [];
  const header = lines.shift()!;
  const dir = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i.exec(header.text);
  if (dir) direction = dir[1]!.toUpperCase().replace("TD", "TB") as Direction;

  /** Reads one node reference at the start of `rest`; returns its id and the remainder. */
  const node = (rest: string, no: number): [string, string] => {
    const id = /^[\w.][\w.-]*?(?=$|[\s[({>&]|--|==|-\.|:::)/.exec(rest)?.[0];
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
    const cls = /^:::([\w-]+)/.exec(after);
    if (cls) {
      styles.use(id, cls[1]!);
      after = after.slice(cls[0].length);
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
    if (styles.line(text) || /^(direction\s|linkStyle\b|click\b)/.test(text))
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
  return {
    ...(direction && { direction }),
    nodes: [...nodes.values()],
    flows,
    styles,
  };
}

function flowchartSpec(lines: Line[]) {
  const { direction, nodes, flows, styles } = flowchart(lines);
  const colors = styles.resolve(
    nodes.map((n) => n.id),
    (id) => id,
  );
  return {
    ...(direction && { direction }),
    spec: {
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, shape: n.shape })),
      flows,
      ...(colors && { styles: colors }),
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
  const { direction, nodes, flows, styles } = flowchart(lines);
  const colors = styles.resolve(
    nodes.map((n) => n.id),
    (id) => id,
  );
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
      ...(colors && { styles: colors }),
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
  const { direction, nodes, flows, styles } = flowchart(lines);
  const round = new Set(["connector", "alternate", "terminator"]);
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  const colors = styles.resolve(
    nodes.map((n) => n.id),
    (id) => names.get(id)!,
  );
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
      ...(colors && { styles: colors }),
    },
  };
}

// ---------------------------------------------------------------- erDiagram

export const LEFT_CARD: Record<string, string> = {
  "|o": "0..1",
  "||": "1",
  "}o": "0..*",
  "}|": "1..*",
};
export const RIGHT_CARD: Record<string, string> = {
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

/**
 * States are keyed by their Mermaid id. A state X { ... } block makes X a
 * composite state and every state first named inside it a nested one; [*]
 * inside a block is that block's own initial or final state.
 */
function stateDiagram(lines: Line[]): Record<string, unknown> {
  const states = new Map<string, Record<string, unknown>>();
  const transitions: Record<string, unknown>[] = [];
  const notes: Note[] = [];
  const styles = new Styles();
  const blocks: string[] = [];
  let starts = 0;
  let ends = 0;
  const declare = (id: string, fields: Record<string, unknown>) => {
    const known = states.get(id);
    if (known) {
      Object.assign(known, fields);
      return;
    }
    states.set(id, {
      id,
      ...fields,
      ...(blocks.length > 0 && { parent: blocks.at(-1)! }),
    });
  };
  const state = (ref: string, side: "from" | "to") => {
    const id = styles.suffix(ref);
    if (id === "[*]") {
      const key =
        side === "from" ? `[*] start ${++starts}` : `[*] end ${++ends}`;
      declare(key, { type: side === "from" ? "initial" : "final" });
      return key;
    }
    if (!states.has(id)) declare(id, { name: id });
    return id;
  };
  for (let i = 0; i < lines.length; i++) {
    const { no, text } = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w-]+)\s*\{$/.exec(text))) {
      // state "Name" as X may come first, naming X before its block.
      const named = m[1] !== undefined || !states.has(m[2]!);
      declare(m[2]!, named ? { name: multiline(m[1] ?? m[2]!) } : {});
      blocks.push(m[2]!);
    } else if (text === "}") {
      if (blocks.pop() === undefined) fail(no, "} without a state block");
    } else if ((m = /^state\s+"([^"]+)"\s+as\s+([\w-]+)$/.exec(text))) {
      declare(m[2]!, { name: multiline(m[1]!) });
    } else if ((m = /^state\s+([\w-]+)\s+<<(choice|fork|join)>>$/.exec(text))) {
      declare(m[1]!, { type: m[2]! });
    } else if (
      (m =
        /^(\[\*\]|[\w-]+(?::::[\w-]+)?)\s*-->\s*(\[\*\]|[\w-]+(?::::[\w-]+)?)\s*(?::\s*(.*))?$/.exec(
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
    } else if (
      (m = /^note\s+(left|right)\s+of\s+([\w-]+)\s*(?::\s*(.*))?$/i.exec(text))
    ) {
      let body = m[3];
      if (body === undefined) {
        const read = noteBody(lines, i + 1);
        body = read.text;
        i = read.next - 1;
      }
      state(m[2]!, "to");
      notes.push({ text: body, on: [m[2]!] });
    } else if (styles.line(text)) {
      // classDef, class and style
    } else if ((m = /^([\w-]+)\s*:(?!::)\s*(.+)$/.exec(text))) {
      state(m[1]!, "to");
      states.get(m[1]!)!.name = multiline(m[2]!);
    } else if (
      (m = /^state\s+([\w-]+)$/.exec(text)) ||
      (m = /^(\w[\w-]*(?::::[\w-]+)?)$/.exec(text))
    ) {
      state(m[1]!, "to");
    } else if (!/^(direction\s|--$)/.test(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (blocks.length > 0) {
    fail(lines.at(-1)!.no, `state ${blocks.at(-1)} is never closed with }`);
  }
  const colors = styles.resolve([...states.keys()], (id) => id);
  return {
    states: [...states.values()],
    transitions,
    ...(notes.length > 0 && { notes }),
    ...(colors && { styles: colors }),
  };
}

// ---------------------------------------------------------------- mindmap

interface MindEntry {
  name: string;
  children: MindEntry[];
}

/** Mermaid's node shapes, outermost delimiters first. */
const MIND_SHAPE =
  /^[\w-]*\s*(?:\[\[?|\(\(|\(|\)\)|\)|\{\{)(.*?)(?:\]\]?|\)\)|\)|\(\(|\(|\}\})$/;

/**
 * A mindmap: each line a node, a child of the nearest line above it that is
 * indented less. ::icon() lines and :::class suffixes are styling.
 */
function mindmap(lines: Line[]): Record<string, unknown> {
  const stack: { indent: number; node: MindEntry }[] = [];
  let root: MindEntry | undefined;
  for (const { no, text, indent } of lines) {
    if (/^::icon\(/.test(text)) continue;
    const bare = text.replace(/\s*:::.*$/, "");
    const shaped = MIND_SHAPE.exec(bare);
    const node: MindEntry = {
      name: multiline(unquote(shaped ? shaped[1]! : bare)),
      children: [],
    };
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (parent) parent.node.children.push(node);
    else if (root)
      fail(no, "a mindmap has one root; indent this line under it");
    else root = node;
    stack.push({ indent, node });
  }
  if (!root) fail(1, "mindmap has no root");
  const strip = (n: MindEntry): Record<string, unknown> => ({
    name: n.name,
    ...(n.children.length > 0 && { children: n.children.map(strip) }),
  });
  return { root: strip(root!) };
}

// ---------------------------------------------------------------- requirement

const REQUIREMENT_KEYWORDS: Record<string, string> = {
  requirement: "requirement",
  functionalrequirement: "functional",
  interfacerequirement: "interface",
  performancerequirement: "performance",
  physicalrequirement: "physical",
  designconstraint: "design",
};

const NAME = String.raw`"[^"]+"|[\w.-]+`;

/**
 * A requirementDiagram (mermaid.js.org/syntax/requirementDiagram): typed
 * requirements and elements in { } blocks of key: value lines, and
 * relations written a - type -> b or b <- type - a.
 */
function requirementDiagram(lines: Line[]): Record<string, unknown> {
  const requirements: Record<string, unknown>[] = [];
  const elements: Record<string, unknown>[] = [];
  const relations: Record<string, unknown>[] = [];
  const styles = new Styles();
  const names: string[] = [];
  let open: Record<string, unknown> | null = null;
  let isElement = false;
  const forward = new RegExp(`^(${NAME})\\s*-\\s*(\\w+)\\s*->\\s*(${NAME})$`);
  const backward = new RegExp(`^(${NAME})\\s*<-\\s*(\\w+)\\s*-\\s*(${NAME})$`);
  const relation = (from: string, type: string, to: string, no: number) => {
    if (
      ![
        "contains",
        "copies",
        "derives",
        "satisfies",
        "verifies",
        "refines",
        "traces",
      ].includes(type)
    ) {
      fail(no, `unknown relation ${type}`);
    }
    relations.push({ from: unquote(from), to: unquote(to), type });
  };
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    if (open) {
      if (text === "}") {
        (isElement ? elements : requirements).push(open);
        open = null;
        continue;
      }
      m =
        /^(\w+)\s*:\s*(.*?)\s*$/.exec(text) ??
        fail(no, `cannot read "${text}"`);
      const key = m[1]!.toLowerCase();
      const value = unquote(m[2]!);
      const field = isElement
        ? { type: "type", docref: "docRef" }[key]
        : {
            id: "id",
            text: "text",
            risk: "risk",
            verifymethod: "verifyMethod",
          }[key];
      if (!field) fail(no, `unknown field ${m[1]}`);
      open[field!] =
        field === "risk" || field === "verifyMethod"
          ? value.toLowerCase()
          : multiline(value);
      continue;
    }
    if (
      (m = new RegExp(`^(\\w+)\\s+(${NAME})\\s*(?::::([\\w-]+))?\\s*\\{$`).exec(
        text,
      ))
    ) {
      const keyword = m[1]!.toLowerCase();
      const type = REQUIREMENT_KEYWORDS[keyword];
      if (keyword !== "element" && !type)
        fail(no, `unknown requirement type ${m[1]}`);
      const name = multiline(unquote(m[2]!));
      if (m[3]) styles.use(name, m[3]);
      names.push(name);
      isElement = keyword === "element";
      open = isElement
        ? { name }
        : { name, ...(type !== "requirement" && { type }) };
    } else if ((m = forward.exec(text))) {
      relation(m[1]!, m[2]!, m[3]!, no);
    } else if ((m = backward.exec(text))) {
      relation(m[3]!, m[2]!, m[1]!, no);
    } else if (!styles.line(text) && !/^direction\s/.test(text)) {
      fail(no, `cannot read "${text}"`);
    }
  }
  if (open)
    fail(lines.at(-1)!.no, `${String(open.name)} is never closed with }`);
  const colors = styles.resolve(names, (n) => n);
  return {
    requirements,
    elements,
    relations: relations.map((r) => ({
      ...r,
      from: multiline(String(r.from)),
      to: multiline(String(r.to)),
    })),
    ...(colors && { styles: colors }),
  };
}

// ---------------------------------------------------------------- entry

const HEADERS: [RegExp, Kind][] = [
  [/^requirementDiagram\b/, "requirement"],
  [/^C4(Context|Container|Component)\b/, "c4"],
  [/^classDiagram(-v2)?\b/, "class"],
  [/^sequenceDiagram\b/, "sequence"],
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^erDiagram\b/, "erd"],
  [/^stateDiagram(-v2)?\b/, "statemachine"],
  [/^mindmap\b/, "mindmap"],
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
  if (/^C4(Dynamic|Deployment)\b/.test(header.text)) {
    fail(
      header.no,
      `${header.text.split(/\s/)[0]} is not built: StarUML 7.1.1 has no C4 dynamic or deployment elements; C4Context, C4Container and C4Component are`,
      "UNSUPPORTED_SYNTAX",
    );
  }
  if (!found) {
    return fail(
      header.no,
      `unsupported diagram "${header.text.split(/\s/)[0]}"; expected classDiagram, sequenceDiagram, flowchart, erDiagram, stateDiagram, mindmap, requirementDiagram or C4Context/C4Container/C4Component`,
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
    case "mindmap":
      return { kind, ...titled, spec: mindmap(body()) };
    case "requirement":
      return { kind, ...titled, spec: requirementDiagram(body()) };
    case "c4": {
      // C4 diagrams take their title as a title line inside the body too.
      const { spec, warnings } = readC4(body(), fail, () => false);
      return {
        kind,
        ...titled,
        spec,
        ...(warnings.length > 0 && { warnings }),
      };
    }
    case "activity":
      return { kind, ...titled, ...activitySpec(lines) };
    case "usecase":
      return { kind, ...titled, ...usecaseSpec(lines) };
    default:
      return { kind, ...titled, ...flowchartSpec(lines) };
  }
}
