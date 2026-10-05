import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { parseModelSpec } from "../../../src/model/spec.js";
import { endpoints } from "../../../src/routes.js";
import {
  namingKindOf,
  normalizeModelSpec,
  normalizeOps,
  offProfile,
  Renames,
  styleReport,
  styleViews,
} from "../../../src/style/apply.js";
import { profiled } from "../../../src/style/authoring.js";
import { trusted } from "../../../src/style/guard.js";
import { builtInProfiles } from "../../../src/style/profile.js";
import { serialize } from "../../../src/serialize.js";
import type { Element, View } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;
const standard = () => builtInProfiles()["uml-standard"]!;

beforeEach(() => {
  env = installMockApp();
});

describe("naming in authoring", () => {
  it("knows the rule of each model type", () => {
    expect(namingKindOf("UMLDataType")).toBe("classifier");
    expect(namingKindOf("UMLOperation")).toBe("operation");
    expect(namingKindOf("UMLEnumerationLiteral")).toBe("literal");
    expect(namingKindOf("UMLUseCase")).toBe("usecase");
    expect(namingKindOf("UMLPackage")).toBe("package");
    expect(namingKindOf("UMLActor")).toBeNull();
  });

  it("normalises a build's names before it runs, so an upsert finds them again", async () => {
    const spec = {
      packages: ["billing"],
      classes: [
        {
          name: "order line",
          package: "billing",
          attributes: ["+Total: int", "+MAX_LINES: int$"],
          operations: ["+Place(): void"],
        },
        { name: "OrderLine" },
        { name: "Status", kind: "enum", literals: ["new", "Billing::Paid"] },
        { name: "Big\nBox" },
      ],
    };
    const first = await ok<{
      style: { renamed: { from: string; to: string }[] };
      ids: Record<string, { model: string }>;
    }>(ep("/build_diagram"), {
      kind: "class",
      name: "N",
      result: "ids",
      spec,
    });
    expect(first.style.renamed).toEqual([
      { kind: "classifier", from: "order line", to: "OrderLine" },
      { kind: "attribute", from: "Total", to: "total" },
      { kind: "operation", from: "Place", to: "place" },
      { kind: "literal", from: "new", to: "NEW" },
      { kind: "literal", from: "Billing::Paid", to: "BILLING_PAID" },
    ]);
    const names = env.app.repository
      .getInstancesOf("UMLClass")
      .map((c) => c.name)
      .sort();
    // The renamed class does not take the name of the one already written so.
    expect(names).toEqual(["Big\nBox", "OrderLine", "OrderLine2"]);
    const again = await ok<{ created: number; upserted: boolean }>(
      ep("/build_diagram"),
      { kind: "class", name: "N", upsert: true, spec },
    );
    expect(again).toMatchObject({ upserted: true, created: 0 });
  });

  it("leaves requirement and ERD names to their notations", async () => {
    const built = await ok<{ style: Record<string, unknown> }>(
      ep("/build_diagram"),
      {
        kind: "erd",
        spec: { entities: [{ name: "order_line", columns: ["id int PK"] }] },
      },
    );
    expect(built.style).toEqual({ profile: "uml-standard" });
  });

  it("normalises a model spec and makes references follow", () => {
    const spec = parseModelSpec({
      contexts: [
        { id: "bill", name: "Billing" },
        { name: "Core Stuff", parent: "bill", dependsOn: ["bill"] },
      ],
      classes: [
        {
          name: "order",
          context: "bill",
          attributes: ["+Total: int"],
          literals: [],
        },
        { name: "line_item", context: "Core Stuff", operations: ["Sum()"] },
        { name: "Kind", kind: "enum", literals: ["a"] },
      ],
      relationships: [{ from: "order", to: "line_item", type: "owns" }],
      useCases: [{ name: "pay bill", includes: ["log in"] }, "log in"],
      collaborations: [
        {
          name: "Pay",
          context: "bill",
          participants: [{ name: "order", type: "order" }, "Clerk"],
          messages: [["Clerk", "order", "pay()"]],
        },
        { name: "Idle" },
      ],
      lifecycles: [
        { name: "OrderLife", subject: "order", states: ["New"] },
        { name: "Free" },
      ],
    });
    const renames = new Renames({
      ...standard(),
      naming: {
        ...standard().naming,
        usecase: { pattern: "Verb noun", fix: "sentence" },
        package: { pattern: "lowercase", fix: "lower" },
      },
    });
    const out = normalizeModelSpec(spec, renames);
    expect(
      out.packages.map((p) => [p.key, p.name, p.parent, p.dependsOn]),
    ).toEqual([
      ["bill", "billing", undefined, []],
      ["corestuff", "corestuff", "bill", ["bill"]],
    ]);
    expect(out.classes.map((c) => [c.name, c.package])).toEqual([
      ["Order", "bill"],
      ["LineItem", "corestuff"],
      ["Kind", undefined],
    ]);
    expect(out.classes[0]!.attributes[0]!.name).toBe("total");
    expect(out.classes[1]!.operations[0]!.name).toBe("sum");
    expect(out.classes[2]!.literals).toEqual(["A"]);
    expect(out.relationships[0]).toMatchObject({
      from: "Order",
      to: "LineItem",
    });
    expect(out.useCases.map((u) => [u.name, u.includes])).toEqual([
      ["Pay bill", ["Log in"]],
      ["Log in", []],
    ]);
    expect(out.collaborations[0]!.participants[0]).toMatchObject({
      name: "Order",
      type: "Order",
    });
    expect(out.collaborations[0]!.messages[0]).toMatchObject({ to: "Order" });
    expect(out.collaborations[0]!.package).toBe("bill");
    expect(out.lifecycles[0]!.subject).toBe("Order");
    expect(out.lifecycles[1]!.subject).toBeUndefined();
  });

  it("normalises the names of ops, and leaves other ops alone", () => {
    const renames = new Renames(standard());
    const ops = normalizeOps(
      [
        {
          path: "/create_element",
          body: { type: "UMLClass", name: "my class" },
        },
        { path: "/add_attribute", body: { name: "MAX", isStatic: true } },
        { path: "/add_attribute", body: { name: "Count" } },
        { path: "/add_operation", body: { name: "run" } },
        { path: "/add_enumeration_literal", body: { name: "paid" } },
        { path: "/create_element", body: { type: "UMLClass" } },
        { path: "/update_element", body: { name: "x y" } },
      ],
      renames,
    );
    expect(ops.map((o) => o.body.name)).toEqual([
      "MyClass",
      "MAX",
      "count",
      "run",
      "PAID",
      undefined,
      "x y",
    ]);
  });

  it("reports at most fifty renames and what it cannot fix", () => {
    const renames = new Renames({
      ...standard(),
      naming: {
        ...standard().naming,
        operation: { pattern: "^do", fix: "camel" },
      },
    });
    for (let i = 0; i < 60; i++) renames.name(`op ${i}`, "classifier");
    renames.name("run", "operation");
    const report = styleReport(standard(), renames, 0);
    expect(report.renamed).toHaveLength(50);
    expect(report.unfixed).toEqual(["operation run"]);
    expect(styleReport(standard(), new Renames(standard()), 3)).toEqual({
      profile: "uml-standard",
      styled: 3,
    });
  });
});

