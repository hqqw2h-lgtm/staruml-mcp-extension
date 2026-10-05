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

/**
 * The subset of the StarUML `app` / `type` globals this extension calls.
 *
 * Every member is checked against StarUML 7.1.1: method names against the
 * runtime prototypes recorded in tests/fixtures/app-surface.7.1.1.json, and
 * signatures against the sources shipped in StarUML.app/Contents/Resources/app/src.
 * Add a member only after confirming it there; the published API reference
 * (files.staruml.io/api-docs/6.0.0) does not match 7.x.
 */

export interface Element {
  _id: string;
  _parent?: Element | null;
  name?: string;
  [key: string]: unknown;
}

export interface View extends Element {
  model: Element | null;
}

/** engine/command-manager.js */
export interface CommandManager {
  /** Returns null without registering when the id is taken or the handler is missing. */
  register(
    id: string,
    handler: (...args: never[]) => unknown,
    displayName?: string,
  ): unknown;
  /** Returns the handler's result, or false when no command has that id. */
  execute(id: string, ...args: unknown[]): unknown;
  /** Every registered command, keyed by id. */
  commands: Record<string, unknown>;
  /** Display names, only for commands registered with one. */
  commandNames: Record<string, string>;
}

/**
 * engine/project-manager.js. 7.1.1 has neither saveAs nor loadFromFile; its
 * prototype is closeProject, exportToFile, getFilename, getProject,
 * importFromFile, importFromJson, load, loadAsTemplate, loadFromJson,
 * newProject and save.
 */
export interface ProjectManager {
  getFilename(): string | null;
  /** Null after closeProject(). */
  getProject(): Element | null;
  /** Synchronous; writes the file, adopts it as the filename and clears the modified flag. */
  save(fullPath: string): Element | null;
  /** Synchronous; throws for a missing file and returns null for an empty one. */
  load(fullPath: string): Element | null;
  newProject(): Element;
}

/**
 * core/repository.js. An operation is the unit of undo; Engine methods build
 * one per call, which is also how Engine.moveUp/moveDown reorder.
 */
export interface OperationBuilder {
  begin(name: string): void;
  /** Moves `value` to `index` of `elem[field]`, counted after removing it. */
  fieldReorder(
    elem: Element,
    field: string,
    value: Element,
    index: number,
  ): void;
  end(): void;
  getOperation(): Operation;
}

/** core/repository.js */
export interface Repository {
  get(id: string): Element | undefined;
  /** Every element by id, views and diagrams included (core/repository.js). */
  getIdMap(): Record<string, Element>;
  /** Throws a TypeError when `typeName` is not a key of the `type` global. */
  getInstancesOf(typeName: string): Element[];
  findAll(predicate: (elem: Element) => boolean): Element[];
  getViewsOf(model: Element): View[];
  getEdgeViewsOf(view: Element): View[];
  /** Relationships whose ends (source/target or end1/end2.reference) name `model`. */
  getRelationshipsOf(model: Element): Element[];
  /** Every element holding a reference to `elem`, from the reverse reference index. */
  getRefsTo(elem: Element): Element[];
  /** Node views at the far end of `view`'s edges that are instances of `edgeType`. */
  getConnectedNodeViews(
    view: Element,
    edgeType: abstract new (...args: never[]) => unknown,
  ): View[];
  getOperationBuilder(): OperationBuilder;
  /**
   * Applies an operation and pushes it on the undo stack unless it is empty
   * or `bypass`; logs, rather than throws, what fails inside.
   */
  doOperation(operation: Operation): void;
  /** Reverts the top of the undo stack; a no-op on an empty stack. */
  undo(): void;
  redo(): void;
  isModified(): boolean;
  /** Repository is an EventEmitter; "operationExecuted" follows each recorded operation, undo and redo. */
  on(event: string, listener: (operation: Operation) => void): unknown;
  off(event: string, listener: (operation: Operation) => void): unknown;
}

/** core/repository.js OperationBuilder._getBase plus the recorded ops. */
export interface Operation {
  id?: string;
  name: string;
  bypass?: boolean;
  ops: unknown[];
}

/** Options accepted by Factory.createModelAndView in 7.x. */
export interface ModelAndViewOptions {
  /** A key of app.factory.getModelAndViewIds(). */
  id: string;
  parent: Element;
  diagram: Element;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  tailView?: View;
  headView?: View;
  tailModel?: Element | null;
  headModel?: Element | null;
  containerView?: View;
  /**
   * Some factory functions measure against the editor's canvas, e.g. the
   * timing diagram's time segments (uml-factory.js); the UI always passes it.
   */
  editor?: unknown;
  modelInitializer?: (model: Element) => void;
  viewInitializer?: (view: View) => void;
}

