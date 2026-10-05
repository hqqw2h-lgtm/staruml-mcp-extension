import { describe, expect, it } from "vitest";
import {
  isOperation,
  multiline,
  parseAttribute,
  parseOperation,
} from "../../../src/build/members.js";

describe("multiline", () => {
  it("turns <br>, <br/> and a written \\n into newlines", () => {
    expect(multiline(" a<br>b<BR />c\\nd ")).toBe("a\nb\nc\nd");
  });
});

describe("parseAttribute", () => {
  it.each([
    ["id", { name: "id" }],
    ["+id: long", { name: "id", type: "long", visibility: "public" }],
    ["-String owner", { name: "owner", type: "String", visibility: "private" }],
    [
      "#List~int~ items",
      { name: "items", type: "List<int>", visibility: "protected" },
    ],
    [
      "~count: int = 0",
      { name: "count", type: "int", visibility: "package", defaultValue: "0" },
    ],
    [
      "tags: String[0..*]",
      { name: "tags", type: "String", multiplicity: "0..*" },
    ],
    [
      "+max: int$",
      { name: "max", type: "int", visibility: "public", isStatic: true },
    ],
    ["note:", { name: "note" }],
  ])("%s", (source, expected) => {
    expect(parseAttribute(source)).toEqual(expected);
  });
});

describe("parseOperation", () => {
  it.each([
    ["run()", { name: "run" }],
    [
      "+place(qty: int, Item item): Order",
      {
        name: "place",
        visibility: "public",
        returnType: "Order",
        parameters: [
          { name: "qty", type: "int" },
          { name: "item", type: "Item" },
        ],
      },
    ],
    [
      "+deposit(amount) bool$",
      {
        name: "deposit",
        visibility: "public",
        parameters: [{ name: "amount" }],
        returnType: "bool",
        isStatic: true,
      },
    ],
    ["draw()*", { name: "draw", isAbstract: true }],
  ])("%s", (source, expected) => {
    expect(parseOperation(source)).toEqual(expected);
  });

  it("tells operations from attributes by the parameter list", () => {
    expect(isOperation("go()")).toBe(true);
    expect(isOperation("go: int")).toBe(false);
  });
});
