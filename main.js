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
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  DEFAULT_PORT: () => DEFAULT_PORT,
  PREF_ENABLED: () => PREF_ENABLED,
  PREF_PORT: () => PREF_PORT,
  init: () => init,
  log: () => log,
  setToken: () => setToken,
  showServerInfo: () => showServerInfo,
  shutdown: () => shutdown
});
module.exports = __toCommonJS(main_exports);

// src/http-server.ts
var import_node_crypto = require("node:crypto");
var import_node_http = __toESM(require("node:http"));
var import_node_perf_hooks = require("node:perf_hooks");

// src/errors.ts
var ERROR_STATUS = {
  /** The body does not match the endpoint's request schema. */
  INVALID_ARGUMENT: 400,
  INVALID_JSON: 400,
  BODY_READ_FAILED: 400,
  /** A type name that is not in the metamodel or has no factory function. */
  UNKNOWN_TYPE: 400,
  /** A bearer token is configured and the request lacks it or has another. */
  UNAUTHORIZED: 401,
  /** The request carries an Origin header not in mcp-ext.security.allowedOrigins. */
  FORBIDDEN_ORIGIN: 403,
  /** An id that names no element, or an element of the wrong kind. */
  NOT_FOUND: 404,
  UNKNOWN_ENDPOINT: 404,
  METHOD_NOT_ALLOWED: 405,
  /** Body over mcp-ext.limits.maxBodyKiB, or a batch over mcp-ext.limits.maxBatchOps. */
  PAYLOAD_TOO_LARGE: 413,
  /** A POST without Content-Type: application/json. */
  UNSUPPORTED_MEDIA_TYPE: 415,
  /** The operation needs an open project, or a saved one. */
  NO_PROJECT: 409,
  /** StarUML refused the operation, e.g. a factory precondition failed. */
  STARUML_ERROR: 422,
  /**
   * The command would open a modal or native dialog and wait for someone at
   * StarUML; it was refused, or stopped where the dialog would have opened.
   */
  DIALOG_REQUIRED: 422,
  /** Over mcp-ext.limits.commandsPerMinute; Retry-After says when to retry. */
  RATE_LIMITED: 429,
  /** A defect in this extension; details are in StarUML's developer console. */
  INTERNAL: 500,
  /** No answer within mcp-ext.limits.timeoutSeconds; the call may still complete. */
  TIMEOUT: 504
};
var ERROR_CODES = Object.keys(ERROR_STATUS);
var ApiError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
  code;
  details;
  toBody() {
    return {
      success: false,
      code: this.code,
      error: this.message,
      ...this.details !== void 0 && { details: this.details }
    };
  }
};
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function inStarUML(call) {
  try {
    return call();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("STARUML_ERROR", errorMessage(err));
  }
}

// src/version.ts
var EXTENSION_NAME = "staruml-mcp-extension";
var EXTENSION_VERSION = "0.3.0";

// src/http-server.ts
var UNLIMITED = {
  maxBodyBytes: () => Number.POSITIVE_INFINITY,
  token: () => "",
  allowedOrigins: () => [],
  timeoutMs: () => Number.POSITIVE_INFINITY,
  throttle: () => 0
};
var JSON_TYPE = /^application\/json\s*(;|$)/i;
function createRequestListener(handlers, log2, policy = UNLIMITED) {
  return async (req, res) => {
    const path = req.url.split("?")[0];
    const received = import_node_perf_hooks.performance.now();
    res.on(
      "finish",
      () => log2(
        "debug",
        `[${EXTENSION_NAME}] ${req.method} ${path} ${res.statusCode} ${(import_node_perf_hooks.performance.now() - received).toFixed(1)} ms`
      )
    );
    const origin = req.headers.origin;
    if (origin !== void 0 && !policy.allowedOrigins().includes(origin)) {
      sendError(res, "FORBIDDEN_ORIGIN", `Origin ${origin} is not allowed`);
      return;
    }
    const token2 = policy.token();
    if (token2 && !bearerMatches(req.headers.authorization, token2)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="staruml"');
      sendError(res, "UNAUTHORIZED", "Missing or wrong bearer token");
      return;
    }
    if (req.method === "GET" && path === "/") {
      sendJson(res, 200, {
        name: EXTENSION_NAME,
        version: EXTENSION_VERSION,
        endpoints: Object.keys(handlers).sort()
      });
      return;
    }
    if (req.method !== "POST") {
      sendError(res, "METHOD_NOT_ALLOWED", `Method ${req.method} not allowed`);
      return;
    }
    const handler = Object.hasOwn(handlers, path) ? handlers[path] : void 0;
    if (!handler) {
      sendError(res, "UNKNOWN_ENDPOINT", `No handler for ${path}`);
      return;
    }
    if (!JSON_TYPE.test(req.headers["content-type"] ?? "")) {
      sendError(
        res,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json"
      );
      return;
    }
    let raw;
    try {
      raw = await readBody(req, policy.maxBodyBytes());
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        res.setHeader("Connection", "close");
        sendError(res, "PAYLOAD_TOO_LARGE", err.message);
        return;
      }
      sendError(
        res,
        "BODY_READ_FAILED",
        `Failed to read body: ${errorMessage(err)}`
      );
      return;
    }
    let body;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      sendError(res, "INVALID_JSON", `Invalid JSON: ${errorMessage(err)}`);
      return;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      sendError(res, "INVALID_JSON", "Request body must be a JSON object");
      return;
    }
    const retryAfter = policy.throttle(path);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      sendError(res, "RATE_LIMITED", `Too many calls to ${path}`);
      return;
    }
    const started = import_node_perf_hooks.performance.now();
    try {
      const result = await withTimeout(
        Promise.resolve(handler(body)),
        policy.timeoutMs()
      );
      if (result === TIMED_OUT) {
        sendError(
          res,
          "TIMEOUT",
          `${path} did not answer within ${policy.timeoutMs()} ms; it may still complete`
        );
        return;
      }
      const status = result.success ? 200 : ERROR_STATUS[result.code];
      sendJson(res, status, result, started);
    } catch (err) {
      log2(
        "error",
        `[${EXTENSION_NAME}] handler ${path} threw: ${stackOf(err)}`
      );
      const body2 = {
        success: false,
        code: "INTERNAL",
        error: errorMessage(err)
      };
      sendJson(res, 500, body2, started);
    }
  };
}
function bearerMatches(header, token2) {
  const match = /^Bearer (.+)$/i.exec(header ?? "");
  if (!match) return false;
  const digest = (text3) => (0, import_node_crypto.createHash)("sha256").update(text3).digest();
  return (0, import_node_crypto.timingSafeEqual)(digest(match[1]), digest(token2));
}
var TIMED_OUT = /* @__PURE__ */ Symbol("timed out");
function withTimeout(promise, ms) {
  if (!Number.isFinite(ms)) return promise;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
var ExtensionHttpServer = class {
  server = null;
  port;
  host;
  listener;
  log;
  constructor(options) {
    this.port = options.port;
    this.host = options.host ?? "127.0.0.1";
    this.log = options.onLog ?? (() => {
    });
    this.listener = createRequestListener(
      options.handlers,
      this.log,
      options.policy
    );
  }
  /** Bound port, which differs from the configured one when that was 0. */
  get address() {
    return this.server ? this.server.address() : null;
  }
  start() {
    return new Promise((resolve, reject) => {
      const server2 = import_node_http.default.createServer(
        (req, res) => void this.listener(req, res)
      );
      server2.once("error", reject);
      server2.listen(this.port, this.host, () => {
        server2.off("error", reject);
        this.server = server2;
        const { port } = server2.address();
        this.log(
          "info",
          `[${EXTENSION_NAME}] listening on http://${this.host}:${port}`
        );
        resolve();
      });
    });
  }
  stop() {
    const server2 = this.server;
    if (!server2) return Promise.resolve();
    this.server = null;
    return new Promise((resolve) => server2.close(() => resolve()));
  }
};
var BodyTooLarge = class extends Error {
  constructor(limit) {
    super(
      `Request body exceeds ${limit} bytes (preference mcp-ext.limits.maxBodyKiB)`
    );
  }
};
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) {
      req.resume();
      reject(new BodyTooLarge(limit));
      return;
    }
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        req.resume();
        reject(new BodyTooLarge(limit));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
function sendError(res, code, error2) {
  const body = { success: false, code, error: error2 };
  sendJson(res, ERROR_STATUS[code], body);
}
function sendJson(res, status, body, handlerStarted) {
  const text3 = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text3)
  };
  if (handlerStarted !== void 0) {
    const ms = import_node_perf_hooks.performance.now() - handlerStarted;
    headers["Server-Timing"] = `handler;dur=${ms.toFixed(3)}`;
  }
  res.writeHead(status, headers);
  res.end(text3);
}
function stackOf(err) {
  return err instanceof Error ? String(err.stack) : String(err);
}

// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str2) {
  return str2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str2) {
  const units = str2.length;
  if (!highSurrogate.test(str2))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str2.charCodeAt(i) & 64512) === 55296 && (str2.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}

