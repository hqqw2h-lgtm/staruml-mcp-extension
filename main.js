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
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
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
var anyString = /^[\s\S]{0,}$/;
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
    const meta2 = _meta[0];
    this._map.set(schema, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta2 = this._map.get(schema);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
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
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
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
  register(reg, meta2) {
    reg.add(this, meta2);
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

// src/handlers/commands.ts
var getAllCommands = defineEndpoint({
  path: "/get_all_commands",
  description: "Ids of every registered command.",
  readOnly: true,
  destructive: false,
  request: object({}),
  response: object({ count: int(), ids: array(string2()) }),
  handle: () => {
    const ids = Object.keys(app.commands.commands).sort();
    return { count: ids.length, ids };
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
function nameInitializer(name) {
  if (name === void 0) return {};
  return {
    modelInitializer: (m) => {
      m.name = name;
    }
  };
}
var createElement = defineEndpoint({
  path: "/create_element",
  description: "Create a model element (no view) under a parent, e.g. a UMLClass in a UMLModel.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName("A model id of app.factory.getModelIds(), e.g. 'UMLClass'."),
    parentId: id("Owner element id."),
    name: optional(text("Element name; StarUML generates one if omitted.")),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent element");
    const elem = inStarUML(
      () => app.factory.createModel({
        id: input.type,
        parent,
        ...nameInitializer(input.name)
      })
    );
    if (!elem) {
      throw new ApiError("UNKNOWN_TYPE", `Unknown model type: ${input.type}`);
    }
    return serialize(elem, input);
  }
});
var updateElement = defineEndpoint({
  path: "/update_element",
  description: "Set one attribute of an element.",
  readOnly: false,
  destructive: true,
  request: object({
    id: id("Element id."),
    field: doc(string2().check(_minLength(1)), "Attribute name."),
    value: doc(unknown(), "New value."),
    ...projectionShape()
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.id);
    if (typeof elem[input.field] === "undefined") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${elem.constructor.name} has no field '${input.field}'`
      );
    }
    inStarUML(() => app.engine.setProperty(elem, input.field, input.value));
    return serialize(elem, input);
  }
});
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
var createdSchema = () => object({ view: elementSchema(), model: elementSchema() });
function createModelAndView(options, projection) {
  const view = inStarUML(() => app.factory.createModelAndView(options));
  if (!view) {
    throw new ApiError(
      "UNKNOWN_TYPE",
      `Unknown model-and-view type: ${options.id}`
    );
  }
  return {
    view: serialize(view, projection),
    model: serialize(view.model, projection)
  };
}
var placementShape = () => ({
  parentId: id("Owner of the new model element."),
  diagramId: id("Diagram to place the view on.")
});
var createElementWithView = defineEndpoint({
  path: "/create_element_with_view",
  description: "Create a model element and its view on a diagram, e.g. a UMLClass shown on a UMLClassDiagram.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A model-and-view id of app.factory.getModelAndViewIds(), e.g. 'UMLClass', 'UMLUseCase'."
    ),
    ...placementShape(),
    name: optional(text("Element name; StarUML generates one if omitted.")),
    x: coordinate("Left edge in diagram coordinates, default 100."),
    y: coordinate("Top edge, default 100."),
    x2: coordinate("Right edge, default x + 100."),
    y2: coordinate("Bottom edge, default y + 50."),
    ...projectionShape()
  }),
  response: createdSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent");
    const diagram = requireDiagram(input.diagramId);
    const x1 = input.x ?? 100;
    const y1 = input.y ?? 100;
    return createModelAndView(
      {
        id: input.type,
        parent,
        diagram,
        x1,
        y1,
        x2: input.x2 ?? x1 + 100,
        y2: input.y2 ?? y1 + 50,
        ...nameInitializer(input.name)
      },
      input
    );
  }
});
var createEdgeWithView = defineEndpoint({
  path: "/create_edge_with_view",
  description: "Create a relationship (UMLAssociation, UMLControlFlow, ...) between the models of two views, and the edge view connecting them.",
  readOnly: false,
  destructive: false,
  request: object({
    type: typeName(
      "A relationship id of app.factory.getModelAndViewIds(), e.g. 'UMLAssociation'."
    ),
    ...placementShape(),
    tailViewId: id("View at the source end."),
    headViewId: id("View at the target end."),
    name: optional(text("Relationship name.")),
    ...projectionShape()
  }),
  response: createdSchema(),
  handle: (input) => {
    const parent = requireElement(input.parentId, "Parent");
    const diagram = requireDiagram(input.diagramId);
    const tailView = requireView(input.tailViewId, "Tail view");
    const headView = requireView(input.headViewId, "Head view");
    return createModelAndView(
      {
        id: input.type,
        parent,
        diagram,
        tailView,
        headView,
        tailModel: tailView.model,
        headModel: headView.model,
        ...nameInitializer(input.name)
      },
      input
    );
  }
});

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
  createDiagram,
  switchDiagram,
  closeDiagram,
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
