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
 * find_elements, /introspect sections and a read-only /batch of five
 * lookups. Exits non-zero on any transport error or non-2xx answer, when
 * client p99 exceeds P99_BUDGET_MS, or when any single handler held the
 * renderer thread longer than HANDLER_BUDGET_MS (taken from the
 * Server-Timing header the server sets).
 *
 * A second, sequential phase sends WRITE_BATCHES /batch requests that each
 * create a class with an attribute and an operation, alternating atomic and
 * non-atomic. StarUML's own cost per created element grows with the model
 * (the explorer and diagrams update on every operation), so writes get no
 * absolute budget; what is checked is the atomic batch's overhead, the ratio
 * of its median handler time to the non-atomic one, against
 * ATOMIC_OVERHEAD_BUDGET.
 *
 * Environment: STARUML_EXT_URL (default http://localhost:58322),
 * STARUML_EXT_TOKEN (when StarUML requires an access token),
 * P99_BUDGET_MS (default 250), HANDLER_BUDGET_MS (default 50), SEED (default
 * 200), WRITE_BATCHES (default 200), ATOMIC_OVERHEAD_BUDGET (default 1.25).
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
    parentId: projectId,
    name: "Load",
  });
  const ids = [model.json.data._id];
  for (let i = 0; i < SEED; i++) {
    const cls = await post("/create_element", {
      type: "UMLClass",
      parentId: model.json.data._id,
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
          body: { type: "UMLClass", parentId: modelId, name: `W${i}` },
        },
        { path: "/add_attribute", body: { ownerId: "$c", name: "id" } },
        { path: "/add_operation", body: { ownerId: "$c", name: "run" } },
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

async function main() {
  const ids = await seed();
  const [modelId, ...classIds] = ids;
  const mix = [
    () => ["/find_elements", { type: "UMLClass" }],
    () => ["/find_elements", { type: "UMLClass", name: `C${SEED >> 1}` }],
    (i) => ["/get_element_by_id", { id: classIds[i % classIds.length] }],
    () => ["/get_project_info", {}],
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
      "/batch",
      {
        atomic: false,
        ops: Array.from({ length: 5 }, (_, k) => ({
          path: "/get_element_by_id",
          body: { id: classIds[(i + k) % classIds.length] },
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
    budgets: {
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
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
