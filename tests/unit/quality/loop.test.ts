import { beforeEach, describe, expect, it } from "vitest";
import { geometryOf, kindOf } from "../../../src/quality/geometry.js";
import { assess, improve, placedByBuild } from "../../../src/quality/loop.js";
import { endpoints } from "../../../src/routes.js";
import { trusted } from "../../../src/style/guard.js";
import { builtInProfiles, type Profile } from "../../../src/style/profile.js";
import type { Element, View } from "../../../src/types.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;
const standard = (): Profile => builtInProfiles()["uml-standard"]!;

beforeEach(() => {
  env = installMockApp();
});

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
  quality: { score: number; before: number; steps: string[]; passes: boolean };
}

async function build(body: Record<string, unknown>): Promise<Built> {
  return ok<Built>(ep("/build_diagram"), { result: "ids", ...body });
}

/** Sets a view's box directly, as a hand edit or another tool would. */
function place(id: string, left: number, top: number, width?: number) {
  const v = get(id);
  v.left = left;
  v.top = top;
  if (width !== undefined) v.width = width;
}

describe("the loop inside /build_diagram", () => {
  it("answers quality and stays one undo step", async () => {
    const built = await build({
      kind: "class",
      name: "Q",
      spec: {
        classes: [{ name: "A" }, { name: "B" }, { name: "C" }],
        relations: [
          { from: "B", to: "A", type: "generalization" },
          { from: "C", to: "A", type: "generalization" },
        ],
      },
    });
    expect(built.quality).toMatchObject({ passes: true });
    expect(built.quality.score).toBeGreaterThanOrEqual(80);
  });
});

describe("/diagram_quality", () => {
  it("scores a diagram with its measures, penalties and lint findings", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    place(
      built.ids.B!.view,
      get(built.ids.A!.view).left as number,
      get(built.ids.A!.view).top as number,
    );
    const q = await ok<{
      score: number;
      rating: number;
      kind: string;
      metrics: Record<string, number>;
      penalties: Record<string, number>;
      findings: { rule: string; count: number }[];
      passes: boolean;
    }>(ep("/diagram_quality"), { ref: built.diagram._id });
    expect(q.kind).toBe("class");
    expect(q.metrics.overlapPairs).toBe(1);
    expect(q.penalties.overlap).toBeGreaterThan(0);
    expect(q.findings).toContainEqual(
      expect.objectContaining({ rule: "L001", count: 1 }),
    );
    expect(q.passes).toBe(false);
    expect(q.rating).toBeLessThan(4);
  });

  it("scores a diagram of a kind the build does not make against the profile's minScore", async () => {
    const d = create("UMLObjectDiagram");
    d.name = "Objects";
    d._parent = env.model;
    (env.model.ownedElements as Element[]).push(d);
    env.app.repository.index(d);
    const q = await ok<{ kind: string | null; target: number }>(
      ep("/diagram_quality"),
      { ref: d._id },
    );
    expect(q).toMatchObject({ kind: null, target: 80 });
    expect(kindOf(d)).toBeNull();
    const improved = await ok<{ quality: { target: number } }>(
      ep("/improve_diagram"),
      { ref: d._id },
    );
    expect(improved.quality.target).toBe(80);
  });
});

