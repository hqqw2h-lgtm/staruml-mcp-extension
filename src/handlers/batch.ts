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
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError, type ErrorBody } from "../errors.js";
import type { HandlerResult } from "../http-server.js";
import { maxBatchOps } from "../settings.js";
import type { Operation } from "../types.js";

/**
 * Paths an atomic batch refuses. Nesting and history steps would fight the
 * batch's own undo handling, replacing the project would leave nothing to roll
 * back, saving would persist a state that may be rolled back, and the async
 * ones (command execution, code generation, multi-diagram, PDF and HTML
 * export) yield to the event loop, where another request's change would be
 * recorded as part of the batch. /export_diagram yields only to composite a
 * background, and records no operation of its own.
 */
export const NOT_ATOMIC = new Set([
  "/batch",
  "/build_diagram",
  "/build_model",
  "/sync_operations",
  "/apply_pattern",
  "/apply_preset",
  "/apply_theme",
  "/undo",
  "/redo",
  "/restore_snapshot",
  "/new_project",
  "/open_project",
  "/save_project",
  "/save_project_as",
  "/execute_command",
  "/export_pdf",
  "/export_html",
  "/export_diagrams",
  "/generate_code",
  "/reverse_code",
]);

const NAME = /^[A-Za-z_][\w-]*$/;
const REFERENCE = /^\$([A-Za-z_][\w-]*)((?:\.(?:[A-Za-z_$][\w$]*|\d+))*)$/;

type Results = Map<string, { success: boolean; data?: unknown }>;

/**
 * Replaces each string "$name" or "$name.path" with what it names in the
 * result of the op saved as `name`: an element becomes its id (`.id` is
 * accepted for `_id`), so "$cls" is the created element's id and "$cls.view"
 * and "$cls.model" those of a create_*_with_view result; a numeric segment
 * indexes a list, as in "$frag.model.operands.0" of a result projected with
 * fields: ["operands"]. "$$" escapes a literal leading "$".
 */
export function resolveReferences(value: unknown, results: Results): unknown {
  if (typeof value === "string") {
    if (value.startsWith("$$")) return value.slice(1);
    const match = REFERENCE.exec(value);
    return match ? lookup(value, match[1]!, match[2]!, results) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveReferences(v, results));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveReferences(v, results)]),
    );
  }
  return value;
}

