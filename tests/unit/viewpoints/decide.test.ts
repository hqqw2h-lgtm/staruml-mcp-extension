import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Decision,
  decide,
  normalizeIntent,
} from "../../../src/viewpoints/decide.js";
import { viewpointCatalogue } from "../../../src/viewpoints/index.js";
import {
  AUDIENCES,
  type Audience,
  SCOPE_KINDS,
  type ScopeKind,
} from "../../../src/viewpoints/schema.js";

// Issue #42: the decision table is a total, deterministic function of the
// intent, the audience and the kind of scope.

const { table, byName } = viewpointCatalogue();
const phrases = table.rules.flatMap((r) => [...r.phrases, ...(r.weak ?? [])]);

const intent = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.string({ unit: "grapheme", maxLength: 40 }),
  fc
    .array(
      fc.oneof(
        fc.constantFrom(...phrases),
        fc.constantFrom("the", "how", "of"),
      ),
      { maxLength: 6 },
    )
    .map((ws) => ws.join(" ")),
  fc
    .tuple(fc.constantFrom(...phrases), fc.string({ maxLength: 10 }))
    .map(([p, x]) => `${p.toUpperCase()}!${x}`),
);
const scope = fc.constantFrom(...SCOPE_KINDS);
const audience = fc.option(fc.constantFrom(...AUDIENCES), { nil: undefined });

function holds(d: Decision, s: ScopeKind, a: Audience | undefined): void {
  if (d.ok) {
    const rule = table.rules.find((r) => r.id === d.rule)!;
    expect(rule.scopes).toContain(s);
    expect(rule.viewpoint).toBe(d.viewpoint);
    expect(byName.get(d.viewpoint)!.kinds).toContain(d.kind);
    if (a !== undefined) {
      expect(byName.get(d.viewpoint)!.stakeholders).toContain(a);
    }
    expect(d.reason.length).toBeGreaterThan(0);
    return;
  }
  expect(d.alternatives.length).toBeGreaterThan(0);
  for (const alt of d.alternatives) {
    expect(byName.get(alt.viewpoint)!.kinds).toContain(alt.kind);
    if (d.problem === "audience") {
      expect(byName.get(alt.viewpoint)!.stakeholders).toContain(a);
    }
  }
}

describe("decide (property)", () => {
  it("is total: every intent, scope and audience gets a choice or a refusal with alternatives", () => {
    fc.assert(
      fc.property(intent, scope, audience, (i, s, a) => {
        const d = decide({ intent: i, scope: s, ...(a && { audience: a }) });
        holds(d, s, a);
      }),
      { numRuns: 2000 },
    );
  });

  it("is deterministic: the same input gives the same answer", () => {
    fc.assert(
      fc.property(intent, scope, audience, (i, s, a) => {
        const input = { intent: i, scope: s, ...(a && { audience: a }) };
        expect(decide(input)).toEqual(decide(structuredClone(input)));
      }),
      { numRuns: 500 },
    );
  });

  it("ignores case, punctuation and accents", () => {
    fc.assert(
      fc.property(fc.constantFrom(...phrases), scope, (p, s) => {
        const loud = `  ${p.toUpperCase().split(" ").join(" -- ")}?! `;
        expect(decide({ intent: loud, scope: s })).toEqual(
          decide({ intent: p, scope: s }),
        );
      }),
    );
    expect(normalizeIntent("Café  Déjà-vu!")).toBe("cafe deja vu");
  });

  it("reaches every rule through a phrase of its own", () => {
    for (const r of table.rules) {
      const reached = r.phrases.some((p) => {
        const d = decide({ intent: p, scope: r.scopes[0]! });
        return d.ok && d.rule === r.id;
      });
      expect(reached, r.id).toBe(true);
    }
  });
});

describe("decide (cases)", () => {
  const pick = (i: string, s: ScopeKind = "model", a?: Audience) =>
    decide({ intent: i, scope: s, ...(a && { audience: a }) });

  it.each([
    ["how does a device publish telemetry over MQTT", "runtime", "sequence"],
    ["which states can an alarm be in", "lifecycle", "statemachine"],
    ["what does the system talk to, the big picture", "context", "c4"],
    ["which services make up the platform", "container", "c4"],
    [
      "where does it run in a microservices deployment",
      "deployment",
      "deployment",
    ],
    ["what data is stored", "data", "erd"],
    ["what can a tenant administrator do", "actors-goals", "usecase"],
    ["which features does it offer", "actors-goals", "mindmap"],
    ["how are the packages layered", "component", "package"],
    ["show the classes of the rule engine", "code", "class"],
    ["how is a rule chain executed step by step", "runtime", "activity"],
    ["who talks to whom at login", "runtime", "communication"],
  ] as const)("%s → %s %s", (i, viewpoint, kind) => {
    expect(pick(i)).toMatchObject({ ok: true, viewpoint, kind });
  });

  it("falls back to the scope's own view when no phrase matches, and says so", () => {
    expect(pick("tell me about it", "statemachine")).toMatchObject({
      ok: true,
      viewpoint: "lifecycle",
      matched: [],
      reason: expect.stringMatching(/by default\)$/),
    });
    expect(pick("tell me about it", "model")).toMatchObject({
      ok: false,
      problem: "unclear",
    });
    const other = pick("tell me about it", "other");
    expect(other).toMatchObject({ ok: false, problem: "unclear" });
    expect((other as { alternatives: unknown[] }).alternatives).toHaveLength(
      12,
    );
  });

  it("refuses a view not drawn for the scope, with the same view for another scope first", () => {
    const d = pick("show the lifecycle", "actor");
    expect(d).toMatchObject({
      ok: false,
      problem: "scope",
      wanted: { viewpoint: "lifecycle", kind: "statemachine", rule: "D01" },
      reason: expect.stringMatching(/not an actor$/),
    });
    const alts = (d as { alternatives: { viewpoint: string }[] }).alternatives;
    expect(alts[0]!.viewpoint).toBe("lifecycle");
    expect(alts.map((a) => a.viewpoint)).toContain("actors-goals");
    expect(pick("data model", "package")).toMatchObject({
      ok: false,
      problem: "scope",
      reason: expect.stringMatching(/not a package$/),
    });
  });

  it("takes a weaker rule drawn for the scope when the stronger one is not, unless it is stronger still", () => {
    // 'lifecycle' (1) and 'use case' (2): only the use case is drawn for an actor.
    expect(pick("lifecycle use case", "actor")).toMatchObject({
      ok: true,
      viewpoint: "actors-goals",
    });
    // 'state machine' + 'states' (3) beat 'actor' (1).
    expect(pick("state machine states of an actor", "actor")).toMatchObject({
      ok: false,
      problem: "scope",
    });
  });

  it("refuses a view not written for the audience, offering ones that are", () => {
    const d = pick("show the classes", "model", "business");
    expect(d).toMatchObject({
      ok: false,
      problem: "audience",
      wanted: { viewpoint: "code" },
    });
    expect(pick("show the classes", "model", "developer")).toMatchObject({
      ok: true,
      viewpoint: "code",
    });
  });
});
