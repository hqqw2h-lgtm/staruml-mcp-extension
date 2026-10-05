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

import { ApiError } from "./errors.js";
import type { Element, View } from "./types.js";

/*
 * Element references by path (issue #20). A reference is an element id, or:
 *
 *   Model/Shop/Order          owners from the project down, "/" between steps
 *   Shop/Order, Order         the trailing steps of a path, when one element ends so
 *   Order.total               "." steps into a member: attribute, literal, column, slot, parameter
 *   Order#pay(), Order#pay    "#" steps into an operation; "(int, String)" picks an overload
 *   /Model/Shop               a leading "/" accepts only the path from the project
 *   Order@Main                the view of Order on the diagram Main (any reference on each side)
 *   @current, @project        the diagram open in the editor; the project
 *
 * "\" escapes any of / . # @ ( ) , \ inside a name. Ids win over paths, so a
 * name that is also an id names that element. pathOf writes the canonical
 * form, which resolves back to the same element whenever the names along it
 * are unique among their siblings.
 */

/** Owner fields whose items a path enters with "." rather than "/". */
const MEMBER_FIELDS = [
  "attributes",
  "literals",
  "columns",
  "slots",
  "parameters",
];
const OPERATION_FIELDS = ["operations", "receptions"];

const SPECIAL = /[\\/.#@(),]/g;

export type Separator = "/" | "." | "#";

export interface Step {
  sep: Separator;
  name: string;
  /** Parameter types of an operation step written with parentheses. */
  params?: string[];
}

export interface ParsedPath {
  absolute: boolean;
  steps: Step[];
}

export function escapeName(name: string): string {
  return name.replace(SPECIAL, (c) => `\\${c}`);
}

/**
 * Splits a path into steps. Total: any string parses, and one that names
 * nothing simply matches no element. With `dots` false a "." is part of the
 * name, the reading tried when a name such as "java.util" matches nothing
 * as members.
 */
export function parsePath(text: string, dots = true): ParsedPath {
  const steps: Step[] = [];
  let step: Step = { sep: "/", name: "" };
  let absolute = false;
  let i = 0;
  if (text.startsWith("/")) {
    absolute = true;
    i = 1;
  }
  const next = (sep: Separator) => {
    steps.push(step);
    step = { sep, name: "" };
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length) {
      step.name += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "/") next("/");
    else if (c === "#") next("#");
    else if (c === "." && dots) next(".");
    else if (c === "(" && step.sep === "#" && step.params === undefined) {
      const [params, end] = readParams(text, i + 1);
      step.params = params;
      i = end;
    } else step.name += c;
    i++;
  }
  steps.push(step);
  return { absolute, steps };
}

/** The comma-separated types up to the closing parenthesis, and its index. */
function readParams(text: string, from: number): [string[], number] {
  const params: string[] = [];
  let current = "";
  let i = from;
  for (; i < text.length && text[i] !== ")"; i++) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length) {
      current += text[++i];
    } else if (c === ",") {
      params.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim() !== "" || params.length > 0) params.push(current.trim());
  return [params, i];
}

/** The member or operation list of its owner that holds `elem`; callers check it has one. */
function fieldOf(elem: Element): string | null {
  const owner = elem._parent!;
  for (const field of [...MEMBER_FIELDS, ...OPERATION_FIELDS]) {
    const list = owner[field];
    if (Array.isArray(list) && list.includes(elem)) return field;
  }
  return null;
}

const isView = (elem: Element) => elem instanceof type.View;

/** A type as a path or a signature writes it: a classifier's name, or the text. */
function typeName(value: unknown): string {
  if (value && typeof value === "object") {
    return String((value as Element).name ?? "");
  }
  return typeof value === "string" ? value : "";
}

/**
 * Parameter types of an operation or reception, without the return
 * parameter; both are UMLBehavioralFeatures, which own `parameters`.
 */
function parameterTypes(op: Element): string[] {
  return (op.parameters as Element[])
    .filter((p) => p.direction !== "return")
    .map((p) => typeName(p.type));
}

