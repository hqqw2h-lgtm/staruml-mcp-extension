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

import type {
  ActivitySpec,
  ClassSpec,
  Direction,
  ErdSpec,
  Extracted,
  FlowchartSpec,
  MindNode,
  NoteSpec,
  SequenceSpec,
  StateSpec,
  UsecaseSpec,
} from "./model.js";
import { scopeOf } from "./model.js";
import type { C4Spec, RequirementSpec } from "./model.js";
import { c4Level, c4Macros } from "./c4-writer.js";

/*
 * Writes the specs read from a diagram as Mermaid that /build_diagram reads
 * back into the same nodes and edges (src/build/mermaid.ts), following
 * mermaid.js.org/syntax. Use case and activity diagrams have no Mermaid
 * type and are written as flowcharts in the shape build_diagram reads as
 * that kind.
 */

/** Line breaks as Mermaid writes them; double quotes would end a label. */
export const text = (name: string) =>
  name.replace(/\r?\n/g, "<br/>").replace(/"/g, "'");

const isWord = (name: string) => /^[A-Za-z_][\w.]*$/.test(name);

/** Ids for names that are not Mermaid words, kept stable per name. */
class Ids {
  private readonly ids = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  get(name: string): string {
    if (isWord(name)) return name;
    let id = this.ids.get(name);
    if (!id) {
      id = `${this.prefix}${this.ids.size}`;
      this.ids.set(name, id);
    }
    return id;
  }
}

function classDiagram(
  spec: ClassSpec,
  notes: readonly NoteSpec[],
): { lines: string[]; warnings: string[] } {
  const ids = new Ids("C");
  const warnings: string[] = [];
  const lines = ["classDiagram"];
  const write = (c: ClassSpec["classes"][number], indent: string) => {
    const id = ids.get(c.name);
    const annotation = {
      class: [],
      abstract: ["<<abstract>>"],
      interface: ["<<interface>>"],
      enum: ["<<enumeration>>"],
    }[c.kind];
    const members = [
      ...annotation,
      ...c.attributes,
      ...c.operations,
      ...c.literals,
    ];
    const head = `${indent}class ${id}${id === c.name ? "" : `["${text(c.name)}"]`}`;
    if (members.length === 0) {
      lines.push(head);
      return;
    }
    lines.push(`${head} {`);
    for (const m of members) lines.push(`${indent}  ${m}`);
    lines.push(`${indent}}`);
  };
  for (const pkg of spec.packages) {
    lines.push(`  namespace ${pkg.replace(/\W/g, "_")} {`);
    for (const c of spec.classes) if (c.package === pkg) write(c, "    ");
    lines.push("  }");
  }
  for (const c of spec.classes) if (c.package === undefined) write(c, "  ");
  for (const r of spec.relations) {
    const from = ids.get(r.from);
    const to = ids.get(r.to);
    const card = (m: string | undefined) => (m ? ` "${m}"` : "");
    const cardAfter = (m: string | undefined) => (m ? `"${m}" ` : "");
    const label = r.name ? ` : ${text(r.name)}` : "";
    // The arrows build_diagram reads (CLASS_ARROWS); the parent of a
    // generalization comes first, as does the whole of an aggregation or
    // composition, which is also its `from`.
    const line =
      {
        generalization: `${to} <|-- ${from}`,
        realization: `${to} <|.. ${from}`,
        composition: `${from}${card(r.fromMultiplicity)} *-- ${cardAfter(r.toMultiplicity)}${to}`,
        aggregation: `${from}${card(r.fromMultiplicity)} o-- ${cardAfter(r.toMultiplicity)}${to}`,
        directed: `${from}${card(r.fromMultiplicity)} --> ${cardAfter(r.toMultiplicity)}${to}`,
        dependency: `${from} ..> ${to}`,
      }[r.type] ??
      `${from}${card(r.fromMultiplicity)} -- ${cardAfter(r.toMultiplicity)}${to}`;
    lines.push(`  ${line}${label}`);
  }
  for (const n of notes) {
    // A Mermaid note is on one class at most.
    if (n.on.length > 1)
      warnings.push(`a note on ${n.on.length} classes is written on the first`);
    lines.push(
      `  note ${n.on[0] !== undefined ? `for ${ids.get(n.on[0])} ` : ""}"${text(n.text)}"`,
    );
  }
  return { lines, warnings };
}

const ARROWS: Record<string, string> = {
  sync: "->>",
  async: "-)",
  reply: "-->>",
  create: "->>",
  delete: "-x",
};

/** Mermaid's block keywords for an operator, with its operand separator. */
const BLOCKS: Record<string, string> = {
  alt: "else",
  opt: "else",
  loop: "else",
  break: "else",
  par: "and",
  critical: "option",
};

function sequenceDiagram(
  spec: SequenceSpec,
  notes: readonly NoteSpec[],
): {
  lines: string[];
  warnings: string[];
} {
  const lines = ["sequenceDiagram"];
  const warnings: string[] = [];
  const ids = new Ids("P");
  for (const p of spec.participants) {
    const id = ids.get(p);
    lines.push(`  participant ${id}${id === p ? "" : ` as ${text(p)}`}`);
  }
  const fragments = spec.fragments.filter((f) => {
    if (BLOCKS[f.operator]) return true;
    warnings.push(`a ${f.operator} fragment has no Mermaid block`);
    return false;
  });
  const depth = () => "  ".repeat(1 + open.length);
  const open: number[] = [];
  const note = (n: NoteSpec) => {
    if (n.on.length === 0) {
      warnings.push("a note on no lifeline is not written");
      return;
    }
    const where = n.side === "over" ? "over" : `${n.side} of`;
    lines.push(
      `${depth()}Note ${where} ${n.on.map((p) => ids.get(p)).join(",")}: ${text(n.text)}`,
    );
  };
  const operand = (f: (typeof fragments)[number], k: number, level: number) =>
    lines.push(
      `${"  ".repeat(level)}${BLOCKS[f.operator]} ${text(f.operands[k]!)}`.trimEnd(),
    );
  spec.messages.forEach((m, i) => {
    for (const n of notes) if (n.at === i) note(n);
    open.forEach((j, level) => {
      const f = fragments[j]!;
      const k = f.operandStarts?.indexOf(i) ?? -1;
      if (k >= 0) operand(f, k, level + 1);
    });
    fragments.forEach((f, j) => {
      if (f.from !== i) return;
      lines.push(
        `${depth()}${f.operator}${f.guard ? ` ${text(f.guard)}` : ""}`,
      );
      open.push(j);
    });
    lines.push(
      `${depth()}${ids.get(m.from)}${ARROWS[m.kind]}${ids.get(m.to)}: ${text(m.text)}`,
    );
    while (open.length > 0 && fragments[open.at(-1)!]!.to === i) {
      const f = fragments[open.pop()!]!;
      // Operands without a recorded start (a fragment never drawn has no
      // operand views to read them from) close the block, empty.
      if (!f.operandStarts) {
        f.operands.forEach((_, k) => operand(f, k, open.length + 1));
      }
      lines.push(`${depth()}end`);
    }
  });
  for (const n of notes)
    if ((n.at ?? spec.messages.length) >= spec.messages.length) note(n);
  return { lines, warnings };
}

const HEADER: Record<Direction, string> = {
  TD: "flowchart TD",
  LR: "flowchart LR",
  BT: "flowchart BT",
  RL: "flowchart RL",
};

function usecase(spec: UsecaseSpec, direction: Direction): string[] {
  const lines = [HEADER[direction]];
  const ids = new Map<string, string>();
  spec.actors.forEach((a, i) => {
    ids.set(a, `A${i}`);
    lines.push(`  A${i}["${text(a)}"]`);
  });
  const useCase = (u: { name: string }, i: number, indent: string) => {
    ids.set(u.name, `U${i}`);
    lines.push(`${indent}U${i}(["${text(u.name)}"])`);
  };
  const inner = spec.useCases.filter((u) => u.inSystem);
  if (spec.system !== undefined && inner.length > 0) {
    lines.push(`  subgraph S["${text(spec.system)}"]`);
    spec.useCases.forEach((u, i) => u.inSystem && useCase(u, i, "    "));
    lines.push("  end");
  }
  spec.useCases.forEach((u, i) => !u.inSystem && useCase(u, i, "  "));
  for (const r of spec.relations) {
    const label = r.type === "association" ? r.name : r.type;
    lines.push(
      `  ${ids.get(r.from)} ${r.type === "association" ? "---" : "-->"}${label ? `|${text(label)}|` : ""} ${ids.get(r.to)}`,
    );
  }
  return lines;
}

/** Shapes build_diagram's activity reading maps back to each node type. */
const ACTIVITY_SHAPES: Record<string, [string, string]> = {
  initial: ["([", "])"],
  final: ["([", "])"],
  flowFinal: ["([", "])"],
  decision: ["{", "}"],
  merge: ["{", "}"],
  fork: ["{{", "}}"],
  join: ["{{", "}}"],
  object: ["[/", "/]"],
  action: ["[", "]"],
};

const ACTIVITY_LABELS: Record<string, string> = {
  initial: "start",
  final: "end",
  flowFinal: "end",
  fork: "fork",
  join: "join",
};

function activity(spec: ActivitySpec, direction: Direction): string[] {
  const lines = [HEADER[direction]];
  const node = (n: ActivitySpec["nodes"][number], indent: string) => {
    const [open, close] = ACTIVITY_SHAPES[n.type]!;
    // A blank label reads back as no name; a pseudo node's name is dropped.
    const label = n.name || ACTIVITY_LABELS[n.type] || " ";
    lines.push(`${indent}${n.id}${open}"${text(label)}"${close}`);
  };
  for (const lane of spec.lanes) {
    lines.push(`  subgraph ${laneId(spec.lanes, lane)}["${text(lane)}"]`);
    for (const n of spec.nodes) if (n.lane === lane) node(n, "    ");
    lines.push("  end");
  }
  for (const n of spec.nodes) if (n.lane === undefined) node(n, "  ");
  for (const f of spec.flows) {
    lines.push(`  ${f.from} -->${f.guard ? `|${text(f.guard)}|` : ""} ${f.to}`);
  }
  return lines;
}

const laneId = (lanes: string[], lane: string) => `L${lanes.indexOf(lane)}`;

/**
 * States nest in state X { } blocks, each transition in the innermost block
 * holding both its ends, so a [*] in a block is that composite's own.
 */
function stateDiagram(
  spec: StateSpec,
  direction: Direction,
  notes: readonly NoteSpec[],
): string[] {
  const lines = ["stateDiagram-v2"];
  if (direction === "LR" || direction === "RL") {
    lines.push(`  direction ${direction}`);
  }
  const types = new Map(spec.states.map((s) => [s.id, s.type]));
  const ref = (id: string) => {
    const t = types.get(id);
    return t === "initial" || t === "final" ? "[*]" : id;
  };
  const scope = scopeOf(spec);
  const block = (parent: string | undefined, indent: string) => {
    for (const s of spec.states) {
      if (s.parent !== parent) continue;
      if (s.type === "state") {
        lines.push(`${indent}state "${text(s.name || s.id)}" as ${s.id}`);
      } else if (s.type !== "initial" && s.type !== "final") {
        lines.push(`${indent}state ${s.id} <<${s.type}>>`);
      }
      if (spec.states.some((c) => c.parent === s.id)) {
        lines.push(`${indent}state ${s.id} {`);
        block(s.id, `${indent}  `);
        lines.push(`${indent}}`);
      }
    }
    for (const t of spec.transitions) {
      if (scope(t) !== parent) continue;
      const label = [
        t.trigger ? text(t.trigger) : "",
        t.guard ? `[${text(t.guard)}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `${indent}${ref(t.from)} --> ${ref(t.to)}${label ? ` : ${label}` : ""}`,
      );
    }
  };
  block(undefined, "  ");
  for (const n of notes) {
    // Mermaid puts a note beside one state.
    for (const id of n.on.slice(0, 1)) {
      const body = text(n.text);
      lines.push(`  note right of ${id} : ${body}`);
    }
  }
  return lines;
}

const LEFT: Record<string, string> = {
  "0..1": "|o",
  "1": "||",
  "0..*": "}o",
  "1..*": "}|",
};
const RIGHT: Record<string, string> = {
  "0..1": "o|",
  "1": "||",
  "0..*": "o{",
  "1..*": "|{",
};

const entity = (name: string) =>
  /^[\w-]+$/.test(name) ? name : `"${text(name)}"`;

function erDiagram(spec: ErdSpec): string[] {
  const lines = ["erDiagram"];
  for (const e of spec.entities) {
    if (e.columns.length === 0) {
      lines.push(`  ${entity(e.name)}`);
      continue;
    }
    lines.push(`  ${entity(e.name)} {`);
    for (const c of e.columns) {
      const keys = [
        c.primaryKey && "PK",
        c.foreignKey && "FK",
        c.unique && "UK",
      ].filter(Boolean);
      // Mermaid needs a type; an untyped column reads back as type "string".
      lines.push(
        `    ${c.type || "string"} ${c.name}${keys.length > 0 ? ` ${keys.join(", ")}` : ""}`,
      );
    }
    lines.push("  }");
  }
  for (const r of spec.relationships) {
    lines.push(
      `  ${entity(r.from)} ${LEFT[r.fromCardinality] ?? "||"}${r.identifying ? "--" : ".."}${RIGHT[r.toCardinality] ?? "||"} ${entity(r.to)} : "${text(r.name ?? "")}"`,
    );
  }
  return lines;
}

/** Mermaid delimiters per FLOWCHART_SHAPES key; delay and display have none. */
const FLOW_SHAPES: Record<string, [string, string]> = {
  process: ["[", "]"],
  decision: ["{", "}"],
  terminator: ["([", "])"],
  data: ["[/", "/]"],
  document: [">", "]"],
  predefined: ["[[", "]]"],
  alternate: ["(", ")"],
  database: ["[(", ")]"],
  manualInput: ["[/", "\\]"],
  preparation: ["{{", "}}"],
  connector: ["((", "))"],
};

function flowchart(
  spec: FlowchartSpec,
  direction: Direction,
): {
  lines: string[];
  warnings: string[];
} {
  const lines = [HEADER[direction]];
  const warnings: string[] = [];
  for (const n of spec.nodes) {
    const shape = FLOW_SHAPES[n.type];
    if (!shape) warnings.push(`${n.id} (${n.type}) is written as a process`);
    const [open, close] = shape ?? FLOW_SHAPES.process!;
    lines.push(`  ${n.id}${open}"${text(n.name) || " "}"${close}`);
  }
  for (const f of spec.flows) {
    lines.push(`  ${f.from} -->${f.label ? `|${text(f.label)}|` : ""} ${f.to}`);
  }
  return { lines, warnings };
}

function mindmap(roots: MindNode[]): { lines: string[]; warnings: string[] } {
  const lines = ["mindmap"];
  const warnings: string[] = [];
  const write = (node: MindNode, depth: number) => {
    const name = text(node.name);
    // Brackets and parentheses would read as a node shape.
    const label = /[()[\]{}]/.test(name) ? `n["${name}"]` : name || '[" "]';
    lines.push(`${"  ".repeat(depth)}${label}`);
    for (const child of node.children) write(child, depth + 1);
  };
  if (roots.length > 1) {
    warnings.push(`${roots.length - 1} more root nodes are not written`);
  }
  if (roots[0]) write(roots[0], 1);
  return { lines, warnings };
}

const REQUIREMENT_KEYWORDS: Record<string, string> = {
  requirement: "requirement",
  functional: "functionalRequirement",
  interface: "interfaceRequirement",
  performance: "performanceRequirement",
  physical: "physicalRequirement",
  design: "designConstraint",
};

/** A requirement or element name: a word as is, anything else quoted. */
const reqName = (name: string) =>
  /^\w+$/.test(name) ? name : `"${text(name)}"`;

function requirementDiagram(spec: RequirementSpec): string[] {
  const lines = ["requirementDiagram"];
  for (const r of spec.requirements) {
    lines.push(`  ${REQUIREMENT_KEYWORDS[r.type]} ${reqName(r.name)} {`);
    if (r.id) lines.push(`    id: "${text(r.id)}"`);
    if (r.text) lines.push(`    text: "${text(r.text)}"`);
    if (r.risk) lines.push(`    risk: ${r.risk}`);
    if (r.verifyMethod) lines.push(`    verifymethod: ${r.verifyMethod}`);
    lines.push("  }");
  }
  for (const e of spec.elements) {
    lines.push(`  element ${reqName(e.name)} {`);
    if (e.type !== undefined) lines.push(`    type: "${text(e.type)}"`);
    if (e.docRef !== undefined) lines.push(`    docref: "${text(e.docRef)}"`);
    lines.push("  }");
  }
  for (const r of spec.relations) {
    lines.push(`  ${reqName(r.from)} - ${r.type} -> ${reqName(r.to)}`);
  }
  return lines;
}

function c4(spec: C4Spec): string[] {
  return [`C4${c4Level(spec)}`, ...c4Macros(spec).map((l) => `  ${l}`)];
}

/** `title` goes into front matter, where build_diagram takes the name from. */
export function toMermaid(
  x: Extracted,
  title = "",
): { text: string; warnings: string[] } {
  const front = title ? ["---", `title: "${text(title)}"`, "---"] : [];
  const done = (lines: string[], warnings: string[] = []) => ({
    text: `${[...front, ...lines].join("\n")}\n`,
    warnings,
  });
  switch (x.kind) {
    case "class": {
      const { lines, warnings } = classDiagram(x.spec, x.notes ?? []);
      return done(lines, warnings);
    }
    case "sequence": {
      const { lines, warnings } = sequenceDiagram(x.spec, x.notes ?? []);
      return done(lines, warnings);
    }
    case "usecase":
      return done(usecase(x.spec, x.direction));
    case "activity":
      return done(activity(x.spec, x.direction));
    case "statemachine":
      return done(stateDiagram(x.spec, x.direction, x.notes ?? []));
    case "erd":
      return done(erDiagram(x.spec));
    case "flowchart": {
      const { lines, warnings } = flowchart(x.spec, x.direction);
      return done(lines, warnings);
    }
    case "requirement":
      return done(requirementDiagram(x.spec));
    case "c4":
      return done(c4(x.spec));
    default: {
      const { lines, warnings } = mindmap(x.spec.roots);
      return done(lines, warnings);
    }
  }
}
