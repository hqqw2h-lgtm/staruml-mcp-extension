import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, type Summary } from "./support.js";

interface Introspection {
  metamodel: Record<string, unknown>;
  factory: {
    modelIds: string[];
    diagramIds: string[];
    modelAndView: {
      id: string;
      modelType: string | null;
      relationship: string | null;
    }[];
  };
  toolbox: {
    groups: { id: string; diagramTypes: string[] | null }[];
    items: {
      id: string;
      group: string;
      rubberband: string;
      creates: string;
      command?: string;
    }[];
  };
}

interface Created {
  view: Summary;
  model: Summary | null;
}

/**
 * Toolbox items the factory only places on or inside another view: the item
 * that creates the host. Several timing diagram parts nest
 * frame > lifeline > state > time segment (uml-factory.js preconditions).
 */
const HOSTS: Record<string, string> = {
  UMLPort: "UMLClass",
  UMLPart: "UMLClass",
  UMLConnectionPointReference: "UMLState",
  UMLInputPin: "UMLAction",
  UMLOutputPin: "UMLAction",
  UMLInputExpansionNode: "UMLExpansionRegion",
  UMLOutputExpansionNode: "UMLExpansionRegion",
  UMLStateInvariant: "UMLLifeline@UMLSequenceDiagram",
  UMLLifeline: "frame@UMLTimingDiagram",
  UMLTimeTick: "frame@UMLTimingDiagram",
  UMLTimingState: "UMLLifeline@UMLTimingDiagram",
  UMLTimeSegment: "UMLTimingState@UMLTimingDiagram",
  UMLTimeConstraint: "UMLTimeSegment@UMLTimingDiagram",
  SysMLPort: "SysMLBlock",
  SysMLPart: "SysMLBlock",
  SysMLReference: "SysMLBlock",
  SysMLValue: "SysMLBlock",
  SysMLConstraintProperty: "SysMLBlock",
  BPMNBoundaryEvent: "BPMNTask",
};

/** Placed by their own test below: it needs a diagram owned by a constraint block. */
const OWN_TEST = new Set(["SysMLConstraintParameter"]);

/**
 * Properties of a block go into the block (blockPropertyPrecondition in
 * sysml-factory.js); the editor gets it as the diagram's owner because
 * internal block diagrams live in their block, so here it is passed.
 */
const OWNED_BY_HOST = new Set([
  "SysMLPart",
  "SysMLReference",
  "SysMLValue",
  "SysMLConstraintProperty",
]);

