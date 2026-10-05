import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { patterns, withVariant } from "../../src/patterns/index.js";
import type { Pattern } from "../../src/patterns/schema.js";
import {
  call,
  describeLive,
  indexMdj,
  liveDir,
  type MdjElement,
} from "./support.js";

// Issue #30: every pattern of the library applied on StarUML 7.1.1, its
// diagram written as Mermaid and built again, found back by
// /detect_patterns, and each property it prescribes read from the saved
// project.

interface Applied {
  roles: Record<string, { _id: string; path: string; created: boolean }[]>;
  changes: { created: unknown[]; updated: unknown[] };
  properties: { path: string; field: string }[];
  diagram: string;
  plan?: { ops: unknown[] };
}

/** /describe_diagram's node and edge lines, sorted. */
async function shown(diagram: string): Promise<string[]> {
  const res = await call<{ text: string }>("/describe_diagram", {
    diagram,
    maxChars: 200_000,
  });
  return res.data.text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .sort();
}

const applied = new Map<string, Applied>();

/** What a pattern prescribes, read one property at a time from the .mdj. */
function assertProperties(
  pattern: Pattern,
  result: Applied,
  byId: Map<string, MdjElement>,
): number {
  const get = (ref: unknown) =>
    byId.get(typeof ref === "string" ? ref : (ref as { $ref: string }).$ref)!;
  const named = (v: unknown) => (v && typeof v === "object" ? get(v).name : v);
  const first = (role: string) => get(result.roles[role]![0]!._id);
  const typeOf = (text: string) => {
    const role = /^\{(.+)\}$/.exec(text)?.[1];
    return role
      ? first(role).name
      : text.replace(/\{(.+?)\}/g, (_m, r: string) => String(first(r).name));
  };
  const list = (e: MdjElement, field: string) =>
    ((e[field] ?? []) as MdjElement[]).map((x) => (x._id ? x : get(x)));
  // StarUML leaves default values out of the .mdj.
  const value = (e: MdjElement, k: string, fallback: unknown) =>
    e[k] === undefined ? fallback : e[k];
  const DEFAULTS: Record<string, unknown> = {
    isAbstract: false,
    isLeaf: false,
    isStatic: false,
    isQuery: false,
    isReadOnly: false,
    isID: false,
    visibility: "public",
    direction: "in",
    navigable: "unspecified",
    aggregation: "none",
    multiplicity: "",
    defaultValue: "",
    name: "",
  };
  const prop = (e: MdjElement, k: string) => value(e, k, DEFAULTS[k]);
  let checked = 0;
  for (const role of pattern.roles) {
    for (const { _id } of result.roles[role.name] ?? []) {
      const elem = get(_id);
      expect(elem._type, role.name).toBe(role.type);
      for (const [k, v] of Object.entries(role.properties ?? {})) {
        expect(prop(elem, k), `${role.name}.${k}`).toBe(v);
        checked++;
      }
      if (role.stereotype) {
        expect(named(elem.stereotype)).toBe(role.stereotype);
        checked++;
      }
      for (const a of role.attributes ?? []) {
        const attr = list(elem, "attributes").find((x) => x.name === a.name)!;
        expect(attr, `${role.name}.${a.name}`).toBeDefined();
        for (const [k, v] of Object.entries(a)) {
          if (k === "name") continue;
          const want =
            k === "type" || k === "defaultValue" ? typeOf(v as string) : v;
          expect(
            k === "type" ? named(attr.type) : prop(attr, k),
            `${role.name}.${a.name}.${k}`,
          ).toBe(want);
          checked++;
        }
      }
      for (const o of role.operations ?? []) {
        const name = /^\{.+\}$/.test(o.name) ? elem.name : o.name;
        const op = list(elem, "operations").find((x) => x.name === name)!;
        expect(op, `${role.name}#${name}`).toBeDefined();
        const params = list(op, "parameters");
        for (const [k, v] of Object.entries(o)) {
          if (k === "name") continue;
          if (k === "returnType") {
            const ret = params.find((x) => x.direction === "return")!;
            expect(named(ret.type)).toBe(typeOf(v as string));
          } else if (k === "parameters") {
            for (const p of v as {
              name: string;
              type?: string;
              direction?: string;
            }[]) {
              const param = params.find((x) => x.name === p.name)!;
              expect(param, `${role.name}#${name}(${p.name})`).toBeDefined();
              if (p.type) expect(named(param.type)).toBe(typeOf(p.type));
              if (p.direction)
                expect(prop(param, "direction")).toBe(p.direction);
            }
          } else if (k === "stereotype") {
            expect(named(op.stereotype)).toBe(v);
          } else {
            expect(prop(op, k), `${role.name}#${name}.${k}`).toBe(v);
          }
          checked++;
        }
      }
    }
  }
  const TYPES: Record<string, string> = {
    association: "UMLAssociation",
    aggregation: "UMLAssociation",
    composition: "UMLAssociation",
    generalization: "UMLGeneralization",
    realization: "UMLInterfaceRealization",
    dependency: "UMLDependency",
  };
  const all = [...byId.values()];
  for (const r of pattern.relationships) {
    for (const from of result.roles[r.from] ?? []) {
      for (const to of result.roles[r.to] ?? []) {
        const rel = all.find((m) => {
          if (m._type !== TYPES[r.type]) return false;
          const ends =
            "source" in m
              ? [m.source, m.target]
              : [
                  (m.end1 as MdjElement).reference,
                  (m.end2 as MdjElement).reference,
                ];
          return (
            (ends[0] as { $ref: string }).$ref === from._id &&
            (ends[1] as { $ref: string }).$ref === to._id
          );
        })!;
        expect(rel, `${r.type} ${r.from} -> ${r.to}`).toBeDefined();
        const aggregation = { aggregation: "shared", composition: "composite" }[
          r.type as string
        ];
        if (aggregation) {
          expect(prop(rel.end1 as MdjElement, "aggregation")).toBe(aggregation);
        }
        for (const [k, v] of Object.entries(r.fromEnd ?? {})) {
          expect(prop(rel.end1 as MdjElement, k), `${r.from} end ${k}`).toBe(v);
          checked++;
        }
        for (const [k, v] of Object.entries(r.toEnd ?? {})) {
          expect(prop(rel.end2 as MdjElement, k), `${r.to} end ${k}`).toBe(v);
          checked++;
        }
      }
    }
  }
  return checked;
}

