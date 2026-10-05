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

/**
 * Keys declared in preferences/preference.json, which StarUML registers
 * before init() (docs: developing-extensions/defining-preferences). Limits
 * are read on every request, so a change in File > Preferences applies to
 * the next request without a restart.
 */
export const PREF = {
  enabled: "mcp-ext.server.enabled",
  port: "mcp-ext.server.port",
  maxBodyKiB: "mcp-ext.limits.maxBodyKiB",
  maxBatchOps: "mcp-ext.limits.maxBatchOps",
} as const;

/** Defaults repeated from preference.json for a StarUML that has not registered it. */
export const DEFAULTS = {
  /** Large enough for a batch of several hundred element creations. */
  maxBodyKiB: 4096,
  maxBatchOps: 500,
} as const;

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

export function maxBodyBytes(): number {
  return positiveInt(PREF.maxBodyKiB, DEFAULTS.maxBodyKiB) * 1024;
}

export function maxBatchOps(): number {
  return positiveInt(PREF.maxBatchOps, DEFAULTS.maxBatchOps);
}
