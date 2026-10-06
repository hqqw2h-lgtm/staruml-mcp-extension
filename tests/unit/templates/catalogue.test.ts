import Ajv2020 from "ajv/dist/2020.js";
import { format } from "prettier";
import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { ApiError } from "../../../src/errors.js";
import { endpoints } from "../../../src/routes.js";
import { builtInProfiles } from "../../../src/style/profile.js";
import {
  crossCheckTemplates,
  defaultTemplate,
  findTemplate,
  loadTemplates,
  scopeText,
  TEMPLATE_FILES,
  templateParts,
  templateProfile,
  templates,
} from "../../../src/templates/index.js";
import {
  type Template,
  templateSchema,
} from "../../../src/templates/schema.js";
import type { Element } from "../../../src/types.js";
import { viewpointCatalogue } from "../../../src/viewpoints/index.js";
import { create, installMockApp } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

// Issue #43: the template catalogue is data, one default per viewpoint and
// kind, held to a schema and cross-checked against the viewpoints.

const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeEach(() => {
  installMockApp();
});

describe("template catalogue", () => {
  it("holds a default template for every viewpoint and kind, each valid against its JSON Schema", async () => {
    const text = await format(
      JSON.stringify(z.toJSONSchema(templateSchema())),
      {
        parser: "json",
      },
    );
    await expect(text).toMatchFileSnapshot(
      "../../../src/templates/template.schema.json",
    );
    const validate = new Ajv2020({ strict: false }).compile(JSON.parse(text));
    for (const file of TEMPLATE_FILES) {
      expect(validate(file), JSON.stringify(validate.errors)).toBe(true);
    }
    const pairs = viewpointCatalogue().viewpoints.flatMap((v) =>
      v.kinds.map((k) => `${v.name}:${k}`),
    );
    expect(
      templates()
        .map((t) => `${t.viewpoint}:${t.kind}`)
        .sort(),
    ).toEqual(pairs.sort());
    expect(templates()).toBe(templates());
    expect(defaultTemplate("runtime", "sequence").name).toBe(
      "runtime-sequence",
    );
  });

  it("names its templates, and refuses an unknown one", () => {
    expect(findTemplate("data-erd").kind).toBe("erd");
    expect(() => findTemplate("poster")).toThrow(ApiError);
    expect(() => findTemplate("poster")).toThrow(
      /the templates are context-landscape/,
    );
  });

  it("cross-checks kinds, defaults, legends and the decision table", () => {
    const list = () => templates().map(clone) as Template[];
    expect(crossCheckTemplates(list(), viewpointCatalogue())).toEqual([]);
    const bad = list();
    bad.push({ ...bad[0]! });
    bad[1] = { ...bad[1]!, kind: "class" };
    bad[12] = { ...bad[12]!, parts: { titleBlock: true, legend: [] } };
    bad[13] = { ...bad[13]!, name: "renamed" };
    const problems = crossCheckTemplates(bad, viewpointCatalogue());
    expect(problems).toEqual(
      expect.arrayContaining([
        "template context-landscape: defined twice",
        "template container-overview: container is not drawn as class",
        "template deployment-nodes: deployment requires a legend",
        "context as c4: 2 default templates, not one",
        "container as c4: 0 default templates, not one",
        "rule D02: no template data-erd",
        "rule D10: template container-overview draws container as class",
      ]),
    );
    expect(() => loadTemplates(bad)).toThrow(/^template catalogue: /);
    expect(() => loadTemplates([{ name: "x" }])).toThrow();
  });

  it("draws in the project's style or a built-in's visuals, keeping the project's rules", () => {
    const project = {
      ...builtInProfiles()["uml-standard"]!,
      strict: true,
      name: "mine",
    };
    const t = findTemplate("container-overview");
    expect(templateProfile(project, t)).toBe(project);
    const house = templateProfile(project, { ...t, style: "presentation" });
    expect(house).toMatchObject({
      name: "presentation",
      strict: true,
      naming: project.naming,
      policy: project.policy,
      visuals: builtInProfiles()["presentation"]!.visuals,
    });
  });

  it("writes the title block and legend, and the scope as a reader says it", () => {
    const model = create("UMLModel") as Element;
    const project = create("Project") as Element;
    Object.assign(model, { name: "Shop", _parent: project });
    const collab = create("UMLCollaboration") as Element;
    Object.assign(collab, { name: "Pay", _parent: model });
    const interaction = create("UMLInteraction") as Element;
    Object.assign(interaction, { name: "Pay", _parent: collab });
    expect(scopeText(interaction, "Pay")).toBe("Shop");
    expect(scopeText(interaction, "Pay communication")).toBe("Shop");
    expect(scopeText(model, "Shop")).toBe("Shop");
    expect(scopeText(project, "x")).toBe("");
    const parts = templateParts(
      findTemplate("deployment-nodes"),
      "Prod",
      model,
    );
    expect(parts.title).toBe(
      [
        "Prod",
        "Deployment: Where does the system run, and how are its runtime environments connected?",
        "Scope: Shop",
        "Template: deployment-nodes v1",
      ].join("\n"),
    );
    expect(parts.legend).toMatch(/^Legend\nNode: /);
    const bare = templateParts(
      { ...findTemplate("data-erd"), parts: { titleBlock: false, legend: [] } },
      null,
      project,
    );
    expect(bare).toEqual({});
    expect(
      templateParts(findTemplate("data-erd"), undefined, project).title,
    ).toBe(
      "Data\nData: What data does the system keep, and how are the records related?\nTemplate: data-erd v1",
    );
  });
});

describe("/list_templates and /describe_template", () => {
  it("describes a template without its exemplar", async () => {
    const one = await ok<{
      template: Record<string, unknown>;
      question: string;
    }>(ep("/describe_template"), { template: "runtime-sequence" });
    expect(one.template).toMatchObject({
      name: "runtime-sequence",
      viewpoint: "runtime",
      kind: "sequence",
      content: { maxLifelines: 12 },
    });
    expect(one.template).not.toHaveProperty("$schema");
    expect(JSON.stringify(one)).not.toMatch(/fingerprint|exemplar|Telemetry/);
    expect(one.question).toMatch(/\?$/);
    await fails(ep("/describe_template"), { name: "x" }, "NOT_FOUND");
  });
});
