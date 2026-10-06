import { format } from "prettier";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";
import { batchRunner } from "../../../src/handlers/batch.js";
import {
  PATTERN_FILES,
  patterns,
  withVariant,
} from "../../../src/patterns/index.js";
import { type Pattern, patternSchema } from "../../../src/patterns/schema.js";
import { endpoints } from "../../../src/routes.js";
import { serialize } from "../../../src/serialize.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { ok } from "../support.js";

let env: MockEnvironment;
const endpoint = (path: string) => endpoints.find((e) => e.path === path)!;
const apply = endpoint("/apply_pattern");
const detect = endpoint("/detect_patterns");

beforeEach(() => {
  env = installMockApp();
});

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

interface Applied {
  roles: Record<string, { _id: string; path: string; created: boolean }[]>;
  changes: { created: { path: string; type: string }[]; updated: unknown[] };
  properties: { path: string; field: string; value: unknown }[];
  diagram?: string;
  sequenceDiagram?: string;
  plan?: { ops: unknown[] };
}

describe("pattern library", () => {
  it("holds the 23 GoF patterns and seven domain patterns, each valid against the schema", async () => {
    expect(PATTERN_FILES).toHaveLength(30);
    for (const data of PATTERN_FILES) {
      expect(z.safeParse(patternSchema(), data).success).toBe(true);
    }
    const counts = Object.fromEntries(
      ["creational", "structural", "behavioral", "domain"].map((c) => [
        c,
        patterns().filter((p) => p.category === c).length,
      ]),
    );
    expect(counts).toEqual({
      creational: 5,
      structural: 7,
      behavioral: 11,
      domain: 7,
    });
    // The JSON Schema the files name in $schema is this schema.
    await expect(
      await format(JSON.stringify(z.toJSONSchema(patternSchema())), {
        parser: "json",
      }),
    ).toMatchFileSnapshot("../../../src/patterns/pattern.schema.json");
  });

  it.each(patterns().map((p) => [p.name, p] as const))(
    "%s names only its own roles",
    (_name, p) => {
      const roles = new Set(p.roles.map((r) => r.name));
      expect(roles.size).toBe(p.roles.length);
      const placeholders =
        JSON.stringify({ ...p, variants: undefined }).match(
          /\{([A-Za-z]+)\}/g,
        ) ?? [];
      for (const ph of placeholders) expect(roles).toContain(ph.slice(1, -1));
      for (const r of p.relationships) {
        expect(roles).toContain(r.from);
        expect(roles).toContain(r.to);
      }
      for (const c of p.checks ?? []) {
        expect(roles).toContain(c.role);
        if (c.relationship !== undefined) {
          expect(p.relationships[c.relationship]!.from).toBe(c.role);
        }
      }
    },
  );
});

/** What a pattern prescribes, checked one property at a time on the model. */
function assertProperties(pattern: Pattern, applied: Applied) {
  const get = (id: string) => env.app.repository.get(id)! as Element;
  const named = (e: unknown) =>
    e && typeof e === "object" ? (e as Element).name : e;
  const first = (role: string) => get(applied.roles[role]![0]!._id);
  const typeOf = (text: string) => {
    const role = /^\{(.+)\}$/.exec(text)?.[1];
    return role
      ? first(role).name
      : text.replace(/\{(.+?)\}/g, (_m, r: string) => String(first(r).name));
  };
  let checked = 0;
  for (const role of pattern.roles) {
    for (const { _id } of applied.roles[role.name] ?? []) {
      const elem = get(_id);
      expect(elem.constructor.name, role.name).toBe(role.type);
      for (const [k, v] of Object.entries(role.properties ?? {})) {
        expect(elem[k], `${role.name}.${k}`).toBe(v);
        checked++;
      }
      if (role.stereotype) {
        expect(named(elem.stereotype), `${role.name} stereotype`).toBe(
          role.stereotype,
        );
        checked++;
      }
      for (const a of role.attributes ?? []) {
        const attr = (elem.attributes as Element[]).find(
          (x) => x.name === a.name,
        )!;
        expect(attr, `${role.name}.${a.name}`).toBeDefined();
        for (const [k, v] of Object.entries(a)) {
          if (k === "name") continue;
          const want =
            k === "type"
              ? typeOf(v as string)
              : k === "defaultValue"
                ? typeOf(v as string)
                : v;
          expect(
            k === "type" ? named(attr.type) : attr[k],
            `${role.name}.${a.name}.${k}`,
          ).toBe(want);
          checked++;
        }
      }
      for (const o of role.operations ?? []) {
        const name = /^\{.+\}$/.test(o.name) ? elem.name : o.name;
        const op = (elem.operations as Element[]).find((x) => x.name === name)!;
        expect(op, `${role.name}#${name}`).toBeDefined();
        const params = op.parameters as Element[];
        for (const [k, v] of Object.entries(o)) {
          if (k === "name") continue;
          if (k === "returnType") {
            const ret = params.find((x) => x.direction === "return")!;
            expect(named(ret.type), `${role.name}#${name} returns`).toBe(
              typeOf(v as string),
            );
          } else if (k === "parameters") {
            for (const p of v as {
              name: string;
              type?: string;
              direction?: string;
            }[]) {
              const param = params.find((x) => x.name === p.name)!;
              expect(param, `${role.name}#${name}(${p.name})`).toBeDefined();
              if (p.type) expect(named(param.type)).toBe(typeOf(p.type));
              if (p.direction) expect(param.direction).toBe(p.direction);
              checked++;
            }
          } else if (k === "stereotype") {
            expect(named(op.stereotype)).toBe(v);
          } else {
            expect(op[k], `${role.name}#${name}.${k}`).toBe(v);
          }
          checked++;
        }
      }
    }
  }
  for (const r of pattern.relationships) {
    for (const from of applied.roles[r.from] ?? []) {
      for (const to of applied.roles[r.to] ?? []) {
        const tail = get(from._id);
        const head = get(to._id);
        const type = {
          association: "UMLAssociation",
          aggregation: "UMLAssociation",
          composition: "UMLAssociation",
          generalization: "UMLGeneralization",
          realization: "UMLInterfaceRealization",
          dependency: "UMLDependency",
        }[r.type];
        const rel = env.app.repository
          .getRelationshipsOf(tail as never)
          .find((m) => {
            if (m.constructor.name !== type) return false;
            const ends =
              "source" in m
                ? [m.source, m.target]
                : [
                    (m.end1 as Element).reference,
                    (m.end2 as Element).reference,
                  ];
            return ends[0] === tail && ends[1] === head;
          })!;
        expect(rel, `${r.type} ${r.from} -> ${r.to}`).toBeDefined();
        if (r.stereotype) expect(named(rel.stereotype)).toBe(r.stereotype);
        const aggregation = { aggregation: "shared", composition: "composite" }[
          r.type as string
        ];
        if (aggregation)
          expect((rel.end1 as Element).aggregation).toBe(aggregation);
        for (const [k, v] of Object.entries(r.fromEnd ?? {})) {
          expect((rel.end1 as Element)[k], `${r.from} end ${k}`).toBe(v);
          checked++;
        }
        for (const [k, v] of Object.entries(r.toEnd ?? {})) {
          expect((rel.end2 as Element)[k], `${r.to} end ${k}`).toBe(v);
          checked++;
        }
      }
    }
  }
  return checked;
}

