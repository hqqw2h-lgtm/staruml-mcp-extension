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
import { ApiError } from "../errors.js";
import { requireDiagram, requireElement, requireProject } from "../lookup.js";
import { calledName, type Change, planModel } from "../model/plan.js";
import {
  GEOMETRY_HINT,
  modelSpecSchema,
  parseModelSpec,
  RELATIONS,
} from "../model/spec.js";
import { pathOf } from "../refs.js";
import {
  normalizeModelSpec,
  Renames,
  styleReport,
  styleReportSchema,
} from "../style/apply.js";
import { effectiveProfile } from "../style/profile.js";
import { ref } from "../schemas.js";
import type { Element, View } from "../types.js";
import { batchRunner, type OpResult } from "./batch.js";
import { planOf, planSchema, resultField } from "./build.js";

/*
 * Model-level authoring (issue #23): /build_model makes or updates a whole
 * model from an object-level spec, without diagrams; /sync_operations and
 * /check_messages keep a sequence diagram's messages and the receivers'
 * operations in step.
 */

/**
 * Ops one /build_model may run. The preference mcp-ext.limits.maxBatchOps
 * bounds a client's /batch; a model spec of a hundred classes with their
 * members is a few thousand ops of one call.
 */
export const MODEL_MAX_OPS = 20_000;

const changeSchema = () =>
  z.object({
    path: z.string(),
    type: z.string(),
    fields: z.optional(z.array(z.string())),
  });

/** Paths of each kind a dry run lists unless asked for the full detail. */
export const DRY_RUN_PATHS = 20;

export const DRY_RUN_DETAILS = ["summary", "full"] as const;

export const detailField = () =>
  z.optional(
    doc(
      z.enum(DRY_RUN_DETAILS),
      `With dryRun: summary (default; /build_model with result full defaults to full) lists the first ${DRY_RUN_PATHS} changes, ops and steps of each kind with the counts of the rest in omitted, strings in ops cut at ${CLIP} characters; full lists every one whole. A 645-op ThingsBoard model's full dry run is 80 KB.`,
    ),
  );

export const omittedSchema = () =>
  z.optional(
    doc(
      z.object({
        created: z.int(),
        updated: z.int(),
        ops: z.int(),
        steps: z.int(),
      }),
      "With a summary dry run: how many of each were left out of changes and plan.",
    ),
  );

type Plan = ReturnType<typeof planOf>;

/** Longest string a summary dry run quotes in an op's body. */
export const CLIP = 200;

/**
 * Strings longer than CLIP cut to it with how many characters were left:
 * the stored view sections ride in one tag op of 20 KB for ThingsBoard,
 * a summary's first ops would otherwise carry them whole.
 */
