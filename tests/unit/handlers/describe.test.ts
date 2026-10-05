import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeDiagram,
  validateModel,
} from "../../../src/handlers/describe.js";
import { endpoints } from "../../../src/routes.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

const build = endpoints.find((e) => e.path === "/build_diagram")!;

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
}

interface Described {
  diagram: { _id: string; _type: string; name: string | null };
  nodes: number;
  edges: number;
  text: string;
  truncated: boolean;
}

describe("/describe_diagram", () => {
  it("summarises nodes with members and edges", async () => {
    const built = await ok<Built>(build, {
      name: "Shop",
      mermaid: [
        "classDiagram",
        "class Order {",
        "  +id: long[1] = 0$",
        "  -String note",
        "  +total(qty: int, Item item): double*",
        "  +reset()$",
        "  #hidden()",
        "}",
        "class Kind {",
        "  <<enumeration>>",
        "  NEW",
        "}",
        "Customer --> Order : places",
        "Order --|> Base",
      ].join("\n"),
    });
    const data = await ok<Described>(describeDiagram, {
      diagramId: built.diagram._id,
    });
    expect(data).toMatchObject({
      diagram: {
        _id: built.diagram._id,
        _type: "UMLClassDiagram",
        name: "Shop",
      },
      nodes: 4,
      edges: 2,
      truncated: false,
    });
    expect(data.text.split("\n")).toEqual([
      'UMLClassDiagram "Shop" in "Untitled": 4 nodes, 2 edges',
      "Nodes:",
      '- UMLClass "Order" { +id: long[1] = 0$; -note: String; +total(qty: int, item: Item): double*; +reset()$; #hidden() }',
      '- UMLEnumeration "Kind" { NEW }',
      '- UMLClass "Customer"',
      '- UMLClass "Base"',
      "Edges:",
      '- "Customer" -[UMLAssociation "places"]-> "Order"',
      '- "Order" -[UMLGeneralization]-> "Base"',
    ]);
  });

  it("lists ERD columns and unnamed nodes, and joins multi-line names", async () => {
    const erd = await ok<Built>(build, {
      kind: "erd",
      spec: {
        entities: [
          {
            name: "Two<br/>Lines",
            columns: ["id int PK", "code varchar(8) FK", "plain"],
          },
        ],
      },
    });
    const text = (
      await ok<Described>(describeDiagram, { diagramId: erd.diagram._id })
    ).text;
    expect(text).toContain(
      '- ERDEntity "Two Lines" { id int PK; code varchar(8) FK; plain }',
    );
    const act = await ok<Built>(build, {
      kind: "activity",
      spec: { nodes: [{ id: "s", type: "initial" }] },
    });
    const described = await ok<Described>(describeDiagram, {
      diagramId: act.diagram._id,
    });
    expect(described.text).toContain("- UMLInitialNode (unnamed)");
    expect(described.text).not.toContain("Edges:");
  });

  it("leaves out views without a model and edges to them", async () => {
    const built = await ok<Built>(build, {
      kind: "flowchart",
      spec: { nodes: ["A", "B"], flows: [{ from: "A", to: "B" }] },
    });
    const diagram = env.app.repository.get(built.diagram._id)!;
    const edge = (
      diagram.ownedViews as { tail?: unknown; model: unknown }[]
    ).find((v) => v.tail)!;
    const a = env.app.repository.get(built.ids.A!.view)!;
    a.model = null;
    const data = await ok<Described>(describeDiagram, {
      diagramId: built.diagram._id,
    });
    expect(data).toMatchObject({ nodes: 1, edges: 0 });
    expect(data.text).not.toContain('Nodes:\n- FCProcess "A"');
    void edge;
    const empty = await ok<Described>(describeDiagram, {
      diagramId: env.mainDiagram._id,
    });
    expect(empty.text).toBe(
      'UMLClassDiagram "Main" in "Model": 0 nodes, 0 edges',
    );
  });

  it("cuts the text at maxChars and counts what it left out", async () => {
    const built = await ok<Built>(build, {
      kind: "flowchart",
      spec: { nodes: Array.from({ length: 40 }, (_, i) => `Step number ${i}`) },
    });
    const data = await ok<Described>(describeDiagram, {
      diagramId: built.diagram._id,
      maxChars: 300,
    });
    expect(data.truncated).toBe(true);
    expect(data.text.length).toBeLessThanOrEqual(300);
    expect(data.text).toMatch(/\n\.\.\. \d+ more lines$/);
  });

  it("checks its arguments", async () => {
    await fails(describeDiagram, { diagramId: env.model._id }, "NOT_FOUND");
    await fails(
      describeDiagram,
      { diagramId: env.mainDiagram._id, maxChars: 10 },
      "INVALID_ARGUMENT",
    );
  });
});

