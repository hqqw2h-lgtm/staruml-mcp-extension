/**
 * In-memory stand-in for the StarUML `app` and `type` globals.
 *
 * Every manager class declares exactly the prototype method names that
 * StarUML 7.1.1 exposes (tests/fixtures/app-surface.7.1.1.json, checked by
 * tests/unit/mock-surface.test.ts). Methods the extension does not call yet
 * are stubs that throw, so a handler that starts depending on one fails loudly
 * instead of passing against invented behaviour.
 *
 * Modelled semantics are taken from the 7.1.1 sources shipped in
 * StarUML.app/Contents/Resources/app/src (engine/factory.js,
 * engine/project-manager.js, engine/command-manager.js, engine/engine.js,
 * core/repository.js):
 * - factory.create{Model,Diagram,ModelAndView} take one options object and
 *   return null (after console.error) for an unregistered id;
 * - project.save(fullPath) and project.load(fullPath) are synchronous and
 *   need a path; there is no saveAs or loadFromFile;
 * - engine.setProperty ignores fields the element does not declare;
 * - engine.deleteElements cascades to children, relationships and views;
 * - commands.execute returns false for an unknown id.
 */

let nextId = 1;

export class Element {
  _id: string;
  _parent: Element | null = null;
  name = "";
  ownedElements: Element[] = [];
  constructor() {
    this._id = `MOCK${String(nextId++).padStart(6, "0")}`;
  }
}

export class Model extends Element {}
export class Project extends Model {}
export class UMLModel extends Model {}
export class UMLPackage extends Model {}
export class UMLClassifier extends Model {
  attributes: Element[] = [];
  operations: Element[] = [];
}
export class UMLClass extends UMLClassifier {}
export class UMLInterface extends UMLClassifier {}
export class UMLActor extends UMLClassifier {}
export class UMLUseCase extends UMLClassifier {}
export class UMLAttribute extends Model {}
export class UMLRelationship extends Model {
  end1: { reference: Element | null } = { reference: null };
  end2: { reference: Element | null } = { reference: null };
}
export class UMLAssociation extends UMLRelationship {}
export class UMLDependency extends UMLRelationship {}

export class Diagram extends Model {
  ownedViews: View[] = [];
}
export class UMLClassDiagram extends Diagram {}
export class UMLUseCaseDiagram extends Diagram {}

export class View extends Element {
  model: Element | null = null;
  subViews: View[] = [];
}
export class NodeView extends View {
  left = 0;
  top = 0;
  width = 0;
  height = 0;
}
export class EdgeView extends View {
  tail: View | null = null;
  head: View | null = null;
}
export class UMLClassView extends NodeView {}
export class UMLInterfaceView extends NodeView {}
export class UMLActorView extends NodeView {}
export class UMLUseCaseView extends NodeView {}
export class UMLAssociationView extends EdgeView {}
export class UMLDependencyView extends EdgeView {}

type Ctor<T> = new () => T;

const MODEL_TYPES: Record<string, Ctor<Model>> = {
  UMLModel,
  UMLPackage,
  UMLClass,
  UMLInterface,
  UMLActor,
  UMLUseCase,
  UMLAttribute,
  UMLAssociation,
  UMLDependency,
};

const DIAGRAM_TYPES: Record<string, Ctor<Diagram>> = {
  UMLClassDiagram,
  UMLUseCaseDiagram,
};

const MODEL_AND_VIEW_TYPES: Record<
  string,
  { model: Ctor<Model>; view: Ctor<View> }
> = {
  UMLClass: { model: UMLClass, view: UMLClassView },
  UMLInterface: { model: UMLInterface, view: UMLInterfaceView },
  UMLActor: { model: UMLActor, view: UMLActorView },
  UMLUseCase: { model: UMLUseCase, view: UMLUseCaseView },
  UMLAssociation: { model: UMLAssociation, view: UMLAssociationView },
  UMLDependency: { model: UMLDependency, view: UMLDependencyView },
};

