import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElement,
  deleteElement,
  findElements,
  getElementById,
  updateElement,
} from "../../../src/handlers/elements.js";
import {
  installMockApp,
  UMLClass,
  type MockEnvironment,
  type View,
} from "../../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function addClass(name: string): UMLClass {
  return env.app.factory.createModel({
    id: "UMLClass",
    parent: env.model,
    modelInitializer: (m) => {
      m.name = name;
    },
  }) as UMLClass;
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

describe("getElementById", () => {
  it.each([{}, { id: "" }, { id: 1 }])("requires an id: %j", async (body) => {
    expect(await getElementById(body)).toEqual({
      success: false,
      error: "Required field 'id' (string) missing",
    });
  });

  it("rejects an unknown id", async () => {
    expect(await getElementById({ id: "missing" })).toEqual({
      success: false,
      error: "Element not found: missing",
    });
  });

  it("returns own fields with references collapsed to {_id, name}", async () => {
    const cls = addClass("Book");
    const attr = env.app.factory.createModel({
      id: "UMLAttribute",
      parent: cls,
      field: "attributes",
    })!;
    Object.assign(cls, {
      _private: 1,
      tags: ["x", null],
      documentation: undefined,
      note: null,
    });
    const result = await getElementById({ id: cls._id });
    expect(result).toEqual({
      success: true,
      data: {
        _id: cls._id,
        _parent: { _id: env.model._id, name: "Model" },
        name: "Book",
        ownedElements: [],
        attributes: [{ _id: attr._id, name: "" }],
        operations: [],
        tags: ["x", null],
        documentation: undefined,
        note: null,
      },
    });
  });

  it("keeps plain object values as they are", async () => {
    const cls = addClass("Book");
    Object.assign(cls, { bounds: { x: 1 } });
    expect(await getElementById({ id: cls._id })).toMatchObject({
      data: { bounds: { x: 1 } },
    });
  });
});

describe("findElements", () => {
  beforeEach(() => {
    addClass("Book");
    addClass("Author");
  });

  it("finds by type", async () => {
    expect(await findElements({ type: "UMLClass" })).toMatchObject({
      success: true,
      data: { count: 2 },
    });
  });

  it("finds by type and name", async () => {
    const result = await findElements({ type: "UMLClass", name: "Author" });
    expect(result).toMatchObject({
      data: { count: 1, elements: [{ name: "Author" }] },
    });
  });

  it("finds by name across all types", async () => {
    expect(await findElements({ name: "Model" })).toMatchObject({
      data: { count: 1, elements: [{ name: "Model" }] },
    });
  });

  it("returns every element without filters", async () => {
    // Project, Model, Main, Book, Author
    expect(await findElements({})).toMatchObject({ data: { count: 5 } });
  });

  it("reports an unknown type name", async () => {
    expect(await findElements({ type: "NoSuchType" })).toEqual({
      success: false,
      error: "Right-hand side of 'instanceof' is not callable",
    });
  });
});

describe("createElement", () => {
  it.each([{}, { type: "" }])("requires a type: %j", async (body) => {
    expect(await createElement(body)).toEqual({
      success: false,
      error: "Required field 'type' (string) missing, e.g. 'UMLClass'",
    });
  });

  it.each([{ type: "UMLClass" }, { type: "UMLClass", parentId: "" }])(
    "requires a parentId: %j",
    async (body) => {
      expect(await createElement(body)).toEqual({
        success: false,
        error: "Required field 'parentId' (string) missing",
      });
    },
  );

  it("rejects an unknown parent", async () => {
    expect(
      await createElement({ type: "UMLClass", parentId: "missing" }),
    ).toEqual({
      success: false,
      error: "Parent element not found: missing",
    });
  });

  it("creates a named element", async () => {
    const result = await createElement({
      type: "UMLClass",
      parentId: env.model._id,
      name: "A",
    });
    expect(result).toMatchObject({ success: true, data: { name: "A" } });
    expect(env.model.ownedElements.at(-1)).toBeInstanceOf(UMLClass);
  });

  it("creates an unnamed element", async () => {
    expect(
      await createElement({ type: "UMLClass", parentId: env.model._id }),
    ).toMatchObject({
      success: true,
      data: { name: "" },
    });
  });

  it("reports an id the factory does not know, for which it returns null", async () => {
    expect(
      await createElement({ type: "Nope", parentId: env.model._id }),
    ).toEqual({
      success: false,
      error: "Unknown model type: Nope",
    });
  });

  it("reports a factory exception", async () => {
    vi.spyOn(env.app.factory, "createModel").mockImplementation(() => {
      throw new Error("factory down");
    });
    expect(
      await createElement({ type: "UMLClass", parentId: env.model._id }),
    ).toEqual({
      success: false,
      error: "factory down",
    });
  });
});

