import { beforeEach, describe, expect, it, vi } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { buildDiagramEndpoint } from "../../../src/handlers/build.js";
import { endpoints, routes } from "../../../src/routes.js";
import { serialize } from "../../../src/serialize.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const build = buildDiagramEndpoint(() => endpoints);

beforeEach(() => {
  env = installMockApp();
});

/** What a diagram's .mdj records about structure and placement. */
const GOLDEN_FIELDS = [
  "name",
  "ownedElements",
  "ownedViews",
  "model",
  "tail",
  "head",
  "source",
  "target",
  "end1",
  "end2",
  "reference",
  "cardinality",
  "multiplicity",
  "aggregation",
  "navigable",
  "identifying",
  "attributes",
  "operations",
  "parameters",
  "literals",
  "columns",
  "type",
  "length",
  "primaryKey",
  "foreignKey",
  "nullable",
  "unique",
  "defaultValue",
  "direction",
  "visibility",
  "isStatic",
  "isAbstract",
  "stereotype",
  "guard",
  "interactionOperator",
  "operands",
  "messageSort",
  "kind",
  "left",
  "top",
  "width",
  "height",
];

/** The project in .mdj form, cut to GOLDEN_FIELDS, ids numbered by appearance. */
function golden(project: Element): string {
  const json = JSON.stringify(
    serialize(project, { fields: GOLDEN_FIELDS, depth: 8 }),
    null,
    1,
  );
  const ids = new Map<string, string>();
  return json.replace(/"(_id|_parent|\$ref)": "([^"]+)"/g, (_m, k, v) => {
    if (!ids.has(v)) ids.set(v, `#${ids.size}`);
    return `"${k}": "${ids.get(v)}"`;
  });
}

interface Built {
  diagram: { _id: string; _type: string; name: string | null };
  created: number;
  layout: string;
  ids: Record<string, { model: string | null; view: string }>;
  edges: unknown[];
}

describe("/build_diagram per kind", () => {
  it.each(Object.entries(cases))("%s", async (label, body) => {
    const data = await ok<Built>(build, body as Record<string, unknown>);
    expect(data.created).toBeGreaterThan(0);
    await expect(golden(env.project)).toMatchFileSnapshot(
      `../../fixtures/build/${label}.mdj.json`,
    );
  });
});

interface Full extends Built {
  kind: string;
  upserted: boolean;
  updated: number;
  unchanged: number;
  edges: { key: string; model: string | null; view: string }[];
}

describe("/build_diagram requests", () => {
  it("needs exactly one of spec and mermaid, and a kind with spec", async () => {
    await fails(
      build,
      {},
      "INVALID_ARGUMENT",
      "Pass either spec (with kind) or mermaid",
    );
    await fails(
      build,
      { kind: "class", spec: {}, mermaid: "classDiagram" },
      "INVALID_ARGUMENT",
      "Pass either spec (with kind) or mermaid",
    );
    await fails(
      build,
      { spec: {} },
      "INVALID_ARGUMENT",
      "kind: required with spec",
    );
    await fails(
      build,
      { mermaid: "pie" },
      "INVALID_ARGUMENT",
      /^mermaid line 1/,
    );
    await fails(
      build,
      { kind: "erd", spec: { entities: 1 } },
      "INVALID_ARGUMENT",
      /^spec\.entities/,
    );
  });

  it("names the diagram from the request, else the Mermaid title, else StarUML", async () => {
    const named = await ok<Full>(build, {
      mermaid: "---\ntitle: From title\n---\nflowchart\n  A",
      name: "Given<br>name",
    });
    expect(named.diagram.name).toBe("Given\nname");
    expect(named.layout).toBe("engine");
    const titled = await ok<Full>(build, {
      mermaid: "flowchart LR\n  title Titled\n  A --> B",
    });
    expect(titled.diagram.name).toBe("Titled");
    const unnamed = await ok<Full>(build, {
      kind: "flowchart",
      spec: { nodes: ["A"] },
    });
    expect(unnamed.diagram._type).toBe("FCFlowchartDiagram");
  });

  it("builds under a given parent and reports a failed op as the whole call's error", async () => {
    const data = await ok<Full>(build, {
      kind: "class",
      parentId: env.model._id,
      spec: { classes: [{ name: "A" }] },
    });
    expect(env.app.repository.get(data.diagram._id)!._parent).toBe(env.model);
    await fails(
      build,
      { kind: "class", parentId: "nope", spec: {} },
      "NOT_FOUND",
    );
    const real = env.app.factory.createModelAndView.bind(env.app.factory);
    let calls = 0;
    vi.spyOn(env.app.factory, "createModelAndView").mockImplementation((o) => {
      if (++calls === 2) throw "Invalid connection (test)";
      return real(o);
    });
    await fails(
      build,
      { kind: "class", spec: { classes: [{ name: "A" }, { name: "B" }] } },
      "STARUML_ERROR",
      "build_diagram: ops.2 /create_element_with_view failed, batch rolled back: Invalid connection (test)",
    );
  });

  it("places without engine layout when asked, or when the engine has none", async () => {
    const off = await ok<Full>(build, {
      kind: "flowchart",
      spec: { nodes: ["A", "B"], flows: [{ from: "A", to: "B" }] },
      autoLayout: false,
    });
    expect(off.layout).toBe("placed");
    (env.app.engine as unknown as Record<string, unknown>).layoutDiagram =
      undefined;
    const none = await ok<Full>(build, {
      kind: "flowchart",
      spec: { nodes: ["A"] },
      direction: "LR",
    });
    expect(none.layout).toBe("placed");
  });

  it("files classes under their package", async () => {
    const data = await ok<Full>(build, {
      kind: "class",
      spec: { packages: ["p"], classes: [{ name: "A", package: "p" }] },
    });
    expect(env.app.repository.get(data.ids.A!.model!)!._parent!._id).toBe(
      data.ids.p!.model,
    );
  });

  it("returns the ids of nodes and edges", async () => {
    const data = await ok<Full>(build, {
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "B" }],
        relations: [{ from: "A", to: "B" }],
      },
    });
    expect(Object.keys(data.ids)).toEqual(["A", "B"]);
    const a = env.app.repository.get(data.ids.A!.model!)!;
    expect(a.name).toBe("A");
    expect(env.app.repository.get(data.ids.A!.view)!.model).toBe(a);
    expect(data.edges).toEqual([
      { key: "A -> B", model: expect.any(String), view: expect.any(String) },
    ]);
    expect(data.created).toBe(3);
  });
});

