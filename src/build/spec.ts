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

import * as z from "zod/mini";
import { doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import {
  type AttributeSpec,
  multiline,
  type OperationSpec,
  parseAttribute,
  parseOperation,
} from "./members.js";

/*
 * The compact /build_diagram spec of each diagram kind, and its translation
 * into a Plan: the nodes and edges to create, by StarUML create id (a
 * model-and-view id or toolbox item id, see /introspect), keyed by name so
 * edges can name their ends and upsert can find what exists.
 */

export const KINDS = [
  "class",
  "sequence",
  "usecase",
  "activity",
  "statemachine",
  "erd",
  "flowchart",
  "mindmap",
] as const;
export type Kind = (typeof KINDS)[number];

export const DIAGRAM_TYPES: Record<Kind, string> = {
  class: "UMLClassDiagram",
  sequence: "UMLSequenceDiagram",
  usecase: "UMLUseCaseDiagram",
  activity: "UMLActivityDiagram",
  statemachine: "UMLStatechartDiagram",
  erd: "ERDDiagram",
  flowchart: "FCFlowchartDiagram",
  mindmap: "MMMindmapDiagram",
};

export interface ColumnSpec {
  name: string;
  type?: string;
  length?: string;
  primaryKey?: boolean;
  foreignKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanNode {
  key: string;
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  /** Key of the node whose model owns this one's, e.g. a class's package. */
  owner?: string;
  attributes?: AttributeSpec[];
  operations?: OperationSpec[];
  literals?: string[];
  columns?: ColumnSpec[];
  /** Activity lane key; placement puts the node inside that lane. */
  lane?: string;
  /** Guard of a combined fragment's first operand. */
  guard?: string;
  /** Guards of a combined fragment's further operands. */
  operands?: string[];
  /** /set_view_style options for the new view. */
  style?: Record<string, unknown>;
  width: number;
  height: number;
  /** Fixed geometry; otherwise placement decides. */
  box?: Box;
}

export interface PlanEdge {
  type: string;
  from: string;
  to: string;
  name?: string;
  properties?: Record<string, unknown>;
  tailEnd?: Record<string, unknown>;
  headEnd?: Record<string, unknown>;
  /** Sequence messages are drawn at their place in time. */
  geometry?: { x1: number; y1: number; x2: number; y2: number };
}

export type Direction = "TB" | "BT" | "LR" | "RL";

export interface Plan {
  kind: Kind;
  nodes: PlanNode[];
  edges: PlanEdge[];
  /** Placement is fixed by the kind (sequence) or by lanes and boundaries. */
  fixed: boolean;
}

// ---------------------------------------------------------------- schemas

const name = () => z.string().check(z.minLength(1));
const strings = () => z.array(name());
const nameOr = <T extends z.ZodMiniType>(object: T) =>
  z.union([name(), object]);

const attributeObject = () =>
  z.object({
    name: name(),
    type: z.optional(z.string()),
    visibility: z.optional(
      z.enum(["public", "private", "protected", "package"]),
    ),
    isStatic: z.optional(z.boolean()),
    defaultValue: z.optional(z.string()),
    multiplicity: z.optional(z.string()),
  });

const operationObject = () =>
  z.object({
    name: name(),
    parameters: z.optional(
      z.array(z.object({ name: name(), type: z.optional(z.string()) })),
    ),
    returnType: z.optional(z.string()),
    visibility: z.optional(
      z.enum(["public", "private", "protected", "package"]),
    ),
    isStatic: z.optional(z.boolean()),
    isAbstract: z.optional(z.boolean()),
  });

const relationTypes = [
  "association",
  "directed",
  "aggregation",
  "composition",
  "generalization",
  "realization",
  "dependency",
] as const;

const classSpec = () =>
  z.object({
    packages: z.optional(
      z.array(
        nameOr(z.object({ name: name(), stereotype: z.optional(z.string()) })),
      ),
    ),
    classes: z.optional(
      z.array(
        z.object({
          name: name(),
          kind: z.optional(z.enum(["class", "interface", "enum", "abstract"])),
          stereotype: z.optional(z.string()),
          package: z.optional(doc(name(), "Owning package, by name.")),
          attributes: z.optional(z.array(nameOr(attributeObject()))),
          operations: z.optional(z.array(nameOr(operationObject()))),
          literals: z.optional(strings()),
          documentation: z.optional(z.string()),
        }),
      ),
    ),
    relations: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          type: z.optional(z.enum(relationTypes)),
          name: z.optional(z.string()),
          fromMultiplicity: z.optional(z.string()),
          toMultiplicity: z.optional(z.string()),
        }),
      ),
    ),
  });

