#!/usr/bin/env node
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

/*
 * Load test for the extension's HTTP server running inside StarUML.
 *
 *   node scripts/load-test.mjs [--requests 5000] [--concurrency 50]
 *
 * Replaces the open project with a fresh one seeded with SEED classes, then
 * fires read-only requests at a fixed concurrency: summaries, full and
 * field-projected elements, owned elements expanded one level, paged
 * find_elements, /introspect sections, /search_types queries, /export_text
 * of a built class diagram as Mermaid, PlantUML and draw.io, the same
 * diagram as a draw.io file from /export_diagram (returned, not written), a read-only /batch
 * of five lookups, and reads that address elements by path ("Load/C7",
 * "Order.total", "Order#place()", the diagram by name) rather than by id,
 * /lint_diagram and /uml_lint over them, and the read-only planning
 * endpoints: /diff_diagram, a /build_diagram dryRun and /diff_since of a
 * snapshot taken after seeding, a /build_model dryRun of a small object
 * spec and /check_messages over the seeded package, /apply_pattern dry
 * runs, /detect_patterns over the seeded package, the pattern, preset and
 * type descriptions, /apply_preset, /apply_theme and /sync_operations dry
 * runs, and the workspace reads of issue #28 (/get_preference, /quick_find,
 * /list_working_diagrams, /list_extensions, /list_templates,
 * /get_project_metadata) and /performance_stats. Exits non-zero on any transport error or
 * non-2xx answer, when client p99 exceeds P99_BUDGET_MS, or when any single
 * handler held the renderer thread longer than HANDLER_BUDGET_MS (taken
 * from the Server-Timing header the server sets).
 *
 * A second, sequential phase sends WRITE_BATCHES /batch requests that each
 * create a class with an attribute and an operation, alternating atomic and
 * non-atomic. StarUML's own cost per created element grows with the model
 * (the explorer and diagrams update on every operation), so writes get no
 * absolute budget; what is checked is the atomic batch's overhead, the ratio
 * of its median handler time to the non-atomic one, against
 * ATOMIC_OVERHEAD_BUDGET.
 *
 * A third, sequential phase sends BUILDS /build_diagram requests, each a
 * class diagram of six classes with members and five relationships laid out
 * by the engine, every other one an upsert of the previous diagram (which
 * adds nothing). Builds get no absolute budget, for the reason writes get
 * none; an upsert that changes nothing runs no operation at all, so its
 * handler p99 is held to UPSERT_BUDGET_MS.
 *
 * Environment: STARUML_EXT_URL (default http://localhost:58322),
 * STARUML_EXT_TOKEN (when StarUML requires an access token),
 * P99_BUDGET_MS (default 250), HANDLER_BUDGET_MS (default 50), SEED (default
 * 200), WRITE_BATCHES (default 200), ATOMIC_OVERHEAD_BUDGET (default 1.25),
 * BUILDS (default 50), UPSERT_BUDGET_MS (default 50).
 */
import http from "node:http";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    requests: { type: "string", default: "5000" },
    concurrency: { type: "string", default: "50" },
  },
});
const TOTAL = Number(values.requests);
const CONCURRENCY = Number(values.concurrency);
const BASE = new URL(process.env.STARUML_EXT_URL ?? "http://localhost:58322");
const P99_BUDGET_MS = Number(process.env.P99_BUDGET_MS ?? 250);
const HANDLER_BUDGET_MS = Number(process.env.HANDLER_BUDGET_MS ?? 50);
const SEED = Number(process.env.SEED ?? 200);
const TOKEN = process.env.STARUML_EXT_TOKEN;
const WRITE_BATCHES = Number(process.env.WRITE_BATCHES ?? 200);
const ATOMIC_OVERHEAD_BUDGET = Number(
  process.env.ATOMIC_OVERHEAD_BUDGET ?? 1.25,
);

const BUILDS = Number(process.env.BUILDS ?? 50);
const UPSERT_BUDGET_MS = Number(process.env.UPSERT_BUDGET_MS ?? 50);
const QUALITY_RUNS = Number(process.env.QUALITY_RUNS ?? 20);
const IMPROVE_BUDGET_MS = Number(process.env.IMPROVE_BUDGET_MS ?? 500);

const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

