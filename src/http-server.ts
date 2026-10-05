import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { errorMessage } from "./errors.js";
import { EXTENSION_NAME, EXTENSION_VERSION } from "./version.js";

export type HandlerResult =
  { success: true; data?: unknown } | { success: false; error: string };

export type Handler = (
  body: Record<string, unknown>,
) => Promise<HandlerResult> | HandlerResult;

export type LogLevel = "info" | "error";
export type Logger = (level: LogLevel, message: string) => void;

export interface HttpServerOptions {
  port: number;
  host?: string;
  handlers: Readonly<Record<string, Handler>>;
  onLog?: Logger;
}

type RequestListener = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

/**
 * Handlers and the JSON serialisation of their results run on the Electron
 * renderer thread that also paints StarUML, so that span is reported as a
 * Server-Timing metric (https://www.w3.org/TR/server-timing/) for the load test
 * to hold against a budget. For an async handler it includes time spent awaiting.
 */
export function createRequestListener(
  handlers: Readonly<Record<string, Handler>>,
  log: Logger,
): RequestListener {
  return async (req, res) => {
    // IncomingMessage.url is always set on requests produced by http.Server.
    const path = req.url!.split("?")[0]!;

    if (req.method === "GET" && path === "/") {
      sendJson(res, 200, {
        name: EXTENSION_NAME,
        version: EXTENSION_VERSION,
        endpoints: Object.keys(handlers).sort(),
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        success: false,
        error: `Method ${req.method} not allowed`,
      });
      return;
    }

    const handler = Object.hasOwn(handlers, path) ? handlers[path] : undefined;
    if (!handler) {
      sendJson(res, 404, { success: false, error: `No handler for ${path}` });
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      sendJson(res, 400, {
        success: false,
        error: `Failed to read body: ${errorMessage(err)}`,
      });
      return;
    }

    let body: unknown;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      sendJson(res, 400, {
        success: false,
        error: `Invalid JSON: ${errorMessage(err)}`,
      });
      return;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      sendJson(res, 400, {
        success: false,
        error: "Request body must be a JSON object",
      });
      return;
    }

    const started = performance.now();
    try {
      const result = await handler(body as Record<string, unknown>);
      sendJson(res, result.success ? 200 : 400, result, started);
    } catch (err) {
      log(
        "error",
        `[${EXTENSION_NAME}] handler ${path} threw: ${stackOf(err)}`,
      );
      sendJson(res, 500, { success: false, error: errorMessage(err) }, started);
    }
  };
}

export class ExtensionHttpServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly listener: RequestListener;
  private readonly log: Logger;

  constructor(options: HttpServerOptions) {
    this.port = options.port;
    // Loopback only: the endpoints mutate the open model and have no authentication yet.
    this.host = options.host ?? "127.0.0.1";
    this.log = options.onLog ?? (() => {});
    this.listener = createRequestListener(options.handlers, this.log);
  }

  /** Bound port, which differs from the configured one when that was 0. */
  get address(): AddressInfo | null {
    return this.server ? (this.server.address() as AddressInfo) : null;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(
        (req, res) => void this.listener(req, res),
      );
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        this.server = server;
        const { port } = server.address() as AddressInfo;
        this.log(
          "info",
          `[${EXTENSION_NAME}] listening on http://${this.host}:${port}`,
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    this.server = null;
    return new Promise((resolve) => server.close(() => resolve()));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  handlerStarted?: number,
): void {
  const text = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  };
  if (handlerStarted !== undefined) {
    const ms = performance.now() - handlerStarted;
    headers["Server-Timing"] = `handler;dur=${ms.toFixed(3)}`;
  }
  res.writeHead(status, headers);
  res.end(text);
}

function stackOf(err: unknown): string {
  return err instanceof Error ? String(err.stack) : String(err);
}
