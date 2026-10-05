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

import * as z from "zod/mini";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireProject } from "../lookup.js";
import { elementSchema, projectionShape } from "../schemas.js";
import { serialize, type Projection } from "../serialize.js";

const filename = (description: string) =>
  doc(z.string().check(z.minLength(1)), description);

const projectInfo = () =>
  z.object({
    filename: doc(
      z.nullable(z.string()),
      "File the project was opened from or last saved to; null if never saved.",
    ),
    project: z.nullable(elementSchema()),
  });

function describeProject(projection: Projection) {
  const project = app.project.getProject();
  return {
    filename: app.project.getFilename(),
    project: project && serialize(project, projection),
  };
}

export const getProjectInfo = defineEndpoint({
  path: "/get_project_info",
  description: "The open project and its file name.",
  readOnly: true,
  destructive: false,
  request: z.object(projectionShape()),
  response: projectInfo(),
  handle: describeProject,
});

/**
 * ProjectManager.save(fullPath) is synchronous, writes the file and makes it
 * the project's filename; with no path it throws inside fs.writeFileSync
 * (engine/project-manager.js in 7.1.1). Save and save-as both go through it.
 */
function saveTo(file: string): { filename: string | null } {
  requireProject();
  inStarUML(() => app.project.save(file));
  return { filename: app.project.getFilename() };
}

const saved = () => z.object({ filename: z.nullable(z.string()) });

export const saveProject = defineEndpoint({
  path: "/save_project",
  description:
    "Save the project to 'filename', or to the file it was opened from or last saved to.",
  readOnly: false,
  destructive: true,
  request: z.object({
    filename: z.optional(filename("Absolute .mdj path; overwrites the file.")),
  }),
  response: saved(),
  handle: (input) => {
    const file = input.filename ?? app.project.getFilename();
    if (!file) {
      throw new ApiError(
        "NO_PROJECT",
        "Project has no file yet; pass 'filename' or use /save_project_as",
      );
    }
    return saveTo(file);
  },
});

/** 7.x has no ProjectManager.saveAs (issue #2); save(fullPath) already switches the project to the new file. */
export const saveProjectAs = defineEndpoint({
  path: "/save_project_as",
  description:
    "Save the project to a new file, which becomes the project's file.",
  readOnly: false,
  destructive: true,
  request: z.object({
    filename: filename("Absolute .mdj path; overwrites the file."),
  }),
  response: saved(),
  handle: (input) => saveTo(input.filename),
});

/** An empty Project; the "Model" and "Main" diagram StarUML starts with come from its template, not from this call. */
export const newProject = defineEndpoint({
  path: "/new_project",
  description:
    "Replace the open project with an empty one; unsaved changes are lost.",
  readOnly: false,
  destructive: true,
  request: z.object(projectionShape()),
  response: projectInfo(),
  handle: (input) => {
    inStarUML(() => app.project.newProject());
    return describeProject(input);
  },
});

export const openProject = defineEndpoint({
  path: "/open_project",
  description:
    "Replace the open project with a .mdj file; unsaved changes are lost.",
  readOnly: false,
  destructive: true,
  request: z.object({
    filename: filename("Absolute .mdj path."),
    ...projectionShape(),
  }),
  response: z.object({ filename: z.string(), project: elementSchema() }),
  handle: (input) => {
    // load() is synchronous and returns null, leaving the open project alone, for an empty file.
    const project = inStarUML(() => app.project.load(input.filename));
    if (!project) {
      throw new ApiError("STARUML_ERROR", `File is empty: ${input.filename}`);
    }
    return { filename: input.filename, project: serialize(project, input) };
  },
});
