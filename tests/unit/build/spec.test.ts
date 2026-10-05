import { describe, expect, it } from "vitest";
import { parseColumn, planFor } from "../../../src/build/spec.js";
import { ApiError } from "../../../src/errors.js";

const refused = (kind: Parameters<typeof planFor>[0], spec: unknown) => {
  try {
    planFor(kind, spec);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).message;
  }
  throw new Error("expected a refusal");
};

describe("spec validation", () => {
  it("reports the first issue under spec.", () => {
    expect(refused("class", { classes: [{}] })).toMatch(
      /^spec\.classes\.0\.name: .* \(for kind class\)$/,
    );
  });

  it("refuses duplicate names and edges to unknown nodes", () => {
    expect(refused("flowchart", { nodes: ["a", "a"] })).toBe(
      "spec: a is defined twice; give one of them another name or id",
    );
    expect(
      refused("flowchart", { nodes: ["a"], flows: [{ from: "a", to: "b" }] }),
    ).toBe("spec.flows.0: no node named b");
  });
});

describe("class", () => {
  it("maps kinds, members, packages and relation ends", () => {
    const plan = planFor("class", {
      packages: ["core", { name: "api", stereotype: "boundary" }],
      classes: [
        {
          name: "A",
          kind: "abstract",
          package: "core",
          stereotype: "entity",
          documentation: "doc",
          attributes: [{ name: "x", type: "int" }],
          operations: [{ name: "f" }],
        },
        { name: "I", kind: "interface" },
        { name: "E", kind: "enum", literals: ["ONE"] },
        { name: "C" },
      ],
      relations: [
        { from: "C", to: "A" },
        {
          from: "C",
          to: "A",
          type: "composition",
          fromMultiplicity: "1",
          toMultiplicity: "*",
        },
        {
          from: "C",
          to: "A",
          type: "generalization",
          name: "is",
          fromMultiplicity: "1",
        },
        { from: "C", to: "I", type: "realization" },
        { from: "C", to: "E", type: "dependency", toMultiplicity: "1" },
      ],
    });
    expect(plan.nodes.map((n) => n.type)).toEqual([
      "UMLPackage",
      "UMLPackage",
      "UMLClass",
      "UMLInterface",
      "UMLEnumeration",
      "UMLClass",
    ]);
    expect(plan.nodes[1]!.properties).toEqual({ stereotype: "boundary" });
    expect(plan.nodes[2]).toMatchObject({
      owner: "core",
      properties: {
        isAbstract: true,
        stereotype: "entity",
        documentation: "doc",
      },
      attributes: [{ name: "x", type: "int" }],
      operations: [{ name: "f" }],
    });
    expect(plan.nodes[3]!.style).toEqual({ stereotypeDisplay: "label" });
    expect(plan.nodes[5]!.properties).toBeUndefined();
    expect(
      plan.edges.map((e) => [e.type, e.tailEnd, e.headEnd, e.name]),
    ).toEqual([
      ["UMLAssociation", undefined, undefined, undefined],
      [
        "UMLComposition",
        { multiplicity: "1" },
        { multiplicity: "*" },
        undefined,
      ],
      ["UMLGeneralization", undefined, undefined, "is"],
      ["UMLInterfaceRealization", undefined, undefined, undefined],
      ["UMLDependency", undefined, undefined, undefined],
    ]);
  });

  it("refuses a class in an unknown package", () => {
    expect(refused("class", { classes: [{ name: "A", package: "p" }] })).toBe(
      "spec.classes.0.package: no package named p",
    );
  });

  it("accepts an empty spec", () => {
    expect(planFor("class", {})).toEqual({
      kind: "class",
      nodes: [],
      edges: [],
      fixed: false,
    });
  });
});

