import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEdgeWithView,
  createRelationship,
} from "../../../src/handlers/relationships.js";
import {
  create,
  installMockApp,
  type Element,
  type MockEnvironment,
  type View,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

interface Created {
  view: { _id: string } | null;
  model: { _id: string; name?: string; [key: string]: unknown } | null;
}

describe("/create_edge_with_view", () => {
  let tail: View;
  let head: View;

  beforeEach(() => {
    const make = (x: number) =>
      env.app.factory.createModelAndView({
        id: "UMLClass",
        parent: env.model,
        diagram: env.mainDiagram,
        x1: x,
        y1: 0,
        x2: x + 100,
        y2: 50,
      })!;
    tail = make(0);
    head = make(200);
  });

  function edgeBody(
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: "UMLAssociation",
      parentId: env.model._id,
      diagramId: env.mainDiagram._id,
      tailViewId: tail._id,
      headViewId: head._id,
      ...extra,
    };
  }

  it.each(["type", "diagramId", "tailViewId", "headViewId"])(
    "requires %s",
    async (field) => {
      await fails(
        createEdgeWithView,
        edgeBody({ [field]: undefined }),
        "INVALID_ARGUMENT",
        new RegExp(`^${field}: `),
      );
    },
  );

  it.each([
    [{ parentId: "missing" }, "Parent not found: missing"],
    [{ diagramId: "missing" }, "Diagram not found: missing"],
  ])("checks parent and diagram: %j", async (extra, error) => {
    await fails(createEdgeWithView, edgeBody(extra), "NOT_FOUND", error);
  });

  it.each([
    ["tailViewId", "Tail"],
    ["headViewId", "Head"],
  ])("rejects a %s that is missing or not a view", async (field, label) => {
    for (const id of ["missing", env.model._id]) {
      await fails(
        createEdgeWithView,
        edgeBody({ [field]: id }),
        "NOT_FOUND",
        `${label} view not found: ${id}`,
      );
    }
  });

  it("connects the two views with a named association between their models (#1)", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    const data = await ok<Created>(
      createEdgeWithView,
      edgeBody({ name: "wrote" }),
    );
    expect(data.model).toMatchObject({
      _type: "UMLAssociation",
      name: "wrote",
    });
    expect(spy.mock.calls[0]).toHaveLength(1);

    const edge = env.app.repository.get(data.view!._id) as View;
    expect(edge.tail).toBe(tail);
    expect(edge.head).toBe(head);
    const association = edge.model!;
    expect((association.end1 as Element).reference).toBe(tail.model);
    expect((association.end2 as Element).reference).toBe(head.model);
  });

  it("sets source and target of a directed relationship", async () => {
    const data = await ok<Created>(
      createEdgeWithView,
      edgeBody({ type: "UMLGeneralization", fields: ["source", "target"] }),
    );
    expect(data.model).toEqual({
      _id: data.model!._id,
      _type: "UMLGeneralization",
      source: { $ref: tail.model!._id },
      target: { $ref: head.model!._id },
    });
  });

  it("reports a type without a model-and-view factory", async () => {
    await fails(
      createEdgeWithView,
      edgeBody({ type: "UMLAttribute" }),
      "UNKNOWN_TYPE",
      "Unknown model-and-view type: UMLAttribute",
    );
  });

  it("reports a factory exception as STARUML_ERROR", async () => {
    vi.spyOn(env.app.factory, "createModelAndView").mockImplementation(() => {
      throw "Invalid connection (UMLAssociation)";
    });
    await fails(
      createEdgeWithView,
      edgeBody(),
      "STARUML_ERROR",
      "Invalid connection (UMLAssociation)",
    );
  });
});