// Issue #5: everything the 7.1.1 catalogue offers can be created through the API.
describeLive("every catalogue id on StarUML 7.1.1", () => {
  let intro: Introspection;
  let modelId = "";
  const diagrams = new Map<string, string>();
  let slot = 0;

  /** A free 100x80 cell, so hosts and guests do not overlap other views. */
  function cell(): { x: number; y: number; x2: number; y2: number } {
    const x = 40 + (slot % 6) * 260;
    const y = 40 + Math.floor(slot / 6) * 260;
    slot++;
    return { x, y, x2: x + 200, y2: y + 200 };
  }

  async function diagram(typeName: string): Promise<string> {
    if (!diagrams.has(typeName)) {
      const res = await call<Summary>("/create_diagram", {
        type: typeName,
        parentId: modelId,
      });
      expect(res.success, `${typeName}: ${res.error}`).toBe(true);
      diagrams.set(typeName, res.data._id);
    }
    return diagrams.get(typeName)!;
  }

  function diagramFor(itemId: string): string {
    const item = intro.toolbox.items.find((i) => i.id === itemId)!;
    const group = intro.toolbox.groups.find((g) => g.id === item.group)!;
    return group.diagramTypes?.[0] ?? "UMLClassDiagram";
  }

  /** The host an item needs on a diagram; a timing lifeline needs a frame, a sequence one does not. */
  function hostOn(itemId: string, diagramType: string): string | undefined {
    const spec = HOSTS[itemId];
    const on = spec?.split("@")[1];
    return on === undefined || on === diagramType ? spec : undefined;
  }

  /** Creates `spec` ("Item" or "Item@Diagram", "frame" for a timing frame) and answers its view id. */
  async function host(
    spec: string,
    diagramType: string,
  ): Promise<{ view: string; model: string | null }> {
    const [itemId, onDiagram] = spec.split("@") as [string, string?];
    const diagramId = await diagram(onDiagram ?? diagramType);
    if (itemId === "frame") {
      const d = await call<{ ownedViews: { $ref: string }[] }>(
        "/get_element_by_id",
        { id: diagramId, fields: ["ownedViews"] },
      );
      return { view: d.data.ownedViews[0]!.$ref, model: null };
    }
    const target = onDiagram ?? diagramType;
    const res = await call<Created>("/create_element_with_view", {
      type: itemId,
      diagramId,
      ...(await placement(itemId, target)),
      ...cell(),
    });
    expect(res.success, `host ${spec}: ${res.error}`).toBe(true);
    return { view: res.data.view._id, model: res.data.model?._id ?? null };
  }

  /** containerViewId, and parentId where the factory wants the host's model as owner. */
  async function placement(
    itemId: string,
    diagramType: string,
  ): Promise<Record<string, string>> {
    const outer = hostOn(itemId, diagramType);
    if (!outer) return {};
    const { view, model } = await host(outer, diagramType);
    return {
      containerViewId: view,
      ...(OWNED_BY_HOST.has(itemId) && model && { parentId: model }),
    };
  }

  beforeAll(async () => {
    intro = (
      await call<Introspection>("/introspect", {
        include: ["factory", "metamodel", "toolbox"],
      })
    ).data;
    const project = (await call<{ project: Summary }>("/new_project")).data
      .project;
    modelId = (
      await call<Summary>("/create_element", {
        type: "UMLModel",
        parentId: project._id,
        name: "Catalogue",
      })
    ).data._id;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("creates every diagram id", async () => {
    for (const id of intro.factory.diagramIds) {
      const res = await call<Summary>("/create_diagram", {
        type: id,
        parentId: modelId,
      });
      expect(res.data?._type, `${id}: ${res.error}`).toBe(id);
    }
  });

  it("creates every model id that has a metamodel class", async () => {
    for (const id of intro.factory.modelIds) {
      const res = await call<Summary>("/create_element", {
        type: id,
        parentId: modelId,
      });
      if (intro.metamodel[id]) {
        expect(res.data?._type, `${id}: ${res.error}`).toBe(id);
      } else {
        // 7.1.1 registers SysMLOperation without defining the class.
        expect(res, id).toMatchObject({ code: "UNKNOWN_TYPE" });
      }
    }
  });

  // Some 250 creations. StarUML 7.1.1 gets slower at them once earlier
  // suites have made large models, even after the project is replaced:
  // 10 s after a restart, over 30 s at the end of the live run.
  it("creates every node item of the toolbox on its diagram, hosted where the factory requires", async () => {
    const failures: string[] = [];
    for (const item of intro.toolbox.items) {
      if (item.rubberband === "line" || item.command) continue;
      // Self-connections are edges from a view to itself; see relationships.live.
      if (item.id.startsWith("UMLSelf") || OWN_TEST.has(item.id)) continue;
      const diagramType = diagramFor(item.id);
      const res = await call<Created>("/create_element_with_view", {
        type: item.id,
        diagramId: await diagram(diagramType),
        ...(await placement(item.id, diagramType)),
        ...cell(),
      });
      if (!res.success) failures.push(`${item.id}: ${res.code} ${res.error}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  // parameterFn files the parameter in the block's `parameters`, which only a
  // SysMLConstraintBlock has; on a plain block StarUML fails inside the factory.
  it("places a constraint parameter on the frame of a constraint block's parametric diagram", async () => {
    const block = await call<Summary>("/create_element", {
      type: "SysMLConstraintBlock",
      parentId: modelId,
    });
    const pd = await call<{ _id: string; ownedViews: { $ref: string }[] }>(
      "/create_diagram",
      {
        type: "SysMLParametricDiagram",
        parentId: block.data._id,
        fields: ["ownedViews"],
      },
    );
    const res = await call<Created>("/create_element_with_view", {
      type: "SysMLConstraintParameter",
      diagramId: pd.data._id,
      containerViewId: pd.data.ownedViews[0]!.$ref,
      x: 5,
      y: 100,
      x2: 25,
      y2: 120,
    });
    expect(res.data?.model, res.error).toMatchObject({
      _parent: block.data._id,
    });
  });

  it("refuses toolbox items that run their own command", async () => {
    const custom = intro.toolbox.items.filter(
      (i) =>
        i.command && !intro.factory.modelAndView.some((e) => e.id === i.id),
    );
    expect(custom.length).toBeGreaterThan(0);
    for (const item of custom) {
      expect(
        await call("/create_element_with_view", {
          type: item.id,
          diagramId: await diagram("UMLClassDiagram"),
        }),
      ).toMatchObject({ code: "UNKNOWN_TYPE" });
    }
  });
});
