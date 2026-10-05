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
  FlowNode,
  MindNode,
  NoteSpec,
  SequenceSpec,
  StateSpec,
  UsecaseSpec,
} from "./model.js";
import { scopeOf } from "./model.js";

/*
 * Writes the specs read from a diagram as PlantUML (plantuml.com, the
 * class, sequence, use case, state, IE entity and mindmap syntaxes).
 * Elements are declared once under an alias and referenced by it, so any
 * name works. Activity diagrams and flowcharts are arbitrary graphs, which
 * the structured activity syntax (start/if/fork) cannot express, so they
 * use the legacy activity syntax, whose arrows may join any two nodes.
 */

/** PlantUML writes a line break inside a quoted name as \n. */
const q = (name: string) =>
  `"${name.replace(/"/g, "'").replace(/\r?\n/g, "\\n")}"`;

const one = (name: string) => name.replace(/\r?\n/g, " ");

function aliases(names: readonly string[], prefix: string) {
  const ids = new Map<string, string>();
  for (const n of names) if (!ids.has(n)) ids.set(n, `${prefix}${ids.size}`);
  return (name: string) => ids.get(name)!;
}

/** A note as PlantUML writes one over several lines. */
const noteLines = (head: string, body: string, indent = "") => [
  `${indent}${head}`,
  ...body.split(/\r?\n/).map((l) => `${indent}  ${l}`),
  `${indent}end note`,
];

function classDiagram(spec: ClassSpec, notes: readonly NoteSpec[]): string[] {
  const id = aliases(
    spec.classes.map((c) => c.name),
    "C",
  );
  const lines: string[] = [];
  const keyword = {
    class: "class",
    abstract: "abstract class",
    interface: "interface",
    enum: "enum",
  };
  const write = (c: ClassSpec["classes"][number], indent: string) => {
    const members = [...c.attributes, ...c.operations, ...c.literals];
    const head = `${indent}${keyword[c.kind]} ${q(c.name)} as ${id(c.name)}`;
    if (members.length === 0) {
      lines.push(head);
      return;
    }
    lines.push(`${head} {`);
    for (const m of members) lines.push(`${indent}  ${m}`);
    lines.push(`${indent}}`);
  };
  for (const pkg of spec.packages) {
    lines.push(`package ${q(pkg)} {`);
    for (const c of spec.classes) if (c.package === pkg) write(c, "  ");
    lines.push("}");
  }
  for (const c of spec.classes) if (c.package === undefined) write(c, "");
  for (const r of spec.relations) {
    const from = id(r.from);
    const to = id(r.to);
    const card = (m: string | undefined) => (m ? ` "${m}"` : "");
    const cardAfter = (m: string | undefined) => (m ? `"${m}" ` : "");
    const label = r.name ? ` : ${one(r.name)}` : "";
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
    lines.push(`${line}${label}`);
  }
  notes.forEach((n, i) => {
    lines.push(...noteLines(`note as N${i}`, n.text));
    for (const on of n.on) lines.push(`N${i} .. ${id(on)}`);
  });
  return lines;
}

const ARROWS: Record<string, string> = {
  sync: "->",
  async: "->>",
  reply: "-->",
  create: "->",
  delete: "->",
};

/** PlantUML's group keywords; others become a labelled group. */
const GROUPS = new Set(["alt", "opt", "loop", "par", "break", "critical"]);

function sequenceDiagram(
  spec: SequenceSpec,
  notes: readonly NoteSpec[],
): string[] {
  const id = aliases(spec.participants, "P");
  const lines = spec.participants.map((p) => `participant ${q(p)} as ${id(p)}`);
  const open: SequenceSpec["fragments"] = [];
  const note = (n: NoteSpec) => {
    if (n.on.length === 0) return;
    const where = n.side === "over" ? "over" : `${n.side} of`;
    lines.push(
      ...noteLines(`note ${where} ${n.on.map(id).join(", ")}`, n.text),
    );
  };
  spec.messages.forEach((m, i) => {
    for (const n of notes) if (n.at === i) note(n);
    for (const f of open) {
      const k = f.operandStarts?.indexOf(i) ?? -1;
      if (k >= 0) lines.push(`else ${one(f.operands[k]!)}`.trimEnd());
    }
    for (const f of spec.fragments) {
      if (f.from !== i) continue;
      const head = GROUPS.has(f.operator) ? f.operator : `group ${f.operator}`;
      lines.push(`${head}${f.guard ? ` ${one(f.guard)}` : ""}`);
      open.push(f);
    }
    if (m.kind === "create") lines.push(`create ${id(m.to)}`);
    lines.push(
      `${id(m.from)} ${ARROWS[m.kind]} ${id(m.to)}${m.text ? ` : ${one(m.text)}` : ""}`,
    );
    if (m.kind === "delete") lines.push(`destroy ${id(m.to)}`);
    while (open.length > 0 && open.at(-1)!.to === i) {
      const f = open.pop()!;
      if (!f.operandStarts) {
        for (const guard of f.operands)
          lines.push(`else ${one(guard)}`.trimEnd());
      }
      lines.push("end");
    }
  });
  for (const n of notes) {
    if ((n.at ?? spec.messages.length) >= spec.messages.length) note(n);
  }
  return lines;
}

