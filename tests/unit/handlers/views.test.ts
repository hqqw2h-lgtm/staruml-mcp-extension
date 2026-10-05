import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagram } from "../../../src/handlers/diagrams.js";
import { createElementWithView } from "../../../src/handlers/elements.js";
import { createEdgeWithView } from "../../../src/handlers/relationships.js";
import {
  layoutDiagram,
  moveViews,
  resizeNode,
  routeEdges,
  setViewStyle,
  setZOrder,
} from "../../../src/handlers/views.js";
import {
  create,
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

interface Created {
  view: { _id: string };
  model: { _id: string };
}

export async function classView(
  name: string,
  diagramId = env.mainDiagram._id,
  x = 100,
): Promise<Created> {
  return ok<Created>(createElementWithView, {
    type: "UMLClass",
    diagramId,
    name,
    x,
  });
}

function view(id: string): MockElement {
  return env.app.repository.get(id)!;
}

describe("/layout_diagram", () => {
  it("lays out the current diagram top to bottom by default", async () => {
    const a = await classView("A");
    const b = await classView("B");
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const data = await ok(layoutDiagram, {});
    expect(data).toEqual({ _id: env.mainDiagram._id, direction: "TB" });
    expect(view(a.view._id).top).toBe(20);
    expect(view(b.view._id).top).toBe(120);
    expect(env.app.repository._undoStack.size()).toBe(1);
  });

  it("opens the named diagram and passes direction, separations and edge style", async () => {
    const spy = vi.spyOn(env.app.engine, "layoutDiagram");
    await classView("A");
    await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      direction: "LR",
      separations: { node: 10, edge: 5, rank: 40 },
      edgeLineStyle: "rectilinear",
    });
    expect(env.app.diagrams.getCurrentDiagram()).toBe(env.mainDiagram);
    expect(spy).toHaveBeenCalledWith(
      env.app.diagrams.getEditor(),
      env.mainDiagram,
      "LR",
      { node: 10, edge: 5, rank: 40 },
      0,
    );
  });

  it("needs a diagram when none is open", async () => {
    await fails(
      layoutDiagram,
      {},
      "NOT_FOUND",
      "No diagram is open; pass 'id'",
    );
  });

  it("rejects an id that is not a diagram and an unknown direction", async () => {
    await fails(layoutDiagram, { id: env.model._id }, "NOT_FOUND");
    await fails(
      layoutDiagram,
      { direction: "up" },
      "INVALID_ARGUMENT",
      /^direction: /,
    );
  });
});

describe("/layout_diagram presets", () => {
  it("runs flow presets against dagre's head-to-tail ranks", async () => {
    const spy = vi.spyOn(env.app.engine, "layoutDiagram");
    await classView("A");
    const data = await ok(layoutDiagram, {
      diagramId: env.mainDiagram._id,
      preset: "flow-down",
    });
    expect(data).toEqual({
      _id: env.mainDiagram._id,
      direction: "BT",
      preset: "flow-down",
      separations: { node: 40, edge: 20, rank: 50 },
      edgeLineStyle: "rectilinear",
    });
    expect(spy).toHaveBeenLastCalledWith(
      env.app.diagrams.getEditor(),
      env.mainDiagram,
      "BT",
      { node: 40, edge: 20, rank: 50 },
      0,
    );
    await ok(layoutDiagram, { id: env.mainDiagram._id, preset: "flow-right" });
    expect(spy.mock.lastCall![2]).toBe("RL");
    await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      preset: "hierarchy-down",
    });
    expect(spy.mock.lastCall![2]).toBe("TB");
    expect((spy.mock.lastCall as unknown[])[3]).toEqual({
      node: 50,
      edge: 20,
      rank: 70,
    });
  });

  it("lets explicit fields override the preset", async () => {
    const spy = vi.spyOn(env.app.engine, "layoutDiagram");
    await classView("A");
    await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      preset: "flow-down",
      direction: "LR",
      separations: { node: 1, edge: 2, rank: 3 },
      rankSeparation: 9,
      edgeLineStyle: "curve",
    });
    expect(spy).toHaveBeenLastCalledWith(
      env.app.diagrams.getEditor(),
      env.mainDiagram,
      "LR",
      { node: 1, edge: 2, rank: 9 },
      3,
    );
  });

  it("completes partial separations with StarUML's defaults", async () => {
    const spy = vi.spyOn(env.app.engine, "layoutDiagram");
    await classView("A");
    const data = await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      nodeSeparation: 80,
    });
    expect(data).toEqual({
      _id: env.mainDiagram._id,
      direction: "TB",
      separations: { node: 80, edge: 30, rank: 30 },
    });
    expect((spy.mock.lastCall as unknown[])[4]).toBeUndefined();
  });

  it("fits node views to their content first", async () => {
    const a = await classView("A");
    const b = await classView("B", undefined, 400);
    const c = await classView("C", undefined, 700);
    const pkg = await ok<Created>(createElementWithView, {
      type: "UMLPackage",
      diagramId: env.mainDiagram._id,
      name: "P",
      x: 900,
      y: 100,
    });
    await ok(createEdgeWithView, {
      type: "UMLAssociation",
      diagramId: env.mainDiagram._id,
      tailViewId: a.view._id,
      headViewId: b.view._id,
    });
    Object.assign(view(a.view._id), { minWidth: 50, minHeight: 30 });
    // Already at its minimum size.
    const vb = view(b.view._id);
    Object.assign(vb, { minWidth: vb.width, minHeight: vb.height });
    // No minimum known yet: never drawn.
    Object.assign(view(c.view._id), { minWidth: 0, minHeight: 0 });
    Object.assign(view(pkg.view._id), {
      minWidth: 10,
      minHeight: 10,
      containedViews: [vb],
    });
    const before = env.app.repository._undoStack.size();
    const data = await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      fit: true,
    });
    expect(data).toMatchObject({ fitted: 1 });
    expect(view(a.view._id)).toMatchObject({ width: 50, height: 30 });
    expect(view(pkg.view._id).width).not.toBe(10);
    expect(env.app.repository._undoStack.size()).toBe(before + 2);
    const again = await ok(layoutDiagram, {
      id: env.mainDiagram._id,
      fit: true,
    });
    expect(again).toMatchObject({ fitted: 0 });
    expect(env.app.repository._undoStack.size()).toBe(before + 3);
  });

  it("rejects an unknown preset", async () => {
    await fails(
      layoutDiagram,
      { preset: "sideways" },
      "INVALID_ARGUMENT",
      /^preset: /,
    );
  });
});

