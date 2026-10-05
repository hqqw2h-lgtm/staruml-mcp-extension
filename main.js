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
  showServerInfo: () => showServerInfo,
  shutdown: () => shutdown
});
module.exports = __toCommonJS(main_exports);

// src/http-server.ts
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
  /** An id that names no element, or an element of the wrong kind. */
  NOT_FOUND: 404,
  UNKNOWN_ENDPOINT: 404,
  METHOD_NOT_ALLOWED: 405,
  /** The operation needs an open project, or a saved one. */
  NO_PROJECT: 409,
  /** StarUML refused the operation, e.g. a factory precondition failed. */
  STARUML_ERROR: 422,
  /** A defect in this extension; details are in StarUML's developer console. */
  INTERNAL: 500
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
function createRequestListener(handlers, log) {
  return async (req, res) => {
    const path = req.url.split("?")[0];
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
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
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
    const started = import_node_perf_hooks.performance.now();
    try {
      const result = await handler(body);
      const status = result.success ? 200 : ERROR_STATUS[result.code];
      sendJson(res, status, result, started);
    } catch (err) {
      log(
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
    this.listener = createRequestListener(options.handlers, this.log);
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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sendError(res, code, error2) {
  const body = { success: false, code, error: error2 };
  sendJson(res, ERROR_STATUS[code], body);
}
function sendJson(res, status, body, handlerStarted) {
  const text2 = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text2)
  };
  if (handlerStarted !== void 0) {
    const ms = import_node_perf_hooks.performance.now() - handlerStarted;
    headers["Server-Timing"] = `handler;dur=${ms.toFixed(3)}`;
  }
  res.writeHead(status, headers);
  res.end(text2);
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
function text(description) {
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
var executeCommand = defineEndpoint({
  path: "/execute_command",
  description: "Run a registered StarUML command (see /get_all_commands). Commands can do anything the UI can, including deleting data.",
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
    let result;
    try {
      result = await app.commands.execute(input.id, ...input.args ?? []);
    } catch (err) {
      throw new ApiError(
        "STARUML_ERROR",
        `Command ${input.id} threw: ${errorMessage(err)}`
      );
    }
    return { id: input.id, result: serializeValue(result, input) };
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
    name: optional(text("Diagram name; StarUML generates one if omitted.")),
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
    name: optional(text("Exact element name.")),
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
    name: optional(text("Element name; StarUML generates one if omitted.")),
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
    name: optional(text("Element name; StarUML generates one if omitted.")),
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
var str = (description) => optional(text(description));
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
    name: text("Attribute name."),
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
  name: text("Parameter name."),
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
    name: text("Operation name."),
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
    name: text("Literal name."),
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
    name: text("Parameter name, e.g. 'T'."),
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
    name: text("Tag name."),
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
    documentation: text("Documentation; replaces the current text."),
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
    name: optional(text("Relationship name.")),
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
    name: optional(text("Relationship name.")),
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
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");

// src/app-modules.ts
var import_node_module = require("node:module");
var import_node_path = require("node:path");
function appModule(relative) {
  const resources = process.resourcesPath;
  if (!resources) {
    throw new ApiError(
      "STARUML_ERROR",
      "StarUML's modules are only available inside StarUML"
    );
  }
  const appRequire = (0, import_node_module.createRequire)((0, import_node_path.join)(resources, "app", "src", "index.js"));
  return appRequire(`./${relative}`);
}
function diagramExport() {
  return appModule("engine/diagram-export.js");
}

// src/handlers/export.ts
var BOUNDING_BOX_EXPAND = 10;
var RASTER_MARGIN = 30;
var PRO_DIAGRAM_TYPES = [
  "SysMLRequirementDiagram",
  "SysMLBlockDefinitionDiagram",
  "SysMLInternalBlockDiagram",
  "SysMLParametricDiagram",
  "BPMNDiagram",
  "WFWireframeDiagram",
  "AWSDiagram",
  "GCPDiagram"
];
var MAX_SCALE = 4;
var MIME = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml" };
function watermarkFor(diagram) {
  const status = app.licenseStore.getLicenseStatus();
  if (status.trial) return [70, 12, "UNREGISTERED"];
  if (status.edition !== "PRO" && PRO_DIAGRAM_TYPES.includes(diagram.constructor.name)) {
    return [45, 12, "PRO ONLY"];
  }
  return null;
}
function renderRaster(diagram, format, scale, background) {
  const element = document.createElement("canvas");
  const Canvas = type.Canvas;
  const Point = type.Point;
  const ZoomFactor = type.ZoomFactor;
  const canvas = new Canvas(element.getContext("2d"));
  const box = diagram.getBoundingBoxWithChildren(canvas);
  box.expand(BOUNDING_BOX_EXPAND);
  canvas.origin = new Point(-box.x1, -box.y1);
  canvas.zoomFactor = new ZoomFactor(1, 1);
  canvas.ratio = scale;
  element.width = Math.ceil((box.getWidth() + RASTER_MARGIN) * scale);
  element.height = Math.ceil((box.getHeight() + RASTER_MARGIN) * scale);
  const fill = background ?? (format === "jpeg" ? "#ffffff" : void 0);
  if (fill) {
    const context = element.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, element.width, element.height);
  }
  const mark = watermarkFor(diagram);
  if (mark) {
    diagram.drawWatermark(canvas, element.width, element.height, ...mark);
  }
  diagram.arrangeDiagram(canvas);
  diagram.drawDiagram(canvas, false);
  const base642 = element.toDataURL(MIME[format]).replace(/^data:image\/(png|jpeg);base64,/, "");
  return {
    data: Buffer.from(base642, "base64"),
    width: element.width,
    height: element.height
  };
}
function renderSvg(diagram, background) {
  const selected = diagram.selectedViews;
  diagram.selectedViews = [];
  let svg;
  try {
    svg = diagramExport().getSVGImageData(diagram);
  } finally {
    diagram.selectedViews = selected;
  }
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
  string2().check(refine((p) => (0, import_node_path2.isAbsolute)(p), "must be an absolute path")),
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
  handle: (input) => {
    const diagram = currentOr(input.id);
    const format = input.format ?? "png";
    const image = inStarUML(
      () => format === "svg" ? renderSvg(diagram, input.background) : renderRaster(diagram, format, input.scale ?? 1, input.background)
    );
    const meta3 = {
      diagram: diagram._id,
      format,
      mimeType: MIME[format],
      width: image.width,
      height: image.height,
      bytes: image.data.length
    };
    if (input.path === void 0) {
      return { ...meta3, base64: image.data.toString("base64") };
    }
    writeFile(input.path, image.data);
    return { ...meta3, path: input.path };
  }
});
function writeFile(path, data) {
  try {
    (0, import_node_fs.mkdirSync)((0, import_node_path2.dirname)(path), { recursive: true });
    (0, import_node_fs.writeFileSync)(path, data);
  } catch (err) {
    throw new ApiError(
      "STARUML_ERROR",
      `Cannot write ${path}: ${err.message}`
    );
  }
}
var PDF_WAIT_MS = 3e4;
var PDF_POLL_MS = 50;
async function waitForPdf(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (; ; ) {
    if ((0, import_node_fs.existsSync)(path) && (0, import_node_fs.readFileSync)(path).subarray(-32).includes("%%EOF")) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new ApiError(
        "STARUML_ERROR",
        `PDF was not completed within ${timeoutMs} ms: ${path}`
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
      bytes: (0, import_node_fs.readFileSync)(input.path).length
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
    const index = (0, import_node_path2.join)(input.path, "index.html");
    (0, import_node_fs.rmSync)(index, { force: true });
    await app.commands.execute(command, input.path);
    if (!(0, import_node_fs.existsSync)(index)) {
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
  exportPdf,
  exportHtml,
  undo,
  redo,
  isModified,
  introspectEndpoint(() => endpoints),
  debug
];
var routes = Object.fromEntries(
  endpoints.map((e) => [e.path, e.handler])
);

// src/main.ts
var DEFAULT_PORT = 58322;
var PREF_ENABLED = "mcp-ext.server.enabled";
var PREF_PORT = "mcp-ext.server.port";
var LOG_PREFIX = `[${EXTENSION_NAME}]`;
var server = null;
async function init() {
  app.commands.register(
    "mcp-ext:server-info",
    showServerInfo,
    "MCP Extension: Server Info"
  );
  if (app.preferences.get(PREF_ENABLED, true) !== true) {
    console.log(
      `${LOG_PREFIX} HTTP server disabled by preference ${PREF_ENABLED}`
    );
    return;
  }
  const port = app.preferences.get(PREF_PORT, DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(
      `${LOG_PREFIX} ${PREF_PORT} must be an integer in 0..65535, got ${String(port)}`
    );
    return;
  }
  const candidate = new ExtensionHttpServer({
    port,
    handlers: routes,
    onLog: (level, msg) => level === "error" ? console.error(msg) : console.log(msg)
  });
  try {
    await candidate.start();
  } catch (err) {
    console.error(
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
function showServerInfo() {
  const address = server?.address;
  const status = address ? `Listening on http://${address.address}:${address.port}` : "HTTP server is not running";
  app.dialogs.showInfoDialog(
    `${EXTENSION_NAME} v${EXTENSION_VERSION}

${status}

Endpoints:
  ${Object.keys(routes).sort().join("\n  ")}`
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PORT,
  PREF_ENABLED,
  PREF_PORT,
  init,
  showServerInfo,
  shutdown
});
