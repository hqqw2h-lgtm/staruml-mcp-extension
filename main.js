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
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function failure(err) {
  return { success: false, error: errorMessage(err) };
}

// src/version.ts
var EXTENSION_NAME = "staruml-mcp-extension";
var EXTENSION_VERSION = "0.2.2";

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
      sendJson(res, 405, {
        success: false,
        error: `Method ${req.method} not allowed`
      });
      return;
    }
    const handler = Object.hasOwn(handlers, path) ? handlers[path] : void 0;
    if (!handler) {
      sendJson(res, 404, { success: false, error: `No handler for ${path}` });
      return;
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      sendJson(res, 400, {
        success: false,
        error: `Failed to read body: ${errorMessage(err)}`
      });
      return;
    }
    let body;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch (err) {
      sendJson(res, 400, {
        success: false,
        error: `Invalid JSON: ${errorMessage(err)}`
      });
      return;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      sendJson(res, 400, {
        success: false,
        error: "Request body must be a JSON object"
      });
      return;
    }
    const started = import_node_perf_hooks.performance.now();
    try {
      const result = await handler(body);
      sendJson(res, result.success ? 200 : 400, result, started);
    } catch (err) {
      log(
        "error",
        `[${EXTENSION_NAME}] handler ${path} threw: ${stackOf(err)}`
      );
      sendJson(res, 500, { success: false, error: errorMessage(err) }, started);
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
function sendJson(res, status, body, handlerStarted) {
  const text = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  };
  if (handlerStarted !== void 0) {
    const ms = import_node_perf_hooks.performance.now() - handlerStarted;
    headers["Server-Timing"] = `handler;dur=${ms.toFixed(3)}`;
  }
  res.writeHead(status, headers);
  res.end(text);
}
function stackOf(err) {
  return err instanceof Error ? String(err.stack) : String(err);
}

// src/handlers/commands.ts
function commandIds() {
  return Object.keys(app.commands.commands);
}
var getAllCommands = () => {
  const ids = commandIds().sort();
  return { success: true, data: { count: ids.length, ids } };
};
var executeCommand = async (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' (string) missing" };
  }
  const args = Array.isArray(body.args) ? body.args : [];
  if (!Object.hasOwn(app.commands.commands, id)) {
    return { success: false, error: `Command not registered: ${id}` };
  }
  try {
    const result = await app.commands.execute(id, ...args);
    return { success: true, data: { id, result: toJson(result) } };
  } catch (err) {
    return failure(`Command ${id} threw: ${errorMessage(err)}`);
  }
};
function toJson(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[non-serializable]";
  }
}

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
  "dialogs"
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
var debug = () => {
  const data = { app_keys: Object.keys(app).sort() };
  for (const name of INTROSPECTED_MANAGERS) {
    data[name] = describeSurface(app[name]);
  }
  return { success: true, data };
};