export function clip(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > CLIP
      ? `${value.slice(0, CLIP)}... [${value.length - CLIP} more chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map(clip);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clip(v)]),
    );
  }
  return value;
}

/**
 * A dry run's changes and plan as a summary: the first DRY_RUN_PATHS of
 * each list, and how many were left out. The counts answer the size; the
 * first paths show what kind of change it is.
 */
export function summarize<C>(
  changes: { created: C[]; updated: C[] },
  plan: Plan,
  detail: (typeof DRY_RUN_DETAILS)[number] | undefined,
) {
  if (detail === "full") return { changes, plan };
  const first = <T>(list: T[]) => list.slice(0, DRY_RUN_PATHS);
  const rest = (list: unknown[]) => Math.max(0, list.length - DRY_RUN_PATHS);
  const omitted = {
    created: rest(changes.created),
    updated: rest(changes.updated),
    ops: rest(plan.ops),
    steps: rest(plan.creates) + rest(plan.updates) + rest(plan.deletes),
  };
  return {
    changes: {
      created: first(changes.created),
      updated: first(changes.updated),
    },
    plan: {
      ops: first(plan.ops).map((op) => clip(op) as (typeof plan.ops)[number]),
      creates: first(plan.creates),
      updates: first(plan.updates),
      deletes: first(plan.deletes),
    },
    ...(Object.values(omitted).some((n) => n > 0) && { omitted }),
  };
}

const countBy = (changes: readonly Change[]) => {
  const out: Record<string, number> = {};
  for (const c of changes) out[c.type] = (out[c.type] ?? 0) + 1;
  return out;
};

/** The id of an element the plan names: its own, or that of the op that made it. */
function idOf(result: OpResult | undefined, ref: string): string {
  return ref.startsWith("$") ? (result!.data as { _id: string })._id : ref;
}

export function buildModelEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/build_model",
    unknownKeyHint: GEOMETRY_HINT,
    description: `Make or update a model from an object-level spec, without diagrams, as one undo step: packages (contexts), classes with members and responsibilities (documentation), relationships (${Object.keys(RELATIONS).join(", ")}), actors and use cases, collaborations as interactions with lifelines and messages, lifecycles as state machines. The spec is strict (additionalProperties false, no geometry or colour fields); its view sections (classViews, useCaseViews, activities, erd, components, deployments, features) are stored with the model as a hidden tag for /derive_diagrams. Relationship types are these verbs only: a UML word (composition, generalization...) is refused with the verb to write. dryRun answers the counts with the first 20 changes and /batch ops (detail full: every one); upsert updates the model of the same name.`,
    readOnly: false,
    destructive: false,
    request: z.object({
      spec: doc(
        modelSpecSchema(),
        `The object model, no diagrams and no geometry: an unknown field (a position, a size, a colour) is refused. Relationship direction: ${Object.entries(
          RELATIONS,
        )
          .map(([k, v]) => `${k}: ${v}`)
          .join(
            "; ",
          )}. classViews, useCaseViews, activities, erd, components, deployments and features are stored with the model for /derive_diagrams.`,
      ),
      parent: z.optional(ref("Owner of the model; default the project.")),
      upsert: z.optional(
        doc(
          z.boolean(),
          "Update the model of the same name under the parent: elements are matched by owner, type and name, members by name, relationships by type, ends and name; what differs is set, what is missing added, nothing removed.",
        ),
      ),
      dryRun: z.optional(
        doc(
          z.boolean(),
          "Answer the changes and the /batch ops, and change nothing; detail says how many.",
        ),
      ),
      detail: detailField(),
      result: resultField(
        "terse (default): counts by element type. ids: also the id of each package, classifier, collaboration and state machine by path. full: also every created and updated element.",
      ),
    }),
    response: z.object({
      model: doc(
        z.object({ _id: z.string(), name: z.string(), path: z.string() }),
        "The model built or updated; _id is '$m0' on a dry run that makes it.",
      ),
      upserted: doc(z.boolean(), "The model existed and was updated."),
      counts: z.object({
        created: doc(z.record(z.string(), z.int()), "Elements made, by type."),
        updated: doc(
          z.record(z.string(), z.int()),
          "Elements changed, by type.",
        ),
        unchanged: doc(
          z.int(),
          "Elements the spec names that already were as written.",
        ),
      }),
      changes: z.optional(
        doc(
          z.object({
            created: z.array(changeSchema()),
            updated: z.array(changeSchema()),
          }),
          "With result full or dryRun: each element made or changed, by path; relationships as 'from -> to'.",
        ),
      ),
      ids: z.optional(
        doc(z.record(z.string(), z.string()), "With result ids or full."),
      ),
      skipped: z.optional(
        doc(
          z.array(z.object({ section: z.string(), reason: z.string() })),
          "Not answered since the spec became strict (issue #33): every section is the model's; kept for older clients.",
        ),
      ),
      dryRun: z.optional(z.boolean()),
      plan: z.optional(doc(planSchema(), "With dryRun: what applying runs.")),
      omitted: omittedSchema(),
      style: z.optional(styleReportSchema()),
    }),
    handle: async (input) => {
      const profile = effectiveProfile().profile;
      const renames = new Renames(profile);
      const spec = normalizeModelSpec(parseModelSpec(input.spec), renames);
      const parent =
        input.parent === undefined
          ? requireProject()
          : requireElement(input.parent, "Parent");
      const plan = planModel(spec, { parent, upsert: input.upsert ?? false });
      const mode = input.result ?? "terse";
      const report = {
        upserted: !plan.root.ref.startsWith("$"),
        counts: {
          created: countBy(plan.created),
          updated: countBy(plan.updated),
          unchanged: plan.unchanged,
        },
        ...(mode === "full" &&
          !input.dryRun && {
            changes: { created: plan.created, updated: plan.updated },
          }),
        style: styleReport(profile, renames, 0),
      };
      const model = {
        _id: plan.root.ref,
        name: spec.name,
        path: plan.root.path,
      };
      if (input.dryRun) {
        return {
          model,
          ...report,
          ...(mode !== "terse" && { ids: Object.fromEntries(plan.refs) }),
          dryRun: true,
          ...summarize(
            { created: plan.created, updated: plan.updated },
            planOf(plan.ops),
            // Asking for every result asks for every change too.
            input.detail ?? (mode === "full" ? "full" : undefined),
          ),
        };
      }
      const run =
        plan.ops.length > 0
          ? await batchRunner.run(endpoints(), plan.ops, true, MODEL_MAX_OPS)
          : { results: [] };
      const byAlias = new Map(
        run.results.flatMap((r) => (r.as ? [[r.as, r]] : [])),
      );
      const resolve = (ref: string) => idOf(byAlias.get(ref.slice(1)), ref);
      return {
        model: { ...model, _id: resolve(plan.root.ref) },
        ...report,
        ...(mode !== "terse" && {
          ids: Object.fromEntries(
            [...plan.refs].map(([path, ref]) => [path, resolve(ref)]),
          ),
        }),
      };
    },
  });
}

/** A lifeline's classifier: what its role is typed with, else the one class named like it. */
function receiverOf(lifeline: Element | null | undefined): Element | null {
  if (!lifeline) return null;
  const typed = (lifeline.represent as Element | null | undefined)?.type;
  if (typed && typeof typed === "object") return typed as Element;
  const named = app.repository
    .getInstancesOf("UMLClassifier")
    .filter(
      (c) =>
        c.name === lifeline.name &&
        (c instanceof type.UMLClass || c instanceof type.UMLInterface),
    );
  return named.length === 1 ? named[0]! : null;
}

/** Every UMLClassifier holds its operations in a list (the UML metamodel). */
const operationsOf = (c: Element) => c.operations as Element[];

/** Messages a sequence diagram shows, top to bottom. */
function messagesOn(diagram: Element): Element[] {
  if (!(diagram instanceof type.UMLSequenceDiagram)) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${diagram.constructor.name} ${diagram._id} is not a sequence diagram`,
    );
  }
  return (diagram.ownedViews as View[])
    .filter((v) => v.model instanceof type.UMLMessage)
    .map((v) => v.model!);
}