/** The metamodel classes as exposed through the `type` global. */
export const mockTypes: Record<string, Ctor<Element>> = {
  Element,
  Model,
  Project,
  Diagram,
  View,
  NodeView,
  EdgeView,
  UMLClassifier,
  UMLRelationship,
  ...MODEL_TYPES,
  ...DIAGRAM_TYPES,
  UMLClassView,
  UMLInterfaceView,
  UMLActorView,
  UMLUseCaseView,
  UMLAssociationView,
  UMLDependencyView,
};

function notModeled(owner: string, name: string): never {
  throw new Error(`mock: ${owner}.${name} is not modelled`);
}

/** Adds throwing stubs so the prototype carries every name the real one has. */
function stub(
  cls: { name: string; prototype: object },
  names: readonly string[],
): void {
  for (const name of names) {
    Object.defineProperty(cls.prototype, name, {
      value: () => notModeled(cls.name, name),
      writable: true,
      configurable: true,
    });
  }
}

function children(elem: Element): Element[] {
  const out: Element[] = [...elem.ownedElements];
  if (elem instanceof UMLClassifier)
    out.push(...elem.attributes, ...elem.operations);
  if (elem instanceof Diagram) out.push(...elem.ownedViews);
  if (elem instanceof View) out.push(...elem.subViews);
  return out;
}

export class Repository {
  _idMap: Record<string, Element> = {};
  _modified = false;

  get(id: string): Element | undefined {
    return this._idMap[id];
  }
  getIdMap(): Record<string, Element> {
    return this._idMap;
  }
  /** Only the type selector `@Type` is modelled. */
  select(selector: string): Element[] {
    const match = /^@(\w+)$/.exec(selector);
    if (!match) return notModeled("Repository", `select(${selector})`);
    return this.getInstancesOf(match[1]!);
  }
  find(predicate: (e: Element) => boolean): Element | null {
    return Object.values(this._idMap).find(predicate) ?? null;
  }
  findAll(predicate: (e: Element) => boolean): Element[] {
    return Object.values(this._idMap).filter(predicate);
  }
  getInstancesOf(typeName: string): Element[] {
    const ctor = mockTypes[typeName];
    return this.findAll((e) => {
      // Same failure as the real `elem instanceof global.type[name]` for an unknown name.
      if (!ctor)
        throw new TypeError("Right-hand side of 'instanceof' is not callable");
      return e instanceof ctor;
    });
  }
  getViewsOf(model: Element): View[] {
    return this.findAll(
      (e) => e instanceof View && e.model === model,
    ) as View[];
  }
  getEdgeViewsOf(view: Element): EdgeView[] {
    return this.findAll(
      (e) => e instanceof EdgeView && (e.tail === view || e.head === view),
    ) as EdgeView[];
  }
  getRelationshipsOf(model: Element): UMLRelationship[] {
    return this.findAll(
      (e) =>
        e instanceof UMLRelationship &&
        (e.end1.reference === model || e.end2.reference === model),
    ) as UMLRelationship[];
  }
  isElement(value: unknown): boolean {
    return value instanceof Element;
  }
  isModified(): boolean {
    return this._modified;
  }
  setModified(modified: boolean): void {
    this._modified = modified;
  }
  clear(): void {
    this._idMap = {};
    this._modified = false;
  }

  /** Test helper, not on the real prototype: registers an element and its subtree. */
  index(elem: Element): void {
    this._idMap[elem._id] = elem;
    for (const child of children(elem)) this.index(child);
  }
  unindex(elem: Element): void {
    delete this._idMap[elem._id];
    for (const child of children(elem)) this.unindex(child);
  }
}
stub(Repository, [
  "_addRef",
  "_addRefsOf",
  "_applyOperation",
  "_removeRef",
  "_removeRefsOf",
  "_revertOperation",
  "bypassFieldAssign",
  "bypassInsert",
  "doOperation",
  "extractChanged",
  "generateGuid",
  "getConnectedHeadNodeViews",
  "getConnectedNodeViews",
  "getConnectedTailNodeViews",
  "getOperationBuilder",
  "getRefsTo",
  "lookupAndFind",
  "readObject",
  "redo",
  "search",
  "undo",
  "writeObject",
]);
const REPOSITORY_HELPERS = ["index", "unindex"];