/**
 * The canonical path of an element, or null for what a path cannot name:
 * the project, and views showing no model. A view is its model's path and
 * its diagram's, joined by "@".
 */
export function pathOf(elem: Element): string | null {
  if (isView(elem)) {
    const view = elem as View;
    const model = view.model;
    const diagram = diagramOf(view);
    if (!model || !diagram) return null;
    const modelPath = pathOf(model);
    const diagramPath = pathOf(diagram);
    return modelPath === null || diagramPath === null
      ? null
      : `${modelPath}@${diagramPath}`;
  }
  const parts: string[] = [];
  for (
    let e: Element | null | undefined = elem;
    e && e._parent;
    e = e._parent
  ) {
    const field = fieldOf(e);
    const name = escapeName(typeof e.name === "string" ? e.name : "");
    if (field && OPERATION_FIELDS.includes(field)) {
      parts.unshift(
        `#${name}(${parameterTypes(e).map(escapeName).join(", ")})`,
      );
    } else if (field) {
      parts.unshift(`.${name}`);
    } else {
      parts.unshift(`/${name}`);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("").slice(1);
}

function diagramOf(view: Element): Element | null {
  let e: Element | null | undefined = view;
  while (e && !(e instanceof type.Diagram)) e = e._parent;
  return e ?? null;
}

/** Whether `elem` can be the element a step names, given how the step is entered. */
function stepMatches(elem: Element, step: Step): boolean {
  if ((elem.name ?? "") !== step.name) return false;
  const field = fieldOf(elem);
  if (step.sep === "#") {
    if (!field || !OPERATION_FIELDS.includes(field)) return false;
    return (
      step.params === undefined || sameTypes(parameterTypes(elem), step.params)
    );
  }
  if (step.sep === ".") return field !== null && MEMBER_FIELDS.includes(field);
  return true;
}

const sameTypes = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Elements matching a parsed path, by the last step's name and then up
 * through their owners. A match reaching the project is exact; when there
 * are exact matches, suffix matches are dropped. An operation step with
 * parameter types that fits no overload falls back to the name alone.
 */
function matchPath(
  parsed: ParsedPath,
  candidates: (name: string) => Element[],
): Element[] {
  const { steps } = parsed;
  const exact: Element[] = [];
  const suffix: Element[] = [];
  for (const elem of candidates(steps.at(-1)!.name)) {
    let e: Element | null | undefined = elem;
    let ok = true;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (!e || !e._parent || !stepMatches(e, steps[i]!)) {
        ok = false;
        break;
      }
      e = e._parent;
    }
    if (!ok) continue;
    if (!e!._parent) exact.push(elem);
    else if (!parsed.absolute) suffix.push(elem);
  }
  const found = exact.length > 0 ? exact : suffix;
  const last = steps.at(-1)!;
  if (found.length === 0 && last.sep === "#" && last.params !== undefined) {
    return matchPath(
      {
        ...parsed,
        steps: [...steps.slice(0, -1), { ...last, params: undefined }],
      },
      candidates,
    );
  }
  return found;
}

/** Non-view elements by name, built once per resolution. */
function nameIndex(): (name: string) => Element[] {
  let index: Map<string, Element[]> | null = null;
  return (name) => {
    if (!index) {
      index = new Map();
      for (const elem of Object.values(app.repository.getIdMap())) {
        if (isView(elem)) continue;
        const key = typeof elem.name === "string" ? elem.name : "";
        const list = index.get(key);
        if (list) list.push(elem);
        else index.set(key, [elem]);
      }
    }
    return index.get(name) ?? [];
  };
}

/**
 * The element with this id. Repository.get reads a plain object
 * (core/repository.js keeps _idMap as {}), so "toString" or "constructor"
 * would otherwise come back as Object.prototype's members.
 */
export function byId(id: string): Element | undefined {
  const elem = app.repository.get(id);
  return elem?._id === id ? elem : undefined;
}

/** Elements a reference could mean, before the kind filter. */
function lookupAll(ref: string): Element[] {
  const found = byId(ref);
  if (found) return [found];
  if (ref === "@current") {
    const current = app.diagrams.getCurrentDiagram();
    return current ? [current] : [];
  }
  if (ref === "@project") {
    const project = app.project.getProject();
    return project ? [project] : [];
  }
  const at = splitAt(ref);
  if (at) {
    const diagrams = lookupAll(at[1]).filter((d) => d instanceof type.Diagram);
    const views = lookupAll(at[0]).flatMap((m) =>
      viewsOf(m).filter((v) => diagrams.includes(diagramOf(v)!)),
    );
    if (views.length > 0) return views;
  }
  const index = nameIndex();
  const strict = matchPath(parsePath(ref), index);
  return strict.length > 0 || !ref.includes(".")
    ? strict
    : matchPath(parsePath(ref, false), index);
}

/**
 * The views drawing `model` as a whole. Repository.getViewsOf also answers
 * the sub-views showing the same model, such as a class view's name and
 * attribute compartments (their _parent is the class view, core/core.js).
 */
function viewsOf(model: Element): View[] {
  return app.repository
    .getViewsOf(model)
    .filter((v) => !(v._parent instanceof type.View));
}

/**
 * "model@diagram" at the first unescaped "@" after the start; the diagram
 * side may itself be "@current".
 */
function splitAt(ref: string): [string, string] | null {
  for (let i = 1; i < ref.length; i++) {
    if (ref[i] === "\\") i++;
    else if (ref[i] === "@") return [ref.slice(0, i), ref.slice(i + 1)];
  }
  return null;
}

export type RefKind = "element" | "diagram" | "view";

export interface ResolveOptions {
  /** What the field takes; default any element. */
  kind?: RefKind;
  /** Names the request field in messages, e.g. "Parent". */
  role?: string;
  /** For a view: the diagram whose view of a named model is meant. */
  diagram?: Element;
}

/** At most this many candidates are listed with AMBIGUOUS_REF. */
export const MAX_CANDIDATES = 20;

export interface Candidate {
  _id: string;
  _type: string;
  path: string | null;
}

/**
 * The one element `ref` names, as an id or a path; NOT_FOUND when nothing
 * fits the kind and AMBIGUOUS_REF, with the candidates, when several do. A
 * model where a view is expected stands for its view on `diagram`, or its
 * only view.
 */
export function resolveRef(ref: string, options: ResolveOptions = {}): Element {
  const kind = options.kind ?? "element";
  const role =
    options.role ??
    { element: "Element", diagram: "Diagram", view: "View" }[kind];
  let found = lookupAll(ref);
  if (kind === "diagram") {
    found = found.filter((e) => e instanceof type.Diagram);
  } else if (kind === "view") {
    found = unique(
      found.flatMap((e) =>
        isView(e)
          ? [e]
          : viewsOf(e).filter(
              (v) => !options.diagram || diagramOf(v) === options.diagram,
            ),
      ),
    );
  }
  if (found.length === 1) return found[0]!;
  if (found.length === 0) {
    throw new ApiError("NOT_FOUND", `${role} not found: ${ref}`);
  }
  throw new ApiError(
    "AMBIGUOUS_REF",
    `${role} ${ref} names ${found.length} elements; pass one of their ids or a longer path`,
    { candidates: found.slice(0, MAX_CANDIDATES).map(candidate) },
  );
}

/** resolveRef, or null where it would answer NOT_FOUND. */
export function tryResolve(
  ref: string,
  options: ResolveOptions = {},
): Element | null {
  try {
    return resolveRef(ref, options);
  } catch (err) {
    if (err instanceof ApiError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

const unique = <T>(list: T[]) => [...new Set(list)];

export function candidate(elem: Element): Candidate {
  return {
    _id: elem._id,
    _type: elem.constructor.name,
    path: pathOf(elem),
  };
}
