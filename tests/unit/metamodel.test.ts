import { beforeEach, describe, expect, it } from "vitest";
import {
  attributeOf,
  isMetaClass,
  lineage,
  ownerField,
  relationshipKind,
  resolveOwnerField,
} from "../../src/metamodel.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("isMetaClass", () => {
  it("accepts classes and rejects enums, unknown and inherited names", () => {
    expect(isMetaClass("UMLClass")).toBe(true);
    expect(isMetaClass("UMLVisibilityKind")).toBe(false);
    expect(isMetaClass("Nope")).toBe(false);
    expect(isMetaClass("toString")).toBe(false);
  });
});

describe("lineage", () => {
  it("lists the type and its ancestors, nearest first", () => {
    expect(lineage("UMLClass")).toEqual([
      "UMLClass",
      "UMLClassifier",
      "UMLModelElement",
      "ExtensibleModel",
      "Model",
      "Element",
    ]);
    expect(lineage("Nope")).toEqual(["Nope"]);
  });
});

describe("attributeOf", () => {
  it("finds own and inherited attributes", () => {
    expect(attributeOf("UMLClass", "isActive")).toMatchObject({
      kind: "prim",
    });
    expect(attributeOf("UMLClass", "name")).toMatchObject({ type: "String" });
    expect(attributeOf("UMLClass", "nope")).toBeUndefined();
  });
});

describe("ownerField", () => {
  it.each([
    ["UMLClass", "UMLAttribute", "attributes"],
    ["UMLClass", "UMLOperation", "operations"],
    ["UMLClass", "Tag", "tags"],
    ["UMLClass", "UMLClass", "ownedElements"],
    ["UMLInteraction", "UMLMessage", "messages"],
    ["UMLActivity", "UMLControlFlow", "edges"],
    ["ERDEntity", "ERDColumn", "columns"],
    ["UMLOperation", "UMLParameter", "parameters"],
    // Three equally specific lists; the first declared wins.
    ["UMLOperation", "UMLConstraint", "preconditions"],
  ])("files %s's %s under %s", (owner, child, field) => {
    expect(ownerField(create(owner), child)).toBe(field);
  });

  it("returns null when no list fits, e.g. for a view owner or an unknown type", () => {
    expect(ownerField(create("UMLClassView"), "UMLClass")).toBeNull();
    expect(ownerField(env.model, "NoSuchType")).toBeNull();
  });
});

describe("resolveOwnerField", () => {
  it("defaults to ownerField", () => {
    expect(
      resolveOwnerField(create("UMLClass"), "UMLAttribute", undefined),
    ).toBe("attributes");
  });

  it("refuses an owner without a fitting list", () => {
    expect(() =>
      resolveOwnerField(create("UMLClassView"), "UMLClass", undefined),
    ).toThrow("UMLClassView has no list that holds UMLClass");
  });

  it("accepts an explicit list typed for the child", () => {
    expect(
      resolveOwnerField(create("UMLClass"), "UMLAttribute", "ownedElements"),
    ).toBe("ownedElements");
  });

  it.each([
    ["nope", "UMLClass has no owned-element list 'nope'"],
    ["name", "UMLClass has no owned-element list 'name'"],
    ["operations", "UMLClass.operations holds UMLOperation, not UMLAttribute"],
  ])("refuses the field %s", (field, message) => {
    expect(() =>
      resolveOwnerField(create("UMLClass"), "UMLAttribute", field),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", message }));
  });
});

describe("relationshipKind", () => {
  it.each([
    ["UMLGeneralization", "directed"],
    ["UMLMessage", "directed"],
    ["UMLAssociation", "undirected"],
    ["ERDRelationship", "undirected"],
    ["UMLClass", null],
    ["Nope", null],
  ])("%s is %s", (name, kind) => {
    expect(relationshipKind(name)).toBe(kind);
  });
});
