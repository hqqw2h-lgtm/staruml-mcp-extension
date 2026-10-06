import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  call,
  describeLive,
  indexMdj,
  liveDir,
  type MdjElement,
  type Summary,
} from "./support.js";

interface Ref {
  $ref: string;
}

// Issue #5: typed parts of elements and every /update_element operation,
// checked through the API, in the saved .mdj, and against undo.
describeLive("element parts and updates against StarUML 7.1.1", () => {
  const dir = liveDir();
  let modelId = "";
  let book = "";
  let author = "";
  const ids: Record<string, string> = {};

  async function read<T = Record<string, unknown>>(
    id: string,
    fields: string[],
    depth = 0,
  ): Promise<T> {
    const res = await call<T>("/get_element_by_id", { id, fields, depth });
    expect(res.success, res.error).toBe(true);
    return res.data;
  }

  async function created(path: string, body: Record<string, unknown>) {
    const res = await call<Summary & Record<string, unknown>>(path, body);
    expect(res.success, `${path}: ${res.error}`).toBe(true);
    return res.data;
  }

  beforeAll(async () => {
    const project = (await call<{ project: Summary }>("/new_project")).data
      .project;
    modelId = (
      await created("/create_element", {
        type: "UMLModel",
        parentId: project._id,
        name: "Library",
      })
    )._id;
    book = (
      await created("/create_element", {
        type: "UMLClass",
        parentId: modelId,
        name: "Book",
      })
    )._id;
    author = (
      await created("/create_element", {
        type: "UMLClass",
        parentId: modelId,
        name: "Author",
      })
    )._id;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("adds typed attributes to a class", async () => {
    ids.title = (
      await created("/add_attribute", {
        ownerId: book,
        name: "title",
        type: "String",
        visibility: "private",
        multiplicity: "1",
      })
    )._id;
    ids.writtenBy = (
      await created("/add_attribute", {
        ownerId: book,
        name: "writtenBy",
        type: { $ref: author },
        multiplicity: "1..*",
        aggregation: "shared",
        isReadOnly: true,
      })
    )._id;
    expect(
      await read(ids.writtenBy, ["type", "aggregation", "isReadOnly"]),
    ).toMatchObject({
      type: { $ref: author },
      aggregation: "shared",
      isReadOnly: true,
    });
    expect(await read(book, ["attributes"])).toEqual({
      _id: book,
      _type: "UMLClass",
      attributes: [{ $ref: ids.title }, { $ref: ids.writtenBy }],
    });
  });

  it("adds an operation with parameters and a return type as one undo step", async () => {
    const op = await created("/add_operation", {
      ownerId: book,
      name: "lend",
      isQuery: false,
      parameters: [
        { name: "to", type: { $ref: author } },
        { name: "days", type: "int", defaultValue: "14" },
      ],
      returnType: "boolean",
      fields: ["parameters", "name", "type", "direction"],
      depth: 1,
    });
    ids.lend = op._id;
    expect(op.parameters).toEqual([
      expect.objectContaining({ name: "to", type: { $ref: author } }),
      expect.objectContaining({ name: "days", type: "int" }),
      expect.objectContaining({
        name: "",
        type: "boolean",
        direction: "return",
      }),
    ]);
    const days = (op.parameters as { _id: string }[])[1]!._id;
    ids.days = days;
    await created("/add_parameter", {
      operationId: op._id,
      name: "note",
      type: "String",
      direction: "in",
    });

    // One edit:undo removes the operation together with all its parameters.
    const temp = await created("/add_operation", {
      ownerId: book,
      name: "temporary",
      parameters: [{ name: "x" }],
    });
    expect((await call("/execute_command", { id: "edit:undo" })).success).toBe(
      true,
    );
    expect(await call("/get_element_by_id", { id: temp._id })).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await call("/get_element_by_id", { id: ids.lend })).toMatchObject({
      success: true,
    });
  });

  it("adds enumeration literals, template parameters, slots and tags", async () => {
    const color = await created("/create_element", {
      type: "UMLEnumeration",
      parentId: modelId,
      name: "Color",
    });
    const red = await created("/add_enumeration_literal", {
      enumerationId: color._id,
      name: "RED",
    });
    expect(await read(color._id, ["literals"])).toMatchObject({
      literals: [{ $ref: red._id }],
    });

    const t = await created("/add_template_parameter", {
      ownerId: book,
      name: "T",
      parameterType: "class",
    });
    ids.template = t._id;

    const copy = await created("/create_element", {
      type: "UMLObject",
      parentId: modelId,
      name: "dune",
      properties: { classifier: { $ref: book } },
    });
    const slot = await created("/add_slot", {
      instanceId: copy._id,
      name: "title",
      definingFeature: ids.title,
      value: '"Dune"',
      fields: ["definingFeature", "value", "_parent"],
    });
    expect(slot).toMatchObject({
      _parent: copy._id,
      definingFeature: { $ref: ids.title },
      value: '"Dune"',
    });

    for (const [kind, value, field] of [
      ["string", "fiction", "value"],
      ["number", 412, "number"],
      ["boolean", true, "checked"],
      ["reference", author, "reference"],
    ] as const) {
      const tag = await created("/add_tag", {
        elementId: book,
        name: `t-${kind}`,
        kind,
        value,
        fields: ["kind", field],
      });
      expect(tag).toMatchObject({
        kind,
        [field]: kind === "reference" ? { $ref: author } : value,
      });
    }
  });

  it("sets stereotype and documentation", async () => {
    expect(
      await created("/set_stereotype", {
        elementId: book,
        stereotype: "entity",
        fields: ["stereotype"],
      }),
    ).toMatchObject({ stereotype: "entity" });
    expect(
      await created("/set_documentation", {
        elementId: book,
        documentation: "A published work.",
        fields: ["documentation"],
      }),
    ).toMatchObject({ documentation: "A published work." });
  });

  it("sets references by id and clears them with null", async () => {
    await created("/update_element", {
      id: ids.title,
      field: "type",
      value: { $ref: author },
    });
    expect(await read(ids.title, ["type"])).toMatchObject({
      type: { $ref: author },
    });
    await created("/update_element", {
      id: ids.title,
      field: "type",
      value: "String",
    });
    expect(await read<{ type: unknown }>(ids.title, ["type"])).toMatchObject({
      type: "String",
    });
    expect(
      await call("/update_element", {
        id: ids.title,
        field: "type",
        value: { $ref: "missing" },
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds to and removes from a reference list", async () => {
    const add = await call("/update_element", {
      id: ids.lend,
      op: "add",
      field: "raisedExceptions",
      value: [author, book],
      fields: ["raisedExceptions"],
    });
    expect(add.data).toMatchObject({
      raisedExceptions: [{ $ref: author }, { $ref: book }],
    });
    const remove = await call("/update_element", {
      id: ids.lend,
      op: "remove",
      field: "raisedExceptions",
      value: author,
      fields: ["raisedExceptions"],
    });
    expect(remove.data).toMatchObject({ raisedExceptions: [{ $ref: book }] });
  });

  it("reorders an owned list in one undoable operation", async () => {
    const before = await read<{ attributes: Ref[] }>(book, ["attributes"]);
    const last = before.attributes.at(-1)!.$ref;
    const moved = await call<{ attributes: Ref[] }>("/update_element", {
      id: book,
      op: "reorder",
      field: "attributes",
      value: last,
      index: 0,
      fields: ["attributes"],
    });
    expect(moved.data.attributes[0]!.$ref).toBe(last);
    await call("/execute_command", { id: "edit:undo" });
    expect(await read(book, ["attributes"])).toMatchObject({
      attributes: before.attributes,
    });
  });

  it("relocates a class into a package and an attribute to another class", async () => {
    const pkg = await created("/create_element", {
      type: "UMLPackage",
      parentId: modelId,
      name: "people",
    });
    expect(
      await created("/update_element", {
        id: author,
        op: "relocate",
        parentId: pkg._id,
        fields: ["_parent"],
      }),
    ).toMatchObject({ _parent: pkg._id });
    await created("/update_element", {
      id: ids.writtenBy,
      op: "relocate",
      parentId: author,
    });
    expect(await read(author, ["attributes"])).toMatchObject({
      attributes: [{ $ref: ids.writtenBy }],
    });
    expect(
      await call("/update_element", {
        id: book,
        op: "relocate",
        parentId: ids.title,
      }),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("saves every part to the .mdj", async () => {
    const file = join(dir, "features.mdj");
    expect((await call("/save_project_as", { filename: file })).success).toBe(
      true,
    );
    const byId = indexMdj(
      JSON.parse(readFileSync(file, "utf-8")) as MdjElement,
    );
    expect(byId.get(book)).toMatchObject({
      stereotype: "entity",
      documentation: "A published work.",
      templateParameters: [{ _id: ids.template, name: "T" }],
    });
    expect(byId.get(ids.days)).toMatchObject({
      _type: "UMLParameter",
      type: "int",
      defaultValue: "14",
    });
    expect(byId.get(ids.writtenBy)).toMatchObject({
      _parent: { $ref: author },
      type: { $ref: author },
    });
    const tags = (byId.get(book)!.tags as MdjElement[]).map((t) => t.name);
    expect(tags).toEqual(["t-string", "t-number", "t-boolean", "t-reference"]);
  });
});
