import { beforeEach, describe, expect, it } from "vitest";
import {
  executeCommand,
  getAllCommands,
} from "../../../src/handlers/commands.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
  env.app.commands.register("test:b", () => 42, "Named");
  env.app.commands.register("test:a", () => undefined);
});

describe("/get_all_commands", () => {
  it("lists every registered id, including commands without a display name", async () => {
    expect(await ok(getAllCommands)).toEqual({
      count: 2,
      ids: ["test:a", "test:b"],
    });
  });
});

describe("/execute_command", () => {
  it.each([{}, { id: "" }, { id: 7 }])(
    "rejects a missing id: %j",
    async (body) => {
      await fails(executeCommand, body, "INVALID_ARGUMENT", /^id: /);
    },
  );

  it("rejects an unregistered id, also one inherited from Object.prototype", async () => {
    for (const id of ["nope", "toString"]) {
      await fails(
        executeCommand,
        { id },
        "NOT_FOUND",
        `Command not registered: ${id}`,
      );
    }
  });

  it("passes args and returns a primitive result", async () => {
    env.app.commands.register(
      "test:sum",
      (a, b) => (a as number) + (b as number),
    );
    expect(await ok(executeCommand, { id: "test:sum", args: [2, 3] })).toEqual({
      id: "test:sum",
      result: 5,
    });
  });

  it("rejects non-array args", async () => {
    await fails(
      executeCommand,
      { id: "test:a", args: "x" },
      "INVALID_ARGUMENT",
      /^args: /,
    );
  });

  it("awaits a promise result", async () => {
    env.app.commands.register("test:async", () => Promise.resolve("done"));
    expect(await ok(executeCommand, { id: "test:async" })).toMatchObject({
      result: "done",
    });
  });

  it.each([
    ["undefined", () => undefined, null],
    ["a function", () => () => 1, "[function]"],
    ["an object", () => ({ a: [1] }), { a: [1] }],
  ])("serialises %s", async (_label, fn, expected) => {
    env.app.commands.register("test:value", fn);
    expect(await ok(executeCommand, { id: "test:value" })).toEqual({
      id: "test:value",
      result: expected,
    });
  });

  it("projects an element result like any element", async () => {
    env.app.commands.register("test:model", () => env.model);
    expect(await ok(executeCommand, { id: "test:model" })).toEqual({
      id: "test:model",
      result: {
        _id: env.model._id,
        _type: "UMLModel",
        name: "Model",
        _parent: env.project._id,
      },
    });
    expect(
      await ok(executeCommand, { id: "test:model", fields: ["name"] }),
    ).toMatchObject({ result: { name: "Model" } });
  });

  it("reports a throwing command as STARUML_ERROR", async () => {
    env.app.commands.register("test:throw", () => {
      throw new Error("boom");
    });
    await fails(
      executeCommand,
      { id: "test:throw" },
      "STARUML_ERROR",
      "Command test:throw threw: boom",
    );
  });
});
