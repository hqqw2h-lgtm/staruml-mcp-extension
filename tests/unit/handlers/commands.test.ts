import { beforeEach, describe, expect, it } from "vitest";
import {
  executeCommand,
  getAllCommands,
} from "../../../src/handlers/commands.js";
import { installMockApp, type MockApp } from "../../mock/staruml.js";

let app: MockApp;

beforeEach(() => {
  ({ app } = installMockApp());
  app.commands.register("test:b", () => 42, "Named");
  app.commands.register("test:a", () => undefined);
});

describe("getAllCommands", () => {
  it("lists every registered id, including commands without a display name", async () => {
    expect(await getAllCommands({})).toEqual({
      success: true,
      data: { count: 2, ids: ["test:a", "test:b"] },
    });
  });
});

describe("executeCommand", () => {
  it.each([{}, { id: "" }, { id: 7 }])(
    "rejects a missing id: %j",
    async (body) => {
      expect(await executeCommand(body)).toEqual({
        success: false,
        error: "Required field 'id' (string) missing",
      });
    },
  );

  it("rejects an unregistered id", async () => {
    expect(await executeCommand({ id: "nope" })).toEqual({
      success: false,
      error: "Command not registered: nope",
    });
  });

  it("does not resolve ids through the prototype chain", async () => {
    expect(await executeCommand({ id: "toString" })).toMatchObject({
      success: false,
    });
  });

  it("passes args and returns a primitive result", async () => {
    app.commands.register("test:sum", (a, b) => (a as number) + (b as number));
    expect(await executeCommand({ id: "test:sum", args: [2, 3] })).toEqual({
      success: true,
      data: { id: "test:sum", result: 5 },
    });
  });

  it("ignores non-array args", async () => {
    app.commands.register("test:argc", (...args) => args.length);
    expect(await executeCommand({ id: "test:argc", args: "x" })).toMatchObject({
      data: { result: 0 },
    });
  });

  it("awaits a promise result", async () => {
    app.commands.register("test:async", () => Promise.resolve("done"));
    expect(await executeCommand({ id: "test:async" })).toMatchObject({
      data: { result: "done" },
    });
  });

  it.each([
    ["undefined", () => undefined, null],
    ["null", () => null, null],
    ["a function", () => () => 1, "[function]"],
    ["an object", () => ({ a: [1] }), { a: [1] }],
    [
      "a cyclic object",
      () => {
        const o: Record<string, unknown> = {};
        o.self = o;
        return o;
      },
      "[non-serializable]",
    ],
  ])("serialises %s", async (_label, fn, expected) => {
    app.commands.register("test:value", fn);
    expect(await executeCommand({ id: "test:value" })).toEqual({
      success: true,
      data: { id: "test:value", result: expected },
    });
  });

  it("reports a throwing command", async () => {
    app.commands.register("test:throw", () => {
      throw new Error("boom");
    });
    expect(await executeCommand({ id: "test:throw" })).toEqual({
      success: false,
      error: "Command test:throw threw: boom",
    });
  });
});