/** Parameters written in a message: "process(session, msg: TbMsg)". */
function argumentsOf(text: string): { name: string; type?: string }[] {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return [];
  return text
    .slice(open + 1, close)
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const colon = a.indexOf(":");
      return colon < 0
        ? { name: a }
        : { name: a.slice(0, colon).trim(), type: a.slice(colon + 1).trim() };
    });
}

type Problem = "not-a-call" | "no-receiver" | "no-operation";

interface Checked {
  message: Element;
  receiver: Element | null;
  called: string | null;
  problem: Problem | null;
}

/** Each call message with its receiver and what is wrong with it, if anything. */
function check(messages: readonly Element[]): Checked[] {
  return messages
    .filter((m) => m.messageSort !== "reply")
    .map((m) => {
      const called = calledName(String(m.name ?? ""));
      const receiver = receiverOf(m.target as Element | null);
      const problem: Problem | null =
        called === null
          ? "not-a-call"
          : !receiver
            ? "no-receiver"
            : operationsOf(receiver).some((o) => o.name === called)
              ? null
              : "no-operation";
      return { message: m, receiver, called, problem };
    });
}

const PROBLEMS = {
  "not-a-call":
    "The text names no operation, e.g. prose such as 'check limits'.",
  "no-receiver":
    "The receiving lifeline has no class or interface: type its role, or name it like one class.",
  "no-operation":
    "The receiver has no operation of that name: /sync_operations adds it.",
} as const;

