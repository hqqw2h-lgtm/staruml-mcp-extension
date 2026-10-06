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
import { FORMATS } from "../build/source.js";
import { DIAGRAM_TYPES, KINDS, planFor } from "../build/spec.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireDiagram, requireProject } from "../lookup.js";
import { candidate, pathOf } from "../refs.js";
import { elementSchema, ref } from "../schemas.js";
import { serialize } from "../serialize.js";
import type { Element, Operation } from "../types.js";
import { describeOp, opsFor, readSource } from "./build.js";

/*
 * Issue #22: see a change before making it, and say what changed since a
 * point. /diff_diagram compares a diagram with a spec through the same
 * planning /build_diagram does; /snapshot records every model element's
 * attributes, /diff_since compares the model with them, and
 * /restore_snapshot undoes back to the snapshot.
 */

const refItem = () =>
  z.object({
    _id: z.string(),
    _type: z.string(),
    path: z.nullable(z.string()),
  });

export const diffDiagram = defineEndpoint({
  path: "/diff_diagram",
  description:
    "Compare a diagram with a spec or diagram text (as /build_diagram takes them) and list what differs: nodes and edges the spec adds, elements and views on the diagram it lacks, and nodes whose members, properties or colours it changes. This is what /build_diagram with upsert and prune would do; nothing is changed.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagram: ref("Diagram to compare."),
    kind: z.optional(
      doc(
        z.enum(KINDS),
        "Diagram kind; required with spec, else read from text.",
      ),
    ),
    spec: z.optional(
      doc(z.record(z.string(), z.unknown()), "A /build_diagram spec."),
    ),
    mermaid: z.optional(z.string().check(z.minLength(1))),
    text: z.optional(
      doc(
        z.string().check(z.minLength(1)),
        "Diagram source, as /build_diagram reads it.",
      ),
    ),
    format: z.optional(z.enum(FORMATS)),
    reuse: z.optional(
      doc(
        z.boolean(),
        "As /build_diagram's reuse, default true: a new node named like an element elsewhere counts as showing that element.",
      ),
    ),
  }),
  aliases: { diagramId: "diagram", id: "diagram" },
  response: z.object({
    diagram: elementSchema(),
    kind: z.string(),
    identical: doc(z.boolean(), "The diagram already shows the spec."),
    added: z.object({
      nodes: doc(z.array(z.string()), "Nodes of the spec not on the diagram."),
      edges: doc(
        z.array(z.string()),
        "Edges of the spec not on the diagram, 'from -> to'.",
      ),
    }),
    removed: doc(
      z.array(refItem()),
      "Elements (or, where they are shown elsewhere too, views) on the diagram that the spec lacks.",
    ),
    changed: z.array(
      z.object({
        node: z.string(),
        path: z.nullable(z.string()),
        changes: z.array(z.string()),
      }),
    ),
    unchanged: doc(z.int(), "Nodes and edges that match."),
  }),
  handle: (input) => {
    const diagram = requireDiagram(input.diagram);
    const { kind, spec, direction } = readSource(input);
    const expected = DIAGRAM_TYPES[kind];
    if (!app.metamodels.isKindOf(diagram.constructor.name, expected)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${pathOf(diagram)} is a ${diagram.constructor.name}; a ${kind} spec builds a ${expected}`,
      );
    }
    const built = opsFor(
      planFor(kind, spec),
      { diagram, parent: diagram._parent!, name: diagram.name },
      direction ?? "TB",
      false,
      undefined,
      { prune: true, reuse: input.reuse ?? true },
    );
    const added = {
      nodes: [...built.created.values()],
      edges: built.edgeOps.map((e) => e.key),
    };
    const removed = built.removed.map(candidate);
    const changed = built.changes.map((c) => ({
      node: c.key,
      path: pathOf(c.view),
      changes: c.ops.map((op) => {
        const step = describeOp(op);
        return step.change ?? `${op.path.slice(1)} ${step.name}`;
      }),
    }));
    return {
      diagram: serialize(diagram),
      kind,
      identical:
        added.nodes.length +
          added.edges.length +
          removed.length +
          changed.length ===
        0,
      added,
      removed,
      changed,
      unchanged: built.unchanged,
    };
  },
});

interface Captured {
  type: string;
  name: string | null;
  path: string | null;
  fields: Record<string, string>;
}

interface Snapshot {
  label: string;
  takenAt: string;
  project: Element;
  /** The operation on top of the undo stack when taken, null for an empty stack. */
  top: Operation | null;
  elements: Map<string, Captured>;
}

/** Snapshots kept, oldest dropped first; each holds every element's attributes. */
export const MAX_SNAPSHOTS = 20;

const snapshots = new Map<string, Snapshot>();

/** core/repository.js keeps its history in two Stack objects whose items are `stack`. */
interface History {
  _undoStack: { stack: Operation[] };
  _redoStack: { stack: Operation[] };
}
const history = () => app.repository as unknown as History;

/**
 * A model element's own attributes as JSON, by name. Owned lists are left
 * out, so a new attribute shows as added rather than as a change to its
 * class too; views are not captured at all.
 */
function capture(elem: Element): Captured {
  const owned = new Set(
    app.metamodels
      .getMetaAttributes(elem.constructor.name)
      .filter((a) => a.kind === "obj" || a.kind === "objs")
      .map((a) => a.name),
  );
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(serialize(elem, { summary: false }))) {
    if (!owned.has(k)) fields[k] = JSON.stringify(v);
  }
  return {
    type: elem.constructor.name,
    name: typeof elem.name === "string" ? elem.name : null,
    path: pathOf(elem),
    fields,
  };
}

function models(): Element[] {
  return Object.values(app.repository.getIdMap()).filter(
    (e) => !(e instanceof type.View),
  );
}

function requireSnapshot(label: string): Snapshot {
  const snap = snapshots.get(label);
  if (!snap) {
    throw new ApiError(
      "NOT_FOUND",
      `No snapshot ${label}; snapshots: ${[...snapshots.keys()].join(", ") || "none"}`,
    );
  }
  if (snap.project !== app.project.getProject()) {
    throw new ApiError(
      "SNAPSHOT_STALE",
      `Snapshot ${label} was taken of another project`,
    );
  }
  return snap;
}

export const takeSnapshot = defineEndpoint({
  path: "/snapshot",
  description:
    "Record a checkpoint of the model under a label: every element's attributes, and the place in the undo history. /diff_since lists what changed after it, /restore_snapshot goes back to it. Kept in memory, at most 20, until StarUML restarts; a label taken again is replaced.",
  readOnly: true,
  destructive: false,
  request: z.object({
    label: z.optional(
      doc(
        z.string().check(z.minLength(1), z.maxLength(100)),
        "Name to refer to it by; default snapshot-<n>.",
      ),
    ),
  }),
  response: z.object({
    label: z.string(),
    takenAt: doc(z.string(), "ISO time."),
    elements: doc(z.int(), "Model elements recorded (views are not)."),
  }),
  handle: (input) => {
    const project = requireProject();
    const label = input.label ?? `snapshot-${snapshots.size + 1}`;
    const elements = new Map(models().map((e) => [e._id, capture(e)]));
    const undo = history()._undoStack.stack;
    snapshots.delete(label);
    snapshots.set(label, {
      label,
      takenAt: new Date().toISOString(),
      project,
      top: undo.at(-1) ?? null,
      elements,
    });
    if (snapshots.size > MAX_SNAPSHOTS) {
      snapshots.delete(snapshots.keys().next().value!);
    }
    const snap = snapshots.get(label)!;
    return { label, takenAt: snap.takenAt, elements: elements.size };
  },
});

const changedItem = () =>
  z.object({
    _id: z.string(),
    _type: z.string(),
    name: z.nullable(z.string()),
    path: z.nullable(z.string()),
    fields: doc(z.array(z.string()), "Attributes whose value differs."),
  });

const listed = () =>
  z.object({
    _id: z.string(),
    _type: z.string(),
    name: z.nullable(z.string()),
    path: z.nullable(z.string()),
  });

export function diffSince(snap: Snapshot) {
  const added: z.output<ReturnType<typeof listed>>[] = [];
  const changed: z.output<ReturnType<typeof changedItem>>[] = [];
  const seen = new Set<string>();
  for (const elem of models()) {
    seen.add(elem._id);
    const before = snap.elements.get(elem._id);
    const now = capture(elem);
    const item = {
      _id: elem._id,
      _type: now.type,
      name: now.name,
      path: now.path,
    };
    if (!before) {
      added.push(item);
      continue;
    }
    const fields = [
      ...new Set([...Object.keys(before.fields), ...Object.keys(now.fields)]),
    ].filter((f) => before.fields[f] !== now.fields[f]);
    if (fields.length > 0) changed.push({ ...item, fields });
  }
  const removed = [...snap.elements]
    .filter(([id]) => !seen.has(id))
    .map(([id, c]) => ({ _id: id, _type: c.type, name: c.name, path: c.path }));
  return { added, changed, removed };
}

export const diffSinceEndpoint = defineEndpoint({
  path: "/diff_since",
  description:
    "List the model elements added, changed (with the attributes that differ) and removed since a /snapshot, with their paths. Views are not compared.",
  readOnly: true,
  destructive: false,
  request: z.object({
    snapshot: doc(z.string().check(z.minLength(1)), "The snapshot's label."),
    limit: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(5000)),
        "Most items per list; default 200. counts are always the full numbers.",
      ),
    ),
  }),
  response: z.object({
    snapshot: z.string(),
    counts: z.object({ added: z.int(), changed: z.int(), removed: z.int() }),
    truncated: z.boolean(),
    added: z.array(listed()),
    changed: z.array(changedItem()),
    removed: z.array(listed()),
  }),
  handle: (input) => {
    const snap = requireSnapshot(input.snapshot);
    const { added, changed, removed } = diffSince(snap);
    const limit = input.limit ?? 200;
    return {
      snapshot: snap.label,
      counts: {
        added: added.length,
        changed: changed.length,
        removed: removed.length,
      },
      truncated: [added, changed, removed].some((l) => l.length > limit),
      added: added.slice(0, limit),
      changed: changed.slice(0, limit),
      removed: removed.slice(0, limit),
    };
  },
});

/**
 * Undoes every operation recorded after the snapshot, then merges them on
 * the redo stack into one, so the restore is one step of history: one
 * /redo brings back everything it undid. Merging is what /batch does on
 * the undo stack; Repository.redo applies the merged ops in order.
 */
export const restoreSnapshot = defineEndpoint({
  path: "/restore_snapshot",
  description:
    "Undo back to a /snapshot in one step: every operation recorded after it is undone, and one /redo brings them all back. Refused as SNAPSHOT_STALE when the undo history no longer reaches the snapshot (it was undone past, cut by StarUML's history limit, or another project is open).",
  readOnly: false,
  destructive: true,
  request: z.object({
    snapshot: doc(z.string().check(z.minLength(1)), "The snapshot's label."),
  }),
  response: z.object({
    snapshot: z.string(),
    undone: doc(z.int(), "Operations undone."),
    remaining: doc(
      z.object({ added: z.int(), changed: z.int(), removed: z.int() }),
      "What still differs from the snapshot afterwards; all zero unless something changed outside the undo history.",
    ),
  }),
  handle: (input) => {
    const snap = requireSnapshot(input.snapshot);
    const undo = history()._undoStack.stack;
    const at = snap.top === null ? -1 : undo.lastIndexOf(snap.top);
    if (snap.top !== null && at < 0) {
      throw new ApiError(
        "SNAPSHOT_STALE",
        `The undo history no longer reaches snapshot ${snap.label}`,
      );
    }
    const count = undo.length - 1 - at;
    for (let i = 0; i < count; i++) app.repository.undo();
    if (count > 1) {
      const redo = history()._redoStack.stack;
      const undone = redo.splice(redo.length - count, count).reverse();
      const builder = app.repository.getOperationBuilder();
      builder.begin("restore snapshot");
      builder.end();
      const merged = builder.getOperation();
      merged.ops = undone.flatMap((o) => o.ops);
      redo.push(merged);
    }
    const diff = diffSince(snap);
    return {
      snapshot: snap.label,
      undone: count,
      remaining: {
        added: diff.added.length,
        changed: diff.changed.length,
        removed: diff.removed.length,
      },
    };
  },
});

/** For tests: forget every snapshot. */
export function clearSnapshots(): void {
  snapshots.clear();
}