describe("sequence", () => {
  it("adds participants named only in messages and places messages in time", () => {
    const plan = planFor("sequence", {
      participants: [{ name: "User", kind: "actor" }],
      messages: [
        { from: "User", to: "Shop", text: "a<br/>b" },
        { from: "Shop", to: "Shop", kind: "async" },
        { from: "Shop", to: "Shop" },
        { from: "Shop", to: "User", kind: "reply" },
        { from: "Shop", to: "Shop", kind: "sync" },
      ],
    });
    expect(plan.fixed).toBe(true);
    expect(plan.nodes.map((n) => n.key)).toEqual(["User", "Shop"]);
    expect(plan.edges.map((e) => e.type)).toEqual([
      "UMLMessage",
      "UMLSelfMessage",
      "UMLSelfMessage",
      "UMLReplyMessage",
      "UMLSelfMessage",
    ]);
    expect(plan.edges[0]!.name).toBe("a\nb");
    expect(plan.edges[1]!.properties).toEqual({ messageSort: "asynchCall" });
    expect(plan.edges[2]!.properties).toBeUndefined();
    expect(plan.edges[4]!.properties).toBeUndefined();
    expect(plan.edges[1]!.geometry!.x2).toBe(plan.edges[1]!.geometry!.x1 + 40);
    expect(planFor("sequence", {})).toMatchObject({ nodes: [], edges: [] });
  });

  it("nests fragments and spaces messages around them", () => {
    const plan = planFor("sequence", {
      participants: ["A", "B"],
      messages: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ],
      fragments: [
        { operator: "alt", guard: "x", operands: ["else"], from: 0, to: 1 },
        { operator: "opt", from: 0, to: 0 },
        { operator: "loop", from: 0, to: 1 },
      ],
    });
    const [alt, opt, loop] = plan.nodes.slice(2);
    expect(alt).toMatchObject({ guard: "x", operands: ["else"], name: "" });
    expect(opt!.box!.x).toBeGreaterThan(alt!.box!.x);
    expect(loop!.box!.x).toBeGreaterThan(alt!.box!.x);
    expect(opt!.box!.y).toBeGreaterThan(loop!.box!.y);
    expect(alt!.box!.y + alt!.box!.height).toBeGreaterThan(
      loop!.box!.y + loop!.box!.height,
    );
  });

  it("refuses fragments outside the messages", () => {
    const spec = { messages: [{ from: "A", to: "B" }] };
    expect(
      refused("sequence", {
        ...spec,
        fragments: [{ operator: "opt", from: 0, to: 1 }],
      }),
    ).toMatch(/^spec\.fragments\.0: from and to must be message indices/);
    expect(
      refused("sequence", {
        ...spec,
        fragments: [{ operator: "opt", from: 1, to: 0 }],
      }),
    ).toMatch(/^spec\.fragments\.0/);
  });
});

describe("usecase", () => {
  it("is fixed only with a system", () => {
    const free = planFor("usecase", {
      actors: ["A"],
      useCases: ["U"],
      relations: [
        { from: "A", to: "U" },
        { from: "U", to: "U", type: "extend", name: "x" },
      ],
    });
    expect(free.fixed).toBe(false);
    expect(free.edges.map((e) => e.type)).toEqual([
      "UMLAssociation",
      "UMLExtend",
    ]);
    expect(planFor("usecase", { system: "S" }).fixed).toBe(true);
    expect(planFor("usecase", {}).nodes).toEqual([]);
  });
});

describe("activity", () => {
  it("maps node types, names and guards", () => {
    const plan = planFor("activity", {
      nodes: [
        "Do",
        { id: "s", type: "initial" },
        { id: "o", type: "object" },
        { name: "Named", type: "flowFinal" },
        { id: "m", type: "merge", name: "m<br/>x" },
      ],
      flows: [
        { from: "s", to: "Do", guard: "g", name: "n" },
        { from: "Do", to: "o" },
      ],
    });
    expect(plan.fixed).toBe(false);
    expect(plan.nodes.map((n) => [n.key, n.type, n.name])).toEqual([
      ["Do", "UMLAction", "Do"],
      ["s", "UMLInitialNode", ""],
      ["o", "UMLObjectNode", "o"],
      ["Named", "UMLFlowFinalNode", "Named"],
      ["m", "UMLMergeNode", "m\nx"],
    ]);
    expect(plan.edges[0]).toMatchObject({
      name: "n",
      properties: { guard: "g" },
    });
    expect(plan.edges[1]!.properties).toBeUndefined();
    expect(planFor("activity", {}).nodes).toEqual([]);
  });

  it("refuses unknown lanes and nameless nodes", () => {
    expect(refused("activity", { nodes: [{ name: "a", lane: "x" }] })).toBe(
      "spec.nodes.0.lane: no lane named x",
    );
    expect(refused("activity", { nodes: [{ type: "initial" }] })).toBe(
      "spec.nodes.0: needs a name or an id",
    );
  });
});

