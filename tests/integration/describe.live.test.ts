import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Hit {
  id: string;
  category: string;
  description: string;
  example?: { path: string; body: Record<string, unknown> };
}

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
}

/** The example with its placeholders filled in. */
function fill(
  example: { path: string; body: Record<string, unknown> },
  values: Record<string, unknown>,
) {
  const body = Object.fromEntries(
    Object.entries(example.body).map(([k, v]) => [
      k,
      typeof v === "string" && v.startsWith("<") ? values[k] : v,
    ]),
  );
  return call<{ _id: string }>(example.path, body);
}

// Issue #18: type search, diagram text and model validation against
// StarUML 7.1.1.
describeLive("search, describe and validate", () => {
  let built: Built;

  beforeAll(async () => {
    await call("/new_project");
    const res = await call<Built>("/build_diagram", {
      name: "Shop",
      mermaid:
        "classDiagram\nclass Order {\n  +id: long\n  +total(): double\n}\nCustomer --> Order : places",
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    built = res.data;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("finds types whose example requests work as given", async () => {
    const res = await call<{ total: number; results: Hit[] }>("/search_types", {
      query: "composition",
      limit: 5,
    });
    const hit = res.data.results[0]!;
    expect(hit).toMatchObject({
      id: "UMLComposition",
      category: "relationship",
    });
    const edge = await fill(hit.example!, {
      tailId: built.ids.Customer!.view,
      headId: built.ids.Order!.view,
      diagramId: built.diagram._id,
    });
    expect(edge.success, JSON.stringify(edge)).toBe(true);

    const node = await call<{ results: Hit[] }>("/search_types", {
      query: "use case",
      categories: ["palette"],
    });
    expect(node.data.results[0]!.id).toBe("UMLUseCase");
    const diagram = await call<{ results: Hit[] }>("/search_types", {
      query: "statechart",
      categories: ["diagram"],
    });
    expect(diagram.data.results[0]!.id).toBe("UMLStatechartDiagram");
    const command = await call<{ results: Hit[] }>("/search_types", {
      query: "align left",
      categories: ["command"],
    });
    expect(command.data.results[0]!.example).toEqual({
      path: "/execute_command",
      body: { id: "alignment:align-left" },
    });
  });

  it("summarises a diagram in a few lines", async () => {
    const res = await call<{ text: string; nodes: number; edges: number }>(
      "/describe_diagram",
      { diagramId: built.diagram._id },
    );
    expect(res.data).toMatchObject({ nodes: 2, truncated: false });
    expect(res.data.text).toContain(
      '- UMLClass "Order" { +id: long; +total(): double }',
    );
    expect(res.data.text).toContain(
      '- "Customer" -[UMLAssociation "places"]-> "Order"',
    );
    const short = await call<{ text: string; truncated: boolean }>(
      "/describe_diagram",
      { diagramId: built.diagram._id, maxChars: 200 },
    );
    expect(short.data.text.length).toBeLessThanOrEqual(200);
  });

  it("validates the open model with StarUML's rules, within a scope", async () => {
    const order = built.ids.Order!.model;
    const parent = (
      await call<{ _parent: string }>("/get_element_by_id", { id: order })
    ).data._parent;
    const dup = await call<{ _id: string }>("/create_element", {
      type: "UMLClass",
      parentId: parent,
      name: "Order",
    });
    const res = await call<{
      count: number;
      rules: number;
      problems: { id: string; ruleId: string; message: string }[];
    }>("/validate_model", {});
    expect(res.data.rules).toBeGreaterThan(50);
    expect(res.data.problems).toContainEqual(
      expect.objectContaining({
        id: dup.data._id,
        ruleId: "UML002",
        message: "Name is already defined.",
      }),
    );
    const scoped = await call<{ problems: { id: string }[] }>(
      "/validate_model",
      { scope: dup.data._id },
    );
    expect(scoped.data.problems.map((p) => p.id)).toEqual([dup.data._id]);
    await call("/delete_element", { id: dup.data._id });
    const clean = await call<{ problems: { id: string }[] }>(
      "/validate_model",
      { scope: parent },
    );
    expect(clean.data.problems.map((p) => p.id)).not.toContain(order);
  });
});
