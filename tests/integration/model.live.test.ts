import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { call, describeLive } from "./support.js";

// Issue #23: /build_model, /sync_operations and /check_messages against
// StarUML 7.1.1, with the ThingsBoard analysis as the big spec.

interface Built {
  model: { _id: string; name: string; path: string };
  upserted: boolean;
  counts: {
    created: Record<string, number>;
    updated: Record<string, number>;
    unchanged: number;
  };
  changes?: { created: { path: string; type: string }[] };
  ids?: Record<string, string>;
  skipped?: { section: string }[];
  plan?: { ops: unknown[] };
}

const total = (counts: Record<string, number>) =>
  Object.values(counts).reduce((a, b) => a + b, 0);

describeLive("/build_model", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("plans the ThingsBoard model, builds exactly that in one undo step, and upserts it to nothing", async () => {
    const dry = await call<Built>("/build_model", {
      spec: tb,
      dryRun: true,
      result: "full",
    });
    expect(dry.success, JSON.stringify(dry).slice(0, 600)).toBe(true);
    const built = await call<Built>("/build_model", {
      spec: tb,
      result: "full",
    });
    expect(built.success, JSON.stringify(built).slice(0, 600)).toBe(true);
    expect(built.data.counts).toEqual(dry.data.counts);
    expect(built.data.changes).toEqual(dry.data.changes);
    expect(built.data.counts.created).toMatchObject({
      UMLModel: 1,
      UMLPackage: 15,
      UMLClass: 60,
      UMLInterface: 30,
      UMLEnumeration: 3,
      UMLLifeline: 37,
      UMLMessage: 57,
      UMLStateMachine: 3,
      UMLTransition: 32,
    });
    // The view sections are the model's now, stored for /derive_diagrams.
    expect(built.data.skipped).toBeUndefined();
    expect(built.data.counts.created).toMatchObject({ Tag: 1 });

    // Elements are where the spec puts them, with their semantics.
    const tenant = await call<{
      _parent: string;
      documentation: string;
    }>("/get_element_by_id", {
      ref: "ThingsBoard/Domain Model \\(common\\.data\\)/Tenant",
      fields: ["_parent", "documentation"],
    });
    expect(tenant.data.documentation).toMatch(
      /^Isolation boundary that owns all other entities\nKnows: title, tenant profile, region\./,
    );

    // StarUML's own rules find nothing unnamed or named twice.
    const problems = await call<{
      problems: { ruleId: string; _type: string; name: string | null }[];
    }>("/validate_model", { scope: built.data.model._id, limit: 1000 });
    expect(
      problems.data.problems.filter((p) =>
        ["UML001", "UML002"].includes(p.ruleId),
      ),
    ).toEqual([]);

    const again = await call<Built>("/build_model", {
      spec: tb,
      upsert: true,
      dryRun: true,
    });
    expect(again.data.upserted).toBe(true);
    expect(again.data.plan!.ops).toEqual([]);
    expect(total(again.data.counts.created)).toBe(0);

    // One undo removes the whole model.
    await call("/undo");
    const gone = await call("/get_element_by_id", {
      ref: built.data.model._id,
    });
    expect(gone.code).toBe("NOT_FOUND");
    await call("/redo");
    const back = await call("/get_element_by_id", {
      ref: built.data.model._id,
    });
    expect(back.success).toBe(true);
  }, 300_000);

  it("syncs a sequence diagram's calls into operations and checks them", async () => {
    await call<Built>("/build_model", {
      spec: {
        system: "Shop",
        classes: [
          { name: "Order", operations: ["+place(): void"] },
          { name: "Bank", kind: "interface" },
        ],
      },
    });
    const diagram = await call<{ diagram: { _id: string } }>("/build_diagram", {
      kind: "sequence",
      name: "Checkout",
      parent: "Shop",
      spec: {
        messages: [
          { from: "Clerk", to: "Order", text: "place()" },
          { from: "Clerk", to: "Order", text: "cancel(reason: String)" },
          { from: "Order", to: "Bank", text: "charge(amount)", kind: "async" },
          { from: "Bank", to: "Order", text: "ok", kind: "reply" },
          { from: "Clerk", to: "Order", text: "think it over" },
        ],
      },
    });
    expect(diagram.success, JSON.stringify(diagram)).toBe(true);
    const id = diagram.data.diagram._id;
    const before = await call<{
      checked: number;
      problems: { text: string; problem: string }[];
    }>("/check_messages", { diagram: id });
    expect(before.data.checked).toBe(4);
    expect(before.data.problems.map((p) => [p.text, p.problem])).toEqual([
      ["cancel(reason: String)", "no-operation"],
      ["charge(amount)", "no-operation"],
      ["think it over", "not-a-call"],
    ]);
    const synced = await call<{
      added: { receiver: string; operation: string; parameters: string[] }[];
      linked: number;
    }>("/sync_operations", { diagram: id });
    expect(synced.data.added).toEqual([
      {
        receiver: "Shop/Order",
        operation: "cancel",
        parameters: ["reason"],
        messages: 1,
      },
      {
        receiver: "Shop/Bank",
        operation: "charge",
        parameters: ["amount"],
        messages: 1,
      },
    ]);
    expect(synced.data.linked).toBe(3);
    const cancel = await call<{
      parameters: { $ref: string }[];
    }>("/get_element_by_id", {
      ref: "Shop/Order#cancel",
      fields: ["parameters"],
    });
    const param = await call<{ name: string; type: string }>(
      "/get_element_by_id",
      { ref: cancel.data.parameters[0]!.$ref, fields: ["name", "type"] },
    );
    expect(param.data).toMatchObject({ name: "reason", type: "String" });
    const after = await call<{ problems: { problem: string }[] }>(
      "/check_messages",
      { diagram: id },
    );
    expect(after.data.problems.map((p) => p.problem)).toEqual(["not-a-call"]);
    // uml_lint's message rule agrees.
    const lint = await call<{ findings: { rule: string }[] }>("/uml_lint", {
      scope: "Shop",
    });
    expect(lint.data.findings.filter((f) => f.rule === "U007")).toEqual([]);
  });
});