/**
 * engine/factory.js. Each create function takes a single options object and
 * returns null (after a console.error) when `id` names no registered factory
 * function (docs: developing-extensions/creating-deleting-and-modifying-elements).
 */
export interface Factory {
  createModel(options: {
    id: string;
    parent: Element;
    field?: string;
    modelInitializer?: (model: Element) => void;
  }): Element | null;
  createDiagram(options: {
    id: string;
    parent: Element;
    diagramInitializer?: (diagram: Element) => void;
  }): Element | null;
  /** Returns the created view; the created model is its `model`. */
  createModelAndView(options: ModelAndViewOptions): View | null;
  getModelIds(): string[];
  getModelAndViewIds(): string[];
  getDiagramIds(): string[];
  /** Default options per model-and-view id, e.g. modelType, viewType, field (registerModelAndViewFn). */
  modelAndViewOptions: Record<
    string,
    { modelType?: string; viewType?: string }
  >;
}

/** engine/engine.js */
export interface Engine {
  /** Silently ignores (returns null for) a field the element does not declare. */
  setProperty(elem: Element, field: string, value: unknown): unknown;
  /** Cascades to owned elements, relationships, views, sub-views and connected edges. */
  deleteElements(models: Element[], views: Element[]): unknown;
  /** Inserts `model` into `parent[field]` as one operation; returns the stored element. */
  addModel(parent: Element, field: string, model: Element): Element | null;
  /** No-op unless `elem[field]` is an array. */
  addItem(elem: Element, field: string, value: Element): void;
  removeItem(elem: Element, field: string, value: Element): void;
  /**
   * No-op unless `elem` is in `elem._parent[field]` and `newOwner[field]`
   * exists; the element is appended to `newOwner[field]`.
   */
  relocate(elem: Element, newOwner: Element, field: string): void;
  /*
   * View edits. Each returns null after a console.error when a required
   * argument is missing and otherwise records one operation. `editor` must
   * show the diagram the views are on: moveViews and resizeNode traverse
   * editor.diagram to carry connected edges along.
   */
  /** `direction` is one of Diagram.LD_* ("TB", "BT", "LR", "RL"). */
  layoutDiagram(
    editor: unknown,
    diagram: Element,
    direction: string,
    separations?: { node: number; edge: number; rank: number },
    edgeLineStyle?: number,
  ): unknown;
  moveViews(editor: unknown, views: View[], dx: number, dy: number): unknown;
  /** Absolute diagram coordinates of the new bounds. */
  resizeNode(
    editor: unknown,
    node: View,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): unknown;
  /** Colours are CSS colour strings, e.g. "#ffffff". */
  setFillColor(editor: unknown, views: View[], color: string): unknown;
  setLineColor(editor: unknown, views: View[], color: string): unknown;
  setFontColor(editor: unknown, views: View[], color: string): unknown;
  setFontFace(editor: unknown, views: View[], face: string): unknown;
  setFontSize(editor: unknown, views: View[], size: number): unknown;
  /** One of EdgeView.LS_*: 0 rectilinear, 1 oblique, 2 roundrect, 3 curve. */
  setLineStyle(editor: unknown, views: View[], lineStyle: number): unknown;
  /** One of UMLGeneralNodeView.SD_*, e.g. "label", "icon". */
  setStereotypeDisplay(editor: unknown, views: View[], value: string): unknown;
  setAutoResize(editor: unknown, views: View[], autoResize: boolean): unknown;
}

/** ui/diagram-manager.js */
export interface DiagramManager {
  setCurrentDiagram(diagram: Element): void;
  closeDiagram(diagram: Element): void;
  getEditor(): unknown;
  getCurrentDiagram(): Element | null;
  /** The editor's tabs, in tab order; the live array, not a copy. */
  getWorkingDiagrams(): Element[];
  /** DiagramEditor.setZoomScale clamps to 0.1..3. */
  setZoomLevel(scale: number): void;
  getZoomLevel(): number;
  /** Centres the viewport on (x, y) in diagram coordinates. */
  scrollTo(x: number, y: number): void;
  /** Show/hide also store the diagramEditor.showGrid preference. */
  showGrid(): void;
  hideGrid(): void;
  isGridVisible(): boolean;
  setSnapToGrid(allow: boolean): void;
  getSnapToGrid(): boolean;
  repaint(): void;
  deselectAll(): void;
}

