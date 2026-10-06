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
import { multiline, parseAttribute, parseOperation } from "./members.js";
import {
  Builder,
  common,
  FRAME,
  LABEL_PADDING,
  name,
  type Plan,
  type PlanNode,
  textWidth,
} from "./plan.js";

/*
 * The diagram families of issue #25 that share one spec grammar: nodes of
 * a family's node types, nested with `in`, and edges of its edge types.
 * Each family is data, the palette of its diagram type in 7.1.1
 * (toolbox/*.json of the extension that registers it), so a new family is
 * a table entry rather than a planner.
 */

export interface NodeType {
  /** Model-and-view id or toolbox item id. */
  create: string;
  width?: number;
  height?: number;
  /**
   * How `in` places it. contain (default): moved into the container's view
   * once both exist, as dropping it there does. border: made on the
   * container's border (toolbox option parasitic: ports, parameters).
   * inside: made inside the container, which the factory requires at
   * creation (a timing state in its lifeline, a part in its class).
   */
  in?: "contain" | "border" | "inside";
  /** `in` also makes the container's model own this one's. */
  owned?: boolean;
  /** With no `in`, made in the diagram's frame (a timing lifeline, a block's port). */
  frame?: boolean;
  /** Takes attributes and operations, written as on a class diagram. */
  members?: boolean;
  /** Takes slots, "name = value", as an instance does. */
  slots?: boolean;
  /**
   * How /export_text tells this type's views apart where the model type
   * the create id names does not: the model and view classes, and the
   * owner list holding the model (SysML parts, references and values are
   * all SysMLProperty in SysMLPartView, filed in parts, references or
   * values by sysml-factory.js).
   */
  match?: { model?: string; view?: string; field?: string };
  /** Its width means something (a time segment's duration) and is written back. */
  keepWidth?: boolean;
}

export interface Family {
  diagram: string;
  /** What the diagram shows, for the manifest. */
  title: string;
  nodes: Record<string, NodeType>;
  edges: Record<string, string>;
  /** The node and edge type a spec entry without `type` gets. */
  node: string;
  edge?: string;
  /**
   * The model type the diagram is drawn for and filed under, made from
   * spec.block when the parent is not one: an internal block or parametric
   * diagram shows the inside of one block (SysML 1.6 §8.3.1.2).
   */
  owner?: string;
  /**
   * An edge type drawn along another edge rather than between nodes: a
   * communication message rides the connector between its lifelines, as
   * `forward` when it runs the connector's way, else as `reverse`.
   */
  riding?: { type: string; along: string; forward: string; reverse: string };
  /**
   * StarUML draws the diagram in a frame (a view whose model is the
   * diagram), which the placement wraps around the nodes; the engine
   * layout would treat it as one more node.
   */
  framed?: boolean;
  /** What a container holds is stacked top to bottom (a wireframe's controls). */
  stack?: boolean;
  /** Containers hide their compartments for what they hold (a class's parts). */
  suppress?: boolean;
  /**
   * Edge types whose `from` is the whole: the toolbox's composition and
   * aggregation put the diamond on end2, the head (model-init in
   * sysml/toolbox), so the edge is drawn from `to` to `from` (issue #29).
   */
  wholeFirst?: readonly string[];
}

/** Widths below this are symbols, not boxes holding their name. */
const ICON = 100;

const node = (create: string, more: Partial<NodeType> = {}): NodeType => ({
  create,
  ...more,
});

const BPMN_FLOW = (create: string, more: Partial<NodeType> = {}) =>
  node(create, { width: 120, height: 60, ...more });
const EVENT = (create: string) => node(create, { width: 30, height: 30 });
const GATEWAY = (create: string) => node(create, { width: 40, height: 40 });

const WF = (create: string, width = 160, height = 30) =>
  node(create, { width, height });

