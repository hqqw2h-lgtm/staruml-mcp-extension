import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";
import { decodePng, inkIn, type Pixels } from "./png.js";

// Issue #34: what the ThingsBoard validation found drawn wrong, checked on
// StarUML 7.1.1's own rendering.

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string | null; view: string }>;
  edges: { key: string; model: string | null; view: string }[];
  layout: string;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GEOMETRY = ["left", "top", "width", "height"];

async function element<T = Record<string, unknown>>(
  ref: string,
  fields: string[],
): Promise<T> {
  const res = await call<T>("/get_element_by_id", { ref, fields });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data;
}

const box = (ref: string) => element<Box>(ref, GEOMETRY);
const refOf = (value: unknown) => (value as { $ref: string }).$ref;

async function built(body: Record<string, unknown>): Promise<Built> {
  const res = await call<Built>("/build_diagram", body);
  expect(res.success, JSON.stringify(res).slice(0, 800)).toBe(true);
  return res.data;
}

async function png(diagram: string): Promise<Pixels> {
  const res = await call<{ base64: string }>("/export_diagram", {
    diagram,
    background: "#ffffff",
  });
  expect(res.success, JSON.stringify(res).slice(0, 400)).toBe(true);
  return decodePng(Buffer.from(res.data.base64, "base64"));
}

/**
 * Where diagram point (0, 0) lands in the export: getImageData draws from
 * the bounding box of every view less 10 (BOUNDING_BOX_EXPAND,
 * engine/diagram-export.js in 7.1.1), at one pixel per unit.
 */
function origin(boxes: Box[]): { x: number; y: number } {
  return {
    x: 10 - Math.min(...boxes.map((b) => b.left)),
    y: 10 - Math.min(...boxes.map((b) => b.top)),
  };
}

const intersects = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