const MESSAGE_KINDS = ["sync", "async", "reply", "create", "delete"] as const;

const sequenceSpec = () =>
  z.object({
    participants: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            kind: z.optional(z.enum(["participant", "actor"])),
          }),
        ),
      ),
    ),
    messages: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          text: z.optional(z.string()),
          kind: z.optional(z.enum(MESSAGE_KINDS)),
        }),
      ),
    ),
    fragments: z.optional(
      z.array(
        z.object({
          operator: z.enum([
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
          ]),
          guard: z.optional(z.string()),
          operands: z.optional(
            doc(
              z.array(z.string()),
              "Guards of further operands, e.g. ['else'] for an alt; StarUML divides the fragment evenly between operands.",
            ),
          ),
          from: doc(
            z.int().check(z.minimum(0)),
            "Index of the first message inside.",
          ),
          to: doc(
            z.int().check(z.minimum(0)),
            "Index of the last message inside.",
          ),
        }),
      ),
    ),
  });

const usecaseSpec = () =>
  z.object({
    system: z.optional(
      doc(name(), "System boundary drawn around the use cases."),
    ),
    actors: z.optional(strings()),
    useCases: z.optional(strings()),
    relations: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          type: z.optional(
            z.enum(["association", "include", "extend", "generalization"]),
          ),
          name: z.optional(z.string()),
        }),
      ),
    ),
  });

const ACTIVITY_NODES = [
  "action",
  "initial",
  "final",
  "flowFinal",
  "decision",
  "merge",
  "fork",
  "join",
  "object",
] as const;

const activitySpec = () =>
  z.object({
    lanes: z.optional(strings()),
    nodes: z.optional(
      z.array(
        nameOr(
          z.object({
            id: z.optional(doc(name(), "Key for flows; default the name.")),
            name: z.optional(z.string()),
            type: z.optional(z.enum(ACTIVITY_NODES)),
            lane: z.optional(name()),
          }),
        ),
      ),
    ),
    flows: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          guard: z.optional(z.string()),
          name: z.optional(z.string()),
        }),
      ),
    ),
  });

const STATE_TYPES = [
  "state",
  "initial",
  "final",
  "choice",
  "fork",
  "join",
] as const;

const statemachineSpec = () =>
  z.object({
    states: z.optional(
      z.array(
        nameOr(
          z.object({
            id: z.optional(name()),
            name: z.optional(z.string()),
            type: z.optional(z.enum(STATE_TYPES)),
          }),
        ),
      ),
    ),
    transitions: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          trigger: z.optional(z.string()),
          guard: z.optional(z.string()),
          effect: z.optional(z.string()),
        }),
      ),
    ),
  });

const CARDINALITIES = ["0..1", "1", "0..*", "1..*"] as const;

const erdSpec = () =>
  z.object({
    entities: z.optional(
      z.array(
        z.object({
          name: name(),
          columns: z.optional(
            z.array(
              nameOr(
                z.object({
                  name: name(),
                  type: z.optional(z.string()),
                  length: z.optional(z.string()),
                  primaryKey: z.optional(z.boolean()),
                  foreignKey: z.optional(z.boolean()),
                  nullable: z.optional(z.boolean()),
                  unique: z.optional(z.boolean()),
                }),
              ),
            ),
          ),
        }),
      ),
    ),
    relationships: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          name: z.optional(z.string()),
          fromCardinality: z.optional(z.enum(CARDINALITIES)),
          toCardinality: z.optional(z.enum(CARDINALITIES)),
          identifying: z.optional(z.boolean()),
        }),
      ),
    ),
  });