/** Family kinds, by the spec kind name /build_diagram takes. */
export const FAMILIES = {
  composite: {
    diagram: "UMLCompositeStructureDiagram",
    title:
      "UML composite structure: classes with their parts, ports and connectors, collaborations",
    nodes: {
      class: node("UMLClass", { width: 220, height: 140, members: true }),
      part: node("UMLPart", {
        in: "inside",
        owned: true,
        width: 100,
        match: { model: "UMLAttribute", view: "UMLPartView" },
      }),
      port: node("UMLPort", {
        in: "border",
        owned: true,
        width: 20,
        height: 20,
      }),
      interface: node("UMLInterface", { width: 30, height: 30 }),
      collaboration: node("UMLCollaboration", { width: 160, height: 80 }),
      collaborationUse: node("UMLCollaborationUse", { width: 140 }),
    },
    edges: {
      connector: "UMLConnector",
      association: "UMLAssociation",
      dependency: "UMLDependency",
      realization: "UMLRealization",
      roleBinding: "UMLRoleBinding",
      generalization: "UMLGeneralization",
    },
    node: "class",
    edge: "connector",
    suppress: true,
  },
  object: {
    diagram: "UMLObjectDiagram",
    title: "UML object: instances with slot values and the links between them",
    nodes: {
      object: node("UMLObject", { width: 160, slots: true }),
      class: node("UMLClass", { members: true }),
      componentInstance: node("UMLComponentInstance", { width: 160 }),
      nodeInstance: node("UMLNodeInstance", { width: 160, height: 80 }),
      artifactInstance: node("UMLArtifactInstance", { width: 160 }),
    },
    edges: {
      link: "UMLLink",
      directedLink: "UMLDirectedLink",
      dependency: "UMLDependency",
    },
    node: "object",
    edge: "link",
  },
  communication: {
    diagram: "UMLCommunicationDiagram",
    title:
      "UML communication: lifelines, the connectors between them and numbered messages along the connectors",
    nodes: { lifeline: node("UMLLifeline", { width: 120, height: 40 }) },
    edges: { connector: "UMLConnector", message: "UMLForwardMessage" },
    node: "lifeline",
    edge: "message",
    framed: true,
    riding: {
      type: "message",
      along: "connector",
      forward: "UMLForwardMessage",
      reverse: "UMLReverseMessage",
    },
  },
  timing: {
    diagram: "UMLTimingDiagram",
    title:
      "UML timing: lifelines in the frame, their states, the time segments each state lasts and messages between segments",
    nodes: {
      lifeline: node("UMLLifeline", { frame: true, width: 600, height: 100 }),
      state: node("UMLTimingState", {
        in: "inside",
        width: 600,
        height: 20,
        match: { model: "UMLConstraint" },
      }),
      segment: node("UMLTimeSegment", {
        in: "inside",
        width: 80,
        height: 20,
        match: { model: "UMLStateInvariant" },
        keepWidth: true,
      }),
    },
    edges: { message: "UMLMessage" },
    node: "lifeline",
    edge: "message",
    framed: true,
  },
  overview: {
    diagram: "UMLInteractionOverviewDiagram",
    title:
      "UML interaction overview: interactions and interaction uses joined by control flow",
    nodes: {
      interactionUse: node("UMLInteractionUseInOverview", {
        width: 160,
        match: { model: "UMLAction", view: "UMLInteractionUseView" },
      }),
      interaction: node("UMLInteractionInOverview", {
        width: 200,
        height: 120,
        match: { model: "UMLAction", view: "UMLInteractionInlineView" },
      }),
      initial: node("UMLInitialNode", { width: 20, height: 20 }),
      final: node("UMLActivityFinalNode", { width: 26, height: 26 }),
      decision: node("UMLDecisionNode", { width: 30, height: 40 }),
      merge: node("UMLMergeNode", { width: 30, height: 40 }),
      fork: node("UMLForkNode", { width: 80, height: 8 }),
      join: node("UMLJoinNode", { width: 80, height: 8 }),
    },
    edges: { flow: "UMLControlFlow" },
    node: "interactionUse",
    edge: "flow",
    framed: true,
  },
  infoflow: {
    diagram: "UMLInformationFlowDiagram",
    title:
      "UML information flow: classifiers and the information items conveyed between them",
    nodes: {
      class: node("UMLClass"),
      actor: node("UMLActor", { width: 40, height: 80 }),
      useCase: node("UMLUseCase", { width: 140 }),
      item: node("UMLInformationItem"),
    },
    edges: {
      flow: "UMLInformationFlow",
      dependency: "UMLDependency",
      association: "UMLAssociation",
    },
    node: "class",
    edge: "flow",
  },
  profile: {
    diagram: "UMLProfileDiagram",
    title:
      "UML profile: stereotypes, the metaclasses they extend and their generalizations",
    nodes: {
      stereotype: node("UMLStereotype", { width: 160, members: true }),
      metaclass: node("UMLMetaClass", { width: 140 }),
      enumeration: node("UMLEnumeration"),
    },
    edges: { extension: "UMLExtension", generalization: "UMLGeneralization" },
    node: "stereotype",
    edge: "extension",
  },
  dfd: {
    diagram: "DFDDiagram",
    title:
      "Data flow (Gane–Sarson): external entities, processes, data stores and data flows",
    nodes: {
      external: node("DFDExternalEntity", { width: 140 }),
      process: node("DFDProcess", { width: 140, height: 80 }),
      store: node("DFDDataStore", { width: 160, height: 40 }),
    },
    edges: { flow: "DFDDataFlow" },
    node: "process",
    edge: "flow",
  },
  bdd: {
    diagram: "SysMLBlockDefinitionDiagram",
    title:
      "SysML block definition: blocks, value and constraint types, their compositions and generalizations",
    nodes: {
      block: node("SysMLBlock", { width: 160, height: 80, members: true }),
      valueType: node("SysMLValueType", { width: 160 }),
      interfaceBlock: node("SysMLInterfaceBlock", { width: 160 }),
      constraintBlock: node("SysMLConstraintBlock", { width: 180 }),
      enumeration: node("UMLEnumeration"),
      signal: node("UMLSignal"),
      stakeholder: node("SysMLStakeholder"),
      viewpoint: node("SysMLViewpoint", { width: 160 }),
      view: node("SysMLView", { width: 160 }),
    },
    edges: {
      association: "UMLAssociation",
      directed: "UMLDirectedAssociation",
      composition: "UMLComposition",
      aggregation: "UMLAggregation",
      generalization: "UMLGeneralization",
      dependency: "UMLDependency",
      realization: "UMLInterfaceRealization",
      conform: "SysMLConform",
      expose: "SysMLExpose",
    },
    node: "block",
    edge: "composition",
    wholeFirst: ["composition", "aggregation"],
    framed: true,
  },
  ibd: {
    diagram: "SysMLInternalBlockDiagram",
    title:
      "SysML internal block: the parts, references and values inside one block (spec.block), its ports and the connectors between them",
    nodes: {
      part: node("SysMLPart", { width: 140, match: { field: "parts" } }),
      reference: node("SysMLReference", {
        width: 140,
        match: { field: "references" },
      }),
      value: node("SysMLValue", { width: 140, match: { field: "values" } }),
      port: node("SysMLPort", {
        in: "border",
        frame: true,
        width: 20,
        height: 20,
      }),
    },
    edges: { connector: "SysMLConnector" },
    node: "part",
    edge: "connector",
    owner: "SysMLBlock",
    framed: true,
  },
  parametric: {
    diagram: "SysMLParametricDiagram",
    title:
      "SysML parametric: constraint properties of one block (spec.block), their parameters and the values bound to them",
    nodes: {
      constraint: node("SysMLConstraintProperty", {
        width: 180,
        height: 80,
        match: { field: "constraints" },
      }),
      parameter: node("SysMLConstraintParameter", {
        in: "border",
        width: 20,
        height: 20,
        match: { model: "SysMLProperty", field: "parameters" },
      }),
      value: node("SysMLValue", { width: 140, match: { field: "values" } }),
      part: node("SysMLPart", { width: 140, match: { field: "parts" } }),
    },
    edges: { connector: "SysMLConnector" },
    node: "constraint",
    edge: "connector",
    owner: "SysMLBlock",
    framed: true,
  },
  bpmn: {
    diagram: "BPMNDiagram",
    title:
      "BPMN process: pools and lanes, tasks, events, gateways, data and the flows between them",
    nodes: {
      pool: node("BPMNParticipant", { width: 600, height: 200 }),
      lane: node("BPMNLane", { width: 570, height: 100 }),
      task: BPMN_FLOW("BPMNTask"),
      userTask: BPMN_FLOW("BPMNUserTask"),
      serviceTask: BPMN_FLOW("BPMNServiceTask"),
      sendTask: BPMN_FLOW("BPMNSendTask"),
      receiveTask: BPMN_FLOW("BPMNReceiveTask"),
      manualTask: BPMN_FLOW("BPMNManualTask"),
      scriptTask: BPMN_FLOW("BPMNScriptTask"),
      businessRuleTask: BPMN_FLOW("BPMNBusinessRuleTask"),
      callActivity: BPMN_FLOW("BPMNCallActivity"),
      subProcess: BPMN_FLOW("BPMNSubProcess", { width: 160, height: 100 }),
      start: EVENT("BPMNStartEvent"),
      end: EVENT("BPMNEndEvent"),
      throw: EVENT("BPMNIntermediateThrowEvent"),
      catch: EVENT("BPMNIntermediateCatchEvent"),
      exclusive: GATEWAY("BPMNExclusiveGateway"),
      parallel: GATEWAY("BPMNParallelGateway"),
      inclusive: GATEWAY("BPMNInclusiveGateway"),
      eventBased: GATEWAY("BPMNEventBasedGateway"),
      complex: GATEWAY("BPMNComplexGateway"),
      dataObject: node("BPMNDataObject", { width: 40, height: 50 }),
      dataStore: node("BPMNDataStore", { width: 50, height: 50 }),
      annotation: node("BPMNTextAnnotation", { width: 120, height: 40 }),
    },
    edges: {
      sequence: "BPMNSequenceFlow",
      message: "BPMNMessageFlow",
      association: "BPMNAssociation",
      data: "BPMNDataAssociation",
    },
    node: "task",
    edge: "sequence",
  },
  wireframe: {
    diagram: "WFWireframeDiagram",
    title:
      "Wireframe: frames (web, mobile, desktop) holding panels and controls, top to bottom",
    nodes: {
      frame: node("WFFrame", { width: 320, height: 240 }),
      webFrame: node("WFWebFrame", { width: 400, height: 300 }),
      mobileFrame: node("WFMobileFrame", { width: 240, height: 420 }),
      desktopFrame: node("WFDesktopFrame", { width: 400, height: 300 }),
      panel: node("WFPanel", { width: 200, height: 120 }),
      button: WF("WFButton", 120),
      text: WF("WFText"),
      input: WF("WFInput"),
      dropdown: WF("WFDropdown"),
      checkbox: WF("WFCheckbox"),
      radio: WF("WFRadio"),
      switch: WF("WFSwitch", 80),
      link: WF("WFLink", 120),
      tabList: WF("WFTabList", 200),
      tab: WF("WFTab", 80),
      image: WF("WFImage", 120, 90),
      separator: WF("WFSeparator", 160, 10),
      avatar: WF("WFAvatar", 40, 40),
      slider: WF("WFSlider"),
    },
    edges: {},
    node: "frame",
    stack: true,
  },
  aws: {
    diagram: "AWSDiagram",
    title:
      "AWS architecture: groups (cloud, VPC, subnets, availability zones, security groups) holding services and resources, joined by arrows",
    nodes: {
      group: node("AWSGroup", { width: 320, height: 200 }),
      genericGroup: node("AWSGenericGroup", { width: 320, height: 200 }),
      availabilityZone: node("AWSAvailabilityZone", {
        width: 300,
        height: 180,
      }),
      securityGroup: node("AWSSecurityGroup", { width: 280, height: 160 }),
      service: node("AWSService", { width: 60, height: 60 }),
      resource: node("AWSResource", { width: 60, height: 60 }),
      generalResource: node("AWSGeneralResource", { width: 60, height: 60 }),
      callout: node("AWSCallout", { width: 30, height: 30 }),
    },
    edges: { arrow: "AWSArrow" },
    node: "service",
    edge: "arrow",
  },
  azure: {
    diagram: "AzureDiagram",
    title: "Azure architecture: groups holding services, joined by connectors",
    nodes: {
      group: node("AzureGroup", { width: 320, height: 200 }),
      service: node("AzureService", { width: 60, height: 60 }),
      callout: node("AzureCallout", { width: 30, height: 30 }),
    },
    edges: { connector: "AzureConnector" },
    node: "service",
    edge: "connector",
  },
  gcp: {
    diagram: "GCPDiagram",
    title:
      "Google Cloud architecture: users, zones (project, region, …) holding products and services, joined by paths",
    nodes: {
      user: node("GCPUser", { width: 60, height: 60 }),
      zone: node("GCPZone", { width: 320, height: 200 }),
      product: node("GCPProduct", { width: 160, height: 60 }),
      service: node("GCPService", { width: 160, height: 60 }),
    },
    edges: { path: "GCPPath" },
    node: "product",
    edge: "path",
  },
} as const satisfies Record<string, Family>;

