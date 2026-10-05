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
  SequenceSpec,
  StateSpec,
  UsecaseSpec,
} from "./model.js";

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

function classDiagram(spec: ClassSpec): string[] {
  const ids = new Ids("C");
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
    // The arrows build_diagram reads (CLASS_ARROWS); the whole of an
    // aggregation or composition and the parent of a generalization come first.
    const line =
      {
        generalization: `${to} <|-- ${from}`,
        realization: `${to} <|.. ${from}`,
        composition: `${to}${card(r.toMultiplicity)} *-- ${cardAfter(r.fromMultiplicity)}${from}`,
        aggregation: `${to}${card(r.toMultiplicity)} o-- ${cardAfter(r.fromMultiplicity)}${from}`,
        directed: `${from}${card(r.fromMultiplicity)} --> ${cardAfter(r.toMultiplicity)}${to}`,
        dependency: `${from} ..> ${to}`,
      }[r.type] ??
      `${from}${card(r.fromMultiplicity)} -- ${cardAfter(r.toMultiplicity)}${to}`;
    lines.push(`  ${line}${label}`);
  }
  return lines;
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

function sequenceDiagram(spec: SequenceSpec): {
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
  spec.messages.forEach((m, i) => {
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
      // Further operands are written as empty sections closing the block,
      // since StarUML does not record which messages each one covers.
      for (const guard of f.operands) {
        lines.push(`${depth()}${BLOCKS[f.operator]} ${text(guard)}`.trimEnd());
      }
      lines.push(`${depth()}end`);
    }
  });
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

function stateDiagram(spec: StateSpec, direction: Direction): string[] {
  const lines = ["stateDiagram-v2"];
  if (direction === "LR" || direction === "RL") {
    lines.push(`  direction ${direction}`);
  }
  const types = new Map(spec.states.map((s) => [s.id, s.type]));
  for (const s of spec.states) {
    if (s.type === "state") {
      lines.push(`  state "${text(s.name || s.id)}" as ${s.id}`);
    } else if (s.type !== "initial" && s.type !== "final") {
      lines.push(`  state ${s.id} <<${s.type}>>`);
    }
  }
  const ref = (id: string) => {
    const t = types.get(id);
    return t === "initial" || t === "final" ? "[*]" : id;
  };
  for (const t of spec.transitions) {
    const label = [
      t.trigger ? text(t.trigger) : "",
      t.guard ? `[${text(t.guard)}]` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `  ${ref(t.from)} --> ${ref(t.to)}${label ? ` : ${label}` : ""}`,
    );
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
    case "class":
      return done(classDiagram(x.spec));
    case "sequence": {
      const { lines, warnings } = sequenceDiagram(x.spec);
      return done(lines, warnings);
    }
    case "usecase":
      return done(usecase(x.spec, x.direction));
    case "activity":
      return done(activity(x.spec, x.direction));
    case "statemachine":
      return done(stateDiagram(x.spec, x.direction));
    case "erd":
      return done(erDiagram(x.spec));
    case "flowchart": {
      const { lines, warnings } = flowchart(x.spec, x.direction);
      return done(lines, warnings);
    }
    default: {
      const { lines, warnings } = mindmap(x.spec.roots);
      return done(lines, warnings);
    }
  }
}
