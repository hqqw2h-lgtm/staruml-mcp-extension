import { beforeEach, describe, expect, it } from "vitest";
import { fill, planPattern } from "../../../src/patterns/apply.js";
import { detect, score, violations } from "../../../src/patterns/detect.js";
import type { Pattern } from "../../../src/patterns/schema.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

// The engine's edge cases, on patterns written for them rather than the
// library's.

let env: MockEnvironment;
const endpoint = (path: string) => endpoints.find((e) => e.path === path)!;
const create = endpoint("/create_element");
const relate = endpoint("/create_relationship");
const addOperation = endpoint("/add_operation");
const addAttribute = endpoint("/add_attribute");
const apply = endpoint("/apply_pattern");
const preset = endpoint("/apply_preset");
const describeType = endpoint("/describe_type");

beforeEach(() => {
  env = installMockApp();
});

const get = (id: string) => env.app.repository.get(id)! as Element;
const cls = async (name: string, type = "UMLClass") =>
  get(
    (await ok<{ _id: string }>(create, { type, parent: env.model._id, name }))
      ._id,
  );

const role = (name: string, more: Partial<Pattern["roles"][number]> = {}) => ({
  name,
  type: "UMLClass" as const,
  cardinality: "1" as const,
  description: "",
  ...more,
});

describe("templates", () => {
  it("leaves a placeholder naming no bound role as written", () => {
    expect(fill("{A} and {B}", new Map([["A", "x"]]))).toBe("x and {B}");
  });
});

describe("planning", () => {
  it("writes a type naming a role nothing plays as text", () => {
    const pattern: Pattern = {
      name: "T",
      category: "domain",
      intent: "t",
      roles: [
        role("A", { attributes: [{ name: "helper", type: "{Opt}" }] }),
        role("Opt", { optional: true }),
      ],
      relationships: [],
    };
    const plan = planPattern(pattern, {
      bindings: {},
      parent: env.model,
      upsert: false,
    });
    expect(
      plan.ops.find((o) => o.path === "/add_attribute")!.body,
    ).toMatchObject({
      name: "helper",
      type: "{Opt}",
    });
    expect(plan.roles.Opt).toEqual([]);
  });
});

