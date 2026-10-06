import { beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import type { Element, View } from "../../../src/types.js";
import { allRules, lintViewpoint } from "../../../src/viewpoints/lint.js";
import { MARK_TAG } from "../../../src/viewpoints/mark.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";
import { KIOSK } from "./fixtures.js";

// Issue #42: a diagram keeps to the viewpoint it declares.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;

beforeEach(() => {
  env = installMockApp();
});

interface Finding {
  rule: string;
  severity: string;
  message: string;
  viewpoint: string | null;
  ids: string[];
  suggest?: { viewpoint: string; kind?: string; count?: number }[];
}
interface Linted {
  diagrams: number;
  count: number;
  counts: Record<string, number>;
  findings: Finding[];
}

async function build(body: Record<string, unknown>) {
  return ok<{
    diagram: { _id: string };
    ids: Record<string, { model: string; view: string }>;
    viewpoint?: { name: string; conforms: boolean; findings: unknown[] };
  }>(ep("/build_diagram"), { result: "ids", ...body });
}

const lint = (scope: string, more: Record<string, unknown> = {}) =>
  ok<Linted>(ep("/viewpoint_lint"), { scope, ...more });

/** Declares `viewpoint` on a diagram by hand, as a bare name. */
async function declare(diagram: string, viewpoint: string) {
  await ok(ep("/add_tag"), {
    ref: diagram,
    name: MARK_TAG,
    kind: "string",
    value: viewpoint,
    hidden: true,
  });
}

const rules = (l: Linted) => l.findings.map((f) => f.rule);

const CLASSES = {
  kind: "class",
  spec: {
    classes: [{ name: "A" }, { name: "B" }],
    relations: [{ from: "A", to: "B", type: "association" }],
  },
};

describe("/viewpoint_lint", () => {
  it("passes a diagram that keeps to its viewpoint", async () => {
    const d = await build({ ...CLASSES, name: "Types", viewpoint: "code" });
    expect(d.viewpoint).toEqual({ name: "code", conforms: true, findings: [] });
    expect(await lint(d.diagram._id)).toMatchObject({ diagrams: 1, count: 0 });
  });

  it("V008: no viewpoint declared, an error under a strict profile; an unknown one too", async () => {
    const d = await build({ ...CLASSES, name: "Types" });
    expect(d.viewpoint).toBeUndefined();
    const loose = await lint(d.diagram._id);
    expect(loose.findings).toEqual([
      expect.objectContaining({
        rule: "V008",
        severity: "warning",
        viewpoint: null,
      }),
    ]);
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    expect((await lint(d.diagram._id)).findings[0]!.severity).toBe("error");
    await ok(ep("/set_style_profile"), { reset: true });
    await declare(d.diagram._id, "poster");
    const unknown = await lint(d.diagram._id);
    expect(unknown.findings[0]).toMatchObject({
      rule: "V008",
      viewpoint: "poster",
      message: expect.stringMatching(/not in the catalogue/),
    });
  });

  it("V009 and V001: a kind the viewpoint is not drawn as, and elements outside it", async () => {
    const d = await build({ ...CLASSES, name: "Types" });
    await declare(d.diagram._id, "lifecycle");
    const l = await lint(d.diagram._id);
    expect(rules(l)).toEqual(["V001", "V009"]);
    expect(l.findings[0]!.message).toMatch(
      /^2 UMLClass, 1 UMLAssociation lie outside the lifecycle viewpoint/,
    );
    expect(l.findings[0]!.suggest).toEqual([{ viewpoint: "code" }]);
    const tie = await build({
      kind: "class",
      name: "Tie",
      spec: { classes: [{ name: "Z" }, { name: "Y", kind: "interface" }] },
    });
    await declare(tie.diagram._id, "data");
    expect((await lint(tie.diagram._id)).findings[0]!.message).toMatch(
      /^1 UMLClass, 1 UMLInterface lie outside/,
    );
    expect(l.findings[1]!.suggest).toEqual([
      { viewpoint: "lifecycle", kind: "statemachine" },
    ]);
  });

  it("V002: elements of several viewpoints on one diagram, with the split", async () => {
    const d = await build({ ...CLASSES, name: "Mixed", viewpoint: "code" });
    await ok(ep("/create_element_with_view"), {
      type: "UMLActor",
      diagram: d.diagram._id,
      name: "Clerk",
      x: 400,
      y: 40,
    });
    const l = await lint(d.diagram._id);
    const mixed = l.findings.find((f) => f.rule === "V002")!;
    expect(mixed.suggest).toEqual([
      { viewpoint: "code", count: 2 },
      { viewpoint: "context", count: 1 },
    ]);
    expect(rules(l)).toContain("V001");
  });

  it("V005: a context view showing the system's inside", async () => {
    const d = await build({
      kind: "c4",
      name: "Context",
      viewpoint: "context",
      spec: {
        elements: [
          { id: "u", name: "User", type: "person" },
          { id: "s", name: "Shop", type: "system" },
          { id: "a", name: "App", type: "container" },
        ],
        relations: [{ from: "u", to: "s", label: "Uses" }],
      },
    });
    const l = await lint(d.diagram._id);
    expect(rules(l)).toEqual(["V005"]);
    expect(l.findings[0]!.message).toMatch(/1 C4Container$/);
    expect(d.viewpoint!.conforms).toBe(false);
  });

  it("V006: a default name or a missing legend; a hand-written legend counts", async () => {
    const d = await build({
      kind: "c4",
      name: "C4Diagram1",
      spec: { elements: [{ name: "User", type: "person" }] },
    });
    await declare(d.diagram._id, "container");
    const l = await lint(d.diagram._id);
    expect(l.findings[0]).toMatchObject({
      rule: "V006",
      message:
        "The container viewpoint requires title and legend, which the diagram lacks",
    });
    await ok(ep("/update_element"), {
      ref: d.diagram._id,
      field: "name",
      value: "Platform containers",
    });
    await ok(ep("/create_element_with_view"), {
      type: "Note",
      diagram: d.diagram._id,
      x: 10,
      y: 300,
    });
    const note = (get(d.diagram._id).ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLNoteView",
    )!;
    await ok(ep("/update_element"), {
      ref: note._id,
      field: "text",
      value: "legend: blue is ours",
    });
    expect((await lint(d.diagram._id)).count).toBe(0);
  });

  it("V003: a runtime view with no message, an unlabelled first one, or one from the middle", async () => {
    const seq = (messages: unknown[], name: string) =>
      build({
        kind: "sequence",
        name,
        viewpoint: "runtime",
        spec: { participants: ["A", "B", "C"], messages },
      });
    const none = await seq([], "Quiet");
    const unlabelled = await seq([{ from: "A", to: "B", text: "" }], "Mute");
    const middle = await seq([{ from: "B", to: "C", text: "go()" }], "Middle");
    // The loop draws the sender of the first message leftmost; moved by
    // hand, the scenario starts in the middle.
    const lifeline = (get(middle.diagram._id).ownedViews as View[]).find(
      (v) => v.model?.name === "B",
    )!;
    await ok(ep("/update_element"), {
      ref: lifeline._id,
      field: "left",
      value: 900,
    });
    const good = await seq([{ from: "A", to: "B", text: "go()" }], "Good");
    const message = async (id: string) =>
      (await lint(id)).findings.map((f) => f.message);
    expect(await message(none.diagram._id)).toEqual([
      "The runtime view has no clear initiator: it shows no message, so nothing starts the scenario",
    ]);
    expect(await message(unlabelled.diagram._id)).toEqual([
      "The runtime view has no clear initiator: its first message has no text, so the trigger is not said",
    ]);
    expect((await message(middle.diagram._id))[0]).toMatch(
      /first message comes from B, which is not the leftmost lifeline/,
    );
    expect(await message(good.diagram._id)).toEqual([]);
    const said = env.app.repository
      .getInstancesOf("UMLMessage")
      .find((m) => m.name === "" && (m.source as Element).name === "A")!;
    said.name = null;
    expect((await message(unlabelled.diagram._id))[0]).toMatch(/no text/);
    // A found message comes from outside: that is its trigger.
    const msg = env.app.repository
      .getInstancesOf("UMLMessage")
      .find((m) => m.name === "go()" && (m.source as Element).name === "B")!;
    msg.source = env.app.repository.getInstancesOf("UMLInteraction")[0]!;
    expect(await message(middle.diagram._id)).toEqual([]);
  });

  it("V003: an activity without an initial node; a communication view by its messages", async () => {
    const act = await build({
      kind: "activity",
      name: "Steps",
      viewpoint: "runtime",
      spec: { nodes: [{ id: "a", name: "Do" }], flows: [] },
    });
    expect((await lint(act.diagram._id)).findings[0]!.message).toMatch(
      /no initial node/,
    );
    await ok(ep("/build_model"), { spec: KIOSK });
    const derived = await ok<{ diagrams: { diagram: string }[] }>(
      ep("/derive_diagrams"),
      { scope: "Kiosk", kinds: ["communication"] },
    );
    for (const d of derived.diagrams) {
      expect((await lint(d.diagram)).count).toBe(0);
    }
  });

  it("V004: a lifecycle that belongs to no class", async () => {
    await ok(ep("/build_model"), { spec: KIOSK });
    const derived = await ok<{
      diagrams: { name: string; diagram: string; conforms: boolean }[];
    }>(ep("/derive_diagrams"), { scope: "Kiosk", viewpoints: ["lifecycle"] });
    expect(derived.diagrams.map((d) => [d.name, d.conforms])).toEqual([
      ["Order life", true],
      ["Shift", false],
    ]);
    const shift = await lint(derived.diagrams[1]!.diagram);
    expect(shift.findings[0]!.message).toBe(
      "The lifecycle belongs to UMLModel Kiosk, not to a class whose objects go through it",
    );
    // A machine moved out of everything belongs to nothing.
    const machine = get(derived.diagrams[1]!.diagram)._parent!;
    machine._parent = null;
    expect(
      (await lint(derived.diagrams[1]!.diagram)).findings[0]!.message,
    ).toMatch(/belongs to nothing/);
  });

  it("V007: more elements, or more lifelines, than the viewpoint holds", async () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => ({ name: `P${i}` }));
    const big = await build({
      kind: "package",
      name: "Big",
      viewpoint: "component",
      spec: { packages: twentyOne },
    });
    expect((await lint(big.diagram._id)).findings[0]).toMatchObject({
      rule: "V007",
      message: "21 elements, more than the 20 a component view holds",
    });
    const people = Array.from({ length: 13 }, (_, i) => `L${i}`);
    const crowd = await build({
      kind: "sequence",
      name: "Crowd",
      viewpoint: "runtime",
      spec: {
        participants: people,
        messages: [{ from: "L0", to: "L1", text: "go()" }],
      },
    });
    expect((await lint(crowd.diagram._id)).findings[0]).toMatchObject({
      rule: "V007",
      message: "13 lifelines, more than the 12 a scenario stays readable with",
      suggest: [{ viewpoint: "runtime", kind: "activity" }],
    });
  });

  it("reads a diagram of no kind it builds, and one without a name, without failing", () => {
    const odd = create("UMLDiagram") as Element;
    const tag = create("Tag") as Element;
    Object.assign(tag, { name: MARK_TAG, value: "code", _parent: odd });
    Object.assign(odd, { tags: [tag], name: null, ownedViews: [] });
    const found = lintViewpoint(odd, allRules(), { strict: false });
    expect(found.map((f) => [f.rule, f.message])).toEqual([
      [
        "V009",
        "A UMLDiagram diagram cannot show the code viewpoint, which is drawn as class",
      ],
      ["V006", "The code viewpoint requires title, which the diagram lacks"],
    ]);
  });

  it("checks every diagram under a scope, with rules turned off or reweighted, most severe first", async () => {
    await build({ ...CLASSES, name: "One" });
    const two = await build({ ...CLASSES, name: "Two" });
    await declare(two.diagram._id, "lifecycle");
    const all = await ok<Linted>(ep("/viewpoint_lint"), {});
    expect(all.diagrams).toBeGreaterThanOrEqual(2);
    expect(all.findings[0]!.severity).toBe("error");
    const some = await ok<Linted>(ep("/viewpoint_lint"), {
      rules: { V001: "off", "no-viewpoint": "info", V009: "warning" },
      limit: 1,
    });
    expect(rules(some)).toEqual(["V009"]);
    expect(some).toMatchObject({ truncated: true, counts: { error: 0 } });
    await fails(
      ep("/viewpoint_lint"),
      { rules: { V999: "off" } },
      "INVALID_ARGUMENT",
      /no rule V999/,
    );
    await fails(ep("/viewpoint_lint"), { scope: "Nowhere" }, "NOT_FOUND");
    const one = await ok<Linted>(ep("/viewpoint_lint"), {
      diagram: two.diagram._id,
    });
    expect(one.diagrams).toBe(1);
    // An element that owns nothing holds no diagram.
    const tag = (get(two.diagram._id).tags as Element[])[0]!;
    expect(await lint(tag._id)).toMatchObject({ diagrams: 0, count: 0 });
    const view = (get(two.diagram._id).ownedViews as View[])[0]!;
    expect(await lint(view._id)).toMatchObject({ diagrams: 0, count: 0 });
  });
});