describe("edge details", () => {
  let tail: View;
  let head: View;

  beforeEach(() => {
    const make = (x: number) =>
      env.app.factory.createModelAndView({
        id: "UMLClass",
        parent: env.model,
        diagram: env.mainDiagram,
        x1: x,
        y1: 0,
        x2: x + 100,
        y2: 50,
      })!;
    tail = make(0);
    head = make(200);
  });

  function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "UMLAssociation",
      diagramId: env.mainDiagram._id,
      tailViewId: tail._id,
      headViewId: head._id,
      ...extra,
    };
  }

  it("defaults the owner to the diagram's owner and the geometry to the view centres", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(createEdgeWithView, body());
    expect(spy.mock.calls[0]![0]).toMatchObject({
      parent: env.model,
      x1: 50,
      y1: 25,
      x2: 250,
      y2: 25,
    });
  });

  it("takes explicit geometry, and 0 where an end is not a node", async () => {
    const edge = env.app.factory.createModelAndView({
      id: "UMLAssociation",
      parent: env.model,
      diagram: env.mainDiagram,
      tailView: tail,
      headView: head,
    })!;
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(
      createEdgeWithView,
      body({ type: "NoteLink", tailViewId: edge._id, y2: 7 }),
    );
    expect(spy.mock.calls[0]![0]).toMatchObject({
      x1: 0,
      y1: 0,
      x2: 250,
      y2: 7,
    });
  });

  it("uses 0 for a head that is not a node", async () => {
    const edge = env.app.factory.createModelAndView({
      id: "UMLAssociation",
      parent: env.model,
      diagram: env.mainDiagram,
      tailView: tail,
      headView: head,
    })!;
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(
      createEdgeWithView,
      body({ type: "NoteLink", headViewId: edge._id }),
    );
    expect(spy.mock.calls[0]![0]).toMatchObject({
      x1: 50,
      y1: 25,
      x2: 0,
      y2: 0,
    });
  });

  it("takes explicit geometry for both ends", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(createEdgeWithView, body({ x1: 1, y1: 2, x2: 3, y2: 4 }));
    expect(spy.mock.calls[0]![0]).toMatchObject({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it("sets attributes of one end only", async () => {
    const data = await ok<Created>(
      createEdgeWithView,
      body({
        tailEnd: { name: "only" },
        fields: ["end1", "end2", "name"],
        depth: 1,
      }),
    );
    expect(data.model).toMatchObject({
      end1: { name: "only" },
      end2: { name: "" },
    });
  });

  it("sets relationship attributes and both ends in the creation", async () => {
    const data = await ok<Created>(
      createEdgeWithView,
      body({
        name: "owns",
        properties: { isDerived: true },
        tailEnd: { name: "owner", aggregation: "composite" },
        headEnd: { name: "items", multiplicity: "*", navigable: "navigable" },
        fields: [
          "isDerived",
          "name",
          "end1",
          "end2",
          "aggregation",
          "multiplicity",
          "navigable",
        ],
        depth: 1,
      }),
    );
    expect(data.model).toMatchObject({
      name: "owns",
      isDerived: true,
      end1: {
        _type: "UMLAssociationEnd",
        name: "owner",
        aggregation: "composite",
      },
      end2: { name: "items", multiplicity: "*", navigable: "navigable" },
    });
  });

  it("validates end attributes against the end class", async () => {
    await fails(
      createEdgeWithView,
      body({ headEnd: { cardinality: "1" } }),
      "INVALID_ARGUMENT",
      "UMLAssociationEnd has no field 'cardinality'",
    );
  });

  it("refuses ends on a directed relationship", async () => {
    await fails(
      createEdgeWithView,
      body({ type: "UMLGeneralization", tailEnd: { name: "x" } }),
      "INVALID_ARGUMENT",
      "tailEnd/headEnd apply to undirected relationships (end1/end2); UMLGeneralization has none",
    );
  });

  it("applies a toolbox item's presets to an edge", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(createEdgeWithView, body({ type: "UMLComposition" }));
    expect(spy.mock.calls[0]![0]).toMatchObject({
      id: "UMLAssociation",
      "model-init": { end2: { aggregation: "composite" } },
      tailView: tail,
    });
  });

  it("answers a null model for a view-only edge", async () => {
    const data = await ok<Created>(
      createEdgeWithView,
      body({ type: "NoteLink" }),
    );
    expect(data.model).toBeNull();
  });

  it("passes an explicit owner on", async () => {
    const pkg = env.app.factory.createModel({
      id: "UMLPackage",
      parent: env.model,
    })!;
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(createEdgeWithView, body({ parentId: pkg._id }));
    expect(spy.mock.calls[0]![0]).toMatchObject({ parent: pkg });
  });
});

