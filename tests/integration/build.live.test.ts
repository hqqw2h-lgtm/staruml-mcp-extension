import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import { call, describeLive } from "./support.js";

interface Built {
  diagram: { _id: string; name: string | null };
  kind: string;
  upserted: boolean;
  created: number;
  updated: number;
  unchanged: number;
  layout: string;
  ids: Record<string, { model: string | null; view: string }>;
  edges: { key: string; model: string | null; view: string }[];
}

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

// Nodes and edges each case must produce, the same counts the golden .mdj
// fixtures of tests/unit/handlers/build.test.ts record.
const EXPECTED: Record<string, [nodes: number, edges: number, kind: string]> = {
  class: [2, 1, "class"],
  sequence: [5, 5, "sequence"],
  usecase: [6, 4, "usecase"],
  "usecase-free": [3, 2, "usecase"],
  activity: [8, 6, "activity"],
  "activity-free": [7, 7, "activity"],
  statemachine: [6, 5, "statemachine"],
  erd: [2, 1, "erd"],
  flowchart: [5, 5, "flowchart"],
  mindmap: [5, 4, "mindmap"],
  "m-class": [4, 3, "class"],
  "m-seq": [6, 5, "sequence"],
  "m-flow": [5, 5, "flowchart"],
  "m-activity": [8, 6, "activity"],
  "m-usecase": [5, 3, "usecase"],
  "m-erd": [3, 2, "erd"],
  "m-state": [8, 8, "statemachine"],
};

// Issue #9: /build_diagram against StarUML 7.1.1, every kind from a spec and
// from Mermaid, rendered to PNG; upsert and the single undo step.
describeLive("/build_diagram", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it.each(Object.entries(cases))(
    "builds %s and renders it",
    async (label, body) => {
      const res = await call<Built>(
        "/build_diagram",
        body as Record<string, unknown>,
      );
      expect(res.success, JSON.stringify(res).slice(0, 800)).toBe(true);
      const [nodes, edges, kind] = EXPECTED[label]!;
      expect(res.data.kind).toBe(kind);
      expect(Object.keys(res.data.ids)).toHaveLength(nodes);
      expect(res.data.edges).toHaveLength(edges);
      expect(res.data.created).toBe(nodes + edges);
      for (const ref of [...Object.values(res.data.ids), ...res.data.edges]) {
        const view = await call<{ _id: string }>("/get_element_by_id", {
          id: ref.view,
        });
        expect(view.success).toBe(true);
      }
      // Every node and edge has its view on the diagram, besides any view
      // StarUML adds on its own (the sequence diagram's frame).
      const diagram = await call<{ ownedViews: unknown[] }>(
        "/get_element_by_id",
        {
          id: res.data.diagram._id,
          fields: ["ownedViews"],
        },
      );
      expect(diagram.data.ownedViews.length).toBeGreaterThanOrEqual(
        nodes + edges,
      );
      const image = await call<{
        base64: string;
        width: number;
        height: number;
      }>("/export_diagram", {
        id: res.data.diagram._id,
        background: "#ffffff",
      });
      const png = Buffer.from(image.data.base64, "base64");
      expect(pngSize(png)).toEqual({
        width: image.data.width,
        height: image.data.height,
      });
      expect(image.data.width).toBeGreaterThan(100);
    },
  );

  it("names diagrams from the request or the Mermaid title, with line breaks", async () => {
    const named = await call<Built>("/build_diagram", {
      kind: "flowchart",
      name: "Two<br/>lines",
      spec: { nodes: ["A\\nB"] },
    });
    expect(named.data.diagram.name).toBe("Two\nlines");
    const node = await call<{ name: string }>("/get_element_by_id", {
      id: named.data.ids["A\nB"]!.model!,
    });
    expect(node.data.name).toBe("A\nB");
    const titled = await call<Built>("/build_diagram", {
      mermaid: "---\ntitle: Front matter\n---\nerDiagram\n  A ||--o{ B : has",
    });
    expect(titled.data.diagram.name).toBe("Front matter");
  });

  it("updates on upsert instead of duplicating", async () => {
    const spec = {
      classes: [
        { name: "Invoice", attributes: ["+id: long"] },
        { name: "Line" },
      ],
      relations: [{ from: "Invoice", to: "Line", type: "composition" }],
    };
    const first = await call<Built>("/build_diagram", {
      kind: "class",
      name: "Upsert",
      spec,
    });
    const again = await call<Built>("/build_diagram", {
      kind: "class",
      name: "Upsert",
      spec,
      upsert: true,
    });
    expect(again.data).toMatchObject({
      upserted: true,
      created: 0,
      updated: 0,
      unchanged: 3,
      ids: first.data.ids,
    });
    const grown = await call<Built>("/build_diagram", {
      kind: "class",
      name: "Upsert",
      upsert: true,
      spec: {
        classes: [
          { name: "Invoice", attributes: ["+id: long", "+total: double"] },
          { name: "Line" },
          { name: "Payer" },
        ],
        relations: [...spec.relations, { from: "Payer", to: "Invoice" }],
      },
    });
    expect(grown.data).toMatchObject({ created: 2, updated: 1, unchanged: 2 });
    const order = await call<{ attributes: unknown[] }>("/get_element_by_id", {
      id: first.data.ids.Invoice!.model!,
      fields: ["attributes"],
    });
    expect(order.data.attributes).toHaveLength(2);
    const found = await call<{ count: number }>("/find_elements", {
      type: "UMLClass",
      name: "Invoice",
    });
    expect(found.data.count).toBe(1);
  });

  it("is one undo step, and refuses a bad spec without leaving anything", async () => {
    const res = await call<Built>("/build_diagram", {
      kind: "statemachine",
      name: "Undo me",
      spec: { states: ["A", "B"], transitions: [{ from: "A", to: "B" }] },
    });
    expect(res.success).toBe(true);
    expect((await call("/undo")).success).toBe(true);
    expect(
      (await call("/get_element_by_id", { id: res.data.diagram._id })).code,
    ).toBe("NOT_FOUND");
    expect(
      (await call("/get_element_by_id", { id: res.data.ids.A!.model! })).code,
    ).toBe("NOT_FOUND");
    const bad = await call("/build_diagram", {
      kind: "flowchart",
      spec: { nodes: ["A"], flows: [{ from: "A", to: "Z" }] },
    });
    expect(bad).toMatchObject({ status: 400, code: "INVALID_ARGUMENT" });
  });
});
