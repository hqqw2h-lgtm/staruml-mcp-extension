import { describe, expect, it } from "vitest";
import { CLIP, clip } from "../../../src/handlers/model.js";

describe("clip (summary dry runs, #40)", () => {
  it("cuts long strings anywhere in an op and says how much was left", () => {
    const long = "x".repeat(CLIP + 7);
    expect(
      clip({
        path: "/create_element",
        body: { value: long, n: 3, list: [long, "a"], none: null },
      }),
    ).toEqual({
      path: "/create_element",
      body: {
        value: `${"x".repeat(CLIP)}... [7 more chars]`,
        n: 3,
        list: [`${"x".repeat(CLIP)}... [7 more chars]`, "a"],
        none: null,
      },
    });
  });
});
