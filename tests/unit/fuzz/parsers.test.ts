import fc from "fast-check";
import { describe, expect, it } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { parseJsonSchema } from "../../../src/build/jsonschema.js";
import { parseMermaid } from "../../../src/build/mermaid.js";
import { parsePlantUml } from "../../../src/build/plantuml.js";
import { FORMATS, parseSource } from "../../../src/build/source.js";
import { KINDS, type Kind, planFor } from "../../../src/build/spec.js";
import { parseSql } from "../../../src/build/sql.js";
import { ApiError } from "../../../src/errors.js";

/*
 * Issue #27: every text reader of /build_diagram, and the planner behind
 * it, answers any input with a spec or an ApiError of a stable code,
 * never anything else, and within a bounded time.
 */

/** What a reader may refuse with: a malformed text, or one StarUML cannot hold. */
const CODES = ["INVALID_ARGUMENT", "UNSUPPORTED_SYNTAX"];
/** Per input; the slowest real-world inputs read in well under 50 ms. */
const BUDGET_MS = 250;

function stable(read: () => unknown): void {
  const started = performance.now();
  try {
    read();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(CODES).toContain(err.code);
    expect(err.message.length).toBeGreaterThan(0);
  }
  expect(performance.now() - started).toBeLessThan(BUDGET_MS);
}

/** Lines built from a language's own tokens, so inputs reach past the first check. */
const lines = (tokens: readonly string[], head: fc.Arbitrary<string>) =>
  fc
    .tuple(
      head,
      fc.array(
        fc
          .array(
            fc.oneof(
              { weight: 4, arbitrary: fc.constantFrom(...tokens) },
              { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
            ),
            { maxLength: 7 },
          )
          .map((t) => t.join(" ")),
        { maxLength: 25 },
      ),
    )
    .map(([h, body]) => [h, ...body].join("\n"));

const IDENT = ["A", "B", "Order", "x", '"Long name"', "[*]", "C1", "%%"];

const MERMAID = lines(
  [
    ...IDENT,
    "-->",
    "--o",
    "--*",
    "<|--",
    "..>",
    "->>",
    "-->>",
    "||--o{",
    "}o--||",
    ":",
    "{",
    "}",
    "[",
    "]",
    "(",
    ")",
    "((",
    "))",
    "class",
    "participant",
    "actor",
    "note",
    "alt",
    "else",
    "end",
    "loop",
    "state",
    "subgraph",
    "classDef",
    "style",
    "fill:#f00",
    ":::",
    "requirement",
    "element",
    "satisfies",
    "Person(",
    "Rel(",
    "id:",
    "text:",
    "+id: long",
    "+run()",
    "<<interface>>",
    "title",
  ],
  fc.constantFrom(
    "classDiagram",
    "sequenceDiagram",
    "flowchart TD",
    "graph LR",
    "erDiagram",
    "stateDiagram-v2",
    "mindmap",
    "requirementDiagram",
    "C4Context",
    "C4Container",
    "pie",
    "---\ntitle: T\n---\nclassDiagram",
    "",
  ),
);

const PLANTUML = lines(
  [
    ...IDENT,
    "->",
    "-->",
    "<|--",
    "*--",
    "o--",
    "..>",
    "--",
    "-",
    ":",
    "{",
    "}",
    "class",
    "interface",
    "enum",
    "abstract",
    "package",
    "namespace",
    "participant",
    "actor",
    "usecase",
    "(Use)",
    ":Act:",
    "rectangle",
    "start",
    "stop",
    ":act;",
    "if (x) then (yes)",
    "else",
    "endif",
    "while (w)",
    "endwhile",
    "fork",
    "end fork",
    "|Lane|",
    "state",
    "<<choice>>",
    "entity",
    "|o--o{",
    "component",
    "[Comp]",
    "port",
    "node",
    "artifact",
    "<<deploy>>",
    "note right of A",
    "end note",
    "alt",
    "group",
    "title X",
    "skinparam x y",
  ],
  fc.constantFrom(
    "@startuml",
    "@startmindmap",
    "@startgantt",
    "@startuml\n!include <C4/C4_Container>",
    "",
  ),
).map((t) => `${t}\n@enduml`);

const SQL = lines(
  [
    "CREATE",
    "TABLE",
    "IF",
    "NOT",
    "EXISTS",
    "t",
    "u",
    '"q"',
    "(",
    ")",
    ",",
    ";",
    "id",
    "int",
    "varchar(20)",
    "PRIMARY",
    "KEY",
    "REFERENCES",
    "FOREIGN",
    "UNIQUE",
    "NULL",
    "DEFAULT",
    "ALTER",
    "ADD",
    "COLUMN",
    "CONSTRAINT",
    "VIEW",
    "INDEX",
    "--",
    "/*",
    "*/",
    "'s'",
  ],
  fc.constantFrom("CREATE TABLE t (id int PRIMARY KEY);", "create table", ""),
);

/**
 * JSON values shaped like schemas: types, properties, refs, combinators,
 * nested `depth` levels deep (each level branches, so an unbounded
 * recursion would generate gigabytes).
 */
function schemaAt(depth: number): fc.Arbitrary<unknown> {
  const child =
    depth === 0 ? fc.constantFrom({}, { type: "string" }) : schemaAt(depth - 1);
  return fc.oneof(
    fc.record(
      {
        type: fc.constantFrom(
          "object",
          "string",
          "integer",
          "array",
          "number",
          "boolean",
          "null",
          ["string", "null"],
          7,
        ),
        properties: fc.dictionary(
          fc.constantFrom("id", "name", "items", "owner", "$x"),
          child,
          { maxKeys: 3 },
        ),
        items: child,
        $ref: fc.constantFrom(
          "#/$defs/A",
          "#/definitions/B",
          "other.json",
          "#",
        ),
        allOf: fc.array(child, { maxLength: 2 }),
        oneOf: fc.array(child, { maxLength: 1 }),
        anyOf: fc.array(child, { maxLength: 2 }),
        enum: fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }),
        required: fc.array(fc.constantFrom("id", "name", "x"), {
          maxLength: 2,
        }),
        format: fc.constantFrom("date-time", "uuid", "email"),
        title: fc.constantFrom("A", "Order", "T", ""),
      },
      { requiredKeys: [] },
    ),
    fc.jsonValue({ maxDepth: 1 }),
  );
}

