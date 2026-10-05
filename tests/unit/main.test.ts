import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionHttpServer } from "../../src/http-server.js";
import {
  DEFAULT_PORT,
  init,
  showServerInfo,
  shutdown,
} from "../../src/main.js";
import { installMockApp, type MockApp } from "../mock/staruml.js";

let app: MockApp;

beforeEach(() => {
  ({ app } = installMockApp());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await shutdown();
  vi.restoreAllMocks();
});

describe("init", () => {
  it("serves the routes and registers the server-info command", async () => {
    await init(0);
    expect(app.commands.commandNames["mcp-ext:server-info"]).toBe(
      "MCP Extension: Server Info",
    );

    app.commands.execute("mcp-ext:server-info");
    const message = app.dialogs.shown[0]!.message;
    const port = /127\.0\.0\.1:(\d+)/.exec(message)![1];
    expect(message).toContain("/create_element_with_view");

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(((await res.json()) as { endpoints: string[] }).endpoints).toContain(
      "/debug",
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("listening on"),
    );
  });

  it("routes server errors to console.error", async () => {
    await init(0);
    const port = /:(\d+)/.exec(
      vi.mocked(console.log).mock.calls[0]![0] as string,
    )![1];
    delete (globalThis as { app?: unknown }).app;
    await fetch(`http://127.0.0.1:${port}/get_all_commands`, {
      method: "POST",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("/get_all_commands threw"),
    );
  });

  it("logs and gives up when the port is taken, leaving StarUML loading", async () => {
    vi.spyOn(ExtensionHttpServer.prototype, "start").mockRejectedValue(
      new Error("listen EADDRINUSE"),
    );
    await init();
    expect(console.error).toHaveBeenCalledWith(
      `[staruml-mcp-extension] failed to listen on port ${DEFAULT_PORT}: listen EADDRINUSE`,
    );
    expect(app.commands.commands["mcp-ext:server-info"]).toBeUndefined();
  });
});

describe("showServerInfo", () => {
  it("says when the server is not running", () => {
    showServerInfo();
    expect(app.dialogs.shown[0]!.message).toContain(
      "HTTP server is not running",
    );
  });
});

describe("shutdown", () => {
  it("is a no-op when nothing is running", async () => {
    await expect(shutdown()).resolves.toBeUndefined();
  });
});
