import { beforeEach, describe, expect, it } from "vitest";
import {
  scoreEntry,
  searchTypes,
  typeCorpus,
} from "../../../src/handlers/search.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

interface Hit {
  id: string;
  category: string;
  title?: string;
  description: string;
  example?: { path: string; body: Record<string, unknown> };
  score: number;
}

interface Found {
  query: string;
  total: number;
  results: Hit[];
}

const search = (body: Record<string, unknown>) => ok<Found>(searchTypes, body);

describe("/search_types", () => {
  it("ranks an exact id first and gives a palette example", async () => {
    const data = await search({ query: "UMLClass" });
    expect(data.results[0]).toMatchObject({
      id: "UMLClass",
      category: "palette",
      title: "Class",
      example: {
        path: "/create_element_with_view",
        body: { type: "UMLClass", diagramId: "<diagram id>" },
      },
    });
    expect(data.results[0]!.description).toMatch(
      /^Palette node "Class" in ".+" \(UMLClassDiagram/,
    );
    expect(data.results.length).toBeLessThanOrEqual(10);
    expect(data.total).toBeGreaterThan(data.results.length);
  });

  it("describes palette edges with their preset and relationship kind", async () => {
    const data = await search({ query: "composition", limit: 3 });
    const hit = data.results.find((h) => h.id === "UMLComposition")!;
    expect(hit.category).toBe("relationship");
    expect(hit.description).toMatch(
      /^Palette edge "Composition".*creates UMLAssociation, an undirected relationship/,
    );
    expect(hit.example).toEqual({
      path: "/create_relationship",
      body: {
        type: "UMLComposition",
        tailId: "<source view id>",
        headId: "<target view id>",
        diagramId: "<diagram id>",
      },
    });
  });

  it("finds diagrams, models, enums and commands by words", async () => {
    const diagram = await search({
      query: "state chart diagram",
      categories: ["diagram"],
    });
    expect(diagram.results[0]).toMatchObject({
      id: "UMLStatechartDiagram",
      category: "diagram",
      example: { path: "/create_diagram" },
    });
    const enums = await search({ query: "UMLVisibilityKind" });
    expect(enums.results[0]).toMatchObject({
      category: "enum",
      description: expect.stringMatching(/^Enumeration: public \| /),
    });
    const command = await search({
      query: "align bottom",
      categories: ["command"],
    });
    expect(command.results[0]).toMatchObject({
      id: "alignment:align-bottom",
      example: {
        path: "/execute_command",
        body: { id: "alignment:align-bottom" },
      },
    });
    const withArgs = await search({
      query: "project.open",
      categories: ["command"],
    });
    expect(withArgs.results[0]!.description).toMatch(/\(dialog: /);
  });

  it("gives model types the request that creates them", async () => {
    const attr = await search({ query: "UMLAttribute", categories: ["model"] });
    expect(attr.results[0]).toMatchObject({
      id: "UMLAttribute",
      example: { path: "/create_element" },
    });
    expect(attr.results[0]!.description).toMatch(
      /^Model element, kind of UMLStructuralFeature.*creatable as a model$/,
    );
    const abstract = await search({
      query: "UMLClassifier",
      categories: ["model"],
    });
    expect(abstract.results[0]).toMatchObject({
      id: "UMLClassifier",
      example: { path: "/find_elements", body: { type: "UMLClassifier" } },
    });
    expect(abstract.results[0]!.description).toMatch(/not creatable directly$/);
    const root = await search({ query: "Element", categories: ["model"] });
    expect(root.results[0]!.description).toMatch(/^Model element, root type/);
  });

  it("lists relationship ids, those without a palette item too", async () => {
    // 7.1.1 has a palette item for every relationship id; this one has none.
    const factory = env.app.factory as unknown as {
      getModelAndViewIds(): string[];
    };
    const ids = factory.getModelAndViewIds();
    factory.getModelAndViewIds = () => [...ids, "UMLAbstraction"];
    const data = await search({
      query: "relationship",
      categories: ["relationship"],
      limit: 50,
    });
    expect(data.results.length).toBeGreaterThan(1);
    expect(data.results.map((h) => h.id)).toContain("UMLAbstraction");
    for (const hit of data.results) {
      expect(hit.example!.path).toBe("/create_relationship");
      expect(hit.description).toMatch(/relationship/);
    }
  });

  it("describes what extensions may register sparsely", async () => {
    const g = meta as Record<string, unknown>;
    g.XBare = { kind: "class", super: "Model" };
    g.XBareKind = { kind: "enum" };
    const factory = env.app.factory as unknown as {
      getModelAndViewIds(): string[];
      modelAndViewOptions: Record<string, { modelType?: string }>;
    };
    const ids = factory.getModelAndViewIds();
    factory.getModelAndViewIds = () => [...ids, "XLink"];
    factory.modelAndViewOptions.XLink = { modelType: "UMLDependency" };
    env.app.toolbox.items.XOrphan = {
      id: "XOrphan",
      groupId: "no-such-group",
      title: "Orphan",
      rubberband: "rect",
    };
    try {
      const bare = await search({ query: "XBare", limit: 2 });
      expect(bare.results.map((h) => [h.id, h.description])).toEqual([
        ["XBare", expect.stringMatching(/^Model element, kind of Model < /)],
        ["XBareKind", "Enumeration: "],
      ]);
      expect(bare.results[0]!.description).not.toMatch(/own attributes/);
      const link = await search({ query: "XLink" });
      expect(link.results[0]!.description).toMatch(
        /^directed relationship \(source -> target\) creating UMLDependency, kind of /,
      );
      const orphan = await search({ query: "XOrphan" });
      expect(orphan.results[0]!.description).toBe(
        'Palette node "Orphan"; creates XOrphan',
      );
    } finally {
      delete g.XBare;
      delete g.XBareKind;
      delete factory.modelAndViewOptions.XLink;
    }
  });

  it("matches letters in order when no word matches", async () => {
    const data = await search({ query: "clsdgm" });
    expect(data.results.map((h) => h.id)).toContain("UMLClassDiagram");
    const none = await search({ query: "qqqqzzzz" });
    expect(none).toEqual({ query: "qqqqzzzz", total: 0, results: [] });
  });

  it("caches the corpus until the registries change", () => {
    const first = typeCorpus();
    expect(typeCorpus()).toBe(first);
    installMockApp();
    expect(typeCorpus()).not.toBe(first);
  });

  it("validates the request", async () => {
    await fails(searchTypes, { query: "" }, "INVALID_ARGUMENT");
    await fails(searchTypes, { query: "a", limit: 51 }, "INVALID_ARGUMENT");
    await fails(
      searchTypes,
      { query: "a", categories: ["view"] },
      "INVALID_ARGUMENT",
    );
  });
});

describe("scoreEntry", () => {
  const entry = {
    id: "UMLClass",
    category: "palette" as const,
    title: "Class",
    description: "Palette node",
  };
  it("orders exact, prefix, substring, words and letters", () => {
    expect(scoreEntry(entry, "uml-class")).toBe(1000);
    expect(scoreEntry(entry, "class")).toBe(1000);
    expect(scoreEntry(entry, "UMLCla")).toBe(898);
    expect(scoreEntry(entry, "lcla")).toBe(796);
    expect(scoreEntry(entry, "palette node")).toBe(502);
    expect(scoreEntry(entry, "ucs")).toBeGreaterThan(200);
    expect(scoreEntry(entry, "???")).toBe(0);
    expect(scoreEntry({ ...entry, title: undefined, id: "X" }, "x y")).toBe(0);
  });
});
