import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  BASE_URL,
  call,
  describeLive,
  liveDir,
  type Summary,
} from "./support.js";

// One scenario on a fresh project; later steps use ids created by earlier ones.
describeLive("endpoints against StarUML 7.1.1", () => {
  const dir = liveDir();
  let projectId = "";
  let modelId = "";
  let diagramId = "";
  let classId = "";

  beforeAll(async () => {
    expect((await call("/new_project")).success).toBe(true);
    const info = await call<{ project: Summary }>("/get_project_info");
    projectId = info.data.project._id;
  });

  afterAll(async () => {
    // Leaves StarUML on an empty, unmodified project so it can quit without a prompt.
    await call("/new_project");
  });

  it("rejects unknown paths and malformed bodies with stable codes", async () => {
    expect(await call("/no_such_endpoint")).toMatchObject({
      status: 404,
      code: "UNKNOWN_ENDPOINT",
    });
    const res = await fetch(BASE_URL + "/find_elements", {
      method: "POST",
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_JSON" });
  });

  it("lists the registered commands, including ones without a display name", async () => {
    const res = await call<{ count: number; ids: string[] }>(
      "/get_all_commands",
    );
    expect(res.data.ids).toContain("project:save");
    expect(res.data.ids).toContain("mcp-ext:server-info");
    expect(res.data.count).toBe(res.data.ids.length);
  });

  it("executes a command and refuses an unregistered one", async () => {
    expect(
      await call("/execute_command", { id: "view:actual-size" }),
    ).toMatchObject({
      success: true,
    });
    expect(
      await call("/execute_command", { id: "no:such-command" }),
    ).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      error: "Command not registered: no:such-command",
    });
  });

  it("starts from an empty project", async () => {
    const info = await call<{
      filename: string | null;
      project: Record<string, unknown>;
    }>("/get_project_info", { fields: ["ownedElements"] });
    expect(info.data.filename).toBeNull();
    expect(info.data.project).toEqual({
      _id: projectId,
      _type: "Project",
      ownedElements: [],
    });
  });

  it("creates a model and a class diagram in it", async () => {
    const model = await call<Summary>("/create_element", {
      type: "UMLModel",
      parentId: projectId,
      name: "Domain",
    });
    expect(model).toMatchObject({
      success: true,
      data: { _type: "UMLModel", name: "Domain", _parent: projectId },
    });
    modelId = model.data._id;

    const diagram = await call<Summary>("/create_diagram", {
      type: "UMLClassDiagram",
      parentId: modelId,
      name: "Classes",
    });
    expect(diagram).toMatchObject({
      success: true,
      data: { name: "Classes", _type: "UMLClassDiagram", _parent: modelId },
    });
    diagramId = diagram.data._id;
  });

  it("reports unknown model and diagram types instead of a null dereference", async () => {
    expect(
      await call("/create_element", { type: "Nope", parentId: modelId }),
    ).toMatchObject({
      status: 400,
      code: "UNKNOWN_TYPE",
      error: "Unknown model type: Nope",
    });
    expect(
      await call("/create_diagram", { type: "Nope", parentId: modelId }),
    ).toMatchObject({
      code: "UNKNOWN_TYPE",
      error: "Unknown diagram type: Nope",
    });
  });

  it("switches to the diagram and refuses to switch to a non-diagram", async () => {
    expect(await call("/switch_diagram", { id: diagramId })).toMatchObject({
      success: true,
    });
    expect(await call("/switch_diagram", { id: modelId })).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      error: `Diagram not found: ${modelId}`,
    });
  });

  it("creates, finds, reads and updates a class", async () => {
    const cls = await call<Summary>("/create_element", {
      type: "UMLClass",
      parentId: modelId,
      name: "Book",
    });
    classId = cls.data._id;

    const found = await call<{ count: number; elements: Summary[] }>(
      "/find_elements",
      {
        type: "UMLClass",
        name: "Book",
      },
    );
    expect(found.data.count).toBe(1);
    expect(found.data.elements[0]!._id).toBe(classId);

    const read = await call<Summary>("/get_element_by_id", { id: classId });
    expect(read.data).toEqual({
      _id: classId,
      _type: "UMLClass",
      name: "Book",
      _parent: modelId,
    });

    expect(
      await call("/update_element", {
        id: classId,
        field: "isAbstract",
        value: true,
      }),
    ).toMatchObject({ success: true, data: { _id: classId, name: "Book" } });
    expect(
      await call("/get_element_by_id", { id: classId, fields: ["isAbstract"] }),
    ).toMatchObject({ data: { isAbstract: true } });
    expect(
      await call("/update_element", {
        id: classId,
        field: "noSuchField",
        value: 1,
      }),
    ).toMatchObject({
      success: false,
      code: "INVALID_ARGUMENT",
      error: "UMLClass has no field 'noSuchField'",
    });
  });

  it("reports an unknown type name from find_elements", async () => {
    expect(await call("/find_elements", { type: "NoSuchType" })).toMatchObject({
      success: false,
      code: "UNKNOWN_TYPE",
    });
  });

  it("saves to an explicit path and reopens the file", async () => {
    const file = join(dir, "endpoints.mdj");
    expect(await call("/save_project", { filename: file })).toMatchObject({
      success: true,
      data: { filename: file },
    });
    const saved = JSON.parse(readFileSync(file, "utf-8")) as {
      ownedElements: { name: string }[];
    };
    expect(saved.ownedElements.map((e) => e.name)).toEqual(["Domain"]);

    expect((await call("/new_project")).success).toBe(true);
    expect(await call("/open_project", { filename: file })).toMatchObject({
      success: true,
    });
    const found = await call<{ count: number }>("/find_elements", {
      type: "UMLClass",
    });
    expect(found.data.count).toBe(1);
  });

  it("deletes the class", async () => {
    expect(await call("/delete_element", { id: classId })).toMatchObject({
      success: true,
      data: { deleted: classId, models_deleted: 1 },
    });
    expect(await call("/get_element_by_id", { id: classId })).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("closes the diagram", async () => {
    await call("/switch_diagram", { id: diagramId });
    expect(await call("/close_diagram", { id: diagramId })).toMatchObject({
      success: true,
      data: { closed: diagramId },
    });
  });
});
