import { describe, expect, it } from "vitest";
import {
  formatAttribute,
  formatOperation,
  isOperation,
  typeText,
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

describe("member formatting", () => {
  it("writes attributes back in the form parseAttribute reads", () => {
    const source = {
      name: "id",
      visibility: "private",
      type: "long",
      multiplicity: "1",
      defaultValue: "0",
      isStatic: true,
    };
    expect(formatAttribute(source)).toBe("-id: long[1] = 0$");
    expect(parseAttribute(formatAttribute(source))).toEqual({
      name: "id",
      type: "long",
      visibility: "private",
      multiplicity: "1",
      defaultValue: "0",
      isStatic: true,
    });
    expect(formatAttribute({ name: "x", visibility: "other" })).toBe("x");
    expect(formatAttribute({})).toBe("");
  });

  it("writes operations with parameters and a return type", () => {
    expect(
      formatOperation({
        name: "place",
        visibility: "package",
        isAbstract: true,
        parameters: [
          { name: "qty", type: "int", direction: "in" },
          { name: "item", type: { name: "Item" } },
          { name: "", type: "Order", direction: "return" },
        ],
      }),
    ).toBe("~place(qty: int, item: Item): Order*");
    expect(formatOperation({ name: "go", parameters: [{}] })).toBe("go()");
    expect(formatOperation({})).toBe("()");
    expect(
      formatOperation({ name: "s", isStatic: true, isAbstract: true }),
    ).toBe("s()$");
  });

  it("reads a type from text or a classifier reference", () => {
    expect(typeText("int")).toBe("int");
    expect(typeText({ name: "Item" })).toBe("Item");
    expect(typeText(null)).toBe("");
    expect(typeText({})).toBe("");
    expect(typeText(3)).toBe("");
  });
});
