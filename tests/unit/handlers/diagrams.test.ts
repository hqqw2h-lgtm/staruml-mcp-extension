import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeDiagramById,
  createDiagram,
  switchDiagram,
} from "../../../src/handlers/diagrams.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("createDiagram", () => {
  it.each([{}, { type: "" }])("requires a type: %j", async (body) => {
    expect(await createDiagram(body)).toMatchObject({
      success: false,
      error: expect.stringContaining("Required field 'type'"),
    });
  });

  it.each([
    { type: "UMLClassDiagram" },
    { type: "UMLClassDiagram", parentId: "" },
  ])("requires a parentId: %j", async (body) => {
    expect(await createDiagram(body)).toEqual({
      success: false,
      error: "Required field 'parentId' (string) missing",
    });
  });

  it("rejects an unknown parent", async () => {
    expect(
      await createDiagram({ type: "UMLClassDiagram", parentId: "missing" }),
    ).toEqual({
      success: false,
      error: "Parent element not found: missing",
    });
  });

  it("creates a named diagram under the parent", async () => {
    const result = await createDiagram({
      type: "UMLClassDiagram",
      parentId: env.model._id,
      name: "Domain",
    });
    expect(result).toMatchObject({
      success: true,
      data: { name: "Domain", type: "UMLClassDiagram" },
    });
    const id = (result as { data: { _id: string } }).data._id;
    expect(env.app.repository.get(id)?._parent).toBe(env.model);
  });

  it("creates an unnamed diagram", async () => {
    const result = await createDiagram({
      type: "UMLClassDiagram",
      parentId: env.model._id,
    });
    expect(result).toMatchObject({ success: true, data: { name: "" } });
  });

  it("reports an id the factory does not know, for which it returns null", async () => {
    expect(
      await createDiagram({ type: "NoSuchDiagram", parentId: env.model._id }),
    ).toEqual({
      success: false,
      error: "Unknown diagram type: NoSuchDiagram",
    });
  });

  it("reports a factory exception", async () => {
    vi.spyOn(env.app.factory, "createDiagram").mockImplementation(() => {
      throw new Error("factory down");
    });
    expect(
      await createDiagram({ type: "UMLClassDiagram", parentId: env.model._id }),
    ).toEqual({
      success: false,
      error: "factory down",
    });
  });
});

describe.each([
  ["switchDiagram", switchDiagram, "setCurrentDiagram"],
  ["closeDiagramById", closeDiagramById, "closeDiagram"],
] as const)("%s", (_name, handler, method) => {
  it.each([{}, { id: "" }])("requires an id: %j", async (body) => {
    expect(await handler(body)).toEqual({
      success: false,
      error: "Required field 'id' (diagram id) missing",
    });
  });

  it("rejects an unknown id", async () => {
    expect(await handler({ id: "missing" })).toEqual({
      success: false,
      error: "Diagram not found: missing",
    });
  });

  it("rejects an element that is not a diagram", async () => {
    expect(await handler({ id: env.model._id })).toEqual({
      success: false,
      error: `Diagram not found: ${env.model._id}`,
    });
  });

  it("reports a diagram manager exception", async () => {
    vi.spyOn(env.app.diagrams, method).mockImplementation(() => {
      throw new Error("editor gone");
    });
    expect(await handler({ id: env.mainDiagram._id })).toEqual({
      success: false,
      error: "editor gone",
    });
  });
});

describe("switching and closing", () => {
  it("makes the diagram current, then closes it", async () => {
    const id = env.mainDiagram._id;
    expect(await switchDiagram({ id })).toEqual({
      success: true,
      data: { _id: id },
    });
    expect(env.app.diagrams.getCurrentDiagram()).toBe(env.mainDiagram);
    expect(await closeDiagramById({ id })).toEqual({
      success: true,
      data: { closed: id },
    });
    expect(env.app.diagrams.getWorkingDiagrams()).toEqual([]);
  });
});