/**
 * ui/diagram-editor.js, reached as app.diagrams.diagramEditor the way
 * default-commands.js does. selectView replaces the selection and
 * selectAdditionalView extends it; both emit selectionChanged, which the
 * diagram manager forwards to app.selections.
 */
export interface DiagramEditor {
  selectView(view: View): void;
  selectAdditionalView(view: View): void;
}

/** engine/selection-manager.js */
export interface SelectionManager {
  getSelectedModels(): Element[];
  getSelectedViews(): View[];
  /** Replaces both lists and fires selectionChanged when either differs. */
  select(models: Element[], views: View[]): void;
  deselectAll(): void;
}

/** engine/license-store.js. */
export interface LicenseStore {
  getLicenseStatus(): { trial?: boolean; edition?: string };
}

/** Attribute kinds accepted by MetamodelManager.validateMetaType (core/metamodel-manager.js). */
export type AttributeKind =
  "prim" | "enum" | "var" | "ref" | "refs" | "obj" | "objs" | "custom";

/** One entry of a metamodel.json `attributes` array. */
export interface MetaAttribute {
  name: string;
  kind: AttributeKind;
  /** Integer/String/Boolean/Real/Image for prim, else a meta type name. */
  type: string;
  /** Not saved to .mdj files (Element.save skips it). */
  transient?: boolean;
  default?: unknown;
  visible?: boolean;
  /** Suggested values of a prim attribute, e.g. multiplicities. */
  options?: string[];
}

/** One entry of the `meta` global, as registered from metamodel.json files. */
export interface MetaType {
  kind: "class" | "enum";
  super?: string;
  attributes?: MetaAttribute[];
  literals?: string[];
  /** View class shown for this model class. */
  view?: string;
  /** View classes a diagram class accepts, besides those of its supers. */
  views?: string[];
}

/** core/metamodel-manager.js */
export interface MetamodelManager {
  /** Inherited attributes first; throws a TypeError for a name not in `meta`. */
  getMetaAttributes(typeName: string): MetaAttribute[];
  /** False when `child` is not in `meta`. */
  isKindOf(child: string, parent: string): boolean;
  getViewTypeOf(typeName: string): string | null;
  /** Throws a TypeError for a name not in `meta`. */
  getAvailableViewTypes(diagramTypeName: string): string[];
}

/** One palette entry, from an extension's toolbox/*.json (views/toolbox-view.js). */
export interface ToolboxItem {
  id: string;
  groupId: string;
  title: string;
  /** "rect" | "point" for nodes, "line" for edges. */
  rubberband: string;
  /** Command run on drop; default factory:create-model-and-view. */
  command?: string;
  /** Options merged into createModelAndView's, e.g. {id, "model-init"}. */
  commandArg?: Record<string, unknown>;
}

/** views/toolbox-view.js; groups and items are own fields. */
export interface Toolbox {
  groups: Record<
    string,
    {
      id: string;
      title: string;
      /** Null when the group shows on every diagram. */
      diagramTypes: (abstract new (...args: never[]) => unknown)[] | null;
    }
  >;
  /** Keyed by item id; an id listed in several groups keeps its last entry. */
  items: Record<string, ToolboxItem>;
}

/** core/preference-manager.js; docs: developing-extensions/defining-preferences */
export interface PreferenceManager {
  /** Stored value, else the schema default, else `defaultValue`, else null. */
  get(key: string, defaultValue?: unknown): unknown;
  /** Stores the value for the next get; the dialog shows it too. */
  set(key: string, value: unknown): void;
}

/** dialogs/dialog-manager.js; docs: developing-extensions/using-dialogs */
export interface Dialogs {
  showInfoDialog(message: string): unknown;
}

export interface StarUMLApp {
  commands: CommandManager;
  project: ProjectManager;
  repository: Repository;
  factory: Factory;
  engine: Engine;
  diagrams: DiagramManager & { diagramEditor: DiagramEditor };
  selections: SelectionManager;
  licenseStore: LicenseStore;
  dialogs: Dialogs;
  preferences: PreferenceManager;
  metamodels: MetamodelManager;
  toolbox: Toolbox;
  /** StarUML's package.json version, e.g. "7.1.1" (app-context.js). */
  version: string;
  /** StarUML's package.json. */
  metadata: { apiVersion?: string };
  [key: string]: unknown;
}

declare global {
  var app: StarUMLApp;
  /** Metamodel classes by name, e.g. `type.View`, `type.UMLClass` (core/core.js). */
  var type: Record<string, abstract new (...args: never[]) => unknown>;
  /** Metamodel definitions by type name (core/metamodel-manager.js registers into global.meta). */
  var meta: Record<string, MetaType>;
}

export {};
