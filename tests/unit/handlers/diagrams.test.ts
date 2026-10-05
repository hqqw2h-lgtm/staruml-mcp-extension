import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeDiagram,
  createDiagram,
  switchDiagram,
} from "../../../src/handlers/diagrams.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("/create_diagram", () => {
  it.each([{}, { type: "" }, { type: 1 }])(
    "requires a type: %j",
    async (body) => {
      await fails(
        createDiagram,
        { parentId: env.model._id, ...body },
        "INVALID_ARGUMENT",
        /^type: /,
      );
    },
  );

  it("requires a parentId", async () => {
    await fails(
      createDiagram,
      { type: "UMLClassDiagram" },
      "INVALID_ARGUMENT",
      /^parent: /,
    );
  });

  it("rejects an unknown parent", async () => {
    await fails(
      createDiagram,
      { type: "UMLClassDiagram", parentId: "missing" },
      "NOT_FOUND",
      "Parent element not found: missing",
    );
  });

  it("creates a named diagram and returns its summary", async () => {
    const data = await ok(createDiagram, {
      type: "UMLUseCaseDiagram",
      parentId: env.model._id,
      name: "Cases",
    });
    expect(data).toMatchObject({
      _type: "UMLUseCaseDiagram",
      name: "Cases",
      _parent: env.model._id,
    });
    expect(env.app.repository.get(data._id as string)).toBeDefined();
  });

  it("leaves the name to the factory and honours the projection", async () => {
    const data = await ok(createDiagram, {
      type: "UMLClassDiagram",
      parentId: env.model._id,
      fields: ["ownedViews"],
    });
    expect(data).toEqual({
      _id: data._id,
      _type: "UMLClassDiagram",
      ownedViews: [],
    });
  });

  it("reports an id without a diagram factory, for which it returns null", async () => {
    await fails(
      createDiagram,
      { type: "Nope", parentId: env.model._id },
      "UNKNOWN_TYPE",
      "Unknown diagram type: Nope",
    );
  });

  it("reports a failed factory precondition as STARUML_ERROR", async () => {
    const view = env.app.factory.createModelAndView({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
    })!;
    await fails(
      createDiagram,
      { type: "UMLClassDiagram", parentId: view._id },
      "STARUML_ERROR",
      "UMLClassDiagram cannot be placed here.",
    );
  });
});

describe.each([
  ["/switch_diagram", switchDiagram],
  ["/close_diagram", closeDiagram],
])("%s", (_path, endpoint) => {
  it("requires an id", async () => {
    await fails(endpoint, {}, "INVALID_ARGUMENT", /^diagram: /);
  });

  it.each(["missing", "model"])(
    "rejects an id that is not a diagram (%s)",
    async (which) => {
      const id = which === "model" ? env.model._id : which;
      await fails(endpoint, { id }, "NOT_FOUND", `Diagram not found: ${id}`);
    },
  );
});

describe("/switch_diagram", () => {
  it("makes the diagram current", async () => {
    expect(await ok(switchDiagram, { id: env.mainDiagram._id })).toEqual({
      _id: env.mainDiagram._id,
    });
    expect(env.app.diagrams.getCurrentDiagram()).toBe(env.mainDiagram);
  });

  it("reports a diagram manager exception", async () => {
    vi.spyOn(env.app.diagrams, "setCurrentDiagram").mockImplementation(() => {
      throw new Error("no editor");
    });
    await fails(
      switchDiagram,
      { id: env.mainDiagram._id },
      "STARUML_ERROR",
      "no editor",
    );
  });
});

describe("/close_diagram", () => {
  it("closes the diagram's tab", async () => {
    env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    expect(await ok(closeDiagram, { id: env.mainDiagram._id })).toEqual({
      closed: env.mainDiagram._id,
    });
    expect(env.app.diagrams.getWorkingDiagrams()).toEqual([]);
  });
});
