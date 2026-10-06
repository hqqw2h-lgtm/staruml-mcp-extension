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
import { resolveRef } from "./refs.js";
import type { Element, View } from "./types.js";

/**
 * Resolves an id or path (see refs.ts), throwing NOT_FOUND or AMBIGUOUS_REF;
 * `role` names the request field in the message.
 */
export function requireElement(ref: string, role = "Element"): Element {
  return resolveRef(ref, { role });
}

/**
 * The diagram manager and the factory accept any element where a diagram is
 * expected and fail later inside the editor (ui/diagram-manager.js,
 * engine/factory.js in 7.1.1), so the kind is checked here.
 */
export function requireDiagram(ref: string, role = "Diagram"): Element {
  return resolveRef(ref, { kind: "diagram", role });
}

/**
 * A view, or a model standing for its view on `diagram` (its only view when
 * no diagram is given).
 */
export function requireView(
  ref: string,
  role = "View",
  diagram?: Element,
): View {
  return resolveRef(ref, {
    kind: "view",
    role,
    ...(diagram && { diagram }),
  }) as View;
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
