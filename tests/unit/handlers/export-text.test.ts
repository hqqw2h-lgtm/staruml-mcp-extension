import { beforeEach, describe, expect, it } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { exportText } from "../../../src/handlers/export-text.js";
import { endpoints } from "../../../src/routes.js";
import {
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

const build = endpoints.find((e) => e.path === "/build_diagram")!;

interface Built {
  diagram: { _id: string };
  kind: string;
}

interface Exported {
  kind: string;
  format: string;
  text: string;
  warnings: string[];
}

/** Model names of the node and edge views on a diagram, sorted. */
export function shown(diagramId: string) {
  const diagram = env.app.repository.get(diagramId)!;
  const views = (diagram.ownedViews as MockElement[]).filter((v) => v.model);
  const names = (edges: boolean) =>
    views
      .filter((v) => ("tail" in v && v.tail !== undefined) === edges)
      .map(
        (v) =>
          `${(v.model as MockElement).constructor.name}:${String((v.model as MockElement).name)}`,
      )
      .sort();
  return { nodes: names(false), edges: names(true) };
}

describe("/export_text per kind", () => {
  it.each(Object.entries(cases))(
    "%s round-trips through Mermaid and writes PlantUML",
    async (label, body) => {
      const built = await ok<Built>(build, body as Record<string, unknown>);
      const mermaid = await ok<Exported>(exportText, {
        diagramId: built.diagram._id,
        format: "mermaid",
      });
      await expect(mermaid.text).toMatchFileSnapshot(
        `../../fixtures/export/${label}.mmd`,
      );
      const plantuml = await ok<Exported>(exportText, {
        diagramId: built.diagram._id,
        format: "plantuml",
      });
      await expect(plantuml.text).toMatchFileSnapshot(
        `../../fixtures/export/${label}.puml`,
      );
      expect(mermaid.kind).toBe(built.kind);
      const again = await ok<Built>(build, {
        mermaid: mermaid.text,
        kind: mermaid.kind,
        allowDuplicateNames: true,
      });
      expect(shown(again.diagram._id)).toEqual(shown(built.diagram._id));
    },
  );
});

/** A view of `id` added straight through the mock factory. */
function add(
  diagramId: string,
  id: string,
  name: string,
  at: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    tail?: MockElement;
    head?: MockElement;
  },
): MockElement {
  const diagram = env.app.repository.get(diagramId)!;
  const view = env.app.factory.createModelAndView({
    id,
    parent: diagram._parent as MockElement,
    diagram,
    x1: at.x,
    y1: at.y,
    x2: at.x + (at.w ?? 40),
    y2: at.y + (at.h ?? 40),
    ...(at.tail && {
      tailView: at.tail,
      headView: at.head,
      tailModel: at.tail.model as MockElement,
      headModel: at.head!.model as MockElement,
    }),
  } as unknown as Parameters<typeof env.app.factory.createModelAndView>[0])!;
  (view.model as MockElement).name = name;
  return view;
}

const view = (id: string) => env.app.repository.get(id)!;
const model = (id: string) => view(id).model as MockElement;

async function text(diagramId: string, format = "mermaid") {
  return ok<Exported>(exportText, { diagramId, format });
}

interface Ids {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
  edges: { key: string; model: string; view: string }[];
}