describe("/build_diagram route", () => {
  it("is served with the batch endpoint it builds on", async () => {
    const result = await routes["/build_diagram"]!({
      kind: "flowchart",
      spec: { nodes: ["A"] },
    });
    expect(result).toMatchObject({ success: true, data: { created: 1 } });
  });
});

describe("/build_diagram upsert", () => {
  const spec = {
    classes: [
      { name: "A", attributes: ["x: int"] },
      { name: "B", kind: "enum", literals: ["ONE"] },
    ],
    relations: [{ from: "A", to: "B" }],
  };

  it("updates the diagram of the same name instead of adding one", async () => {
    const first = await ok<Full>(build, { kind: "class", name: "D", spec });
    const again = await ok<Full>(build, {
      kind: "class",
      name: "D",
      spec,
      upsert: true,
    });
    expect(again).toMatchObject({
      upserted: true,
      created: 0,
      updated: 0,
      unchanged: 3,
      layout: "placed",
      ids: first.ids,
      edges: [],
    });
    expect(again.diagram._id).toBe(first.diagram._id);
    const grownRequest = {
      kind: "class",
      name: "D",
      upsert: true,
      spec: {
        classes: [
          {
            name: "A",
            kind: "abstract",
            attributes: ["x: int", "y: int"],
            operations: ["f()", "f()"],
          },
          { name: "B", kind: "enum", literals: ["ONE", "TWO"] },
          { name: "C" },
        ],
        relations: [
          { from: "A", to: "B" },
          { from: "C", to: "A", type: "generalization" },
        ],
      },
    };
    const grown = await ok<Full>(build, grownRequest);
    expect(grown).toMatchObject({
      created: 2,
      updated: 2,
      unchanged: 1,
      layout: "engine",
    });
    const a = env.app.repository.get(first.ids.A!.model!)!;
    expect(a.isAbstract).toBe(true);
    expect((a.attributes as { name: string }[]).map((x) => x.name)).toEqual([
      "x",
      "y",
    ]);
    // Members are matched by name, against the model and the spec itself.
    expect((a.operations as unknown[]).length).toBe(1);
    const steady = await ok<Full>(
      build,
      JSON.parse(JSON.stringify(grownRequest)) as Record<string, unknown>,
    );
    expect(steady).toMatchObject({ created: 0, updated: 0, unchanged: 5 });
    const b = env.app.repository.get(first.ids.B!.model!)!;
    expect((b.literals as { name: string }[]).map((x) => x.name)).toEqual([
      "ONE",
      "TWO",
    ]);
  });

  it("adds a diagram when none matches, or when it has no name", async () => {
    const first = await ok<Full>(build, { kind: "class", name: "D", spec });
    const other = await ok<Full>(build, {
      kind: "class",
      name: "E",
      spec,
      upsert: true,
    });
    expect(other.upserted).toBe(false);
    expect(other.diagram._id).not.toBe(first.diagram._id);
    const elsewhere = await ok<Full>(build, {
      kind: "class",
      name: "D",
      spec,
      upsert: true,
      parentId: env.model._id,
    });
    expect(elsewhere.upserted).toBe(false);
    const nameless = await ok<Full>(build, {
      kind: "class",
      spec,
      upsert: true,
    });
    expect(nameless.upserted).toBe(false);
  });

  it("matches pseudo states by kind and columns by name", async () => {
    const machine = {
      states: [{ id: "i", type: "initial" }, { id: "c", type: "choice" }, "S"],
      transitions: [{ from: "i", to: "S" }],
    };
    await ok(build, { kind: "statemachine", name: "M", spec: machine });
    const again = await ok<Full>(build, {
      kind: "statemachine",
      name: "M",
      spec: machine,
      upsert: true,
    });
    expect(again).toMatchObject({ created: 0, unchanged: 4 });
    const db = { entities: [{ name: "t", columns: ["id int PK"] }] };
    await ok(build, { kind: "erd", name: "DB", spec: db });
    const more = await ok<Full>(build, {
      kind: "erd",
      name: "DB",
      upsert: true,
      spec: { entities: [{ name: "t", columns: ["id int PK", "name text"] }] },
    });
    expect(more).toMatchObject({ created: 0, updated: 1 });
    const table = env.app.repository.get(more.ids.t!.model!)!;
    expect((table.columns as { name: string }[]).map((c) => c.name)).toEqual([
      "id",
      "name",
    ]);
  });

  it("ignores views without a model on the diagram", async () => {
    const first = await ok<Full>(build, {
      kind: "flowchart",
      name: "F",
      spec: { nodes: ["A"] },
    });
    const diagram = env.app.repository.get(first.diagram._id)!;
    await ok(
      (await import("../../../src/handlers/elements.js")).createElementWithView,
      { type: "Note", diagramId: diagram._id },
    );
    const again = await ok<Full>(build, {
      kind: "flowchart",
      name: "F",
      spec: { nodes: ["A"] },
      upsert: true,
    });
    expect(again.unchanged).toBe(1);
  });
});
