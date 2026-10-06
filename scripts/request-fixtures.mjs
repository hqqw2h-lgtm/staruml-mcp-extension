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
 * Picks the request examples the contract test (tests/unit/contract.test.ts)
 * holds every manifest request schema to, from the requests a live run
 * sent and StarUML answered with 2xx (issue #27):
 *
 *   RECORD_REQUESTS=/tmp/requests.jsonl npm run test:live
 *   node scripts/request-fixtures.mjs /tmp/requests.jsonl
 *
 * Up to three distinct bodies per endpoint, the smallest first, are
 * written to tests/fixtures/requests.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";

const [, , recorded] = process.argv;
if (!recorded) {
  console.error("usage: node scripts/request-fixtures.mjs <requests.jsonl>");
  process.exit(2);
}
const PER_PATH = 3;
const byPath = new Map();
for (const line of readFileSync(recorded, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  const { path, body, status } = JSON.parse(line);
  if (status < 200 || status >= 300) continue;
  const text = JSON.stringify(body);
  const seen = byPath.get(path) ?? new Map();
  seen.set(text, body);
  byPath.set(path, seen);
}
const out = Object.fromEntries(
  [...byPath.keys()].sort().map((path) => [
    path,
    [...byPath.get(path).entries()]
      .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, PER_PATH)
      .map(([, body]) => body),
  ]),
);
const file = new URL("../tests/fixtures/requests.json", import.meta.url);
writeFileSync(
  file,
  await format(JSON.stringify(out), {
    parser: "json",
    filepath: file.pathname,
  }),
);
console.log(`wrote ${Object.keys(out).length} endpoints to ${file.pathname}`);
