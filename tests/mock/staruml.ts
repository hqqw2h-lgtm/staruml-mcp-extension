/**
 * In-memory stand-in for the StarUML `app`, `type` and `meta` globals.
 *
 * Every manager class declares exactly the prototype method names that
 * StarUML 7.1.1 exposes (tests/fixtures/app-surface.7.1.1.json, checked by
 * tests/unit/mock-surface.test.ts). Methods the extension does not call yet
 * are stubs that throw, so a handler that starts depending on one fails loudly
 * instead of passing against invented behaviour.
 *
 * Element classes are generated from the 7.1.1 metamodel
 * (tests/fixtures/metamodel.7.1.1.json): one class per meta class, extending
 * its `super`, with every own attribute initialised by kind the way the
 * element constructors in core/core.js and the extensions' elements.js do.
 *
 * Modelled semantics are taken from the 7.1.1 sources shipped in
 * StarUML.app/Contents/Resources/app/src (engine/factory.js,
 * engine/project-manager.js, engine/command-manager.js, engine/engine.js,
 * core/repository.js, core/metamodel-manager.js):
 * - factory.create{Model,Diagram,ModelAndView} take one options object and
 *   return null (after console.error) for an unregistered id, and throw a
 *   plain string when a precondition fails;
 * - project.save(fullPath) and project.load(fullPath) are synchronous and
 *   need a path; there is no saveAs or loadFromFile;
 * - engine.setProperty ignores fields the element does not declare;
 * - engine.deleteElements cascades to children, relationships and views;
 * - commands.execute returns false for an unknown id.
 */
import metamodel from "../fixtures/metamodel.7.1.1.json";

export interface MetaAttribute {
  name: string;
  kind: string;
  type: string;
  default?: unknown;
  transient?: boolean;
}
export interface MetaType {
  name?: string;
  kind: string;
  super?: string;
  attributes?: MetaAttribute[];
  literals?: string[];
  view?: string;
  views?: string[];
  ordering?: number;
}

export const META = metamodel.meta as unknown as Record<string, MetaType>;

let nextId = 1;

/** Fields every mock element carries; generated classes add the rest. */
export class MockElement {
  _id: string;
  _parent: MockElement | null = null;
  [field: string]: unknown;
  constructor() {
    this._id = `MOCK${String(nextId++).padStart(6, "0")}`;
  }
}

export type Element = MockElement & { name: string };
export type View = Element & {
  model: Element | null;
  subViews: View[];
  tail?: View | null;
  head?: View | null;
};
type Ctor = new () => MockElement;

function ownAttributes(typeName: string): MetaAttribute[] {
  return META[typeName]!.attributes ?? [];
}

/** core/metamodel-manager.js getMetaAttributes: inherited attributes first. */
function metaAttributes(typeName: string): MetaAttribute[] {
  const metaClass = META[typeName]!;
  const inherited = metaClass.super ? metaAttributes(metaClass.super) : [];
  return [...inherited, ...(metaClass.attributes ?? [])];
}

function isKindOf(child: string | undefined, parent: string): boolean {
  if (!child || !META[child]) return false;
  if (META[child] === META[parent]) return true;
  return isKindOf(META[child]!.super, parent);
}

const PRIM_DEFAULTS: Record<string, unknown> = {
  String: "",
  Integer: 0,
  Real: 0,
  Boolean: false,
  Image: "",
};

/** Custom attributes (Font, Points) store themselves through __write. */
class CustomValue {
  constructor(readonly text: string) {}
  __write(): string {
    return this.text;
  }
}

/**
 * Relationship ends are created by the relationship's constructor with the
 * most specific end class, e.g. UMLAssociation → UMLAssociationEnd.
 */
function endTypeFor(typeName: string): string {
  for (let t: string | undefined = typeName; t; t = META[t]!.super) {
    if (META[`${t}End`]?.kind === "class") return `${t}End`;
  }
  return "RelationshipEnd";
}

