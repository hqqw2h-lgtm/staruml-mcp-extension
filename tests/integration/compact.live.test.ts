import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, type Envelope, type Summary } from "./support.js";

interface Page {
  count: number;
  elements: Record<string, unknown>[];
  nextCursor: string | null;
}

/** True when `value` holds an element object rather than a {$ref}. */
function inlinesElement(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(inlinesElement);
  if (value === null || typeof value !== "object") return false;
  return "_id" in value;
}

async function allPages(body: Record<string, unknown>): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const res: Envelope<Page> = await call<Page>("/find_elements", {
      ...body,
      ...(cursor && { cursor }),
    });
    expect(res.success, res.error).toBe(true);
    pages.push(res.data);
    cursor = res.data.nextCursor;
  } while (cursor);
  return pages;
}

// Issue #8: summary by default, projection, pagination and error codes on 7.1.1.
describeLive("compact responses against StarUML 7.1.1", () => {
  let projectId = "";
  let modelId = "";
  let diagramId = "";
  let classId = "";
  let attributeId = "";
  let viewId = "";

  beforeAll(async () => {
    const created = await call<{ project: Summary }>("/new_project");
    projectId = created.data.project._id;
    modelId = (
      await call<Summary>("/create_element", {
        type: "UMLModel",
        parentId: projectId,
        name: "Compact",
      })
    ).data._id;
    diagramId = (
      await call<Summary>("/create_diagram", {
        type: "UMLClassDiagram",
        parentId: modelId,
      })
    ).data._id;
    const views = [];
    for (const [name, x] of [
      ["Book", 20],
      ["Author", 300],
    ] as const) {
      views.push(
        (
          await call<{ view: Summary; model: Summary }>(
            "/create_element_with_view",
            { type: "UMLClass", parentId: modelId, diagramId, name, x, y: 20 },
          )
        ).data,
      );
    }
    classId = views[0]!.model._id;
    viewId = views[0]!.view._id;
    await call("/create_edge_with_view", {
      type: "UMLAssociation",
      parentId: modelId,
      diagramId,
      tailViewId: views[0]!.view._id,
      headViewId: views[1]!.view._id,
    });
    attributeId = (
      await call<Summary>("/create_element", {
        type: "UMLAttribute",
        parentId: classId,
        name: "title",
      })
    ).data._id;
    for (let i = 0; i < 25; i++) {
      await call("/create_element", {
        type: "UMLClass",
        parentId: modelId,
        name: `Paged${i}`,
      });
    }
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("answers every read with summaries by default", async () => {
    const info = await call<{ project: Summary }>("/get_project_info");
    expect(info.data.project).toEqual({
      _id: projectId,
      _type: "Project",
      name: expect.any(String),
      _parent: null,
    });
    const read = await call<Summary>("/get_element_by_id", { id: classId });
    expect(read.data).toEqual({
      _id: classId,
      _type: "UMLClass",
      name: "Book",
      _parent: modelId,
    });
    const found = await call<Page>("/find_elements", { type: "UMLClass" });
    for (const elem of found.data.elements) {
      expect(Object.keys(elem).sort()).toEqual([
        "_id",
        "_parent",
        "_type",
        "name",
      ]);
    }
  });

  it("returns every saved attribute with summary:false, references as {$ref}", async () => {
    const full = await call<Record<string, unknown>>("/get_element_by_id", {
      id: classId,
      summary: false,
    });
    expect(full.data).toMatchObject({
      _id: classId,
      _type: "UMLClass",
      _parent: modelId,
      name: "Book",
      visibility: "public",
      isAbstract: false,
    });
    // /create_element files a UMLAttribute in the class's `attributes` list (#5).
    expect(full.data.attributes).toEqual([{ $ref: attributeId }]);
    for (const value of Object.values(full.data)) {
      expect(inlinesElement(value)).toBe(false);
    }
  });

  it("returns only the requested fields", async () => {
    expect(
      await call("/get_element_by_id", {
        id: classId,
        fields: ["isAbstract", "_parent"],
      }),
    ).toMatchObject({
      data: {
        _id: classId,
        _type: "UMLClass",
        isAbstract: false,
        _parent: modelId,
      },
    });
    const res = await call<Record<string, unknown>>("/get_element_by_id", {
      id: classId,
      fields: ["isAbstract"],
    });
    expect(Object.keys(res.data).sort()).toEqual([
      "_id",
      "_type",
      "isAbstract",
    ]);
  });

  it("expands owned elements to the requested depth", async () => {
    const shallow = await call<{ ownedElements: unknown[] }>(
      "/get_element_by_id",
      { id: modelId, fields: ["ownedElements"] },
    );
    expect(shallow.data.ownedElements.every((e) => !inlinesElement(e))).toBe(
      true,
    );
    const deep = await call<{
      ownedElements: { _id: string; name?: string; attributes: unknown[] }[];
    }>("/get_element_by_id", {
      id: modelId,
      fields: ["ownedElements", "name", "attributes"],
      depth: 1,
    });
    const book = deep.data.ownedElements.find((e) => e._id === classId)!;
    expect(book.name).toBe("Book");
    expect(book.attributes).toEqual([{ $ref: attributeId }]);
  });

  it("projects every element of a real project without inlining references", async () => {
    const pages = await allPages({ summary: false, limit: 50 });
    const elements = pages.flatMap((p) => p.elements);
    expect(elements.length).toBe(pages[0]!.count);
    const types = new Set(elements.map((e) => e._type));
    for (const t of [
      "Project",
      "UMLModel",
      "UMLClassDiagram",
      "UMLClass",
      "UMLClassView",
      "UMLAssociation",
      "UMLAssociationEnd",
      "UMLAssociationView",
      "UMLAttribute",
    ]) {
      expect(types).toContain(t);
    }
    for (const elem of elements) {
      expect(typeof elem._id).toBe("string");
      for (const [key, value] of Object.entries(elem)) {
        expect(inlinesElement(value), `${String(elem._type)}.${key}`).toBe(
          false,
        );
      }
    }
  });

  it("pages through find_elements with a cursor, in id order, without repeats", async () => {
    const pages = await allPages({ type: "UMLClass", limit: 10 });
    expect(pages.map((p) => p.elements.length)).toEqual([10, 10, 7]);
    expect(pages.at(-1)!.nextCursor).toBeNull();
    const ids = pages.flatMap((p) => p.elements.map((e) => e._id as string));
    expect(new Set(ids).size).toBe(27);
    expect(ids).toEqual([...ids].sort());
    expect(pages[0]!.count).toBe(27);
  });

  it("answers invalid input with INVALID_ARGUMENT and the failing paths, without a stack", async () => {
    const res = await call("/find_elements", { limit: 0, depth: "deep" });
    expect(res).toMatchObject({
      status: 400,
      code: "INVALID_ARGUMENT",
    });
    const paths = (
      (res as unknown as { details: { path: string }[] }).details ?? []
    ).map((d) => d.path);
    expect(paths.sort()).toEqual(["depth", "limit"]);
    for (const failure of [
      res,
      await call("/get_element_by_id", { id: "nope" }),
      // A view is not a Model, so the factory's precondition refuses it.
      await call("/create_element", { type: "UMLClass", parentId: viewId }),
    ]) {
      expect(failure.success).toBe(false);
      expect(failure.code).toMatch(/^[A-Z_]+$/);
      expect(failure.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(failure)).not.toMatch(/\n\s+at /);
    }
  });
});
