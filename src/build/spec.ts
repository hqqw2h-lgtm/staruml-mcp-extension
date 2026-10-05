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
  "requirement",
  "c4",
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
  requirement: "SysMLRequirementDiagram",
  c4: "C4Diagram",
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
  /** Key of the node whose view contains this one's, e.g. a composite state. */
  container?: string;
  /** Text of a note, which is a view without a model. */
  text?: string;
  /** Diagram y where each operand after a fragment's first begins. */
  operandAt?: number[];
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

const hex = (what: string) =>
  z.optional(
    doc(
      z.string().check(z.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)),
      `${what}, CSS hex such as '#ffcc00'.`,
    ),
  );

export interface ViewStyle {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
}

/** Notes and colours, which every kind takes. */
const common = () => ({
  notes: z.optional(
    doc(
      z.array(
        z.object({
          text: z.string().check(z.minLength(1)),
          on: z.optional(
            doc(
              z.union([name(), strings()]),
              "Nodes the note is linked to; on a sequence diagram, the lifelines it is drawn at.",
            ),
          ),
          side: z.optional(
            doc(
              z.enum(["left", "right", "over"]),
              "sequence: where the note sits against its one lifeline; default right, over for several.",
            ),
          ),
          at: z.optional(
            doc(
              z.int().check(z.minimum(0)),
              "sequence: the number of messages above the note; default all of them.",
            ),
          ),
        }),
      ),
      "Notes (UMLNote), each linked to the nodes it is on.",
    ),
  ),
  styles: z.optional(
    doc(
      z.record(
        name(),
        z.object({
          fillColor: hex("Fill colour"),
          lineColor: hex("Line colour"),
          fontColor: hex("Text colour"),
        }),
      ),
      "Colours of node views by node name (or id).",
    ),
  ),
});

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
    ...common(),
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
    ...common(),
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
              "Guards of further operands, e.g. ['else'] for an alt; StarUML divides the fragment evenly between operands unless operandStarts says where each begins.",
            ),
          ),
          operandStarts: z.optional(
            doc(
              z.array(z.int().check(z.minimum(0))),
              "Index of the first message of each further operand, one per operands entry, increasing, within from+1..to.",
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
    ...common(),
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
    ...common(),
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
    ...common(),
    states: z.optional(
      z.array(
        nameOr(
          z.object({
            id: z.optional(name()),
            name: z.optional(z.string()),
            type: z.optional(z.enum(STATE_TYPES)),
            parent: z.optional(
              doc(
                name(),
                "Composite state this one is nested in, by name or id.",
              ),
            ),
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
    ...common(),
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
    ...common(),
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

const mindmapSpec = () => z.object({ ...common(), root: mindNode });

/** Mermaid's requirement types, as the stereotypes StarUML's own importer gives them. */
export const REQUIREMENT_TYPES = {
  requirement: undefined,
  functional: "functionalRequirement",
  interface: "interfaceRequirement",
  performance: "performanceRequirement",
  physical: "physicalRequirement",
  design: "designConstraint",
} as const;

export const REQUIREMENT_RELATIONS = {
  contains: "UMLContainment",
  copies: "SysMLCopy",
  derives: "SysMLDeriveReqt",
  satisfies: "SysMLSatisfy",
  verifies: "SysMLVerify",
  refines: "SysMLRefine",
  traces: "UMLDependency",
} as const;

const requirementSpec = () =>
  z.object({
    ...common(),
    requirements: z.optional(
      z.array(
        z.object({
          name: name(),
          type: z.optional(
            z.enum(
              Object.keys(REQUIREMENT_TYPES) as [
                keyof typeof REQUIREMENT_TYPES,
              ],
            ),
          ),
          id: z.optional(z.string()),
          text: z.optional(z.string()),
          risk: z.optional(z.enum(["low", "medium", "high"])),
          verifyMethod: z.optional(
            z.enum(["analysis", "inspection", "test", "demonstration"]),
          ),
        }),
      ),
    ),
    elements: z.optional(
      z.array(
        z.object({
          name: name(),
          type: z.optional(z.string()),
          docRef: z.optional(z.string()),
        }),
      ),
    ),
    relations: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          type: z.enum(
            Object.keys(REQUIREMENT_RELATIONS) as [
              keyof typeof REQUIREMENT_RELATIONS,
            ],
          ),
        }),
      ),
    ),
  });

/** C4ContainerKind literals of the 7.1.1 C4 metamodel. */
export const C4_CONTAINER_KINDS = [
  "server-webapp",
  "client-webapp",
  "desktop-app",
  "mobile-app",
  "console-app",
  "serverless-function",
  "database",
  "blob-store",
  "filesystem",
  "shell-script",
  "etc",
] as const;

export const C4_TYPES = {
  person: "C4Person",
  system: "C4SoftwareSystem",
  container: "C4Container",
  component: "C4Component",
} as const;

const c4Spec = () =>
  z.object({
    ...common(),
    elements: z.optional(
      z.array(
        z.object({
          id: z.optional(doc(name(), "Key for relations; default the name.")),
          name: name(),
          type: z.enum(Object.keys(C4_TYPES) as [keyof typeof C4_TYPES]),
          kind: z.optional(
            doc(z.enum(C4_CONTAINER_KINDS), "Container kind, e.g. database."),
          ),
          technology: z.optional(z.string()),
          description: z.optional(z.string()),
          external: z.optional(
            doc(z.boolean(), "Outside the system in scope; drawn grey."),
          ),
        }),
      ),
    ),
    relations: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          label: z.optional(z.string()),
          technology: z.optional(z.string()),
          description: z.optional(z.string()),
        }),
      ),
    ),
  });

