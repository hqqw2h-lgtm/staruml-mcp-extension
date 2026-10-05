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

import { ApiError } from "./errors.js";
import type { Element, View } from "./types.js";

/** Resolves an id, throwing NOT_FOUND; `role` names the request field in the message. */
export function requireElement(id: string, role = "Element"): Element {
  const elem = app.repository.get(id);
  if (!elem) throw new ApiError("NOT_FOUND", `${role} not found: ${id}`);
  return elem;
}

/**
 * The diagram manager and the factory accept any element where a diagram is
 * expected and fail later inside the editor (ui/diagram-manager.js,
 * engine/factory.js in 7.1.1), so the kind is checked here.
 */
export function requireDiagram(id: string, role = "Diagram"): Element {
  const elem = app.repository.get(id);
  if (!elem || !(elem instanceof type.Diagram)) {
    throw new ApiError("NOT_FOUND", `${role} not found: ${id}`);
  }
  return elem;
}

export function requireView(id: string, role = "View"): View {
  const elem = app.repository.get(id);
  if (!elem || !(elem instanceof type.View)) {
    throw new ApiError("NOT_FOUND", `${role} not found: ${id}`);
  }
  return elem as View;
}

/**
 * Repository.getInstancesOf evaluates `elem instanceof type[name]` and throws
 * a TypeError for a name that is not a metamodel class (core/repository.js).
 */
export function requireTypeName(name: string): void {
  if (!Object.hasOwn(type, name)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown element type: ${name}`);
  }
}

export function requireProject(): Element {
  const project = app.project.getProject();
  if (!project) throw new ApiError("NO_PROJECT", "No project is open");
  return project;
}
