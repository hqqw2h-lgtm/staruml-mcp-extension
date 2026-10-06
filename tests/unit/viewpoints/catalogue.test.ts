import Ajv2020 from "ajv/dist/2020.js";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import introspect from "../../fixtures/introspect.7.1.1.json";
import decisions from "../../../src/viewpoints/decisions.json";
import {
  crossCheck,
  elementLimit,
  findViewpoint,
  loadCatalogue,
  VIEWPOINT_FILES,
  viewpointCatalogue,
  viewpoints,
} from "../../../src/viewpoints/index.js";
import {
  type DecisionTable,
  decisionTableSchema,
  type Viewpoint,
  VIEWPOINT_NAMES,
  viewpointSchema,
} from "../../../src/viewpoints/schema.js";
import { ApiError } from "../../../src/errors.js";

// Issue #42: the viewpoint catalogue and decision table are data, held to
// a schema and to cross-checks that no schema can express.

const metamodel = introspect.metamodel as Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("viewpoint catalogue", () => {
  it("holds the nine viewpoints, each valid against its JSON Schema", async () => {
    expect(viewpoints().map((v) => v.name)).toEqual([...VIEWPOINT_NAMES]);
    const text = await format(
      JSON.stringify(z.toJSONSchema(viewpointSchema())),
      { parser: "json" },
    );
    // The JSON Schema the files name in $schema is this schema.
    await expect(text).toMatchFileSnapshot(
      "../../../src/viewpoints/viewpoint.schema.json",
    );
    const schema = JSON.parse(text) as Record<string, unknown>;
    const validate = new Ajv2020({ strict: false }).compile(schema);
    for (const file of VIEWPOINT_FILES) {
      expect(validate(file), JSON.stringify(validate.errors)).toBe(true);
    }
    const tableText = await format(
      JSON.stringify(z.toJSONSchema(decisionTableSchema())),
      { parser: "json" },
    );
    await expect(tableText).toMatchFileSnapshot(
      "../../../src/viewpoints/decisions.schema.json",
    );
    const table = JSON.parse(tableText) as Record<string, unknown>;
    const check = new Ajv2020({ strict: false }).compile(table);
    expect(check(decisions), JSON.stringify(check.errors)).toBe(true);
  });

  it("names only metaclasses StarUML 7.1.1 has", () => {
    for (const v of viewpoints()) {
      for (const t of [...v.elements, ...v.relationships]) {
        expect(metamodel, `${v.name}: ${t}`).toHaveProperty([t]);
      }
    }
  });

  it("writes a legend for every viewpoint that requires one, and a question for each", () => {
    for (const v of viewpoints()) {
      expect(v.question).toMatch(/\?$/);
      if (v.required.includes("legend"))
        expect(v.legend!.length).toBeGreaterThan(0);
    }
  });

  it("finds a viewpoint by name and refuses an unknown one", () => {
    expect(findViewpoint("runtime").limits.maxLifelines).toBe(12);
    expect(() => findViewpoint("poster")).toThrow(ApiError);
    expect(() => findViewpoint("poster")).toThrow(/the viewpoints are context/);
    expect(elementLimit(findViewpoint("actors-goals"), "mindmap")).toBe(60);
    expect(elementLimit(findViewpoint("actors-goals"), "usecase")).toBe(25);
    expect(viewpointCatalogue()).toBe(viewpointCatalogue());
  });
});

describe("cross-checks", () => {
  const vps = () => viewpoints().map(clone);
  const table = () => clone(viewpointCatalogue().table) as DecisionTable;

  it("passes the committed catalogue", () => {
    expect(crossCheck(vps(), table())).toEqual([]);
    expect(loadCatalogue(VIEWPOINT_FILES, decisions).viewpoints).toHaveLength(
      9,
    );
  });

  it("reports a viewpoint missing, twice, or reached by no rule", () => {
    const list = vps();
    const twice = [...list, list[0]!];
    expect(crossCheck(twice, table())).toContain(
      "viewpoint context: not defined exactly once",
    );
    expect(crossCheck(list.slice(1), table())).toContain(
      "viewpoint context: not defined exactly once",
    );
    const t = table();
    t.rules = t.rules.filter((r) => r.viewpoint !== "data");
    expect(crossCheck(list, t)).toContain(
      "viewpoint data: no decision rule reaches it",
    );
  });

  it("reports an audience no viewpoint is written for", () => {
    const list = vps().map((v) => ({
      ...v,
      stakeholders: v.stakeholders.filter((s) => s !== "dba"),
    })) as Viewpoint[];
    // An emptied list would break the schema, not the cross-check.
    expect(crossCheck(list, table())).toContain(
      "audience dba: no viewpoint is written for it",
    );
  });

  it("reports duplicate rule ids, a kind the viewpoint is not drawn as, and bad defaults", () => {
    const t = table();
    t.rules.push({ ...t.rules[0]! });
    t.rules[1] = { ...t.rules[1]!, kind: "class" };
    t.defaults = { ...t.defaults, model: "D99", actor: "D01" };
    const problems = crossCheck(vps(), t);
    expect(problems).toContain("rule D01: defined twice");
    expect(problems).toContain("rule D02: data is not drawn as class");
    expect(problems).toContain("default model: no rule D99");
    expect(problems).toContain(
      "default actor: rule D01 is not drawn for that scope",
    );
    expect(() => loadCatalogue(VIEWPOINT_FILES, t)).toThrow(
      /^viewpoint catalogue: .*rule D01: defined twice/,
    );
  });

  it("refuses files the schema does not accept", () => {
    expect(() =>
      loadCatalogue([{ ...(VIEWPOINT_FILES[0] as object), x: 1 }], decisions),
    ).toThrow();
  });
});