const LAYOUT: Record<Direction, string[]> = {
  TD: [],
  BT: [],
  LR: ["left to right direction"],
  RL: ["left to right direction"],
};

function usecase(spec: UsecaseSpec, direction: Direction): string[] {
  const actor = aliases(spec.actors, "A");
  const uc = aliases(
    spec.useCases.map((u) => u.name),
    "U",
  );
  const lines = [...LAYOUT[direction]];
  for (const a of spec.actors) lines.push(`actor ${q(a)} as ${actor(a)}`);
  const inner = spec.useCases.filter((u) => u.inSystem);
  if (spec.system !== undefined && inner.length > 0) {
    lines.push(`rectangle ${q(spec.system)} {`);
    for (const u of inner)
      lines.push(`  usecase ${q(u.name)} as ${uc(u.name)}`);
    lines.push("}");
  }
  for (const u of spec.useCases) {
    if (!u.inSystem) lines.push(`usecase ${q(u.name)} as ${uc(u.name)}`);
  }
  const ref = (name: string) =>
    spec.actors.includes(name) ? actor(name) : uc(name);
  for (const r of spec.relations) {
    const [from, to] = [ref(r.from), ref(r.to)];
    lines.push(
      {
        include: `${from} ..> ${to} : <<include>>`,
        extend: `${from} ..> ${to} : <<extend>>`,
        generalization: `${to} <|-- ${from}`,
      }[r.type] ?? `${from} --> ${to}${r.name ? ` : ${one(r.name)}` : ""}`,
    );
  }
  return lines;
}

/**
 * A legacy activity graph: (*) for initial and final nodes, ===bars=== for
 * forks and joins, every other node an activity named where an arrow first
 * reaches it ("name" as N1) and by its alias after that. A node no arrow
 * reaches has nowhere to be declared and is reported.
 */
function graph(
  nodes: readonly FlowNode[],
  edges: readonly { from: string; to: string; label?: string }[],
  direction: Direction,
): { lines: string[]; warnings: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const declared = new Set<string>();
  const ref = (id: string, side: "from" | "to") => {
    const n = byId.get(id)!;
    if (n.type === "initial" && side === "from") return "(*)";
    if ((n.type === "final" || n.type === "flowFinal") && side === "to") {
      return "(*)";
    }
    if (n.type === "fork" || n.type === "join") return `===${n.id}===`;
    if (declared.has(id)) return n.id;
    declared.add(id);
    return `${q(n.name || n.id)} as ${n.id}`;
  };
  const lines = [...LAYOUT[direction]];
  for (const e of edges) {
    const from = ref(e.from, "from");
    lines.push(
      `${from} -->${e.label ? ` [${one(e.label)}]` : ""} ${ref(e.to, "to")}`,
    );
  }
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const alone = nodes.filter((n) => !linked.has(n.id)).length;
  return {
    lines,
    warnings:
      alone > 0
        ? [
            `${alone} node${alone === 1 ? "" : "s"} without flows ${alone === 1 ? "is" : "are"} not written`,
          ]
        : [],
  };
}

function activity(spec: ActivitySpec, direction: Direction) {
  return graph(
    spec.nodes,
    spec.flows.map((f) => ({ from: f.from, to: f.to, label: f.guard })),
    direction,
  );
}

function flowchart(spec: FlowchartSpec, direction: Direction) {
  return graph(spec.nodes, spec.flows, direction);
}

const STEREOTYPES = new Set(["choice", "fork", "join"]);

