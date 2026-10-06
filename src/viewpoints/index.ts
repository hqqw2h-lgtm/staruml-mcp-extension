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

import * as z from "zod/mini";
import { ApiError } from "../errors.js";
import actorsGoals from "./actors-goals.json";
import code from "./code.json";
import component from "./component.json";
import container from "./container.json";
import context from "./context.json";
import data from "./data.json";
import decisions from "./decisions.json";
import deployment from "./deployment.json";
import lifecycle from "./lifecycle.json";
import runtime from "./runtime.json";
import {
  AUDIENCES,
  type DecisionTable,
  decisionTableSchema,
  type Viewpoint,
  VIEWPOINT_NAMES,
  type ViewpointName,
  viewpointSchema,
} from "./schema.js";

/*
 * The viewpoint catalogue and the decision table (issue #42), parsed and
 * cross-checked once: a rule names a kind its viewpoint can show, a
 * default names a rule drawn for that scope, and every viewpoint is
 * reachable through some rule. A catalogue that breaks one of these is a
 * defect of this extension, so it fails loudly on first use.
 */

/** The viewpoint files in catalogue order, outside in. */
export const VIEWPOINT_FILES: readonly unknown[] = [
  context,
  container,
  component,
  code,
  runtime,
  lifecycle,
  actorsGoals,
  deployment,
  data,
];

export interface Catalogue {
  viewpoints: Viewpoint[];
  byName: ReadonlyMap<ViewpointName, Viewpoint>;
  table: DecisionTable;
}

let catalogue: Catalogue | null = null;

/** Problems in a parsed catalogue and table that the schemas cannot see. */
export function crossCheck(
  viewpoints: readonly Viewpoint[],
  table: DecisionTable,
): string[] {
  const problems: string[] = [];
  const byName = new Map(viewpoints.map((v) => [v.name, v]));
  for (const name of VIEWPOINT_NAMES) {
    if (viewpoints.filter((v) => v.name === name).length !== 1) {
      problems.push(`viewpoint ${name}: not defined exactly once`);
    }
    if (!table.rules.some((r) => r.viewpoint === name)) {
      problems.push(`viewpoint ${name}: no decision rule reaches it`);
    }
  }
  for (const audience of AUDIENCES) {
    if (!viewpoints.some((v) => v.stakeholders.includes(audience))) {
      problems.push(`audience ${audience}: no viewpoint is written for it`);
    }
  }
  const ids = new Set<string>();
  for (const r of table.rules) {
    if (ids.has(r.id)) problems.push(`rule ${r.id}: defined twice`);
    ids.add(r.id);
    const vp = byName.get(r.viewpoint);
    if (vp && !vp.kinds.includes(r.kind)) {
      problems.push(`rule ${r.id}: ${r.viewpoint} is not drawn as ${r.kind}`);
    }
  }
  for (const [scope, id] of Object.entries(table.defaults)) {
    const rule = table.rules.find((r) => r.id === id);
    if (!rule) problems.push(`default ${scope}: no rule ${id}`);
    else if (!(rule.scopes as string[]).includes(scope)) {
      problems.push(`default ${scope}: rule ${id} is not drawn for that scope`);
    }
  }
  return problems;
}

/** A catalogue from its files, parsed and cross-checked; any problem throws. */
export function loadCatalogue(
  files: readonly unknown[],
  tableFile: unknown,
): Catalogue {
  const viewpoints = files.map((v) => z.parse(viewpointSchema(), v));
  const table = z.parse(decisionTableSchema(), tableFile);
  const problems = crossCheck(viewpoints, table);
  if (problems.length > 0) {
    throw new Error(`viewpoint catalogue: ${problems.join("; ")}`);
  }
  return {
    viewpoints,
    byName: new Map(viewpoints.map((v) => [v.name, v])),
    table,
  };
}

/** The catalogue, parsed and checked on first use. */
export function viewpointCatalogue(): Catalogue {
  catalogue ??= loadCatalogue(VIEWPOINT_FILES, decisions);
  return catalogue;
}

export const viewpoints = (): Viewpoint[] => viewpointCatalogue().viewpoints;

/** A viewpoint by name; another name is NOT_FOUND with the names there are. */
export function findViewpoint(name: string): Viewpoint {
  const found = viewpointCatalogue().byName.get(name as ViewpointName);
  if (!found) {
    throw new ApiError(
      "NOT_FOUND",
      `No viewpoint ${name}; the viewpoints are ${VIEWPOINT_NAMES.join(", ")}`,
    );
  }
  return found;
}

/** The node limit of a viewpoint for a diagram kind. */
export const elementLimit = (v: Viewpoint, kind: string): number =>
  v.limits.kinds?.[kind as keyof NonNullable<Viewpoint["limits"]["kinds"]>] ??
  v.limits.maxElements;
