import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEdgeWithView,
  createElementWithView,
} from "../../../src/handlers/elements.js";
import {
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
  view: { _id: string };
  model: { _id: string; name?: string };
}

describe("/create_element_with_view", () => {
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

  it.each(["type", "parentId", "diagramId"])("requires %s", async (field) => {
    await fails(
      createElementWithView,
      nodeBody({ [field]: undefined }),
      "INVALID_ARGUMENT",
      new RegExp(`^${field}: `),
    );
  });

  it("rejects an unknown parent", async () => {
    await fails(
      createElementWithView,
      nodeBody({ parentId: "missing" }),
      "NOT_FOUND",
      "Parent not found: missing",
    );
  });

  it.each(["missing", "model"])(
    "rejects a diagramId that is not a diagram (%s)",
    async (which) => {
      const diagramId = which === "model" ? env.model._id : which;
      await fails(
        createElementWithView,
        nodeBody({ diagramId }),
        "NOT_FOUND",
        `Diagram not found: ${diagramId}`,
      );
    },
  );

  it("passes createModelAndView a single options object (#1)", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(createElementWithView, nodeBody());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
    });
  });

  it("creates a named class and its view at the requested bounds", async () => {
    const data = await ok<Created>(
      createElementWithView,
      nodeBody({ name: "Book", x: 10, y: 20, x2: 210, y2: 120 }),
    );
    expect(data).toEqual({
      view: {
        _id: data.view._id,
        _type: "UMLClassView",
        name: null,
        _parent: env.mainDiagram._id,
      },
      model: {
        _id: data.model._id,
        _type: "UMLClass",
        name: "Book",
        _parent: env.model._id,
      },
    });
    const view = env.app.repository.get(data.view._id) as View;
    expect(env.mainDiagram.ownedViews).toContain(view);
    expect([view.left, view.top, view.width, view.height]).toEqual([
      10, 20, 200, 100,
    ]);
  });

  it("defaults the bounds to a 100x50 box at (100, 100) and projects both elements", async () => {
    const data = await ok<{ view: Record<string, unknown> }>(
      createElementWithView,
      nodeBody({ fields: ["left", "top", "width", "height"] }),
    );
    expect(data.view).toMatchObject({
      left: 100,
      top: 100,
      width: 100,
      height: 50,
    });
  });

  it("rejects a name that is not a string", async () => {
    await fails(
      createElementWithView,
      nodeBody({ name: 7 }),
      "INVALID_ARGUMENT",
      /^name: /,
    );
  });

  it("reports a type without a model-and-view factory, for which it returns null", async () => {
    await fails(
      createElementWithView,
      nodeBody({ type: "UMLAttribute" }),
      "UNKNOWN_TYPE",
      "Unknown model-and-view type: UMLAttribute",
    );
  });

  it("reports a factory exception as STARUML_ERROR", async () => {
    vi.spyOn(env.app.factory, "createModelAndView").mockImplementation(() => {
      throw new Error("factory down");
    });
    await fails(
      createElementWithView,
      nodeBody(),
      "STARUML_ERROR",
      "factory down",
    );
  });
});

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

  it.each(["type", "parentId", "diagramId", "tailViewId", "headViewId"])(
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

    const edge = env.app.repository.get(data.view._id) as View;
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
      _id: data.model._id,
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
