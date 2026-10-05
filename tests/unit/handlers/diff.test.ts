import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchRunner } from "../../../src/handlers/batch.js";
import { describeOp, planOf } from "../../../src/handlers/build.js";
import {
  clearSnapshots,
  diffDiagram,
  diffSinceEndpoint,
  MAX_SNAPSHOTS,
  restoreSnapshot,
  takeSnapshot,
} from "../../../src/handlers/diff.js";
import { endpoints } from "../../../src/routes.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, fullResults, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
  clearSnapshots();
});

const endpoint = (path: string) =>
  fullResults(endpoints.find((e) => e.path === path)!);
const build = endpoint("/build_diagram");
// The /batch endpoint, unwrapped.
const batch = endpoints.find((e) => e.path === "/batch")!;

interface Step {
  op: string;
  target: string | null;
  as?: string;
  type?: string;
  name?: string;
  change?: string;
}

interface Planned {
  diagram: { _id: string; _type: string; name: string | null };
  created: number;
  dryRun?: boolean;
  ids: Record<string, { model: string | null; view: string }>;
  edges: { key: string; model: string | null; view: string }[];
  plan?: {
    ops: { path: string; body: Record<string, unknown>; as?: string }[];
    creates: Step[];
    updates: Step[];
    deletes: Step[];
  };
  deleted?: number;
  warnings?: string[];
  format?: string;
}

const SPEC = {
  classes: [{ name: "Order", attributes: ["+id: long"] }, { name: "Line" }],
  relations: [{ from: "Order", to: "Line", type: "composition" }],
};

const state = () => ({
  ids: Object.keys(env.app.repository.getIdMap()).sort(),
  undo: env.app.repository._undoStack.size(),
  modified: env.app.repository.isModified(),
});

