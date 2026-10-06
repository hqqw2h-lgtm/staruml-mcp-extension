import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { serialize } from "../../../src/serialize.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import {
  create,
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fullResults, invoke, ok } from "../support.js";

/*
 * Issue #27: properties that hold for any input of a kind, not only the
 * examples the other suites pick: projections and paging of the
 * serializer, batch references, spec to plan to batch, and the fixed
 * points of building, exporting and building again.
 */

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const build = fullResults(ep("/build_diagram"));
const RUNS = { numRuns: 40 };

beforeEach(() => {
  env = installMockApp();
});

/** n classes with an attribute each under the model, by name. */
function classes(n: number): MockElement[] {
  return Array.from({ length: n }, (_, i) => {
    const c = create("UMLClass");
    c.name = `C${i}`;
    c._parent = env.model;
    (env.model.ownedElements as MockElement[]).push(c);
    const a = create("UMLAttribute");
    a.name = `a${i}`;
    a._parent = c;
    (c.attributes as MockElement[]).push(a);
    env.app.repository.index(c);
    env.app.repository.index(a);
    return c;
  });
}

const FIELDS = [
  "name",
  "_parent",
  "attributes",
  "operations",
  "visibility",
  "isAbstract",
  "documentation",
  "nope",
];

describe("serializer projections", () => {
  it("answers exactly _id, _type and the asked fields the element has, at the asked depth", () => {
    const [c] = classes(1);
    fc.assert(
      fc.property(
        fc.subarray(FIELDS),
        fc.integer({ min: 0, max: 3 }),
        (fields, depth) => {
          const out = serialize(c as unknown as Element, { fields, depth });
          const keys = Object.keys(out).sort();
          const expected = [
            "_id",
            "_type",
            ...fields.filter((f) => f === "_parent" || f in c),
          ].filter((f) => f !== "nope");
          expect(keys).toEqual([...new Set(expected)].sort());
          const attrs = out.attributes as Record<string, unknown>[] | undefined;
          if (attrs) {
            // Owned elements are expanded with the same projection, else refs.
            expect(attrs[0]).toEqual(
              depth > 0
                ? expect.objectContaining({ _id: expect.any(String) })
                : { $ref: expect.any(String) },
            );
            if (depth > 0) expect("$ref" in attrs[0]!).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("summarises unless fields are given, and lists every saved attribute with summary false", () => {
    const [c] = classes(1);
    fc.assert(
      fc.property(fc.boolean(), (summary) => {
        const out = serialize(c as unknown as Element, { summary });
        if (summary) {
          expect(Object.keys(out).sort()).toEqual(
            ["_id", "_parent", "_type", "name", "path"].sort(),
          );
        } else {
          expect(out).toHaveProperty("attributes");
          expect(out).toHaveProperty("visibility");
        }
      }),
      { numRuns: 4 },
    );
  });
});

describe("find_elements paging", () => {
  it("pages through every match once, in id order, whatever the page size", async () => {
    classes(23);
    const find = ep("/find_elements");
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (limit) => {
        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page: {
            elements: { _id: string }[];
            nextCursor: string | null;
            count: number;
          } = await ok(find, {
            type: "UMLClass",
            limit,
            ...(cursor !== null && { cursor }),
          });
          expect(page.elements.length).toBeLessThanOrEqual(limit);
          expect(page.count).toBe(23);
          seen.push(...page.elements.map((e) => e._id));
          cursor = page.nextCursor;
          pages++;
        } while (cursor !== null);
        expect(seen).toHaveLength(23);
        expect(new Set(seen).size).toBe(23);
        expect([...seen].sort()).toEqual(seen);
        expect(pages).toBe(Math.max(1, Math.ceil(23 / limit)));
      }),
      RUNS,
    );
  });
});

describe("batch references", () => {
  it("resolves each $name to what the named op made, at any nesting", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
        async (parents) => {
          env = installMockApp();
          // Each package is made in the model or in an earlier package.
          const ops = parents.map((p, i) => ({
            path: "/create_element",
            as: `p${i}`,
            body: {
              type: "UMLPackage",
              parent: i === 0 ? env.model._id : `$p${p % i}`,
              name: `P${i}`,
            },
          }));
          const res = await ok<{
            results: { as: string; data: { _id: string; _parent: string } }[];
          }>(fullResults(ep("/batch")), { ops });
          const ids = res.results.map((r) => r.data._id);
          res.results.forEach((r, i) => {
            const expected = i === 0 ? env.model._id : ids[parents[i]! % i]!;
            expect(r.data._parent).toBe(expected);
          });
        },
      ),
      RUNS,
    );
  });

  it("refuses a reference to a name no earlier op has, at that op", async () => {
    // That the refused batch leaves nothing is held live (batch.live.test.ts):
    // the mock factory records no undoable operation.
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{1,6}$/), async (name) => {
        env = installMockApp();
        const res = await invoke(ep("/batch"), {
          ops: [
            {
              path: "/create_element",
              as: "made",
              body: { type: "UMLPackage", parent: env.model._id, name: "X" },
            },
            {
              path: "/create_element",
              body: { type: "UMLPackage", parent: `$${name}x`, name: "Y" },
            },
          ],
        });
        expect(res).toMatchObject({
          success: false,
          code: "INVALID_ARGUMENT",
          details: { index: 1 },
        });
      }),
      RUNS,
    );
  });
});