describeLive("design patterns", () => {
  beforeAll(async () => {
    await call("/new_project");
    // A new 7.1.1 project holds no model; patterns go in this one.
    await call("/create_element", {
      type: "UMLModel",
      parent: "@project",
      name: "Model",
    });
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it.each(patterns().map((p) => [p.name] as const))(
    "%s: applies as planned, round-trips through Mermaid and is detected back",
    async (name) => {
      const pkg = await call<{ _id: string }>("/create_element", {
        type: "UMLPackage",
        parent: "Model",
        name: `${name} package`,
      });
      expect(pkg.success, JSON.stringify(pkg)).toBe(true);
      const body = { pattern: name, parent: pkg.data._id, diagram: name };
      const dry = await call<Applied>("/apply_pattern", {
        ...body,
        dryRun: true,
      });
      expect(dry.success, JSON.stringify(dry).slice(0, 600)).toBe(true);
      const res = await call<Applied>("/apply_pattern", body);
      expect(res.success, JSON.stringify(res).slice(0, 600)).toBe(true);
      expect(res.data.changes).toEqual(dry.data.changes);
      expect(res.data.properties.map((p) => `${p.path} ${p.field}`)).toEqual(
        dry.data.properties.map((p) => `${p.path} ${p.field}`),
      );
      applied.set(name, res.data);

      const found = await call<{
        detections: { pattern: string; confidence: number }[];
      }>("/detect_patterns", {
        scope: pkg.data._id,
        patterns: [name],
        minConfidence: 0.99,
      });
      expect(found.data.detections[0]).toMatchObject({
        pattern: name,
        confidence: 1,
      });

      const mermaid = await call<{ text: string; kind: string }>(
        "/export_text",
        {
          diagram: res.data.diagram,
          format: "mermaid",
        },
      );
      expect(mermaid.success).toBe(true);
      const again = await call<{ diagram: { _id: string } }>("/build_diagram", {
        mermaid: mermaid.data.text,
        kind: "class",
        name: `${name} again`,
        parent: pkg.data._id,
      });
      expect(again.success, mermaid.data.text).toBe(true);
      expect(await shown(again.data.diagram._id)).toEqual(
        await shown(res.data.diagram),
      );
    },
    60_000,
  );

  it("sets every property each pattern prescribes, as the saved project shows", async () => {
    const file = join(liveDir(), "patterns.mdj");
    const saved = await call("/save_project_as", { filename: file });
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    const byId = indexMdj(
      JSON.parse(readFileSync(file, "utf-8")) as MdjElement,
    );
    let checked = 0;
    for (const pattern of patterns()) {
      checked += assertProperties(pattern, applied.get(pattern.name)!, byId);
    }
    expect(checked).toBeGreaterThan(250);
  });

  it("applies variants and a pattern's sequence diagram", async () => {
    const res = await call<Applied & { sequenceDiagram: string }>(
      "/apply_pattern",
      {
        pattern: "Observer",
        variant: "interface-subject",
        sequence: true,
        bindings: { Subject: "Feed", ConcreteSubject: "Prices" },
      },
    );
    expect(res.success, JSON.stringify(res).slice(0, 600)).toBe(true);
    const seq = await call<{ text: string }>("/export_text", {
      diagram: res.data.sequenceDiagram,
      format: "mermaid",
    });
    expect(seq.data.text).toContain("Prices->>Prices: notify()");
    const found = await call<{
      detections: { variant?: string; confidence: number }[];
    }>("/detect_patterns", { patterns: ["Observer"], minConfidence: 0.99 });
    expect(
      found.data.detections.some((d) => d.variant === "interface-subject"),
    ).toBe(true);
    const pattern = withVariant(
      patterns().find((p) => p.name === "Observer")!,
      "interface-subject",
    );
    expect(pattern.roles[0]!.type).toBe("UMLInterface");
  });

  it("applies presets and describes types", async () => {
    const money = await call<{ _id: string }>("/create_element", {
      type: "UMLClass",
      parent: "Model",
      name: "Money",
    });
    await call("/add_attribute", {
      ref: money.data._id,
      name: "amount",
      type: "int",
    });
    const res = await call<{ properties: { field: string }[] }>(
      "/apply_preset",
      {
        ref: money.data._id,
        preset: "value-object",
      },
    );
    expect(res.success, JSON.stringify(res)).toBe(true);
    const amount = await call<{ isReadOnly: boolean; visibility: string }>(
      "/get_element_by_id",
      { ref: "Model/Money.amount", fields: ["isReadOnly", "visibility"] },
    );
    expect(amount.data).toMatchObject({
      isReadOnly: true,
      visibility: "private",
    });
    const type = await call<{
      properties: { name: string; meaning?: string; allowed?: string[] }[];
    }>("/describe_type", { type: "UMLAssociationEnd" });
    expect(
      type.data.properties.find((p) => p.name === "aggregation"),
    ).toMatchObject({
      allowed: ["none", "shared", "composite"],
      meaning: expect.stringMatching(/^On an association end/),
    });
    const lint = await call<{ findings: { rule: string }[] }>("/uml_lint", {});
    expect(lint.success).toBe(true);
  });
});
