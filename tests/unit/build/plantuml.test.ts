import { describe, expect, it } from "vitest";
import { parsePlantUml, preprocess } from "../../../src/build/plantuml.js";
import { ApiError } from "../../../src/errors.js";

// Issue #16: the PlantUML front end of /build_diagram.
const puml = (body: string, start = "uml") =>
  `@start${start}\n${body}\n@end${start}`;

const refused = (source: string, as?: Parameters<typeof parsePlantUml>[1]) => {
  try {
    parsePlantUml(source, as);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return `${(err as ApiError).code} ${(err as ApiError).message}`;
  }
  throw new Error("expected a refusal");
};

const spec = (body: string, as?: Parameters<typeof parsePlantUml>[1]) =>
  parsePlantUml(puml(body), as).spec as Record<string, unknown>;

describe("preprocess", () => {
  it("drops comments, styling and blocks, and keeps title and direction", () => {
    const src = preprocess(
      [
        "' a comment",
        "@startuml",
        "/' block",
        "comment '/",
        "/' inline '/ class A",
        "title My <br> title",
        "skinparam monochrome true",
        "skinparam class {",
        "  BackgroundColor red",
        "}",
        "<style>",
        "x",
        "</style>",
        "legend right",
        "  text",
        "endlegend",
        "header",
        "  text",
        "end header",
        "left to right direction",
        "!include <C4/C4_Context>",
        "hide empty members",
        "",
        "class B",
        "@enduml",
        "class C",
      ].join("\n"),
    );
    expect(src).toEqual({
      type: "uml",
      no: 2,
      lines: [
        { no: 5, text: "class A" },
        { no: 24, text: "class B" },
      ],
      title: "My \n title",
      direction: "LR",
      includes: ["<C4/C4_Context>"],
    });
    expect(
      preprocess("@startuml\ntop to bottom direction\nA -> B").direction,
    ).toBe("TB");
  });

  it("refuses text without @start and diagrams without statements", () => {
    expect(refused("class A")).toBe(
      "INVALID_ARGUMENT plantuml line 1: no @startuml line",
    );
    expect(refused("@startuml\n@enduml")).toBe(
      "INVALID_ARGUMENT plantuml line 1: no diagram",
    );
    expect(refused("@startgantt\n[Task] lasts 5 days\n@endgantt")).toMatch(
      /^UNSUPPORTED_SYNTAX plantuml line 1: @startgantt diagrams are not built/,
    );
  });
});