export const checkMessages = defineEndpoint({
  path: "/check_messages",
  description:
    "List the call messages of a sequence diagram (or of every interaction in a scope) that name no operation of their receiver: no-operation (the receiver lacks it; /sync_operations adds it), no-receiver (the lifeline has no class or interface) and not-a-call (prose). Replies are not checked. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagram: z.optional(ref("Sequence diagram.")),
    scope: z.optional(
      ref("Instead of diagram: every message owned within this element."),
    ),
  }),
  response: z.object({
    checked: doc(z.int(), "Call messages looked at."),
    ok: doc(z.int(), "Messages naming an operation of their receiver."),
    problems: z.array(
      z.object({
        message: z.string(),
        text: z.string(),
        from: z.nullable(z.string()),
        to: z.nullable(z.string()),
        receiver: doc(z.nullable(z.string()), "The receiver's path."),
        problem: z.enum(Object.keys(PROBLEMS) as [Problem, ...Problem[]]),
        hint: z.string(),
      }),
    ),
  }),
  handle: (input) => {
    if ((input.diagram === undefined) === (input.scope === undefined)) {
      throw new ApiError("INVALID_ARGUMENT", "Pass diagram or scope");
    }
    let messages: Element[];
    if (input.diagram !== undefined) {
      messages = messagesOn(requireDiagram(input.diagram));
    } else {
      const scope = requireElement(input.scope!, "Scope");
      messages = app.repository.getInstancesOf("UMLMessage").filter((m) => {
        for (let e: Element | null | undefined = m; e; e = e._parent) {
          if (e === scope) return true;
        }
        return false;
      });
    }
    const checked = check(messages);
    const problems = checked.filter((c) => c.problem !== null);
    return {
      checked: checked.length,
      ok: checked.length - problems.length,
      problems: problems.map((c) => ({
        message: c.message._id,
        text: String(c.message.name ?? ""),
        from: ((c.message.source as Element | null)?.name as string) ?? null,
        to: ((c.message.target as Element | null)?.name as string) ?? null,
        receiver: c.receiver ? pathOf(c.receiver) : null,
        problem: c.problem!,
        hint: PROBLEMS[c.problem!],
      })),
    };
  },
});

export function syncOperationsEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/sync_operations",
    description:
      "Add to each receiver of a sequence diagram's call messages the operations the messages name and it lacks, with the parameters written in the message, and set each message's signature to its operation; one undo step. Messages that are prose or go to a lifeline without a class are listed in skipped. dryRun answers the same without changing anything.",
    readOnly: false,
    destructive: false,
    request: z.object({
      diagram: ref("Sequence diagram."),
      dryRun: z.optional(doc(z.boolean(), "Answer what would change.")),
    }),
    response: z.object({
      added: z.array(
        z.object({
          receiver: doc(z.string(), "The class or interface, by path."),
          operation: z.string(),
          parameters: z.array(z.string()),
          messages: doc(z.int(), "Messages calling it."),
        }),
      ),
      linked: doc(z.int(), "Messages given their operation as signature."),
      skipped: z.array(
        z.object({
          message: z.string(),
          text: z.string(),
          reason: z.string(),
        }),
      ),
      dryRun: z.optional(z.boolean()),
      plan: z.optional(planSchema()),
    }),
    handle: async (input) => {
      const diagram = requireDiagram(input.diagram);
      const ops: {
        path: string;
        body: Record<string, unknown>;
        as?: string;
      }[] = [];
      const added = new Map<
        string,
        {
          receiver: string;
          operation: string;
          parameters: string[];
          messages: number;
          ref: string;
        }
      >();
      const skipped: { message: string; text: string; reason: string }[] = [];
      let linked = 0;
      for (const c of check(messagesOn(diagram))) {
        if (c.problem === "not-a-call" || c.problem === "no-receiver") {
          skipped.push({
            message: c.message._id,
            text: String(c.message.name ?? ""),
            reason: PROBLEMS[c.problem],
          });
          continue;
        }
        const receiver = c.receiver!;
        const key = `${receiver._id}#${c.called}`;
        let opRef = operationsOf(receiver).find(
          (o) => o.name === c.called,
        )?._id;
        if (!opRef) {
          const known = added.get(key);
          if (known) {
            known.messages++;
            opRef = known.ref;
          } else {
            const parameters = argumentsOf(String(c.message.name));
            const as = `op${added.size}`;
            ops.push({
              path: "/add_operation",
              as,
              body: {
                ref: receiver._id,
                name: c.called,
                ...(parameters.length > 0 && { parameters }),
              },
            });
            opRef = `$${as}`;
            added.set(key, {
              receiver: pathOf(receiver)!,
              operation: c.called!,
              parameters: parameters.map((p) => p.name),
              messages: 1,
              ref: opRef,
            });
          }
        }
        if ((c.message.signature as Element | null)?._id !== opRef) {
          linked++;
          ops.push({
            path: "/update_element",
            body: { ref: c.message._id, field: "signature", value: opRef },
          });
        }
      }
      const answer = {
        added: [...added.values()].map(({ ref: _ref, ...a }) => a),
        linked,
        skipped,
      };
      if (input.dryRun) return { ...answer, dryRun: true, plan: planOf(ops) };
      if (ops.length > 0)
        await batchRunner.run(endpoints(), ops, true, MODEL_MAX_OPS);
      return answer;
    },
  });
}
