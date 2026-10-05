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

export interface ProjectManager {
  getFilename(): string | null;
  getProject(): unknown;
  save(filename?: string): Promise<void>;
  saveAs(filename: string): Promise<void>;
  newProject(): unknown;
  loadFromFile(filename: string): Promise<void>;
  closeProject(): void;
}

/** core/repository.js */
export interface Repository {
  get(id: string): Element | undefined;
  /** Throws a TypeError when `typeName` is not a key of the `type` global. */
  getInstancesOf(typeName: string): Element[];
  findAll(predicate: (elem: Element) => boolean): Element[];
  getViewsOf(model: Element): View[];
  getEdgeViewsOf(view: Element): View[];
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
  createModelAndView(options: unknown): Element | null;
}

/** engine/engine.js */
export interface Engine {
  /** Silently ignores (returns null for) a field the element does not declare. */
  setProperty(elem: Element, field: string, value: unknown): unknown;
  /** Cascades to owned elements, relationships, views, sub-views and connected edges. */
  deleteElements(models: Element[], views: Element[]): unknown;
}

/** ui/diagram-manager.js */
export interface DiagramManager {
  setCurrentDiagram(diagram: Element): void;
  closeDiagram(diagram: Element): void;
}

/** core/preference-manager.js; docs: developing-extensions/defining-preferences */
export interface PreferenceManager {
  /** Stored value, else the schema default, else `defaultValue`, else null. */
  get(key: string, defaultValue?: unknown): unknown;
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
  diagrams: DiagramManager;
  dialogs: Dialogs;
  preferences: PreferenceManager;
  [key: string]: unknown;
}

declare global {
  var app: StarUMLApp;
  /** Metamodel classes by name, e.g. `type.View`, `type.UMLClass` (core/core.js). */
  var type: Record<string, abstract new (...args: never[]) => unknown>;
}

export {};