describe("/export_text details", () => {
  it("reads packages, abstract classes and every association form", async () => {
    const built = await ok<Ids>(build, {
      kind: "class",
      spec: {
        packages: ["P"],
        classes: [
          { name: "A", package: "P", kind: "abstract" },
          { name: "B" },
          { name: "C" },
        ],
        relations: [
          { from: "A", to: "B", type: "aggregation" },
          { from: "A", to: "C", type: "directed", name: "uses" },
          { from: "B", to: "C", type: "dependency" },
          { from: "B", to: "C" },
          { from: "C", to: "B", fromMultiplicity: "1" },
        ],
      },
    });
    const d = built.diagram._id;
    // The mock leaves out the palette's model-init, which sets these ends.
    const end = (i: number, n: 1 | 2) =>
      model(built.edges[i]!.view)[`end${n}`] as MockElement;
    end(1, 2).navigable = "navigable";
    end(1, 1).navigable = "unspecified";
    // An association whose whole is its second end, as StarUML's palette
    // Composition draws it, reads with the ends swapped.
    end(4, 2).aggregation = "composite";
    add(d, "UMLDataType", "DT", { x: 600, y: 10 });
    add(d, "UMLRealization", "abs", {
      x: 0,
      y: 0,
      tail: view(built.ids.B!.view),
      head: view(built.ids.C!.view),
    });
    const out = await text(d);
    expect(out.text).toContain(
      "namespace P {\n    class A {\n      <<abstract>>",
    );
    expect(out.text).toContain(
      "  A o-- B\n  A --> C : uses\n  B ..> C\n  B -- C\n",
    );
    expect(out.text).toContain('  B *-- "1" C\n');
    expect(out.warnings).toEqual([
      "1 UMLDataType view is not written",
      "1 UMLRealization view is not written",
    ]);
  });

  it("orders messages by height and reads fragments around them", async () => {
    const built = await ok<Ids>(build, {
      kind: "sequence",
      spec: {
        messages: [
          { from: "A", to: "B", text: "one" },
          { from: "B", to: "A", text: "two" },
        ],
        fragments: [{ operator: "opt", guard: "g", from: 1, to: 1 }],
      },
    });
    const d = built.diagram._id;
    model(built.edges[1]!.view).messageSort = "asynchSignal";
    delete model(built.edges[0]!.view).messageSort;
    // A fragment no message passes through, and a view of another kind.
    add(d, "UMLCombinedFragment", "", { x: 0, y: 2000 });
    add(d, "UMLClass", "K", { x: 0, y: 3000 });
    // A message drawn without points sorts last.
    const late = add(d, "UMLMessage", "late", {
      x: 0,
      y: 0,
      tail: view(built.ids.A!.view),
      head: view(built.ids.B!.view),
    });
    late.points = "";
    const out = await text(d);
    expect(out.text).toContain(
      "  A->>B: one\n  opt g\n    B-)A: two\n  end\n  A->>B: late\n",
    );
    expect(out.warnings).toEqual([
      "1 UMLCombinedFragment view is not written",
      "1 UMLClass view is not written",
    ]);
  });

  it("reads use cases outside the boundary and named associations", async () => {
    const built = await ok<Ids>(build, {
      kind: "usecase",
      spec: {
        actors: ["U"],
        useCases: ["Buy", "Pay"],
        relations: [
          { from: "U", to: "Buy", name: "starts" },
          { from: "Pay", to: "Buy", type: "generalization" },
        ],
      },
    });
    const d = built.diagram._id;
    add(d, "UMLClass", "K", { x: 0, y: 3000 });
    add(d, "UMLDependency", "dep", {
      x: 0,
      y: 0,
      tail: view(built.ids.U!.view),
      head: view(built.ids.Pay!.view),
    });
    const out = await text(d);
    expect(out.text).toContain("A0 ---|starts| U0");
    expect(out.text).toContain("U1 -->|generalization| U0");
    expect(out.text).not.toContain("subgraph");
    expect(out.warnings).toHaveLength(2);
  });

  it("reads activity lanes by position and skips what is not a flow", async () => {
    const built = await ok<Ids>(build, {
      kind: "activity",
      spec: {
        nodes: [
          { id: "s", type: "initial" },
          { id: "o", name: "Doc", type: "object" },
          { id: "f", type: "flowFinal" },
        ],
        flows: [
          { from: "s", to: "o", guard: "go" },
          { from: "o", to: "f" },
        ],
      },
    });
    const d = built.diagram._id;
    const k = add(d, "UMLClass", "K", { x: 0, y: 3000 });
    add(d, "UMLDependency", "dep", {
      x: 0,
      y: 0,
      tail: view(built.ids.o!.view),
      head: k,
    });
    const out = await text(d);
    expect(out.text).toContain('N1[/"Doc"/]');
    expect(out.text).toContain("N0 -->|go| N1");
    expect(out.warnings).toEqual([
      "1 UMLClass view is not written",
      "1 UMLDependency view is not written",
    ]);
  });

  it("reads other pseudostates as choices and infers the flow direction", async () => {
    const built = await ok<Ids>(build, {
      kind: "statemachine",
      spec: {
        states: [{ id: "a", name: "A" }, { id: "j", type: "join" }, "B"],
        transitions: [
          { from: "a", to: "j" },
          { from: "j", to: "B" },
        ],
      },
    });
    const d = built.diagram._id;
    model(built.ids.j!.view).kind = "junction";
    add(d, "UMLClass", "K", { x: 0, y: 3000 });
    const place = (key: string, left: number, top: number) =>
      Object.assign(view(built.ids[key]!.view), { left, top });
    place("a", 400, 0);
    place("j", 200, 0);
    place("B", 0, 0);
    expect((await text(d)).text).toContain(
      'direction RL\n  state "A" as N0\n  state N1 <<choice>>',
    );
    place("a", 0, 400);
    place("j", 0, 200);
    place("B", 0, 0);
    const up = await text(d, "plantuml");
    expect(up.text).not.toContain("direction");
    expect(up.warnings).toEqual(["1 UMLClass view is not written"]);
    expect((await text(d)).text).toMatch(/^stateDiagram-v2\n {2}state/);
    place("a", 0, 0);
    place("j", 300, 0);
    place("B", 600, 0);
    expect((await text(d)).text).toContain("direction LR");
  });

  it("reads ERD column lengths, names and non-identifying relationships", async () => {
    const built = await ok<Ids>(build, {
      kind: "erd",
      spec: {
        entities: [
          { name: "a", columns: ["id varchar(8) PK", "n int UK"] },
          { name: "b" },
        ],
        relationships: [
          { from: "a", to: "b", identifying: false, name: "has" },
          { from: "b", to: "a" },
        ],
      },
    });
    const d = built.diagram._id;
    const n = (model(built.ids.a!.view).columns as MockElement[])[1]!;
    n.length = "0";
    add(d, "UMLClass", "K", { x: 0, y: 3000 });
    add(d, "UMLDependency", "dep", {
      x: 0,
      y: 0,
      tail: view(built.ids.a!.view),
      head: view(built.ids.b!.view),
    });
    const out = await text(d);
    expect(out.text).toContain("    varchar(8) id PK\n    int n UK\n");
    expect(out.text).toContain('a ||..o{ b : "has"\n  b ||--o{ a : ""');
    expect(out.warnings).toHaveLength(2);
  });

  it("reads flowchart labels and skips views of other kinds", async () => {
    const built = await ok<Ids>(build, {
      kind: "flowchart",
      spec: { nodes: ["A", "B"], flows: [{ from: "A", to: "B", label: "x" }] },
    });
    const d = built.diagram._id;
    add(d, "UMLClass", "K", { x: 0, y: 3000 });
    add(d, "UMLClass", "L", { x: 0, y: 3100 });
    const out = await text(d);
    expect(out.text).toContain("N0 -->|x| N1");
    expect(out.warnings).toEqual(["2 UMLClass views are not written"]);
  });

  it("reads one parent per mind map node", async () => {
    const built = await ok<Ids>(build, {
      kind: "mindmap",
      spec: { root: { name: "R", children: [{ name: "A" }, { name: "B" }] } },
    });
    const d = built.diagram._id;
    add(d, "MMEdge", "", {
      x: 0,
      y: 0,
      tail: view(built.ids["R/A"]!.view),
      head: view(built.ids["R/B"]!.view),
    });
    add(d, "UMLDependency", "dep", {
      x: 0,
      y: 0,
      tail: view(built.ids["R/A"]!.view),
      head: view(built.ids.R!.view),
    });
    const out = await text(d);
    expect(out.text).toBe("mindmap\n  R\n    A\n    B\n");
    expect(out.warnings).toEqual([
      "1 MMEdge view is not written",
      "1 UMLDependency view is not written",
    ]);
  });

  it("refuses diagrams it has no text form for", async () => {
    const d = await ok<{ _id: string }>(
      endpoints.find((e) => e.path === "/create_diagram")!,
      { type: "UMLComponentDiagram", parentId: env.model._id },
    );
    await fails(
      exportText,
      { diagramId: d._id, format: "mermaid" },
      "INVALID_ARGUMENT",
      /^UMLComponentDiagram cannot be written as text; supported: class, /,
    );
    await fails(
      exportText,
      { diagramId: env.mainDiagram._id, format: "svg" },
      "INVALID_ARGUMENT",
    );
  });
});

