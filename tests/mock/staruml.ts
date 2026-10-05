/**
 * In-memory stand-in for the StarUML `app`, `type` and `meta` globals.
 *
 * Every manager class declares exactly the prototype method names that
 * StarUML 7.1.1 exposes (tests/fixtures/app-surface.7.1.1.json, checked by
 * tests/unit/mock-surface.test.ts). Methods the extension does not call yet
 * are stubs that throw, so a handler that starts depending on one fails loudly
 * instead of passing against invented behaviour.
 *
 * Element classes and factory ids come from POST /introspect recorded
 * against 7.1.1 (tests/fixtures/introspect.7.1.1.json, checked against the
 * running app by tests/integration): one class per meta class, extending its
 * `super`, with every own attribute initialised by kind the way the element
 * constructors in core/core.js and the extensions' elements.js do. The
 * factory registers exactly the 7.1.1 ids, with the generic behaviour of
 * Factory.defaultModelFn / defaultModelAndViewFn / default*RelationshipFn;
 * ids that 7.1.1 builds with a dedicated function (lifelines, messages,
 * association classes, ...) get that generic behaviour too.
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
import { EventEmitter } from "node:events";
import introspect from "../fixtures/introspect.7.1.1.json";

export interface MetaAttribute {
  name: string;
  kind: string;
  type: string;
  default?: unknown;
  transient?: boolean;
}
export interface MetaType {
  kind: string;
  super?: string;
  attributes?: MetaAttribute[];
  literals?: string[];
  view?: string;
  /** Diagrams: every view type accepted, inherited ones included. */
  availableViews?: string[];
}

interface CatalogueEntry {
  kind: string;
  super: string | null;
  attributes: MetaAttribute[];
  literals?: string[];
  viewType: string | null;
  viewTypes?: string[];
}

/** The `meta` global, rebuilt from the recorded catalogue. */
export const META: Record<string, MetaType> = Object.fromEntries(
  Object.entries(
    introspect.metamodel as unknown as Record<string, CatalogueEntry>,
  ).map(([name, entry]) => [
    name,
    {
      kind: entry.kind,
      ...(entry.super && { super: entry.super }),
      attributes: entry.attributes,
      ...(entry.literals && { literals: entry.literals }),
      ...(entry.viewType && { view: entry.viewType }),
      ...(entry.viewTypes && { availableViews: entry.viewTypes }),
    },
  ]),
);

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
  canContainView(view: View): boolean;
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

/**
 * View kinds a view can hold (canContainViewKind in the 7.1.1 elements.js
 * files); View.canContainView in core/core.js refuses the view itself.
 */
const CONTAINS: Record<string, readonly string[]> = {
  UMLRegionView: ["UMLStateView", "UMLPseudostateView", "UMLFinalStateView"],
};
Object.defineProperty(mockTypes.View!.prototype, "canContainView", {
  value(this: MockElement, view: MockElement): boolean {
    return (
      view !== this &&
      (CONTAINS[this.constructor.name] ?? []).some((k) => is(view, k))
    );
  },
});

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
    return [...(META[diagramTypeName]!.availableViews ?? [])];
  }
}
stub(MetamodelManager, ["assert", "register", "validateMetaType"]);

/** core/repository.js's Stack, the undo and redo history. */
class Stack<T> {
  items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items = [];
  }
}

