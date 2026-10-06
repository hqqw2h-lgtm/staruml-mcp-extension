import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import {
  crosses,
  edgePoints,
  labelWidth,
  lintDiagram,
} from "../../../src/handlers/lint.js";
import { umlLint } from "../../../src/handlers/uml-lint.js";
import { endpoints } from "../../../src/routes.js";
import {
  create,
  installMockApp,
  type Element,
  type MockEnvironment,
  type View,
} from "../../mock/staruml.js";
import { fails, fullResults, invoke, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

const endpoint = (path: string) =>
  fullResults(endpoints.find((e) => e.path === path)!);

interface Finding {
  rule: string;
  name: string;
  severity: string;
  message: string;
  ids: string[];
  paths: (string | null)[];
  fix: string;
  autofix: { path: string; body: Record<string, unknown> } | null;
}

interface Linted {
  count: number;
  counts: { error: number; warning: number; info: number };
  truncated: boolean;
  findings: Finding[];
}

interface Created {
  view: { _id: string };
  model: { _id: string } | null;
}

async function node(
  name: string,
  x: number,
  y: number,
  w = 100,
  h = 50,
  type = "UMLClass",
): Promise<View> {
  const made = await ok<Created>(endpoint("/create_element_with_view"), {
    type,
    diagram: "Main",
    name,
    x,
    y,
    x2: x + w,
    y2: y + h,
    allowDuplicateNames: true,
  });
  return env.app.repository.get(made.view._id) as View;
}

async function edge(from: View, to: View): Promise<View> {
  const made = await ok<Created>(endpoint("/create_relationship"), {
    type: "UMLAssociation",
    tail: from._id,
    head: to._id,
    diagram: "Main",
  });
  return env.app.repository.get(made.view._id) as View;
}

const rules = (data: Linted) => data.findings.map((f) => f.rule);

describe("geometry helpers", () => {
  it("clips segments against a box shrunk by its border", () => {
    const box = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(crosses({ x: -10, y: 50 }, { x: 110, y: 50 }, box)).toBe(true);
    expect(crosses({ x: 50, y: -10 }, { x: 50, y: 110 }, box)).toBe(true);
    expect(crosses({ x: -10, y: 1 }, { x: 110, y: 1 }, box)).toBe(false);
    expect(crosses({ x: 1, y: -10 }, { x: 1, y: 110 }, box)).toBe(false);
    expect(crosses({ x: -10, y: -10 }, { x: -5, y: 200 }, box)).toBe(false);
    expect(crosses({ x: 200, y: 0 }, { x: 150, y: 100 }, box)).toBe(false);
    expect(crosses({ x: 0, y: 0 }, { x: 1, y: 1 }, { ...box, right: 3 })).toBe(
      false,
    );
    expect(labelWidth("ab\nabcd")).toBe(4 * 7 + 20);
  });

  it("reads an edge's drawn points, else runs centre to centre", async () => {
    const a = await node("A", 0, 0);
    const b = await node("B", 300, 0);
    const e = await edge(a, b);
    expect(edgePoints(e)).toEqual([
      { x: 50, y: 25 },
      { x: 350, y: 25 },
    ]);
    e.points = {
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
    };
    expect(edgePoints(e)).toHaveLength(3);
    e.points = { points: [{ x: 1, y: 2 }] };
    expect(edgePoints(e)).toHaveLength(2);
  });
});

describe("/lint_diagram", () => {
  it("finds every layout rule on a diagram that breaks them", async () => {
    const a = await node("A", 10, 10);
    const b = await node("B", 10, 10);
    const c = await node("C", 60, 40);
    const d = await node("D", -200, -5);
    const e = await node("E", 400, 300);
    const f = await node("F", 900, 300);
    const g = await node("G", 600, 290, 60, 60);
    await edge(e, f);
    await edge(a, c);
    await edge(d, g);
    await node("AVeryLongClassNameThatCannotFit", 1200, 600, 80, 40);
    const crowd = [];
    for (let i = 0; i < 7; i++) {
      crowd.push(
        await node(
          `K${i}`,
          1500 + (i % 3) * 40,
          1500 + Math.floor(i / 3) * 40,
          30,
          30,
        ),
      );
    }
    const data = await ok<Linted>(lintDiagram, { diagram: "Main" });
    expect(new Set(rules(data))).toEqual(
      new Set(["L001", "L002", "L003", "L004", "L005", "L006", "L007"]),
    );
    expect(data.findings[0]).toMatchObject({
      rule: "L001",
      name: "stacked",
      severity: "error",
      ids: [a._id, b._id],
      paths: ["Model/A@Model/Main", "Model/B@Model/Main"],
      autofix: {
        path: "/layout_diagram",
        body: { diagram: env.mainDiagram._id },
      },
    });
    const overlap = data.findings.find((x) => x.rule === "L002")!;
    expect(overlap.autofix).toEqual({
      path: "/move_views",
      body: { refs: [c._id], dx: 70, dy: 0 },
    });
    expect(
      data.findings.filter((x) => x.rule === "L002").map((x) => x.ids),
    ).toEqual([
      [a._id, c._id],
      [b._id, c._id],
    ]);
    expect(data.findings.find((x) => x.rule === "L003")!.autofix).toEqual({
      path: "/move_views",
      body: { refs: [d._id], dx: 220, dy: 25 },
    });
    expect(data.findings.find((x) => x.rule === "L004")!.ids[1]).toBe(g._id);
    expect(data.findings.find((x) => x.rule === "L005")!.autofix).toMatchObject(
      {
        path: "/resize_node",
        body: { width: 31 * 7 + 20, height: 40 },
      },
    );
    expect(
      data.findings.find((x) => x.rule === "L007")!.autofix!.body,
    ).toMatchObject({ nodeSeparation: 60, rankSeparation: 80 });
    expect(data.counts.error).toBe(1);
    expect(data.count).toBe(data.findings.length);

    const limited = await ok<Linted>(lintDiagram, {
      diagramId: env.mainDiagram._id,
      rules: ["overlap", "L003"],
      limit: 1,
    });
    expect(limited).toMatchObject({ count: 3, truncated: true });
    expect(rules(limited)).toEqual(["L002"]);
  });

  it("leaves alone what is meant to overlap, hidden views and frames", async () => {
    const pkg = await node("Pkg", 0, 0, 400, 300, "UMLPackage");
    const inner = await node("Inner", 50, 50);
    const lane = await node("Lane", 30, 30, 100, 100);
    // An area view: its class name marks it as one.
    Object.setPrototypeOf(
      lane,
      (type as Record<string, { prototype: object }>).UMLSwimlaneView!
        .prototype,
    );
    const outside = await node("Out", 600, 60);
    await edge(inner, outside);
    const hidden = await node("Hidden", 50, 50);
    hidden.visible = false;
    const nested = await node("Nested", 1000, 1000);
    nested.containerView = pkg;
    const holder = await node("Holder", 990, 990, 30, 30);
    nested.containerView = holder;
    const frame = await node("Frame", 50, 50);
    frame.model = env.mainDiagram;
    const actor = await node(
      "ActorWithAVeryLongName",
      900,
      0,
      40,
      60,
      "UMLActor",
    );
    const unnamed = await node("", 700, 400, 20, 20);
    (unnamed.model as Element).name = "";
    const data = await ok<Linted>(lintDiagram, { diagram: "Main" });
    const about = (id: string) =>
      data.findings.filter((f) => f.ids.includes(id)).map((f) => f.rule);
    expect(about(inner._id)).toEqual([]);
    expect(about(pkg._id)).toEqual([]);
    expect(about(lane._id)).toEqual([]);
    expect(about(hidden._id)).toEqual([]);
    expect(about(frame._id)).toEqual([]);
    expect(about(nested._id).filter((r) => r === "L002")).toEqual([]);
    expect(about(actor._id)).toEqual(["L006"]);
    expect(about(unnamed._id)).toEqual(["L006"]);
  });

  it("skips lifelines a message passes and ends reached through sub-views", async () => {
    const a = await node("A", 0, 0);
    const b = await node("B", 400, 0);
    const life = await node("Life", 200, 0, 50, 50);
    Object.setPrototypeOf(
      life,
      (type as Record<string, { prototype: object }>).UMLSeqLifelineView!
        .prototype,
    );
    const e = await edge(a, b);
    const block = await node("Block", 200, 100, 50, 50);
    const c = await node("C", 0, 100);
    const d = await node("D", 400, 100);
    const sub = create<View>("UMLNameCompartmentView");
    sub._parent = c;
    const e2 = await edge(c, d);
    e2.tail = sub;
    const data = await ok<Linted>(lintDiagram, {
      diagram: "Main",
      rules: ["L004", "L006"],
    });
    expect(
      data.findings.filter((f) => f.rule === "L004").map((f) => f.ids),
    ).toEqual([[e2._id, block._id]]);
    expect(data.findings.find((f) => f.ids.includes(c._id))).toBeUndefined();
    void e;
  });

  it("lints the current diagram by default and checks its arguments", async () => {
    await fails(lintDiagram, {}, "NOT_FOUND", "Diagram not found: @current");
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    expect(await ok<Linted>(lintDiagram, {})).toMatchObject({
      count: 0,
      truncated: false,
      findings: [],
    });
    await fails(
      lintDiagram,
      { rules: ["nope"] },
      "INVALID_ARGUMENT",
      /^rules: no rule nope; rules are L001 stacked, /,
    );
    await fails(lintDiagram, { diagram: "Model" }, "NOT_FOUND");
  });

  it("answers any request with findings or a stable error (fuzz)", async () => {
    await node("A", 0, 0);
    await node("B", 10, 10);
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.constantFrom("diagram", "rules", "limit", "diagramId", "id", "x"),
          fc.oneof(
            fc.string(),
            fc.integer({ min: -5, max: 2000 }),
            fc.array(fc.constantFrom("L001", "overlap", "dense", "nope", "")),
            fc.constant(null),
            fc.constant("Main"),
          ),
        ),
        async (body) => {
          const res = await invoke(lintDiagram, body);
          if (!res.success) {
            expect([
              "INVALID_ARGUMENT",
              "NOT_FOUND",
              "AMBIGUOUS_REF",
            ]).toContain(res.code);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("stays well-formed on any arrangement of boxes (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            x: fc.integer({ min: -100, max: 900 }),
            y: fc.integer({ min: -100, max: 900 }),
            w: fc.integer({ min: 1, max: 300 }),
            h: fc.integer({ min: 1, max: 300 }),
          }),
          { maxLength: 12 },
        ),
        fc.integer({ min: 1, max: 20 }),
        async (boxes, limit) => {
          env = installMockApp();
          const views = [];
          for (const [i, b] of boxes.entries()) {
            views.push(await node(`N${i}`, b.x, b.y, b.w, b.h));
          }
          for (let i = 1; i < views.length; i += 2) {
            await edge(views[i - 1]!, views[i]!);
          }
          const data = await ok<Linted>(lintDiagram, {
            diagram: "Main",
            limit,
          });
          expect(data.findings.length).toBeLessThanOrEqual(limit);
          expect(data.count).toBe(
            data.counts.error + data.counts.warning + data.counts.info,
          );
          for (const f of data.findings) {
            expect(f.ids.length).toBe(f.paths.length);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

/** A class with members, through the endpoints. */
async function cls(
  name: string,
  parent = "Model",
  extra: Record<string, unknown> = {},
): Promise<string> {
  const made = await ok<{ _id: string }>(endpoint("/create_element"), {
    type: "UMLClass",
    parent,
    name,
    allowDuplicateNames: true,
    ...extra,
  });
  return made._id;
}

const get = (id: string) => env.app.repository.get(id)!;

interface UmlFinding {
  rule: string;
  severity: string;
  id: string;
  path: string | null;
  message: string;
  fix: string;
}

interface UmlLinted {
  count: number;
  counts: { error: number; warning: number; info: number };
  truncated: boolean;
  findings: UmlFinding[];
}

describe("/uml_lint", () => {
  it("reports class-model mistakes with ids, paths and fixes", async () => {
    const order = await cls("Order");
    await ok(endpoint("/add_attribute"), { ref: order, name: "total" });
    await ok(endpoint("/add_attribute"), {
      ref: order,
      name: "id",
      type: "long",
    });
    const shape = await cls("Shape", "Model", {
      properties: { isAbstract: true },
    });
    const circle = await cls("Circle");
    const base = await cls("Base", "Model", {
      properties: { isAbstract: true },
    });
    await ok(endpoint("/create_relationship"), {
      type: "UMLGeneralization",
      tail: circle,
      head: base,
    });
    const payable = await ok<{ _id: string }>(endpoint("/create_element"), {
      type: "UMLInterface",
      parent: "Model",
      name: "Payable",
    });
    const used = await ok<{ _id: string }>(endpoint("/create_element"), {
      type: "UMLInterface",
      parent: "Model",
      name: "Used",
    });
    await ok(endpoint("/create_relationship"), {
      type: "UMLInterfaceRealization",
      tail: order,
      head: used._id,
    });
    const plain = await ok<{ model: { _id: string } }>(
      endpoint("/create_relationship"),
      { type: "UMLAssociation", tail: order, head: circle },
    );
    const half = await ok<{ model: { _id: string } }>(
      endpoint("/create_relationship"),
      {
        type: "UMLAssociation",
        tail: order,
        head: circle,
        tailEnd: { multiplicity: "1", navigable: "navigable" },
      },
    );
    await ok(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: order,
      head: circle,
      tailEnd: { multiplicity: "1" },
      headEnd: { multiplicity: "*", navigable: "navigable" },
    });
    // An attribute filed outside a classifier's attributes is not a member.
    await ok(endpoint("/create_element"), {
      type: "UMLAttribute",
      parent: "Model",
      field: "ownedElements",
      name: "loose",
    });
    const data = await ok<UmlLinted>(umlLint, { rules: { naming: "off" } });
    const byRule = (rule: string) =>
      data.findings.filter((f) => f.rule === rule).map((f) => f.id);
    expect(byRule("U001")).toEqual([plain.model._id, half.model._id]);
    expect(byRule("U002")).toEqual([plain.model._id]);
    expect(byRule("U003")).toEqual([
      (get(order).attributes as Element[])[0]!._id,
    ]);
    expect(byRule("U005")).toEqual([shape]);
    expect(byRule("U006")).toEqual([payable._id]);
    const total = data.findings.find((f) => f.rule === "U003")!;
    expect(total).toMatchObject({
      severity: "warning",
      path: "Model/Order.total",
      message: 'The attribute "total" of "Order" has no type',
    });
    expect(data.findings.find((f) => f.rule === "U001")!.message).toContain(
      "no multiplicity on either end",
    );
    expect(
      data.findings.filter((f) => f.rule === "U001")[1]!.message,
    ).toContain("an end without multiplicity");
    const navigability = await ok<UmlLinted>(umlLint, {
      rules: { naming: "off", U001: "off" },
    });
    expect(navigability.findings.map((f) => f.rule)).not.toContain("U001");
    expect(navigability.findings.map((f) => f.rule)).toContain("U002");
  });

  it("finds dangling relationships", async () => {
    const a = await cls("A");
    const b = await cls("B");
    const dep = await ok<{ model: { _id: string } }>(
      endpoint("/create_relationship"),
      { type: "UMLDependency", tail: a, head: b },
    );
    const assoc = await ok<{ model: { _id: string } }>(
      endpoint("/create_relationship"),
      { type: "UMLAssociation", tail: a, head: b },
    );
    const dep2 = await ok<{ model: { _id: string } }>(
      endpoint("/create_relationship"),
      { type: "UMLDependency", tail: a, head: b },
    );
    get(dep.model._id).target = null;
    get(dep2.model._id).source = create("UMLClass");
    (get(assoc.model._id).end2 as Element).reference = null;
    const data = await ok<UmlLinted>(umlLint, {
      rules: { U001: "off", U002: "off", naming: "off" },
    });
    expect(data.findings.map((f) => [f.rule, f.severity, f.id])).toEqual([
      ["U004", "error", dep.model._id],
      ["U004", "error", dep2.model._id],
      ["U004", "error", assoc.model._id],
    ]);
    expect(data.findings[0]!.message).toContain("missing its target");
    expect(data.findings[1]!.message).toContain("missing its source");
  });

  it("checks sequence messages against the receiver's operations", async () => {
    const built = await ok<{
      ids: Record<string, { model: string }>;
      edges: { model: string }[];
    }>(endpoint("/build_diagram"), {
      kind: "sequence",
      spec: {
        participants: ["Client", "Shop", "Anon"],
        messages: [
          { from: "Client", to: "Shop", text: "pay(amount)" },
          { from: "Client", to: "Shop", text: "refund", kind: "async" },
          { from: "Shop", to: "Client", text: "ok", kind: "reply" },
          { from: "Client", to: "Shop", text: "inherited()" },
          { from: "Client", to: "Anon", text: "whatever" },
          { from: "Client", to: "Shop", text: "signed" },
          { from: "Client", to: "Shop", text: "" },
        ],
      },
    });
    const shop = await cls("ShopService");
    const parent = await cls("Base");
    await ok(endpoint("/add_operation"), { ref: shop, name: "pay" });
    await ok(endpoint("/add_operation"), { ref: parent, name: "inherited" });
    await ok(endpoint("/create_relationship"), {
      type: "UMLGeneralization",
      tail: shop,
      head: parent,
    });
    // A generalization cycle is not followed forever.
    await ok(endpoint("/create_relationship"), {
      type: "UMLGeneralization",
      tail: parent,
      head: shop,
    });
    const role = create("UMLAttribute");
    role.type = get(shop);
    get(built.ids.Shop!.model).represent = role;
    const signed = get(built.edges[5]!.model);
    signed.signature = (get(shop).operations as Element[])[0];
    const data = await ok<UmlLinted>(umlLint, {
      rules: { naming: "off", U009: "off", U010: "off" },
    });
    const flagged = data.findings.filter((f) => f.rule === "U007");
    expect(flagged.map((f) => f.id)).toEqual([built.edges[1]!.model]);
    expect(flagged[0]!.fix).toBe(
      "Add the operation (/add_operation {ref: 'Model/ShopService', name: 'refund'}) or rename the message.",
    );
  });

  it("checks use cases, state machines and ERD entities", async () => {
    await ok(endpoint("/build_diagram"), {
      kind: "usecase",
      spec: {
        actors: ["User"],
        useCases: ["Log in", "Audit", "Check", "Remind"],
        relations: [
          { from: "User", to: "Log in" },
          { from: "Log in", to: "Check", type: "include" },
          { from: "Remind", to: "Log in", type: "extend" },
        ],
      },
    });
    // StarUML files a state machine diagram under a UMLStateMachine; the
    // mock factory makes no such container on its own.
    for (const name of ["Done", "Loop"]) {
      await ok(endpoint("/create_element"), {
        type: "UMLStateMachine",
        parent: "Model",
        name,
      });
    }
    await ok(endpoint("/build_diagram"), {
      kind: "statemachine",
      parent: "Done",
      name: "Complete",
      spec: {
        states: [
          { id: "s", type: "initial" },
          { id: "A" },
          { id: "e", type: "final" },
        ],
        transitions: [
          { from: "s", to: "A" },
          { from: "A", to: "e" },
        ],
      },
    });
    await ok(endpoint("/build_diagram"), {
      kind: "statemachine",
      parent: "Loop",
      name: "Open",
      spec: {
        states: [{ id: "A" }, { id: "B" }],
        transitions: [{ from: "A", to: "B" }],
      },
    });
    await ok(endpoint("/build_diagram"), {
      kind: "erd",
      spec: {
        entities: [
          { name: "Keyed", columns: ["id int PK"] },
          { name: "Loose", columns: ["x int"] },
        ],
      },
    });
    const data = await ok<UmlLinted>(umlLint, { rules: { naming: "off" } });
    const names = (rule: string) =>
      data.findings.filter((f) => f.rule === rule).map((f) => get(f.id).name);
    expect(names("U008")).toEqual(["Audit"]);
    expect(names("U009")).toEqual(["Loop"]);
    expect(names("U010")).toEqual(["Loop"]);
    expect(names("U011")).toEqual(["Loose"]);
  });

  it("applies naming conventions, configurable per kind", async () => {
    const lower = await cls("order");
    await ok(endpoint("/add_attribute"), {
      ref: lower,
      name: "Total",
      type: "int",
    });
    await ok(endpoint("/add_operation"), { ref: lower, name: "Pay" });
    const kind = await ok<{ _id: string }>(endpoint("/create_element"), {
      type: "UMLEnumeration",
      parent: "Model",
      name: "Kind",
    });
    await ok(endpoint("/add_enumeration_literal"), {
      ref: kind._id,
      name: "new",
    });
    await ok(endpoint("/create_element"), {
      type: "UMLPackage",
      parent: "Model",
      name: "Billing",
    });
    await ok(endpoint("/create_element"), {
      type: "UMLPrimitiveType",
      parent: "Model",
      name: "int",
    });
    const unnamed = await cls("Unnamed");
    get(unnamed).name = "";
    const only = {
      rules: Object.fromEntries(
        [
          "U001",
          "U002",
          "U003",
          "U004",
          "U005",
          "U006",
          "U007",
          "U008",
          "U009",
          "U010",
          "U011",
        ].map((r) => [r, "off"]),
      ),
    };
    const data = await ok<UmlLinted>(umlLint, only);
    expect(data.findings.map((f) => get(f.id).name)).toEqual([
      "order",
      "Total",
      "Pay",
      "new",
    ]);
    expect(data.findings[0]!.message).toBe(
      'The classifier name "order" is not PascalCase',
    );
    const custom = await ok<UmlLinted>(umlLint, {
      ...only,
      rules: { ...only.rules, U012: "warning" },
      naming: {
        classifier: "^[a-z]+$",
        attribute: false,
        operation: "snake_case",
        literal: "lowercase",
        package: "UPPER_CASE",
      },
    });
    expect(custom.findings.map((f) => [get(f.id).name, f.severity])).toEqual([
      ["Kind", "warning"],
      ["Pay", "warning"],
      ["Billing", "warning"],
    ]);
    await fails(
      umlLint,
      { naming: { classifier: "([" } },
      "INVALID_ARGUMENT",
      /^naming\.classifier: \(\[ is neither PascalCase, /,
    );
  });

  it("scopes, limits and checks its arguments", async () => {
    const pkg = await ok<{ _id: string }>(endpoint("/create_element"), {
      type: "UMLPackage",
      parent: "Model",
      name: "Inside",
    });
    await cls("lowerInside", "Model/Inside");
    await cls("lowerOutside");
    const scoped = await ok<UmlLinted>(umlLint, { scope: "Inside" });
    expect(scoped.findings.map((f) => get(f.id).name)).toEqual(["lowerInside"]);
    const limited = await ok<UmlLinted>(umlLint, { limit: 1 });
    expect(limited).toMatchObject({ count: 2, truncated: true });
    await fails(umlLint, { rules: { U999: "off" } }, "INVALID_ARGUMENT");
    await fails(
      umlLint,
      { scope: "Nope" },
      "NOT_FOUND",
      "Scope not found: Nope",
    );
    void pkg;
  });

  it("answers any request with findings or a stable error (fuzz)", async () => {
    await cls("x");
    await fc.assert(
      fc.asyncProperty(
        fc.record(
          {
            scope: fc.oneof(fc.string(), fc.constant("Model")),
            rules: fc.dictionary(
              fc.constantFrom("U001", "naming", "U012", "bogus"),
              fc.constantFrom("off", "error", "warning", "info", "loud"),
            ),
            naming: fc.record(
              {
                classifier: fc.oneof(
                  fc.string(),
                  fc.constant(false as const),
                  fc.constantFrom(
                    "PascalCase",
                    "(",
                    "[a-",
                    "toString",
                    "constructor",
                  ),
                ),
                operation: fc.string(),
              },
              { requiredKeys: [] },
            ),
            limit: fc.integer({ min: -3, max: 2000 }),
          },
          { requiredKeys: [] },
        ),
        async (body) => {
          const res = await invoke(umlLint, body);
          if (!res.success) {
            expect([
              "INVALID_ARGUMENT",
              "NOT_FOUND",
              "AMBIGUOUS_REF",
            ]).toContain(res.code);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
