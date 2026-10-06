import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../../src/errors.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const endpoint = (path: string) => endpoints.find((e) => e.path === path)!;
const apply = endpoint("/apply_pattern");
const detect = endpoint("/detect_patterns");
const list = endpoint("/list_patterns");
const describePattern = endpoint("/describe_pattern");
const preset = endpoint("/apply_preset");
const describeType = endpoint("/describe_type");
const lint = endpoint("/uml_lint");
const createElement = endpoint("/create_element");
const addOperation = endpoint("/add_operation");
const addAttribute = endpoint("/add_attribute");

beforeEach(() => {
  env = installMockApp();
});

const get = (id: string) => env.app.repository.get(id)! as Element;
const cls = async (name: string, type = "UMLClass", parent?: string) =>
  ok<{ _id: string }>(createElement, {
    type,
    parent: parent ?? env.model._id,
    name,
  });

interface Applied {
  roles: Record<string, { _id: string; path: string; created: boolean }[]>;
  created: number;
  updated: number;
  unchanged: number;
  changes: { updated: { path: string; fields: string[] }[] };
  properties: { path: string; field: string; value: unknown }[];
  warnings?: string[];
  diagram?: string;
}

describe("/list_patterns and /describe_pattern", () => {
  it("lists the library by category, with roles, variants and sequences", async () => {
    const all = await ok<{
      count: number;
      patterns: {
        name: string;
        roles: string[];
        variants: string[];
        sequence: boolean;
      }[];
    }>(list, {});
    expect(all.count).toBe(30);
    expect(all.patterns.find((p) => p.name === "Strategy")).toEqual({
      name: "Strategy",
      category: "behavioral",
      intent: expect.any(String),
      roles: ["Context", "Strategy", "ConcreteStrategy*"],
      variants: ["abstract-class"],
      sequence: true,
    });
    expect(all.patterns.find((p) => p.name === "Adapter")!.roles).toContain(
      "Client?",
    );
    const domain = await ok<{ count: number }>(list, { category: "domain" });
    expect(domain.count).toBe(7);
  });

  it("describes a pattern or one of its variants by any spelling of its name", async () => {
    const strategy = await ok<{
      name: string;
      roles: { name: string; type: string }[];
      $schema?: string;
    }>(describePattern, { name: "strategy", variant: "abstract-class" });
    expect(strategy.$schema).toBeUndefined();
    expect(strategy.roles[1]).toMatchObject({
      name: "Strategy",
      type: "UMLClass",
    });
    await ok(describePattern, { name: "factory-method" });
    await fails(
      describePattern,
      { name: "Nope" },
      "NOT_FOUND",
      "No pattern Nope; /list_patterns lists 30",
    );
    await fails(
      describePattern,
      { name: "Strategy", variant: "x" },
      "INVALID_ARGUMENT",
      "variant: Strategy has the variants abstract-class, not x",
    );
    await fails(
      describePattern,
      { name: "Bridge", variant: "x" },
      "INVALID_ARGUMENT",
      "variant: Bridge has no variants, not x",
    );
  });
});

