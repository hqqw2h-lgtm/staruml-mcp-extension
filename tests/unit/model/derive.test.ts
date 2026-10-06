import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import tb from "../../fixtures/domains/thingsboard.oo.json";
import { ApiError } from "../../../src/errors.js";
import { naming } from "../../../src/handlers/oo.js";
import {
  DERIVED_KINDS,
  derive,
  modelOf,
  viewsOf,
} from "../../../src/model/derive.js";
import { pathOf } from "../../../src/refs.js";
import { endpoints } from "../../../src/routes.js";
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

interface Derived {
  model: string;
  diagrams: {
    kind: string;
    name: string;
    diagram: string;
    created: number;
    updated: number;
    unchanged: number;
    deleted?: number;
    ops?: number;
    quality?: { score: number; passes: boolean };
  }[];
  counts: {
    diagrams: number;
    created: number;
    unchanged: number;
    deleted: number;
  };
  quality?: { min: number; mean: number; passing: number; failing: string[] };
  dryRun?: boolean;
}

/** A small shop: every kind of relationship, a collaboration with a fragment, a nested lifecycle. */
const SHOP = {
  system: "Shop",
  contexts: [
    { id: "sales", name: "Sales", dependsOn: ["billing"] },
    { id: "billing", name: "Billing", dependsOn: ["sales"] },
    { id: "infra", name: "Infra", parent: "billing" },
  ],
  classes: [
    {
      name: "Order",
      context: "sales",
      attributes: ["+id: int"],
      operations: ["+place(): void", "+total(): int"],
    },
    { name: "Line", context: "sales", attributes: ["+qty: int"] },
    { name: "Entity", context: "sales", kind: "abstract" },
    {
      name: "Payable",
      context: "billing",
      kind: "interface",
      operations: ["+pay(): void"],
    },
    {
      name: "Invoice",
      context: "billing",
      operations: ["+getTotal(): int", "+setTotal(t: int): void"],
    },
    { name: "Status", context: "billing", kind: "enum", literals: ["NEW"] },
    { name: "Clock", context: "infra" },
    { name: "Loose" },
    { name: "Order2", context: "billing" },
  ],
  relationships: [
    { from: "Order", to: "Line", type: "owns", fromMult: "1", toMult: "1..*" },
    { from: "Order", to: "Invoice", type: "has" },
    { from: "Order", to: "Clock", type: "knows", name: "time" },
    { from: "Order", to: "Entity", type: "isA" },
    { from: "Invoice", to: "Payable", type: "implements" },
    { from: "Invoice", to: "Status", type: "uses" },
    { from: "Line", to: "Status", type: "association" },
  ],
  actors: ["Clerk", "Auditor"],
  useCases: [
    {
      name: "Place order",
      system: "Store",
      actors: ["Clerk"],
      includes: ["Pay bill"],
    },
    { name: "Pay bill", system: "Store", actors: ["Clerk"] },
    { name: "Audit books", actors: ["Auditor"] },
  ],
  collaborations: [
    {
      name: "Checkout",
      participants: ["Clerk", "Order", "Invoice"],
      messages: [
        ["Clerk", "Order", "place()"],
        ["Order", "Invoice", "pay()", "async"],
        ["Invoice", "Order", "paid", "reply"],
        ["Order", "Order", "total()"],
      ],
      fragments: [{ operator: "opt", guard: "paid", from: 1, to: 2 }],
    },
    { name: "Idle", messages: [["Clerk", "Order", "noop()", "create"]] },
  ],
  lifecycles: [
    {
      name: "Order life",
      subject: "Order",
      states: [
        { id: "i", type: "initial" },
        "Open",
        { id: "Busy", name: "Busy" },
        { id: "inner", name: "Checking", parent: "Busy" },
        { id: "c", type: "choice" },
        { id: "f", type: "fork" },
        { id: "j", type: "join" },
        { id: "x", type: "final" },
      ],
      transitions: [
        { from: "i", to: "Open" },
        { from: "Open", to: "Busy", trigger: "work", guard: "ok" },
        { from: "Busy", to: "c" },
        { from: "c", to: "f" },
        { from: "f", to: "j" },
        { from: "j", to: "x" },
      ],
    },
  ],
  classViews: [
    {
      name: "Sales and billing",
      contexts: ["sales", "Billing"],
      exclude: ["Line"],
      also: ["Loose", "Nobody"],
      classes: ["Clock"],
    },
    { name: "Nothing", contexts: ["nowhere"] },
    { name: "Picked", classes: ["Order"] },
  ],
  useCaseViews: [
    { name: "Audit", cases: ["Audit books"] },
    {
      name: "Clerk goals",
      actor: "Clerk",
      actors: ["Auditor"],
      cases: ["Place order", "Pay bill"],
      extraActors: [],
    },
  ],
  activities: [
    {
      name: "Fulfil",
      lanes: ["Shop"],
      nodes: [
        { id: "s", type: "initial", lane: "Shop" },
        { name: "Pack", lane: "Shop" },
        { id: "e", type: "final", lane: "Shop" },
      ],
      flows: [
        ["s", "Pack", "", "extra"],
        { from: "Pack", to: "e", guard: "done" },
      ],
    },
  ],
  erd: {
    entities: [
      { name: "orders", columns: ["id int PK"] },
      { name: "lines", columns: ["id int PK", "order_id int FK"] },
    ],
    relationships: [
      ["orders", "lines", "1", "0..*"],
      { from: "orders", to: "lines", name: "again" },
    ],
  },
  components: {
    name: "Shop containers",
    elements: [
      { id: "web", name: "Web", type: "container", technology: "TS" },
      { id: "db", name: "DB", type: "container", kind: "database" },
    ],
    relations: [
      ["web", "db", "reads", "SQL"],
      { from: "db", to: "web", label: "notifies" },
    ],
  },
  deployments: [
    {
      name: "Prod",
      nodes: [
        { name: "Edge", kind: "device", contains: ["app.js"] },
        { name: "Host", kind: "node" },
        {
          name: "Box",
          kind: "executionEnvironment",
          parent: "Host",
          contains: ["shop.jar"],
        },
      ],
      links: [["Edge", "Host", "HTTPS"], { from: "Host", to: "Edge" }],
    },
    { name: "Bare", nodes: [{ name: "Lonely" }] },
  ],
  features: {
    name: "Shop features",
    children: [{ name: "Orders", children: [{ name: "Cart" }] }],
  },
};

