import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/errors.js";
import {
  applyFix,
  compilePattern,
  CONVENTIONS,
  type Convention,
  FIX_FOR,
  FIXES,
  normalize,
  settle,
  words,
} from "../../../src/style/naming.js";

const conventions = Object.keys(CONVENTIONS) as Convention[];

describe("words", () => {
  it("splits at separators and case changes, and drops accents", () => {
    expect(words("order_line-item total")).toEqual([
      "order",
      "line",
      "item",
      "total",
    ]);
    expect(words("XMLHttpRequest")).toEqual(["XML", "Http", "Request"]);
    expect(words("größeÄnderung")).toEqual(["grosse", "Anderung"]);
    expect(words("  ")).toEqual([]);
  });
});

describe("applyFix", () => {
  it("rewrites by each fixer", () => {
    expect(applyFix("order line", "pascal")).toBe("OrderLine");
    expect(applyFix("Order Line", "camel")).toBe("orderLine");
    expect(applyFix("maxSize", "upperSnake")).toBe("MAX_SIZE");
    expect(applyFix("MaxSize", "snake")).toBe("max_size");
    expect(applyFix("Billing Core", "lower")).toBe("billingcore");
    expect(applyFix("PLACE ORDER", "sentence")).toBe("Place order");
    expect(applyFix("anything goes", "none")).toBe("anything goes");
  });

  it("puts a letter before a leading digit and fills in what has no words", () => {
    expect(applyFix("3d model", "pascal")).toBe("N3dModel");
    expect(applyFix("3d model", "camel")).toBe("n3dModel");
    expect(applyFix("3d", "upperSnake")).toBe("N3D");
    expect(applyFix("3d", "snake")).toBe("n3d");
    expect(applyFix("3d", "lower")).toBe("n3d");
    expect(applyFix("3d model", "sentence")).toBe("N 3d model");
    expect(applyFix("Login", "sentence")).toBe("Login element");
    for (const fix of FIXES.filter((f) => f !== "none")) {
      expect(applyFix("--", fix).length).toBeGreaterThan(0);
    }
  });
});

describe("compilePattern", () => {
  it("answers a built-in by name, else compiles the expression", () => {
    expect(compilePattern("PascalCase", "f")).toBe(CONVENTIONS.PascalCase);
    expect(compilePattern("^I[A-Z]", "f").test("IFoo")).toBe(true);
  });

  it("refuses an invalid expression naming the field", () => {
    expect(() => compilePattern("(", "naming.classifier")).toThrow(ApiError);
    expect(() => compilePattern("(", "naming.classifier")).toThrow(
      /naming.classifier: \( is neither/,
    );
  });
});

describe("normalize", () => {
  it("leaves a matching name, fixes another, reports an unfixable one", () => {
    const rule = { pattern: "PascalCase", fix: "pascal" as const };
    expect(normalize("Order", rule)).toEqual({
      name: "Order",
      violated: false,
      fixed: false,
    });
    expect(normalize("order_line", rule)).toEqual({
      name: "OrderLine",
      violated: true,
      fixed: true,
    });
    expect(normalize("order", { pattern: "PascalCase", fix: "none" })).toEqual({
      name: "order",
      violated: true,
      fixed: false,
    });
    // A fix that still breaks a custom pattern is not applied.
    expect(normalize("order", { pattern: "^I[A-Z]", fix: "pascal" })).toEqual({
      name: "order",
      violated: true,
      fixed: false,
    });
  });

  const anyName = fc.oneof(
    fc.string(),
    fc.string({ unit: "grapheme" }),
    fc.constantFrom("", " ", "__", "3d", "Größe", "a\nb", "XMLHttp"),
  );

  it("is idempotent and never answers an empty name (property)", () => {
    fc.assert(
      fc.property(anyName, fc.constantFrom(...conventions), (name, c) => {
        const rule = { pattern: c, fix: FIX_FOR[c] };
        const once = normalize(name, rule);
        const twice = normalize(once.name, rule);
        expect(twice.name).toBe(once.name);
        expect(twice.fixed).toBe(false);
        if (once.fixed) {
          expect(once.name.length).toBeGreaterThan(0);
          expect(CONVENTIONS[c].test(once.name)).toBe(true);
        } else if (once.violated) {
          expect(once.name).toBe(name);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("makes every built-in fixer match its convention (property)", () => {
    fc.assert(
      fc.property(anyName, fc.constantFrom(...conventions), (name, c) => {
        const fixed = applyFix(name, FIX_FOR[c]);
        expect(fixed.length).toBeGreaterThan(0);
        expect(CONVENTIONS[c].test(fixed)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("settle", () => {
  it("keeps names not renamed and numbers renamed ones that collide", () => {
    expect(
      settle([
        { from: "order_item", to: "OrderItem" },
        { from: "OrderItem", to: "OrderItem" },
        { from: "order item", to: "OrderItem" },
      ]),
    ).toEqual(["OrderItem2", "OrderItem", "OrderItem3"]);
  });

  it("never answers a duplicate among renamed names (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            from: fc.constantFrom("a", "b", "A", "B", "a_b", "AB"),
            to: fc.constantFrom("A", "B", "AB"),
          }),
          { maxLength: 12 },
        ),
        (list) => {
          const out = settle(list);
          const renamed = out.filter((_, i) => list[i]!.from !== list[i]!.to);
          const kept = out.filter((_, i) => list[i]!.from === list[i]!.to);
          expect(new Set(renamed).size).toBe(renamed.length);
          for (const r of renamed) expect(kept).not.toContain(r);
          out.forEach((n, i) => {
            if (list[i]!.from === list[i]!.to) expect(n).toBe(list[i]!.to);
            else expect(n.startsWith(list[i]!.to)).toBe(true);
          });
        },
      ),
    );
  });
});