describe("/apply_pattern bindings", () => {
  it("binds roles to existing elements by path, to new names and to lists", async () => {
    const pay = await cls("PaymentContext");
    await cls("Card");
    const applied = await ok<Applied>(apply, {
      pattern: "Strategy",
      bindings: {
        Context: "Model/PaymentContext",
        Strategy: { new: { name: "PaymentMethod" } },
        ConcreteStrategy: ["Card", "Cash"],
      },
    });
    expect(applied.roles.Context).toEqual([
      { _id: pay._id, path: "Model/PaymentContext", created: false },
    ]);
    expect(
      applied.roles.ConcreteStrategy!.map((r) => [r.path, r.created]),
    ).toEqual([
      ["Model/Card", false],
      ["Model/Cash", true],
    ]);
    const method = get(applied.roles.Strategy![0]!._id);
    expect(method.constructor.name).toBe("UMLInterface");
    // Documentation templates name what is bound.
    expect(get(pay._id).documentation).toBe(
      "PaymentContext delegates the varying algorithm to a PaymentMethod.",
    );
    expect(applied.properties).toContainEqual({
      path: "Model/PaymentContext",
      field: "documentation",
      value:
        "PaymentContext delegates the varying algorithm to a PaymentMethod.",
    });
    // A type of a role is that role's element.
    const setStrategy = (get(pay._id).operations as Element[]).find(
      (o) => o.name === "setStrategy",
    )!;
    expect((setStrategy.parameters as Element[])[0]!.type).toBe(method);
  });

  it("keeps existing documentation, sets what differs on existing members and warns of a type that differs", async () => {
    const target = await cls("Target");
    get(target._id).documentation = "Mine.";
    await ok(addOperation, {
      ref: target._id,
      name: "request",
      visibility: "private",
    });
    const applied = await ok<Applied>(apply, {
      pattern: "Adapter",
      bindings: { Target: "Target" },
    });
    expect(get(target._id).documentation).toBe("Mine.");
    expect(applied.warnings).toEqual([
      "Target is an interface in Adapter; Model/Target is a UMLClass: it is made abstract, and realizations of it are generalizations",
    ]);
    expect(get(target._id).isAbstract).toBe(true);
    expect(applied.changes.updated).toContainEqual({
      path: "Model/Target#request()",
      type: "UMLOperation",
      fields: ["isAbstract"],
    });
    const again = await ok<Applied>(apply, {
      pattern: "Adapter",
      bindings: { Target: "Target", Adapter: "Adapter", Adaptee: "Adaptee" },
    });
    expect(again.created).toBe(0);
    expect(again.updated).toBe(0);
  });

  it("refuses bindings that do not fit the pattern", async () => {
    await cls("A");
    await cls("B");
    await fails(
      apply,
      { pattern: "Strategy", bindings: { Nope: "A" } },
      "INVALID_ARGUMENT",
      "bindings.Nope: Strategy has the roles Context, Strategy, ConcreteStrategy",
    );
    await fails(
      apply,
      { pattern: "Strategy", bindings: { Context: ["A", "B"] } },
      "INVALID_ARGUMENT",
      "bindings.Context: the role takes one element, got 2",
    );
    await fails(
      apply,
      { pattern: "Strategy", bindings: { Context: "Model/Nothing" } },
      "NOT_FOUND",
      /^bindings\.Context: nothing at Model\/Nothing/,
    );
    await fails(
      apply,
      { pattern: "Strategy", bindings: { Context: "Model" } },
      "INVALID_ARGUMENT",
      "bindings.Context: Model is a UMLModel, not a classifier",
    );
    await fails(
      apply,
      { pattern: "Bridge", sequence: true },
      "INVALID_ARGUMENT",
      "sequence: Bridge has no sequence",
    );
    // A new element named like one the parent has.
    await cls("Context");
    await fails(
      apply,
      { pattern: "State", bindings: { Context: { new: { name: "Context" } } } },
      "DUPLICATE_NAME",
    );
    const upserted = await ok<Applied>(apply, {
      pattern: "State",
      bindings: { Context: { new: { name: "Context" } } },
      upsert: true,
    });
    expect(upserted.roles.Context![0]!.created).toBe(false);
  });

  it("shows the pattern on an existing class diagram, once", async () => {
    const first = await ok<Applied>(apply, {
      pattern: "Proxy",
      diagram: env.mainDiagram._id,
    });
    expect(first.diagram).toBe(env.mainDiagram._id);
    const views = () => (env.mainDiagram.ownedViews as Element[]).length;
    const before = views();
    expect(before).toBeGreaterThan(3);
    await ok<Applied>(apply, {
      pattern: "Proxy",
      diagram: env.mainDiagram._id,
      bindings: {
        Subject: "Subject",
        RealSubject: "RealSubject",
        Proxy: "Proxy",
      },
    });
    expect(views()).toBe(before);
    const seq = await ok<{ diagram: { _id: string } }>(
      endpoint("/build_diagram"),
      {
        kind: "sequence",
        spec: { messages: [{ from: "A", to: "B" }] },
      },
    );
    await fails(
      apply,
      { pattern: "Proxy", diagram: seq.diagram._id },
      "INVALID_ARGUMENT",
      /is a UMLSequenceDiagram, not a class diagram$/,
    );
  });

  it("needs a model for new elements when given no parent", async () => {
    env.project.ownedElements = [];
    await fails(
      apply,
      { pattern: "Singleton" },
      "NOT_FOUND",
      "The project has no model; pass parent",
    );
    const pkg = await ok<{ _id: string }>(createElement, {
      type: "UMLModel",
      parent: env.project._id,
      name: "Other",
    });
    const applied = await ok<Applied>(apply, {
      pattern: "Singleton",
      parent: pkg._id,
      bindings: { Singleton: "Config" },
    });
    expect(applied.roles.Singleton![0]!.path).toBe("Other/Config");
  });

  // Property: whatever is bound, apply_pattern answers or refuses with an
  // error code of the contract; nothing else escapes.
  it("answers any bindings with a result or a contract error", async () => {
    await cls("Exists");
    const value = fc.oneof(
      fc.constantFrom(
        "Exists",
        "Model/Exists",
        "Model",
        "Model/Missing",
        "Fresh",
        "@current",
      ),
      fc.string({ maxLength: 6 }),
      fc.record({
        new: fc.record({ name: fc.string({ minLength: 1, maxLength: 6 }) }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.constantFrom("Context", "Strategy", "ConcreteStrategy", "Other"),
          fc.oneof(value, fc.array(value, { maxLength: 3 })),
        ),
        fc.boolean(),
        async (bindings, upsert) => {
          const res = await apply.handler({
            pattern: "Strategy",
            bindings,
            upsert,
            dryRun: true,
          });
          if (!res.success) expect(ERROR_CODES).toContain(res.code);
          else
            expect(Object.keys((res.data as Applied).roles)).toEqual([
              "Context",
              "Strategy",
              "ConcreteStrategy",
            ]);
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  // Property: a pattern applied under any names is detected back whole.
  it("detects Strategy back under any names it is applied with", async () => {
    const name = fc.stringMatching(/^[A-Z][a-z]{2,6}$/);
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(name, { minLength: 4, maxLength: 5 }),
        async ([c, s, ...concrete]) => {
          env = installMockApp();
          await ok<Applied>(apply, {
            pattern: "Strategy",
            bindings: { Context: c!, Strategy: s!, ConcreteStrategy: concrete },
          });
          const found = await ok<{
            detections: { pattern: string; confidence: number }[];
          }>(detect, { patterns: ["Strategy"] });
          expect(found.detections[0]).toMatchObject({
            pattern: "Strategy",
            confidence: 1,
          });
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe("/detect_patterns", () => {
  it("scores a partial instance and lists what is missing, within a scope", async () => {
    const pkg = await ok<{ _id: string }>(createElement, {
      type: "UMLPackage",
      parent: env.model._id,
      name: "P",
    });
    await ok(apply, { pattern: "Observer", parent: pkg._id });
    const subject = (
      await ok<{ elements: { _id: string; name: string }[] }>(
        endpoint("/find_elements"),
        { type: "UMLClass", name: "Subject" },
      )
    ).elements[0]!;
    get(subject._id).isAbstract = false;
    const found = await ok<{
      count: number;
      detections: { pattern: string; confidence: number; missing: string[] }[];
    }>(detect, {
      scope: pkg._id,
      patterns: ["Observer"],
    });
    expect(found.detections[0]!.confidence).toBeLessThan(1);
    expect(found.detections[0]!.missing).toContain(
      "Model/P/Subject.isAbstract is not true",
    );
    const elsewhere = await ok<{ count: number }>(detect, {
      scope: env.mainDiagram._id,
    });
    expect(elsewhere.count).toBe(0);
    const limited = await ok<{ count: number; detections: unknown[] }>(detect, {
      minConfidence: 0,
      limit: 1,
    });
    expect(limited.detections).toHaveLength(1);
    expect(limited.count).toBeGreaterThan(1);
  });

  it("matches associations drawn either way round and abstract classes in interface roles", async () => {
    const a = await cls("Ctx");
    const s = await cls("Algo");
    get(s._id).isAbstract = true;
    const c = await cls("Impl");
    await ok(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: s._id,
      head: a._id,
    });
    await ok(endpoint("/create_relationship"), {
      type: "UMLGeneralization",
      tail: c._id,
      head: s._id,
    });
    const found = await ok<{
      detections: {
        pattern: string;
        variant?: string;
        roles: Record<string, { _id: string }[]>;
      }[];
    }>(detect, {
      patterns: ["Strategy"],
      minConfidence: 0.3,
    });
    const d = found.detections.find(
      (x) => x.roles.Context?.[0]?._id === a._id,
    )!;
    expect(d.roles.Strategy![0]!._id).toBe(s._id);
  });
});

describe("uml_lint U013 pattern-consistency", () => {
  it("reports a detected pattern that breaks its pattern's rules", async () => {
    const singleton = await ok<Applied>(apply, {
      pattern: "Singleton",
      bindings: { Singleton: "Registry" },
    });
    const registry = get(singleton.roles.Singleton![0]!._id);
    (registry.operations as Element[]).find(
      (o) => o.name === "Registry",
    )!.visibility = "public";
    const composite = await ok<Applied>(apply, { pattern: "Composite" });
    const whole = get(composite.roles.Composite![0]!._id);
    const assoc = env.app.repository
      .getRelationshipsOf(whole as never)
      .find((r) => r.constructor.name === "UMLAssociation")!;
    (assoc.end1 as Element).aggregation = "none";
    const value = await ok<Applied>(apply, {
      pattern: "Value Object",
      bindings: { ValueObject: "Money" },
    });
    await ok(addAttribute, {
      ref: value.roles.ValueObject![0]!._id,
      name: "amount",
      type: "int",
    });
    const findings = await ok<{
      findings: {
        rule: string;
        message: string;
        path: string | null;
        fix: string;
      }[];
    }>(lint, {
      rules: {
        U001: "off",
        U002: "off",
        U003: "off",
        U005: "off",
        U006: "off",
      },
    });
    const u13 = findings.findings.filter((f) => f.rule === "U013");
    expect(u13.map((f) => [f.path, f.message])).toEqual(
      expect.arrayContaining([
        [
          "Model/Registry#Registry()",
          "Singleton (Singleton): A singleton's constructor is private, so no other class can make a second instance.",
        ],
        [
          "Model/Composite//",
          "Composite (Composite): A composite owns its children: the association from it to its components is a composition.",
        ],
        [
          "Model/Money.amount",
          "Value Object (ValueObject): A value object is immutable: every attribute is read only and it has no setters.",
        ],
      ]),
    );
    expect(u13[0]!.fix).toMatch(/^Set /);
    const off = await ok<{ findings: { rule: string }[] }>(lint, {
      rules: { U013: "off" },
    });
    expect(off.findings.some((f) => f.rule === "U013")).toBe(false);
  });
});

describe("/apply_preset", () => {
  it("sets the properties of each kind on the element and its members", async () => {
    const money = await cls("Money");
    await ok(addAttribute, { ref: money._id, name: "amount", type: "int" });
    await ok(addOperation, { ref: money._id, name: "setAmount" });
    await ok(addOperation, { ref: money._id, name: "Money" });
    const value = await ok<{
      properties: { path: string; field: string; value: unknown }[];
      warnings: string[];
      description: string;
    }>(preset, {
      ref: money._id,
      preset: "value-object",
    });
    expect(get(money._id)).toMatchObject({
      isLeaf: true,
      stereotype: "valueObject",
    });
    const amount = (get(money._id).attributes as Element[])[0]!;
    expect(amount).toMatchObject({ isReadOnly: true, visibility: "private" });
    const [setter, ctor] = get(money._id).operations as Element[];
    expect(setter!.isQuery).toBe(true);
    expect(ctor!.isQuery).toBe(false);
    expect(value.warnings).toEqual([
      "Model/Money#setAmount() looks like a setter, which a value-object has none of",
    ]);
    expect(value.properties).toContainEqual({
      path: "Model/Money.amount",
      field: "isReadOnly",
      value: true,
    });

    const user = await cls("User");
    await ok(preset, { ref: user._id, preset: "entity" });
    expect((get(user._id).attributes as Element[])[0]).toMatchObject({
      name: "id",
      isID: true,
      isReadOnly: true,
    });
    const util = await cls("Strings");
    await ok(addOperation, { ref: util._id, name: "trim" });
    const dry = await ok<{ dryRun: boolean; plan: { ops: unknown[] } }>(
      preset,
      { ref: util._id, preset: "static-utility", dryRun: true },
    );
    expect(dry.dryRun).toBe(true);
    expect(get(util._id).isLeaf).toBe(false);
    await ok(preset, { ref: util._id, preset: "static-utility" });
    const ops = get(util._id).operations as Element[];
    expect(ops.map((o) => [o.name, o.isStatic, o.visibility])).toEqual([
      ["trim", true, "public"],
      ["Strings", false, "private"],
    ]);
    await ok(preset, { ref: util._id, preset: "abstract" });
    expect(get(util._id).isAbstract).toBe(true);
    await ok(preset, { ref: user._id, preset: "immutable" });
    const port = await cls("Port", "UMLInterface");
    await ok(addOperation, { ref: port._id, name: "send" });
    await ok(addAttribute, { ref: port._id, name: "MAX" });
    await ok(preset, { ref: port._id, preset: "interface" });
    expect((get(port._id).operations as Element[])[0]).toMatchObject({
      isAbstract: true,
    });
    expect((get(port._id).attributes as Element[])[0]).toMatchObject({
      isStatic: true,
      isReadOnly: true,
    });
    const color = await cls("Color", "UMLEnumeration");
    await ok(preset, { ref: color._id, preset: "enum" });
    expect(get(color._id).isLeaf).toBe(true);
    const nothing = await ok<{ changes: { updated: unknown[] } }>(preset, {
      ref: color._id,
      preset: "enum",
    });
    expect(nothing.changes.updated).toEqual([]);
    await fails(
      preset,
      { ref: color._id, preset: "entity" },
      "INVALID_ARGUMENT",
      "entity applies to UMLClass; " + color._id + " is a UMLEnumeration",
    );
  });
});

describe("/describe_type", () => {
  it("lists a type's properties with their meaning and allowed values", async () => {
    const op = await ok<{
      supers: string[];
      properties: {
        name: string;
        allowed?: string[];
        meaning?: string;
        declaredBy: string;
        default?: unknown;
      }[];
    }>(describeType, { type: "UMLOperation" });
    expect(op.supers[0]).toBe("UMLBehavioralFeature");
    const query = op.properties.find((p) => p.name === "isQuery")!;
    expect(query).toMatchObject({
      declaredBy: "UMLOperation",
      meaning: "The operation changes no state (a side-effect-free query).",
      default: false,
    });
    expect(op.properties.find((p) => p.name === "visibility")!.allowed).toEqual(
      ["public", "protected", "private", "package"],
    );
    const end = await ok<{
      properties: { name: string; allowed?: string[] }[];
    }>(describeType, { type: "UMLAssociationEnd" });
    expect(end.properties.find((p) => p.name === "navigable")!.allowed).toEqual(
      ["unspecified", "navigable", "notNavigable"],
    );
    expect(
      end.properties.find((p) => p.name === "multiplicity")!.allowed,
    ).toEqual(expect.arrayContaining(["0..1"]));
    await fails(describeType, { type: "Nope" }, "UNKNOWN_TYPE");
    await fails(
      describeType,
      { type: "UMLVisibilityKind" },
      "UNKNOWN_TYPE",
      "UMLVisibilityKind is not a metamodel class; /search_types finds one",
    );
  });
});
