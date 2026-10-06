import { beforeEach, describe, expect, it } from "vitest";
import { lifelineOps } from "../../../src/handlers/build.js";
import { geometryOf } from "../../../src/quality/geometry.js";
import {
  autofix,
  fitFragments,
  fitLanes,
  fold,
  improve,
  Mover,
  placeLabels,
  scoredAsIs,
  unbundle,
  unstrip,
  wrapRows,
} from "../../../src/quality/loop.js";
import { measure } from "../../../src/quality/metric.js";
import { endpoints } from "../../../src/routes.js";
import {
  builtInProfiles,
  limitsFor,
  type Profile,
} from "../../../src/style/profile.js";
import type { Element, View } from "../../../src/types.js";
import {
  create,
  installMockApp,
  mockPoints,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { ok } from "../support.js";

/*
 * The quality loop's steps for #38 one at a time: folding a strip,
 * wrapping wide rows, choosing among the ways out of a strip, moving edge
 * labels, straightening bus lines, fitting lanes and fragments.
 */

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
/** A view with the fields these tests read and set, typed. */
type Box = View & {
  left: number;
  top: number;
  width: number;
  height: number;
  edgePosition: number;
  lineStyle: number;
  model: { name: string };
};
const get = (id: string) => env.app.repository.get(id) as unknown as Box;
const mk = (typeName: string) => create(typeName) as unknown as Box;
const standard = (): Profile => builtInProfiles()["uml-standard"]!;
const limits = () => limitsFor(standard());

beforeEach(() => {
  env = installMockApp();
});

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
}

const build = (body: Record<string, unknown>) =>
  ok<Built>(ep("/build_diagram"), {
    result: "ids",
    autoLayout: false,
    ...body,
  });

/** A class diagram of `n` unrelated classes, set out at (x(i), y(i)). */
async function classes(
  n: number,
  x: (i: number) => number,
  y: (i: number) => number,
) {
  const names = Array.from({ length: n }, (_, i) => `C${i}`);
  const built = await build({
    kind: "class",
    spec: { classes: names.map((name) => ({ name })) },
  });
  names.forEach((name, i) => {
    const v = get(built.ids[name]!.view);
    v.left = x(i);
    v.top = y(i);
    v.width = 100;
    v.height = 50;
  });
  return { built, diagram: get(built.diagram._id) as unknown as Element };
}

const aspect = (d: Element) => measure(geometryOf(d)).aspect;

describe("fold", () => {
  it("folds a row into bands within maxAspect, every other band mirrored", async () => {
    const { diagram } = await classes(
      12,
      (i) => i * 160,
      () => 0,
    );
    expect(aspect(diagram)).toBeGreaterThan(3);
    fold(diagram, limits(), new Mover(diagram));
    expect(aspect(diagram)).toBeLessThanOrEqual(3);
  });

  it("folds a column into bands side by side", async () => {
    const { diagram } = await classes(
      12,
      () => 0,
      (i) => i * 90,
    );
    fold(diagram, limits(), new Mover(diagram));
    expect(aspect(diagram)).toBeLessThanOrEqual(3);
  });

  it("leaves a picture, a lone box and a strip with no gap to cut alone", async () => {
    const square = await classes(
      4,
      (i) => (i % 2) * 150,
      (i) => (i >> 1) * 100,
    );
    const before = aspect(square.diagram);
    fold(square.diagram, limits(), new Mover(square.diagram));
    expect(aspect(square.diagram)).toBe(before);
    const lone = await classes(
      1,
      () => 0,
      () => 0,
    );
    fold(lone.diagram, limits(), new Mover(lone.diagram));
    const packed = await classes(
      6,
      (i) => i * 60,
      () => 0,
    );
    const wide = aspect(packed.diagram);
    fold(packed.diagram, limits(), new Mover(packed.diagram));
    expect(aspect(packed.diagram)).toBe(wide);
  });
});

describe("wrapRows", () => {
  it("breaks a wide row into staggered sub-rows and moves the rows below down", async () => {
    const { built, diagram } = await classes(
      10,
      (i) => (i < 9 ? i * 140 : 0),
      (i) => (i < 9 ? 0 : 300),
    );
    wrapRows(diagram, new Mover(diagram));
    expect(aspect(diagram)).toBeLessThan(3);
    expect(get(built.ids.C9!.view).top).toBeGreaterThan(300);
  });

  it("leaves a tall drawing and a lone box alone", async () => {
    const tall = await classes(
      3,
      () => 0,
      (i) => i * 200,
    );
    const top = get(tall.built.ids.C2!.view).top;
    wrapRows(tall.diagram, new Mover(tall.diagram));
    expect(get(tall.built.ids.C2!.view).top).toBe(top);
    const lone = await classes(
      1,
      () => 0,
      () => 0,
    );
    wrapRows(lone.diagram, new Mover(lone.diagram));
  });
});