export const FLOWCHART_SHAPES = {
  process: "FCProcess",
  decision: "FCDecision",
  terminator: "FCTerminator",
  data: "FCData",
  document: "FCDocument",
  predefined: "FCPredefinedProcess",
  alternate: "FCAlternateProcess",
  database: "FCDatabase",
  manualInput: "FCManualInput",
  preparation: "FCPreparation",
  connector: "FCConnector",
  delay: "FCDelay",
  display: "FCDisplay",
} as const;

const flowchartSpec = () =>
  z.object({
    nodes: z.optional(
      z.array(
        nameOr(
          z.object({
            id: z.optional(name()),
            name: z.optional(z.string()),
            shape: z.optional(
              z.enum(
                Object.keys(FLOWCHART_SHAPES) as [
                  keyof typeof FLOWCHART_SHAPES,
                ],
              ),
            ),
          }),
        ),
      ),
    ),
    flows: z.optional(
      z.array(
        z.object({ from: name(), to: name(), label: z.optional(z.string()) }),
      ),
    ),
  });

interface MindNode {
  name: string;
  children?: MindNode[];
}

const mindNode: z.ZodMiniType<MindNode> = z.object({
  name: name(),
  get children() {
    return z.optional(z.array(mindNode));
  },
});

const mindmapSpec = () => z.object({ root: mindNode });

export const SPEC_SCHEMAS = {
  class: classSpec,
  sequence: sequenceSpec,
  usecase: usecaseSpec,
  activity: activitySpec,
  statemachine: statemachineSpec,
  erd: erdSpec,
  flowchart: flowchartSpec,
  mindmap: mindmapSpec,
} as const;

export type Spec<K extends Kind> = z.output<
  ReturnType<(typeof SPEC_SCHEMAS)[K]>
>;

/** Parses `spec` for `kind`, reporting issues under "spec.". */
export function parseSpec<K extends Kind>(kind: K, spec: unknown): Spec<K> {
  const result = z.safeParse(SPEC_SCHEMAS[kind](), spec);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec.${issue.path.map(String).join(".")}: ${issue.message} (for kind ${kind})`,
      result.error.issues,
    );
  }
  return result.data as Spec<K>;
}

// ---------------------------------------------------------------- plans

/** Holds the nodes by key and refuses duplicates and dangling edge ends. */
class Builder {
  readonly nodes: PlanNode[] = [];
  readonly edges: PlanEdge[] = [];
  private readonly byKey = new Map<string, PlanNode>();

  constructor(readonly kind: Kind) {}

  node(
    node: Omit<PlanNode, "width" | "height"> &
      Partial<Pick<PlanNode, "width" | "height">>,
  ): PlanNode {
    if (this.byKey.has(node.key)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec: ${node.key} is defined twice; give one of them another name or id`,
      );
    }
    const full: PlanNode = { width: 120, height: 60, ...node };
    this.nodes.push(full);
    this.byKey.set(full.key, full);
    return full;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Ends are names as nodes are, so "a<br/>b" finds the node named "a\nb". */
  edge(spec: PlanEdge, where: string): void {
    const edge = {
      ...spec,
      from: multiline(spec.from),
      to: multiline(spec.to),
    };
    for (const end of [edge.from, edge.to]) {
      if (!this.byKey.has(end)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.${where}: no node named ${end}`,
        );
      }
    }
    this.edges.push(edge);
  }

  plan(fixed = false): Plan {
    return { kind: this.kind, nodes: this.nodes, edges: this.edges, fixed };
  }
}

const str = (value: string | { name: string }) =>
  multiline(typeof value === "string" ? value : value.name);

const CLASS_TYPES = {
  class: "UMLClass",
  abstract: "UMLClass",
  interface: "UMLInterface",
  enum: "UMLEnumeration",
} as const;

const RELATION_TYPES: Record<(typeof relationTypes)[number], string> = {
  association: "UMLAssociation",
  directed: "UMLDirectedAssociation",
  aggregation: "UMLAggregation",
  composition: "UMLComposition",
  generalization: "UMLGeneralization",
  realization: "UMLInterfaceRealization",
  dependency: "UMLDependency",
};

function classPlan(spec: Spec<"class">): Plan {
  const b = new Builder("class");
  for (const p of spec.packages ?? []) {
    const stereotype = typeof p === "string" ? undefined : p.stereotype;
    b.node({
      key: str(p),
      type: "UMLPackage",
      name: str(p),
      ...(stereotype && { properties: { stereotype } }),
      width: 200,
      height: 120,
    });
  }
  (spec.classes ?? []).forEach((c, i) => {
    const kind = c.kind ?? "class";
    if (c.package !== undefined && !b.has(c.package)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.classes.${i}.package: no package named ${c.package}`,
      );
    }
    const properties = {
      ...(kind === "abstract" && { isAbstract: true }),
      ...(c.stereotype !== undefined && { stereotype: c.stereotype }),
      ...(c.documentation !== undefined && { documentation: c.documentation }),
    };
    const attributes = (c.attributes ?? []).map((a) =>
      typeof a === "string" ? parseAttribute(a) : a,
    );
    const operations = (c.operations ?? []).map((o) =>
      typeof o === "string" ? parseOperation(o) : o,
    );
    b.node({
      key: multiline(c.name),
      type: CLASS_TYPES[kind],
      name: multiline(c.name),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(c.package !== undefined && { owner: c.package }),
      ...(attributes.length > 0 && { attributes }),
      ...(operations.length > 0 && { operations }),
      ...(c.literals && { literals: c.literals }),
      // StarUML draws an interface as a lollipop by default, which hides
      // its operations.
      ...(kind === "interface" && { style: { stereotypeDisplay: "label" } }),
      width: 180,
      height:
        40 +
        14 *
          (attributes.length + operations.length + (c.literals?.length ?? 0)),
    });
  });
  (spec.relations ?? []).forEach((r, i) => {
    const type = r.type ?? "association";
    const ends =
      type !== "generalization" &&
      type !== "realization" &&
      type !== "dependency";
    b.edge(
      {
        type: RELATION_TYPES[type],
        from: r.from,
        to: r.to,
        ...(r.name !== undefined && { name: r.name }),
        ...(ends &&
          r.fromMultiplicity !== undefined && {
            tailEnd: { multiplicity: r.fromMultiplicity },
          }),
        ...(ends &&
          r.toMultiplicity !== undefined && {
            headEnd: { multiplicity: r.toMultiplicity },
          }),
      },
      `relations.${i}`,
    );
  });
  return b.plan();
}

