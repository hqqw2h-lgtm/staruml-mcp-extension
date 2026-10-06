import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import tb from "../../fixtures/domains/thingsboard.oo.json";
import { ApiError } from "../../../src/errors.js";
import { manifest } from "../../../src/handlers/introspect.js";
import { parseModelSpec } from "../../../src/model/spec.js";
import { endpoints } from "../../../src/routes.js";
import { DRAWING_ENDPOINTS } from "../../../src/style/guard.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;

beforeEach(() => {
  env = installMockApp();
});

describe("the OO spec is strict (issue #33)", () => {
  it("refuses geometry, colours and any unknown field, at every level, before anything happens", async () => {
    const before = env.app.repository.getInstancesOf("UMLClass").length;
    for (const spec of [
      { classes: [{ name: "A", x: 10 }] },
      { classes: [{ name: "A", attributes: [{ name: "a", width: 3 }] }] },
      {
        relationships: [
          { from: "A", to: "B", type: "owns", lineColor: "#000" },
        ],
      },
      { collaborations: [{ name: "C", layout: "LR" }] },
      { lifecycles: [{ name: "L", states: [{ id: "s", left: 1 }] }] },
      {
        deployments: [{ name: "D", nodes: [{ name: "N", fillColor: "#fff" }] }],
      },
      { features: { name: "F", children: [{ name: "G", top: 2 }] } },
      { diagram: "class" },
    ]) {
      const refused = await fails(
        ep("/build_model"),
        { spec },
        "INVALID_ARGUMENT",
      );
      expect(refused.error).toMatch(/^spec[.:]/);
    }
    expect(env.app.repository.getInstancesOf("UMLClass")).toHaveLength(before);
  });

  it("publishes a JSON Schema without additional properties or geometry fields", () => {
    const entry = manifest(endpoints).find((e) => e.path === "/build_model")!;
    const spec = (
      entry.request as { properties: { spec: Record<string, unknown> } }
    ).properties.spec;
    expect(spec.additionalProperties).toBe(false);
    const text = JSON.stringify(spec);
    for (const field of [
      '"x"',
      '"y"',
      '"left"',
      '"top"',
      '"width"',
      '"height"',
      '"fillColor"',
      '"lineColor"',
    ]) {
      expect(text).not.toContain(`${field}:`);
    }
  });

  it("reads the ThingsBoard analysis, and never answers anything but INVALID_ARGUMENT (fuzz)", () => {
    expect(parseModelSpec(tb).classes).toHaveLength(93);
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.record({
            classes: fc.array(fc.dictionary(fc.string(), fc.jsonValue()), {
              maxLength: 3,
            }),
          }),
          fc.dictionary(
            fc.constantFrom("classes", "erd", "features", "deployments", "x"),
            fc.jsonValue(),
          ),
        ),
        (value) => {
          try {
            parseModelSpec(value);
          } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).code).toBe("INVALID_ARGUMENT");
          }
        },
      ),
      { numRuns: 300 },
    );
    // Hundreds of parses of a 90 KB analysis; the load of a parallel run
    // can take it past the default 5 s.
  }, 60_000);
});

describe("/introspect capabilities", () => {
  const listed = async (body: Record<string, unknown>) =>
    ok<{
      endpoints: { path: string }[];
      capabilities?: { hidden: string[]; strict: boolean };
    }>(ep("/introspect"), {
      include: ["endpoints"],
      ...body,
    });

  it("hides every drawing endpoint from the oo set under a strict profile, only then", async () => {
    const all = await listed({});
    expect(all.capabilities).toBeUndefined();
    const loose = await listed({ capabilities: "oo" });
    expect(loose.endpoints).toHaveLength(all.endpoints.length);
    expect(loose.capabilities).toEqual({
      set: "oo",
      strict: false,
      hidden: [],
    });
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    const oo = await listed({ capabilities: "oo" });
    const paths = oo.endpoints.map((e) => e.path);
    for (const p of DRAWING_ENDPOINTS) expect(paths).not.toContain(p);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/build_model",
        "/derive_diagrams",
        "/model_lint",
        "/explain_model",
        "/improve_diagram",
      ]),
    );
    expect(oo.capabilities!.hidden).toEqual([...DRAWING_ENDPOINTS]);
    expect((await listed({ capabilities: "all" })).endpoints).toHaveLength(
      all.endpoints.length,
    );
  });
});

