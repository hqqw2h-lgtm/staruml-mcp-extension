import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  call,
  describeLive,
  indexMdj,
  liveDir,
  type MdjElement,
  type Summary,
} from "./support.js";

interface Ref {
  $ref: string;
}
interface Created {
  view: Summary | null;
  model: (Summary & Record<string, unknown>) | null;
}

/**
 * One case per relationship id 7.1.1 registers: the diagram it is drawn on
 * and the toolbox items at its ends that satisfy the factory's precondition
 * (uml-factory.js, erd-factory.js, ... in 7.1.1). A `host` puts both ends
 * inside a view of that item, as parts and ports must be.
 */
const CASES: {
  type: string;
  diagram: string;
  tail: string;
  head: string;
  host?: string;
}[] = [
  {
    type: "UMLAssociation",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLClass",
  },
  {
    type: "UMLGeneralization",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLClass",
  },
  {
    type: "UMLDependency",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLClass",
  },
  {
    type: "UMLRealization",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLInterface",
  },
  {
    type: "UMLInterfaceRealization",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLInterface",
  },
  {
    type: "UMLTemplateBinding",
    diagram: "UMLClassDiagram",
    tail: "UMLClass",
    head: "UMLClass",
  },
  {
    type: "UMLInformationFlow",
    diagram: "UMLInformationFlowDiagram",
    tail: "UMLClass",
    head: "UMLClass",
  },
  {
    type: "UMLComponentRealization",
    diagram: "UMLComponentDiagram",
    tail: "UMLClass",
    head: "UMLComponent",
  },
  {
    type: "UMLDeployment",
    diagram: "UMLDeploymentDiagram",
    tail: "UMLArtifact",
    head: "UMLNode",
  },
  {
    type: "UMLCommunicationPath",
    diagram: "UMLDeploymentDiagram",
    tail: "UMLNode",
    head: "UMLNode",
  },
  {
    type: "UMLLink",
    diagram: "UMLObjectDiagram",
    tail: "UMLObject",
    head: "UMLObject",
  },
  {
    type: "UMLInclude",
    diagram: "UMLUseCaseDiagram",
    tail: "UMLUseCase",
    head: "UMLUseCase",
  },
  {
    type: "UMLExtend",
    diagram: "UMLUseCaseDiagram",
    tail: "UMLUseCase",
    head: "UMLUseCase",
  },
  {
    type: "UMLExtension",
    diagram: "UMLProfileDiagram",
    tail: "UMLStereotype",
    head: "UMLMetaClass",
  },
  {
    type: "UMLConnector",
    diagram: "UMLCompositeStructureDiagram",
    tail: "UMLPart",
    head: "UMLPart",
    host: "UMLClass",
  },
  {
    type: "UMLRoleBinding",
    diagram: "UMLCompositeStructureDiagram",
    tail: "UMLCollaborationUse",
    head: "UMLPart",
    host: "UMLClass",
  },
  {
    type: "UMLMessage",
    diagram: "UMLSequenceDiagram",
    tail: "UMLLifeline",
    head: "UMLLifeline",
  },
  {
    type: "UMLTransition",
    diagram: "UMLStatechartDiagram",
    tail: "UMLState",
    head: "UMLState",
  },
  {
    type: "UMLControlFlow",
    diagram: "UMLActivityDiagram",
    tail: "UMLAction",
    head: "UMLAction",
  },
  {
    type: "UMLObjectFlow",
    diagram: "UMLActivityDiagram",
    tail: "UMLAction",
    head: "UMLObjectNode",
  },
  {
    type: "UMLExceptionHandler",
    diagram: "UMLActivityDiagram",
    tail: "UMLAction",
    head: "UMLAction",
  },
  {
    type: "UMLActivityInterrupt",
    diagram: "UMLActivityDiagram",
    tail: "UMLAction",
    head: "UMLAction",
  },
  {
    type: "ERDRelationship",
    diagram: "ERDDiagram",
    tail: "ERDEntity",
    head: "ERDEntity",
  },
  {
    type: "DFDDataFlow",
    diagram: "DFDDiagram",
    tail: "DFDProcess",
    head: "DFDDataStore",
  },
  {
    type: "FCFlow",
    diagram: "FCFlowchartDiagram",
    tail: "FCProcess",
    head: "FCDecision",
  },
  {
    type: "MMEdge",
    diagram: "MMMindmapDiagram",
    tail: "MMNode",
    head: "MMNode",
  },
  {
    type: "C4Relationship",
    diagram: "C4Diagram",
    tail: "C4Person",
    head: "C4SoftwareSystem",
  },
  {
    type: "AWSArrow",
    diagram: "AWSDiagram",
    tail: "AWSService",
    head: "AWSResource",
  },
  {
    type: "AzureConnector",
    diagram: "AzureDiagram",
    tail: "AzureService",
    head: "AzureService",
  },
  {
    type: "GCPPath",
    diagram: "GCPDiagram",
    tail: "GCPUser",
    head: "GCPService",
  },
  {
    type: "BPMNSequenceFlow",
    diagram: "BPMNDiagram",
    tail: "BPMNTask",
    head: "BPMNTask",
  },
  {
    type: "BPMNMessageFlow",
    diagram: "BPMNDiagram",
    tail: "BPMNParticipant",
    head: "BPMNParticipant",
  },
  {
    type: "BPMNAssociation",
    diagram: "BPMNDiagram",
    tail: "BPMNTextAnnotation",
    head: "BPMNTask",
  },
  {
    type: "BPMNDataAssociation",
    diagram: "BPMNDiagram",
    tail: "BPMNTask",
    head: "BPMNDataObject",
  },
  {
    type: "BPMNMessageLink",
    diagram: "BPMNDiagram",
    tail: "BPMNMessage",
    head: "BPMNParticipant",
  },
  {
    type: "BPMNConversationLink",
    diagram: "BPMNDiagram",
    tail: "BPMNConversation",
    head: "BPMNParticipant",
  },
  {
    type: "SysMLConform",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLView",
    head: "SysMLViewpoint",
  },
  {
    type: "SysMLExpose",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLView",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLCopy",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLRequirement",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLDeriveReqt",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLRequirement",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLVerify",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLRequirement",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLSatisfy",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLRequirement",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLRefine",
    diagram: "SysMLRequirementDiagram",
    tail: "SysMLRequirement",
    head: "SysMLRequirement",
  },
  {
    type: "SysMLConnector",
    diagram: "SysMLInternalBlockDiagram",
    tail: "SysMLPart",
    head: "SysMLPart",
    host: "SysMLBlock",
  },
];