describe("/route_edges", () => {
  it("styles every edge view on the diagram in one step", async () => {
    const a = await classView("A");
    const b = await classView("B", undefined, 400);
    const edge = await ok<Created>(createEdgeWithView, {
      type: "UMLAssociation",
      diagramId: env.mainDiagram._id,
      tailViewId: a.view._id,
      headViewId: b.view._id,
    });
    const before = env.app.repository._undoStack.size();
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const data = await ok(routeEdges, { lineStyle: "roundrect" });
    expect(data).toEqual({
      diagram: env.mainDiagram._id,
      lineStyle: "roundrect",
      edges: 1,
    });
    expect(view(edge.view._id).lineStyle).toBe(2);
    expect(env.app.repository._undoStack.size()).toBe(before + 1);
  });

  it("does nothing on a diagram without edges", async () => {
    await classView("A");
    const before = env.app.repository._undoStack.size();
    const data = await ok(routeEdges, {
      diagramId: env.mainDiagram._id,
      lineStyle: "oblique",
    });
    expect(data).toMatchObject({ edges: 0 });
    expect(env.app.repository._undoStack.size()).toBe(before);
  });

  it("needs a diagram", async () => {
    await fails(
      routeEdges,
      { lineStyle: "curve" },
      "NOT_FOUND",
      "No diagram is open; pass 'diagramId'",
    );
    await fails(
      routeEdges,
      { diagramId: env.mainDiagram._id, lineStyle: "zigzag" },
      "INVALID_ARGUMENT",
    );
  });
});

