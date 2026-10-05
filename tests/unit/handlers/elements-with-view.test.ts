import { beforeEach, describe, expect, it } from "vitest";
import {
  createEdgeWithView,
  createElementWithView,
} from "../../../src/handlers/elements.js";
import type { UMLAssociationView } from "../../mock/staruml.js";
import {
  installMockApp,
  UMLAssociation,
  UMLClassView,
  type MockEnvironment,
  type NodeView,
} from "../../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

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

describe("createElementWithView validation", () => {
  it.each([{}, { type: "" }])("requires a type: %j", async (body) => {
    expect(await createElementWithView(body)).toMatchObject({
      success: false,
      error: expect.stringContaining("Required field 'type' missing"),
    });
  });

  it.each([{ type: "UMLClass" }, { type: "UMLClass", parentId: "" }])(
    "requires a parentId: %j",
    async (body) => {
      expect(await createElementWithView(body)).toEqual({
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

  it("rejects an unknown diagram", async () => {
    expect(
      await createElementWithView(nodeBody({ diagramId: "missing" })),
    ).toEqual({
      success: false,
      error: "Diagram not found: missing",
    });
  });
});

// Issue #1: the positional createModelAndView(id, parent, diagram, options) call
// makes the 7.1.1 factory return null. These describe the fixed behaviour and are
// expected to fail until the handler passes a single options object.
describe("createElementWithView (#1)", () => {
  it("surfaces the null view returned for the positional call", async () => {
    expect(await createElementWithView(nodeBody({ name: "Book" }))).toEqual({
      success: false,
      error: "Cannot read properties of null (reading 'model')",
    });
  });

  it.fails(
    "creates a named class and its view at the requested bounds",
    async () => {
      const result = await createElementWithView(
        nodeBody({ name: "Book", x: 10, y: 20, x2: 210, y2: 120 }),
      );
      expect(result).toMatchObject({
        success: true,
        data: { model: { name: "Book" } },
      });
      const viewId = (result as { data: { view: { _id: string } } }).data.view
        ._id;
      const view = env.app.repository.get(viewId) as NodeView;
      expect(view).toBeInstanceOf(UMLClassView);
      expect([view.left, view.top, view.width, view.height]).toEqual([
        10, 20, 200, 100,
      ]);
    },
  );

  it.fails("defaults the bounds to a 100x50 box at (100, 100)", async () => {
    const result = await createElementWithView(nodeBody());
    const viewId = (result as { data: { view: { _id: string } } }).data.view
      ._id;
    const view = env.app.repository.get(viewId) as NodeView;
    expect([view.left, view.top, view.width, view.height]).toEqual([
      100, 100, 100, 50,
    ]);
  });
});

describe("createEdgeWithView validation", () => {
  let tailId: string;
  let headId: string;

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
      })!._id;
    tailId = make(0);
    headId = make(200);
  });

  function edgeBody(
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: "UMLAssociation",
      parentId: env.model._id,
      diagramId: env.mainDiagram._id,
      tailViewId: tailId,
      headViewId: headId,
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

  it.each([{ parentId: undefined }, { parentId: "" }])(
    "requires a parentId: %j",
    async (extra) => {
      expect(await createEdgeWithView(edgeBody(extra))).toEqual({
        success: false,
        error: "Required field 'parentId' missing",
      });
    },
  );

  it.each([{ diagramId: undefined }, { diagramId: "" }])(
    "requires a diagramId: %j",
    async (extra) => {
      expect(await createEdgeWithView(edgeBody(extra))).toEqual({
        success: false,
        error: "Required field 'diagramId' missing",
      });
    },
  );

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
    [{ parentId: "missing" }, "Parent not found: missing"],
    [{ diagramId: "missing" }, "Diagram not found: missing"],
    [{ tailViewId: "missing" }, "Tail view not found: missing"],
    [{ headViewId: "missing" }, "Head view not found: missing"],
  ])("rejects %j", async (extra, error) => {
    expect(await createEdgeWithView(edgeBody(extra))).toEqual({
      success: false,
      error,
    });
  });

  it("surfaces the null view returned for the positional call (#1)", async () => {
    expect(await createEdgeWithView(edgeBody({ name: "wrote" }))).toEqual({
      success: false,
      error: "Cannot read properties of null (reading 'model')",
    });
  });

  it.fails("connects the two views with a named association (#1)", async () => {
    const result = await createEdgeWithView(edgeBody({ name: "wrote" }));
    expect(result).toMatchObject({
      success: true,
      data: { model: { name: "wrote" } },
    });
    const viewId = (result as { data: { view: { _id: string } } }).data.view
      ._id;
    const edge = env.app.repository.get(viewId) as UMLAssociationView;
    expect(edge.tail?._id).toBe(tailId);
    expect(edge.head?._id).toBe(headId);
    expect(edge.model).toBeInstanceOf(UMLAssociation);
  });
});
