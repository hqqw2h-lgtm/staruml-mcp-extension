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
import { exportText } from "./handlers/export-text.js";
import { describeDiagram, validateModel } from "./handlers/describe.js";
import { lintDiagram } from "./handlers/lint.js";
import {
  diffDiagram,
  diffSinceEndpoint,
  restoreSnapshot,
  takeSnapshot,
} from "./handlers/diff.js";
import { umlLint } from "./handlers/uml-lint.js";
import {
  applyPatternEndpoint,
  applyPresetEndpoint,
  describePattern,
  describeType,
  detectPatterns,
  listPatterns,
} from "./handlers/patterns.js";
import {
  buildModelEndpoint,
  checkMessages,
  syncOperationsEndpoint,
} from "./handlers/model.js";
import { searchTypes } from "./handlers/search.js";
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
  createViewOf,
  divideFragment,
  layoutDiagram,
  moveViews,
  resizeNode,
  routeEdges,
  setViewStyle,
  setZOrder,
} from "./handlers/views.js";
import { applyThemeEndpoint } from "./handlers/theme.js";
import {
  applyStyleProfile,
  explainStyleViolation,
  getStyleProfile,
  setStyleProfileEndpoint,
} from "./handlers/style.js";
import { profiled } from "./style/authoring.js";
import { saveGated, styleLocked, viewFieldLocked } from "./style/guard.js";
import type { Handler } from "./http-server.js";

/** Endpoint paths are part of the contract with the staruml-mcp server; do not rename. */
export const endpoints: readonly Endpoint[] = [
  getAllCommands,
  describeCommands,
  executeCommand,

  getProjectInfo,
  saveGated(saveProject),
  saveGated(saveProjectAs),
  newProject,
  openProject,

  getElementById,
  findElements,
  createElement,
  viewFieldLocked(updateElement),
  deleteElement,
  profiled(createElementWithView),
  profiled(createEdgeWithView),
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
  styleLocked(routeEdges),
  styleLocked(moveViews),
  styleLocked(resizeNode),
  styleLocked(setViewStyle),
  styleLocked(setZOrder),
  styleLocked(divideFragment),
  createViewOf,

  getSelection,
  setSelection,
  getEditorState,
  setEditorState,

  saveGated(exportDiagram),
  saveGated(exportDiagrams),
  saveGated(exportPdf),
  saveGated(exportHtml),
  saveGated(exportText),

  listCodeGenerators,
  generateCode,
  reverseCode,

  undo,
  redo,
  isModified,

  batchEndpoint(() => endpoints),
  buildDiagramEndpoint(() => endpoints),

  searchTypes,
  describeDiagram,
  validateModel,
  lintDiagram,
  umlLint,
  diffDiagram,
  takeSnapshot,
  diffSinceEndpoint,
  restoreSnapshot,

  buildModelEndpoint(() => endpoints),
  syncOperationsEndpoint(() => endpoints),
  checkMessages,

  listPatterns,
  describePattern,
  applyPatternEndpoint(() => endpoints),
  detectPatterns,
  applyPresetEndpoint(() => endpoints),
  describeType,

  styleLocked(applyThemeEndpoint(() => endpoints)),

  getStyleProfile,
  setStyleProfileEndpoint(() => endpoints),
  applyStyleProfile,
  explainStyleViolation,

  introspectEndpoint(() => endpoints),
  debug,
];

export const routes: Readonly<Record<string, Handler>> = Object.fromEntries(
  endpoints.map((e) => [e.path, e.handler]),
);
