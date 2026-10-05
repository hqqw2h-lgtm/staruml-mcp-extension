import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULTS,
  maxBatchOps,
  maxBodyBytes,
  PREF,
  positiveInt,
} from "../../src/settings.js";
import { installMockApp, type MockApp } from "../mock/staruml.js";

let app: MockApp;

beforeEach(() => {
  ({ app } = installMockApp());
});

describe("settings", () => {
  it("falls back to the defaults", () => {
    expect(maxBodyBytes()).toBe(DEFAULTS.maxBodyKiB * 1024);
    expect(maxBatchOps()).toBe(DEFAULTS.maxBatchOps);
  });

  it("reads the preferences on every call", () => {
    app.preferences.set(PREF.maxBodyKiB, 2);
    app.preferences.set(PREF.maxBatchOps, 3);
    expect(maxBodyBytes()).toBe(2048);
    expect(maxBatchOps()).toBe(3);
  });

  it.each([0, -1, 1.5, "10", null])("ignores the value %j", (value) => {
    app.preferences.set("k", value);
    expect(positiveInt("k", 7)).toBe(7);
  });
});