function lookup(
  text: string,
  name: string,
  path: string,
  results: Results,
): unknown {
  const result = results.get(name);
  if (!result) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${text}: no earlier op is named ${name}`,
    );
  }
  if (!result.success) {
    throw new ApiError("INVALID_ARGUMENT", `${text}: op ${name} failed`);
  }
  let value: unknown = result.data;
  for (const segment of path.split(".").slice(1)) {
    const key = segment === "id" ? "_id" : segment;
    value =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  if (value !== null && typeof value === "object") {
    const { _id, $ref } = value as { _id?: unknown; $ref?: unknown };
    value = _id ?? $ref;
  }
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new ApiError("INVALID_ARGUMENT", `${text} does not name a value`);
  }
  return value;
}

const opSchema = () =>
  z.object({
    path: doc(
      z.string().check(z.regex(/^\//)),
      "Endpoint path, e.g. '/create_element_with_view'.",
    ),
    body: z.optional(
      doc(
        z.record(z.string(), z.unknown()),
        "The endpoint's request body. Strings '$name' and '$name.field' are replaced by ids from earlier results.",
      ),
    ),
    as: z.optional(
      doc(
        z.string().check(z.regex(NAME)),
        "Name later ops use to refer to this op's result.",
      ),
    ),
  });

const resultSchema = () =>
  z.object({
    path: z.string(),
    as: z.optional(z.string()),
    success: z.boolean(),
    id: z.optional(
      doc(
        z.string(),
        "result terse: the id of what the op made or acted on (its model, for a model with a view).",
      ),
    ),
    data: z.optional(
      doc(
        z.unknown(),
        "result full: the op's response data; result ids: its ids only.",
      ),
    ),
    code: z.optional(z.string()),
    error: z.optional(z.string()),
    details: z.optional(z.unknown()),
  });

export interface OpResult {
  path: string;
  as?: string;
  success: boolean;
  id?: string;
  data?: unknown;
  code?: string;
  error?: string;
  details?: unknown;
}

export type Op = z.infer<ReturnType<typeof opSchema>>;

/** Fails the whole request before anything runs, for problems knowable up front. */
function checkPlan(
  ops: readonly Op[],
  endpoints: ReadonlyMap<string, Endpoint>,
  atomic: boolean,
  max: number,
): void {
  if (ops.length > max) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      `A batch takes at most ${max} ops (preference mcp-ext.limits.maxBatchOps); got ${ops.length}`,
    );
  }
  const names = new Set<string>();
  ops.forEach((op, i) => {
    if (!endpoints.has(op.path)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `ops.${i}.path: no endpoint ${op.path}`,
      );
    }
    if (op.path === "/batch" || (atomic && NOT_ATOMIC.has(op.path))) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `ops.${i}.path: ${op.path} cannot run in ${atomic ? "an atomic" : "a"} batch`,
      );
    }
    if (op.as !== undefined) {
      if (names.has(op.as)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `ops.${i}.as: ${op.as} is used twice`,
        );
      }
      names.add(op.as);
    }
  });
}

async function runOp(
  op: Op,
  endpoint: Endpoint,
  results: Results,
): Promise<OpResult> {
  let outcome: HandlerResult;
  try {
    const body = resolveReferences(op.body ?? {}, results) as Record<
      string,
      unknown
    >;
    outcome = await endpoint.handler(body);
  } catch (err) {
    // An unexpected throw is still a defect; the batch reports it like the
    // HTTP server would rather than losing the results of earlier ops.
    outcome =
      err instanceof ApiError
        ? err.toBody()
        : { success: false, code: "INTERNAL", error: String(err) };
  }
  if (op.as !== undefined) results.set(op.as, outcome);
  return {
    path: op.path,
    ...(op.as !== undefined && { as: op.as }),
    ...outcome,
  };
}

/**
 * Collects the undoable operations StarUML records while `run` executes,
 * through the repository's operationExecuted event (core/repository.js,
 * emitted after an operation is pushed on the undo stack).
 */
async function recording<T>(
  run: () => Promise<T>,
): Promise<{ value: T; operations: Operation[] }> {
  const operations: Operation[] = [];
  const listener = (operation: Operation) => operations.push(operation);
  app.repository.on("operationExecuted", listener);
  try {
    return { value: await run(), operations };
  } finally {
    app.repository.off("operationExecuted", listener);
  }
}

/** core/repository.js keeps its history in two Stack fields with no public accessors. */
interface History {
  _undoStack: { pop(): unknown; push(operation: Operation): void };
  _redoStack: { clear(): void };
}

const history = () => app.repository as unknown as History;

/**
 * Replaces the batch's operations on the undo stack by one whose ops are
 * theirs in order; undo reverts ops last to first, so reverting it equals
 * reverting each operation in turn. The stack is edited rather than the
 * operations undone and the merged one re-applied, which would run every
 * change twice (measured at about twice the batch's time on 7.1.1). The
 * top of the stack is the batch's: endpoints that yield to the event loop
 * are refused in atomic batches, so no other request runs in between.
 */
function squash(operations: readonly Operation[]): void {
  const builder = app.repository.getOperationBuilder();
  builder.begin("batch");
  builder.end();
  const merged = builder.getOperation();
  merged.ops = operations.flatMap((o) => o.ops);
  const { _undoStack } = history();
  for (let i = 0; i < operations.length; i++) _undoStack.pop();
  _undoStack.push(merged);
}

type Mode = "terse" | "ids" | "full";

/** An element's id, the ids in a create-with-view answer, else nothing. */
function idsOf(data: unknown): unknown {
  if (data === null || typeof data !== "object") return undefined;
  const { _id, view, model } = data as {
    _id?: unknown;
    view?: { _id?: unknown } | null;
    model?: { _id?: unknown } | null;
  };
  if (typeof _id === "string") return { _id };
  if (view && typeof view === "object") {
    return {
      view: { _id: view._id },
      model: model && typeof model === "object" ? { _id: model._id } : null,
    };
  }
  return undefined;
}

/** The id a terse answer names: the model a view shows, else the element. */
function primaryId(data: unknown): string | undefined {
  const ids = idsOf(data) as
    | { _id?: string; view?: { _id: string }; model?: { _id: string } | null }
    | undefined;
  return ids?._id ?? ids?.model?._id ?? ids?.view?._id;
}

/** A successful op's result as `mode` reports it; failures keep everything. */
function shapeResult(result: OpResult, mode: Mode): OpResult {
  if (mode === "full" || !result.success) return result;
  const { data, ...rest } = result;
  if (mode === "ids") {
    const ids = idsOf(data);
    return ids === undefined ? rest : { ...rest, data: ids };
  }
  const id = primaryId(data);
  return id === undefined ? rest : { ...rest, id };
}

function rollBack(operations: readonly Operation[]): void {
  for (let i = 0; i < operations.length; i++) app.repository.undo();
  // Undo leaves the reverted operations redoable; redoing a half-applied
  // batch would bring back what the rollback removed.
  history()._redoStack.clear();
}

export interface BatchRun {
  atomic: boolean;
  succeeded: number;
  failed: number;
  results: OpResult[];
}

/**
 * Runs `ops` as /batch does, answering every op's whole result. Endpoints
 * that compose a batch of their own (/build_model, /apply_pattern) pass a
 * `max` of their own: the preference bounds what a client sends in one
 * request, not what one composite call is made of.
 */
export async function runBatch(
  endpoints: readonly Endpoint[],
  ops: readonly Op[],
  atomic = true,
  max = maxBatchOps(),
): Promise<BatchRun> {
  const byPath = new Map<string, Endpoint>(endpoints.map((e) => [e.path, e]));
  checkPlan(ops, byPath, atomic, max);
  const resultsByName: Results = new Map();
  const { value: results, operations } = await recording(async () => {
    const out: OpResult[] = [];
    for (const op of ops) {
      const result = await runOp(op, byPath.get(op.path)!, resultsByName);
      out.push(result);
      if (atomic && !result.success) break;
    }
    return out;
  });
  const failures = results.filter((r) => !r.success);
  if (atomic && failures.length > 0) {
    rollBack(operations);
    const failed = failures[0]! as OpResult & ErrorBody;
    const index = results.length - 1;
    throw new ApiError(
      failed.code,
      `ops.${index} ${failed.path} failed, batch rolled back: ${failed.error}`,
      { index, results },
    );
  }
  if (atomic && operations.length > 1) squash(operations);
  return {
    atomic,
    succeeded: results.length - failures.length,
    failed: failures.length,
    results,
  };
}

export function batchEndpoint(endpoints: () => readonly Endpoint[]): Endpoint {
  return defineEndpoint({
    path: "/batch",
    description:
      "Run several endpoint calls in one request. Later ops refer to earlier results as '$name' (the result's id), '$name.view' or '$name.model'. atomic (default true) makes the whole batch one undo step and undoes it all when an op fails; atomic false runs every op and reports each. result picks how much of each answer comes back: terse ids by default, ids, or full.",
    readOnly: false,
    destructive: true,
    request: z.object({
      ops: doc(
        z.array(opSchema()).check(z.minLength(1)),
        "Calls in order. The limit is the mcp-ext.limits.maxBatchOps preference, default 500.",
      ),
      atomic: z.optional(
        doc(
          z.boolean(),
          "Default true. Atomic batches refuse /undo, /redo, /restore_snapshot, /new_project, /open_project, /save_project*, /execute_command, /export_pdf, /export_html, /export_diagrams, /generate_code, /reverse_code, and the endpoints running a batch of their own: /build_diagram, /build_model, /sync_operations, /apply_pattern, /apply_preset, /apply_theme.",
        ),
      ),
      result: z.optional(
        doc(
          z.enum(["terse", "ids", "full"]),
          "terse (default): each op's success and the id it made or acted on. ids: each op's ids ({_id}, or {view, model} for a create with view). full: each op's whole answer. Failed ops always carry code, error and details.",
        ),
      ),
    }),
    response: z.object({
      atomic: z.boolean(),
      succeeded: doc(z.int(), "Ops that succeeded."),
      failed: doc(z.int(), "Ops that failed; always 0 for an atomic batch."),
      results: doc(
        z.array(resultSchema()),
        "One entry per op, in order: the op's data, or its error code and message.",
      ),
    }),
    handle: async (input) => {
      const atomic = input.atomic ?? true;
      const run = await runBatch(endpoints(), input.ops, atomic);
      const mode = input.result ?? "terse";
      return {
        ...run,
        results: run.results.map((r) => shapeResult(r, mode)),
      };
    },
  });
}
