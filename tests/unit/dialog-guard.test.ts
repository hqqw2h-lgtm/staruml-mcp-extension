import { beforeEach, describe, expect, it } from "vitest";
import { DialogRefused, withoutDialogs } from "../../src/dialog-guard.js";
import { ApiError } from "../../src/errors.js";
import { installMockApp, type MockEnvironment } from "../mock/staruml.js";

let env: MockEnvironment;
let picker: { showDialog: () => string; other: number };
const hosts = () => env.app as unknown as Record<string, unknown>;

beforeEach(() => {
  env = installMockApp();
  picker = { showDialog: () => "picked", other: 1 };
  hosts().elementPickerDialog = picker;
  hosts().nothing = null;
});

describe("withoutDialogs", () => {
  it("passes the result through and restores every dialog afterwards", async () => {
    const original = picker.showDialog;
    (env.app.dialogs as unknown as Record<string, unknown>).showOwnDialog =
      () => "own";
    const own = (env.app.dialogs as unknown as Record<string, () => string>)
      .showOwnDialog;
    expect(await withoutDialogs("x", async () => 7)).toBe(7);
    expect(picker.showDialog).toBe(original);
    expect(Object.hasOwn(env.app.dialogs, "showInfoDialog")).toBe(false);
    expect(
      (env.app.dialogs as unknown as Record<string, unknown>).showOwnDialog,
    ).toBe(own);
    env.app.dialogs.showInfoDialog("still works");
    expect(env.app.dialogs.shown).toHaveLength(1);
  });

  it("refuses a dialog opened directly and reports it", async () => {
    const err = await withoutDialogs("Command t:x", () =>
      env.app.dialogs.showInfoDialog("hi"),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "DIALOG_REQUIRED",
      message:
        "Command t:x opens a dialog (dialogs.showInfoDialog) that would wait for someone at StarUML; pass the arguments that avoid it or use a dedicated endpoint",
      details: { dialogs: ["dialogs.showInfoDialog"] },
    });
    expect(env.app.dialogs.shown).toEqual([]);
  });

  it("reports a refused dialog even when the caller swallows the error", async () => {
    const run = async () => {
      try {
        picker.showDialog();
      } catch (err) {
        expect(err).toBeInstanceOf(DialogRefused);
        expect((err as DialogRefused).dialog).toBe(
          "elementPickerDialog.showDialog",
        );
      }
      return "done";
    };
    await expect(withoutDialogs("y", run)).rejects.toMatchObject({
      code: "DIALOG_REQUIRED",
    });
    expect(picker.showDialog()).toBe("picked");
  });

  it("rethrows other errors unchanged", async () => {
    const boom = new Error("boom");
    await expect(
      withoutDialogs("z", () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
