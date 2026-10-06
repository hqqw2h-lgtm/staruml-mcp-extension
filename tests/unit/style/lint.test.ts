import { beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;

beforeEach(() => {
  env = installMockApp();
});

interface Linted {
  findings: {
    rule: string;
    severity: string;
    message: string;
    autofix?: unknown;
  }[];
}

describe("/lint_diagram under the style profile", () => {
  it("suggests a split above maxElements (L008)", async () => {
    await ok(ep("/set_style_profile"), {
      patch: { layout: { maxElements: 2 } },
    });
    const built = await ok<{ diagram: { _id: string } }>(ep("/build_diagram"), {
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    });
    const linted = await ok<Linted>(ep("/lint_diagram"), {
      diagram: built.diagram._id,
      rules: ["L008"],
    });
    expect(linted.findings).toEqual([
      expect.objectContaining({
        rule: "L008",
        severity: "info",
        message:
          "3 nodes, more than the 2 the style profile 'uml-standard' allows on one diagram",
      }),
    ]);
  });

  it("flags views off the profile (L009), an error when strict, with the fix", async () => {
    const built = await ok<{
      diagram: { _id: string };
      ids: Record<string, { view: string }>;
    }>(ep("/build_diagram"), {
      kind: "class",
      result: "ids",
      spec: { classes: [{ name: "A" }] },
    });
    const lint = () =>
      ok<Linted>(ep("/lint_diagram"), {
        diagram: built.diagram._id,
        rules: ["off-profile"],
      });
    expect((await lint()).findings).toEqual([]);
    get(built.ids.A!.view).fillColor = "#ff0000";
    await ok(ep("/set_style_profile"), { profile: "print" });
    const warned = await lint();
    expect(warned.findings[0]).toMatchObject({
      rule: "L009",
      severity: "warning",
      autofix: {
        path: "/apply_style_profile",
        body: { scope: built.diagram._id, names: false },
      },
    });
    expect(warned.findings[0]!.message).toMatch(/fillColor/);
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    expect((await lint()).findings[0]!.severity).toBe("error");
    await ok(ep("/apply_style_profile"), { scope: built.diagram._id });
    expect((await lint()).findings).toEqual([]);
  });
});

describe("/uml_lint under the style profile", () => {
  async function model() {
    await ok(ep("/build_model"), {
      spec: {
        system: "Shop",
        contexts: ["Billing"],
        classes: [
          {
            name: "Order",
            context: "Billing",
            attributes: ["+total: int", "+MAX: int$"],
          },
        ],
        useCases: ["checkout"],
      },
    });
    const max = env.app.repository
      .getInstancesOf("UMLAttribute")
      .find((a) => a.name === "MAX")!;
    max.isReadOnly = true;
    return max;
  }

  it("keeps its defaults while the project stores no profile", async () => {
    // A constant is an attribute to the defaults, package and use case unchecked.
    (await model()).name = "max";
    const linted = await ok<Linted>(ep("/uml_lint"), {
      rules: Object.fromEntries(
        ["U001", "U002", "U003", "U005", "U006", "U008", "U013"].map((r) => [
          r,
          "off",
        ]),
      ),
    });
    expect(linted.findings).toEqual([]);
  });

  it("checks the profile's naming, constants and use cases included, as errors when strict", async () => {
    const max = await model();
    max.name = "max";
    await ok(ep("/set_style_profile"), { profile: "uml-standard" });
    const off = Object.fromEntries(
      ["U001", "U002", "U003", "U005", "U006", "U008", "U013"].map((r) => [
        r,
        "off",
      ]),
    );
    const linted = await ok<Linted>(ep("/uml_lint"), { rules: off });
    expect(linted.findings.map((f) => [f.severity, f.message])).toEqual([
      ["info", 'The constant name "max" is not UPPER_CASE'],
      ["info", 'The usecase name "checkout" is not Verb noun'],
      ["info", 'The package name "Billing" is not lowercase'],
    ]);
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    const strict = await ok<Linted>(ep("/uml_lint"), { rules: off });
    expect(strict.findings.every((f) => f.severity === "error")).toBe(true);
    // The request's own setting still wins.
    const asked = await ok<Linted>(ep("/uml_lint"), {
      rules: { ...off, naming: "warning" },
    });
    expect(asked.findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("checks a constant as an attribute when no constant rule is set", async () => {
    const max = await model();
    max.name = "Max";
    await ok(ep("/set_style_profile"), {
      patch: { naming: { constant: null, usecase: null, package: null } },
    });
    const linted = await ok<Linted>(ep("/uml_lint"), {
      rules: Object.fromEntries(
        ["U001", "U002", "U003", "U005", "U006", "U008", "U013"].map((r) => [
          r,
          "off",
        ]),
      ),
    });
    expect(linted.findings.map((f) => f.message)).toEqual([
      'The attribute name "Max" is not camelCase',
    ]);
  });
});
