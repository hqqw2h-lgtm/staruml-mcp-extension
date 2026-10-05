import { beforeEach, describe, expect, it } from "vitest";
import { buildDiagramEndpoint } from "../../../src/handlers/build.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { ok } from "../support.js";

// Issue #34: what the ThingsBoard validation found drawn wrong.

let env: MockEnvironment;
const build = buildDiagramEndpoint(() => endpoints);
const get = (id: string) => env.app.repository.get(id)! as Element;

beforeEach(() => {
  env = installMockApp();
});

interface Op {
  path: string;
  body: Record<string, unknown>;
}
interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string | null; view: string }>;
  plan?: { ops: Op[] };
}

const opsOf = async (body: Record<string, unknown>) =>
  (await ok<Built>(build, { ...body, dryRun: true })).plan!.ops;

describe("class views", () => {
  it("shows an interface's operations and attributes, and an abstract class's operations", async () => {
    const data = await ok<Built>(build, {
      kind: "class",
      spec: {
        classes: [
          { name: "Port", kind: "interface", operations: ["send(): void"] },
          {
            name: "Typed",
            kind: "interface",
            attributes: ["a: int"],
            operations: ["b()"],
          },
          { name: "Base", kind: "abstract", operations: ["run()*"] },
          { name: "Plain" },
        ],
      },
    });
    expect(get(data.ids.Port!.view)).toMatchObject({
      suppressOperations: false,
      stereotypeDisplay: "label",
    });
    const port = await opsOf({
      kind: "class",
      spec: { classes: [{ name: "P", kind: "interface" }] },
    });
    expect(
      port.filter((o) => o.body.field === "suppressAttributes"),
    ).toHaveLength(0);
    const typed = await opsOf({
      kind: "class",
      spec: { classes: [{ name: "T", kind: "interface", attributes: ["a"] }] },
    });
    expect(typed.map((o) => o.body.field).filter(Boolean)).toEqual([
      "suppressOperations",
      "suppressAttributes",
    ]);
    expect(get(data.ids.Base!.view).suppressOperations).toBe(false);
  });

  it("sets view attributes again on upsert only where they differ", async () => {
    const request = {
      kind: "class",
      name: "D",
      upsert: true,
      spec: {
        classes: [{ name: "I", kind: "interface", operations: ["x()"] }],
      },
    };
    const data = await ok<Built>(build, request);
    expect(
      (await opsOf(request)).filter((o) => o.path === "/update_element"),
    ).toEqual([]);
    get(data.ids.I!.view).suppressOperations = true;
    expect(await opsOf(request)).toContainEqual({
      path: "/update_element",
      body: {
        ref: data.ids.I!.view,
        field: "suppressOperations",
        value: false,
      },
    });
  });

  it("draws classes inside their package's view, which holds them", async () => {
    const data = await ok<Built & { layout: string }>(build, {
      kind: "class",
      spec: {
        packages: ["P"],
        classes: [
          { name: "A", package: "P" },
          { name: "B", package: "P" },
          { name: "C" },
        ],
        relations: [{ from: "A", to: "B" }],
      },
    });
    const pkg = get(data.ids.P!.view);
    for (const name of ["A", "B"]) {
      const view = get(data.ids[name]!.view);
      expect(view.containerView).toBe(pkg);
      expect(get(data.ids[name]!.model!)._parent).toBe(get(data.ids.P!.model!));
      const n = view as unknown as Record<string, number>;
      const p = pkg as unknown as Record<string, number>;
      expect(n.left).toBeGreaterThanOrEqual(p.left!);
      expect(n.top).toBeGreaterThan(p.top!);
      expect(n.left! + n.width!).toBeLessThanOrEqual(p.left! + p.width!);
      expect(n.top! + n.height!).toBeLessThanOrEqual(p.top! + p.height!);
    }
    expect(get(data.ids.C!.view).containerView).toBeNull();
    // Format > Layout would move the classes out of the package's bounds.
    expect(data.layout).toBe("placed");
  });
});

describe("reused elements", () => {
  it("draws them without '(from Owner)' unless asked", async () => {
    await ok<Built>(build, {
      kind: "class",
      spec: { packages: ["Core"], classes: [{ name: "A", package: "Core" }] },
    });
    const plain = await ok<Built>(build, {
      kind: "class",
      name: "Elsewhere",
      spec: { classes: [{ name: "A" }] },
    });
    expect(get(plain.ids.A!.view).showNamespace).toBe(false);
    const ops = await opsOf({
      kind: "class",
      name: "Again",
      showNamespace: true,
      spec: { classes: [{ name: "A" }] },
    });
    expect(ops.some((o) => o.body.field === "showNamespace")).toBe(false);
  });

  it("leaves views that have no namespace line alone", async () => {
    await ok<Built>(build, {
      kind: "erd",
      spec: { entities: [{ name: "E" }] },
    });
    const ops = await opsOf({
      kind: "erd",
      name: "Again",
      spec: { entities: [{ name: "E" }] },
    });
    expect(ops.map((o) => o.path)).toContain("/create_view_of");
    expect(ops.some((o) => o.body.field === "showNamespace")).toBe(false);
  });
});