const MESSAGE_TYPES = {
  sync: "UMLMessage",
  async: "UMLAsyncMessage",
  reply: "UMLReplyMessage",
  create: "UMLCreateMessage",
  delete: "UMLDeleteMessage",
} as const;

/** Sequence geometry: lifelines in a row, messages one step down each. */
export const SEQUENCE = {
  left: 40,
  top: 20,
  spacing: 200,
  width: 120,
  firstMessage: 110,
  step: 50,
  /** Room for a fragment's operator tab and guard above its first message. */
  header: 55,
  footer: 20,
};

function sequencePlan(spec: Spec<"sequence">): Plan {
  const b = new Builder("sequence");
  const messages = (spec.messages ?? []).map((m) => ({
    ...m,
    from: multiline(m.from),
    to: multiline(m.to),
  }));
  const participants = (spec.participants ?? []).map(str);
  // Participants used only in messages are declared in order of appearance,
  // as Mermaid does.
  for (const m of messages) {
    for (const end of [m.from, m.to]) {
      if (!participants.includes(end)) participants.push(end);
    }
  }
  // Each fragment opening at a message pushes it down to clear the
  // fragment's header, and each one closing after it leaves a gap below.
  const fragments = spec.fragments ?? [];
  const ys: number[] = [];
  let at = SEQUENCE.firstMessage;
  messages.forEach((_, i) => {
    at += SEQUENCE.header * fragments.filter((f) => f.from === i).length;
    ys.push(at);
    at +=
      SEQUENCE.step +
      SEQUENCE.footer * fragments.filter((f) => f.to === i).length;
  });
  const height = at + SEQUENCE.step - SEQUENCE.top;
  const center = (key: string) =>
    SEQUENCE.left +
    participants.indexOf(key) * SEQUENCE.spacing +
    SEQUENCE.width / 2;
  participants.forEach((p, i) =>
    b.node({
      key: p,
      type: "UMLLifeline",
      name: p,
      width: SEQUENCE.width,
      height,
      box: {
        x: SEQUENCE.left + i * SEQUENCE.spacing,
        y: SEQUENCE.top,
        width: SEQUENCE.width,
        height,
      },
    }),
  );
  const y = (i: number) => ys[i]!;
  messages.forEach((m, i) => {
    const self = m.from === m.to;
    b.edge(
      {
        type: self ? "UMLSelfMessage" : MESSAGE_TYPES[m.kind ?? "sync"],
        from: m.from,
        to: m.to,
        ...(m.text !== undefined && { name: multiline(m.text) }),
        ...(self &&
          m.kind !== undefined &&
          m.kind !== "sync" && {
            properties: {
              messageSort: {
                async: "asynchCall",
                reply: "reply",
                create: "createMessage",
                delete: "deleteMessage",
              }[m.kind],
            },
          }),
        geometry: {
          x1: center(m.from),
          y1: y(i),
          x2: self ? center(m.from) + 40 : center(m.to),
          y2: y(i),
        },
      },
      `messages.${i}`,
    );
  });
  fragments.forEach((f, i) => {
    if (f.from > f.to || f.to >= messages.length) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.fragments.${i}: from and to must be message indices with from <= to < ${messages.length}`,
      );
    }
    const inside = messages.slice(f.from, f.to + 1);
    const columns = inside
      .flatMap((m) => [m.from, m.to])
      .map((p) => participants.indexOf(p));
    // Fragments enclosing this one sit outside it: further left and right,
    // their tabs above its tab where they open at the same message.
    const outer = fragments.filter(
      (g, j) =>
        j !== i &&
        g.from <= f.from &&
        g.to >= f.to &&
        (g.to - g.from > f.to - f.from || j < i),
    );
    const inset = 10 * outer.length;
    const x =
      SEQUENCE.left + Math.min(...columns) * SEQUENCE.spacing - 30 + inset;
    const x2 =
      SEQUENCE.left +
      Math.max(...columns) * SEQUENCE.spacing +
      SEQUENCE.width +
      30 -
      inset;
    const opening = fragments.filter((g) => g.from === f.from).length;
    const closing = fragments.filter((g) => g.to === f.to).length;
    const top =
      y(f.from) -
      SEQUENCE.header *
        (opening - outer.filter((g) => g.from === f.from).length) +
      5;
    const bottom =
      y(f.to) +
      SEQUENCE.step / 2 +
      SEQUENCE.footer *
        (closing - 1 - outer.filter((g) => g.to === f.to).length);
    b.node({
      key: `fragment ${i}`,
      type: "UMLCombinedFragment",
      // The operator and guard say it all; StarUML would add "CombinedFragment1".
      name: "",
      properties: { interactionOperator: f.operator },
      ...(f.guard !== undefined && { guard: f.guard }),
      ...(f.operands && { operands: f.operands }),
      width: x2 - x,
      height: bottom - top,
      box: { x, y: top, width: x2 - x, height: bottom - top },
    });
  });
  return b.plan(true);
}

const USECASE_RELATIONS = {
  association: "UMLAssociation",
  include: "UMLInclude",
  extend: "UMLExtend",
  generalization: "UMLGeneralization",
} as const;

function usecasePlan(spec: Spec<"usecase">): Plan {
  const b = new Builder("usecase");
  const system = spec.system === undefined ? undefined : multiline(spec.system);
  const useCases = (spec.useCases ?? []).map(multiline);
  if (system !== undefined) {
    b.node({
      key: system,
      type: "UMLUseCaseSubject",
      name: system,
      width: 260,
      height: 100 + 80 * useCases.length,
    });
  }
  for (const a of spec.actors ?? []) {
    b.node({
      key: multiline(a),
      type: "UMLActor",
      name: multiline(a),
      width: 40,
      height: 80,
    });
  }
  for (const u of useCases) {
    b.node({ key: u, type: "UMLUseCase", name: u, width: 160, height: 50 });
  }
  (spec.relations ?? []).forEach((r, i) =>
    b.edge(
      {
        type: USECASE_RELATIONS[r.type ?? "association"],
        from: r.from,
        to: r.to,
        ...(r.name !== undefined && { name: r.name }),
      },
      `relations.${i}`,
    ),
  );
  return b.plan(system !== undefined);
}

const ACTIVITY_TYPES: Record<
  (typeof ACTIVITY_NODES)[number],
  [string, number, number]
> = {
  action: ["UMLAction", 120, 50],
  initial: ["UMLInitialNode", 20, 20],
  final: ["UMLActivityFinalNode", 26, 26],
  flowFinal: ["UMLFlowFinalNode", 26, 26],
  decision: ["UMLDecisionNode", 30, 40],
  merge: ["UMLMergeNode", 30, 40],
  fork: ["UMLForkNode", 120, 10],
  join: ["UMLJoinNode", 120, 10],
  object: ["UMLObjectNode", 120, 50],
};

/**
 * Pseudo nodes (initial, final, decision, ...) without a name stay unnamed
 * instead of taking StarUML's generated "InitialNode1"; a named kind of node
 * without a name is called by its key.
 */
function nodeName(
  name: string | undefined,
  key: string,
  named: boolean,
): string {
  if (name !== undefined) return multiline(name);
  return named ? key : "";
}

function activityPlan(spec: Spec<"activity">): Plan {
  const b = new Builder("activity");
  const lanes = (spec.lanes ?? []).map(multiline);
  for (const lane of lanes) {
    b.node({
      key: lane,
      type: "UMLSwimlaneVert",
      name: lane,
      width: 200,
      height: 400,
    });
  }
  (spec.nodes ?? []).forEach((n, i) => {
    const o = typeof n === "string" ? { name: n } : n;
    const type = o.type ?? "action";
    const [create, width, height] = ACTIVITY_TYPES[type];
    if (o.lane !== undefined && !lanes.includes(o.lane)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.nodes.${i}.lane: no lane named ${o.lane}`,
      );
    }
    const key = o.id ?? (o.name !== undefined ? multiline(o.name) : undefined);
    if (key === undefined) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.nodes.${i}: needs a name or an id`,
      );
    }
    b.node({
      key,
      type: create,
      name: nodeName(o.name, key, type === "action" || type === "object"),
      ...(o.lane !== undefined && { lane: o.lane }),
      width,
      height,
    });
  });
  (spec.flows ?? []).forEach((f, i) =>
    b.edge(
      {
        type: "UMLControlFlow",
        from: f.from,
        to: f.to,
        ...(f.name !== undefined && { name: f.name }),
        ...(f.guard !== undefined && { properties: { guard: f.guard } }),
      },
      `flows.${i}`,
    ),
  );
  return b.plan(lanes.length > 0);
}

const STATE_CREATE: Record<
  (typeof STATE_TYPES)[number],
  [string, number, number]
> = {
  state: ["UMLState", 120, 50],
  initial: ["UMLInitialState", 20, 20],
  final: ["UMLFinalState", 26, 26],
  choice: ["UMLChoice", 30, 30],
  fork: ["UMLFork", 10, 80],
  join: ["UMLJoin", 10, 80],
};

function statemachinePlan(spec: Spec<"statemachine">): Plan {
  const b = new Builder("statemachine");
  (spec.states ?? []).forEach((s, i) => {
    const o = typeof s === "string" ? { name: s } : s;
    const type = o.type ?? "state";
    const key = o.id ?? (o.name !== undefined ? multiline(o.name) : undefined);
    if (key === undefined) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.states.${i}: needs a name or an id`,
      );
    }
    const [create, width, height] = STATE_CREATE[type];
    b.node({
      key,
      type: create,
      name: nodeName(o.name, key, type === "state"),
      width,
      height,
    });
  });
  (spec.transitions ?? []).forEach((t, i) => {
    const label = [
      t.trigger ?? "",
      t.effect !== undefined ? ` / ${t.effect}` : "",
    ]
      .join("")
      .trim();
    b.edge(
      {
        type: "UMLTransition",
        from: t.from,
        to: t.to,
        ...(label && { name: label }),
        ...(t.guard !== undefined && { properties: { guard: t.guard } }),
      },
      `transitions.${i}`,
    );
  });
  return b.plan();
}