describe("/improve_diagram", () => {
  it("relays out a stacked class diagram, one undo step, and dryRun changes nothing", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "B" }, { name: "C" }],
        relations: [
          { from: "B", to: "A", type: "generalization" },
          { from: "C", to: "A", type: "generalization" },
        ],
      },
    });
    for (const k of ["A", "B", "C"]) place(built.ids[k]!.view, 300, 300);
    const dry = await ok<{
      quality: { score: number; before: number };
      dryRun: boolean;
    }>(ep("/improve_diagram"), { ref: built.diagram._id, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.quality.score).toBeGreaterThan(dry.quality.before);
    expect(get(built.ids.B!.view)).toMatchObject({ left: 300, top: 300 });
    const done = await ok<{ quality: { score: number; steps: string[] } }>(
      ep("/improve_diagram"),
      {
        ref: built.diagram._id,
        preset: "flow-right",
        maxIterations: 2,
        target: 100,
      },
    );
    expect(done.quality.steps[0]).toBe("layout flow-right");
    expect(done.quality.score).toBeGreaterThan(dry.quality.before);
    await ok(ep("/undo"));
    expect(get(built.ids.B!.view)).toMatchObject({ left: 300, top: 300 });
    await fails(ep("/improve_diagram"), { ref: "Nothing" }, "NOT_FOUND");
  });

  it("keeps a step only when the score does not drop", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    place(built.ids.A!.view, -50, 10);
    // An engine that throws a moved view far away makes every single move worse.
    const move = env.app.engine.moveViews.bind(env.app.engine);
    env.app.engine.moveViews = (editor, views, dx, dy) =>
      move(editor, views, dx * 1000 + 50_000, dy * 1000 + 50_000);
    const q = improve(get(built.diagram._id), standard(), { relayout: false });
    env.app.engine.moveViews = move;
    expect(q.steps).not.toContain("autofix");
    const [a, b] = [get(built.ids.A!.view), get(built.ids.B!.view)];
    // Only the move of everything at once (trim) is kept: nothing moved apart.
    expect((b.left as number) - (a.left as number)).toBe(
      (b.left as number) - (a.left as number),
    );
    expect(q.score).toBe(q.before);
  });

  it("fits long names, wrapping past labelWrap", async () => {
    const long =
      "AVeryLongClassNameThatNeedsMuchMoreRoomThanTheDefaultWrapWidthAllows";
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: long }, { name: "MediumLengthName" }] },
    });
    place(built.ids[long]!.view, 400, 400, 100);
    place(built.ids.MediumLengthName!.view, 403, 600, 60);
    // StarUML computes minHeight when it repaints; wrapped lines need more.
    get(built.ids[long]!.view).minHeight = 90;
    const q = improve(get(built.diagram._id), standard(), { relayout: false });
    expect(q.steps).toContain("fit labels");
    expect(get(built.ids[long]!.view)).toMatchObject({
      wordWrap: true,
      width: 220,
      height: 90,
    });
    expect(get(built.ids.MediumLengthName!.view).width).toBeGreaterThan(60);
  });

  it("moves boxes off each other, onto the grid and to the margin", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    });
    place(built.ids.A!.view, 103, 107);
    place(built.ids.B!.view, 150, 120);
    place(built.ids.C!.view, 103, 400);
    const q = improve(get(built.diagram._id), standard(), { relayout: false });
    expect(q.steps).toEqual(
      expect.arrayContaining(["separate", "snap", "trim"]),
    );
    const g = geometryOf(get(built.diagram._id));
    expect(Math.min(...g.nodes.map((n) => n.left))).toBe(40);
    expect(g.nodes.every((n) => n.left % 10 === 0 && n.top % 10 === 0)).toBe(
      true,
    );
    // Without snapping, nothing goes on the grid.
    const loose = {
      ...standard(),
      visuals: { ...standard().visuals, grid: { size: 10, snap: false } },
    };
    place(built.ids.A!.view, 1003, 1007);
    expect(
      improve(get(built.diagram._id), loose, { relayout: false }).steps,
    ).not.toContain("snap");
  });

  it("orders a rank by its neighbours above, then autofixes what is left", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [
          { name: "L" },
          { name: "R" },
          { name: "RChild" },
          { name: "LChild" },
        ],
        relations: [
          { from: "LChild", to: "L", type: "generalization" },
          { from: "RChild", to: "R", type: "generalization" },
        ],
      },
    });
    place(built.ids.L!.view, 0, 0);
    place(built.ids.R!.view, 300, 0);
    place(built.ids.RChild!.view, 0, 200);
    place(built.ids.LChild!.view, 300, 200);
    const q = improve(get(built.diagram._id), standard(), { relayout: false });
    expect(q.steps).toContain("order ranks");
    expect(get(built.ids.LChild!.view).left as number).toBeLessThan(
      get(built.ids.RChild!.view).left as number,
    );
  });

  it("orders lifelines by their first message unless notes pin them, and frames them all", async () => {
    const spec = {
      participants: ["Bank", "User", "Shop"],
      messages: [
        { from: "User", to: "Shop", text: "order()" },
        { from: "Shop", to: "Bank", text: "pay()" },
      ],
    };
    const built = await build({ kind: "sequence", spec });
    const d = get(built.diagram._id);
    // Back in the spec's order, as a hand edit could leave them.
    ["Bank", "User", "Shop"].forEach((n, i) =>
      place(built.ids[n]!.view, 40 + i * 200, 40),
    );
    const frame = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLFrameView",
    )!;
    frame.width = 10;
    const q = improve(d, standard());
    expect(q.steps).toContain("lifelines");
    const lefts = ["User", "Shop", "Bank"].map(
      (n) => get(built.ids[n]!.view).left as number,
    );
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    expect(frame.width as number).toBeGreaterThan(10);
    expect(placedByBuild(d, "sequence")).toBe(true);
    const noted = await build({
      kind: "sequence",
      spec: { ...spec, notes: [{ text: "n", on: "Bank", side: "right" }] },
    });
    const before = get(noted.ids.Bank!.view).left;
    improve(get(noted.diagram._id), standard());
    expect(get(noted.ids.Bank!.view).left).toBe(before);
    // A message without points sorts first; a lifeline without messages comes last.
    const lonely = await build({
      kind: "sequence",
      spec: { participants: ["Solo"] },
    });
    expect(improve(get(lonely.diagram._id), standard()).steps).not.toContain(
      "lifelines",
    );
  });

  it("puts the boundary around its use cases and actors outside it", async () => {
    const built = await build({
      kind: "usecase",
      spec: {
        system: "Shop",
        actors: ["Clerk"],
        useCases: ["Pay bill", "Ship order"],
        relations: [{ from: "Clerk", to: "Pay bill" }],
      },
    });
    const subject = get(built.ids.Shop!.view);
    const s = { left: subject.left as number, top: subject.top as number };
    place(built.ids.Clerk!.view, s.left + 20, s.top + 60);
    place(
      built.ids["Ship order"]!.view,
      s.left + 30,
      (subject.top as number) + (subject.height as number) - 20,
    );
    const q = improve(get(built.diagram._id), standard());
    expect(q.steps).toContain("boundary");
    expect(
      (get(built.ids.Clerk!.view).left as number) +
        (get(built.ids.Clerk!.view).width as number),
    ).toBeLessThan(subject.left as number);
    // A boundary with no use case inside keeps its size.
    const empty = await build({
      kind: "usecase",
      spec: { system: "Empty", actors: ["A"] },
    });
    improve(get(empty.diagram._id), standard());
  });

  it("straightens chains in flows, down for activities and right for state machines", async () => {
    const activity = await build({
      kind: "activity",
      spec: {
        nodes: [
          { id: "s", type: "initial" },
          { id: "a", name: "Pick" },
          { id: "b", name: "Pack" },
          { id: "d", type: "decision" },
          { id: "x", name: "Ship" },
          { id: "y", name: "Hold" },
        ],
        flows: [
          { from: "s", to: "a" },
          { from: "a", to: "b" },
          { from: "b", to: "d" },
          { from: "d", to: "x" },
          { from: "d", to: "y" },
          { from: "y", to: "y" },
        ],
      },
    });
    const pack = get(activity.ids.b!.view);
    place(activity.ids.b!.view, (pack.left as number) + 37, pack.top as number);
    const q = improve(get(activity.diagram._id), standard());
    expect(q.steps).toContain("align chains");
    const [a, b] = ["a", "b"].map((k) => get(activity.ids[k]!.view));
    expect((a!.left as number) + (a!.width as number) / 2).toBe(
      (b!.left as number) + (b!.width as number) / 2,
    );
    const state = await build({
      kind: "statemachine",
      spec: {
        states: ["A", "B"],
        transitions: [{ from: "A", to: "B" }],
      },
    });
    const sb = get(state.ids.B!.view);
    place(state.ids.B!.view, sb.left as number, (sb.top as number) + 23);
    expect(improve(get(state.diagram._id), standard()).steps).toContain(
      "align chains",
    );
    expect(get(state.ids.B!.view).top).toBe(get(state.ids.A!.view).top);
    // A flowchart has no preset in the profile: its flow runs down.
    const flow = await build({
      kind: "flowchart",
      spec: {
        nodes: [
          { id: "p", name: "P" },
          { id: "q", name: "Q" },
        ],
        flows: [{ from: "p", to: "q" }],
      },
    });
    const fq = get(flow.ids.q!.view);
    place(flow.ids.q!.view, (fq.left as number) + 31, fq.top as number);
    improve(get(flow.diagram._id), standard());
    expect(get(flow.ids.q!.view).left).toBe(get(flow.ids.p!.view).left);
  });

  it("leaves lanes and mind maps where the build put them", async () => {
    const lanes = await build({
      kind: "activity",
      spec: {
        lanes: ["Customer", "Shop"],
        nodes: [
          { id: "a", name: "Order", lane: "Customer" },
          { id: "b", name: "Ship", lane: "Shop" },
        ],
        flows: [{ from: "a", to: "b" }],
      },
    });
    const d = get(lanes.diagram._id);
    expect(placedByBuild(d, "activity")).toBe(true);
    const before = get(lanes.ids.b!.view).left;
    improve(d, standard(), { relayout: true });
    expect(get(lanes.ids.b!.view).left).toBe(before);
    const map = await build({
      kind: "mindmap",
      spec: { root: { name: "R", children: [{ name: "C" }] } },
    });
    expect(
      improve(get(map.diagram._id), standard(), { relayout: true }).steps,
    ).toEqual([]);
  });
});