async function model(spec: Record<string, unknown> = SHOP) {
  return ok<{ model: { _id: string } }>(ep("/build_model"), { spec });
}

describe("/derive_diagrams", () => {
  it("draws every kind from the model and its views, and a second run changes nothing", async () => {
    const m = await model();
    const classes = env.app.repository.getInstancesOf("UMLClass").length;
    const first = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
    });
    expect(first.diagrams.map((d) => `${d.kind}:${d.name}`)).toEqual([
      "package:Shop packages",
      "class:Sales and billing",
      "class:Nothing",
      "class:Picked",
      "sequence:Checkout",
      "sequence:Idle",
      "usecase:Audit",
      "usecase:Clerk goals",
      "statemachine:Order life",
      "activity:Fulfil",
      "erd:Shop data model",
      "c4:Shop containers",
      "deployment:Prod",
      "deployment:Bare",
      "mindmap:Shop features",
    ]);
    expect(first.quality!.mean).toBeGreaterThan(0);
    const views = () =>
      env.app.repository
        .getInstancesOf("View")
        .map((v) => `${v._id}@${String(v.left)},${String(v.top)}`)
        .sort();
    const before = views();
    const again = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
    });
    expect(again.counts).toMatchObject({ created: 0, deleted: 0 });
    expect(views()).toEqual(before);
    // Each derived diagram shows the model's own elements: no class was copied.
    expect(env.app.repository.getInstancesOf("UMLClass")).toHaveLength(classes);
    expect(env.app.repository.getInstancesOf("UMLLifeline")).toHaveLength(5);
  });

  it("draws a collaboration as a communication diagram when asked, from the model's own lifelines and messages", async () => {
    const m = await model();
    const count = (t: string) => env.app.repository.getInstancesOf(t).length;
    const messages = count("UMLMessage");
    const first = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["communication"],
    });
    expect(first.diagrams.map((d) => `${d.kind}:${d.name}`)).toEqual([
      "communication:Checkout communication",
      "communication:Idle communication",
    ]);
    // Checkout's three messages between lifelines, not the self call.
    const checkout = get(first.diagrams[0]!.diagram);
    const views = checkout.ownedViews as View[];
    expect(
      views.filter((v) => v.constructor.name === "UMLCommMessageView"),
    ).toHaveLength(3);
    expect(
      views.filter((v) => v.constructor.name === "UMLConnectorView"),
    ).toHaveLength(2);
    expect(count("UMLMessage")).toBe(messages);
    expect(count("UMLLifeline")).toBe(5);
    const again = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["communication"],
    });
    expect(again.counts).toMatchObject({ created: 0, deleted: 0 });
  });

  it("derives one class diagram per package with collaborators, an overview, and splits big ones", async () => {
    const m = await model();
    const per = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["class", "package"],
      policy: { classDiagrams: "perPackage", hideGetters: true },
    });
    expect(per.diagrams.map((d) => d.name)).toEqual([
      "Shop packages",
      "Shop",
      "Sales",
      "Billing",
      "Infra",
    ]);
    // Invoice shows only accessors, so its operations stay folded.
    const billing = get(per.diagrams[3]!.diagram);
    const invoice = (billing.ownedViews as View[]).find(
      (v) => v.model?.name === "Invoice",
    )!;
    expect(invoice.suppressOperations).toBe(true);
    // Hidden already: a second run leaves it.
    await ok(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["class"],
      policy: { classDiagrams: "perPackage", hideGetters: true },
    });
    await ok(ep("/set_style_profile"), {
      patch: {
        layout: { maxElements: 2 },
        policy: { neighbours: false, packageOverview: false },
      },
    });
    const split = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["class", "package"],
      policy: { classDiagrams: "perPackage" },
    });
    expect(split.diagrams.map((d) => d.name)).toContain("Sales (1/2)");
    expect(split.diagrams.some((d) => d.kind === "package")).toBe(false);
  });

  it("groups use cases by system when the model has no use case views", async () => {
    const spec = { ...SHOP, useCaseViews: undefined, classViews: undefined };
    const m = await model(spec);
    const out = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      kinds: ["usecase"],
    });
    expect(out.diagrams.map((d) => d.name)).toEqual([
      "Store",
      "Shop use cases",
    ]);
    const none = await model({ system: "Empty", classes: [{ name: "A" }] });
    expect(
      (
        await ok<Derived>(ep("/derive_diagrams"), {
          scope: none.model._id,
          kinds: ["usecase", "sequence"],
        })
      ).diagrams,
    ).toEqual([]);
  });

  it("answers what each diagram would change on a dry run, and changes nothing", async () => {
    const m = await model();
    const dry = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
      dryRun: true,
      kinds: ["class", "erd"],
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.diagrams[0]!.ops).toBeGreaterThan(0);
    expect(dry.diagrams[0]!.diagram).toBe("$diagram");
    expect(dry.quality).toBeUndefined();
    expect(env.app.repository.getInstancesOf("UMLClassDiagram")).toHaveLength(
      1,
    );
  });

  it("refuses a bad policy and names the diagram a build failed on", async () => {
    const m = await model();
    await fails(
      ep("/derive_diagrams"),
      { scope: m.model._id, policy: { classDiagrams: "all" } },
      "INVALID_ARGUMENT",
      /^policy.policy.classDiagrams/,
    );
    await fails(ep("/derive_diagrams"), { scope: "Nowhere" }, "NOT_FOUND");
    // A stored view the build cannot draw.
    const tag = (get(m.model._id).tags as Element[])[0]!;
    tag.value = JSON.stringify({
      erd: {
        entities: [{ name: "t", columns: ["id nonsense PK FK FK"] }],
        relationships: [["t", "nowhere"]],
      },
    });
    await fails(
      ep("/derive_diagrams"),
      { scope: m.model._id, kinds: ["erd"] },
      "INVALID_ARGUMENT",
      /^derive_diagrams: erd diagram Shop data model: /,
    );
    const plain = new Error("defect");
    expect(naming("x", plain)).toBe(plain);
    expect(
      (naming("x", new ApiError("NOT_FOUND", "gone")) as ApiError).message,
    ).toBe("x: gone");
  });
});

