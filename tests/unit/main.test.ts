import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import menu from "../../menus/menu.json";
import preference from "../../preferences/preference.json";
import { ExtensionHttpServer } from "../../src/http-server.js";
import {
  DEFAULT_PORT,
  init,
  PREF_ENABLED,
  PREF_PORT,
  showServerInfo,
  shutdown,
} from "../../src/main.js";
import { DEFAULTS, PREF } from "../../src/settings.js";
import { installMockApp, type MockApp } from "../mock/staruml.js";

let app: MockApp;

beforeEach(() => {
  ({ app } = installMockApp());
  // StarUML registers preferences/*.json before calling init().
  app.preferences.register(preference);
  app.preferences.set(PREF_PORT, 0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await shutdown();
  vi.restoreAllMocks();
});

function boundPort(): string {
  app.commands.execute("mcp-ext:server-info");
  return /127\.0\.0\.1:(\d+)/.exec(app.dialogs.shown.at(-1)!.message)![1]!;
}

describe("init", () => {
  it("serves the routes and registers the server-info command", async () => {
    await init();
    expect(app.commands.commandNames["mcp-ext:server-info"]).toBe(
      "MCP Extension: Server Info",
    );
    expect(app.dialogs.shown).toEqual([]);

    const port = boundPort();
    expect(app.dialogs.shown[0]!.message).toContain(
      "/create_element_with_view",
    );
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(((await res.json()) as { endpoints: string[] }).endpoints).toContain(
      "/debug",
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("listening on"),
    );
  });

  it("routes server errors to console.error", async () => {
    await init();
    const port = boundPort();
    Object.defineProperty(app.commands, "commands", {
      get() {
        throw new Error("registry gone");
      },
    });
    await fetch(`http://127.0.0.1:${port}/get_all_commands`, {
      method: "POST",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("/get_all_commands threw"),
    );
  });

  it("enforces the body size preference", async () => {
    app.preferences.set(PREF.maxBodyKiB, 1);
    await init();
    const res = await fetch(
      `http://127.0.0.1:${boundPort()}/get_all_commands`,
      { method: "POST", body: JSON.stringify({ pad: "x".repeat(1100) }) },
    );
    expect(res.status).toBe(413);
  });

  it("stays off when disabled, but keeps the command", async () => {
    app.preferences.set(PREF_ENABLED, false);
    await init();
    expect(console.log).toHaveBeenCalledWith(
      `[staruml-mcp-extension] HTTP server disabled by preference ${PREF_ENABLED}`,
    );
    app.commands.execute("mcp-ext:server-info");
    expect(app.dialogs.shown[0]!.message).toContain(
      "HTTP server is not running",
    );
  });

  it.each(["58322", -1, 65536, 1.5, null])(
    "refuses the port preference %j",
    async (value) => {
      app.preferences.set(PREF_PORT, value);
      await init();
      expect(console.error).toHaveBeenCalledWith(
        `[staruml-mcp-extension] ${PREF_PORT} must be an integer in 0..65535, got ${String(value)}`,
      );
    },
  );

  it.each([
    ["the schema default", () => app.preferences.stored.delete(PREF_PORT)],
    [
      "the built-in default when no schema is registered",
      () => {
        app.preferences.stored.clear();
        app.preferences.itemMap = {};
      },
    ],
  ])(
    "listens on %s, and logs when the port is taken",
    async (_label, setup) => {
      setup();
      vi.spyOn(ExtensionHttpServer.prototype, "start").mockRejectedValue(
        new Error("listen EADDRINUSE"),
      );
      await init();
      expect(console.error).toHaveBeenCalledWith(
        `[staruml-mcp-extension] failed to listen on port ${DEFAULT_PORT}: listen EADDRINUSE`,
      );
    },
  );
});

describe("package files", () => {
  it("declares preference defaults that match the code", () => {
    expect(app.preferences.get(PREF_ENABLED)).toBe(true);
    app.preferences.stored.clear();
    expect(app.preferences.get(PREF_PORT)).toBe(DEFAULT_PORT);
    expect(app.preferences.get(PREF.maxBodyKiB)).toBe(DEFAULTS.maxBodyKiB);
    expect(app.preferences.get(PREF.maxBatchOps)).toBe(DEFAULTS.maxBatchOps);
  });

  it("only points menu items at commands init() registers", async () => {
    app.preferences.set(PREF_ENABLED, false);
    await init();
    const commands: string[] = [];
    const walk = (items: { command?: string; submenu?: unknown[] }[]): void => {
      for (const item of items) {
        if (item.command) commands.push(item.command);
        if (item.submenu) walk(item.submenu as typeof items);
      }
    };
    walk(menu.menu);
    expect(commands.length).toBeGreaterThan(0);
    for (const id of commands)
      expect(app.commands.commands).toHaveProperty([id]);
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