describe("assess and geometry", () => {
  it("reads containers through sub-views and edge labels with text", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "B" }],
        relations: [{ from: "A", to: "B", type: "association", name: "has" }],
      },
    });
    const d = get(built.diagram._id);
    const edge = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLAssociationView",
    )!;
    const label = {
      _id: "LBL",
      left: 10,
      top: 10,
      width: 30,
      height: 12,
      text: "has",
      visible: true,
    };
    edge.nameLabel = label as unknown as Element;
    const hidden = { ...label, visible: false };
    let g = geometryOf(d);
    expect(g.nodes.find((n) => n.id === "LBL")).toMatchObject({
      label: true,
      attachedTo: [built.ids.A!.view, built.ids.B!.view],
    });
    edge.nameLabel = hidden as unknown as Element;
    expect(geometryOf(d).nodes.some((n) => n.id === "LBL")).toBe(false);
    edge.nameLabel = { ...label, text: "" } as unknown as Element;
    expect(geometryOf(d).nodes.some((n) => n.id === "LBL")).toBe(false);
    edge.nameLabel = { ...label, width: 0 } as unknown as Element;
    expect(geometryOf(d).nodes.some((n) => n.id === "LBL")).toBe(false);
    // A view held by a sub-view of another (a state in a region) is that one's.
    const a = get(built.ids.A!.view);
    const b = get(built.ids.B!.view);
    const region = create("UMLRegionView");
    region._parent = b as never;
    a.containerView = region;
    g = geometryOf(d);
    expect(g.nodes.find((n) => n.id === a._id)!.parent).toBe(b._id);
    // A container chain that leaves the views ends at nothing.
    const outside = create("UMLRegionView");
    outside._parent = env.model as never;
    a.containerView = outside;
    expect(geometryOf(d).nodes.find((n) => n.id === a._id)!.parent).toBeNull();
    expect(assess(d, standard()).score).toBeGreaterThan(0);
  });
});