describe("derive edge cases", () => {
  it("draws sections without relationships, each model's elements its own", async () => {
    const spec = (n: string) => ({
      system: n,
      erd: { entities: [{ name: "t" }] },
      components: { elements: [{ name: "Web", type: "container" }] },
    });
    for (const n of ["One", "Two"]) {
      const m = await model(spec(n));
      await ok(ep("/derive_diagrams"), { scope: m.model._id });
    }
    const webs = env.app.repository
      .getInstancesOf("C4Element")
      .filter((e) => e.name === "Web");
    expect(webs).toHaveLength(2);
  });

  it("leaves a view taken by one node to it when a bound node asks for it too", async () => {
    const { opsFor } = await import("../../../src/handlers/build.js");
    const { planFor } = await import("../../../src/build/spec.js");
    const built = await ok<{
      diagram: { _id: string };
      ids: Record<string, { model: string }>;
    }>(ep("/build_diagram"), {
      kind: "class",
      name: "Pool",
      result: "ids",
      spec: { classes: [{ name: "A" }] },
    });
    const plan = planFor("class", { classes: [{ name: "A" }, { name: "B" }] });
    const result = opsFor(
      plan,
      { diagram: get(built.diagram._id), parent: env.model, name: "Pool" },
      "TB",
      false,
      "hierarchy-down",
      { bind: new Map([["B", get(built.ids.A!.model)]]) },
    );
    // A keeps its view; B, bound to the same class, gets a view of its own.
    expect(result.reused.has("A")).toBe(true);
    expect(result.ops.some((o) => o.path === "/create_view_of")).toBe(true);
  });
});

