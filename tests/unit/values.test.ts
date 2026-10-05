import { beforeEach, describe, expect, it } from "vitest";
import { attributeOf } from "../../src/metamodel.js";
import type { MetaAttribute } from "../../src/types.js";
import {
  refId,
  settableAttribute,
  toModelValue,
  toModelValues,
} from "../../src/values.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
} from "../mock/staruml.js";

let env: MockEnvironment;
let cls: Element;

beforeEach(() => {
  env = installMockApp();
  cls = env.app.factory.createModel({ id: "UMLClass", parent: env.model })!;
});

function attr(typeName: string, name: string): MetaAttribute {
  return attributeOf(typeName, name)!;
}

function rejects(call: () => unknown, code: string, message: RegExp): void {
  expect(call).toThrow(
    expect.objectContaining({ code, message: expect.stringMatching(message) }),
  );
}

describe("refId", () => {
  it("reads a bare id or {$ref}", () => {
    expect(refId("A")).toBe("A");
    expect(refId({ $ref: "B" })).toBe("B");
    expect(refId({ $ref: 1 })).toBeNull();
    expect(refId(null)).toBeNull();
    expect(refId(3)).toBeNull();
  });
});

describe("toModelValue", () => {
  it.each([
    ["UMLClass", "name", "Book"],
    ["UMLClass", "isAbstract", true],
    ["Tag", "number", 3],
    ["ParasiticView", "alpha", 1.5],
    ["UMLClass", "visibility", "private"],
  ])("passes a valid %s.%s through", (typeName, name, value) => {
    expect(toModelValue(typeName, attr(typeName, name), value)).toBe(value);
  });

  it.each([
    ["UMLClass", "name", 1, /expects a String/],
    ["UMLClass", "isAbstract", "yes", /expects a Boolean/],
    ["Tag", "number", 1.5, /expects a Integer/],
    ["ParasiticView", "alpha", Infinity, /expects a Real/],
    ["UMLClass", "visibility", "hidden", /expects one of public, protected/],
  ])("rejects %s.%s = %j", (typeName, name, value, message) => {
    rejects(
      () => toModelValue(typeName, attr(typeName, name), value),
      "INVALID_ARGUMENT",
      message,
    );
  });

  it("takes an Image as a string", () => {
    const image: MetaAttribute = { name: "x", kind: "prim", type: "Image" };
    expect(toModelValue("T", image, "data:image/png;base64,")).toBe(
      "data:image/png;base64,",
    );
    rejects(() => toModelValue("T", image, 1), "INVALID_ARGUMENT", /Image/);
  });

  it("accepts any prim value for a prim type without a check", () => {
    const custom: MetaAttribute = { name: "x", kind: "prim", type: "Other" };
    expect(toModelValue("T", custom, { a: 1 })).toEqual({ a: 1 });
  });

  it("treats an enum without literals as having none", () => {
    const orphan: MetaAttribute = { name: "x", kind: "enum", type: "Nope" };
    rejects(
      () => toModelValue("T", orphan, "a"),
      "INVALID_ARGUMENT",
      /one of $/,
    );
  });

  it("resolves a ref from a bare id or {$ref}, and null clears it", () => {
    const end = attr("UMLAssociationEnd", "reference");
    expect(toModelValue("UMLAssociationEnd", end, cls._id)).toBe(cls);
    expect(toModelValue("UMLAssociationEnd", end, { $ref: cls._id })).toBe(cls);
    expect(toModelValue("UMLAssociationEnd", end, null)).toBeNull();
  });

  it("checks a referenced element exists and has the attribute's type", () => {
    const model = attr("View", "model");
    rejects(
      () => toModelValue("View", model, "missing"),
      "NOT_FOUND",
      /^View.model: element not found: missing$/,
    );
    rejects(
      () => toModelValue("View", model, 5),
      "INVALID_ARGUMENT",
      /expects an element id or \{\$ref: id\}/,
    );
    const head = attr("EdgeView", "head");
    rejects(
      () => toModelValue("EdgeView", head, cls._id),
      "INVALID_ARGUMENT",
      /expects a View, got UMLClass/,
    );
  });

  it("resolves every item of a refs list", () => {
    const raised = attr("UMLOperation", "raisedExceptions");
    expect(
      toModelValue("UMLOperation", raised, [cls._id, { $ref: cls._id }]),
    ).toEqual([cls, cls]);
    rejects(
      () => toModelValue("UMLOperation", raised, cls._id),
      "INVALID_ARGUMENT",
      /expects an array of element ids/,
    );
  });

  it("takes a var as a {$ref} element or a plain value", () => {
    const typeAttr = attr("UMLAttribute", "type");
    expect(toModelValue("UMLAttribute", typeAttr, { $ref: cls._id })).toBe(cls);
    // A bare string is a type name, not an id.
    expect(toModelValue("UMLAttribute", typeAttr, cls._id)).toBe(cls._id);
    expect(toModelValue("UMLAttribute", typeAttr, null)).toBeNull();
    rejects(
      () => toModelValue("UMLAttribute", typeAttr, [1]),
      "INVALID_ARGUMENT",
      /expects a string, number, boolean, null or \{\$ref: id\}/,
    );
  });

  it.each([
    ["UMLClass", "attributes"],
    ["UMLAssociation", "end1"],
    ["View", "font"],
  ])("refuses to set the owned or custom attribute %s.%s", (typeName, name) => {
    rejects(
      () => toModelValue(typeName, attr(typeName, name), []),
      "INVALID_ARGUMENT",
      /cannot be set here/,
    );
  });
});

describe("settableAttribute", () => {
  it("rejects unknown names and the identity fields", () => {
    expect(settableAttribute("UMLClass", "name").name).toBe("name");
    for (const name of ["nope", "_id", "_parent"]) {
      rejects(
        () => settableAttribute("UMLClass", name),
        "INVALID_ARGUMENT",
        new RegExp(`^UMLClass has no field '${name}'$`),
      );
    }
  });
});

describe("toModelValues", () => {
  it("converts every property", () => {
    expect(
      toModelValues("UMLAttribute", {
        name: "a",
        type: { $ref: cls._id },
        multiplicity: "*",
      }),
    ).toEqual({ name: "a", type: cls, multiplicity: "*" });
  });
});