const SCHEMA = schemaAt(2);

const JSON_SCHEMA = fc.oneof(
  fc
    .record(
      {
        $defs: fc.dictionary(fc.constantFrom("A", "B", "Order"), SCHEMA, {
          maxKeys: 3,
        }),
        definitions: fc.dictionary(fc.constantFrom("B"), SCHEMA, {
          maxKeys: 1,
        }),
        properties: fc.dictionary(fc.constantFrom("a", "b"), SCHEMA, {
          maxKeys: 2,
        }),
        type: fc.constantFrom("object", "array"),
        title: fc.string({ maxLength: 5 }),
      },
      { requiredKeys: [] },
    )
    .map((s) => JSON.stringify(s)),
  fc.string(),
  fc.jsonValue().map((v) => JSON.stringify(v)),
);

const kind = fc.constantFrom<Kind | undefined>(undefined, ...KINDS);
const RUNS = { numRuns: 300 };

describe("parser fuzzing (issue #27)", () => {
  it("Mermaid never throws but INVALID_ARGUMENT or UNSUPPORTED_SYNTAX", () => {
    fc.assert(
      fc.property(fc.oneof(MERMAID, fc.string()), kind, (text, as) =>
        stable(() => parseMermaid(text, as)),
      ),
      RUNS,
    );
  });

  it("PlantUML never throws but INVALID_ARGUMENT or UNSUPPORTED_SYNTAX", () => {
    fc.assert(
      fc.property(fc.oneof(PLANTUML, fc.string()), kind, (text, as) =>
        stable(() => parsePlantUml(text, as)),
      ),
      RUNS,
    );
  });

  it("SQL DDL never throws but INVALID_ARGUMENT or UNSUPPORTED_SYNTAX", () => {
    fc.assert(
      fc.property(fc.oneof(SQL, fc.string()), (text) =>
        stable(() => parseSql(text)),
      ),
      RUNS,
    );
  });

  it("JSON Schema never throws but INVALID_ARGUMENT or UNSUPPORTED_SYNTAX", () => {
    fc.assert(
      fc.property(JSON_SCHEMA, kind, (text, as) =>
        stable(() => parseJsonSchema(text, as)),
      ),
      RUNS,
    );
  });

  it("whatever a reader answers plans, or is refused with a stable code", () => {
    fc.assert(
      fc.property(
        fc.oneof(MERMAID, PLANTUML, SQL, JSON_SCHEMA),
        fc.constantFrom(undefined, ...FORMATS),
        kind,
        (text, format, as) =>
          stable(() => {
            const parsed = parseSource(text, format, as);
            planFor(parsed.kind, parsed.spec);
          }),
      ),
      RUNS,
    );
  });

  it("every kind's planner takes any JSON spec without throwing but INVALID_ARGUMENT", () => {
    const shaped = (k: Kind) =>
      (cases as Record<string, { kind?: string; spec?: unknown }>)[
        Object.keys(cases).find(
          (c) => (cases as Record<string, { kind?: string }>)[c]!.kind === k,
        ) ?? ""
      ]?.spec;
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        fc.oneof(fc.jsonValue({ maxDepth: 4 }), fc.object({ maxDepth: 3 })),
        fc.boolean(),
        (k, junk, mutate) =>
          stable(() => {
            const base = shaped(k);
            // A golden spec with one field replaced reaches deeper checks.
            const spec =
              mutate && base && typeof base === "object"
                ? { ...(base as object), [Object.keys(base)[0]!]: junk }
                : junk;
            planFor(k, spec);
          }),
      ),
      { numRuns: 600 },
    );
  });
});
