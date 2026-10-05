import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint, doc } from "../../src/endpoint.js";
import { ApiError } from "../../src/errors.js";

const echo = defineEndpoint({
  path: "/echo",
  description: "Echo.",
  readOnly: true,
  destructive: false,
  request: z.object({
    n: z.int(),
    tags: z.optional(z.array(z.string())),
  }),
  response: z.object({ n: z.int() }),
  handle: async (input) => {
    if (input.n === 404) throw new ApiError("NOT_FOUND", "no such n");
    if (input.n === 500) throw new Error("defect");
    return { n: input.n };
  },
});

describe("defineEndpoint", () => {
  it("keeps the declared metadata and drops the implementation", () => {
    expect(echo).toMatchObject({
      path: "/echo",
      description: "Echo.",
      readOnly: true,
      destructive: false,
    });
    expect(echo).not.toHaveProperty("handle");
  });

  it("passes the parsed body to the handler and wraps its result", async () => {
    expect(await echo.handler({ n: 1, extra: true })).toEqual({
      success: true,
      data: { n: 1 },
    });
  });

  it("answers INVALID_ARGUMENT with one issue per problem, naming its path", async () => {
    expect(await echo.handler({ n: "x", tags: [1] })).toEqual({
      success: false,
      code: "INVALID_ARGUMENT",
      error:
        "n: Invalid input: expected number, received string; tags.0: Invalid input: expected string, received number",
      details: [
        {
          path: "n",
          message: "Invalid input: expected number, received string",
        },
        {
          path: "tags.0",
          message: "Invalid input: expected string, received number",
        },
      ],
    });
  });

  it("names the body itself when it is not an object", async () => {
    const result = await echo.handler(null as unknown as Record<string, never>);
    expect(result).toMatchObject({
      code: "INVALID_ARGUMENT",
      details: [{ path: "(body)" }],
    });
  });

  it("turns an ApiError into its error body", async () => {
    expect(await echo.handler({ n: 404 })).toEqual({
      success: false,
      code: "NOT_FOUND",
      error: "no such n",
    });
  });

  it("lets any other exception reach the HTTP server", async () => {
    await expect(echo.handler({ n: 500 })).rejects.toThrow("defect");
  });
});

describe("doc", () => {
  it("attaches a description that JSON Schema generation carries", () => {
    const schema = doc(z.string(), "A name.");
    expect(z.toJSONSchema(schema)).toMatchObject({
      type: "string",
      description: "A name.",
    });
  });
});