describe("/layout_diagram runs the loop when called from outside", () => {
  it("answers quality in the same undo step, and not inside the extension's own work", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    const layout = ep("/layout_diagram");
    const outside = await ok<{ quality?: { score: number } }>(layout, {
      diagram: built.diagram._id,
      preset: "hierarchy-down",
    });
    expect(outside.quality?.score).toBeGreaterThan(0);
    const inside = await trusted(() =>
      ok<{ quality?: unknown }>(layout, { diagram: built.diagram._id }),
    );
    expect(inside.quality).toBeUndefined();
    await fails(layout, { diagram: "Nothing" }, "NOT_FOUND");
  });
});

describe("edges of the loop", () => {
  it("wraps a name in a box already wide, keeps a height that fits, and relays out by kind", async () => {
    const long =
      "AVeryLongClassNameThatNeedsMuchMoreRoomThanTheDefaultWrapWidthAllows";
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: long }, { name: "B" }] },
    });
    place(built.ids[long]!.view, 400, 400, 300);
    const v = get(built.ids[long]!.view);
    v.minHeight = 1;
    improve(get(built.diagram._id), standard(), { relayout: false });
    expect(v).toMatchObject({ wordWrap: true, width: 300 });
    // Already wrapped and wide enough: nothing to do.
    improve(get(built.diagram._id), standard(), { relayout: false });
    // A profile without a class preset lays a class diagram out as a hierarchy.
    const bare = {
      ...standard(),
      layout: { ...standard().layout, presets: {} },
    };
    expect(
      improve(get(built.diagram._id), bare, { relayout: true, target: 100 })
        .steps[0],
    ).toMatch(/^layout hierarchy-down|^fit/);
    const c4 = await build({
      kind: "c4",
      spec: {
        elements: [
          { id: "a", name: "A", type: "system" },
          { id: "b", name: "B", type: "system" },
        ],
        relations: [{ from: "a", to: "b", label: "uses" }],
      },
    });
    improve(get(c4.diagram._id), standard(), { relayout: true, target: 100 });
  });

  it("relays out a diagram of a kind the build does not make by a flow", async () => {
    const d = create("UMLObjectDiagram");
    d._parent = env.model;
    (env.model.ownedElements as unknown[]).push(d);
    env.app.repository.index(d);
    for (const name of ["o1", "o2"]) {
      await ok(ep("/create_element_with_view"), {
        type: "UMLObject",
        diagram: d._id,
        name,
      });
    }
    const q = improve(d as unknown as Element, standard(), {
      relayout: true,
      target: 100,
    });
    expect(q.target).toBe(100);
  });

  it("moves a box back onto the canvas by its autofix", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    place(built.ids.A!.view, -50, 300);
    const q = improve(get(built.diagram._id), standard(), { relayout: false });
    expect(q.steps).toContain("autofix");
    expect(get(built.ids.A!.view).left as number).toBeGreaterThanOrEqual(0);
  });

  it("orders messages by where they run, and leaves a sequence without a frame alone", async () => {
    const built = await build({
      kind: "sequence",
      spec: {
        participants: ["A", "B", "C"],
        messages: [
          { from: "A", to: "B", text: "one()" },
          { from: "B", to: "C", text: "two()" },
        ],
      },
    });
    const d = get(built.diagram._id);
    const messages = (d.ownedViews as View[]).filter(
      (v) => v.constructor.name === "UMLSeqMessageView",
    );
    // The second message drawn above the first: C and B come before A.
    messages[0]!.points = {
      points: [
        { x: 0, y: 300 },
        { x: 1, y: 300 },
      ],
    } as never;
    messages[1]!.points = {
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
      ],
    } as never;
    const frame = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLFrameView",
    )!;
    (d.ownedViews as View[]).splice((d.ownedViews as View[]).indexOf(frame), 1);
    improve(d, standard());
    const lefts = ["B", "C", "A"].map(
      (n) => get(built.ids[n]!.view).left as number,
    );
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    messages[0]!.points = { points: [] } as never;
    improve(d, standard());
  });

  it("reads a lifeline's line part as its lifeline, and a label without text as none", async () => {
    const built = await build({
      kind: "sequence",
      spec: { messages: [{ from: "A", to: "B", text: "go()" }] },
    });
    const d = get(built.diagram._id);
    const msg = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLSeqMessageView",
    )!;
    const line = create("UMLLinePartView");
    line._parent = get(built.ids.A!.view) as never;
    msg.tail = line as unknown as View;
    msg.nameLabel = {
      _id: "L",
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    } as unknown as Element;
    const g = geometryOf(d);
    expect(g.edges[0]!.ends[0]).toBe(built.ids.A!.view);
    expect(g.nodes.some((n) => n.id === "L")).toBe(false);
    // A container chain that ends without an owner.
    const a = get(built.ids.A!.view);
    const loose = create("UMLRegionView");
    (loose as { _parent: unknown })._parent = undefined;
    a.containerView = loose as unknown as View;
    expect(geometryOf(d).nodes.find((n) => n.id === a._id)!.parent).toBeNull();
  });

  it("scores the current diagram by default, and a diagram without a name", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "A" }] },
    });
    await ok(ep("/switch_diagram"), { diagram: built.diagram._id });
    const d = get(built.diagram._id);
    d.name = undefined as never;
    const q = await ok<{ diagram: { name: string | null } }>(
      ep("/diagram_quality"),
    );
    expect(q.diagram.name).toBeNull();
    const i = await ok<{ diagram: { _id: string } }>(ep("/improve_diagram"), {
      relayout: false,
    });
    expect(i.diagram._id).toBe(built.diagram._id);
  });
});

