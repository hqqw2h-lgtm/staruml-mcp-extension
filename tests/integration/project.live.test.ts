import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive, liveDir, type Summary } from "./support.js";

// The ProjectManager methods src/types.ts declares; each must exist on 7.1.1.
const DECLARED = ["getFilename", "getProject", "save", "load", "newProject"];

// Issue #2: the real ProjectManager surface, and save-as built on save(fullPath).
describeLive("project files on StarUML 7.1.1", () => {
  const dir = liveDir();
  const first = join(dir, "project-first.mdj");
  const second = join(dir, "project-second.mdj");
  let projectId = "";

  beforeAll(async () => {
    for (const f of [first, second]) rmSync(f, { force: true });
    await call("/new_project");
    projectId = (await call<{ project: Summary }>("/get_project_info")).data
      .project._id;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("exposes every declared ProjectManager method, and no saveAs or loadFromFile", async () => {
    const res = await call<{ project: { proto: string[] } }>("/debug");
    const proto = res.data.project.proto;
    for (const method of DECLARED) expect(proto, method).toContain(method);
    expect(proto).not.toContain("saveAs");
    expect(proto).not.toContain("loadFromFile");
  });

  it("refuses save_project without a filename before the project has a file", async () => {
    expect(await call("/save_project")).toMatchObject({
      status: 409,
      code: "NO_PROJECT",
      error: "Project has no file yet; pass 'filename' or use /save_project_as",
    });
  });

  it("saves as a new file and adopts it", async () => {
    await call("/create_element", {
      type: "UMLModel",
      parentId: projectId,
      name: "First",
    });
    expect(await call("/save_project_as", { filename: first })).toMatchObject({
      status: 200,
      data: { filename: first },
    });
    const info = await call<{ filename: string }>("/get_project_info");
    expect(info.data.filename).toBe(first);
    const saved = JSON.parse(readFileSync(first, "utf-8")) as {
      ownedElements: { name: string }[];
    };
    expect(saved.ownedElements.map((e) => e.name)).toEqual(["First"]);
  });

  it("save_project without a filename writes to the adopted file", async () => {
    await call("/create_element", {
      type: "UMLModel",
      parentId: projectId,
      name: "Second",
    });
    expect(await call("/save_project")).toMatchObject({
      data: { filename: first },
    });
    const saved = JSON.parse(readFileSync(first, "utf-8")) as {
      ownedElements: { name: string }[];
    };
    expect(saved.ownedElements.map((e) => e.name)).toEqual(["First", "Second"]);
  });

  it("save-as to another file leaves the first one as it was", async () => {
    const before = readFileSync(first, "utf-8");
    await call("/create_element", {
      type: "UMLModel",
      parentId: projectId,
      name: "Third",
    });
    expect(await call("/save_project_as", { filename: second })).toMatchObject({
      data: { filename: second },
    });
    expect(readFileSync(first, "utf-8")).toBe(before);
    expect(existsSync(second)).toBe(true);
  });

  it("reopens a saved file with the same element ids", async () => {
    await call("/new_project");
    const opened = await call<{
      project: Summary & { ownedElements: unknown[] };
    }>("/open_project", { filename: second, fields: ["ownedElements"] });
    expect(opened.status).toBe(200);
    expect(opened.data.project.ownedElements).toHaveLength(3);
    expect(opened.data.project._id).toBe(projectId);
    const found = await call<{ count: number }>("/find_elements", {
      type: "UMLModel",
      name: "Third",
    });
    expect(found.data.count).toBe(1);
  });

  it("reports an empty file and a missing file", async () => {
    const empty = join(dir, "project-empty.mdj");
    writeFileSync(empty, "");
    expect(await call("/open_project", { filename: empty })).toMatchObject({
      status: 422,
      code: "STARUML_ERROR",
      error: `File is empty: ${empty}`,
    });
    expect(
      await call("/open_project", { filename: join(dir, "absent.mdj") }),
    ).toMatchObject({
      status: 422,
      code: "STARUML_ERROR",
      error: expect.stringContaining("ENOENT"),
    });
  });
});
