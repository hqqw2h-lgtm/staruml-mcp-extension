import { ExtensionHttpServer } from "./http-server.js";
import { errorMessage } from "./errors.js";
import { routes } from "./routes.js";
import { EXTENSION_NAME, EXTENSION_VERSION } from "./version.js";

/** One above StarUML's built-in API server (58321) so both can run side by side. */
export const DEFAULT_PORT = 58322;

const LOG_PREFIX = `[${EXTENSION_NAME}]`;

let server: ExtensionHttpServer | null = null;

/**
 * Entry point called by StarUML's extension loader with no arguments
 * (docs: developing-extensions/getting-started). A failure to bind is logged
 * rather than thrown so the rest of StarUML keeps loading.
 */
export async function init(port: number = DEFAULT_PORT): Promise<void> {
  const candidate = new ExtensionHttpServer({
    port,
    handlers: routes,
    onLog: (level, msg) =>
      level === "error" ? console.error(msg) : console.log(msg),
  });
  try {
    await candidate.start();
  } catch (err) {
    console.error(
      `${LOG_PREFIX} failed to listen on port ${port}: ${errorMessage(err)}`,
    );
    return;
  }
  server = candidate;
  app.commands.register(
    "mcp-ext:server-info",
    showServerInfo,
    "MCP Extension: Server Info",
  );
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
