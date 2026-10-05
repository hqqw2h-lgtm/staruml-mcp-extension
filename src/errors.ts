import type { HandlerResult } from "./http-server.js";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function failure(err: unknown): HandlerResult {
  return { success: false, error: errorMessage(err) };
}