describe("derive rules", () => {
  it("reads the model a scope belongs to and its stored views, a broken tag as none", async () => {
    const m = await model();
    const sales = env.app.repository
      .getInstancesOf("UMLPackage")
      .find((p) => p.name === "Sales")!;
    expect(modelOf(sales)).toBe(get(m.model._id));
    expect(modelOf(env.project)).toBeNull();
    expect(viewsOf(null)).toEqual({});
    (get(m.model._id).tags as Element[])[0]!.value = "{";
    expect(viewsOf(get(m.model._id))).toEqual({});
    // From a package: its own classes, and the project as scope derives everything.
    expect(derive(sales, standard()).map((d) => d.kind)).toEqual([
      "class",
      "statemachine",
    ]);
    expect(
      derive(env.project, standard(), new Set(["statemachine"])).map(
        (d) => d.name,
      ),
    ).toEqual(["Order life"]);
  });

  it("names nodes apart where names repeat, and spells every relationship", async () => {
    const twin = await model({ system: "Twins", contexts: ["A", "B"] });
    for (const owner of ["Twins/A", "Twins/B"]) {
      await ok(ep("/create_element"), {
        type: "UMLClass",
        parent: owner,
        name: "Same",
      });
    }
    void twin;
    const twins = env.app.repository
      .getInstancesOf("UMLModel")
      .find((x) => x.name === "Twins")!;
    const [overview, ...classes] = derive(twins, {
      ...standard(),
      policy: { ...standard().policy, classDiagrams: "perPackage" },
    });
    expect(overview!.kind).toBe("package");
    expect(classes.map((c) => c.name)).toEqual(["A", "B"]);
    const all = derive(twins, standard(), new Set(["class"]));
    expect(all.map((d) => d.name)).toEqual(["A", "B"]);
    // One diagram holding both: keys tell them apart by their owners.
    await ok(ep("/add_tag"), {
      ref: twins._id,
      name: "mcp.modelViews",
      kind: "string",
      value: JSON.stringify({
        classViews: [{ name: "Both", contexts: ["A", "B"] }],
      }),
    });
    const [pair] = derive(twins, standard(), new Set(["class"]));
    expect(
      (pair!.spec as { classes: { name: string }[] }).classes.map(
        (c) => c.name,
      ),
    ).toEqual(["Same (A)", "Same (B)"]);
    const m = await model();
    const shop = derive(get(m.model._id), standard(), new Set(["class"]))[0]!;
    const relations = (
      shop.spec as { relations: { type: string; name?: string }[] }
    ).relations;
    expect([...new Set(relations.map((r) => r.type))].sort()).toEqual(
      [
        "aggregation",
        "dependency",
        "directed",
        "generalization",
        "realization",
      ].sort(),
    );
  });

  it("maps message kinds and pseudostates, and skips what a model leaves out", async () => {
    const m = await model();
    const [checkout] = derive(
      get(m.model._id),
      standard(),
      new Set(["sequence"]),
    );
    expect(
      (checkout!.spec as { messages: { kind: string }[] }).messages.map(
        (x) => x.kind,
      ),
    ).toEqual(["sync", "async", "reply", "sync"]);
    // A collaboration without its interaction draws nothing.
    const lone = create("UMLCollaboration");
    lone.name = "Lone";
    lone._parent = get(m.model._id) as never;
    (get(m.model._id).ownedElements as unknown[]).push(lone);
    env.app.repository.index(lone);
    // A pseudostate of a kind the build has no type for is drawn as a choice.
    const junction = env.app.repository
      .getInstancesOf("UMLPseudostate")
      .find((p) => p.kind === "choice")!;
    junction.kind = "junction";
    // A transition to a vertex outside the machine is left out.
    const t = env.app.repository.getInstancesOf("UMLTransition")[0]!;
    t.target = create("UMLState") as never;
    const out = derive(
      get(m.model._id),
      standard(),
      new Set(["sequence", "statemachine"]),
    );
    expect(out.map((d) => d.name)).toEqual(["Checkout", "Idle", "Order life"]);
    const states = (out[2]!.spec as { states: { type: string }[] }).states;
    expect(states.filter((s) => s.type === "choice")).toHaveLength(1);
    expect(
      (out[2]!.spec as { transitions: unknown[] }).transitions,
    ).toHaveLength(5);
  });

  it("reads tuples as objects, whatever they hold (property)", async () => {
    const m = await model();
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 5 }),
        (link) => {
          (get(m.model._id).tags as Element[])[0]!.value = JSON.stringify({
            erd: { entities: [], relationships: [link] },
          });
          const [erd] = derive(get(m.model._id), standard(), new Set(["erd"]));
          const rel = (erd!.spec as { relationships: Record<string, string>[] })
            .relationships[0]!;
          expect(rel.from).toBe(link[0]);
          expect(rel.to).toBe(link[1]);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("the ThingsBoard acceptance (mock)", () => {
  it("builds the model and derives every kind of the validation in two calls, then nothing changes", async () => {
    const m = await model(tb as unknown as Record<string, unknown>);
    const out = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
    });
    const kinds = new Map<string, number>();
    for (const d of out.diagrams)
      kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
    expect(Object.fromEntries(kinds)).toEqual({
      package: 1,
      class: 6,
      sequence: 5,
      usecase: 4,
      statemachine: 3,
      activity: 1,
      erd: 1,
      c4: 1,
      deployment: 2,
      mindmap: 1,
    });
    const again = await ok<Derived>(ep("/derive_diagrams"), {
      scope: m.model._id,
    });
    expect(again.counts).toMatchObject({ created: 0, deleted: 0 });
    // Responsibilities are documentation.
    const tenant = env.app.repository
      .getInstancesOf("UMLClass")
      .find((c) => c.name === "Tenant")!;
    expect(String(tenant.documentation)).toMatch(/^Isolation boundary/);
  }, 60_000);
});

describe("derived specs (golden)", () => {
  /** What derive answers, ids replaced by paths so the file is stable. */
  const golden = (d: ReturnType<typeof derive>) =>
    JSON.stringify(
      d.map((x) => ({
        kind: x.kind,
        name: x.name,
        parent: pathOf(x.parent),
        spec: x.spec,
        bind: [...x.bind].map(([k, e]) => [k, e.constructor.name, pathOf(e)]),
        bindEdges: [...x.bindEdges].map(([i, e]) => [
          i,
          e.constructor.name,
          String(e.name),
        ]),
        accessorsOnly: x.accessorsOnly.map((e) => pathOf(e)),
      })),
      null,
      1,
    );
  const all = new Set([...DERIVED_KINDS]);
  const by = (policy: Partial<Profile["policy"]>): Profile => ({
    ...standard(),
    policy: { ...standard().policy, ...policy },
  });

  it.each([
    ["shop", SHOP, standard()],
    [
      "shop-per-package",
      SHOP,
      by({ classDiagrams: "perPackage", neighbours: false, hideGetters: true }),
    ],
    ["thingsboard", tb, standard()],
    [
      "thingsboard-per-package",
      tb,
      by({ classDiagrams: "perPackage", packageOverview: false }),
    ],
  ] as const)("%s", async (label, spec, profile) => {
    const m = await model(spec as unknown as Record<string, unknown>);
    await expect(
      golden(derive(get(m.model._id), profile, all)),
    ).toMatchFileSnapshot(`../../fixtures/domains/${label}.derived.json`);
  });
});
