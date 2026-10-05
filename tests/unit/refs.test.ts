import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  escapeName,
  MAX_CANDIDATES,
  parsePath,
  pathOf,
  resolveRef,
  tryResolve,
} from "../../src/refs.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
  type View,
} from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function model(
  id: string,
  parent: Element,
  name: string,
  field?: string,
): Element {
  return env.app.factory.createModel({
    id,
    parent,
    ...(field && { field }),
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

function shown(elem: Element, diagram: Element): View {
  return env.app.factory.createViewOf({
    model: elem,
    diagram,
    x: 0,
    y: 0,
  }) as View;
}

function param(op: Element, name: string, type: unknown, direction = "in") {
  const p = model("UMLParameter", op, name, "parameters");
  p.type = type;
  p.direction = direction;
  return p;
}

/** Model/Shop/{Order {total, pay(int), pay(Item, String), pay(): bool}, Item}, Main shows Order. */
function shop() {
  const pkg = model("UMLPackage", env.model, "Shop");
  const order = model("UMLClass", pkg, "Order");
  const item = model("UMLClass", pkg, "Item");
  const total = model("UMLAttribute", order, "total", "attributes");
  const payInt = model("UMLOperation", order, "pay", "operations");
  param(payInt, "n", "int");
  const payItem = model("UMLOperation", order, "pay", "operations");
  param(payItem, "item", item);
  param(payItem, "note", "String");
  param(payItem, "", "bool", "return");
  const view = shown(order, env.mainDiagram);
  return { pkg, order, item, total, payInt, payItem, view };
}

function code(call: () => unknown): string {
  try {
    call();
  } catch (err) {
    return (err as ApiError).code;
  }
  return "OK";
}

describe("parsePath", () => {
  it("splits steps by separator and reads parameter lists and escapes", () => {
    expect(parsePath("Model/Shop/Order.total")).toEqual({
      absolute: false,
      steps: [
        { sep: "/", name: "Model" },
        { sep: "/", name: "Shop" },
        { sep: "/", name: "Order" },
        { sep: ".", name: "total" },
      ],
    });
    expect(parsePath("/A#pay(Item, String)x").steps).toEqual([
      { sep: "/", name: "A" },
      { sep: "#", name: "payx", params: ["Item", "String"] },
    ]);
    expect(parsePath("A#f()").steps[1]).toEqual({
      sep: "#",
      name: "f",
      params: [],
    });
    expect(parsePath("A#f(a\\,b, )").steps[1]!.params).toEqual(["a,b", ""]);
    expect(parsePath("A#f(int").steps[1]!.params).toEqual(["int"]);
    expect(parsePath("a\\/b\\.c(d)").steps).toEqual([
      { sep: "/", name: "a/b.c(d)" },
    ]);
    expect(parsePath("java.util", false).steps).toEqual([
      { sep: "/", name: "java.util" },
    ]);
    expect(parsePath("trailing\\").steps).toEqual([
      { sep: "/", name: "trailing\\" },
    ]);
    expect(parsePath("A#f(x)(y)").steps[1]).toEqual({
      sep: "#",
      name: "f(y)",
      params: ["x"],
    });
  });

  it("never throws and always yields at least one step", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (text, dots) => {
        const parsed = parsePath(text, dots);
        expect(parsed.steps.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("pathOf", () => {
  it("writes owners with / and members with . and #", () => {
    const s = shop();
    void s;
    expect(pathOf(s.order)).toBe("Model/Shop/Order");
    expect(pathOf(s.total)).toBe("Model/Shop/Order.total");
    expect(pathOf(s.payInt)).toBe("Model/Shop/Order#pay(int)");
    expect(pathOf(s.payItem)).toBe("Model/Shop/Order#pay(Item, String)");
    expect(pathOf(s.view)).toBe("Model/Shop/Order@Model/Main");
    expect(pathOf(env.mainDiagram)).toBe("Model/Main");
    expect(pathOf(env.project)).toBeNull();
    const note = env.app.factory.createModelAndView({
      id: "Note",
      parent: env.model,
      diagram: env.mainDiagram,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
    })!;
    expect(pathOf(note)).toBeNull();
    const enumeration = model("UMLEnumeration", env.model, "Kind");
    const literal = model(
      "UMLEnumerationLiteral",
      enumeration,
      "A.B",
      "literals",
    );
    expect(pathOf(literal)).toBe("Model/Kind.A\\.B");
    const unnamed = model("UMLClass", env.model, "");
    delete (unnamed as { name?: string }).name;
    expect(pathOf(unnamed)).toBe("Model/");
    expect(resolveRef("Model/")).toBe(unnamed);
    // A reception has no parameters; types without a name write as "".
    const reception = model("UMLReception", s.order, "ping", "receptions");
    expect(pathOf(reception)).toBe("Model/Shop/Order#ping()");
    expect(resolveRef("Order#ping()")).toBe(reception);
    const typed = model("UMLOperation", s.item, "f", "operations");
    param(typed, "a", null);
    const anonymous = model("UMLClass", env.model, "");
    delete (anonymous as { name?: string }).name;
    param(typed, "b", anonymous);
    expect(pathOf(typed)).toBe("Model/Shop/Item#f(, )");
  });

  it("has no path for a view whose model or diagram has none", () => {
    const s = shop();
    const loose = env.app.factory.createModelAndView({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
    })!;
    loose.model = env.project;
    expect(pathOf(loose)).toBeNull();
    s.view._parent = null;
    expect(pathOf(s.view)).toBeNull();
    s.view._parent = env.project;
    expect(pathOf(s.view)).toBeNull();
  });
});

describe("resolveRef", () => {
  it("resolves ids, full paths, suffixes and members", () => {
    const s = shop();
    expect(resolveRef(s.order._id)).toBe(s.order);
    expect(resolveRef("Model/Shop/Order")).toBe(s.order);
    expect(resolveRef("/Model/Shop/Order")).toBe(s.order);
    expect(resolveRef("Shop/Order")).toBe(s.order);
    expect(resolveRef("Order")).toBe(s.order);
    expect(resolveRef("Order.total")).toBe(s.total);
    expect(resolveRef("Order/total")).toBe(s.total);
    expect(resolveRef("Order#pay(int)")).toBe(s.payInt);
    expect(resolveRef("Order#pay(Item, String)")).toBe(s.payItem);
    expect(resolveRef("Main", { kind: "diagram" })).toBe(env.mainDiagram);
    for (const elem of Object.values(s)) {
      expect(resolveRef(pathOf(elem)!)).toBe(elem);
    }
  });

  it("refuses what a step's kind rules out", () => {
    const s = shop();
    expect(code(() => resolveRef("/Shop/Order"))).toBe("NOT_FOUND");
    expect(code(() => resolveRef("Order#total"))).toBe("NOT_FOUND");
    expect(code(() => resolveRef("Shop.Order"))).toBe("NOT_FOUND");
    expect(code(() => resolveRef("Order", { kind: "diagram" }))).toBe(
      "NOT_FOUND",
    );
    expect(code(() => resolveRef("Nothing/Order"))).toBe("NOT_FOUND");
    // The return parameter is unnamed, and "" is its name.
    expect(resolveRef("Order#pay(Item, String)/")).toBe(
      (s.payItem.parameters as Element[])[2],
    );
    // Repository.get on a plain object would answer Object.prototype's.
    expect(code(() => resolveRef("toString"))).toBe("NOT_FOUND");
  });

  it("lists the candidates of an ambiguous reference", () => {
    const s = shop();
    let err: ApiError | undefined;
    try {
      resolveRef("Order#pay", { role: "Operation" });
    } catch (e) {
      err = e as ApiError;
    }
    expect(err!.code).toBe("AMBIGUOUS_REF");
    expect(err!.message).toBe(
      "Operation Order#pay names 2 elements; pass one of their ids or a longer path",
    );
    expect(err!.details).toEqual({
      candidates: [
        {
          _id: s.payInt._id,
          _type: "UMLOperation",
          path: "Model/Shop/Order#pay(int)",
        },
        {
          _id: s.payItem._id,
          _type: "UMLOperation",
          path: "Model/Shop/Order#pay(Item, String)",
        },
      ],
    });
    // Parameter types that fit no overload fall back to the name.
    expect(code(() => resolveRef("Order#pay(long)"))).toBe("AMBIGUOUS_REF");
    expect(code(() => resolveRef("Order#pay()"))).toBe("AMBIGUOUS_REF");
    for (let i = 0; i < MAX_CANDIDATES + 5; i++) {
      model("UMLClass", s.pkg, "Many", undefined);
      model("UMLPackage", env.model, `P${i}`);
    }
    try {
      resolveRef("Many");
    } catch (e) {
      err = e as ApiError;
    }
    expect((err!.details as { candidates: unknown[] }).candidates).toHaveLength(
      MAX_CANDIDATES,
    );
  });

  it("prefers the full path to a suffix match", () => {
    const top = model("UMLPackage", env.model, "Shop");
    const nested = model(
      "UMLPackage",
      model("UMLPackage", env.model, "Old"),
      "Model",
    );
    const deep = model("UMLPackage", nested, "Shop");
    expect(resolveRef("Model/Shop")).toBe(top);
    expect(resolveRef("Old/Model/Shop")).toBe(deep);
  });

  it("reads a dotted name as a name when no member fits", () => {
    const pkg = model("UMLPackage", env.model, "java.util");
    expect(resolveRef("java.util")).toBe(pkg);
    expect(resolveRef("Model/java.util")).toBe(pkg);
  });

  it("resolves @current, @project and views by model@diagram", () => {
    const s = shop();
    expect(code(() => resolveRef("@current"))).toBe("NOT_FOUND");
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    expect(resolveRef("@current", { kind: "diagram" })).toBe(env.mainDiagram);
    expect(resolveRef("@project")).toBe(env.project);
    expect(resolveRef("Order@Main")).toBe(s.view);
    expect(resolveRef("Order@@current")).toBe(s.view);
    expect(resolveRef("Model/Shop/Order@Model/Main", { kind: "view" })).toBe(
      s.view,
    );
    const odd = model("UMLClass", env.model, "a@b");
    expect(resolveRef("a@b")).toBe(odd);
    expect(resolveRef("a\\@b")).toBe(odd);
    expect(pathOf(odd)).toBe("Model/a\\@b");
    (env.app.project as unknown as { project: null }).project = null;
    expect(code(() => resolveRef("@project"))).toBe("NOT_FOUND");
  });

  it("takes a model's view where a view is expected", () => {
    const s = shop();
    expect(resolveRef("Order", { kind: "view" })).toBe(s.view);
    // A compartment showing the same model is part of the view, not another.
    const compartment = env.app.factory.createViewOf({
      model: s.item,
      diagram: env.mainDiagram,
    })!;
    compartment.model = s.order;
    compartment._parent = s.view;
    expect(resolveRef("Order", { kind: "view" })).toBe(s.view);
    expect(resolveRef("Order@Main")).toBe(s.view);
    expect(resolveRef(s.view._id, { kind: "view" })).toBe(s.view);
    const other = env.app.factory.createDiagram({
      id: "UMLClassDiagram",
      parent: env.model,
    })!;
    const second = shown(s.order, other);
    expect(code(() => resolveRef("Order", { kind: "view" }))).toBe(
      "AMBIGUOUS_REF",
    );
    expect(resolveRef("Order", { kind: "view", diagram: other })).toBe(second);
    expect(code(() => resolveRef("Item", { kind: "view" }))).toBe("NOT_FOUND");
  });

  it("tryResolve answers null for nothing and still refuses ambiguity", () => {
    shop();
    expect(tryResolve("Nope")).toBeNull();
    expect(code(() => tryResolve("Order#pay"))).toBe("AMBIGUOUS_REF");
    expect(() =>
      tryResolve("x", {
        get kind(): "element" {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });
});

/** Names that need every escape, and plain ones. */
const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.constantFrom("a/b", "a.b", "x#y", "@at", "p(q)", "c,d", "back\\slash"),
);

describe("resolver properties", () => {
  it("round-trips path and id for elements whose names are unique among siblings", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(nameArb, { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(nameArb, { minLength: 1, maxLength: 4 }),
        (packages, members) => {
          env = installMockApp();
          const made: Element[] = [];
          let owner = env.model;
          for (const name of packages) {
            owner = model("UMLPackage", owner, `p${name}`);
            made.push(owner);
          }
          const cls = model("UMLClass", owner, "C");
          made.push(cls);
          for (const name of members) {
            made.push(model("UMLAttribute", cls, name, "attributes"));
            made.push(model("UMLOperation", cls, name, "operations"));
          }
          for (const elem of made) {
            const path = pathOf(elem)!;
            expect(resolveRef(path)).toBe(elem);
            expect(resolveRef(elem._id)).toBe(elem);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("never finds a name that is unique in the project ambiguous", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(nameArb, { minLength: 1, maxLength: 10 }),
        (names) => {
          env = installMockApp();
          const made = names.map((n, i) =>
            model(
              i % 2 ? "UMLClass" : "UMLPackage",
              env.model,
              `n${escapeName(n)}${n}`,
            ),
          );
          for (const elem of made) {
            expect(resolveRef(escapeName(elem.name))).toBe(elem);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("answers any string with an element or a stable error code (fuzz)", () => {
    shop();
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.stringMatching(/^[\w/.#@()\\, ]{0,30}$/),
          fc.constantFrom("@current", "@project", "Order@", "@", "#", "."),
        ),
        fc.constantFrom("element", "diagram", "view"),
        (ref, kind) => {
          try {
            const found = resolveRef(ref, {
              kind: kind as "element" | "diagram" | "view",
            });
            expect(found._id).toEqual(expect.any(String));
          } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
            expect(["NOT_FOUND", "AMBIGUOUS_REF"]).toContain(
              (err as ApiError).code,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
