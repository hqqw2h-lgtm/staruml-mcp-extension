import { describe, expect, it } from "vitest";
import { parseMermaid } from "../../../src/build/mermaid.js";
import { toMermaid } from "../../../src/text/mermaid-writer.js";
import type { Extracted } from "../../../src/text/model.js";
import { toPlantUml } from "../../../src/text/plantuml-writer.js";

const both = (x: Extracted) => ({
  mermaid: toMermaid(x),
  plantuml: toPlantUml(x),
});

const cls = (
  name: string,
  more: Partial<{
    kind: "class" | "interface" | "enum" | "abstract";
    package: string;
    attributes: string[];
    operations: string[];
    literals: string[];
  }> = {},
) => ({
  name,
  kind: "class" as const,
  attributes: [],
  operations: [],
  literals: [],
  ...more,
});

describe("class writers", () => {
  const x: Extracted = {
    kind: "class",
    spec: {
      packages: ["Shop core"],
      classes: [
        cls("Order", { package: "Shop core", attributes: ["+id: long"] }),
        cls("Line item", { kind: "abstract" }),
        cls("Kind", { kind: "enum", literals: ["NEW"] }),
        cls("Pay", { kind: "interface" }),
        cls("Base"),
      ],
      relations: [
        {
          from: "Line item",
          to: "Order",
          type: "composition",
          fromMultiplicity: "*",
          toMultiplicity: "1",
        },
        { from: "Line item", to: "Order", type: "aggregation" },
        {
          from: "Order",
          to: "Kind",
          type: "directed",
          fromMultiplicity: "1",
          name: "has\nkind",
        },
        { from: "Order", to: "Pay", type: "realization" },
        { from: "Order", to: "Base", type: "generalization" },
        { from: "Order", to: "Base", type: "dependency" },
        {
          from: "Order",
          to: "Base",
          type: "association",
          toMultiplicity: "0..1",
        },
      ],
    },
  };

  it("writes Mermaid that build_diagram reads back", () => {
    const { text, warnings } = toMermaid(x);
    expect(warnings).toEqual([]);
    expect(text).toBe(
      [
        "classDiagram",
        "  namespace Shop_core {",
        "    class Order {",
        "      +id: long",
        "    }",
        "  }",
        '  class C0["Line item"] {',
        "    <<abstract>>",
        "  }",
        "  class Kind {",
        "    <<enumeration>>",
        "    NEW",
        "  }",
        "  class Pay {",
        "    <<interface>>",
        "  }",
        "  class Base",
        '  Order "1" *-- "*" C0',
        "  Order o-- C0",
        '  Order "1" --> Kind : has<br/>kind',
        "  Pay <|.. Order",
        "  Base <|-- Order",
        "  Order ..> Base",
        '  Order -- "0..1" Base',
        "",
      ].join("\n"),
    );
    const { spec } = parseMermaid(text);
    expect(spec).toMatchObject({
      packages: ["Shop_core"],
      classes: expect.arrayContaining([
        expect.objectContaining({ name: "Line item", kind: "abstract" }),
        expect.objectContaining({ name: "Order", package: "Shop_core" }),
      ]),
    });
    expect((spec.relations as unknown[])[0]).toEqual({
      from: "Line item",
      to: "Order",
      type: "composition",
      fromMultiplicity: "*",
      toMultiplicity: "1",
    });
  });

  it("writes PlantUML with aliases", () => {
    const { text } = toPlantUml(x);
    expect(text.split("\n")).toEqual([
      "@startuml",
      'package "Shop core" {',
      '  class "Order" as C0 {',
      "    +id: long",
      "  }",
      "}",
      'abstract class "Line item" as C1',
      'enum "Kind" as C2 {',
      "  NEW",
      "}",
      'interface "Pay" as C3',
      'class "Base" as C4',
      'C0 "1" *-- "*" C1',
      "C0 o-- C1",
      'C0 "1" --> C2 : has kind',
      "C3 <|.. C0",
      "C4 <|-- C0",
      "C0 ..> C4",
      'C0 -- "0..1" C4',
      "@enduml",
      "",
    ]);
  });
});