/** core/repository.js extends EventEmitter; only operationExecuted is emitted here. */
export class Repository extends EventEmitter {
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
  /** The reverse of every ref/refs attribute and relationship end that names `elem`. */
  getRefsTo(elem: MockElement): MockElement[] {
    return this.findAll((e) => {
      for (const attr of metaAttributes(e.constructor.name)) {
        const value = e[attr.name];
        if (attr.kind === "ref" && value === elem) return true;
        if (attr.kind === "refs" && (value as unknown[]).includes(elem))
          return true;
      }
      return false;
    });
  }
  getConnectedNodeViews(
    view: MockElement,
    edgeType: new () => MockElement,
  ): View[] {
    return this.getEdgeViewsOf(view)
      .filter((e) => e instanceof edgeType)
      .map((e) => (e.head === view ? e.tail! : e.head!));
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

  getOperationBuilder(): OperationBuilder {
    return new OperationBuilder();
  }
  _undoStack = new Stack<Operation>();
  _redoStack = new Stack<Operation>();
  /**
   * Field assignments and reorders are recorded and undoable, as in
   * core/repository.js; element creation and deletion are modelled directly
   * by Factory and Engine and are not undoable here.
   */
  doOperation(operation: Operation): void {
    if (operation.ops.length === 0) return;
    applyOps(operation);
    if (operation.bypass !== true) {
      this._undoStack.push(operation);
      this._redoStack.clear();
      this.emit("operationExecuted", operation);
    }
    this.setModified(true);
  }
  undo(): void {
    const operation = this._undoStack.pop();
    if (!operation) return;
    for (const op of [...operation.ops].reverse()) op.revert!();
    this._redoStack.push(operation);
    this.setModified(true);
    this.emit("operationExecuted", operation);
  }
  redo(): void {
    const operation = this._redoStack.pop();
    if (!operation) return;
    applyOps(operation);
    this._undoStack.push(operation);
    this.setModified(true);
    this.emit("operationExecuted", operation);
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
  "extractChanged",
  "generateGuid",
  "getConnectedHeadNodeViews",
  "getConnectedTailNodeViews",
  "lookupAndFind",
  "readObject",
  "search",
  "writeObject",
]);
const REPOSITORY_HELPERS = ["index", "unindex"];

interface Op {
  kind: "assign" | "reorder";
  elem: MockElement;
  field: string;
  value: unknown;
  index?: number;
  /** Set when applied, so the op can be reverted. */
  revert?: () => void;
}

export interface Operation {
  name: string;
  bypass?: boolean;
  ops: Op[];
}

function applyOps(operation: Operation): void {
  for (const op of operation.ops) {
    if (op.kind === "assign") {
      const old = op.elem[op.field];
      op.elem[op.field] = op.value;
      op.revert = () => {
        op.elem[op.field] = old;
      };
    } else {
      const list = op.elem[op.field] as unknown[];
      const from = list.indexOf(op.value);
      list.splice(from, 1);
      list.splice(op.index!, 0, op.value);
      op.revert = () => {
        list.splice(list.indexOf(op.value), 1);
        list.splice(from, 0, op.value);
      };
    }
  }
}

/** core/repository.js OperationBuilder, for the operations the extension builds. */
export class OperationBuilder {
  private operation: Operation | null = null;
  begin(name: string): void {
    this.operation = { name, ops: [] };
  }
  fieldReorder(
    elem: MockElement,
    field: string,
    value: MockElement,
    index: number,
  ): void {
    this.operation!.ops.push({ kind: "reorder", elem, field, value, index });
  }
  fieldAssign(elem: MockElement, field: string, value: unknown): void {
    this.operation!.ops.push({ kind: "assign", elem, field, value });
  }
  end(): void {}
  getOperation(): Operation | null {
    return this.operation;
  }
}

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
  containerView?: View;
  editor?: unknown;
  modelInitializer?: (m: Element) => void;
  viewInitializer?: (v: View) => void;
}

function place(view: MockElement, options: ModelAndViewOptions): void {
  view.left = options.x1 ?? 0;
  view.top = options.y1 ?? 0;
  view.width = (options.x2 ?? 0) - (options.x1 ?? 0);
  view.height = (options.y2 ?? 0) - (options.y1 ?? 0);
}