describe("unstrip", () => {
  const score = (values: number[]) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)]!;
  };

  it("keeps the best scored way out within maxAspect", async () => {
    const { diagram } = await classes(
      12,
      (i) => i * 160,
      () => 0,
    );
    // A labelled edge: the turned layout leaves room for its label.
    const views = diagram.ownedViews as unknown as Box[];
    views.push(
      Object.assign(mk("UMLAssociationView"), {
        tail: views[0],
        head: views[1],
        visible: true,
        points: mockPoints([
          { x: 50, y: 25 },
          { x: 130, y: 60 },
          { x: 210, y: 25 },
        ]),
        nameLabel: Object.assign(mk("EdgeLabelView"), {
          left: 100,
          top: 5,
          width: 120,
          height: 13,
          text: "label",
        }),
      }),
    );
    unstrip(diagram, "hierarchy-down", limits(), () => 90, new Mover(diagram));
    expect(aspect(diagram)).toBeLessThanOrEqual(3);
  });

  it("keeps a drawing just past the limit when every way out loses 15 points", async () => {
    const { diagram } = await classes(
      4,
      (i) => i * 115,
      () => 0,
    );
    const before = aspect(diagram);
    const tight = { ...limits(), maxAspect: before / 1.1 };
    // Now 90; the ways out score 50.
    unstrip(diagram, null, tight, score([50, 50, 90]), new Mover(diagram));
    expect(aspect(diagram)).toBe(before);
  });

  it("takes the least strip-like way when none is within the limit", async () => {
    const { diagram } = await classes(
      12,
      (i) => i * 160,
      () => 0,
    );
    const strict = { ...limits(), maxAspect: 0.5 };
    unstrip(diagram, "flow-right", strict, () => 80, new Mover(diagram));
    expect(aspect(diagram)).toBeLessThan(12);
  });
});

describe("placeLabels", () => {
  it("moves a label printed over a box to a spot that scores better", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "B" }],
        relations: [{ from: "A", to: "B", type: "association", name: "uses" }],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const [a, b] = ["A", "B"].map((k) => get(built.ids[k]!.view));
    Object.assign(a!, { left: 0, top: 0, width: 100, height: 50 });
    Object.assign(b!, { left: 400, top: 0, width: 100, height: 50 });
    const edge = (diagram.ownedViews as unknown as Box[]).find(
      (v) => v instanceof type.EdgeView,
    )!;
    edge.points = {
      points: [
        { x: 100, y: 25 },
        { x: 400, y: 25 },
      ],
    };
    const label = mk("EdgeLabelView");
    Object.assign(label, {
      left: 10,
      top: 10,
      width: 40,
      height: 14,
      text: "uses",
      edgePosition: 1,
      distance: 15,
      alpha: Math.PI / 2,
      _parent: edge,
    });
    env.app.repository._idMap[label._id] = label as never;
    edge.nameLabel = label;
    let calls = 0;
    const score = () => {
      calls++;
      // The head spot clears the box.
      if (label.edgePosition === 2) label.left = 200;
      return label.left === 200 ? 90 : 50;
    };
    placeLabels(diagram, score, () => false, new Mover(diagram));
    expect(label.edgePosition).toBe(2);
    expect(calls).toBeGreaterThan(2);
    // A move that would make a strip of the drawing is refused.
    label.left = 10;
    label.edgePosition = 1;
    placeLabels(
      diagram,
      score,
      (() => {
        let n = 0;
        return () => n++ > 0;
      })(),
      new Mover(diagram),
    );
    expect(label.edgePosition).toBe(1);
    // Every spot scores better yet leaves the label over the box: each is
    // kept in turn, none ends the search.
    label.left = 10;
    let n = 0;
    placeLabels(
      diagram,
      () => ++n,
      () => false,
      new Mover(diagram),
    );
    expect(n).toBeGreaterThan(17);
  });
});

describe("autofix", () => {
  it("widens a box its name overflows", async () => {
    const built = await build({
      kind: "class",
      spec: { classes: [{ name: "AVeryLongClassNameIndeedHere" }] },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const v = get(built.ids.AVeryLongClassNameIndeedHere!.view);
    v.width = 30;
    autofix(diagram, true, new Mover(diagram));
    expect(v.width).toBeGreaterThan(30);
  });
});

describe("unbundle", () => {
  it("straightens edges sharing a bus line to different targets", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "S" }, { name: "T" }, { name: "U" }],
        relations: [
          { from: "S", to: "T", type: "dependency" },
          { from: "S", to: "U", type: "dependency" },
        ],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const edges = (diagram.ownedViews as unknown as Box[]).filter(
      (v) => v instanceof type.EdgeView,
    );
    edges.forEach((e, i) => {
      e.lineStyle = 0;
      e.points = {
        points: [
          { x: 0, y: 100 },
          { x: 300, y: 100 },
          { x: 300 + i * 100, y: 200 },
        ],
      };
    });
    unbundle(diagram);
    expect(edges.map((e) => e.lineStyle)).toEqual([1, 1]);
    // Straight already: nothing left to do.
    unbundle(diagram);
  });
});

