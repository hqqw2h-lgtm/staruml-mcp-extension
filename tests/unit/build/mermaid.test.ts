import { describe, expect, it } from "vitest";
import { parseMermaid, preprocess } from "../../../src/build/mermaid.js";
import { ApiError } from "../../../src/errors.js";

const refused = (source: string, as?: Parameters<typeof parseMermaid>[1]) => {
  try {
    parseMermaid(source, as);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).message;
  }
  throw new Error("expected a refusal");
};

describe("preprocess", () => {
  it("reads the title from front matter and drops comments and blank lines", () => {
    expect(
      preprocess(
        '---\nconfig: x\ntitle: "My diagram"\n---\n\n%% note\nclassDiagram %% tail\r\n  A',
      ),
    ).toEqual({
      title: "My diagram",
      lines: [
        { no: 7, text: "classDiagram", indent: 0 },
        { no: 8, text: "A", indent: 2 },
      ],
    });
    expect(preprocess("---\nx: 1\n---\ngraph")).toEqual({
      lines: [{ no: 4, text: "graph", indent: 0 }],
    });
  });

  it("refuses unclosed front matter, nothing and unknown diagrams", () => {
    expect(refused("---\ntitle: x\n")).toBe(
      "mermaid line 1: front matter is not closed with ---",
    );
    expect(refused("%% only")).toBe("mermaid line 1: no diagram");
    expect(refused("pie\n  a: 1")).toMatch(
      /^mermaid line 1: unsupported diagram "pie"/,
    );
    expect(refused("erDiagram", "class")).toBe(
      "mermaid line 1: erDiagram cannot be built as class",
    );
  });
});

describe("classDiagram", () => {
  it("reads classes, members, annotations and every arrow", () => {
    const parsed = parseMermaid(`classDiagram
  title Zoo
  direction LR
  class Animal~T~ {
    <<abstract>>
    +int age
    +isMammal() bool
  }
  class Duck["Duck label"]
  class Empty
  <<interface>> Swimmer
  class Color {
    <<enumeration>>
    RED
  }
  class Kind {
    <<enum>>
  }
  class Mark {
    <<service>>
  }
  Duck : +swim()
  Duck : +String beak
  Animal <|-- Duck
  Fish --|> Animal
  Swimmer <|.. Fish
  Duck ..|> Swimmer
  Pond *-- Duck
  Duck --* Pond
  Zoo o-- Pond
  Pond --o Zoo
  Zoo --> Keeper : has
  Keeper <-- Zoo
  Zoo ..> Food
  Food <.. Zoo
  Zoo "1" -- "*" Visitor
  A .. B
  note "hello"
  style A fill:#f9f
  }`);
    expect(parsed.title).toBe("Zoo");
    const spec = parsed.spec as {
      classes: {
        name: string;
        kind?: string;
        attributes?: string[];
        operations?: string[];
        literals?: string[];
      }[];
      relations: Record<string, unknown>[];
    };
    const byName = Object.fromEntries(spec.classes.map((c) => [c.name, c]));
    expect(byName.Animal).toEqual({
      name: "Animal",
      kind: "abstract",
      attributes: ["+int age"],
      operations: ["+isMammal() bool"],
    });
    // The label is the name, as Mermaid draws it.
    expect(byName["Duck label"]).toEqual({
      name: "Duck label",
      attributes: ["+String beak"],
      operations: ["+swim()"],
    });
    expect(byName.Swimmer!.kind).toBe("interface");
    expect(byName.Color).toEqual({
      name: "Color",
      kind: "enum",
      literals: ["RED"],
    });
    expect(byName.Kind!.kind).toBe("enum");
    expect(byName.Mark!.kind).toBeUndefined();
    expect(spec.relations.map((r) => `${r.from} ${r.type} ${r.to}`)).toEqual([
      "Duck label generalization Animal",
      "Fish generalization Animal",
      "Fish realization Swimmer",
      "Duck label realization Swimmer",
      "Duck label composition Pond",
      "Duck label composition Pond",
      "Pond aggregation Zoo",
      "Pond aggregation Zoo",
      "Zoo directed Keeper",
      "Zoo directed Keeper",
      "Zoo dependency Food",
      "Zoo dependency Food",
      "Zoo association Visitor",
      "A dependency B",
    ]);
    expect(spec.relations[8]).toMatchObject({ name: "has" });
    expect(spec.relations[12]).toMatchObject({
      fromMultiplicity: "1",
      toMultiplicity: "*",
    });
  });

  it("puts reversed cardinalities on the right ends", () => {
    const { spec } = parseMermaid('classDiagram\n  A "1" <|-- "2" B');
    expect((spec.relations as unknown[])[0]).toEqual({
      from: "B",
      to: "A",
      type: "generalization",
      fromMultiplicity: "2",
      toMultiplicity: "1",
    });
  });

  it("refuses what it cannot read", () => {
    expect(refused("classDiagram\n  A -> B")).toBe(
      'mermaid line 2: cannot read "A -> B"',
    );
  });
});