const GOLDEN = [
  "name",
  "ownedElements",
  "ownedViews",
  "model",
  "source",
  "target",
  "end1",
  "end2",
  "reference",
  "aggregation",
  "navigable",
  "multiplicity",
  "attributes",
  "operations",
  "parameters",
  "type",
  "direction",
  "visibility",
  "isStatic",
  "isAbstract",
  "isLeaf",
  "isQuery",
  "isReadOnly",
  "isID",
  "defaultValue",
  "stereotype",
  "documentation",
  "messageSort",
];

function golden(project: Element): string {
  const json = JSON.stringify(
    serialize(project, { fields: GOLDEN, depth: 8 }),
    null,
    1,
  );
  const ids = new Map<string, string>();
  return json.replace(/"(_id|_parent|\$ref)": "([^"]+)"/g, (_m, k, v) => {
    if (!ids.has(v)) ids.set(v, `#${ids.size}`);
    return `"${k}": "${ids.get(v)}"`;
  });
}

describe("/apply_pattern on every pattern", () => {
  it.each(patterns().map((p) => [p.name, p] as const))(
    "%s: plans what it applies, sets every property, and is detected back",
    async (name, pattern) => {
      const body = {
        pattern: name,
        diagram: name,
        sequence: pattern.sequence !== undefined,
      };
      const dry = await ok<Applied>(apply, {
        ...body,
        dryRun: true,
        detail: "full",
      });
      const spy = vi.spyOn(batchRunner, "run");
      const applied = await ok<Applied>(apply, body);
      expect(spy.mock.calls[0]![1]).toEqual(dry.plan!.ops);
      spy.mockRestore();
      expect(applied.changes).toEqual(dry.changes);
      expect(
        applied.properties.map(({ path, field }) => [path, field]),
      ).toEqual(dry.properties.map(({ path, field }) => [path, field]));
      expect(assertProperties(pattern, applied)).toBeGreaterThan(0);
      await expect(golden(env.project)).toMatchFileSnapshot(
        `../../fixtures/patterns/${slug(name)}.mdj.json`,
      );
      const found = await ok<{
        detections: {
          pattern: string;
          confidence: number;
          roles: Record<string, { _id: string }[]>;
        }[];
      }>(detect, { patterns: [name], minConfidence: 0.99 });
      const ids = (roles: Record<string, { _id: string }[]>) =>
        Object.fromEntries(
          Object.entries(roles)
            .filter(([, list]) => list.length > 0)
            .map(([role, list]) => [role, list.map((x) => x._id).sort()]),
        );
      expect(
        found.detections.map((d) => [d.pattern, d.confidence, ids(d.roles)]),
      ).toContainEqual([name, 1, ids(applied.roles)]);
    },
  );
});

describe("/apply_pattern variants", () => {
  it.each(
    patterns().flatMap((p) =>
      Object.keys(p.variants ?? {}).map((v) => [p.name, v] as const),
    ),
  )("%s %s", async (name, variant) => {
    const applied = await ok<Applied>(apply, { pattern: name, variant });
    const pattern = withVariant(
      patterns().find((p) => p.name === name)!,
      variant,
    );
    assertProperties(pattern, applied);
    const found = await ok<{
      detections: { variant?: string; confidence: number }[];
    }>(detect, {
      patterns: [name],
      minConfidence: 0.99,
    });
    expect(
      found.detections.some((d) => d.variant === variant && d.confidence === 1),
    ).toBe(true);
  });
});
