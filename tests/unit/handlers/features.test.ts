import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAttribute,
  addEnumerationLiteral,
  addOperation,
  addParameter,
  addSlot,
  addTag,
  addTemplateParameter,
  setDocumentation,
  setStereotype,
} from "../../../src/handlers/features.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
let cls: Element;

beforeEach(() => {
  env = installMockApp();
  cls = env.app.factory.createModel({
    id: "UMLClass",
    parent: env.model,
    modelInitializer: (m) => {
      m.name = "Book";
    },
  })!;
});

function stored(id: unknown): Element {
  return env.app.repository.get(id as string) as Element;
}

describe("/add_attribute", () => {
  it("adds a typed attribute with its UML properties", async () => {
    const data = await ok(addAttribute, {
      ownerId: cls._id,
      name: "author",
      type: { $ref: cls._id },
      visibility: "private",
      multiplicity: "1..*",
      defaultValue: "none",
      isStatic: true,
      isReadOnly: true,
      isDerived: false,
      isID: true,
      aggregation: "shared",
      documentation: "who wrote it",
      properties: { isOrdered: true },
      summary: false,
    });
    expect(data).toMatchObject({
      _type: "UMLAttribute",
      _parent: cls._id,
      name: "author",
      type: { $ref: cls._id },
      visibility: "private",
      multiplicity: "1..*",
      defaultValue: "none",
      isStatic: true,
      isReadOnly: true,
      isID: true,
      aggregation: "shared",
      documentation: "who wrote it",
      isOrdered: true,
    });
    expect(cls.attributes).toEqual([stored(data._id)]);
  });

  it("takes a type name as text", async () => {
    expect(
      await ok(addAttribute, {
        ownerId: cls._id,
        name: "title",
        type: "String",
        fields: ["type"],
      }),
    ).toMatchObject({ type: "String" });
  });

  it("refuses an owner without attributes and an unknown visibility", async () => {
    await fails(
      addAttribute,
      { ownerId: env.model._id, name: "x" },
      "INVALID_ARGUMENT",
      "UMLModel has no owned-element list 'attributes'",
    );
    await fails(
      addAttribute,
      { ownerId: cls._id, name: "x", visibility: "secret" },
      "INVALID_ARGUMENT",
      /^visibility: /,
    );
    await fails(
      addAttribute,
      { ownerId: "missing", name: "x" },
      "NOT_FOUND",
      "Owner not found: missing",
    );
  });
});