interface ModelOptions {
  id: string;
  parent: Element;
  field?: string;
  modelInitializer?: (m: Element) => void;
}
interface DiagramOptions {
  id: string;
  parent: Element;
  diagramInitializer?: (d: Element) => void;
}
interface ModelAndViewOptions {
  id: string;
  parent: Element;
  diagram: Diagram;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  tailView?: View;
  headView?: View;
  tailModel?: Element;
  headModel?: Element;
  modelInitializer?: (m: Element) => void;
  viewInitializer?: (v: View) => void;
}

function attach(parent: Element, field: string, child: Element): void {
  const list = (parent as unknown as Record<string, unknown>)[field];
  if (!Array.isArray(list))
    throw new Error(`mock: ${parent.constructor.name}.${field} is not a list`);
  list.push(child);
  child._parent = parent;
}

export class Factory {
  constructor(private readonly repository: Repository) {}

  createModel(options: ModelOptions): Element | null {
    const ctor = MODEL_TYPES[options.id];
    if (!ctor) return null;
    const model = new ctor();
    options.modelInitializer?.(model);
    attach(options.parent, options.field ?? "ownedElements", model);
    this.repository.index(model);
    this.repository.setModified(true);
    return model;
  }

  createDiagram(options: DiagramOptions): Diagram | null {
    const ctor = DIAGRAM_TYPES[options.id];
    if (!ctor) return null;
    const diagram = new ctor();
    options.diagramInitializer?.(diagram);
    attach(options.parent, "ownedElements", diagram);
    this.repository.index(diagram);
    this.repository.setModified(true);
    return diagram;
  }

  /**
   * A positional call passes the type name string as `options`, so `options.id`
   * is undefined and the real factory returns null; that is how issue #1
   * surfaced as "Cannot read properties of null (reading 'model')".
   */
  createModelAndView(options: ModelAndViewOptions): View | null {
    const spec = MODEL_AND_VIEW_TYPES[options.id];
    if (!spec) return null;
    const model = new spec.model();
    const view = new spec.view();
    view.model = model;
    if (model instanceof UMLRelationship) {
      model.end1.reference = options.tailModel ?? null;
      model.end2.reference = options.headModel ?? null;
    }
    if (view instanceof EdgeView) {
      view.tail = options.tailView ?? null;
      view.head = options.headView ?? null;
    }
    if (view instanceof NodeView) {
      view.left = options.x1 ?? 0;
      view.top = options.y1 ?? 0;
      view.width = (options.x2 ?? view.left) - view.left;
      view.height = (options.y2 ?? view.top) - view.top;
    }
    options.modelInitializer?.(model);
    options.viewInitializer?.(view);
    attach(options.parent, "ownedElements", model);
    options.diagram.ownedViews.push(view);
    view._parent = options.diagram;
    this.repository.index(model);
    this.repository.index(view);
    this.repository.setModified(true);
    return view;
  }

  getModelIds(): string[] {
    return Object.keys(MODEL_TYPES);
  }
  getDiagramIds(): string[] {
    return Object.keys(DIAGRAM_TYPES);
  }
  getModelAndViewIds(): string[] {
    return Object.keys(MODEL_AND_VIEW_TYPES);
  }
}
stub(Factory, [
  "_defaultModelPrecondition",
  "assert",
  "assignInitObject",
  "createViewAndRelationships",
  "createViewOf",
  "defaultDiagramFn",
  "defaultDirectedRelationshipFn",
  "defaultEdgeViewOnlyFn",
  "defaultModelAndViewFn",
  "defaultModelFn",
  "defaultUndirectedRelationshipFn",
  "defaultViewOnDiagramFn",
  "defaultViewOnlyFn",
  "getViewByTypes",
  "registerDiagramFn",
  "registerModelAndViewFn",
  "registerModelFn",
  "registerViewOfFn",
  "triggerDiagramCreated",
  "triggerElementCreated",
]);