describe("sequenceDiagram", () => {
  it("reads participants, aliases, arrows and blocks", () => {
    const { spec, title } = parseMermaid(`---
title: Talk
---
sequenceDiagram
  autonumber
  participant A as Alice
  actor B
  create participant C as Carol
  create actor D
  A->>B: hi
  A-->>B: back
  A--xB
  A-xB: lost
  A--)B: a
  A-)B: b
  A-->B: c
  A->B: d
  activate B
  B ->> +C: call
  loop forever
    B->>A: tick
  end
  alt x
    A->>B: 1
  else y
    A->>B: 2
  else
    A->>B: 3
  end
  par
  and two
  end
  Note right of A: hi`);
    expect(title).toBe("Talk");
    const s = spec as {
      participants: unknown[];
      messages: { from: string; to: string; kind: string; text?: string }[];
      fragments: unknown[];
    };
    expect(s.participants).toEqual([
      { name: "Alice" },
      { name: "B", kind: "actor" },
      { name: "Carol" },
      { name: "D", kind: "actor" },
    ]);
    expect(s.messages.map((m) => m.kind)).toEqual([
      "sync",
      "reply",
      "async",
      "async",
      "async",
      "async",
      "reply",
      "sync",
      "sync",
      "sync",
      "sync",
      "sync",
      "sync",
    ]);
    expect(s.messages[0]).toEqual({
      from: "Alice",
      to: "B",
      kind: "sync",
      text: "hi",
    });
    expect(s.messages[2]!.text).toBeUndefined();
    expect(s.messages[8]).toMatchObject({ from: "B", to: "Carol" });
    expect(s.fragments).toEqual([
      { operator: "loop", guard: "forever", from: 9, to: 9 },
      {
        operator: "alt",
        guard: "x",
        operands: ["y", "else"],
        operandStarts: [11, 12],
        from: 10,
        to: 12,
      },
    ]);
  });

  it("refuses unbalanced blocks and unknown lines", () => {
    expect(refused("sequenceDiagram\n  else")).toBe(
      "mermaid line 2: else outside a block",
    );
    expect(refused("sequenceDiagram\n  end")).toBe(
      "mermaid line 2: end without a block",
    );
    expect(refused("sequenceDiagram\n  opt x\n  A->>B: m")).toBe(
      "mermaid line 2: opt is never closed with end",
    );
    expect(refused("sequenceDiagram\n  what is this")).toBe(
      'mermaid line 2: cannot read "what is this"',
    );
  });
});