describe("visuals", () => {
  async function shop(profile?: string) {
    if (profile) await ok(ep("/set_style_profile"), { profile });
    return ok<{
      diagram: { _id: string };
      ids: Record<string, { model: string; view: string }>;
      edges: { view: string }[];
      style: { styled?: number };
    }>(ep("/build_diagram"), {
      kind: "class",
      result: "full",
      spec: {
        classes: [
          { name: "Order", stereotype: "entity" },
          { name: "Payable", kind: "interface" },
        ],
        relations: [{ from: "Order", to: "Payable", type: "realization" }],
        styles: { Payable: { fillColor: "#123456" } },
      },
    });
  }

  it("gives a build's views the profile's look; the spec's colours win unless strict", async () => {
    const built = await shop("presentation");
    expect(built.style.styled).toBeGreaterThan(0);
    const order = get(built.ids.Order!.view);
    expect(order).toMatchObject({
      fillColor: "#fdf6e3",
      showVisibility: false,
    });
    expect((order.font as { __write(): string }).__write()).toBe("Arial;15;0");
    expect(get(built.ids.Payable!.view).fillColor).toBe("#123456");
    expect(get(built.edges[0]!.view).lineStyle).toBe(2);
    expect(
      offProfile(order as View, builtInProfiles()["presentation"]!),
    ).toEqual([]);
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    const strict = await ok<{
      ids: Record<string, { view: string }>;
      warnings: string[];
    }>(ep("/build_diagram"), {
      kind: "class",
      result: "ids",
      spec: {
        classes: [
          { name: "Ledger" },
          { name: "Port", kind: "interface" },
          { name: "Plain" },
        ],
        styles: {
          Ledger: { fillColor: "#123456" },
          Port: { fillColor: "#123456" },
        },
      },
    });
    expect(get(strict.ids.Ledger!.view).fillColor).toBe("#fdf6e3");
    // An interface keeps the box display it needs to show its operations.
    expect(get(strict.ids.Port!.view)).toMatchObject({
      fillColor: "#e8f4fd",
      stereotypeDisplay: "label",
    });
    expect(strict.warnings).toEqual([
      "the style profile is strict: the colours the spec gives 2 node(s) were not applied",
    ]);
  });

  it("styles by stereotype over kind, fonts by face, and only flags views have", async () => {
    await ok(ep("/set_style_profile"), {
      profile: "print",
      patch: {
        visuals: {
          stereotypes: {
            entity: { fillColor: "#eeeeee", stereotypeDisplay: "icon" },
          },
          show: { suppressOperations: true },
        },
      },
    });
    const built = await shop();
    const order = get(built.ids.Order!.view);
    expect(order).toMatchObject({
      fillColor: "#eeeeee",
      stereotypeDisplay: "icon",
      suppressOperations: true,
    });
    expect((order.font as { __write(): string }).__write()).toBe("Arial;12;0");
    // Applying again finds nothing to change.
    const d = get(built.diagram._id);
    const profile = {
      ...builtInProfiles()["print"]!,
      visuals: {
        ...builtInProfiles()["print"]!.visuals,
        stereotypes: {
          entity: { fillColor: "#eeeeee", stereotypeDisplay: "icon" as const },
        },
        show: { suppressOperations: true },
      },
    };
    // The interface keeps the colour its spec gave it; the rest is settled.
    const settled = (d.ownedViews as View[]).filter(
      (v) => v._id !== built.ids.Payable!.view,
    );
    expect(styleViews(d, settled, profile)).toBe(0);
    // A stereotype held as an element counts by its name; a view without a font is left alone.
    (order.model as Element).stereotype = {
      name: "entity",
    } as unknown as Element;
    order.font = null;
    expect(offProfile(order as View, profile)).toEqual([]);
    // An empty stereotype is none: the kind's look applies.
    (order.model as Element).stereotype = "";
    expect(offProfile(order as View, profile)).toEqual(["fillColor"]);
  });

  it("changes only the font face, or only the size", async () => {
    const built = await shop();
    const d = get(built.diagram._id);
    const view = get(built.ids.Order!.view) as View;
    const face = {
      ...standard(),
      visuals: {
        ...standard().visuals,
        kinds: { "*": { fontFace: "Courier" } },
      },
    };
    expect(styleViews(d, [view], face)).toBe(1);
    expect((view.font as { __write(): string }).__write()).toBe("Courier;13;0");
    const size = {
      ...standard(),
      visuals: { ...standard().visuals, kinds: { "*": { fontSize: 13 } } },
    };
    expect(styleViews(d, [view], size)).toBe(0);
  });
});