export type FamilyKind = keyof typeof FAMILIES;
export const FAMILY_KINDS = Object.keys(FAMILIES) as FamilyKind[];

const enumOf = (keys: readonly string[]) =>
  z.enum(keys as [string, ...string[]]);

const family = (kind: FamilyKind): Family => FAMILIES[kind];

/** The spec schema of a family, its node and edge types listed. */
export function familySpec(kind: FamilyKind) {
  const f = family(kind);
  const nodeTypes = Object.keys(f.nodes);
  const edgeTypes = Object.keys(f.edges);
  const size = (what: string) =>
    z.optional(doc(z.int().check(z.minimum(10)), `${what} of the view.`));
  return z.object({
    ...common(),
    ...(f.owner && {
      block: z.optional(
        doc(
          name(),
          `The ${f.owner} the diagram shows the inside of; made unless parent is one or one of this name is there.`,
        ),
      ),
    }),
    nodes: z.optional(
      z.array(
        z.union([
          name(),
          z.object({
            name: z.optional(z.string()),
            id: z.optional(
              doc(name(), "Key for edges and in; default the name."),
            ),
            type: z.optional(doc(enumOf(nodeTypes), `Default ${f.node}.`)),
            in: z.optional(
              doc(
                name(),
                "The node (id or name) this one sits in, or on for a port or parameter.",
              ),
            ),
            stereotype: z.optional(z.string()),
            documentation: z.optional(z.string()),
            properties: z.optional(
              doc(
                z.record(z.string(), z.unknown()),
                "Model attributes by name, e.g. icon for a cloud service, checked for a checkbox.",
              ),
            ),
            attributes: z.optional(z.array(name())),
            operations: z.optional(z.array(name())),
            slots: z.optional(
              doc(z.array(name()), "Instance values, 'name = value'."),
            ),
            width: size("Width"),
            height: size("Height"),
          }),
        ]),
      ),
    ),
    edges: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          ...(edgeTypes.length > 0 && {
            type: z.optional(doc(enumOf(edgeTypes), `Default ${f.edge}.`)),
          }),
          name: z.optional(z.string()),
          properties: z.optional(z.record(z.string(), z.unknown())),
        }),
      ),
    ),
  });
}