describe("/build_diagram dryRun", () => {
  it("answers the plan without touching the model, and applying runs that plan", async () => {
    const before = state();
    const dry = await ok<Planned>(build, {
      kind: "class",
      name: "Shop",
      spec: SPEC,
      dryRun: true,
    });
    expect(state()).toEqual(before);
    expect(dry).toMatchObject({
      dryRun: true,
      diagram: { _id: "$diagram", _type: "UMLClassDiagram", name: "Shop" },
      created: 3,
      ids: {
        Order: { model: "$n0.model", view: "$n0.view" },
        Line: { model: "$n1.model", view: "$n1.view" },
      },
      edges: [{ key: "Order -> Line", model: "$e0.model", view: "$e0.view" }],
    });
    expect(dry.plan!.creates.map((s) => [s.op, s.name ?? s.type])).toEqual([
      ["/create_diagram", "Shop"],
      ["/create_element_with_view", "Order"],
      ["/add_attribute", "id"],
      ["/create_element_with_view", "Line"],
      ["/create_relationship", "UMLAssociation"],
    ]);
    expect(dry.plan!.creates[0]!.target).toBe("@project");
    expect(dry.plan!.creates[2]!.target).toBe("$n0.model");
    expect(dry.plan!.updates.map((u) => u.op)).toEqual(["/layout_diagram"]);
    expect(dry.plan!.deletes).toEqual([]);

    const spy = vi.spyOn(batchRunner, "run");
    const applied = await ok<Planned>(build, {
      kind: "class",
      name: "Shop",
      spec: SPEC,
    });
    expect(spy.mock.calls[0]![1]).toEqual(dry.plan!.ops);
    spy.mockRestore();
    expect(applied.dryRun).toBeUndefined();
    expect(applied.created).toBe(dry.created);
  });

  it("plans an upsert with updates and pruning against the existing diagram", async () => {
    const first = await ok<Planned>(build, {
      kind: "class",
      name: "Shop",
      spec: { ...SPEC, classes: [...SPEC.classes, { name: "Old" }] },
    });
    const dry = await ok<Planned>(build, {
      kind: "class",
      name: "Shop",
      upsert: true,
      prune: true,
      dryRun: true,
      spec: {
        classes: [
          {
            name: "Order",
            attributes: ["+id: long", "+total: double"],
            kind: "abstract",
          },
          { name: "Line" },
        ],
        relations: SPEC.relations,
        styles: { Line: { fillColor: "#abcdef" } },
      },
    });
    expect(dry.diagram._id).toBe(first.diagram._id);
    expect(dry.ids.Order).toEqual(first.ids.Order);
    expect(dry.deleted).toBe(1);
    expect(dry.plan!.deletes).toEqual([
      { op: "/delete_element", target: "Old" },
    ]);
    expect(dry.plan!.updates).toEqual([
      {
        op: "/update_element",
        target: "Order",
        change: 'field = "isAbstract", value = true',
      },
      {
        op: "/set_view_style",
        target: "Line@Shop",
        change: 'fillColor = "#abcdef"',
      },
    ]);
    expect(dry.plan!.creates).toEqual([
      expect.objectContaining({
        op: "/add_attribute",
        target: "Order",
        name: "total",
        type: "double",
      }),
    ]);
    expect(env.app.repository.get(first.ids.Old!.model!)).toBeDefined();
  });

  it("plans from text and keeps the read's warnings", async () => {
    const dry = await ok<Planned>(build, {
      text: "@startuml\nclass A\nclass B\nA --> B\nskinparam x y\n@enduml",
      dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, format: "plantuml" });
    expect(dry.plan!.ops.length).toBeGreaterThan(2);
  });

  it("describes ops by their targets' paths", () => {
    const cls = env.app.factory.createModel({
      id: "UMLClass",
      parent: env.model,
      modelInitializer: (m) => {
        m.name = "C";
      },
    })!;
    expect(
      describeOp({
        path: "/update_element",
        body: { ref: cls._id, field: "name", value: "D" },
      }),
    ).toEqual({
      op: "/update_element",
      target: "Model/C",
      change: 'field = "name", value = "D"',
    });
    expect(
      describeOp({ path: "/resize_node", body: { ref: env.project._id } })
        .target,
    ).toBe("@project");
    const note = env.app.factory.createModelAndView({
      id: "Note",
      parent: env.model,
      diagram: env.mainDiagram,
      x1: 0,
      y1: 0,
      x2: 9,
      y2: 9,
    })!;
    expect(
      describeOp({ path: "/resize_node", body: { ref: note._id } }).target,
    ).toBe(note._id);
    expect(
      describeOp({ path: "/move_views", body: { refs: ["gone"], dx: 1 } }),
    ).toEqual({
      op: "/move_views",
      target: "gone",
      change: "dx = 1",
    });
    expect(describeOp({ path: "/layout_diagram", body: {} })).toEqual({
      op: "/layout_diagram",
      target: null,
    });
    expect(
      describeOp({
        path: "/create_diagram",
        as: "diagram",
        body: { type: "X", parent: 3 },
      }),
    ).toEqual({
      op: "/create_diagram",
      target: null,
      as: "diagram",
      type: "X",
    });
    expect(planOf([])).toEqual({
      ops: [],
      creates: [],
      updates: [],
      deletes: [],
    });
  });
});

interface Diffed {
  diagram: { _id: string };
  kind: string;
  identical: boolean;
  added: { nodes: string[]; edges: string[] };
  removed: { _id: string; _type: string; path: string | null }[];
  changed: { node: string; path: string | null; changes: string[] }[];
  unchanged: number;
}

