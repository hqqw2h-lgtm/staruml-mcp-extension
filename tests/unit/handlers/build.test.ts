import { beforeEach, describe, expect, it, vi } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { buildDiagramEndpoint } from "../../../src/handlers/build.js";
import { endpoints, routes } from "../../../src/routes.js";
import { serialize } from "../../../src/serialize.js";
import type { Element } from "../../../src/types.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
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
  shown?: number;
  deleted?: number;
  warnings?: string[];
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
      "Pass one of spec (with kind), mermaid and text",
    );
    await fails(
      build,
      { kind: "class", spec: {}, mermaid: "classDiagram" },
      "INVALID_ARGUMENT",
      "Pass one of spec (with kind), mermaid and text",
    );
    await fails(
      build,
      { spec: {} },
      "INVALID_ARGUMENT",
      "kind: required with spec",
    );
    await fails(
      build,
      { mermaid: "flowchart\n  A", format: "plantuml" },
      "INVALID_ARGUMENT",
      "format: mermaid holds Mermaid; pass plantuml source as text",
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
      {
        kind: "class",
        reuse: false,
        spec: { classes: [{ name: "A" }, { name: "B" }] },
      },
      "STARUML_ERROR",
      "build_diagram: ops.2 /create_element_with_view failed, batch rolled back: Invalid connection (test)",
    );
  });

  it("lays flows out along their edges and class diagrams as hierarchies (#12)", async () => {
    const spy = vi.spyOn(env.app.engine, "layoutDiagram");
    const flow = await ok<Full & { preset: string }>(build, {
      mermaid: "flowchart TD\n  S([start]) --> A[Do] --> E([end])",
      kind: "activity",
    });
    expect(flow.preset).toBe("flow-down");
    expect(spy.mock.lastCall![2]).toBe("BT");
    const right = await ok<Full & { preset: string }>(build, {
      mermaid: "flowchart LR\n  S --> E",
    });
    expect(right.preset).toBe("flow-right");
    expect(spy.mock.lastCall![2]).toBe("RL");
    const classes = await ok<Full & { preset: string }>(build, {
      kind: "class",
      spec: { classes: [{ name: "A" }] },
    });
    expect(classes.preset).toBe("hierarchy-down");
    const chosen = await ok<Full & { preset: string }>(build, {
      kind: "statemachine",
      spec: { states: ["A"] },
      layout: "hierarchy-left",
    });
    expect(chosen.preset).toBe("hierarchy-left");
    expect(spy.mock.lastCall![2]).toBe("RL");
    const placed = await ok<Full & { preset?: string }>(build, {
      kind: "class",
      spec: { classes: [{ name: "Z" }] },
      autoLayout: false,
    });
    expect(placed.preset).toBeUndefined();
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

// Issue #19: prune, notes, colours, composite states, operand boundaries
// and showing existing elements.
describe("/build_diagram notes, colours and nesting", () => {
  const get = (id: string) => env.app.repository.get(id)!;

  it("makes notes with their text and links, and colours views", async () => {
    const data = await ok<Full>(build, {
      kind: "class",
      spec: {
        classes: [{ name: "A" }],
        notes: [{ text: "about A", on: "A" }],
        styles: { A: { fillColor: "#ffcc00" } },
      },
    });
    const note = get(data.ids["note 0"]!.view);
    expect(data.ids["note 0"]!.model).toBeNull();
    expect(note.text).toBe("about A");
    expect(get(data.ids.A!.view).fillColor).toBe("#ffcc00");
    expect(data.edges).toEqual([
      { key: "note 0 -> A", model: null, view: expect.any(String) },
    ]);
    const link = get(data.edges[0]!.view);
    expect([link.tail, link.head]).toEqual([note, get(data.ids.A!.view)]);
  });

  it("puts nested states in their composite state's region", async () => {
    const data = await ok<Full>(build, {
      mermaid: "stateDiagram\n  state S {\n    [*] --> T\n  }\n  S --> U",
    });
    const region = get(data.ids.T!.view).containerView as Element;
    expect(region.constructor.name).toBe("UMLRegionView");
    expect(get(data.ids.T!.model!)._parent).toBe(region.model);
    expect(data.layout).toBe("placed");
  });

  it("divides fragments where their operands begin", async () => {
    const data = await ok<Full>(build, {
      mermaid:
        "sequenceDiagram\n  alt a\n  A->>B: 1\n  else b\n  A->>B: 2\n  end",
    });
    const fragment = get(data.ids["fragment 0"]!.view);
    const operands = (
      (fragment.operandCompartment as Element).subViews as Element[]
    ).map((v) => [v.top as number, v.height as number]);
    const y = (i: number) =>
      (get(data.edges[i]!.view).points as { points: { y: number }[] })
        .points[0]!.y;
    expect(operands[0]![0]! + operands[0]![1]!).toBe(y(1) - 35);
  });

  it("matches notes and colours on upsert", async () => {
    const request = {
      kind: "flowchart",
      name: "N",
      upsert: true,
      spec: {
        nodes: ["a", "b"],
        notes: [{ text: "n", on: "a" }],
        styles: { a: { fillColor: "#111111" } },
      },
    };
    const first = await ok<Full>(build, request);
    // A frame showing the diagram itself is neither matched nor pruned.
    const diagram = get(first.diagram._id);
    const frame = create("UMLFrameView");
    frame.model = diagram;
    (diagram.ownedViews as Element[]).push(frame);
    const again = await ok<Full>(build, { ...request, prune: true });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(again.deleted).toBe(0);
    expect(diagram.ownedViews).toContain(frame);
    expect(again.ids["note 0"]).toEqual(first.ids["note 0"]);
    const recoloured = await ok<Full>(build, {
      ...request,
      spec: { ...request.spec, styles: { a: { fillColor: "#222222" } } },
    });
    expect(recoloured).toMatchObject({ updated: 1, unchanged: 3 });
    expect(get(first.ids.a!.view).fillColor).toBe("#222222");
  });

  it("nests new states in an existing composite on upsert", async () => {
    const request = {
      kind: "statemachine",
      name: "S",
      upsert: true,
      spec: { states: ["S", { name: "T", parent: "S" }] },
    };
    await ok<Full>(build, request);
    const again = await ok<Full>(build, {
      ...request,
      spec: { states: [...request.spec.states, { name: "U", parent: "S" }] },
    });
    expect(again).toMatchObject({ created: 1, unchanged: 2 });
    expect(
      (get(again.ids.U!.view).containerView as Element).constructor.name,
    ).toBe("UMLRegionView");
  });
});

describe("/build_diagram prune", () => {
  const get = (id: string) => env.app.repository.get(id);

  it("needs upsert", async () => {
    await fails(
      build,
      { kind: "flowchart", spec: {}, prune: true },
      "INVALID_ARGUMENT",
      "prune: needs upsert",
    );
  });

  it("deletes what the spec no longer has, edges first, in one undo step", async () => {
    const first = await ok<Full>(build, {
      kind: "flowchart",
      name: "P",
      spec: {
        nodes: ["a", "b", "c"],
        flows: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
        notes: [{ text: "n", on: "c" }],
      },
    });
    const undo = env.app.repository._undoStack.size();
    const pruned = await ok<Full>(build, {
      kind: "flowchart",
      name: "P",
      upsert: true,
      prune: true,
      spec: { nodes: ["a", "b"], flows: [{ from: "a", to: "b" }] },
    });
    expect(pruned).toMatchObject({ created: 0, unchanged: 3, deleted: 4 });
    expect(get(first.ids.c!.model!)).toBeUndefined();
    expect(get(first.ids["note 0"]!.view)).toBeUndefined();
    expect(get(first.ids.a!.model!)).toBeDefined();
    // The mock's deleteElements records no operation; the live test checks
    // the single undo step.
    expect(env.app.repository._undoStack.size()).toBeGreaterThanOrEqual(undo);
    const nothing = await ok<Full>(build, {
      kind: "flowchart",
      name: "P",
      upsert: true,
      prune: true,
      spec: { nodes: ["a", "b"], flows: [{ from: "a", to: "b" }] },
    });
    expect(nothing.deleted).toBe(0);
    // A view of no model that is not a note, such as free text, is not the
    // spec's to prune.
    const diagram = get(first.diagram._id)!;
    const text = env.app.factory.createModelAndView({
      id: "Text",
      parent: diagram._parent!,
      diagram,
    } as never)!;
    await ok<Full>(build, {
      kind: "flowchart",
      name: "P",
      upsert: true,
      prune: true,
      spec: {},
    });
    expect(diagram.ownedViews).toEqual([text]);
  });

  it("keeps elements shown elsewhere or owning kept ones, removing only their views", async () => {
    const shared = await ok<Full>(build, {
      kind: "class",
      name: "Shared",
      spec: {
        packages: ["p"],
        classes: [{ name: "A", package: "p" }, { name: "B" }],
      },
    });
    await ok<Full>(build, {
      kind: "class",
      name: "Other",
      spec: { classes: [{ name: "B" }] },
    });
    const pruned = await ok<Full>(build, {
      kind: "class",
      name: "Shared",
      upsert: true,
      prune: true,
      reuse: false,
      spec: { classes: [{ name: "A" }] },
    });
    expect(pruned.deleted).toBe(2);
    expect(get(shared.ids.p!.model!)).toBeDefined();
    expect(get(shared.ids.p!.view)).toBeUndefined();
    expect(get(shared.ids.B!.model!)).toBeDefined();
    expect(get(shared.ids.B!.view)).toBeUndefined();
  });

  it("lets a pruned owner take what it owns along, and never the diagram's owner", async () => {
    const holder = await ok<Full>(build, {
      kind: "class",
      reuse: false,
      spec: { packages: ["Owner"] },
    });
    const owner = holder.ids.Owner!.model!;
    const data = await ok<Full>(build, {
      kind: "class",
      name: "Own",
      parentId: owner,
      spec: {
        packages: ["Owner", "p"],
        classes: [
          { name: "A", package: "Owner" },
          { name: "B", package: "p" },
        ],
        relations: [{ from: "B", to: "B", name: "self" }],
      },
    });
    expect(data.ids.Owner!.model).toBe(owner);
    const pruned = await ok<Full>(build, {
      kind: "class",
      name: "Own",
      parentId: owner,
      upsert: true,
      prune: true,
      spec: {},
    });
    // The Owner view, A, p (taking B along) and the self association,
    // which the mock files under the diagram's owner rather than under B.
    expect(pruned.deleted).toBe(4);
    expect(get(owner)).toBeDefined();
    expect(get(data.ids.Owner!.view)).toBeUndefined();
    expect(get(data.ids.p!.model!)).toBeUndefined();
    expect(get(data.ids.B!.model!)).toBeUndefined();
    expect(get(data.ids.A!.model!)).toBeUndefined();
    expect(get(data.diagram._id)!.ownedViews).toEqual([]);
  });
});

describe("/build_diagram reuse", () => {
  const get = (id: string) => env.app.repository.get(id)!;

  it("shows elements that exist elsewhere, with their relationships, once", async () => {
    const first = await ok<Full>(build, {
      kind: "class",
      name: "One",
      spec: {
        classes: [{ name: "A" }, { name: "B" }],
        relations: [{ from: "A", to: "B", name: "r" }],
      },
    });
    const second = await ok<Full>(build, {
      kind: "class",
      name: "Two",
      spec: {
        classes: [{ name: "A", attributes: ["x: int"] }, { name: "B" }],
        relations: [{ from: "A", to: "B", name: "r" }],
        styles: { A: { fillColor: "#abcdef" } },
      },
    });
    expect(second).toMatchObject({ created: 3, shown: 2 });
    expect(second.ids.A!.model).toBe(first.ids.A!.model);
    expect(second.edges[0]!.model).toBe(first.edges[0]!.model);
    expect(get(second.ids.A!.view).fillColor).toBe("#abcdef");
    // Shown at the planned size, as a placed diagram needs.
    expect(get(second.ids.A!.view).width).toBe(180);
    expect((get(first.ids.A!.model!).attributes as Element[]).length).toBe(1);
    const fresh = await ok<Full>(build, {
      kind: "class",
      name: "Three",
      reuse: false,
      spec: { classes: [{ name: "A" }] },
    });
    expect(fresh.ids.A!.model).not.toBe(first.ids.A!.model);
    expect(fresh.shown).toBeUndefined();
  });

  it("creates relationships the existing elements do not have yet", async () => {
    await ok<Full>(build, {
      kind: "usecase",
      spec: { actors: ["U"], useCases: ["Do"] },
    });
    const again = await ok<Full>(build, {
      kind: "usecase",
      spec: {
        actors: ["U"],
        useCases: ["Do"],
        relations: [{ from: "U", to: "Do" }],
      },
    });
    expect(again).toMatchObject({ created: 3, shown: 2 });
  });

  it("picks one of several by its owner or path, else warns and makes a new one", async () => {
    await ok<Full>(build, {
      kind: "class",
      reuse: false,
      spec: { packages: ["p", "q"], classes: [{ name: "A", package: "p" }] },
    });
    await ok<Full>(build, {
      kind: "class",
      reuse: false,
      spec: { classes: [{ name: "A", package: "q" }], packages: ["q"] },
    });
    const ambiguous = await ok<Full & { warnings: string[] }>(build, {
      kind: "class",
      spec: { classes: [{ name: "A" }] },
    });
    expect(ambiguous.shown).toBeUndefined();
    expect(ambiguous.warnings).toEqual([
      "2 UMLClass elements are named A; made a new one (name it by its path, Owner::A, to show one of them)",
    ]);
    const byPath = await ok<Full>(build, {
      kind: "class",
      spec: { classes: [{ name: "p :: A" }] },
    });
    expect(byPath.shown).toBe(1);
    expect(get(get(byPath.ids["p :: A"]!.model!)._parent!._id).name).toBe("p");
    await fails(
      build,
      { kind: "class", spec: { classes: [{ name: "zz::A" }] } },
      "INVALID_ARGUMENT",
      "spec: no UMLClass at zz::A",
    );
    // Under the diagram's owner, the nearer one wins.
    const model = env.model;
    const near = await ok<Full>(build, {
      kind: "class",
      parentId: model._id,
      reuse: false,
      spec: { classes: [{ name: "N" }] },
    });
    await ok<Full>(build, {
      kind: "class",
      reuse: false,
      spec: { classes: [{ name: "N" }] },
    });
    const picked = await ok<Full>(build, {
      kind: "class",
      parentId: model._id,
      spec: { classes: [{ name: "N" }] },
    });
    expect(picked.ids.N!.model).toBe(near.ids.N!.model);
  });
});
