import { beforeEach, describe, expect, it, vi } from "vitest";
import tb from "../../fixtures/domains/thingsboard.oo.json";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const buildModel = endpoints.find((e) => e.path === "/build_model")!;

beforeEach(() => {
  env = installMockApp();
});

interface Built {
  model: { _id: string; name: string; path: string };
  upserted: boolean;
  counts: {
    created: Record<string, number>;
    updated: Record<string, number>;
    unchanged: number;
  };
  changes?: {
    created: { path: string; type: string }[];
    updated: { path: string; type: string; fields: string[] }[];
  };
  ids?: Record<string, string>;
  skipped?: { section: string; reason: string }[];
  dryRun?: boolean;
  plan?: { ops: { path: string }[] };
}

const all = (typeName: string) =>
  env.app.repository.getInstancesOf(typeName) as Element[];
const named = (typeName: string, name: string) =>
  all(typeName).find((e) => e.name === name)!;
const total = (counts: Record<string, number>) =>
  Object.values(counts).reduce((a, b) => a + b, 0);

const SHOP = {
  system: "Shop",
  summary: "Selling things.",
  contexts: [
    {
      id: "sales",
      name: "Sales",
      responsibility: "Orders",
      dependsOn: ["catalog"],
    },
    { id: "catalog", name: "Catalog" },
    { id: "pricing", name: "Pricing", parent: "catalog" },
  ],
  classes: [
    {
      name: "Order",
      context: "sales",
      responsibility: "A customer's purchase",
      knows: ["lines", "total"],
      does: ["place"],
      collaboratesWith: ["Product"],
      attributes: ["-id: long", "+lines: Line[0..*]"],
      operations: ["+place(): void", "total"],
    },
    { name: "Line", context: "sales", attributes: ["+product: Product"] },
    { name: "Product", package: "catalog", kind: "abstract", isLeaf: false },
    { name: "Book", package: "catalog" },
    {
      name: "Priced",
      package: "pricing",
      kind: "interface",
      operations: ["price(): double"],
    },
    {
      name: "Status",
      context: "sales",
      kind: "enum",
      literals: ["OPEN", "PAID"],
    },
  ],
  relationships: [
    { from: "Order", to: "Line", type: "owns", fromMult: "1", toMult: "1..*" },
    { from: "Order", to: "Product", type: "has", name: "features" },
    { from: "Line", to: "Product", type: "knows", toRole: "item" },
    { from: "Book", to: "Product", type: "isA" },
    { from: "Book", to: "Priced", type: "implements" },
    { from: "Order", to: "Status", type: "uses" },
    { from: "Order", to: "Book", type: "association", fromMultiplicity: "*" },
  ],
  actors: ["Clerk", { name: "Customer", kind: "human", goals: ["buy"] }],
  useCases: [
    {
      name: "Buy",
      system: "Web shop",
      actors: ["Customer"],
      includes: ["Pay"],
    },
    "Pay",
    { name: "Refund", actors: ["Clerk"], extends: ["Pay"], documentation: "d" },
  ],
  collaborations: [
    {
      name: "Checkout",
      context: "sales",
      participants: [
        { name: "Customer", kind: "actor" },
        "Order",
        { name: "Bank" },
      ],
      messages: [
        ["Customer", "Order", "place()", "sync"],
        { from: "Order", to: "Order", text: "total()" },
        ["Order", "Bank", "charge(amount)", "async"],
        ["Bank", "Order", "ok", "reply"],
        ["Order", "Order", "recalculate everything"],
      ],
      fragments: [
        { operator: "alt", guard: "paid", operands: ["else"] },
        { operator: "loop" },
      ],
    },
  ],
  lifecycles: [
    {
      name: "Order lifecycle",
      subject: "Order",
      states: [
        { id: "i", type: "initial" },
        "Open",
        { id: "p", name: "Paying", parent: "Open" },
        { id: "c", type: "choice" },
        { id: "f", type: "final" },
      ],
      transitions: [
        { from: "i", to: "Open" },
        {
          from: "Open",
          to: "c",
          trigger: "pay",
          guard: "total > 0",
          effect: "charge",
        },
        { from: "c", to: "f" },
      ],
    },
  ],
};

