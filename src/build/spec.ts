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
  formatAttribute,
  formatOperation,
  multiline,
  parseAttribute,
  parseOperation,
} from "./members.js";
import {
  type Box,
  Builder,
  type ColumnSpec,
  common,
  LABEL_PADDING,
  LINE_HEIGHT,
  name,
  nameOr,
  type Plan,
  type PlanNode,
  str,
  strings,
  textWidth,
} from "./plan.js";

import {
  FAMILIES,
  FAMILY_KINDS,
  type FamilyKind,
  familyPlan,
  familySpec,
} from "./families.js";
import {
  componentPlan,
  componentSpec,
  deploymentPlan,
  deploymentSpec,
  packagePlan,
  packageSpec,
} from "./structure.js";

export type {
  Box,
  ColumnSpec,
  Direction,
  Plan,
  PlanEdge,
  PlanNode,
  ViewStyle,
} from "./plan.js";
export { textWidth } from "./plan.js";

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
  "package",
  "component",
  "deployment",
  "composite",
  "object",
  "communication",
  "timing",
  "overview",
  "infoflow",
  "profile",
  "dfd",
  "bdd",
  "ibd",
  "parametric",
  "bpmn",
  "wireframe",
  "aws",
  "azure",
  "gcp",
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
  package: "UMLPackageDiagram",
  component: "UMLComponentDiagram",
  deployment: "UMLDeploymentDiagram",
  ...(Object.fromEntries(
    FAMILY_KINDS.map((k) => [k, FAMILIES[k].diagram]),
  ) as Record<FamilyKind, string>),
};

