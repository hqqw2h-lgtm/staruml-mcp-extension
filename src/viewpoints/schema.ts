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
import { KINDS } from "../build/spec.js";
import { doc } from "../endpoint.js";

/*
 * The shape of a viewpoint and of the decision table that picks one
 * (issue #42). A viewpoint is a contract for a kind of view: whose
 * questions it answers, which model element and relationship types may
 * appear on it, how many, and which parts it must carry. src/viewpoints
 * holds one JSON file per viewpoint and decisions.json; viewpoint.schema.json
 * and decisions.schema.json are these schemas as JSON Schema, which the files
 * name in $schema.
 */

export const VIEWPOINT_NAMES = [
  "context",
  "container",
  "component",
  "code",
  "runtime",
  "lifecycle",
  "actors-goals",
  "deployment",
  "data",
] as const;
export type ViewpointName = (typeof VIEWPOINT_NAMES)[number];

/** Who reads a view; a viewpoint lists the audiences it is written for. */
export const AUDIENCES = [
  "business",
  "analyst",
  "architect",
  "developer",
  "tester",
  "operator",
  "dba",
] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Parts a view of the viewpoint must show besides its elements. */
export const PARTS = ["title", "legend", "trigger"] as const;
export type Part = (typeof PARTS)[number];

/** What a /request_diagram scope is, by the element it names. */
export const SCOPE_KINDS = [
  "model",
  "package",
  "class",
  "interaction",
  "statemachine",
  "actor",
  "usecase",
  "other",
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

const text = () => z.string().check(z.minLength(1));
const typeNames = (what: string, min: number) =>
  doc(
    z
      .array(z.string().check(z.regex(/^[A-Z][A-Za-z0-9]*$/)))
      .check(z.minLength(min)),
    `${what}, by StarUML metaclass name (UMLClass, C4Person, ERDEntity).`,
  );
const count = () => z.int().check(z.minimum(1), z.maximum(500));

export const viewpointSchema = () =>
  z.strictObject({
    $schema: z.optional(z.string()),
    name: z.enum(VIEWPOINT_NAMES),
    title: text(),
    summary: doc(text(), "What a view of this kind shows, in a sentence."),
    question: doc(text(), "The question every view of it must answer."),
    concerns: z.array(text()).check(z.minLength(1)),
    stakeholders: z.array(z.enum(AUDIENCES)).check(z.minLength(1)),
    kinds: doc(
      z.array(z.enum(KINDS)).check(z.minLength(1)),
      "Diagram kinds that can show it, the usual one first.",
    ),
    elements: typeNames("Node types a view may show", 1),
    relationships: typeNames("Edge types a view may show", 0),
    limits: z.strictObject({
      maxElements: doc(count(), "Nodes past which a view is split."),
      maxLifelines: z.optional(
        doc(count(), "Lifelines past which a scenario is drawn otherwise."),
      ),
      kinds: z.optional(
        doc(
          z.partialRecord(z.enum(KINDS), count()),
          "maxElements for a diagram kind, where it differs.",
        ),
      ),
    }),
    required: doc(
      z.array(z.enum(PARTS)),
      "title: a name that is not the default; legend: a legend note; trigger: what starts the scenario.",
    ),
    legend: z.optional(
      doc(z.array(text()), "Lines of the legend note, under 'Legend'."),
    ),
    split: doc(text(), "How a view past its limits is divided."),
  });
export type Viewpoint = z.output<ReturnType<typeof viewpointSchema>>;

export const decisionRuleSchema = () =>
  z.strictObject({
    id: z.string().check(z.regex(/^D[0-9]{2}$/)),
    viewpoint: z.enum(VIEWPOINT_NAMES),
    kind: z.enum(KINDS),
    phrases: doc(
      z.array(text()).check(z.minLength(1)),
      "Words of an intent that ask for this view; each scores its word count.",
    ),
    weak: z.optional(
      doc(
        z.array(text()),
        "Words that hint at it; each scores a quarter of its word count.",
      ),
    ),
    scopes: doc(
      z.array(z.enum(SCOPE_KINDS)).check(z.minLength(1)),
      "Scopes it can be drawn for.",
    ),
    reason: doc(text(), "Why this view answers such an intent."),
  });
export type DecisionRule = z.output<ReturnType<typeof decisionRuleSchema>>;

export const decisionTableSchema = () =>
  z.strictObject({
    $schema: z.optional(z.string()),
    version: z.int().check(z.minimum(1)),
    rules: z.array(decisionRuleSchema()).check(z.minLength(1)),
    defaults: doc(
      z.partialRecord(z.enum(SCOPE_KINDS), z.string()),
      "The rule an intent matching none takes, by scope kind.",
    ),
  });
export type DecisionTable = z.output<ReturnType<typeof decisionTableSchema>>;
