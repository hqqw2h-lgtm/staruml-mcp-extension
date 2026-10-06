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

import { formatAttribute, formatOperation } from "../build/members.js";
import {
  FAMILIES,
  type Family,
  type FamilyKind,
  type NodeType,
} from "../build/families.js";
import { edgeViews, list, nodeViews } from "../handlers/describe.js";
import { modelTypeOf } from "../handlers/elements.js";
import { resolveCreateType } from "../toolbox.js";
import type { Element, View } from "../types.js";

/*
 * Reads a diagram of a family kind back into its /build_diagram spec, the
 * one grammar every family shares (build/families.ts). No Mermaid or
 * PlantUML diagram holds these notations, so the spec itself, as JSON, is
 * their text form: built again it gives the same nodes, nesting and edges.
 */

export interface FamilyNodeOut {
  name: string;
  id?: string;
  type: string;
  in?: string;
  stereotype?: string;
  properties?: Record<string, unknown>;
  attributes?: string[];
  operations?: string[];
  slots?: string[];
  width?: number;
}

export interface FamilyEdgeOut {
  from: string;
  to: string;
  type: string;
  name?: string;
}

export interface FamilySpecOut {
  block?: string;
  nodes: FamilyNodeOut[];
  edges: FamilyEdgeOut[];
}

/**
 * Model attributes a family node carries beyond its name: the icon of a
 * cloud element, a wireframe control's state, a zone's or path's kind
 * (each extension's metamodel.json in 7.1.1). Written back when set.
 */
const KEPT = [
  "icon",
  "checked",
  "dashed",
  "rounded",
  "zoneType",
  "pathType",
  "product",
  "orientation",
  "position",
];

const typeName = (e: Element) => e.constructor.name;

/** The model class a node type's create id makes. */
function modelOf(t: NodeType): string | null {
  return t.match?.model ?? modelTypeOf(resolveCreateType(t.create).id);
}

/** Whether `view` is one of node type `t`. */
function matches(t: NodeType, view: View): boolean {
  const m = view.model!;
  if (typeName(m) !== modelOf(t)) return false;
  if (t.match?.view && typeName(view) !== t.match.view) return false;
  if (t.match?.field) {
    return list(m._parent?.[t.match.field]).includes(m);
  }
  return true;
}

const stereotypeOf = (m: Element): string | undefined =>
  typeof m.stereotype === "string" && m.stereotype
    ? m.stereotype
    : m.stereotype && typeof m.stereotype === "object"
      ? String((m.stereotype as Element).name)
      : undefined;

/** The edge type keyword of a relationship, its ends' settings considered. */
function edgeKeyword(f: Family, m: Element): string | undefined {
  const t = typeName(m);
  const candidates = Object.entries(f.edges)
    .filter(([, create]) => modelTypeOf(resolveCreateType(create).id) === t)
    .map(([k]) => k);
  if (candidates.length <= 1) return candidates[0];
  // UMLAssociation and UMLLink: the toolbox items differ in their ends.
  const e1 = m.end1 as Element;
  const e2 = m.end2 as Element;
  const wanted =
    e2.aggregation === "composite"
      ? "composition"
      : e2.aggregation === "shared"
        ? "aggregation"
        : e2.navigable === "navigable" && e1.navigable !== "navigable"
          ? t === "UMLLink"
            ? "directedLink"
            : "directed"
          : t === "UMLLink"
            ? "link"
            : "association";
  return candidates.includes(wanted) ? wanted : candidates[0];
}

/**
 * A classifier's attributes and operations as text; a part or port drawn
 * as a node of its own is written as that node, not again here.
 */
function members(m: Element, nodes: ReadonlyMap<Element, string>) {
  const attributes = list(m.attributes).filter((a) => !nodes.has(a));
  const operations = list(m.operations);
  return {
    ...(attributes.length > 0 && {
      attributes: attributes.map((a) => formatAttribute(a)),
    }),
    ...(operations.length > 0 && {
      operations: operations.map((o) => formatOperation(o)),
    }),
  };
}

