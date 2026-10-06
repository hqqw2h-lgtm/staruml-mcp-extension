import { beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { readMark } from "../../../src/viewpoints/mark.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";
import { KIOSK } from "./fixtures.js";

// Issue #42: the agent states the intent; the engine picks the view by
// the committed decision table, draws it from the model, or refuses it
// with the views that fit.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const request = ep("/request_diagram");

beforeEach(() => {
  env = installMockApp();
});

interface Requested {
  choice: {
    viewpoint: string;
    kind: string;
    rule: string;
    reason: string;
    question: string;
    matched: string[];
  };
  scope: string | null;
  diagrams: {
    kind: string;
    name: string;
    diagram: string;
    viewpoint: string;
    conforms?: boolean;
    created: number;
  }[];
  counts: { diagrams: number; created: number };
  dryRun?: boolean;
}

interface Refusal {
  details: {
    reason: string;
    wanted?: { viewpoint: string; kind: string };
    alternatives: { viewpoint: string; kind: string; candidates?: string[] }[];
  };
}

async function kiosk(spec: Record<string, unknown> = KIOSK) {
  return ok<{ model: { _id: string } }>(ep("/build_model"), { spec });
}

const names = (r: Requested) =>
  r.diagrams.map((d) => `${d.viewpoint}:${d.kind}:${d.name}`);

describe("/request_diagram", () => {
  it.each([
    ["how does checkout work, which messages", "runtime:sequence:Checkout"],
    [
      "which states does an order go through",
      "lifecycle:statemachine:Order life",
    ],
    [
      "what does the kiosk deal with: the big picture",
      "context:c4:Kiosk context",
    ],
    ["which containers and technology", "container:c4:Kiosk containers"],
    ["where is it deployed", "deployment:deployment:Shop floor"],
    ["what is stored in the database", "data:erd:Kiosk data model"],
    ["which features are there", "actors-goals:mindmap:Kiosk features"],
    [
      "how do packages depend on each other",
      "component:package:Kiosk packages",
    ],
    ["what are the steps to close the day", "runtime:activity:Close day"],
    [
      "who talks to whom in checkout",
      "runtime:communication:Checkout communication",
    ],
  ])("%s → %s", async (intent, expected) => {
    await kiosk();
    const r = await ok<Requested>(request, { intent, scope: "Kiosk" });
    expect(names(r)).toEqual([expected]);
    expect(r.choice.question).toMatch(/\?$/);
    expect(r.diagrams[0]!.conforms).toBe(true);
    const diagram = env.app.repository.get(r.diagrams[0]!.diagram) as Element;
    expect(readMark(diagram)!.viewpoint).toBe(expected.split(":")[0]);
  });

  it("draws every class view of the model, or the ones whose names the intent shares", async () => {
    await kiosk();
    const all = await ok<Requested>(request, {
      intent: "show the classes",
      scope: "Kiosk",
      audience: "developer",
    });
    expect(names(all)).toEqual(["code:class:Sales", "code:class:Stock"]);
    const one = await ok<Requested>(request, {
      intent: "show the classes of stock",
      scope: "Kiosk",
    });
    expect(names(one)).toEqual(["code:class:Stock"]);
    // Drawn again, nothing is made.
    const again = await ok<Requested>(request, {
      intent: "show the classes of stock",
      scope: "Kiosk",
    });
    expect(again.counts.created).toBe(0);
  });

  it("draws for a package, a class, a collaboration, a state machine, an actor and a use case", async () => {
    await kiosk();
    const cases: [string, string, string[]][] = [
      ["classes", "Kiosk/Sales", ["code:class:Sales"]],
      ["dependencies between packages", "Kiosk/Sales", []],
      [
        "show the class",
        "Kiosk/Sales/Order",
        ["code:class:Order and its collaborators"],
      ],
      [
        "its lifecycle",
        "Kiosk/Sales/Order",
        ["lifecycle:statemachine:Order life"],
      ],
      [
        "which messages does it take part in",
        "Kiosk/Sales/Order",
        ["runtime:sequence:Checkout"],
      ],
      ["anything", "Kiosk/Checkout", ["runtime:sequence:Checkout"]],
      [
        "anything",
        "Kiosk/Sales/Order/Order life",
        ["lifecycle:statemachine:Order life"],
      ],
      ["what are the goals", "Kiosk/Buyer", ["actors-goals:usecase:Kiosk"]],
      ["anything", "Kiosk/Sell goods", ["actors-goals:usecase:Kiosk"]],
    ];
    for (const [intent, scope, expected] of cases) {
      const res = await request.handler({ intent, scope });
      if (expected.length === 0) {
        expect(res, `${intent} ${scope}`).toMatchObject({
          success: false,
          code: "VIEWPOINT_MISMATCH",
        });
        continue;
      }
      expect(res, `${intent} ${scope}`).toMatchObject({ success: true });
      expect(names((res as { data: Requested }).data), scope).toEqual(expected);
    }
  });

  it("stands the project for its only model, and refuses a project of several", async () => {
    await kiosk();
    const r = await ok<Requested>(request, {
      intent: "data model",
      scope: "@project",
      dryRun: true,
    });
    expect(r).toMatchObject({ scope: "Kiosk", dryRun: true });
    expect(r.diagrams[0]!.diagram).toBe("$diagram");
    expect(r.diagrams[0]!.conforms).toBeUndefined();
    await kiosk({ system: "Other", classes: [{ name: "A" }] });
    const refused = (await fails(
      request,
      { intent: "data model", scope: "@project" },
      "VIEWPOINT_MISMATCH",
      /the project holds 2 models/,
    )) as unknown as Refusal;
    expect(refused.details.reason).toBe("scope");
    expect(refused.details.alternatives.map((a) => a.candidates)).toEqual([
      ["Kiosk"],
      ["Other"],
    ]);
    const unclear = (await fails(
      request,
      { intent: "make it pretty", scope: "@project" },
      "VIEWPOINT_MISMATCH",
    )) as unknown as Refusal;
    expect(unclear.details.alternatives).toEqual([]);
  });

  it("refuses an intent it cannot place, offering what the model has", async () => {
    await kiosk();
    const refused = (await fails(
      request,
      { intent: "make it pretty", scope: "Kiosk" },
      "VIEWPOINT_MISMATCH",
      /names no view the table knows/,
    )) as unknown as Refusal;
    expect(refused.details.reason).toBe("unclear");
    const offered = refused.details.alternatives.map((a) => a.viewpoint);
    expect(offered).toContain("lifecycle");
    // Only views the model can show, each with where to ask for it.
    for (const a of refused.details.alternatives) {
      expect(a.candidates!.length).toBeGreaterThan(0);
    }
  });

  it("refuses a view the scope cannot have, naming the scopes that have it", async () => {
    await kiosk();
    const refused = (await fails(
      request,
      { intent: "the lifecycle", scope: "Kiosk/Buyer" },
      "VIEWPOINT_MISMATCH",
    )) as unknown as Refusal;
    expect(refused.details).toMatchObject({
      reason: "scope",
      wanted: { viewpoint: "lifecycle", kind: "statemachine" },
    });
    expect(refused.details.alternatives[0]!.candidates).toEqual(
      expect.arrayContaining(["Kiosk", "Kiosk/Sales/Order"]),
    );
  });

  it("refuses a view not written for the audience", async () => {
    await kiosk();
    const refused = (await fails(
      request,
      { intent: "the classes", scope: "Kiosk", audience: "business" },
      "VIEWPOINT_MISMATCH",
      /written for developer, architect, not business/,
    )) as unknown as Refusal;
    expect(refused.details.reason).toBe("audience");
  });

  it("refuses a scope with nothing to show, listing what the model has; and a model with nothing at all", async () => {
    await kiosk({ system: "Bare", classes: [{ name: "A" }] });
    const refused = (await fails(
      request,
      { intent: "the lifecycle", scope: "Bare" },
      "VIEWPOINT_MISMATCH",
      /holds nothing a lifecycle view \(statemachine\) draws/,
    )) as unknown as Refusal;
    expect(refused.details.reason).toBe("empty");
    expect(refused.details.alternatives).toEqual([
      expect.objectContaining({ viewpoint: "code", kind: "class" }),
    ]);
    // A model with no view at all offers the table's alternatives as they are.
    await ok(ep("/create_element"), {
      type: "UMLModel",
      parent: "@project",
      name: "Void",
    });
    const none = (await fails(
      request,
      { intent: "make it pretty", scope: "Void" },
      "VIEWPOINT_MISMATCH",
    )) as unknown as Refusal;
    expect(none.details.alternatives).toEqual([]);
  });

  it("refuses more lifelines or elements than the viewpoint holds, with an activity or a split", async () => {
    const many = Array.from({ length: 13 }, (_, i) => `P${i}`);
    await kiosk({
      system: "Crowd",
      classes: Array.from({ length: 21 }, (_, i) => ({
        name: `C${i}`,
        context: `p${i}`,
      })),
      contexts: Array.from({ length: 21 }, (_, i) => `p${i}`),
      collaborations: [
        {
          name: "Rush",
          messages: many.slice(1).map((p, i) => [many[i], p, "go()"]),
        },
      ],
    });
    const lifelines = (await fails(
      request,
      { intent: "the sequence of messages", scope: "Crowd" },
      "VIEWPOINT_MISMATCH",
      /Rush has 13 lifelines, more than the 12/,
    )) as unknown as Refusal;
    expect(lifelines.details.alternatives.map((a) => a.kind)).toEqual([
      "activity",
      "sequence",
    ]);
    const packages = (await fails(
      request,
      { intent: "package dependencies", scope: "Crowd" },
      "VIEWPOINT_MISMATCH",
      /Crowd packages has 21 elements, more than the 20/,
    )) as unknown as Refusal;
    expect(packages.details.reason).toBe("limits");
  });

  it("draws for a package outside any model", async () => {
    await ok(ep("/create_element"), {
      type: "UMLPackage",
      parent: "@project",
      name: "Loose",
    });
    await ok(ep("/create_element"), {
      type: "UMLClass",
      parent: "Loose",
      name: "Thing",
    });
    const r = await ok<Requested>(request, {
      intent: "the classes",
      scope: "Loose",
    });
    expect(names(r)).toEqual(["code:class:Loose"]);
  });

  it("refuses a scope that no view is drawn for", async () => {
    await kiosk();
    const refused = (await fails(
      request,
      { intent: "the lifecycle", scope: "Kiosk/Sales/Order#place()" },
      "VIEWPOINT_MISMATCH",
      /not an other;/,
    )) as unknown as Refusal;
    expect(refused.details.reason).toBe("scope");
  });

  it("checks its request", async () => {
    await fails(request, { intent: "", scope: "x" }, "INVALID_ARGUMENT");
    await fails(request, { intent: "data", scope: "Nowhere" }, "NOT_FOUND");
    await fails(
      request,
      { intent: "data", scope: "@project", audience: "ceo" },
      "INVALID_ARGUMENT",
    );
  });
});

describe("/list_viewpoints and /describe_viewpoint", () => {
  it("lists the catalogue and describes one with its rules", async () => {
    const list = await ok<{
      viewpoints: { name: string }[];
      decisions: { rules: number };
    }>(ep("/list_viewpoints"));
    expect(list.viewpoints).toHaveLength(9);
    expect(list.decisions.rules).toBe(12);
    const one = await ok<{
      viewpoint: Record<string, unknown>;
      rules: { id: string }[];
    }>(ep("/describe_viewpoint"), { name: "runtime" });
    expect(one.viewpoint).not.toHaveProperty("$schema");
    expect(one.viewpoint.question).toMatch(/\?$/);
    expect(one.rules.map((r) => r.id)).toEqual(["D04", "D05", "D06"]);
    await fails(ep("/describe_viewpoint"), { name: "x" }, "INVALID_ARGUMENT");
  });
});