// node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved2 = E.stackTraceLimit;
    if (typeof saved2 === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved2;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer2, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init2(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer2(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init2(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init2 });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 5
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type2, input) {
    if (type2 === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type2] ?? type2;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/core/registries.js
var _a2;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta3 = _meta[0];
    this._map.set(schema, meta3);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.set(meta3.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta3 = this._map.get(schema);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.delete(meta3.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _positive(params) {
  return /* @__PURE__ */ _gt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}

// node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta3 = ctx.metadataRegistry.get(schema);
  if (meta3)
    assignProps(result.schema, meta3);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id2 = ctx.metadataRegistry.get(entry[0])?.id;
    if (id2) {
      const existing = idToSchema.get(id2);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id2}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id2, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id3) => id3);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id2 = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id2;
      return { defId: id2, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id2)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref: ref2, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref2;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id2 = ctx.metadataRegistry.get(entry[0])?.id;
    if (id2) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type2 = option.type;
    for (const member of Array.isArray(type2) ? type2 : [type2]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties2 = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties2, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties2, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties: properties2 };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref2 = seen.ref;
    seen.ref = null;
    if (ref2) {
      flattenRef(ref2);
      const refSeen = ctx.seen.get(ref2);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref2;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref2) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id2 = ctx.external.registry.get(schema)?.id;
    if (!id2)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id2);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var bigintProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "BigInt cannot be represented in JSON Schema");
};
var symbolProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Symbols cannot be represented in JSON Schema");
};
var nullProcessor = (_schema, ctx, json, _params) => {
  if (ctx.target === "openapi-3.0") {
    json.type = "string";
    json.nullable = true;
    json.enum = [null];
  } else {
    json.type = "null";
  }
};
var undefinedProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Undefined cannot be represented in JSON Schema");
};
var voidProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Void cannot be represented in JSON Schema");
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var anyProcessor = (_schema, _ctx, _json, _params) => {
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var dateProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Date cannot be represented in JSON Schema");
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var nanProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "NaN cannot be represented in JSON Schema");
};
var templateLiteralProcessor = (schema, _ctx, json, _params) => {
  const _json = json;
  const pattern = schema._zod.pattern;
  if (!pattern)
    throw new Error("Pattern not found in template literal");
  _json.type = "string";
  _json.pattern = pattern.source;
};
var fileProcessor = (schema, _ctx, json, _params) => {
  const _json = json;
  _json.type = "string";
  _json.format = "binary";
  _json.contentEncoding = "binary";
  const { minimum, maximum, mime } = aggregateChecks(schema);
  if (minimum !== void 0)
    _json.minLength = minimum;
  if (maximum !== void 0)
    _json.maxLength = maximum;
  if (!mime)
    return;
  if (mime.length === 0)
    _json.not = {};
  else if (mime.length === 1)
    _json.contentMediaType = mime[0];
  else
    _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
};
var successProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var functionProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Function types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var mapProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Map cannot be represented in JSON Schema");
};
var setProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Set cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? processSchema(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  let minItems = def.items.length;
  while (minItems > 0) {
    const item = def.items[minItems - 1];
    const optional2 = ctx.io === "input" ? inputOptin(item) !== void 0 : item._zod.optout === "optional";
    if (!optional2)
      break;
    minItems--;
  }
  const maxItems = def.items.length;
  const isClosed = !def.rest;
  if (ctx.target === "draft-2020-12") {
    json.prefixItems = prefixItems;
    if (isClosed) {
      json.items = false;
    } else if (rest) {
      json.items = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else if (ctx.target === "openapi-3.0") {
    json.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json.items.anyOf.push(rest);
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else {
    json.items = prefixItems;
    if (isClosed) {
      json.additionalItems = false;
    } else if (rest) {
      json.additionalItems = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  }
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id: id2, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var promiseProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
  const innerType = schema._zod.innerType;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var allProcessors = {
  string: stringProcessor,
  number: numberProcessor,
  boolean: booleanProcessor,
  bigint: bigintProcessor,
  symbol: symbolProcessor,
  null: nullProcessor,
  undefined: undefinedProcessor,
  void: voidProcessor,
  never: neverProcessor,
  any: anyProcessor,
  unknown: unknownProcessor,
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
  nan: nanProcessor,
  template_literal: templateLiteralProcessor,
  file: fileProcessor,
  success: successProcessor,
  custom: customProcessor,
  function: functionProcessor,
  transform: transformProcessor,
  map: mapProcessor,
  set: setProcessor,
  array: arrayProcessor,
  object: objectProcessor,
  union: unionProcessor,
  intersection: intersectionProcessor,
  tuple: tupleProcessor,
  record: recordProcessor,
  nullable: nullableProcessor,
  nonoptional: nonoptionalProcessor,
  default: defaultProcessor,
  prefault: prefaultProcessor,
  catch: catchProcessor,
  pipe: pipeProcessor,
  readonly: readonlyProcessor,
  promise: promiseProcessor,
  optional: optionalProcessor,
  lazy: lazyProcessor
};
function toJSONSchema(input, params) {
  if ("_idmap" in input) {
    const registry2 = input;
    const ctx2 = initializeContext({ ...params, processors: allProcessors });
    const defs = {};
    for (const entry of registry2._idmap.entries()) {
      const [_, schema] = entry;
      processSchema(schema, ctx2);
    }
    const schemas = {};
    const external = {
      registry: registry2,
      uri: params?.uri,
      defs
    };
    ctx2.external = external;
    for (const entry of registry2._idmap.entries()) {
      const [key, schema] = entry;
      extractDefs(ctx2, schema);
      assignProp(schemas, key, finalize(ctx2, schema));
    }
    if (Object.keys(defs).length > 0) {
      const defsSegment = ctx2.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs
      };
    }
    return { schemas };
  }
  const ctx = initializeContext({ ...params, processors: allProcessors });
  processSchema(input, ctx);
  extractDefs(ctx, input);
  return finalize(ctx, input);
}

// node_modules/zod/v4/mini/schemas.js
var ZodMiniType = /* @__PURE__ */ $constructor("ZodMiniType", (inst, def) => {
  if (!inst._zod)
    throw new Error("Uninitialized schema in ZodMiniType.");
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
}, {
  // `with` is an alias for `check`: the same function object, not a wrapper.
  get with() {
    return this.check;
  },
  set with(value) {
    own(this, "with", value);
  },
  parse(data, params) {
    return parse(this, data, params, { callee: this.parse });
  },
  parseAsync(data, params) {
    return parseAsync(this, data, params, { callee: this.parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  check(...checks) {
    const def = this.def;
    return this.clone({
      ...def,
      checks: [
        ...def.checks ?? [],
        ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }, { parent: true });
  },
  clone(_def, params) {
    return clone(this, _def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta3) {
    reg.add(this, meta3);
    return this;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  }
});
var ZodMiniString = /* @__PURE__ */ $constructor("ZodMiniString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function string2(params) {
  return _string(ZodMiniString, params);
}
var ZodMiniNumber = /* @__PURE__ */ $constructor("ZodMiniNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function number2(params) {
  return _number(ZodMiniNumber, params);
}
var ZodMiniNumberFormat = /* @__PURE__ */ $constructor("ZodMiniNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodMiniNumber.init(inst, def);
});
function int(params) {
  return _int(ZodMiniNumberFormat, params);
}
var ZodMiniBoolean = /* @__PURE__ */ $constructor("ZodMiniBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function boolean2(params) {
  return _boolean(ZodMiniBoolean, params);
}
var ZodMiniUnknown = /* @__PURE__ */ $constructor("ZodMiniUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function unknown() {
  return _unknown(ZodMiniUnknown);
}
var ZodMiniArray = /* @__PURE__ */ $constructor("ZodMiniArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function array(element, params) {
  return new ZodMiniArray({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
var ZodMiniObject = /* @__PURE__ */ $constructor("ZodMiniObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodMiniType.init(inst, def);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
});
// @__NO_SIDE_EFFECTS__
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodMiniObject(def);
}
// @__NO_SIDE_EFFECTS__
function looseObject(shape, params) {
  return new ZodMiniObject({
    type: "object",
    shape,
    catchall: /* @__PURE__ */ unknown(),
    ...normalizeParams(params)
  });
}
var ZodMiniUnion = /* @__PURE__ */ $constructor("ZodMiniUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function union(options, params) {
  return new ZodMiniUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodMiniRecord = /* @__PURE__ */ $constructor("ZodMiniRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodMiniRecord({
      type: "record",
      keyType: /* @__PURE__ */ string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodMiniRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodMiniEnum = /* @__PURE__ */ $constructor("ZodMiniEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodMiniType.init(inst, def);
  inst.options = [...inst._zod.values];
});
// @__NO_SIDE_EFFECTS__
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodMiniEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodMiniLiteral = /* @__PURE__ */ $constructor("ZodMiniLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function literal(value, params) {
  return new ZodMiniLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodMiniOptional = /* @__PURE__ */ $constructor("ZodMiniOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function optional(innerType) {
  return new ZodMiniOptional({
    type: "optional",
    innerType
  });
}
var ZodMiniNullable = /* @__PURE__ */ $constructor("ZodMiniNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function nullable(innerType) {
  return new ZodMiniNullable({
    type: "nullable",
    innerType
  });
}
var ZodMiniCustom = /* @__PURE__ */ $constructor("ZodMiniCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodMiniType.init(inst, def);
});
// @__NO_SIDE_EFFECTS__
function refine(fn, _params = {}) {
  return _refine(ZodMiniCustom, fn, _params);
}

// src/endpoint.ts
config(en_default());
config({ jitless: true });
function defineEndpoint(spec) {
  const { handle, ...endpoint } = spec;
  const handler = async (body) => {
    const parsed = safeParse(spec.request, body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(toIssue);
      return new ApiError(
        "INVALID_ARGUMENT",
        issues.map((i) => `${i.path}: ${i.message}`).join("; "),
        issues
      ).toBody();
    }
    try {
      return { success: true, data: await handle(parsed.data) };
    } catch (err) {
      if (err instanceof ApiError) return err.toBody();
      throw err;
    }
  };
  return { ...endpoint, handler };
}
function toIssue(issue2) {
  const path = issue2.path.map(String).join(".");
  return { path: path || "(body)", message: issue2.message };
}
function doc(schema, description) {
  globalRegistry.add(schema, { description });
  return schema;
}

// src/settings.ts
var PREF = {
  enabled: "mcp-ext.server.enabled",
  port: "mcp-ext.server.port",
  logLevel: "mcp-ext.server.logLevel",
  token: "mcp-ext.token",
  allowedOrigins: "mcp-ext.security.allowedOrigins",
  maxBodyKiB: "mcp-ext.limits.maxBodyKiB",
  maxBatchOps: "mcp-ext.limits.maxBatchOps",
  timeoutSeconds: "mcp-ext.limits.timeoutSeconds",
  commandsPerMinute: "mcp-ext.limits.commandsPerMinute"
};
var DEFAULTS = {
  logLevel: "info",
  /** Large enough for a batch of several hundred element creations. */
  maxBodyKiB: 4096,
  maxBatchOps: 500,
  /** Above the 30 s export_pdf waits for pdfkit, so its own error wins. */
  timeoutSeconds: 60,
  commandsPerMinute: 60
};
var THROTTLED = [
  "/execute_command",
  "/generate_code",
  "/reverse_code"
];
function positiveInt(key, fallback) {
  const value = app.preferences.get(key, fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function text(key) {
  const value = app.preferences.get(key, "");
  return typeof value === "string" ? value.trim() : "";
}
function maxBodyBytes() {
  return positiveInt(PREF.maxBodyKiB, DEFAULTS.maxBodyKiB) * 1024;
}
function maxBatchOps() {
  return positiveInt(PREF.maxBatchOps, DEFAULTS.maxBatchOps);
}
function token() {
  return text(PREF.token);
}
function allowedOrigins() {
  return text(PREF.allowedOrigins).split(/[\s,]+/).filter((o) => o.length > 0);
}
function timeoutMs() {
  return positiveInt(PREF.timeoutSeconds, DEFAULTS.timeoutSeconds) * 1e3;
}
var LEVELS = ["error", "info", "debug"];
function logLevel() {
  const value = app.preferences.get(PREF.logLevel, DEFAULTS.logLevel);
  return LEVELS.includes(value) ? value : DEFAULTS.logLevel;
}
function logs(level) {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(logLevel());
}
var MINUTE_MS = 6e4;
var RateLimiter = class {
  constructor(limit, now = Date.now) {
    this.limit = limit;
    this.now = now;
  }
  limit;
  now;
  calls = /* @__PURE__ */ new Map();
  /** Seconds to wait, or 0 after recording the call. */
  take(path) {
    const now = this.now();
    const recent = (this.calls.get(path) ?? []).filter(
      (t) => t > now - MINUTE_MS
    );
    if (recent.length >= this.limit()) {
      this.calls.set(path, recent);
      return Math.ceil((recent[0] + MINUTE_MS - now) / 1e3);
    }
    recent.push(now);
    this.calls.set(path, recent);
    return 0;
  }
};
function preferencePolicy(limiter = new RateLimiter(
  () => positiveInt(PREF.commandsPerMinute, DEFAULTS.commandsPerMinute)
)) {
  return {
    maxBodyBytes,
    token,
    allowedOrigins,
    timeoutMs,
    throttle: (path) => THROTTLED.includes(path) ? limiter.take(path) : 0
  };
}

// src/handlers/batch.ts
var NOT_ATOMIC = /* @__PURE__ */ new Set([
  "/batch",
  "/undo",
  "/redo",
  "/new_project",
  "/open_project",
  "/save_project",
  "/save_project_as",
  "/execute_command",
  "/export_pdf",
  "/export_html",
  "/export_diagrams",
  "/generate_code",
  "/reverse_code"
]);
var NAME = /^[A-Za-z_][\w-]*$/;
var REFERENCE = /^\$([A-Za-z_][\w-]*)((?:\.[A-Za-z_$][\w$]*)*)$/;
function resolveReferences(value, results) {
  if (typeof value === "string") {
    if (value.startsWith("$$")) return value.slice(1);
    const match = REFERENCE.exec(value);
    return match ? lookup(value, match[1], match[2], results) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveReferences(v, results));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveReferences(v, results)])
    );
  }
  return value;
}
function lookup(text3, name, path, results) {
  const result = results.get(name);
  if (!result) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${text3}: no earlier op is named ${name}`
    );
  }
  if (!result.success) {
    throw new ApiError("INVALID_ARGUMENT", `${text3}: op ${name} failed`);
  }
  let value = result.data;
  for (const segment of path.split(".").slice(1)) {
    const key = segment === "id" ? "_id" : segment;
    value = value !== null && typeof value === "object" ? value[key] : void 0;
  }
  if (value !== null && typeof value === "object") {
    const { _id, $ref } = value;
    value = _id ?? $ref;
  }
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new ApiError("INVALID_ARGUMENT", `${text3} does not name a value`);
  }
  return value;
}
var opSchema = () => object({
  path: doc(
    string2().check(_regex(/^\//)),
    "Endpoint path, e.g. '/create_element_with_view'."
  ),
  body: optional(
    doc(
      record(string2(), unknown()),
      "The endpoint's request body. Strings '$name' and '$name.field' are replaced by ids from earlier results."
    )
  ),
  as: optional(
    doc(
      string2().check(_regex(NAME)),
      "Name later ops use to refer to this op's result."
    )
  )
});
var resultSchema = () => object({
  path: string2(),
  as: optional(string2()),
  success: boolean2(),
  data: optional(doc(unknown(), "The op's response data.")),
  code: optional(string2()),
  error: optional(string2()),
  details: optional(unknown())
});
function checkPlan(ops, endpoints2, atomic) {
  const max = maxBatchOps();
  if (ops.length > max) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      `A batch takes at most ${max} ops (preference mcp-ext.limits.maxBatchOps); got ${ops.length}`
    );
  }
  const names = /* @__PURE__ */ new Set();
  ops.forEach((op, i) => {
    if (!endpoints2.has(op.path)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `ops.${i}.path: no endpoint ${op.path}`
      );
    }
    if (op.path === "/batch" || atomic && NOT_ATOMIC.has(op.path)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `ops.${i}.path: ${op.path} cannot run in ${atomic ? "an atomic" : "a"} batch`
      );
    }
    if (op.as !== void 0) {
      if (names.has(op.as)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `ops.${i}.as: ${op.as} is used twice`
        );
      }
      names.add(op.as);
    }
  });
}
async function runOp(op, endpoint, results) {
  let outcome;
  try {
    const body = resolveReferences(op.body ?? {}, results);
    outcome = await endpoint.handler(body);
  } catch (err) {
    outcome = err instanceof ApiError ? err.toBody() : { success: false, code: "INTERNAL", error: String(err) };
  }
  if (op.as !== void 0) results.set(op.as, outcome);
  return {
    path: op.path,
    ...op.as !== void 0 && { as: op.as },
    ...outcome
  };
}
async function recording(run) {
  const operations = [];
  const listener = (operation) => operations.push(operation);
  app.repository.on("operationExecuted", listener);
  try {
    return { value: await run(), operations };
  } finally {
    app.repository.off("operationExecuted", listener);
  }
}
var history = () => app.repository;
function squash(operations) {
  const builder = app.repository.getOperationBuilder();
  builder.begin("batch");
  builder.end();
  const merged = builder.getOperation();
  merged.ops = operations.flatMap((o) => o.ops);
  const { _undoStack } = history();
  for (let i = 0; i < operations.length; i++) _undoStack.pop();
  _undoStack.push(merged);
}
function rollBack(operations) {
  for (let i = 0; i < operations.length; i++) app.repository.undo();
  history()._redoStack.clear();
}
function batchEndpoint(endpoints2) {
  return defineEndpoint({
    path: "/batch",
    description: "Run several endpoint calls in one request. Later ops refer to earlier results as '$name' (the result's id), '$name.view' or '$name.model'. atomic (default true) makes the whole batch one undo step and undoes it all when an op fails; atomic false runs every op and reports each.",
    readOnly: false,
    destructive: true,
    request: object({
      ops: doc(
        array(opSchema()).check(_minLength(1)),
        "Calls in order. The limit is the mcp-ext.limits.maxBatchOps preference, default 500."
      ),
      atomic: optional(
        doc(
          boolean2(),
          "Default true. Atomic batches refuse /undo, /redo, /new_project, /open_project, /save_project*, /execute_command, /export_pdf, /export_html, /export_diagrams, /generate_code and /reverse_code."
        )
      )
    }),
    response: object({
      atomic: boolean2(),
      succeeded: doc(int(), "Ops that succeeded."),
      failed: doc(int(), "Ops that failed; always 0 for an atomic batch."),
      results: doc(
        array(resultSchema()),
        "One entry per op, in order: the op's data, or its error code and message."
      )
    }),
    handle: async (input) => {
      const atomic = input.atomic ?? true;
      const byPath = new Map(
        endpoints2().map((e) => [e.path, e])
      );
      checkPlan(input.ops, byPath, atomic);
      const resultsByName = /* @__PURE__ */ new Map();
      const { value: results, operations } = await recording(async () => {
        const out = [];
        for (const op of input.ops) {
          const result = await runOp(op, byPath.get(op.path), resultsByName);
          out.push(result);
          if (atomic && !result.success) break;
        }
        return out;
      });
      const failures = results.filter((r) => !r.success);
      if (atomic && failures.length > 0) {
        rollBack(operations);
        const failed = failures[0];
        const index = results.length - 1;
        throw new ApiError(
          failed.code,
          `ops.${index} ${failed.path} failed, batch rolled back: ${failed.error}`,
          { index, results }
        );
      }
      if (atomic && operations.length > 1) squash(operations);
      return {
        atomic,
        succeeded: results.length - failures.length,
        failed: failures.length,
        results
      };
    }
  });
}

// src/command-catalogue.json
var command_catalogue_default = {
  commands: {
    "alignment:align-bottom": {
      args: [],
      dialog: "never",
      effect: "Aligns the selected node views to the lowest bottom edge.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:409"
    },
    "alignment:align-center": {
      args: [],
      dialog: "never",
      effect: "Centers the selected node views horizontally on a common axis.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:399"
    },
    "alignment:align-left": {
      args: [],
      dialog: "never",
      effect: "Aligns the selected node views to the leftmost edge.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:389"
    },
    "alignment:align-middle": {
      args: [],
      dialog: "never",
      effect: "Centers the selected node views vertically on a common axis.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:414"
    },
    "alignment:align-right": {
      args: [],
      dialog: "never",
      effect: "Aligns the selected node views to the rightmost edge.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:394"
    },
    "alignment:align-top": {
      args: [],
      dialog: "never",
      effect: "Aligns the selected node views to the topmost edge.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:404"
    },
    "alignment:bring-to-front": {
      args: [],
      dialog: "never",
      effect: "Moves the selected views to the top of the diagram z-order.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:384"
    },
    "alignment:send-to-back": {
      args: [],
      dialog: "never",
      effect: "Moves the selected views to the bottom of the diagram z-order.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:379"
    },
    "alignment:set-height-equally": {
      args: [],
      dialog: "never",
      effect: "Gives all selected node views the same height.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:434"
    },
    "alignment:set-size-equally": {
      args: [],
      dialog: "never",
      effect: "Gives all selected node views the same width and height.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:439"
    },
    "alignment:set-width-equally": {
      args: [],
      dialog: "never",
      effect: "Gives all selected node views the same width.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:429"
    },
    "alignment:space-equally-horizontally": {
      args: [],
      dialog: "never",
      effect: "Distributes the selected node views with equal horizontal spacing.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:419"
    },
    "alignment:space-equally-vertically": {
      args: [],
      dialog: "never",
      effect: "Distributes the selected node views with equal vertical spacing.",
      needs: "selection (node views in current diagram)",
      source: "extensions/default/alignment/main.js:424"
    },
    "api:get_all_diagrams_info": {
      args: [],
      dialog: "never",
      effect: "Returns id, type, name and documentation of every diagram in the repository (empty array if none).",
      needs: "open project",
      source: "src/engine/default-commands.js:1699"
    },
    "api:get_current_diagram_info": {
      args: [],
      dialog: "never",
      effect: "Returns id, type, name and documentation of the active diagram, or null when none is open.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1700"
    },
    "api:get_diagram_image_by_id": {
      args: [
        {
          name: "diagramId",
          note: "Must resolve to a Diagram, else the command throws.",
          optional: false,
          type: "string element _id"
        }
      ],
      dialog: "never",
      effect: "Renders the given diagram to PNG and returns the image data (null if rendering fails).",
      needs: "open project",
      note: "Throws an Error for an unknown or non-diagram id.",
      source: "src/engine/default-commands.js:1704"
    },
    "application:log": {
      args: [
        {
          name: "...args",
          note: "Forwarded verbatim to console.log.",
          optional: true,
          type: "any"
        }
      ],
      dialog: "never",
      effect: "Writes the arguments to the renderer DevTools console.",
      source: "src/engine/default-commands.js:1444"
    },
    "application:main-log": {
      args: [
        {
          name: "...args",
          note: "Sent over IPC to the main process.",
          optional: true,
          type: "any (structured-cloneable)"
        }
      ],
      dialog: "never",
      effect: "Prints the arguments on the main process console (stdout), the channel the CLI uses for output.",
      source: "src/engine/default-commands.js:1445"
    },
    "application:preferences": {
      args: [
        {
          name: "preferenceId",
          note: "Pre-selects that preference section.",
          optional: true,
          type: "string preference schema id"
        }
      ],
      dialog: "always",
      effect: "Opens the Preferences modal dialog.",
      source: "src/engine/default-commands.js:1439"
    },
    "application:quit": {
      args: [],
      dialog: "confirm",
      effect: "Saves working-diagram state and asks the main process to quit the whole application.",
      note: "Main process closes every window; a window with unsaved changes raises a blocking native Save/Don't Save/Cancel box (window.js close handler). Choosing Save routes to project:save, which opens a native save dialog for an untitled project. Terminates the app, which also stops any in-app server.",
      source: "src/engine/default-commands.js:1446"
    },
    "application:reload": {
      args: [],
      dialog: "confirm",
      effect: "Asks the main process to relaunch the application and then quits it (full app restart, not a window reload).",
      note: "Kills every window and with it the in-app HTTP server; it does not come back until the relaunched app finishes loading. Shares application:quit's path, so a modified project raises the blocking native Save/Don't Save/Cancel box (window close handler) before the quit proceeds.",
      source: "src/engine/default-commands.js:1447"
    },
    "aws:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/aws/aws-commands.js:90"
    },
    "aws:set-icon": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens the icon picker for a AWS element view that has an icon and sets the chosen icon (and a name derived from it).",
      needs: "target view (options.view) of a AWSElement",
      note: "Nothing happens when options.view.model is not a AWSElement that has an icon. The picker is an in-app modal; result is applied asynchronously but the handler returns undefined.",
      source: "extensions/essential/aws/aws-commands.js:91"
    },
    "azure:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/azure/azure-commands.js:54"
    },
    "azure:set-icon": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens the icon picker for a Azure element view and sets the chosen icon (and a name derived from it).",
      needs: "target view (options.view) of a AzureElement",
      note: "Nothing happens when options.view.model is not a AzureElement. The picker is an in-app modal; result is applied asynchronously but the handler returns undefined.",
      source: "extensions/essential/azure/azure-commands.js:55"
    },
    "bpmn:add-boundary-event": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a boundary event at a random spot on the given activity view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/bpmn/bpmn-commands.js:287"
    },
    "bpmn:add-choreography-initiating-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a message above the choreography view linked to it with a rectilinear message link.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/bpmn/bpmn-commands.js:301"
    },
    "bpmn:add-choreography-return-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a grey (return) message below the choreography view linked to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/bpmn/bpmn-commands.js:305"
    },
    "bpmn:add-event-definition": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). command-arg supplies id (e.g. BPMNTimerEventDefinition); spread into factory options.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Creates an event definition of the given type under the event's model.",
      needs: "target view (options.view) of a BPMNEvent",
      source: "extensions/essential/bpmn/bpmn-commands.js:288"
    },
    "bpmn:add-lane": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a lane inside the given pool/lane view, below its current bottom.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/bpmn/bpmn-commands.js:286"
    },
    "bpmn:add-text-annotation": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a text annotation below the view and associates it with the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/bpmn/bpmn-commands.js:309"
    },
    "bpmn:assign-choreography-initiating-participant": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker for a participant and sets it as the choreography activity's initiating participant.",
      needs: "target view (options.view) of a BPMNChoreographyActivity",
      note: "No-op when the model is not a BPMNChoreographyActivity.",
      source: "extensions/essential/bpmn/bpmn-commands.js:297"
    },
    "bpmn:assign-choreography-participant": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options.field names the participant list to append to.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker for a participant and appends the choice to the choreography activity's participant field.",
      needs: "target view (options.view) of a BPMNChoreographyActivity",
      note: "No-op when the model is not a BPMNChoreographyActivity.",
      source: "extensions/essential/bpmn/bpmn-commands.js:293"
    },
    "bpmn:create-choreography-participant": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options.field is upperParticipants or lowerParticipants (from command-arg).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Creates a new participant next to the choreography activity and adds it to the given participant field.",
      needs: "target view (options.view) of a BPMNChoreographyActivity",
      source: "extensions/essential/bpmn/bpmn-commands.js:289"
    },
    "bpmn:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/bpmn/bpmn-commands.js:285"
    },
    "c4:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/c4/c4-commands.js:57"
    },
    "cli:ejs": {
      args: [
        {
          name: "template",
          optional: false,
          type: "string .ejs file path"
        },
        {
          name: "select",
          note: "Passed to app.repository.select.",
          optional: false,
          type: "string element selector expression"
        },
        {
          name: "output",
          note: "When omitted the rendered text is printed to the main console instead of written.",
          optional: true,
          type: "string ejs-templated output path"
        }
      ],
      dialog: "never",
      effect: "Renders an EJS template once per selected element and writes each result to a file (or the main console), then quits the app.",
      needs: "open project",
      note: "Designed for CLI mode: after running it schedules an IPC 'quit' 500 ms later, which terminates the whole app (and the HTTP server). Errors are only logged to the main console.",
      source: "src/engine/default-commands.js:1680"
    },
    "cli:exec": {
      args: [
        {
          name: "cmd",
          optional: false,
          type: "string command id"
        },
        {
          name: "args",
          note: "Passed as the single argument to that command.",
          optional: true,
          type: "any"
        }
      ],
      dialog: "never",
      effect: "Executes another registered command by id, then quits the app.",
      note: "Designed for CLI mode: after running it schedules an IPC 'quit' 500 ms later, which terminates the whole app (and the HTTP server). Errors are only logged to the main console. Any dialog the target command opens is still shown, and the quit fires regardless.",
      source: "src/engine/default-commands.js:1684"
    },
    "cli:html": {
      args: [
        {
          name: "output",
          optional: false,
          type: "string directory path"
        }
      ],
      dialog: "never",
      effect: "Runs html-export:export into the given directory (html-docs subfolder), then quits the app.",
      needs: "open project",
      note: "Designed for CLI mode: after running it schedules an IPC 'quit' 500 ms later, which terminates the whole app (and the HTTP server). Errors are only logged to the main console.",
      source: "src/engine/default-commands.js:1682"
    },
    "cli:image": {
      args: [
        {
          name: "format",
          note: "Other values export nothing.",
          optional: false,
          type: "string png|jpeg|svg"
        },
        {
          name: "selector",
          note: "Non-diagram matches are filtered out.",
          optional: false,
          type: "string element selector expression"
        },
        {
          name: "output",
          note: "Defaults to <diagram name>.<format> in the working directory.",
          optional: true,
          type: "string ejs-templated output path"
        }
      ],
      dialog: "never",
      effect: "Exports each selected diagram as an image file, then quits the app.",
      needs: "open project",
      note: "Designed for CLI mode: after running it schedules an IPC 'quit' 500 ms later, which terminates the whole app (and the HTTP server). Errors are only logged to the main console.",
      source: "src/engine/default-commands.js:1681"
    },
    "cli:pdf": {
      args: [
        {
          name: "selector",
          note: "Non-diagram matches are filtered out.",
          optional: false,
          type: "string element selector expression"
        },
        {
          name: "output",
          optional: false,
          type: "string .pdf file path"
        },
        {
          name: "options",
          note: "Forwarded to the PDF exporter (page size, layout, header etc.).",
          optional: true,
          type: "object PDF export options"
        }
      ],
      dialog: "never",
      effect: "Exports the selected diagrams into one PDF file, then quits the app.",
      needs: "open project",
      note: "Designed for CLI mode: after running it schedules an IPC 'quit' 500 ms later, which terminates the whole app (and the HTTP server). Errors are only logged to the main console.",
      source: "src/engine/default-commands.js:1683"
    },
    "common:tag": {
      args: [
        {
          name: "options",
          note: "Accepted but ignored.",
          optional: true,
          type: "object"
        }
      ],
      dialog: "never",
      effect: "Adds a new Tag to the currently selected model element.",
      needs: "selection (ExtensibleModel)",
      source: "extensions/essential/common/common-commands.js:37"
    },
    "debug:reload": {
      args: [],
      dialog: "confirm",
      effect: "Reloads the current window's web contents.",
      note: "Reload tears down the renderer, killing the in-app HTTP server until extensions re-initialise. When the repository is modified it first shows the blocking Save/Don't Save/Cancel box: Save runs project:save and does NOT reload; Cancel aborts; only Don't Save reloads.",
      source: "extensions/default/debug/main.js:45"
    },
    "debug:show-devtools": {
      args: [],
      dialog: "external",
      effect: "Opens Chromium DevTools for the window in a detached window.",
      note: "Opens a separate DevTools window; no modal in the app.",
      source: "extensions/default/debug/main.js:44"
    },
    "dfd:add-incoming-external-entity": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an external entity above the view with a data flow into the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/dfd/dfd-commands.js:138"
    },
    "dfd:add-incoming-process": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a process above the view with a data flow into the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/dfd/dfd-commands.js:139"
    },
    "dfd:add-outgoing-datastore": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a data store below the view connected by a data flow from the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/dfd/dfd-commands.js:137"
    },
    "dfd:add-outgoing-process": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a process below the view connected by a data flow from the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/dfd/dfd-commands.js:136"
    },
    "diagram-generator:overview": {
      args: [
        {
          name: "base",
          note: "Package to generate from; defaults to the selected element if it is a UMLPackage.",
          optional: true,
          type: "Element (UMLPackage)"
        },
        {
          name: "doNotOpen",
          note: "When true the generated diagram is not opened.",
          optional: true,
          type: "boolean"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Generates a class diagram 'Overview' of a package's owned elements with compartments suppressed, auto-lays it out and opens it.",
      needs: "selection (UMLPackage) when base omitted",
      note: "If base is omitted and the selection is not a UMLPackage, a blocking native info message box is shown and nothing is generated.",
      source: "extensions/default/diagram-generator/main.js:372"
    },
    "diagram-generator:overview-expanded": {
      args: [
        {
          name: "base",
          note: "Package to generate from; defaults to the selected element if it is a UMLPackage.",
          optional: true,
          type: "Element (UMLPackage)"
        },
        {
          name: "doNotOpen",
          note: "When true the generated diagram is not opened.",
          optional: true,
          type: "boolean"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Generates an 'Overview' class diagram of a package's owned elements with compartments shown, lays it out and opens it.",
      needs: "selection (UMLPackage) when base omitted",
      note: "If base is omitted and the selection is not a UMLPackage, a blocking native info message box is shown and nothing is generated.",
      source: "extensions/default/diagram-generator/main.js:373"
    },
    "diagram-generator:package-structure": {
      args: [
        {
          name: "base",
          note: "Package to generate from; defaults to the selected element if it is a UMLPackage.",
          optional: true,
          type: "Element (UMLPackage)"
        },
        {
          name: "doNotOpen",
          note: "When true the generated diagram is not opened.",
          optional: true,
          type: "boolean"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Generates a package diagram of nested packages under a package and opens it.",
      needs: "selection (UMLPackage) when base omitted",
      note: "If base is omitted and the selection is not a UMLPackage, a blocking native info message box is shown and nothing is generated.",
      source: "extensions/default/diagram-generator/main.js:375"
    },
    "diagram-generator:type-hierarchy": {
      args: [
        {
          name: "base",
          note: "Package to generate from; defaults to the selected element if it is a UMLPackage.",
          optional: true,
          type: "Element (UMLPackage)"
        },
        {
          name: "doNotOpen",
          note: "When true the generated diagram is not opened.",
          optional: true,
          type: "boolean"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Generates a class diagram showing the generalization/realization hierarchy of a package's types and opens it.",
      needs: "selection (UMLPackage) when base omitted",
      note: "If base is omitted and the selection is not a UMLPackage, a blocking native info message box is shown and nothing is generated.",
      source: "extensions/default/diagram-generator/main.js:374"
    },
    "diagram-layout:auto": {
      args: [
        {
          name: "direction",
          note: "Rank direction; default is the diagram's built-in default.",
          optional: true,
          type: "string (TB|BT|LR|RL)"
        },
        {
          name: "separations",
          note: "If given, pass all three fields; missing ones become undefined.",
          optional: true,
          type: "object {node,edge,rank} numbers"
        }
      ],
      dialog: "never",
      effect: "Auto-lays out the current diagram (dagre) with the default direction, as one undoable operation.",
      needs: "current diagram",
      source: "extensions/default/diagram-layout/main.js:39"
    },
    "diagram-layout:bottom-top": {
      args: [
        {
          name: "separations",
          note: "Direction is bound; first caller arg becomes separations. If given, pass all three fields.",
          optional: true,
          type: "object {node,edge,rank} numbers"
        }
      ],
      dialog: "never",
      effect: "Auto-lays out the current diagram with rank direction BT, as one undoable operation.",
      needs: "current diagram",
      source: "extensions/default/diagram-layout/main.js:41"
    },
    "diagram-layout:left-right": {
      args: [
        {
          name: "separations",
          note: "Direction is bound; first caller arg becomes separations. If given, pass all three fields.",
          optional: true,
          type: "object {node,edge,rank} numbers"
        }
      ],
      dialog: "never",
      effect: "Auto-lays out the current diagram with rank direction LR, as one undoable operation.",
      needs: "current diagram",
      source: "extensions/default/diagram-layout/main.js:42"
    },
    "diagram-layout:right-left": {
      args: [
        {
          name: "separations",
          note: "Direction is bound; first caller arg becomes separations. If given, pass all three fields.",
          optional: true,
          type: "object {node,edge,rank} numbers"
        }
      ],
      dialog: "never",
      effect: "Auto-lays out the current diagram with rank direction RL, as one undoable operation.",
      needs: "current diagram",
      source: "extensions/default/diagram-layout/main.js:43"
    },
    "diagram-layout:top-bottom": {
      args: [
        {
          name: "separations",
          note: "Direction is bound; first caller arg becomes separations. If given, pass all three fields.",
          optional: true,
          type: "object {node,edge,rank} numbers"
        }
      ],
      dialog: "never",
      effect: "Auto-lays out the current diagram with rank direction TB, as one undoable operation.",
      needs: "current diagram",
      source: "extensions/default/diagram-layout/main.js:40"
    },
    "diagram-thumbnails:toggle": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the Diagram Thumbnails panel.",
      source: "extensions/default/diagram-thumbnails/main.js:299"
    },
    "edit:copy": {
      args: [],
      dialog: "confirm",
      effect: "Copies the selected model (single) or selected copyable views to the StarUML clipboard; inside a text field forwards a native copy.",
      needs: "selection",
      note: "Shows a blocking native info box when selected views cannot be copied (e.g. in sequence/communication diagrams). Deselects non-copyable views as a side effect.",
      source: "src/engine/default-commands.js:1509"
    },
    "edit:copy-diagram-as-image": {
      args: [],
      dialog: "never",
      effect: "Renders the current diagram to an image (PNG on macOS) and writes it to the system clipboard; clears diagram selection.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1510"
    },
    "edit:cut": {
      args: [],
      dialog: "confirm",
      effect: "Copies then deletes the selected model or views (text-field focus: native cut).",
      needs: "selection",
      note: "View cut goes through edit:delete, which can open the 'Delete Views Only / Delete from Model' modal when the diagram allows neither deleting nor hiding views.",
      source: "src/engine/default-commands.js:1508"
    },
    "edit:delete": {
      args: [],
      dialog: "confirm",
      effect: "Deletes the selected views from the diagram (or hides them where the diagram only allows hiding); models stay.",
      needs: "selection, current diagram",
      note: "If the current diagram can neither delete nor hide views (e.g. lifelines in sequence diagrams), opens a renderer modal asking Delete Views Only / Delete from Model / Cancel.",
      source: "src/engine/default-commands.js:1516"
    },
    "edit:delete-from-model": {
      args: [],
      dialog: "never",
      effect: "Deletes the selected models (and models of selected views) from the repository, closing any deleted diagrams; no confirmation.",
      needs: "selection",
      note: "Destructive without prompt; undoable via edit:undo.",
      source: "src/engine/default-commands.js:1517"
    },
    "edit:move-down": {
      args: [],
      dialog: "never",
      effect: "Moves the selected element one position down within its parent's collection.",
      needs: "selection",
      note: "Throws if nothing is selected.",
      source: "src/engine/default-commands.js:1523"
    },
    "edit:move-up": {
      args: [],
      dialog: "never",
      effect: "Moves the selected element one position up within its parent's collection.",
      needs: "selection",
      note: "Throws if nothing is selected.",
      source: "src/engine/default-commands.js:1522"
    },
    "edit:open-sub-diagram": {
      args: [],
      dialog: "never",
      effect: "Opens the first diagram owned by the selected element (or its sub-activity/sub-machine); toast if none.",
      needs: "selection (exactly one model)",
      source: "src/engine/default-commands.js:1535"
    },
    "edit:paste": {
      args: [],
      dialog: "confirm",
      effect: "Pastes the clipboard model under the selected element or clipboard views into the current diagram (text-field focus: native paste).",
      needs: "selection or current diagram",
      note: "Shows a blocking native info box when clipboard views cannot be pasted into the current diagram.",
      source: "src/engine/default-commands.js:1515"
    },
    "edit:redo": {
      args: [],
      dialog: "never",
      effect: "Redoes the last undone operation (text-field focus: native redo).",
      source: "src/engine/default-commands.js:1507"
    },
    "edit:select-all": {
      args: [],
      dialog: "never",
      effect: "Selects all views in the current diagram, or all text in a focused input.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1524"
    },
    "edit:select-in-diagram": {
      args: [],
      dialog: "confirm",
      effect: "Selects a view of the selected model in a diagram, opening that diagram.",
      needs: "selection",
      note: "If the model has views in more than one diagram, opens an element-list picker modal to choose the diagram; toast if none.",
      source: "src/engine/default-commands.js:1530"
    },
    "edit:select-in-explorer": {
      args: [],
      dialog: "never",
      effect: "Reveals and selects the first selected model in the Model Explorer.",
      needs: "selection",
      source: "src/engine/default-commands.js:1525"
    },
    "edit:undo": {
      args: [],
      dialog: "never",
      effect: "Undoes the last operation (text-field focus: native undo).",
      source: "src/engine/default-commands.js:1506"
    },
    "engine:set-property": {
      args: [
        {
          name: "options",
          note: "set-model is a lodash path applied to model before setting.",
          optional: false,
          type: "object {model, property, value, set-model?}"
        }
      ],
      dialog: "never",
      effect: "Sets one property of an element through an undoable engine operation.",
      source: "src/engine/default-commands.js:1695"
    },
    "erd:add-many-to-many": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an entity to the right linked by a relationship with 0..* at both ends.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/erd/erd-commands.js:191"
    },
    "erd:add-one-to-many": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an entity to the right linked by a relationship whose far end is 0..*.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/erd/erd-commands.js:190"
    },
    "erd:add-one-to-one": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an entity to the right of the entity view linked by a one-to-one relationship.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/erd/erd-commands.js:189"
    },
    "erd:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/erd/erd-commands.js:187"
    },
    "erd:set-column-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses 'name: type(size)' text and sets the ERD column's name, type and length.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/erd/erd-commands.js:188"
    },
    "erd:suppress-columns": {
      args: [],
      dialog: "never",
      effect: "Toggles column-compartment suppression on the selected ERD entity views.",
      needs: "selection (views)",
      source: "extensions/essential/erd/erd-commands.js:192"
    },
    "explorer:collapse-all": {
      args: [],
      dialog: "never",
      effect: "Collapses all nodes in the Model Explorer tree.",
      source: "src/views/model-explorer-view.js:624"
    },
    "explorer:expand-all": {
      args: [],
      dialog: "never",
      effect: "Expands all nodes in the Model Explorer tree.",
      source: "src/views/model-explorer-view.js:617"
    },
    "explorer:show-stereotype-text": {
      args: [],
      dialog: "never",
      effect: "Toggles showing stereotype text in the Model Explorer.",
      source: "src/views/model-explorer-view.js:610"
    },
    "explorer:sort-by-added": {
      args: [],
      dialog: "never",
      effect: "Sorts the Model Explorer in insertion order.",
      source: "src/views/model-explorer-view.js:596"
    },
    "explorer:sort-by-name": {
      args: [],
      dialog: "never",
      effect: "Sorts the Model Explorer alphabetically.",
      source: "src/views/model-explorer-view.js:603"
    },
    "factory:create-diagram": {
      args: [
        {
          name: "options",
          note: "id is a registered diagram factory id (e.g. UMLClassDiagram). parent defaults to the selection, else the project.",
          optional: false,
          type: "object {id, parent?, diagramInitializer?, ...}"
        }
      ],
      dialog: "never",
      effect: "Creates a diagram of the given factory id under a parent and returns it.",
      needs: "open project",
      note: "Unknown id logs an error and returns null.",
      source: "src/engine/default-commands.js:1688"
    },
    "factory:create-model": {
      args: [
        {
          name: "options",
          note: "id is a registered model factory id (e.g. UMLClass). parent defaults to the current selection.",
          optional: false,
          type: "object {id, parent?, field?, modelInitializer?, ...}"
        }
      ],
      dialog: "never",
      effect: "Creates a model element of the given factory id under a parent and returns it.",
      needs: "open project; selection when parent omitted",
      note: "Unknown id logs an error and returns null.",
      source: "src/engine/default-commands.js:1689"
    },
    "factory:create-model-and-view": {
      args: [
        {
          name: "options",
          note: "diagram defaults to the current diagram; parent is always forced to the diagram's owner.",
          optional: false,
          type: "object {id, diagram?, x1, y1, x2, y2, tailView?, headView?, containerView?, modelInitializer?, viewInitializer?, ...}"
        }
      ],
      dialog: "never",
      effect: "Creates a model element plus its view on a diagram and returns the view.",
      needs: "current diagram (when options.diagram omitted)",
      note: "Unknown id logs an error and returns null; factory assertions throw a string.",
      source: "src/engine/default-commands.js:1690"
    },
    "fc:add-incoming-decision": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a decision above the flowchart node with a flow into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/flowchart/flowchart-commands.js:134"
    },
    "fc:add-incoming-process": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a process above the flowchart node with a flow into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/flowchart/flowchart-commands.js:132"
    },
    "fc:add-outgoing-decision": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a decision below the flowchart node connected by a flow from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/flowchart/flowchart-commands.js:133"
    },
    "fc:add-outgoing-process": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a process below the flowchart node connected by a flow from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/flowchart/flowchart-commands.js:131"
    },
    "find:find": {
      args: [],
      dialog: "always",
      effect: "Opens the Find modal; on OK searches elements by keyword and shows results in a bottom panel.",
      needs: "open project",
      source: "extensions/default/find/main.js:153"
    },
    "format:auto-resize": {
      args: [],
      dialog: "never",
      effect: "Toggles auto-resize on the selected views.",
      needs: "selection (views)",
      source: "src/engine/default-commands.js:1572"
    },
    "format:fill-color": {
      args: [
        {
          name: "newColor",
          note: "When omitted a color picker modal opens.",
          optional: true,
          type: "string color (e.g. #RRGGBB)"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Sets the fill color of the selected views.",
      needs: "selection (views)",
      source: "src/engine/default-commands.js:1542"
    },
    "format:font": {
      args: [],
      dialog: "always",
      effect: "Opens the font modal and applies face/size/color to the selected views.",
      needs: "selection (views)",
      source: "src/engine/default-commands.js:1541"
    },
    "format:inherit-style": {
      args: [],
      dialog: "never",
      effect: "Toggles parent-style inheritance on the selected views.",
      needs: "selection (views)",
      source: "src/engine/default-commands.js:1582"
    },
    "format:line-color": {
      args: [],
      dialog: "always",
      effect: "Opens a color picker modal and applies the line color to the selected views.",
      needs: "selection (views)",
      note: "Unlike fill-color, no argument bypasses the dialog.",
      source: "src/engine/default-commands.js:1547"
    },
    "format:linestyle-curve": {
      args: [],
      dialog: "never",
      effect: "Sets the line style of the selected edge views to curve.",
      needs: "selection (edge views)",
      source: "src/engine/default-commands.js:1567"
    },
    "format:linestyle-oblique": {
      args: [],
      dialog: "never",
      effect: "Sets the line style of the selected edge views to oblique.",
      needs: "selection (edge views)",
      source: "src/engine/default-commands.js:1557"
    },
    "format:linestyle-rectilinear": {
      args: [],
      dialog: "never",
      effect: "Sets the line style of the selected edge views to rectilinear.",
      needs: "selection (edge views)",
      source: "src/engine/default-commands.js:1552"
    },
    "format:linestyle-roundrect": {
      args: [],
      dialog: "never",
      effect: "Sets the line style of the selected edge views to rounded-rectilinear.",
      needs: "selection (edge views)",
      source: "src/engine/default-commands.js:1562"
    },
    "format:show-diagram-name": {
      args: [],
      dialog: "never",
      effect: "Toggles diagram-name display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4631"
    },
    "format:show-multiplicity": {
      args: [],
      dialog: "never",
      effect: "Toggles multiplicity display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4621"
    },
    "format:show-namespace": {
      args: [],
      dialog: "never",
      effect: "Toggles namespace display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4606"
    },
    "format:show-operation-signature": {
      args: [],
      dialog: "never",
      effect: "Toggles operation-signature display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4626"
    },
    "format:show-property": {
      args: [],
      dialog: "never",
      effect: "Toggles property display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4611"
    },
    "format:show-shadow": {
      args: [],
      dialog: "never",
      effect: "Toggles drop shadow on the selected views.",
      needs: "selection (views)",
      source: "src/engine/default-commands.js:1577"
    },
    "format:show-type": {
      args: [],
      dialog: "never",
      effect: "Toggles type display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4616"
    },
    "format:show-visibility": {
      args: [],
      dialog: "never",
      effect: "Toggles visibility display on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4601"
    },
    "format:stereotype": {
      args: [
        {
          name: "value",
          note: "Omitting it sets stereotypeDisplay to undefined.",
          optional: false,
          type: "string none|label|decoration|decoration-label|icon|icon-label"
        }
      ],
      dialog: "never",
      effect: "Sets the stereotype display mode of the selected views to the given value.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4565"
    },
    "format:stereotype-decoration": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to decoration.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4576"
    },
    "format:stereotype-decoration-label": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to decoration with label.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4581"
    },
    "format:stereotype-icon": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to icon.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4586"
    },
    "format:stereotype-icon-label": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to icon with label.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4591"
    },
    "format:stereotype-label": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to label.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4571"
    },
    "format:stereotype-none": {
      args: [],
      dialog: "never",
      effect: "Sets stereotype display of the selected views to none.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4566"
    },
    "format:suppress-attributes": {
      args: [],
      dialog: "never",
      effect: "Toggles attribute-compartment suppression on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4636"
    },
    "format:suppress-constraints": {
      args: [],
      dialog: "never",
      effect: "Toggles constraint-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:362"
    },
    "format:suppress-flow-properties": {
      args: [],
      dialog: "never",
      effect: "Toggles flow-property-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:368"
    },
    "format:suppress-literals": {
      args: [],
      dialog: "never",
      effect: "Toggles literal-compartment suppression on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4651"
    },
    "format:suppress-operations": {
      args: [],
      dialog: "never",
      effect: "Toggles operation-compartment suppression on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4641"
    },
    "format:suppress-parts": {
      args: [],
      dialog: "never",
      effect: "Toggles part-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:363"
    },
    "format:suppress-ports": {
      args: [],
      dialog: "never",
      effect: "Toggles port-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:364"
    },
    "format:suppress-properties": {
      args: [],
      dialog: "never",
      effect: "Toggles property-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:367"
    },
    "format:suppress-property-values": {
      args: [],
      dialog: "never",
      effect: "Toggles property-value-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:361"
    },
    "format:suppress-receptions": {
      args: [],
      dialog: "never",
      effect: "Toggles reception-compartment suppression on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4646"
    },
    "format:suppress-references": {
      args: [],
      dialog: "never",
      effect: "Toggles reference-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:365"
    },
    "format:suppress-values": {
      args: [],
      dialog: "never",
      effect: "Toggles value-compartment suppression on the selected SysML views.",
      needs: "selection (views)",
      source: "extensions/essential/sysml/sysml-commands.js:366"
    },
    "format:word-wrap": {
      args: [],
      dialog: "never",
      effect: "Toggles word wrap on the selected UML views.",
      needs: "selection (views)",
      source: "extensions/essential/uml/uml-commands.js:4596"
    },
    "gcp:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/gcp/gcp-commands.js:102"
    },
    "gcp:set-icon": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens the icon picker for a GCP element view and sets the chosen icon (and a name derived from it).",
      needs: "target view (options.view) of a GCPElement",
      note: "Nothing happens when options.view.model is not a GCPElement. The picker is an in-app modal; result is applied asynchronously but the handler returns undefined.",
      source: "extensions/essential/gcp/gcp-commands.js:103"
    },
    "gcp:set-product-icon": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens the icon picker for a GCP element view and sets the chosen icon and the product name derived from it.",
      needs: "target view (options.view) of a GCPElement",
      note: "No-op when the model is not a GCPElement.",
      source: "extensions/essential/gcp/gcp-commands.js:104"
    },
    "help:about": {
      args: [],
      dialog: "always",
      effect: "Opens the About modal.",
      source: "src/engine/default-commands.js:1655"
    },
    "help:check-for-updates": {
      args: [],
      dialog: "always",
      effect: "Opens the Check for Updates modal and, if no update is known, asks the main process to check.",
      note: "Also triggers a network update check (electron autoUpdater).",
      source: "src/engine/default-commands.js:1656"
    },
    "help:documentation": {
      args: [],
      dialog: "external",
      effect: "Opens the online documentation URL in the system browser.",
      note: "shell.openExternal; no in-app dialog.",
      source: "src/engine/default-commands.js:1666"
    },
    "help:forum": {
      args: [],
      dialog: "external",
      effect: "Opens the community forum URL in the system browser.",
      note: "shell.openExternal; no in-app dialog.",
      source: "src/engine/default-commands.js:1671"
    },
    "help:license-activation": {
      args: [],
      dialog: "always",
      effect: "Opens the License Activation modal.",
      source: "src/engine/default-commands.js:1661"
    },
    "help:release-notes": {
      args: [],
      dialog: "external",
      effect: "Opens the release notes URL in the system browser.",
      note: "shell.openExternal; no in-app dialog.",
      source: "src/engine/default-commands.js:1672"
    },
    "html-export:export": {
      args: [
        {
          name: "path",
          note: "Target folder used as-is; when omitted a folder picker opens and docs go into <picked>/html-docs.",
          optional: true,
          type: "string directory path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Exports HTML documentation (with diagram images) for the project into a folder, then shows a toast.",
      needs: "open project",
      note: "The folder picker is the synchronous showOpenDialog (blocks the renderer). Shows a success toast even if the picker was cancelled.",
      source: "extensions/default/html-export/main.js:249"
    },
    "java:configure": {
      args: [],
      dialog: "always",
      effect: "Opens the preference dialog on the Java section.",
      source: "user:staruml.java/main.js (0.9.7) _handleConfigure"
    },
    "java:generate": {
      args: [
        {
          name: "base",
          note: "When omitted an element picker modal opens.",
          optional: true,
          type: "Element (UMLPackage or classifier)"
        },
        {
          name: "path",
          note: "When omitted a folder dialog opens.",
          optional: true,
          type: "string output directory"
        },
        {
          name: "options",
          note: "Defaults to the java.gen.* preferences.",
          optional: true,
          type: "object generator options"
        }
      ],
      async: true,
      avoidWith: 3,
      dialog: "without-args",
      effect: "Generates Java sources for the base element into the directory.",
      note: "Use /generate_code. Not part of StarUML; present when the Java extension is installed.",
      source: "user:staruml.java/main.js (0.9.7) _handleGenerate"
    },
    "java:reverse": {
      args: [
        {
          name: "basePath",
          note: "Ignored: 0.9.7 analyzes only a folder picked in its dialog.",
          optional: true,
          type: "string source directory"
        }
      ],
      async: true,
      dialog: "always",
      effect: "Reverse-engineers Java sources into the project.",
      needs: "open project",
      note: "Use /reverse_code, which calls the analyzer with a path.",
      source: "user:staruml.java/main.js (0.9.7) _handleReverse"
    },
    "markdown-doc:toggle": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the Markdown documentation panel.",
      source: "extensions/default/markdown/main.js:197"
    },
    "mcp-ext:server-info": {
      args: [],
      dialog: "always",
      effect: "Shows the MCP extension's server status, access policy and endpoint list.",
      note: "Blocking native info message box (sendSync show-message-box); would stall the renderer, and with it the extension's HTTP server, until dismissed.",
      source: "src/main.ts"
    },
    "mcp-ext:set-token": {
      args: [
        {
          name: "value",
          note: "Trimmed and stored as the access token; an empty string clears it. Any non-undefined non-string value generates a random token without showing it.",
          optional: true,
          type: "string"
        }
      ],
      avoidWith: 1,
      dialog: "without-args",
      effect: "Stores an MCP extension access token in preferences (a random 24-byte base64url one when no string is given) and returns 'set' or 'cleared'.",
      note: "Without an argument it generates a token and shows it in an info dialog; a string is stored (trimmed), an empty string clears it.",
      source: "src/main.ts"
    },
    "mermaid:example-class-diagram": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled class diagram example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:227"
    },
    "mermaid:example-er-diagram": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled ER diagram example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:247"
    },
    "mermaid:example-flowchart": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled flowchart example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:242"
    },
    "mermaid:example-mindmap": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled mindmap example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:257"
    },
    "mermaid:example-requirement-diagram": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled requirement diagram example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:252"
    },
    "mermaid:example-sequence-diagram": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled sequence diagram example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:232"
    },
    "mermaid:example-state-diagram": {
      args: [],
      dialog: "never",
      effect: "Replaces the Mermaid dialog editor text with the bundled state diagram example.",
      needs: "mermaid dialog editor",
      note: "Only meaningful while the Mermaid dialog is open; throws if the dialog has never been opened in this session.",
      source: "extensions/default/mermaid/main.js:237"
    },
    "mermaid:generate-diagram": {
      args: [
        {
          name: "code",
          note: "First line must declare a supported type: classDiagram, sequenceDiagram, flowchart, erDiagram, mindmap, requirementDiagram, stateDiagram.",
          optional: false,
          type: "string Mermaid source"
        },
        {
          name: "base",
          note: "Container; when omitted or the Project, a new package is created under the project.",
          optional: true,
          type: "Element (e.g. UMLPackage)"
        }
      ],
      dialog: "never",
      effect: "Parses Mermaid source and creates the corresponding StarUML model and diagram.",
      needs: "open project",
      note: "Throws on unsupported type or parse error.",
      source: "extensions/default/mermaid/main.js:221"
    },
    "mermaid:show-mermaid-dialog": {
      args: [],
      dialog: "always",
      effect: "Opens the Mermaid editor modal; on OK generates a diagram from the entered code.",
      source: "extensions/default/mermaid/main.js:215"
    },
    "mindmap:add-node-left": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a mind-map node to the left of the node and links it with an oblique edge.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/mindmap/mindmap-commands.js:79"
    },
    "mindmap:add-node-right": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a mind-map node to the right of the node and links it with an oblique edge.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/mindmap/mindmap-commands.js:80"
    },
    "minimap:toggle": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the minimap panel.",
      source: "extensions/default/minimap/main.js:234"
    },
    "model:tag-editor": {
      args: [],
      dialog: "always",
      effect: "Opens the Tag Editor modal for the selected element.",
      needs: "selection",
      note: "No-op without a selection.",
      source: "src/engine/default-commands.js:1648"
    },
    "project:close": {
      args: [],
      dialog: "confirm",
      effect: "Closes the current window.",
      note: "Main-process close handler shows a blocking native Save/Don't Save/Cancel box when the project is modified; Save then runs project:save (save dialog if untitled).",
      source: "src/engine/default-commands.js:1503"
    },
    "project:export-diagram-all-to-jpegs": {
      args: [
        {
          name: "basePath",
          note: "When omitted a folder picker opens.",
          optional: true,
          type: "string directory path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Exports every diagram in the project as JPEG files into a folder.",
      needs: "open project",
      note: "Folder picker is the synchronous showOpenDialog (blocks the renderer). Shows a blocking native alert if the project has no diagrams.",
      source: "src/engine/default-commands.js:1488"
    },
    "project:export-diagram-all-to-pngs": {
      args: [
        {
          name: "basePath",
          note: "When omitted a folder picker opens.",
          optional: true,
          type: "string directory path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Exports every diagram in the project as PNG files into a folder.",
      needs: "open project",
      note: "Folder picker is the synchronous showOpenDialog (blocks the renderer). Shows a blocking native alert if the project has no diagrams.",
      source: "src/engine/default-commands.js:1483"
    },
    "project:export-diagram-all-to-svgs": {
      args: [
        {
          name: "basePath",
          note: "When omitted a folder picker opens.",
          optional: true,
          type: "string directory path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Exports every diagram in the project as SVG files into a folder.",
      needs: "open project",
      note: "Folder picker is the synchronous showOpenDialog (blocks the renderer). Shows a blocking native alert if the project has no diagrams.",
      source: "src/engine/default-commands.js:1493"
    },
    "project:export-diagram-to-jpeg": {
      args: [
        {
          name: "diagram",
          note: "Defaults to the current diagram.",
          optional: true,
          type: "Element (Diagram)"
        },
        {
          name: "fullPath",
          note: "When omitted a native save dialog opens; no extension is appended to a supplied path.",
          optional: true,
          type: "string file path"
        }
      ],
      async: true,
      avoidWith: 2,
      dialog: "without-args",
      effect: "Exports one diagram (default: current) as a JPEG file.",
      needs: "current diagram (if none passed)",
      note: "Shows a blocking native alert if no diagram is passed and none is current.",
      source: "src/engine/default-commands.js:1473"
    },
    "project:export-diagram-to-png": {
      args: [
        {
          name: "diagram",
          note: "Defaults to the current diagram.",
          optional: true,
          type: "Element (Diagram)"
        },
        {
          name: "fullPath",
          note: "When omitted a native save dialog opens; no extension is appended to a supplied path.",
          optional: true,
          type: "string file path"
        }
      ],
      async: true,
      avoidWith: 2,
      dialog: "without-args",
      effect: "Exports one diagram (default: current) as a PNG file.",
      needs: "current diagram (if none passed)",
      note: "Shows a blocking native alert if no diagram is passed and none is current.",
      source: "src/engine/default-commands.js:1468"
    },
    "project:export-diagram-to-svg": {
      args: [
        {
          name: "diagram",
          note: "Defaults to the current diagram.",
          optional: true,
          type: "Element (Diagram)"
        },
        {
          name: "fullPath",
          note: "When omitted a native save dialog opens; no extension is appended to a supplied path.",
          optional: true,
          type: "string file path"
        }
      ],
      async: true,
      avoidWith: 2,
      dialog: "without-args",
      effect: "Exports one diagram (default: current) as a SVG file.",
      needs: "current diagram (if none passed)",
      note: "Shows a blocking native alert if no diagram is passed and none is current.",
      source: "src/engine/default-commands.js:1478"
    },
    "project:export-fragment": {
      args: [
        {
          name: "element",
          note: "When omitted an element-picker modal opens.",
          optional: true,
          type: "Element"
        },
        {
          name: "fullPath",
          note: "When omitted a native save dialog opens.",
          optional: true,
          type: "string file path"
        }
      ],
      async: true,
      avoidWith: 2,
      dialog: "without-args",
      effect: "Exports an element subtree to a .mfj model fragment file.",
      needs: "open project",
      note: "No dialog only when both element and fullPath are supplied. Rejects with a user-cancelled marker on cancel; file errors show a blocking error box.",
      source: "src/engine/default-commands.js:1463"
    },
    "project:import-fragment": {
      args: [
        {
          name: "fullPath",
          note: "When omitted a native open dialog (synchronous) opens.",
          optional: true,
          type: "string file path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Imports a .mfj model fragment under the project root.",
      needs: "open project",
      source: "src/engine/default-commands.js:1458"
    },
    "project:new": {
      args: [
        {
          name: "template",
          note: "Defaults to the configured default template.",
          optional: true,
          type: "string template file path"
        }
      ],
      dialog: "confirm",
      effect: "Replaces the current project with a new one from a template (default template if none given).",
      note: "If the repository is modified, shows a blocking native Save/Don't Save/Cancel box; Save on an untitled project then opens a save dialog (not awaited). Returns false on cancel.",
      source: "src/engine/default-commands.js:1450"
    },
    "project:open": {
      args: [
        {
          name: "fullPath",
          note: "When omitted a native open dialog (synchronous) opens.",
          optional: true,
          type: "string .mdj file path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Opens a .mdj project: loads it in this window if the window is empty and unmodified, otherwise asks the main process to open it in a new window.",
      note: "With a path no dialog in practice: a modified or already-named project triggers a new window rather than the save-confirm box. A load failure shows a blocking error box.",
      source: "src/engine/default-commands.js:1451"
    },
    "project:open-recent": {
      args: [
        {
          name: "path",
          note: "Menu items pass the recent-file path as command-arg.",
          optional: false,
          type: "string .mdj file path"
        }
      ],
      dialog: "never",
      effect: "Opens a recently used project via project:open, or drops it from the recent list with an error toast if the file no longer exists.",
      note: "Delegates to project:open with a path, which opens in this window when empty/unmodified, otherwise in a new window; only a load failure shows an error box. Missing/omitted path just toasts. The project:open promise is not returned.",
      source: "extensions/default/open-recent/main.js:84"
    },
    "project:print-to-pdf": {
      args: [],
      async: true,
      dialog: "always",
      effect: "Opens the Print modal, then a save dialog, and writes the chosen diagrams to a PDF.",
      needs: "open project",
      note: "Arguments are ignored. Blocking alert if no diagram; error box on failure.",
      source: "src/engine/default-commands.js:1498"
    },
    "project:save": {
      args: [
        {
          name: "fullPath",
          note: "When omitted and the project is untitled, a native save dialog opens.",
          optional: true,
          type: "string .mdj file path"
        }
      ],
      async: true,
      avoidWith: 0,
      dialog: "without-args",
      effect: "Saves the project to the given path, or to its current file.",
      needs: "open project",
      note: "File errors show a blocking native error box.",
      source: "src/engine/default-commands.js:1452"
    },
    "project:save-as": {
      args: [],
      async: true,
      dialog: "always",
      effect: "Asks for a new file name with a native save dialog and saves the project there.",
      needs: "open project",
      note: "Path and save-as flag are pre-bound, so caller arguments cannot bypass the dialog.",
      source: "src/engine/default-commands.js:1453"
    },
    "relationship-view:select-related-element": {
      args: [],
      dialog: "never",
      effect: "Selects in the Model Explorer the element at the other end of the row picked in the Relationships panel.",
      needs: "Relationships panel row selected",
      source: "extensions/default/relationship-view/main.js:208"
    },
    "relationship-view:select-relationship": {
      args: [],
      dialog: "never",
      effect: "Selects in the Model Explorer the relationship of the row picked in the Relationships panel.",
      needs: "Relationships panel row selected",
      source: "extensions/default/relationship-view/main.js:209"
    },
    "relationship-view:toggle": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the Relationships panel.",
      source: "extensions/default/relationship-view/main.js:207"
    },
    "robustness:create": {
      args: [
        {
          name: "options",
          note: "id is UMLBoundary, UMLEntity or UMLControl (toolbox passes it); diagram is dereferenced unguarded.",
          optional: false,
          type: "object {id, diagram, x1, y1, x2, y2}"
        }
      ],
      dialog: "confirm",
      effect: "Creates a class stereotyped boundary/entity/control (icon display, compartments hidden) on the diagram.",
      needs: "current diagram (options.diagram)",
      note: "If the UML Standard Profile is not applied, shows a blocking confirm asking to apply it; OK applies it and creates the class, Cancel creates nothing. String errors surface as an alert dialog.",
      source: "extensions/default/robustness/main.js:86"
    },
    "staruml-v1:import": {
      args: [
        {
          name: "fullPath",
          note: "When omitted a native open dialog (synchronous) opens.",
          optional: true,
          type: "string .uml file path"
        }
      ],
      async: true,
      avoidWith: 1,
      dialog: "without-args",
      effect: "Imports a StarUML 1 (.uml) file, replacing the current project.",
      note: "Replaces the open project without any unsaved-changes confirmation.",
      source: "extensions/default/staruml-v1/main.js:111"
    },
    "sysml:add-composited-block": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a block below the view connected by a composite association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/sysml/sysml-commands.js:349"
    },
    "sysml:add-constraint-parameter": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a constraint parameter at a random spot on the constraint view.",
      needs: "current diagram, target view (options.view)",
      note: "Logs the options object to the console.",
      source: "extensions/essential/sysml/sysml-commands.js:358"
    },
    "sysml:add-port": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a port at a random spot on the block view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/sysml/sysml-commands.js:350"
    },
    "sysml:add-sub-requirement": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a requirement below the requirement view, owned by it, with a containment link.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/sysml/sysml-commands.js:348"
    },
    "sysml:create-block": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a Block next to the property's owner and assigns it as the type.",
      needs: "target view of a SysMLProperty or SysMLPort",
      note: "No-op unless options.view.model is a SysMLProperty or SysMLPort. Uses an in-app input dialog.",
      source: "extensions/essential/sysml/sysml-commands.js:352"
    },
    "sysml:create-constraint-block": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a ConstraintBlock two levels up from the property and assigns it as the type.",
      needs: "target view of a SysMLProperty",
      note: "No-op unless options.view.model is a SysMLProperty. Uses an in-app input dialog.",
      source: "extensions/essential/sysml/sysml-commands.js:357"
    },
    "sysml:create-item-flow": {
      args: [
        {
          name: "options",
          note: "options.model is a connector whose two end parts/ports are typed.",
          optional: false,
          type: "object {model, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks for the flow direction and creates an ItemFlow on the connector between the two end types.",
      needs: "selected connector (options.model)",
      note: "Throws a string assertion (shown as a toast from quick-edit) when either end is untyped; otherwise always shows the radio dialog.",
      source: "extensions/essential/sysml/sysml-commands.js:355"
    },
    "sysml:create-value-type": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a ValueType next to the property's owner and assigns it as the type.",
      needs: "target view of a SysMLProperty or SysMLPort",
      note: "No-op unless options.view.model is a SysMLProperty or SysMLPort. Uses an in-app input dialog.",
      source: "extensions/essential/sysml/sysml-commands.js:354"
    },
    "sysml:select-block": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker and sets the chosen Block as the property's or port's type.",
      needs: "target view of a SysMLProperty or SysMLPort",
      note: "No-op unless options.view.model is a SysMLProperty or SysMLPort.",
      source: "extensions/essential/sysml/sysml-commands.js:351"
    },
    "sysml:select-constraint-block": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker and sets the chosen ConstraintBlock as the property's type.",
      needs: "target view of a SysMLProperty",
      note: "No-op unless options.view.model is a SysMLProperty.",
      source: "extensions/essential/sysml/sysml-commands.js:356"
    },
    "sysml:select-value-type": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker and sets the chosen ValueType as the property's or port's type.",
      needs: "target view of a SysMLProperty or SysMLPort",
      note: "No-op unless options.view.model is a SysMLProperty or SysMLPort.",
      source: "extensions/essential/sysml/sysml-commands.js:353"
    },
    "tools:extension-manager": {
      args: [],
      dialog: "always",
      effect: "Opens the Extension Manager modal.",
      source: "src/engine/default-commands.js:1589"
    },
    "uml:add-activity-fork": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a fork node below the view leading to two new actions.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4557"
    },
    "uml:add-activity-join": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a join node above the view fed by two new actions.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4556"
    },
    "uml:add-aggregated-class": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class to the right connected by a shared-aggregation association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4435"
    },
    "uml:add-associated-actor": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an actor to the left of the use case connected by an association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4454"
    },
    "uml:add-associated-class": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class to the right connected by a plain association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4434"
    },
    "uml:add-associated-usecase": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a use case to the right of the actor connected by an association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4459"
    },
    "uml:add-choice": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a choice pseudostate below the view plus two branch states, all linked by transitions.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4527"
    },
    "uml:add-communicating-node": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a node to the right connected by a communication path.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4451"
    },
    "uml:add-compartment-item": {
      args: [
        {
          name: "options",
          note: "Normally built by quick-edit command-arg; type is a metaclass name such as UMLAttribute.",
          optional: false,
          type: "object {model, view, type, field, compartment, name-prefix, parent-model?, parent-view?, suppress-property?, model-init?, initializer?}"
        }
      ],
      dialog: "never",
      effect: "Adds a new item (e.g. attribute, operation, literal) to the owner's field, un-suppresses the compartment if needed and opens quick-edit on the new item.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4402"
    },
    "uml:add-composited-class": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class to the right connected by a composite association.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4436"
    },
    "uml:add-connected-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a lifeline to the right connected by a connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4493"
    },
    "uml:add-connected-part": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a sibling part next to the part view connected by a connector.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4446"
    },
    "uml:add-connection-point-reference": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a connection point reference on the submachine state view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4506"
    },
    "uml:add-constraint": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a constraint owned by the model, placed left of the view and attached by a constraint link.",
      needs: "current diagram, target view (options.view)",
      note: "Errors are logged and set options.result = false.",
      source: "extensions/essential/uml/uml-commands.js:4401"
    },
    "uml:add-create-message-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a new lifeline and a create message from the view's lifeline to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4473"
    },
    "uml:add-decision": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a decision node below the view plus two branch actions, linked by control flows.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4554"
    },
    "uml:add-dependant-package": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a package below the view that depends on it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4442"
    },
    "uml:add-depending-package": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a package above the view that the view depends on.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4443"
    },
    "uml:add-deployed-artifact": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an artifact below the node view with a deployment to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4452"
    },
    "uml:add-deployed-component": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a component below the node view with a deployment to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4453"
    },
    "uml:add-do-activity": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks for a behavior kind, then adds it to the state's doActivities compartment and opens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4511"
    },
    "uml:add-effect": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks for a behavior kind and adds it as an effect of the transition.",
      needs: "current diagram, target view (options.view)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4531"
    },
    "uml:add-entry-activity": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks for a behavior kind, then adds it to the state's entryActivities compartment and opens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4510"
    },
    "uml:add-exit-activity": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks for a behavior kind, then adds it to the state's exitActivities compartment and opens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4512"
    },
    "uml:add-extended-usecase": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a use case below the view that extends it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4456"
    },
    "uml:add-final-node": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an activity final node below the view with a control flow from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4559"
    },
    "uml:add-final-state": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a final state below the view with a transition from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4526"
    },
    "uml:add-fork": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a fork pseudostate below the view leading to two new states.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4529"
    },
    "uml:add-forward-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a lifeline below, a connector to it and a forward message on that connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4495"
    },
    "uml:add-forward-message-comm": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a forward message on the given connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4497"
    },
    "uml:add-found-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an endpoint and a found message from it to the lifeline.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4478"
    },
    "uml:add-included-usecase": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a use case below the view that it includes.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4455"
    },
    "uml:add-incoming-control-flow": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an action above the view with a control flow into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4542"
    },
    "uml:add-incoming-object-flow": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an object node above the view with an object flow into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4550"
    },
    "uml:add-incoming-transition": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a state above the view with a transition into the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4521"
    },
    "uml:add-initial-node": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an initial node above the view with a control flow into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4558"
    },
    "uml:add-initial-state": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an initial pseudostate above the view with a transition into it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4525"
    },
    "uml:add-input-pin": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an input pin on the action view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4536"
    },
    "uml:add-internal-transition": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an internal transition to the state's first region and opens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      note: "On a simple state (no regions) shows an info toast instead; no dialog.",
      source: "extensions/essential/uml/uml-commands.js:4513"
    },
    "uml:add-join": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a join pseudostate above the view fed by two new states.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4528"
    },
    "uml:add-linked-object": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an object to the right connected by a link.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4447"
    },
    "uml:add-lost-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an endpoint and a lost message from the lifeline to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4479"
    },
    "uml:add-merge": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a merge node above the view fed by two new actions.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4555"
    },
    "uml:add-message-from-gate": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a gate and a message from it to the lifeline.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4480"
    },
    "uml:add-message-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a new lifeline and a synchronous message from the view's lifeline to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4472"
    },
    "uml:add-message-to-gate": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a gate and a message from the lifeline to it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4481"
    },
    "uml:add-note": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a note to the right of the view (or edge label) attached by a note link.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4400"
    },
    "uml:add-operand": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an interaction operand to the combined fragment.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4492"
    },
    "uml:add-outgoing-control-flow": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an action below the view with a control flow from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4538"
    },
    "uml:add-outgoing-object-flow": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an object node below the view with an object flow from it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4546"
    },
    "uml:add-outgoing-transition": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a state below the view with a transition from the view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4517"
    },
    "uml:add-output-pin": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an output pin on the action view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4537"
    },
    "uml:add-part": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a part inside the classifier view, right of existing parts.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4438"
    },
    "uml:add-port": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a port on the classifier view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4437"
    },
    "uml:add-provided-interface": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an interface next to the view connected by an interface realization (lollipop); for an untyped port also creates and assigns a '<port>Type' class.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4432"
    },
    "uml:add-realizing-class": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class below the interface view that realizes it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4431"
    },
    "uml:add-region": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a region to the state.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4505"
    },
    "uml:add-reply-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a reply message reversing the given message (sequence diagram) or on the same connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      note: "Does nothing on other diagram types or when the sequence message does not join two lifelines.",
      source: "extensions/essential/uml/uml-commands.js:4486"
    },
    "uml:add-required-interface": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an interface next to the view connected by a dependency (socket).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4433"
    },
    "uml:add-reverse-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a lifeline below, a connector to it and a reverse message on that connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4496"
    },
    "uml:add-reverse-message-comm": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a reverse message on the given connector (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4501"
    },
    "uml:add-self-connector": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a self connector on the lifeline (communication diagram).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4494"
    },
    "uml:add-self-message": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a self message on the lifeline.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4477"
    },
    "uml:add-stereotype": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a stereotype below the metaclass view connected by an extension.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4560"
    },
    "uml:add-subactor": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an actor below the view generalizing it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4457"
    },
    "uml:add-subclass": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class below the view generalizing it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4427"
    },
    "uml:add-subinterface": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an interface below the view generalizing it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4429"
    },
    "uml:add-subpackage": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a package below the view owned by it with a containment link.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4441"
    },
    "uml:add-substereotype": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a stereotype below the view generalizing it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4561"
    },
    "uml:add-superactor": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an actor above the view as its parent actor.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4458"
    },
    "uml:add-superclass": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a class above the view as its superclass.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4428"
    },
    "uml:add-superinterface": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds an interface above the view as its super-interface.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4430"
    },
    "uml:add-superstereotype": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a stereotype above the view as its parent.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4562"
    },
    "uml:add-template-parameter-substitution": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a template parameter substitution to the template binding.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4423"
    },
    "uml:add-trigger": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a trigger event to the transition.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4530"
    },
    "uml:apply-profile": {
      args: [
        {
          name: "fullPath",
          optional: false,
          type: "string .mfj profile file path"
        },
        {
          name: "profileName",
          note: "When given and a profile of that name already exists at project root, toasts and returns false.",
          optional: true,
          type: "string"
        }
      ],
      dialog: "never",
      effect: "Imports a profile model fragment into the project root and returns the imported element.",
      needs: "open project",
      source: "extensions/essential/uml/uml-commands.js:4367"
    },
    "uml:apply-profile.uml-standard": {
      args: [],
      dialog: "never",
      effect: "Imports the bundled UML Standard Profile into the project (toast if already present).",
      needs: "open project",
      source: "extensions/essential/uml/uml-commands.js:4368"
    },
    "uml:create-model-and-view.frame": {
      args: [
        {
          name: "options",
          note: "Toolbox rubber-band rectangle; diagram defaults to the current one.",
          optional: true,
          type: "object {diagram?, x1, y1, x2, y2, ...}"
        }
      ],
      dialog: "always",
      effect: "Asks which model element the frame represents, then draws a frame for it on the diagram.",
      needs: "current diagram",
      note: "Element picker dialog every time; nothing is created on cancel.",
      source: "extensions/essential/uml/uml-commands.js:4380"
    },
    "uml:create-model.constraint": {
      args: [],
      dialog: "confirm",
      effect: "Creates a constraint under the selected element; for operations, behaviors and actions asks which constraint slot (pre/post/body etc.) to use.",
      needs: "selection",
      note: "Radio dialog only when the selection is a UMLOperation, UMLBehavior or UMLAction; otherwise it creates a plain owned constraint silently.",
      source: "extensions/essential/uml/uml-commands.js:4379"
    },
    "uml:create-model.do-activity": {
      args: [],
      dialog: "always",
      effect: "Asks for a behavior kind and creates it in the selected state's doActivities.",
      needs: "selection (UMLState)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4376"
    },
    "uml:create-model.effect": {
      args: [],
      dialog: "always",
      effect: "Asks for a behavior kind and creates it as an effect of the selected transition.",
      needs: "selection (UMLTransition)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4378"
    },
    "uml:create-model.entry-activity": {
      args: [],
      dialog: "always",
      effect: "Asks for a behavior kind and creates it in the selected state's entryActivities.",
      needs: "selection (UMLState)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4375"
    },
    "uml:create-model.exit-activity": {
      args: [],
      dialog: "always",
      effect: "Asks for a behavior kind and creates it in the selected state's exitActivities.",
      needs: "selection (UMLState)",
      note: "Always opens a radio dialog to choose OpaqueBehavior/Activity/StateMachine/Interaction.",
      source: "extensions/essential/uml/uml-commands.js:4377"
    },
    "uml:create-operation": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, adds the operation to the target lifeline's type and sets it as the message signature.",
      needs: "target view of a UMLMessage",
      note: "Shows an alert 'Lifeline should have a type.' when the target lifeline's role is untyped; a dialog appears either way.",
      source: "extensions/essential/uml/uml-commands.js:4484"
    },
    "uml:create-signal": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a signal in the collaboration's owner and sets it as the message signature.",
      needs: "target view of a UMLMessage",
      note: "In-app input dialog; skipped only if the message has no owner three levels up.",
      source: "extensions/essential/uml/uml-commands.js:4485"
    },
    "uml:create-state-condition-for-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a state/condition inside the timing-diagram lifeline view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4487"
    },
    "uml:create-time-segment": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a time segment on the timing-diagram lifeline view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4491"
    },
    "uml:create-type": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a class beside the attribute's owner and sets it as the attribute's type.",
      needs: "target view of a UMLAttribute",
      note: "No-op unless options.view.model is a UMLAttribute with an owner. In-app input dialog.",
      source: "extensions/essential/uml/uml-commands.js:4445"
    },
    "uml:create-type-for-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Prompts for a name, creates a class and sets it as the type of the lifeline's represented role.",
      needs: "target view of a UMLLifeline",
      note: "Shows an alert dialog instead when the lifeline does not represent an attribute (role); so some dialog appears either way.",
      source: "extensions/essential/uml/uml-commands.js:4468"
    },
    "uml:delete-compartment-item": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options.view is the compartment item view.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Deletes the item's model and moves the quick-edit to a neighbouring item.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4403"
    },
    "uml:move-down-compartment-item": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options.field names the owner field; parent-model optional.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Moves the compartment item one place down in its owner's list and reopens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4411"
    },
    "uml:move-up-compartment-item": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options.field names the owner field; parent-model optional.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Moves the compartment item one place up in its owner's list and reopens quick-edit on it.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4407"
    },
    "uml:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        },
        {
          name: "basePath",
          note: "Overrides the base directory the filename is resolved against (default: the UML extension dir).",
          optional: true,
          type: "string directory"
        }
      ],
      dialog: "external",
      effect: "Opens the named template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/uml/uml-commands.js:4365"
    },
    "uml:open-down-compartment-item": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Moves the quick-edit to the next visible compartment item (crossing compartments).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4419"
    },
    "uml:open-up-compartment-item": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Moves the quick-edit to the previous visible compartment item (crossing compartments).",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/uml/uml-commands.js:4415"
    },
    "uml:select-operation": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Lists the target lifeline type's (inherited) operations and sets the chosen one as the message signature.",
      needs: "target view of a UMLMessage",
      note: "Shows an alert 'Lifeline should have a type.' when the target lifeline's role is untyped; a dialog appears either way.",
      source: "extensions/essential/uml/uml-commands.js:4483"
    },
    "uml:select-owner-attribute": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded). options['set-model'] (lodash path) can retarget options.model, normally an association end.",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Lists the attributes of the opposite end's classifier and sets the chosen one as the end's owner attribute.",
      needs: "association end (options.model)",
      source: "extensions/essential/uml/uml-commands.js:4439"
    },
    "uml:select-signal": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker for a Signal and assigns it to the reception's signal or the message's signature.",
      needs: "target view of a UMLReception or UMLMessage",
      source: "extensions/essential/uml/uml-commands.js:4440"
    },
    "uml:select-type": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker for a classifier and sets it as the attribute's type.",
      needs: "target view of a UMLAttribute",
      note: "No-op unless options.view.model is a UMLAttribute.",
      source: "extensions/essential/uml/uml-commands.js:4444"
    },
    "uml:select-type-for-lifeline": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "always",
      effect: "Opens an element picker and sets the chosen classifier as the type of the lifeline's represented role.",
      needs: "target view of a UMLLifeline",
      note: "Shows an alert dialog instead when the lifeline does not represent an attribute (role); so some dialog appears either way.",
      source: "extensions/essential/uml/uml-commands.js:4464"
    },
    "uml:set-attribute-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses attribute text (visibility, name, type, multiplicity, default) and updates the attribute.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4384"
    },
    "uml:set-constraint-specification": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Sets the constraint's specification to the given text.",
      note: "Errors set options.result = false.",
      source: "extensions/essential/uml/uml-commands.js:4396"
    },
    "uml:set-lifeline-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses lifeline text and sets name, stereotype, selector and the type of the represented role.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4460"
    },
    "uml:set-message-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses message text and sets name, stereotype, assignment target and arguments.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4482"
    },
    "uml:set-name-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses '<<stereotype>> visibility name' text and sets the element's name, visibility and stereotype.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed. options['set-model'] (lodash path) retargets options.model first.",
      source: "extensions/essential/uml/uml-commands.js:4383"
    },
    "uml:set-note-text": {
      args: [
        {
          name: "options",
          note: "options.view is the note view.",
          optional: false,
          type: "object {view, value}"
        }
      ],
      dialog: "never",
      effect: "Sets the note view's text.",
      source: "extensions/essential/uml/uml-commands.js:4448"
    },
    "uml:set-object-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses 'name: Classifier' text and sets the object's name, visibility, stereotype and classifier.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4449"
    },
    "uml:set-operation-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses operation text and rewrites the operation's name, visibility, stereotype, parameters and return type.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4388"
    },
    "uml:set-slot-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses slot text and sets the slot's name, visibility, stereotype, type and value.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4450"
    },
    "uml:set-template-parameter-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses template-parameter text and sets its name, stereotype, type and default.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4392"
    },
    "uml:set-transition-expression": {
      args: [
        {
          name: "options",
          note: "options.value is the text typed in the quick-edit; options.model the element to update.",
          optional: false,
          type: "object {model, value, ...}"
        }
      ],
      dialog: "never",
      effect: "Parses 'triggers [guard] / effect' text and rewrites the transition's triggers, guard and effects.",
      note: "A parse failure sets options.result = false instead of throwing; nothing is changed.",
      source: "extensions/essential/uml/uml-commands.js:4532"
    },
    "view:actual-size": {
      args: [],
      dialog: "never",
      effect: "Resets diagram zoom to 100%, keeping the view centre.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1625"
    },
    "view:close-all-diagrams": {
      args: [],
      dialog: "never",
      effect: "Closes all open diagram tabs.",
      source: "src/engine/default-commands.js:1608"
    },
    "view:close-diagram": {
      args: [],
      dialog: "never",
      effect: "Closes the current diagram tab.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1598"
    },
    "view:close-other-diagrams": {
      args: [],
      dialog: "never",
      effect: "Closes all diagram tabs except the current one.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1603"
    },
    "view:command-palette": {
      args: [],
      dialog: "always",
      effect: "Opens the command palette modal.",
      source: "src/engine/default-commands.js:1597"
    },
    "view:editors": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the right-hand Editors panel (property/style/documentation editors).",
      source: "src/views/editors-holder-view.js:124"
    },
    "view:fit-to-window": {
      args: [],
      dialog: "never",
      effect: "Zooms (max 100%) and scrolls so the whole current diagram fits the viewport.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1630"
    },
    "view:navigator": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the Navigator panel.",
      source: "src/views/navigator-view.js:159"
    },
    "view:next-diagram": {
      args: [],
      dialog: "never",
      effect: "Switches to the next open diagram tab.",
      source: "src/engine/default-commands.js:1613"
    },
    "view:previous-diagram": {
      args: [],
      dialog: "never",
      effect: "Switches to the previous open diagram tab.",
      source: "src/engine/default-commands.js:1618"
    },
    "view:quick-find": {
      args: [],
      dialog: "always",
      effect: "Opens the Quick Find modal for searching elements by name.",
      needs: "open project",
      source: "src/engine/default-commands.js:1596"
    },
    "view:rename-diagram": {
      args: [],
      dialog: "always",
      effect: "Opens a text-input modal to rename the current diagram.",
      needs: "current diagram",
      note: "Throws if there is no current diagram.",
      source: "src/engine/default-commands.js:1641"
    },
    "view:show-grid": {
      args: [],
      dialog: "never",
      effect: "Toggles grid visibility in the diagram editor.",
      source: "src/engine/default-commands.js:1635"
    },
    "view:sidebar": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the sidebar.",
      source: "src/views/sidebar-view.js:158"
    },
    "view:snap-to-grid": {
      args: [],
      dialog: "never",
      effect: "Toggles snap-to-grid in the diagram editor.",
      source: "src/engine/default-commands.js:1636"
    },
    "view:statusbar": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the status bar.",
      source: "src/views/statusbar-view.js:201"
    },
    "view:toolbar": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the toolbar.",
      source: "src/views/toolbar-view.js:104"
    },
    "view:toolbox": {
      args: [],
      dialog: "never",
      effect: "Shows or hides the toolbox.",
      source: "src/views/toolbox-view.js:432"
    },
    "view:zoom-in": {
      args: [],
      dialog: "never",
      effect: "Increases diagram zoom by 10%, keeping the view centre.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1623"
    },
    "view:zoom-out": {
      args: [],
      dialog: "never",
      effect: "Decreases diagram zoom by 10%, keeping the view centre.",
      needs: "current diagram",
      source: "src/engine/default-commands.js:1624"
    },
    "wireframe:add-tab": {
      args: [
        {
          name: "options",
          note: "Quick-edit options; options.view is the anchor View on the current diagram (required, dereferenced unguarded).",
          optional: false,
          type: "object {view, model, property, ...}"
        }
      ],
      dialog: "never",
      effect: "Adds a tab inside the given wireframe tab-list view.",
      needs: "current diagram, target view (options.view)",
      source: "extensions/essential/wireframe/wireframe-commands.js:63"
    },
    "wireframe:new-from-template": {
      args: [
        {
          name: "filename",
          note: "Menu passes e.g. a bundled .mdj under the extension's templates folder.",
          optional: false,
          type: "string template path relative to the extension dir"
        }
      ],
      dialog: "external",
      effect: "Opens the named bundled template in a new StarUML window.",
      note: "Asks the main process (application:new-from-template) to open a new StarUML window loaded with the template; nothing changes in this window and no dialog is shown. The new window is a separate renderer.",
      source: "extensions/essential/wireframe/wireframe-commands.js:62"
    }
  },
  version: "7.1.1"
};

// src/dialog-guard.ts
var DialogRefused = class extends Error {
  constructor(dialog) {
    super(`Refused to open ${dialog}`);
    this.dialog = dialog;
    this.name = "DialogRefused";
  }
  dialog;
};
function dialogMethods() {
  const found = [];
  const dialogs = app.dialogs;
  for (const name of methodNames(dialogs)) {
    if (name.startsWith("show")) found.push([dialogs, name, `dialogs.${name}`]);
  }
  for (const [key, value] of Object.entries(app)) {
    const host = value;
    if (key !== "dialogs" && host !== null && typeof host === "object" && typeof host.showDialog === "function") {
      found.push([host, "showDialog", `${key}.showDialog`]);
    }
  }
  return found;
}
function methodNames(host) {
  const names = new Set(Object.keys(host));
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(host))) {
    names.add(name);
  }
  return [...names].filter((n) => typeof host[n] === "function");
}
async function withoutDialogs(what, run) {
  const attempted = [];
  const restore = [];
  for (const [host, name, label] of dialogMethods()) {
    const own2 = Object.getOwnPropertyDescriptor(host, name);
    host[name] = () => {
      attempted.push(label);
      throw new DialogRefused(label);
    };
    restore.push(() => {
      if (own2) Object.defineProperty(host, name, own2);
      else delete host[name];
    });
  }
  let outcome;
  try {
    outcome = { value: await run() };
  } catch (error2) {
    outcome = { error: error2 };
  } finally {
    for (const undo2 of restore) undo2();
  }
  if (attempted.length > 0) {
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${what} opens a dialog (${attempted[0]}) that would wait for someone at StarUML; pass the arguments that avoid it or use a dedicated endpoint`,
      { dialogs: attempted }
    );
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

// src/serialize.ts
var MAX_DEPTH = 8;
function isElement(value) {
  return value instanceof type.Element;
}
function ref(elem) {
  return { $ref: elem._id };
}
function summarize(elem) {
  return {
    _id: elem._id,
    _type: elem.constructor.name,
    name: typeof elem.name === "string" ? elem.name : null,
    _parent: elem._parent ? elem._parent._id : null
  };
}
function reported(attr) {
  return attr.name !== "_id" && attr.name !== "_parent" && !attr.transient;
}
function serialize(elem, projection = {}) {
  const { fields } = projection;
  if (!fields && projection.summary !== false) return { ...summarize(elem) };
  const out = {
    _id: elem._id,
    _type: elem.constructor.name
  };
  const wanted = fields ? new Set(fields) : null;
  if (!wanted || wanted.has("_parent")) {
    out._parent = elem._parent ? elem._parent._id : null;
  }
  const depth = projection.depth ?? 0;
  for (const attr of app.metamodels.getMetaAttributes(out._type)) {
    if (!reported(attr) || wanted && !wanted.has(attr.name)) continue;
    const value = elem[attr.name];
    if (value === void 0) continue;
    out[attr.name] = convert(attr, value, { ...projection, depth });
  }
  return out;
}
function convert(attr, value, projection) {
  const owned = (child) => projection.depth > 0 ? serialize(child, { ...projection, depth: projection.depth - 1 }) : ref(child);
  switch (attr.kind) {
    case "ref":
      return isElement(value) ? ref(value) : null;
    case "refs":
      return Array.isArray(value) ? value.filter(isElement).map(ref) : [];
    case "obj":
      return isElement(value) ? owned(value) : null;
    case "objs":
      return Array.isArray(value) ? value.filter(isElement).map(owned) : [];
    case "var":
      return isElement(value) ? ref(value) : value;
    case "custom":
      return hasWrite(value) ? value.__write() : null;
    default:
      return value;
  }
}
function hasWrite(value) {
  return typeof value === "object" && value !== null && typeof value.__write === "function";
}
function serializeValue(value, projection = {}) {
  if (value === void 0 || value === null) return null;
  if (isElement(value)) return serialize(value, projection);
  if (Array.isArray(value))
    return value.map((item) => serializeValue(item, projection));
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[non-serializable]";
  }
}

// src/schemas.ts
function id(description) {
  return doc(string2().check(_minLength(1)), description);
}
function typeName(description) {
  return doc(string2().check(_minLength(1)), description);
}
function text2(description) {
  return doc(string2(), description);
}
function coordinate(description) {
  return optional(doc(number2(), description));
}
function projectionShape() {
  return {
    summary: optional(
      doc(
        boolean2(),
        "Default true: each element is {_id, _type, name, _parent}. False returns every saved attribute. Ignored when 'fields' is given."
      )
    ),
    fields: optional(
      doc(
        array(string2().check(_minLength(1))),
        "Attribute names to return besides _id and _type, e.g. ['name', 'attributes']; '_parent' is accepted. Names an element lacks are omitted."
      )
    ),
    depth: optional(
      doc(
        int().check(_gte(0), _lte(MAX_DEPTH)),
        "Levels of owned elements (ownedElements, attributes, ownedViews, ...) to expand with the same projection. Default 0: owned elements are {$ref: id}."
      )
    )
  };
}
function elementSchema() {
  return doc(
    looseObject({
      _id: string2(),
      _type: doc(string2(), "Metamodel class name."),
      name: optional(nullable(string2())),
      _parent: optional(
        doc(nullable(string2()), "Owner id; null for the project.")
      )
    }),
    "Element projection. Reference attributes are {$ref: id}; owned elements are {$ref: id} or, with depth > 0, nested elements."
  );
}
function properties(description) {
  return optional(doc(record(string2(), unknown()), description));
}
function reference(description) {
  return doc(
    union([
      string2().check(_minLength(1)),
      object({ $ref: string2().check(_minLength(1)) })
    ]),
    description
  );
}
function typeValue(description) {
  return doc(
    union([string2(), object({ $ref: string2().check(_minLength(1)) })]),
    description
  );
}
var ATTRIBUTE_VALUES_HELP = "Initial attribute values by name, as /introspect lists them: plain values for prim/enum attributes, an id or {$ref: id} for references, arrays of those for reference lists.";

// src/handlers/commands.ts
var getAllCommands = defineEndpoint({
  path: "/get_all_commands",
  description: "Ids of every registered command.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: object({ count: int(), ids: array(string2()) }),
  handle: () => {
    const ids2 = Object.keys(app.commands.commands).sort();
    return { count: ids2.length, ids: ids2 };
  }
});
var CATALOGUE_VERSION = command_catalogue_default.version;
var COMMANDS = command_catalogue_default.commands;
function commandInfo(id2) {
  return Object.hasOwn(COMMANDS, id2) ? COMMANDS[id2] : void 0;
}
function refuseDialog(id2, args) {
  const info = commandInfo(id2);
  if (info?.dialog === "always") {
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${id2} always opens a dialog that would wait for someone at StarUML (${info.effect})${info.note ? ` ${info.note}` : ""}`,
      { dialog: "always" }
    );
  }
  const needed = info?.avoidWith ?? 0;
  if (info?.dialog === "without-args" && args.length < needed) {
    const names = info.args.slice(0, needed).map((a) => a.name);
    throw new ApiError(
      "DIALOG_REQUIRED",
      `${id2} opens a dialog unless given ${names.join(", ")}; pass ${needed} argument${needed === 1 ? "" : "s"}`,
      { dialog: "without-args", args: names }
    );
  }
}
var argSchema = () => object({
  name: string2(),
  type: string2(),
  optional: boolean2(),
  note: optional(string2())
});
var describeCommands = defineEndpoint({
  path: "/describe_commands",
  description: "Arguments, effect and dialog behaviour of registered commands (docs/commands.md), so /execute_command can be called without opening a dialog.",
  readOnly: true,
  destructive: false,
  request: object({
    ids: optional(
      doc(
        array(string2().check(_minLength(1))),
        "Command ids; default every registered and every catalogued command."
      )
    )
  }),
  response: object({
    catalogue: doc(string2(), "StarUML version the catalogue was read from."),
    count: int(),
    commands: array(
      object({
        id: string2(),
        registered: boolean2(),
        dialog: doc(
          string2(),
          "never, always, without-args, confirm, external, or unknown for a command not in the catalogue."
        ),
        effect: optional(string2()),
        args: optional(array(argSchema())),
        avoidWith: optional(
          doc(int(), "without-args: arguments that avoid the dialog.")
        ),
        needs: optional(string2()),
        async: optional(boolean2()),
        note: optional(string2()),
        source: optional(string2())
      })
    )
  }),
  handle: (input) => {
    const ids2 = input.ids ?? [
      .../* @__PURE__ */ new Set([
        ...Object.keys(app.commands.commands),
        ...Object.keys(COMMANDS)
      ])
    ].sort();
    const commands = ids2.map((id2) => {
      const info = commandInfo(id2);
      return {
        id: id2,
        registered: Object.hasOwn(app.commands.commands, id2),
        ...info ?? { dialog: "unknown" }
      };
    });
    return { catalogue: CATALOGUE_VERSION, count: commands.length, commands };
  }
});
var executeCommand = defineEndpoint({
  path: "/execute_command",
  description: "Run a registered StarUML command (see /describe_commands for arguments). Commands can do anything the UI can, including deleting data. A command that would open a dialog is refused with DIALOG_REQUIRED instead of waiting for someone at StarUML.",
  readOnly: false,
  destructive: true,
  request: object({
    id: id("Command id, e.g. 'edit.undo'."),
    args: optional(doc(array(unknown()), "Positional arguments.")),
    ...projectionShape()
  }),
  response: object({
    id: string2(),
    result: doc(
      unknown(),
      "The command's return value; elements are projected like any element."
    )
  }),
  handle: async (input) => {
    if (!Object.hasOwn(app.commands.commands, input.id)) {
      throw new ApiError("NOT_FOUND", `Command not registered: ${input.id}`);
    }
    const args = input.args ?? [];
    refuseDialog(input.id, args);
    let result;
    try {
      result = await withoutDialogs(
        `Command ${input.id}`,
        () => app.commands.execute(input.id, ...args)
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        "STARUML_ERROR",
        `Command ${input.id} threw: ${errorMessage(err)}`
      );
    }
    return { id: input.id, result: serializeValue(result, input) };
  }
});

// src/handlers/codegen.ts
var import_node_fs = require("node:fs");
var import_node_module = require("node:module");
var import_node_path = require("node:path");

// src/lookup.ts
function requireElement(id2, role = "Element") {
  const elem = app.repository.get(id2);
  if (!elem) throw new ApiError("NOT_FOUND", `${role} not found: ${id2}`);
  return elem;
}
function requireDiagram(id2, role = "Diagram") {
  const elem = app.repository.get(id2);
  if (!elem || !(elem instanceof type.Diagram)) {
    throw new ApiError("NOT_FOUND", `${role} not found: ${id2}`);
  }
  return elem;
}
function requireView(id2, role = "View") {
  const elem = app.repository.get(id2);
  if (!elem || !(elem instanceof type.View)) {
    throw new ApiError("NOT_FOUND", `${role} not found: ${id2}`);
  }
  return elem;
}
function requireTypeName(name) {
  if (!Object.hasOwn(type, name)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown element type: ${name}`);
  }
}
function requireProject() {
  const project = app.project.getProject();
  if (!project) throw new ApiError("NO_PROJECT", "No project is open");
  return project;
}

// src/handlers/codegen.ts
var GENERATORS = {
  java: { extension: "staruml.java", analyzer: "code-analyzer.js" },
  cpp: { extension: "staruml.cpp", analyzer: "code-analyzer.js" },
  csharp: { extension: "staruml.csharp", analyzer: "code-analyzer.js" },
  python: { extension: "staruml.python", analyzer: null }
};
var LANGUAGES = Object.keys(GENERATORS);
var generateCommand = (language) => `${language}:generate`;
var nodeRequire = (0, import_node_module.createRequire)(__filename);
function extensionDir(extension) {
  const suffix = `${import_node_path.sep}${extension}${import_node_path.sep}main.js`;
  const main = Object.keys(nodeRequire.cache).find((p) => p.endsWith(suffix));
  return main === void 0 ? null : (0, import_node_path.dirname)(main);
}
function preferenceOptions(dir, section) {
  const file = (0, import_node_path.join)(dir, "preferences", "preference.json");
  if (!(0, import_node_fs.existsSync)(file)) return {};
  const { id: prefix, schema = {} } = JSON.parse(
    (0, import_node_fs.readFileSync)(file, "utf-8")
  );
  const start = `${prefix}.${section}.`;
  return Object.fromEntries(
    Object.entries(schema).filter(([key, item]) => key.startsWith(start) && item.type !== "section").map(([key]) => [key.slice(start.length), app.preferences.get(key)])
  );
}
function requireGenerator(language) {
  const dir = extensionDir(GENERATORS[language].extension);
  if (dir === null) {
    throw new ApiError(
      "NOT_FOUND",
      `The ${language} code generator (${GENERATORS[language].extension}) is not installed; install it from Tools > Extension Manager`
    );
  }
  return dir;
}
function snapshot(dir) {
  const files = /* @__PURE__ */ new Map();
  const visit = (at) => {
    for (const entry of (0, import_node_fs.readdirSync)(at, { withFileTypes: true })) {
      const full = (0, import_node_path.join)(at, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.set((0, import_node_path.relative)(dir, full), (0, import_node_fs.statSync)(full).mtimeMs);
    }
  };
  visit(dir);
  return files;
}
var absoluteDir = (description) => doc(
  string2().check(refine((p) => (0, import_node_path.isAbsolute)(p), "must be an absolute path")),
  description
);
var languageField = () => doc(_enum(LANGUAGES), "Generator language: java, cpp, csharp or python.");
var optionsField = (description) => optional(doc(record(string2(), unknown()), description));
var listCodeGenerators = defineEndpoint({
  path: "/list_code_generators",
  description: "Which code generator extensions are installed, for /generate_code and /reverse_code, with the options each takes from its preferences.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: object({
    generators: array(
      object({
        language: string2(),
        extension: string2(),
        installed: boolean2(),
        reverse: doc(boolean2(), "Whether /reverse_code supports it."),
        path: optional(doc(string2(), "Extension directory, if installed.")),
        generateOptions: optional(record(string2(), unknown())),
        reverseOptions: optional(record(string2(), unknown()))
      })
    )
  }),
  handle: () => ({
    generators: LANGUAGES.map((language) => {
      const { extension, analyzer } = GENERATORS[language];
      const dir = extensionDir(extension);
      return {
        language,
        extension,
        installed: dir !== null,
        reverse: analyzer !== null,
        ...dir !== null && {
          path: dir,
          generateOptions: preferenceOptions(dir, "gen"),
          ...analyzer !== null && {
            reverseOptions: preferenceOptions(dir, "rev")
          }
        }
      };
    })
  })
});
var generateCode = defineEndpoint({
  path: "/generate_code",
  description: "Generate source code from a model element with an installed generator extension (Tools > <Language> > Generate Code) into a directory, and list the files written.",
  readOnly: false,
  destructive: true,
  request: object({
    language: languageField(),
    baseId: id(
      "Element to generate from: a package or model generates its whole tree, a class or interface one file."
    ),
    path: absoluteDir(
      "Absolute output directory; created if missing. A package becomes a subdirectory named after it, and the Java generator fails if that already exists."
    ),
    options: optionsField(
      "Generator options by name, e.g. {indentSpaces: 2, javaDoc: false} for Java; the rest come from the generator's preferences (see /list_code_generators)."
    )
  }),
  response: object({
    language: string2(),
    base: string2(),
    path: string2(),
    count: int(),
    files: doc(
      array(string2()),
      "Files created or rewritten, relative to path, sorted."
    )
  }),
  handle: async (input) => {
    const dir = requireGenerator(input.language);
    const command = generateCommand(input.language);
    if (!Object.hasOwn(app.commands.commands, command)) {
      throw new ApiError(
        "STARUML_ERROR",
        `${GENERATORS[input.language].extension} registered no ${command} command`
      );
    }
    const base = requireElement(input.baseId, "Base element");
    try {
      (0, import_node_fs.mkdirSync)(input.path, { recursive: true });
    } catch (err) {
      throw new ApiError(
        "STARUML_ERROR",
        `Cannot create ${input.path}: ${errorMessage(err)}`
      );
    }
    const before = snapshot(input.path);
    const options = { ...preferenceOptions(dir, "gen"), ...input.options };
    await guarded(
      command,
      () => app.commands.execute(command, base, input.path, options)
    );
    const files = [...snapshot(input.path)].filter(([file, mtime]) => before.get(file) !== mtime).map(([file]) => file).sort();
    return {
      language: input.language,
      base: base._id,
      path: input.path,
      count: files.length,
      files
    };
  }
});
async function guarded(what, run) {
  try {
    await withoutDialogs(what, run);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("STARUML_ERROR", `${what} failed: ${errorMessage(err)}`);
  }
}
var reverseCode = defineEndpoint({
  path: "/reverse_code",
  description: "Reverse-engineer a source directory into the open project with an installed generator extension (Tools > <Language> > Reverse Code), and summarize the elements it added.",
  readOnly: false,
  destructive: false,
  request: object({
    language: languageField(),
    path: absoluteDir(
      "Absolute directory whose source files are read, recursively."
    ),
    options: optionsField(
      "Analyzer options by name, e.g. {association: false, publicOnly: true} for Java; the rest come from its preferences."
    )
  }),
  response: object({
    language: string2(),
    path: string2(),
    created: doc(int(), "Elements added, views and diagrams included."),
    roots: doc(
      array(
        object({
          _id: string2(),
          _type: string2(),
          name: optional(nullable(string2())),
          _parent: optional(nullable(string2()))
        })
      ),
      "The added elements whose owner existed before, e.g. the top-level packages."
    )
  }),
  handle: async (input) => {
    const { analyzer } = GENERATORS[input.language];
    if (analyzer === null) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `language: the ${input.language} generator has no reverse engineering`
      );
    }
    const dir = requireGenerator(input.language);
    requireProject();
    if (!(0, import_node_fs.existsSync)(input.path) || !(0, import_node_fs.statSync)(input.path).isDirectory()) {
      throw new ApiError("NOT_FOUND", `No such directory: ${input.path}`);
    }
    const module2 = (0, import_node_module.createRequire)((0, import_node_path.join)(dir, "main.js"))(
      `./${analyzer}`
    );
    const before = new Set(Object.keys(app.repository.getIdMap()));
    const options = { ...preferenceOptions(dir, "rev"), ...input.options };
    await guarded(
      `${input.language} reverse engineering`,
      () => module2.analyze(input.path, options)
    );
    const added = Object.entries(app.repository.getIdMap()).filter(([key]) => !before.has(key)).map(([, elem]) => elem);
    const fresh = new Set(added);
    return {
      language: input.language,
      path: input.path,
      created: added.length,
      roots: added.filter((e) => !e._parent || !fresh.has(e._parent)).map(summarize)
    };
  }
});

// src/handlers/debug.ts
var INTROSPECTED_MANAGERS = [
  "commands",
  "project",
  "repository",
  "factory",
  "engine",
  "diagrams",
  "preferences",
  "selections",
  "dialogs",
  "metamodels"
];
function describeSurface(target) {
  if (target === null || typeof target !== "object") {
    return { type: typeof target, keys: null, proto: null };
  }
  return {
    type: "object",
    keys: Object.keys(target).sort(),
    proto: Object.getOwnPropertyNames(Object.getPrototypeOf(target)).sort()
  };
}
var surfaceSchema = () => object({
  type: string2(),
  keys: nullable(array(string2())),
  proto: nullable(array(string2()))
});
var debugResponse = object({
  app_keys: array(string2()),
  ...Object.fromEntries(
    INTROSPECTED_MANAGERS.map((name) => [name, surfaceSchema()])
  )
});
var debug = defineEndpoint({
  path: "/debug",
  description: "Own keys of `app` and the own and prototype members of its managers.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: debugResponse,
  handle: () => {
    const data = { app_keys: Object.keys(app).sort() };
    for (const name of INTROSPECTED_MANAGERS) {
      data[name] = describeSurface(app[name]);
    }
    return data;
  }
});

// src/metamodel.ts
function isMetaClass(name) {
  return Object.hasOwn(meta, name) && meta[name].kind === "class";
}
function lineage(name) {
  const out = [];
  for (let t = name; t; t = meta[t]?.super) out.push(t);
  return out;
}
function attributeOf(typeName2, name) {
  return app.metamodels.getMetaAttributes(typeName2).find((attr) => attr.name === name);
}
function ownerField(owner, childType) {
  let best = null;
  for (const attr of app.metamodels.getMetaAttributes(owner.constructor.name)) {
    if (attr.kind !== "objs" || !app.metamodels.isKindOf(childType, attr.type))
      continue;
    const depth = lineage(attr.type).length;
    if (!best || depth > best.depth) best = { name: attr.name, depth };
  }
  return best?.name ?? null;
}
function resolveOwnerField(owner, childType, field) {
  const ownerType = owner.constructor.name;
  if (field === void 0) {
    const chosen = ownerField(owner, childType);
    if (!chosen) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${ownerType} has no list that holds ${childType}`
      );
    }
    return chosen;
  }
  const attr = attributeOf(ownerType, field);
  if (!attr || attr.kind !== "objs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${ownerType} has no owned-element list '${field}'`
    );
  }
  if (!app.metamodels.isKindOf(childType, attr.type)) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${ownerType}.${field} holds ${attr.type}, not ${childType}`
    );
  }
  return field;
}
function relationshipKind(typeName2) {
  if (app.metamodels.isKindOf(typeName2, "DirectedRelationship"))
    return "directed";
  if (app.metamodels.isKindOf(typeName2, "UndirectedRelationship"))
    return "undirected";
  return null;
}

// src/handlers/introspect.ts
var SECTIONS = ["factory", "metamodel", "toolbox", "endpoints"];
var attributeSchema = () => object({
  name: string2(),
  kind: doc(
    _enum(["prim", "enum", "var", "ref", "refs", "obj", "objs", "custom"]),
    "prim/enum: value; ref/refs: reference(s) to other elements; obj/objs: owned element(s); var: a reference or a plain value; custom: an object StarUML stores as a string (Font, Points)."
  ),
  type: doc(
    string2(),
    "Integer, Real, String, Boolean or Image for prim; otherwise a metamodel type name."
  ),
  default: optional(unknown()),
  transient: optional(
    doc(boolean2(), "Runtime state; not saved or returned.")
  ),
  options: optional(
    doc(array(string2()), "Suggested values, e.g. multiplicities.")
  )
});
var metaTypeSchema = () => object({
  kind: _enum(["class", "enum"]),
  super: nullable(string2()),
  supers: doc(array(string2()), "Ancestors, nearest first."),
  attributes: doc(
    array(attributeSchema()),
    "Own attributes; with inherited: true, inherited ones first."
  ),
  literals: optional(array(string2())),
  viewType: doc(
    nullable(string2()),
    "View class that shows this model class on a diagram."
  ),
  viewTypes: optional(
    doc(
      array(string2()),
      "Diagrams only: view classes the diagram accepts."
    )
  ),
  relationship: doc(
    nullable(_enum(["directed", "undirected"])),
    "directed: source/target; undirected: end1/end2 elements."
  ),
  isView: boolean2(),
  isDiagram: boolean2(),
  creatable: doc(
    object({
      model: boolean2(),
      modelAndView: boolean2(),
      diagram: boolean2()
    }),
    "Which factory registers this name: /create_element, /create_element_with_view and /create_relationship, /create_diagram."
  )
});
var modelAndViewSchema = () => object({
  id: string2(),
  modelType: nullable(string2()),
  viewType: nullable(string2()),
  relationship: nullable(_enum(["directed", "undirected"]))
});
var toolboxSchema = () => object({
  groups: array(
    object({
      id: string2(),
      title: string2(),
      diagramTypes: doc(
        nullable(array(string2())),
        "Diagrams the group is shown for; null for every diagram."
      )
    })
  ),
  items: doc(
    array(
      object({
        id: doc(
          string2(),
          "Pass as 'type' to /create_element_with_view, /create_edge_with_view or /create_relationship."
        ),
        group: string2(),
        title: string2(),
        rubberband: doc(
          string2(),
          "line for edges; rect or point for nodes."
        ),
        creates: doc(string2(), "The model-and-view id the item creates."),
        options: doc(
          record(string2(), unknown()),
          "Presets the item adds, e.g. model-init attribute values or parasitic: true for elements placed on a host view (pass containerViewId)."
        ),
        command: optional(
          doc(
            string2(),
            "A command other than factory:create-model-and-view; such items cannot be created through this API unless `creates` is itself a model-and-view id."
          )
        )
      })
    ),
    "The diagram editor's palette entries; an id in several groups is listed once."
  )
});
var manifestEntrySchema = () => object({
  path: string2(),
  description: string2(),
  readOnly: boolean2(),
  destructive: boolean2(),
  request: doc(record(string2(), unknown()), "JSON Schema (2020-12)."),
  response: doc(
    record(string2(), unknown()),
    "JSON Schema (2020-12) of `data` in a successful response."
  )
});
var errorBodySchema = () => object({
  success: literal(false),
  code: _enum(ERROR_CODES),
  error: string2(),
  details: optional(unknown())
});
var introspectResponse = object({
  staruml: object({
    version: string2(),
    apiVersion: nullable(string2())
  }),
  extension: object({ name: string2(), version: string2() }),
  factory: optional(
    object({
      modelIds: array(string2()),
      diagramIds: array(string2()),
      modelAndViewIds: array(string2()),
      modelAndView: doc(
        array(modelAndViewSchema()),
        "What each model-and-view id creates; ids such as UMLInputExpansionNode create another model type."
      )
    })
  ),
  metamodel: optional(record(string2(), metaTypeSchema())),
  toolbox: optional(toolboxSchema()),
  endpoints: optional(array(manifestEntrySchema())),
  errors: optional(
    object({
      status: doc(record(string2(), int()), "HTTP status per error code."),
      schema: doc(
        record(string2(), unknown()),
        "JSON Schema of an error response body."
      )
    })
  )
});
function describeAttribute(attr) {
  return {
    name: attr.name,
    kind: attr.kind,
    type: attr.type,
    ...attr.default !== void 0 && { default: attr.default },
    ...attr.transient && { transient: true },
    ...attr.options && { options: [...attr.options] }
  };
}
function describeType(name, ids2, inherited) {
  const metaType = meta[name];
  if (metaType.kind === "enum") {
    return {
      kind: "enum",
      super: null,
      supers: [],
      attributes: [],
      literals: [...metaType.literals ?? []],
      viewType: null,
      relationship: null,
      isView: false,
      isDiagram: false,
      creatable: { model: false, modelAndView: false, diagram: false }
    };
  }
  const isDiagram = app.metamodels.isKindOf(name, "Diagram");
  const attributes = inherited ? app.metamodels.getMetaAttributes(name) : metaType.attributes ?? [];
  return {
    kind: "class",
    super: metaType.super ?? null,
    supers: lineage(name).slice(1),
    attributes: attributes.map(describeAttribute),
    viewType: app.metamodels.getViewTypeOf(name),
    ...isDiagram && {
      viewTypes: app.metamodels.getAvailableViewTypes(name)
    },
    relationship: relationshipKind(name),
    isView: app.metamodels.isKindOf(name, "View"),
    isDiagram,
    creatable: {
      model: ids2.model.has(name),
      modelAndView: ids2.modelAndView.has(name),
      diagram: ids2.diagram.has(name)
    }
  };
}
function describeModelAndView(id2) {
  const options = app.factory.modelAndViewOptions[id2] ?? {};
  const candidate = options.modelType ?? id2;
  const modelType = isMetaClass(candidate) ? candidate : null;
  return {
    id: id2,
    modelType,
    viewType: options.viewType ?? (modelType ? app.metamodels.getViewTypeOf(modelType) : null),
    relationship: modelType ? relationshipKind(modelType) : null
  };
}
function describeToolbox() {
  const { groups, items } = app.toolbox;
  return {
    groups: Object.values(groups).map((g) => ({
      id: g.id,
      title: g.title,
      diagramTypes: g.diagramTypes ? g.diagramTypes.map((t) => t.name) : null
    })),
    items: Object.values(items).map((item) => {
      const { id: id2, ...options } = item.commandArg ?? {};
      return {
        id: item.id,
        group: item.groupId,
        title: item.title,
        rubberband: item.rubberband,
        creates: typeof id2 === "string" ? id2 : item.id,
        options: serializeValue(options),
        ...item.command && { command: item.command }
      };
    })
  };
}
var manifestCache = null;
function manifest(endpoints2) {
  if (manifestCache?.endpoints !== endpoints2) {
    manifestCache = {
      endpoints: endpoints2,
      entries: endpoints2.map((e) => ({
        path: e.path,
        description: e.description,
        readOnly: e.readOnly,
        destructive: e.destructive,
        request: toJSONSchema(e.request, { io: "input" }),
        response: toJSONSchema(e.response, { io: "output" })
      }))
    };
  }
  return manifestCache.entries;
}
function introspectEndpoint(endpoints2) {
  return defineEndpoint({
    path: "/introspect",
    description: "StarUML and extension versions, factory ids, the metamodel catalogue, the diagram editor's toolbox, and this endpoint manifest with JSON Schemas.",
    readOnly: true,
    destructive: false,
    request: object({
      include: optional(
        doc(
          array(_enum(SECTIONS)),
          "Sections to return besides the versions; default all."
        )
      ),
      types: optional(
        doc(
          array(string2().check(_minLength(1))),
          "Restrict the metamodel section to these type names."
        )
      ),
      inherited: optional(
        doc(
          boolean2(),
          "List inherited attributes with each type; default false (own attributes and supers)."
        )
      )
    }),
    response: introspectResponse,
    handle: (input) => {
      const include = new Set(input.include ?? SECTIONS);
      const ids2 = {
        model: app.factory.getModelIds(),
        modelAndView: app.factory.getModelAndViewIds(),
        diagram: app.factory.getDiagramIds()
      };
      const out = {
        staruml: {
          version: app.version,
          apiVersion: app.metadata.apiVersion ?? null
        },
        extension: { name: EXTENSION_NAME, version: EXTENSION_VERSION }
      };
      if (include.has("factory")) {
        out.factory = {
          modelIds: [...ids2.model].sort(),
          diagramIds: [...ids2.diagram].sort(),
          modelAndViewIds: [...ids2.modelAndView].sort(),
          modelAndView: [...ids2.modelAndView].sort().map(describeModelAndView)
        };
      }
      if (include.has("metamodel")) {
        const sets = {
          model: new Set(ids2.model),
          modelAndView: new Set(ids2.modelAndView),
          diagram: new Set(ids2.diagram)
        };
        const names = (input.types ?? Object.keys(meta)).filter(
          (name) => Object.hasOwn(meta, name)
        );
        out.metamodel = Object.fromEntries(
          names.sort().map((name) => [
            name,
            describeType(name, sets, input.inherited === true)
          ])
        );
      }
      if (include.has("toolbox")) out.toolbox = describeToolbox();
      if (include.has("endpoints")) {
        out.endpoints = manifest(endpoints2());
        out.errors = {
          status: { ...ERROR_STATUS },
          schema: toJSONSchema(errorBodySchema())
        };
      }
      return out;
    }
  });
}

// src/handlers/diagrams.ts
var createDiagram = defineEndpoint({
  path: "/create_diagram",
  description: "Create a diagram under a model element.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A diagram id of app.factory.getDiagramIds(), e.g. 'UMLClassDiagram', 'UMLSequenceDiagram', 'ERDDiagram'."
    ),
    parentId: id("Owner, usually a UMLModel or UMLPackage."),
    name: optional(text2("Diagram name; StarUML generates one if omitted.")),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent element");
    const { name } = input;
    const diagram = inStarUML(
      () => app.factory.createDiagram({
        id: input.type,
        parent,
        ...name !== void 0 && {
          diagramInitializer: (d) => {
            d.name = name;
          }
        }
      })
    );
    if (!diagram) {
      throw new ApiError("UNKNOWN_TYPE", `Unknown diagram type: ${input.type}`);
    }
    return serialize(diagram, input);
  }
});
var diagramRequest = () => object({ id: id("Diagram id.") });
var switchDiagram = defineEndpoint({
  path: "/switch_diagram",
  description: "Open a diagram in the editor and make it the current one.",
  readOnly: false,
  destructive: false,
  request: diagramRequest(),
  response: object({ _id: string2() }),
  handle: (input) => {
    const diagram = requireDiagram(input.id);
    inStarUML(() => app.diagrams.setCurrentDiagram(diagram));
    return { _id: diagram._id };
  }
});
var closeDiagram = defineEndpoint({
  path: "/close_diagram",
  description: "Close a diagram's editor tab; the diagram stays in the model.",
  readOnly: false,
  destructive: false,
  request: diagramRequest(),
  response: object({ closed: string2() }),
  handle: (input) => {
    const diagram = requireDiagram(input.id);
    inStarUML(() => app.diagrams.closeDiagram(diagram));
    return { closed: diagram._id };
  }
});

// src/values.ts
var PRIM_CHECKS = {
  String: (v) => typeof v === "string",
  Image: (v) => typeof v === "string",
  Boolean: (v) => typeof v === "boolean",
  Integer: (v) => Number.isInteger(v),
  Real: (v) => typeof v === "number" && Number.isFinite(v)
};
function refId(value) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && typeof value.$ref === "string") {
    return value.$ref;
  }
  return null;
}
function invalid(owner, attr, expected) {
  throw new ApiError(
    "INVALID_ARGUMENT",
    `${owner}.${attr.name} (${attr.kind} ${attr.type}) expects ${expected}`
  );
}
function referenced(owner, attr, value) {
  const id2 = refId(value);
  if (id2 === null) invalid(owner, attr, "an element id or {$ref: id}");
  const elem = app.repository.get(id2);
  if (!elem) {
    throw new ApiError(
      "NOT_FOUND",
      `${owner}.${attr.name}: element not found: ${id2}`
    );
  }
  if (!app.metamodels.isKindOf(elem.constructor.name, attr.type)) {
    invalid(owner, attr, `a ${attr.type}, got ${elem.constructor.name} ${id2}`);
  }
  return elem;
}
function toModelValue(owner, attr, value) {
  switch (attr.kind) {
    case "prim": {
      const check = PRIM_CHECKS[attr.type];
      if (check && !check(value)) invalid(owner, attr, `a ${attr.type}`);
      return value;
    }
    case "enum": {
      const literals = meta[attr.type]?.literals ?? [];
      if (!literals.includes(value))
        invalid(owner, attr, `one of ${literals.join(", ")}`);
      return value;
    }
    case "ref":
      return value === null ? null : referenced(owner, attr, value);
    case "refs":
      if (!Array.isArray(value))
        invalid(owner, attr, "an array of element ids");
      return value.map((v) => referenced(owner, attr, v));
    case "var":
      if (refId(value) !== null && typeof value === "object")
        return referenced(owner, attr, value);
      if (value !== null && typeof value === "object")
        invalid(owner, attr, "a string, number, boolean, null or {$ref: id}");
      return value;
    default:
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${owner}.${attr.name} is a ${attr.kind} attribute and cannot be set here`
      );
  }
}
function settableAttribute(typeName2, name) {
  const attr = name === "_id" || name === "_parent" ? void 0 : attributeOf(typeName2, name);
  if (!attr) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${typeName2} has no field '${name}'`
    );
  }
  return attr;
}
function toModelValues(typeName2, properties2) {
  const out = {};
  for (const [name, value] of Object.entries(properties2)) {
    out[name] = toModelValue(
      typeName2,
      settableAttribute(typeName2, name),
      value
    );
  }
  return out;
}

// src/create.ts
function initialValues(typeName2, name, properties2) {
  return toModelValues(typeName2, {
    ...properties2,
    ...name !== void 0 && { name }
  });
}
function requireModelId(id2) {
  if (!app.factory.getModelIds().includes(id2)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown model type: ${id2}`);
  }
  if (!isMetaClass(id2)) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `${id2} is registered with the factory but has no metamodel class, so StarUML cannot create it`
    );
  }
}
function createOwned(owner, typeName2, field, values, initialize = () => {
}) {
  requireModelId(typeName2);
  const into = resolveOwnerField(owner, typeName2, field);
  const elem = inStarUML(
    () => app.factory.createModel({
      id: typeName2,
      parent: owner,
      field: into,
      modelInitializer: (m) => {
        Object.assign(m, values);
        initialize(m);
      }
    })
  );
  if (!elem) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not create ${typeName2} in ${owner.constructor.name}.${into}`
    );
  }
  return elem;
}
function instantiate(typeName2) {
  if (!isMetaClass(typeName2) || !Object.hasOwn(type, typeName2)) {
    throw new ApiError("UNKNOWN_TYPE", `Unknown element type: ${typeName2}`);
  }
  const Ctor = type[typeName2];
  return new Ctor();
}
function diagramOf(view) {
  let e = view;
  while (e && !(e instanceof type.Diagram)) e = e._parent;
  return e ?? null;
}
function endView(id2, diagram, role) {
  const elem = requireElement(id2, role);
  if (elem instanceof type.View) {
    if (diagramOf(elem) !== diagram) {
      throw new ApiError(
        "NOT_FOUND",
        `${role} ${id2} is not on diagram ${diagram._id}`
      );
    }
    return elem;
  }
  const view = app.repository.getViewsOf(elem).find((v) => diagramOf(v) === diagram);
  if (!view) {
    throw new ApiError(
      "NOT_FOUND",
      `${role}: no view of ${id2} on diagram ${diagram._id}`
    );
  }
  return view;
}
function center(view) {
  const { left, top, width, height } = view;
  if (typeof left !== "number" || typeof top !== "number" || typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  return { x: left + width / 2, y: top + height / 2 };
}
function createModelAndView(options) {
  if (!app.factory.getModelAndViewIds().includes(options.id)) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `Unknown model-and-view type: ${options.id}`
    );
  }
  const view = inStarUML(
    () => app.factory.createModelAndView({
      ...options,
      editor: app.diagrams.getEditor()
    })
  );
  if (!view) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not create ${options.id} on diagram ${options.diagram._id}`
    );
  }
  return view;
}

