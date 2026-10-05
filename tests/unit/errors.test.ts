import { describe, expect, it } from "vitest";
import { errorMessage, failure } from "../../src/errors.js";

describe("errorMessage", () => {
  it("uses Error.message and stringifies anything else", () => {
    expect(errorMessage(new TypeError("bad"))).toBe("bad");
    expect(errorMessage("text")).toBe("text");
    expect(failure(42)).toEqual({ success: false, error: "42" });
  });
});
