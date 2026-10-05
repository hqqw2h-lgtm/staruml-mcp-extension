import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir } from "./support.js";

interface Ref {
  _id: string;
  name?: string;
}
interface Created {
  view: Ref;
  model: Ref;
}

/** The subset of the .mdj JSON the assertions read. */
interface MdjElement {
  _type: string;
  _id: string;
  name?: string;
  ownedElements?: MdjElement[];
  ownedViews?: MdjElement[];
  model?: { $ref: string };
  tail?: { $ref: string };
  head?: { $ref: string };
  end1?: { reference: { $ref: string } };
  end2?: { reference: { $ref: string } };
}

function flatten(elem: MdjElement): MdjElement[] {
  return [
    elem,
    ...(elem.ownedElements ?? []).flatMap(flatten),
    ...(elem.ownedViews ?? []).flatMap(flatten),
  ];
}

// Issue #1: two classes with views and an association between them on a new
// UMLClassDiagram, checked through the API and in the saved .mdj.
describeLive("class diagram built through create_*_with_view", () => {
  const dir = liveDir();
  let modelId = "";
  let diagramId = "";
  let book: Created;
  let author: Created;
  let wrote: Created;

  beforeAll(async () => {
    await call("/new_project");
    const info = await call<{ project: Ref }>("/get_project_info");
    modelId = (
      await call<Ref>("/create_element", {
        type: "UMLModel",
        parentId: info.data.project._id,
        name: "Library",
      })
    ).data._id;
    diagramId = (
      await call<Ref>("/create_diagram", {
        type: "UMLClassDiagram",
        parentId: modelId,
        name: "Books",
      })
    ).data._id;
    await call("/switch_diagram", { id: diagramId });
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("creates two classes with views", async () => {
    const created = await Promise.all(
      [
        { name: "Book", x: 40 },
        { name: "Author", x: 340 },
      ].map(({ name, x }) =>
        call<Created>("/create_element_with_view", {
          type: "UMLClass",
          parentId: modelId,
          diagramId,
          name,
          x,
          y: 40,
          x2: x + 160,
          y2: 140,
        }),
      ),
    );
    for (const res of created)
      expect(res).toMatchObject({ status: 200, success: true });
    [book, author] = created.map((res) => res.data) as [Created, Created];
    expect(book.model.name).toBe("Book");
    expect(author.model.name).toBe("Author");

    const view = await call<{
      model: Ref;
      _parent: Ref;
      left: number;
      width: number;
    }>("/get_element_by_id", { id: book.view._id });
    expect(view.data).toMatchObject({
      model: { _id: book.model._id, name: "Book" },
      _parent: { _id: diagramId },
      left: 40,
    });
  });

  it("connects them with an association", async () => {
    const res = await call<Created>("/create_edge_with_view", {
      type: "UMLAssociation",
      parentId: modelId,
      diagramId,
      tailViewId: book.view._id,
      headViewId: author.view._id,
      name: "wrote",
    });
    expect(res).toMatchObject({
      status: 200,
      success: true,
      data: { model: { name: "wrote" } },
    });
    wrote = res.data;

    const edge = await call<{ tail: Ref; head: Ref; model: Ref }>(
      "/get_element_by_id",
      {
        id: wrote.view._id,
      },
    );
    expect(edge.data.tail._id).toBe(book.view._id);
    expect(edge.data.head._id).toBe(author.view._id);

    const diagram = await call<{ ownedViews: Ref[] }>("/get_element_by_id", {
      id: diagramId,
    });
    const ownedViewIds = diagram.data.ownedViews.map((v) => v._id);
    expect(ownedViewIds).toEqual(
      expect.arrayContaining([book.view._id, author.view._id, wrote.view._id]),
    );
  });

  it("reports an unknown model-and-view type instead of dereferencing null", async () => {
    expect(
      await call("/create_element_with_view", {
        type: "NoSuchType",
        parentId: modelId,
        diagramId,
      }),
    ).toMatchObject({
      status: 400,
      error: "Unknown model-and-view type: NoSuchType",
    });
  });

  it("writes the classes, views and association to the .mdj", async () => {
    const file = join(dir, "class-diagram.mdj");
    expect(await call("/save_project", { filename: file })).toMatchObject({
      success: true,
    });

    const all = flatten(JSON.parse(readFileSync(file, "utf-8")) as MdjElement);
    const byId = new Map(all.map((e) => [e._id, e]));

    expect(byId.get(book.model._id)).toMatchObject({
      _type: "UMLClass",
      name: "Book",
    });
    expect(byId.get(author.model._id)).toMatchObject({
      _type: "UMLClass",
      name: "Author",
    });
    expect(byId.get(diagramId)).toMatchObject({
      _type: "UMLClassDiagram",
      name: "Books",
    });
    expect(byId.get(book.view._id)).toMatchObject({
      _type: "UMLClassView",
      model: { $ref: book.model._id },
    });

    const association = byId.get(wrote.model._id)!;
    expect(association).toMatchObject({
      _type: "UMLAssociation",
      name: "wrote",
    });
    expect(association.end1?.reference.$ref).toBe(book.model._id);
    expect(association.end2?.reference.$ref).toBe(author.model._id);
    expect(byId.get(wrote.view._id)).toMatchObject({
      _type: "UMLAssociationView",
      model: { $ref: wrote.model._id },
      tail: { $ref: book.view._id },
      head: { $ref: author.view._id },
    });
  });
});
