import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { call, describeLive } from "./support.js";

// Issue #42 on StarUML 7.1.1: the ThingsBoard model derived per viewpoint,
// every diagram conforming to its viewpoint; /request_diagram choosing
// the view for stated intents and refusing what does not fit; strict
// profiles refusing diagrams without a viewpoint.

interface Derived {
  diagrams: {
    kind: string;
    name: string;
    diagram: string;
    viewpoint: string;
    conforms?: boolean;
    template?: string;
    accepted?: boolean;
    quality?: { score: number };
  }[];
  counts: { created: number; deleted: number };
}

interface Requested extends Derived {
  choice: { viewpoint: string; kind: string; rule: string; reason: string };
}

const ALL_KINDS = [
  "package",
  "class",
  "sequence",
  "usecase",
  "statemachine",
  "activity",
  "erd",
  "c4",
  "deployment",
  "mindmap",
  "communication",
];
const ALL_VIEWPOINTS = [
  "context",
  "container",
  "component",
  "code",
  "runtime",
  "lifecycle",
  "actors-goals",
  "deployment",
  "data",
];

describeLive("viewpoints: ThingsBoard by viewpoint and by intent", () => {
  let model = "";

  beforeAll(async () => {
    await call("/new_project");
    const built = await call<{ model: { _id: string } }>("/build_model", {
      spec: tb,
    });
    expect(built.success).toBe(true);
    model = built.data.model._id;
  }, 120_000);

  afterAll(async () => {
    await call("/set_style_profile", { reset: true });
    await call("/new_project");
  });

  it("derives every diagram as a view of one viewpoint, each conforming to it", async () => {
    const out = await call<Derived>("/derive_diagrams", {
      scope: model,
      kinds: ALL_KINDS,
      viewpoints: ALL_VIEWPOINTS,
    });
    expect(out.success, JSON.stringify(out).slice(0, 600)).toBe(true);
    const by: Record<string, number> = {};
    for (const d of out.data.diagrams)
      by[d.viewpoint] = (by[d.viewpoint] ?? 0) + 1;
    expect(by).toEqual({
      component: 1,
      code: 6,
      runtime: 11,
      "actors-goals": 5,
      lifecycle: 3,
      data: 1,
      context: 1,
      container: 1,
      deployment: 2,
    });
    expect(
      out.data.diagrams.filter((d) => !d.conforms).map((d) => d.name),
    ).toEqual([]);
    // Issue #43: each drawn with its viewpoint's default template, and
    // each passing against that template's golden exemplar.
    expect(
      out.data.diagrams.filter((d) => !d.accepted).map((d) => d.name),
    ).toEqual([]);
    expect(out.data.diagrams.every((d) => d.template)).toBe(true);
    const lint = await call<{
      diagrams: number;
      counts: Record<string, number>;
      findings: { rule: string; path: string; message: string }[];
    }>("/viewpoint_lint", { scope: model, limit: 1000 });
    expect(lint.data.diagrams).toBe(31);
    expect(lint.data.findings).toEqual([]);
    const again = await call<Derived>("/derive_diagrams", {
      scope: model,
      kinds: ALL_KINDS,
      viewpoints: ALL_VIEWPOINTS,
    });
    expect(again.data.counts).toMatchObject({ created: 0, deleted: 0 });
  }, 900_000);

  it.each([
    [
      "how does a device publish telemetry over MQTT",
      "developer",
      "runtime",
      "sequence",
      ["Seq - Telemetry ingestion over MQTT"],
    ],
    [
      "which states can an alarm be in",
      "tester",
      "lifecycle",
      "statemachine",
      ["State - Alarm lifecycle"],
    ],
    [
      "what does the platform talk to: the big picture",
      "business",
      "context",
      "c4",
      ["ThingsBoard context"],
    ],
    [
      "which services and data stores make up the platform, and their technology",
      "architect",
      "container",
      "c4",
      ["ThingsBoard containers"],
    ],
    [
      "where does it run in a microservices deployment",
      "operator",
      "deployment",
      "deployment",
      ["Deployment - Microservices"],
    ],
    [
      "what data is stored in the database",
      "dba",
      "data",
      "erd",
      ["ThingsBoard data model"],
    ],
    [
      "what can a tenant administrator do",
      "analyst",
      "actors-goals",
      "usecase",
      ["Use Cases - Tenant Administrator"],
    ],
    [
      "how are the packages layered and which depend on which",
      "architect",
      "component",
      "package",
      ["ThingsBoard packages"],
    ],
    [
      "show the classes of the rule engine",
      "developer",
      "code",
      "class",
      ["Class - Rule Engine"],
    ],
    [
      "how is a rule chain executed step by step",
      "developer",
      "runtime",
      "activity",
      ["Activity - Rule chain execution"],
    ],
  ])(
    "request_diagram: %s (%s) → %s %s",
    async (intent, audience, viewpoint, kind, names) => {
      const r = await call<Requested>("/request_diagram", {
        intent,
        audience,
        scope: "ThingsBoard",
      });
      expect(r.success, JSON.stringify(r).slice(0, 600)).toBe(true);
      expect(r.data.choice).toMatchObject({ viewpoint, kind });
      expect(r.data.diagrams.map((d) => d.name)).toEqual(names);
      for (const d of r.data.diagrams) {
        expect(d.conforms).toBe(true);
        expect(d.quality!.score).toBeGreaterThanOrEqual(80);
      }
    },
    300_000,
  );

  it("refuses what does not fit, with the views that do", async () => {
    const audience = await call<never>("/request_diagram", {
      intent: "show the classes",
      audience: "business",
      scope: "ThingsBoard",
    });
    expect(audience).toMatchObject({
      status: 422,
      code: "VIEWPOINT_MISMATCH",
      details: { reason: "audience" },
    });
    const scope = await call<never>("/request_diagram", {
      intent: "show the lifecycle",
      scope: "ThingsBoard/System Administrator",
    });
    expect(scope).toMatchObject({
      code: "VIEWPOINT_MISMATCH",
      details: { reason: "scope", wanted: { viewpoint: "lifecycle" } },
    });
    const unclear = await call<never>("/request_diagram", {
      intent: "make it look nice",
      scope: "ThingsBoard",
    });
    expect(unclear).toMatchObject({
      code: "VIEWPOINT_MISMATCH",
      details: { reason: "unclear" },
    });
    const lifeline = await call<{ name: string }>("/request_diagram", {
      intent: "its lifecycle",
      scope: "ThingsBoard/Domain Model \\(common\\.data\\)/Device",
    });
    expect(lifeline.success).toBe(true);
  }, 300_000);

  it("refuses a scenario past the lifeline limit, offering an activity or a split", async () => {
    const parts = Array.from({ length: 14 }, (_, i) => `Part${i}`);
    await call("/build_model", {
      spec: {
        system: "Crowd",
        collaborations: [
          {
            name: "Rush",
            messages: parts.slice(1).map((p, i) => [parts[i], p, `step${i}()`]),
          },
        ],
      },
    });
    const r = await call<never>("/request_diagram", {
      intent: "the sequence of messages",
      scope: "Crowd",
    });
    expect(r).toMatchObject({
      code: "VIEWPOINT_MISMATCH",
      details: {
        reason: "limits",
        alternatives: [{ kind: "activity" }, { kind: "sequence" }],
      },
    });
  }, 120_000);

  it("refuses a diagram without a template under a strict profile", async () => {
    await call("/set_style_profile", { patch: { strict: true } });
    const free = await call("/build_diagram", {
      kind: "class",
      name: "Free",
      viewpoint: "code",
      spec: { classes: [{ name: "A" }] },
    });
    expect(free).toMatchObject({ status: 403, code: "TEMPLATE_ONLY" });
    const empty = await call("/create_diagram", { type: "UMLClassDiagram" });
    expect(empty).toMatchObject({ status: 403, code: "VIEWPOINT_REQUIRED" });
    const declared = await call<{ viewpoint: { conforms: boolean } }>(
      "/build_diagram",
      {
        name: "Declared",
        template: "code-classes",
        spec: { classes: [{ name: "A" }] },
      },
    );
    expect(declared.data.viewpoint.conforms).toBe(true);
    await call("/set_style_profile", { reset: true });
  }, 120_000);

  it("lists and describes the catalogue", async () => {
    const list = await call<{ viewpoints: { name: string }[] }>(
      "/list_viewpoints",
    );
    expect(list.data.viewpoints.map((v) => v.name)).toEqual(ALL_VIEWPOINTS);
    const one = await call<{ viewpoint: { question: string } }>(
      "/describe_viewpoint",
      { name: "context" },
    );
    expect(one.data.viewpoint.question).toMatch(/\?$/);
  });
});