describe("sequence writers", () => {
  const x: Extracted = {
    kind: "sequence",
    spec: {
      participants: ["Alice", "Bob the builder"],
      messages: [
        { from: "Alice", to: "Bob the builder", text: "hi", kind: "sync" },
        { from: "Bob the builder", to: "Alice", text: "", kind: "async" },
        { from: "Alice", to: "Bob the builder", text: "new", kind: "create" },
        { from: "Alice", to: "Bob the builder", text: "bye", kind: "delete" },
        { from: "Bob the builder", to: "Alice", text: "ok", kind: "reply" },
      ],
      fragments: [
        { operator: "par", guard: "a", operands: ["b"], from: 0, to: 1 },
        { operator: "seq", operands: [""], from: 2, to: 2 },
        { operator: "critical", operands: [], from: 3, to: 4 },
      ],
    },
  };

  it("writes Mermaid blocks and reports operators Mermaid lacks", () => {
    const { text, warnings } = toMermaid(x);
    expect(warnings).toEqual(["a seq fragment has no Mermaid block"]);
    expect(text.split("\n")).toEqual([
      "sequenceDiagram",
      "  participant Alice",
      "  participant P0 as Bob the builder",
      "  par a",
      "    Alice->>P0: hi",
      "    P0-)Alice: ",
      "  and b",
      "  end",
      "  Alice->>P0: new",
      "  critical",
      "    Alice-xP0: bye",
      "    P0-->>Alice: ok",
      "  end",
      "",
    ]);
    expect(parseMermaid(text).spec).toMatchObject({
      participants: [{ name: "Alice" }, { name: "Bob the builder" }],
      fragments: [
        { operator: "par", guard: "a", operands: ["b"], from: 0, to: 1 },
        { operator: "critical", from: 3, to: 4 },
      ],
    });
  });

  it("writes PlantUML groups, create and destroy", () => {
    expect(toPlantUml(x).text.split("\n")).toEqual([
      "@startuml",
      'participant "Alice" as P0',
      'participant "Bob the builder" as P1',
      "par a",
      "P0 -> P1 : hi",
      "P1 ->> P0",
      "else b",
      "end",
      "group seq",
      "create P1",
      "P0 -> P1 : new",
      "else",
      "end",
      "critical",
      "P0 -> P1 : bye",
      "destroy P1",
      "P1 --> P0 : ok",
      "end",
      "@enduml",
      "",
    ]);
  });
});

describe("use case writers", () => {
  const x = (system: string | undefined, inSystem: boolean): Extracted => ({
    kind: "usecase",
    direction: "TD",
    spec: {
      ...(system !== undefined && { system }),
      actors: ["User"],
      useCases: [
        { name: "Buy", inSystem },
        { name: "Pay", inSystem: false },
      ],
      relations: [
        { from: "User", to: "Buy", type: "association", name: "uses" },
        { from: "User", to: "Pay", type: "association" },
        { from: "Buy", to: "Pay", type: "extend" },
        { from: "Pay", to: "Buy", type: "generalization" },
      ],
    },
  });

  it("puts use cases inside the system only when the boundary holds them", () => {
    const inner = both(x("Shop", true));
    expect(inner.mermaid.text).toContain(
      '  subgraph S["Shop"]\n    U0(["Buy"])\n  end\n  U1(["Pay"])',
    );
    expect(inner.mermaid.text).toContain("A0 ---|uses| U0");
    expect(inner.mermaid.text).toContain("A0 --- U1");
    expect(inner.mermaid.text).toContain("U0 -->|extend| U1");
    expect(inner.plantuml.text).toContain(
      'rectangle "Shop" {\n  usecase "Buy" as U0\n}',
    );
    expect(inner.plantuml.text).toContain("A0 --> U0 : uses");
    expect(inner.plantuml.text).toContain("U0 ..> U1 : <<extend>>");
    expect(inner.plantuml.text).toContain("U0 <|-- U1");
    const outside = both(x("Shop", false));
    expect(outside.mermaid.text).not.toContain("subgraph");
    expect(outside.plantuml.text).not.toContain("rectangle");
    expect(both(x(undefined, false)).mermaid.text).not.toContain("subgraph");
  });
});