describe("/export_text notes", () => {
  it("reports notes on kinds whose text has none", async () => {
    const built = await ok<Built>(build, {
      kind: "flowchart",
      spec: { nodes: ["a"], notes: [{ text: "n", on: "a" }] },
    });
    const out = await text(built.diagram._id);
    expect(out.warnings).toContain("1 UMLNote view is not written");
  });
});

describe("/export_text notes and operands as drawn", () => {
  const ownedViews = (id: string) =>
    env.app.repository.get(id)!.ownedViews as MockElement[];

  it("reads links drawn towards a note and notes on non-classes", async () => {
    const built = await ok<Built & { ids: Record<string, { view: string }> }>(
      build,
      {
        kind: "class",
        spec: {
          packages: ["p"],
          classes: [{ name: "A" }],
          notes: [{ text: "on p", on: "p" }, { text: "free" }],
        },
      },
    );
    const link = await ok<{ view: { _id: string } }>(
      endpoints.find((e) => e.path === "/create_edge_with_view")!,
      {
        type: "NoteLink",
        diagramId: built.diagram._id,
        tailViewId: built.ids.A!.view,
        headViewId: built.ids["note 1"]!.view,
      },
    );
    expect(link.view._id).toBeTruthy();
    const out = await text(built.diagram._id);
    expect(out.text).toContain('  note "on p"');
    expect(out.text).toContain('  note for A "free"');
  });

  it("writes else at each operand's first message", async () => {
    const source =
      "sequenceDiagram\n  participant A\n  participant B\n  alt a\n    A->>B: 1\n  else b\n    A->>B: 2\n  else c\n    A->>B: 3\n  end";
    const built = await ok<Built>(build, { mermaid: source });
    expect((await text(built.diagram._id)).text).toBe(`${source}\n`);
  });

  it("leaves operands undivided when one starts below every message", async () => {
    const built = await ok<Built & { ids: Record<string, { view: string }> }>(
      build,
      {
        mermaid:
          "sequenceDiagram\n  alt a\n  A->>B: 1\n  else b\n  A->>B: 2\n  end",
      },
    );
    const fragment = view(built.ids["fragment 0"]!.view);
    const first = (fragment.operandCompartment as MockElement)
      .subViews as MockElement[];
    first[0]!.height = 1000;
    const out = await text(built.diagram._id);
    expect(out.text).toContain("    A->>B: 2\n  else b\n  end");
  });

  it("writes a sequence note with no lifeline to stand by as a warning", async () => {
    const built = await ok<Built>(build, {
      kind: "sequence",
      spec: { participants: ["A"] },
    });
    const diagram = env.app.repository.get(built.diagram._id)!;
    diagram.ownedViews = ownedViews(built.diagram._id).filter((v) => !v.model);
    env.app.factory.createModelAndView({
      id: "Note",
      parent: diagram._parent as MockElement,
      diagram,
    } as never);
    const out = await text(built.diagram._id);
    expect(out.warnings).toContain("a note on no lifeline is not written");
  });
});