export type FamilySpec = z.output<ReturnType<typeof familySpec>>;

/** One line per family for the manifest's description of spec. */
export function familyGrammar(): string {
  return FAMILY_KINDS.map((k) => {
    const f = family(k);
    const edges = Object.keys(f.edges);
    return `${k} (${f.title}): {${f.owner ? "block, " : ""}nodes: [{name, id, type: ${Object.keys(f.nodes).join("|")}, in, stereotype, properties${Object.values(f.nodes).some((n) => n.members) ? ", attributes, operations" : ""}${Object.values(f.nodes).some((n) => n.slots) ? ", slots" : ""}, width, height}]${edges.length > 0 ? `, edges: [{from, to, type: ${edges.join("|")}, name}]` : ""}}`;
  }).join(". ");
}

/** "name = value" as a slot. */
export function parseSlot(source: string): { name: string; value: string } {
  const eq = source.indexOf("=");
  return eq < 0
    ? { name: source.trim(), value: "" }
    : { name: source.slice(0, eq).trim(), value: source.slice(eq + 1).trim() };
}

interface FamilyEdge {
  from: string;
  to: string;
  type?: string;
  name?: string;
  properties?: Record<string, unknown>;
}

type NodeEntry = Exclude<NonNullable<FamilySpec["nodes"]>[number], string>;