export const SPEC_SCHEMAS = {
  class: classSpec,
  sequence: sequenceSpec,
  usecase: usecaseSpec,
  activity: activitySpec,
  statemachine: statemachineSpec,
  erd: erdSpec,
  flowchart: flowchartSpec,
  mindmap: mindmapSpec,
  requirement: requirementSpec,
  c4: c4Spec,
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

  get(key: string): PlanNode | undefined {
    return this.byKey.get(key);
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
  // The whole is `from`, drawn at the tail with end1 aggregated, as
  // StarUML's own "add aggregated part" commands make it (end1 of an
  // association whose tail is the whole, uml-commands.js in 7.1.1). The
  // toolbox's UMLAggregation/UMLComposition items preset end2 instead, which
  // would put the diamond on the part (issue #29).
  aggregation: "UMLAssociation",
  composition: "UMLAssociation",
  generalization: "UMLGeneralization",
  realization: "UMLInterfaceRealization",
  dependency: "UMLDependency",
};

const AGGREGATIONS: Partial<Record<string, string>> = {
  aggregation: "shared",
  composition: "composite",
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
    const aggregation = AGGREGATIONS[type];
    const tailEnd = {
      ...(aggregation && { aggregation }),
      ...(ends &&
        r.fromMultiplicity !== undefined && {
          multiplicity: r.fromMultiplicity,
        }),
    };
    b.edge(
      {
        type: RELATION_TYPES[type],
        from: r.from,
        to: r.to,
        ...(r.name !== undefined && { name: r.name }),
        ...(Object.keys(tailEnd).length > 0 && { tailEnd }),
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
  /** Room above an operand's first message for the operand's guard. */
  operand: 30,
  /** A note's row between messages. */
  note: 50,
};

/** Height of a note box holding `text`. */
export const noteHeight = (text: string) =>
  Math.max(40, 16 + 16 * multiline(text).split("\n").length);

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
  const fragments = spec.fragments ?? [];
  fragments.forEach((f, i) => {
    if (f.from > f.to || f.to >= messages.length) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.fragments.${i}: from and to must be message indices with from <= to < ${messages.length}`,
      );
    }
    const starts = f.operandStarts;
    if (
      starts &&
      (starts.length !== (f.operands?.length ?? 0) ||
        starts.some(
          (s, k) => s <= (k === 0 ? f.from : starts[k - 1]!) || s > f.to,
        ))
    ) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.fragments.${i}.operandStarts: one increasing message index per operand, each within ${f.from + 1}..${f.to}`,
      );
    }
  });
  const notes = (spec.notes ?? []).map((n, i) => {
    const on = (
      n.on === undefined ? [] : typeof n.on === "string" ? [n.on] : n.on
    ).map(multiline);
    for (const p of on) {
      if (!participants.includes(p)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.notes.${i}.on: no participant named ${p}`,
        );
      }
    }
    if (participants.length === 0) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.notes.${i}: a sequence note stands by a participant, and there is none`,
      );
    }
    return { ...n, on, at: Math.min(n.at ?? messages.length, messages.length) };
  });
  // Each fragment opening at a message pushes it down to clear the
  // fragment's header, each operand starting at it to clear the guard, and
  // each fragment closing after it leaves a gap below. A note takes a row of
  // its own above the message it precedes.
  const openingAt = (i: number) => fragments.filter((f) => f.from === i).length;
  const startsAt = (i: number) =>
    fragments.filter((f) => f.operandStarts?.includes(i)).length;
  const ys: number[] = [];
  const noteTops = new Map<number, number>();
  let at = SEQUENCE.firstMessage;
  for (let i = 0; i <= messages.length; i++) {
    notes.forEach((n, j) => {
      if (n.at !== i) return;
      noteTops.set(j, at - 25);
      at += Math.max(SEQUENCE.note, noteHeight(n.text) + 10);
    });
    if (i === messages.length) break;
    at += SEQUENCE.header * openingAt(i) + SEQUENCE.operand * startsAt(i);
    ys.push(at);
    at +=
      SEQUENCE.step +
      SEQUENCE.footer * fragments.filter((f) => f.to === i).length;
  }
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
      ...(f.operandStarts && {
        operandAt: f.operandStarts.map(
          (s) => y(s) - SEQUENCE.header * openingAt(s) - 35,
        ),
      }),
      width: x2 - x,
      height: bottom - top,
      box: { x, y: top, width: x2 - x, height: bottom - top },
    });
  });
  notes.forEach((n, j) => {
    const centers = (n.on.length > 0 ? n.on : participants).map(center);
    const side = n.side ?? (centers.length === 1 ? "right" : "over");
    const left =
      centers.length > 1 || side === "over"
        ? Math.min(...centers) - 70
        : side === "right"
          ? centers[0]! + 10
          : centers[0]! - 130;
    const width =
      centers.length > 1 || side === "over"
        ? Math.max(...centers) - Math.min(...centers) + 140
        : 120;
    const h = noteHeight(n.text);
    b.node({
      key: `note ${j}`,
      type: "Note",
      name: "",
      text: multiline(n.text),
      width,
      height: h,
      box: { x: left, y: noteTops.get(j)!, width, height: h },
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
  const nested: [key: string, parent: string, index: number][] = [];
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
    if (o.parent !== undefined) nested.push([key, multiline(o.parent), i]);
  });
  for (const [key, parent, i] of nested) {
    const outer = b.get(parent);
    if (outer?.type !== "UMLState" && outer?.type !== "UMLCompositeState") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.states.${i}.parent: no state named ${parent}`,
      );
    }
    // The toolbox's Composite State: a UMLState with one region, whose
    // view holds the nested states' views.
    outer.type = "UMLCompositeState";
    b.get(key)!.container = parent;
  }
  for (const [key, , i] of nested) {
    const seen = new Set<string>();
    for (let k: string | undefined = key; k; k = b.get(k)!.container) {
      if (seen.has(k)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.states.${i}.parent: ${key} would be nested in itself`,
        );
      }
      seen.add(k);
    }
  }
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
  return b.plan(nested.length > 0);
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

