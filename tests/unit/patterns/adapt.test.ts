import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_CONFIDENCE,
  withoutDuplicates,
} from "../../../src/handlers/patterns.js";
import { adaptRole, relationType } from "../../../src/patterns/adapt.js";
import type { Detection } from "../../../src/patterns/detect.js";
import { findPattern } from "../../../src/patterns/index.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

// Issue #40: a role bound to an element of another metaclass is adapted
// the same way when applied and when detected, or refused with the reason.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const apply = ep("/apply_pattern");
const detect = ep("/detect_patterns");

beforeEach(() => {
  env = installMockApp();
});

const get = (id: string) => env.app.repository.get(id)! as Element;
const make = async (name: string, type = "UMLClass") =>
  get(
    (
      await ok<{ _id: string }>(ep("/create_element"), {
        type,
        parent: env.model._id,
        name,
      })
    )._id,
  );
const relationsOf = (e: Element) =>
  env.app.repository.getRelationshipsOf(e as never) as Element[];

interface Found {
  count: number;
  duplicates?: number;
  detections: {
    pattern: string;
    confidence: number;
    roles: Record<string, { _id: string }[]>;
    missing: string[];
  }[];
}

describe("an interface in an abstract class role", () => {
  it("is realized, gets abstract public operations, and is detected back at 1 (Observer)", async () => {
    const subject = await make("SubscriptionManager", "UMLInterface");
    const listener = await make("Listener", "UMLInterface");
    const telemetry = await make("TelemetryService");
    const handler = await make("TransportHandler");
    // A class associated with the subject the way ConcreteSubject is, but
    // not realizing it: the validation bound such a one by mistake.
    const decoy = await make("SessionCtx");
    await ok(ep("/create_relationship"), {
      type: "UMLAssociation",
      tail: handler._id,
      head: decoy._id,
    });
    const applied = await ok<{ warnings?: string[] }>(apply, {
      pattern: "Observer",
      bindings: {
        Subject: "SubscriptionManager",
        Observer: "Listener",
        ConcreteSubject: "TelemetryService",
        ConcreteObserver: ["TransportHandler"],
      },
    });
    expect(applied.warnings).toEqual([
      "Subject is an abstract class in Observer; Model/SubscriptionManager is a UMLInterface: its operations are abstract and public, and generalizations to it are realizations",
    ]);
    const toSubject = relationsOf(telemetry).filter(
      (r) => r.target === subject,
    );
    expect(toSubject.map((r) => r.constructor.name)).toEqual([
      "UMLInterfaceRealization",
    ]);
    const ops = subject.operations as Element[];
    expect(ops.map((o) => [o.name, o.isAbstract, o.visibility])).toEqual([
      ["attach", true, "public"],
      ["detach", true, "public"],
      ["notify", true, "public"],
    ]);
    expect(subject.isAbstract).not.toBe(true);
    void listener;
    const found = await ok<Found>(detect, { patterns: ["Observer"] });
    const best = found.detections[0]!;
    expect(best.confidence).toBe(1);
    expect(best.missing).toEqual([]);
    expect(best.roles.ConcreteSubject![0]!._id).toBe(telemetry._id);
    expect(best.roles.Subject![0]!._id).toBe(subject._id);
    // Applied again, nothing changes.
    const again = await ok<{ created: number; updated: number }>(apply, {
      pattern: "Observer",
      bindings: {
        Subject: "SubscriptionManager",
        Observer: "Listener",
        ConcreteSubject: "TelemetryService",
        ConcreteObserver: ["TransportHandler"],
      },
    });
    expect([again.created, again.updated]).toEqual([0, 0]);
  });

  it("is realized by every concrete handler (Chain of Responsibility)", async () => {
    const node = await make("TbNode", "UMLInterface");
    const filter = await make("FilterNode");
    const log = await make("LogNode");
    await ok(apply, {
      pattern: "Chain of Responsibility",
      bindings: {
        Handler: "TbNode",
        ConcreteHandler: ["FilterNode", "LogNode"],
      },
    });
    for (const c of [filter, log]) {
      expect(
        relationsOf(c)
          .filter((r) => r.target === node)
          .map((r) => r.constructor.name),
      ).toEqual(["UMLInterfaceRealization"]);
    }
    const found = await ok<Found>(detect, {
      patterns: ["Chain of Responsibility"],
    });
    expect(found.detections[0]!.confidence).toBe(1);
  });
});

describe("a class in an interface role", () => {
  it("is made abstract and specialised, and is detected back at 1 (Strategy)", async () => {
    const method = await make("PaymentMethod");
    const card = await make("Card");
    const applied = await ok<{ warnings?: string[] }>(apply, {
      pattern: "Strategy",
      bindings: { Strategy: "PaymentMethod", ConcreteStrategy: ["Card"] },
    });
    expect(applied.warnings).toEqual([
      "Strategy is an interface in Strategy; Model/PaymentMethod is a UMLClass: it is made abstract, and realizations of it are generalizations",
    ]);
    expect(method.isAbstract).toBe(true);
    expect(
      relationsOf(card)
        .filter((r) => r.target === method)
        .map((r) => r.constructor.name),
    ).toEqual(["UMLGeneralization"]);
    const found = await ok<Found>(detect, { patterns: ["Strategy"] });
    expect(found.detections[0]!.confidence).toBe(1);
  });
});