describe("/diff_diagram", () => {
  it("reports what a spec adds, removes and changes, and nothing for a match", async () => {
    const built = await ok<Planned>(build, {
      kind: "class",
      name: "Shop",
      spec: { ...SPEC, classes: [...SPEC.classes, { name: "Old" }] },
    });
    const before = state();
    const same = await ok<Diffed>(diffDiagram, {
      diagram: "Shop",
      kind: "class",
      spec: { ...SPEC, classes: [...SPEC.classes, { name: "Old" }] },
    });
    expect(same).toMatchObject({
      identical: true,
      added: { nodes: [], edges: [] },
      removed: [],
      changed: [],
      unchanged: 4,
    });
    const diff = await ok<Diffed>(diffDiagram, {
      diagramId: built.diagram._id,
      mermaid: [
        "classDiagram",
        "class Order {",
        "  +id: long",
        "  +total() double",
        "}",
        "class Line",
        "class New",
        "Order *-- Line",
        "Line --> New",
      ].join("\n"),
    });
    expect(state()).toEqual(before);
    expect(diff).toMatchObject({
      kind: "class",
      identical: false,
      added: { nodes: ["New"], edges: ["Line -> New"] },
      removed: [{ _id: built.ids.Old!.model, _type: "UMLClass", path: "Old" }],
      changed: [
        {
          node: "Order",
          path: "Order@Shop",
          changes: ["add_operation total"],
        },
      ],
    });
  });

  it("refuses a spec of another kind than the diagram", async () => {
    await fails(
      diffDiagram,
      { diagram: "Main", kind: "erd", spec: {} },
      "INVALID_ARGUMENT",
      "Model/Main is a UMLClassDiagram; a erd spec builds a ERDDiagram",
    );
    await fails(diffDiagram, { diagram: "Main" }, "INVALID_ARGUMENT");
    await fails(
      diffDiagram,
      { diagram: "Nope", kind: "class", spec: {} },
      "NOT_FOUND",
    );
  });
});

interface Snap {
  label: string;
  takenAt: string;
  elements: number;
}

interface Since {
  snapshot: string;
  counts: { added: number; changed: number; removed: number };
  truncated: boolean;
  added: { _id: string; path: string | null }[];
  changed: { _id: string; path: string | null; fields: string[] }[];
  removed: { _id: string; path: string | null }[];
}

async function addClass(name: string): Promise<string> {
  return (
    await ok<{ _id: string }>(endpoint("/create_element"), {
      type: "UMLClass",
      parent: "Model",
      name,
    })
  )._id;
}