describe("/build_model", () => {
  it("makes packages, classifiers, members and relationships with their semantics", async () => {
    const data = await ok<Built>(buildModel, { spec: SHOP, result: "full" });
    expect(data.model.name).toBe("Shop");
    expect(data.upserted).toBe(false);
    const model = env.app.repository.get(data.model._id)!;
    expect(model.documentation).toBe("Selling things.");
    const sales = named("UMLPackage", "Sales");
    expect(sales._parent).toBe(model);
    expect(sales.documentation).toBe("Orders");
    expect(named("UMLPackage", "Pricing")._parent).toBe(
      named("UMLPackage", "Catalog"),
    );
    const order = named("UMLClass", "Order");
    expect(order._parent).toBe(sales);
    expect(order.documentation).toBe(
      "A customer's purchase\nKnows: lines, total.\nDoes: place.\nCollaborates with: Product.",
    );
    const attrs = order.attributes as Element[];
    expect(attrs.map((a) => [a.name, a.visibility, a.multiplicity])).toEqual([
      ["id", "private", ""],
      ["lines", "public", "0..*"],
    ]);
    // A type naming a class of the spec references it.
    expect(attrs[1]!.type).toBe(named("UMLClass", "Line"));
    expect((order.operations as Element[]).map((o) => o.name)).toEqual([
      "place",
      "total",
    ]);
    expect(named("UMLClass", "Product").isAbstract).toBe(true);
    expect(named("UMLInterface", "Priced")._parent).toBe(
      named("UMLPackage", "Pricing"),
    );
    expect(
      (named("UMLEnumeration", "Status").literals as Element[]).map(
        (l) => l.name,
      ),
    ).toEqual(["OPEN", "PAID"]);

    const assoc = (name: string) =>
      all("UMLAssociation").find(
        (a) =>
          ((a.end1 as Element).reference as Element).name === "Order" &&
          ((a.end2 as Element).reference as Element).name === name,
      )!;
    expect(assoc("Line").end1).toMatchObject({
      aggregation: "composite",
      multiplicity: "1",
    });
    expect(assoc("Line").end2).toMatchObject({
      navigable: "navigable",
      multiplicity: "1..*",
    });
    expect(assoc("Product")).toMatchObject({ name: "features" });
    expect(assoc("Product").end1).toMatchObject({ aggregation: "shared" });
    expect(assoc("Book").end1).toMatchObject({
      multiplicity: "*",
      aggregation: "none",
    });
    const knows = all("UMLAssociation").find(
      (a) => ((a.end1 as Element).reference as Element).name === "Line",
    )!;
    expect(knows.end1).toMatchObject({ navigable: "notNavigable" });
    expect(knows.end2).toMatchObject({ navigable: "navigable", name: "item" });
    expect(all("UMLGeneralization")[0]).toMatchObject({
      source: named("UMLClass", "Book"),
      target: named("UMLClass", "Product"),
    });
    expect(all("UMLInterfaceRealization")[0]!.target).toBe(
      named("UMLInterface", "Priced"),
    );
    const deps = all("UMLDependency").map((d) => [
      (d.source as Element).name,
      (d.target as Element).name,
    ]);
    expect(deps).toEqual(
      expect.arrayContaining([
        ["Sales", "Catalog"],
        ["Order", "Status"],
      ]),
    );
    expect(data.changes!.created).toContainEqual({
      path: "Shop/Sales/Order -> Shop/Sales/Line",
      type: "UMLAssociation",
    });
    expect(data.ids!["Shop/Sales/Order"]).toBe(order._id);
  });

  it("makes actors, use cases, collaborations and lifecycles", async () => {
    await ok<Built>(buildModel, { spec: SHOP });
    expect(named("UMLActor", "Customer").documentation).toBe(
      "Kind: human.\nGoals: buy.",
    );
    expect(named("UMLActor", "Clerk").documentation).toBe("");
    // A use case without a system of its own belongs to the spec's.
    expect(all("UMLUseCaseSubject").map((s) => s.name)).toEqual([
      "Web shop",
      "Shop",
    ]);
    expect(named("UMLUseCase", "Refund").documentation).toBe("d");
    expect(all("UMLInclude")[0]).toMatchObject({
      source: named("UMLUseCase", "Buy"),
      target: named("UMLUseCase", "Pay"),
    });
    expect(all("UMLExtend")[0]).toMatchObject({
      source: named("UMLUseCase", "Refund"),
    });

    const collab = named("UMLCollaboration", "Checkout");
    const interaction = (collab.ownedElements as Element[])[0]!;
    expect(interaction.constructor.name).toBe("UMLInteraction");
    const lifelines = interaction.participants as Element[];
    expect(lifelines.map((l) => l.name)).toEqual(["Customer", "Order", "Bank"]);
    // The actor named Customer, not a class, types the actor participant.
    expect(
      ((lifelines[0]!.represent as Element).type as Element).constructor.name,
    ).toBe("UMLActor");
    expect((lifelines[1]!.represent as Element).type).toBe(
      named("UMLClass", "Order"),
    );
    expect((lifelines[2]!.represent as Element).type).toBeFalsy();
    const messages = interaction.messages as Element[];
    expect(messages.map((m) => [m.name, m.messageSort])).toEqual([
      ["place()", "synchCall"],
      ["total()", "synchCall"],
      ["charge(amount)", "asynchCall"],
      ["ok", "reply"],
      ["recalculate everything", "synchCall"],
    ]);
    const order = named("UMLClass", "Order");
    expect(messages[0]!.signature).toBe((order.operations as Element[])[0]);
    expect(messages[1]!.signature).toBe((order.operations as Element[])[1]);
    expect(messages[2]!.signature).toBeFalsy();
    const fragments = interaction.fragments as Element[];
    expect(
      fragments.map((f) => [
        f.name,
        f.interactionOperator,
        (f.operands as Element[]).map((o) => [o.name, o.guard]),
      ]),
    ).toEqual([
      [
        "paid",
        "alt",
        [
          ["paid", "paid"],
          ["else", "else"],
        ],
      ],
      ["loop", "loop", [["loop", ""]]],
    ]);

    const machine = named("UMLStateMachine", "Order lifecycle");
    expect(machine._parent).toBe(order);
    const region = (machine.regions as Element[])[0]!;
    const vertices = region.vertices as Element[];
    expect(vertices.map((v) => [v.constructor.name, v.name, v.kind])).toEqual([
      ["UMLPseudostate", "", "initial"],
      ["UMLState", "Open", undefined],
      ["UMLPseudostate", "", "choice"],
      ["UMLFinalState", "", undefined],
    ]);
    const open = vertices[1]!;
    expect(
      ((open.regions as Element[])[0]!.vertices as Element[]).map(
        (v) => v.name,
      ),
    ).toEqual(["Paying"]);
    const transitions = region.transitions as Element[];
    expect(transitions.map((t) => [t.name, t.guard])).toEqual([
      ["", ""],
      ["pay / charge", "total > 0"],
      ["", ""],
    ]);
  });

  it("ingests the ThingsBoard analysis whole, storing its view sections with the model", async () => {
    const data = await ok<Built>(buildModel, { spec: tb });
    expect(data.counts.created).toMatchObject({
      UMLPackage: 15,
      UMLClass: 60,
      UMLInterface: 30,
      UMLEnumeration: 3,
      UMLActor: 6,
      UMLUseCase: 21,
      UMLCollaboration: 5,
      UMLLifeline: 37,
      UMLMessage: 57,
      UMLStateMachine: 3,
      UMLTransition: 32,
    });
    expect(data.skipped).toBeUndefined();
    // The sections /derive_diagrams draws travel with the model.
    const tag = (named("UMLModel", "ThingsBoard").tags as Element[]).find(
      (t) => t.name === "mcp.modelViews",
    )!;
    expect(Object.keys(JSON.parse(String(tag.value)))).toEqual([
      "classViews",
      "useCaseViews",
      "activities",
      "erd",
      "components",
      "deployments",
      "features",
      "contexts",
      "subjects",
      "fragments",
    ]);
    // The device lifecycle is the Device class's, not the Device actor's.
    expect(
      named("UMLStateMachine", "State - Device lifecycle")._parent!.constructor
        .name,
    ).toBe("UMLClass");
  });

  it("plans exactly what it applies, and a dry run changes nothing", async () => {
    const dry = await ok<Built>(buildModel, {
      spec: SHOP,
      dryRun: true,
      detail: "full",
    });
    expect(dry.dryRun).toBe(true);
    expect(all("UMLClass")).toHaveLength(0);
    expect(dry.model._id).toBe("$m0");
    expect(dry.ids).toBeUndefined();
    const applied = await ok<Built>(buildModel, { spec: SHOP, result: "full" });
    expect(applied.counts).toEqual(dry.counts);
    expect(applied.changes).toEqual(dry.changes);
    expect(dry.plan!.ops.length).toBe(total(dry.counts.created));
  });

  it("answers a dry run as a summary unless asked for every change", async () => {
    const summary = await ok<
      Built & {
        omitted?: {
          created: number;
          updated: number;
          ops: number;
          steps: number;
        };
        plan?: { ops: unknown[]; creates: unknown[]; updates: unknown[] };
      }
    >(buildModel, { spec: tb, dryRun: true });
    const full = await ok<Built & { omitted?: unknown }>(buildModel, {
      spec: tb,
      dryRun: true,
      detail: "full",
    });
    expect(full.omitted).toBeUndefined();
    const everything = await ok<Built & { omitted?: unknown }>(buildModel, {
      spec: tb,
      dryRun: true,
      result: "full",
    });
    expect(everything.omitted).toBeUndefined();
    expect(everything.changes).toEqual(full.changes);
    expect(summary.counts).toEqual(full.counts);
    expect(summary.changes!.created).toEqual(
      full.changes!.created.slice(0, 20),
    );
    expect(summary.plan!.ops).toHaveLength(20);
    expect(summary.omitted).toEqual({
      created: full.changes!.created.length - 20,
      updated: 0,
      ops: full.plan!.ops.length - 20,
      steps: expect.any(Number),
    });
    // The ThingsBoard dry run answered 80 KB in the validation.
    expect(JSON.stringify(summary).length).toBeLessThan(
      JSON.stringify(full).length / 5,
    );
    // A small plan is answered whole either way.
    const small = await ok<Built & { omitted?: unknown }>(buildModel, {
      spec: { name: "Tiny", classes: [{ name: "A" }] },
      dryRun: true,
    });
    expect(small.omitted).toBeUndefined();
    expect(small.plan!.ops.length).toBeGreaterThan(0);
  });

  it("refuses a model that exists unless upserting, and then changes only what differs", async () => {
    await ok<Built>(buildModel, { spec: SHOP });
    const again = await fails(
      buildModel,
      { spec: SHOP },
      "DUPLICATE_NAME",
      "Shop exists; pass upsert: true to update it",
    );
    expect(again.details).toMatchObject({ existing: { _type: "UMLModel" } });
    const same = await ok<Built>(buildModel, {
      spec: SHOP,
      upsert: true,
      dryRun: true,
    });
    expect(same.counts.created).toEqual({});
    expect(same.counts.updated).toEqual({});
    expect(same.plan!.ops).toEqual([]);
    expect(same.upserted).toBe(true);
    const changed = structuredClone(SHOP);
    changed.classes[0]!.responsibility = "A purchase";
    changed.classes[0]!.attributes!.push("+note: String");
    changed.classes[0]!.attributes![0] = "+id: long";
    changed.classes[0]!.operations![0] = "#place(): void";
    changed.classes[2]!.kind = "abstract";
    changed.classes.push({ name: "Ebook", package: "catalog" });
    changed.classes[5]!.literals!.push("VOID");
    const upserted = await ok<Built>(buildModel, {
      spec: changed,
      upsert: true,
      result: "full",
    });
    expect(upserted.counts.created).toEqual({
      UMLClass: 1,
      UMLAttribute: 1,
      UMLEnumerationLiteral: 1,
    });
    expect(upserted.changes!.updated).toEqual([
      { path: "Shop/Sales/Order", type: "UMLClass", fields: ["documentation"] },
      {
        path: "Shop/Sales/Order.id",
        type: "UMLAttribute",
        fields: ["visibility"],
      },
      {
        path: "Shop/Sales/Order#place()",
        type: "UMLOperation",
        fields: ["visibility"],
      },
    ]);
    expect(named("UMLClass", "Order").documentation).toMatch(/^A purchase/);
    // Applying it twice changes nothing more.
    const twice = await ok<Built>(buildModel, { spec: changed, upsert: true });
    expect(total(twice.counts.created) + total(twice.counts.updated)).toBe(0);
    expect(twice.ids).toBeUndefined();
  });

  it("files the model under a parent and relates spec elements to ones the model has", async () => {
    const pkg = await ok<{ _id: string }>(
      endpoints.find((e) => e.path === "/create_element")!,
      {
        type: "UMLPackage",
        parent: env.model._id,
        name: "Base",
      },
    );
    await ok(
      endpoints.find((e) => e.path === "/create_element")!,
      {
        type: "UMLClass",
        parent: pkg._id,
        name: "Entity",
      },
    );
    const data = await ok<Built>(buildModel, {
      parent: env.model._id,
      spec: {
        name: "Sub",
        classes: [{ name: "User" }],
        relationships: [{ from: "User", to: "Model/Base/Entity", type: "isA" }],
      },
      result: "ids",
    });
    expect(data.model.path).toBe("Model/Sub");
    expect(all("UMLGeneralization")[0]!.target).toBe(
      named("UMLClass", "Entity"),
    );
    expect(Object.keys(data.ids!)).toEqual(["Model/Sub", "Model/Sub/User"]);
  });
});