describe("scoring", () => {
  it("reads stereotypes given as elements, types as text and members a binding lacks", async () => {
    const a = await cls("A");
    const b = await cls("B", "UMLInterface");
    const plain = await cls("Plain");
    a.stereotype = { name: "entity" } as unknown as string;
    await ok(addAttribute, { ref: a._id, name: "label", type: "String" });
    await ok(addAttribute, { ref: a._id, name: "other", type: "Thing" });
    await ok(addAttribute, { ref: a._id, name: "link", type: { $ref: b._id } });
    await ok(addOperation, { ref: a._id, name: "run" });
    (a.operations as Element[])[0]!.stereotype = {
      name: "create",
    } as unknown as string;
    const pattern: Pattern = {
      name: "T",
      category: "domain",
      intent: "t",
      roles: [
        role("A", {
          stereotype: "entity",
          attributes: [
            { name: "label", type: "String" },
            { name: "other", type: "{B}" },
            { name: "link", type: "B" },
          ],
          operations: [{ name: "run", stereotype: "create" }],
        }),
        role("B", { type: "UMLInterface", optional: true }),
        role("C"),
        role("D", { type: "UMLInterface" }),
      ],
      relationships: [
        { type: "dependency", from: "A", to: "C" },
        { type: "dependency", from: "C", to: "A" },
      ],
      checks: [
        {
          id: "c",
          role: "C",
          property: "isAbstract",
          equals: true,
          message: "m",
        },
        {
          id: "r",
          role: "A",
          relationship: 0,
          property: "name",
          equals: "x",
          message: "m",
        },
      ],
    };
    const s = score(
      pattern,
      new Map([
        ["A", [a]],
        ["D", [plain]],
      ]),
    );
    expect(s.missing).toEqual([
      // {B} names a role nothing plays.
      "Model/A.other type is not {B}",
      "nothing plays C",
      "Model/Plain is a UMLClass, not a UMLInterface",
      "no dependency from A to C",
      "no dependency from C to A",
    ]);
    // A role absent from the binding fails no check of its own, nor one
    // over a relationship to it.
    expect(violations(pattern, new Map([["A", [a]]]))).toEqual([]);
  });

  it("finds each instance once whichever role it starts from", async () => {
    const a = await cls("P");
    const b = await cls("Q");
    await ok(relate, { type: "UMLAssociation", tail: a._id, head: b._id });
    await ok(relate, { type: "UMLAssociation", tail: b._id, head: a._id });
    const pattern: Pattern = {
      name: "Pair",
      category: "domain",
      intent: "t",
      roles: [role("X"), role("Y")],
      relationships: [{ type: "association", from: "X", to: "Y" }],
    };
    const found = detect(pattern, [a, b], 0.5);
    expect(found).toHaveLength(2);
    // A member type given as text leads nowhere.
    const typed: Pattern = {
      ...pattern,
      roles: [
        role("X", { attributes: [{ name: "y", type: "{Y}" }] }),
        role("Y"),
      ],
      relationships: [],
    };
    await ok(addAttribute, { ref: a._id, name: "y", type: "Q" });
    expect(detect(typed, [a, b], 0)[0]!.roles.Y).toEqual([]);
  });

  it("checks a relationship's ends however the association was drawn", async () => {
    const whole = await cls("W");
    const part = await cls("V");
    // Drawn from the part, so the whole is end2.
    await ok(relate, {
      type: "UMLAssociation",
      tail: part._id,
      head: whole._id,
      headEnd: { aggregation: "composite" },
    });
    const pattern: Pattern = {
      name: "Whole",
      category: "domain",
      intent: "t",
      roles: [role("W"), role("V")],
      relationships: [{ type: "composition", from: "W", to: "V" }],
      checks: [
        {
          id: "a",
          role: "W",
          relationship: 0,
          end: "from",
          property: "aggregation",
          equals: "composite",
          message: "whole",
        },
        {
          id: "b",
          role: "W",
          relationship: 0,
          end: "to",
          property: "aggregation",
          equals: "composite",
          message: "part",
        },
        {
          id: "c",
          role: "W",
          relationship: 0,
          property: "name",
          equals: "has",
          message: "named",
        },
      ],
    };
    const binding = new Map([
      ["W", [whole]],
      ["V", [part]],
    ]);
    expect(score(pattern, binding).missing).toEqual([]);
    expect(violations(pattern, binding).map((v) => v.check.id)).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("apply_pattern on existing members", () => {
  it("adds parameters and return types an existing operation lacks, and sets those that differ", async () => {
    const ctx = await cls("Ctx");
    await ok(addOperation, {
      ref: ctx._id,
      name: "setStrategy",
      parameters: [{ name: "x", type: "int" }],
    });
    const builder = await cls("Make", "UMLInterface");
    await ok(addOperation, { ref: builder._id, name: "getResult" });
    await ok(addOperation, {
      ref: builder._id,
      name: "buildPart",
      returnType: "int",
    });
    const strategy = await ok<{ changes: { created: { path: string }[] } }>(
      apply,
      {
        pattern: "Strategy",
        bindings: { Context: "Ctx" },
      },
    );
    expect(strategy.changes.created.map((c) => c.path)).toContain(
      "Model/Ctx#setStrategy().strategy",
    );
    const set = (ctx.operations as Element[])[0]!;
    expect((set.parameters as Element[]).map((p) => p.name)).toEqual([
      "x",
      "strategy",
    ]);
    // Bound again with the parameter typed otherwise: the type is set back.
    (set.parameters as Element[])[1]!.type = "int";
    const again = await ok<{
      changes: { updated: { path: string; fields: string[] }[] };
    }>(apply, {
      pattern: "Strategy",
      bindings: {
        Context: "Ctx",
        Strategy: "Strategy",
        ConcreteStrategy: "ConcreteStrategy",
      },
    });
    expect(again.changes.updated).toContainEqual({
      path: "Model/Ctx#setStrategy().strategy",
      type: "UMLParameter",
      fields: ["type"],
    });
    const built = await ok<{
      changes: {
        created: { path: string }[];
        updated: { path: string; fields: string[] }[];
      };
    }>(apply, {
      pattern: "Builder",
      bindings: { Builder: "Make" },
    });
    expect(built.changes.created.map((c) => c.path)).toContain(
      "Model/Make#getResult().return",
    );
    // Its return typed otherwise: bound again, the type is set back.
    const getResult = (builder.operations as Element[]).find(
      (o) => o.name === "getResult",
    )!;
    const ret = (getResult.parameters as Element[]).find(
      (x) => x.direction === "return",
    )!;
    ret.type = "int";
    const rebuilt = await ok<{
      changes: { updated: { path: string; fields: string[] }[] };
    }>(apply, {
      pattern: "Builder",
      bindings: {
        Builder: "Make",
        Director: "Director",
        ConcreteBuilder: "ConcreteBuilder",
        Product: "Product",
      },
    });
    expect(rebuilt.changes.updated).toContainEqual({
      path: "Model/Make#getResult().return",
      type: "UMLParameter",
      fields: ["type"],
    });
    void builder;
  });

  it("sets the ends of an existing relationship the pattern describes otherwise", async () => {
    const first = await ok<{ roles: Record<string, { _id: string }[]> }>(
      apply,
      { pattern: "Strategy" },
    );
    const ctx = get(first.roles.Context![0]!._id);
    const assoc = env.app.repository
      .getRelationshipsOf(ctx as never)
      .find((r) => r.constructor.name === "UMLAssociation")!;
    (assoc.end2 as Element).navigable = "unspecified";
    const bindings = {
      Context: "Context",
      Strategy: "Strategy",
      ConcreteStrategy: "ConcreteStrategy",
    };
    const again = await ok<{
      unchanged: number;
      changes: { updated: { path: string; fields: string[] }[] };
    }>(apply, { pattern: "Strategy", bindings });
    expect(again.changes.updated).toEqual([
      {
        path: "Model/Context -> Model/Strategy.end2",
        type: "UMLAssociationEnd",
        fields: ["navigable"],
      },
    ]);
    const third = await ok<{ updated: number }>(apply, {
      pattern: "Strategy",
      bindings,
    });
    expect(third.updated).toBe(0);
  });

  it("refuses a parent that is not a package", async () => {
    await fails(
      apply,
      { pattern: "Singleton", parent: env.project._id },
      "INVALID_ARGUMENT",
      /^parent: new elements go in a model or package; .+ is a Project$/,
    );
    const a = await cls("Host");
    await fails(
      apply,
      { pattern: "Singleton", parent: a._id },
      "INVALID_ARGUMENT",
      "parent: new elements go in a model or package; Model/Host is a UMLClass",
    );
  });
});

describe("presets and types, edge cases", () => {
  it("knows a constructor by its stereotype element", async () => {
    const a = await cls("Tool");
    await ok(addOperation, { ref: a._id, name: "make" });
    (a.operations as Element[])[0]!.stereotype = {
      name: "create",
    } as unknown as string;
    await ok(preset, { ref: a._id, preset: "static-utility" });
    expect((a.operations as Element[])[0]!.isStatic).toBe(false);
    // A preset without member properties leaves the members alone.
    await ok(addAttribute, { ref: a._id, name: "count", type: "int" });
    await ok(preset, { ref: a._id, preset: "abstract" });
    expect((a.attributes as Element[])[0]!.isStatic).toBe(false);
  });

  it("describes a type whose ancestors declare no attributes of their own", async () => {
    const saved = meta.UMLModelElement!.attributes;
    meta.UMLModelElement!.attributes = undefined;
    try {
      const actor = await ok<{ properties: { declaredBy: string }[] }>(
        describeType,
        { type: "UMLActor" },
      );
      expect(actor.properties.map((p) => p.declaredBy)).toContain(
        "UMLClassifier",
      );
    } finally {
      meta.UMLModelElement!.attributes = saved;
    }
  });
});
