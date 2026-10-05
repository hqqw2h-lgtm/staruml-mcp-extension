import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint, renameAliases } from "../../src/endpoint.js";
import { manifest } from "../../src/handlers/introspect.js";
import { endpoints } from "../../src/routes.js";
import {
  installMockApp,
  type Element,
  type MockEnvironment,
  type View,
} from "../mock/staruml.js";
import { fails, fullResults, invoke, ok } from "./support.js";

/*
 * Issue #20 path addressing and issue #36 canonical field names, through
 * the endpoints that take references.
 */

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

const endpoint = (path: string) =>
  fullResults(endpoints.find((e) => e.path === path)!);

interface Summary {
  _id: string;
  _type: string;
  name: string | null;
  path?: string;
}

interface Created {
  view: Summary | null;
  model: Summary | null;
}

async function classOnMain(name: string): Promise<Created> {
  return ok<Created>(endpoint("/create_element_with_view"), {
    type: "UMLClass",
    diagram: "Main",
    name,
  });
}

describe("path references through endpoints", () => {
  it("creates, reads, updates and deletes by path, answering paths", async () => {
    const pkg = await ok<Summary>(endpoint("/create_element"), {
      type: "UMLPackage",
      parent: "Model",
      name: "Shop",
    });
    expect(pkg.path).toBe("Model/Shop");
    const order = await ok<Summary>(endpoint("/create_element"), {
      type: "UMLClass",
      parent: "Model/Shop",
      name: "Order",
    });
    await ok(endpoint("/add_attribute"), {
      ref: "Shop/Order",
      name: "total",
      type: "double",
    });
    await ok(endpoint("/add_operation"), { ref: "Order", name: "pay" });
    const total = await ok<Summary>(endpoint("/get_element_by_id"), {
      ref: "Model/Shop/Order.total",
    });
    expect(total).toMatchObject({
      name: "total",
      path: "Model/Shop/Order.total",
    });
    expect(
      await ok<Summary>(endpoint("/get_element_by_id"), {
        id: "Order#pay()",
      }),
    ).toMatchObject({ _type: "UMLOperation", path: "Model/Shop/Order#pay()" });
    // A reference value given as a path.
    const line = await ok<Summary>(endpoint("/create_element"), {
      type: "UMLClass",
      parent: "Shop",
      name: "Line",
    });
    const typed = await ok<{ type: { $ref: string } }>(
      endpoint("/update_element"),
      {
        ref: "Order.total",
        field: "type",
        value: { $ref: "Shop/Line" },
        fields: ["type"],
      },
    );
    expect(typed.type).toEqual({ $ref: line._id });
    const deleted = await ok<{ deleted: string }>(endpoint("/delete_element"), {
      ref: "Model/Shop/Line",
    });
    expect(deleted.deleted).toBe(line._id);
    void order;
  });

  it("reorders a list item named by path", async () => {
    await ok(endpoint("/create_element"), {
      type: "UMLClass",
      parent: "Model",
      name: "C",
    });
    for (const name of ["a", "b"]) {
      await ok(endpoint("/add_attribute"), { ref: "C", name });
    }
    const after = await ok<{ attributes: { $ref: string }[] }>(
      endpoint("/update_element"),
      {
        ref: "C",
        op: "reorder",
        field: "attributes",
        value: "C.b",
        index: 0,
        fields: ["attributes"],
      },
    );
    const b = await ok<Summary>(endpoint("/get_element_by_id"), {
      ref: "C.b",
    });
    expect(after.attributes[0]).toEqual({ $ref: b._id });
  });

  it("draws edges between models named by path, on a diagram named by path", async () => {
    await classOnMain("A");
    await classOnMain("B");
    const edge = await ok<Created>(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: "Model/A",
      head: "B",
      diagram: "Model/Main",
    });
    expect(edge.view!.path).toBe(`${edge.model!.path}@Model/Main`);
    const viaView = await ok<Created>(endpoint("/create_edge_with_view"), {
      type: "UMLDependency",
      tail: "A@Main",
      head: "B",
      diagram: "Main",
    });
    expect(viaView.model!._type).toBe("UMLDependency");
    await fails(
      endpoint("/create_edge_with_view"),
      { type: "UMLDependency", tail: "A", head: "B", diagram: "@project" },
      "NOT_FOUND",
      "Diagram not found: @project",
    );
  });

  it("answers AMBIGUOUS_REF with candidates and NOT_FOUND by role", async () => {
    await ok(endpoint("/create_element"), {
      type: "UMLPackage",
      parent: "Model",
      name: "Other",
    });
    for (const parent of ["Model", "Model/Other"]) {
      await ok(endpoint("/create_element"), {
        type: "UMLPackage",
        parent,
        name: "P",
      });
    }
    const failure = await fails(
      endpoint("/get_element_by_id"),
      { ref: "P" },
      "AMBIGUOUS_REF",
    );
    expect(
      (failure.details as { candidates: { path: string }[] }).candidates.map(
        (c) => c.path,
      ),
    ).toEqual(["Model/P", "Model/Other/P"]);
    // A path from the project names one of them.
    expect(
      await ok<Summary>(endpoint("/get_element_by_id"), { ref: "Model/P" }),
    ).toMatchObject({ path: "Model/P" });
    await fails(
      endpoint("/create_element"),
      { type: "UMLClass", parent: "Nope/P" },
      "NOT_FOUND",
      "Parent element not found: Nope/P",
    );
  });
});

