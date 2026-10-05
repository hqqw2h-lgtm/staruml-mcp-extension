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

import { ExtensionHttpServer } from "./http-server.js";
import { errorMessage } from "./errors.js";
import { routes } from "./routes.js";
import { maxBodyBytes, PREF } from "./settings.js";
import { EXTENSION_NAME, EXTENSION_VERSION } from "./version.js";

/** One above StarUML's built-in API server (58321) so both can run side by side. */
export const DEFAULT_PORT = 58322;

export const PREF_ENABLED = PREF.enabled;
export const PREF_PORT = PREF.port;

const LOG_PREFIX = `[${EXTENSION_NAME}]`;

let server: ExtensionHttpServer | null = null;

/**
 * Called by StarUML's extension loader, which neither passes arguments nor
 * awaits the result (extensibility/extension-loader.js in 7.1.1), so every
 * failure is logged here instead of rejecting.
 */
export async function init(): Promise<void> {
  // Registered first so Tools > MCP Extension works even when the server is off.
  app.commands.register(
    "mcp-ext:server-info",
    showServerInfo,
    "MCP Extension: Server Info",
  );

  if (app.preferences.get(PREF_ENABLED, true) !== true) {
    console.log(
      `${LOG_PREFIX} HTTP server disabled by preference ${PREF_ENABLED}`,
    );
    return;
  }
  const port = app.preferences.get(PREF_PORT, DEFAULT_PORT);
  // 0 asks the OS for a free port; Server Info shows which one was bound.
  if (
    !Number.isInteger(port) ||
    (port as number) < 0 ||
    (port as number) > 65535
  ) {
    console.error(
      `${LOG_PREFIX} ${PREF_PORT} must be an integer in 0..65535, got ${String(port)}`,
    );
    return;
  }

  const candidate = new ExtensionHttpServer({
    port: port as number,
    handlers: routes,
    policy: { maxBodyBytes },
    onLog: (level, msg) =>
      level === "error" ? console.error(msg) : console.log(msg),
  });
  try {
    await candidate.start();
  } catch (err) {
    console.error(
      `${LOG_PREFIX} failed to listen on port ${String(port)}: ${errorMessage(err)}`,
    );
    return;
  }
  server = candidate;
}

/** Not called by StarUML; lets tests and a future reload command release the port. */
export async function shutdown(): Promise<void> {
  const running = server;
  server = null;
  await running?.stop();
}

export function showServerInfo(): void {
  const address = server?.address;
  const status = address
    ? `Listening on http://${address.address}:${address.port}`
    : "HTTP server is not running";
  app.dialogs.showInfoDialog(
    `${EXTENSION_NAME} v${EXTENSION_VERSION}\n\n${status}\n\nEndpoints:\n  ${Object.keys(routes).sort().join("\n  ")}`,
  );
}