interface Validated {
  count: number;
  rules: number;
  problems: {
    id: string;
    _type: string;
    name: string | null;
    ruleId: string;
    message: string;
  }[];
}

const proc = process as { resourcesPath?: string };

afterEach(() => {
  delete proc.resourcesPath;
});

/**
 * A StarUML install tree with rules.js files where the main process finds
 * them, written as the real ones are: pushes into the `rules` global.
 */
function installRules(withUser: boolean): void {
  const root = mkdtempSync(join(tmpdir(), "resources-"));
  const write = (path: string, body: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  write(
    "app/resources/default/rules.js",
    `rules.push({ id: "UML001", message: "Name expected.", appliesTo: ["UMLModelElement"],
      exceptions: ["UMLDirectedRelationship", "UMLUndirectedRelationship"],
      constraint: (e) => String(e.name ?? "").length > 0 });`,
  );
  write(
    "app/extensions/essential/uml/rules.js",
    `rules.push({ id: "UML002", message: "Name is already defined.", appliesTo: ["UMLModelElement"],
      constraint: (e) => !(e._parent?.ownedElements ?? []).some((s) => s !== e && e.name && s.name === e.name) });`,
  );
  mkdirSync(join(root, "app/extensions/default/no-rules"), { recursive: true });
  if (withUser) {
    write(
      "user/boom/rules.js",
      `rules.push({ id: "BOOM", message: "never", appliesTo: ["UMLClass"],
        constraint: () => { throw new Error("rule bug"); } });`,
    );
    (env.app as unknown as Record<string, unknown>).extensionLoader = {
      getUserExtensionPath: () => join(root, "user"),
    };
  }
  proc.resourcesPath = join(root);
}

describe("/validate_model", () => {
  it("loads the rules files and lists failures with element and rule ids, within a scope", async () => {
    installRules(false);
    const built = await ok<Built>(build, {
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    const a = env.app.repository.get(built.ids.A!.model)!;
    const b = env.app.repository.get(built.ids.B!.model)!;
    b.name = "A";
    const all = await ok<Validated>(validateModel);
    expect(all.rules).toBe(2);
    expect(all.problems).toContainEqual({
      id: a._id,
      _type: "UMLClass",
      name: "A",
      ruleId: "UML002",
      message: "Name is already defined.",
    });
    expect(all.count).toBe(all.problems.length);
    // A second call reads the same files without adding their rules again.
    const limited = await ok<Validated>(validateModel, { limit: 1 });
    expect(limited).toMatchObject({ count: all.count, rules: 2 });
    expect(limited.problems).toHaveLength(1);
    const scoped = await ok<Validated>(validateModel, { scope: a._id });
    expect(scoped.problems.map((p) => p.id)).toEqual([a._id]);
  });

  it("reads user extensions' rules, names unnamed elements null and skips rules that throw", async () => {
    installRules(true);
    const built = await ok<Built>(build, {
      kind: "class",
      spec: { classes: [{ name: "A" }] },
    });
    const a = env.app.repository.get(built.ids.A!.model)!;
    delete (a as { name?: string }).name;
    const data = await ok<Validated>(validateModel, { scope: a._id });
    expect(data.rules).toBe(3);
    expect(data.problems).toEqual([
      {
        id: a._id,
        _type: "UMLClass",
        name: null,
        ruleId: "UML001",
        message: "Name expected.",
      },
    ]);
  });

  it("drops problems on elements gone from the repository", async () => {
    installRules(false);
    env.app.validator.validate = () => [
      { id: "gone", ruleId: "X", message: "m" },
    ];
    expect(await ok<Validated>(validateModel)).toMatchObject({
      count: 0,
      problems: [],
    });
  });

  it("needs StarUML's files, the validator and a known scope", async () => {
    await fails(
      validateModel,
      {},
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML",
    );
    installRules(false);
    await fails(validateModel, { scope: "nope" }, "NOT_FOUND");
    (env.app as unknown as Record<string, unknown>).validator = undefined;
    await fails(
      validateModel,
      {},
      "STARUML_ERROR",
      "This StarUML has no app.validator to run the rules",
    );
  });
});