describe("activity and flowchart writers", () => {
  const activity: Extracted = {
    kind: "activity",
    direction: "RL",
    spec: {
      lanes: [],
      nodes: [
        { id: "N0", name: "", type: "initial" },
        { id: "N1", name: "", type: "decision" },
        { id: "N2", name: "keep", type: "object" },
        { id: "N3", name: "", type: "flowFinal" },
        { id: "N4", name: "", type: "join" },
        { id: "N5", name: "", type: "merge" },
        { id: "N6", name: "alone", type: "action" },
      ],
      flows: [
        { from: "N0", to: "N1" },
        { from: "N1", to: "N2", guard: "g" },
        { from: "N2", to: "N4" },
        { from: "N4", to: "N5" },
        { from: "N5", to: "N3" },
        { from: "N5", to: "N2" },
      ],
    },
  };

  it("writes every activity node type", () => {
    const { mermaid, plantuml } = both(activity);
    expect(mermaid.text.split("\n").slice(0, 8)).toEqual([
      "flowchart RL",
      '  N0(["start"])',
      '  N1{" "}',
      '  N2[/"keep"/]',
      '  N3(["end"])',
      '  N4{{"join"}}',
      '  N5{" "}',
      '  N6["alone"]',
    ]);
    expect(plantuml.warnings).toEqual(["1 node without flows is not written"]);
    expect(plantuml.text.split("\n")).toEqual([
      "@startuml",
      "left to right direction",
      '(*) --> "N1" as N1',
      'N1 --> [g] "keep" as N2',
      "N2 --> ===N4===",
      '===N4=== --> "N5" as N5',
      "N5 --> (*)",
      "N5 --> N2",
      "@enduml",
      "",
    ]);
  });

  it("writes flowchart shapes, and a process for those Mermaid lacks", () => {
    const x: Extracted = {
      kind: "flowchart",
      direction: "BT",
      spec: {
        nodes: [
          { id: "N0", name: "wait", type: "delay" },
          { id: "N1", name: "", type: "document" },
          { id: "N2", name: "a", type: "process" },
          { id: "N3", name: "b", type: "process" },
          { id: "N4", name: "c", type: "process" },
        ],
        flows: [
          { from: "N0", to: "N1", label: "x" },
          { from: "N2", to: "N3" },
          { from: "N3", to: "N4" },
        ],
      },
    };
    const { mermaid, plantuml } = both(x);
    expect(mermaid.warnings).toEqual(["N0 (delay) is written as a process"]);
    expect(mermaid.text).toContain('N0["wait"]\n  N1>" "]');
    expect(mermaid.text).toContain("N0 -->|x| N1");
    expect(plantuml.warnings).toEqual([]);
    expect(plantuml.text).toContain('"wait" as N0 --> [x] "N1" as N1');
  });

  it("reports isolated nodes in the plural", () => {
    const x: Extracted = {
      kind: "flowchart",
      direction: "TD",
      spec: {
        nodes: [
          { id: "N0", name: "a", type: "process" },
          { id: "N1", name: "b", type: "process" },
        ],
        flows: [],
      },
    };
    expect(toPlantUml(x).warnings).toEqual([
      "2 nodes without flows are not written",
    ]);
  });
});

