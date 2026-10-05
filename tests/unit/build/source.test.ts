import { describe, expect, it } from "vitest";
import { detectFormat, parseSource } from "../../../src/build/source.js";
import { ApiError } from "../../../src/errors.js";

// Issue #16: which format a text is, and reading it.
describe("detectFormat", () => {
  it("tells PlantUML, JSON Schema, SQL and Mermaid apart", () => {
    expect(detectFormat("' note\n@startuml\nA -> B\n@enduml")).toBe("plantuml");
    expect(detectFormat('  {"type": "object"}')).toBe("jsonschema");
    expect(detectFormat("-- dump\n{")).toBe("jsonschema");
    expect(detectFormat("create unlogged table t (id int);")).toBe("sql");
    expect(detectFormat("CREATE TABLE t (id int)")).toBe("sql");
    expect(detectFormat("%% x\nclassDiagram\n  A")).toBe("mermaid");
  });
});

describe("parseSource", () => {
  it("reads each format, and refuses SQL as anything but an ERD", () => {
    expect(parseSource("@startuml\nA -> B\n@enduml")).toMatchObject({
      kind: "sequence",
      format: "plantuml",
    });
    expect(
      parseSource("CREATE TABLE t (id int)", undefined, "erd"),
    ).toMatchObject({
      kind: "erd",
      format: "sql",
    });
    expect(
      parseSource('{"properties": {}}', "jsonschema", "erd"),
    ).toMatchObject({
      kind: "erd",
      format: "jsonschema",
    });
    expect(parseSource("flowchart\n  A", "mermaid")).toMatchObject({
      kind: "flowchart",
      format: "mermaid",
    });
    try {
      parseSource("CREATE TABLE t (id int)", "sql", "class");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("UNSUPPORTED_SYNTAX");
      expect((err as ApiError).message).toBe(
        "sql: DDL is read as an ERD, not class",
      );
    }
  });
});
