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
        "UMLAssociation",
        { aggregation: "composite", multiplicity: "1" },
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
      "spec.classes.0.package: no package named p; declare it in spec.packages or set spec.autoCreatePackages",
    );
    const auto = planFor("class", {
      autoCreatePackages: true,
      classes: [
        { name: "A", package: "p" },
        { name: "B", package: "p" },
      ],
    });
    expect(auto.nodes.map((n) => [n.key, n.type, n.owner])).toEqual([
      ["p", "UMLPackage", undefined],
      ["A", "UMLClass", "p"],
      ["B", "UMLClass", "p"],
    ]);
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

// Issue #19: notes, colours, composite states and operand boundaries.
describe("notes and styles", () => {
  it("adds notes linked to the nodes they are on, and colours by node", () => {
    const plan = planFor("class", {
      classes: [{ name: "A" }, { name: "B" }],
      notes: [
        { text: "on A", on: "A" },
        { text: "two<br/>lines", on: ["A", "B"] },
        { text: "free" },
      ],
      styles: { A: { fillColor: "#F9f", lineColor: "#333333" } },
    });
    const notes = plan.nodes.filter((n) => n.type === "Note");
    expect(notes.map((n) => [n.key, n.text, n.height])).toEqual([
      ["note 0", "on A", 40],
      ["note 1", "two\nlines", 48],
      ["note 2", "free", 40],
    ]);
    expect(plan.edges).toEqual([
      { type: "NoteLink", from: "note 0", to: "A" },
      { type: "NoteLink", from: "note 1", to: "A" },
      { type: "NoteLink", from: "note 1", to: "B" },
    ]);
    expect(plan.nodes[0]!.style).toEqual({
      fillColor: "#ff99ff",
      lineColor: "#333333",
    });
  });

  it("keeps an interface's stereotype display beside its colours", () => {
    const plan = planFor("class", {
      classes: [{ name: "I", kind: "interface" }],
      styles: { I: { fontColor: "#000" } },
    });
    expect(plan.nodes[0]!.style).toEqual({
      stereotypeDisplay: "label",
      fontColor: "#000000",
    });
  });

  it("refuses notes and styles on unknown nodes, and a node named like a note", () => {
    expect(
      refused("flowchart", { nodes: ["a"], notes: [{ text: "x", on: "b" }] }),
    ).toBe("spec.notes.0.on: no node named b");
    expect(
      refused("flowchart", {
        nodes: ["a"],
        styles: { b: { fillColor: "#fff" } },
      }),
    ).toBe("spec.styles.b: no node named b");
    expect(
      refused("flowchart", { nodes: ["note 0"], notes: [{ text: "x" }] }),
    ).toBe("spec: note 0 is defined twice; give the node another name or id");
    expect(
      refused("flowchart", {
        nodes: ["a"],
        styles: { a: { fillColor: "red" } },
      }),
    ).toMatch(/^spec\.styles\.a\.fillColor/);
  });
});

describe("sequence notes and operands", () => {
  const messages = [
    { from: "A", to: "B" },
    { from: "B", to: "A" },
    { from: "A", to: "B" },
  ];

  it("draws notes at their place in time, beside or over lifelines", () => {
    const plan = planFor("sequence", {
      messages,
      notes: [
        { text: "first", on: "A", at: 0 },
        { text: "left", on: "B", side: "left", at: 1 },
        { text: "over one", on: "A", side: "over", at: 1 },
        { text: "both", on: ["A", "B"] },
        { text: "all", at: 99 },
      ],
    });
    const boxes = Object.fromEntries(
      plan.nodes.filter((n) => n.type === "Note").map((n) => [n.text, n.box]),
    );
    expect(boxes.first).toEqual({ x: 110, y: 85, width: 120, height: 40 });
    expect(boxes.left).toEqual({ x: 170, y: 185, width: 120, height: 40 });
    expect(boxes["over one"]).toEqual({
      x: 30,
      y: 235,
      width: 140,
      height: 40,
    });
    expect(boxes.both!.x).toBe(30);
    expect(boxes.both!.width).toBe(340);
    expect(boxes.all).toEqual({ ...boxes.both, y: boxes.all!.y });
    expect(boxes.all!.y).toBeGreaterThan(boxes.both!.y);
    // Notes are not linked on a sequence diagram.
    expect(plan.edges.every((e) => e.type !== "NoteLink")).toBe(true);
  });

  it("refuses a note on an unknown participant, or with no participant", () => {
    expect(
      refused("sequence", { messages, notes: [{ text: "x", on: "C" }] }),
    ).toBe("spec.notes.0.on: no participant named C");
    expect(refused("sequence", { notes: [{ text: "x" }] })).toBe(
      "spec.notes.0: a sequence note stands by a participant, and there is none",
    );
  });

  it("places operand boundaries above each operand's first message", () => {
    const plan = planFor("sequence", {
      messages,
      fragments: [
        {
          operator: "alt",
          guard: "a",
          operands: ["b", "c"],
          operandStarts: [1, 2],
          from: 0,
          to: 2,
        },
      ],
    });
    const fragment = plan.nodes.find((n) => n.type === "UMLCombinedFragment")!;
    const ys = plan.edges.map((e) => e.geometry!.y1);
    expect(fragment.operandAt).toEqual([ys[1]! - 35, ys[2]! - 35]);
    expect(ys[1]! - ys[0]!).toBe(80);
  });

  it("refuses operand starts that do not match the operands", () => {
    const fragment = { operator: "alt", operands: ["b"], from: 0, to: 2 };
    for (const operandStarts of [[0], [3], [1, 2], []]) {
      expect(
        refused("sequence", {
          messages,
          fragments: [{ ...fragment, operandStarts }],
        }),
      ).toBe(
        "spec.fragments.0.operandStarts: one increasing message index per operand, each within 1..2",
      );
    }
    expect(
      refused("sequence", {
        messages,
        fragments: [
          { ...fragment, operands: ["b", "c"], operandStarts: [2, 2] },
        ],
      }),
    ).toMatch(/^spec\.fragments\.0\.operandStarts/);
    expect(
      refused("sequence", {
        messages,
        fragments: [{ operator: "alt", operandStarts: [1], from: 0, to: 2 }],
      }),
    ).toMatch(/^spec\.fragments\.0\.operandStarts/);
  });
});