/**
 * Requirements as SysMLRequirements with Mermaid's type as stereotype, and
 * elements as classes stereotyped element with Type and DocRef attributes,
 * the way StarUML's own Mermaid importer builds them
 * (extensions/default/mermaid/factory/requirement-factory.js, 7.1.1).
 */
function requirementPlan(spec: Spec<"requirement">): Plan {
  const b = new Builder("requirement");
  for (const r of spec.requirements ?? []) {
    const stereotype = REQUIREMENT_TYPES[r.type ?? "requirement"];
    const notes = [
      r.risk && `Risk: ${r.risk}`,
      r.verifyMethod && `VerifyMethod: ${r.verifyMethod}`,
    ].filter(Boolean);
    const lines = [r.id, r.text].filter(Boolean).length;
    b.node({
      key: multiline(r.name),
      type: "SysMLRequirement",
      name: multiline(r.name),
      properties: {
        ...(r.id !== undefined && { id: r.id }),
        ...(r.text !== undefined && { text: r.text }),
        ...(stereotype && { stereotype }),
        ...(notes.length > 0 && { documentation: notes.join("\n") }),
      },
      width: 180,
      height: 60 + 20 * lines,
    });
  }
  for (const e of spec.elements ?? []) {
    const attributes = [
      e.type !== undefined && { name: "Type", defaultValue: e.type },
      e.docRef !== undefined && { name: "DocRef", defaultValue: e.docRef },
    ].filter((a) => a !== false);
    b.node({
      key: multiline(e.name),
      type: "UMLClass",
      name: multiline(e.name),
      properties: { stereotype: "element" },
      ...(attributes.length > 0 && { attributes }),
      width: 180,
      height: 50 + 14 * attributes.length,
    });
  }
  (spec.relations ?? []).forEach((r, i) => {
    // A containment edge runs from the contained element to its container
    // (containmentFn in uml-factory.js relocates the tail into the head).
    const contains = r.type === "contains";
    b.edge(
      {
        type: REQUIREMENT_RELATIONS[r.type],
        from: contains ? r.to : r.from,
        to: contains ? r.from : r.to,
        ...(r.type === "traces" && { properties: { stereotype: "trace" } }),
      },
      `relations.${i}`,
    );
  });
  return b.plan();
}