describe("/create_relationship", () => {
  let a: View;
  let b: View;

  beforeEach(() => {
    const make = (name: string, x: number) =>
      env.app.factory.createModelAndView({
        id: "UMLClass",
        parent: env.model,
        diagram: env.mainDiagram,
        x1: x,
        y1: 0,
        x2: x + 100,
        y2: 50,
        modelInitializer: (m) => {
          m.name = name;
        },
      })!;
    a = make("A", 0);
    b = make("B", 200);
  });

  describe("on a diagram", () => {
    it("resolves model ids to their views on the diagram", async () => {
      const data = await ok<Created>(createRelationship, {
        type: "UMLDependency",
        diagramId: env.mainDiagram._id,
        tailId: a.model!._id,
        headId: b._id,
        name: "uses",
        fields: ["source", "target", "name"],
      });
      expect(data.model).toMatchObject({
        name: "uses",
        source: { $ref: a.model!._id },
        target: { $ref: b.model!._id },
      });
      const edge = env.app.repository.get(data.view!._id) as View;
      expect([edge.tail, edge.head]).toEqual([a, b]);
    });

    it("passes an explicit owner on and refuses `field`", async () => {
      const spy = vi.spyOn(env.app.factory, "createModelAndView");
      await ok(createRelationship, {
        type: "UMLDependency",
        diagramId: env.mainDiagram._id,
        tailId: a._id,
        headId: b._id,
        parentId: a.model!._id,
      });
      expect(spy.mock.calls[0]![0]).toMatchObject({ parent: a.model });
      await fails(
        createRelationship,
        {
          type: "UMLDependency",
          diagramId: env.mainDiagram._id,
          tailId: a._id,
          headId: b._id,
          field: "ownedElements",
        },
        "INVALID_ARGUMENT",
        /^field applies without a diagram/,
      );
    });

    it("rejects an end that is not shown on the diagram", async () => {
      const other = env.app.factory.createModel({
        id: "UMLClass",
        parent: env.model,
      })!;
      await fails(
        createRelationship,
        {
          type: "UMLDependency",
          diagramId: env.mainDiagram._id,
          tailId: other._id,
          headId: b._id,
        },
        "NOT_FOUND",
        `Tail: no view of ${other._id} on diagram ${env.mainDiagram._id}`,
      );
    });
  });

  describe("without a diagram", () => {
    it("creates a directed relationship under the tail model, like the factories", async () => {
      const data = await ok<Created>(createRelationship, {
        type: "UMLGeneralization",
        tailId: b.model!._id,
        headId: a._id,
        fields: ["source", "target", "_parent"],
      });
      expect(data).toEqual({
        view: null,
        model: {
          _id: data.model!._id,
          _type: "UMLGeneralization",
          _parent: b.model!._id,
          source: { $ref: b.model!._id },
          target: { $ref: a.model!._id },
        },
      });
      expect(b.model!.ownedElements).toContainEqual(
        env.app.repository.get(data.model!._id),
      );
    });

    it("sets an undirected relationship's end references and attributes", async () => {
      const data = await ok<Created>(createRelationship, {
        type: "UMLAssociation",
        tailId: a.model!._id,
        headId: b.model!._id,
        name: "ab",
        tailEnd: { name: "a" },
        headEnd: { multiplicity: "0..1" },
        fields: ["name", "end1", "end2", "reference", "multiplicity"],
        depth: 1,
      });
      expect(data.model).toMatchObject({
        name: "ab",
        end1: { name: "a", reference: { $ref: a.model!._id } },
        end2: { multiplicity: "0..1", reference: { $ref: b.model!._id } },
      });
    });

    it("files it under the tail's owner when that has a list for the type", async () => {
      const interaction = env.app.factory.createModel({
        id: "UMLInteraction",
        parent: env.model,
      })!;
      const lifeline = (name: string): Element => {
        const l = create("UMLLifeline");
        l.name = name;
        env.app.engine.addModel(interaction, "participants", l);
        return l;
      };
      const data = await ok<Created>(createRelationship, {
        type: "UMLMessage",
        tailId: lifeline("x")._id,
        headId: lifeline("y")._id,
        properties: { messageSort: "asynchCall" },
        fields: ["_parent", "messageSort"],
      });
      expect(data.model).toMatchObject({
        _parent: interaction._id,
        messageSort: "asynchCall",
      });
      expect(interaction.messages).toHaveLength(1);
    });

    it("takes an explicit owner and list", async () => {
      const data = await ok<Created>(createRelationship, {
        type: "UMLDependency",
        tailId: a.model!._id,
        headId: b.model!._id,
        parentId: env.model._id,
        field: "ownedElements",
        fields: ["_parent"],
      });
      expect(data.model!._parent).toBe(env.model._id);
      await fails(
        createRelationship,
        {
          type: "UMLDependency",
          tailId: a.model!._id,
          headId: b.model!._id,
          field: "attributes",
        },
        "INVALID_ARGUMENT",
        "UMLClass.attributes holds UMLAttribute, not UMLDependency",
      );
    });

    it("files under the tail itself when it has no owner", async () => {
      const data = await ok<Created>(createRelationship, {
        type: "UMLDependency",
        tailId: env.project._id,
        headId: a.model!._id,
        fields: ["_parent"],
      });
      expect(data.model!._parent).toBe(env.project._id);
    });

    it.each(["UMLClass", "UMLVisibilityKind", "Nope"])(
      "refuses %s, which is not a relationship class",
      async (typeName) => {
        await fails(
          createRelationship,
          { type: typeName, tailId: a._id, headId: b._id },
          "UNKNOWN_TYPE",
          `Not a relationship type: ${typeName}`,
        );
      },
    );

    it("refuses a view that shows no model", async () => {
      const note = env.app.factory.createModelAndView({
        id: "Note",
        parent: env.model,
        diagram: env.mainDiagram,
      })!;
      await fails(
        createRelationship,
        { type: "UMLDependency", tailId: a._id, headId: note._id },
        "INVALID_ARGUMENT",
        `Head ${note._id} shows no model`,
      );
    });

    it("reports an engine that does not add the relationship", async () => {
      vi.spyOn(env.app.engine, "addModel").mockReturnValue(null);
      await fails(
        createRelationship,
        { type: "UMLDependency", tailId: a._id, headId: b._id },
        "STARUML_ERROR",
        "StarUML did not add UMLDependency to UMLClass.ownedElements",
      );
    });
  });
});
