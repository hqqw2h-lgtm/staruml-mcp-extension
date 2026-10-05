import { describe, expect, it } from "vitest";
import {
  ApiError,
  ERROR_CODES,
  ERROR_STATUS,
  errorMessage,
  inStarUML,
} from "../../src/errors.js";

describe("errorMessage", () => {
  it("uses Error.message and stringifies anything else", () => {
    expect(errorMessage(new TypeError("bad"))).toBe("bad");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("ApiError", () => {
  it("renders an error body, with details only when given", () => {
    expect(new ApiError("NOT_FOUND", "gone").toBody()).toEqual({
      success: false,
      code: "NOT_FOUND",
      error: "gone",
    });
    expect(new ApiError("INVALID_ARGUMENT", "bad", [1]).toBody()).toEqual({
      success: false,
      code: "INVALID_ARGUMENT",
      error: "bad",
      details: [1],
    });
    expect(new ApiError("INTERNAL", "x").name).toBe("ApiError");
  });

  it("maps every code to an HTTP error status", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("inStarUML", () => {
  it("returns the call's result", () => {
    expect(inStarUML(() => 3)).toBe(3);
  });

  it("lets an ApiError from our own callbacks through unchanged", () => {
    const own = new ApiError("NOT_FOUND", "inner");
    expect(() =>
      inStarUML(() => {
        throw own;
      }),
    ).toThrow(own);
  });

  it("reports a thrown string, as factory preconditions throw, as STARUML_ERROR", () => {
    expect(() =>
      inStarUML(() => {
        throw "Invalid connection (UMLGeneralization)";
      }),
    ).toThrow(
      expect.objectContaining({
        code: "STARUML_ERROR",
        message: "Invalid connection (UMLGeneralization)",
      }),
    );
  });
});