// ---------------------------------------------------------------- schemas

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
    autoCreatePackages: z.optional(
      doc(
        z.boolean(),
        "Make a package for each class's package that packages does not declare.",
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
    outside: z.optional(
      doc(
        strings(),
        "Use cases of another system: drawn beside the boundary rather than in it.",
      ),
    ),
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
  package: packageSpec,
  component: componentSpec,
  deployment: deploymentSpec,
  composite: () => familySpec("composite"),
  object: () => familySpec("object"),
  communication: () => familySpec("communication"),
  timing: () => familySpec("timing"),
  overview: () => familySpec("overview"),
  infoflow: () => familySpec("infoflow"),
  profile: () => familySpec("profile"),
  dfd: () => familySpec("dfd"),
  bdd: () => familySpec("bdd"),
  ibd: () => familySpec("ibd"),
  parametric: () => familySpec("parametric"),
  bpmn: () => familySpec("bpmn"),
  wireframe: () => familySpec("wireframe"),
  aws: () => familySpec("aws"),
  azure: () => familySpec("azure"),
  gcp: () => familySpec("gcp"),
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
      if (!spec.autoCreatePackages) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.classes.${i}.package: no package named ${c.package}; declare it in spec.packages or set spec.autoCreatePackages`,
        );
      }
      b.node({
        key: c.package,
        type: "UMLPackage",
        name: c.package,
        width: 200,
        height: 120,
      });
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
    const shown = viewProperties(kind, attributes.length);
    b.node({
      key: multiline(c.name),
      type: CLASS_TYPES[kind],
      name: multiline(c.name),
      ...(Object.keys(properties).length > 0 && { properties }),
      // The class is drawn inside its package's view, which grows to hold
      // it (issue #34), as dropping a class on a package does.
      ...(c.package !== undefined && {
        owner: c.package,
        container: c.package,
      }),
      ...(attributes.length > 0 && { attributes }),
      ...(operations.length > 0 && { operations }),
      ...(c.literals && { literals: c.literals }),
      // StarUML draws an interface as a lollipop by default, which hides
      // its operations.
      ...(kind === "interface" && { style: { stereotypeDisplay: "label" } }),
      ...(shown && { viewProperties: shown }),
      // StarUML widens a class view to its longest line when it draws it;
      // planning that width keeps neighbours, and a package holding the
      // class, clear of it.
      width: Math.max(
        180,
        textWidth(
          [
            c.name,
            ...attributes.map((a) => formatAttribute(a)),
            ...operations.map((o) =>
              formatOperation({
                ...o,
                parameters: [
                  ...(o.parameters ?? []),
                  ...(o.returnType === undefined
                    ? []
                    : [{ direction: "return", type: o.returnType }]),
                ],
              }),
            ),
            ...(c.literals ?? []),
          ].join("\n"),
        ) +
          2 * LABEL_PADDING,
      ),
      height:
        40 +
        14 *
          (attributes.length + operations.length + (c.literals?.length ?? 0)),
    });
  });
  const nested = b.nodes.some((n) => n.container !== undefined);
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
  // Format > Layout moves views out of their containers' bounds, so a
  // diagram with packages holding classes keeps the computed placement.
  return b.plan(nested);
}

/**
 * Compartments an interface view hides by default: the uml.interface
 * suppressAttributes and suppressOperations preferences default to true
 * (UMLInterfaceView in the 7.1.1 uml elements.js), so an interface built
 * with operations was drawn as an empty box. An abstract class shows its
 * operations, which build_diagram sets explicitly in case the preference
 * says otherwise.
 */
function viewProperties(
  kind: "class" | "interface" | "enum" | "abstract",
  attributes: number,
): Record<string, unknown> | undefined {
  if (kind === "interface") {
    return {
      suppressOperations: false,
      ...(attributes > 0 && { suppressAttributes: false }),
    };
  }
  return kind === "abstract" ? { suppressOperations: false } : undefined;
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
  /** Below the frame's "sd" tab, which StarUML puts at (8, 8). */
  top: 40,
  spacing: 200,
  width: 120,
  firstMessage: 130,
  step: 50,
  /**
   * Room for a fragment's operator tab and its first operand's guard above
   * its first message. The guard is drawn 15 below the operand's top
   * (INTERACTIONOPERAND_GUARD_VERT_MARGIN in the 7.1.1 uml elements.js) and
   * a message's name about 17 above its line, so less room puts the guard
   * on the message's label (issue #34).
   */
  header: 80,
  footer: 20,
  /** Room above an operand's first message for the divider and its guard. */
  operand: 50,
  /** How far above an operand's first message its divider is drawn. */
  divider: 55,
  /** A note's row between messages. */
  note: 50,
  /** Where StarUML puts a new sequence diagram's frame (_addFrame, uml-factory.js). */
  frame: 8,
  /** Space between the frame and what it holds. */
  frameMargin: 20,
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
  const fragments = (spec.fragments ?? []).map(withOperandStarts);
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
  const fragmentNames = uniqueNames(
    fragments.map((f) => f.guard || f.operator),
  );
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
      // Named after its guard, else its operator, rather than StarUML's
      // "CombinedFragment1"; unnamed, it fails UML001 (issue #34).
      name: fragmentNames[i]!,
      properties: { interactionOperator: f.operator },
      ...(f.guard !== undefined && { guard: f.guard }),
      ...(f.operands && { operands: f.operands }),
      operandNames: uniqueNames(
        [f.guard, ...(f.operands ?? [])].map((g) => g || f.operator),
      ),
      ...(f.operandStarts && {
        operandAt: f.operandStarts.map(
          (s) => y(s) - SEQUENCE.header * openingAt(s) - SEQUENCE.divider,
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
  const right = Math.max(
    SEQUENCE.left + SEQUENCE.width + SEQUENCE.frameMargin,
    ...b.nodes.map((n) => n.box!.x + n.box!.width + SEQUENCE.frameMargin),
  );
  const bottom = Math.max(
    ...b.nodes.map((n) => n.box!.y + n.box!.height + SEQUENCE.frameMargin),
    SEQUENCE.top + height + SEQUENCE.frameMargin,
  );
  // StarUML's frame keeps its default 700 x 600 whatever the diagram
  // holds; the frame is sized to every lifeline, fragment and note.
  return {
    ...b.plan(true),
    frame: {
      x: SEQUENCE.frame,
      y: SEQUENCE.frame,
      width: right - SEQUENCE.frame,
      height: bottom - SEQUENCE.frame,
    },
  };
}

/** Names made distinct by a counter, as UML002 wants of siblings: "x", "x 2". */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
}

type FragmentSpec = NonNullable<Spec<"sequence">["fragments"]>[number];

/**
 * Further operands without operandStarts begin at messages spread evenly
 * over the fragment, so each divider falls between messages; StarUML's own
 * equal split cuts through them (issue #34). A fragment with fewer messages
 * than operands keeps the equal split.
 */
function withOperandStarts(f: FragmentSpec): FragmentSpec {
  const count = f.operands?.length ?? 0;
  const inside = f.to - f.from + 1;
  if (f.operandStarts || count === 0 || inside < count + 1) return f;
  return {
    ...f,
    operandStarts: Array.from(
      { length: count },
      (_, k) => f.from + Math.floor(((k + 1) * inside) / (count + 1)),
    ),
  };
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
  const outside = new Set((spec.outside ?? []).map(multiline));
  if (system !== undefined) {
    // Placement sizes the boundary to the grid of use cases it holds.
    b.node({
      key: system,
      type: "UMLUseCaseSubject",
      name: system,
      width: 260,
      height: 100,
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
    b.node({
      key: u,
      type: "UMLUseCase",
      name: u,
      // An ellipse's text runs in its middle band: the name and some air.
      width: Math.max(160, textWidth(u) + 3 * LABEL_PADDING),
      height: 50,
      ...(outside.has(u) && { outside: true }),
    });
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
    const name = nodeName(o.name, key, type === "state");
    // A state view clips its name rather than growing (issue #34).
    const lines = name.split("\n");
    b.node({
      key,
      type: create,
      name,
      width:
        type === "state"
          ? Math.max(width, textWidth(name) + 2 * LABEL_PADDING)
          : width,
      height:
        type === "state"
          ? Math.max(height, 30 + LINE_HEIGHT * lines.length)
          : height,
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
  let widest = 0;
  (spec.transitions ?? []).forEach((t, i) => {
    // StarUML draws "trigger [guard] / effect" (UMLTransition.getString).
    widest = Math.max(
      widest,
      textWidth(
        [
          t.trigger,
          t.guard !== undefined && `[${t.guard}]`,
          t.effect && `/ ${t.effect}`,
        ]
          .filter(Boolean)
          .join(" "),
      ),
    );
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
  return {
    ...b.plan(nested.length > 0),
    fit: true,
    ...(widest > 0 && { edgeLabelWidth: widest }),
  };
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

/** A mind map's row pitch, the gap between its columns and the margin. */
const MIND = { row: 48, gap: 70, margin: 40, height: 36 };

/** Leaves under a mind map node: the rows its subtree takes. */
const leaves = (n: MindNode): number =>
  (n.children ?? []).reduce((sum, c) => sum + leaves(c), 0) || 1;

/**
 * Root in the middle, its branches split between the right and the left
 * so both sides hold about as many leaves (the first branches go right,
 * in order), each side a tidy tree growing outwards with a parent centred
 * on its children. A map drawn down one side measured 1020×8292 for the
 * ThingsBoard features (rated 1/5); balanced it is about square.
 */
function mindmapPlan(spec: Spec<"mindmap">): Plan {
  const b = new Builder("mindmap");
  const widthOf = (n: MindNode) =>
    Math.max(80, textWidth(multiline(n.name)) + 2 * LABEL_PADDING);
  const root = spec.root;
  const branches = root.children ?? [];
  const total = branches.reduce((n, c) => n + leaves(c), 0);
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  let taken = 0;
  for (const c of branches) {
    if (taken < total / 2) {
      right.push(c);
      taken += leaves(c);
    } else left.push(c);
  }
  // Column widths by depth, per side, so a long name does not overlap the
  // next column.
  const columns = (side: MindNode[]) => {
    const widths: number[] = [];
    const walk = (n: MindNode, d: number) => {
      widths[d] = Math.max(widths[d] ?? 0, widthOf(n));
      for (const c of n.children ?? []) walk(c, d + 1);
    };
    for (const c of side) walk(c, 0);
    return widths;
  };
  const rows = (side: MindNode[]) => side.reduce((n, c) => n + leaves(c), 0);
  const height = Math.max(rows(right), rows(left), 1) * MIND.row;
  const leftCols = columns(left);
  const rootW = widthOf(root);
  const rootX = MIND.margin + leftCols.reduce((n, w) => n + w + MIND.gap, 0);
  const rootKey = multiline(root.name);
  const boxes = new Map<string, Box>();
  boxes.set(rootKey, {
    x: rootX,
    y: MIND.margin + height / 2 - MIND.height / 2,
    width: rootW,
    height: MIND.height,
  });
  const layoutSide = (side: MindNode[], dir: 1 | -1) => {
    const cols = columns(side);
    // x of each depth's column: outwards from the root.
    const xs: number[] = [];
    let x = dir === 1 ? rootX + rootW + MIND.gap : rootX - MIND.gap;
    cols.forEach((w, d) => {
      xs[d] = dir === 1 ? x : x - w;
      x += dir * (w + MIND.gap);
    });
    let top = MIND.margin + (height - rows(side) * MIND.row) / 2;
    const place = (n: MindNode, key: string, d: number): number => {
      const kids = n.children ?? [];
      let centre: number;
      if (kids.length === 0) {
        centre = top + MIND.row / 2;
        top += MIND.row;
      } else {
        const ys = kids.map((c) =>
          place(c, `${key}/${multiline(c.name)}`, d + 1),
        );
        centre = (ys[0]! + ys.at(-1)!) / 2;
      }
      const w = widthOf(n);
      boxes.set(key, {
        // A node hugs its column on the root's side.
        x: dir === 1 ? xs[d]! : xs[d]! + cols[d]! - w,
        y: centre - MIND.height / 2,
        width: w,
        height: MIND.height,
      });
      return centre;
    };
    for (const c of side) place(c, `${rootKey}/${multiline(c.name)}`, 0);
  };
  layoutSide(right, 1);
  layoutSide(left, -1);
  const visit = (node: MindNode, parent: string | null) => {
    const key =
      parent === null
        ? multiline(node.name)
        : `${parent}/${multiline(node.name)}`;
    b.node({
      key,
      type: "MMNode",
      name: multiline(node.name),
      width: boxes.get(key)!.width,
      height: MIND.height,
      box: boxes.get(key)!,
      // MMNodeView wraps its name by default (mindmap elements.js 7.1.1),
      // two lines in a box placed for one, onto the row below.
      viewProperties: { wordWrap: false },
    });
    if (parent !== null) b.edge({ type: "MMEdge", from: parent, to: key }, key);
    for (const child of node.children ?? []) visit(child, key);
  };
  visit(root, null);
  return b.plan(true);
}

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
  package: packagePlan,
  component: componentPlan,
  deployment: deploymentPlan,
  composite: (spec) => familyPlan("composite", spec),
  object: (spec) => familyPlan("object", spec),
  communication: (spec) => familyPlan("communication", spec),
  timing: (spec) => familyPlan("timing", spec),
  overview: (spec) => familyPlan("overview", spec),
  infoflow: (spec) => familyPlan("infoflow", spec),
  profile: (spec) => familyPlan("profile", spec),
  dfd: (spec) => familyPlan("dfd", spec),
  bdd: (spec) => familyPlan("bdd", spec),
  ibd: (spec) => familyPlan("ibd", spec),
  parametric: (spec) => familyPlan("parametric", spec),
  bpmn: (spec) => familyPlan("bpmn", spec),
  wireframe: (spec) => familyPlan("wireframe", spec),
  aws: (spec) => familyPlan("aws", spec),
  azure: (spec) => familyPlan("azure", spec),
  gcp: (spec) => familyPlan("gcp", spec),
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
