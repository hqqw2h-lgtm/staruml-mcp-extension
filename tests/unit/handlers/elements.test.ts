import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElement,
  DEFAULT_PAGE_SIZE,
  deleteElement,
  findElements,
  getElementById,
  updateElement,
} from "../../../src/handlers/elements.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
  type View,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function addClass(name: string): Element {
  return env.app.factory.createModel({
    id: "UMLClass",
    parent: env.model,
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

function addClassWithView(name: string, x: number): View {
  return env.app.factory.createModelAndView({
    id: "UMLClass",
    parent: env.model,
    diagram: env.mainDiagram,
    x1: x,
    y1: 0,
    x2: x + 100,
    y2: 50,
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

describe("/get_element_by_id", () => {
  it.each([{}, { id: "" }, { id: 1 }])("requires an id: %j", async (body) => {
    await fails(getElementById, body, "INVALID_ARGUMENT", /^id: /);
  });

  it("rejects an unknown id", async () => {
    await fails(
      getElementById,
      { id: "missing" },
      "NOT_FOUND",
      "Element not found: missing",
    );
  });

  it("returns the summary by default", async () => {
    const cls = addClass("Book");
    expect(await ok(getElementById, { id: cls._id })).toEqual({
      _id: cls._id,
      _type: "UMLClass",
      name: "Book",
      _parent: env.model._id,
    });
  });

  it("returns every attribute with references as {$ref} on request", async () => {
    const view = addClassWithView("Book", 0);
    expect(
      await ok(getElementById, { id: view._id, summary: false }),
    ).toMatchObject({
      _type: "UMLClassView",
      _parent: env.mainDiagram._id,
      model: { $ref: view.model!._id },
      left: 0,
    });
  });

  it("applies fields and depth", async () => {
    const cls = addClass("Book");
    expect(
      await ok(getElementById, {
        id: env.model._id,
        fields: ["ownedElements", "name"],
        depth: 1,
      }),
    ).toEqual({
      _id: env.model._id,
      _type: "UMLModel",
      name: "Model",
      ownedElements: [
        {
          _id: env.mainDiagram._id,
          _type: "UMLClassDiagram",
          name: "Main",
          ownedElements: [],
        },
        { _id: cls._id, _type: "UMLClass", name: "Book", ownedElements: [] },
      ],
    });
  });

  it.each([
    [{ summary: "no" }, /^summary: /],
    [{ fields: "name" }, /^fields: /],
    [{ fields: [""] }, /^fields\.0: /],
    [{ depth: -1 }, /^depth: /],
    [{ depth: 9 }, /^depth: /],
    [{ depth: 1.5 }, /^depth: /],
  ])("rejects the projection %j", async (projection, error) => {
    await fails(
      getElementById,
      { id: env.model._id, ...projection },
      "INVALID_ARGUMENT",
      error,
    );
  });
});

describe("/find_elements", () => {
  beforeEach(() => {
    addClass("Book");
    addClass("Author");
  });

  it("finds by type, including subtypes", async () => {
    expect(await ok(findElements, { type: "UMLClass" })).toMatchObject({
      count: 2,
      nextCursor: null,
    });
    expect(await ok(findElements, { type: "UMLClassifier" })).toMatchObject({
      count: 2,
    });
  });

  it("finds by type and name, returning summaries", async () => {
    const data = await ok(findElements, { type: "UMLClass", name: "Author" });
    expect(data).toEqual({
      count: 1,
      elements: [
        {
          _id: expect.any(String),
          _type: "UMLClass",
          name: "Author",
          _parent: env.model._id,
        },
      ],
      nextCursor: null,
    });
  });

  it("finds by name across all types", async () => {
    expect(await ok(findElements, { name: "Model" })).toMatchObject({
      count: 1,
      elements: [{ name: "Model" }],
    });
  });

  it("returns every element without filters", async () => {
    // Project, Model, Main, Book, Author
    expect(await ok(findElements)).toMatchObject({ count: 5 });
  });

  it("projects every element in the page", async () => {
    const data = await ok<{ elements: unknown[] }>(findElements, {
      type: "UMLClass",
      fields: ["isAbstract"],
    });
    for (const elem of data.elements) {
      expect(Object.keys(elem as object).sort()).toEqual([
        "_id",
        "_type",
        "isAbstract",
      ]);
    }
  });

  it("reports an unknown type name instead of the TypeError getInstancesOf throws", async () => {
    await fails(
      findElements,
      { type: "NoSuchType" },
      "UNKNOWN_TYPE",
      "Unknown element type: NoSuchType",
    );
    await fails(findElements, { type: "toString" }, "UNKNOWN_TYPE");
  });

  it.each([{ limit: 0 }, { limit: 1001 }, { cursor: "" }, { type: "" }])(
    "rejects %j",
    async (body) => {
      await fails(findElements, body, "INVALID_ARGUMENT");
    },
  );

  it("pages through the matches in id order with a cursor", async () => {
    for (let i = 0; i < 5; i++) addClass(`C${i}`);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await ok<{
        count: number;
        elements: { _id: string }[];
        nextCursor: string | null;
      }>(findElements, { type: "UMLClass", limit: 3, cursor });
      expect(page.count).toBe(7);
      seen.push(...page.elements.map((e) => e._id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(
      env.app.repository
        .getInstancesOf("UMLClass")
        .map((e) => e._id)
        .sort(),
    );
  });

  it("keeps paging consistent when the element at the cursor is deleted", async () => {
    const first = await ok<{
      elements: { _id: string }[];
      nextCursor: string;
    }>(findElements, { type: "UMLClass", limit: 1 });
    const removed = env.app.repository.get(first.nextCursor)!;
    env.app.engine.deleteElements([removed], []);
    const second = await ok<{ elements: { _id: string }[] }>(findElements, {
      type: "UMLClass",
      cursor: first.nextCursor,
    });
    expect(second.elements.map((e) => e._id)).not.toContain(
      first.elements[0]!._id,
    );
    expect(second.elements).toHaveLength(1);
  });

  it("limits a page to DEFAULT_PAGE_SIZE unless told otherwise", async () => {
    for (let i = 0; i < DEFAULT_PAGE_SIZE; i++) addClass(`P${i}`);
    const data = await ok<{ elements: unknown[]; nextCursor: string | null }>(
      findElements,
      { type: "UMLClass" },
    );
    expect(data.elements).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(data.nextCursor).not.toBeNull();
  });
});

describe("/create_element", () => {
  it.each([{}, { type: "" }])("requires a type: %j", async (body) => {
    await fails(
      createElement,
      { parentId: env.model._id, ...body },
      "INVALID_ARGUMENT",
      /^type: /,
    );
  });

  it.each([{}, { parentId: "" }])("requires a parentId: %j", async (body) => {
    await fails(
      createElement,
      { type: "UMLClass", ...body },
      "INVALID_ARGUMENT",
      /^parentId: /,
    );
  });

  it("rejects an unknown parent", async () => {
    await fails(
      createElement,
      { type: "UMLClass", parentId: "missing" },
      "NOT_FOUND",
      "Parent element not found: missing",
    );
  });

  it("creates a named element and returns its summary", async () => {
    const data = await ok(createElement, {
      type: "UMLClass",
      parentId: env.model._id,
      name: "A",
    });
    expect(data).toMatchObject({
      _type: "UMLClass",
      name: "A",
      _parent: env.model._id,
    });
    expect(env.model.ownedElements).toContain(
      env.app.repository.get(data._id as string),
    );
  });

  it("creates an unnamed element and honours the projection", async () => {
    expect(
      await ok(createElement, {
        type: "UMLClass",
        parentId: env.model._id,
        fields: ["isAbstract"],
      }),
    ).toEqual({
      _id: expect.any(String),
      _type: "UMLClass",
      isAbstract: false,
    });
  });

  it("reports an id the factory does not know, for which it returns null", async () => {
    await fails(
      createElement,
      { type: "Nope", parentId: env.model._id },
      "UNKNOWN_TYPE",
      "Unknown model type: Nope",
    );
  });

  it("reports a factory exception as STARUML_ERROR", async () => {
    vi.spyOn(env.app.factory, "createModel").mockImplementation(() => {
      throw new Error("factory down");
    });
    await fails(
      createElement,
      { type: "UMLClass", parentId: env.model._id },
      "STARUML_ERROR",
      "factory down",
    );
  });
});

describe("/update_element", () => {
  it.each([{}, { id: "" }])("requires an id: %j", async (body) => {
    await fails(
      updateElement,
      { field: "name", value: 1, ...body },
      "INVALID_ARGUMENT",
      /^id: /,
    );
  });

  it("rejects an empty field name", async () => {
    await fails(
      updateElement,
      { id: env.model._id, field: "", value: 1 },
      "INVALID_ARGUMENT",
      /^field: /,
    );
  });

  it("rejects an unknown id", async () => {
    await fails(
      updateElement,
      { id: "missing", field: "name", value: "x" },
      "NOT_FOUND",
      "Element not found: missing",
    );
  });

  it("rejects a field the element does not declare, which setProperty would ignore", async () => {
    const cls = addClass("A");
    await fails(
      updateElement,
      { id: cls._id, field: "colour", value: "red" },
      "INVALID_ARGUMENT",
      "UMLClass has no field 'colour'",
    );
  });

  it("sets the property through the engine and returns the summary", async () => {
    const cls = addClass("A");
    const spy = vi.spyOn(env.app.engine, "setProperty");
    expect(
      await ok(updateElement, { id: cls._id, field: "name", value: "B" }),
    ).toMatchObject({ _id: cls._id, name: "B" });
    expect(spy).toHaveBeenCalledWith(cls, "name", "B");
  });

  it("reports an engine exception as STARUML_ERROR", async () => {
    const cls = addClass("A");
    vi.spyOn(env.app.engine, "setProperty").mockImplementation(() => {
      throw new Error("read only");
    });
    await fails(
      updateElement,
      { id: cls._id, field: "name", value: "B" },
      "STARUML_ERROR",
      "read only",
    );
  });
});

describe("/delete_element", () => {
  it.each([{}, { id: "" }])("requires an id: %j", async (body) => {
    await fails(deleteElement, body, "INVALID_ARGUMENT", /^id: /);
  });

  it("rejects an unknown id", async () => {
    await fails(
      deleteElement,
      { id: "missing" },
      "NOT_FOUND",
      "Element not found: missing",
    );
  });

  it("deletes a class together with its view and the edges attached to it", async () => {
    const book = addClassWithView("Book", 0);
    const author = addClassWithView("Author", 200);
    const edge = env.app.factory.createModelAndView({
      id: "UMLAssociation",
      parent: env.model,
      diagram: env.mainDiagram,
      tailView: book,
      headView: author,
      tailModel: book.model!,
      headModel: author.model!,
    })!;
    const spy = vi.spyOn(env.app.engine, "deleteElements");

    expect(await ok(deleteElement, { id: book.model!._id })).toEqual({
      deleted: book.model!._id,
      models_deleted: 1,
      views_deleted: 2,
    });
    expect(spy).toHaveBeenCalledWith([book.model], [book, edge]);
    expect(env.app.repository.get(book._id)).toBeUndefined();
    expect(env.app.repository.get(edge.model!._id)).toBeUndefined();
    expect(env.app.repository.getInstancesOf("UMLAssociation")).toEqual([]);
    expect(env.app.repository.get(author._id)).toBe(author);
  });

  it("deletes a diagram with the views it owns but not their models", async () => {
    const view = addClassWithView("Book", 0);
    expect(await ok(deleteElement, { id: env.mainDiagram._id })).toMatchObject({
      models_deleted: 1,
      views_deleted: 1,
    });
    expect(env.app.repository.get(view._id)).toBeUndefined();
    expect(env.app.repository.get(view.model!._id)).toBe(view.model);
  });

  it("collects a view reachable both from its diagram and from its model once", async () => {
    const view = addClassWithView("Book", 0);
    // Model, Main and Book; Book's view is owned by Main and is a view of Book.
    expect(await ok(deleteElement, { id: env.model._id })).toMatchObject({
      models_deleted: 3,
      views_deleted: 1,
    });
    expect(env.app.repository.get(view._id)).toBeUndefined();
  });

  it("reports an engine exception as STARUML_ERROR", async () => {
    const cls = addClass("A");
    vi.spyOn(env.app.engine, "deleteElements").mockImplementation(() => {
      throw new Error("locked");
    });
    await fails(deleteElement, { id: cls._id }, "STARUML_ERROR", "locked");
  });
});

describe("/create_element (#5)", () => {
  it("files the element in the owner list typed for it", async () => {
    const cls = addClass("Book");
    const data = await ok(createElement, {
      type: "UMLAttribute",
      parentId: cls._id,
      name: "title",
    });
    expect(cls.attributes).toContainEqual(
      env.app.repository.get(data._id as string),
    );
  });

  it("takes an explicit list and initial properties, references by id", async () => {
    const cls = addClass("Book");
    const data = await ok(createElement, {
      type: "UMLAttribute",
      parentId: cls._id,
      field: "ownedElements",
      properties: { type: { $ref: cls._id }, multiplicity: "*" },
      fields: ["type", "multiplicity", "_parent"],
    });
    expect(data).toMatchObject({
      _parent: cls._id,
      type: { $ref: cls._id },
      multiplicity: "*",
    });
    expect(cls.ownedElements).toHaveLength(1);
  });

  it("checks properties and the list before calling StarUML", async () => {
    const spy = vi.spyOn(env.app.factory, "createModel");
    await fails(
      createElement,
      {
        type: "UMLClass",
        parentId: env.model._id,
        properties: { isAbstract: "yes" },
      },
      "INVALID_ARGUMENT",
      /isAbstract/,
    );
    await fails(
      createElement,
      { type: "UMLClass", parentId: env.model._id, field: "attributes" },
      "INVALID_ARGUMENT",
      "UMLModel has no owned-element list 'attributes'",
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("/update_element (#5)", () => {
  let cls: Element;
  let other: Element;

  beforeEach(() => {
    cls = addClass("A");
    other = addClass("B");
  });

  function addAttribute(owner: Element, name: string): Element {
    return env.app.factory.createModel({
      id: "UMLAttribute",
      parent: owner,
      field: "attributes",
      modelInitializer: (m) => {
        m.name = name;
      },
    })!;
  }

  describe("set", () => {
    it("sets a reference by id or {$ref} and clears it with null", async () => {
      const attr = addAttribute(cls, "b");
      expect(
        await ok(updateElement, {
          id: attr._id,
          field: "type",
          value: { $ref: other._id },
          fields: ["type"],
        }),
      ).toMatchObject({ type: { $ref: other._id } });
      expect(attr.type).toBe(other);
      const end = (
        env.app.factory.createModelAndView({
          id: "UMLAssociation",
          parent: env.model,
          diagram: env.mainDiagram,
        })!.model!.end1 as Element
      )._id;
      await ok(updateElement, { id: end, field: "reference", value: cls._id });
      expect(env.app.repository.get(end)!.reference).toBe(cls);
      await ok(updateElement, { id: end, field: "reference", value: null });
      expect(env.app.repository.get(end)!.reference).toBeNull();
    });

    it("needs field and value", async () => {
      await fails(
        updateElement,
        { id: cls._id, value: 1 },
        "INVALID_ARGUMENT",
        "set needs field",
      );
      await fails(
        updateElement,
        { id: cls._id, field: "name" },
        "INVALID_ARGUMENT",
        "set needs value",
      );
    });

    it("refuses owned and custom attributes and values of the wrong kind", async () => {
      await fails(
        updateElement,
        { id: cls._id, field: "attributes", value: [] },
        "INVALID_ARGUMENT",
        /cannot be set here/,
      );
      await fails(
        updateElement,
        { id: cls._id, field: "isAbstract", value: "true" },
        "INVALID_ARGUMENT",
        /expects a Boolean/,
      );
    });
  });

  describe("add and remove", () => {
    let op: Element;

    beforeEach(() => {
      op = env.app.factory.createModel({
        id: "UMLOperation",
        parent: cls,
        field: "operations",
      })!;
    });

    it("adds one or several references once each, and removes them", async () => {
      await ok(updateElement, {
        id: op._id,
        op: "add",
        field: "raisedExceptions",
        value: other._id,
      });
      await ok(updateElement, {
        id: op._id,
        op: "add",
        field: "raisedExceptions",
        value: [{ $ref: other._id }, cls._id],
      });
      expect(op.raisedExceptions).toEqual([other, cls]);
      expect(
        await ok(updateElement, {
          id: op._id,
          op: "remove",
          field: "raisedExceptions",
          value: [other._id, other._id],
          fields: ["raisedExceptions"],
        }),
      ).toMatchObject({ raisedExceptions: [{ $ref: cls._id }] });
    });

    it("only works on reference lists", async () => {
      await fails(
        updateElement,
        { id: cls._id, op: "add", field: "attributes", value: other._id },
        "INVALID_ARGUMENT",
        /^add needs a reference list; UMLClass.attributes is objs/,
      );
    });

    it("checks the referenced elements", async () => {
      await fails(
        updateElement,
        { id: op._id, op: "add", field: "raisedExceptions", value: "missing" },
        "NOT_FOUND",
      );
    });
  });

  describe("reorder", () => {
    it("moves an owned item to an index as one operation", async () => {
      const [x, y, z] = ["x", "y", "z"].map((n) => addAttribute(cls, n));
      const spy = vi.spyOn(env.app.repository, "doOperation");
      await ok(updateElement, {
        id: cls._id,
        op: "reorder",
        field: "attributes",
        value: z!._id,
        index: 0,
      });
      expect(cls.attributes).toEqual([z, x, y]);
      expect(spy).toHaveBeenCalledTimes(1);
      await ok(updateElement, {
        id: cls._id,
        op: "reorder",
        field: "attributes",
        value: { $ref: z!._id },
        index: 2,
      });
      expect(cls.attributes).toEqual([x, y, z]);
    });

    it.each([
      [
        { field: "name", value: "x", index: 0 },
        "INVALID_ARGUMENT",
        /^reorder needs a list/,
      ],
      [
        { field: "attributes", value: "x" },
        "INVALID_ARGUMENT",
        /^reorder needs index$/,
      ],
      [
        { field: "attributes", value: "nope", index: 0 },
        "NOT_FOUND",
        /^nope is not in UMLClass.attributes$/,
      ],
      [
        { field: "attributes", value: 5, index: 0 },
        "NOT_FOUND",
        /^null is not in/,
      ],
      [
        { field: "attributes", value: "FIRST", index: 1 },
        "INVALID_ARGUMENT",
        /^index 1 is past the end of UMLClass.attributes \(1 items\)$/,
      ],
    ])("refuses %j", async (body, code, message) => {
      const first = addAttribute(cls, "only");
      const value = body.value === "FIRST" ? first._id : body.value;
      await fails(
        updateElement,
        { id: cls._id, op: "reorder", ...body, value },
        code as "INVALID_ARGUMENT",
        message,
      );
    });
  });

  describe("relocate", () => {
    it("moves an element to another owner, keeping its list", async () => {
      const pkg = env.app.factory.createModel({
        id: "UMLPackage",
        parent: env.model,
      })!;
      expect(
        await ok(updateElement, {
          id: cls._id,
          op: "relocate",
          parentId: pkg._id,
          fields: ["_parent"],
        }),
      ).toEqual({ _id: cls._id, _type: "UMLClass", _parent: pkg._id });
      expect(pkg.ownedElements).toContain(cls);
      expect(env.model.ownedElements).not.toContain(cls);
    });

    it("moves an attribute between classes", async () => {
      const attr = addAttribute(cls, "a");
      await ok(updateElement, {
        id: attr._id,
        op: "relocate",
        parentId: other._id,
        field: "attributes",
      });
      expect(other.attributes).toEqual([attr]);
    });

    it("does nothing for the current owner", async () => {
      const spy = vi.spyOn(env.app.engine, "relocate");
      await ok(updateElement, {
        id: cls._id,
        op: "relocate",
        parentId: env.model._id,
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it("needs parentId", async () => {
      await fails(
        updateElement,
        { id: cls._id, op: "relocate" },
        "INVALID_ARGUMENT",
        "relocate needs parentId",
      );
    });

    it("refuses a different list, an owner without the list, and moving into itself", async () => {
      const attr = addAttribute(cls, "a");
      await fails(
        updateElement,
        {
          id: attr._id,
          op: "relocate",
          parentId: other._id,
          field: "ownedElements",
        },
        "INVALID_ARGUMENT",
        `relocate keeps the list field: ${attr._id} is in 'attributes', not 'ownedElements'`,
      );
      await fails(
        updateElement,
        { id: attr._id, op: "relocate", parentId: env.model._id },
        "INVALID_ARGUMENT",
        "UMLModel has no list field 'attributes'",
      );
      const inner = env.app.factory.createModel({
        id: "UMLPackage",
        parent: cls,
      })!;
      for (const target of [cls, inner]) {
        await fails(
          updateElement,
          { id: cls._id, op: "relocate", parentId: target._id },
          "INVALID_ARGUMENT",
          `${target._id} is ${cls._id} itself or inside it`,
        );
      }
    });

    it("refuses elements that are not in a list of their owner", async () => {
      const end = env.app.factory.createModelAndView({
        id: "UMLAssociation",
        parent: env.model,
        diagram: env.mainDiagram,
      })!.model!.end1 as Element;
      await fails(
        updateElement,
        { id: end._id, op: "relocate", parentId: other._id },
        "INVALID_ARGUMENT",
        `UMLAssociationEnd ${end._id} is not in a list of its owner and cannot be relocated`,
      );
      await fails(
        updateElement,
        { id: env.project._id, op: "relocate", parentId: other._id },
        "INVALID_ARGUMENT",
        /is not in a list of its owner/,
      );
    });

    it("reports a relocation StarUML did not perform", async () => {
      const pkg = env.app.factory.createModel({
        id: "UMLPackage",
        parent: env.model,
      })!;
      vi.spyOn(env.app.engine, "relocate").mockImplementation(() => {});
      await fails(
        updateElement,
        { id: cls._id, op: "relocate", parentId: pkg._id },
        "STARUML_ERROR",
        `StarUML did not relocate ${cls._id} to ${pkg._id}`,
      );
    });
  });

  it("rejects an unknown op", async () => {
    await fails(
      updateElement,
      { id: cls._id, op: "merge" },
      "INVALID_ARGUMENT",
      /^op: /,
    );
  });
});