/** "id int PK", "name varchar(40) NOT NULL", "customer_id int FK". */
export function parseColumn(source: string): ColumnSpec {
  const words = source.trim().split(/\s+/);
  const column: ColumnSpec = { name: words[0]! };
  const rest = words.slice(1);
  const flags = new Set(rest.map((w) => w.toUpperCase()));
  const type = rest.find((w) => !/^(PK|FK|UK|UNIQUE|NULL|NOT)$/i.test(w));
  if (type) {
    const sized = /^([^(]+)\(([^)]*)\)$/.exec(type);
    if (sized) {
      column.type = sized[1]!;
      column.length = sized[2]!;
    } else {
      column.type = type;
    }
  }
  if (flags.has("PK")) column.primaryKey = true;
  if (flags.has("FK")) column.foreignKey = true;
  if (flags.has("UK") || flags.has("UNIQUE")) column.unique = true;
  if (flags.has("NULL") && !flags.has("NOT")) column.nullable = true;
  return column;
}

function erdPlan(spec: Spec<"erd">): Plan {
  const b = new Builder("erd");
  for (const e of spec.entities ?? []) {
    const columns = (e.columns ?? []).map((c) =>
      typeof c === "string" ? parseColumn(c) : c,
    );
    b.node({
      key: multiline(e.name),
      type: "ERDEntity",
      name: multiline(e.name),
      ...(columns.length > 0 && { columns }),
      width: 160,
      height: 40 + 16 * columns.length,
    });
  }
  (spec.relationships ?? []).forEach((r, i) =>
    b.edge(
      {
        type: "ERDRelationship",
        from: r.from,
        to: r.to,
        ...(r.name !== undefined && { name: r.name }),
        ...(r.identifying !== undefined && {
          properties: { identifying: r.identifying },
        }),
        tailEnd: { cardinality: r.fromCardinality ?? "1" },
        headEnd: { cardinality: r.toCardinality ?? "0..*" },
      },
      `relationships.${i}`,
    ),
  );
  return b.plan();
}