describe("refused bindings", () => {
  it("names the role an interface cannot play and why", async () => {
    await make("Port", "UMLInterface");
    await make("Kind", "UMLEnumeration");
    await fails(
      apply,
      { pattern: "Observer", bindings: { ConcreteSubject: "Port" } },
      "INVALID_ARGUMENT",
      "bindings.ConcreteSubject: Model/Port is a UMLInterface; ConcreteSubject is a concrete class in Observer, which the pattern instantiates; bind a class",
    );
    await fails(
      apply,
      { pattern: "Template Method", bindings: { AbstractClass: "Port" } },
      "INVALID_ARGUMENT",
      "bindings.AbstractClass: Model/Port is a UMLInterface; AbstractClass keeps concrete operations next to abstract ones in Template Method, which an interface cannot hold; bind a class",
    );
    await fails(
      apply,
      { pattern: "Observer", bindings: { Subject: "Kind" } },
      "INVALID_ARGUMENT",
      "bindings.Subject: Model/Kind is a UMLEnumeration; Subject is a UMLClass in Observer; a UMLEnumeration cannot play it",
    );
  });
});

describe("adaptation rules", () => {
  it("keeps a role's other properties and visibility-less operations as written", () => {
    const pattern = findPattern("Observer");
    const subject = pattern.roles.find((r) => r.name === "Subject")!;
    const leafy = {
      ...subject,
      properties: { isAbstract: true, isLeaf: false },
      operations: [{ name: "run" }],
    };
    expect(adaptRole(pattern, leafy, "UMLInterface")).toMatchObject({
      type: "UMLInterface",
      properties: { isLeaf: false },
      operations: [{ name: "run", isAbstract: true }],
    });
    const bare = adaptRole(pattern, leafy, "UMLInterface") as typeof leafy;
    expect(bare.operations[0]).not.toHaveProperty("visibility");
    const plain = { ...subject, properties: { isAbstract: true } };
    expect(
      (adaptRole(pattern, plain, "UMLInterface") as typeof plain).properties,
    ).toBeUndefined();
    expect(adaptRole(pattern, subject, "UMLClass")).toBe(subject);
  });

  it("turns generalizations and realizations by the ends' metaclasses", () => {
    const C = "UMLClass";
    const I = "UMLInterface";
    expect(relationType("generalization", C, I)).toBe("realization");
    expect(relationType("generalization", C, C)).toBe("generalization");
    expect(relationType("generalization", I, I)).toBe("generalization");
    expect(relationType("realization", C, I)).toBe("realization");
    expect(relationType("realization", C, C)).toBe("generalization");
    expect(relationType("realization", I, I)).toBe("generalization");
    expect(relationType("dependency", C, I)).toBe("dependency");
  });
});

describe("/detect_patterns filtering", () => {
  it("answers from 0.8 by default and drops what a better detection covers", async () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBe(0.8);
    // A strategy without its operations: found only when asked lower.
    const ctx = await make("Ctx");
    const algo = await make("Algo", "UMLInterface");
    const impl = await make("Impl");
    await ok(ep("/create_relationship"), {
      type: "UMLAssociation",
      tail: ctx._id,
      head: algo._id,
    });
    await ok(ep("/create_relationship"), {
      type: "UMLInterfaceRealization",
      tail: impl._id,
      head: algo._id,
    });
    const strict = await ok<Found>(detect, { patterns: ["Strategy"] });
    expect(strict.detections).toEqual([]);
    const loose = await ok<Found>(detect, {
      patterns: ["Strategy"],
      minConfidence: 0.3,
    });
    expect(loose.detections.length).toBeGreaterThan(0);
    expect(
      loose.detections.every((d) => d.confidence < DEFAULT_MIN_CONFIDENCE),
    ).toBe(true);
  });

  it("keeps the first of detections binding the same elements, per pattern", () => {
    const d = (pattern: string, ids: string[], confidence = 1): Detection => ({
      pattern,
      confidence,
      roles: { R: ids.map((_id) => ({ _id, path: null })) },
      missing: [],
      binding: new Map(),
    });
    const kept = withoutDuplicates([
      d("A", ["1", "2", "3"]),
      d("A", ["2", "3"], 0.9),
      d("B", ["2", "3"], 0.9),
      d("A", ["3", "4"], 0.8),
    ]);
    expect(kept.map((k) => [k.pattern, k.confidence])).toEqual([
      ["A", 1],
      ["B", 0.9],
      ["A", 0.8],
    ]);
  });
});