/** External elements are grey, as C4-PlantUML and Mermaid draw them. */
const C4_EXTERNAL = { fillColor: "#999999", lineColor: "#8a8a8a" };

function c4Plan(spec: Spec<"c4">): Plan {
  const b = new Builder("c4");
  for (const e of spec.elements ?? []) {
    const properties = {
      ...(e.type === "container" && e.kind !== undefined && { kind: e.kind }),
      ...(e.technology !== undefined && { technology: e.technology }),
      ...(e.description !== undefined && { description: e.description }),
    };
    b.node({
      key: e.id ?? multiline(e.name),
      type: C4_TYPES[e.type],
      name: multiline(e.name),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(e.external && { style: C4_EXTERNAL }),
      width: 180,
      height: e.type === "person" ? 140 : 110,
    });
  }
  (spec.relations ?? []).forEach((r, i) => {
    const properties = {
      ...(r.technology !== undefined && { technology: r.technology }),
      ...(r.description !== undefined && { description: r.description }),
    };
    b.edge(
      {
        type: "C4Relationship",
        from: r.from,
        to: r.to,
        ...(r.label !== undefined && { name: multiline(r.label) }),
        ...(Object.keys(properties).length > 0 && { properties }),
      },
      `relations.${i}`,
    );
  });
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
  requirement: requirementPlan,
  c4: c4Plan,
};

const longHex = (color: string) =>
  color.length === 4
    ? `#${[...color.slice(1)].map((c) => c + c).join("")}`.toLowerCase()
    : color.toLowerCase();

/**
 * Adds what every kind shares: notes, linked to the nodes they are on (a
 * sequence diagram draws its notes at their place in time instead), and
 * view colours.
 */
function decorate(
  plan: Plan,
  spec: z.output<z.ZodMiniObject<ReturnType<typeof common>>>,
): Plan {
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const fail = (where: string, key: string): never => {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec.${where}: no node named ${key}`,
    );
  };
  if (plan.kind !== "sequence") {
    (spec.notes ?? []).forEach((n, i) => {
      const key = `note ${i}`;
      if (byKey.has(key)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec: ${key} is defined twice; give the node another name or id`,
        );
      }
      const text = multiline(n.text);
      const node: PlanNode = {
        key,
        type: "Note",
        name: "",
        text,
        width: 140,
        height: noteHeight(text),
      };
      plan.nodes.push(node);
      byKey.set(key, node);
      const on =
        n.on === undefined ? [] : typeof n.on === "string" ? [n.on] : n.on;
      for (const target of on.map(multiline)) {
        if (!byKey.has(target)) fail(`notes.${i}.on`, target);
        plan.edges.push({ type: "NoteLink", from: key, to: target });
      }
    });
  }
  for (const [key, style] of Object.entries(spec.styles ?? {})) {
    const node = byKey.get(multiline(key)) ?? fail(`styles.${key}`, key);
    const colors = Object.fromEntries(
      Object.entries(style).map(([k, v]) => [k, longHex(v)]),
    );
    node.style = { ...node.style, ...colors };
  }
  return plan;
}

export function planFor<K extends Kind>(kind: K, spec: unknown): Plan {
  const parsed = parseSpec(kind, spec);
  return decorate(PLANNERS[kind](parsed), parsed);
}
