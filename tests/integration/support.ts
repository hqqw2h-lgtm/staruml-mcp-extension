import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "vitest";

/**
 * Live tests drive a real StarUML 7.1.1 with this build installed
 * (`npm run build && npm run install:local`, then restart StarUML). They
 * replace the open project, so run them only against a disposable session.
 */
export const LIVE = process.env.STARUML_LIVE === "1";
export const BASE_URL = process.env.STARUML_EXT_URL ?? "http://localhost:58322";

export const describeLive = describe.skipIf(!LIVE);

export interface Envelope<T = Record<string, unknown>> {
  status: number;
  success: boolean;
  data: T;
  error?: string;
}

export async function call<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<Envelope<T>> {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success: boolean;
    data: T;
    error?: string;
  };
  return { status: res.status, ...json };
}

/** Directory for .mdj files written by StarUML; override with STARUML_LIVE_DIR. */
export function liveDir(): string {
  return (
    process.env.STARUML_LIVE_DIR ?? mkdtempSync(join(tmpdir(), "staruml-live-"))
  );
}