describe("state machine writers", () => {
  it("writes pseudostates, labels and a sideways direction", () => {
    const x: Extracted = {
      kind: "statemachine",
      direction: "LR",
      spec: {
        states: [
          { id: "N0", name: "", type: "initial" },
          { id: "N1", name: "", type: "state" },
          { id: "N2", name: "", type: "fork" },
          { id: "N3", name: "", type: "final" },
        ],
        transitions: [
          { from: "N0", to: "N1" },
          { from: "N1", to: "N2", guard: "g" },
          { from: "N2", to: "N3", trigger: "t" },
        ],
      },
    };
    const { mermaid, plantuml } = both(x);
    expect(mermaid.text.split("\n")).toEqual([
      "stateDiagram-v2",
      "  direction LR",
      '  state "N1" as N1',
      "  state N2 <<fork>>",
      "  [*] --> N1",
      "  N1 --> N2 : [g]",
      "  N2 --> [*] : t",
      "",
    ]);
    expect(plantuml.text).toContain(
      'left to right direction\nstate "N1" as N1',
    );
    const down = toMermaid({ ...x, direction: "BT" } as Extracted).text;
    expect(down).not.toContain("direction");
  });
});

describe("ERD writers", () => {
  it("writes columns, keys and cardinalities", () => {
    const x: Extracted = {
      kind: "erd",
      spec: {
        entities: [
          {
            name: "line item",
            columns: [
              {
                name: "id",
                type: "int",
                primaryKey: true,
                foreignKey: false,
                unique: false,
              },
              {
                name: "code",
                type: "",
                primaryKey: false,
                foreignKey: true,
                unique: true,
              },
            ],
          },
          {
            name: "keys",
            columns: [
              {
                name: "k",
                type: "int",
                primaryKey: true,
                foreignKey: false,
                unique: false,
              },
            ],
          },
          { name: "plain", columns: [] },
        ],
        relationships: [
          {
            from: "line item",
            to: "plain",
            fromCardinality: "0..1",
            toCardinality: "1..*",
            identifying: false,
            name: "has",
          },
          {
            from: "plain",
            to: "keys",
            fromCardinality: "many",
            toCardinality: "?",
            identifying: true,
          },
        ],
      },
    };
    const { mermaid, plantuml } = both(x);
    expect(mermaid.text.split("\n")).toEqual([
      "erDiagram",
      '  "line item" {',
      "    int id PK",
      "    string code FK, UK",
      "  }",
      "  keys {",
      "    int k PK",
      "  }",
      "  plain",
      '  "line item" |o..|{ plain : "has"',
      '  plain ||--|| keys : ""',
      "",
    ]);
    expect(plantuml.text.split("\n")).toEqual([
      "@startuml",
      'entity "line item" as E0 {',
      "  *id : int <<PK>>",
      "  --",
      "  code <<FK>> <<UK>>",
      "}",
      'entity "keys" as E1 {',
      "  *k : int <<PK>>",
      "}",
      'entity "plain" as E2 {',
      "}",
      "E0 |o..|{ E2 : has",
      "E2 ||--|| E1",
      "@enduml",
      "",
    ]);
  });
});

describe("mindmap writers", () => {
  it("writes the first tree, quoting names that look like shapes", () => {
    const x: Extracted = {
      kind: "mindmap",
      spec: {
        roots: [
          {
            name: "Root",
            children: [
              { name: "f(x)", children: [] },
              { name: "", children: [] },
            ],
          },
          { name: "Other", children: [] },
        ],
      },
    };
    const { mermaid, plantuml } = both(x);
    expect(mermaid.warnings).toEqual(["1 more root nodes are not written"]);
    expect(mermaid.text).toBe('mindmap\n  Root\n    n["f(x)"]\n    [" "]\n');
    expect(plantuml.text).toBe(
      "@startmindmap\n* Root\n** f(x)\n** \n* Other\n@endmindmap\n",
    );
    expect(toMermaid({ kind: "mindmap", spec: { roots: [] } }).text).toBe(
      "mindmap\n",
    );
  });
});

describe("PlantUML aliases", () => {
  it("gives a repeated name one alias", () => {
    const x: Extracted = {
      kind: "class",
      spec: {
        packages: [],
        classes: [cls("A"), cls("A")],
        relations: [{ from: "A", to: "A", type: "association" }],
      },
    };
    expect(toPlantUml(x).text).toBe(
      '@startuml\nclass "A" as C0\nclass "A" as C0\nC0 -- C0\n@enduml\n',
    );
  });
});
