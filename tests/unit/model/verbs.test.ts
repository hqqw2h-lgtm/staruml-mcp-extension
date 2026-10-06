import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint } from "../../../src/endpoint.js";
import { ApiError, ERROR_CODES } from "../../../src/errors.js";
import {
  GEOMETRY_HINT,
  geometryHint,
  parseModelSpec,
  RELATIONS,
  relationTypeError,
  UML_WORDS,
} from "../../../src/model/spec.js";
import { endpoints } from "../../../src/routes.js";
import { installMockApp } from "../../mock/staruml.js";
import { fails } from "../support.js";

// Issue #40: an object spec says what one object does to another; the UML
// a relationship means is the build's to decide, and geometry is never
// part of it.

const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const VERBS = Object.keys(RELATIONS);

const withType = (type: unknown) => ({
  classes: [{ name: "A" }, { name: "B" }],
  relationships: [{ from: "A", to: "B", type }],
});

beforeEach(() => {
  installMockApp();
});

describe("relationship verbs", () => {
  it("refuses every UML word, naming the verb that says it (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(UML_WORDS)), (word) => {
        let error: unknown;
        try {
          parseModelSpec(withType(word));
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("INVALID_ARGUMENT");
        const verb = UML_WORDS[word]!;
        expect((error as ApiError).message).toContain(
          `${word} is a UML word; an object spec writes the verb ${verb}`,
        );
        expect(VERBS).toContain(verb);
      }),
    );
  });

  it("accepts exactly the verbs, and refuses any other text with the stable code (property)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...VERBS),
          fc.string(),
          fc.jsonValue({ maxDepth: 2 }),
        ),
        (type) => {
          let error: unknown;
          try {
            parseModelSpec(withType(type));
          } catch (err) {
            error = err;
          }
          if (typeof type === "string" && VERBS.includes(type)) {
            expect(error).toBeUndefined();
          } else {
            expect(error).toBeInstanceOf(ApiError);
            expect((error as ApiError).code).toBe("INVALID_ARGUMENT");
          }
        },
      ),
    );
  });

  it("answers /build_model with the verb to use and never another code (fuzz)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constantFrom(...Object.keys(UML_WORDS)),
          fc.string(),
          fc.jsonValue({ maxDepth: 2 }),
        ),
        async (type) => {
          const res = await ep("/build_model").handler({
            spec: withType(type),
            dryRun: true,
          });
          if (res.success) {
            expect(VERBS).toContain(type);
            return;
          }
          expect(ERROR_CODES).toContain(res.code);
          expect(res.code).toBe("INVALID_ARGUMENT");
          if (typeof type === "string" && Object.hasOwn(UML_WORDS, type)) {
            expect(res.error).toContain(`writes the verb ${UML_WORDS[type]}`);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("says nothing extra of a value that is not a UML word", () => {
    expect(relationTypeError("calls")).toBeUndefined();
    expect(relationTypeError(7)).toBeUndefined();
    expect(relationTypeError("toString")).toBeUndefined();
  });
});

describe("unknown fields", () => {
  it("say that geometry and colours are never part of a spec (property)", async () => {
    const geometry = fc.constantFrom(
      "x",
      "y",
      "left",
      "top",
      "width",
      "height",
      "fillColor",
      "color",
      "lineColor",
      "layout",
    );
    await fc.assert(
      fc.asyncProperty(geometry, fc.integer(), async (key, value) => {
        expect(() =>
          parseModelSpec({ classes: [{ name: "A", [key]: value }] }),
        ).toThrow(GEOMETRY_HINT);
        const built = await fails(
          ep("/build_model"),
          { spec: { classes: [{ name: "A", [key]: value }] } },
          "INVALID_ARGUMENT",
        );
        expect(built.error).toContain(GEOMETRY_HINT);
      }),
      { numRuns: 20 },
    );
  });

  it("leave other refusals as they were", async () => {
    const res = await fails(
      ep("/build_model"),
      { spec: { classes: [{}] } },
      "INVALID_ARGUMENT",
    );
    expect(res.error).not.toContain("geometry");
    // An endpoint says its hint only after an unknown field, and one
    // without a hint names the field alone.
    const request = z.strictObject({ n: z.int() });
    const define = (hint?: string) =>
      defineEndpoint({
        path: "/x",
        description: "x",
        readOnly: true,
        destructive: false,
        request,
        response: z.null(),
        handle: () => null,
        ...(hint !== undefined && { unknownKeyHint: hint }),
      });
    const hinted = define(geometryHint("x"));
    expect(
      (await fails(hinted, { n: 1, x: 1 }, "INVALID_ARGUMENT")).error,
    ).toBe(`(body): Unrecognized key: "x"; ${geometryHint("x")}`);
    expect(
      (await fails(hinted, { n: "1" }, "INVALID_ARGUMENT")).error,
    ).not.toContain("geometry");
    expect(
      (await fails(define(), { n: 1, x: 1 }, "INVALID_ARGUMENT")).error,
    ).toBe('(body): Unrecognized key: "x"');
  });
});
