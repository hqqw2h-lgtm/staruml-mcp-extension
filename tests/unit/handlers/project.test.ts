import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectInfo,
  newProject,
  openProject,
  saveProject,
  saveProjectAs,
} from "../../../src/handlers/project.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

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

describe("/get_project_info", () => {
  it("summarises the open project", async () => {
    expect(await ok(getProjectInfo)).toEqual({
      filename: null,
      project: {
        _id: env.project._id,
        _type: "Project",
        name: "Untitled",
        _parent: null,
      },
    });
  });

  it("projects the project like any element", async () => {
    expect(await ok(getProjectInfo, { fields: ["ownedElements"] })).toEqual({
      filename: null,
      project: {
        _id: env.project._id,
        _type: "Project",
        ownedElements: [{ $ref: env.model._id }],
      },
    });
  });

  it("reports no project after it was closed", async () => {
    env.app.project.closeProject();
    expect(await ok(getProjectInfo)).toEqual({
      filename: null,
      project: null,
    });
  });
});

describe("/save_project", () => {
  it("writes to the given file and adopts it as the project filename", async () => {
    expect(await ok(saveProject, { filename: FILE })).toEqual({
      filename: FILE,
    });
    expect(savedNames(FILE)).toEqual(["Model"]);
    expect(env.app.repository.isModified()).toBe(false);
  });

  it("saves to the current file when none is given", async () => {
    env.app.project.save(FILE);
    env.project.name = "Renamed";
    expect(await ok(saveProject)).toEqual({ filename: FILE });
    expect(JSON.parse(env.disk.get(FILE)!)).toMatchObject({
      name: "Renamed",
    });
  });

  it.each([{ filename: "" }, { filename: 3 }])(
    "rejects a filename that is not a non-empty string: %j",
    async (body) => {
      await fails(saveProject, body, "INVALID_ARGUMENT", /^filename: /);
    },
  );

  it("refuses to guess a file for a project that was never saved", async () => {
    await fails(
      saveProject,
      {},
      "NO_PROJECT",
      "Project has no file yet; pass 'filename' or use /save_project_as",
    );
    expect(env.disk.size).toBe(0);
  });

  it("refuses when no project is open", async () => {
    env.app.project.closeProject();
    await fails(
      saveProject,
      { filename: FILE },
      "NO_PROJECT",
      "No project is open",
    );
  });

  it("reports a write failure", async () => {
    vi.spyOn(env.app.project, "save").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    await fails(
      saveProject,
      { filename: FILE },
      "STARUML_ERROR",
      "EACCES: permission denied",
    );
  });
});

describe("/save_project_as (#2)", () => {
  it.each([{}, { filename: "" }])("requires a filename: %j", async (body) => {
    await fails(saveProjectAs, body, "INVALID_ARGUMENT", /^filename: /);
  });

  it("writes through ProjectManager.save, the only save on 7.x", async () => {
    const spy = vi.spyOn(env.app.project, "save");
    expect(await ok(saveProjectAs, { filename: FILE })).toEqual({
      filename: FILE,
    });
    expect(spy).toHaveBeenCalledWith(FILE);
    expect(savedNames(FILE)).toEqual(["Model"]);
  });

  it("switches the project to the new file, leaving the old one untouched", async () => {
    env.app.project.save(FILE);
    const before = env.disk.get(FILE);
    env.app.factory.createModel({ id: "UMLClass", parent: env.project });

    await ok(saveProjectAs, { filename: OTHER });
    expect(env.app.project.getFilename()).toBe(OTHER);
    expect(env.disk.get(FILE)).toBe(before);
    expect(savedNames(OTHER)).toEqual(["Model", ""]);
  });

  it("refuses when no project is open", async () => {
    env.app.project.closeProject();
    await fails(saveProjectAs, { filename: FILE }, "NO_PROJECT");
  });
});

describe("/new_project", () => {
  it("replaces the project with an empty one and describes it", async () => {
    const data = await ok<{ filename: null; project: { _id: string } }>(
      newProject,
    );
    const project = env.app.project.getProject()!;
    expect(project).not.toBe(env.project);
    expect(project.ownedElements).toEqual([]);
    expect(data).toEqual({
      filename: null,
      project: {
        _id: project._id,
        _type: "Project",
        name: "",
        _parent: null,
      },
    });
  });

  it("reports a ProjectManager exception", async () => {
    vi.spyOn(env.app.project, "newProject").mockImplementation(() => {
      throw new Error("busy");
    });
    await fails(newProject, {}, "STARUML_ERROR", "busy");
  });
});

describe("/open_project", () => {
  it.each([{}, { filename: "" }])("requires a filename: %j", async (body) => {
    await fails(openProject, body, "INVALID_ARGUMENT", /^filename: /);
  });

  it("loads a saved project, keeping element ids and references", async () => {
    const view = env.app.factory.createModelAndView({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
    })!;
    env.app.project.save(FILE);
    env.app.project.newProject();

    const data = await ok(openProject, { filename: FILE });
    expect(data).toEqual({
      filename: FILE,
      project: {
        _id: env.project._id,
        _type: "Project",
        name: "Untitled",
        _parent: null,
      },
    });
    const reopened = env.app.repository.get(view._id)!;
    expect(reopened.constructor.name).toBe("UMLClassView");
    expect(reopened.model).toBe(env.app.repository.get(view.model!._id));
    expect(env.app.project.getFilename()).toBe(FILE);
  });

  it("reports an empty file, for which load() returns null", async () => {
    env.disk.set(FILE, "");
    const before = env.app.project.getProject();
    await fails(
      openProject,
      { filename: FILE },
      "STARUML_ERROR",
      `File is empty: ${FILE}`,
    );
    expect(env.app.project.getProject()).toBe(before);
  });

  it("reports a missing file", async () => {
    await fails(
      openProject,
      { filename: "/nope.mdj" },
      "STARUML_ERROR",
      /ENOENT/,
    );
  });
});
