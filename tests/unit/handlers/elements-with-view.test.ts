import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElementWithView } from "../../../src/handlers/elements.js";
import {
  installMockApp,
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

  it.each(["type", "diagramId"])("requires %s", async (field) => {
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

  it("defaults the owner to the diagram's owner, as the diagram editor does", async () => {
    const data = await ok<Created>(
      createElementWithView,
      nodeBody({ parentId: undefined }),
    );
    expect(data.model).toMatchObject({ _parent: env.model._id });
  });

  it("applies properties to the new model in the same creation", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    const data = await ok<{ model: Record<string, unknown> }>(
      createElementWithView,
      nodeBody({
        name: "Shape",
        properties: { isAbstract: true },
        fields: ["isAbstract", "name"],
      }),
    );
    expect(data.model).toMatchObject({ isAbstract: true, name: "Shape" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects a property the model type lacks before calling StarUML", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await fails(
      createElementWithView,
      nodeBody({ properties: { colour: "red" } }),
      "INVALID_ARGUMENT",
      "UMLClass has no field 'colour'",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("hosts the view in a container view, as the editor does on a drop onto it", async () => {
    const host = await ok<Created>(createElementWithView, nodeBody());
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    const data = await ok<Created>(
      createElementWithView,
      nodeBody({
        type: "UMLInterface",
        parentId: undefined,
        containerViewId: host.view._id,
      }),
    );
    const container = env.app.repository.get(host.view._id) as View;
    expect(spy.mock.calls[0]![0]).toMatchObject({
      containerView: container,
      headView: container,
      headModel: container.model,
      tailView: container,
      parent: env.model,
    });
    expect(container.containedViews).toContain(
      env.app.repository.get(data.view._id),
    );
  });

  it("passes an explicit parentId on", async () => {
    const host = await ok<Created>(createElementWithView, nodeBody());
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(
      createElementWithView,
      nodeBody({ parentId: host.model._id, containerViewId: host.view._id }),
    );
    expect(spy.mock.calls[0]![0]).toMatchObject({
      parent: env.app.repository.get(host.model._id),
    });
  });

  it("rejects a container that is not a view", async () => {
    await fails(
      createElementWithView,
      nodeBody({ containerViewId: env.model._id }),
      "NOT_FOUND",
      `Container view not found: ${env.model._id}`,
    );
  });

  it("applies a toolbox item's presets, with the request's values on top", async () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    await ok(
      createElementWithView,
      nodeBody({ type: "C4ContainerDatabase", name: "db" }),
    );
    const options = spy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(options).toMatchObject({
      id: "C4Container",
      "model-init": { kind: "database" },
      x1: 100,
    });
  });

  it("creates view-only ids such as Note, which take no name or properties", async () => {
    const data = await ok<{ view: { _type: string }; model: null }>(
      createElementWithView,
      nodeBody({ type: "Note" }),
    );
    expect(data).toMatchObject({ view: { _type: "UMLNoteView" }, model: null });
    await fails(
      createElementWithView,
      nodeBody({ type: "Note", name: "x" }),
      "INVALID_ARGUMENT",
      "Note creates only a view; name and properties do not apply",
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
