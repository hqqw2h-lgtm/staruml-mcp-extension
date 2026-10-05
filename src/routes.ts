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

import type { Endpoint } from "./endpoint.js";
import { batchEndpoint } from "./handlers/batch.js";
import { buildDiagramEndpoint } from "./handlers/build.js";
import {
  describeCommands,
  executeCommand,
  getAllCommands,
} from "./handlers/commands.js";
import {
  generateCode,
  listCodeGenerators,
  reverseCode,
} from "./handlers/codegen.js";
import { debug } from "./handlers/debug.js";
import { introspectEndpoint } from "./handlers/introspect.js";
import {
  closeDiagram,
  createDiagram,
  switchDiagram,
} from "./handlers/diagrams.js";
import {
  createElement,
  createElementWithView,
  deleteElement,
  findElements,
  getElementById,
  updateElement,
} from "./handlers/elements.js";
import {
  getProjectInfo,
  newProject,
  openProject,
  saveProject,
  saveProjectAs,
} from "./handlers/project.js";
import {
  addAttribute,
  addEnumerationLiteral,
  addOperation,
  addParameter,
  addSlot,
  addTag,
  addTemplateParameter,
  setDocumentation,
  setStereotype,
} from "./handlers/features.js";
import {
  createEdgeWithView,
  createRelationship,
} from "./handlers/relationships.js";
import {
  getEditorState,
  getSelection,
  setEditorState,
  setSelection,
} from "./handlers/editor.js";
import {
  exportDiagram,
  exportDiagrams,
  exportHtml,
  exportPdf,
} from "./handlers/export.js";
import { isModified, redo, undo } from "./handlers/history.js";
import {
  getConnectedNodeViews,
  getEdgeViewsOf,
  getRefsTo,
  getRelationshipsOf,
  getViewsOf,
} from "./handlers/queries.js";
import {
  layoutDiagram,
  moveViews,
  resizeNode,
  routeEdges,
  setViewStyle,
  setZOrder,
} from "./handlers/views.js";
import type { Handler } from "./http-server.js";

/** Endpoint paths are part of the contract with the staruml-mcp server; do not rename. */
export const endpoints: readonly Endpoint[] = [
  getAllCommands,
  describeCommands,
  executeCommand,

  getProjectInfo,
  saveProject,
  saveProjectAs,
  newProject,
  openProject,

  getElementById,
  findElements,
  createElement,
  updateElement,
  deleteElement,
  createElementWithView,
  createEdgeWithView,
  createRelationship,

  addAttribute,
  addOperation,
  addParameter,
  addEnumerationLiteral,
  addTemplateParameter,
  addSlot,
  addTag,
  setStereotype,
  setDocumentation,

  createDiagram,
  switchDiagram,
  closeDiagram,

  getViewsOf,
  getEdgeViewsOf,
  getRelationshipsOf,
  getRefsTo,
  getConnectedNodeViews,

  layoutDiagram,
  routeEdges,
  moveViews,
  resizeNode,
  setViewStyle,
  setZOrder,

  getSelection,
  setSelection,
  getEditorState,
  setEditorState,

  exportDiagram,
  exportDiagrams,
  exportPdf,
  exportHtml,

  listCodeGenerators,
  generateCode,
  reverseCode,

  undo,
  redo,
  isModified,

  batchEndpoint(() => endpoints),
  buildDiagramEndpoint(() => endpoints),

  introspectEndpoint(() => endpoints),
  debug,
];

export const routes: Readonly<Record<string, Handler>> = Object.fromEntries(
  endpoints.map((e) => [e.path, e.handler]),
);