// src/toolbox.ts
var CURSOR_OPTIONS = /* @__PURE__ */ new Set(["id", "connectable-views", "self-connection"]);
var DEFAULT_COMMAND = "factory:create-model-and-view";
function resolveCreateType(typeName2) {
  const { items } = app.toolbox;
  const item = Object.hasOwn(items, typeName2) ? items[typeName2] : void 0;
  const custom = item?.command && item.command !== DEFAULT_COMMAND;
  if (!item || custom) {
    if (app.factory.getModelAndViewIds().includes(typeName2)) {
      return { id: typeName2, preset: {} };
    }
    throw new ApiError(
      "UNKNOWN_TYPE",
      custom ? `${typeName2} is a toolbox item run by the command ${item.command}, which this API does not call` : `Unknown model-and-view type: ${typeName2}`
    );
  }
  const arg = item.commandArg ?? {};
  const preset = {};
  for (const [key, value] of Object.entries(arg)) {
    if (!CURSOR_OPTIONS.has(key)) preset[key] = value;
  }
  return { id: typeof arg.id === "string" ? arg.id : typeName2, preset };
}

// src/handlers/elements.ts
var getElementById = defineEndpoint({
  path: "/get_element_by_id",
  description: "Read one element by id.",
  readOnly: true,
  destructive: false,
  request: object({ id: id("Element id."), ...projectionShape() }),
  response: elementSchema(),
  handle: (input) => serialize(requireElement(input.id), input)
});
var DEFAULT_PAGE_SIZE = 100;
var MAX_PAGE_SIZE = 1e3;
var findElements = defineEndpoint({
  path: "/find_elements",
  description: "Find elements by metamodel type (including subtypes) and/or exact name, a page at a time.",
  readOnly: true,
  destructive: false,
  request: object({
    type: optional(
      typeName("Metamodel class, e.g. 'UMLClass'; subtypes match too.")
    ),
    name: optional(text2("Exact element name.")),
    limit: optional(
      doc(
        int().check(_gte(1), _lte(MAX_PAGE_SIZE)),
        `Page size, default ${DEFAULT_PAGE_SIZE}.`
      )
    ),
    cursor: optional(
      doc(string2().check(_minLength(1)), "nextCursor of the previous page.")
    ),
    ...projectionShape()
  }),
  response: object({
    count: doc(int(), "Matches across all pages."),
    elements: array(elementSchema()),
    nextCursor: doc(
      nullable(string2()),
      "Pass as 'cursor' for the next page; null on the last page."
    )
  }),
  handle: (input) => {
    const { name, cursor } = input;
    let pool;
    if (input.type !== void 0) {
      requireTypeName(input.type);
      pool = app.repository.getInstancesOf(input.type);
    } else {
      pool = app.repository.findAll(() => true);
    }
    const matches = (name === void 0 ? pool : pool.filter((e) => e.name === name)).sort((a, b) => compare(a._id, b._id));
    const rest = cursor === void 0 ? matches : matches.filter((e) => compare(e._id, cursor) > 0);
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    const page = rest.slice(0, limit);
    return {
      count: matches.length,
      elements: page.map((e) => serialize(e, input)),
      nextCursor: rest.length > limit ? page[limit - 1]._id : null
    };
  }
});
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
var createElement = defineEndpoint({
  path: "/create_element",
  description: "Create a model element (no view) under an owner, e.g. a UMLClass in a UMLModel or an ERDColumn in an ERDEntity.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A model id of /introspect factory.modelIds, e.g. 'UMLClass'."
    ),
    parentId: id("Owner element id."),
    name: optional(text2("Element name; StarUML generates one if omitted.")),
    field: optional(
      doc(
        string2().check(_minLength(1)),
        "Owner list to add to; default the owner's list typed most specifically for the element, e.g. 'attributes' for a UMLAttribute in a class, else 'ownedElements'."
      )
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent element");
    requireModelId(input.type);
    const values = initialValues(input.type, input.name, input.properties);
    return serialize(
      createOwned(parent, input.type, input.field, values),
      input
    );
  }
});
var UPDATE_OPS = ["set", "add", "remove", "reorder", "relocate"];
var updateElement = defineEndpoint({
  path: "/update_element",
  description: "Change an element: set an attribute (references by id), add to or remove from a reference list, move an item within a list, or relocate the element to another owner. Each call is one undo step.",
  readOnly: false,
  destructive: true,
  request: object({
    id: id("Element id."),
    op: optional(
      doc(
        _enum(UPDATE_OPS),
        "set (default): field = value. add/remove: value is one or more element ids for the reference list `field`. reorder: move the item `value` of list `field` to `index`. relocate: move the element to owner `parentId`, keeping its list field."
      )
    ),
    field: optional(
      doc(
        string2().check(_minLength(1)),
        "Attribute name; required except for relocate."
      )
    ),
    value: optional(
      doc(
        unknown(),
        "set: the new value; an id or {$ref: id} for references, null to clear. add/remove: an id, {$ref: id} or an array of them. reorder: the item to move."
      )
    ),
    index: optional(
      doc(
        int().check(_gte(0)),
        "reorder: target position, counted after the item is taken out."
      )
    ),
    parentId: optional(id("relocate: the new owner.")),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.id);
    const op = input.op ?? "set";
    if (op === "relocate") {
      if (input.parentId === void 0) {
        throw new ApiError("INVALID_ARGUMENT", "relocate needs parentId");
      }
      relocate(elem, requireElement(input.parentId, "Parent"), input.field);
      return serialize(elem, input);
    }
    if (input.field === void 0) {
      throw new ApiError("INVALID_ARGUMENT", `${op} needs field`);
    }
    if (input.value === void 0) {
      throw new ApiError("INVALID_ARGUMENT", `${op} needs value`);
    }
    const typeName2 = elem.constructor.name;
    const attr = settableAttribute(typeName2, input.field);
    if (op === "set") {
      const value = toModelValue(typeName2, attr, input.value);
      inStarUML(() => app.engine.setProperty(elem, attr.name, value));
    } else if (op === "reorder") {
      reorder(elem, attr, input.value, input.index);
    } else {
      changeReferences(elem, attr, op, input.value);
    }
    return serialize(elem, input);
  }
});
function changeReferences(elem, attr, op, value) {
  const typeName2 = elem.constructor.name;
  if (attr.kind !== "refs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${op} needs a reference list; ${typeName2}.${attr.name} is ${attr.kind}. Owned elements are created with /create_element and moved with op 'relocate'.`
    );
  }
  const items = toModelValue(
    typeName2,
    attr,
    Array.isArray(value) ? value : [value]
  );
  const list = elem[attr.name];
  for (const item of items) {
    if (op === "add" && !list.includes(item)) {
      inStarUML(() => app.engine.addItem(elem, attr.name, item));
    } else if (op === "remove" && list.includes(item)) {
      inStarUML(() => app.engine.removeItem(elem, attr.name, item));
    }
  }
}
function reorder(elem, attr, value, index) {
  const typeName2 = elem.constructor.name;
  if (attr.kind !== "refs" && attr.kind !== "objs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `reorder needs a list; ${typeName2}.${attr.name} is ${attr.kind}`
    );
  }
  if (index === void 0) {
    throw new ApiError("INVALID_ARGUMENT", "reorder needs index");
  }
  const list = elem[attr.name];
  const itemId = refId(value);
  const item = list.find((e) => e._id === itemId);
  if (!item) {
    throw new ApiError(
      "NOT_FOUND",
      `${String(itemId)} is not in ${typeName2}.${attr.name}`
    );
  }
  if (index >= list.length) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `index ${index} is past the end of ${typeName2}.${attr.name} (${list.length} items)`
    );
  }
  const builder = app.repository.getOperationBuilder();
  builder.begin("reorder");
  builder.fieldReorder(elem, attr.name, item, index);
  builder.end();
  inStarUML(() => app.repository.doOperation(builder.getOperation()));
}
function containingField(elem) {
  const owner = elem._parent;
  if (!owner) return null;
  for (const attr of app.metamodels.getMetaAttributes(owner.constructor.name)) {
    const value = owner[attr.name];
    if (Array.isArray(value) && value.includes(elem)) return attr.name;
  }
  return null;
}
function relocate(elem, newOwner, field) {
  const current = containingField(elem);
  if (!current) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${elem.constructor.name} ${elem._id} is not in a list of its owner and cannot be relocated`
    );
  }
  if (field !== void 0 && field !== current) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `relocate keeps the list field: ${elem._id} is in '${current}', not '${field}'`
    );
  }
  if (!Array.isArray(newOwner[current])) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${newOwner.constructor.name} has no list field '${current}'`
    );
  }
  for (let e = newOwner; e; e = e._parent) {
    if (e === elem) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${newOwner._id} is ${elem._id} itself or inside it`
      );
    }
  }
  if (elem._parent === newOwner) return;
  inStarUML(() => app.engine.relocate(elem, newOwner, current));
  if (elem._parent !== newOwner) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not relocate ${elem._id} to ${newOwner._id}`
    );
  }
}
var deleteElement = defineEndpoint({
  path: "/delete_element",
  description: "Delete an element with everything it owns, the views showing them, and edges attached to those views.",
  readOnly: false,
  destructive: true,
  request: object({ id: id("Element id.") }),
  response: object({
    deleted: string2(),
    models_deleted: int(),
    views_deleted: int()
  }),
  handle: (input) => {
    const elem = requireElement(input.id);
    const { models, views } = collectDeletionTargets(elem);
    inStarUML(() => app.engine.deleteElements(models, views));
    return {
      deleted: input.id,
      models_deleted: models.length,
      views_deleted: views.length
    };
  }
});
function collectDeletionTargets(root) {
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  const views = [];
  const stack = [root];
  for (let e = stack.pop(); e !== void 0; e = stack.pop()) {
    if (seen.has(e._id)) continue;
    seen.add(e._id);
    if (e instanceof type.View) {
      views.push(e);
      stack.push(...app.repository.getEdgeViewsOf(e));
    } else {
      models.push(e);
      stack.push(...app.repository.getViewsOf(e));
    }
    for (const field of ["ownedElements", "ownedViews", "subViews"]) {
      const owned = e[field];
      if (Array.isArray(owned)) stack.push(...owned);
    }
  }
  return { models, views };
}
var createdSchema = () => object({
  view: elementSchema(),
  model: doc(
    nullable(elementSchema()),
    "Null for view-only ids such as Note or NoteLink."
  )
});
function created(view, projection) {
  return {
    view: serialize(view, projection),
    model: view.model ? serialize(view.model, projection) : null
  };
}
var createElementWithView = defineEndpoint({
  path: "/create_element_with_view",
  description: "Create a model element and its view on a diagram, e.g. a UMLClass shown on a UMLClassDiagram. Pass containerViewId for elements placed on or inside another view: ports and parts on a class, pins on an action, tasks in a BPMN lane, lifelines in a timing frame.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A model-and-view id of /introspect factory.modelAndViewIds, e.g. 'UMLClass', 'ERDEntity', or a toolbox item id, which applies the item's presets, e.g. 'UMLInitialState', 'UMLCompositeState', 'C4ContainerDatabase'."
    ),
    diagramId: id("Diagram to place the view on."),
    parentId: optional(
      id(
        "Owner of the new model element; default the diagram's owner, as the diagram editor does. Items placed on a host view (toolbox option parasitic, e.g. ports and pins) are filed under the host's model by StarUML regardless."
      )
    ),
    containerViewId: optional(
      id("View that hosts or contains the new view.")
    ),
    name: optional(text2("Element name; StarUML generates one if omitted.")),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    x: coordinate("Left edge in diagram coordinates, default 100."),
    y: coordinate("Top edge, default 100."),
    x2: coordinate("Right edge, default x + 100."),
    y2: coordinate("Bottom edge, default y + 50."),
    ...projectionShape()
  }),
  response: createdSchema(),
  handle: (input) => {
    const diagram = requireDiagram(input.diagramId);
    const container = input.containerViewId === void 0 ? void 0 : requireView(input.containerViewId, "Container view");
    const parent = input.parentId === void 0 ? diagram._parent : requireElement(input.parentId, "Parent");
    const { id: createId, preset } = resolveCreateType(input.type);
    const values = valuesFor(createId, input.name, input.properties);
    const x1 = input.x ?? 100;
    const y1 = input.y ?? 100;
    const view = createModelAndView({
      ...preset,
      id: createId,
      parent,
      diagram,
      x1,
      y1,
      x2: input.x2 ?? x1 + 100,
      y2: input.y2 ?? y1 + 50,
      // The toolbox's "parasitic" and "container-views" options make the
      // view under the cursor the head view and container (engine/factory.js).
      ...container && {
        containerView: container,
        headView: container,
        headModel: container.model,
        tailView: container,
        tailModel: container.model
      },
      modelInitializer: (m) => {
        Object.assign(m, values);
      }
    });
    return created(view, input);
  }
});
function valuesFor(id2, name, props) {
  const modelType = modelTypeOf(id2);
  if (modelType) return initialValues(modelType, name, props);
  if (name !== void 0 || props !== void 0) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${id2} creates only a view; name and properties do not apply`
    );
  }
  return {};
}
function modelTypeOf(id2) {
  const candidate = app.factory.modelAndViewOptions[id2]?.modelType ?? id2;
  return isMetaClass(candidate) ? candidate : null;
}

// src/handlers/project.ts
var filename = (description) => doc(string2().check(_minLength(1)), description);
var projectInfo = () => object({
  filename: doc(
    nullable(string2()),
    "File the project was opened from or last saved to; null if never saved."
  ),
  project: nullable(elementSchema())
});
function describeProject(projection) {
  const project = app.project.getProject();
  return {
    filename: app.project.getFilename(),
    project: project && serialize(project, projection)
  };
}
var getProjectInfo = defineEndpoint({
  path: "/get_project_info",
  description: "The open project and its file name.",
  readOnly: true,
  destructive: false,
  request: object(projectionShape()),
  response: projectInfo(),
  handle: describeProject
});
function saveTo(file) {
  requireProject();
  inStarUML(() => app.project.save(file));
  return { filename: app.project.getFilename() };
}
var saved = () => object({ filename: nullable(string2()) });
var saveProject = defineEndpoint({
  path: "/save_project",
  description: "Save the project to 'filename', or to the file it was opened from or last saved to.",
  readOnly: false,
  destructive: true,
  request: object({
    filename: optional(filename("Absolute .mdj path; overwrites the file."))
  }),
  response: saved(),
  handle: (input) => {
    const file = input.filename ?? app.project.getFilename();
    if (!file) {
      throw new ApiError(
        "NO_PROJECT",
        "Project has no file yet; pass 'filename' or use /save_project_as"
      );
    }
    return saveTo(file);
  }
});
var saveProjectAs = defineEndpoint({
  path: "/save_project_as",
  description: "Save the project to a new file, which becomes the project's file.",
  readOnly: false,
  destructive: true,
  request: object({
    filename: filename("Absolute .mdj path; overwrites the file.")
  }),
  response: saved(),
  handle: (input) => saveTo(input.filename)
});
var newProject = defineEndpoint({
  path: "/new_project",
  description: "Replace the open project with an empty one; unsaved changes are lost.",
  readOnly: false,
  destructive: true,
  request: object(projectionShape()),
  response: projectInfo(),
  handle: (input) => {
    inStarUML(() => app.project.newProject());
    return describeProject(input);
  }
});
var openProject = defineEndpoint({
  path: "/open_project",
  description: "Replace the open project with a .mdj file; unsaved changes are lost.",
  readOnly: false,
  destructive: true,
  request: object({
    filename: filename("Absolute .mdj path."),
    ...projectionShape()
  }),
  response: object({ filename: string2(), project: elementSchema() }),
  handle: (input) => {
    const project = inStarUML(() => app.project.load(input.filename));
    if (!project) {
      throw new ApiError("STARUML_ERROR", `File is empty: ${input.filename}`);
    }
    return { filename: input.filename, project: serialize(project, input) };
  }
});

// src/handlers/features.ts
var visibility = () => optional(
  doc(
    _enum(["public", "protected", "private", "package"]),
    "Default public."
  )
);
var aggregation = () => optional(doc(_enum(["none", "shared", "composite"]), "Default none."));
var direction = () => optional(doc(_enum(["in", "inout", "out", "return"]), "Default in."));
var flag = (description) => optional(doc(boolean2(), description));
var str = (description) => optional(text2(description));
function pick2(input, names) {
  const out = {};
  for (const name of names) {
    if (input[name] !== void 0) out[name] = input[name];
  }
  return out;
}
var STRUCTURAL = [
  "type",
  "visibility",
  "multiplicity",
  "defaultValue",
  "isStatic",
  "isReadOnly",
  "isDerived",
  "isID",
  "aggregation",
  "documentation"
];
var structuralShape = () => ({
  type: optional(
    typeValue(
      "A type name such as 'String', or {$ref: id} of a classifier in the model."
    )
  ),
  visibility: visibility(),
  multiplicity: str("E.g. '0..1', '1', '*', '1..*'."),
  defaultValue: str("Default value as text."),
  isStatic: flag("Class-level feature."),
  isReadOnly: flag("Read only."),
  isDerived: flag("Derived."),
  isID: flag("Part of the identity."),
  aggregation: aggregation(),
  documentation: str("Documentation text."),
  properties: properties(ATTRIBUTE_VALUES_HELP)
});
function featureValues(typeName2, input, names) {
  return initialValues(typeName2, input.name, {
    ...input.properties,
    ...pick2(input, names)
  });
}
var addAttribute = defineEndpoint({
  path: "/add_attribute",
  description: "Add a UMLAttribute to a classifier (class, interface, data type, signal, ...).",
  readOnly: false,
  destructive: false,
  request: object({
    ownerId: id("Classifier id."),
    name: text2("Attribute name."),
    ...structuralShape(),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLAttribute", input, STRUCTURAL);
    return serialize(
      createOwned(owner, "UMLAttribute", "attributes", values),
      input
    );
  }
});
var PARAMETER = [
  "type",
  "direction",
  "multiplicity",
  "defaultValue",
  "isReadOnly",
  "documentation"
];
var parameterShape = () => ({
  name: text2("Parameter name."),
  type: optional(
    typeValue("A type name, or {$ref: id} of a classifier in the model.")
  ),
  direction: direction(),
  multiplicity: str("E.g. '0..1', '*'."),
  defaultValue: str("Default value as text."),
  isReadOnly: flag("Read only."),
  documentation: str("Documentation text."),
  properties: properties(ATTRIBUTE_VALUES_HELP)
});
var OPERATION = [
  "visibility",
  "isStatic",
  "isAbstract",
  "isQuery",
  "specification",
  "documentation"
];
var addOperation = defineEndpoint({
  path: "/add_operation",
  description: "Add a UMLOperation with its parameters and return type to a classifier.",
  readOnly: false,
  destructive: false,
  request: object({
    ownerId: id("Classifier id."),
    name: text2("Operation name."),
    visibility: visibility(),
    isStatic: flag("Class-level operation."),
    isAbstract: flag("Abstract."),
    isQuery: flag("Does not change state."),
    specification: str("Body or specification text."),
    documentation: str("Documentation text."),
    parameters: optional(
      doc(array(object(parameterShape())), "In declaration order.")
    ),
    returnType: optional(
      typeValue(
        "Return type: a type name or {$ref: id}; stored as a parameter with direction 'return'."
      )
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLOperation", input, OPERATION);
    const parameters = [
      ...(input.parameters ?? []).map(
        (p) => featureValues("UMLParameter", p, PARAMETER)
      ),
      ...input.returnType === void 0 ? [] : [
        initialValues("UMLParameter", "", {
          type: input.returnType,
          direction: "return"
        })
      ]
    ];
    const operation = createOwned(
      owner,
      "UMLOperation",
      "operations",
      values,
      (op) => {
        for (const paramValues of parameters) {
          const param = Object.assign(instantiate("UMLParameter"), paramValues);
          param._parent = op;
          op.parameters.push(param);
        }
      }
    );
    return serialize(operation, input);
  }
});
var addParameter = defineEndpoint({
  path: "/add_parameter",
  description: "Add a UMLParameter to an operation (or another behavioral feature).",
  readOnly: false,
  destructive: false,
  request: object({
    operationId: id("Operation id."),
    ...parameterShape(),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.operationId, "Operation");
    const values = featureValues("UMLParameter", input, PARAMETER);
    return serialize(
      createOwned(owner, "UMLParameter", "parameters", values),
      input
    );
  }
});
var addEnumerationLiteral = defineEndpoint({
  path: "/add_enumeration_literal",
  description: "Add a UMLEnumerationLiteral to a UMLEnumeration.",
  readOnly: false,
  destructive: false,
  request: object({
    enumerationId: id("UMLEnumeration id."),
    name: text2("Literal name."),
    documentation: str("Documentation text."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.enumerationId, "Enumeration");
    const values = featureValues("UMLEnumerationLiteral", input, [
      "documentation"
    ]);
    return serialize(
      createOwned(owner, "UMLEnumerationLiteral", "literals", values),
      input
    );
  }
});
var addTemplateParameter = defineEndpoint({
  path: "/add_template_parameter",
  description: "Add a UMLTemplateParameter to a model element, e.g. T of a generic class.",
  readOnly: false,
  destructive: false,
  request: object({
    ownerId: id("Templated element id."),
    name: text2("Parameter name, e.g. 'T'."),
    parameterType: optional(
      typeValue("Kind of argument, e.g. 'class', or {$ref: id}.")
    ),
    defaultValue: optional(
      typeValue("Default argument: text or {$ref: id}.")
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLTemplateParameter", input, [
      "parameterType",
      "defaultValue"
    ]);
    return serialize(
      createOwned(owner, "UMLTemplateParameter", "templateParameters", values),
      input
    );
  }
});
var addSlot = defineEndpoint({
  path: "/add_slot",
  description: "Add a UMLSlot (attribute value) to an instance such as a UMLObject.",
  readOnly: false,
  destructive: false,
  request: object({
    instanceId: id("Instance id, e.g. a UMLObject."),
    name: str("Slot name; usually the defining attribute's name."),
    definingFeature: optional(
      reference(
        "The UMLAttribute (or other structural feature) the slot sets."
      )
    ),
    value: str("Value as text."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.instanceId, "Instance");
    const values = featureValues("UMLSlot", input, [
      "definingFeature",
      "value"
    ]);
    return serialize(createOwned(owner, "UMLSlot", "slots", values), input);
  }
});
var TAG_VALUE_FIELD = {
  string: "value",
  enum: "value",
  number: "number",
  boolean: "checked",
  reference: "reference"
};
var addTag = defineEndpoint({
  path: "/add_tag",
  description: "Add a Tag (name/value extension property) to an element. Tags show in the property editor and, unless hidden, on diagrams with Format > Show Property.",
  readOnly: false,
  destructive: false,
  request: object({
    elementId: id("Element to tag."),
    name: text2("Tag name."),
    kind: doc(
      _enum(["string", "number", "boolean", "reference", "enum"]),
      "TagKind; decides which value attribute is set."
    ),
    value: doc(
      unknown(),
      "string/enum: text; number: an integer; boolean: true/false; reference: an id or {$ref: id}."
    ),
    hidden: flag("Hide the tag on diagrams."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.elementId, "Element");
    const values = initialValues("Tag", input.name, {
      ...input.properties,
      kind: input.kind,
      [TAG_VALUE_FIELD[input.kind]]: input.value,
      ...input.hidden !== void 0 && { hidden: input.hidden }
    });
    return serialize(createOwned(owner, "Tag", "tags", values), input);
  }
});
function setAttribute(elem, field, value) {
  const typeName2 = elem.constructor.name;
  const converted = toModelValue(
    typeName2,
    settableAttribute(typeName2, field),
    value
  );
  inStarUML(() => app.engine.setProperty(elem, field, converted));
}
var setStereotype = defineEndpoint({
  path: "/set_stereotype",
  description: "Set or clear an element's stereotype: a name shown as \xABname\xBB, or a UMLStereotype from a profile.",
  readOnly: false,
  destructive: true,
  request: object({
    elementId: id("Element id."),
    stereotype: doc(
      nullable(
        union([
          string2(),
          object({ $ref: string2().check(_minLength(1)) })
        ])
      ),
      "Stereotype name, {$ref: id} of a UMLStereotype, or null to clear."
    ),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.elementId);
    setAttribute(elem, "stereotype", input.stereotype);
    return serialize(elem, input);
  }
});
var setDocumentation = defineEndpoint({
  path: "/set_documentation",
  description: "Set an element's documentation text.",
  readOnly: false,
  destructive: true,
  request: object({
    elementId: id("Element id."),
    documentation: text2("Documentation; replaces the current text."),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.elementId);
    setAttribute(elem, "documentation", input.documentation);
    return serialize(elem, input);
  }
});

// src/handlers/relationships.ts
function endTypes(modelType) {
  const probe = instantiate(modelType);
  return {
    tail: probe.end1.constructor.name,
    head: probe.end2.constructor.name
  };
}
function endValues(modelType, kind, tailEnd, headEnd) {
  if (tailEnd === void 0 && headEnd === void 0) {
    return { tail: {}, head: {} };
  }
  if (kind !== "undirected") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `tailEnd/headEnd apply to undirected relationships (end1/end2); ${String(modelType)} has none`
    );
  }
  const types = endTypes(modelType);
  return {
    tail: toModelValues(types.tail, tailEnd ?? {}),
    head: toModelValues(types.head, headEnd ?? {})
  };
}
function assignEnds(model, ends) {
  if (model.end1) Object.assign(model.end1, ends.tail);
  if (model.end2) Object.assign(model.end2, ends.head);
}
function edgeGeometry(tail, head, input) {
  const from = center(tail);
  const to = center(head);
  return {
    x1: input.x1 ?? from?.x ?? 0,
    y1: input.y1 ?? from?.y ?? 0,
    x2: input.x2 ?? to?.x ?? 0,
    y2: input.y2 ?? to?.y ?? 0
  };
}
var geometryShape = () => ({
  x1: coordinate(
    "Edge start in diagram coordinates; default the tail view's centre. For a sequence message, y1/y2 place it on the lifelines."
  ),
  y1: coordinate("See x1."),
  x2: coordinate("Edge end; default the head view's centre."),
  y2: coordinate("See x2.")
});
var endShape = () => ({
  tailEnd: properties(
    "Undirected relationships only: attributes of end1, e.g. {name, navigable, aggregation, multiplicity} for a UMLAssociation."
  ),
  headEnd: properties("Undirected relationships only: attributes of end2.")
});
function createEdge(request) {
  const { id: createId, preset } = resolveCreateType(request.type);
  const modelType = modelTypeOf(createId);
  const kind = modelType ? relationshipKind(modelType) : null;
  const values = valuesFor(createId, request.name, request.properties);
  const ends = endValues(modelType, kind, request.tailEnd, request.headEnd);
  return createModelAndView({
    ...preset,
    id: createId,
    parent: request.parent,
    diagram: request.diagram,
    tailView: request.tail,
    headView: request.head,
    tailModel: request.tail.model,
    headModel: request.head.model,
    ...edgeGeometry(request.tail, request.head, request),
    modelInitializer: (m) => {
      Object.assign(m, values);
      assignEnds(m, ends);
    }
  });
}
var createEdgeWithView = defineEndpoint({
  path: "/create_edge_with_view",
  description: "Create a relationship (UMLAssociation, UMLControlFlow, ...) between the models of two views, and the edge view connecting them. /create_relationship does the same and also accepts model ids and end attributes.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A model-and-view id of /introspect factory.modelAndViewIds whose entry has a relationship kind, e.g. 'UMLAssociation', an edge id such as 'NoteLink', or a toolbox item id such as 'UMLComposition' or 'UMLAsyncMessage'."
    ),
    diagramId: id("Diagram to place the edge on."),
    parentId: optional(
      id(
        "Passed to the factory as the diagram editor does; default the diagram's owner. Most relationship factories file the relationship under the tail model regardless."
      )
    ),
    tailViewId: id("View at the source end."),
    headViewId: id("View at the target end."),
    name: optional(text2("Relationship name.")),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...endShape(),
    ...geometryShape(),
    ...projectionShape()
  }),
  response: createdSchema(),
  handle: (input) => {
    const diagram = requireDiagram(input.diagramId);
    const parent = input.parentId === void 0 ? diagram._parent : requireElement(input.parentId, "Parent");
    const view = createEdge({
      ...input,
      parent,
      diagram,
      tail: requireView(input.tailViewId, "Tail view"),
      head: requireView(input.headViewId, "Head view")
    });
    return created(view, input);
  }
});
function createModelOnly(modelType, kind, input, tail, head) {
  const values = initialValues(modelType, input.name, input.properties);
  const ends = endValues(modelType, kind, input.tailEnd, input.headEnd);
  const parent = input.parentId === void 0 ? defaultOwner(tail, modelType) : requireElement(input.parentId, "Parent");
  const field = resolveOwnerField(parent, modelType, input.field);
  const model = instantiate(modelType);
  if (kind === "directed") {
    model.source = tail;
    model.target = head;
  } else {
    model.end1.reference = tail;
    model.end2.reference = head;
  }
  Object.assign(model, values);
  assignEnds(model, ends);
  const stored = inStarUML(() => app.engine.addModel(parent, field, model));
  if (!stored) {
    throw new ApiError(
      "STARUML_ERROR",
      `StarUML did not add ${modelType} to ${parent.constructor.name}.${field}`
    );
  }
  return stored;
}
function defaultOwner(tail, modelType) {
  const owner = tail._parent;
  const field = owner ? ownerField(owner, modelType) : null;
  if (owner && field) {
    const attr = attributeOf(owner.constructor.name, field);
    if (attr.type !== "Element") return owner;
  }
  return tail;
}
function endModel(id2, role) {
  const elem = requireElement(id2, role);
  const model = elem instanceof type.View ? elem.model : elem;
  if (!model) {
    throw new ApiError("INVALID_ARGUMENT", `${role} ${id2} shows no model`);
  }
  return model;
}
var createRelationship = defineEndpoint({
  path: "/create_relationship",
  description: "Create a relationship between two elements with its ends set: source/target for directed kinds (Generalization, Dependency, Realization, InterfaceRealization, Include, Extend, Transition, ControlFlow, ObjectFlow, Message, flows of the other diagram families), end1/end2 for undirected ones (Association with end name, navigability, aggregation, multiplicity; Link; ERD relationship; connectors). With diagramId the edge view is created too, through StarUML's own factory and its connection rules; tail/head may then be view ids or ids of models shown on that diagram.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "With diagramId: a model-and-view id (see /introspect factory.modelAndView) or a toolbox item id that presets one, e.g. 'UMLComposition', 'UMLReplyMessage', 'ERDRelationshipOneToMany'. Without: a metamodel class whose relationship kind is directed or undirected."
    ),
    tailId: id("Source end: a model, or a view on the diagram."),
    headId: id("Target end: a model, or a view on the diagram."),
    diagramId: optional(id("Diagram to draw the relationship on.")),
    parentId: optional(
      id(
        "Owner of the relationship. With a diagram it is passed to the factory as the diagram editor does (default the diagram's owner); most relationship factories file the relationship under the tail model regardless. Without a diagram the default is the tail's owner when that has a list for this type (messages, edges, transitions), else the tail model."
      )
    ),
    field: optional(
      doc(
        string2().check(_minLength(1)),
        "Without a diagram: owner list to add to; default the list typed for the relationship, e.g. 'messages' of a UMLInteraction."
      )
    ),
    name: optional(text2("Relationship name.")),
    properties: properties(
      `${ATTRIBUTE_VALUES_HELP} E.g. {messageSort: "asynchCall"} for a UMLMessage, {guard: "x > 0"} for a UMLControlFlow.`
    ),
    ...endShape(),
    ...geometryShape(),
    ...projectionShape()
  }),
  response: object({
    view: doc(nullable(elementSchema()), "Null without a diagram."),
    model: doc(
      nullable(elementSchema()),
      "Null for view-only edge ids such as NoteLink."
    )
  }),
  handle: (input) => {
    if (input.diagramId !== void 0) {
      const diagram = requireDiagram(input.diagramId);
      if (input.field !== void 0) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          "field applies without a diagram; the factory function decides where a drawn relationship goes"
        );
      }
      const view = createEdge({
        ...input,
        parent: input.parentId === void 0 ? diagram._parent : requireElement(input.parentId, "Parent"),
        diagram,
        tail: endView(input.tailId, diagram, "Tail"),
        head: endView(input.headId, diagram, "Head")
      });
      return created(view, input);
    }
    const kind = isMetaClass(input.type) ? relationshipKind(input.type) : null;
    if (!kind) {
      throw new ApiError(
        "UNKNOWN_TYPE",
        `Not a relationship type: ${input.type}`
      );
    }
    const model = createModelOnly(
      input.type,
      kind,
      input,
      endModel(input.tailId, "Tail"),
      endModel(input.headId, "Head")
    );
    return { view: null, model: serialize(model, input) };
  }
});

// src/handlers/views.ts
var LINE_STYLES = {
  rectilinear: 0,
  oblique: 1,
  roundrect: 2,
  curve: 3
};
var STEREOTYPE_DISPLAYS = [
  "none",
  "label",
  "decoration",
  "decoration-label",
  "icon",
  "icon-label"
];
var LAYOUT_DIRECTIONS = ["TB", "BT", "LR", "RL"];
var lineStyle = (description) => doc(
  _enum(Object.keys(LINE_STYLES)),
  description
);
var color = (description) => optional(
  doc(
    string2().check(_regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)),
    description
  )
);
var viewIds = () => doc(
  array(string2().check(_minLength(1))).check(_minLength(1)),
  "View ids, all on one diagram."
);
function requireViewsOnOneDiagram(ids2) {
  const views = ids2.map((i) => requireView(i));
  const diagram = diagramOf(views[0]);
  const stray = views.find((v) => diagramOf(v) !== diagram);
  if (stray) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `View ${stray._id} is not on diagram ${diagram._id} like ${views[0]._id}`
    );
  }
  return { views, diagram };
}
function editorShowing(diagram) {
  if (app.diagrams.getCurrentDiagram() !== diagram) {
    inStarUML(() => app.diagrams.setCurrentDiagram(diagram));
  }
  return app.diagrams.getEditor();
}
var viewsResult = () => object({
  diagram: doc(string2(), "Id of the diagram the views are on."),
  views: array(elementSchema())
});
function projectionOr(input, fields) {
  return input.fields !== void 0 || input.summary !== void 0 ? input : { ...input, fields };
}
function viewsResponse(diagram, views, projection) {
  return {
    diagram: diagram._id,
    views: views.map((v) => serialize(v, projection))
  };
}
var GEOMETRY = ["left", "top", "width", "height"];
var layoutDiagram = defineEndpoint({
  path: "/layout_diagram",
  description: "Arrange a diagram's node views automatically (Format > Layout in the UI), as one undoable operation. Opens the diagram in the editor.",
  readOnly: false,
  destructive: false,
  request: object({
    id: optional(id("Diagram id; default the current diagram.")),
    direction: optional(
      doc(
        _enum(LAYOUT_DIRECTIONS),
        "Rank direction: TB top to bottom (default), BT, LR, RL."
      )
    ),
    separations: optional(
      doc(
        object({
          node: number2().check(_gte(0)),
          edge: number2().check(_gte(0)),
          rank: number2().check(_gte(0))
        }),
        "Spacing in diagram units between nodes, edges and ranks; StarUML's defaults when omitted."
      )
    ),
    edgeLineStyle: optional(
      lineStyle("Line style applied to edges by the layout.")
    )
  }),
  response: object({ _id: string2(), direction: string2() }),
  handle: (input) => {
    const diagram = input.id === void 0 ? app.diagrams.getCurrentDiagram() : requireDiagram(input.id);
    if (!diagram) {
      throw new ApiError("NOT_FOUND", "No diagram is open; pass 'id'");
    }
    const direction2 = input.direction ?? "TB";
    const editor = editorShowing(diagram);
    inStarUML(
      () => app.engine.layoutDiagram(
        editor,
        diagram,
        direction2,
        input.separations,
        input.edgeLineStyle === void 0 ? void 0 : LINE_STYLES[input.edgeLineStyle]
      )
    );
    return { _id: diagram._id, direction: direction2 };
  }
});
var moveViews = defineEndpoint({
  path: "/move_views",
  description: "Move views by an offset, carrying contained views and connected edges along, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: object({
    ids: viewIds(),
    dx: doc(number2(), "Horizontal offset in diagram units."),
    dy: doc(number2(), "Vertical offset in diagram units."),
    ...projectionShape()
  }),
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
    const editor = editorShowing(diagram);
    inStarUML(() => app.engine.moveViews(editor, views, input.dx, input.dy));
    return viewsResponse(diagram, views, projectionOr(input, GEOMETRY));
  }
});
var resizeNode = defineEndpoint({
  path: "/resize_node",
  description: "Set a node view's bounds; omitted values keep the current ones. Connected edges follow, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: object({
    id: id("Node view id."),
    left: optional(doc(number2(), "Left edge in diagram units.")),
    top: optional(doc(number2(), "Top edge in diagram units.")),
    width: optional(doc(number2().check(_positive()), "Width.")),
    height: optional(doc(number2().check(_positive()), "Height.")),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const node = requireView(input.id);
    if (!(node instanceof type.NodeView)) {
      throw new ApiError("NOT_FOUND", `Node view not found: ${input.id}`);
    }
    const bounds = node;
    const left = input.left ?? bounds.left;
    const top = input.top ?? bounds.top;
    const right = left + (input.width ?? bounds.width);
    const bottom = top + (input.height ?? bounds.height);
    const editor = editorShowing(diagramOf(node));
    inStarUML(
      () => app.engine.resizeNode(editor, node, left, top, right, bottom)
    );
    return serialize(node, projectionOr(input, GEOMETRY));
  }
});
var setViewStyle = defineEndpoint({
  path: "/set_view_style",
  description: "Change how views are drawn: colours, font, edge line style, stereotype display, auto-resize (the Format menu). Each given property is one undoable operation.",
  readOnly: false,
  destructive: false,
  request: object({
    ids: viewIds(),
    fillColor: color("Fill colour, CSS hex such as '#ffcc00'."),
    lineColor: color("Line colour."),
    fontColor: color("Text colour."),
    fontFace: optional(
      doc(string2().check(_minLength(1)), "Font family, e.g. 'Arial'.")
    ),
    fontSize: optional(
      doc(number2().check(_positive()), "Font size in points.")
    ),
    lineStyle: optional(lineStyle("Edge line style; edges only.")),
    stereotypeDisplay: optional(
      doc(
        _enum(STEREOTYPE_DISPLAYS),
        "How a UML node view shows its stereotype."
      )
    ),
    autoResize: optional(
      doc(boolean2(), "Grow node views to fit their content.")
    ),
    ...projectionShape()
  }),
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
    const editor = editorShowing(diagram);
    const e = app.engine;
    const changes = [
      ["fillColor", () => e.setFillColor(editor, views, input.fillColor)],
      ["lineColor", () => e.setLineColor(editor, views, input.lineColor)],
      ["fontColor", () => e.setFontColor(editor, views, input.fontColor)],
      ["fontFace", () => e.setFontFace(editor, views, input.fontFace)],
      ["fontSize", () => e.setFontSize(editor, views, input.fontSize)],
      [
        "lineStyle",
        () => e.setLineStyle(editor, views, LINE_STYLES[input.lineStyle])
      ],
      [
        "stereotypeDisplay",
        () => e.setStereotypeDisplay(editor, views, input.stereotypeDisplay)
      ],
      ["autoResize", () => e.setAutoResize(editor, views, input.autoResize)]
    ];
    const given = changes.filter(([key]) => input[key] !== void 0);
    if (given.length === 0) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `Pass at least one of ${changes.map(([key]) => key).join(", ")}`
      );
    }
    for (const [, apply] of given) inStarUML(apply);
    const fields = given.map(
      ([key]) => key === "fontFace" || key === "fontSize" ? "font" : key
    );
    return viewsResponse(
      diagram,
      views,
      projectionOr(input, [...new Set(fields)])
    );
  }
});
var setZOrder = defineEndpoint({
  path: "/set_z_order",
  description: "Bring views to the front or send them to the back of their diagram, as one undoable operation. Views nested in another view keep their order.",
  readOnly: false,
  destructive: false,
  request: object({
    ids: viewIds(),
    position: doc(_enum(["front", "back"]), "Where to move the views.")
  }),
  response: object({
    diagram: string2(),
    order: doc(
      array(string2()),
      "The diagram's top-level view ids, back to front, after the change."
    )
  }),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
    const owned = diagram.ownedViews;
    const builder = app.repository.getOperationBuilder();
    builder.begin(
      input.position === "front" ? "bring to front" : "send to back"
    );
    const topLevel = views.filter((v) => v._parent === diagram);
    const ordered = input.position === "front" ? topLevel : topLevel.reverse();
    for (const view of ordered) {
      builder.fieldReorder(
        diagram,
        "ownedViews",
        view,
        input.position === "front" ? owned.length - 1 : 0
      );
    }
    builder.end();
    inStarUML(() => app.repository.doOperation(builder.getOperation()));
    return { diagram: diagram._id, order: owned.map((v) => v._id) };
  }
});

// src/handlers/editor.ts
var getSelection = defineEndpoint({
  path: "/get_selection",
  description: "What is selected in the UI: model elements (in the model explorer or as the models of selected views) and views.",
  readOnly: true,
  destructive: false,
  request: object(projectionShape()),
  response: object({
    models: array(elementSchema()),
    views: array(elementSchema())
  }),
  handle: (input) => ({
    models: app.selections.getSelectedModels().map((m) => serialize(m, input)),
    views: app.selections.getSelectedViews().map((v) => serialize(v, input))
  })
});
var ids = (description) => optional(doc(array(string2().check(_minLength(1))), description));
var setSelection = defineEndpoint({
  path: "/set_selection",
  description: "Select views in the diagram editor and/or model elements, replacing the selection; both empty or omitted clears it. Selecting views opens their diagram.",
  readOnly: false,
  destructive: false,
  request: object({
    viewIds: ids("Views to select, all on one diagram."),
    modelIds: ids("Model elements to select besides the views' models."),
    ...projectionShape()
  }),
  response: object({
    models: array(elementSchema()),
    views: array(elementSchema())
  }),
  handle: (input) => {
    const extra = (input.modelIds ?? []).map((i) => requireElement(i));
    const picked = input.viewIds && input.viewIds.length > 0 ? requireViewsOnOneDiagram(input.viewIds) : null;
    const views = picked ? picked.views : [];
    inStarUML(() => {
      app.diagrams.deselectAll();
      if (picked) {
        editorShowing(picked.diagram);
        const editor = app.diagrams.diagramEditor;
        editor.selectView(views[0]);
        for (const view of views.slice(1)) editor.selectAdditionalView(view);
      }
      const models = [];
      for (const m of [...views.map((v) => v.model), ...extra]) {
        if (m && !models.includes(m)) models.push(m);
      }
      app.selections.select(models, views);
    });
    return {
      models: app.selections.getSelectedModels().map((m) => serialize(m, input)),
      views: app.selections.getSelectedViews().map((v) => serialize(v, input))
    };
  }
});
var editorState = () => object({
  currentDiagram: doc(
    nullable(string2()),
    "Id of the diagram shown in the editor."
  ),
  workingDiagrams: doc(
    array(string2()),
    "Ids of the diagrams open as editor tabs, in tab order."
  ),
  zoom: doc(number2(), "Zoom scale, 1 = 100%."),
  topLeft: doc(
    nullable(object({ x: number2(), y: number2() })),
    "Diagram coordinates shown at the viewport's top-left corner; null without a current diagram."
  ),
  gridVisible: boolean2(),
  snapToGrid: boolean2()
});
function describeEditor() {
  const current = app.diagrams.getCurrentDiagram();
  return {
    currentDiagram: current ? current._id : null,
    workingDiagrams: app.diagrams.getWorkingDiagrams().map((d) => d._id),
    zoom: app.diagrams.getZoomLevel(),
    // DiagramEditor.setOrigin records the canvas origin on the diagram; it
    // clamps it to <= 0, the negated scroll offset in diagram units (7.1.1).
    topLeft: current ? {
      x: Math.abs(current._originX ?? 0),
      y: Math.abs(current._originY ?? 0)
    } : null,
    gridVisible: app.diagrams.isGridVisible(),
    snapToGrid: app.diagrams.getSnapToGrid()
  };
}
var getEditorState = defineEndpoint({
  path: "/get_editor_state",
  description: "The diagram editor's state: current and open diagrams, zoom, scroll position, grid.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: editorState(),
  handle: describeEditor
});
var setEditorState = defineEndpoint({
  path: "/set_editor_state",
  description: "Change the diagram editor's view: show a diagram, zoom, scroll, grid. Nothing here changes the model or the undo history; gridVisible and snapToGrid are stored as StarUML preferences, as the View menu does.",
  readOnly: false,
  destructive: false,
  request: object({
    diagramId: optional(id("Diagram to open and show first.")),
    zoom: optional(
      doc(
        number2().check(_gte(0.1), _lte(3)),
        "Zoom scale between 0.1 and 3 (DiagramEditor.setZoomScale's range)."
      )
    ),
    center: optional(
      doc(
        object({ x: number2(), y: number2() }),
        "Diagram point to centre the viewport on, in diagram units."
      )
    ),
    gridVisible: optional(boolean2()),
    snapToGrid: optional(boolean2())
  }),
  response: editorState(),
  handle: (input) => {
    const diagram = input.diagramId === void 0 ? null : requireDiagram(input.diagramId);
    inStarUML(() => {
      if (diagram) app.diagrams.setCurrentDiagram(diagram);
      if (input.zoom !== void 0) app.diagrams.setZoomLevel(input.zoom);
      if (input.center) app.diagrams.scrollTo(input.center.x, input.center.y);
      if (input.gridVisible === true) app.diagrams.showGrid();
      if (input.gridVisible === false) app.diagrams.hideGrid();
      if (input.snapToGrid !== void 0) {
        app.diagrams.setSnapToGrid(input.snapToGrid);
      }
    });
    return describeEditor();
  }
});

// src/handlers/export.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = require("node:path");

// src/app-modules.ts
var import_node_module2 = require("node:module");
var import_node_path2 = require("node:path");
function appModule(relative2) {
  const resources = process.resourcesPath;
  if (!resources) {
    throw new ApiError(
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML"
    );
  }
  const appRequire = (0, import_node_module2.createRequire)((0, import_node_path2.join)(resources, "app", "src", "index.js"));
  return appRequire(`./${relative2}`);
}
function diagramExport() {
  return appModule("engine/diagram-export.js");
}

// src/handlers/export.ts
var MAX_SCALE = 4;
var MIME = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml" };
function withoutSelection(diagram, run) {
  const selected = diagram.selectedViews;
  diagram.selectedViews = [];
  try {
    return run();
  } finally {
    diagram.selectedViews = selected;
  }
}
function withPixelRatio(ratio, run) {
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: ratio
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(window, "devicePixelRatio", original);
    else delete window.devicePixelRatio;
  }
}
function imageSize(data) {
  if (data.length >= 24 && data.readUInt32BE(12) === 1229472850) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  let at = 2;
  while (at + 9 <= data.length && data[at] === 255) {
    const marker = data[at + 1];
    if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
      return {
        width: data.readUInt16BE(at + 7),
        height: data.readUInt16BE(at + 5)
      };
    }
    at += 2 + data.readUInt16BE(at + 2);
  }
  return { width: 0, height: 0 };
}
async function composite(png, background, mime) {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(png)], { type: "image/png" })
  );
  const element = document.createElement("canvas");
  element.width = bitmap.width;
  element.height = bitmap.height;
  const context = element.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, element.width, element.height);
  context.drawImage(bitmap, 0, 0);
  return dataUrlBytes(element.toDataURL(mime));
}
var dataUrlBytes = (url) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
async function renderRaster(diagram, format, scale, background) {
  const mime = background === void 0 ? MIME[format] : MIME.png;
  const base642 = inStarUML(
    () => withoutSelection(
      diagram,
      () => withPixelRatio(scale, () => diagramExport().getImageData(diagram, mime))
    )
  );
  let data = Buffer.from(base642, "base64");
  if (background !== void 0) {
    data = await composite(data, background, MIME[format]);
  }
  return { data, ...imageSize(data) };
}
function renderSvg(diagram, background) {
  let svg = withoutSelection(
    diagram,
    () => diagramExport().getSVGImageData(diagram)
  );
  if (background) {
    svg = svg.replace(
      /<svg\b[^>]*>/,
      (open) => `${open}<rect width="100%" height="100%" fill="${background}"/>`
    );
  }
  const size = (attr) => Number(new RegExp(`<svg\\b[^>]*\\b${attr}="([\\d.]+)`).exec(svg)?.[1] ?? 0);
  return {
    data: Buffer.from(svg, "utf-8"),
    width: size("width"),
    height: size("height")
  };
}
var absolutePath = (description) => doc(
  string2().check(refine((p) => (0, import_node_path3.isAbsolute)(p), "must be an absolute path")),
  description
);
function currentOr(id2) {
  if (id2 !== void 0) return requireDiagram(id2);
  const current = app.diagrams.getCurrentDiagram();
  if (!current)
    throw new ApiError("NOT_FOUND", "No diagram is open; pass 'id'");
  return current;
}
var exportDiagram = defineEndpoint({
  path: "/export_diagram",
  description: "Render a diagram as PNG, JPEG or SVG, as File > Export Diagram As does, and return it base64-encoded or write it to a file.",
  readOnly: false,
  destructive: true,
  request: object({
    id: optional(doc(string2(), "Diagram id; default the current diagram.")),
    format: optional(
      doc(_enum(["png", "jpeg", "svg"]), "Image format; default png.")
    ),
    scale: optional(
      doc(
        number2().check(_positive(), _lte(MAX_SCALE)),
        `Pixels per diagram unit for PNG and JPEG, up to ${MAX_SCALE}; default 1. File > Export uses the display's pixel ratio. SVG is unscaled.`
      )
    ),
    background: optional(
      doc(
        string2().check(_regex(/^(#[0-9a-f]{3,8}|[a-z]+)$/i)),
        "CSS colour behind the diagram, e.g. '#ffffff'. Default transparent, white for JPEG."
      )
    ),
    path: optional(
      absolutePath(
        "Absolute file to write; overwritten, parent directories created. Omit to receive the image in the response."
      )
    )
  }),
  response: object({
    diagram: string2(),
    format: string2(),
    mimeType: string2(),
    width: doc(number2(), "Pixels; SVG user units for svg."),
    height: number2(),
    bytes: doc(int(), "Size of the encoded image."),
    path: optional(
      doc(string2(), "The file written, when 'path' was given.")
    ),
    base64: optional(
      doc(string2(), "The image, when 'path' was not given.")
    )
  }),
  handle: async (input) => {
    const diagram = currentOr(input.id);
    const format = input.format ?? "png";
    const image = format === "svg" ? inStarUML(() => renderSvg(diagram, input.background)) : await renderRaster(
      diagram,
      format,
      input.scale ?? 1,
      input.background
    );
    return deliver(
      {
        diagram: diagram._id,
        format,
        mimeType: MIME[format],
        width: image.width,
        height: image.height,
        bytes: image.data.length
      },
      image.data,
      input.path
    );
  }
});
function deliver(meta3, data, path) {
  if (path === void 0) return { ...meta3, base64: data.toString("base64") };
  writeFile(path, data);
  return { ...meta3, path };
}
function writeFile(path, data) {
  try {
    (0, import_node_fs2.mkdirSync)((0, import_node_path3.dirname)(path), { recursive: true });
    (0, import_node_fs2.writeFileSync)(path, data);
  } catch (err) {
    throw new ApiError(
      "STARUML_ERROR",
      `Cannot write ${path}: ${err.message}`
    );
  }
}
function fileStem(diagram, taken) {
  const name = typeof diagram.name === "string" ? diagram.name : "";
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const stem = clean === "" || taken.has(clean.toLowerCase()) ? `${clean || "diagram"}-${diagram._id}` : clean;
  taken.add(stem.toLowerCase());
  return stem;
}
var exportDiagrams = defineEndpoint({
  path: "/export_diagrams",
  description: "Write diagrams as image files into a directory, one per diagram named after it, as File > Export Diagrams does; /export_diagram renders one.",
  readOnly: false,
  destructive: true,
  request: object({
    path: absolutePath(
      "Absolute directory to write into; created if missing. Files of the same name are overwritten."
    ),
    ids: optional(
      doc(
        array(string2().check(_minLength(1))).check(_minLength(1)),
        "Diagram ids; default every diagram in the project."
      )
    ),
    format: optional(
      doc(_enum(["png", "jpeg", "svg"]), "Image format; default png.")
    ),
    scale: optional(
      doc(
        number2().check(_positive(), _lte(MAX_SCALE)),
        "As for /export_diagram."
      )
    ),
    background: optional(
      doc(
        string2().check(_regex(/^(#[0-9a-f]{3,8}|[a-z]+)$/i)),
        "As for /export_diagram."
      )
    )
  }),
  response: object({
    path: string2(),
    format: string2(),
    count: int(),
    files: array(
      object({
        diagram: string2(),
        file: doc(string2(), "Absolute path written."),
        width: number2(),
        height: number2(),
        bytes: int()
      })
    )
  }),
  handle: async (input) => {
    requireProject();
    const diagrams = input.ids ? input.ids.map((i) => requireDiagram(i)) : app.repository.getInstancesOf("Diagram");
    if (diagrams.length === 0) {
      throw new ApiError("NOT_FOUND", "The project has no diagrams");
    }
    const format = input.format ?? "png";
    const extension = format === "jpeg" ? "jpg" : format;
    const taken = /* @__PURE__ */ new Set();
    const files = [];
    for (const diagram of diagrams) {
      const image = format === "svg" ? inStarUML(() => renderSvg(diagram, input.background)) : await renderRaster(
        diagram,
        format,
        input.scale ?? 1,
        input.background
      );
      const file = (0, import_node_path3.join)(input.path, `${fileStem(diagram, taken)}.${extension}`);
      writeFile(file, image.data);
      files.push({
        diagram: diagram._id,
        file,
        width: image.width,
        height: image.height,
        bytes: image.data.length
      });
    }
    return { path: input.path, format, count: files.length, files };
  }
});
var PDF_WAIT_MS = 3e4;
var PDF_POLL_MS = 50;
async function waitForPdf(path, timeoutMs2) {
  const deadline = Date.now() + timeoutMs2;
  for (; ; ) {
    if ((0, import_node_fs2.existsSync)(path) && (0, import_node_fs2.readFileSync)(path).subarray(-32).includes("%%EOF")) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new ApiError(
        "STARUML_ERROR",
        `PDF was not completed within ${timeoutMs2} ms: ${path}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PDF_POLL_MS));
  }
}
var exportPdf = defineEndpoint({
  path: "/export_pdf",
  description: "Write diagrams to a PDF file, one page each, as File > Print to PDF and the CLI's pdf command do.",
  readOnly: false,
  destructive: true,
  request: object({
    path: absolutePath("Absolute .pdf file to write; overwritten."),
    ids: optional(
      doc(
        array(string2().check(_minLength(1))).check(_minLength(1)),
        "Diagram ids in page order; default every diagram in the project."
      )
    ),
    size: optional(
      doc(
        string2().check(_minLength(1)),
        "pdfkit page size, e.g. 'A4' (default), 'LETTER', 'A3'."
      )
    ),
    layout: optional(
      doc(_enum(["landscape", "portrait"]), "Default landscape.")
    ),
    showName: optional(
      doc(boolean2(), "Print each diagram's path name; default true.")
    )
  }),
  response: object({
    path: string2(),
    pages: int(),
    bytes: int()
  }),
  handle: async (input) => {
    requireProject();
    const diagrams = input.ids ? input.ids.map((i) => requireDiagram(i)) : app.repository.getInstancesOf("Diagram");
    if (diagrams.length === 0) {
      throw new ApiError("NOT_FOUND", "The project has no diagrams");
    }
    writeFile(input.path, Buffer.alloc(0));
    inStarUML(
      () => diagramExport().exportToPDF(diagrams, input.path, {
        size: input.size ?? "A4",
        layout: input.layout ?? "landscape",
        showName: input.showName ?? true
      })
    );
    await waitForPdf(input.path, PDF_WAIT_MS);
    return {
      path: input.path,
      pages: diagrams.length,
      bytes: (0, import_node_fs2.readFileSync)(input.path).length
    };
  }
});
var exportHtml = defineEndpoint({
  path: "/export_html",
  description: "Write HTML documentation of the whole project, with diagram images, into a directory (File > Export > HTML Docs).",
  readOnly: false,
  destructive: true,
  request: object({
    path: absolutePath(
      "Absolute directory to write into; created if missing. index.html is its entry page."
    )
  }),
  response: object({ path: string2(), index: string2() }),
  handle: async (input) => {
    requireProject();
    const command = "html-export:export";
    if (!Object.hasOwn(app.commands.commands, command)) {
      throw new ApiError(
        "STARUML_ERROR",
        "The bundled html-export extension is not loaded"
      );
    }
    const index = (0, import_node_path3.join)(input.path, "index.html");
    (0, import_node_fs2.rmSync)(index, { force: true });
    await app.commands.execute(command, input.path);
    if (!(0, import_node_fs2.existsSync)(index)) {
      throw new ApiError("STARUML_ERROR", `HTML export wrote no ${index}`);
    }
    return { path: input.path, index };
  }
});

// src/handlers/history.ts
var state = () => object({
  modified: doc(
    boolean2(),
    "Whether the project has changes not yet saved to its file."
  )
});
var undo = defineEndpoint({
  path: "/undo",
  description: "Undo the last change (Edit > Undo). Every endpoint that changes the model is one step; an atomic /batch is one step.",
  readOnly: false,
  destructive: true,
  request: object({}),
  response: state(),
  handle: () => {
    inStarUML(() => app.repository.undo());
    return { modified: app.repository.isModified() };
  }
});
var redo = defineEndpoint({
  path: "/redo",
  description: "Redo the last undone change (Edit > Redo).",
  readOnly: false,
  destructive: true,
  request: object({}),
  response: state(),
  handle: () => {
    inStarUML(() => app.repository.redo());
    return { modified: app.repository.isModified() };
  }
});
var isModified = defineEndpoint({
  path: "/is_modified",
  description: "Whether the project has unsaved changes.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: state(),
  handle: () => ({ modified: app.repository.isModified() })
});

// src/handlers/queries.ts
var listResult = () => object({ count: int(), elements: array(elementSchema()) });
function listOf(elements, projection) {
  return {
    count: elements.length,
    elements: elements.map((e) => serialize(e, projection))
  };
}
var getViewsOf = defineEndpoint({
  path: "/get_views_of",
  description: "Every view of a model element, on any diagram; empty for a model that is in no diagram.",
  readOnly: true,
  destructive: false,
  request: object({ id: id("Model element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) => listOf(app.repository.getViewsOf(requireElement(input.id)), input)
});
var getEdgeViewsOf = defineEndpoint({
  path: "/get_edge_views_of",
  description: "Edge views attached to a view at either end.",
  readOnly: true,
  destructive: false,
  request: object({ id: id("View id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) => listOf(app.repository.getEdgeViewsOf(requireView(input.id)), input)
});
var getRelationshipsOf = defineEndpoint({
  path: "/get_relationships_of",
  description: "Relationships (generalizations, associations, dependencies, ...) that have the element at an end.",
  readOnly: true,
  destructive: false,
  request: object({ id: id("Model element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) => listOf(app.repository.getRelationshipsOf(requireElement(input.id)), input)
});
var getRefsTo = defineEndpoint({
  path: "/get_refs_to",
  description: "Every element holding a reference to the element: typed attributes, relationship ends, views showing it. Check before deleting.",
  readOnly: true,
  destructive: false,
  request: object({ id: id("Element id."), ...projectionShape() }),
  response: listResult(),
  handle: (input) => listOf(app.repository.getRefsTo(requireElement(input.id)), input)
});
var getConnectedNodeViews = defineEndpoint({
  path: "/get_connected_node_views",
  description: "Node views at the other end of a view's edges, optionally only edges of one view type.",
  readOnly: true,
  destructive: false,
  request: object({
    id: id("View id."),
    edgeType: optional(
      typeName(
        "Edge view type to follow, e.g. 'UMLAssociationView'; default every EdgeView."
      )
    ),
    ...projectionShape()
  }),
  response: listResult(),
  handle: (input) => {
    const view = requireView(input.id);
    const edgeType = input.edgeType ?? "EdgeView";
    requireTypeName(edgeType);
    const nodes = inStarUML(
      () => app.repository.getConnectedNodeViews(view, type[edgeType])
    );
    return listOf(nodes, input);
  }
});

// src/routes.ts
var endpoints = [
  getAllCommands,
  describeCommands,
  executeCommand,
  getProjectInfo,
  saveProject,
  saveProjectAs,
  newProject,
  openProject,
  getElementById,
  findElements,
  createElement,
  updateElement,
  deleteElement,
  createElementWithView,
  createEdgeWithView,
  createRelationship,
  addAttribute,
  addOperation,
  addParameter,
  addEnumerationLiteral,
  addTemplateParameter,
  addSlot,
  addTag,
  setStereotype,
  setDocumentation,
  createDiagram,
  switchDiagram,
  closeDiagram,
  getViewsOf,
  getEdgeViewsOf,
  getRelationshipsOf,
  getRefsTo,
  getConnectedNodeViews,
  layoutDiagram,
  moveViews,
  resizeNode,
  setViewStyle,
  setZOrder,
  getSelection,
  setSelection,
  getEditorState,
  setEditorState,
  exportDiagram,
  exportDiagrams,
  exportPdf,
  exportHtml,
  listCodeGenerators,
  generateCode,
  reverseCode,
  undo,
  redo,
  isModified,
  batchEndpoint(() => endpoints),
  introspectEndpoint(() => endpoints),
  debug
];
var routes = Object.fromEntries(
  endpoints.map((e) => [e.path, e.handler])
);

// src/main.ts
var import_node_crypto2 = require("node:crypto");
var DEFAULT_PORT = 58322;
var PREF_ENABLED = PREF.enabled;
var PREF_PORT = PREF.port;
var LOG_PREFIX = `[${EXTENSION_NAME}]`;
var server = null;
async function init() {
  app.commands.register(
    "mcp-ext:server-info",
    showServerInfo,
    "MCP Extension: Server Info"
  );
  app.commands.register(
    "mcp-ext:set-token",
    setToken,
    "MCP Extension: Generate Access Token"
  );
  if (app.preferences.get(PREF_ENABLED, true) !== true) {
    log(
      "info",
      `${LOG_PREFIX} HTTP server disabled by preference ${PREF_ENABLED}`
    );
    return;
  }
  const port = app.preferences.get(PREF_PORT, DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    log(
      "error",
      `${LOG_PREFIX} ${PREF_PORT} must be an integer in 0..65535, got ${String(port)}`
    );
    return;
  }
  const candidate = new ExtensionHttpServer({
    port,
    handlers: routes,
    policy: preferencePolicy(),
    onLog: log
  });
  try {
    await candidate.start();
  } catch (err) {
    log(
      "error",
      `${LOG_PREFIX} failed to listen on port ${String(port)}: ${errorMessage(err)}`
    );
    return;
  }
  server = candidate;
}
async function shutdown() {
  const running = server;
  server = null;
  await running?.stop();
}
function log(level, message) {
  if (!logs(level)) return;
  if (level === "error") console.error(message);
  else console.log(message);
}
function showServerInfo() {
  const address = server?.address;
  const status = address ? `Listening on http://${address.address}:${address.port}` : "HTTP server is not running";
  const origins = allowedOrigins();
  const access = [
    token() ? "Access token: required (Authorization: Bearer <token>)" : "Access token: none; any local process can call the endpoints",
    `Allowed browser origins: ${origins.length > 0 ? origins.join(", ") : "none"}`
  ].join("\n");
  app.dialogs.showInfoDialog(
    `${EXTENSION_NAME} v${EXTENSION_VERSION}

${status}
${access}

Endpoints:
  ${Object.keys(routes).sort().join("\n  ")}`
  );
}
function setToken(value) {
  const next = typeof value === "string" ? value.trim() : (0, import_node_crypto2.randomBytes)(24).toString("base64url");
  app.preferences.set(PREF.token, next);
  if (value === void 0) {
    app.dialogs.showInfoDialog(
      `New access token:

${next}

Clients must send 'Authorization: Bearer ${next}'. It is stored in Preferences > MCP Extension.`
    );
  }
  return next ? "set" : "cleared";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PORT,
  PREF_ENABLED,
  PREF_PORT,
  init,
  log,
  setToken,
  showServerInfo,
  shutdown
});
