import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElementWithView } from "../../../src/handlers/elements.js";
import {
  getConnectedNodeViews,
  getEdgeViewsOf,
  getRefsTo,
  getRelationshipsOf,
  getViewsOf,
} from "../../../src/handlers/queries.js";
import { createEdgeWithView } from "../../../src/handlers/relationships.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
interface Created {
  view: { _id: string };
  model: { _id: string };
}
interface List {
  count: number;
  elements: { _id: string; _type: string }[];
}
let a: Created;
let b: Created;
let edge: Created;

beforeEach(async () => {
  env = installMockApp();
  const node = (name: string, x: number) =>
    ok<Created>(createElementWithView, {
      type: "UMLClass",
      diagramId: env.mainDiagram._id,
      name,
      x,
    });
  a = await node("A", 100);
  b = await node("B", 400);
  edge = await ok<Created>(createEdgeWithView, {
    type: "UMLGeneralization",
    diagramId: env.mainDiagram._id,
    tailViewId: a.view._id,
    headViewId: b.view._id,
  });
});

describe("reverse lookups", () => {
  it("/get_views_of lists a model's views", async () => {
    const data = await ok<List>(getViewsOf, { id: a.model._id });
    expect(data).toEqual({
      count: 1,
      elements: [expect.objectContaining({ _id: a.view._id })],
    });
  });

  it("/get_edge_views_of lists edges at a view", async () => {
    const data = await ok<List>(getEdgeViewsOf, { id: b.view._id });
    expect(data.elements.map((e) => e._id)).toEqual([edge.view._id]);
  });

  it("/get_relationships_of lists relationships at a model", async () => {
    const data = await ok<List>(getRelationshipsOf, {
      id: b.model._id,
      fields: ["source"],
    });
    expect(data.elements).toEqual([
      {
        _id: edge.model._id,
        _type: "UMLGeneralization",
        source: { $ref: a.model._id },
      },
    ]);
  });

  it("/get_refs_to lists referrers", async () => {
    const data = await ok<List>(getRefsTo, { id: a.model._id });
    expect(data.elements.map((e) => e._id).sort()).toEqual(
      [a.view._id, edge.model._id].sort(),
    );
  });

  it("/get_connected_node_views follows every edge by default", async () => {
    const data = await ok<List>(getConnectedNodeViews, { id: a.view._id });
    expect(data.elements.map((e) => e._id)).toEqual([b.view._id]);
  });

  it("/get_connected_node_views filters by edge view type", async () => {
    const none = await ok<List>(getConnectedNodeViews, {
      id: a.view._id,
      edgeType: "UMLAssociationView",
    });
    expect(none.count).toBe(0);
    await fails(
      getConnectedNodeViews,
      { id: a.view._id, edgeType: "Nope" },
      "UNKNOWN_TYPE",
    );
  });

  it("/get_connected_node_views reports what StarUML throws", async () => {
    vi.spyOn(env.app.repository, "getConnectedNodeViews").mockImplementation(
      () => {
        throw new Error("boom");
      },
    );
    await fails(
      getConnectedNodeViews,
      { id: a.view._id },
      "STARUML_ERROR",
      "boom",
    );
  });

  it("answers NOT_FOUND for unknown ids and non-views", async () => {
    await fails(getViewsOf, { id: "nope" }, "NOT_FOUND");
    await fails(getEdgeViewsOf, { id: a.model._id }, "NOT_FOUND");
    await fails(getRefsTo, { id: "nope" }, "NOT_FOUND");
    await fails(getRelationshipsOf, { id: "nope" }, "NOT_FOUND");
  });
});
