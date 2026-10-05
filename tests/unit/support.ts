import { expect } from "vitest";
import * as z from "zod/mini";
import type { Endpoint } from "../../src/endpoint.js";
import type { ErrorBody, ErrorCode } from "../../src/errors.js";

/**
 * Calls an endpoint the way the HTTP server does and holds every successful
 * answer to the endpoint's own response schema, so the manifest cannot
 * promise a shape the handler does not produce.
 */
export async function invoke(
  endpoint: Endpoint,
  body: Record<string, unknown> = {},
) {
  const result = await endpoint.handler(body);
  if (result.success) z.parse(endpoint.response, result.data);
  return result;
}

/** The `data` of a call that must succeed. */
export async function ok<T = Record<string, unknown>>(
  endpoint: Endpoint,
  body: Record<string, unknown> = {},
): Promise<T> {
  const result = await invoke(endpoint, body);
  expect(result, JSON.stringify(result)).toMatchObject({ success: true });
  return (result as { data: T }).data;
}

/** The error body of a call that must fail, checked against the expected code. */
export async function fails(
  endpoint: Endpoint,
  body: Record<string, unknown>,
  code: ErrorCode,
  error?: string | RegExp,
): Promise<ErrorBody> {
  const result = await invoke(endpoint, body);
  expect(result, JSON.stringify(result)).toMatchObject({
    success: false,
    code,
  });
  const failure = result as ErrorBody;
  if (typeof error === "string") expect(failure.error).toBe(error);
  else if (error) expect(failure.error).toMatch(error);
  return failure;
}