describe("/build_model refusals", () => {
  const refuse = (
    spec: unknown,
    error: string | RegExp,
    code: "INVALID_ARGUMENT" | "AMBIGUOUS_REF" = "INVALID_ARGUMENT",
  ) =>
    fails(
      buildModel,
      { spec: { system: "S", ...(spec as Record<string, unknown>) } },
      code,
      error,
    );

  it("names the field of a malformed spec", async () => {
    await refuse({ classes: [{ name: "" }] }, /^spec\.classes\.0\.name: /);
    await refuse(
      { contexts: [], packages: [] },
      "spec: pass contexts or packages, not both",
    );
    await refuse(
      { classes: [{ name: "A", context: "x", package: "y" }] },
      "spec.classes.0: pass context or package, not both",
    );
    await refuse(
      { classes: [{ name: "A" }, { name: "A" }] },
      "spec.classes.1: A is defined twice",
    );
    await refuse(
      { classes: [{ name: "A", context: "nope" }] },
      "spec.classes.0.context: no package or context nope; declare it in spec.contexts or spec.packages",
    );
  });

  it("refuses dangling and looping references", async () => {
    await refuse(
      { packages: [{ name: "A", parent: "B" }] },
      "spec.packages.0.parent: no package B",
    );
    await refuse(
      {
        packages: [
          { name: "A", parent: "B" },
          { name: "B", parent: "A" },
        ],
      },
      "spec.packages.0.parent: A would be nested in itself",
    );
    await refuse(
      { packages: [{ name: "A", dependsOn: ["Z"] }] },
      "spec.packages.0.dependsOn.0: no package Z",
    );
    await refuse(
      { relationships: [{ from: "A", to: "B", type: "uses" }] },
      "spec.relationships.0.from: no class, interface, actor or use case A in the spec or the model",
    );
    await refuse(
      { useCases: [{ name: "U", includes: ["V"] }] },
      "spec.useCases.0.includes.0: no use case V in the spec",
    );
    await refuse(
      {
        collaborations: [
          { name: "C", participants: [{ name: "x", type: "Nope" }] },
        ],
      },
      "spec.collaborations.0.participants: no classifier Nope for x",
    );
    await refuse(
      { collaborations: [{ name: "C", messages: [["a", "", "x"]] }] },
      "spec.collaborations.0.messages.0: from and to must be names",
    );
    await refuse(
      { collaborations: [{ name: "C", messages: [["a", "b", "x", "loud"]] }] },
      "spec.collaborations.0.messages.0: kind loud is not one of sync, async, reply, create, delete",
    );
    await refuse(
      { lifecycles: [{ name: "L", states: [{ type: "initial" }] }] },
      "spec.lifecycles.0.states.0: needs a name or an id",
    );
    await refuse(
      {
        lifecycles: [
          { name: "L", states: ["A"], transitions: [{ from: "A", to: "B" }] },
        ],
      },
      "spec.lifecycles.0.transitions.0.to: no state B",
    );
    await refuse(
      {
        lifecycles: [
          {
            name: "L",
            states: [
              { id: "i", type: "initial" },
              { name: "A", parent: "i" },
            ],
          },
        ],
      },
      "spec.lifecycles.0.states.1.parent: no state i",
    );
    await refuse(
      {
        lifecycles: [
          {
            name: "L",
            states: [
              { name: "A", parent: "B" },
              { name: "B", parent: "A" },
            ],
          },
        ],
      },
      "spec.lifecycles.0.states.0.parent: A would be nested in itself",
    );
  });

  it("leaves a participant untyped when several model elements have its name", async () => {
    const create = endpoints.find((e) => e.path === "/create_element")!;
    for (const parent of [env.model._id, env.project._id]) {
      const pkg = await ok<{ _id: string }>(create, {
        type: parent === env.project._id ? "UMLModel" : "UMLPackage",
        parent,
        name: `P${parent}`,
      });
      await ok(create, { type: "UMLClass", parent: pkg._id, name: "Twin" });
    }
    await ok<Built>(buildModel, {
      spec: {
        system: "S",
        collaborations: [{ name: "C", participants: ["Twin"] }],
      },
    });
    const role = named("UMLLifeline", "Twin").represent as Element;
    expect(role.type).toBeFalsy();
    await refuse(
      {
        system: "S2",
        relationships: [{ from: "Twin", to: "Twin", type: "uses" }],
      },
      /Twin names 4 elements/,
      "AMBIGUOUS_REF",
    );
  });
});

