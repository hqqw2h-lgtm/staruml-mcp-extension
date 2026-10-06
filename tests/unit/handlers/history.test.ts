import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElementWithView } from "../../../src/handlers/elements.js";
import { isModified, redo, undo } from "../../../src/handlers/history.js";
import { moveViews } from "../../../src/handlers/views.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

describe("/undo, /redo, /is_modified", () => {
  it("reports a fresh project as unmodified", async () => {
    expect(await ok(isModified)).toEqual({ modified: false });
  });

  it("undoes and redoes the last operation", async () => {
    const a = await ok<{ view: { _id: string } }>(createElementWithView, {
      type: "UMLClass",
      diagramId: env.mainDiagram._id,
    });
    await ok(moveViews, { ids: [a.view._id], dx: 50, dy: 0 });
    const view = env.app.repository.get(a.view._id)!;
    expect(view.left).toBe(150);
    expect(await ok(undo)).toEqual({ modified: true });
    expect(view.left).toBe(100);
    await ok(redo);
    expect(view.left).toBe(150);
  });

  it("is a no-op on empty stacks", async () => {
    await ok(undo);
    await ok(redo);
  });

  it("reports what StarUML throws", async () => {
    vi.spyOn(env.app.repository, "undo").mockImplementation(() => {
      throw new Error("boom");
    });
    await fails(undo, {}, "STARUML_ERROR", "boom");
  });
});
