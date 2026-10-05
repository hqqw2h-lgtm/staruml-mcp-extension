import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMANDS,
  describeCommands,
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
        path: "Model",
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

describe("command catalogue", () => {
  it("gives every without-args command the arguments that avoid its dialog", () => {
    for (const [id, info] of Object.entries(COMMANDS)) {
      if (info.dialog === "without-args") {
        expect(info.avoidWith, id).toBeTypeOf("number");
        expect(info.avoidWith!, id).toBeLessThanOrEqual(info.args.length);
      } else {
        expect(info.avoidWith, id).toBeUndefined();
      }
    }
  });
});

describe("/execute_command dialogs", () => {
  it("refuses a command that always opens a dialog, before running it", async () => {
    let ran = false;
    env.app.commands.register("help:about", () => {
      ran = true;
    });
    const err = await fails(
      executeCommand,
      { id: "help:about" },
      "DIALOG_REQUIRED",
      /^help:about always opens a dialog/,
    );
    expect(err.details).toEqual({ dialog: "always" });
    env.app.commands.register("view:rename-diagram", () => {});
    await fails(
      executeCommand,
      { id: "view:rename-diagram" },
      "DIALOG_REQUIRED",
      /^view:rename-diagram always opens a dialog .*\(.*\) Throws.+/,
    );
    env.app.commands.register("java:configure", () => {});
    await fails(
      executeCommand,
      { id: "java:configure" },
      "DIALOG_REQUIRED",
      /\)$/,
    );
    expect(ran).toBe(false);
  });

  it("refuses a command missing the arguments that avoid its dialog", async () => {
    const calls: unknown[][] = [];
    env.app.commands.register("project:export-fragment", (...a) => {
      calls.push(a);
    });
    const err = await fails(
      executeCommand,
      { id: "project:export-fragment", args: ["x"] },
      "DIALOG_REQUIRED",
      "project:export-fragment opens a dialog unless given element, fullPath; pass 2 arguments",
    );
    expect(err.details).toEqual({
      dialog: "without-args",
      args: ["element", "fullPath"],
    });
    env.app.commands.register("format:fill-color", () => {});
    await fails(
      executeCommand,
      { id: "format:fill-color" },
      "DIALOG_REQUIRED",
      /pass 1 argument$/,
    );
    await ok(executeCommand, {
      id: "project:export-fragment",
      args: ["x", "/tmp/y"],
    });
    expect(calls).toEqual([["x", "/tmp/y"]]);
  });

  it("stops a command where it opens a dialog at run time", async () => {
    env.app.commands.register("project:save", () =>
      env.app.dialogs.showInfoDialog("no file"),
    );
    await fails(
      executeCommand,
      { id: "project:save" },
      "DIALOG_REQUIRED",
      /^Command project:save opens a dialog \(dialogs.showInfoDialog\)/,
    );
    expect(env.app.dialogs.shown).toEqual([]);
  });
});

describe("/describe_commands", () => {
  it("merges the catalogue with what is registered", async () => {
    env.app.commands.register("edit:undo", () => {});
    const all = await ok<{
      catalogue: string;
      count: number;
      commands: { id: string; registered: boolean; dialog: string }[];
    }>(describeCommands);
    expect(all.catalogue).toBe("7.1.1");
    expect(all.count).toBe(Object.keys(COMMANDS).length + 2);
    const byId = new Map(all.commands.map((c) => [c.id, c]));
    expect(byId.get("test:a")).toEqual({
      id: "test:a",
      registered: true,
      dialog: "unknown",
    });
    expect(byId.get("edit:undo")).toMatchObject({
      registered: true,
      dialog: "never",
      args: [],
    });
    expect(byId.get("help:about")).toMatchObject({
      registered: false,
      dialog: "always",
    });
    expect(all.commands.map((c) => c.id)).toEqual(
      [...all.commands.map((c) => c.id)].sort(),
    );
    const some = await ok<{ commands: { id: string }[] }>(describeCommands, {
      ids: ["project:open", "toString"],
    });
    expect(some.commands).toMatchObject([
      { id: "project:open", dialog: "without-args", avoidWith: 1 },
      { id: "toString", registered: false, dialog: "unknown" },
    ]);
  });
});