describe("updateElement", () => {
  it.each([{}, { id: "" }])("requires an id: %j", async (body) => {
    expect(await updateElement(body)).toEqual({
      success: false,
      error: "Required field 'id' missing",
    });
  });

  it.each([{ id: "x" }, { id: "x", field: "" }])(
    "requires a field: %j",
    async (body) => {
      expect(await updateElement(body)).toEqual({
        success: false,
        error: "Required field 'field' missing",
      });
    },
  );

  it("rejects an unknown id", async () => {
    expect(
      await updateElement({ id: "missing", field: "name", value: "x" }),
    ).toEqual({
      success: false,
      error: "Element not found: missing",
    });
  });

  it("rejects a field the element does not declare, which setProperty would ignore", async () => {
    const cls = addClass("A");
    expect(
      await updateElement({ id: cls._id, field: "colour", value: "red" }),
    ).toEqual({
      success: false,
      error: "UMLClass has no field 'colour'",
    });
  });

  it("sets the property through the engine", async () => {
    const cls = addClass("A");
    const spy = vi.spyOn(env.app.engine, "setProperty");
    const result = await updateElement({
      id: cls._id,
      field: "name",
      value: "B",
    });
    expect(result).toMatchObject({ success: true, data: { name: "B" } });
    expect(spy).toHaveBeenCalledWith(cls, "name", "B");
  });

  it("reports an engine exception", async () => {
    const cls = addClass("A");
    vi.spyOn(env.app.engine, "setProperty").mockImplementation(() => {
      throw new Error("read only");
    });
    expect(
      await updateElement({ id: cls._id, field: "name", value: "B" }),
    ).toEqual({
      success: false,
      error: "read only",
    });
  });
});

describe("deleteElement", () => {
  it.each([{}, { id: "" }])("requires an id: %j", async (body) => {
    expect(await deleteElement(body)).toEqual({
      success: false,
      error: "Required field 'id' missing",
    });
  });

  it("rejects an unknown id", async () => {
    expect(await deleteElement({ id: "missing" })).toEqual({
      success: false,
      error: "Element not found: missing",
    });
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

    const result = await deleteElement({ id: book.model!._id });

    expect(result).toEqual({
      success: true,
      data: { deleted: book.model!._id, models_deleted: 1, views_deleted: 2 },
    });
    expect(spy).toHaveBeenCalledWith([book.model], [book, edge]);
    expect(env.app.repository.get(book._id)).toBeUndefined();
    expect(env.app.repository.get(edge.model!._id)).toBeUndefined();
    expect(env.app.repository.getInstancesOf("UMLAssociation")).toEqual([]);
    expect(env.app.repository.get(author._id)).toBe(author);
  });

  it("deletes a diagram with the views it owns but not their models", async () => {
    const view = addClassWithView("Book", 0);
    const result = await deleteElement({ id: env.mainDiagram._id });
    expect(result).toMatchObject({
      data: { models_deleted: 1, views_deleted: 1 },
    });
    expect(env.app.repository.get(view._id)).toBeUndefined();
    expect(env.app.repository.get(view.model!._id)).toBe(view.model);
  });

  it("collects a view reachable both from its diagram and from its model once", async () => {
    const view = addClassWithView("Book", 0);
    const result = await deleteElement({ id: env.model._id });
    // Model, Main and Book; Book's view is owned by Main and is a view of Book.
    expect(result).toMatchObject({
      data: { models_deleted: 3, views_deleted: 1 },
    });
    expect(env.app.repository.get(view._id)).toBeUndefined();
  });

  it("reports an engine exception", async () => {
    const cls = addClass("A");
    vi.spyOn(env.app.engine, "deleteElements").mockImplementation(() => {
      throw new Error("locked");
    });
    expect(await deleteElement({ id: cls._id })).toEqual({
      success: false,
      error: "locked",
    });
  });
});
