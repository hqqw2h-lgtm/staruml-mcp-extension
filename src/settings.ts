/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

import type { LogLevel, RequestPolicy } from "./http-server.js";

/**
 * Keys declared in preferences/preference.json, which StarUML registers
 * before init() (docs: developing-extensions/defining-preferences). All but
 * enabled and port are read on every request, so a change in
 * File > Preferences applies to the next request without a restart.
 */
export const PREF = {
  enabled: "mcp-ext.server.enabled",
  port: "mcp-ext.server.port",
  logLevel: "mcp-ext.server.logLevel",
  token: "mcp-ext.token",
  allowedOrigins: "mcp-ext.security.allowedOrigins",
  maxBodyKiB: "mcp-ext.limits.maxBodyKiB",
  maxBatchOps: "mcp-ext.limits.maxBatchOps",
  timeoutSeconds: "mcp-ext.limits.timeoutSeconds",
  commandsPerMinute: "mcp-ext.limits.commandsPerMinute",
} as const;

/** Defaults repeated from preference.json for a StarUML that has not registered it. */
export const DEFAULTS = {
  logLevel: "info" as LogLevel,
  /** Large enough for a batch of several hundred element creations. */
  maxBodyKiB: 4096,
  maxBatchOps: 500,
  /** Above the 30 s export_pdf waits for pdfkit, so its own error wins. */
  timeoutSeconds: 60,
  commandsPerMinute: 60,
} as const;

/** Endpoints that are rate limited: commands can do anything the UI can. */
export const THROTTLED = [
  "/execute_command",
  "/generate_code",
  "/reverse_code",
];

/**
 * A positive integer preference. The preference dialog stores whatever is
 * typed into a number field, so anything else falls back to the default
 * rather than disabling the limit.
 */
export function positiveInt(key: string, fallback: number): number {
  const value = app.preferences.get(key, fallback);
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : fallback;
}

function text(key: string): string {
  const value = app.preferences.get(key, "");
  return typeof value === "string" ? value.trim() : "";
}

export function maxBodyBytes(): number {
  return positiveInt(PREF.maxBodyKiB, DEFAULTS.maxBodyKiB) * 1024;
}

export function maxBatchOps(): number {
  return positiveInt(PREF.maxBatchOps, DEFAULTS.maxBatchOps);
}

export function token(): string {
  return text(PREF.token);
}

/** Comma- or space-separated origins, e.g. "http://localhost:3000". */
export function allowedOrigins(): string[] {
  return text(PREF.allowedOrigins)
    .split(/[\s,]+/)
    .filter((o) => o.length > 0);
}

export function timeoutMs(): number {
  return positiveInt(PREF.timeoutSeconds, DEFAULTS.timeoutSeconds) * 1000;
}

const LEVELS: readonly LogLevel[] = ["error", "info", "debug"];

export function logLevel(): LogLevel {
  const value = app.preferences.get(PREF.logLevel, DEFAULTS.logLevel);
  return LEVELS.includes(value as LogLevel)
    ? (value as LogLevel)
    : DEFAULTS.logLevel;
}

/** Whether a message at `level` passes the log level preference. */
export function logs(level: LogLevel): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(logLevel());
}

const MINUTE_MS = 60_000;

/**
 * A sliding one-minute window per path, shared by all clients: there is one
 * StarUML window to protect, whoever calls.
 */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly limit: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds to wait, or 0 after recording the call. */
  take(path: string): number {
    const now = this.now();
    const recent = (this.calls.get(path) ?? []).filter(
      (t) => t > now - MINUTE_MS,
    );
    if (recent.length >= this.limit()) {
      this.calls.set(path, recent);
      return Math.ceil((recent[0]! + MINUTE_MS - now) / 1000);
    }
    recent.push(now);
    this.calls.set(path, recent);
    return 0;
  }
}

export function preferencePolicy(
  limiter = new RateLimiter(() =>
    positiveInt(PREF.commandsPerMinute, DEFAULTS.commandsPerMinute),
  ),
): RequestPolicy {
  return {
    maxBodyBytes,
    token,
    allowedOrigins,
    timeoutMs,
    throttle: (path) => (THROTTLED.includes(path) ? limiter.take(path) : 0),
  };
}