/** Where a timing diagram's rows start and the width of their name column. */
export const TIMING = { left: 40, top: 80, label: 120, width: 640, row: 30 };

/**
 * Fixed boxes for a timing diagram: lifelines one under the other, each
 * state a row of its lifeline, and segments one after the other along
 * their lifeline's time axis in spec order, each in its state's row. The
 * frame arranges lifelines and states itself (UMLTimingFrameView
 * .arrangeObject, uml/elements.js in 7.1.1); where a segment starts and
 * ends is what the diagram says.
 */
function timeline(nodes: PlanNode[]): void {
  const lifelines = nodes.filter((n) => n.host === FRAME);
  let y = TIMING.top;
  for (const l of lifelines) {
    const states = nodes.filter((n) => n.host === l.key);
    const height = Math.max(60, TIMING.row * states.length + 20);
    l.box = { x: TIMING.left, y, width: TIMING.width, height };
    let t = TIMING.left + TIMING.label;
    states.forEach((st, j) => {
      st.box = {
        x: TIMING.left + TIMING.label,
        y: y + 10 + j * TIMING.row,
        width: TIMING.width - TIMING.label,
        height: 20,
      };
    });
    for (const seg of nodes.filter((n) =>
      states.some((st) => st.key === n.host),
    )) {
      const row = states.find((st) => st.key === seg.host)!.box!;
      seg.box = { x: t, y: row.y, width: seg.width, height: row.height };
      t += seg.width;
    }
    y += height + 20;
  }
}