function initialValue(owner: MockElement, attr: MetaAttribute): unknown {
  switch (attr.kind) {
    case "prim":
      return attr.default ?? PRIM_DEFAULTS[attr.type];
    case "enum":
      return attr.default ?? META[attr.type]!.literals![0];
    case "refs":
    case "objs":
      return [];
    case "obj": {
      if (attr.name !== "end1" && attr.name !== "end2") return null;
      const end = new mockTypes[endTypeFor(owner.constructor.name)]!();
      end._parent = owner;
      return end;
    }
    case "custom":
      return new CustomValue(attr.type === "Font" ? "Arial;13;0" : "");
    default:
      return null;
  }
}

function generateClasses(): Record<string, Ctor> {
  const classes: Record<string, Ctor> = {};
  const define = (name: string): Ctor => {
    const existing = classes[name];
    if (existing) return existing;
    const metaClass = META[name]!;
    const Base: Ctor = metaClass.super ? define(metaClass.super) : MockElement;
    const attrs = ownAttributes(name).filter(
      (a) => a.name !== "_id" && a.name !== "_parent",
    );
    // A computed key gives the class its metamodel name as constructor.name.
    const cls = {
      [name]: class extends Base {
        constructor() {
          super();
          for (const attr of attrs) this[attr.name] = initialValue(this, attr);
        }
      },
    }[name]!;
    classes[name] = cls;
    return cls;
  };
  for (const [name, metaClass] of Object.entries(META)) {
    if (metaClass.kind === "class") define(name);
  }
  return classes;
}

/** The metamodel classes as exposed through the `type` global. */
export const mockTypes: Record<string, Ctor> = generateClasses();

export function create<T extends MockElement = Element>(typeName: string): T {
  const ctor = mockTypes[typeName];
  if (!ctor) throw new Error(`mock: no class ${typeName}`);
  return new ctor() as T;
}

function is(elem: unknown, typeName: string): boolean {
  return elem instanceof mockTypes[typeName]!;
}

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

/** Element.getChildren: values of obj and objs attributes. */
export function children(elem: MockElement): MockElement[] {
  const out: MockElement[] = [];
  for (const attr of metaAttributes(elem.constructor.name)) {
    const value = elem[attr.name];
    if (attr.kind === "obj" && value instanceof MockElement) out.push(value);
    if (attr.kind === "objs" && Array.isArray(value))
      out.push(...(value as MockElement[]));
  }
  return out;
}

export class MetamodelManager {
  getMetaAttributes(typeName: string): MetaAttribute[] {
    return metaAttributes(typeName);
  }
  isKindOf(child: string, parent: string): boolean {
    return isKindOf(child, parent);
  }
  getViewTypeOf(typeName: string): string | null {
    return META[typeName]?.view ?? null;
  }
  getAvailableViewTypes(diagramTypeName: string): string[] {
    const metaClass = META[diagramTypeName]!;
    const inherited = metaClass.super
      ? this.getAvailableViewTypes(metaClass.super)
      : [];
    return [...inherited, ...(metaClass.views ?? [])];
  }
}
stub(MetamodelManager, ["assert", "register", "validateMetaType"]);

export class Repository {
  _idMap: Record<string, MockElement> = {};
  _modified = false;

