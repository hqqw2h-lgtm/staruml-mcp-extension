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

import { DIAGRAM_TYPES, type Kind } from "../build/spec.js";
import { edgePoints } from "../handlers/lint.js";
import type { Element, View } from "../types.js";
import type { GEdge, GNode, Geometry } from "./metric.js";

/*
 * A diagram's views as the metric reads them: node boxes (NodeView keeps
 * left, top, width and height as numbers, core/core.js) and edge polylines.
 */

/**
 * Views that stand for an area rather than a thing: they hold other views
 * or span them by design, so overlapping them is not a defect (the same
 * set /lint_diagram skips).
 */
export const AREA =
  /Frame|Subject|Swimlane|Partition|CombinedFragment|Operand|Region|Boundary|Lane|Pool/;
/** Messages run across every lifeline between their ends. */
const THROUGH = /Lifeline/;

/** Node views drawn on their own: visible, not the diagram's frame. */
export function nodeViews(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) =>
      v instanceof type.NodeView &&
      v.visible !== false &&
      !(v.model instanceof type.Diagram),
  );
}

export function edgeViewsOf(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) =>
      v instanceof type.EdgeView &&
      v.visible !== false &&
      v.tail !== null &&
      v.head !== null,
  );
}

/**
 * The listed view `view` is drawn in: up its container chain, through
 * sub-views such as a composite state's region, which are not listed.
 */
function holderOf(view: View, listed: ReadonlySet<View>): View | null {
  let v: View | null | undefined = (view.containerView as View | null) ?? null;
  while (v && !listed.has(v)) {
    v = ((v.containerView as View | null) ?? (v._parent as View)) || null;
    if (v && !(v instanceof type.View)) return null;
  }
  return v ?? null;
}

/** The node view an edge end belongs to: a lifeline's line part counts as its lifeline. */
export function ownerNode(view: View): View {
  let v = view;
  while (v._parent instanceof type.View) {
    v = v._parent as View;
  }
  return v;
}

export const box = (v: View) =>
  v as unknown as { left: number; top: number; width: number; height: number };

/** The labels an edge prints beside it (EdgeView sub-views, core/core.js and uml/elements.js in 7.1.1). */
const LABELS = [
  "nameLabel",
  "stereotypeLabel",
  "tailRoleNameLabel",
  "headRoleNameLabel",
  "tailMultiplicityLabel",
  "headMultiplicityLabel",
] as const;

const boxNode = (v: View, fields: Omit<GNode, keyof Box | "id">): GNode => {
  const b = box(v);
  return {
    id: v._id,
    left: b.left,
    top: b.top,
    width: b.width,
    height: b.height,
    ...fields,
  };
};

type Box = { left: number; top: number; width: number; height: number };

const drawn = (v: View | null | undefined): v is View => {
  if (!v || v.visible === false) return false;
  const b = box(v);
  return b.width > 0 && b.height > 0;
};

export function geometryOf(diagram: Element): Geometry {
  const views = nodeViews(diagram);
  const listed = new Set(views);
  const nodes: GNode[] = views.map((v) => {
    const kind = v.constructor.name;
    const container = holderOf(v, listed);
    return boxNode(v, {
      area: AREA.test(kind),
      through: THROUGH.test(kind),
      parent: container ? container._id : null,
    });
  });
  const frame = (diagram.ownedViews as View[]).find(
    (v) => v.model === diagram && v instanceof type.NodeView && drawn(v),
  );
  // The diagram's own frame holds everything: an area like a boundary.
  if (frame)
    nodes.push(boxNode(frame, { area: true, through: false, parent: null }));
  // An operand's top is the divider a reader takes for "else"; a message
  // label it cuts reads as belonging to either branch.
  for (const f of views.filter(
    (v) => v instanceof type.UMLCombinedFragmentView,
  )) {
    const operands = ((f.operandCompartment as View | undefined)?.subViews ??
      []) as View[];
    for (const o of operands.filter(drawn)) {
      nodes.push(boxNode(o, { area: true, through: false, parent: f._id }));
    }
  }
  const edgeViews = edgeViewsOf(diagram);
  const edges: GEdge[] = edgeViews.map((e) => ({
    id: e._id,
    points: edgePoints(e),
    ends: [ownerNode(e.tail as View)._id, ownerNode(e.head as View)._id],
  }));
  edgeViews.forEach((e, i) => {
    const ends = edges[i]!.ends;
    // A transition's name, a dependency's stereotype, an association's
    // role and multiplicity sit beside their edge (EdgeLabelView); one on
    // a box or another label hides text.
    for (const field of LABELS) {
      const label = e[field] as View | null | undefined;
      if (!drawn(label) || !String(label.text ?? "")) continue;
      nodes.push(
        boxNode(label, {
          area: false,
          through: false,
          label: true,
          parent: null,
          attachedTo: ends,
          edge: e._id,
        }),
      );
    }
    // A message's activation bar covers its lifeline; a label under it is
    // hidden, the bars of one lifeline stack by design.
    const activation = e.activation as View | null | undefined;
    if (drawn(activation)) {
      nodes.push(
        boxNode(activation, {
          area: false,
          through: false,
          label: true,
          parent: null,
          attachedTo: ends,
          group: ends[1],
        }),
      );
    }
  });
  const selected = (diagram.selectedViews as View[] | undefined)?.length ?? 0;
  return { nodes, edges, ...(selected > 0 && { selected }) };
}

const KINDS_BY_TYPE = new Map<string, Kind>(
  (Object.entries(DIAGRAM_TYPES) as [Kind, string][]).map(([k, t]) => [t, k]),
);

/** The /build_diagram kind of a diagram, or null for a kind it does not build. */
export const kindOf = (diagram: Element): Kind | null =>
  KINDS_BY_TYPE.get(diagram.constructor.name) ?? null;