describe("/build_model spec forms", () => {
  it("reads every form a field may take", async () => {
    const data = await ok<Built>(buildModel, {
      result: "full",
      spec: {
        name: "Forms",
        summary: "   ",
        packages: [{ name: "P", stereotype: "layer", documentation: "doc" }],
        classes: [
          {
            name: "A",
            package: "P",
            stereotype: "entity",
            isActive: true,
            isLeaf: true,
            attributes: [{ name: "count: int = 0$" }, "+tag"],
            operations: [{ name: "+make(n: int): A$" }, "stop"],
          },
          { name: "B" },
        ],
        relationships: [
          { from: "A", to: "B", type: "uses", name: "calls" },
          { from: "A", to: "B", type: "association" },
          { from: "B", to: "A", type: "owns", fromRole: "whole" },
        ],
        actors: [{ name: "Admin", documentation: "Runs it." }],
        collaborations: [
          {
            name: "Talk",
            messages: [{ from: "A", to: "B" }, ["B", "A"], ["A", "C", "go()"]],
          },
        ],
        lifecycles: [
          { name: "Empty" },
          {
            name: "Ids",
            states: [{ id: "s" }, { id: "t", name: "Named" }],
            transitions: [{ from: "s", to: "t" }],
          },
        ],
      },
    });
    const model = env.app.repository.get(data.model._id)!;
    expect(model.documentation).toBe("");
    expect(named("UMLPackage", "P")).toMatchObject({
      stereotype: "layer",
      documentation: "doc",
    });
    const a = named("UMLClass", "A");
    expect(a).toMatchObject({
      stereotype: "entity",
      isActive: true,
      isLeaf: true,
    });
    expect(
      (a.attributes as Element[]).map((x) => [
        x.name,
        x.isStatic,
        x.defaultValue,
      ]),
    ).toEqual([
      ["count", true, "0"],
      ["tag", false, ""],
    ]);
    expect(
      (a.operations as Element[]).map((o) => [o.name, o.isStatic]),
    ).toEqual([
      ["make", true],
      ["stop", false],
    ]);
    expect(all("UMLDependency")[0]!.name).toBe("calls");
    const interaction = named("UMLInteraction", "Talk");
    expect((interaction.participants as Element[]).map((l) => l.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect((interaction.messages as Element[]).map((m) => m.name)).toEqual([
      "",
      "",
      "go()",
    ]);
    expect(named("UMLActor", "Admin").documentation).toBe("Runs it.");
    expect(named("UMLStateMachine", "Empty").regions as Element[]).toHaveLength(
      1,
    );
    const ids = (named("UMLStateMachine", "Ids").regions as Element[])[0]!;
    expect((ids.vertices as Element[]).map((v) => v.name)).toEqual([
      "s",
      "Named",
    ]);
    expect(
      data.changes!.created.some((c) => c.path === "Forms/P/A#make(int)"),
    ).toBe(true);
  });

  it("takes a type written as text as the classifier of that name on upsert", async () => {
    const spec = {
      system: "Typed",
      classes: [
        { name: "Line" },
        { name: "Order", attributes: ["+line: Line"] },
      ],
    };
    await ok<Built>(buildModel, { spec });
    const order = named("UMLClass", "Order");
    expect((order.attributes as Element[])[0]!.type).toBe(
      named("UMLClass", "Line"),
    );
    // Line no longer in the spec: "Line" is text naming the type it has.
    const again = await ok<Built>(buildModel, {
      upsert: true,
      dryRun: true,
      result: "ids",
      spec: {
        system: "Typed",
        classes: [{ name: "Order", attributes: ["+line: Line"] }],
      },
    });
    expect(again.counts.updated).toEqual({});
    expect(again.ids).toEqual({
      Typed: expect.any(String),
      "Typed/Order": order._id,
    });
  });

  it("reports StarUML refusing to add an element", async () => {
    const spy = vi.spyOn(env.app.engine, "addModel").mockReturnValue(null);
    await fails(
      buildModel,
      {
        spec: {
          system: "Refused",
          collaborations: [{ name: "C", participants: ["A"] }],
        },
      },
      "STARUML_ERROR",
      /StarUML did not add UMLLifeline to UMLInteraction\.participants/,
    );
    spy.mockRestore();
  });
});

describe("/build_model defaults", () => {
  it("names the model Model, and reads abstract operations, untyped parameters and one-sided ends", async () => {
    await fails(
      buildModel,
      { spec: {} },
      "DUPLICATE_NAME",
      "Model exists; pass upsert: true to update it",
    );
    const data = await ok<Built>(buildModel, {
      upsert: true,
      result: "full",
      spec: {
        classes: [
          { name: "Job", kind: "abstract", operations: ["+run(x)*"] },
          { name: "Step" },
        ],
        relationships: [
          { from: "Job", to: "Step", type: "association", toMult: "*" },
        ],
      },
    });
    expect(data.upserted).toBe(true);
    const run = (named("UMLClass", "Job").operations as Element[])[0]!;
    expect(run.isAbstract).toBe(true);
    expect(data.changes!.created.map((c) => c.path)).toContain(
      "Model/Job#run()",
    );
    const assoc = all("UMLAssociation")[0]!;
    expect(assoc.end2).toMatchObject({ multiplicity: "*" });
    expect(assoc.end1).toMatchObject({ multiplicity: "" });
  });
});

describe("/build_model lifecycles on upsert", () => {
  it("fills the machine's first region, or gives a machine without one a region", async () => {
    const spec = {
      system: "Life",
      lifecycles: [
        {
          name: "L",
          states: ["A", "B"],
          transitions: [{ from: "A", to: "B" }],
        },
      ],
    };
    await ok<Built>(buildModel, { spec });
    const machine = named("UMLStateMachine", "L");
    expect(machine.regions as Element[]).toHaveLength(1);
    const same = await ok<Built>(buildModel, {
      spec,
      upsert: true,
      dryRun: true,
    });
    expect(same.plan!.ops).toEqual([]);
    machine.regions = [];
    const refilled = await ok<Built>(buildModel, { spec, upsert: true });
    expect(refilled.counts.created).toEqual({
      UMLRegion: 1,
      UMLState: 2,
      UMLTransition: 1,
    });
  });
});
