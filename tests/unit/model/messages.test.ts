import { beforeEach, describe, expect, it } from "vitest";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, fullResults, ok } from "../support.js";

let env: MockEnvironment;
const endpoint = (path: string) =>
  fullResults(endpoints.find((e) => e.path === path)!);
const buildModel = endpoint("/build_model");
const build = endpoint("/build_diagram");
const checkMessages = endpoint("/check_messages");
const sync = endpoint("/sync_operations");

beforeEach(() => {
  env = installMockApp();
});

interface Problem {
  message: string;
  text: string;
  from: string | null;
  to: string | null;
  receiver: string | null;
  problem: string;
  hint: string;
}

async function setUp() {
  await ok(buildModel, {
    spec: {
      system: "Shop",
      packages: ["A", "B"],
      classes: [
        { name: "Order", operations: ["place()"] },
        { name: "Bank", kind: "interface" },
        { name: "Twin", package: "A" },
        { name: "Twin2", package: "B" },
      ],
    },
  });
  // A second Twin makes the name ambiguous.
  const twin2 = env.app.repository
    .getInstancesOf("UMLClass")
    .find((c) => c.name === "Twin2")!;
  twin2.name = "Twin";
  return ok<{ diagram: { _id: string } }>(build, {
    kind: "sequence",
    name: "Checkout",
    spec: {
      messages: [
        { from: "Clerk", to: "Order", text: "place()" },
        { from: "Clerk", to: "Order", text: "cancel(reason: String, at)" },
        { from: "Clerk", to: "Order", text: "cancel()" },
        { from: "Order", to: "Bank", text: "charge(amount)", kind: "async" },
        { from: "Bank", to: "Order", text: "ok", kind: "reply" },
        { from: "Clerk", to: "Nobody", text: "do()" },
        { from: "Clerk", to: "Order", text: "think hard" },
        { from: "Clerk", to: "Twin", text: "x()" },
        { from: "Clerk", to: "Order", text: "audit" },
      ],
    },
  });
}

describe("/check_messages", () => {
  it("lists calls naming no operation of their receiver, by problem", async () => {
    const { diagram } = await setUp();
    const data = await ok<{ checked: number; ok: number; problems: Problem[] }>(
      checkMessages,
      { diagram: diagram._id },
    );
    expect(data.checked).toBe(8);
    expect(data.ok).toBe(1);
    expect(data.problems.map((p) => [p.text, p.problem, p.receiver])).toEqual([
      ["cancel(reason: String, at)", "no-operation", "Shop/Order"],
      ["cancel()", "no-operation", "Shop/Order"],
      ["charge(amount)", "no-operation", "Shop/Bank"],
      ["do()", "no-receiver", null],
      ["think hard", "not-a-call", "Shop/Order"],
      ["x()", "no-receiver", null],
      ["audit", "no-operation", "Shop/Order"],
    ]);
    expect(data.problems[0]).toMatchObject({ from: "Clerk", to: "Order" });
    expect(data.problems[0]!.hint).toMatch(/sync_operations/);
  });

  it("checks every message within a scope", async () => {
    await setUp();
    const shop = env.app.repository
      .getInstancesOf("UMLModel")
      .find((m) => m.name === "Shop")!;
    const none = await ok<{ checked: number }>(checkMessages, {
      scope: shop._id,
    });
    expect(none.checked).toBe(0);
    const everything = await ok<{ checked: number }>(checkMessages, {
      scope: env.project._id,
    });
    expect(everything.checked).toBe(8);
  });

  it("needs one sequence diagram or a scope", async () => {
    await fails(checkMessages, {}, "INVALID_ARGUMENT", "Pass diagram or scope");
    await fails(
      checkMessages,
      { diagram: env.mainDiagram._id, scope: env.model._id },
      "INVALID_ARGUMENT",
    );
    await fails(
      checkMessages,
      { diagram: env.mainDiagram._id },
      "INVALID_ARGUMENT",
      /is not a sequence diagram$/,
    );
  });

  it("reads a lifeline's type from its role, and unnamed messages as prose", async () => {
    const { diagram } = await setUp();
    const views = env.app.repository.get(diagram._id)!.ownedViews as Element[];
    const lifeline = views
      .map((v) => v.model as Element | null)
      .find((m) => m?.name === "Nobody")!;
    const bank = env.app.repository
      .getInstancesOf("UMLInterface")
      .find((c) => c.name === "Bank")!;
    // StarUML's lifelineFn gives each lifeline a role; the mock does not.
    const role = create("UMLAttribute");
    role.type = bank;
    lifeline.represent = role;
    const message = views
      .map((v) => v.model as Element | null)
      .find((m) => m?.name === "audit")!;
    message.name = undefined as unknown as string;
    const data = await ok<{ problems: Problem[] }>(checkMessages, {
      diagram: diagram._id,
    });
    expect(data.problems.find((p) => p.text === "do()")).toMatchObject({
      problem: "no-operation",
      receiver: "Shop/Bank",
    });
    expect(data.problems.at(-1)).toMatchObject({
      text: "",
      problem: "not-a-call",
    });
  });
});