// src/handlers/diagrams.ts
var createDiagram = (body) => {
  const typeName = body.type;
  const parentId = body.parentId;
  const name = typeof body.name === "string" ? body.name : void 0;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error: "Required field 'type' (string) missing. Example: 'UMLClassDiagram', 'UMLUseCaseDiagram', 'UMLSequenceDiagram', 'UMLActivityDiagram', 'ERDDiagram'"
    };
  }
  if (typeof parentId !== "string" || parentId.length === 0) {
    return {
      success: false,
      error: "Required field 'parentId' (string) missing"
    };
  }
  const parent = app.repository.get(parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${parentId}` };
  }
  try {
    const diagram = app.factory.createDiagram({
      id: typeName,
      parent,
      ...name !== void 0 && {
        diagramInitializer: (d) => {
          d.name = name;
        }
      }
    });
    if (!diagram) {
      return { success: false, error: `Unknown diagram type: ${typeName}` };
    }
    return {
      success: true,
      data: {
        _id: diagram._id,
        name: diagram.name,
        type: diagram.constructor.name
      }
    };
  } catch (err) {
    return failure(err);
  }
};
function requireDiagram(body) {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return "Required field 'id' (diagram id) missing";
  }
  const diagram = app.repository.get(id);
  if (!diagram || !(diagram instanceof type.Diagram)) {
    return `Diagram not found: ${id}`;
  }
  return diagram;
}
var switchDiagram = (body) => {
  const diagram = requireDiagram(body);
  if (typeof diagram === "string") return { success: false, error: diagram };
  try {
    app.diagrams.setCurrentDiagram(diagram);
    return { success: true, data: { _id: diagram._id } };
  } catch (err) {
    return failure(err);
  }
};
var closeDiagramById = (body) => {
  const diagram = requireDiagram(body);
  if (typeof diagram === "string") return { success: false, error: diagram };
  try {
    app.diagrams.closeDiagram(diagram);
    return { success: true, data: { closed: diagram._id } };
  } catch (err) {
    return failure(err);
  }
};

// src/handlers/elements.ts
var getElementById = (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' (string) missing" };
  }
  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  return { success: true, data: shallow(elem) };
};
var findElements = (body) => {
  const typeName = typeof body.type === "string" ? body.type : null;
  const nameFilter = typeof body.name === "string" ? body.name : null;
  try {
    const pool = typeName ? app.repository.getInstancesOf(typeName) : app.repository.findAll(() => true);
    const filtered = nameFilter === null ? pool : pool.filter((e) => e.name === nameFilter);
    return {
      success: true,
      data: { count: filtered.length, elements: filtered.map(shallow) }
    };
  } catch (err) {
    return failure(err);
  }
};
var createElement = (body) => {
  const typeName = body.type;
  const parentId = body.parentId;
  const name = typeof body.name === "string" ? body.name : void 0;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error: "Required field 'type' (string) missing, e.g. 'UMLClass'"
    };
  }
  if (typeof parentId !== "string" || parentId.length === 0) {
    return {
      success: false,
      error: "Required field 'parentId' (string) missing"
    };
  }
  const parent = app.repository.get(parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${parentId}` };
  }
  try {
    const elem = app.factory.createModel({
      id: typeName,
      parent,
      ...name !== void 0 && {
        modelInitializer: (m) => {
          m.name = name;
        }
      }
    });
    if (!elem) {
      return { success: false, error: `Unknown model type: ${typeName}` };
    }
    return { success: true, data: shallow(elem) };
  } catch (err) {
    return failure(err);
  }
};
var updateElement = (body) => {
  const id = body.id;
  const field = body.field;
  const value = body.value;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' missing" };
  }
  if (typeof field !== "string" || field.length === 0) {
    return { success: false, error: "Required field 'field' missing" };
  }
  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  if (typeof elem[field] === "undefined") {
    return {
      success: false,
      error: `${elem.constructor.name} has no field '${field}'`
    };
  }
  try {
    app.engine.setProperty(elem, field, value);
    return { success: true, data: shallow(elem) };
  } catch (err) {
    return failure(err);
  }
};
var deleteElement = (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' missing" };
  }
  const elem = app.repository.get(id);
  if (!elem) {
    return { success: false, error: `Element not found: ${id}` };
  }
  try {
    const { models, views } = collectDeletionTargets(elem);
    app.engine.deleteElements(models, views);
    return {
      success: true,
      data: {
        deleted: id,
        models_deleted: models.length,
        views_deleted: views.length
      }
    };
  } catch (err) {
    return failure(err);
  }
};
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
function resolveParentAndDiagram(body) {
  const { parentId, diagramId } = body;
  if (typeof parentId !== "string" || parentId.length === 0) {
    return "Required field 'parentId' missing";
  }
  if (typeof diagramId !== "string" || diagramId.length === 0) {
    return "Required field 'diagramId' missing";
  }
  const parent = app.repository.get(parentId);
  if (!parent) return `Parent not found: ${parentId}`;
  const diagram = app.repository.get(diagramId);
  if (!diagram || !(diagram instanceof type.Diagram)) {
    return `Diagram not found: ${diagramId}`;
  }
  return { parent, diagram };
}
function createModelAndView(options) {
  const view = app.factory.createModelAndView(options);
  if (!view) {
    return {
      success: false,
      error: `Unknown model-and-view type: ${options.id}`
    };
  }
  const model = view.model;
  return {
    success: true,
    data: {
      view: { _id: view._id },
      model: { _id: model._id, name: model.name }
    }
  };
}
function nameInitializer(name) {
  if (typeof name !== "string") return {};
  return {
    modelInitializer: (m) => {
      m.name = name;
    }
  };
}
var createElementWithView = (body) => {
  const typeName = body.type;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error: "Required field 'type' missing (e.g. 'UMLUseCase', 'UMLActor', 'UMLAction')"
    };
  }
  const resolved = resolveParentAndDiagram(body);
  if (typeof resolved === "string") return { success: false, error: resolved };
  const x1 = typeof body.x === "number" ? body.x : 100;
  const y1 = typeof body.y === "number" ? body.y : 100;
  const x2 = typeof body.x2 === "number" ? body.x2 : x1 + 100;
  const y2 = typeof body.y2 === "number" ? body.y2 : y1 + 50;
  try {
    return createModelAndView({
      id: typeName,
      ...resolved,
      x1,
      y1,
      x2,
      y2,
      ...nameInitializer(body.name)
    });
  } catch (err) {
    return failure(err);
  }
};
var createEdgeWithView = (body) => {
  const { type: typeName, tailViewId, headViewId } = body;
  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error: "Required field 'type' missing (e.g. 'UMLAssociation', 'UMLControlFlow')"
    };
  }
  const resolved = resolveParentAndDiagram(body);
  if (typeof resolved === "string") return { success: false, error: resolved };
  if (typeof tailViewId !== "string" || typeof headViewId !== "string") {
    return {
      success: false,
      error: "Required fields 'tailViewId' and 'headViewId' missing"
    };
  }
  const tailView = app.repository.get(tailViewId);
  if (!tailView || !(tailView instanceof type.View)) {
    return { success: false, error: `Tail view not found: ${tailViewId}` };
  }
  const headView = app.repository.get(headViewId);
  if (!headView || !(headView instanceof type.View)) {
    return { success: false, error: `Head view not found: ${headViewId}` };
  }
  try {
    return createModelAndView({
      id: typeName,
      ...resolved,
      tailView,
      headView,
      tailModel: tailView.model,
      headModel: headView.model,
      ...nameInitializer(body.name)
    });
  } catch (err) {
    return failure(err);
  }
};
function shallow(elem) {
  const out = {};
  for (const [key, val] of Object.entries(elem)) {
    if (key.startsWith("_") && key !== "_id" && key !== "_parent") continue;
    if (val === null || val === void 0) {
      out[key] = val;
    } else if (Array.isArray(val)) {
      out[key] = val.map(
        (item) => item && typeof item === "object" && "_id" in item ? {
          _id: item._id,
          name: item.name
        } : item
      );
    } else if (typeof val === "object" && "_id" in val) {
      out[key] = {
        _id: val._id,
        name: val.name
      };
    } else {
      out[key] = val;
    }
  }
  return out;
}