/** The plan of a family spec: its nodes by key, nested by `in`, and edges. */
export function familyPlan(kind: FamilyKind, spec: FamilySpec): Plan {
  const f = family(kind);
  const b = new Builder(kind);
  const entries = (spec.nodes ?? []).map((n): NodeEntry =>
    typeof n === "string" ? { name: n } : n,
  );
  const keyOf = (n: NodeEntry, i: number) => {
    const key = n.id ?? (n.name !== undefined ? multiline(n.name) : undefined);
    if (key === undefined || key === "") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.nodes.${i}: needs a name or an id`,
      );
    }
    return key;
  };
  const keys = entries.map(keyOf);
  const typeOf = (n: NodeEntry) => f.nodes[n.type ?? f.node]!;
  // Containers before what they hold, so a container's view exists when a
  // node is made in it; `in` that loops or names nothing is refused.
  const order: number[] = [];
  const state = new Map<number, "open" | "done">();
  const visit = (i: number) => {
    if (state.get(i) === "done") return;
    if (state.get(i) === "open") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.nodes.${i}.in: ${keys[i]} would be inside itself`,
      );
    }
    state.set(i, "open");
    const into = entries[i]!.in;
    if (into !== undefined) {
      const c = keys.indexOf(multiline(into));
      if (c < 0) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.nodes.${i}.in: no node named ${into}`,
        );
      }
      visit(c);
    }
    state.set(i, "done");
    order.push(i);
  };
  entries.forEach((_, i) => visit(i));
  for (const i of order) {
    const n = entries[i]!;
    const t = typeOf(n);
    const key = keys[i]!;
    const label = n.name !== undefined ? multiline(n.name) : "";
    const into = n.in !== undefined ? multiline(n.in) : undefined;
    const properties = {
      ...n.properties,
      ...(n.stereotype !== undefined && { stereotype: n.stereotype }),
      ...(n.documentation !== undefined && { documentation: n.documentation }),
    };
    const placement = t.in ?? "contain";
    const where: Partial<PlanNode> =
      into !== undefined
        ? placement === "contain"
          ? { container: into }
          : { host: into, ...(placement === "inside" && { inside: true }) }
        : t.frame
          ? t.in === "border"
            ? { host: FRAME }
            : { host: FRAME, inside: true }
          : {};
    if (into !== undefined && t.owned) where.owner = into;
    // A type narrower than ICON is a symbol with its name beside or under
    // it (an event, a gateway, a cloud icon); a wider one holds its name.
    const width =
      n.width ??
      ((t.width ?? 120) < ICON
        ? t.width!
        : Math.max(t.width ?? 120, textWidth(label) + 2 * LABEL_PADDING));
    b.node({
      key,
      type: t.create,
      name: label,
      ...(Object.keys(properties).length > 0 && { properties }),
      ...where,
      ...(t.members &&
        n.attributes && { attributes: n.attributes.map(parseAttribute) }),
      ...(t.members &&
        n.operations && { operations: n.operations.map(parseOperation) }),
      ...(t.slots && n.slots && { slots: n.slots.map(parseSlot) }),
      // Every border type gives its size.
      width: t.in === "border" ? t.width! : width,
      height: n.height ?? t.height ?? 60,
    });
  }
  const edges = (spec.edges ?? []) as FamilyEdge[];
  if (edges.length > 0 && f.edge === undefined) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec.edges: a ${kind} diagram has no edges; nest nodes with in`,
    );
  }
  const rides = (e: { type?: string }) =>
    f.riding !== undefined && (e.type ?? f.edge) === f.riding.type;
  const edgeOf = (e: FamilyEdge) => {
    const t = e.type ?? f.edge!;
    const swap = f.wholeFirst?.includes(t) === true;
    return {
      type: f.edges[t]!,
      from: swap ? e.to : e.from,
      to: swap ? e.from : e.to,
      ...(e.name !== undefined && { name: multiline(e.name) }),
      ...(e.properties && { properties: e.properties }),
    };
  };
  edges.forEach((e, i) => {
    if (!rides(e)) b.edge({ ...edgeOf(e), source: i }, `edges.${i}`);
  });
  // A communication message is drawn along the connector between its
  // lifelines (messageFn in uml-factory.js, 7.1.1); a connector the spec
  // does not declare is made for it.
  edges.forEach((e, i) => {
    if (!rides(e)) return;
    const r = f.riding!;
    const from = multiline(e.from);
    const to = multiline(e.to);
    const connector = f.edges[r.along]!;
    let along = b.edges.findIndex(
      (x) =>
        x.type === connector &&
        ((x.from === from && x.to === to) || (x.from === to && x.to === from)),
    );
    if (along < 0) {
      b.edge({ type: connector, from, to, implicit: true }, `edges.${i}`);
      along = b.edges.length - 1;
    }
    b.edge(
      {
        ...edgeOf(e),
        type: b.edges[along]!.from === from ? r.forward : r.reverse,
        along,
        source: i,
      },
      `edges.${i}`,
    );
  });
  if (kind === "timing") timeline(b.nodes);
  if (f.suppress) {
    // The parts drawn inside a class are its attributes too; listed in its
    // compartment as well they would sit under the parts.
    for (const n of b.nodes) {
      const holds = b.nodes.some(
        (o) => o.container === n.key || (o.inside && o.host === n.key),
      );
      if (holds) {
        n.viewProperties = {
          suppressAttributes: true,
          suppressOperations: true,
        };
      }
    }
  }
  const plan = b.plan(
    b.nodes.some((n) => n.container !== undefined || n.host !== undefined) ||
      f.framed === true,
  );
  if (f.owner) {
    const block = (spec as { block?: string }).block;
    plan.owner = {
      type: f.owner,
      ...(block !== undefined && { name: multiline(block) }),
    };
  }
  if (f.framed) plan.framed = true;
  if (f.stack) plan.stack = true;
  return plan;
}
