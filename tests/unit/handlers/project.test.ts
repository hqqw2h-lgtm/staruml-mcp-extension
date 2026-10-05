import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectInfo,
  newProject,
  openProject,
  saveProject,
  saveProjectAs,
} from "../../../src/handlers/project.js";
import {
  installMockApp,
  UMLClass,
  type MockEnvironment,
} from "../../mock/staruml.js";

const FILE = "/tmp/model.mdj";
const OTHER = "/tmp/other.mdj";
let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function savedNames(file: string): string[] {
  const data = JSON.parse(env.disk.get(file)!) as {
    ownedElements: { name: string }[];
  };
  return data.ownedElements.map((e) => e.name);
}

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
    expect(savedNames(FILE)).toEqual(["Model"]);
    expect(env.app.repository.isModified()).toBe(false);
  });

  it.each([{}, { filename: "" }, { filename: 3 }])(
    "saves to the current file when none is given: %j",
    async (body) => {
      env.app.project.save(FILE);
      env.app.project.getProject()!.name = "Renamed";
      expect(await saveProject(body)).toEqual({
        success: true,
        data: { filename: FILE },
      });
      expect(JSON.parse(env.disk.get(FILE)!)).toMatchObject({
        name: "Renamed",
      });
    },
  );

  it("refuses to guess a file for a project that was never saved", async () => {
    expect(await saveProject({})).toEqual({
      success: false,
      error: "Project has no file yet; pass 'filename' or use /save_project_as",
    });
    expect(env.disk.size).toBe(0);
  });

  it("refuses when no project is open", async () => {
    env.app.project.closeProject();
    expect(await saveProject({ filename: FILE })).toEqual({
      success: false,
      error: "No project is open",
    });
  });

  it("reports a write failure", async () => {
    vi.spyOn(env.app.project, "save").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(await saveProject({ filename: FILE })).toEqual({
      success: false,
      error: "EACCES: permission denied",
    });
  });
});

describe("saveProjectAs (#2)", () => {
  it.each([{}, { filename: "" }])("requires a filename: %j", async (body) => {
    expect(await saveProjectAs(body)).toEqual({
      success: false,
      error: "Required field 'filename' (string) missing",
    });
  });

  it("writes through ProjectManager.save, the only save on 7.x", async () => {
    const spy = vi.spyOn(env.app.project, "save");
    expect(await saveProjectAs({ filename: FILE })).toEqual({
      success: true,
      data: { filename: FILE },
    });
    expect(spy).toHaveBeenCalledWith(FILE);
    expect(savedNames(FILE)).toEqual(["Model"]);
  });

  it("switches the project to the new file, leaving the old one untouched", async () => {
    env.app.project.save(FILE);
    const before = env.disk.get(FILE);
    env.app.factory.createModel({
      id: "UMLClass",
      parent: env.app.project.getProject()!,
    });

    expect(await saveProjectAs({ filename: OTHER })).toMatchObject({
      success: true,
    });
    expect(env.app.project.getFilename()).toBe(OTHER);
    expect(env.disk.get(FILE)).toBe(before);
    expect(savedNames(OTHER)).toEqual(["Model", ""]);
  });

  it("refuses when no project is open", async () => {
    env.app.project.closeProject();
    expect(await saveProjectAs({ filename: FILE })).toEqual({
      success: false,
      error: "No project is open",
    });
  });
});

describe("newProject", () => {
  it("replaces the project with an empty one", async () => {
    const before = env.app.project.getProject();
    expect(await newProject({})).toEqual({ success: true, data: null });
    expect(env.app.project.getProject()).not.toBe(before);
    expect(env.app.project.getProject()!.ownedElements).toEqual([]);
    expect(env.app.project.getFilename()).toBeNull();
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

  it("loads a saved project, keeping element ids", async () => {
    const cls = env.app.factory.createModel({
      id: "UMLClass",
      parent: env.model,
    })!;
    env.app.project.save(FILE);
    env.app.project.newProject();

    const result = await openProject({ filename: FILE });
    expect(result).toMatchObject({
      success: true,
      data: {
        filename: FILE,
        project: { name: "Untitled", ownedElementsCount: 1 },
      },
    });
    expect(env.app.repository.get(cls._id)).toBeInstanceOf(UMLClass);
    expect(env.app.project.getFilename()).toBe(FILE);
  });

  it("reports an empty file, for which load() returns null", async () => {
    env.disk.set(FILE, "");
    const before = env.app.project.getProject();
    expect(await openProject({ filename: FILE })).toEqual({
      success: false,
      error: `File is empty: ${FILE}`,
    });
    expect(env.app.project.getProject()).toBe(before);
  });

  it("reports a missing file", async () => {
    expect(await openProject({ filename: "/nope.mdj" })).toMatchObject({
      success: false,
      error: expect.stringContaining("ENOENT"),
    });
  });
});