export class Engine {
  constructor(private readonly repository: Repository) {}

  setProperty(elem: Element, field: string, value: unknown): null | undefined {
    const record = elem as unknown as Record<string, unknown>;
    if (!elem || !field || typeof record[field] === "undefined") return null;
    record[field] = value;
    this.repository.setModified(true);
    return undefined;
  }

  setProperties(elem: Element, values: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(values))
      this.setProperty(elem, field, value);
  }

  deleteElements(models: Element[], views: Element[]): void {
    const all = new Set<Element>([...models, ...views]);
    let changed = true;
    while (changed) {
      const before = all.size;
      for (const elem of [...all]) {
        for (const child of children(elem)) all.add(child);
        if (elem instanceof View) {
          for (const edge of this.repository.getEdgeViewsOf(elem))
            all.add(edge);
        } else {
          for (const rel of this.repository.getRelationshipsOf(elem))
            all.add(rel);
          for (const view of this.repository.getViewsOf(elem)) all.add(view);
        }
      }
      changed = all.size !== before;
    }
    for (const elem of all) {
      const parent = elem._parent;
      if (parent) {
        for (const list of Object.values(parent)) {
          if (Array.isArray(list)) {
            const i = list.indexOf(elem);
            if (i >= 0) list.splice(i, 1);
          }
        }
      }
      this.repository.unindex(elem);
    }
    this.repository.setModified(true);
  }
}
stub(Engine, [
  "_determineDeletingElements",
  "_determineOutsideElements",
  "addItem",
  "addModel",
  "addModelAndView",
  "addViews",
  "layoutDiagram",
  "modifyEdge",
  "moveDown",
  "moveParasiticView",
  "moveUp",
  "moveViews",
  "moveViewsChangingContainer",
  "reconnectEdge",
  "relocate",
  "removeItem",
  "resizeNode",
  "setAutoResize",
  "setElemsProperty",
  "setFillColor",
  "setFont",
  "setFontColor",
  "setFontFace",
  "setFontSize",
  "setLineColor",
  "setLineStyle",
  "setStereotypeDisplay",
]);

export class DiagramManager {
  current: Diagram | null = null;
  working: Diagram[] = [];

  getCurrentDiagram(): Diagram | null {
    return this.current;
  }
  /** Like the real one, accepts any element; callers must check it is a diagram. */
  setCurrentDiagram(diagram: Diagram): void {
    this.openDiagram(diagram);
    this.current = diagram;
  }
  openDiagram(diagram: Diagram): void {
    if (!this.working.includes(diagram)) this.working.push(diagram);
  }
  closeDiagram(diagram: Diagram): void {
    this.working = this.working.filter((d) => d !== diagram);
    if (this.current === diagram) this.current = this.working[0] ?? null;
  }
  closeAll(): void {
    this.working = [];
    this.current = null;
  }
  getWorkingDiagrams(): Diagram[] {
    return [...this.working];
  }
}
stub(DiagramManager, [
  "__fixDiagramProblem",
  "_currentDiagramChangedEvent",
  "_setupKeyBindings",
  "_setupPreferences",
  "_setupUI",
  "_triggerDoubleClickedEvent",
  "_triggerFileDropEvent",
  "_triggerSelectionChangedEvent",
  "_triggerViewMovedEvent",
  "appReady",
  "closeOthers",
  "deselectAll",
  "getDiagramArea",
  "getEditor",
  "getHiddenEditor",
  "getScrollPosition",
  "getSnapToGrid",
  "getViewportSize",
  "getZoomLevel",
  "hideGrid",
  "htmlReady",
  "isGridVisible",
  "needRepaint",
  "nextDiagram",
  "previousDiagram",
  "repaint",
  "restoreDiagramOrigin",
  "restoreWorkingDiagrams",
  "resumeRepaint",
  "saveWorkingDiagrams",
  "scrollTo",
  "selectAll",
  "selectInDiagram",
  "setActiveHandler",
  "setSnapToGrid",
  "setZoomLevel",
  "showGrid",
  "suspendRepaint",
  "toggleGrid",
  "toggleSnapToGrid",
  "updateDiagram",
]);

