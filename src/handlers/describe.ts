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
import {
  formatAttribute,
  formatOperation,
  typeText,
} from "../build/members.js";
import { loadValidationRules } from "../app-modules.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireElement } from "../lookup.js";
import { id } from "../schemas.js";
import { summarize } from "../serialize.js";
import type { Element, View } from "../types.js";

/**
 * A name on one line; StarUML names may hold line breaks. Every model and
 * diagram has a name (Model.name defaults to "", core/core.js).
 */
export function label(elem: Element): string {
  return elem.name!.replace(/\s*\n\s*/g, " ");
}

/** Node views on `diagram` that show a model, in diagram order. */
export function nodeViews(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) => v instanceof type.NodeView && v.model,
  );
}

/** Edge views on `diagram` that show a model and join two modelled views. */
export function edgeViews(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) =>
      v instanceof type.EdgeView &&
      v.model &&
      (v.tail as View | null)?.model &&
      (v.head as View | null)?.model,
  );
}

export const list = (value: unknown) =>
  (Array.isArray(value) ? value : []) as Element[];

/** One member per entry: attributes, operations, literals, columns. */
export function membersOf(model: Element): string[] {
  return [
    ...list(model.attributes).map((a) => formatAttribute(a)),
    ...list(model.operations).map((o) => formatOperation(o)),
    ...list(model.literals).map((l) => label(l)),
    ...list(model.columns).map((c) =>
      [
        label(c),
        typeText(c.type) +
          (typeof c.length === "string" && c.length ? `(${c.length})` : ""),
        c.primaryKey ? "PK" : "",
        c.foreignKey ? "FK" : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ];
}

const quoted = (elem: Element) => {
  const name = label(elem);
  return name ? `"${name}"` : "(unnamed)";
};

function nodeLine(view: View): string {
  const model = view.model!;
  const members = membersOf(model);
  return (
    `- ${model.constructor.name} ${quoted(model)}` +
    (members.length > 0 ? ` { ${members.join("; ")} }` : "")
  );
}

function edgeLine(view: View): string {
  const model = view.model!;
  const name = label(model);
  return (
    `- ${quoted((view.tail as View).model!)} -[${model.constructor.name}` +
    (name ? ` "${name}"` : "") +
    `]-> ${quoted((view.head as View).model!)}`
  );
}

export const describeDiagram = defineEndpoint({
  path: "/describe_diagram",
  description:
    "A compact text summary of a diagram: its nodes with their members and its edges as 'tail -[Type \"name\"]-> head', cut to maxChars. Cheaper to read than the element tree.",
  readOnly: true,
  destructive: false,
  request: z.object({
    diagramId: id("Diagram id."),
    maxChars: z.optional(
      doc(
        z.int().check(z.minimum(200), z.maximum(200_000)),
        "Longest text to return; default 4000. Lines past it are counted, not shown.",
      ),
    ),
  }),
  response: z.object({
    diagram: z.object({
      _id: z.string(),
      _type: z.string(),
      name: z.nullable(z.string()),
    }),
    nodes: doc(z.int(), "Node views showing a model."),
    edges: doc(z.int(), "Edge views showing a model."),
    text: z.string(),
    truncated: z.boolean(),
  }),
  handle: (input) => {
    const diagram = requireDiagram(input.diagramId);
    const max = input.maxChars ?? 4000;
    const nodes = nodeViews(diagram);
    const edges = edgeViews(diagram);
    const lines = [
      `${diagram.constructor.name} ${quoted(diagram)} in ${quoted(diagram._parent!)}: ${nodes.length} nodes, ${edges.length} edges`,
      ...(nodes.length > 0 ? ["Nodes:", ...nodes.map(nodeLine)] : []),
      ...(edges.length > 0 ? ["Edges:", ...edges.map(edgeLine)] : []),
    ];
    let text = "";
    let shown = 0;
    for (const line of lines) {
      const next = shown === 0 ? line : `${text}\n${line}`;
      // Room for the "... N more lines" marker.
      if (next.length > max - 30) break;
      text = next;
      shown++;
    }
    const truncated = shown < lines.length;
    if (truncated) text += `\n... ${lines.length - shown} more lines`;
    const { _id, _type, name } = summarize(diagram);
    return {
      diagram: { _id, _type, name },
      nodes: nodes.length,
      edges: edges.length,
      text,
      truncated,
    };
  },
});

/** Whether `elem` is `ancestor` or owned by it, directly or not. */
function within(elem: Element, ancestor: Element): boolean {
  for (let e: Element | null | undefined = elem; e; e = e._parent) {
    if (e === ancestor) return true;
  }
  return false;
}

export const validateModel = defineEndpoint({
  path: "/validate_model",
  description:
    "Check the open model against StarUML's validation rules (the rules.js of the core and of the UML, ERD and other extensions, what Model > Validate runs on the saved file) and list each problem with the element and rule id. Needs no save. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(
      id(
        "Only problems on this element and what it owns; default the project.",
      ),
    ),
    limit: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(1000)),
        "Most problems to list; default 200. count is always the full number.",
      ),
    ),
  }),
  response: z.object({
    count: doc(z.int(), "Problems found in scope."),
    rules: doc(z.int(), "Rules checked."),
    problems: z.array(
      z.object({
        id: doc(z.string(), "Element id."),
        _type: z.string(),
        name: z.nullable(z.string()),
        ruleId: doc(z.string(), "Rule id, e.g. UML001."),
        message: z.string(),
      }),
    ),
  }),
  handle: (input) => {
    const scope =
      input.scope === undefined ? null : requireElement(input.scope, "Scope");
    const validator = app.validator;
    if (!validator || typeof validator.validate !== "function") {
      throw new ApiError(
        "STARUML_ERROR",
        "This StarUML has no app.validator to run the rules",
      );
    }
    const user = app.extensionLoader?.getUserExtensionPath() ?? null;
    loadValidationRules(user);
    const found = inStarUML(() => validator.validate());
    const problems = found.flatMap((p) => {
      const elem = app.repository.get(p.id);
      if (!elem || (scope && !within(elem, scope))) return [];
      return [
        {
          id: p.id,
          _type: elem.constructor.name,
          name: (elem.name as string | undefined) ?? null,
          ruleId: String(p.ruleId),
          message: String(p.message),
        },
      ];
    });
    return {
      count: problems.length,
      rules: rules.length,
      problems: problems.slice(0, input.limit ?? 200),
    };
  },
});
