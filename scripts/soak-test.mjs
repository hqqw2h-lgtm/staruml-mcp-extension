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
 * Soak test of the write path (issue #26): OPS creates, each a class with
 * its view on one diagram, every one deleted again right after, so the
 * model stays small and any growth in latency is the session's own, not
 * the model's. Latency is the handler time from Server-Timing (the time
 * the renderer thread was held); p50 and p99 are reported per 100 ops,
 * and the run fails when the p50 of the last 100 exceeds the first 100's
 * by more than GROWTH_BUDGET, or on any error.
 *
 *   node scripts/soak-test.mjs [--ops 2000] [--json file]
 *
 * Environment: STARUML_EXT_URL (default http://localhost:58322),
 * STARUML_EXT_TOKEN, GROWTH_BUDGET (default 0.25).
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    ops: { type: "string", default: "2000" },
    json: { type: "string" },
  },
});
const OPS = Number(values.ops);
const BASE = process.env.STARUML_EXT_URL ?? "http://localhost:58322";
const GROWTH_BUDGET = Number(process.env.GROWTH_BUDGET ?? "0.25");
const WINDOW = 100;

async function call(path, body = {}) {
  const started = performance.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.STARUML_EXT_TOKEN && {
        Authorization: `Bearer ${process.env.STARUML_EXT_TOKEN}`,
      }),
    },
    body: JSON.stringify(body),
    // A hung StarUML fails the run rather than holding it.
    signal: globalThis.AbortSignal.timeout(60_000),
  });
  const wall = performance.now() - started;
  const timing = /handler;dur=([\d.]+)/.exec(
    res.headers.get("server-timing") ?? "",
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json)}`);
  }
  return { data: json.data, handler: timing ? Number(timing[1]) : wall, wall };
}

const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

await call("/new_project");
const { data: diagram } = await call("/create_diagram", {
  type: "UMLClassDiagram",
  parent: "@project",
  name: "Soak",
});
await call("/switch_diagram", { diagram: diagram._id });
const before = await call("/performance_stats").catch(() => null);

const creates = [];
const deletes = [];
for (let i = 0; i < OPS; i++) {
  const made = await call("/create_element_with_view", {
    type: "UMLClass",
    diagram: diagram._id,
    name: `Soak${i}`,
    x: 40 + (i % 10) * 30,
    y: 40 + (i % 10) * 20,
  });
  creates.push(made.handler);
  const gone = await call("/delete_element", { ref: made.data.model._id });
  deletes.push(gone.handler);
}
const after = await call("/performance_stats").catch(() => null);

const windows = [];
for (let w = 0; w < OPS / WINDOW; w++) {
  const slice = creates
    .slice(w * WINDOW, (w + 1) * WINDOW)
    .sort((a, b) => a - b);
  const del = deletes.slice(w * WINDOW, (w + 1) * WINDOW).sort((a, b) => a - b);
  windows.push({
    ops: `${w * WINDOW + 1}-${(w + 1) * WINDOW}`,
    createP50: Number(quantile(slice, 0.5).toFixed(2)),
    createP99: Number(quantile(slice, 0.99).toFixed(2)),
    deleteP50: Number(quantile(del, 0.5).toFixed(2)),
    deleteP99: Number(quantile(del, 0.99).toFixed(2)),
  });
}
console.table(windows);
const first = windows[0].createP50;
const last = windows.at(-1).createP50;
const growth = (last - first) / first;
const report = {
  ops: OPS,
  firstP50: first,
  lastP50: last,
  growth: Number(growth.toFixed(3)),
  budget: GROWTH_BUDGET,
  windows,
  stats: { before: before?.data ?? null, after: after?.data ?? null },
};
if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
console.log(
  `create p50 first ${first} ms, last ${last} ms, growth ${(growth * 100).toFixed(1)}% (budget ${GROWTH_BUDGET * 100}%)`,
);
if (after) console.log("stats after:", JSON.stringify(after.data));
await call("/new_project");
if (growth > GROWTH_BUDGET) {
  console.error("FAIL: write latency grew past the budget");
  process.exit(1);
}
