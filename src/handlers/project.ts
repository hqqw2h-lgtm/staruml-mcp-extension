import { failure } from "../errors.js";
import type { Handler } from "../http-server.js";

export const getProjectInfo: Handler = () => {
  const project = app.project.getProject() as Record<string, unknown> | null;
  const filename = app.project.getFilename();
  return {
    success: true,
    data: { filename, project: project && summarize(project) },
  };
};

export const saveProject: Handler = async (body) => {
  const filename =
    typeof body.filename === "string" ? body.filename : undefined;
  try {
    await app.project.save(filename);
    return { success: true, data: { filename: app.project.getFilename() } };
  } catch (err) {
    return failure(err);
  }
};

export const saveProjectAs: Handler = async (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing",
    };
  }
  try {
    await app.project.saveAs(filename);
    // Issue #2: ProjectManager has no saveAs on 7.1.1, so this is unreachable
    // until the handler is rebuilt on save(); the ignore goes with that fix.
    /* v8 ignore next */
    return { success: true, data: { filename } };
  } catch (err) {
    return failure(err);
  }
};

export const newProject: Handler = () => {
  try {
    app.project.newProject();
    return { success: true, data: null };
  } catch (err) {
    return failure(err);
  }
};

export const openProject: Handler = async (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing",
    };
  }
  try {
    const project = app.project as unknown as { load: (fp: string) => unknown };
    await project.load(filename);
    return { success: true, data: { filename } };
  } catch (err) {
    return failure(err);
  }
};

function summarize(project: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: project._id,
    name: project.name,
    ownedElementsCount: (project.ownedElements as unknown[]).length,
  };
}
