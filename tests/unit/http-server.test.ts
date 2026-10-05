import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestListener,
  ExtensionHttpServer,
  type Handler,
} from "../../src/http-server.js";
import { EXTENSION_VERSION } from "../../src/version.js";

const handlers: Record<string, Handler> = {
  "/ok": (body) => ({ success: true, data: body }),
  "/fail": () => ({ success: false, error: "nope" }),
  "/async": async () => ({ success: true }),
  "/throw": () => {
    throw new Error("kaboom");
  },
  "/throw-string": () => {
    throw "plain";
  },
};

let server: ExtensionHttpServer | null = null;
let base = "";
const log = vi.fn();

async function start(): Promise<void> {
  server = new ExtensionHttpServer({ port: 0, handlers, onLog: log });
  await server.start();
  base = `http://127.0.0.1:${server.address!.port}`;
}

afterEach(async () => {
  await server?.stop();
  server = null;
  log.mockReset();
});

function post(path: string, body?: string): Promise<Response> {
  return fetch(base + path, { method: "POST", body });
}

describe("ExtensionHttpServer", () => {
  it("lists endpoints and the build version on GET /", async () => {
    await start();
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "staruml-mcp-extension",
      version: EXTENSION_VERSION,
      endpoints: ["/async", "/fail", "/ok", "/throw", "/throw-string"],
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("listening on"),
    );
  });

  it("rejects other methods", async () => {
    await start();
    const res = await fetch(base + "/ok");
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      success: false,
      error: "Method GET not allowed",
    });
  });

  it("returns 404 for unknown paths, including inherited object keys", async () => {
    await start();
    for (const path of ["/missing", "/constructor"]) {
      const res = await post(path, "{}");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        success: false,
        error: `No handler for ${path}`,
      });
    }
  });

  it("routes by path, ignoring the query string, and echoes the body", async () => {
    await start();
    const res = await post("/ok?x=1", JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(
      /^handler;dur=\d+\.\d{3}$/,
    );
    expect(await res.json()).toEqual({ success: true, data: { a: 1 } });
  });

  it("treats an empty body as {}", async () => {
    await start();
    expect(await (await post("/ok")).json()).toEqual({
      success: true,
      data: {},
    });
  });

  it("awaits asynchronous handlers", async () => {
    await start();
    expect((await post("/async")).status).toBe(200);
  });

  it.each(["{", "[1]", "null", "3"])(
    "rejects the non-object body %s",
    async (body) => {
      await start();
      const res = await post("/ok", body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toMatch(
        /^(Invalid JSON: |Request body must be a JSON object)/,
      );
    },
  );

  it("maps a handler failure to 400", async () => {
    await start();
    const res = await post("/fail", "{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "nope" });
  });

  it.each([
    ["/throw", "kaboom", "Error: kaboom"],
    ["/throw-string", "plain", "plain"],
  ])(
    "maps an exception from %s to 500 and logs it",
    async (path, message, logged) => {
      await start();
      const res = await post(path, "{}");
      expect(res.status).toBe(500);
      expect(res.headers.get("server-timing")).toMatch(/^handler;dur=/);
      expect(await res.json()).toEqual({ success: false, error: message });
      expect(log).toHaveBeenCalledWith(
        "error",
        expect.stringContaining(logged),
      );
    },
  );

  it("fails to start when the port is taken, and stop() is idempotent", async () => {
    await start();
    const second = new ExtensionHttpServer({
      port: server!.address!.port,
      handlers,
    });
    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
    expect(second.address).toBeNull();
    await second.stop();
  });

  it("binds to loopback by default and accepts another host", async () => {
    await start();
    expect(server!.address!.address).toBe("127.0.0.1");
    const other = new ExtensionHttpServer({
      port: 0,
      host: "localhost",
      handlers,
    });
    await other.start();
    await other.stop();
  });
});

describe("createRequestListener", () => {
  it("answers 400 when the request body stream errors", async () => {
    const listener = createRequestListener(handlers, () => {});
    const req = Object.assign(new PassThrough(), {
      method: "POST",
      url: "/ok",
    });
    const res = { writeHead: vi.fn(), end: vi.fn() };
    const done = listener(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    req.destroy(new Error("socket hang up"));
    await done;
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({
      success: false,
      error: "Failed to read body: socket hang up",
    });
  });
});
