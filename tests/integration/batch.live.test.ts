import { afterAll, beforeAll, expect, it } from "vitest";
import { BASE_URL, call, describeLive, type Summary } from "./support.js";

interface Result {
  path: string;
  success: boolean;
  data?: Record<string, Summary> & Summary;
  code?: string;
}
interface Batch {
  atomic: boolean;
  succeeded: number;
  failed: number;
  results: Result[];
}

// Issue #7: /batch with $name references, atomic undo and rollback.
describeLive("/batch", () => {
  let modelId = "";

  beforeAll(async () => {
    await call("/new_project");
    const info = await call<{ project: Summary }>("/get_project_info");
    modelId = (
      await call<Summary>("/create_element", {
        type: "UMLModel",
        parentId: info.data.project._id,
        name: "Batch",
      })
    ).data._id;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  const exists = async (id: string) =>
    (await call("/get_element_by_id", { id })).success;

  it("builds a class diagram atomically and undoes it in one step", async () => {
    const node = (as: string, x: number) => ({
      path: "/create_element_with_view",
      as,
      body: { type: "UMLClass", diagramId: "$dgm", name: as, x, y: 80 },
    });
    const res = await call<Batch>("/batch", {
      ops: [
        {
          path: "/create_diagram",
          as: "dgm",
          body: { type: "UMLClassDiagram", parentId: modelId, name: "Shop" },
        },
        node("Order", 80),
        node("Customer", 380),
        node("Item", 80),
        {
          path: "/add_attribute",
          body: { ownerId: "$Order.model", name: "total", type: "Decimal" },
        },
        {
          path: "/create_edge_with_view",
          as: "places",
          body: {
            type: "UMLAssociation",
            diagramId: "$dgm",
            tailViewId: "$Customer.view",
            headViewId: "$Order.view",
            name: "places",
          },
        },
        {
          path: "/create_edge_with_view",
          body: {
            type: "UMLComposition",
            diagramId: "$dgm",
            tailViewId: "$Order.view",
            headViewId: "$Item.view",
          },
        },
        { path: "/layout_diagram", body: { id: "$dgm", direction: "LR" } },
      ],
    });
    expect(res.status, JSON.stringify(res)).toBe(200);
    expect(res.data).toMatchObject({ atomic: true, succeeded: 8, failed: 0 });
    const [dgm, order, , , , places] = res.data.results;
    const ids = [
      dgm!.data!._id,
      order!.data!.model._id,
      order!.data!.view._id,
      places!.data!.model._id,
    ];
    for (const id of ids) expect(await exists(id)).toBe(true);
    const attrs = await call<{ attributes: { $ref: string }[] }>(
      "/get_element_by_id",
      { id: order!.data!.model._id, fields: ["attributes"] },
    );
    expect(attrs.data.attributes).toHaveLength(1);

    await call("/undo");
    for (const id of ids) expect(await exists(id)).toBe(false);
    await call("/redo");
    for (const id of ids) expect(await exists(id)).toBe(true);
    await call("/undo");
    // The step before the batch is the UMLModel, which a second undo removes.
    expect(await exists(modelId)).toBe(true);
  });

  it("rolls back an atomic batch whose op fails", async () => {
    const res = await call<Batch>("/batch", {
      ops: [
        {
          path: "/create_element",
          as: "c",
          body: { type: "UMLClass", parentId: modelId, name: "Doomed" },
        },
        { path: "/add_attribute", body: { ownerId: "$c", name: "a" } },
        { path: "/add_attribute", body: { ownerId: "missing", name: "b" } },
      ],
    });
    expect(res).toMatchObject({ status: 404, code: "NOT_FOUND" });
    const { results } = (res as unknown as { details: { results: Result[] } })
      .details;
    expect(results.map((r) => r.success)).toEqual([true, true, false]);
    expect(await exists(results[0]!.data!._id)).toBe(false);
    await call("/redo");
    expect(await exists(results[0]!.data!._id)).toBe(false);
  });

  it("reports each op of a non-atomic batch", async () => {
    const res = await call<Batch>("/batch", {
      atomic: false,
      ops: [
        {
          path: "/create_element",
          as: "k",
          body: { type: "UMLClass", parentId: modelId, name: "Kept" },
        },
        { path: "/create_element", body: { type: "Nope", parentId: modelId } },
        { path: "/get_element_by_id", body: { id: "$k", fields: ["name"] } },
      ],
    });
    expect(res.data).toMatchObject({ atomic: false, succeeded: 2, failed: 1 });
    expect(res.data.results[1]).toMatchObject({ code: "UNKNOWN_TYPE" });
    expect(res.data.results[2]!.data).toMatchObject({ name: "Kept" });
  });

  it("enforces the op and body limits", async () => {
    const many = Array.from({ length: 501 }, () => ({ path: "/is_modified" }));
    const res = await call("/batch", { ops: many, atomic: false });
    expect(res).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    const big = await fetch(BASE_URL + "/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(4 * 1024 * 1024 + 1) }),
    });
    expect(big.status).toBe(413);
  });
});
