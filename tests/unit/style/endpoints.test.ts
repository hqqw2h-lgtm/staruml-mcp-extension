import { beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import { builtInProfiles, PROFILE_TAG } from "../../../src/style/profile.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;

beforeEach(() => {
  env = installMockApp();
});

interface Got {
  profile: { name: string; strict: boolean };
  source: string;
  builtIns: string[];
  problem?: string;
}

describe("/get_style_profile and /set_style_profile", () => {
  it("answers the preference's profile, or a built-in by name", async () => {
    const got = await ok<Got>(ep("/get_style_profile"));
    expect(got).toMatchObject({
      profile: { name: "uml-standard" },
      source: "preferences",
      builtIns: ["uml-standard", "minimal", "presentation", "print"],
    });
    expect(
      await ok<Got>(ep("/get_style_profile"), { name: "print" }),
    ).toMatchObject({ profile: { name: "print" }, source: "built-in" });
  });

  it("stores a built-in, a patch and a whole profile in a hidden project tag, ", async () => {
    const set = ep("/set_style_profile");
    const first = await ok<{ changed: boolean; source: string }>(set, {
      profile: "minimal",
    });
    expect(first).toMatchObject({ changed: true, source: "project" });
    const tag = (env.project.tags as Element[]).find(
      (t) => t.name === PROFILE_TAG,
    )!;
    expect(tag).toMatchObject({ kind: "string", hidden: true });
    expect(JSON.parse(String(tag.value)).name).toBe("minimal");
    expect(
      await ok<{ changed: boolean }>(set, { profile: "minimal" }),
    ).toMatchObject({ changed: false });
    await ok(set, { patch: { strict: true } });
    expect((await ok<Got>(ep("/get_style_profile"))).profile).toMatchObject({
      name: "minimal",
      strict: true,
    });
    await ok(set, {
      profile: { ...builtInProfiles()["print"]!, name: "house" },
    });
    expect((await ok<Got>(ep("/get_style_profile"))).profile.name).toBe(
      "house",
    );
    await ok(set, { profile: "presentation", patch: { strict: true } });
    expect((await ok<Got>(ep("/get_style_profile"))).profile).toMatchObject({
      name: "presentation",
      strict: true,
    });
  });

  it("refuses a bad profile or patch whole, and reset removes the tag", async () => {
    const set = ep("/set_style_profile");
    await fails(set, {}, "INVALID_ARGUMENT", "Pass profile, patch or reset");
    await fails(set, { patch: { strict: 1 } }, "INVALID_ARGUMENT", /strict/);
    await fails(
      set,
      { patch: { naming: { classifier: { pattern: "(", fix: "pascal" } } } },
      "INVALID_ARGUMENT",
      /naming.classifier.pattern/,
    );
    await fails(
      set,
      { reset: true, profile: "print" },
      "INVALID_ARGUMENT",
      /pass it alone/,
    );
    expect(await ok(set, { reset: true })).toMatchObject({ changed: false });
    await ok(set, { profile: "print" });
    expect(await ok(set, { reset: true })).toMatchObject({
      changed: true,
      source: "preferences",
      profile: { name: "uml-standard" },
    });
  });

  it("reports a stored profile that no longer parses", async () => {
    await ok(ep("/set_style_profile"), { profile: "print" });
    const tag = (env.project.tags as Element[])[0]!;
    tag.value = "{}";
    const got = await ok<Got>(ep("/get_style_profile"));
    expect(got.source).toBe("preferences");
    expect(got.problem).toMatch(/not a valid profile/);
  });

  it("needs a project", async () => {
    env.app.project.getProject = () => null as never;
    await fails(ep("/set_style_profile"), { profile: "print" }, "NO_PROJECT");
  });
});

describe("/apply_style_profile", () => {
  async function messy() {
    return ok<{
      diagram: { _id: string };
      ids: Record<string, { model: string; view: string }>;
    }>(ep("/build_diagram"), {
      kind: "class",
      name: "Messy",
      result: "ids",
      spec: {
        classes: [
          { name: "Order", attributes: ["+Total: int"] },
          { name: "Line" },
        ],
      },
    });
  }

  it("renames what breaks the rules, siblings distinct, and styles the views; twice changes nothing", async () => {
    const built = await messy();
    // Names made off the profile after the build, as a hand edit would.
    get(built.ids.Order!.model).name = "order";
    const line = get(built.ids.Line!.model);
    line.name = "Order_";
    const total = (get(built.ids.Order!.model).attributes as Element[])[0]!;
    total.isStatic = true;
    total.isReadOnly = true;
    total.name = "max total";
    await ok(ep("/set_style_profile"), { profile: "print" });
    const dry = await ok<{ renamed: unknown[]; dryRun: boolean }>(
      ep("/apply_style_profile"),
      { dryRun: true },
    );
    expect(dry.dryRun).toBe(true);
    expect(get(built.ids.Order!.model).name).toBe("order");
    const applied = await ok<{
      renamed: { kind: string; from: string; to: string }[];
      styled: number;
      diagrams: number;
    }>(ep("/apply_style_profile"), {});
    expect(applied.renamed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "classifier",
          from: "order",
          to: "Order",
        }),
        expect.objectContaining({
          kind: "classifier",
          from: "Order_",
          to: "Order2",
        }),
        expect.objectContaining({
          kind: "constant",
          from: "max total",
          to: "MAX_TOTAL",
        }),
      ]),
    );
    expect(applied.styled).toBeGreaterThan(0);
    const view = get(built.ids.Order!.view);
    expect(view).toMatchObject({ fillColor: "#ffffff", lineColor: "#000000" });
    expect((view.font as { __write(): string }).__write()).toBe("Arial;12;0");
    const again = await ok<{ renamed: unknown[]; styled: number }>(
      ep("/apply_style_profile"),
      {},
    );
    expect(again).toMatchObject({ renamed: [], styled: 0 });
  });

  it("can skip names or visuals, takes a diagram as scope, and reports what it cannot fix", async () => {
    const built = await messy();
    await ok(ep("/build_diagram"), {
      kind: "usecase",
      spec: { actors: ["Clerk"], useCases: ["Checkout"] },
    });
    get(built.ids.Order!.model).name = "order";
    const names = await ok<{
      renamed: unknown[];
      styled: number;
      unfixed: string[];
    }>(ep("/apply_style_profile"), { visuals: false });
    expect(names.renamed).toHaveLength(1);
    expect(names.unfixed).toContain("usecase Checkout");
    get(built.ids.Order!.model).name = "order";
    await ok(ep("/set_style_profile"), { profile: "presentation" });
    const visuals = await ok<{ renamed: unknown[]; diagrams: number }>(
      ep("/apply_style_profile"),
      { scope: built.diagram._id, names: false },
    );
    expect(visuals).toMatchObject({ renamed: [], diagrams: 1 });
    expect(get(built.ids.Order!.view).fillColor).toBe("#fdf6e3");
  });
});