export class CommandManager {
  commands: Record<string, (...args: unknown[]) => unknown> = {};
  commandNames: Record<string, string> = {};

  register(
    id: string,
    handler: (...args: unknown[]) => unknown,
    name?: string,
  ): null | undefined {
    if (this.commands[id] || !id || !handler) return null;
    this.commands[id] = handler;
    if (name) this.commandNames[id] = name;
    return undefined;
  }
  execute(id: string, ...args: unknown[]): unknown {
    const handler = this.commands[id];
    return handler ? handler(...args) : false;
  }
}

/** Serialised project files keyed by absolute path, standing in for the disk. */
export type MockDisk = Map<string, string>;

export class ProjectManager {
  filename: string | null = null;
  project: Project | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly disk: MockDisk,
  ) {}

  getFilename(): string | null {
    return this.filename;
  }
  getProject(): Project | null {
    return this.project;
  }

  /** An empty Project; StarUML's default Model > Main comes from a template, not from here. */
  newProject(): Project {
    this.project = new Project();
    this.filename = null;
    this.repository.clear();
    this.repository.index(this.project);
    return this.project;
  }

  save(fullPath: string): Project | null {
    if (typeof fullPath !== "string") {
      throw new TypeError(
        `The "path" argument must be of type string or an instance of Buffer or URL. Received ${String(fullPath)}`,
      );
    }
    this.disk.set(
      fullPath,
      this.project ? JSON.stringify(serialize(this.project)) : "null",
    );
    this.filename = fullPath;
    this.repository.setModified(false);
    return this.project;
  }

  load(fullPath: string): Project | null {
    const text = this.disk.get(fullPath);
    if (text === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${fullPath}'`);
    }
    if (!text) return null;
    this.closeProject();
    this.project = deserialize(
      JSON.parse(text) as SerializedElement,
      null,
    ) as Project;
    this.repository.index(this.project);
    this.filename = fullPath;
    this.repository.setModified(false);
    return this.project;
  }

  closeProject(): void {
    this.project = null;
    this.filename = null;
    this.repository.clear();
  }
}
stub(ProjectManager, [
  "exportToFile",
  "importFromFile",
  "importFromJson",
  "loadAsTemplate",
  "loadFromJson",
]);

interface SerializedElement {
  _type: string;
  _id: string;
  name: string;
  ownedElements: SerializedElement[];
}

function serialize(elem: Element): SerializedElement {
  return {
    _type: elem.constructor.name,
    _id: elem._id,
    name: elem.name,
    ownedElements: elem.ownedElements.map(serialize),
  };
}

function deserialize(data: SerializedElement, parent: Element | null): Element {
  const ctor = mockTypes[data._type]!;
  const elem = new ctor();
  elem._id = data._id;
  elem.name = data.name;
  elem._parent = parent;
  elem.ownedElements = data.ownedElements.map((child) =>
    deserialize(child, elem),
  );
  return elem;
}

interface PreferenceItem {
  text?: string;
  type?: string;
  default?: unknown;
}

/** Follows core/preference-manager.js, with a Map in place of localStorage. */
export class PreferenceManager {
  schemaMap: Record<string, unknown> = {};
  itemMap: Record<string, PreferenceItem> = {};
  stored = new Map<string, unknown>();