describe("/move_views", () => {
  it("moves node views and answers with their geometry", async () => {
    const a = await classView("A");
    const data = await ok<{ diagram: string; views: { left: number }[] }>(
      moveViews,
      { ids: [a.view._id], dx: 15, dy: -5 },
    );
    expect(data.diagram).toBe(env.mainDiagram._id);
    expect(data.views[0]).toMatchObject({
      _id: a.view._id,
      left: 115,
      top: 95,
    });
    expect(env.app.diagrams.getCurrentDiagram()).toBe(env.mainDiagram);
  });

  it("keeps the current diagram when the views are already on it", async () => {
    const a = await classView("A");
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const spy = vi.spyOn(env.app.diagrams, "setCurrentDiagram");
    await ok(moveViews, { ids: [a.view._id], dx: 1, dy: 1, summary: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses views on different diagrams", async () => {
    const other = await ok<{ _id: string }>(createDiagram, {
      type: "UMLClassDiagram",
      parentId: env.model._id,
    });
    const a = await classView("A");
    const b = await classView("B", other._id);
    await fails(
      moveViews,
      { ids: [a.view._id, b.view._id], dx: 1, dy: 1 },
      "INVALID_ARGUMENT",
      `View ${b.view._id} is not on diagram ${env.mainDiagram._id} like ${a.view._id}`,
    );
  });

  it("refuses ids that are not views, and an empty list", async () => {
    await fails(
      moveViews,
      { ids: [env.model._id], dx: 1, dy: 1 },
      "NOT_FOUND",
      `View not found: ${env.model._id}`,
    );
    await fails(moveViews, { ids: [], dx: 1, dy: 1 }, "INVALID_ARGUMENT");
  });

  it("reports what StarUML throws as STARUML_ERROR", async () => {
    const a = await classView("A");
    vi.spyOn(env.app.engine, "moveViews").mockImplementation(() => {
      throw new Error("boom");
    });
    await fails(
      moveViews,
      { ids: [a.view._id], dx: 1, dy: 1 },
      "STARUML_ERROR",
      "boom",
    );
  });
});

describe("/resize_node", () => {
  it("keeps omitted bounds", async () => {
    const a = await classView("A");
    const data = await ok(resizeNode, { id: a.view._id, width: 300 });
    expect(data).toMatchObject({
      left: 100,
      top: 100,
      width: 300,
      height: 50,
    });
    expect(await ok(resizeNode, { id: a.view._id, height: 80 })).toMatchObject({
      width: 300,
      height: 80,
    });
  });

  it("sets every bound", async () => {
    const a = await classView("A");
    const data = await ok(resizeNode, {
      id: a.view._id,
      left: 1,
      top: 2,
      width: 3,
      height: 4,
      fields: ["width"],
    });
    expect(data).toEqual({ _id: a.view._id, _type: "UMLClassView", width: 3 });
  });

  it("refuses an edge view", async () => {
    const a = await classView("A");
    const b = await classView("B", undefined, 400);
    const edge = await ok<Created>(createEdgeWithView, {
      type: "UMLAssociation",
      diagramId: env.mainDiagram._id,
      tailViewId: a.view._id,
      headViewId: b.view._id,
    });
    await fails(
      resizeNode,
      { id: edge.view._id, width: 10 },
      "NOT_FOUND",
      `Node view not found: ${edge.view._id}`,
    );
  });
});

describe("/set_view_style", () => {
  it("applies each given property as its own operation", async () => {
    const a = await classView("A");
    const data = await ok<{ views: Record<string, unknown>[] }>(setViewStyle, {
      ids: [a.view._id],
      fillColor: "#ffcc00",
      lineColor: "#123",
      fontColor: "#00000080",
      fontFace: "Helvetica",
      fontSize: 18,
      stereotypeDisplay: "icon",
      autoResize: true,
    });
    expect(data.views[0]).toMatchObject({
      fillColor: "#ffcc00",
      lineColor: "#123",
      fontColor: "#00000080",
      font: "Helvetica;18;0",
      stereotypeDisplay: "icon",
      autoResize: true,
    });
    expect(env.app.repository._undoStack.size()).toBe(7);
  });

  it("maps line style names to EdgeView.LS_*", async () => {
    const a = await classView("A");
    const b = await classView("B", undefined, 400);
    const edge = await ok<Created>(createEdgeWithView, {
      type: "UMLAssociation",
      diagramId: env.mainDiagram._id,
      tailViewId: a.view._id,
      headViewId: b.view._id,
    });
    const data = await ok<{ views: Record<string, unknown>[] }>(setViewStyle, {
      ids: [edge.view._id],
      lineStyle: "curve",
    });
    expect(data.views[0]).toMatchObject({ lineStyle: 3 });
  });

  it("needs at least one property", async () => {
    const a = await classView("A");
    await fails(
      setViewStyle,
      { ids: [a.view._id] },
      "INVALID_ARGUMENT",
      /^Pass at least one of fillColor, lineColor/,
    );
  });

  it("rejects a colour that is not CSS hex", async () => {
    const a = await classView("A");
    await fails(
      setViewStyle,
      { ids: [a.view._id], fillColor: "red" },
      "INVALID_ARGUMENT",
      /^fillColor: /,
    );
  });
});

describe("/set_z_order", () => {
  async function three() {
    const a = await classView("A");
    const b = await classView("B");
    const c = await classView("C");
    return [a.view._id, b.view._id, c.view._id];
  }

  it("brings views to the front in the given order", async () => {
    const [a, b, c] = await three();
    const data = await ok(setZOrder, { ids: [a, b], position: "front" });
    expect(data).toEqual({
      diagram: env.mainDiagram._id,
      order: [c, a, b],
    });
  });

  it("sends views to the back keeping their order", async () => {
    const [a, b, c] = await three();
    const data = await ok(setZOrder, { ids: [b, c], position: "back" });
    expect(data).toMatchObject({ order: [b, c, a] });
    env.app.repository.undo();
    expect(
      (env.mainDiagram.ownedViews as MockElement[]).map((v) => v._id),
    ).toEqual([a, b, c]);
  });

  it("leaves nested views alone", async () => {
    const [a] = await three();
    const label = create("UMLNameCompartmentView");
    label._parent = view(a!);
    (view(a!).subViews as MockElement[]).push(label);
    env.app.repository.index(label);
    const data = await ok<{ order: string[] }>(setZOrder, {
      ids: [label._id],
      position: "front",
    });
    expect(data.order[0]).toBe(a);
  });
});