describe("/explain_style_violation", () => {
  it("names the naming rule, the fixed name and an autofix", async () => {
    const built = await ok<{ ids: Record<string, { model: string }> }>(
      ep("/build_diagram"),
      { kind: "class", result: "ids", spec: { classes: [{ name: "Order" }] } },
    );
    const order = get(built.ids.Order!.model);
    order.name = "order_line";
    const out = await ok<{
      ok: boolean;
      violations: { rule: string; expected?: string; autofix: unknown }[];
    }>(ep("/explain_style_violation"), { ref: order._id });
    expect(out.ok).toBe(false);
    expect(out.violations[0]).toMatchObject({
      rule: "naming.classifier",
      expected: "OrderLine",
      autofix: {
        path: "/update_element",
        body: { ref: order._id, field: "name", value: "OrderLine" },
      },
    });
  });

  it("reports documentation, duplicates and views off the profile's colours", async () => {
    await ok(ep("/set_style_profile"), {
      profile: "print",
      patch: { naming: { package: { pattern: "lowercase", fix: "none" } } },
    });
    const built = await ok<{
      ids: Record<string, { model: string; view: string }>;
    }>(ep("/build_diagram"), {
      kind: "class",
      result: "ids",
      spec: { packages: ["Billing"], classes: [{ name: "Order" }] },
    });
    const view = get(built.ids.Order!.view);
    view.fillColor = "#ff0000";
    const out = await ok<{ violations: { rule: string; autofix: unknown }[] }>(
      ep("/explain_style_violation"),
      { ref: built.ids.Order!.model },
    );
    expect(out.violations.map((v) => v.rule)).toEqual([
      "documentation",
      "visuals",
    ]);
    const pkg = await ok<{ violations: { rule: string; fix: string }[] }>(
      ep("/explain_style_violation"),
      { ref: built.ids.Billing!.model },
    );
    expect(pkg.violations[0]).toMatchObject({ rule: "naming.package" });
    expect(pkg.violations[0]!.fix).toMatch(/the rule reports only/);
    // A duplicate in the same owner.
    await ok(ep("/create_element"), {
      type: "UMLClass",
      parent: get(built.ids.Order!.model)._parent!._id,
      name: "Order",
      allowDuplicateNames: true,
    });
    const dup = await ok<{ violations: { rule: string }[] }>(
      ep("/explain_style_violation"),
      { ref: built.ids.Order!.model },
    );
    expect(dup.violations.map((v) => v.rule)).toContain("duplicates");
  });

  it("checks a name before it exists, and says when no rule applies", async () => {
    const explain = ep("/explain_style_violation");
    expect(
      await ok(explain, { kind: "operation", name: "PlaceOrder" }),
    ).toMatchObject({
      ok: false,
      violations: [{ expected: "placeOrder", fix: "Name it placeOrder." }],
    });
    expect(
      await ok(explain, { kind: "usecase", name: "checkout" }),
    ).toMatchObject({
      ok: false,
      violations: [{ fix: "Choose a name matching Verb noun." }],
    });
    expect(await ok(explain, { kind: "operation", name: "place" })).toEqual({
      profile: "uml-standard",
      ok: true,
      violations: [],
    });
    await ok(ep("/set_style_profile"), {
      patch: { naming: { operation: null } },
    });
    expect(
      await ok(explain, { kind: "operation", name: "Place" }),
    ).toMatchObject({ ok: true });
    await fails(explain, {}, "INVALID_ARGUMENT", "Pass ref, or kind and name");
    // A view has no name of its own to check.
    const view = (env.mainDiagram.ownedViews as Element[])[0];
    expect(view).toBeUndefined();
    const shown = await ok<{ view: { _id: string } }>(
      ep("/create_element_with_view"),
      { type: "UMLClass", diagram: env.mainDiagram._id, name: "Shown" },
    );
    expect(await ok(explain, { ref: shown.view._id })).toMatchObject({
      ok: true,
    });
    // A fix that does not reach a custom pattern is no fix.
    await ok(ep("/set_style_profile"), {
      patch: { naming: { classifier: { pattern: "^I[A-Z]", fix: "pascal" } } },
    });
    const custom = await ok<{ violations: { fix: string }[] }>(explain, {
      ref: "Model/Shown",
    });
    expect(custom.violations[0]!.fix).toMatch(
      /the fix does not match the pattern/,
    );
    // The project element itself has no rule.
    expect(await ok(explain, { ref: env.project._id })).toMatchObject({
      ok: true,
    });
  });
});