describe("/create_element_with_view and /create_edge_with_view under the profile", () => {
  it("name the element by the rules and style the view, in one call", async () => {
    await ok(ep("/set_style_profile"), { profile: "presentation" });
    const a = await ok<{
      view: { _id: string };
      model: { name: string };
      style: { renamed: unknown[]; styled: number };
    }>(ep("/create_element_with_view"), {
      type: "UMLClass",
      diagram: env.mainDiagram._id,
      name: "order line",
    });
    expect(a.model.name).toBe("OrderLine");
    expect(a.style).toMatchObject({
      renamed: [{ from: "order line", to: "OrderLine" }],
      styled: 1,
    });
    const edge = await ok<{ style: { styled: number } }>(
      ep("/create_edge_with_view"),
      {
        type: "UMLDependency",
        diagram: env.mainDiagram._id,
        tail: a.view._id,
        head: a.view._id,
      },
    );
    expect(edge.style.styled).toBe(1);
  });

  it("pass through inside the extension's own work, failures and unknown types", async () => {
    const create = ep("/create_element_with_view");
    const inner = await trusted(() =>
      ok<Record<string, unknown>>(create, {
        type: "UMLClass",
        diagram: env.mainDiagram._id,
        name: "lower",
      }),
    );
    expect(inner.style).toBeUndefined();
    await fails(
      create,
      { type: "NoSuchType", diagram: env.mainDiagram._id, name: "x" },
      "UNKNOWN_TYPE",
    );
    await fails(create, { type: "UMLClass" }, "INVALID_ARGUMENT");
    await fails(create, { name: "x" }, "INVALID_ARGUMENT");
    const raw = profiled(create);
    expect(
      await raw.handler(null as unknown as Record<string, unknown>),
    ).toMatchObject({ success: false });
    const unnamed = await ok<{ style: unknown }>(create, {
      type: "UMLClass",
      diagram: env.mainDiagram._id,
    });
    expect(unnamed.style).toEqual({ profile: "uml-standard" });
  });
});

describe("determinism (issue #31)", () => {
  /** The project as text, ids numbered by appearance. */
  function snapshot(): string {
    const json = JSON.stringify(serialize(env.project, { depth: 12 }));
    const ids = new Map<string, string>();
    return json.replace(/"MOCK\d+"/g, (m) => {
      if (!ids.has(m)) ids.set(m, `#${ids.size}`);
      return ids.get(m)!;
    });
  }

  it("builds every golden spec twice to the same model, placement and text", async () => {
    for (const [key, c] of Object.entries(cases)) {
      const runs: string[] = [];
      for (let i = 0; i < 2; i++) {
        env = installMockApp();
        await ok(ep("/set_style_profile"), { profile: "presentation" });
        const built = await ok<{ diagram: { _id: string } }>(
          ep("/build_diagram"),
          c,
        );
        const text = await ok<{ text?: string }>(ep("/export_text"), {
          diagram: built.diagram._id,
        }).catch(() => ({ text: "" }));
        runs.push(`${snapshot()}\n${text.text ?? ""}`);
      }
      expect(runs[1], key).toBe(runs[0]);
    }
    expect(readFileSync).toBeDefined();
  });
});