// src/handlers/project.ts
var getProjectInfo = () => {
  const project = app.project.getProject();
  return {
    success: true,
    data: {
      filename: app.project.getFilename(),
      project: project && summarize(project)
    }
  };
};
function saveTo(filename) {
  if (!app.project.getProject()) {
    return { success: false, error: "No project is open" };
  }
  try {
    app.project.save(filename);
    return { success: true, data: { filename: app.project.getFilename() } };
  } catch (err) {
    return failure(err);
  }
}
var saveProject = (body) => {
  const filename = typeof body.filename === "string" && body.filename.length > 0 ? body.filename : app.project.getFilename();
  if (!filename) {
    return {
      success: false,
      error: "Project has no file yet; pass 'filename' or use /save_project_as"
    };
  }
  return saveTo(filename);
};
var saveProjectAs = (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing"
    };
  }
  return saveTo(filename);
};
var newProject = () => {
  try {
    app.project.newProject();
    return { success: true, data: null };
  } catch (err) {
    return failure(err);
  }
};
var openProject = (body) => {
  const filename = body.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    return {
      success: false,
      error: "Required field 'filename' (string) missing"
    };
  }
  try {
    const project = app.project.load(filename);
    if (!project)
      return { success: false, error: `File is empty: ${filename}` };
    return { success: true, data: { filename, project: summarize(project) } };
  } catch (err) {
    return failure(err);
  }
};
function summarize(project) {
  return {
    _id: project._id,
    name: project.name,
    ownedElementsCount: project.ownedElements.length
  };
}

// src/routes.ts
var routes = {
  "/get_all_commands": getAllCommands,
  "/execute_command": executeCommand,
  "/get_project_info": getProjectInfo,
  "/save_project": saveProject,
  "/save_project_as": saveProjectAs,
  "/new_project": newProject,
  "/open_project": openProject,
  "/get_element_by_id": getElementById,
  "/find_elements": findElements,
  "/create_element": createElement,
  "/update_element": updateElement,
  "/delete_element": deleteElement,
  "/create_element_with_view": createElementWithView,
  "/create_edge_with_view": createEdgeWithView,
  "/create_diagram": createDiagram,
  "/switch_diagram": switchDiagram,
  "/close_diagram": closeDiagramById,
  "/debug": debug
};

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
