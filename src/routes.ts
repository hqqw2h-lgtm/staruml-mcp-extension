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
import { performanceStats } from "./handlers/performance.js";
import { quieted } from "./quiet.js";
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
  closeDiagrams,
  exportFragment,
  exportXmi,
  getPreference,
  getProjectMetadata,
  importFragment,
  importXmi,
  listExtensions,
  listTemplates,
  listWorkingDiagrams,
  newFromTemplate,
  quickFind,
  setPreference,
  setProjectMetadata,
} from "./handlers/workspace.js";
import {
  applyStyleProfile,
  explainStyleViolation,
  getStyleProfile,
  setStyleProfileEndpoint,
} from "./handlers/style.js";
import { profiled } from "./style/authoring.js";
import {
  deriveDiagramsEndpoint,
  explainModel,
  modelLint,
} from "./handlers/oo.js";
import {
  diagramQuality,
  improveDiagram,
  withQuality,
} from "./handlers/quality.js";
import {
  saveGated,
  styleLocked,
  viewFieldLocked,
  viewpointRequired,
} from "./style/guard.js";
import { derivedLocked } from "./templates/lock.js";
import { describeTemplate } from "./handlers/templates.js";
import {
  describeViewpoint,
  listViewpoints,
  requestDiagramEndpoint,
  viewpointLint,
} from "./handlers/viewpoints.js";
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
  listTemplates,
  newFromTemplate,
  getProjectMetadata,
  setProjectMetadata,
  saveGated(exportFragment),
  importFragment,
  saveGated(exportXmi),
  importXmi,
  getPreference,
  setPreference,
  listExtensions,
  quickFind,

  getElementById,
  findElements,
  createElement,
  derivedLocked(viewFieldLocked(updateElement)),
  derivedLocked(deleteElement, { deletes: true }),
  derivedLocked(profiled(createElementWithView)),
  derivedLocked(profiled(createEdgeWithView)),
  derivedLocked(createRelationship),

  addAttribute,
  addOperation,
  addParameter,
  addEnumerationLiteral,
  addTemplateParameter,
  addSlot,
  derivedLocked(addTag),
  derivedLocked(setStereotype),
  derivedLocked(setDocumentation),

  viewpointRequired(createDiagram),
  switchDiagram,
  closeDiagram,
  listWorkingDiagrams,
  closeDiagrams,

  getViewsOf,
  getEdgeViewsOf,
  getRelationshipsOf,
  getRefsTo,
  getConnectedNodeViews,

  derivedLocked(withQuality(layoutDiagram), { current: true }),
  derivedLocked(styleLocked(routeEdges), { current: true }),
  derivedLocked(styleLocked(moveViews)),
  derivedLocked(styleLocked(resizeNode)),
  derivedLocked(styleLocked(setViewStyle)),
  derivedLocked(styleLocked(setZOrder)),
  derivedLocked(styleLocked(divideFragment)),
  derivedLocked(createViewOf),

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
  deriveDiagramsEndpoint(() => endpoints),
  explainModel,
  modelLint,

  listViewpoints,
  describeViewpoint,
  describeTemplate,
  viewpointLint,
  requestDiagramEndpoint(() => endpoints),

  listPatterns,
  describePattern,
  applyPatternEndpoint(() => endpoints),
  detectPatterns,
  applyPresetEndpoint(() => endpoints),
  describeType,

  derivedLocked(styleLocked(applyThemeEndpoint(() => endpoints))),

  getStyleProfile,
  setStyleProfileEndpoint(() => endpoints),
  applyStyleProfile,
  explainStyleViolation,

  diagramQuality,
  improveDiagram,

  introspectEndpoint(() => endpoints),
  performanceStats,
  debug,
];

/**
 * Each request that writes runs quietly (issue #26): repaint once, select
 * once, no explorer animations. /batch and the builds call the endpoints
 * of the list directly, inside their own quiet request.
 */
export const routes: Readonly<Record<string, Handler>> = Object.fromEntries(
  endpoints.map((e) => [e.path, quieted(e).handler]),
);