describeLive("issue #34 rendering", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("draws an interface's operations and nests classes in their package", async () => {
    const data = await built({
      kind: "class",
      name: "Ports",
      spec: {
        packages: ["Rules"],
        classes: [
          {
            name: "TbNode",
            kind: "interface",
            package: "Rules",
            operations: [
              "+init(ctx: TbContext): void",
              "+onMsg(ctx: TbContext, msg: TbMsg): void",
              "+destroy(): void",
            ],
          },
          { name: "Filter", package: "Rules", operations: ["+test(): bool"] },
          { name: "Outside" },
        ],
        relations: [{ from: "Filter", to: "TbNode", type: "realization" }],
      },
    });
    expect(data.layout).toBe("placed");
    const view = await element<Box & { suppressOperations: boolean }>(
      data.ids.TbNode!.view,
      [...GEOMETRY, "suppressOperations", "containerView"],
    );
    expect(view.suppressOperations).toBe(false);
    const pkg = await box(data.ids.Rules!.view);
    for (const name of ["TbNode", "Filter"]) {
      const v = await element<Box & { containerView: { $ref: string } }>(
        data.ids[name]!.view,
        [...GEOMETRY, "containerView"],
      );
      expect(refOf(v.containerView)).toBe(data.ids.Rules!.view);
      expect(v.left).toBeGreaterThanOrEqual(pkg.left);
      expect(v.top).toBeGreaterThan(pkg.top);
      expect(v.left + v.width).toBeLessThanOrEqual(pkg.left + pkg.width);
      expect(v.top + v.height).toBeLessThanOrEqual(pkg.top + pkg.height);
      const model = await element<{ _parent: string }>(data.ids[name]!.model!, [
        "_parent",
      ]);
      expect(model._parent).toBe(data.ids.Rules!.model);
    }
    const outside = await box(data.ids.Outside!.view);
    const image = await png(data.diagram._id);
    const o = origin([pkg, outside]);
    // Three operation lines below the name compartment carry ink; an
    // interface drawn with suppressed operations leaves that band blank.
    const ops = inkIn(image, {
      x: view.left + o.x + 4,
      y: view.top + o.y + 40,
      width: view.width - 8,
      height: view.height - 44,
    });
    expect(ops).toBeGreaterThan(150);
  });

  it("sizes the sequence frame to every lifeline and keeps guards off message labels", async () => {
    const participants = [
      "Device",
      "Transport",
      "Rule",
      "Actor",
      "Queue",
      "Db",
    ];
    const data = await built({
      kind: "sequence",
      name: "Telemetry",
      spec: {
        participants,
        messages: [
          { from: "Device", to: "Transport", text: "publish(telemetry)" },
          { from: "Transport", to: "Rule", text: "process(msg)" },
          { from: "Rule", to: "Actor", text: "tell(msg)" },
          { from: "Actor", to: "Queue", text: "push(msg)" },
          { from: "Queue", to: "Db", text: "save(ts, values)" },
          { from: "Db", to: "Device", text: "ack", kind: "reply" },
        ],
        fragments: [
          {
            operator: "alt",
            guard: "device active",
            operands: ["else"],
            from: 1,
            to: 4,
          },
          { operator: "loop", guard: "each value", from: 4, to: 4 },
        ],
      },
    });
    const diagram = await element<{ ownedViews: { $ref: string }[] }>(
      data.diagram._id,
      ["ownedViews"],
    );
    let frame: Box | null = null;
    for (const v of diagram.ownedViews) {
      const view = await element<Box & { _type: string }>(refOf(v), GEOMETRY);
      if (view._type === "UMLFrameView") frame = view;
    }
    expect(frame).not.toBeNull();
    const last = await box(data.ids.Db!.view);
    expect(frame!.left + frame!.width).toBeGreaterThan(last.left + last.width);
    expect(frame!.top + frame!.height).toBeGreaterThan(last.top + last.height);
    const image = await png(data.diagram._id);
    // The frame is the outermost view: the image is its box, 10 units
    // around it and getImageData's 30 more.
    expect(image.width).toBe(frame!.width + 50);
    expect(image.height).toBe(frame!.height + 50);
    const right = frame!.left + frame!.width + 10 - frame!.left;
    let ink = 0;
    for (let y = 20; y < frame!.height; y++) {
      if (inkIn(image, { x: right - 1, y, width: 3, height: 1 }) > 0) ink++;
    }
    expect(ink).toBeGreaterThan(frame!.height * 0.9);

    // Each operand's guard label clears every message's name label.
    const labels: Box[] = [];
    for (const edge of data.edges) {
      const e = await element<{ nameLabel: { $ref: string } }>(edge.view, [
        "nameLabel",
      ]);
      labels.push(await box(refOf(e.nameLabel)));
    }
    const guards: Box[] = [];
    for (const key of ["fragment 0", "fragment 1"]) {
      const f = await element<{ operandCompartment: { $ref: string } }>(
        data.ids[key]!.view,
        ["operandCompartment"],
      );
      const c = await element<{ subViews: { $ref: string }[] }>(
        refOf(f.operandCompartment),
        ["subViews"],
      );
      for (const operand of c.subViews) {
        const o = await element<{ guardLabel: { $ref: string } }>(
          refOf(operand),
          ["guardLabel"],
        );
        const g = await box(refOf(o.guardLabel));
        if (g.width > 0) guards.push(g);
      }
    }
    expect(guards.length).toBe(3);
    for (const g of guards) {
      for (const l of labels) expect(intersects(g, l)).toBe(false);
    }

    // Fragments and operands are named, so StarUML's rules pass.
    const problems = await call<{
      problems: { ruleId: string; _type: string }[];
    }>("/validate_model", {});
    expect(
      problems.data.problems.filter((p) =>
        ["UMLCombinedFragment", "UMLInteractionOperand"].includes(p._type),
      ),
    ).toEqual([]);
  });

  it("sizes states to their names and keeps transition labels apart", async () => {
    const data = await built({
      kind: "statemachine",
      name: "Alarm",
      spec: {
        states: [
          { id: "start", type: "initial" },
          "Active Unacknowledged",
          "Active Acknowledged",
          "Cleared Unacknowledged",
          { id: "end", type: "final" },
        ],
        transitions: [
          { from: "start", to: "Active Unacknowledged", trigger: "raise" },
          {
            from: "Active Unacknowledged",
            to: "Active Acknowledged",
            trigger: "ack",
            effect: "notify(user)",
          },
          {
            from: "Active Unacknowledged",
            to: "Cleared Unacknowledged",
            trigger: "clear",
            guard: "severity < threshold",
          },
          { from: "Active Acknowledged", to: "end", trigger: "clear" },
          { from: "Cleared Unacknowledged", to: "end", trigger: "ack" },
        ],
      },
    });
    const states: Box[] = [];
    for (const name of [
      "Active Unacknowledged",
      "Active Acknowledged",
      "Cleared Unacknowledged",
    ]) {
      const s = await box(data.ids[name]!.view);
      // At least the width of the name at StarUML's 13px font.
      expect(s.width).toBeGreaterThanOrEqual(5.5 * name.length);
      states.push(s);
    }
    const labels: Box[] = [];
    for (const edge of data.edges) {
      const e = await element<{ nameLabel: { $ref: string } }>(edge.view, [
        "nameLabel",
      ]);
      const l = await box(refOf(e.nameLabel));
      if (l.width > 0) labels.push(l);
    }
    for (const [i, a] of labels.entries()) {
      for (const b of labels.slice(i + 1)) expect(intersects(a, b)).toBe(false);
      for (const s of states) expect(intersects(a, s)).toBe(false);
    }
    const image = await png(data.diagram._id);
    expect(image.width).toBeGreaterThan(100);
  });

  it("shows reused elements by their plain names unless asked", async () => {
    await built({
      kind: "class",
      name: "Core",
      spec: {
        packages: ["Domain"],
        classes: [{ name: "Tenant", package: "Domain" }],
      },
    });
    const plain = await built({
      kind: "usecase",
      name: "Elsewhere",
      spec: { actors: ["Admin"], useCases: ["Manage"] },
    });
    expect(plain).toBeDefined();
    const again = await built({
      kind: "class",
      name: "Overview",
      spec: { classes: [{ name: "Tenant" }] },
    });
    const view = await element<{ showNamespace: boolean }>(
      again.ids.Tenant!.view,
      ["showNamespace"],
    );
    expect(view.showNamespace).toBe(false);
    const shown = await built({
      kind: "class",
      name: "Qualified",
      showNamespace: true,
      spec: { classes: [{ name: "Tenant" }] },
    });
    const qualified = await element<{ showNamespace: boolean }>(
      shown.ids.Tenant!.view,
      ["showNamespace"],
    );
    expect(qualified.showNamespace).toBe(true);
  });
});
