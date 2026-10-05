import { describe, expect, it } from "vitest";
import { parseJsonSchema } from "../../../src/build/jsonschema.js";
import { ApiError } from "../../../src/errors.js";

// Issue #16: JSON Schema into a class diagram or an ERD.
const refused = (
  schema: unknown,
  as?: Parameters<typeof parseJsonSchema>[1],
) => {
  try {
    parseJsonSchema(
      typeof schema === "string" ? schema : JSON.stringify(schema),
      as,
    );
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return `${(err as ApiError).code} ${(err as ApiError).message}`;
  }
  throw new Error("expected a refusal");
};

const schema = {
  title: "Order",
  type: "object",
  required: ["id", "buyer", "lines"],
  properties: {
    id: { type: "integer" },
    at: { type: "string", format: "date-time" },
    status: { $ref: "#/definitions/Status" },
    buyer: { $ref: "#/definitions/Buyer" },
    alt: { anyOf: [{ $ref: "#/definitions/Buyer" }, { type: "null" }] },
    lines: { type: "array", items: { $ref: "#/definitions/Line" } },
    ship: { type: "object", properties: { city: { type: "string" } } },
    box: { title: "Box", properties: { size: { type: "number" } } },
    parts: {
      type: "array",
      items: { type: "object", properties: { n: { type: "integer" } } },
    },
    note: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    any: {},
    loop: { $ref: "#" },
    slash: { $ref: "#/definitions/a~1b" },
  },
  definitions: {
    Status: { type: "string", enum: ["NEW", "DONE"] },
    Party: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
    },
    Buyer: {
      allOf: [
        { $ref: "#/definitions/Party" },
        { properties: { mail: { type: "string" } }, required: ["mail"] },
      ],
      required: [],
    },
    Line: { type: "object", properties: { qty: { type: "integer" } } },
    "a/b": { type: "object" },
  },
};