describe("/sync_operations", () => {
  it("adds the operations the messages name, once each, and links every call", async () => {
    const { diagram } = await setUp();
    const dry = await ok<{
      added: unknown[];
      linked: number;
      dryRun: boolean;
      plan: { ops: { path: string }[] };
    }>(sync, { diagram: diagram._id, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.plan.ops.map((o) => o.path)).toEqual([
      "/update_element",
      "/add_operation",
      "/update_element",
      "/update_element",
      "/add_operation",
      "/update_element",
      "/add_operation",
      "/update_element",
    ]);
    const order = env.app.repository
      .getInstancesOf("UMLClass")
      .find((c) => c.name === "Order")!;
    expect(order.operations as Element[]).toHaveLength(1);
    const data = await ok<{
      added: {
        receiver: string;
        operation: string;
        parameters: string[];
        messages: number;
      }[];
      linked: number;
      skipped: { text: string; reason: string }[];
    }>(sync, { diagram: diagram._id });
    expect(data.added).toEqual([
      {
        receiver: "Shop/Order",
        operation: "cancel",
        parameters: ["reason", "at"],
        messages: 2,
      },
      {
        receiver: "Shop/Bank",
        operation: "charge",
        parameters: ["amount"],
        messages: 1,
      },
      {
        receiver: "Shop/Order",
        operation: "audit",
        parameters: [],
        messages: 1,
      },
    ]);
    expect(data.linked).toBe(5);
    expect(data.skipped.map((s) => s.text)).toEqual([
      "do()",
      "think hard",
      "x()",
    ]);
    const cancel = (order.operations as Element[])[1]!;
    expect(
      (cancel.parameters as Element[]).map((p) => [p.name, p.type || ""]),
    ).toEqual([
      ["reason", "String"],
      ["at", ""],
    ]);
    const again = await ok<{ added: unknown[]; linked: number }>(sync, {
      diagram: diagram._id,
    });
    expect(again).toMatchObject({ added: [], linked: 0 });
    const checked = await ok<{ problems: Problem[] }>(checkMessages, {
      diagram: diagram._id,
    });
    expect(checked.problems.map((p) => p.problem)).toEqual([
      "no-receiver",
      "not-a-call",
      "no-receiver",
    ]);
  });
});

describe("message receivers", () => {
  it("falls back to the class named like a lifeline whose role has a text type, and reads ends that are gone", async () => {
    const { diagram } = await setUp();
    const views = env.app.repository.get(diagram._id)!.ownedViews as Element[];
    const models = views.map((v) => v.model as Element | null);
    const order = models.find(
      (m) => m?.constructor.name === "UMLLifeline" && m.name === "Order",
    )!;
    const role = create("UMLAttribute");
    role.type = "Order";
    order.represent = role;
    const place = models.find((m) => m?.name === "place()")!;
    const lost = models.find((m) => m?.name === "do()")!;
    lost.source = null;
    lost.target = null;
    const unnamed = models.find((m) => m?.name === "think hard")!;
    unnamed.name = undefined as unknown as string;
    const checked = await ok<{ ok: number; problems: Problem[] }>(
      checkMessages,
      { scope: env.project._id },
    );
    expect(checked.ok).toBe(1);
    expect(checked.problems.find((p) => p.message === lost._id)).toMatchObject({
      from: null,
      to: null,
      problem: "no-receiver",
    });
    void place;
    const synced = await ok<{ skipped: { text: string }[] }>(sync, {
      diagram: diagram._id,
      dryRun: true,
    });
    expect(synced.skipped.map((s) => s.text)).toEqual(["do()", "", "x()"]);
  });
});
