import { describe, expect, it } from "vitest";
import { bare, parseSql, statements } from "../../../src/build/sql.js";
import { ApiError } from "../../../src/errors.js";

// Issue #16: SQL DDL into an ERD.
const refused = (source: string) => {
  try {
    parseSql(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return `${(err as ApiError).code} ${(err as ApiError).message}`;
  }
  throw new Error("expected a refusal");
};

describe("statements", () => {
  it("splits at semicolons outside quotes, dropping comments", () => {
    expect(
      statements(
        "-- head\nCREATE TABLE a (x text default ';');\n/* block\n */ CREATE TABLE \"b;\" (y int)\n;\n[c;] /* open",
      ),
    ).toEqual([
      { line: 2, text: "CREATE TABLE a (x text default ';')" },
      { line: 4, text: 'CREATE TABLE "b;" (y int)' },
      { line: 6, text: "[c;]" },
    ]);
    expect(bare('"public"."Orders"')).toBe("Orders");
    expect(bare("`db`.`t`")).toBe("t");
    expect(bare("[dbo].[T]")).toBe("T");
  });
});

describe("parseSql", () => {
  it("reads tables, keys and foreign keys into entities and relationships", () => {
    const parsed = parseSql(`
      SET search_path = public;
      CREATE TABLE IF NOT EXISTS public.customer (
        id serial PRIMARY KEY,
        email varchar(120) NOT NULL UNIQUE,
        rate numeric(10, 2),
        CHECK (rate > 0)
      );
      CREATE TEMPORARY TABLE "order" (
        id bigint NOT NULL,
        customer_id int NOT NULL REFERENCES customer(id),
        note text,
        CONSTRAINT pk PRIMARY KEY (id),
        UNIQUE KEY uk (note)
      ) ENGINE=InnoDB;
      CREATE TABLE line (
        order_id bigint NOT NULL,
        no int NOT NULL,
        ref int,
        PRIMARY KEY (order_id, no),
        FOREIGN KEY (order_id) REFERENCES "order"(id) ON DELETE CASCADE,
        KEY idx (ref),
        UNIQUE (ref, no)
      );
      CREATE TABLE detail (id int PRIMARY KEY REFERENCES line, extra text);
      CREATE UNIQUE INDEX i ON line (ref);
      CREATE INDEX j ON line (ref);
      ALTER TABLE ONLY line ADD CONSTRAINT fk FOREIGN KEY (ref) REFERENCES product (id), OWNER TO me;
      ALTER TABLE line ADD COLUMN extra varchar(5) NOT NULL;
      ALTER TABLE line ADD PRIMARY KEY (no);
      COMMENT ON TABLE line IS 'x';
    `);
    expect(parsed.kind).toBe("erd");
    const spec = parsed.spec as {
      entities: { name: string; columns?: Record<string, unknown>[] }[];
      relationships: Record<string, unknown>[];
    };
    expect(spec.entities.map((e) => e.name)).toEqual([
      "customer",
      "order",
      "line",
      "detail",
      "product",
    ]);
    expect(spec.entities[0]!.columns).toEqual([
      { name: "id", type: "serial", primaryKey: true },
      { name: "email", type: "varchar", length: "120", unique: true },
      { name: "rate", type: "numeric", length: "10,2", nullable: true },
    ]);
    expect(spec.entities[1]!.columns).toEqual([
      { name: "id", type: "bigint", primaryKey: true },
      { name: "customer_id", type: "int", foreignKey: true },
      { name: "note", type: "text", nullable: true, unique: true },
    ]);
    expect(spec.entities[2]!.columns!.at(-1)).toEqual({
      name: "extra",
      type: "varchar",
      length: "5",
    });
    expect(spec.relationships).toEqual([
      {
        from: "customer",
        to: "order",
        fromCardinality: "1",
        toCardinality: "0..*",
        identifying: false,
      },
      {
        from: "order",
        to: "line",
        fromCardinality: "1",
        toCardinality: "0..*",
        identifying: true,
      },
      {
        from: "line",
        to: "detail",
        fromCardinality: "1",
        toCardinality: "0..1",
        identifying: true,
      },
      {
        from: "product",
        to: "line",
        fromCardinality: "0..1",
        toCardinality: "0..*",
        identifying: false,
      },
    ]);
    expect(parsed.warnings).toEqual([
      "1 SET SEARCH_PATH statement is skipped",
      "1 CREATE UNIQUE statement is skipped",
      "1 CREATE INDEX statement is skipped",
      "1 ALTER TABLE statement is skipped",
      "1 COMMENT ON statement is skipped",
      "line 28: line references product, which is not created here; it is drawn without columns",
    ]);
  });

  it("gives nullable and unique keys their cardinalities", () => {
    const spec = parseSql(
      "CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (id int PRIMARY KEY, a_id int UNIQUE REFERENCES a(id), a2 int, FOREIGN KEY (a2) REFERENCES a)",
    ).spec as { relationships: Record<string, unknown>[] };
    expect(spec.relationships).toEqual([
      {
        from: "a",
        to: "b",
        fromCardinality: "0..1",
        toCardinality: "0..1",
        identifying: false,
      },
      {
        from: "a",
        to: "b",
        fromCardinality: "0..1",
        toCardinality: "0..*",
        identifying: false,
      },
    ]);
  });

  it("refuses what an ERD cannot show and what it cannot read", () => {
    expect(refused("CREATE TABLE a (id int); CREATE VIEW v AS SELECT 1")).toBe(
      "UNSUPPORTED_SYNTAX sql line 1: CREATE VIEW has no ERD element; only tables and their keys are drawn",
    );
    expect(
      refused("CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ x $$"),
    ).toBe(
      "UNSUPPORTED_SYNTAX sql line 1: CREATE OR REPLACE FUNCTION has no ERD element; only tables and their keys are drawn",
    );
    expect(refused("CREATE TABLE a (LIKE b)")).toBe(
      "UNSUPPORTED_SYNTAX sql line 1: CREATE TABLE ... LIKE copies a table build_diagram cannot see",
    );
    expect(refused("CREATE TABLE a (id)")).toBe(
      'INVALID_ARGUMENT sql line 1: cannot read column "id"',
    );
    expect(refused("CREATE TABLE a (id int, CONSTRAINT c FOO (id))")).toBe(
      'INVALID_ARGUMENT sql line 1: cannot read "CONSTRAINT c FOO (id)"',
    );
    expect(refused("CREATE TABLE a (id int);\nCREATE TABLE A (id int)")).toBe(
      "INVALID_ARGUMENT sql line 2: table A is created twice",
    );
    expect(refused("ALTER TABLE a ADD x int")).toBe(
      "INVALID_ARGUMENT sql line 1: ALTER TABLE a before CREATE TABLE",
    );
    expect(
      refused("CREATE TABLE a (id int, FOREIGN KEY (zz) REFERENCES a)"),
    ).toBe("INVALID_ARGUMENT sql line 1: a has no column zz");
    expect(refused("SELECT 1")).toBe(
      "INVALID_ARGUMENT sql line 1: no CREATE TABLE statement",
    );
    expect(refused("CREATE TABLE a (id int);\nfrobnicate")).toBe(
      'INVALID_ARGUMENT sql line 2: cannot read "frobnicate"',
    );
  });
});

describe("parseSql details", () => {
  it("reads MySQL types, stray separators and repeated skips", () => {
    const parsed = parseSql(
      "CREATE TABLE t (id int(11) unsigned NOT NULL, u int, UNIQUE (zz), UNIQUE (u),);;\nCREATE INDEX a ON t (id);\nCREATE INDEX b ON t (u);",
    );
    expect(
      (parsed.spec as { entities: { columns: unknown[] }[] }).entities[0]!
        .columns,
    ).toEqual([
      { name: "id", type: "int unsigned", length: "11" },
      { name: "u", type: "int", nullable: true, unique: true },
    ]);
    expect(parsed.warnings).toEqual(["2 CREATE INDEX statements are skipped"]);
  });
});
