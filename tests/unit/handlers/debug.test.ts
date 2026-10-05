import { beforeEach, describe, expect, it } from "vitest";
import {
  debug,
  describeSurface,
  INTROSPECTED_MANAGERS,
} from "../../../src/handlers/debug.js";
import { installMockApp } from "../../mock/staruml.js";
import { ok } from "../support.js";

describe("describeSurface", () => {
  it("lists own keys and prototype methods of an object", () => {
    class Thing {
      a = 1;
      method(): void {}
    }
    expect(describeSurface(new Thing())).toEqual({
      type: "object",
      keys: ["a"],
      proto: ["constructor", "method"],
    });
  });

  it.each([
    [undefined, "undefined"],
    [null, "object"],
    ["text", "string"],
  ])("reports %s without keys", (value, typeName) => {
    expect(describeSurface(value)).toEqual({
      type: typeName,
      keys: null,
      proto: null,
    });
  });
});

describe("/debug", () => {
  beforeEach(() => {
    installMockApp();
  });

  it("describes every introspected manager", async () => {
    const data = await ok<Record<string, { proto: string[] }>>(debug);
    expect(data.app_keys).toContain("repository");
    for (const name of INTROSPECTED_MANAGERS) {
      expect(data[name]!.proto).toContain("constructor");
    }
    expect(data.factory!.proto).toContain("createModelAndView");
    expect(data.metamodels!.proto).toContain("getMetaAttributes");
  });
});
