import { beforeEach, describe, expect, it } from "vitest";
import { runBatch } from "../../src/handlers/batch.js";
import { endpoints } from "../../src/routes.js";
import { insideStep, oneStep, rehearse } from "../../src/undo.js";
import {
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

/** One recorded field assignment, as an engine call makes. */
function assign(elem: MockElement, field: string, value: unknown): void {
  const b = env.app.repository.getOperationBuilder();
  b.begin(`set ${field}`);
  b.fieldAssign(elem, field, value);
  b.end();
  env.app.repository.doOperation(b.getOperation()!);
}

const stack = () => env.app.repository._undoStack;

describe("oneStep", () => {
  it("merges what it records into one undo step, nested steps included", async () => {
    const before = stack().size();
    const value = await oneStep("outer", async () => {
      expect(insideStep()).toBe(true);
      assign(env.model, "name", "A");
      await oneStep("inner", () => assign(env.model, "documentation", "d"));
      // An inner batch leaves the merge to the step.
      await runBatch(endpoints, [
        {
          path: "/update_element",
          body: { ref: env.model._id, field: "name", value: "B" },
        },
        {
          path: "/update_element",
          body: { ref: env.model._id, field: "name", value: "C" },
        },
      ]);
      return 7;
    });
    expect(value).toBe(7);
    expect(insideStep()).toBe(false);
    expect(stack().size()).toBe(before + 1);
    expect(stack().stack.at(-1)!.name).toBe("outer");
    env.app.repository.undo();
    expect(env.model.name).toBe("Model");
    expect(env.model.documentation).toBe("");
  });

  it("records nothing for a step that changes nothing", async () => {
    const before = stack().size();
    await oneStep("empty", () => undefined);
    expect(stack().size()).toBe(before);
  });

  it("undoes what it did when it throws, leaving nothing to redo", async () => {
    assign(env.model, "documentation", "kept");
    await expect(
      oneStep("failing", () => {
        assign(env.model, "name", "Broken");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(env.model.name).toBe("Model");
    expect(env.model.documentation).toBe("kept");
    expect(env.app.repository._redoStack.size()).toBe(0);
  });

  it("stops at the first operation it did not record", async () => {
    await oneStep("s", () => {
      assign(env.model, "name", "X");
      // Something else's operation on top, e.g. pushed past the listener.
      stack().push({ name: "foreign", ops: [] });
    });
    expect(stack().stack.at(-1)!.name).toBe("foreign");
    await expect(
      oneStep("t", () => {
        stack().push({ name: "foreign2", ops: [] });
        throw new Error("x");
      }),
    ).rejects.toThrow();
  });
});

describe("rehearse", () => {
  it("answers the run's value and leaves the model as it was", async () => {
    const before = stack().size();
    const seen = await rehearse(() => {
      assign(env.model, "name", "Tried");
      return env.model.name;
    });
    expect(seen).toBe("Tried");
    expect(env.model.name).toBe("Model");
    expect(stack().size()).toBe(before);
  });
});
