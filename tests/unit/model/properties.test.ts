import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/errors.js";
import { parseModelSpec, RELATIONS } from "../../../src/model/spec.js";
import { endpoints } from "../../../src/routes.js";
import { installMockApp } from "../../mock/staruml.js";

const buildModel = endpoints.find((e) => e.path === "/build_model")!;

// Fuzz: any JSON value either reads as a spec or is refused with the one
// stable code the spec reader has; nothing else escapes.
describe("parseModelSpec fuzz", () => {
  it("never throws anything but INVALID_ARGUMENT", () => {
    const field = fc.constantFrom(
      "system",
      "contexts",
      "packages",
      "classes",
      "relationships",
      "actors",
      "useCases",
      "collaborations",
      "lifecycles",
      "classViews",
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.jsonValue({ maxDepth: 3 }),
          fc.dictionary(field, fc.jsonValue({ maxDepth: 3 })),
          fc.dictionary(
            field,
            fc.array(
              fc.dictionary(
                fc.constantFrom(
                  "name",
                  "from",
                  "to",
                  "type",
                  "states",
                  "messages",
                  "context",
                ),
                fc.jsonValue({ maxDepth: 2 }),
              ),
            ),
          ),
        ),
        (input) => {
          try {
            parseModelSpec(input);
          } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).code).toBe("INVALID_ARGUMENT");
          }
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000);
});

const ident = fc.stringMatching(/^[A-Z][a-z]{1,6}$/);

/** A well-formed spec: unique names, acyclic nesting, ends that exist. */
const specArb = fc
  .record({
    packages: fc.uniqueArray(ident, { maxLength: 4 }),
    classes: fc.uniqueArray(ident, { minLength: 1, maxLength: 6 }),
    nesting: fc.array(fc.nat(), { maxLength: 4 }),
    owners: fc.array(fc.nat(), { maxLength: 6 }),
    relations: fc.array(
      fc.record({
        from: fc.nat(),
        to: fc.nat(),
        type: fc.constantFrom(
          ...(Object.keys(RELATIONS) as (keyof typeof RELATIONS)[]),
        ),
      }),
      { maxLength: 6 },
    ),
    members: fc.array(
      fc.constantFrom("+id: long", "-name: String", "count: int[0..*]"),
      { maxLength: 3 },
    ),
  })
  .map(({ packages, classes, nesting, owners, relations, members }) => {
    // Package names and class names may not clash with "P" prefixes.
    const pkgs = packages.map((p, i) => ({
      name: `P${p}`,
      ...(i > 0 &&
        nesting[i] !== undefined &&
        nesting[i]! % 2 === 0 && { parent: `P${packages[nesting[i]! % i]}` }),
    }));
    return {
      system: "Prop",
      packages: pkgs,
      classes: classes.map((c, i) => ({
        name: c,
        ...(pkgs.length > 0 &&
          owners[i] !== undefined && {
            package: pkgs[owners[i]! % pkgs.length]!.name,
          }),
        attributes: [...new Set(members)],
      })),
      relationships: relations.map((r) => ({
        from: classes[r.from % classes.length]!,
        to: classes[r.to % classes.length]!,
        type: r.type,
      })),
    };
  });

describe("build_model properties", () => {
  it("plans every element of a well-formed spec, applies that plan, and upserts it to nothing", async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        installMockApp();
        const dry = await buildModel.handler({
          spec,
          dryRun: true,
          detail: "full",
        });
        expect(dry.success, JSON.stringify(dry)).toBe(true);
        const counts = (
          dry as { data: { counts: { created: Record<string, number> } } }
        ).data.counts.created;
        expect(counts.UMLModel).toBe(1);
        expect(counts.UMLPackage ?? 0).toBe(spec.packages.length);
        expect(counts.UMLClass ?? 0).toBe(spec.classes.length);
        const applied = await buildModel.handler({ spec });
        expect(applied.success, JSON.stringify(applied)).toBe(true);
        const again = await buildModel.handler({
          spec,
          upsert: true,
          dryRun: true,
        });
        const plan = (again as { data: { plan: { ops: unknown[] } } }).data
          .plan;
        expect(plan.ops).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});
