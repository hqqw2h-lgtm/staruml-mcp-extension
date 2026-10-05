import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectInfo,
  newProject,
  openProject,
  saveProject,
  saveProjectAs,
} from "../../../src/handlers/project.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";

const FILE = "/tmp/model.mdj";
let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("getProjectInfo", () => {
  it("summarises the open project", async () => {
    const project = env.app.project.getProject()!;
    expect(await getProjectInfo({})).toEqual({
      success: true,
      data: {
        filename: null,
        project: { _id: project._id, name: "Untitled", ownedElementsCount: 1 },
      },
    });
  });

  it("reports no project after it was closed", async () => {
    env.app.project.closeProject();
    expect(await getProjectInfo({})).toEqual({
      success: true,
      data: { filename: null, project: null },
    });
  });
});

describe("saveProject", () => {
  it("writes to the given file and adopts it as the project filename", async () => {
    expect(await saveProject({ filename: FILE })).toEqual({
      success: true,
      data: { filename: FILE },
    });
    expect(env.disk.has(FILE)).toBe(true);
    expect(env.app.repository.isModified()).toBe(false);
  });

  it("reports the error ProjectManager.save throws without a path", async () => {
    expect(await saveProject({})).toMatchObject({
      success: false,
      error: expect.stringContaining(
        'The "path" argument must be of type string',
      ),
    });
  });
});

describe("saveProjectAs", () => {
  it.each([{}, { filename: "" }])("requires a filename: %j", async (body) => {
    expect(await saveProjectAs(body)).toEqual({
      success: false,
      error: "Required field 'filename' (string) missing",
    });
  });

  // Issue #2: 7.1.1 has no ProjectManager.saveAs.
  it("fails because ProjectManager.saveAs does not exist (#2)", async () => {
    expect(await saveProjectAs({ filename: FILE })).toEqual({
      success: false,
      error: "app.project.saveAs is not a function",
    });
  });

  it.fails("writes the project to the new file (#2)", async () => {
    expect(await saveProjectAs({ filename: FILE })).toMatchObject({
      success: true,
    });
    expect(env.disk.has(FILE)).toBe(true);
  });
});

describe("newProject", () => {
  it("replaces the project with an empty one", async () => {
    const before = env.app.project.getProject();
    expect(await newProject({})).toEqual({ success: true, data: null });
    expect(env.app.project.getProject()).not.toBe(before);
    expect(env.app.project.getProject()!.ownedElements).toEqual([]);
  });

  it("reports a ProjectManager exception", async () => {
    vi.spyOn(env.app.project, "newProject").mockImplementation(() => {
      throw new Error("busy");
    });
    expect(await newProject({})).toEqual({ success: false, error: "busy" });
  });
});

describe("openProject", () => {
  it.each([{}, { filename: "" }])("requires a filename: %j", async (body) => {
    expect(await openProject(body)).toEqual({
      success: false,
      error: "Required field 'filename' (string) missing",
    });
  });

  it("loads a saved project", async () => {
    env.app.project.save(FILE);
    env.app.project.newProject();
    expect(await openProject({ filename: FILE })).toEqual({
      success: true,
      data: { filename: FILE },
    });
    expect(env.app.project.getProject()!.ownedElements[0]!.name).toBe("Model");
  });

  it("reports a missing file", async () => {
    expect(await openProject({ filename: "/nope.mdj" })).toMatchObject({
      success: false,
      error: expect.stringContaining("ENOENT"),
    });
  });
});