  /** Throws where the real one logs, so a malformed preference.json fails a test. */
  validate(schema: Record<string, PreferenceItem>): boolean {
    for (const [key, item] of Object.entries(schema)) {
      if (!item.text || !item.type)
        throw new Error(`mock: ${key} lacks text or type`);
      if (item.type !== "section" && typeof item.default === "undefined") {
        throw new Error(`mock: ${key} lacks a default`);
      }
    }
    return true;
  }
  register(def: {
    id: string;
    name: string;
    schema: Record<string, PreferenceItem>;
  }): void {
    if (!def.id || !def.name || !def.schema)
      throw new Error("mock: incomplete preference def");
    this.validate(def.schema);
    this.schemaMap[def.id] = def;
    Object.assign(this.itemMap, def.schema);
  }
  get(key: string, defaultValue: unknown = null): unknown {
    if (this.stored.has(key)) return this.stored.get(key);
    const item = this.itemMap[key];
    return item && typeof item.default !== "undefined"
      ? item.default
      : defaultValue;
  }
  set(key: string, value: unknown): void {
    this.stored.set(key, value);
  }
}
stub(PreferenceManager, [
  "getItem",
  "getSchema",
  "getSchemaIds",
  "getSchemaName",
  "getViewState",
  "setViewState",
]);

export class SelectionManager {}
stub(SelectionManager, [
  "deselectAll",
  "getSelected",
  "getSelectedModels",
  "getSelectedViews",
  "isChanged",
  "select",
  "selectModel",
  "selectViews",
  "triggerEvent",
]);

export class Dialogs {
  shown: { kind: string; message: string }[] = [];
  showInfoDialog(message: string): void {
    this.shown.push({ kind: "info", message });
  }
}
stub(Dialogs, [
  "cancelModalDialogIfOpen",
  "showAlertDialog",
  "showColorDialog",
  "showConfirmDialog",
  "showErrorDialog",
  "showFontDialog",
  "showInputDialog",
  "showModalDialog",
  "showModalDialogUsingTemplate",
  "showOpenDialog",
  "showOpenDialogAsync",
  "showSaveConfirmDialog",
  "showSaveDialog",
  "showSaveDialogAsync",
  "showSelectDropdownDialog",
  "showSelectRadioDialog",
  "showSimpleDialog",
  "showTextDialog",
]);

export interface MockApp {
  commands: CommandManager;
  project: ProjectManager;
  repository: Repository;
  factory: Factory;
  engine: Engine;
  diagrams: DiagramManager;
  preferences: PreferenceManager;
  selections: SelectionManager;
  dialogs: Dialogs;
}

export interface MockEnvironment {
  app: MockApp;
  disk: MockDisk;
  /** The default `Model` package of the fresh project. */
  model: UMLModel;
  /** The default `Main` class diagram of the fresh project. */
  mainDiagram: UMLClassDiagram;
}

/** Fresh app with a new project; installs it as the `app` and `type` globals. */
export function installMockApp(): MockEnvironment {
  const disk: MockDisk = new Map();
  const repository = new Repository();
  const app: MockApp = {
    commands: new CommandManager(),
    project: new ProjectManager(repository, disk),
    repository,
    factory: new Factory(repository),
    engine: new Engine(repository),
    diagrams: new DiagramManager(),
    preferences: new PreferenceManager(),
    selections: new SelectionManager(),
    dialogs: new Dialogs(),
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.app = app;
  g.type = mockTypes;

  // StarUML starts on its default template: Untitled > Model > Main.
  const project = app.project.newProject();
  project.name = "Untitled";
  const model = new UMLModel();
  model.name = "Model";
  attach(project, "ownedElements", model);
  const mainDiagram = new UMLClassDiagram();
  mainDiagram.name = "Main";
  attach(model, "ownedElements", mainDiagram);
  repository.index(model);
  repository.setModified(false);
  return { app, disk, model, mainDiagram };
}

export const MOCK_ONLY_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  repository: REPOSITORY_HELPERS,
};