describe("canonical names and aliases (#36)", () => {
  it("refuses both spellings of one field and reports issues as written", async () => {
    await fails(
      endpoint("/get_element_by_id"),
      { id: "Model", ref: "Model" },
      "INVALID_ARGUMENT",
      "id: an alias of ref, which is given too; pass ref only",
    );
    await fails(
      endpoint("/get_element_by_id"),
      { id: 7 },
      "INVALID_ARGUMENT",
      /^id: /,
    );
    await fails(
      endpoint("/get_element_by_id"),
      { ref: 7 },
      "INVALID_ARGUMENT",
      /^ref: /,
    );
    const nested = defineEndpoint({
      path: "/x",
      description: "",
      readOnly: true,
      destructive: false,
      request: z.object({ a: z.object({ b: z.string() }) }),
      aliases: { old: "a" },
      response: z.object({}),
      handle: () => ({}),
    });
    expect(await nested.handler({ old: { b: 1 } })).toMatchObject({
      error: expect.stringMatching(/^old\.b: /),
    });
    expect(await nested.handler({})).toMatchObject({
      error: expect.stringMatching(/^a: /),
    });
    expect(
      await nested.handler([] as unknown as Record<string, unknown>),
    ).toMatchObject({
      error: expect.stringMatching(/^\(body\): /),
    });
    expect(renameAliases(null, { a: "b" }).body).toBeNull();
    expect(renameAliases({ a: 1 }, undefined).body).toEqual({ a: 1 });
  });

  it("lists every alias in the manifest beside its canonical field", () => {
    for (const entry of manifest(endpoints)) {
      const e = endpoints.find((x) => x.path === entry.path)!;
      const props = (
        entry.request as { properties: Record<string, Record<string, unknown>> }
      ).properties;
      for (const [alias, canonical] of Object.entries(e.aliases ?? {})) {
        expect(props[canonical], `${e.path} ${canonical}`).toBeDefined();
        expect(props[alias]).toMatchObject({
          "x-alias-of": canonical,
          deprecated: true,
          description: `Alias of ${canonical}.`,
          type: props[canonical]!.type,
        });
      }
    }
  });

  // Command ids are not element references.
  const NOT_REFERENCES: Record<string, string[]> = {
    "/execute_command": ["id"],
    "/describe_commands": ["ids"],
  };

  it("names every element reference canonically (contract)", () => {
    const reference = /^(id|ids)$|Ids?$/;
    for (const entry of manifest(endpoints)) {
      const props =
        (
          entry.request as {
            properties?: Record<string, Record<string, unknown>>;
          }
        ).properties ?? {};
      for (const [name, schema] of Object.entries(props)) {
        if (!reference.test(name)) continue;
        if (NOT_REFERENCES[entry.path]?.includes(name)) continue;
        expect(schema["x-alias-of"], `${entry.path} ${name}`).toEqual(
          expect.stringMatching(
            /^(ref|refs|diagram|diagrams|tail|head|parent|container|views|models)$/,
          ),
        );
      }
    }
  });

  it("resolves an alias exactly as its canonical field (property)", async () => {
    await classOnMain("A");
    await classOnMain("B");
    await ok(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: "A",
      head: "B",
      diagram: "Main",
    });
    const refs = [
      "A",
      "Model/B",
      "Model/Main",
      "Main",
      "A@Main",
      "Model",
      "Nope",
      ...Object.keys(env.app.repository.getIdMap()),
    ];
    const pairs = endpoints.flatMap((e) =>
      Object.entries(e.aliases ?? {})
        .filter(
          ([, canonical]) => canonical === "ref" || canonical === "diagram",
        )
        .filter(() => e.readOnly)
        .map(([alias, canonical]) => ({ e, alias, canonical })),
    );
    expect(pairs.length).toBeGreaterThan(5);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...pairs),
        fc.constantFrom(...refs),
        async ({ e, alias, canonical }, ref) => {
          const byAlias = await invoke(e, { [alias]: ref });
          const byName = await invoke(e, { [canonical]: ref });
          expect(byAlias).toEqual(byName);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("duplicate names (#20)", () => {
  it("refuses a sibling's name unless allowed, per name space", async () => {
    const create = endpoint("/create_element");
    await ok(create, { type: "UMLClass", parent: "Model", name: "A" });
    const failure = await fails(
      create,
      { type: "UMLInterface", parent: "Model", name: "A" },
      "DUPLICATE_NAME",
      "Model already has a UMLClass named A (Model/A); pass allowDuplicateNames: true to add another",
    );
    expect(failure.details).toEqual({
      existing: {
        _id: expect.any(String),
        _type: "UMLClass",
        path: "Model/A",
      },
    });
    await ok(create, {
      type: "UMLClass",
      parent: "Model",
      name: "A",
      allowDuplicateNames: true,
    });
    // A diagram, an operation and a relationship may share a class's name.
    await ok(endpoint("/create_diagram"), {
      type: "UMLClassDiagram",
      parent: "Model",
      name: "Main2",
    });
    await fails(
      endpoint("/create_diagram"),
      { type: "UMLClassDiagram", parent: "Model", name: "Main" },
      "DUPLICATE_NAME",
    );
    await fails(
      endpoint("/create_diagram"),
      { type: "NoSuchDiagram", parent: "Model", name: "Main" },
      "UNKNOWN_TYPE",
    );
    const cls = await ok<Summary>(create, {
      type: "UMLClass",
      parent: "Model",
      name: "Solo",
    });
    await ok(endpoint("/add_attribute"), { ref: cls._id, name: "x" });
    await fails(
      endpoint("/add_attribute"),
      { ref: cls._id, name: "x" },
      "DUPLICATE_NAME",
    );
    await ok(endpoint("/add_operation"), { ref: cls._id, name: "x" });
    await ok(endpoint("/add_operation"), { ref: cls._id, name: "x" });
    await ok(create, { type: "UMLClass", parent: cls._id, name: "x" });
    const kind = await ok<Summary>(create, {
      type: "UMLEnumeration",
      parent: "Model",
      name: "Kind",
    });
    await ok(endpoint("/add_enumeration_literal"), {
      ref: kind._id,
      name: "A",
    });
    await fails(
      endpoint("/add_enumeration_literal"),
      { ref: kind._id, name: "A" },
      "DUPLICATE_NAME",
    );
    // Unnamed elements and kinds that repeat names by design pass.
    await ok(create, { type: "UMLClass", parent: "Model" });
    await ok(create, { type: "UMLClass", parent: "Model" });
    await classOnMain("V");
    await fails(
      endpoint("/create_element_with_view"),
      { type: "UMLClass", diagram: "Main", name: "V" },
      "DUPLICATE_NAME",
    );
    const host = await classOnMain("Host");
    await ok(endpoint("/create_element_with_view"), {
      type: "UMLPort",
      diagram: "Main",
      container: host.view!._id,
      name: "p",
    });
    await ok(endpoint("/create_element_with_view"), {
      type: "UMLPort",
      diagram: "Main",
      container: "Host",
      name: "p",
    });
    await ok(endpoint("/create_element_with_view"), {
      type: "Note",
      diagram: "Main",
    });
  });

  it("lets build_diagram add a diagram of a taken name only when allowed", async () => {
    const build = endpoint("/build_diagram");
    const spec = { classes: [{ name: "K" }] };
    await ok(build, { kind: "class", name: "Twice", spec });
    await fails(
      build,
      { kind: "class", name: "Twice", spec },
      "DUPLICATE_NAME",
    );
    await ok(build, {
      kind: "class",
      name: "Twice",
      spec,
      allowDuplicateNames: true,
    });
  });
});

describe("relationship labels and role names (#36)", () => {
  it("draws the name as a plain label and puts role names on the ends", async () => {
    // StarUML's UMLGeneralEdgeView starts with showVisibility true; the mock's
    // metamodel snapshot has no constructor defaults.
    const factory = env.app.factory;
    const original = factory.createModelAndView.bind(factory);
    factory.createModelAndView = (options) =>
      original({
        ...options,
        viewInitializer: (v: View) => {
          if ("showVisibility" in v) v.showVisibility = true;
          options.viewInitializer?.(v);
        },
      });
    await classOnMain("A");
    await classOnMain("B");
    const edge = await ok<Created>(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: "A",
      head: "B",
      diagram: "Main",
      name: "REST, WS",
      tailName: "client",
      headName: "server",
    });
    const view = env.app.repository.get(edge.view!._id) as View;
    const model = view.model!;
    expect(model.name).toBe("REST, WS");
    expect(view.showVisibility).toBe(false);
    expect((model.end1 as Element).name).toBe("client");
    expect((model.end2 as Element).name).toBe("server");
    const unnamed = await ok<Created>(endpoint("/create_edge_with_view"), {
      type: "UMLAssociation",
      tail: "A",
      head: "B",
      diagram: "Main",
      headEnd: { multiplicity: "*" },
      headName: "items",
    });
    const plain = env.app.repository.get(unnamed.view!._id) as View;
    expect(plain.showVisibility).toBe(true);
    expect((plain.model!.end2 as Element).multiplicity).toBe("*");
    const modelOnly = await ok<Created>(endpoint("/create_relationship"), {
      type: "UMLAssociation",
      tail: "A",
      head: "B",
      tailName: "from",
    });
    expect(
      (env.app.repository.get(modelOnly.model!._id)!.end1 as Element).name,
    ).toBe("from");
    // A named edge whose view has no visibility to hide.
    const flow = await ok<{
      diagram: { _id: string };
      edges: { view: string }[];
    }>(endpoint("/build_diagram"), {
      kind: "flowchart",
      spec: { nodes: ["X", "Y"], flows: [{ from: "X", to: "Y", label: "go" }] },
    });
    expect(
      "showVisibility" in env.app.repository.get(flow.edges[0]!.view)!,
    ).toBe(false);
  });
});

describe("build_diagram references (#20)", () => {
  it("shows the element a path names, and takes an unmatched path as a name", async () => {
    const build = endpoint("/build_diagram");
    const first = await ok<{ ids: Record<string, { model: string }> }>(build, {
      kind: "class",
      name: "One",
      parent: "Model",
      spec: {
        packages: ["Billing"],
        classes: [{ name: "Invoice", package: "Billing" }],
      },
    });
    const path = "Model/Billing/Invoice";
    const again = await ok<{
      ids: Record<string, { model: string }>;
      shown?: number;
    }>(build, {
      kind: "class",
      name: "Two",
      parent: "Model",
      spec: {
        classes: [{ name: path }, { name: "Model/Billing" }, { name: "x/y" }],
      },
    });
    expect(again.ids[path]!.model).toBe(first.ids.Invoice!.model);
    expect(again.shown).toBe(1);
    // "Model/Billing" is a package, not a class; "x/y" names nothing.
    expect(again.ids["Model/Billing"]!.model).not.toBe(
      first.ids.Billing!.model,
    );
    expect(env.app.repository.get(again.ids["x/y"]!.model)!.name).toBe("x/y");
    // Named once by name and once by path: the path finds it claimed.
    const twice = await ok<{ ids: Record<string, { model: string }> }>(build, {
      kind: "class",
      name: "Three",
      parent: "Model",
      spec: { classes: [{ name: "Invoice" }, { name: path }] },
    });
    expect(twice.ids.Invoice!.model).toBe(first.ids.Invoice!.model);
    expect(twice.ids[path]!.model).not.toBe(first.ids.Invoice!.model);
  });
});