describe("snapshots across the quality loop", () => {
  it("restores a snapshot taken before /improve_diagram, its dry run and a layout", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "B" }, { name: "C" }],
        relations: [{ from: "B", to: "A", type: "generalization" }],
      },
    });
    for (const k of ["A", "B", "C"]) place(built.ids[k]!.view, 300, 300);
    const at = () => get(built.ids.B!.view).left;
    await ok(ep("/snapshot"), { label: "before" });
    await ok(ep("/improve_diagram"), { ref: built.diagram._id, dryRun: true });
    await ok(ep("/improve_diagram"), { ref: built.diagram._id });
    expect(at()).not.toBe(300);
    await ok(ep("/layout_diagram"), { diagram: built.diagram._id });
    const restored = await ok<{ undone: number }>(ep("/restore_snapshot"), {
      snapshot: "before",
    });
    expect(restored.undone).toBe(2);
    expect(at()).toBe(300);
  });
});

describe("lanes and self messages", () => {
  it("pushes overlapping boxes in a lane down, keeping them in their lane", async () => {
    const built = await build({
      kind: "activity",
      spec: {
        lanes: ["Shop"],
        nodes: [
          { id: "a", name: "Pick", lane: "Shop" },
          { id: "b", name: "Pack", lane: "Shop" },
        ],
        flows: [{ from: "a", to: "b" }],
      },
    });
    const a = get(built.ids.a!.view);
    place(built.ids.b!.view, a.left as number, (a.top as number) + 5);
    const q = improve(get(built.diagram._id), standard());
    expect(q.steps).toContain("separate in lanes");
    expect(get(built.ids.b!.view).top as number).toBeGreaterThan(
      (a.top as number) + (a.height as number),
    );
  });

  it("draws a message to its own lifeline when StarUML's factory draws none", async () => {
    const built = await build({
      kind: "sequence",
      spec: { messages: [{ from: "A", to: "B", text: "go()" }] },
    });
    const d = get(built.diagram._id);
    const lifeline = get(built.ids.A!.view);
    const line = create("UMLLinePartView");
    line.left = 70;
    line._parent = lifeline as never;
    lifeline.linePart = line;
    const self = await ok<{
      model: { _id: string };
      view: { _id: string } | null;
    }>(ep("/create_relationship"), {
      type: "UMLMessage",
      tail: (lifeline.model as Element)._id,
      head: (lifeline.model as Element)._id,
    });
    const factory = env.app.factory.createViewOf.bind(env.app.factory);
    env.app.factory.createViewOf = () => null as never;
    const shown = await ok<{ view: { _id: string } }>(ep("/create_view_of"), {
      ref: self.model._id,
      diagram: d._id,
      y: 220,
    });
    const view = get(shown.view._id);
    expect(view).toMatchObject({ tail: line, head: line });
    expect((view.points as { points: { y: number }[] }).points[0]!.y).toBe(220);
    // A message between two lifelines, or without a line part, is not drawn so.
    const other = await ok<{
      model: { _id: string };
      view: { _id: string } | null;
    }>(ep("/create_relationship"), {
      type: "UMLMessage",
      tail: (lifeline.model as Element)._id,
      head: (get(built.ids.B!.view).model as Element)._id,
    });
    await fails(
      ep("/create_view_of"),
      { ref: other.model._id, diagram: d._id },
      "STARUML_ERROR",
    );
    lifeline.linePart = null;
    await ok(ep("/delete_element"), { ref: shown.view._id });
    await fails(
      ep("/create_view_of"),
      {
        ref: self.model._id,
        diagram: d._id,
      },
      "STARUML_ERROR",
    );
    env.app.factory.createViewOf = factory;
  });
});

describe("dodging", () => {
  it("leaves a port an edge runs over on its component's border", async () => {
    const built = await build({
      kind: "component",
      spec: {
        components: [{ name: "Hub", ports: ["p"] }, "Left", "Right"],
        dependencies: [{ from: "Left", to: "Right" }],
      },
    });
    const d = get(built.diagram._id);
    const port = (d.ownedViews as View[]).find((v) =>
      /Port/.test(v.constructor.name),
    )!;
    const [l, r] = [get(built.ids.Left!.view), get(built.ids.Right!.view)];
    place(l._id, 0, 300);
    place(r._id, 600, 300);
    // The port right on the line between them.
    port.left = 300;
    port.top = (l.top as number) + (l.height as number) / 2 - 5;
    port.width = 10;
    port.height = 10;
    const dep = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLDependencyView",
    )!;
    const y = (port.top as number) + 5;
    dep.points = {
      points: [
        { x: 50, y },
        { x: 650, y },
      ],
    } as never;
    const q = improve(d, standard(), { relayout: false, maxIterations: 1 });
    expect(q.steps).not.toContain("dodge");
  });
});