describe("parseJsonSchema", () => {
  it("reads object schemas as classes with attributes and associations", () => {
    const parsed = parseJsonSchema(JSON.stringify(schema));
    expect(parsed).toMatchObject({ kind: "class", title: "Order" });
    const spec = parsed.spec as {
      classes: Record<string, unknown>[];
      relations: Record<string, unknown>[];
    };
    expect(spec.classes.map((c) => c.name)).toEqual([
      "OrderShip",
      "Box",
      "OrderParts",
      "Order",
      "Status",
      "Party",
      "Buyer",
      "Line",
      "a/b",
    ]);
    expect(spec.classes.find((c) => c.name === "Order")).toEqual({
      name: "Order",
      attributes: [
        { name: "id", type: "integer" },
        { name: "at", type: "date-time", multiplicity: "0..1" },
        { name: "note", type: "string", multiplicity: "0..1" },
        { name: "tags", type: "string", multiplicity: "*" },
        { name: "any", type: "any", multiplicity: "0..1" },
      ],
    });
    expect(spec.classes.find((c) => c.name === "Status")).toEqual({
      name: "Status",
      kind: "enum",
      literals: ["NEW", "DONE"],
    });
    expect(spec.relations).toEqual([
      {
        from: "Order",
        to: "Status",
        type: "directed",
        name: "status",
        toMultiplicity: "0..1",
      },
      {
        from: "Order",
        to: "Buyer",
        type: "directed",
        name: "buyer",
        toMultiplicity: "1",
      },
      {
        from: "Order",
        to: "Buyer",
        type: "directed",
        name: "alt",
        toMultiplicity: "0..1",
      },
      {
        from: "Order",
        to: "Line",
        type: "directed",
        name: "lines",
        toMultiplicity: "*",
      },
      {
        from: "OrderShip",
        to: "Order",
        type: "composition",
        fromMultiplicity: "0..1",
      },
      {
        from: "Box",
        to: "Order",
        type: "composition",
        fromMultiplicity: "0..1",
      },
      {
        from: "OrderParts",
        to: "Order",
        type: "composition",
        fromMultiplicity: "*",
      },
      {
        from: "Order",
        to: "Order",
        type: "directed",
        name: "loop",
        toMultiplicity: "0..1",
      },
      {
        from: "Order",
        to: "a/b",
        type: "directed",
        name: "slash",
        toMultiplicity: "0..1",
      },
      { from: "Buyer", to: "Party", type: "generalization" },
    ]);
  });

  it("reads object schemas as entities with key columns for an ERD", () => {
    const parsed = parseJsonSchema(JSON.stringify(schema), "erd");
    const spec = parsed.spec as {
      entities: { name: string; columns?: Record<string, unknown>[] }[];
      relationships: Record<string, unknown>[];
    };
    expect(spec.entities.find((e) => e.name === "Order")!.columns).toEqual([
      { name: "id", type: "integer", primaryKey: true },
      { name: "at", type: "timestamp", nullable: true },
      { name: "status_id", foreignKey: true, nullable: true, type: "varchar" },
      { name: "buyer_id", foreignKey: true },
      { name: "alt_id", foreignKey: true, nullable: true },
      { name: "ship_id", foreignKey: true, nullable: true },
      { name: "box_id", foreignKey: true, nullable: true },
      { name: "note", type: "varchar", nullable: true },
      { name: "tags", type: "varchar[]", nullable: true },
      { name: "any", type: "any", nullable: true },
      { name: "loop_id", foreignKey: true, nullable: true, type: "integer" },
      { name: "slash_id", foreignKey: true, nullable: true },
    ]);
    expect(spec.entities.find((e) => e.name === "Status")!.columns).toEqual([
      { name: "value", type: "varchar", primaryKey: true },
    ]);
    expect(spec.entities.find((e) => e.name === "a/b")).toEqual({
      name: "a/b",
    });
    expect(spec.relationships).toContainEqual({
      from: "Party",
      to: "Buyer",
      fromCardinality: "1",
      toCardinality: "0..1",
      identifying: true,
    });
    expect(spec.relationships).toContainEqual({
      from: "Order",
      to: "Line",
      fromCardinality: "1",
      toCardinality: "0..*",
      identifying: false,
    });
  });

  it("names the root Root without a title, and reads $defs", () => {
    const parsed = parseJsonSchema(
      JSON.stringify({
        properties: { a: { $ref: "#/$defs/A" } },
        $defs: { A: { type: "object" } },
      }),
    );
    expect(parsed.title).toBeUndefined();
    expect(
      (parsed.spec as { classes: { name: string }[] }).classes.map(
        (c) => c.name,
      ),
    ).toEqual(["Root", "A"]);
    expect(
      (
        parseJsonSchema(
          JSON.stringify({
            $defs: {
              A: { allOf: [{ properties: { x: { type: "string" } } }] },
            },
          }),
        ).spec as {
          classes: unknown[];
        }
      ).classes,
    ).toEqual([
      {
        name: "A",
        attributes: [{ name: "x", type: "string", multiplicity: "0..1" }],
      },
    ]);
  });

  it("refuses what has no class or ERD form", () => {
    expect(refused("{nope")).toMatch(
      /^INVALID_ARGUMENT json schema #: not JSON: /,
    );
    expect(refused("[1]")).toBe(
      "INVALID_ARGUMENT json schema #: a schema is a JSON object",
    );
    expect(refused({ title: "x" })).toBe(
      "INVALID_ARGUMENT json schema #: no object schema: give the root properties, or $defs",
    );
    expect(refused({ properties: {} }, "sequence")).toBe(
      "UNSUPPORTED_SYNTAX json schema #: JSON Schema is read as a class diagram or an ERD, not sequence",
    );
    expect(refused({ $defs: { A: 1 } })).toBe(
      "INVALID_ARGUMENT json schema #/$defs/A: is not a schema",
    );
    expect(refused({ properties: { a: 1 } })).toBe(
      "INVALID_ARGUMENT json schema #/properties/a: is not a schema",
    );
    expect(refused({ properties: { a: { $ref: "other.json#/x" } } })).toBe(
      "UNSUPPORTED_SYNTAX json schema #/properties/a: $ref other.json#/x points outside this document's definitions",
    );
    expect(refused({ properties: { a: { $ref: "#/$defs/B" } } })).toBe(
      "INVALID_ARGUMENT json schema #/properties/a: $ref #/$defs/B names no definition",
    );
    expect(refused({ properties: { a: { oneOf: [] } } })).toBe(
      "UNSUPPORTED_SYNTAX json schema #/properties/a: oneOf has no class or ERD form",
    );
    expect(
      refused({
        properties: { a: { anyOf: [{ type: "string" }, { type: "integer" }] } },
      }),
    ).toBe(
      "UNSUPPORTED_SYNTAX json schema #/properties/a: anyOf is read only as one schema or null",
    );
    expect(
      refused({ properties: { a: { anyOf: [{ type: "string" }] } } }),
    ).toBe(
      "UNSUPPORTED_SYNTAX json schema #/properties/a: anyOf is read only as one schema or null",
    );
    expect(
      refused({
        $defs: {
          A: { type: "object" },
          B: { allOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/A" }] },
        },
      }),
    ).toBe(
      "UNSUPPORTED_SYNTAX json schema #/$defs/B: allOf is read only as one $ref base and properties",
    );
    expect(refused({ $defs: { B: { allOf: [{ type: "string" }] } } })).toBe(
      "UNSUPPORTED_SYNTAX json schema #/$defs/B: allOf is read only as one $ref base and properties",
    );
  });
});

describe("parseJsonSchema details", () => {
  it("reads untyped arrays and enums, required inline objects and shared titles", () => {
    const s = {
      title: "T",
      required: ["inner"],
      properties: {
        list: { type: "array" },
        pick: { enum: ["a", "b"] },
        inner: {
          type: "object",
          title: "Line",
          properties: { a: { type: "string" } },
        },
      },
      $defs: {
        Line: { type: "object", properties: { b: { type: "string" } } },
      },
    };
    const cls = parseJsonSchema(JSON.stringify(s)).spec as {
      classes: Record<string, unknown>[];
      relations: Record<string, unknown>[];
    };
    expect(cls.classes).toEqual([
      {
        name: "Line",
        attributes: [{ name: "a", type: "string", multiplicity: "0..1" }],
      },
      {
        name: "T",
        attributes: [
          { name: "list", type: "any", multiplicity: "*" },
          { name: "pick", type: "string", multiplicity: "0..1" },
        ],
      },
    ]);
    expect(cls.relations).toEqual([
      { from: "Line", to: "T", type: "composition", fromMultiplicity: "1" },
    ]);
    const erd = parseJsonSchema(JSON.stringify(s), "erd").spec as {
      entities: { name: string; columns?: unknown[] }[];
    };
    expect(erd.entities.find((e) => e.name === "T")!.columns).toContainEqual({
      name: "list",
      type: "any[]",
      nullable: true,
    });
  });
});
