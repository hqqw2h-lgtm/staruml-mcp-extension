import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import menu from "../../menus/menu.json";
import preference from "../../preferences/preference.json";
import { ExtensionHttpServer } from "../../src/http-server.js";
import {
  DEFAULT_PORT,
  init,
  log,
  PREF_ENABLED,
  PREF_PORT,
  setToken,
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
      headers: { "Content-Type": "application/json" },
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
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pad: "x".repeat(1100) }),
      },
    );
    expect(res.status).toBe(413);
  });

  it("applies the access preferences to requests", async () => {
    app.preferences.set(PREF.token, " tok ");
    app.preferences.set(PREF.commandsPerMinute, 1);
    await init();
    const url = `http://127.0.0.1:${boundPort()}/execute_command`;
    const call = (authorization: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({ id: "nope" }),
      });
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("Bearer tok")).status).toBe(404);
    expect((await call("Bearer tok")).status).toBe(429);
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
    expect(app.preferences.get(PREF.logLevel)).toBe(DEFAULTS.logLevel);
    expect(app.preferences.get(PREF.timeoutSeconds)).toBe(
      DEFAULTS.timeoutSeconds,
    );
    expect(app.preferences.get(PREF.commandsPerMinute)).toBe(
      DEFAULTS.commandsPerMinute,
    );
    expect(app.preferences.get(PREF.token)).toBe("");
    expect(app.preferences.get(PREF.allowedOrigins)).toBe("");
  });

  it("offers every log level the code knows in the dropdown", () => {
    const item = preference.schema[PREF.logLevel] as {
      options: { value: string }[];
    };
    expect(item.options.map((o) => o.value)).toEqual([
      "error",
      "info",
      "debug",
    ]);
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
  it("says when the server is not running, and that no token is set", () => {
    showServerInfo();
    const { message } = app.dialogs.shown[0]!;
    expect(message).toContain("HTTP server is not running");
    expect(message).toContain(
      "Access token: none; any local process can call the endpoints",
    );
    expect(message).toContain("Allowed browser origins: none");
  });

  it("shows the access settings", () => {
    app.preferences.set(PREF.token, "x");
    app.preferences.set(PREF.allowedOrigins, "http://a, http://b");
    showServerInfo();
    const { message } = app.dialogs.shown[0]!;
    expect(message).toContain("Access token: required");
    expect(message).toContain("Allowed browser origins: http://a, http://b");
  });
});

describe("mcp-ext:set-token", () => {
  it("generates and shows a token when run from the menu", () => {
    expect(setToken()).toBe("set");
    const stored = app.preferences.get(PREF.token) as string;
    expect(stored).toMatch(/^[\w-]{32}$/);
    expect(app.dialogs.shown[0]!.message).toContain(`Bearer ${stored}`);
  });

  it("stores a given token, and clears it with an empty one, silently", () => {
    expect(setToken(" abc ")).toBe("set");
    expect(app.preferences.get(PREF.token)).toBe("abc");
    expect(setToken("")).toBe("cleared");
    expect(app.preferences.get(PREF.token)).toBe("");
    expect(app.dialogs.shown).toEqual([]);
  });

  it("generates a token for a non-string argument", () => {
    setToken(42);
    expect(app.preferences.get(PREF.token)).toMatch(/^[\w-]{32}$/);
  });
});

describe("log", () => {
  it("filters by the log level preference", () => {
    app.preferences.set(PREF.logLevel, "error");
    log("info", "quiet");
    log("error", "loud");
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("loud");
    app.preferences.set(PREF.logLevel, "debug");
    log("debug", "chatty");
    expect(console.log).toHaveBeenCalledWith("chatty");
  });
});

describe("shutdown", () => {
  it("is a no-op when nothing is running", async () => {
    await expect(shutdown()).resolves.toBeUndefined();
  });
});