/** Composite states as state X { } blocks, as in the Mermaid writer. */
function stateDiagram(
  spec: StateSpec,
  direction: Direction,
  notes: readonly NoteSpec[],
): string[] {
  const lines = [...LAYOUT[direction]];
  const types = new Map(spec.states.map((s) => [s.id, s.type]));
  const ref = (id: string) => {
    const t = types.get(id);
    return t === "initial" || t === "final" ? "[*]" : id;
  };
  const scope = scopeOf(spec);
  const block = (parent: string | undefined, indent: string) => {
    for (const s of spec.states) {
      if (s.parent !== parent) continue;
      const nested = spec.states.some((c) => c.parent === s.id);
      if (s.type === "state") {
        lines.push(
          `${indent}state ${q(s.name || s.id)} as ${s.id}${nested ? " {" : ""}`,
        );
      } else if (STEREOTYPES.has(s.type)) {
        lines.push(`${indent}state ${s.id} <<${s.type}>>`);
      }
      if (nested) {
        block(s.id, `${indent}  `);
        lines.push(`${indent}}`);
      }
    }
    for (const t of spec.transitions) {
      if (scope(t) !== parent) continue;
      const label = [
        t.trigger ? one(t.trigger) : "",
        t.guard ? `[${one(t.guard)}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `${indent}${ref(t.from)} --> ${ref(t.to)}${label ? ` : ${label}` : ""}`,
      );
    }
  };
  block(undefined, "");
  for (const n of notes) {
    for (const on of n.on.slice(0, 1)) {
      lines.push(...noteLines(`note right of ${on}`, n.text));
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

function erDiagram(spec: ErdSpec): string[] {
  const id = aliases(
    spec.entities.map((e) => e.name),
    "E",
  );
  const lines: string[] = [];
  for (const e of spec.entities) {
    lines.push(`entity ${q(e.name)} as ${id(e.name)} {`);
    const keys = e.columns.filter((c) => c.primaryKey);
    const rest = e.columns.filter((c) => !c.primaryKey);
    const column = (c: ErdSpec["entities"][number]["columns"][number]) => {
      const marks = [
        c.primaryKey && "<<PK>>",
        c.foreignKey && "<<FK>>",
        c.unique && "<<UK>>",
      ].filter(Boolean);
      return `  ${c.primaryKey ? "*" : ""}${c.name}${c.type ? ` : ${c.type}` : ""}${marks.length > 0 ? ` ${marks.join(" ")}` : ""}`;
    };
    lines.push(...keys.map(column));
    if (keys.length > 0 && rest.length > 0) lines.push("  --");
    lines.push(...rest.map(column), "}");
  }
  for (const r of spec.relationships) {
    lines.push(
      `${id(r.from)} ${LEFT[r.fromCardinality] ?? "||"}${r.identifying ? "--" : ".."}${RIGHT[r.toCardinality] ?? "||"} ${id(r.to)}${r.name ? ` : ${one(r.name)}` : ""}`,
    );
  }
  return lines;
}

function mindmap(roots: MindNode[]): string[] {
  const lines: string[] = [];
  const write = (node: MindNode, depth: number) => {
    lines.push(`${"*".repeat(depth)} ${one(node.name)}`);
    for (const child of node.children) write(child, depth + 1);
  };
  for (const root of roots) write(root, 1);
  return lines;
}

export function toPlantUml(
  x: Extracted,
  title = "",
): { text: string; warnings: string[] } {
  const done = (
    lines: string[],
    warnings: string[] = [],
    start = "@startuml",
    end = "@enduml",
  ) => ({
    text: `${[start, ...(title ? [`title ${one(title)}`] : []), ...lines, end].join("\n")}\n`,
    warnings,
  });
  switch (x.kind) {
    case "class":
      return done(classDiagram(x.spec, x.notes ?? []));
    case "sequence":
      return done(sequenceDiagram(x.spec, x.notes ?? []));
    case "usecase":
      return done(usecase(x.spec, x.direction));
    case "activity": {
      const { lines, warnings } = activity(x.spec, x.direction);
      return done(lines, [
        ...(x.spec.lanes.length > 0
          ? ["swimlanes are not written in the legacy activity syntax"]
          : []),
        ...warnings,
      ]);
    }
    case "statemachine":
      return done(stateDiagram(x.spec, x.direction, x.notes ?? []));
    case "erd":
      return done(erDiagram(x.spec));
    case "flowchart": {
      const { lines, warnings } = flowchart(x.spec, x.direction);
      return done(lines, warnings);
    }
    default:
      return done(mindmap(x.spec.roots), [], "@startmindmap", "@endmindmap");
  }
}
