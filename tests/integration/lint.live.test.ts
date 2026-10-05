import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Summary {
  _id: string;
  path?: string;
}

interface Created {
  view: Summary;
  model: Summary;
}

interface Linted {
  count: number;
  findings: {
    rule: string;
    ids?: string[];
    id?: string;
    autofix?: { path: string; body: Record<string, unknown> } | null;
  }[];
}

interface Built {
  diagram: Summary;
  ids: Record<string, { model: string; view: string }>;
  edges: { model: string; view: string }[];
}

const ok = <T>(res: { success: boolean; data: T }, what: string): T => {
  expect(res.success, `${what}: ${JSON.stringify(res).slice(0, 600)}`).toBe(
    true,
  );
  return res.data;
};

// Issue #21 against StarUML 7.1.1: a diagram and a model that break every
// layout and semantic rule on purpose.
describeLive("/lint_diagram and /uml_lint", () => {
  let diagram: Summary;

  async function node(
    name: string,
    x: number,
    y: number,
    w = 100,
    h = 50,
    type = "UMLClass",
    on = diagram._id,
  ): Promise<Created> {
    return ok(
      await call<Created>("/create_element_with_view", {
        type,
        diagram: on,
        name,
        x,
        y,
        x2: x + w,
        y2: y + h,
        allowDuplicateNames: true,
      }),
      name,
    );
  }

  async function edge(from: Created, to: Created, on = diagram._id) {
    return ok(
      await call<Created>("/create_relationship", {
        type: "UMLAssociation",
        tail: from.view._id,
        head: to.view._id,
        diagram: on,
      }),
      "edge",
    );
  }

  beforeAll(async () => {
    await call("/new_project");
    ok(
      await call("/create_element", {
        type: "UMLModel",
        parent: "@project",
        name: "Lint",
      }),
      "model",
    );
    diagram = ok(
      await call<Summary>("/create_diagram", {
        type: "UMLClassDiagram",
        parent: "Lint",
        name: "Messy",
      }),
      "diagram",
    );
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("finds every layout rule and fixes an overlap with its autofix", async () => {
    const a = await node("A", 10, 10);
    await node("B", 10, 10);
    const c = await node("C", 60, 40);
    const d = await node("D", -300, -5);
    const e = await node("E", 400, 300);
    const f = await node("F", 900, 300);
    await node("G", 620, 290, 60, 70);
    await edge(e, f);
    await edge(a, c);
    await edge(d, e);
    await node("Lone", 1200, 40);
    for (let i = 0; i < 7; i++) {
      await node(
        `K${i}`,
        1500 + (i % 3) * 70,
        1500 + Math.floor(i / 3) * 60,
        50,
        40,
      );
    }
    const states = ok(
      await call<Summary>("/create_diagram", {
        type: "UMLStatechartDiagram",
        parent: "Lint",
        name: "Alarms",
      }),
      "statechart",
    );
    await node(
      "Active Unacknowledged Alarm State",
      40,
      40,
      60,
      40,
      "UMLState",
      states._id,
    );
    const messy = ok(
      await call<Linted>("/lint_diagram", { diagram: "Messy" }),
      "lint",
    );
    const alarms = ok(
      await call<Linted>("/lint_diagram", { diagram: "Alarms" }),
      "lint",
    );
    const rules = new Set(
      [...messy.findings, ...alarms.findings].map((x) => x.rule),
    );
    expect([...rules].sort()).toEqual([
      "L001",
      "L002",
      "L003",
      "L004",
      "L005",
      "L006",
      "L007",
    ]);
    // Applying the overlap's autofix leaves one overlap fewer.
    const overlap = messy.findings.find(
      (x) => x.rule === "L002" && x.ids!.includes(c.view._id),
    )!;
    const before = messy.findings.filter((x) => x.rule === "L002").length;
    ok(await call(overlap.autofix!.path, overlap.autofix!.body), "autofix");
    const after = ok(
      await call<Linted>("/lint_diagram", {
        diagram: "Messy",
        rules: ["overlap"],
      }),
      "relint",
    );
    expect(after.findings.length).toBeLessThan(before);
  });

  it("finds every semantic rule in a model that breaks them", async () => {
    const cls = ok(
      await call<Built>("/build_diagram", {
        kind: "class",
        name: "Bad classes",
        spec: {
          classes: [
            { name: "order", attributes: ["total"] },
            { name: "Shape", kind: "abstract" },
            { name: "Payable", kind: "interface" },
            { name: "Item" },
          ],
          relations: [{ from: "order", to: "Item" }],
        },
      }),
      "class",
    );
    const dep = ok(
      await call<Created>("/create_relationship", {
        type: "UMLDependency",
        tail: cls.ids.Item!.model,
        head: cls.ids.Shape!.model,
      }),
      "dependency",
    );
    ok(
      await call("/update_element", {
        ref: dep.model._id,
        field: "target",
        value: null,
      }),
      "dangle",
    );
    const seq = ok(
      await call<Built>("/build_diagram", {
        kind: "sequence",
        name: "Calls",
        spec: {
          participants: ["Client", "Server"],
          messages: [{ from: "Client", to: "Server", text: "refund()" }],
        },
      }),
      "sequence",
    );
    const lifeline = ok(
      await call<{ represent: { $ref: string } | null }>("/get_element_by_id", {
        ref: seq.ids.Server!.model,
        fields: ["represent"],
      }),
      "lifeline",
    );
    expect(lifeline.represent).not.toBeNull();
    ok(
      await call("/update_element", {
        ref: lifeline.represent!.$ref,
        field: "type",
        value: { $ref: cls.ids.Item!.model },
      }),
      "role type",
    );
    ok(
      await call("/build_diagram", {
        kind: "usecase",
        name: "Lonely",
        spec: { useCases: ["Nobody uses me"] },
      }),
      "usecase",
    );
    ok(
      await call("/build_diagram", {
        kind: "statemachine",
        name: "Endless",
        spec: {
          states: [{ id: "A" }, { id: "B" }],
          transitions: [{ from: "A", to: "B" }],
        },
      }),
      "statemachine",
    );
    ok(
      await call("/build_diagram", {
        kind: "erd",
        name: "Keys",
        spec: { entities: [{ name: "Loose", columns: ["x int"] }] },
      }),
      "erd",
    );
    const linted = ok(
      await call<Linted>("/uml_lint", { limit: 1000 }),
      "uml_lint",
    );
    const rules = new Set(linted.findings.map((x) => x.rule));
    for (const rule of [
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
      "U012",
    ]) {
      expect(rules, rule).toContain(rule);
    }
    const owner = ok(
      await call<{ _parent: string }>("/get_element_by_id", {
        ref: cls.ids.Item!.model,
      }),
      "owner",
    )._parent;
    const scoped = ok(
      await call<Linted>("/uml_lint", {
        scope: owner,
        rules: { naming: "off" },
      }),
      "scoped",
    );
    const scopedRules = scoped.findings.map((x) => x.rule);
    expect(scopedRules).not.toContain("U012");
    expect(scopedRules).not.toContain("U011");
    expect(scopedRules).toContain("U005");
  });
});
