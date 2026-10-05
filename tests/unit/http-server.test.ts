import http from "node:http";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestListener,
  ExtensionHttpServer,
  type Handler,
  type RequestPolicy,
  UNLIMITED,
} from "../../src/http-server.js";
import { EXTENSION_VERSION } from "../../src/version.js";

const handlers: Record<string, Handler> = {
  "/ok": (body) => ({ success: true, data: body }),
  "/fail": () => ({ success: false, code: "NOT_FOUND", error: "nope" }),
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

async function start(policy?: Partial<RequestPolicy>): Promise<void> {
  server = new ExtensionHttpServer({
    port: 0,
    handlers,
    onLog: log,
    ...(policy && { policy: { ...UNLIMITED, ...policy } }),
  });
  await server.start();
  base = `http://127.0.0.1:${server.address!.port}`;
}

afterEach(async () => {
  await server?.stop();
  server = null;
  log.mockReset();
});

function post(
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(base + path, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  });
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
      code: "METHOD_NOT_ALLOWED",
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
        code: "UNKNOWN_ENDPOINT",
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
      const json = (await res.json()) as { code: string; error: string };
      expect(json.code).toBe("INVALID_JSON");
      expect(json.error).toMatch(
        /^(Invalid JSON: |Request body must be a JSON object)/,
      );
    },
  );

  it("answers a handler failure with the status of its code", async () => {
    await start();
    const res = await post("/fail", "{}");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      code: "NOT_FOUND",
      error: "nope",
    });
  });

  it.each([
    ["/throw", "kaboom", "Error: kaboom"],
    ["/throw-string", "plain", "plain"],
  ])(
    "maps an exception from %s to 500 without its stack, and logs the stack",
    async (path, message, logged) => {
      await start();
      const res = await post(path, "{}");
      expect(res.status).toBe(500);
      expect(res.headers.get("server-timing")).toMatch(/^handler;dur=/);
      expect(await res.json()).toEqual({
        success: false,
        code: "INTERNAL",
        error: message,
      });
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

describe("body size limit", () => {
  it("accepts a body at the limit", async () => {
    await start({ maxBodyBytes: () => 9 });
    const res = await post("/ok", '{"a":"b"}');
    expect(res.status).toBe(200);
  });

  it("refuses a declared length over the limit before reading it", async () => {
    await start({ maxBodyBytes: () => 8 });
    const res = await post("/ok", '{"a":"bc"}');
    expect(res.status).toBe(413);
    expect(res.headers.get("connection")).toBe("close");
    expect(await res.json()).toEqual({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      error:
        "Request body exceeds 8 bytes (preference mcp-ext.limits.maxBodyKiB)",
    });
  });

  it("counts the bytes of a chunked body", async () => {
    await start({ maxBodyBytes: () => 8 });
    const { port } = server!.address!;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          port,
          path: "/ok",
          method: "POST",
          host: "127.0.0.1",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.write('{"a":');
      req.write('"0123456789"}');
      req.end();
    });
    expect(status).toBe(413);
  });
});

describe("access rules", () => {
  it("refuses every Origin by default", async () => {
    await start();
    const res = await post("/ok", "{}", { Origin: "http://localhost" });
    expect(res.status).toBe(403);
  });

  it("refuses a browser Origin unless it is allowed", async () => {
    await start({ allowedOrigins: () => ["http://localhost:3000"] });
    const refused = await post("/ok", "{}", { Origin: "https://evil.test" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      success: false,
      code: "FORBIDDEN_ORIGIN",
      error: "Origin https://evil.test is not allowed",
    });
    const allowed = await post("/ok", "{}", {
      Origin: "http://localhost:3000",
    });
    expect(allowed.status).toBe(200);
    const listing = await fetch(base + "/", {
      headers: { Origin: "null" },
    });
    expect(listing.status).toBe(403);
  });

  it("requires the bearer token on every path when one is set", async () => {
    await start({ token: () => "s3cret" });
    const none = await post("/ok", "{}");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="staruml"');
    expect(await none.json()).toMatchObject({ code: "UNAUTHORIZED" });
    for (const authorization of [
      "Bearer wrong",
      "Bearer s3cret-and-more",
      "Basic s3cret",
    ]) {
      const res = await post("/ok", "{}", { Authorization: authorization });
      expect(res.status, authorization).toBe(401);
    }
    expect((await fetch(base + "/")).status).toBe(401);
    expect(
      (await post("/ok", "{}", { Authorization: "bearer s3cret" })).status,
    ).toBe(200);
    const listing = await fetch(base + "/", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(listing.status).toBe(200);
  });

  it.each([
    undefined,
    "text/plain",
    "application/jsonp",
    "multipart/form-data",
  ])("answers 415 for Content-Type %s", async (type) => {
    await start();
    const res = await fetch(base + "/ok", {
      method: "POST",
      // fetch labels a string body text/plain, so the header-less case sends none.
      ...(type && { body: "{}", headers: { "Content-Type": type } }),
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      success: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
      error: "Content-Type must be application/json",
    });
  });

  it("accepts application/json with parameters, in any case", async () => {
    await start();
    const res = await post("/ok", "{}", {
      "Content-Type": "Application/JSON; charset=utf-8",
    });
    expect(res.status).toBe(200);
  });

  it("answers 429 with Retry-After when the policy throttles a path", async () => {
    const throttle = vi.fn((path: string) => (path === "/fail" ? 7 : 0));
    await start({ throttle });
    const res = await post("/fail", "{}");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many calls to /fail",
    });
    expect((await post("/ok", "{}")).status).toBe(200);
  });

  it("answers 504 when a handler outlasts the timeout", async () => {
    let finish: () => void = () => {};
    const slow: Record<string, Handler> = {
      "/slow": () =>
        new Promise((resolve) => {
          finish = () => resolve({ success: true });
        }),
      "/fast": () => ({ success: true }),
    };
    server = new ExtensionHttpServer({
      port: 0,
      handlers: slow,
      policy: { ...UNLIMITED, timeoutMs: () => 30 },
    });
    await server.start();
    base = `http://127.0.0.1:${server.address!.port}`;
    const res = await post("/slow", "{}");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      success: false,
      code: "TIMEOUT",
      error: "/slow did not answer within 30 ms; it may still complete",
    });
    finish();
    expect((await post("/fast", "{}")).status).toBe(200);
  });

  it("logs every finished request at debug level", async () => {
    await start();
    await post("/ok", "{}");
    expect(log).toHaveBeenCalledWith(
      "debug",
      expect.stringMatching(
        /^\[staruml-mcp-extension\] POST \/ok 200 [\d.]+ ms$/,
      ),
    );
  });
});

describe("createRequestListener", () => {
  it("answers 400 when the request body stream errors", async () => {
    const listener = createRequestListener(handlers, () => {});
    const req = Object.assign(new PassThrough(), {
      method: "POST",
      url: "/ok",
      headers: { "content-type": "application/json" },
    });
    const res = { writeHead: vi.fn(), end: vi.fn(), on: vi.fn() };
    const done = listener(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    req.destroy(new Error("socket hang up"));
    await done;
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toEqual({
      success: false,
      code: "BODY_READ_FAILED",
      error: "Failed to read body: socket hang up",
    });
  });
});