describe("/add_operation", () => {
  it("adds an operation with parameters and a return parameter in one creation", async () => {
    const spy = vi.spyOn(env.app.factory, "createModel");
    const data = await ok<{
      _id: string;
      parameters: Record<string, unknown>[];
    }>(addOperation, {
      ownerId: cls._id,
      name: "lend",
      visibility: "protected",
      isAbstract: true,
      isQuery: false,
      isStatic: false,
      specification: "body",
      documentation: "Lends it",
      parameters: [
        { name: "to", type: { $ref: cls._id }, direction: "in" },
        {
          name: "days",
          type: "int",
          multiplicity: "1",
          defaultValue: "14",
          isReadOnly: true,
          documentation: "loan period",
          properties: { isOrdered: true },
        },
      ],
      returnType: "boolean",
      fields: [
        "name",
        "parameters",
        "type",
        "direction",
        "defaultValue",
        "isAbstract",
      ],
      depth: 1,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({
      name: "lend",
      isAbstract: true,
      parameters: [
        { name: "to", type: { $ref: cls._id }, direction: "in" },
        { name: "days", type: "int", defaultValue: "14" },
        { name: "", type: "boolean", direction: "return" },
      ],
    });
    const op = stored(data._id);
    expect(cls.operations).toEqual([op]);
    for (const p of op.parameters as Element[]) {
      expect(p._parent).toBe(op);
      expect(stored(p._id)).toBe(p);
    }
  });

  it("adds a bare operation", async () => {
    const data = await ok(addOperation, { ownerId: cls._id, name: "f" });
    expect(stored(data._id).parameters).toEqual([]);
  });

  it("checks every parameter before creating anything", async () => {
    const spy = vi.spyOn(env.app.factory, "createModel");
    await fails(
      addOperation,
      {
        ownerId: cls._id,
        name: "f",
        parameters: [{ name: "x", properties: { colour: 1 } }],
      },
      "INVALID_ARGUMENT",
      "UMLParameter has no field 'colour'",
    );
    await fails(
      addOperation,
      {
        ownerId: cls._id,
        name: "f",
        parameters: [{ name: "x", direction: "up" }],
      },
      "INVALID_ARGUMENT",
      /^parameters\.0\.direction: /,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("/add_parameter", () => {
  it("adds a parameter to an operation", async () => {
    const op = await ok(addOperation, { ownerId: cls._id, name: "f" });
    const data = await ok(addParameter, {
      operationId: op._id,
      name: "x",
      type: "int",
      direction: "out",
      fields: ["direction", "_parent"],
    });
    expect(data).toMatchObject({ direction: "out", _parent: op._id });
  });

  it("refuses an owner that is not a behavioral feature", async () => {
    await fails(
      addParameter,
      { operationId: cls._id, name: "x" },
      "INVALID_ARGUMENT",
      "UMLClass has no owned-element list 'parameters'",
    );
  });
});

describe("/add_enumeration_literal", () => {
  it("adds a literal with documentation", async () => {
    const e = env.app.factory.createModel({
      id: "UMLEnumeration",
      parent: env.model,
    })!;
    const data = await ok(addEnumerationLiteral, {
      enumerationId: e._id,
      name: "RED",
      documentation: "red",
      fields: ["name", "documentation"],
    });
    expect(data).toMatchObject({ name: "RED", documentation: "red" });
    expect(e.literals).toEqual([stored(data._id)]);
  });

  it("refuses a class", async () => {
    await fails(
      addEnumerationLiteral,
      { enumerationId: cls._id, name: "X" },
      "INVALID_ARGUMENT",
    );
  });
});

describe("/add_template_parameter", () => {
  it("adds a template parameter with type and default", async () => {
    const data = await ok(addTemplateParameter, {
      ownerId: cls._id,
      name: "T",
      parameterType: "class",
      defaultValue: { $ref: cls._id },
      fields: ["parameterType", "defaultValue"],
    });
    expect(data).toMatchObject({
      parameterType: "class",
      defaultValue: { $ref: cls._id },
    });
    expect(cls.templateParameters).toEqual([stored(data._id)]);
  });
});

describe("/add_slot", () => {
  it("adds a slot bound to an attribute", async () => {
    const obj = env.app.factory.createModel({
      id: "UMLObject",
      parent: env.model,
    })!;
    const attr = await ok(addAttribute, { ownerId: cls._id, name: "title" });
    const data = await ok(addSlot, {
      instanceId: obj._id,
      name: "title",
      definingFeature: attr._id,
      value: '"Dune"',
      fields: ["definingFeature", "value"],
    });
    expect(data).toMatchObject({
      definingFeature: { $ref: attr._id },
      value: '"Dune"',
    });
    expect(obj.slots).toEqual([stored(data._id)]);
  });

  it("refuses a defining feature that is not a structural feature", async () => {
    const obj = env.app.factory.createModel({
      id: "UMLObject",
      parent: env.model,
    })!;
    await fails(
      addSlot,
      { instanceId: obj._id, definingFeature: { $ref: cls._id } },
      "INVALID_ARGUMENT",
      /expects a UMLStructuralFeature, got UMLClass/,
    );
  });
});

describe("/add_tag", () => {
  it.each([
    ["string", "v", "value"],
    ["enum", "a", "value"],
    ["number", 3, "number"],
    ["boolean", true, "checked"],
  ])("stores a %s tag's value in %s", async (kind, value, field) => {
    const data = await ok(addTag, {
      elementId: cls._id,
      name: "t",
      kind,
      value,
      fields: ["kind", field],
    });
    expect(data).toMatchObject({ kind, [field]: value });
    expect(cls.tags).toEqual([stored(data._id)]);
  });

  it("stores a reference tag and the hidden flag", async () => {
    expect(
      await ok(addTag, {
        elementId: cls._id,
        name: "see",
        kind: "reference",
        value: cls._id,
        hidden: true,
        fields: ["reference", "hidden"],
      }),
    ).toMatchObject({ reference: { $ref: cls._id }, hidden: true });
  });

  it("checks the value against the kind", async () => {
    await fails(
      addTag,
      { elementId: cls._id, name: "n", kind: "number", value: "3" },
      "INVALID_ARGUMENT",
      /Tag.number .* expects a Integer/,
    );
  });
});

describe("/set_stereotype", () => {
  it("sets a name, a UMLStereotype reference, or clears it", async () => {
    expect(
      await ok(setStereotype, {
        elementId: cls._id,
        stereotype: "entity",
        fields: ["stereotype"],
      }),
    ).toMatchObject({ stereotype: "entity" });
    const st = env.app.factory.createModel({
      id: "UMLStereotype",
      parent: env.model,
    })!;
    await ok(setStereotype, {
      elementId: cls._id,
      stereotype: { $ref: st._id },
    });
    expect(cls.stereotype).toBe(st);
    await ok(setStereotype, { elementId: cls._id, stereotype: null });
    expect(cls.stereotype).toBeNull();
  });

  it("refuses elements without a stereotype and reports engine failures", async () => {
    await fails(
      setStereotype,
      { elementId: env.mainDiagram._id, stereotype: "x" },
      "INVALID_ARGUMENT",
      "UMLClassDiagram has no field 'stereotype'",
    );
    vi.spyOn(env.app.engine, "setProperty").mockImplementation(() => {
      throw new Error("locked");
    });
    await fails(
      setStereotype,
      { elementId: cls._id, stereotype: "x" },
      "STARUML_ERROR",
      "locked",
    );
  });
});

describe("/set_documentation", () => {
  it("replaces the documentation", async () => {
    expect(
      await ok(setDocumentation, {
        elementId: cls._id,
        documentation: "A book.",
        fields: ["documentation"],
      }),
    ).toMatchObject({ documentation: "A book." });
  });

  it("requires a text", async () => {
    await fails(
      setDocumentation,
      { elementId: cls._id },
      "INVALID_ARGUMENT",
      /^documentation: /,
    );
  });
});