describe("statemachine", () => {
  it("labels transitions with trigger and effect", () => {
    const plan = planFor("statemachine", {
      states: [
        "A",
        { id: "i", type: "initial" },
        { id: "b" },
        { name: "C", type: "fork" },
      ],
      transitions: [
        { from: "i", to: "A" },
        { from: "A", to: "b", trigger: "go", guard: "ok", effect: "log" },
        { from: "b", to: "A", effect: "e" },
      ],
    });
    expect(plan.nodes.map((n) => n.name)).toEqual(["A", "", "b", "C"]);
    expect(plan.edges.map((e) => [e.name, e.properties])).toEqual([
      [undefined, undefined],
      ["go / log", { guard: "ok" }],
      ["/ e", undefined],
    ]);
    expect(planFor("statemachine", {}).nodes).toEqual([]);
    expect(refused("statemachine", { states: [{ type: "final" }] })).toBe(
      "spec.states.0: needs a name or an id",
    );
  });
});

describe("erd", () => {
  it.each([
    ["id", { name: "id" }],
    ["id int PK", { name: "id", type: "int", primaryKey: true }],
    [
      "name varchar(40) NOT NULL UNIQUE",
      { name: "name", type: "varchar", length: "40", unique: true },
    ],
    [
      "ref int FK NULL",
      { name: "ref", type: "int", foreignKey: true, nullable: true },
    ],
    [
      "code char(2) UK",
      { name: "code", type: "char", length: "2", unique: true },
    ],
  ])("reads the column %s", (source, expected) => {
    expect(parseColumn(source)).toEqual(expected);
  });

  it("maps entities and cardinalities", () => {
    const plan = planFor("erd", {
      entities: [
        { name: "a", columns: ["id int PK", { name: "x", type: "int" }] },
        { name: "b" },
      ],
      relationships: [
        { from: "a", to: "b" },
        {
          from: "a",
          to: "b",
          name: "r",
          fromCardinality: "0..1",
          toCardinality: "1..*",
          identifying: true,
        },
      ],
    });
    expect(plan.nodes[0]!.columns).toHaveLength(2);
    expect(plan.nodes[1]!.columns).toBeUndefined();
    expect(plan.edges.map((e) => [e.tailEnd, e.headEnd, e.properties])).toEqual(
      [
        [{ cardinality: "1" }, { cardinality: "0..*" }, undefined],
        [
          { cardinality: "0..1" },
          { cardinality: "1..*" },
          { identifying: true },
        ],
      ],
    );
    expect(planFor("erd", {}).nodes).toEqual([]);
  });
});

describe("flowchart and mindmap", () => {
  it("maps shapes and sizes", () => {
    const plan = planFor("flowchart", {
      nodes: [
        "a",
        { id: "c", shape: "connector" },
        { name: "d", shape: "decision" },
      ],
      flows: [
        { from: "a", to: "c", label: "x" },
        { from: "c", to: "d" },
      ],
    });
    expect(plan.nodes.map((n) => [n.type, n.name, n.width, n.height])).toEqual([
      ["FCProcess", "a", 140, 50],
      ["FCConnector", "c", 40, 40],
      ["FCDecision", "d", 140, 70],
    ]);
    expect(plan.edges.map((e) => e.name)).toEqual(["x", undefined]);
    expect(planFor("flowchart", {}).nodes).toEqual([]);
    expect(refused("flowchart", { nodes: [{ shape: "data" }] })).toBe(
      "spec.nodes.0: needs a name or an id",
    );
  });

  it("keys mind map nodes by path", () => {
    const plan = planFor("mindmap", {
      root: {
        name: "R",
        children: [{ name: "A", children: [{ name: "B" }] }, { name: "B" }],
      },
    });
    expect(plan.nodes.map((n) => n.key)).toEqual(["R", "R/A", "R/A/B", "R/B"]);
    expect(plan.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      "R>R/A",
      "R/A>R/A/B",
      "R>R/B",
    ]);
  });
});