/** Class specs with distinct names and relations among them. */
const classSpec = fc
  .uniqueArray(fc.stringMatching(/^[A-Z][a-z]{1,6}$/), {
    minLength: 1,
    maxLength: 6,
  })
  .chain((names) =>
    fc.record({
      classes: fc.constant(
        names.map((name, i) => ({
          name,
          ...(i % 3 === 1 && { kind: "interface" as const }),
          attributes: [`+f${i}: int`],
        })),
      ),
      relations: fc.array(
        fc.record({
          from: fc.constantFrom(...names),
          to: fc.constantFrom(...names),
          type: fc.constantFrom(
            "association",
            "directed",
            "dependency",
            "composition",
          ),
        }),
        { maxLength: 4 },
      ),
    }),
  );

describe("spec to plan to batch", () => {
  it("plans one creation per class, attribute and relation, and builds exactly them", async () => {
    await fc.assert(
      fc.asyncProperty(classSpec, async (spec) => {
        env = installMockApp();
        const dry = await ok<{
          created: number;
          plan: { creates: { op: string }[] };
        }>(build, { kind: "class", spec, dryRun: true, name: "D" });
        const count = (op: string) =>
          dry.plan.creates.filter((c) => c.op === op).length;
        expect(count("/create_element_with_view")).toBe(spec.classes.length);
        expect(count("/add_attribute")).toBe(spec.classes.length);
        expect(count("/create_relationship")).toBe(spec.relations.length);
        expect(dry.created).toBe(spec.classes.length + spec.relations.length);
        const made = await ok<{
          created: number;
          ids: object;
          edges: unknown[];
        }>(build, { kind: "class", spec, name: "D" });
        expect(made.created).toBe(dry.created);
        expect(Object.keys(made.ids)).toHaveLength(spec.classes.length);
        expect(made.edges).toHaveLength(spec.relations.length);
      }),
      RUNS,
    );
  });
});

describe("build, export, build fixed points", () => {
  const exportText = ep("/export_text");

  it("Mermaid of a built class diagram builds a diagram whose Mermaid is the same", async () => {
    await fc.assert(
      fc.asyncProperty(classSpec, async (spec) => {
        env = installMockApp();
        const first = await ok<{ diagram: { _id: string } }>(build, {
          kind: "class",
          spec,
          name: "Fixed",
        });
        const text1 = await ok<{ text: string; kind: string }>(exportText, {
          diagram: first.diagram._id,
          format: "mermaid",
        });
        const again = await ok<{ diagram: { _id: string } }>(build, {
          mermaid: text1.text,
          kind: "class",
          reuse: false,
          allowDuplicateNames: true,
        });
        const text2 = await ok<{ text: string }>(exportText, {
          diagram: again.diagram._id,
          format: "mermaid",
        });
        expect(text2.text).toBe(text1.text);
      }),
      { numRuns: 25 },
    );
  });

  it("the spec of a built DFD builds a diagram with the same spec", async () => {
    const dfd = fc
      .uniqueArray(fc.stringMatching(/^[A-Z][a-z]{1,6}$/), {
        minLength: 1,
        maxLength: 5,
      })
      .chain((names) =>
        fc.record({
          nodes: fc.constant(
            names.map((name, i) => ({
              name,
              type: (["process", "external", "store"] as const)[i % 3],
            })),
          ),
          edges: fc.array(
            fc.record({
              from: fc.constantFrom(...names),
              to: fc.constantFrom(...names),
              name: fc.constantFrom("a", "b"),
            }),
            { maxLength: 4 },
          ),
        }),
      );
    await fc.assert(
      fc.asyncProperty(dfd, async (spec) => {
        env = installMockApp();
        const first = await ok<{ diagram: { _id: string } }>(build, {
          kind: "dfd",
          spec,
          name: "Flow",
        });
        const text1 = await ok<{ text: string }>(exportText, {
          diagram: first.diagram._id,
          format: "spec",
        });
        const again = await ok<{ diagram: { _id: string } }>(build, {
          kind: "dfd",
          spec: JSON.parse(text1.text) as Record<string, unknown>,
          name: "Flow",
          reuse: false,
          allowDuplicateNames: true,
        });
        const text2 = await ok<{ text: string }>(exportText, {
          diagram: again.diagram._id,
          format: "spec",
        });
        expect(text2.text).toBe(text1.text);
      }),
      { numRuns: 25 },
    );
  });
});