describe("composite states", () => {
  it("makes a parent a composite state holding its nested states", () => {
    const plan = planFor("statemachine", {
      states: [
        "Outer",
        { name: "Inner", parent: "Outer" },
        { id: "deep", name: "Deep", parent: "Inner" },
      ],
    });
    expect(plan.fixed).toBe(true);
    expect(plan.nodes.map((n) => [n.key, n.type, n.container])).toEqual([
      ["Outer", "UMLCompositeState", undefined],
      ["Inner", "UMLCompositeState", "Outer"],
      ["deep", "UMLState", "Inner"],
    ]);
    expect(planFor("statemachine", { states: ["A"] }).fixed).toBe(false);
  });

  it("refuses unknown parents, pseudostate parents and cycles", () => {
    expect(
      refused("statemachine", { states: [{ name: "A", parent: "B" }] }),
    ).toBe("spec.states.0.parent: no state named B");
    expect(
      refused("statemachine", {
        states: [
          { id: "i", type: "initial" },
          { name: "A", parent: "i" },
        ],
      }),
    ).toBe("spec.states.1.parent: no state named i");
    expect(
      refused("statemachine", {
        states: [
          { name: "A", parent: "B" },
          { name: "B", parent: "A" },
        ],
      }),
    ).toBe("spec.states.0.parent: A would be nested in itself");
  });
});

// Issue #16: requirement and C4 kinds.
describe("requirement and c4", () => {
  it("plans requirements, elements and relations as StarUML's importer builds them", () => {
    const plan = planFor("requirement", {
      requirements: [
        {
          name: "R",
          type: "functional",
          id: "1",
          text: "t",
          risk: "low",
          verifyMethod: "test",
        },
        { name: "Q" },
      ],
      elements: [{ name: "E", type: "sim", docRef: "d" }, { name: "F" }],
      relations: [
        { from: "E", to: "R", type: "satisfies" },
        { from: "R", to: "Q", type: "traces" },
        { from: "R", to: "Q", type: "contains" },
      ],
    });
    expect(
      plan.nodes.map((n) => [
        n.key,
        n.type,
        n.properties,
        n.attributes,
        n.height,
      ]),
    ).toEqual([
      [
        "R",
        "SysMLRequirement",
        {
          id: "1",
          text: "t",
          stereotype: "functionalRequirement",
          documentation: "Risk: low\nVerifyMethod: test",
        },
        undefined,
        100,
      ],
      ["Q", "SysMLRequirement", {}, undefined, 60],
      [
        "E",
        "UMLClass",
        { stereotype: "element" },
        [
          { name: "Type", defaultValue: "sim" },
          { name: "DocRef", defaultValue: "d" },
        ],
        78,
      ],
      ["F", "UMLClass", { stereotype: "element" }, undefined, 50],
    ]);
    expect(plan.edges).toEqual([
      { type: "SysMLSatisfy", from: "E", to: "R" },
      {
        type: "UMLDependency",
        from: "R",
        to: "Q",
        properties: { stereotype: "trace" },
      },
      { type: "UMLContainment", from: "Q", to: "R" },
    ]);
  });

  it("plans C4 elements by type, kind and externality", () => {
    const plan = planFor("c4", {
      elements: [
        { id: "p", name: "P", type: "person" },
        {
          name: "DB",
          type: "container",
          kind: "database",
          technology: "pg",
          description: "d",
        },
        { name: "S", type: "system", kind: "database", external: true },
      ],
      relations: [
        {
          from: "p",
          to: "DB",
          label: "uses",
          technology: "sql",
          description: "q",
        },
        { from: "DB", to: "S" },
      ],
    });
    expect(
      plan.nodes.map((n) => [n.key, n.type, n.properties, n.style, n.height]),
    ).toEqual([
      ["p", "C4Person", undefined, undefined, 140],
      [
        "DB",
        "C4Container",
        { kind: "database", technology: "pg", description: "d" },
        undefined,
        110,
      ],
      [
        "S",
        "C4SoftwareSystem",
        undefined,
        { fillColor: "#999999", lineColor: "#8a8a8a" },
        110,
      ],
    ]);
    expect(plan.edges).toEqual([
      {
        type: "C4Relationship",
        from: "p",
        to: "DB",
        name: "uses",
        properties: { technology: "sql", description: "q" },
      },
      { type: "C4Relationship", from: "DB", to: "S" },
    ]);
  });
});

describe("empty requirement and c4 specs", () => {
  it("plan nothing", () => {
    expect(planFor("requirement", {})).toMatchObject({ nodes: [], edges: [] });
    expect(planFor("c4", {})).toMatchObject({ nodes: [], edges: [] });
  });
});