interface Linted {
  findings: { rule: string; severity: string; message: string }[];
}

describe("/model_lint", () => {
  it("finds each design smell, with its severity and fix", async () => {
    await ok(ep("/build_model"), {
      spec: {
        system: "Smells",
        contexts: [
          { id: "a", name: "A", dependsOn: ["b"] },
          { id: "b", name: "B", dependsOn: ["c", "a"] },
          { id: "c", name: "C", dependsOn: ["a", "a"] },
          { id: "d", name: "D", dependsOn: ["c"] },
        ],
        classes: [
          {
            name: "God",
            context: "a",
            operations: Array.from({ length: 21 }, (_, i) => `+op${i}(): void`),
          },
          {
            name: "Data",
            context: "a",
            attributes: ["+a: int", "+b: int", "+c: int"],
          },
          {
            name: "Dto",
            context: "a",
            stereotype: "dto",
            attributes: ["+a: int", "+b: int", "+c: int"],
          },
          {
            name: "Envy",
            context: "b",
            operations: ["+sum(x: Data, y: Data): int", "-hidden(): void"],
          },
          { name: "Port", context: "b", kind: "interface" },
          { name: "Nobody", context: "b", kind: "interface" },
          { name: "Adapter", context: "b" },
          { name: "Unused", context: "c" },
        ],
        relationships: [
          { from: "Adapter", to: "Port", type: "implements" },
          { from: "God", to: "Data", type: "uses" },
          { from: "Envy", to: "Data", type: "uses" },
          { from: "Dto", to: "God", type: "uses" },
        ],
        collaborations: [
          {
            name: "Run",
            participants: ["God", "Data"],
            messages: [["God", "God", "op0()"]],
          },
        ],
      },
    });
    const all = await ok<Linted>(ep("/model_lint"), { scope: "Smells" });
    const rules = [...new Set(all.findings.map((f) => f.rule))].sort();
    expect(rules).toEqual([
      "M001",
      "M002",
      "M003",
      "M004",
      "M005",
      "M006",
      "M007",
    ]);
    expect(all.findings[0]).toMatchObject({ rule: "M003", severity: "error" });
    // A -> B -> C -> A and A -> B -> A, each cycle once.
    expect(all.findings.filter((f) => f.rule === "M003")).toHaveLength(2);
    expect(all.findings.some((f) => f.message.includes("Dto"))).toBe(false);
    const some = await ok<Linted>(ep("/model_lint"), {
      rules: { M003: "off", "god-class": "info", M007: "off" },
    });
    expect(some.findings.map((f) => f.rule)).not.toContain("M003");
    expect(some.findings.find((f) => f.rule === "M001")!.severity).toBe("info");
    await fails(
      ep("/model_lint"),
      { rules: { M999: "off" } },
      "INVALID_ARGUMENT",
    );
  });

  it("blocks saving on a package cycle when the profile says so", async () => {
    await ok(ep("/build_model"), {
      spec: {
        system: "Cycle",
        contexts: [
          { id: "a", name: "A", dependsOn: ["b"] },
          { id: "b", name: "B", dependsOn: ["a"] },
        ],
      },
    });
    await ok(ep("/set_style_profile"), { patch: { blockSaveOnErrors: true } });
    const refused = await fails(
      ep("/save_project"),
      { filename: "/tmp/x.mdj" },
      "SAVE_BLOCKED",
    );
    expect(refused.details).toMatchObject({ findings: [{ rule: "M003" }] });
  });
});