// Issue #5: every relationship 7.1.1 registers, created with its ends set.
describeLive("relationships against StarUML 7.1.1", () => {
  const dir = liveDir();
  let modelId = "";
  const diagrams = new Map<string, string>();
  let row = 0;

  async function diagram(typeName: string): Promise<string> {
    if (!diagrams.has(typeName)) {
      diagrams.set(
        typeName,
        (
          await call<Summary>("/create_diagram", {
            type: typeName,
            parentId: modelId,
          })
        ).data._id,
      );
    }
    return diagrams.get(typeName)!;
  }

  async function node(
    type: string,
    diagramId: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ view: Summary; model: Summary }> {
    const res = await call<{ view: Summary; model: Summary }>(
      "/create_element_with_view",
      { type, diagramId, x, y, x2: x + 120, y2: y + 100, ...extra },
    );
    expect(res.success, `${type}: ${res.error}`).toBe(true);
    return res.data;
  }

  /**
   * The end element and its owner. Object flows between actions and
   * exception handlers end on pins StarUML adds to the actions
   * (objectFlowFn, exceptionHandlerFn in uml-factory.js).
   */
  async function endOwner(id: string): Promise<string[]> {
    const res = await call<Summary>("/get_element_by_id", { id });
    return [id, res.data._parent!];
  }

  /** Two end views for a case, side by side on their own row. */
  async function ends(c: (typeof CASES)[number]) {
    const diagramId = await diagram(c.diagram);
    const y = 40 + row++ * 220;
    let extra: Record<string, unknown> = {};
    if (c.host) {
      const host = await node(c.host, diagramId, 20, y - 20);
      await call("/update_element", {
        id: host.view._id,
        field: "width",
        value: 700,
      });
      await call("/update_element", {
        id: host.view._id,
        field: "height",
        value: 200,
      });
      extra = { containerViewId: host.view._id, parentId: host.model._id };
    }
    const tail = await node(c.tail, diagramId, 60, y, extra);
    const head = await node(c.head, diagramId, 420, y, extra);
    return { diagramId, tail, head };
  }

  beforeAll(async () => {
    const project = (await call<{ project: Summary }>("/new_project")).data
      .project;
    modelId = (
      await call<Summary>("/create_element", {
        type: "UMLModel",
        parentId: project._id,
        name: "Relationships",
      })
    ).data._id;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("has a case for every relationship id in the catalogue", async () => {
    const intro = await call<{
      factory: { modelAndView: { id: string; relationship: string | null }[] };
    }>("/introspect", { include: ["factory"] });
    const registered = intro.data.factory.modelAndView
      .filter((e) => e.relationship)
      .map((e) => e.id)
      .sort();
    expect(CASES.map((c) => c.type).sort()).toEqual(registered);
  });

  it.each(CASES)("draws $type from $tail to $head on a $diagram", async (c) => {
    const { diagramId, tail, head } = await ends(c);
    const res = await call<Created>("/create_relationship", {
      type: c.type,
      diagramId,
      tailId: tail.view._id,
      headId: head.view._id,
      fields: ["source", "target", "end1", "end2", "reference"],
      depth: 1,
    });
    expect(res.success, res.error).toBe(true);
    expect(res.data.view).not.toBeNull();
    const m = res.data.model!;
    if ("source" in m) {
      expect(await endOwner((m.source as Ref).$ref)).toContain(tail.model._id);
      expect(await endOwner((m.target as Ref).$ref)).toContain(head.model._id);
    } else {
      // Connectors reference the parts (UMLAttribute/SysMLProperty) at their ends.
      const end1 = (m.end1 as { reference: Ref }).reference.$ref;
      const end2 = (m.end2 as { reference: Ref }).reference.$ref;
      expect(end1).toBe(tail.model._id);
      expect(end2).toBe(head.model._id);
    }
  });

  it("sets the source and target of a directed relationship to the end models", async () => {
    const { diagramId, tail, head } = await ends(CASES[1]!);
    const res = await call<Created>("/create_relationship", {
      type: "UMLGeneralization",
      diagramId,
      tailId: tail.model._id,
      headId: head.model._id,
      fields: ["source", "target", "_parent"],
    });
    expect(res.data.model).toMatchObject({
      source: { $ref: tail.model._id },
      target: { $ref: head.model._id },
      // The factory files it under the tail model (uml-factory.js).
      _parent: tail.model._id,
    });
  });

  it("sets association end names, navigability, aggregation and multiplicity, saved to the .mdj", async () => {
    const { diagramId, tail, head } = await ends(CASES[0]!);
    const res = await call<Created>("/create_relationship", {
      type: "UMLAssociation",
      diagramId,
      tailId: tail.model._id,
      headId: head.view._id,
      name: "holds",
      tailEnd: { name: "owner", aggregation: "composite", multiplicity: "1" },
      headEnd: { name: "items", navigable: "navigable", multiplicity: "0..*" },
    });
    expect(res.success, res.error).toBe(true);
    const file = join(dir, "relationships.mdj");
    expect((await call("/save_project_as", { filename: file })).success).toBe(
      true,
    );
    const byId = indexMdj(
      JSON.parse(readFileSync(file, "utf-8")) as MdjElement,
    );
    const assoc = byId.get(res.data.model!._id)!;
    expect(assoc).toMatchObject({
      _type: "UMLAssociation",
      name: "holds",
      end1: {
        name: "owner",
        aggregation: "composite",
        multiplicity: "1",
        reference: { $ref: tail.model._id },
      },
      end2: {
        name: "items",
        navigable: "navigable",
        multiplicity: "0..*",
        reference: { $ref: head.model._id },
      },
    });
  });

  it("applies toolbox presets: composition, many-to-many, asynchronous and self messages", async () => {
    const cls = await ends(CASES[0]!);
    const composition = await call<Created>("/create_relationship", {
      type: "UMLComposition",
      diagramId: cls.diagramId,
      tailId: cls.tail.view._id,
      headId: cls.head.view._id,
      fields: ["end2", "aggregation"],
      depth: 1,
    });
    expect(composition.data.model).toMatchObject({
      _type: "UMLAssociation",
      end2: { aggregation: "composite" },
    });

    const erd = await ends(CASES.find((c) => c.type === "ERDRelationship")!);
    const many = await call<Created>("/create_relationship", {
      type: "ERDRelationshipManyToMany",
      diagramId: erd.diagramId,
      tailId: erd.tail.model._id,
      headId: erd.head.model._id,
      fields: ["end1", "end2", "cardinality"],
      depth: 1,
    });
    expect(many.data.model).toMatchObject({
      end1: { cardinality: "0..*" },
      end2: { cardinality: "0..*" },
    });

    const seq = await ends(CASES.find((c) => c.type === "UMLMessage")!);
    const lifelines = {
      tailId: seq.tail.model._id,
      headId: seq.head.model._id,
    };
    const async = await call<Created>("/create_relationship", {
      type: "UMLAsyncMessage",
      diagramId: seq.diagramId,
      ...lifelines,
      y1: 140,
      y2: 140,
      name: "notify",
      fields: ["messageSort", "name", "source", "target"],
    });
    expect(async.data.model).toMatchObject({
      messageSort: "asynchCall",
      name: "notify",
      source: { $ref: seq.tail.model._id },
      target: { $ref: seq.head.model._id },
    });
    const self = await call<Created>("/create_relationship", {
      type: "UMLSelfMessage",
      diagramId: seq.diagramId,
      tailId: seq.tail.model._id,
      headId: seq.tail.model._id,
      y1: 180,
      y2: 180,
      fields: ["source", "target"],
    });
    expect(self.data.model).toMatchObject({
      source: { $ref: seq.tail.model._id },
      target: { $ref: seq.tail.model._id },
    });
    const reply = await call<Created>("/create_relationship", {
      type: "UMLMessage",
      diagramId: seq.diagramId,
      tailId: seq.head.view._id,
      headId: seq.tail.view._id,
      y1: 220,
      y2: 220,
      properties: { messageSort: "reply" },
      fields: ["messageSort"],
    });
    expect(reply.data.model).toMatchObject({ messageSort: "reply" });
  });

  it("creates relationships without a view, filed where StarUML would", async () => {
    const cls = await ends(CASES[0]!);
    const dep = await call<Created>("/create_relationship", {
      type: "UMLDependency",
      tailId: cls.tail.model._id,
      headId: cls.head.model._id,
      name: "uses",
      fields: ["source", "target", "_parent", "name"],
    });
    expect(dep.data).toMatchObject({
      view: null,
      model: {
        name: "uses",
        _parent: cls.tail.model._id,
        source: { $ref: cls.tail.model._id },
        target: { $ref: cls.head.model._id },
      },
    });
    const link = await call<Created>("/create_relationship", {
      type: "UMLAssociation",
      tailId: cls.tail.model._id,
      headId: cls.head.model._id,
      headEnd: { navigable: "navigable" },
      fields: ["end2", "navigable", "reference"],
      depth: 1,
    });
    expect(link.data.model).toMatchObject({
      end2: { navigable: "navigable", reference: { $ref: cls.head.model._id } },
    });
    const seq = await ends(CASES.find((c) => c.type === "UMLMessage")!);
    const msg = await call<Created>("/create_relationship", {
      type: "UMLMessage",
      tailId: seq.tail.model._id,
      headId: seq.head.model._id,
      fields: ["_parent"],
    });
    // A lifeline's owner, the interaction, keeps messages in `messages`.
    expect(msg.data.model!._parent).toBe(seq.tail.model._parent);
  });

  it("reports StarUML's refusal of an invalid connection", async () => {
    const { diagramId, tail, head } = await ends(CASES[0]!);
    // useCaseLinkPrecondition: an include connects two use cases.
    expect(
      await call("/create_relationship", {
        type: "UMLInclude",
        diagramId,
        tailId: tail.view._id,
        headId: head.view._id,
      }),
    ).toMatchObject({
      status: 422,
      code: "STARUML_ERROR",
      error: "Invalid connection (UMLInclude)",
    });
  });
});
