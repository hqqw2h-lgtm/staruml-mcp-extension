import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Summary {
  _id: string;
  _type: string;
  name: string | null;
  path?: string;
}

interface Built {
  diagram: Summary;
  ids: Record<string, { model: string; view: string }>;
  edges: { model: string; view: string }[];
}

// Issues #20 and #36 against StarUML 7.1.1: path references in every id
// field, canonical field names with their aliases, the duplicate-name
// policy and plain relationship labels.
describeLive("path references and canonical names", () => {
  let built: Built;

  beforeAll(async () => {
    await call("/new_project");
    const res = await call<Built>("/build_diagram", {
      name: "Shop",
      kind: "class",
      spec: {
        packages: ["Sales"],
        classes: [
          {
            name: "Order",
            package: "Sales",
            attributes: ["+total: double"],
            operations: ["+pay(amount: double): void"],
          },
          { name: "Line", package: "Sales" },
        ],
        relations: [{ from: "Order", to: "Line", type: "composition" }],
      },
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    built = res.data;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("reads elements, members and views by path and answers their paths", async () => {
    const order = await call<Summary>("/get_element_by_id", {
      ref: "Sales/Order",
    });
    expect(order.data._id).toBe(built.ids.Order!.model);
    expect(order.data.path).toMatch(/\/Sales\/Order$/);
    const byFullPath = await call<Summary>("/get_element_by_id", {
      ref: order.data.path!,
    });
    expect(byFullPath.data._id).toBe(order.data._id);
    const total = await call<Summary>("/get_element_by_id", {
      ref: "Order.total",
    });
    expect(total.data).toMatchObject({ _type: "UMLAttribute", name: "total" });
    const pay = await call<Summary>("/get_element_by_id", {
      ref: "Order#pay()",
    });
    expect(pay.data).toMatchObject({ _type: "UMLOperation" });
    expect(pay.data.path).toMatch(/Order#pay\(double\)$/);
    const view = await call<Summary>("/get_element_by_id", {
      ref: "Order@Shop",
    });
    expect(view.data._id).toBe(built.ids.Order!.view);
    await call("/switch_diagram", { diagram: "Shop" });
    const current = await call<{ text: string }>("/describe_diagram", {
      diagram: "@current",
    });
    expect(current.data.text).toContain('"Order"');
    const resized = await call<Summary>("/resize_node", {
      ref: "Line",
      width: 220,
      height: 80,
    });
    expect(resized.data._id).toBe(built.ids.Line!.view);
  });

  it("answers AMBIGUOUS_REF with candidates, NOT_FOUND, and DUPLICATE_NAME", async () => {
    await call("/create_element", {
      type: "UMLPackage",
      parent: "@project",
      name: "Other",
    });
    const second = await call<Summary>("/create_element", {
      type: "UMLClass",
      parent: "Other",
      name: "Order",
    });
    expect(second.success, JSON.stringify(second)).toBe(true);
    const ambiguous = await call("/get_element_by_id", { ref: "Order" });
    expect(ambiguous).toMatchObject({ status: 409, code: "AMBIGUOUS_REF" });
    expect(
      (ambiguous.details as { candidates: unknown[] }).candidates,
    ).toHaveLength(2);
    const missing = await call("/get_element_by_id", { ref: "Nope/Order" });
    expect(missing).toMatchObject({ status: 404, code: "NOT_FOUND" });
    const duplicate = await call("/create_element", {
      type: "UMLClass",
      parent: "Other",
      name: "Order",
    });
    expect(duplicate).toMatchObject({ status: 409, code: "DUPLICATE_NAME" });
    const allowed = await call("/create_element", {
      type: "UMLClass",
      parent: "Other",
      name: "Order",
      allowDuplicateNames: true,
    });
    expect(allowed.success).toBe(true);
  });

  it("takes old field names as aliases, and lists them marked in the manifest", async () => {
    const byAlias = await call("/get_element_by_id", {
      id: built.ids.Line!.model,
    });
    const byName = await call("/get_element_by_id", {
      ref: built.ids.Line!.model,
    });
    expect(byAlias).toEqual(byName);
    const both = await call("/get_element_by_id", {
      id: built.ids.Line!.model,
      ref: built.ids.Line!.model,
    });
    expect(both).toMatchObject({ status: 400, code: "INVALID_ARGUMENT" });
    const manifest = await call<{
      endpoints: {
        path: string;
        request: { properties: Record<string, Record<string, unknown>> };
      }[];
    }>("/introspect", { include: ["endpoints"] });
    const edge = manifest.data.endpoints.find(
      (e) => e.path === "/create_edge_with_view",
    )!;
    expect(edge.request.properties.tailViewId).toMatchObject({
      "x-alias-of": "tail",
      deprecated: true,
    });
    expect(edge.request.properties.tail!["x-alias-of"]).toBeUndefined();
  });

  it("labels a relationship plainly and names its ends only when asked", async () => {
    const res = await call<{ view: Summary; model: Summary }>(
      "/create_relationship",
      {
        type: "UMLAssociation",
        tail: "Line",
        head: "Sales/Order",
        diagram: "Shop",
        name: "REST, WS",
        tailName: "client",
      },
    );
    expect(res.success, JSON.stringify(res)).toBe(true);
    const view = await call<{ showVisibility: boolean }>("/get_element_by_id", {
      ref: res.data.view._id,
      fields: ["showVisibility"],
    });
    expect(view.data.showVisibility).toBe(false);
    const model = await call<{
      name: string;
      end1: { $ref: string };
      end2: { $ref: string };
    }>("/get_element_by_id", {
      ref: res.data.model._id,
      fields: ["name", "end1", "end2"],
    });
    expect(model.data.name).toBe("REST, WS");
    const ends = await Promise.all(
      [model.data.end1, model.data.end2].map((e) =>
        call<{ name: string }>("/get_element_by_id", {
          ref: e.$ref,
          fields: ["name"],
        }),
      ),
    );
    expect(ends.map((e) => e.data.name)).toEqual(["client", ""]);
  });

  it("resolves paths and $name.path inside a batch", async () => {
    const res = await call<{ results: { data: Summary }[] }>("/batch", {
      ops: [
        {
          path: "/create_element",
          as: "c",
          body: { type: "UMLClass", parent: "Sales", name: "Invoice" },
        },
        { path: "/add_attribute", body: { ref: "$c.path", name: "due" } },
        { path: "/get_element_by_id", body: { ref: "Sales/Invoice.due" } },
      ],
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.data.results[2]!.data.name).toBe("due");
  });
});