// Issue #16: what requirement and C4 diagrams leave out.
describe("/export_text requirement and C4 extraction", () => {
  it("skips other views and untraced dependencies, and defaults the requirement type", async () => {
    const built = await ok<
      Built & { ids: Record<string, { view: string; model: string }> }
    >(build, {
      kind: "requirement",
      spec: {
        requirements: [{ name: "R" }, { name: "Q" }],
        elements: [{ name: "E" }],
      },
    });
    const d = built.diagram._id;
    model(built.ids.R!.view).stereotype = "oddRequirement";
    add(d, "UMLInterface", "I", { x: 0, y: 0 });
    const r = view(built.ids.R!.view);
    const q = view(built.ids.Q!.view);
    add(d, "UMLDependency", "", { x: 0, y: 0, tail: r, head: q });
    const out = await text(d);
    expect(out.text).toContain("  requirement R {");
    expect(out.warnings).toEqual([
      "1 UMLInterface view is not written",
      "1 UMLDependency view is not written",
    ]);
  });

  it("skips views that are not C4 elements, and edges to them", async () => {
    const built = await ok<Built & { ids: Record<string, { view: string }> }>(
      build,
      {
        kind: "c4",
        spec: { elements: [{ name: "P", type: "person" }] },
      },
    );
    const d = built.diagram._id;
    const other = add(d, "C4Element", "X", { x: 0, y: 0 });
    const p = view(built.ids.P!.view);
    add(d, "C4Relationship", "r", { x: 0, y: 0, tail: p, head: other });
    add(d, "UMLDependency", "", { x: 0, y: 0, tail: p, head: p });
    const out = await text(d);
    expect(out.warnings).toEqual([
      "1 C4Element view is not written",
      "1 C4Relationship view is not written",
      "1 UMLDependency view is not written",
    ]);
  });
});
