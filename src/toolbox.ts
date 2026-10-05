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
import type { ModelAndViewOptions } from "./types.js";

/*
 * Toolbox items are the palette entries of the diagram editor. Many are
 * presets of a model-and-view id: UMLComposition is UMLAssociation with a
 * composite end, UMLAsyncMessage is UMLMessage with messageSort asynchCall,
 * UMLInitialState is UMLPseudostate with pseudostateKind initial. On drop the
 * editor merges the item's command-arg into createModelAndView's options
 * (views/toolbox-view.js in 7.1.1); this module does the same for the HTTP
 * API, minus the options that only make sense under a mouse cursor.
 */

/**
 * connectable-views picks the end views by hit-testing the drop coordinates
 * on the editor canvas, and self-connection copies the head end over the
 * tail; both would override the ends a request names (engine/factory.js).
 */
const CURSOR_OPTIONS = new Set(["id", "connectable-views", "self-connection"]);

export interface CreateType {
  /** The model-and-view id passed to the factory. */
  id: string;
  /** Preset options from the toolbox item, if `type` named one. */
  preset: Partial<ModelAndViewOptions> & Record<string, unknown>;
}

const DEFAULT_COMMAND = "factory:create-model-and-view";

/**
 * A toolbox item resolved to its model-and-view id and preset options, else a
 * model-and-view id as is. The item wins where a name is both, as on drop:
 * C4ContainerDatabase is registered as a model-and-view id without a model
 * class, and only its item's preset (C4Container, kind database) works.
 */
export function resolveCreateType(typeName: string): CreateType {
  const { items } = app.toolbox;
  const item = Object.hasOwn(items, typeName) ? items[typeName]! : undefined;
  const custom = item?.command && item.command !== DEFAULT_COMMAND;
  if (!item || custom) {
    if (app.factory.getModelAndViewIds().includes(typeName)) {
      return { id: typeName, preset: {} };
    }
    throw new ApiError(
      "UNKNOWN_TYPE",
      custom
        ? `${typeName} is a toolbox item run by the command ${item.command}, which this API does not call`
        : `Unknown model-and-view type: ${typeName}`,
    );
  }
  const arg = item.commandArg ?? {};
  const preset: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) {
    if (!CURSOR_OPTIONS.has(key)) preset[key] = value;
  }
  return { id: typeof arg.id === "string" ? arg.id : typeName, preset };
}
