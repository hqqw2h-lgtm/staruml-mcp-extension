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
 * Records POST /introspect of the running StarUML as
 * tests/fixtures/introspect.<version>.json. The unit-test mock builds its
 * metamodel and factory from that file, and tests/integration diffs it
 * against the live answer, so re-run this after StarUML or the endpoint
 * list changes:
 *
 *   node scripts/snapshot-introspect.mjs
 *
 * Environment: STARUML_EXT_URL (default http://localhost:58322),
 * STARUML_EXT_TOKEN when StarUML requires an access token.
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";

const base = process.env.STARUML_EXT_URL ?? "http://localhost:58322";
const res = await fetch(`${base}/introspect`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(process.env.STARUML_EXT_TOKEN && {
      Authorization: `Bearer ${process.env.STARUML_EXT_TOKEN}`,
    }),
  },
  body: "{}",
});
const body = await res.json();
if (!body.success) {
  console.error(`introspect failed: ${JSON.stringify(body)}`);
  process.exit(1);
}
const file = new URL(
  `../tests/fixtures/introspect.${body.data.staruml.version}.json`,
  import.meta.url,
);
writeFileSync(
  file,
  await format(JSON.stringify(body.data), { parser: "json" }),
);
console.log(`wrote ${file.pathname}`);