describe("/explain_model", () => {
  it("lists the view sections stored with the model", async () => {
    await ok(ep("/build_model"), {
      spec: {
        system: "Views",
        classes: [{ name: "A" }],
        classViews: [{ name: "All", classes: ["A"] }],
        useCaseViews: [{ name: "Goals" }],
        activities: [{ name: "Flow", nodes: [{ id: "a" }], flows: [] }],
        erd: { entities: [{ name: "a" }] },
        components: { elements: [{ name: "Web", type: "container" }] },
        deployments: [{ name: "Prod", nodes: [{ name: "Host" }] }],
        features: { name: "Map" },
      },
    });
    const out = await ok<{ text: string }>(ep("/explain_model"), {
      scope: "Views",
      sections: ["views"],
    });
    expect(out.text.split("\n")).toEqual([
      "",
      "## Views",
      "- class views: All",
      "- use case views: Goals",
      "- activities: Flow",
      "- ERD: 1 entities",
      "- C4: 1 elements",
      "- deployments: Prod",
      "- mind map: Map",
    ]);
    await ok(ep("/build_model"), {
      spec: {
        system: "Named",
        erd: { name: "Data", entities: [{ name: "a" }] },
        components: {
          name: "Boxes",
          elements: [{ name: "Web", type: "container" }],
        },
      },
    });
    const named = await ok<{ text: string }>(ep("/explain_model"), {
      scope: "Named",
      sections: ["views", "classes"],
    });
    expect(named.text).toContain("- ERD Data: 1 entities");
    expect(named.text).toContain("- C4 Boxes: 1 elements");
    // A line longer than half the room is cut inside it.
    await ok(ep("/build_model"), {
      spec: {
        system: "Wordy",
        classes: [{ name: "Long", responsibility: "word ".repeat(100) }],
      },
    });
    const cut = await ok<{ text: string; next: number }>(ep("/explain_model"), {
      scope: "Wordy",
      sections: ["classes"],
      maxChars: 200,
    });
    expect(cut.next).toBe(200);
    expect(cut.text.split("\n[truncated")[0]).toHaveLength(200);
    // The project belongs to no model and has no stored views.
    const none = await ok<{ text: string }>(ep("/explain_model"), {
      sections: ["views"],
    });
    expect(none.text).toBe("");
  });

  it("reads the model back as text: responsibilities, verbs, collaborations, lifecycles, goals", async () => {
    await ok(ep("/build_model"), {
      spec: {
        system: "Shop",
        summary: "Sells things.",
        contexts: [
          { id: "s", name: "Sales", responsibility: "Takes orders." },
          { id: "e", name: "Empty" },
        ],
        classes: [
          {
            name: "Order",
            context: "s",
            responsibility: "Holds lines.",
            operations: ["+place(): void"],
          },
          { name: "Line", context: "s" },
          { name: "Base", context: "s", kind: "abstract" },
          { name: "Port", context: "s", kind: "interface" },
          { name: "Kind", context: "s", kind: "enum" },
          { name: "Cart" },
        ],
        relationships: [
          { from: "Order", to: "Line", type: "owns", toMult: "1..*" },
          { from: "Order", to: "Cart", type: "has" },
          { from: "Order", to: "Kind", type: "knows" },
          { from: "Order", to: "Base", type: "isA" },
          { from: "Order", to: "Port", type: "implements" },
          { from: "Order", to: "Line", type: "uses" },
          { from: "Idle", to: "Clerk", type: "isA" },
          { from: "Clerk", to: "Order", type: "knows" },
        ],
        actors: ["Clerk", "Idle"],
        useCases: [{ name: "Place order", actors: ["Clerk"] }],
        collaborations: [
          { name: "Checkout", messages: [["Clerk", "Order", "place()"]] },
        ],
        lifecycles: [
          {
            name: "Order life",
            subject: "Order",
            states: [{ id: "i", type: "initial" }, "Open"],
            transitions: [
              { from: "i", to: "Open", trigger: "go" },
              { from: "Open", to: "Open" },
            ],
          },
          { name: "Free life", states: ["A"] },
        ],
      },
    });
    // A relationship the verbs do not name, and a collaboration without its interaction.
    await ok(ep("/create_relationship"), {
      type: "UMLAbstraction",
      tail: "Shop/Sales/Order",
      head: "Shop/Sales/Line",
    });
    await ok(ep("/create_element"), {
      type: "UMLCollaboration",
      parent: "Shop",
      name: "Empty talk",
    });
    const out = await ok<{ text: string; truncated: boolean }>(
      ep("/explain_model"),
      { scope: "Shop" },
    );
    expect(out.truncated).toBe(false);
    for (const part of [
      "Shop: 2 packages, 6 classifiers, 2 actors, 1 use cases, 2 collaborations, 2 lifecycles",
      "Sells things.",
      "## Shop/Sales",
      "Takes orders.",
      "- Order (class): Holds lines.",
      "owns Line [1..*]",
      "has Cart",
      "knows Kind",
      "is a Base",
      "implements Port",
      "uses Line",
      "does: place()",
      "- Base (abstract)",
      "- Port (interface)",
      "- Kind (enumeration)",
      "## Shop",
      "- Checkout: Clerk -> Order: place()",
      "- Order life (of Order): Pseudostate -> Open on go",
      "- Free life: ",
      "- Clerk: Place order",
      "Open -> Open",
      "- Empty talk: ",
      "- Idle: (no use case)",
    ]) {
      expect(out.text).toContain(part);
    }
    const whole = await ok<{ text: string }>(ep("/explain_model"), {});
    // Cut answers read on with their cursor to the same text, each ending
    // with a marker naming where it stopped.
    let cursor = 0;
    let read = "";
    const stops: string[] = [];
    for (;;) {
      const part = await ok<{
        text: string;
        truncated: boolean;
        next?: number;
        stoppedIn?: string;
        total?: number;
      }>(ep("/explain_model"), { maxChars: 200, cursor });
      if (!part.truncated) {
        read += part.text;
        break;
      }
      const marker = part.text.lastIndexOf("\n[truncated in ");
      expect(marker).toBeGreaterThan(0);
      expect(part.text.slice(marker)).toContain(
        `call again with cursor: ${part.next}`,
      );
      expect(part.total).toBe(whole.text.length);
      read += whole.text.slice(cursor, part.next);
      expect(part.text.slice(0, marker)).toBe(
        whole.text.slice(cursor, part.next).replace(/\n$/, ""),
      );
      stops.push(part.stoppedIn!);
      cursor = part.next!;
    }
    expect(read).toBe(whole.text);
    expect(stops).toContain("classes");
    expect(new Set(stops).size).toBeGreaterThan(1);
    // A line longer than half the room is cut inside.
    const tight = await ok<{ text: string; next: number }>(
      ep("/explain_model"),
      { maxChars: 200, cursor: whole.text.indexOf("- Order (class)") },
    );
    expect(tight.next).toBeGreaterThan(0);
    const only = await ok<{ text: string; truncated: boolean }>(
      ep("/explain_model"),
      { scope: "Shop", sections: ["lifecycles", "useCases"] },
    );
    expect(only.text).toContain("## Lifecycles");
    expect(only.text).not.toContain("## Shop/Sales");
    expect(only.text.startsWith("\n## Lifecycles")).toBe(true);
    const past = await ok<{ text: string; truncated: boolean }>(
      ep("/explain_model"),
      { cursor: 10_000_000 },
    );
    expect(past).toEqual({ text: "", truncated: false });
    const bare = await ok<{ text: string }>(ep("/explain_model"), {
      scope: "Model",
    });
    expect(bare.text).toContain("Model: 0 packages");
    void (env.project as Element);
  });
});