describe("flowchart", () => {
  it("reads shapes, chains, labels and direction", () => {
    const { spec, direction, kind } = parseMermaid(`flowchart TD
  A([Start]) --> B[["Sub"]] --> C[(DB)]
  C -->|yes| D((Circle))
  D -- no --> E{{Prep}}
  E -.-> F[/In/]
  F ==> G[\\Out\\]
  G -. dotted .-> H(Round)
  H == thick ==> I{Choice}
  I --- J>Doc]
  J -.- K[Plain<br/>text]
  K --o L
  L --x M
  M <--> N
  B
  N[Renamed]
  classDef red fill:#f00
  class A red
  style B fill:#0f0
  click A call
  linkStyle 0 stroke:#f00
  direction LR`);
    expect(kind).toBe("flowchart");
    expect(direction).toBe("TB");
    const s = spec as {
      nodes: { id: string; name: string; shape: string }[];
      flows: { label?: string }[];
    };
    expect(s.nodes.map((n) => `${n.id}:${n.shape}:${n.name}`)).toEqual([
      "A:terminator:Start",
      "B:predefined:Sub",
      "C:database:DB",
      "D:connector:Circle",
      "E:preparation:Prep",
      "F:data:In",
      "G:data:Out",
      "H:alternate:Round",
      "I:decision:Choice",
      "J:document:Doc",
      "K:process:Plain\ntext",
      "L:process:L",
      "M:process:M",
      "N:process:Renamed",
    ]);
    expect(s.flows.map((f) => f.label)).toEqual([
      undefined,
      undefined,
      "yes",
      "no",
      undefined,
      undefined,
      "dotted",
      "thick",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(parseMermaid("graph\n  A").direction).toBeUndefined();
    expect(parseMermaid("graph RL\n  A").direction).toBe("RL");
  });

  it("keeps a shape it cannot close as part of nothing and refuses bad links", () => {
    expect(refused("flowchart\n  A[open --> B")).toMatch(
      /^mermaid line 2: expected a link/,
    );
    expect(refused("flowchart\n  --> B")).toMatch(
      /^mermaid line 2: expected a node/,
    );
    expect(refused("flowchart\n  A -->")).toMatch(
      /^mermaid line 2: expected a node/,
    );
    expect(refused("flowchart\n  end")).toBe(
      "mermaid line 2: end without a subgraph",
    );
    expect(refused("flowchart\n  subgraph x\n  A")).toBe(
      "mermaid line 3: subgraph is never closed with end",
    );
  });

  it("reads a flowchart as an activity", () => {
    const { kind, spec } = parseMermaid(
      `flowchart LR
  subgraph lane1 [First lane]
    S([start]) --> A[Act]
    A --> D{ok?}
  end
  subgraph Second
    D -->|yes| F{{fork}}
    D --> M{merge}
    A --> M
    F --> X[x]
    F --> Y[y]
    X --> J{{join}}
    Y --> J
    M --> E((end))
    J --> E
    E --> T([through])
    T --> Z([z])
  end
  O[outside]`,
      "activity",
    );
    expect(kind).toBe("activity");
    const s = spec as {
      lanes: string[];
      nodes: Record<string, unknown>[];
      flows: Record<string, unknown>[];
    };
    expect(s.lanes).toEqual(["First lane", "Second"]);
    expect(Object.fromEntries(s.nodes.map((n) => [n.id, n.type]))).toEqual({
      S: "initial",
      A: "action",
      D: "decision",
      F: "fork",
      M: "merge",
      X: "action",
      Y: "action",
      J: "join",
      E: "action",
      T: "action",
      Z: "final",
      O: "action",
    });
    expect(s.nodes.find((n) => n.id === "S")).toEqual({
      id: "S",
      type: "initial",
      lane: "First lane",
    });
    expect(s.nodes.find((n) => n.id === "O")).toEqual({
      id: "O",
      name: "outside",
      type: "action",
    });
    expect(s.flows[2]).toEqual({ from: "D", to: "F", guard: "yes" });
    expect(
      parseMermaid("flowchart\n  A --> B", "activity").spec,
    ).not.toHaveProperty("lanes");
  });

  it("reads a flowchart as a use case diagram", () => {
    const { spec } = parseMermaid(
      `flowchart LR
  U[User]
  subgraph Shop
    B((Browse))
    P(Pay)
    L([Login])
  end
  U --> B
  U -->|uses| P
  P -.->|«include»| L
  L -->|extend| P
  B -->|Generalization| P`,
      "usecase",
    );
    expect(spec).toEqual({
      system: "Shop",
      actors: ["User"],
      useCases: ["Browse", "Pay", "Login"],
      relations: [
        { from: "User", to: "Browse", type: "association" },
        { from: "User", to: "Pay", type: "association", name: "uses" },
        { from: "Pay", to: "Login", type: "include" },
        { from: "Login", to: "Pay", type: "extend" },
        { from: "Browse", to: "Pay", type: "generalization" },
      ],
    });
    expect(parseMermaid("graph\n  A", "usecase").spec).not.toHaveProperty(
      "system",
    );
  });
});

describe("erDiagram", () => {
  it("reads entities, attributes and every cardinality", () => {
    const { spec } = parseMermaid(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER |o..|| "LINE ITEM" : "has many"
  A }o--o| B
  C }|--|{ D
  LONELY
  direction TB
  CUSTOMER {
    string name PK "the name"
    int id PK, FK
    string email UK
    string note
  }`);
    const s = spec as {
      entities: { name: string; columns?: string[] }[];
      relationships: Record<string, unknown>[];
    };
    expect(s.entities.map((e) => e.name)).toEqual([
      "CUSTOMER",
      "ORDER",
      "LINE ITEM",
      "A",
      "B",
      "C",
      "D",
      "LONELY",
    ]);
    expect(s.entities[0]!.columns).toEqual([
      "name string PK",
      "id int PK FK",
      "email string UK",
      "note string",
    ]);
    expect(s.relationships).toEqual([
      {
        from: "CUSTOMER",
        to: "ORDER",
        fromCardinality: "1",
        toCardinality: "0..*",
        identifying: true,
        name: "places",
      },
      {
        from: "ORDER",
        to: "LINE ITEM",
        fromCardinality: "0..1",
        toCardinality: "1",
        identifying: false,
        name: "has many",
      },
      {
        from: "A",
        to: "B",
        fromCardinality: "0..*",
        toCardinality: "0..1",
        identifying: true,
      },
      {
        from: "C",
        to: "D",
        fromCardinality: "1..*",
        toCardinality: "1..*",
        identifying: true,
      },
    ]);
  });

  it("refuses what it cannot read", () => {
    expect(refused("erDiagram\n  A {\n    oops\n  }")).toBe(
      'mermaid line 3: cannot read attribute "oops"',
    );
    expect(refused("erDiagram\n  A -- B")).toBe(
      'mermaid line 2: cannot read "A -- B"',
    );
  });
});

describe("classDiagram namespaces", () => {
  it("files classes under a namespace's package, once per name", () => {
    const { spec } = parseMermaid(
      "classDiagram\n  namespace Shop {\n    class A\n  }\n  namespace Shop {\n    class B\n  }\n  class C\n  }",
    );
    expect(spec).toEqual({
      packages: ["Shop"],
      classes: [
        { name: "A", package: "Shop" },
        { name: "B", package: "Shop" },
        { name: "C" },
      ],
      relations: [],
    });
  });
});

describe("mindmap", () => {
  it("nests nodes by indentation and strips shapes and styling", () => {
    const parsed = parseMermaid(
      [
        "mindmap",
        "  root((Shop))",
        "    Catalog",
        "      ::icon(fa fa-book)",
        "      s[Search<br/>box]:::big",
        '      "Quoted"',
        "    Cart",
        "      c{{Check out}}",
        "    p)Pay(",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      kind: "mindmap",
      spec: {
        root: {
          name: "Shop",
          children: [
            {
              name: "Catalog",
              children: [{ name: "Search\nbox" }, { name: "Quoted" }],
            },
            { name: "Cart", children: [{ name: "Check out" }] },
            { name: "Pay" },
          ],
        },
      },
    });
  });

  it("refuses a second root and an empty map", () => {
    expect(refused("mindmap\n  A\n  B")).toBe(
      "mermaid line 3: a mindmap has one root; indent this line under it",
    );
    expect(refused("mindmap")).toBe("mermaid line 1: mindmap has no root");
  });
});

describe("stateDiagram", () => {
  it("reads states, pseudo states and labelled transitions", () => {
    const { spec, kind } = parseMermaid(`stateDiagram-v2
  direction LR
  [*] --> Still
  Still --> [*]
  Still --> Moving : push
  Moving --> Crash : hit [fast]
  Crash --> Moving : [again]
  state "Long<br/>name" as LN
  state check <<choice>>
  state Idle
  Lone
  Crash : Broken down
  Crash --> check
  check --> [*]
  note right of Crash : x
  --`);
    expect(kind).toBe("statemachine");
    const s = spec as {
      states: Record<string, unknown>[];
      transitions: Record<string, unknown>[];
    };
    expect(s.states).toEqual([
      { id: "[*] start 1", type: "initial" },
      { id: "Still", name: "Still" },
      { id: "[*] end 1", type: "final" },
      { id: "Moving", name: "Moving" },
      { id: "Crash", name: "Broken down" },
      { id: "LN", name: "Long\nname" },
      { id: "check", type: "choice" },
      { id: "Idle", name: "Idle" },
      { id: "Lone", name: "Lone" },
      { id: "[*] end 2", type: "final" },
    ]);
    expect(s.transitions).toEqual([
      { from: "[*] start 1", to: "Still" },
      { from: "Still", to: "[*] end 1" },
      { from: "Still", to: "Moving", trigger: "push" },
      { from: "Moving", to: "Crash", trigger: "hit", guard: "fast" },
      { from: "Crash", to: "Moving", guard: "again" },
      { from: "Crash", to: "check" },
      { from: "check", to: "[*] end 2" },
    ]);
  });

  it("refuses what it cannot read", () => {
    expect(refused("stateDiagram\n  A -> B")).toBe(
      'mermaid line 2: cannot read "A -> B"',
    );
  });
});

// Issue #19: notes, colours, composite states and operand boundaries.
describe("notes and colours", () => {
  const spec = (source: string, as?: Parameters<typeof parseMermaid>[1]) =>
    parseMermaid(source, as).spec as Record<string, unknown>;

  it("reads class notes and classDef, cssClass, ::: and style colours", () => {
    const s = spec(
      [
        "classDiagram",
        '  class A["Alpha"]:::hot',
        "  class B",
        "  class C",
        '  note for A "about A"',
        '  note "free"',
        '  note for D "makes D"',
        "  classDef hot fill:#f96,stroke:#333,stroke-width:4px",
        "  classDef cool color:#00f;",
        "  classDef bare fill",
        '  cssClass "B,C" cool',
        "  style C fill:red,stroke:#123456",
      ].join("\n"),
    );
    expect(s.notes).toEqual([
      { text: "about A", on: ["Alpha"] },
      { text: "free" },
      { text: "makes D", on: ["D"] },
    ]);
    expect(s.styles).toEqual({
      Alpha: { fillColor: "#f96", lineColor: "#333" },
      B: { fontColor: "#00f" },
      C: { fontColor: "#00f", lineColor: "#123456" },
    });
    expect(spec("classDiagram\n  class A").styles).toBeUndefined();
  });

  it("reads sequence notes beside, over and between lifelines", () => {
    const s = spec(
      [
        "sequenceDiagram",
        "  participant A as Alice",
        "  Note right of A: one",
        "  A->>B: hi",
        "  note LEFT OF B: two",
        "  Note over A,B: three",
        "  rect rgb(1, 2, 3)",
        "    box Aqua",
        "      B->>A: back",
        "    end",
        "  end",
      ].join("\n"),
    );
    expect(s.notes).toEqual([
      { text: "one", on: ["Alice"], side: "right", at: 0 },
      { text: "two", on: ["B"], side: "left", at: 1 },
      { text: "three", on: ["Alice", "B"], side: "over", at: 1 },
    ]);
    expect(s.fragments).toEqual([]);
    expect(refused("sequenceDiagram\n  rect rgb(0,0,0)")).toBe(
      "mermaid line 2: rect is never closed with end",
    );
  });

  it("gives operands their first message, unless one has none", () => {
    const fragments = (body: string) =>
      spec(`sequenceDiagram\n${body}`).fragments as Record<string, unknown>[];
    expect(
      fragments("  par a\n  A->>B: 1\n  and b\n  A->>B: 2\n  end")[0],
    ).toMatchObject({ operands: ["b"], operandStarts: [1] });
    expect(
      fragments("  alt a\n  A->>B: 1\n  else b\n  end")[0],
    ).not.toHaveProperty("operandStarts");
    expect(
      fragments("  alt a\n  else b\n  A->>B: 1\n  end")[0],
    ).not.toHaveProperty("operandStarts");
  });

  it("reads flowchart colours for every reading of a flowchart", () => {
    const source = [
      "flowchart TD",
      "  classDef default fill:#eee",
      "  classDef warn fill:#fcc,color:#300",
      "  A([Start]):::warn --> B{Check}",
      "  B --> C([End])",
      "  class C warn",
      "  style B stroke:#0f0",
      "  linkStyle 0 stroke:#f00",
    ].join("\n");
    expect(spec(source).styles).toEqual({
      A: { fillColor: "#fcc", fontColor: "#300" },
      B: { fillColor: "#eee", lineColor: "#0f0" },
      C: { fillColor: "#fcc", fontColor: "#300" },
    });
    expect(spec(source, "activity").styles).toEqual(spec(source).styles);
    expect(Object.keys(spec(source, "usecase").styles as object)).toEqual([
      "Start",
      "Check",
      "End",
    ]);
    expect(spec("flowchart\n  A --> B").styles).toBeUndefined();
    expect(spec("flowchart\n  A --> B", "activity").styles).toBeUndefined();
    expect(spec("flowchart\n  A --> B", "usecase").styles).toBeUndefined();
  });
});

describe("composite states", () => {
  const spec = (source: string) =>
    parseMermaid(`stateDiagram-v2\n${source}`).spec as {
      states: Record<string, unknown>[];
      transitions: unknown[];
      notes?: unknown[];
      styles?: unknown;
    };

  it("nests the states first named in a block, with the block's own [*]", () => {
    const s = spec(
      [
        "  [*] --> Idle",
        '  state "Working hard" as Busy',
        "  state Busy {",
        "    [*] --> Run",
        "    state Inner {",
        "      Deep",
        "    }",
        "    Idle --> Run",
        "  }",
        '  state "Other" as O {',
        "    X",
        "  }",
        "  Busy --> [*]",
      ].join("\n"),
    );
    expect(s.states).toEqual([
      { id: "[*] start 1", type: "initial" },
      { id: "Idle", name: "Idle" },
      { id: "Busy", name: "Working hard" },
      { id: "[*] start 2", type: "initial", parent: "Busy" },
      { id: "Run", name: "Run", parent: "Busy" },
      { id: "Inner", name: "Inner", parent: "Busy" },
      { id: "Deep", name: "Deep", parent: "Inner" },
      { id: "O", name: "Other" },
      { id: "X", name: "X", parent: "O" },
      { id: "[*] end 1", type: "final" },
    ]);
  });

  it("refuses unbalanced blocks and unclosed notes", () => {
    expect(refused("stateDiagram\n  }")).toBe(
      "mermaid line 2: } without a state block",
    );
    expect(refused("stateDiagram\n  state A {\n  B")).toBe(
      "mermaid line 3: state A is never closed with }",
    );
    expect(refused("stateDiagram\n  note left of A\n  text")).toBe(
      "mermaid line 2: note is never closed with end note",
    );
  });

  it("reads notes, ::: classes and descriptions apart", () => {
    const s = spec(
      [
        "  A:::hot --> B",
        "  C:::hot",
        "  B : Bee",
        "  note right of A : one",
        "  note left of B",
        "    two",
        "    lines",
        "  end note",
        "  classDef hot fill:#f00",
        "  class B hot",
      ].join("\n"),
    );
    expect(s.states).toEqual([
      { id: "A", name: "A" },
      { id: "B", name: "Bee" },
      { id: "C", name: "C" },
    ]);
    expect(s.notes).toEqual([
      { text: "one", on: ["A"] },
      { text: "two\nlines", on: ["B"] },
    ]);
    expect(s.styles).toEqual({
      A: { fillColor: "#f00" },
      B: { fillColor: "#f00" },
      C: { fillColor: "#f00" },
    });
  });
});