function flowchartPlan(spec: Spec<"flowchart">): Plan {
  const b = new Builder("flowchart");
  (spec.nodes ?? []).forEach((n, i) => {
    const o = typeof n === "string" ? { name: n } : n;
    const key = o.id ?? (o.name !== undefined ? multiline(o.name) : undefined);
    if (key === undefined) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.nodes.${i}: needs a name or an id`,
      );
    }
    const shape = o.shape ?? "process";
    b.node({
      key,
      type: FLOWCHART_SHAPES[shape],
      name: o.name !== undefined ? multiline(o.name) : key,
      width: shape === "connector" ? 40 : 140,
      height: shape === "decision" ? 70 : shape === "connector" ? 40 : 50,
    });
  });
  (spec.flows ?? []).forEach((f, i) =>
    b.edge(
      {
        type: "FCFlow",
        from: f.from,
        to: f.to,
        ...(f.label !== undefined && { name: multiline(f.label) }),
      },
      `flows.${i}`,
    ),
  );
  return b.plan();
}

function mindmapPlan(spec: Spec<"mindmap">): Plan {
  const b = new Builder("mindmap");
  const visit = (node: MindNode, parent: string | null) => {
    const key =
      parent === null
        ? multiline(node.name)
        : `${parent}/${multiline(node.name)}`;
    b.node({
      key,
      type: "MMNode",
      name: multiline(node.name),
      width: 120,
      height: 40,
    });
    if (parent !== null) b.edge({ type: "MMEdge", from: parent, to: key }, key);
    for (const child of node.children ?? []) visit(child, key);
  };
  visit(spec.root, null);
  return b.plan();
}

const PLANNERS: { [K in Kind]: (spec: Spec<K>) => Plan } = {
  class: classPlan,
  sequence: sequencePlan,
  usecase: usecasePlan,
  activity: activityPlan,
  statemachine: statemachinePlan,
  erd: erdPlan,
  flowchart: flowchartPlan,
  mindmap: mindmapPlan,
};

export function planFor<K extends Kind>(kind: K, spec: unknown): Plan {
  return PLANNERS[kind](parseSpec(kind, spec));
}
