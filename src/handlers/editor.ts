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
import { inStarUML } from "../errors.js";
import { requireDiagram, requireElement } from "../lookup.js";
import { elementSchema, id, projectionShape } from "../schemas.js";
import { serialize } from "../serialize.js";
import type { Element } from "../types.js";
import { editorShowing, requireViewsOnOneDiagram } from "./views.js";

export const getSelection = defineEndpoint({
  path: "/get_selection",
  description:
    "What is selected in the UI: model elements (in the model explorer or as the models of selected views) and views.",
  readOnly: true,
  destructive: false,
  request: z.object(projectionShape()),
  response: z.object({
    models: z.array(elementSchema()),
    views: z.array(elementSchema()),
  }),
  handle: (input) => ({
    models: app.selections.getSelectedModels().map((m) => serialize(m, input)),
    views: app.selections.getSelectedViews().map((v) => serialize(v, input)),
  }),
});

const ids = (description: string) =>
  z.optional(doc(z.array(z.string().check(z.minLength(1))), description));

export const setSelection = defineEndpoint({
  path: "/set_selection",
  description:
    "Select views in the diagram editor and/or model elements, replacing the selection; both empty or omitted clears it. Selecting views opens their diagram.",
  readOnly: false,
  destructive: false,
  request: z.object({
    viewIds: ids("Views to select, all on one diagram."),
    modelIds: ids("Model elements to select besides the views' models."),
    ...projectionShape(),
  }),
  response: z.object({
    models: z.array(elementSchema()),
    views: z.array(elementSchema()),
  }),
  handle: (input) => {
    const extra = (input.modelIds ?? []).map((i) => requireElement(i));
    const picked =
      input.viewIds && input.viewIds.length > 0
        ? requireViewsOnOneDiagram(input.viewIds)
        : null;
    const views = picked ? picked.views : [];
    inStarUML(() => {
      app.diagrams.deselectAll();
      if (picked) {
        editorShowing(picked.diagram);
        const editor = app.diagrams.diagramEditor;
        editor.selectView(views[0]!);
        for (const view of views.slice(1)) editor.selectAdditionalView(view);
      }
      // The editor forwards its own selection to app.selections; setting it
      // here as well covers model-only selections and the extra models.
      const models: Element[] = [];
      for (const m of [...views.map((v) => v.model), ...extra]) {
        if (m && !models.includes(m)) models.push(m);
      }
      app.selections.select(models, views);
    });
    return {
      models: app.selections
        .getSelectedModels()
        .map((m) => serialize(m, input)),
      views: app.selections.getSelectedViews().map((v) => serialize(v, input)),
    };
  },
});

const editorState = () =>
  z.object({
    currentDiagram: doc(
      z.nullable(z.string()),
      "Id of the diagram shown in the editor.",
    ),
    workingDiagrams: doc(
      z.array(z.string()),
      "Ids of the diagrams open as editor tabs, in tab order.",
    ),
    zoom: doc(z.number(), "Zoom scale, 1 = 100%."),
    topLeft: doc(
      z.nullable(z.object({ x: z.number(), y: z.number() })),
      "Diagram coordinates shown at the viewport's top-left corner; null without a current diagram.",
    ),
    gridVisible: z.boolean(),
    snapToGrid: z.boolean(),
  });

function describeEditor() {
  const current = app.diagrams.getCurrentDiagram();
  return {
    currentDiagram: current ? current._id : null,
    workingDiagrams: app.diagrams.getWorkingDiagrams().map((d) => d._id),
    zoom: app.diagrams.getZoomLevel(),
    // DiagramEditor.setOrigin records the canvas origin on the diagram; it
    // clamps it to <= 0, the negated scroll offset in diagram units (7.1.1).
    topLeft: current
      ? {
          x: Math.abs((current._originX as number | undefined) ?? 0),
          y: Math.abs((current._originY as number | undefined) ?? 0),
        }
      : null,
    gridVisible: app.diagrams.isGridVisible(),
    snapToGrid: app.diagrams.getSnapToGrid(),
  };
}

export const getEditorState = defineEndpoint({
  path: "/get_editor_state",
  description:
    "The diagram editor's state: current and open diagrams, zoom, scroll position, grid.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: editorState(),
  handle: describeEditor,
});

export const setEditorState = defineEndpoint({
  path: "/set_editor_state",
  description:
    "Change the diagram editor's view: show a diagram, zoom, scroll, grid. Nothing here changes the model or the undo history; gridVisible and snapToGrid are stored as StarUML preferences, as the View menu does.",
  readOnly: false,
  destructive: false,
  request: z.object({
    diagramId: z.optional(id("Diagram to open and show first.")),
    zoom: z.optional(
      doc(
        z.number().check(z.minimum(0.1), z.maximum(3)),
        "Zoom scale between 0.1 and 3 (DiagramEditor.setZoomScale's range).",
      ),
    ),
    center: z.optional(
      doc(
        z.object({ x: z.number(), y: z.number() }),
        "Diagram point to centre the viewport on, in diagram units.",
      ),
    ),
    gridVisible: z.optional(z.boolean()),
    snapToGrid: z.optional(z.boolean()),
  }),
  response: editorState(),
  handle: (input) => {
    const diagram =
      input.diagramId === undefined ? null : requireDiagram(input.diagramId);
    inStarUML(() => {
      if (diagram) app.diagrams.setCurrentDiagram(diagram);
      if (input.zoom !== undefined) app.diagrams.setZoomLevel(input.zoom);
      if (input.center) app.diagrams.scrollTo(input.center.x, input.center.y);
      if (input.gridVisible === true) app.diagrams.showGrid();
      if (input.gridVisible === false) app.diagrams.hideGrid();
      if (input.snapToGrid !== undefined) {
        app.diagrams.setSnapToGrid(input.snapToGrid);
      }
    });
    return describeEditor();
  },
});
