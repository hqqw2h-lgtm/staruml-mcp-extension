/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

import { failure } from "../errors.js";
import type { Handler, HandlerResult } from "../http-server.js";
import type { Element } from "../types.js";

export const getProjectInfo: Handler = () => {
  const project = app.project.getProject();
  return {
    success: true,
    data: {
      filename: app.project.getFilename(),
      project: project && summarize(project),
    },
  };
};

/**
 * ProjectManager.save(fullPath) is synchronous, writes the file and makes it
 * the project's filename; with no path it throws inside fs.writeFileSync
 * (engine/project-manager.js in 7.1.1). Save and save-as both go through it.
 */
function saveTo(filename: string): HandlerResult {
  if (!app.project.getProject()) {
    return { success: false, error: "No project is open" };
  }
  try {
    app.project.save(filename);
    return { success: true, data: { filename: app.project.getFilename() } };
  } catch (err) {
    return failure(err);
  }
}

/** Saves to `filename` if given, otherwise to the file the project was last saved to or opened from. */
export const saveProject: Handler = (body) => {
  const filename =
    typeof body.filename === "string" && body.filename.length > 0
      ? body.filename
      : app.project.getFilename();
  if (!filename) {
    return {
      success: false,
      error: "Project has no file yet; pass 'filename' or use /save_project_as",
    };
  }
  return saveTo(filename);
};

/** 7.x has no ProjectManager.saveAs (issue #2); save(fullPath) already switches the project to the new file. */
export const saveProjectAs: Handler = (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing",
    };
  }
  return saveTo(filename);
};

/** An empty Project; the "Model" and "Main" diagram StarUML starts with come from its template, not from this call. */
export const newProject: Handler = () => {
  try {
    app.project.newProject();
    return { success: true, data: null };
  } catch (err) {
    return failure(err);
  }
};

export const openProject: Handler = (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing",
    };
  }
  try {
    // load() is synchronous and returns null, leaving the open project alone, for an empty file.
    const project = app.project.load(filename);
    if (!project)
      return { success: false, error: `File is empty: ${filename}` };
    return { success: true, data: { filename, project: summarize(project) } };
  } catch (err) {
    return failure(err);
  }
};

function summarize(project: Element): Record<string, unknown> {
  return {
    _id: project._id,
    name: project.name,
    ownedElementsCount: (project.ownedElements as unknown[]).length,
  };
}