/** Factory.assignInitObject: nested objects assign into the element's fields. */
function assignInit(elem: MockElement, init: object | undefined): void {
  for (const [key, value] of Object.entries(init ?? {})) {
    if (value !== null && typeof value === "object" && elem[key]) {
      assignInit(elem[key] as MockElement, value as object);
    } else {
      elem[key] = value;
    }
  }
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

interface ModelAndViewEntry {
  id: string;
  modelType: string | null;
  viewType: string | null;
  relationship: string | null;
}

const SEQUENCE_VIEWS: Record<string, string> = {
  UMLLifeline: "UMLSeqLifelineView",
  UMLMessage: "UMLSeqMessageView",
};

/** Ids with a registered factory function in 7.1.1. */
export const MODEL_IDS: readonly string[] = introspect.factory.modelIds;
export const DIAGRAM_IDS: readonly string[] = introspect.factory.diagramIds;
export const MODEL_AND_VIEW: Readonly<Record<string, ModelAndViewEntry>> =
  Object.fromEntries(
    (introspect.factory.modelAndView as ModelAndViewEntry[]).map((e) => [
      e.id,
      e,
    ]),
  );

export class Factory {
  /**
   * Registered default options, an own field as in 7.1.1. Only modelType and
   * viewType are recorded, for the ids where they differ from the defaults
   * (the id itself, and the model type's view).
   */
  modelAndViewOptions: Record<
    string,
    { modelType?: string; viewType?: string }
  > = Object.fromEntries(
    Object.values(MODEL_AND_VIEW)
      .filter((e) =>
        e.modelType
          ? e.modelType !== e.id || e.viewType !== META[e.modelType]!.view
          : e.viewType,
      )
      .map((e) => [
        e.id,
        {
          ...(e.modelType && { modelType: e.modelType }),
          ...(e.viewType && { viewType: e.viewType }),
        },
      ]),
  );

  constructor(private readonly repository: Repository) {}

  createModel(options: ModelOptions): Element | null {
    if (!MODEL_IDS.includes(options.id)) return null;
    assertParent(options.parent, options.id);
    const model = create(options.id);
    options.modelInitializer?.(model);
    // Engine.addModel only logs for a field the parent lacks, and the
    // factory then answers repository.get() of the never-added model.
    const field = options.field ?? "ownedElements";
    if (!Array.isArray(options.parent[field])) return null;
    attach(options.parent, field, model);
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
    const entry = MODEL_AND_VIEW[options.id];
    if (!entry) return null;
    if (!entry.modelType) {
      if (!entry.viewType) notModeled("Factory", options.id);
      const only = create<View>(entry.viewType);
      // defaultViewOnlyFn and defaultEdgeViewOnlyFn (engine/factory.js).
      if (is(only, "EdgeView")) {
        only.tail = options.tailView ?? null;
        only.head = options.headView ?? null;
      } else {
        place(only, options);
      }
      options.viewInitializer?.(only);
      attach(options.diagram, "ownedViews", only);
      this.repository.index(only);
      return only;
    }
    assertParent(options.parent, options.id);
    const model = create(entry.modelType);
    // lifelineFn and messageFn (uml-factory.js) pick the view class by the
    // diagram; the recorded entry has the communication diagram's, or none.
    const onSequence = is(options.diagram, "UMLSequenceDiagram");
    const viewType =
      (onSequence && SEQUENCE_VIEWS[entry.modelType]) || entry.viewType!;
    const view = create<View>(viewType);
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
      // Factory.createModelAndView starts an edge at the drag points, held
      // as Points.points and saved as "x:y;x:y" (core/graphics.js).
      if (options.y1 !== undefined) {
        const points = [
          { x: options.x1 ?? 0, y: options.y1 },
          { x: options.x2 ?? 0, y: options.y2 ?? options.y1 },
        ];
        view.points = {
          points,
          __write: () => points.map((p) => `${p.x}:${p.y}`).join(";"),
        };
      }
    }
    if (is(view, "NodeView")) place(view, options);
    // pseudostateFn (uml-factory.js) stores the toolbox item's kind.
    const kind = (options as { pseudostateKind?: string }).pseudostateKind;
    if (entry.modelType === "UMLPseudostate" && kind) model.kind = kind;
    // stateFn (uml-factory.js) gives a composite state its regions.
    const regions = (options as { regionCount?: number }).regionCount ?? 0;
    for (let i = 0; i < regions; i++)
      attach(model, "regions", create("UMLRegion"));
    if (entry.modelType === "UMLCombinedFragment") {
      // combinedFragmentFn (uml-factory.js) starts every fragment with one operand.
      const operand = create("UMLInteractionOperand");
      attach(model, "operands", operand);
    }
    // Factory.assignInitObject: a toolbox item's model-init, e.g. the
    // composite end2 of UMLComposition.
    assignInit(model, (options as { "model-init"?: object })["model-init"]);
    options.modelInitializer?.(model);
    options.viewInitializer?.(view);
    attach(options.parent, "ownedElements", model);
    attach(options.diagram, "ownedViews", view);
    if (options.containerView) {
      view.containerView = options.containerView;
      (options.containerView.containedViews as View[]).push(view);
    }
    this.repository.index(model);
    this.repository.index(view);
    this.repository.setModified(true);
    return view;
  }

  /**
   * defaultViewOnDiagramFn (engine/factory.js): a relationship joins the
   * views of its ends; any other model gets a view at (x, y) and, through
   * createViewAndRelationships, the views of its relationships to models
   * already on the diagram.
   */
  createViewOf(options: {
    model: MockElement;
    diagram: MockElement;
    x?: number;
    y?: number;
  }): View | null {
    const { model, diagram } = options;
    // Every 7.1.1 diagram type registers a registerViewOfFn function.
    if (!DIAGRAM_IDS.includes(diagram.constructor.name)) return null;
    const viewOf = (m: unknown) =>
      (diagram.ownedViews as View[]).find((v) => v.model === m);
    const add = (view: View) => {
      attach(diagram, "ownedViews", view);
      this.repository.index(view);
      return view;
    };
    const edge = (rel: MockElement, tail: View, head: View) => {
      const view = create<View>(META[rel.constructor.name]!.view!);
      view.model = rel as Element;
      view.tail = tail;
      view.head = head;
      return add(view);
    };
    const ends = (rel: MockElement): [unknown, unknown] =>
      is(rel, "DirectedRelationship")
        ? [rel.source, rel.target]
        : [
            (rel.end1 as MockElement).reference,
            (rel.end2 as MockElement).reference,
          ];
    if (is(model, "Relationship")) {
      const [a, b] = ends(model);
      return edge(model, viewOf(a)!, viewOf(b)!);
    }
    const view = create<View>(META[model.constructor.name]!.view!);
    view.model = model as Element;
    view.left = options.x ?? 0;
    view.top = options.y ?? 0;
    view.width = 100;
    view.height = 50;
    add(view);
    for (const rel of this.repository.getRelationshipsOf(model)) {
      const [a, b] = ends(rel);
      const other = a === model ? b : a;
      const otherView = viewOf(other);
      if (otherView && !viewOf(rel)) {
        if (a === model) edge(rel, view, otherView);
        else edge(rel, otherView, view);
      }
    }
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
    return Object.keys(MODEL_AND_VIEW);
  }
}
stub(Factory, [
  "_defaultModelPrecondition",
  "assert",
  "assignInitObject",
  "createViewAndRelationships",
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

  addModel(
    parent: MockElement,
    field: string,
    model: MockElement,
  ): MockElement | null {
    if (!Array.isArray(parent[field])) return null;
    attach(parent, field, model);
    this.repository.index(model);
    this.repository.setModified(true);
    return model;
  }

  addItem(elem: MockElement, field: string, value: MockElement): void {
    if (!Array.isArray(elem[field])) return;
    (elem[field] as MockElement[]).push(value);
    this.repository.setModified(true);
  }

  removeItem(elem: MockElement, field: string, value: MockElement): void {
    const list = elem[field];
    if (!Array.isArray(list)) return;
    if (list.includes(value)) list.splice(list.indexOf(value), 1);
    this.repository.setModified(true);
  }

  /** engine/engine.js: silently does nothing unless both owners have the field. */
  relocate(elem: MockElement, newOwner: MockElement, field: string): void {
    const oldOwner = elem._parent!;
    const from = oldOwner[field];
    const to = newOwner[field];
    if (
      oldOwner === newOwner ||
      !Array.isArray(from) ||
      !from.includes(elem) ||
      !Array.isArray(to)
    )
      return;
    from.splice(from.indexOf(elem), 1);
    to.push(elem);
    elem._parent = newOwner;
    this.repository.setModified(true);
  }

  setProperties(elem: MockElement, values: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(values))
      this.setProperty(elem, field, value);
  }

  /** Records one undoable operation assigning `values` to each element. */
  private assign(
    name: string,
    entries: [MockElement, Record<string, unknown>][],
  ): void {
    const builder = this.repository.getOperationBuilder();
    builder.begin(name);
    for (const [elem, values] of entries) {
      for (const [field, value] of Object.entries(values))
        builder.fieldAssign(elem, field, value);
    }
    builder.end();
    this.repository.doOperation(builder.getOperation()!);
  }

  /** Stands in for dagre: lays node views out in one rank along `direction`. */
  layoutDiagram(
    editor: unknown,
    diagram: MockElement,
    direction: string,
  ): null | undefined {
    if (!editor || !diagram) return null;
    const nodes = (diagram.ownedViews as MockElement[]).filter((v) =>
      is(v, "NodeView"),
    );
    const horizontal = direction === "LR" || direction === "RL";
    this.assign(
      "layout diagram",
      nodes.map((v, i) => [
        v,
        horizontal
          ? { left: 20 + i * 150, top: 20 }
          : { left: 20, top: 20 + i * 100 },
      ]),
    );
    return undefined;
  }

  moveViews(
    editor: unknown,
    views: MockElement[],
    dx: number,
    dy: number,
  ): null | undefined {
    if (!editor || !views) return null;
    this.assign(
      "move views",
      views
        .filter((v) => is(v, "NodeView"))
        .map((v) => [
          v,
          { left: (v.left as number) + dx, top: (v.top as number) + dy },
        ]),
    );
    return undefined;
  }

  /** moveViews, then the views into containerView and their models into containerModel. */
  moveViewsChangingContainer(
    editor: unknown,
    views: MockElement[],
    dx: number,
    dy: number,
    containerView: MockElement | null,
    containerModel: MockElement | null,
  ): null | undefined {
    if (!editor || !views) return null;
    this.moveViews(editor, views, dx, dy);
    for (const v of views) {
      v.containerView = containerView;
      if (containerView)
        (containerView.containedViews as MockElement[]).push(v);
      const model = v.model as MockElement | null;
      const owner = model?._parent;
      const field = Object.keys(owner ?? {}).find(
        (k) =>
          Array.isArray(owner![k]) && (owner![k] as unknown[]).includes(model),
      );
      if (model && containerModel && field)
        this.relocate(model, containerModel, field);
    }
    return undefined;
  }

  resizeNode(
    editor: unknown,
    node: MockElement,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): null | undefined {
    if (!editor || !node) return null;
    this.assign("resize node", [
      [node, { left, top, width: right - left, height: bottom - top }],
    ]);
    return undefined;
  }

  setFillColor(editor: unknown, views: MockElement[], color: string): void {
    this.setViewField(editor, views, "fillColor", color);
  }
  setLineColor(editor: unknown, views: MockElement[], color: string): void {
    this.setViewField(editor, views, "lineColor", color);
  }
  setFontColor(editor: unknown, views: MockElement[], color: string): void {
    this.setViewField(editor, views, "fontColor", color);
  }
  /** The real ones assign a new Font; the mock keeps Font's "face;size;style" form. */
  setFontFace(editor: unknown, views: MockElement[], face: string): void {
    this.assign(
      "change font face",
      views.map((v) => [v, { font: fontWith(v, 0, face) }]),
    );
    void editor;
  }
  setFontSize(editor: unknown, views: MockElement[], size: number): void {
    this.assign(
      "change font size",
      views.map((v) => [v, { font: fontWith(v, 1, String(size)) }]),
    );
    void editor;
  }
  setLineStyle(editor: unknown, views: MockElement[], lineStyle: number): void {
    this.setViewField(editor, views, "lineStyle", lineStyle);
  }
  setStereotypeDisplay(
    editor: unknown,
    views: MockElement[],
    value: string,
  ): void {
    this.setViewField(editor, views, "stereotypeDisplay", value);
  }
  setAutoResize(editor: unknown, views: MockElement[], value: boolean): void {
    this.setViewField(editor, views, "autoResize", value);
  }
  private setViewField(
    editor: unknown,
    views: MockElement[],
    field: string,
    value: unknown,
  ): void {
    if (!editor) throw new Error("mock: engine view edit without an editor");
    this.assign(
      `change ${field}`,
      views.map((v) => [v, { [field]: value }]),
    );
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
  "addModelAndView",
  "addViews",
  "modifyEdge",
  "moveDown",
  "moveParasiticView",
  "moveUp",
  "reconnectEdge",
  "setElemsProperty",
  "setFont",
]);
const ENGINE_HELPERS = ["assign", "setViewField"];

