import { describe, expect, it } from "vitest";
import surface from "../fixtures/app-surface.7.1.1.json";
import { installMockApp, MOCK_ONLY_MEMBERS } from "../mock/staruml.js";

// The fixture is the live 7.1.1 prototype listing; tests/integration checks it
// against the running app, this checks the mock against the fixture.
describe("mock app surface", () => {
  const { app } = installMockApp();
  const managers = surface.managers as Record<string, { proto: string[] }>;

  it.each(Object.keys(managers))(
    "app.%s has the same prototype methods as 7.1.1",
    (name) => {
      const instance = (app as unknown as Record<string, object>)[name];
      expect(instance, `mock lacks app.${name}`).toBeDefined();
      const extra = MOCK_ONLY_MEMBERS[name] ?? [];
      const names = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
        .filter((n) => !extra.includes(n))
        .sort();
      expect(names).toEqual(managers[name]!.proto);
    },
  );

  it("stubs fail loudly instead of inventing behaviour", () => {
    expect(() =>
      (app.engine as unknown as { layoutDiagram: () => void }).layoutDiagram(),
    ).toThrow("mock: Engine.layoutDiagram is not modelled");
  });
});
