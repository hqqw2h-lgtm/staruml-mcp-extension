import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import { call, describeLive } from "./support.js";

interface Built {
  diagram: { _id: string; name: string | null };
  shown?: number;
  deleted?: number;
  warnings?: string[];
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
  "m-state-nested": [11, 9, "statemachine"],
  "m-class-notes": [4, 2, "class"],
  "m-seq-notes": [6, 4, "sequence"],
  "m-flow-styles": [3, 2, "flowchart"],
  "statemachine-nested": [7, 7, "statemachine"],
  "p-class": [9, 7, "class"],
  "p-seq": [8, 7, "sequence"],
  "p-usecase": [6, 5, "usecase"],
  "p-activity": [16, 16, "activity"],
  "p-legacy": [8, 8, "activity"],
  "p-state": [9, 8, "statemachine"],
  "p-erd": [2, 1, "erd"],
  "p-mindmap": [6, 5, "mindmap"],
  "p-c4": [3, 2, "c4"],
  "sql-shop": [4, 3, "erd"],
  "json-class": [6, 5, "class"],
  "json-erd": [6, 5, "erd"],
  "m-requirement": [5, 5, "requirement"],
  "m-c4": [5, 4, "c4"],
  requirement: [3, 3, "requirement"],
  c4: [4, 3, "c4"],
  composition: [4, 2, "class"],
  "m-composition": [7, 4, "class"],
  package: [5, 4, "package"],
  "package-flat": [3, 2, "package"],
  component: [9, 6, "component"],
  "component-flat": [3, 2, "component"],
  deployment: [7, 5, "deployment"],
  "deployment-flat": [3, 2, "deployment"],
  // Issue #25: every other 7.1.1 diagram family.
  "f-composite": [4, 1, "composite"],
  "f-object": [3, 2, "object"],
  "f-communication": [3, 5, "communication"],
  "f-timing": [10, 1, "timing"],
  "f-overview": [5, 5, "overview"],
  "f-infoflow": [3, 1, "infoflow"],
  "f-profile": [4, 2, "profile"],
  "f-dfd": [4, 4, "dfd"],
  "f-bdd": [6, 3, "bdd"],
  "f-ibd": [4, 3, "ibd"],
  "f-parametric": [3, 2, "parametric"],
  "f-bpmn": [8, 4, "bpmn"],
  "f-wireframe": [5, 0, "wireframe"],
  "f-aws": [5, 2, "aws"],
  "f-azure": [3, 1, "azure"],
  "f-gcp": [4, 2, "gcp"],
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

// Issue #19 against StarUML 7.1.1: composite states, notes, colours,
// operand boundaries, showing existing elements and prune.
describeLive("/build_diagram upsert, prune and reuse (#19)", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  const get = <T = Record<string, unknown>>(id: string, fields?: string[]) =>
    call<T>("/get_element_by_id", { id, ...(fields && { fields }) });

  it("nests states in the composite's region, with notes and colours", async () => {
    const res = await call<Built>("/build_diagram", {
      mermaid:
        "stateDiagram-v2\n  [*] --> Idle\n  state Active {\n    [*] --> Run\n  }\n  Idle --> Active\n  note right of Idle : wait\n  classDef hot fill:#ff9966\n  class Active hot",
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    const run = await get<{ containerView: { $ref: string } }>(
      res.data.ids.Run!.view,
      ["containerView"],
    );
    const region = await get<{ _type: string; model: { $ref: string } }>(
      run.data.containerView.$ref,
      ["model"],
    );
    expect(region.data._type).toBe("UMLRegionView");
    const model = await get<{ _parent: string }>(res.data.ids.Run!.model!);
    expect(model.data._parent).toBe(region.data.model.$ref);
    const active = await get<{ fillColor: string }>(res.data.ids.Active!.view, [
      "fillColor",
    ]);
    expect(active.data.fillColor).toBe("#ff9966");
    const note = await get<{ text: string; _type: string }>(
      res.data.ids["note 0"]!.view,
      ["text"],
    );
    expect(note.data).toMatchObject({ _type: "UMLNoteView", text: "wait" });
    const text = await call<{ text: string }>("/export_text", {
      diagramId: res.data.diagram._id,
      format: "mermaid",
    });
    expect(text.data.text).toMatch(/state N\d+ \{\n {4}state "Run"/);
    expect(text.data.text).toContain("note right of");
  });

  it("divides fragments where each operand begins, and exports them so", async () => {
    const source =
      "sequenceDiagram\n  participant A\n  participant B\n  alt a\n    A->>B: 1\n    A->>B: 2\n  else b\n    A->>B: 3\n  end";
    const res = await call<Built>("/build_diagram", { mermaid: source });
    expect(res.success, JSON.stringify(res)).toBe(true);
    const text = await call<{ text: string }>("/export_text", {
      diagramId: res.data.diagram._id,
      format: "mermaid",
    });
    expect(text.data.text).toContain(source);
  });

  it("shows existing elements again, and prunes in one undo step", async () => {
    const first = await call<Built>("/build_diagram", {
      kind: "class",
      name: "First",
      spec: {
        classes: [{ name: "Order" }, { name: "Line" }],
        relations: [{ from: "Order", to: "Line", type: "composition" }],
      },
    });
    const second = await call<Built>("/build_diagram", {
      kind: "class",
      name: "Second",
      spec: {
        classes: [{ name: "Order" }, { name: "Line" }, { name: "Customer" }],
        relations: [
          { from: "Order", to: "Line", type: "composition" },
          { from: "Customer", to: "Order" },
        ],
      },
    });
    expect(second.data).toMatchObject({ created: 5, shown: 2 });
    expect(second.data.ids.Order!.model).toBe(first.data.ids.Order!.model);
    expect(second.data.edges[0]!.model).toBe(first.data.edges[0]!.model);
    const found = await call<{ count: number }>("/find_elements", {
      type: "UMLClass",
      name: "Order",
    });
    expect(found.data.count).toBe(1);
    // Line is on Second too, so pruning it from First removes only views.
    const pruned = await call<Built>("/build_diagram", {
      kind: "class",
      name: "First",
      upsert: true,
      prune: true,
      spec: { classes: [{ name: "Order" }] },
    });
    expect(pruned.data).toMatchObject({ deleted: 2, unchanged: 1 });
    expect((await get(first.data.ids.Line!.model!)).success).toBe(true);
    expect((await get(first.data.ids.Line!.view)).code).toBe("NOT_FOUND");
    const last = await call<Built>("/build_diagram", {
      kind: "class",
      name: "Second",
      upsert: true,
      prune: true,
      spec: { classes: [{ name: "Order" }, { name: "Customer" }] },
    });
    expect(last.data.deleted).toBe(3);
    expect((await get(first.data.ids.Line!.model!)).code).toBe("NOT_FOUND");
    expect((await call("/undo")).success).toBe(true);
    expect((await get(first.data.ids.Line!.model!)).success).toBe(true);
    expect((await get(second.data.edges[1]!.view)).success).toBe(true);
  });
});

describeLive(
  "/create_view_of, /move_views into containers, /divide_fragment",
  () => {
    beforeAll(async () => {
      await call("/new_project");
    });

    afterAll(async () => {
      await call("/new_project");
    });

    it("refuses views, and relationships without their ends", async () => {
      const built = await call<Built>("/build_diagram", {
        kind: "class",
        spec: {
          classes: [{ name: "A" }, { name: "B" }],
          relations: [{ from: "A", to: "B", type: "dependency" }],
        },
      });
      const view = await call("/create_view_of", {
        modelId: built.data.ids.A!.view,
        diagramId: built.data.diagram._id,
      });
      expect(view.code).toBe("INVALID_ARGUMENT");
      const empty = await call<Built>("/build_diagram", {
        kind: "class",
        reuse: false,
        spec: {},
      });
      const other = { data: empty.data.diagram };
      const early = await call("/create_view_of", {
        modelId: built.data.edges[0]!.model,
        diagramId: other.data._id,
      });
      expect(early.code).toBe("INVALID_ARGUMENT");
      for (const key of ["A", "B"]) {
        const shown = await call("/create_view_of", {
          modelId: built.data.ids[key]!.model,
          diagramId: other.data._id,
        });
        expect(shown.success).toBe(true);
      }
      const edge = await call<{ view: { _id: string } }>("/create_view_of", {
        modelId: built.data.edges[0]!.model,
        diagramId: other.data._id,
      });
      expect(edge.success).toBe(true);
      const views = await call<{ ownedViews: unknown[] }>(
        "/get_element_by_id",
        {
          id: other.data._id,
          fields: ["ownedViews"],
        },
      );
      expect(views.data.ownedViews).toHaveLength(3);
    });

    it("refuses a container that cannot hold the views and boundaries out of order", async () => {
      const states = await call<Built>("/build_diagram", {
        kind: "statemachine",
        spec: { states: ["S", "T"] },
      });
      const bad = await call("/move_views", {
        ids: [states.data.ids.S!.view],
        dx: 0,
        dy: 0,
        containerViewId: states.data.ids.T!.view,
      });
      expect(bad.code).toBe("INVALID_ARGUMENT");
      const seq = await call<Built>("/build_diagram", {
        mermaid:
          "sequenceDiagram\n  alt a\n  A->>B: 1\n  else b\n  A->>B: 2\n  end",
      });
      const wrong = await call("/divide_fragment", {
        id: seq.data.ids["fragment 0"]!.view,
        at: [1, 2],
      });
      expect(wrong.code).toBe("INVALID_ARGUMENT");
    });
  },
);

// Issue #16 against StarUML 7.1.1: text formats and their refusals.
describeLive("/build_diagram text formats (#16)", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("detects each format and says which it read", async () => {
    const formats: [string, string][] = [
      ["@startuml\nA -> B : hi\n@enduml", "plantuml"],
      ["CREATE TABLE t (id int PRIMARY KEY)", "sql"],
      ['{"properties": {"a": {"type": "string"}}}', "jsonschema"],
      ["flowchart\n  A --> B", "mermaid"],
    ];
    for (const [text, format] of formats) {
      const res = await call<Built & { format: string }>("/build_diagram", {
        text,
      });
      expect(res.success, JSON.stringify(res)).toBe(true);
      expect(res.data.format).toBe(format);
    }
  });

  it("refuses unsupported constructs with UNSUPPORTED_SYNTAX and builds nothing", async () => {
    const before = await call<{ count: number }>("/find_elements", {
      type: "Diagram",
    });
    for (const text of [
      "@startgantt\n[A] lasts 2 days\n@endgantt",
      "@startuml\nobject o\n@enduml",
      "CREATE TABLE t (id int); CREATE VIEW v AS SELECT 1",
      '{"properties": {"a": {"oneOf": []}}}',
      'C4Dynamic\n  Rel(a, b, "x")',
    ]) {
      const res = await call("/build_diagram", { text });
      expect(res, text).toMatchObject({
        status: 422,
        code: "UNSUPPORTED_SYNTAX",
      });
    }
    const after = await call<{ count: number }>("/find_elements", {
      type: "Diagram",
    });
    expect(after.data.count).toBe(before.data.count);
  });

  it("writes requirement and C4 diagrams as Mermaid and PlantUML that build again", async () => {
    for (const body of [cases.requirement, cases.c4]) {
      const built = await call<Built>(
        "/build_diagram",
        body as Record<string, unknown>,
      );
      expect(built.success, JSON.stringify(built)).toBe(true);
      const plantuml = await call<{ text: string }>("/export_text", {
        diagramId: built.data.diagram._id,
        format: "plantuml",
      });
      expect(plantuml.data.text).toMatch(/^@startuml\n/);
      const mermaid = await call<{ text: string; kind: string }>(
        "/export_text",
        { diagramId: built.data.diagram._id, format: "mermaid" },
      );
      const again = await call<Built>("/build_diagram", {
        text: mermaid.data.text,
        reuse: false,
      });
      expect(again.success, mermaid.data.text).toBe(true);
      expect(again.data.kind).toBe(built.data.kind);
      expect(Object.keys(again.data.ids)).toHaveLength(
        Object.keys(built.data.ids).length,
      );
      expect(again.data.edges).toHaveLength(built.data.edges.length);
    }
    const c4 = await call<Built>("/build_diagram", {
      text: '@startuml\n!include <C4/C4_Context>\nPerson(u, "User")\nSystem(s, "Sys")\nRel(u, s, "Uses")\n@enduml',
    });
    expect(c4.data.kind).toBe("c4");
    const plantuml = await call<{ text: string }>("/export_text", {
      diagramId: c4.data.diagram._id,
      format: "plantuml",
    });
    const rebuilt = await call<Built>("/build_diagram", {
      text: plantuml.data.text,
      reuse: false,
    });
    expect(rebuilt.data).toMatchObject({ kind: "c4", created: 3 });
  });
});