function fontWith(view: MockElement, part: number, value: string): CustomValue {
  const parts = (view.font as CustomValue).text.split(";");
  parts[part] = value;
  return new CustomValue(parts.join(";"));
}

/** ui/diagram-editor.js, for the selection calls the extension makes. */
export class DiagramEditor {
  constructor(private readonly selections: SelectionManager) {}
  selectView(view: View): void {
    this.selections.select(view.model ? [view.model] : [], [view]);
  }
  selectAdditionalView(view: View): void {
    const views = [...this.selections.getSelectedViews(), view] as View[];
    this.selections.select(
      views.flatMap((v) => (v.model ? [v.model] : [])),
      views,
    );
  }
}

export class DiagramManager {
  current: MockElement | null = null;
  working: MockElement[] = [];
  zoom = 1;
  grid = false;
  snap = true;
  repaints = 0;
  diagramEditor: DiagramEditor;

  constructor(private readonly selections = new SelectionManager()) {
    this.diagramEditor = new DiagramEditor(selections);
  }

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
  setZoomLevel(scale: number): void {
    this.zoom = Math.min(3, Math.max(0.1, scale));
  }
  getZoomLevel(): number {
    return this.zoom;
  }
  /**
   * The real one centres a viewport whose size the mock fixes at 800x600,
   * and DiagramEditor.setOrigin records the origin on the current diagram.
   */
  scrollTo(x: number, y: number): void {
    if (!this.current) return;
    this.current._originX = -Math.max(0, Math.floor(x - 400 / this.zoom));
    this.current._originY = -Math.max(0, Math.floor(y - 300 / this.zoom));
  }
  showGrid(): void {
    this.grid = true;
  }
  hideGrid(): void {
    this.grid = false;
  }
  isGridVisible(): boolean {
    return this.grid;
  }
  setSnapToGrid(allow: boolean): void {
    this.snap = allow;
  }
  getSnapToGrid(): boolean {
    return this.snap;
  }
  /**
   * Drawing the current diagram gives list compartments a view per item
   * (UMLListCompartmentView.update in the 7.1.1 elements.js): an operand
   * view per operand of a combined fragment, stacked below its operator tab
   * at the default height of 30, and a region view per region of a state.
   */
  repaint(): void {
    this.repaints++;
    for (const view of (this.current?.ownedViews ?? []) as View[]) {
      const items = is(view, "UMLCombinedFragmentView")
        ? [
            "operandCompartment",
            "UMLInteractionOperandCompartmentView",
            "UMLInteractionOperandView",
            "operands",
          ]
        : is(view, "UMLStateView")
          ? [
              "decompositionCompartment",
              "UMLDecompositionCompartmentView",
              "UMLRegionView",
              "regions",
            ]
          : null;
      if (!items || view[items[0]!]) continue;
      const [field, compartmentType, itemType, list] = items as [
        string,
        string,
        string,
        string,
      ];
      const compartment = create<View>(compartmentType);
      compartment._parent = view;
      view[field] = compartment;
      view.subViews.push(compartment);
      let top = (view.top as number) + 25;
      for (const item of (view.model![list] ?? []) as Element[]) {
        const sub = create<View>(itemType);
        sub._parent = compartment;
        sub.model = item;
        sub.left = view.left;
        sub.top = top;
        sub.width = view.width;
        sub.height = 30;
        top += 30;
        compartment.subViews.push(sub);
      }
    }
  }
  deselectAll(): void {
    this.selections.deselectAll();
  }
  /** The editor's canvas is only measured by the factory functions. */
  getEditor(): { canvas: { gridFactor: { width: number; height: number } } } {
    return { canvas: { gridFactor: { width: 5, height: 5 } } };
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
  "getDiagramArea",
  "getHiddenEditor",
  "getScrollPosition",
  "getViewportSize",
  "htmlReady",
  "needRepaint",
  "nextDiagram",
  "previousDiagram",
  "restoreDiagramOrigin",
  "restoreWorkingDiagrams",
  "resumeRepaint",
  "saveWorkingDiagrams",
  "selectAll",
  "selectInDiagram",
  "setActiveHandler",
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

/** engine/selection-manager.js, minus the change events. */
export class SelectionManager {
  selectedModels: MockElement[] = [];
  selectedViews: MockElement[] = [];
  getSelectedModels(): MockElement[] {
    return this.selectedModels;
  }
  getSelectedViews(): MockElement[] {
    return this.selectedViews;
  }
  select(models: MockElement[], views: MockElement[]): void {
    this.selectedModels = models;
    this.selectedViews = views;
  }
  deselectAll(): void {
    this.select([], []);
  }
}
stub(SelectionManager, [
  "getSelected",
  "isChanged",
  "selectModel",
  "selectViews",
  "triggerEvent",
]);

/** engine/license-store.js; the mock is licensed unless a test says otherwise. */
export class LicenseStore {
  status: { trial?: boolean; edition?: string } = {
    trial: false,
    edition: "PRO",
  };
  getLicenseStatus(): { trial?: boolean; edition?: string } {
    return this.status;
  }
}

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

interface ToolboxEntry {
  id: string;
  group: string;
  title: string;
  rubberband: string;
  creates: string;
  options: Record<string, unknown>;
  command?: string;
}

/** views/toolbox-view.js state, rebuilt from the recorded toolbox section. */
export class Toolbox {
  groups: Record<
    string,
    { id: string; title: string; diagramTypes: Ctor[] | null }
  > = Object.fromEntries(
    introspect.toolbox.groups.map((g) => [
      g.id,
      {
        id: g.id,
        title: g.title,
        diagramTypes: g.diagramTypes
          ? g.diagramTypes.map((name) => mockTypes[name]!)
          : null,
      },
    ]),
  );
  /** Items without a command-arg in their toolbox JSON have none here either. */
  items: Record<string, Record<string, unknown>> = Object.fromEntries(
    (introspect.toolbox.items as ToolboxEntry[]).map((item) => {
      const commandArg = {
        ...(item.creates !== item.id && { id: item.creates }),
        ...item.options,
      };
      return [
        item.id,
        {
          id: item.id,
          groupId: item.group,
          title: item.title,
          rubberband: item.rubberband,
          ...(item.command && { command: item.command }),
          ...(Object.keys(commandArg).length > 0 && { commandArg }),
        },
      ];
    }),
  );
}

export interface MockRule {
  id: string;
  message: string;
  appliesTo: string[];
  exceptions?: string[];
  constraint(elem: MockElement): boolean;
}

/**
 * core/validator.js: runs the rules in the `rules` global, which rules.js
 * files fill. A rule that throws is logged and skipped there; here too.
 */
export class Validator {
  constructor(private readonly repository: Repository) {}
  validate(): { id: string; ruleId: string; message: string }[] {
    const failed: { id: string; ruleId: string; message: string }[] = [];
    const rules = (globalThis as unknown as { rules: MockRule[] }).rules;
    for (const rule of rules) {
      const targets = rule.appliesTo
        .flatMap((t) => this.repository.getInstancesOf(t))
        .filter((t) => !(rule.exceptions ?? []).some((x) => is(t, x)));
      for (const target of targets) {
        try {
          if (!rule.constraint(target)) {
            failed.push({
              id: target._id as string,
              ruleId: rule.id,
              message: rule.message,
            });
          }
        } catch {
          // core/validator.js logs and moves on.
        }
      }
    }
    return failed;
  }
}

export interface MockApp {
  version: string;
  metadata: { apiVersion?: string };
  commands: CommandManager;
  project: ProjectManager;
  repository: Repository;
  factory: Factory;
  engine: Engine;
  diagrams: DiagramManager;
  preferences: PreferenceManager;
  selections: SelectionManager;
  licenseStore: LicenseStore;
  dialogs: Dialogs;
  metamodels: MetamodelManager;
  toolbox: Toolbox;
  validator: Validator;
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
  const selections = new SelectionManager();
  const app: MockApp = {
    version: "7.1.1",
    metadata: { apiVersion: "7.1.1" },
    commands: new CommandManager(),
    project: new ProjectManager(repository, disk),
    repository,
    factory: new Factory(repository),
    engine: new Engine(repository),
    diagrams: new DiagramManager(selections),
    preferences: new PreferenceManager(),
    selections,
    licenseStore: new LicenseStore(),
    dialogs: new Dialogs(),
    metamodels: new MetamodelManager(),
    toolbox: new Toolbox(),
    validator: new Validator(repository),
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.app = app;
  g.type = mockTypes;
  g.meta = META;
  g.rules = [];

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
  engine: ENGINE_HELPERS,
};