describe("fitLanes", () => {
  it("widens a lane for a box across its border, moves the lanes after it and lengthens all", async () => {
    const built = await build({
      kind: "activity",
      spec: {
        lanes: ["L1", "L2"],
        nodes: [
          { id: "a", name: "A", lane: "L1" },
          { id: "b", name: "B", lane: "L2" },
        ],
        flows: [{ from: "a", to: "b" }],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const lanes = (diagram.ownedViews as unknown as Box[]).filter((v) =>
      /Swimlane/.test(v.constructor.name),
    );
    const [l1, l2] = lanes.sort((x, y) => x.left - y.left) as [Box, Box];
    const a = get(built.ids.a!.view);
    const b = get(built.ids.b!.view);
    // A sticks out of L1 on the right; B hugs L2's left border; a stray
    // node sits outside every lane, below them.
    a.width = 100;
    a.left = l1.left + l1.width - 80;
    a.top = l1.top + 60;
    b.left = l2.left + 2;
    const stray = mk("UMLActionView");
    Object.assign(stray, {
      left: l2.left + l2.width + 300,
      top: l1.top + l1.height + 200,
      width: 100,
      height: 40,
      visible: true,
    });
    (diagram.ownedViews as unknown as Box[]).push(stray);
    const right1 = l1.left + l1.width;
    fitLanes(diagram, new Mover(diagram));
    expect(l1.left + l1.width).toBeGreaterThanOrEqual(a.left + a.width);
    expect(l1.left + l1.width).toBeGreaterThan(right1);
    expect(l2.left).toBe(l1.left + l1.width);
    expect(b.left).toBeGreaterThanOrEqual(l2.left + 20);
    expect(l1.top + l1.height).toBeGreaterThan(stray.top + stray.height);
  });
});

describe("fitFragments", () => {
  it("spans each fragment over the lifelines of the messages it holds", async () => {
    const built = await build({
      kind: "sequence",
      spec: {
        participants: ["A", "B", "C", "D"],
        messages: [
          { from: "A", to: "B", text: "m0" },
          { from: "B", to: "C", text: "m1" },
          { from: "C", to: "B", text: "m2" },
          { from: "A", to: "D", text: "m3" },
        ],
        fragments: [
          { operator: "loop", from: 1, to: 2 },
          { operator: "opt", from: 1, to: 1 },
        ],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const lifelines = (diagram.ownedViews as unknown as Box[]).filter(
      (v) => v instanceof type.UMLSeqLifelineView,
    );
    const fragments = (diagram.ownedViews as unknown as Box[]).filter(
      (v) => v instanceof type.UMLCombinedFragmentView,
    );
    // An empty fragment far below every message stays as it is.
    const empty = mk("UMLCombinedFragmentView");
    Object.assign(empty, {
      left: 5,
      top: 5000,
      width: 50,
      height: 50,
      visible: true,
    });
    (diagram.ownedViews as unknown as Box[]).push(empty);
    for (const l of lifelines) l.left += 100;
    fitFragments(diagram, lifelines, new Mover(diagram));
    const b = lifelines.find((l) => l.model.name === "B")!;
    const c = lifelines.find((l) => l.model.name === "C")!;
    const [outer, inner] = fragments.sort((x, y) => y.height - x.height) as [
      Box,
      Box,
    ];
    expect(outer.left).toBe(b.left - 30);
    expect(outer.left + outer.width).toBe(c.left + c.width + 30);
    expect(inner.left).toBe(b.left - 20);
    expect(empty.left).toBe(5);
  });
});

describe("hard limits in the loop's answers", () => {
  it("reports a sequence too wide to fold as failing, whatever its score", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const built = await build({
      kind: "sequence",
      spec: {
        participants: names,
        messages: [{ from: "P0", to: "P19", text: "far" }],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    const q = improve(diagram, standard());
    expect(q.failures?.[0]).toMatch(/^aspect/);
    expect(q.passes).toBe(false);
    expect(scoredAsIs(diagram, standard()).failures).toEqual(q.failures);
    const dq = await ok<{ failures?: string[]; passes: boolean }>(
      ep("/diagram_quality"),
      { ref: built.diagram._id },
    );
    expect(dq.failures).toEqual(q.failures);
    expect(dq.passes).toBe(false);
  });
});

describe("lifelineOps", () => {
  const lifeline = (name: string, typed: unknown) => {
    const l = create("UMLLifeline") as unknown as Element;
    l.name = name;
    l.represent = typed === undefined ? null : { type: typed };
    return l;
  };
  const actor = (name: string) => {
    const a = create("UMLActor") as unknown as Element;
    a.name = name;
    return a;
  };

  it("draws an actor's lifeline as the actor, named once", () => {
    expect(lifelineOps(lifeline("Device", actor("Device")), "v")).toEqual([
      {
        path: "/update_element",
        body: { ref: "v", field: "stereotypeDisplay", value: "icon" },
      },
      {
        path: "/update_element",
        body: { ref: "v", field: "showType", value: false },
      },
    ]);
    expect(lifelineOps(lifeline("d", actor("Device")), "v")).toHaveLength(1);
    const cls = create("UMLClass") as unknown as Element;
    cls.name = "Other";
    expect(lifelineOps(lifeline("x", cls), "v")).toEqual([]);
  });

  it("leaves untyped lifelines and other elements alone", () => {
    expect(lifelineOps(lifeline("x", undefined), "v")).toEqual([]);
    expect(lifelineOps(lifeline("x", "Text"), "v")).toEqual([]);
    expect(lifelineOps(create("UMLClass") as unknown as Element, "v")).toEqual(
      [],
    );
  });
});

describe("geometryOf for #38", () => {
  it("reads the frame, operands, every edge label, activations and the selection", async () => {
    const built = await build({
      kind: "sequence",
      spec: {
        participants: ["A", "B"],
        messages: [
          { from: "A", to: "B", text: "go" },
          { from: "B", to: "A", text: "back" },
        ],
        fragments: [
          { operator: "alt", guard: "ok", operands: ["else"], from: 0, to: 1 },
        ],
      },
    });
    const diagram = get(built.diagram._id) as unknown as Element;
    env.app.diagrams.setCurrentDiagram(diagram as never);
    env.app.diagrams.repaint();
    // A fragment not drawn yet has no operand views.
    (diagram.ownedViews as unknown as Box[]).push(
      Object.assign(mk("UMLCombinedFragmentView"), {
        left: 0,
        top: 900,
        width: 50,
        height: 50,
      }),
    );
    const before = geometryOf(diagram).nodes.length;
    const fragment = (diagram.ownedViews as unknown as Box[]).find(
      (v) => v instanceof type.UMLCombinedFragmentView,
    )!;
    expect(
      geometryOf(diagram).nodes.filter((n) => n.parent === fragment._id),
    ).toHaveLength(2);
    const message = (diagram.ownedViews as unknown as Box[]).find(
      (v) => v instanceof type.EdgeView,
    )!;
    const label = (text: string, width = 40) =>
      Object.assign(mk("EdgeLabelView"), {
        left: 10,
        top: 10,
        width,
        height: 13,
        text,
      });
    message.nameLabel = label("go");
    message.stereotypeLabel = label("");
    message.tailRoleNameLabel = label("r", 0);
    message.headRoleNameLabel = Object.assign(label("x"), { visible: false });
    message.activation = Object.assign(mk("UMLActivationView"), {
      left: 100,
      top: 100,
      width: 14,
      height: 30,
    });
    diagram.selectedViews = [message];
    const g = geometryOf(diagram);
    expect(g.selected).toBe(1);
    expect(g.nodes.length).toBe(before + 2);
    expect(g.nodes.filter((n) => n.edge === message._id)).toHaveLength(1);
    expect(g.nodes.filter((n) => n.group !== undefined)).toHaveLength(1);
    diagram.selectedViews = [];
    expect(geometryOf(diagram).selected).toBeUndefined();
  });
});

describe("placement for #38", () => {
  it("puts a use case only reached through another secondary one beside it", async () => {
    const built = await build({
      kind: "usecase",
      spec: {
        system: "S",
        actors: ["A"],
        useCases: ["Base", "Leaf", "Mid"],
        relations: [
          { from: "A", to: "Base" },
          { from: "Base", to: "Mid", type: "include" },
          { from: "Mid", to: "Leaf", type: "include" },
        ],
      },
    });
    const [base, mid, leaf] = ["Base", "Mid", "Leaf"].map((k) =>
      get(built.ids[k]!.view),
    );
    expect(mid!.left).toBeGreaterThan(base!.left);
    expect(leaf!.left).toBe(mid!.left);
  });

  it("draws a mind map of a lone root", async () => {
    const built = await build({
      kind: "mindmap",
      spec: { root: { name: "R" } },
    });
    expect(get(built.ids.R!.view).width).toBeGreaterThanOrEqual(80);
  });
});
