import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint } from "../../../src/endpoint.js";
import { manifest } from "../../../src/handlers/introspect.js";
import { endpoints } from "../../../src/routes.js";
import { EXTENSION_VERSION } from "../../../src/version.js";
import recorded from "../../fixtures/introspect.7.1.1.json";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { ok } from "../support.js";

const introspect = endpoints.find((e) => e.path === "/introspect")!;

interface Introspection {
  staruml: { version: string; apiVersion: string | null };
  extension: { name: string; version: string };
  factory?: Record<string, unknown>;
  metamodel?: Record<string, Record<string, unknown>>;
  endpoints?: { path: string; request: Record<string, unknown> }[];
  errors?: { status: Record<string, number> };
}

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("/introspect", () => {
  it("reports the StarUML and extension versions", async () => {
    const data = await ok<Introspection>(introspect, { include: [] });
    expect(data).toEqual({
      staruml: { version: "7.1.1", apiVersion: "7.1.1" },
      extension: { name: "staruml-mcp-extension", version: EXTENSION_VERSION },
    });
  });

  it("keeps catalogue sections while the registries stay, and starts again when one grows (issue #26)", async () => {
    const first = await ok<{ toolbox: unknown }>(introspect, {
      include: ["toolbox"],
    });
    const again = await ok<{ toolbox: unknown }>(introspect, {
      include: ["toolbox"],
    });
    expect(again.toolbox).toBe(first.toolbox);
    env.app.toolbox.items.Extra = {
      id: "Extra",
      groupId: "g",
      title: "Extra",
      rubberband: "rect",
    } as never;
    const grown = await ok<{ toolbox: unknown }>(introspect, {
      include: ["toolbox"],
    });
    expect(grown.toolbox).not.toBe(first.toolbox);
  });

  it("returns every section by default", async () => {
    const data = await ok<Introspection>(introspect);
    expect(Object.keys(data).sort()).toEqual([
      "endpoints",
      "errors",
      "extension",
      "factory",
      "metamodel",
      "staruml",
      "toolbox",
    ]);
  });

  it("copes with meta entries that omit attributes or literals", async () => {
    const g = globalThis as unknown as { meta: Record<string, unknown> };
    g.meta = { ...g.meta, Bare: { kind: "class" }, BareKind: { kind: "enum" } };
    const data = await ok<Introspection>(introspect, {
      include: ["metamodel"],
      types: ["Bare", "BareKind"],
    });
    expect(data.metamodel!.Bare).toMatchObject({ attributes: [], super: null });
    expect(data.metamodel!.BareKind).toMatchObject({ literals: [] });
  });

  it("reports a missing apiVersion as null", async () => {
    env.app.metadata = {};
    const data = await ok<Introspection>(introspect, { include: [] });
    expect(data.staruml.apiVersion).toBeNull();
  });

  // The mock is built from the recorded catalogue, so this checks that the
  // handler reproduces what 7.1.1 answered from the same inputs.
  it("rebuilds the recorded factory and metamodel sections", async () => {
    const data = await ok<Introspection>(introspect, {
      include: ["factory", "metamodel"],
    });
    expect(data.factory).toEqual(recorded.factory);
    expect(data.metamodel).toEqual(recorded.metamodel);
    expect(data.endpoints).toBeUndefined();
  });

  it("rebuilds the recorded toolbox section", async () => {
    const data = await ok<Introspection & { toolbox: unknown }>(introspect, {
      include: ["toolbox"],
    });
    expect(data.toolbox).toEqual(recorded.toolbox);
  });

  it("describes classes with supers, view types, relationship kind and creatability", async () => {
    const data = await ok<Introspection>(introspect, {
      include: ["metamodel"],
      types: [
        "UMLClass",
        "UMLClassDiagram",
        "UMLAssociation",
        "UMLVisibilityKind",
        "Nope",
      ],
    });
    expect(Object.keys(data.metamodel!)).toEqual([
      "UMLAssociation",
      "UMLClass",
      "UMLClassDiagram",
      "UMLVisibilityKind",
    ]);
    expect(data.metamodel!.UMLClass).toMatchObject({
      kind: "class",
      super: "UMLClassifier",
      supers: [
        "UMLClassifier",
        "UMLModelElement",
        "ExtensibleModel",
        "Model",
        "Element",
      ],
      viewType: "UMLClassView",
      relationship: null,
      isView: false,
      isDiagram: false,
      creatable: { model: true, modelAndView: true, diagram: false },
    });
    expect(data.metamodel!.UMLClassDiagram).toMatchObject({
      isDiagram: true,
      viewTypes: expect.arrayContaining(["UMLClassView", "UMLAssociationView"]),
      creatable: { model: false, modelAndView: false, diagram: true },
    });
    expect(data.metamodel!.UMLAssociation!.relationship).toBe("undirected");
    expect(data.metamodel!.UMLVisibilityKind).toMatchObject({
      kind: "enum",
      literals: ["public", "protected", "private", "package"],
    });
  });

  it("lists inherited attributes on request", async () => {
    const own = await ok<Introspection>(introspect, {
      include: ["metamodel"],
      types: ["UMLClass"],
    });
    const all = await ok<Introspection>(introspect, {
      include: ["metamodel"],
      types: ["UMLClass"],
      inherited: true,
    });
    const names = (d: Introspection) =>
      (d.metamodel!.UMLClass!.attributes as { name: string }[]).map(
        (a) => a.name,
      );
    expect(names(own)).toEqual(["isActive"]);
    expect(names(all)).toEqual(
      expect.arrayContaining(["_id", "name", "attributes", "isActive"]),
    );
  });

  it("lists what each model-and-view id creates", async () => {
    const data = await ok<{
      factory: { modelAndView: Record<string, unknown>[] };
    }>(introspect, { include: ["factory"] });
    const byId = Object.fromEntries(
      data.factory.modelAndView.map((e) => [e.id, e]),
    );
    expect(byId.UMLInputExpansionNode).toEqual({
      id: "UMLInputExpansionNode",
      modelType: "UMLExpansionNode",
      viewType: "UMLExpansionNodeView",
      relationship: null,
    });
    expect(byId.Note).toMatchObject({
      modelType: null,
      viewType: "UMLNoteView",
    });
    expect(byId.UMLGeneralization).toMatchObject({ relationship: "directed" });
  });

  it("publishes the endpoint manifest and error codes", async () => {
    const data = await ok<Introspection>(introspect, {
      include: ["endpoints"],
    });
    expect(data.endpoints!.map((e) => e.path)).toEqual(
      endpoints.map((e) => e.path),
    );
    expect(data.errors!.status.NOT_FOUND).toBe(404);
  });
});

describe("manifest", () => {
  it("matches the recorded 7.1.1 snapshot, which must be refreshed when an endpoint changes", () => {
    expect(manifest(endpoints)).toEqual(recorded.endpoints);
  });

  it("gives every endpoint an object request schema, as MCP tool inputs require", () => {
    for (const entry of manifest(endpoints)) {
      expect(entry.request, entry.path).toMatchObject({ type: "object" });
      expect(entry.response, entry.path).toHaveProperty("$schema");
    }
  });

  it("is derived once per endpoint list", () => {
    const first = manifest(endpoints);
    expect(manifest(endpoints)).toBe(first);
    const other = [
      defineEndpoint({
        path: "/x",
        description: "x",
        readOnly: true,
        destructive: false,
        request: z.object({}),
        response: z.null(),
        handle: () => null,
      }),
    ];
    expect(manifest(other)).toEqual([
      expect.objectContaining({
        path: "/x",
        response: expect.objectContaining({ type: "null" }),
      }),
    ]);
    expect(manifest(endpoints)).not.toBe(first);
  });
});