describe("sequence frame and fragments", () => {
  const spec = {
    participants: ["A", "B", "C", "D", "E", "F"],
    messages: [
      { from: "A", to: "F", text: "go" },
      { from: "F", to: "A", text: "back", kind: "reply" },
      { from: "A", to: "B", text: "more" },
    ],
    fragments: [
      { operator: "alt", guard: "ok", operands: ["else"], from: 0, to: 2 },
      { operator: "alt", guard: "ok", from: 2, to: 2 },
      { operator: "loop", from: 1, to: 1 },
      { operator: "par", operands: ["", "x"], from: 0, to: 0 },
    ],
  };

  it("sizes the frame to every lifeline and message", async () => {
    const data = await ok<Built>(build, {
      kind: "sequence",
      name: "Wide",
      spec,
    });
    const frame = (get(data.diagram._id).ownedViews as Element[]).find(
      (v) => v.constructor.name === "UMLFrameView",
    )! as unknown as Record<string, number>;
    const last = get(data.ids.F!.view) as unknown as Record<string, number>;
    expect(frame.left).toBe(8);
    expect(frame.left! + frame.width!).toBeGreaterThan(
      last.left! + last.width!,
    );
    expect(frame.top! + frame.height!).toBeGreaterThan(
      last.top! + last.height!,
    );
    // The lifelines sit below the frame's "sd" tab.
    expect(get(data.ids.A!.view).top).toBe(40);
  });

  it("names fragments and operands after their guards and operators", async () => {
    const data = await ok<Built>(build, { kind: "sequence", spec });
    const names = [0, 1, 2, 3].map((i) => {
      const model = get(data.ids[`fragment ${i}`]!.model!);
      return [
        model.name,
        (model.operands as Element[]).map((o) => [o.name, o.guard]),
      ];
    });
    expect(names).toEqual([
      [
        "ok",
        [
          ["ok", "ok"],
          ["else", "else"],
        ],
      ],
      ["ok 2", [["ok", "ok"]]],
      ["loop", [["loop", ""]]],
      [
        "par",
        [
          ["par", ""],
          ["par 2", ""],
          ["x", "x"],
        ],
      ],
    ]);
  });

  it("starts further operands between messages, unless there are too few", async () => {
    const plan = (
      await ok<Built>(build, { kind: "sequence", spec, dryRun: true })
    ).plan!;
    const divides = plan.ops.filter((o) => o.path === "/divide_fragment");
    // The alt over three messages divides at the second; the par over one
    // message keeps StarUML's equal split.
    expect(divides).toHaveLength(1);
  });

  it("resizes an existing frame only when it differs, and skips a diagram without one", async () => {
    const request = { kind: "sequence", name: "S", upsert: true, spec };
    const data = await ok<Built>(build, request);
    const resizes = async () =>
      (await opsOf(request)).filter((o) => o.path === "/resize_node");
    expect(await resizes()).toEqual([]);
    const diagram = get(data.diagram._id);
    const frame = (diagram.ownedViews as Element[]).find(
      (v) => v.constructor.name === "UMLFrameView",
    )!;
    frame.width = 100;
    expect(await resizes()).toEqual([
      {
        path: "/resize_node",
        body: expect.objectContaining({ ref: frame._id, left: 8, top: 8 }),
      },
    ]);
    // A frame of another diagram, and none of this one.
    frame.model = env.project;
    expect(await resizes()).toEqual([]);
  });
});

describe("state machines", () => {
  it("sizes states to their names and leaves transition labels room", async () => {
    const spec = {
      states: [
        { id: "i", type: "initial" },
        "Active Unacknowledged",
        "Cleared",
      ],
      transitions: [
        { from: "i", to: "Active Unacknowledged" },
        {
          from: "Active Unacknowledged",
          to: "Cleared",
          trigger: "clear",
          guard: "acknowledged",
          effect: "notify",
        },
      ],
    };
    const ops = await opsOf({ kind: "statemachine", spec });
    const state = ops.find((o) => o.body.name === "Active Unacknowledged")!;
    expect(
      (state.body.x2 as number) - (state.body.x as number),
    ).toBeGreaterThanOrEqual(7 * "Active Unacknowledged".length + 40);
    const label = 7 * "clear [acknowledged] / notify".length + 20;
    expect(ops.at(-1)).toEqual({
      path: "/layout_diagram",
      body: expect.objectContaining({
        fit: true,
        nodeSeparation: label,
        rankSeparation: 80,
      }),
    });
    const sideways = await opsOf({
      kind: "statemachine",
      direction: "LR",
      spec,
    });
    expect(sideways.at(-1)!.body).toMatchObject({ rankSeparation: label });
    expect(sideways.at(-1)!.body.nodeSeparation).toBeUndefined();
    const unlabelled = await opsOf({
      kind: "statemachine",
      spec: { states: ["A", "B"], transitions: [{ from: "A", to: "B" }] },
    });
    expect(unlabelled.at(-1)!.body.nodeSeparation).toBeUndefined();
  });
});
