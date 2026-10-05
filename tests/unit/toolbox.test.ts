import { beforeEach, describe, expect, it } from "vitest";
import { resolveCreateType } from "../../src/toolbox.js";
import { installMockApp, type MockEnvironment } from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("resolveCreateType", () => {
  it("takes a plain model-and-view id as is", () => {
    expect(resolveCreateType("UMLClass")).toEqual({
      id: "UMLClass",
      preset: {},
    });
  });

  it("resolves a toolbox item to its id and presets, as the editor does on drop", () => {
    expect(resolveCreateType("UMLComposition")).toEqual({
      id: "UMLAssociation",
      preset: { "model-init": { end2: { aggregation: "composite" } } },
    });
    expect(resolveCreateType("UMLCompositeState")).toEqual({
      id: "UMLState",
      preset: { regionCount: 1 },
    });
  });

  it("prefers the item where a name is both an item and a model-and-view id", () => {
    expect(resolveCreateType("C4ContainerDatabase")).toEqual({
      id: "C4Container",
      preset: { "model-init": { kind: "database" } },
    });
  });

  it("drops presets that hit-test the cursor or copy the head over the tail", () => {
    expect(resolveCreateType("UMLAsyncMessage")).toEqual({
      id: "UMLMessage",
      preset: { "model-init": { messageSort: "asynchCall" } },
    });
    expect(resolveCreateType("UMLSelfTransition")).toEqual({
      id: "UMLTransition",
      preset: {},
    });
  });

  it("falls back to the model-and-view id for an item with its own command", () => {
    expect(env.app.toolbox.items.UMLFrame).toHaveProperty("command");
    expect(resolveCreateType("UMLFrame")).toEqual({
      id: "UMLFrame",
      preset: {},
    });
  });

  it("refuses items run by another command and unknown names", () => {
    expect(() => resolveCreateType("UMLBoundary")).toThrow(
      expect.objectContaining({
        code: "UNKNOWN_TYPE",
        message: expect.stringMatching(
          /^UMLBoundary is a toolbox item run by the command \S+, which this API does not call$/,
        ),
      }),
    );
    for (const name of ["Nope", "toString"]) {
      expect(() => resolveCreateType(name)).toThrow(
        `Unknown model-and-view type: ${name}`,
      );
    }
  });
});