function post(path, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.request(
      {
        host: BASE.hostname,
        port: BASE.port,
        path,
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          const timing = /handler;dur=([\d.]+)/.exec(
            res.headers["server-timing"] ?? "",
          );
          resolve({
            status: res.statusCode,
            ms: performance.now() - started,
            handlerMs: timing ? Number(timing[1]) : NaN,
            json: text ? JSON.parse(text) : null,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function seed() {
  await post("/new_project", {});
  const info = await post("/get_project_info", {});
  const projectId = info.json.data.project._id;
  const model = await post("/create_element", {
    type: "UMLModel",
    parent: projectId,
    name: "Load",
  });
  const ids = [model.json.data._id];
  for (let i = 0; i < SEED; i++) {
    const cls = await post("/create_element", {
      type: "UMLClass",
      parent: model.json.data._id,
      name: `C${i}`,
    });
    ids.push(cls.json.data._id);
  }
  return ids;
}

function percentile(sorted, p) {
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

async function writePhase(modelId, errors) {
  const times = { true: [], false: [] };
  for (let i = 0; i < WRITE_BATCHES; i++) {
    const atomic = i % 2 === 0;
    const res = await post("/batch", {
      atomic,
      ops: [
        {
          path: "/create_element",
          as: "c",
          body: { type: "UMLClass", parent: modelId, name: `W${i}` },
        },
        { path: "/add_attribute", body: { ref: "$c", name: "id" } },
        { path: "/add_operation", body: { ref: "$c", name: "run" } },
      ],
    });
    times[atomic].push(res.handlerMs);
    if (res.status !== 200 || res.json?.data?.failed !== 0) {
      errors.push(`/batch write -> ${res.status} ${JSON.stringify(res.json)}`);
    }
  }
  const stats = (list) => {
    list.sort((a, b) => a - b);
    return {
      p50: +percentile(list, 50).toFixed(3),
      p99: +percentile(list, 99).toFixed(3),
    };
  };
  const atomic = stats(times.true);
  const separate = stats(times.false);
  return {
    batches: WRITE_BATCHES,
    opsPerBatch: 3,
    atomicHandlerMs: atomic,
    nonAtomicHandlerMs: separate,
    atomicOverhead: +(atomic.p50 / separate.p50).toFixed(3),
  };
}

/** Patterns /apply_pattern plans (dry run) in the read mix, in turn. */
const PATTERNS = [
  "Strategy",
  "Observer",
  "Composite",
  "Singleton",
  "Repository",
];

/** An object-level spec /build_model plans (dry run) in the read mix. */
const MODEL_SPEC = {
  system: "Planned",
  contexts: [
    { id: "sales", name: "Sales", dependsOn: ["catalog"] },
    { id: "catalog", name: "Catalog" },
  ],
  classes: [
    {
      name: "Order",
      context: "sales",
      responsibility: "A purchase",
      attributes: ["-id: long", "+total: double"],
      operations: ["+place(): void"],
    },
    { name: "Line", context: "sales", attributes: ["+qty: int"] },
    { name: "Product", context: "catalog", kind: "abstract" },
    { name: "Book", context: "catalog" },
  ],
  relationships: [
    { from: "Order", to: "Line", type: "owns", fromMult: "1", toMult: "1..*" },
    { from: "Line", to: "Product", type: "knows" },
    { from: "Book", to: "Product", type: "isA" },
  ],
  collaborations: [
    {
      name: "Checkout",
      participants: ["Order", "Line"],
      messages: [["Order", "Line", "total()"]],
    },
  ],
};

/** A model /derive_diagrams plans in the read mix; its names are its own. */
const DERIVE_SPEC = {
  system: "LoadModel",
  contexts: [{ id: "cart", name: "Carts" }],
  classes: [
    { name: "Basket", context: "cart", operations: ["+add(i: Item): void"] },
    { name: "Item", context: "cart", attributes: ["+qty: int"] },
  ],
  relationships: [{ from: "Basket", to: "Item", type: "owns" }],
  collaborations: [{ name: "Fill", messages: [["Basket", "Item", "qty()"]] }],
};

const BUILD_SPEC = {
  classes: [
    {
      name: "Order",
      attributes: ["+id: long", "-total: double"],
      operations: ["+place(): void"],
    },
    { name: "Line", attributes: ["+qty: int"] },
    { name: "Product", attributes: ["+sku: String"] },
    { name: "Customer", operations: ["+orders(): List~Order~"] },
    { name: "Payable", kind: "interface", operations: ["pay()"] },
    { name: "Status", kind: "enum", literals: ["NEW", "PAID"] },
  ],
  relations: [
    { from: "Order", to: "Line", type: "composition" },
    { from: "Line", to: "Product", type: "directed" },
    {
      from: "Customer",
      to: "Order",
      fromMultiplicity: "1",
      toMultiplicity: "*",
    },
    { from: "Order", to: "Payable", type: "realization" },
    { from: "Order", to: "Status", type: "dependency" },
  ],
};

const VIEWPOINTS = [
  "context",
  "container",
  "component",
  "code",
  "runtime",
  "lifecycle",
  "actors-goals",
  "deployment",
  "data",
];

/** Intents /request_diagram plans (dry run) against DERIVE_SPEC, in turn. */
const INTENTS = [
  "which classes make up the carts",
  "how does a basket fill, message by message",
  "who talks to whom when filling",
];

const SEARCHES = [
  "composition",
  "state machine",
  "erd entity",
  "align bottom",
  "clsdgm",
  "UMLClass",
];

/**
 * /improve_diagram dry runs, sequentially: each lays the diagram out and
 * runs the loop before undoing it, so it is timed on its own budget rather
 * than the read mix's.
 */
async function qualityPhase(diagram, errors) {
  const times = [];
  for (let i = 0; i < QUALITY_RUNS; i++) {
    const res = await post("/improve_diagram", { ref: diagram, dryRun: true });
    times.push(res.handlerMs);
    if (res.status !== 200 || !res.json?.data?.dryRun) {
      errors.push(
        `/improve_diagram -> ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`,
      );
    }
  }
  times.sort((a, b) => a - b);
  return {
    runs: QUALITY_RUNS,
    handlerMs: {
      p50: +percentile(times, 50).toFixed(2),
      p99: +percentile(times, 99).toFixed(2),
    },
  };
}

async function buildPhase(errors) {
  const times = {
    create: { client: [], handler: [] },
    upsert: { client: [], handler: [] },
  };
  for (let i = 0; i < BUILDS; i++) {
    const upsert = i % 2 === 1;
    const res = await post("/build_diagram", {
      kind: "class",
      name: `Build ${i - (upsert ? 1 : 0)}`,
      spec: BUILD_SPEC,
      upsert,
    });
    const bucket = times[upsert ? "upsert" : "create"];
    bucket.client.push(res.ms);
    bucket.handler.push(res.handlerMs);
    const expected = upsert ? 0 : 11;
    if (res.status !== 200 || res.json?.data?.created !== expected) {
      errors.push(
        `/build_diagram -> ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`,
      );
    }
  }
  const stats = (list) => {
    list.sort((a, b) => a - b);
    return {
      p50: +percentile(list, 50).toFixed(2),
      p99: +percentile(list, 99).toFixed(2),
    };
  };
  return {
    builds: BUILDS,
    createClientMs: stats(times.create.client),
    createHandlerMs: stats(times.create.handler),
    upsertClientMs: stats(times.upsert.client),
    upsertHandlerMs: stats(times.upsert.handler),
  };
}

async function main() {
  const ids = await seed();
  const [modelId, ...classIds] = ids;
  const exported = await post("/build_diagram", {
    kind: "class",
    name: "Export",
    spec: BUILD_SPEC,
  });
  const exportId = exported.json.data.diagram._id;
  await post("/build_diagram", {
    kind: "sequence",
    name: "LoadSeq",
    spec: {
      messages: [
        { from: "Cashier", to: "Ledger", text: "post(entry)" },
        { from: "Ledger", to: "Ledger", text: "recalculate(total)" },
      ],
    },
  });
  await post("/build_model", { spec: DERIVE_SPEC });
  await post("/snapshot", { label: "load" });
  const mix = [
    () => ["/find_elements", { type: "UMLClass" }],
    () => ["/find_elements", { type: "UMLClass", name: `C${SEED >> 1}` }],
    (i) => ["/get_element_by_id", { ref: classIds[i % classIds.length] }],
    (i) => ["/get_element_by_id", { ref: `Load/C${i % SEED}` }],
    (i) => [
      "/get_element_by_id",
      { ref: i % 2 ? "Order.total" : "Order#place()" },
    ],
    () => ["/get_views_of", { ref: "Order" }],
    () => ["/describe_diagram", { diagram: "Export" }],
    () => ["/lint_diagram", { diagram: "Export" }],
    () => ["/uml_lint", { scope: "Load", limit: 50 }],
    () => [
      "/diff_diagram",
      { diagram: "Export", kind: "class", spec: BUILD_SPEC },
    ],
    () => [
      "/build_diagram",
      {
        kind: "class",
        name: "Export",
        spec: BUILD_SPEC,
        upsert: true,
        dryRun: true,
      },
    ],
    () => ["/diff_since", { snapshot: "load", limit: 20 }],
    () => ["/build_model", { spec: MODEL_SPEC, dryRun: true }],
    () => ["/build_model", { spec: MODEL_SPEC, dryRun: true, detail: "full" }],
    () => ["/check_messages", { scope: "Load" }],
    (i) => [
      "/apply_pattern",
      {
        pattern: PATTERNS[i % PATTERNS.length],
        parent: "Load",
        dryRun: true,
      },
    ],
    () => [
      "/detect_patterns",
      { scope: "Load", patterns: ["Strategy", "Singleton", "Composite"] },
    ],
    () => ["/list_patterns", {}],
    () => ["/describe_pattern", { name: "Observer" }],
    () => ["/describe_type", { type: "UMLOperation" }],
    () => [
      "/apply_preset",
      { ref: "Order", preset: "value-object", dryRun: true },
    ],
    () => ["/apply_theme", { ref: "Export", theme: "blueprint", dryRun: true }],
    () => ["/sync_operations", { diagram: "LoadSeq", dryRun: true }],
    () => ["/get_project_info", {}],
    () => ["/get_style_profile", {}],
    () => ["/diagram_quality", { ref: "Export" }],
    () => [
      "/derive_diagrams",
      { scope: "LoadModel", dryRun: true, kinds: ["class", "sequence"] },
    ],
    () => ["/model_lint", { scope: "LoadModel" }],
    // Issue #42: the viewpoint catalogue, its lint and intent-driven requests.
    () => ["/list_viewpoints", {}],
    (i) => ["/describe_viewpoint", { name: VIEWPOINTS[i % VIEWPOINTS.length] }],
    () => ["/viewpoint_lint", { scope: "LoadModel" }],
    (i) => [
      "/request_diagram",
      {
        intent: INTENTS[i % INTENTS.length],
        scope: "LoadModel",
        audience: "developer",
        dryRun: true,
      },
    ],
    () => [
      "/derive_diagrams",
      { scope: "LoadModel", dryRun: true, viewpoints: ["code", "runtime"] },
    ],
    // Issue #28: preferences, quick find, tabs, extensions, templates, metadata.
    () => ["/get_preference", { key: "diagramEditor.showGrid" }],
    (i) => ["/quick_find", { text: `C${i % SEED}`, limit: 10 }],
    () => ["/list_working_diagrams", {}],
    () => ["/list_extensions", {}],
    () => ["/list_templates", {}],
    () => ["/get_project_metadata", {}],
    () => ["/performance_stats", {}],
    () => ["/explain_model", { scope: "LoadModel", maxChars: 2000 }],
    // Issue #40: a section of the text read on from a cursor.
    () => [
      "/explain_model",
      { scope: "LoadModel", sections: ["classes"], maxChars: 500, cursor: 200 },
    ],
    () => ["/detect_patterns", { scope: "Load", minConfidence: 0.5 }],
    () => ["/explain_style_violation", { ref: "Order" }],
    () => ["/apply_style_profile", { scope: "Export", dryRun: true }],
    (i) => [
      "/get_element_by_id",
      { id: classIds[i % classIds.length], summary: false },
    ],
    () => [
      "/get_element_by_id",
      { id: modelId, fields: ["name", "ownedElements"], depth: 1 },
    ],
    () => [
      "/find_elements",
      { type: "UMLClass", limit: 50, fields: ["name", "isAbstract"] },
    ],
    () => ["/find_elements", { limit: 200, summary: false }],
    () => [
      "/introspect",
      {
        include: ["metamodel"],
        types: ["UMLClass", "UMLAttribute", "UMLAssociation"],
        inherited: true,
      },
    ],
    () => ["/introspect", { include: ["factory", "toolbox"] }],
    (i) => [
      "/export_text",
      {
        diagram: exportId,
        // By round, so each format comes up whatever the mix's length.
        format: ["mermaid", "plantuml", "drawio"][
          Math.floor(i / mix.length) % 3
        ],
      },
    ],
    () => ["/export_diagram", { diagram: exportId, format: "drawio" }],
    (i) => [
      "/search_types",
      { query: SEARCHES[i % SEARCHES.length], limit: 10 },
    ],
    (i) => [
      "/batch",
      {
        atomic: false,
        ops: Array.from({ length: 5 }, (_, k) => ({
          path: "/get_element_by_id",
          body: { ref: classIds[(i + k) % classIds.length] },
        })),
      },
    ],
  ];

  const latencies = [];
  const handlerTimes = [];
  const byPath = new Map();
  const errors = [];
  let next = 0;

  async function worker() {
    for (let i = next++; i < TOTAL; i = next++) {
      const [path, body] = mix[i % mix.length](i);
      try {
        const res = await post(path, body);
        latencies.push(res.ms);
        handlerTimes.push(res.handlerMs);
        if (!byPath.has(path)) byPath.set(path, []);
        byPath.get(path).push(res.handlerMs);
        if (res.status !== 200 || !res.json?.success) {
          errors.push(`${path} -> ${res.status} ${JSON.stringify(res.json)}`);
        }
      } catch (err) {
        errors.push(`${path} -> ${err.message}`);
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (performance.now() - started) / 1000;
  const writes = await writePhase(modelId, errors);
  const builds = await buildPhase(errors);
  const quality = await qualityPhase(exportId, errors);
  agent.destroy();
  await post("/new_project", {}).catch(() => {});

  latencies.sort((a, b) => a - b);
  handlerTimes.sort((a, b) => a - b);
  const report = {
    requests: TOTAL,
    concurrency: CONCURRENCY,
    seededClasses: SEED,
    errors: errors.length,
    throughputPerSec: Math.round(TOTAL / elapsed),
    clientMs: {
      p50: +percentile(latencies, 50).toFixed(2),
      p99: +percentile(latencies, 99).toFixed(2),
      max: +latencies.at(-1).toFixed(2),
    },
    handlerMs: {
      p50: +percentile(handlerTimes, 50).toFixed(3),
      p99: +percentile(handlerTimes, 99).toFixed(3),
      max: +handlerTimes.at(-1).toFixed(3),
    },
    handlerP99MsByPath: Object.fromEntries(
      [...byPath].map(([path, times]) => [
        path,
        +percentile(
          times.sort((a, b) => a - b),
          99,
        ).toFixed(3),
      ]),
    ),
    writes,
    builds,
    quality,
    budgets: {
      upsertHandlerP99Ms: UPSERT_BUDGET_MS,
      improveHandlerP99Ms: IMPROVE_BUDGET_MS,
      p99Ms: P99_BUDGET_MS,
      handlerMaxMs: HANDLER_BUDGET_MS,
      atomicOverhead: ATOMIC_OVERHEAD_BUDGET,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (errors.length > 0)
    failures.push(`${errors.length} errors, first: ${errors[0]}`);
  if (report.clientMs.p99 > P99_BUDGET_MS)
    failures.push(`p99 ${report.clientMs.p99} ms`);
  if (!(report.handlerMs.max <= HANDLER_BUDGET_MS)) {
    failures.push(`handler max ${report.handlerMs.max} ms`);
  }
  if (!(writes.atomicOverhead <= ATOMIC_OVERHEAD_BUDGET)) {
    failures.push(`atomic overhead ${writes.atomicOverhead}`);
  }
  if (!(quality.handlerMs.p99 <= IMPROVE_BUDGET_MS)) {
    failures.push(`improve_diagram handler p99 ${quality.handlerMs.p99} ms`);
  }
  if (!(builds.upsertHandlerMs.p99 <= UPSERT_BUDGET_MS)) {
    failures.push(`upsert handler p99 ${builds.upsertHandlerMs.p99} ms`);
  }
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
