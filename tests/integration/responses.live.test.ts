import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { BASE_URL, call, describeLive, headers } from "./support.js";

// Issue #40 on StarUML 7.1.1: answers that scaled with the model are
// bounded, misses name what was meant, an object spec refuses UML words
// and geometry with the fix, and a pattern bound to an interface is built
// as detection reads it back.

/** A call as an MCP client makes it, with the size of what it answers. */
async function measured(path: string, body: Record<string, unknown>) {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { chars: text.length, json: JSON.parse(text) };
}

interface Detected {
  count: number;
  duplicates?: number;
  detections: {
    pattern: string;
    confidence: number;
    roles: Record<string, { _id: string; path: string | null }[]>;
    missing: string[];
  }[];
}

describeLive("compact answers and hints (#40)", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("answers the ThingsBoard dry run as a summary, the full plan on request", async () => {
    const summary = await measured("/build_model", { spec: tb, dryRun: true });
    expect(summary.json.success).toBe(true);
    const full = await measured("/build_model", {
      spec: tb,
      dryRun: true,
      detail: "full",
    });
    expect(full.json.data.counts).toEqual(summary.json.data.counts);
    expect(summary.json.data.plan.ops).toHaveLength(20);
    expect(summary.json.data.omitted.ops).toBe(
      full.json.data.plan.ops.length - 20,
    );
    // 80 KB in the validation; the summary is a few KB.
    expect(full.chars).toBeGreaterThan(50_000);
    expect(summary.chars).toBeLessThan(15_000);
  });

  it("explains the model by section, marking a cut and reading on from its cursor", async () => {
    const built = await call<{ model: { _id: string } }>("/build_model", {
      spec: tb,
    });
    expect(built.success).toBe(true);
    const scope = built.data.model._id;
    const whole = await call<{ text: string; truncated: boolean }>(
      "/explain_model",
      { scope, maxChars: 1_000_000 },
    );
    expect(whole.data.truncated).toBe(false);
    for (const heading of ["## Lifecycles", "## Use cases", "## Views"]) {
      expect(whole.data.text).toContain(heading);
    }
    let cursor = 0;
    let read = "";
    for (let i = 0; i < 50; i++) {
      const part = await call<{
        text: string;
        truncated: boolean;
        next?: number;
        stoppedIn?: string;
      }>("/explain_model", { scope, maxChars: 20_000, cursor });
      if (!part.data.truncated) {
        read += part.data.text;
        break;
      }
      expect(part.data.text).toMatch(
        new RegExp(
          `\\n\\[truncated in ${part.data.stoppedIn} at ${part.data.next} of \\d+ chars; call again with cursor: ${part.data.next}`,
        ),
      );
      read += whole.data.text.slice(cursor, part.data.next);
      cursor = part.data.next!;
    }
    expect(read).toBe(whole.data.text);
    const views = await call<{ text: string }>("/explain_model", {
      scope,
      sections: ["views"],
    });
    expect(views.data.text).toContain("- deployments: ");
    expect(views.data.text).not.toContain("## Collaborations");
  });

  it("lists the nearest names with NOT_FOUND", async () => {
    const miss = await call("/derive_diagrams", { scope: "ThingsBord" });
    expect(miss.code).toBe("NOT_FOUND");
    expect(miss.error).toContain("nearest: ThingsBoard");
    expect(
      (miss.details as { candidates: { path: string }[] }).candidates.length,
    ).toBeLessThanOrEqual(5);
  });

  it("refuses UML words and geometry in an object spec, naming the fix", async () => {
    const word = await call("/build_model", {
      spec: {
        name: "Words",
        classes: [{ name: "A" }, { name: "B" }],
        relationships: [{ from: "A", to: "B", type: "composition" }],
      },
    });
    expect(word.code).toBe("INVALID_ARGUMENT");
    expect(word.error).toContain(
      "composition is a UML word; an object spec writes the verb owns",
    );
    const geometry = await call("/build_model", {
      spec: { name: "Geo", classes: [{ name: "A", x: 10, fillColor: "#f00" }] },
    });
    expect(geometry.code).toBe("INVALID_ARGUMENT");
    expect(geometry.error).toContain(
      "geometry and colours are never part of a spec",
    );
  });

  it("builds Observer on interfaces the way detection reads it, at confidence 1", async () => {
    await call("/new_project");
    await call("/create_element", {
      type: "UMLModel",
      parent: "@project",
      name: "Model",
    });
    for (const [name, type] of [
      ["SubscriptionManager", "UMLInterface"],
      ["Listener", "UMLInterface"],
      ["TelemetryService", "UMLClass"],
      ["TransportHandler", "UMLClass"],
    ]) {
      await call("/create_element", { type, parent: "Model", name });
    }
    const applied = await call<{ warnings?: string[] }>("/apply_pattern", {
      pattern: "Observer",
      bindings: {
        Subject: "SubscriptionManager",
        Observer: "Listener",
        ConcreteSubject: "TelemetryService",
        ConcreteObserver: ["TransportHandler"],
      },
      diagram: "Observer",
    });
    expect(applied.success, JSON.stringify(applied)).toBe(true);
    expect(applied.data.warnings![0]).toContain(
      "generalizations to it are realizations",
    );
    const found = await call<Detected>("/detect_patterns", {
      patterns: ["Observer"],
    });
    const best = found.data.detections[0]!;
    expect(best.confidence).toBe(1);
    expect(best.roles.ConcreteSubject![0]!.path).toBe("Model/TelemetryService");
    const refused = await call("/apply_pattern", {
      pattern: "Observer",
      bindings: { ConcreteSubject: "Listener" },
    });
    expect(refused.code).toBe("INVALID_ARGUMENT");
    expect(refused.error).toContain("bind a class");
    // The default threshold leaves the guesses out.
    const all = await call<Detected>("/detect_patterns", {});
    expect(all.data.detections.every((d) => d.confidence >= 0.8)).toBe(true);
  });
});