  get(id: string): MockElement | undefined {
    return this._idMap[id];
  }
  getIdMap(): Record<string, MockElement> {
    return this._idMap;
  }
  /** Only the type selector `@Type` is modelled. */
  select(selector: string): MockElement[] {
    const match = /^@(\w+)$/.exec(selector);
    if (!match) return notModeled("Repository", `select(${selector})`);
    return this.getInstancesOf(match[1]!);
  }
  find(predicate: (e: MockElement) => boolean): MockElement | null {
    return Object.values(this._idMap).find(predicate) ?? null;
  }
  findAll(predicate: (e: MockElement) => boolean): MockElement[] {
    return Object.values(this._idMap).filter(predicate);
  }
  getInstancesOf(typeName: string): MockElement[] {
    const ctor = mockTypes[typeName];
    return this.findAll((e) => {
      // Same failure as the real `elem instanceof global.type[name]` for an unknown name.
      if (!ctor)
        throw new TypeError("Right-hand side of 'instanceof' is not callable");
      return e instanceof ctor;
    });
  }
  getViewsOf(model: MockElement): View[] {
    return this.findAll((e) => is(e, "View") && e.model === model) as View[];
  }
  getEdgeViewsOf(view: MockElement): View[] {
    return this.findAll(
      (e) => is(e, "EdgeView") && (e.tail === view || e.head === view),
    ) as View[];
  }
  /** core/repository.js: directed by source/target, undirected by end references. */
  getRelationshipsOf(model: MockElement): MockElement[] {
    return this.findAll((e) => {
      if (is(e, "DirectedRelationship"))
        return e.source === model || e.target === model;
      if (is(e, "UndirectedRelationship")) {
        const { end1, end2 } = e as unknown as Record<
          string,
          { reference: unknown }
        >;
        return end1!.reference === model || end2!.reference === model;
      }
      return false;
    });
  }
  isElement(value: unknown): boolean {
    return value instanceof MockElement;
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
  index(elem: MockElement): void {
    this._idMap[elem._id] = elem;
    for (const child of children(elem)) this.index(child);
  }
  unindex(elem: MockElement): void {
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

export interface ModelOptions {
  id: string;
  parent: MockElement;
  field?: string;
  modelInitializer?: (m: Element) => void;
}
export interface DiagramOptions {
  id: string;
  parent: MockElement;
  diagramInitializer?: (d: Element) => void;
}
export interface ModelAndViewOptions {
  id: string;
  parent: MockElement;
  diagram: MockElement;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  tailView?: View;
  headView?: View;
  tailModel?: MockElement | null;
  headModel?: MockElement | null;
  modelInitializer?: (m: Element) => void;
  viewInitializer?: (v: View) => void;
}

function attach(parent: MockElement, field: string, child: MockElement): void {
  const list = parent[field];
  if (!Array.isArray(list))
    throw new Error(`mock: ${parent.constructor.name}.${field} is not a list`);
  list.push(child);
  child._parent = parent;
}

/** Factory._defaultModelPrecondition throws this rendered ERR_INVALID_PARENT string. */
function assertParent(parent: MockElement, typeName: string): void {
  if (!is(parent, "Model")) throw `${typeName} cannot be placed here.`;
}

/** Ids with a registered factory function; StarUML 7.1.1 registers more. */
export const MODEL_IDS = [
  "UMLModel",
  "UMLPackage",
  "UMLClass",
  "UMLInterface",
  "UMLEnumeration",
  "UMLActor",
  "UMLUseCase",
  "UMLAttribute",
  "UMLOperation",
  "UMLParameter",
  "UMLEnumerationLiteral",
];
export const DIAGRAM_IDS = ["UMLClassDiagram", "UMLUseCaseDiagram"];
export const MODEL_AND_VIEW_IDS = [
  "UMLClass",
  "UMLInterface",
  "UMLActor",
  "UMLUseCase",
  "UMLAssociation",
  "UMLDependency",
  "UMLGeneralization",
];

export class Factory {
  constructor(private readonly repository: Repository) {}

  createModel(options: ModelOptions): Element | null {
    if (!MODEL_IDS.includes(options.id)) return null;
    assertParent(options.parent, options.id);
    const model = create(options.id);
    options.modelInitializer?.(model);
    attach(options.parent, options.field ?? "ownedElements", model);
    this.repository.index(model);
    this.repository.setModified(true);
    return model;
  }

  createDiagram(options: DiagramOptions): Element | null {
    if (!DIAGRAM_IDS.includes(options.id)) return null;
    assertParent(options.parent, options.id);
    const diagram = create(options.id);
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
    if (!MODEL_AND_VIEW_IDS.includes(options.id)) return null;
    assertParent(options.parent, options.id);
    const model = create(options.id);
    const view = create<View>(META[options.id]!.view!);
    view.model = model;
    if (is(model, "DirectedRelationship")) {
      model.source = options.tailModel ?? null;
      model.target = options.headModel ?? null;
    }
    if (is(model, "UndirectedRelationship")) {
      (model.end1 as MockElement).reference = options.tailModel ?? null;
      (model.end2 as MockElement).reference = options.headModel ?? null;
    }
    if (is(view, "EdgeView")) {
      view.tail = options.tailView ?? null;
      view.head = options.headView ?? null;
    }
    if (is(view, "NodeView")) {
      view.left = options.x1 ?? 0;
      view.top = options.y1 ?? 0;
      view.width = (options.x2 ?? 0) - (options.x1 ?? 0);
      view.height = (options.y2 ?? 0) - (options.y1 ?? 0);
    }
    options.modelInitializer?.(model);
    options.viewInitializer?.(view);
    attach(options.parent, "ownedElements", model);
    attach(options.diagram, "ownedViews", view);
    this.repository.index(model);
    this.repository.index(view);
    this.repository.setModified(true);
    return view;
  }

  getModelIds(): string[] {
    return [...MODEL_IDS];
  }
  getDiagramIds(): string[] {
    return [...DIAGRAM_IDS];
  }
  getModelAndViewIds(): string[] {
    return [...MODEL_AND_VIEW_IDS];
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

  setProperty(
    elem: MockElement,
    field: string,
    value: unknown,
  ): null | undefined {
    if (!elem || !field || typeof elem[field] === "undefined") return null;
    elem[field] = value;
    this.repository.setModified(true);
    return undefined;
  }

  setProperties(elem: MockElement, values: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(values))
      this.setProperty(elem, field, value);
  }

  deleteElements(models: MockElement[], views: MockElement[]): void {
    const all = new Set<MockElement>([...models, ...views]);
    let changed = true;
    while (changed) {
      const before = all.size;
      for (const elem of [...all]) {
        for (const child of children(elem)) all.add(child);
        if (is(elem, "View")) {
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
  current: MockElement | null = null;
  working: MockElement[] = [];

  getCurrentDiagram(): MockElement | null {
    return this.current;
  }
  /** Like the real one, accepts any element; callers must check it is a diagram. */
  setCurrentDiagram(diagram: MockElement): void {
    this.openDiagram(diagram);
    this.current = diagram;
  }
  openDiagram(diagram: MockElement): void {
    if (!this.working.includes(diagram)) this.working.push(diagram);
  }
  closeDiagram(diagram: MockElement): void {
    this.working = this.working.filter((d) => d !== diagram);
    if (this.current === diagram) this.current = this.working[0] ?? null;
  }
  closeAll(): void {
    this.working = [];
    this.current = null;
  }
  getWorkingDiagrams(): MockElement[] {
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

type Json = Record<string, unknown>;

/** Repository.Writer conventions: `_type`, `{$ref}` for references, owned elements nested. */
function writeElement(elem: MockElement): Json {
  const out: Json = { _type: elem.constructor.name, _id: elem._id };
  for (const attr of metaAttributes(elem.constructor.name)) {
    const value = elem[attr.name];
    if (attr.name === "_id" || attr.name === "_parent" || value == null)
      continue;
    switch (attr.kind) {
      case "ref":
        out[attr.name] = { $ref: (value as MockElement)._id };
        break;
      case "refs":
        out[attr.name] = (value as MockElement[]).map((v) => ({ $ref: v._id }));
        break;
      case "obj":
        out[attr.name] = writeElement(value as MockElement);
        break;
      case "objs":
        out[attr.name] = (value as MockElement[]).map(writeElement);
        break;
      case "var":
        out[attr.name] =
          value instanceof MockElement ? { $ref: value._id } : value;
        break;
      case "custom":
        out[attr.name] = (value as CustomValue).__write();
        break;
      default:
        out[attr.name] = value;
    }
  }
  return out;
}

/** Repository.readObject: builds the tree, then resolves `$ref`s against it. */
function readElement(data: Json): MockElement {
  const byId = new Map<string, MockElement>();
  const pending: (() => void)[] = [];
  const build = (json: Json, parent: MockElement | null): MockElement => {
    const elem = create(json._type as string);
    elem._id = json._id as string;
    elem._parent = parent;
    byId.set(elem._id, elem);
    for (const attr of metaAttributes(elem.constructor.name)) {
      const value = json[attr.name];
      if (attr.name === "_id" || value === undefined) continue;
      const resolve = (r: unknown) => byId.get((r as { $ref: string }).$ref);
      switch (attr.kind) {
        case "ref":
          pending.push(() => (elem[attr.name] = resolve(value)));
          break;
        case "refs":
          pending.push(
            () => (elem[attr.name] = (value as unknown[]).map(resolve)),
          );
          break;
        case "obj":
          elem[attr.name] = build(value as Json, elem);
          break;
        case "objs":
          elem[attr.name] = (value as Json[]).map((v) => build(v, elem));
          break;
        case "var":
          if (typeof value === "object" && value !== null)
            pending.push(() => (elem[attr.name] = resolve(value)));
          else elem[attr.name] = value;
          break;
        case "custom":
          elem[attr.name] = new CustomValue(value as string);
          break;
        default:
          elem[attr.name] = value;
      }
    }
    return elem;
  };
  const root = build(data, null);
  for (const apply of pending) apply();
  return root;
}

export class ProjectManager {
  filename: string | null = null;
  project: Element | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly disk: MockDisk,
  ) {}

  getFilename(): string | null {
    return this.filename;
  }
  getProject(): Element | null {
    return this.project;
  }

  /** An empty Project; StarUML's default Model > Main comes from a template, not from here. */
  newProject(): Element {
    const project = create("Project");
    this.project = project;
    this.filename = null;
    this.repository.clear();
    this.repository.index(project);
    return project;
  }

  save(fullPath: string): Element | null {
    if (typeof fullPath !== "string") {
      throw new TypeError(
        `The "path" argument must be of type string or an instance of Buffer or URL. Received ${String(fullPath)}`,
      );
    }
    this.disk.set(
      fullPath,
      this.project ? JSON.stringify(writeElement(this.project)) : "null",
    );
    this.filename = fullPath;
    this.repository.setModified(false);
    return this.project;
  }

  load(fullPath: string): Element | null {
    const text = this.disk.get(fullPath);
    if (text === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${fullPath}'`);
    }
    if (!text) return null;
    this.closeProject();
    this.project = readElement(JSON.parse(text) as Json) as Element;
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
  version: string;
  commands: CommandManager;
  project: ProjectManager;
  repository: Repository;
  factory: Factory;
  engine: Engine;
  diagrams: DiagramManager;
  preferences: PreferenceManager;
  selections: SelectionManager;
  dialogs: Dialogs;
  metamodels: MetamodelManager;
}

export interface MockEnvironment {
  app: MockApp;
  disk: MockDisk;
  project: Element;
  /** The default `Model` package of the fresh project. */
  model: Element;
  /** The default `Main` class diagram of the fresh project. */
  mainDiagram: Element;
}

/** Fresh app with a new project; installs it as the `app`, `type` and `meta` globals. */
export function installMockApp(): MockEnvironment {
  const disk: MockDisk = new Map();
  const repository = new Repository();
  const app: MockApp = {
    version: "7.1.1",
    commands: new CommandManager(),
    project: new ProjectManager(repository, disk),
    repository,
    factory: new Factory(repository),
    engine: new Engine(repository),
    diagrams: new DiagramManager(),
    preferences: new PreferenceManager(),
    selections: new SelectionManager(),
    dialogs: new Dialogs(),
    metamodels: new MetamodelManager(),
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.app = app;
  g.type = mockTypes;
  g.meta = META;

  // StarUML starts on its default template: Untitled > Model > Main.
  const project = app.project.newProject();
  project.name = "Untitled";
  const model = create("UMLModel");
  model.name = "Model";
  attach(project, "ownedElements", model);
  const mainDiagram = create("UMLClassDiagram");
  mainDiagram.name = "Main";
  attach(model, "ownedElements", mainDiagram);
  repository.index(model);
  repository.setModified(false);
  return { app, disk, project, model, mainDiagram };
}

export const MOCK_ONLY_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  repository: REPOSITORY_HELPERS,
};
