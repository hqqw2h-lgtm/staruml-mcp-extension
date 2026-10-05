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

  it.each([{}, { field: "" }])("requires a field: %j", async (body) => {
    await fails(
      updateElement,
      { id: "x", ...body },
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
