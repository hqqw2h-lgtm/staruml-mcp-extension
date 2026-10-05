import { beforeEach, describe, expect, it } from "vitest";
import {
  allowedOrigins,
  DEFAULTS,
  logLevel,
  logs,
  maxBatchOps,
  maxBodyBytes,
  PREF,
  positiveInt,
  preferencePolicy,
  RateLimiter,
  timeoutMs,
  token,
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

describe("access settings", () => {
  it("trims the token and treats a non-string as none", () => {
    expect(token()).toBe("");
    app.preferences.set(PREF.token, "  t  ");
    expect(token()).toBe("t");
    app.preferences.set(PREF.token, 5);
    expect(token()).toBe("");
  });

  it("splits allowed origins on commas and spaces", () => {
    expect(allowedOrigins()).toEqual([]);
    app.preferences.set(
      PREF.allowedOrigins,
      " http://a:1, http://b  http://c,",
    );
    expect(allowedOrigins()).toEqual(["http://a:1", "http://b", "http://c"]);
  });

  it("converts the timeout to milliseconds", () => {
    expect(timeoutMs()).toBe(60_000);
    app.preferences.set(PREF.timeoutSeconds, 2);
    expect(timeoutMs()).toBe(2000);
  });

  it("falls back to info for an unknown log level", () => {
    expect(logLevel()).toBe("info");
    app.preferences.set(PREF.logLevel, "verbose");
    expect(logLevel()).toBe("info");
    expect(logs("info")).toBe(true);
    expect(logs("debug")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows the limit per sliding minute and says how long to wait", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(
      () => 2,
      () => now,
    );
    expect(limiter.take("/x")).toBe(0);
    now += 10_000;
    expect(limiter.take("/x")).toBe(0);
    now += 1_000;
    expect(limiter.take("/x")).toBe(49);
    expect(limiter.take("/y")).toBe(0);
    now += 49_001;
    expect(limiter.take("/x")).toBe(0);
  });

  it("uses the clock by default", () => {
    const limiter = new RateLimiter(() => 1);
    expect(limiter.take("/x")).toBe(0);
    expect(limiter.take("/x")).toBeGreaterThan(0);
  });
});

describe("preferencePolicy", () => {
  it("throttles only /execute_command, by the preference", () => {
    app.preferences.set(PREF.commandsPerMinute, 1);
    const policy = preferencePolicy();
    expect(policy.throttle("/execute_command")).toBe(0);
    expect(policy.throttle("/execute_command")).toBeGreaterThan(0);
    expect(policy.throttle("/get_all_commands")).toBe(0);
    expect(policy.maxBodyBytes()).toBe(DEFAULTS.maxBodyKiB * 1024);
    expect(policy.token()).toBe("");
    expect(policy.allowedOrigins()).toEqual([]);
    expect(policy.timeoutMs()).toBe(60_000);
  });
});