describe("kinds", () => {
  it("tells kinds apart, and takes a kind where the text does not tell", () => {
    const kind = (body: string, as?: Parameters<typeof parsePlantUml>[1]) =>
      parsePlantUml(puml(body), as).kind;
    expect(kind("state A")).toBe("statemachine");
    expect(kind("entity E {\n  *id : int <<PK>>\n}")).toBe("erd");
    expect(kind("entity A\nentity B\nA ||--o{ B")).toBe("erd");
    expect(kind("(*) --> A")).toBe("activity");
    expect(kind("start\n:a;")).toBe("activity");
    expect(kind("actor U\nU --> (Use)")).toBe("usecase");
    expect(kind("class A")).toBe("class");
    expect(kind("A <|-- B")).toBe("class");
    expect(kind("A -> B : hi")).toBe("sequence");
    expect(kind("participant A")).toBe("sequence");
    expect(kind('Person(a, "A")')).toBe("c4");
    expect(kind("A --> B", "activity")).toBe("activity");
    expect(refused(puml("A"))).toBe(
      "INVALID_ARGUMENT plantuml line 1: cannot tell which kind of diagram this is; pass kind",
    );
    expect(refused(puml("component C\nC --> D"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: D is not declared",
    );
    expect(refused(puml("object o\no --> p"))).toMatch(
      /^UNSUPPORTED_SYNTAX plantuml line 2: object diagrams are not built/,
    );
    expect(refused(puml("A -> B"), "flowchart")).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 1: PlantUML is not read as flowchart",
    );
  });
});

describe("class", () => {
  it("reads declarations, members, packages, relations and notes", () => {
    const s = spec(
      [
        'package "Shop" <<Folder>> {',
        '  abstract class "Long Item" as Item <<entity>> #ffcc00 {',
        "    -id : long",
        "    ==",
        "    {static} +count : int",
        "    {abstract} +price() : double",
        "    {field} +flag",
        "    {method} +run()",
        "  }",
        "  namespace inner {",
        "    class Deep",
        "  }",
        "}",
        "interface Lendable",
        "enum Color {",
        "  RED,",
        "  GREEN;",
        "}",
        "class Book<T> extends Item implements Lendable, Sized",
        "struct S",
        'exception E as "Err"',
        "abstract Base",
        "class A as B",
        "Book : +isbn : String",
        'Book "1" *-- "many" Color : has >',
        "Color --o Item",
        "Book -up-> Base",
        "Base -[#red]-> Book : < uses",
        "S ..> E",
        "S .. Book",
        "Book -- S",
        "E <.. S",
        'note "free" as N1',
        "N1 .. Book",
        "Book .. N1",
        "note as N2",
        "  two",
        "end note",
        "note left of Book : about Book",
        "note right : about the last",
        "note on link",
        "  ignored",
        "end note",
      ].join("\n"),
    ) as { classes: { name: string }[]; [k: string]: unknown };
    expect(s.packages).toEqual(["Shop", "inner"]);
    expect(s.classes[0]).toEqual({
      name: "Long Item",
      kind: "abstract",
      stereotype: "entity",
      package: "Shop",
      attributes: ["-id : long", "+count : int$", "+flag"],
      operations: ["+price() : double*", "+run()"],
    });
    expect(s.classes.map((c) => c.name)).toEqual([
      "Long Item",
      "Deep",
      "Lendable",
      "Color",
      "Book",
      "Sized",
      "S",
      "Err",
      "Base",
      "A",
    ]);
    expect(s.classes[3]).toMatchObject({
      kind: "enum",
      literals: ["RED", "GREEN"],
    });
    expect(s.relations).toEqual([
      { from: "Book", to: "Long Item", type: "generalization" },
      { from: "Book", to: "Lendable", type: "realization" },
      { from: "Book", to: "Sized", type: "realization" },
      {
        from: "Book",
        to: "Color",
        type: "composition",
        name: "has",
        fromMultiplicity: "1",
        toMultiplicity: "many",
      },
      { from: "Long Item", to: "Color", type: "aggregation" },
      { from: "Book", to: "Base", type: "directed" },
      { from: "Base", to: "Book", type: "directed", name: "uses" },
      { from: "S", to: "Err", type: "dependency" },
      { from: "S", to: "Book", type: "dependency" },
      { from: "Book", to: "S", type: "association" },
      { from: "S", to: "Err", type: "dependency" },
    ]);
    expect(s.notes).toEqual([
      { text: "free", on: ["Book", "Book"] },
      { text: "two" },
      { text: "about Book", on: ["Book"] },
      { text: "about the last", on: ["A"] },
    ]);
    expect(s.styles).toEqual({ "Long Item": { fillColor: "#ffcc00" } });
    expect(
      parsePlantUml(
        puml("package a {\n  package b {\n  }\n}\nclass X"),
        "class",
      ).warnings,
    ).toEqual(["package b is nested in a; StarUML gets it at the top level"]);
  });

  it("refuses other classifiers, unknown arrows and lines", () => {
    expect(refused(puml("class A\nannotation N"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: annotation is not part of a class diagram build_diagram reads",
    );
    expect(refused(puml("class A\nA +-- B"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: the +-- arrow has no StarUML relation",
    );
    expect(refused(puml("class A\nwhat is this"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "what is this"',
    );
    expect(refused(puml("class A\nnote top of A"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: note is never closed with end note",
    );
    expect(refused(puml("class A\nnote across : x"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "note across : x"',
    );
    expect(spec("note top : alone\nclass A").notes).toEqual([
      { text: "alone" },
    ]);
  });
});

describe("sequence", () => {
  it("reads participants, messages, groups and notes", () => {
    const s = spec(
      [
        'participant "Web App" as W #red',
        "actor User order 10",
        'participant S as "Server"',
        "database DB",
        "User -> W : open",
        "W ->> S : fetch",
        "S --> W : data",
        "W <- S : push",
        "W <<- S",
        "S -\\\\ DB",
        "S -[#blue]> DB : q",
        "S ->x DB : drop",
        "W -> S !! : kill",
        "group strict ordered",
        "  W -> S",
        "end",
        "group my label",
        "  W -> S",
        "end",
        "par2 x",
        "  W -> S",
        "else y",
        "  S -> W",
        "end",
        "alt empty",
        "end",
        "create actor N",
        "S -> N : new",
        "create Z",
        "S -> Z : make",
        "S -> Z : bye",
        "destroy Z",
        "destroy nobody",
        "activate S",
        "...",
        "== part ==",
        "|||",
        "note over W, S : both",
        "note left : last",
        "rnote right of DB",
        "  multi",
        "end note",
        "note across : skipped",
      ].join("\n"),
    ) as Record<string, Record<string, unknown>[]>;
    expect(s.participants).toEqual([
      { name: "Web App" },
      { name: "User", kind: "actor" },
      { name: "Server" },
      { name: "DB" },
      { name: "N", kind: "actor" },
      { name: "Z" },
    ]);
    expect(s.messages!.map((m) => [m.from, m.to, m.kind, m.text])).toEqual([
      ["User", "Web App", "sync", "open"],
      ["Web App", "Server", "async", "fetch"],
      ["Server", "Web App", "reply", "data"],
      ["Server", "Web App", "sync", "push"],
      ["Server", "Web App", "async", undefined],
      ["Server", "DB", "async", undefined],
      ["Server", "DB", "sync", "q"],
      ["Server", "DB", "delete", "drop"],
      ["Web App", "Server", "delete", "kill"],
      ["Web App", "Server", "sync", undefined],
      ["Web App", "Server", "sync", undefined],
      ["Web App", "Server", "sync", undefined],
      ["Server", "Web App", "sync", undefined],
      ["Server", "N", "create", "new"],
      ["Server", "Z", "create", "make"],
      ["Server", "Z", "delete", "bye"],
    ]);
    expect(s.fragments).toEqual([
      { operator: "strict", guard: "ordered", from: 9, to: 9 },
      { operator: "seq", guard: "my label", from: 10, to: 10 },
      {
        operator: "par",
        guard: "x",
        operands: ["y"],
        operandStarts: [12],
        from: 11,
        to: 12,
      },
    ]);
    expect(s.notes).toEqual([
      { text: "both", on: ["Web App", "Server"], side: "over", at: 16 },
      { text: "last", on: ["Server"], side: "left", at: 16 },
      { text: "multi", on: ["DB"], side: "right", at: 16 },
    ]);
    expect(spec("A -> B\nalt a\nelse b\nA -> B\nend").fragments).toEqual([
      { operator: "alt", guard: "a", operands: ["b"], from: 1, to: 1 },
    ]);
    expect(spec("note left : first\nA -> B").notes).toEqual([
      { text: "first", on: [], side: "left", at: 0 },
    ]);
  });

  it("refuses found, lost, ref and return, and unbalanced groups", () => {
    expect(refused(puml("[-> A : in"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 2: found and lost messages have no StarUML sequence element build_diagram makes",
    );
    expect(refused(puml("A ->] : out"))).toMatch(
      /^UNSUPPORTED_SYNTAX plantuml line 2: found and lost/,
    );
    expect(refused(puml("A -> B\nref over A : x"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: ref has no StarUML sequence element build_diagram makes",
    );
    expect(refused(puml("A -> B\nelse"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: else outside a group",
    );
    expect(refused(puml("A -> B\nend"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: end without a group",
    );
    expect(refused(puml("A -> B\nloop x"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: loop is never closed with end",
    );
    expect(refused(puml("A -> B\nnote below : x"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "note below : x"',
    );
    expect(refused(puml("participant A\nA -> B\n???"))).toBe(
      'INVALID_ARGUMENT plantuml line 4: cannot read "???"',
    );
  });
});

describe("use case", () => {
  it("reads actors, use cases, the boundary, relations and notes", () => {
    const s = spec(
      [
        "actor Customer",
        'actor "Shop Admin" as Admin #eeeeee',
        ":Guest: as G",
        ":Visitor:",
        "actor/ Clerk",
        'usecase "Browse" as UC1',
        "usecase (Pay) as UC2",
        "usecase Plain",
        "(Checkout) as UC3",
        "(Help)",
        "rectangle Shop {",
        "  (Inner)",
        "}",
        'package "Other" {',
        "}",
        "Customer --> UC1 : looks",
        "UC3 ..> UC2 : <<include>>",
        "UC3 .> (Help) : extend",
        "(Login) <. UC3 : include",
        "Admin -|> Customer",
        "Customer <|-- Clerk",
        ":Boss: -- (Approve)",
        "Nobody --> UC1",
        'note "about pay" as N1',
        "N1 .. UC2",
        "UC1 .. N1",
        "note right of UC3 : checkout",
        "note top of (Help)",
        "  help",
        "end note",
      ].join("\n"),
    ) as Record<string, unknown>;
    expect(s.actors).toEqual([
      "Customer",
      "Shop Admin",
      "Guest",
      "Visitor",
      "Clerk",
      "Boss",
      "Nobody",
    ]);
    expect(s.useCases).toEqual([
      "Browse",
      "Pay",
      "Plain",
      "Checkout",
      "Help",
      "Inner",
      "Login",
      "Approve",
    ]);
    expect(s.system).toBe("Shop");
    expect(s.relations).toEqual([
      { from: "Customer", to: "Browse", type: "association", name: "looks" },
      { from: "Checkout", to: "Pay", type: "include" },
      { from: "Checkout", to: "Help", type: "extend" },
      { from: "Checkout", to: "Login", type: "include" },
      { from: "Shop Admin", to: "Customer", type: "generalization" },
      { from: "Clerk", to: "Customer", type: "generalization" },
      { from: "Boss", to: "Approve", type: "association" },
      { from: "Nobody", to: "Browse", type: "association" },
    ]);
    expect(s.notes).toEqual([
      { text: "about pay", on: ["Pay", "Browse"] },
      { text: "checkout", on: ["Checkout"] },
      { text: "help", on: ["Help"] },
    ]);
    expect(
      parsePlantUml(
        puml("rectangle A {\n}\nrectangle B {\n}\nactor X\nX --> (Y)"),
      ).warnings,
    ).toEqual(["only one system boundary is drawn; B is not"]);
    expect(refused(puml("actor A\nA --> (B)\n???"))).toBe(
      'INVALID_ARGUMENT plantuml line 4: cannot read "???"',
    );
  });
});

describe("activity", () => {
  it("compiles the current syntax into a graph", () => {
    const s = spec(
      [
        "|Lane A|",
        "start",
        ":one;",
        "|#pink|Lane B|",
        ":two",
        "lines;",
        "-> go;",
        "if (x?) then (yes)",
        "  :a;",
        "elseif (y?) then (maybe)",
        "  :b;",
        "else if (z?)",
        "  :c;",
        "else (no)",
        "  :d;",
        "endif",
        "if (only?) then",
        "  :e;",
        "end if",
        "while (more?) is (yes)",
        "  :f;",
        "endwhile (no)",
        "repeat",
        "  :g;",
        "repeat while (again?) is (yes) not (no)",
        "fork",
        "  :h;",
        "fork again",
        "  :i;",
        "end fork {and}",
        "split",
        "  :j;",
        "split again",
        "  :k;",
        "  kill",
        "end split",
        "partition P {",
        "  :l;",
        "}",
        "note right : about l",
        "note left",
        "  more",
        "end note",
        "stop",
        "detach",
      ].join("\n"),
    ) as Record<string, Record<string, unknown>[]>;
    expect(s.lanes).toEqual(["Lane A", "Lane B"]);
    const names = s.nodes!.map((n) => [n.type, n.name]);
    expect(names.slice(0, 4)).toEqual([
      ["initial", undefined],
      ["action", "one"],
      ["action", "two\nlines"],
      ["decision", "x?"],
    ]);
    expect(s.flows).toContainEqual({
      from: "action2",
      to: "decision3",
      guard: "go",
    });
    expect(s.flows).toContainEqual({
      from: "decision3",
      to: "action4",
      guard: "yes",
    });
    expect(s.flows).toContainEqual({
      from: "decision3",
      to: "action5",
      guard: "maybe",
    });
    expect(s.flows).toContainEqual({
      from: "decision3",
      to: "action6",
      guard: "z?",
    });
    expect(s.flows).toContainEqual({
      from: "decision3",
      to: "action7",
      guard: "no",
    });
    const types = s.nodes!.map((n) => n.type);
    expect(types.filter((t) => t === "merge").length).toBe(3);
    expect(types.filter((t) => t === "fork").length).toBe(2);
    expect(types.filter((t) => t === "join").length).toBe(2);
    expect(types.filter((t) => t === "flowFinal").length).toBe(2);
    expect(types.at(-2)).toBe("final");
    expect(s.notes).toEqual([
      {
        text: "about l",
        on: [String(s.nodes!.find((n) => n.name === "l")!.id)],
      },
      { text: "more", on: [String(s.nodes!.find((n) => n.name === "l")!.id)] },
    ]);
    expect(spec("note right : first\nstart").notes).toEqual([
      { text: "first" },
    ]);
    expect(
      spec("start\nif (a) then\n  stop\nelse\n  stop\nendif").nodes,
    ).toHaveLength(4);
  });

  it("refuses jumps and unbalanced blocks", () => {
    expect(refused(puml("start\ngoto here"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: goto has no activity element build_diagram makes",
    );
    expect(refused(puml("start\nendif"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: no open if",
    );
    expect(refused(puml("start\nfork again"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: no open fork",
    );
    expect(refused(puml("start\nwhile (a)"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: while is never closed",
    );
    expect(refused(puml("start\n:never"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: action is never closed with ;",
    );
    expect(refused(puml("start\n???"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "???"',
    );
  });

  it("reads the legacy syntax /export_text writes", () => {
    const s = spec(
      [
        '(*) --> "Receive" as A1',
        "A1 --> ===B1===",
        '===B1=== --> "Pick" as A2',
        "===B1=== -> Bill",
        "A2 --> ===B2===",
        "Bill --> ===B2===",
        "===B2=== -right-> [paid] A3",
        '--> "Done"',
        '"Done" --> (*)',
      ].join("\n"),
    ) as Record<string, Record<string, unknown>[]>;
    expect(s.nodes!.map((n) => [n.id, n.type])).toEqual([
      ["start1", "initial"],
      ["A1", "action"],
      ["B1", "fork"],
      ["A2", "action"],
      ["Bill", "action"],
      ["B2", "join"],
      ["A3", "action"],
      ["Done", "action"],
      ["end1", "final"],
    ]);
    expect(s.flows).toContainEqual({ from: "B2", to: "A3", guard: "paid" });
    expect(s.flows).toContainEqual({ from: "A3", to: "Done" });
    expect(refused(puml("(*) --> A\n--> B\nwhat"))).toBe(
      'INVALID_ARGUMENT plantuml line 4: cannot read "what"',
    );
    expect(refused(puml('--> "A"\n(*) --> A'))).toBe(
      "INVALID_ARGUMENT plantuml line 2: an arrow needs a start",
    );
  });
});

describe("state", () => {
  it("reads states, composites, pseudostates, transitions and notes", () => {
    const s = spec(
      [
        "[*] --> Idle",
        'state "Busy now" as Busy {',
        "  [*] --> Run",
        "  Run -> Wait : pause [ok] / log",
        "  state Inner {",
        "    Deep",
        "  }",
        "}",
        'state Done as "All done"',
        "state Busy",
        "state C <<choice>>",
        "state S1 <<start>>",
        "state E1 <<end>>",
        "state F <<fork>> #red",
        "state J <<join>>",
        "Idle -[#blue]-> Busy : go",
        "Busy -up-> C",
        "C --> [*]",
        "Idle : waits here",
        "note left of Idle : idle",
        "note right of Run",
        "  running",
        "end note",
        "note on link",
        "  ignored",
        "end note",
        "note top : free",
      ].join("\n"),
    ) as Record<string, Record<string, unknown>[]>;
    expect(s.states).toEqual([
      { id: "[*] start 1", type: "initial" },
      { id: "Idle", name: "Idle" },
      { id: "Busy", name: "Busy now" },
      { id: "[*] start 2", type: "initial", parent: "Busy" },
      { id: "Run", name: "Run", parent: "Busy" },
      { id: "Wait", name: "Wait", parent: "Busy" },
      { id: "Inner", name: "Inner", parent: "Busy" },
      { id: "Deep", name: "Deep", parent: "Inner" },
      { id: "Done", name: "All done" },
      { id: "C", type: "choice" },
      { id: "S1", type: "initial" },
      { id: "E1", type: "final" },
      { id: "F", type: "fork" },
      { id: "J", type: "join" },
      { id: "[*] end 1", type: "final" },
    ]);
    expect(s.transitions).toContainEqual({
      from: "Run",
      to: "Wait",
      trigger: "pause",
      guard: "ok",
      effect: "log",
    });
    expect(s.notes).toEqual([
      { text: "idle", on: ["Idle"] },
      { text: "running", on: ["Run"] },
      { text: "free" },
    ]);
    expect(parsePlantUml(puml("[*] --> A\nA : desc")).warnings).toEqual([
      "line 3: the description of A is not written to StarUML",
    ]);
  });

  it("refuses history, concurrency, entry points and unbalanced blocks", () => {
    expect(refused(puml("state A {\n  [*] --> B\n  --\n}"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 4: concurrent regions are not built; a composite state gets one region",
    );
    expect(refused(puml("[*] --> A\nA --> [H]"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: history states have no StarUML element build_diagram makes",
    );
    expect(refused(puml("state A <<entryPoint>>"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 2: <<entryPoint>> states have no StarUML element build_diagram makes",
    );
    expect(refused(puml("state A\n}"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: } without a state block",
    );
    expect(refused(puml("state A {\nB"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: state A is never closed with }",
    );
    expect(refused(puml("state A\n???"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "???"',
    );
  });
});

describe("erd and mind map", () => {
  it("reads IE entities and crow's foot relations", () => {
    const s = spec(
      [
        'entity "Customer" as C #eee {',
        "  *id : int <<PK>>",
        "  --",
        "  name : varchar(80)",
        "  code <<UK>>",
        "  *mail : text",
        "  ref : int <<FK>>",
        "}",
        "entity Order",
        "C ||--o{ Order : places >",
        "C |o..|| Order",
      ].join("\n"),
    ) as Record<string, Record<string, unknown>[]>;
    expect(s.entities).toEqual([
      {
        name: "Customer",
        columns: [
          { name: "id", type: "int", primaryKey: true },
          { name: "name", type: "varchar", length: "80", nullable: true },
          { name: "code", unique: true, nullable: true },
          { name: "mail", type: "text" },
          { name: "ref", type: "int", foreignKey: true, nullable: true },
        ],
      },
      { name: "Order" },
    ]);
    expect(s.relationships).toEqual([
      {
        from: "Customer",
        to: "Order",
        fromCardinality: "1",
        toCardinality: "0..*",
        identifying: true,
        name: "places",
      },
      {
        from: "Customer",
        to: "Order",
        fromCardinality: "0..1",
        toCardinality: "1",
        identifying: false,
      },
    ]);
    expect(refused(puml("entity E {\n  ???\n}\nE ||--o{ F"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read column "???"',
    );
    expect(refused(puml("entity E {\n}\nE ||--o{ F\n???"))).toBe(
      'INVALID_ARGUMENT plantuml line 5: cannot read "???"',
    );
  });

  it("reads mind map levels, OrgMode sides and multi-line nodes", () => {
    const parsed = parsePlantUml(
      puml(
        [
          "* Root",
          "** A",
          "***[#red] A1",
          "**_ B",
          "**:Multi",
          "line;",
          "++ Right",
          "-- Left",
        ].join("\n"),
        "mindmap",
      ),
    );
    expect(parsed.kind).toBe("mindmap");
    expect(parsed.spec).toEqual({
      root: {
        name: "Root",
        children: [
          { name: "A", children: [{ name: "A1" }] },
          { name: "B" },
          { name: "Multi\nline" },
          { name: "Right" },
          { name: "Left" },
        ],
      },
    });
    expect(refused(puml("* A\n* B", "mindmap"))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: a mind map has one root in StarUML",
    );
    expect(refused(puml("* A\n*** B", "mindmap"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: a level is skipped",
    );
    expect(refused(puml("what", "mindmap"))).toBe(
      'INVALID_ARGUMENT plantuml line 2: cannot read "what"',
    );
    expect(refused(puml("** A", "mindmap"))).toBe(
      "INVALID_ARGUMENT plantuml line 2: a level is skipped",
    );
    expect(refused("@startmindmap\n@endmindmap")).toBe(
      "INVALID_ARGUMENT plantuml line 1: no diagram",
    );
  });
});

describe("c4", () => {
  it("reads C4-PlantUML macros, boundaries and styles", () => {
    const parsed = parsePlantUml(
      puml(
        [
          "!include <C4/C4_Container>",
          "LAYOUT_TOP_DOWN()",
          'Person(u, "User", "A user")',
          'System_Boundary(s, "Sys") {',
          '  Container(api, "API", "Go", "Serves")',
          '  ContainerDb(db, "DB", $techn="Postgres", $descr="Stores")',
          '  ContainerQueue(q, "Queue")',
          '  Component(c, "Comp", "TS")',
          "}",
          'System_Ext(x, "Ext")',
          'SystemDb(sd, "Store")',
          'Rel(u, api, "Uses", "HTTPS", "calls")',
          'Rel_Back(db, api, "Reads")',
          'BiRel(api, q, "Talks")',
          'Rel_U(c, api, "", $techn="IPC")',
          'UpdateElementStyle(u, $bgColor="#08427b", $fontColor="white", $borderColor="#073b6f")',
          'UpdateElementStyle(x, $fontColor="red")',
          "SHOW_LEGEND()",
        ].join("\n"),
      ),
    );
    expect(parsed.kind).toBe("c4");
    expect(parsed.spec).toEqual({
      elements: [
        { id: "u", name: "User", type: "person", description: "A user" },
        {
          id: "api",
          name: "API",
          type: "container",
          technology: "Go",
          description: "Serves",
        },
        {
          id: "db",
          name: "DB",
          type: "container",
          kind: "database",
          technology: "Postgres",
          description: "Stores",
        },
        { id: "q", name: "Queue", type: "container" },
        { id: "c", name: "Comp", type: "component", technology: "TS" },
        { id: "x", name: "Ext", type: "system", external: true },
        { id: "sd", name: "Store", type: "system" },
      ],
      relations: [
        {
          from: "u",
          to: "api",
          label: "Uses",
          technology: "HTTPS",
          description: "calls",
        },
        { from: "api", to: "db", label: "Reads" },
        { from: "api", to: "q", label: "Talks" },
        { from: "c", to: "api", technology: "IPC" },
      ],
      styles: { u: { fillColor: "#08427b", lineColor: "#073b6f" } },
    });
    expect(parsed.warnings).toEqual([
      "line 15: BiRel is drawn one way, api to q; StarUML's C4 relationship is directed",
      "1 boundary is not drawn; StarUML 7.1.1 has no C4 boundary element",
    ]);
  });

  it("refuses deployment nodes, broken macros and unbalanced boundaries", () => {
    expect(refused(puml('Person(a, "A")\nDeployment_Node(n, "N") {\n}'))).toBe(
      "UNSUPPORTED_SYNTAX plantuml line 3: C4 deployment nodes have no StarUML 7.1.1 element",
    );
    expect(refused(puml("Person(a)"))).toBe(
      "INVALID_ARGUMENT plantuml line 2: Person needs an alias and a label",
    );
    expect(refused(puml('Person(a, "A")\nRel(a)'))).toBe(
      "INVALID_ARGUMENT plantuml line 3: Rel needs two aliases",
    );
    expect(refused(puml('Person(a, "A")\n}'))).toBe(
      "INVALID_ARGUMENT plantuml line 3: } without a boundary",
    );
    expect(refused(puml('Boundary(b, "B") {\nPerson(a, "A")'))).toBe(
      "INVALID_ARGUMENT plantuml line 3: a boundary is never closed with }",
    );
    expect(refused(puml('Person(a, "A")\nwhat'))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "what"',
    );
    expect(
      parsePlantUml(puml('Boundary(b, "B")\nPerson(a, "A")')).warnings,
    ).toEqual([
      "1 boundary is not drawn; StarUML 7.1.1 has no C4 boundary element",
    ]);
    expect(
      parsePlantUml(
        puml('Boundary(a, "A") {\n}\nBoundary(b, "B") {\n}\nPerson(p, "P")'),
      ).warnings,
    ).toEqual([
      "2 boundaries are not drawn; StarUML 7.1.1 has no C4 boundary element",
    ]);
  });
});

describe("details", () => {
  it("reads the less common forms of each kind", () => {
    expect(preprocess("@startuml\n/' a\nb\nc '/\nA -> B").lines).toEqual([
      { no: 5, text: "A -> B" },
    ]);
    const cls = spec(
      "package p {\n}\npackage p {\n  class A\n}\nnote : free\nnote left of Ghost : g",
    );
    expect(cls.packages).toEqual(["p"]);
    expect(cls.notes).toEqual([{ text: "free" }, { text: "g", on: ["Ghost"] }]);
    const seq = spec(
      "participant X\ncreate X\nX -> Y\nalt a\n  X -> Y\nelse b\n  X -> Y\nelse c\n  X -> Y\nend",
    );
    expect(seq.participants).toEqual([{ name: "X" }]);
    expect((seq.fragments as unknown[])[0]).toMatchObject({
      operandStarts: [2, 3],
    });
    const uc = spec("actor A\nA --> (U)\nnote : loose");
    expect(uc.notes).toEqual([{ text: "loose" }]);
    const act = spec(
      "|L|\nstart\n->;\n:a;\n|L|\nwhile (w) is (yes)\nendwhile\nstop",
    );
    expect(act.lanes).toEqual(["L"]);
    expect(act.flows).toContainEqual({
      from: "decision2",
      to: "decision2",
      guard: "yes",
    });
  });
});
