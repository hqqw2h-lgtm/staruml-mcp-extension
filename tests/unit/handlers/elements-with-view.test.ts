import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEdgeWithView,
  createElementWithView,
} from "../../../src/handlers/elements.js";
import {
  installMockApp,
  UMLAssociation,
  UMLClassView,
  type MockEnvironment,
  type NodeView,
  type UMLAssociationView,
} from "../../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function viewId(result: unknown): string {
  return (result as { data: { view: { _id: string } } }).data.view._id;
}

describe("createElementWithView", () => {
  function nodeBody(
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: "UMLClass",
      parentId: env.model._id,
      diagramId: env.mainDiagram._id,
      ...extra,
    };
  }

  it.each([{}, { type: "" }])("requires a type: %j", async (body) => {
    expect(await createElementWithView(body)).toMatchObject({
      success: false,
      error: expect.stringContaining("Required field 'type' missing"),
    });
  });

  it.each([{ parentId: undefined }, { parentId: "" }])(
    "requires a parentId: %j",
    async (extra) => {
      expect(await createElementWithView(nodeBody(extra))).toEqual({
        success: false,
        error: "Required field 'parentId' missing",
      });
    },
  );

  it.each([{ diagramId: undefined }, { diagramId: "" }])(
    "requires a diagramId: %j",
    async (extra) => {
      expect(await createElementWithView(nodeBody(extra))).toEqual({
        success: false,
        error: "Required field 'diagramId' missing",
      });
    },
  );

  it("rejects an unknown parent", async () => {
    expect(
      await createElementWithView(nodeBody({ parentId: "missing" })),
    ).toEqual({
      success: false,
      error: "Parent not found: missing",
    });
  });

  it.each(["missing", "model"])(
    "rejects a diagramId that is not a diagram (%s)",
    async (which) => {
      const diagramId = which === "model" ? env.model._id : which;
      expect(await createElementWithView(nodeBody({ diagramId }))).toEqual({
        success: false,
        error: `Diagram not found: ${diagramId}`,
      });
    },
  );

  it("passes createModelAndView a single options object (#1)", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await createElementWithView(nodeBody());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
    });
  });

  it("creates a named class and its view at the requested bounds", async () => {
    const result = await createElementWithView(
      nodeBody({ name: "Book", x: 10, y: 20, x2: 210, y2: 120 }),
    );
    expect(result).toMatchObject({
      success: true,
      data: { model: { name: "Book" } },
    });
    const view = env.app.repository.get(viewId(result)) as NodeView;
    expect(view).toBeInstanceOf(UMLClassView);
    expect(view.model!._parent).toBe(env.model);
    expect(env.mainDiagram.ownedViews).toContain(view);
    expect([view.left, view.top, view.width, view.height]).toEqual([
      10, 20, 200, 100,
    ]);
  });

  it("defaults the bounds to a 100x50 box at (100, 100) and leaves the name alone", async () => {
    const result = await createElementWithView(nodeBody({ name: 7 }));
    const view = env.app.repository.get(viewId(result)) as NodeView;
    expect([view.left, view.top, view.width, view.height]).toEqual([
      100, 100, 100, 50,
    ]);
    expect(view.model!.name).toBe("");
  });

  it("reports a type without a model-and-view factory, for which it returns null", async () => {
    expect(
      await createElementWithView(nodeBody({ type: "UMLAttribute" })),
    ).toEqual({
      success: false,
      error: "Unknown model-and-view type: UMLAttribute",
    });
  });

  it("reports a factory exception", async () => {
    vi.spyOn(env.app.factory, "createModelAndView").mockImplementation(() => {
      throw new Error("factory down");
    });
    expect(await createElementWithView(nodeBody())).toEqual({
      success: false,
      error: "factory down",
    });
  });
});

describe("createEdgeWithView", () => {
  let tail: NodeView;
  let head: NodeView;

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
      }) as NodeView;
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

  it.each([{ type: undefined }, { type: "" }])(
    "requires a type: %j",
    async (extra) => {
      expect(await createEdgeWithView(edgeBody(extra))).toMatchObject({
        success: false,
        error: expect.stringContaining("Required field 'type' missing"),
      });
    },
  );

  it.each([
    [{ parentId: "" }, "Required field 'parentId' missing"],
    [{ diagramId: undefined }, "Required field 'diagramId' missing"],
    [{ parentId: "missing" }, "Parent not found: missing"],
    [{ diagramId: "missing" }, "Diagram not found: missing"],
  ])("checks parent and diagram: %j", async (extra, error) => {
    expect(await createEdgeWithView(edgeBody(extra))).toEqual({
      success: false,
      error,
    });
  });

  it.each([{ tailViewId: undefined }, { headViewId: 3 }])(
    "requires both view ids: %j",
    async (extra) => {
      expect(await createEdgeWithView(edgeBody(extra))).toEqual({
        success: false,
        error: "Required fields 'tailViewId' and 'headViewId' missing",
      });
    },
  );

  it.each([
    ["tailViewId", "Tail"],
    ["headViewId", "Head"],
  ])("rejects a %s that is missing or not a view", async (field, label) => {
    for (const id of ["missing", env.model._id]) {
      expect(await createEdgeWithView(edgeBody({ [field]: id }))).toEqual({
        success: false,
        error: `${label} view not found: ${id}`,
      });
    }
  });

  it("connects the two views with a named association between their models (#1)", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    const result = await createEdgeWithView(edgeBody({ name: "wrote" }));
    expect(result).toMatchObject({
      success: true,
      data: { model: { name: "wrote" } },
    });
    expect(spy.mock.calls[0]).toHaveLength(1);

    const edge = env.app.repository.get(viewId(result)) as UMLAssociationView;
    expect(edge.tail).toBe(tail);
    expect(edge.head).toBe(head);
    const association = edge.model as UMLAssociation;
    expect(association).toBeInstanceOf(UMLAssociation);
    expect(association.end1.reference).toBe(tail.model);
    expect(association.end2.reference).toBe(head.model);
  });

  it("reports a type without a model-and-view factory", async () => {
    expect(
      await createEdgeWithView(edgeBody({ type: "UMLAttribute" })),
    ).toEqual({
      success: false,
      error: "Unknown model-and-view type: UMLAttribute",
    });
  });

  it("reports a factory exception", async () => {
    vi.spyOn(env.app.factory, "createModelAndView").mockImplementation(() => {
      throw new Error("factory down");
    });
    expect(await createEdgeWithView(edgeBody())).toEqual({
      success: false,
      error: "factory down",
    });
  });
});