describe("/snapshot, /diff_since and /restore_snapshot", () => {
  it("lists what was added, changed and removed since a snapshot", async () => {
    const keep = await addClass("Keep");
    const gone = await addClass("Gone");
    const snap = await ok<Snap>(takeSnapshot, { label: "before" });
    const models = Object.values(env.app.repository.getIdMap()).filter(
      (e) => !(e instanceof type.View),
    );
    expect(snap).toMatchObject({ label: "before", elements: models.length });
    expect(Date.parse(snap.takenAt)).not.toBeNaN();
    const fresh = await addClass("Fresh");
    await ok(endpoint("/update_element"), {
      ref: keep,
      field: "name",
      value: "Kept",
    });
    await ok(endpoint("/add_attribute"), { ref: keep, name: "x" });
    await ok(endpoint("/delete_element"), { ref: gone });
    const since = await ok<Since>(diffSinceEndpoint, { snapshot: "before" });
    expect(since.counts).toEqual({ added: 2, changed: 1, removed: 1 });
    expect(since.added.map((a) => a.path)).toEqual([
      "Model/Fresh",
      "Model/Kept.x",
    ]);
    expect(since.changed).toEqual([
      expect.objectContaining({
        _id: keep,
        path: "Model/Kept",
        fields: ["name"],
      }),
    ]);
    expect(since.removed).toEqual([
      expect.objectContaining({ _id: gone, path: "Model/Gone" }),
    ]);
    const cut = await ok<Since>(diffSinceEndpoint, {
      snapshot: "before",
      limit: 1,
    });
    expect(cut).toMatchObject({ truncated: true });
    expect(cut.added).toHaveLength(1);
    void fresh;
  });

  // The mock records engine view edits as undoable operations; creation,
  // deletion and setProperty it applies directly (tests/mock/staruml.ts).
  let view: string;
  const resize = (width: number) =>
    ok(endpoint("/resize_node"), { ref: view, width, height: 50 });
  const width = () => env.app.repository.get(view)!.width;

  beforeEach(async () => {
    view = (
      await ok<{ view: { _id: string } }>(
        endpoint("/create_element_with_view"),
        { type: "UMLClass", diagram: "Main", name: "A" },
      )
    ).view._id;
  });

  it("restores in one step that one redo takes back", async () => {
    await resize(110);
    await ok(takeSnapshot, { label: "s" });
    await resize(120);
    await resize(130);
    await resize(140);
    const restored = await ok<{
      undone: number;
      remaining: Record<string, number>;
    }>(restoreSnapshot, { snapshot: "s" });
    expect(restored).toEqual({
      snapshot: "s",
      undone: 3,
      remaining: { added: 0, changed: 0, removed: 0 },
    });
    expect(width()).toBe(110);
    expect(env.app.repository._redoStack.size()).toBe(1);
    env.app.repository.redo();
    expect(width()).toBe(140);
    env.app.repository.undo();
    // Nothing after the snapshot, and a single operation, need no merging.
    expect(await ok(restoreSnapshot, { snapshot: "s" })).toMatchObject({
      undone: 0,
    });
    await resize(150);
    expect(await ok(restoreSnapshot, { snapshot: "s" })).toMatchObject({
      undone: 1,
    });
    expect(width()).toBe(110);
  });

  it("restores a snapshot of an empty history to the start", async () => {
    await ok(takeSnapshot, {});
    await resize(120);
    await resize(130);
    expect(await ok(restoreSnapshot, { snapshot: "snapshot-1" })).toMatchObject(
      { undone: 2 },
    );
    expect(width()).toBe(100);
  });

  it("refuses snapshots the history or project no longer reaches", async () => {
    await resize(120);
    await ok(takeSnapshot, { label: "s" });
    env.app.repository.undo();
    await fails(
      restoreSnapshot,
      { snapshot: "s" },
      "SNAPSHOT_STALE",
      "The undo history no longer reaches snapshot s",
    );
    // A change outside the history stays after a restore.
    await ok(takeSnapshot, { label: "t" });
    (env.mainDiagram as Element).name = "Renamed";
    expect(await ok(restoreSnapshot, { snapshot: "t" })).toMatchObject({
      remaining: { changed: 1 },
    });
    await fails(
      diffSinceEndpoint,
      { snapshot: "nope" },
      "NOT_FOUND",
      "No snapshot nope; snapshots: s, t",
    );
    await ok(endpoint("/new_project"), {});
    await fails(
      diffSinceEndpoint,
      { snapshot: "s" },
      "SNAPSHOT_STALE",
      "Snapshot s was taken of another project",
    );
    clearSnapshots();
    await fails(
      diffSinceEndpoint,
      { snapshot: "x" },
      "NOT_FOUND",
      "No snapshot x; snapshots: none",
    );
  });

  it("names an element that has lost its name null", async () => {
    await ok(takeSnapshot, { label: "n" });
    delete (env.model as { name?: string }).name;
    const since = await ok<Since>(diffSinceEndpoint, { snapshot: "n" });
    expect(since.changed).toEqual([
      {
        _id: env.model._id,
        _type: "UMLModel",
        name: null,
        path: "",
        fields: ["name"],
      },
    ]);
  });

  it("keeps the latest snapshots and replaces a label taken again", async () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      await ok(takeSnapshot, { label: `l${i}` });
    }
    await fails(diffSinceEndpoint, { snapshot: "l0" }, "NOT_FOUND");
    await fails(diffSinceEndpoint, { snapshot: "l1" }, "NOT_FOUND");
    await addClass("Z");
    await ok(takeSnapshot, { label: "l5" });
    expect(
      (await ok<Since>(diffSinceEndpoint, { snapshot: "l5" })).counts.added,
    ).toBe(0);
    await fails(
      batch,
      { ops: [{ path: "/restore_snapshot", body: { snapshot: "l5" } }] },
      "INVALID_ARGUMENT",
      "ops.0.path: /restore_snapshot cannot run in an atomic batch",
    );
  });
});