/** `diagram` as the spec of family `kind`, with what it leaves out. */
export function extractFamily(
  diagram: Element,
  kind: FamilyKind,
): { spec: FamilySpecOut; warnings: string[] } {
  const f: Family = FAMILIES[kind];
  const skipped = new Map<string, number>();
  const skip = (what: string) =>
    skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const types = Object.entries(f.nodes);
  const nodes: { view: View; key: string; type: string; t: NodeType }[] = [];
  const riding: View[] = [];
  for (const view of nodeViews(diagram)) {
    const found = types.find(([, t]) => matches(t, view));
    if (found) {
      nodes.push({ view, key: "", type: found[0], t: found[1] });
    } else if (f.riding && typeName(view.model!) === "UMLMessage") {
      riding.push(view);
    } else {
      skip(typeName(view.model!));
    }
  }
  // Names are the keys; a name repeated gets an id, its name and a
  // number, and an unnamed node (an initial node) its type's.
  const seen = new Map<string, number>();
  for (const n of nodes) {
    const name = String(n.view.model!.name) || n.type;
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    n.key = k === 1 ? name : `${name}#${k}`;
  }
  const keyOfView = new Map(nodes.map((n) => [n.view, n.key]));
  const keyOfModel = new Map(nodes.map((n) => [n.view.model!, n.key]));
  const out: FamilyNodeOut[] = nodes.map(({ view, key, type, t }) => {
    const m = view.model!;
    const name = String(m.name);
    const container = view.containerView as View | null | undefined;
    const into = container ? keyOfView.get(container) : undefined;
    // Only plain values: UMLStereotype.icon, say, is an image element.
    const properties = Object.fromEntries(
      KEPT.filter(
        (p) =>
          ["string", "number", "boolean"].includes(typeof m[p]) &&
          m[p] !== "" &&
          m[p] !== false,
      ).map((p) => [p, m[p]]),
    );
    const stereotype = stereotypeOf(m);
    return {
      name,
      ...(key !== name && { id: key }),
      type,
      ...(into !== undefined && { in: into }),
      ...(stereotype !== undefined && { stereotype }),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(t.members && members(m, keyOfModel)),
      ...(t.slots &&
        list(m.slots).length > 0 && {
          slots: list(m.slots).map(
            (s) => `${String(s.name)} = ${String(s.value)}`,
          ),
        }),
      ...(t.keepWidth && { width: Math.round(view.width as number) }),
    };
  });
  const edges: FamilyEdgeOut[] = [];
  for (const view of edgeViews(diagram)) {
    const m = view.model!;
    const keyword = edgeKeyword(f, m);
    const from = keyOfModel.get((view.tail as View).model!);
    const to = keyOfModel.get((view.head as View).model!);
    if (keyword === undefined || from === undefined || to === undefined) {
      skip(typeName(m));
      continue;
    }
    // A connector a message rides is written by the message.
    if (
      f.riding &&
      keyword === f.riding.along &&
      riding.some((r) => (r.model as Element).connector === m) &&
      !m.name
    ) {
      continue;
    }
    const whole = f.wholeFirst?.includes(keyword) === true;
    edges.push({
      from: whole ? to : from,
      to: whole ? from : to,
      type: keyword,
      ...(m.name ? { name: String(m.name) } : {}),
    });
  }
  for (const view of riding) {
    const m = view.model!;
    const from = keyOfModel.get(m.source as Element);
    const to = keyOfModel.get(m.target as Element);
    if (from === undefined || to === undefined) {
      skip("UMLMessage");
      continue;
    }
    edges.push({
      from,
      to,
      type: f.riding!.type,
      ...(m.name ? { name: String(m.name) } : {}),
    });
  }
  return {
    spec: {
      ...(f.owner && { block: String(diagram._parent!.name) }),
      nodes: out,
      edges,
    },
    warnings: [...skipped].map(
      ([t, n]) => `${n} ${t} ${n === 1 ? "view is" : "views are"} not written`,
    ),
  };
}
