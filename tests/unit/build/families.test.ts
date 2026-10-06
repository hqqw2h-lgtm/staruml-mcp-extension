import { beforeEach, describe, expect, it } from "vitest";
import {
  FAMILIES,
  FAMILY_KINDS,
  familyGrammar,
  parseSlot,
} from "../../../src/build/families.js";
import { place } from "../../../src/build/place.js";
import { FRAME } from "../../../src/build/plan.js";
import { DIAGRAM_TYPES, KINDS, planFor } from "../../../src/build/spec.js";
import { ApiError } from "../../../src/errors.js";
import { endpoints } from "../../../src/routes.js";
import { extractFamily } from "../../../src/text/families.js";
import type { Element } from "../../../src/types.js";
import {
  create,
  DIAGRAM_IDS,
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, fullResults, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const build = fullResults(ep("/build_diagram"));

beforeEach(() => {
  env = installMockApp();
});

const refused = (kind: Parameters<typeof planFor>[0], spec: unknown) => {
  try {
    planFor(kind, spec);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).message;
  }
  throw new Error("expected a refusal");
};

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string | null; view: string }>;
  edges: { key: string; model: string | null; view: string }[];
}

describe("diagram families (issue #25)", () => {
  it("gives every 7.1.1 diagram type a kind", () => {
    // Kubernetes is not among them: 7.1.1 ships no such extension.
    const kinds = new Set(Object.values(DIAGRAM_TYPES));
    expect(DIAGRAM_IDS.filter((d) => !kinds.has(d))).toEqual([]);
    expect(KINDS).toHaveLength(29);
    for (const k of FAMILY_KINDS) {
      expect(DIAGRAM_TYPES[k]).toBe(FAMILIES[k].diagram);
    }
  });

  it("documents each family's node and edge types", () => {
    const grammar = familyGrammar();
    expect(grammar).toContain(
      "dfd (Data flow (Gane–Sarson): external entities, processes, data stores and data flows): {nodes: [{name, id, type: external|process|store, in, stereotype, properties, width, height}], edges: [{from, to, type: flow, name}]}",
    );
    expect(grammar).toContain("ibd (");
    expect(grammar).toContain("{block, nodes:");
    expect(grammar).toContain("attributes, operations");
    expect(grammar).toContain("slots");
    const wireframe = grammar.slice(
      grammar.indexOf("wireframe ("),
      grammar.indexOf("aws ("),
    );
    expect(wireframe).not.toContain("edges:");
  });

  it("reads slots with and without a value", () => {
    expect(parseSlot(" total = 42 ")).toEqual({ name: "total", value: "42" });
    expect(parseSlot("flag")).toEqual({ name: "flag", value: "" });
  });

  it("refuses unkeyed nodes, nesting loops, unknown containers and edges where there are none", () => {
    expect(refused("dfd", { nodes: [{ type: "store" }] })).toBe(
      "spec.nodes.0: needs a name or an id",
    );
    expect(refused("dfd", { nodes: [{ name: "" }] })).toBe(
      "spec.nodes.0: needs a name or an id",
    );
    expect(
      refused("aws", {
        nodes: [
          { name: "A", type: "group", in: "B" },
          { name: "B", type: "group", in: "A" },
        ],
      }),
    ).toBe("spec.nodes.0.in: A would be inside itself");
    expect(refused("aws", { nodes: [{ name: "A", in: "Nowhere" }] })).toBe(
      "spec.nodes.0.in: no node named Nowhere",
    );
    expect(
      refused("wireframe", {
        nodes: ["A", "B"],
        edges: [{ from: "A", to: "B" }],
      }),
    ).toBe("spec.edges: a wireframe diagram has no edges; nest nodes with in");
    expect(refused("dfd", { nodes: [{ name: "A", type: "cloud" }] })).toMatch(
      /^spec\.nodes\.0/,
    );
  });

  it("nests by containment, on borders and inside hosts, and sizes symbols by their type", () => {
    const plan = planFor("composite", {
      nodes: [
        { name: "engine", type: "part", in: "Car" },
        { name: "Car", operations: ["start()"] },
        { name: "p", type: "port", in: "Car" },
        { name: "I", type: "interface" },
      ],
    });
    expect(plan.nodes.map((n) => [n.key, n.host, n.inside, n.owner])).toEqual([
      ["Car", undefined, undefined, undefined],
      ["engine", "Car", true, "Car"],
      ["p", "Car", undefined, "Car"],
      ["I", undefined, undefined, undefined],
    ]);
    expect(plan.nodes[0]!.viewProperties).toEqual({
      suppressAttributes: true,
      suppressOperations: true,
    });
    expect(plan.nodes[3]!.viewProperties).toBeUndefined();
    expect(plan.nodes[3]!.width).toBe(30);
    expect(plan.fixed).toBe(true);
    const boxes = place(plan, "TB");
    const car = boxes.get("Car")!;
    const engine = boxes.get("engine")!;
    expect(engine.x).toBeGreaterThan(car.x);
    expect(boxes.get("p")!.x).toBe(car.x + car.width - 10);
    const free = planFor("dfd", {
      nodes: [{ name: "A", width: 300, height: 90 }, "B"],
    });
    expect(free.fixed).toBe(false);
    expect(free.nodes[0]).toMatchObject({ width: 300, height: 90 });
  });

  it("makes the connector a message rides, and draws a message against it as a reverse one", () => {
    const plan = planFor("communication", {
      nodes: ["a", "b", "c"],
      edges: [
        { from: "a", to: "b", name: "m1" },
        { from: "b", to: "a", type: "message", name: "m2" },
        { from: "b", to: "c", type: "connector", name: "k" },
        { from: "c", to: "b", name: "m3" },
      ],
    });
    expect(plan.edges.map((e) => [e.type, e.from, e.to, e.along])).toEqual([
      ["UMLConnector", "b", "c", undefined],
      ["UMLConnector", "a", "b", undefined],
      ["UMLForwardMessage", "a", "b", 1],
      ["UMLReverseMessage", "b", "a", 1],
      ["UMLReverseMessage", "c", "b", 0],
    ]);
    expect(plan.framed).toBe(true);
  });

  it("draws a composition from its part to its whole", () => {
    const plan = planFor("bdd", {
      nodes: ["Car", "Engine"],
      edges: [
        { from: "Car", to: "Engine" },
        { from: "Car", to: "Engine", type: "dependency" },
      ],
    });
    expect(plan.edges.map((e) => [e.type, e.from, e.to])).toEqual([
      ["UMLComposition", "Engine", "Car"],
      ["UMLDependency", "Car", "Engine"],
    ]);
  });

  it("lays a timing diagram's segments along their lifeline", () => {
    const plan = planFor("timing", {
      nodes: [
        "l",
        { id: "s", name: "idle", type: "state", in: "l" },
        { id: "t", name: "busy", type: "state", in: "l" },
        { id: "a", type: "segment", in: "s", width: 100 },
        { id: "b", type: "segment", in: "t" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const box = (k: string) => plan.nodes.find((n) => n.key === k)!.box!;
    expect(box("l")).toEqual({ x: 40, y: 80, width: 640, height: 80 });
    expect(box("t").y).toBe(box("s").y + 30);
    expect(box("a")).toEqual({ x: 160, y: 90, width: 100, height: 20 });
    expect(box("b").x).toBe(260);
    const boxes = place(plan, "TB");
    expect(boxes.get(FRAME)!.width).toBeGreaterThan(640);
  });

  it("frames an empty diagram with room to drop into", () => {
    const plan = planFor("ibd", { block: "B", nodes: [] });
    expect(plan.owner).toEqual({ type: "SysMLBlock", name: "B" });
    expect(place(plan, "TB").get(FRAME)).toEqual({
      x: 20,
      y: 20,
      width: 400,
      height: 240,
    });
    expect(planFor("parametric", {}).owner).toEqual({ type: "SysMLBlock" });
  });

  it("puts a port with no node to sit on on the frame, ranking nothing by its edges", () => {
    const plan = planFor("ibd", {
      block: "B",
      nodes: ["engine", { name: "fuel", type: "port" }],
      edges: [{ from: "fuel", to: "engine" }],
    });
    expect(plan.nodes[1]).toMatchObject({ host: FRAME });
    const boxes = place(plan, "TB");
    const frame = boxes.get(FRAME)!;
    expect(boxes.get("fuel")!.x).toBe(frame.x + frame.width - 10);
    expect(boxes.get("engine")!.y).toBeGreaterThan(frame.y);
  });

  it("stacks what a wireframe frame holds", () => {
    const boxes = place(
      planFor("wireframe", {
        nodes: [
          { name: "F", type: "frame" },
          { name: "a", type: "input", in: "F" },
          { name: "b", type: "button", in: "F" },
        ],
      }),
      "TB",
    );
    const mid = (k: string) => boxes.get(k)!.x + boxes.get(k)!.width / 2;
    expect(mid("a")).toBe(mid("b"));
    expect(boxes.get("b")!.y).toBeGreaterThan(boxes.get("a")!.y);
  });

  it("lays BPMN lanes in their pools and flow nodes in their lanes, left to right", () => {
    const plan = planFor("bpmn", {
      nodes: [
        { name: "P", type: "pool" },
        { name: "L1", type: "lane", in: "P" },
        { name: "L2", type: "lane", in: "P" },
        { name: "s", type: "start", in: "L1" },
        { name: "a", in: "P" },
        { name: "b", in: "L2" },
        { name: "c", in: "L2" },
        { name: "Q", type: "pool" },
        { name: "q", in: "Q" },
        { name: "free", type: "end" },
      ],
      edges: [
        { from: "s", to: "a" },
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "c", to: "q", type: "message" },
        { from: "q", to: "free" },
      ],
    });
    const boxes = place(plan, "TB");
    const b = (k: string) => boxes.get(k)!;
    expect(b("L1").y).toBe(b("P").y);
    expect(b("L2").y).toBe(b("L1").y + b("L1").height);
    expect(b("P").height).toBe(b("L1").height + b("L2").height);
    // a is in P, so in its first lane, a column right of s.
    expect(b("a").x).toBeGreaterThan(b("s").x);
    expect(b("a").y).toBeGreaterThanOrEqual(b("L1").y);
    expect(b("a").y + b("a").height).toBeLessThanOrEqual(
      b("L1").y + b("L1").height,
    );
    // b and c share a column and a lane, one under the other.
    expect(b("b").x).toBe(b("c").x);
    expect(b("c").y).toBeGreaterThan(b("b").y);
    expect(b("L2").height).toBe(180);
    expect(b("Q").y).toBeGreaterThan(b("P").y + b("P").height);
    expect(b("free").y).toBeGreaterThan(b("Q").y + b("Q").height);
  });
});

describe("/build_diagram family kinds", () => {
  it("files an internal block diagram under the block it names, made or found", async () => {
    const first = await ok<Built>(build, {
      kind: "ibd",
      name: "Inside",
      spec: { block: "Car", nodes: ["engine"] },
    });
    const diagram = env.app.repository.get(first.diagram._id)!;
    const block = diagram._parent as MockElement;
    expect(block.constructor.name).toBe("SysMLBlock");
    expect(block.name).toBe("Car");
    const again = await ok<Built>(build, {
      kind: "parametric",
      name: "Laws",
      reuse: false,
      spec: { block: "Car", nodes: ["law"] },
    });
    expect(env.app.repository.get(again.diagram._id)!._parent).toBe(block);
    // A block passed as parent is the block, whatever spec.block says.
    const under = await ok<Built>(build, {
      kind: "ibd",
      name: "Under",
      parent: block._id,
      spec: { nodes: ["x"] },
    });
    expect(env.app.repository.get(under.diagram._id)!._parent).toBe(block);
    await fails(
      build,
      { kind: "ibd", spec: { nodes: ["x"] } },
      "INVALID_ARGUMENT",
      "spec.block: a ibd diagram shows the inside of a SysMLBlock; name it in spec.block, or pass one as parent",
    );
  });

  it("adds to an existing diagram's frame on upsert, and refuses one that lost it", async () => {
    const body = {
      kind: "timing",
      name: "T",
      upsert: true,
      spec: { nodes: ["l1"] },
    };
    const first = await ok<Built>(build, body);
    const second = await ok<Built>(build, {
      ...body,
      spec: { nodes: ["l1", "l2"] },
    });
    expect(second.diagram._id).toBe(first.diagram._id);
    const diagram = env.app.repository.get(first.diagram._id)!;
    const views = diagram.ownedViews as MockElement[];
    expect(
      views.filter((v) => v.constructor.name === "UMLTimingLifelineView"),
    ).toHaveLength(2);
    views.splice(0, 1);
    await fails(
      build,
      { ...body, spec: { nodes: ["l1", "l2", "l3"] } },
      "STARUML_ERROR",
      /has lost its frame; nodes that sit in it cannot be added$/,
    );
  });

  it("shows a reused element of a shared family again", async () => {
    await ok<Built>(build, {
      kind: "dfd",
      name: "One",
      spec: { nodes: ["Customer"] },
    });
    const two = await ok<Built & { shown?: number }>(build, {
      kind: "dfd",
      name: "Two",
      spec: { nodes: ["Customer"] },
    });
    expect(two.shown).toBe(1);
  });
});

describe("/export_text spec of families", () => {
  const diagramOf = (type: string) => {
    const d = create(type);
    d.name = "D";
    d._parent = env.model;
    (env.model.ownedElements as MockElement[]).push(d);
    env.app.repository.index(d);
    return d;
  };
  const view = (
    d: MockElement,
    id: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) =>
    env.app.factory.createModelAndView({
      id,
      parent: env.model,
      diagram: d,
      x1: 0,
      y1: 0,
      x2: 50,
      y2: 50,
      modelInitializer: (m: MockElement) => {
        m.name = name;
      },
      ...extra,
    })!;

  it("names repeated and unnamed nodes, keeps plain properties and skips what it cannot write", () => {
    const d = diagramOf("AWSDiagram");
    const a = view(d, "AWSService", "web");
    a.model!.icon = "Amazon-EC2.svg";
    a.model!.stereotype = create("UMLStereotype");
    (a.model!.stereotype as MockElement).name = "tier";
    view(d, "AWSService", "web").model!.stereotype = "edge";
    view(d, "AWSCallout", "");
    view(d, "UMLClass", "Stray");
    view(d, "UMLClass", "Stray too");
    const out = extractFamily(d as unknown as Element, "aws");
    expect(out.spec.nodes).toEqual([
      {
        name: "web",
        type: "service",
        stereotype: "tier",
        properties: { icon: "Amazon-EC2.svg" },
      },
      { name: "web", id: "web#2", type: "service", stereotype: "edge" },
      { name: "", id: "callout", type: "callout" },
    ]);
    expect(out.warnings).toEqual(["2 UMLClass views are not written"]);
  });

  it("tells links and associations apart by their ends, and skips edges to nodes it left out", () => {
    const d = diagramOf("UMLObjectDiagram");
    const a = view(d, "UMLObject", "a");
    const b = view(d, "UMLObject", "b");
    const c = view(d, "UMLClass", "C");
    const ends = {
      tailView: a,
      headView: b,
      tailModel: a.model,
      headModel: b.model,
    };
    view(d, "UMLLink", "plain", ends);
    const directed = view(d, "UMLLink", "", ends);
    (directed.model!.end2 as MockElement).navigable = "navigable";
    const odd = view(d, "UMLLink", "", ends);
    (odd.model!.end2 as MockElement).aggregation = "shared";
    view(d, "UMLDependency", "", {
      tailView: a,
      headView: c,
      tailModel: a.model,
      headModel: c.model,
    });
    const nodes = extractFamily(d as unknown as Element, "object");
    expect(nodes.spec.edges).toEqual([
      { from: "a", to: "b", type: "link", name: "plain" },
      { from: "a", to: "b", type: "directedLink" },
      { from: "a", to: "b", type: "link" },
      { from: "a", to: "C", type: "dependency" },
    ]);
    const bdd = diagramOf("SysMLBlockDefinitionDiagram");
    const x = view(bdd, "SysMLBlock", "X");
    const y = view(bdd, "SysMLBlock", "Y");
    const e = {
      tailView: x,
      headView: y,
      tailModel: x.model,
      headModel: y.model,
    };
    const shared = view(bdd, "UMLAssociation", "", e);
    (shared.model!.end2 as MockElement).aggregation = "shared";
    view(bdd, "UMLAssociation", "", e);
    const directed2 = view(bdd, "UMLAssociation", "", e);
    (directed2.model!.end2 as MockElement).navigable = "navigable";
    view(bdd, "UMLAssociation", "", {
      ...e,
      headView: view(bdd, "UMLClass", "Out"),
    });
    const blocks = extractFamily(bdd as unknown as Element, "bdd");
    expect(blocks.spec.edges).toEqual([
      { from: "Y", to: "X", type: "aggregation" },
      { from: "X", to: "Y", type: "association" },
      { from: "X", to: "Y", type: "directed" },
    ]);
    expect(blocks.warnings).toEqual([
      "1 UMLClass view is not written",
      "1 UMLAssociation view is not written",
    ]);
  });

  it("writes messages by their lifelines, a named connector too, and skips a message to a lifeline it left out", async () => {
    const built = await ok<Built>(build, {
      kind: "communication",
      name: "C",
      spec: {
        nodes: ["a", "b"],
        edges: [
          { from: "a", to: "b", type: "connector", name: "wire" },
          { from: "a", to: "b", name: "m" },
          { from: "b", to: "a" },
        ],
      },
    });
    const d = env.app.repository.get(built.diagram._id)!;
    const out = extractFamily(d as unknown as Element, "communication");
    expect(out.spec.edges).toEqual([
      { from: "a", to: "b", type: "connector", name: "wire" },
      { from: "a", to: "b", type: "message", name: "m" },
      { from: "b", to: "a", type: "message" },
    ]);
    const message = (d.ownedViews as MockElement[]).find(
      (v) => v.constructor.name === "UMLCommMessageView",
    )!;
    (message.model as MockElement).target = create("UMLLifeline");
    expect(
      extractFamily(d as unknown as Element, "communication").warnings,
    ).toEqual(["1 UMLMessage view is not written"]);
  });
});

describe("/create_element_with_view with custom factory functions", () => {
  it("names what a custom function makes, refuses a name for what makes no model, and sets again what a registered initializer overwrote", async () => {
    const d = await ok<{ _id: string }>(ep("/create_diagram"), {
      type: "UMLTimingDiagram",
      parent: env.model._id,
      fields: ["_id"],
    });
    const frame = (
      env.app.repository.get(d._id)!.ownedViews as MockElement[]
    )[0]!;
    const lifeline = await ok<{ view: { _id: string } }>(
      ep("/create_element_with_view"),
      { type: "UMLLifeline", diagram: d._id, container: frame._id, name: "l" },
    );
    const state = await ok<{ model: { name: string } }>(
      ep("/create_element_with_view"),
      {
        type: "UMLTimingState",
        diagram: d._id,
        container: lifeline.view._id,
        name: "idle",
      },
    );
    expect(state.model.name).toBe("idle");
    const before = (env.app.repository.get(d._id)!.ownedViews as unknown[])
      .length;
    // timeTickFn makes a view only (uml-factory.js), never calling the
    // model initializer.
    const factory = env.app.factory.createModelAndView.bind(env.app.factory);
    env.app.factory.createModelAndView = (options) => {
      if (options.id !== "UMLTimeTick") return factory(options);
      const tick = create("UMLTimeTickView");
      (options.diagram.ownedViews as MockElement[]).push(tick);
      tick._parent = options.diagram;
      env.app.repository.index(tick);
      return tick as never;
    };
    await fails(
      ep("/create_element_with_view"),
      { type: "UMLTimeTick", diagram: d._id, container: frame._id, name: "x" },
      "INVALID_ARGUMENT",
      "UMLTimeTick creates only a view; name and properties do not apply",
    );
    expect(
      (env.app.repository.get(d._id)!.ownedViews as unknown[]).length,
    ).toBe(before);
    const profile = await ok<{ _id: string }>(ep("/create_diagram"), {
      type: "UMLProfileDiagram",
      parent: env.model._id,
    });
    env.app.factory.modelAndViewOptions.UMLMetaClass = {
      modelType: "UMLMetaClass",
    };
    env.app.factory.createModelAndView = (options) =>
      factory({
        ...options,
        modelInitializer: (m) => {
          options.modelInitializer?.(m);
          (m as MockElement).name = "UMLClass";
        },
      });
    const meta = await ok<{ model: { _id: string; name: string } }>(
      ep("/create_element_with_view"),
      { type: "UMLMetaClass", diagram: profile._id, name: "Class" },
    );
    expect(meta.model.name).toBe("Class");
  });
});
