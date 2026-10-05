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
import { diagramOf } from "../create.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireElement, requireView } from "../lookup.js";
import { elementSchema, projectionShape, ref } from "../schemas.js";
import { serialize, type Projection } from "../serialize.js";
import type { Element, View } from "../types.js";
import { created, createdSchema } from "./elements.js";

/** EdgeView.LS_* in core/core.js (7.1.1). */
export const LINE_STYLES = {
  rectilinear: 0,
  oblique: 1,
  roundrect: 2,
  curve: 3,
} as const;

/** UMLGeneralNodeView.SD_* in core/core.js (7.1.1). */
export const STEREOTYPE_DISPLAYS = [
  "none",
  "label",
  "decoration",
  "decoration-label",
  "icon",
  "icon-label",
] as const;

/** Diagram.LD_* in core/core.js (7.1.1): dagre's rankdir. */
export const LAYOUT_DIRECTIONS = ["TB", "BT", "LR", "RL"] as const;

const lineStyle = (description: string) =>
  doc(
    z.enum(Object.keys(LINE_STYLES) as [keyof typeof LINE_STYLES]),
    description,
  );

/** The CSS hex forms StarUML's own colour pickers write. */
const color = (description: string) =>
  z.optional(
    doc(
      z.string().check(z.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)),
      description,
    ),
  );

const viewIds = () =>
  doc(
    z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
    "Views, all on one diagram, by id or path; a model stands for its only view.",
  );

/**
 * Resolves view ids that must share a diagram, because the engine's view
 * edits work through the editor showing that diagram.
 */
export function requireViewsOnOneDiagram(ids: readonly string[]): {
  views: View[];
  diagram: Element;
} {
  const views = ids.map((i) => requireView(i));
  const diagram = diagramOf(views[0]!)!;
  const stray = views.find((v) => diagramOf(v) !== diagram);
  if (stray) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `View ${stray._id} is not on diagram ${diagram._id} like ${views[0]!._id}`,
    );
  }
  return { views, diagram };
}

/**
 * The diagram editor, showing `diagram`. Engine.moveViews and resizeNode
 * traverse editor.diagram to move connected edges, and layoutDiagram repaints
 * it, so the diagram is made current first, as it is when a user edits it.
 */
export function editorShowing(diagram: Element): unknown {
  if (app.diagrams.getCurrentDiagram() !== diagram) {
    inStarUML(() => app.diagrams.setCurrentDiagram(diagram));
  }
  return app.diagrams.getEditor();
}

const viewsResult = () =>
  z.object({
    diagram: doc(z.string(), "Id of the diagram the views are on."),
    views: z.array(elementSchema()),
  });

/**
 * The caller's projection, or `fields` when the caller asked for none, so a
 * view edit answers with the attributes it changed by default.
 */
export function projectionOr(input: Projection, fields: readonly string[]) {
  return input.fields !== undefined || input.summary !== undefined
    ? input
    : { ...input, fields };
}

function viewsResponse(
  diagram: Element,
  views: View[],
  projection: Projection,
) {
  return {
    diagram: diagram._id,
    views: views.map((v) => serialize(v, projection)),
  };
}

const GEOMETRY = ["left", "top", "width", "height"];

/** NODE_SEPARATION, EDGE_SEPARATION, RANK_SEPARATION in core/core.js (7.1.1). */
export const DEFAULT_SEPARATIONS = { node: 30, edge: 30, rank: 30 } as const;

type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];

interface LayoutPreset {
  direction: LayoutDirection;
  separations: { node: number; edge: number; rank: number };
  edgeLineStyle: keyof typeof LINE_STYLES;
}

/*
 * Diagram.layout hands each edge to dagre as head -> tail
 * (g.setEdge(v.head._id, v.tail._id), core/core.js in 7.1.1), so dagre's
 * ranks run from heads to tails and "TB" puts an edge's head above its tail.
 * That suits a class hierarchy, where generalizations point at the parent,
 * and draws a flow upside down (issue #12). The flow presets therefore ask
 * dagre for the opposite rank direction, so an edge's tail comes first.
 */
const flow = (direction: LayoutDirection): LayoutPreset => ({
  direction,
  separations: { node: 40, edge: 20, rank: 50 },
  edgeLineStyle: "rectilinear",
});
const hierarchy = (direction: LayoutDirection): LayoutPreset => ({
  direction,
  separations: { node: 50, edge: 20, rank: 70 },
  edgeLineStyle: "rectilinear",
});

export const LAYOUT_PRESETS = {
  "flow-down": flow("BT"),
  "flow-up": flow("TB"),
  "flow-right": flow("RL"),
  "flow-left": flow("LR"),
  "hierarchy-down": hierarchy("TB"),
  "hierarchy-up": hierarchy("BT"),
  "hierarchy-right": hierarchy("LR"),
  "hierarchy-left": hierarchy("RL"),
} as const satisfies Record<string, LayoutPreset>;

export type LayoutPresetName = keyof typeof LAYOUT_PRESETS;

export const PRESET_NAMES = Object.keys(LAYOUT_PRESETS) as [
  LayoutPresetName,
  ...LayoutPresetName[],
];

const separation = (description: string) =>
  z.optional(doc(z.number().check(z.minimum(0)), description));

function isNode(view: Element): view is View {
  return view instanceof type.NodeView;
}

/**
 * Shrinks or grows each top-level node view to the size its content needs,
 * which is what View.sizeConstraints does for an autoResize view (core/core.js
 * in 7.1.1); minWidth and minHeight are computed on every repaint. Views that
 * contain other views keep their size, since their minimum ignores children.
 * Answers how many views changed size.
 */
export function fitNodeViews(diagram: Element): number {
  const changes: [View, number, number][] = [];
  for (const view of diagram.ownedViews as Element[]) {
    if (!isNode(view)) continue;
    const { minWidth, minHeight, width, height } = view as unknown as Record<
      string,
      number
    >;
    const contained = view.containedViews as unknown[];
    if (!(minWidth! > 0 && minHeight! > 0) || contained.length > 0) {
      continue;
    }
    if (minWidth !== width || minHeight !== height) {
      changes.push([view, minWidth!, minHeight!]);
    }
  }
  if (changes.length === 0) return 0;
  const builder = app.repository.getOperationBuilder();
  builder.begin("fit views");
  for (const [view, w, h] of changes) {
    builder.fieldAssign(view, "width", w);
    builder.fieldAssign(view, "height", h);
  }
  builder.end();
  inStarUML(() => app.repository.doOperation(builder.getOperation()));
  return changes.length;
}

function diagramOrCurrent(given: string | undefined, field: string): Element {
  const diagram =
    given === undefined
      ? app.diagrams.getCurrentDiagram()
      : requireDiagram(given);
  if (!diagram) {
    throw new ApiError("NOT_FOUND", `No diagram is open; pass '${field}'`);
  }
  return diagram;
}

export const layoutDiagram = defineEndpoint({
  path: "/layout_diagram",
  description:
    "Arrange a diagram's node views automatically (Format > Layout in the UI), as one undoable operation. A preset picks direction, spacing and edge style: flow-* put an edge's source before its target (flowcharts, activities, state machines), hierarchy-* put the target first (a superclass above its subclasses). fit first sizes node views to their content. Opens the diagram in the editor.",
  readOnly: false,
  destructive: false,
  request: z.object({
    diagram: z.optional(ref("Diagram; default the current diagram.")),
    preset: z.optional(
      doc(
        z.enum(PRESET_NAMES),
        "flow-down|up|right|left: edges run from source to target in that direction. hierarchy-down|up|right|left: edge targets come first. Other fields override the preset's values.",
      ),
    ),
    direction: z.optional(
      doc(
        z.enum(LAYOUT_DIRECTIONS),
        "dagre's rank direction as StarUML passes it: TB (default) puts an edge's target above its source; BT, LR, RL accordingly.",
      ),
    ),
    separations: z.optional(
      doc(
        z.object({
          node: z.number().check(z.minimum(0)),
          edge: z.number().check(z.minimum(0)),
          rank: z.number().check(z.minimum(0)),
        }),
        "Spacing in diagram units between nodes, edges and ranks; StarUML's defaults when omitted.",
      ),
    ),
    nodeSeparation: separation(
      "Spacing between nodes of one rank, in diagram units.",
    ),
    rankSeparation: separation("Spacing between ranks, in diagram units."),
    edgeLineStyle: z.optional(
      lineStyle(
        "Line style applied to edges by the layout; StarUML's default is curve.",
      ),
    ),
    fit: z.optional(
      doc(
        z.boolean(),
        "Size node views to their content before the layout; one more undo step.",
      ),
    ),
  }),
  aliases: { id: "diagram", diagramId: "diagram" },
  response: z.object({
    _id: z.string(),
    direction: z.string(),
    preset: z.optional(z.string()),
    separations: z.optional(
      doc(
        z.object({ node: z.number(), edge: z.number(), rank: z.number() }),
        "Spacing passed to the layout, when the request set any.",
      ),
    ),
    edgeLineStyle: z.optional(z.string()),
    fitted: z.optional(doc(z.int(), "Node views resized by fit.")),
  }),
  handle: (input) => {
    const diagram = diagramOrCurrent(input.diagram, "diagram");
    const preset =
      input.preset === undefined ? undefined : LAYOUT_PRESETS[input.preset];
    const direction = input.direction ?? preset?.direction ?? "TB";
    // Diagram.layout tests `typeof separations.node !== undefined`, which is
    // always true, so a partial object would hand dagre undefined spacings.
    const custom =
      preset !== undefined ||
      input.separations !== undefined ||
      input.nodeSeparation !== undefined ||
      input.rankSeparation !== undefined;
    const base =
      input.separations ?? preset?.separations ?? DEFAULT_SEPARATIONS;
    const separations = custom
      ? {
          node: input.nodeSeparation ?? base.node,
          edge: base.edge,
          rank: input.rankSeparation ?? base.rank,
        }
      : undefined;
    const edgeLineStyle = input.edgeLineStyle ?? preset?.edgeLineStyle;
    const editor = editorShowing(diagram);
    const fitted = input.fit ? fitNodeViews(diagram) : undefined;
    inStarUML(() =>
      app.engine.layoutDiagram(
        editor,
        diagram,
        direction,
        separations,
        edgeLineStyle === undefined ? undefined : LINE_STYLES[edgeLineStyle],
      ),
    );
    return {
      _id: diagram._id,
      direction,
      ...(input.preset !== undefined && { preset: input.preset }),
      ...(separations && { separations }),
      ...(edgeLineStyle !== undefined && { edgeLineStyle }),
      ...(fitted !== undefined && { fitted }),
    };
  },
});

export const routeEdges = defineEndpoint({
  path: "/route_edges",
  description:
    "Give every edge view on a diagram one line style (Format > Line Style), as one undoable operation; rectilinear and rounded edges are re-routed around their ends. Opens the diagram in the editor.",
  readOnly: false,
  destructive: false,
  request: z.object({
    diagram: z.optional(ref("Diagram; default the current diagram.")),
    lineStyle: lineStyle("Line style for every edge."),
  }),
  aliases: { diagramId: "diagram" },
  response: z.object({
    diagram: z.string(),
    lineStyle: z.string(),
    edges: doc(z.int(), "Edge views given the style."),
  }),
  handle: (input) => {
    const diagram = diagramOrCurrent(input.diagram, "diagram");
    const edges = (diagram.ownedViews as View[]).filter(
      (v) => v instanceof type.EdgeView,
    );
    if (edges.length > 0) {
      const editor = editorShowing(diagram);
      inStarUML(() =>
        app.engine.setLineStyle(editor, edges, LINE_STYLES[input.lineStyle]),
      );
    }
    return {
      diagram: diagram._id,
      lineStyle: input.lineStyle,
      edges: edges.length,
    };
  },
});

export const moveViews = defineEndpoint({
  path: "/move_views",
  description:
    "Move views by an offset, carrying contained views and connected edges along, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    refs: viewIds(),
    dx: doc(z.number(), "Horizontal offset in diagram units."),
    dy: doc(z.number(), "Vertical offset in diagram units."),
    container: z.optional(
      ref(
        "Also put the views inside this view and their models inside its model, as dropping them on it does: states in a composite state (its region), classes in a package.",
      ),
    ),
    ...projectionShape(),
  }),
  aliases: { ids: "refs", containerViewId: "container" },
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.refs);
    const editor = editorShowing(diagram);
    if (input.container === undefined) {
      inStarUML(() => app.engine.moveViews(editor, views, input.dx, input.dy));
    } else {
      const container = requireView(input.container, "Container view", diagram);
      if (diagramOf(container) !== diagram) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `View ${container._id} is not on diagram ${diagram._id}`,
        );
      }
      // Compartments such as a composite state's regions get their views
      // when the diagram is drawn (UMLListCompartmentView.update).
      app.diagrams.repaint();
      const target = containerFor(container, views);
      if (!target) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${container.constructor.name} ${container._id} cannot contain ${[...new Set(views.map((v) => v.constructor.name))].join(", ")}`,
        );
      }
      inStarUML(() =>
        app.engine.moveViewsChangingContainer(
          editor,
          views,
          input.dx,
          input.dy,
          target,
          target.model,
        ),
      );
    }
    return viewsResponse(diagram, views, projectionOr(input, GEOMETRY));
  },
});

/**
 * `view`, or the first of its sub views depth first, that can contain every
 * one of `views`: a composite state holds states in its region's view.
 */
function containerFor(view: View, views: readonly View[]): View | null {
  if (views.every((v) => view.canContainView(v))) return view;
  for (const sub of view.subViews) {
    const found = containerFor(sub, views);
    if (found) return found;
  }
  return null;
}

function subViewsOf(view: View): View[] {
  return view.subViews.flatMap((v) => [v, ...subViewsOf(v)]);
}

export const divideFragment = defineEndpoint({
  path: "/divide_fragment",
  description:
    "Set where each operand of a combined fragment (alt, par, ...) begins, instead of the equal split StarUML gives operands, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ref: ref("Combined fragment view."),
    at: doc(
      z.array(z.number()).check(z.minLength(1)),
      "Diagram y of the top of each operand after the first, increasing, inside the fragment.",
    ),
    ...projectionShape(),
  }),
  aliases: { id: "ref" },
  response: viewsResult(),
  handle: (input) => {
    const view = requireView(input.ref);
    const diagram = diagramOf(view)!;
    editorShowing(diagram);
    // Operand views are made when the fragment is drawn, and drawing places
    // the first one below the operator tab.
    app.diagrams.repaint();
    const box = (v: View) => v as unknown as Record<string, number>;
    const operands = subViewsOf(view)
      .filter((v) => v instanceof type.UMLInteractionOperandView)
      .sort((a, b) => box(a).top! - box(b).top!);
    if (operands.length !== input.at.length + 1) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `at: ${view._id} has ${operands.length} operand views, so it takes ${Math.max(0, operands.length - 1)} boundaries`,
      );
    }
    const bottom = box(view).top! + box(view).height!;
    const tops = [box(operands[0]!).top!, ...input.at, bottom];
    if (tops.some((t, i) => i > 0 && t <= tops[i - 1]!)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `at: boundaries must increase from ${tops[0]} to below ${bottom}`,
      );
    }
    // UMLCombinedFragmentView stacks its operands by their heights and
    // stretches the last one to its bottom (_carryOnOperandViews).
    const builder = app.repository.getOperationBuilder();
    builder.begin("divide fragment");
    operands.forEach((v, i) =>
      builder.fieldAssign(v, "height", tops[i + 1]! - tops[i]!),
    );
    builder.end();
    inStarUML(() => app.repository.doOperation(builder.getOperation()));
    return viewsResponse(diagram, operands, projectionOr(input, GEOMETRY));
  },
});

export const resizeNode = defineEndpoint({
  path: "/resize_node",
  description:
    "Set a node view's bounds; omitted values keep the current ones. Connected edges follow, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ref: ref("Node view; a model stands for its only view."),
    left: z.optional(doc(z.number(), "Left edge in diagram units.")),
    top: z.optional(doc(z.number(), "Top edge in diagram units.")),
    width: z.optional(doc(z.number().check(z.positive()), "Width.")),
    height: z.optional(doc(z.number().check(z.positive()), "Height.")),
    ...projectionShape(),
  }),
  aliases: { id: "ref" },
  response: elementSchema(),
  handle: (input) => {
    const node = requireView(input.ref);
    if (!(node instanceof type.NodeView)) {
      throw new ApiError("NOT_FOUND", `Node view not found: ${input.ref}`);
    }
    const bounds = node as unknown as Record<(typeof GEOMETRY)[number], number>;
    const left = input.left ?? bounds.left!;
    const top = input.top ?? bounds.top!;
    const right = left + (input.width ?? bounds.width!);
    const bottom = top + (input.height ?? bounds.height!);
    const editor = editorShowing(diagramOf(node)!);
    inStarUML(() =>
      app.engine.resizeNode(editor, node, left, top, right, bottom),
    );
    return serialize(node, projectionOr(input, GEOMETRY));
  },
});

export const setViewStyle = defineEndpoint({
  path: "/set_view_style",
  description:
    "Change how views are drawn: colours, font, edge line style, stereotype display, auto-resize (the Format menu). Each given property is one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    refs: viewIds(),
    fillColor: color("Fill colour, CSS hex such as '#ffcc00'."),
    lineColor: color("Line colour."),
    fontColor: color("Text colour."),
    fontFace: z.optional(
      doc(z.string().check(z.minLength(1)), "Font family, e.g. 'Arial'."),
    ),
    fontSize: z.optional(
      doc(z.number().check(z.positive()), "Font size in points."),
    ),
    lineStyle: z.optional(lineStyle("Edge line style; edges only.")),
    stereotypeDisplay: z.optional(
      doc(
        z.enum(STEREOTYPE_DISPLAYS),
        "How a UML node view shows its stereotype.",
      ),
    ),
    autoResize: z.optional(
      doc(z.boolean(), "Grow node views to fit their content."),
    ),
    ...projectionShape(),
  }),
  aliases: { ids: "refs" },
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.refs);
    const editor = editorShowing(diagram);
    const e = app.engine;
    const changes: [keyof typeof input, () => unknown][] = [
      ["fillColor", () => e.setFillColor(editor, views, input.fillColor!)],
      ["lineColor", () => e.setLineColor(editor, views, input.lineColor!)],
      ["fontColor", () => e.setFontColor(editor, views, input.fontColor!)],
      ["fontFace", () => e.setFontFace(editor, views, input.fontFace!)],
      ["fontSize", () => e.setFontSize(editor, views, input.fontSize!)],
      [
        "lineStyle",
        () => e.setLineStyle(editor, views, LINE_STYLES[input.lineStyle!]),
      ],
      [
        "stereotypeDisplay",
        () => e.setStereotypeDisplay(editor, views, input.stereotypeDisplay!),
      ],
      ["autoResize", () => e.setAutoResize(editor, views, input.autoResize!)],
    ];
    const given = changes.filter(([key]) => input[key] !== undefined);
    if (given.length === 0) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `Pass at least one of ${changes.map(([key]) => key).join(", ")}`,
      );
    }
    for (const [, apply] of given) inStarUML(apply);
    // Font face and size are both stored in the custom `font` attribute.
    const fields = given.map(([key]) =>
      key === "fontFace" || key === "fontSize" ? "font" : key,
    );
    return viewsResponse(
      diagram,
      views,
      projectionOr(input, [...new Set(fields)]),
    );
  },
});

export const setZOrder = defineEndpoint({
  path: "/set_z_order",
  description:
    "Bring views to the front or send them to the back of their diagram, as one undoable operation. Views nested in another view keep their order.",
  readOnly: false,
  destructive: false,
  request: z.object({
    refs: viewIds(),
    position: doc(z.enum(["front", "back"]), "Where to move the views."),
  }),
  aliases: { ids: "refs" },
  response: z.object({
    diagram: z.string(),
    order: doc(
      z.array(z.string()),
      "The diagram's top-level view ids, back to front, after the change.",
    ),
  }),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.refs);
    // The alignment extension's bring-to-front/send-to-back reorder
    // diagram.ownedViews, which drawDiagram paints in order (7.1.1).
    const owned = diagram.ownedViews as Element[];
    const builder = app.repository.getOperationBuilder();
    builder.begin(
      input.position === "front" ? "bring to front" : "send to back",
    );
    const topLevel = views.filter((v) => v._parent === diagram);
    const ordered = input.position === "front" ? topLevel : topLevel.reverse();
    for (const view of ordered) {
      builder.fieldReorder(
        diagram,
        "ownedViews",
        view,
        input.position === "front" ? owned.length - 1 : 0,
      );
    }
    builder.end();
    inStarUML(() => app.repository.doOperation(builder.getOperation()));
    return { diagram: diagram._id, order: owned.map((v) => v._id) };
  },
});

/** The ends of a relationship, which must be shown before it can be. */
function endsOf(model: Element): Element[] {
  if (model instanceof type.DirectedRelationship) {
    return [model.source as Element, model.target as Element];
  }
  if (model instanceof type.UndirectedRelationship) {
    return [
      (model.end1 as Element).reference as Element,
      (model.end2 as Element).reference as Element,
    ];
  }
  return [];
}

export const createViewOf = defineEndpoint({
  path: "/create_view_of",
  description:
    "Show an existing model element on a diagram, as dragging it from the model explorer does: StarUML also draws its relationships to elements already shown there. An element already on the diagram answers its view unchanged; a relationship needs both ends shown.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ref: ref("Model element."),
    diagram: ref("Diagram to show it on."),
    x: z.optional(doc(z.number(), "Left edge, default 100.")),
    y: z.optional(doc(z.number(), "Top edge, default 100.")),
    ...projectionShape(),
  }),
  aliases: { modelId: "ref", diagramId: "diagram" },
  response: createdSchema(),
  handle: (input) => {
    const model = requireElement(input.ref, "Model");
    if (model instanceof type.View || model instanceof type.Diagram) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${input.ref} is a ${model.constructor.name}, not a model element`,
      );
    }
    const diagram = requireDiagram(input.diagram);
    const shown = (m: Element) =>
      (diagram.ownedViews as View[]).find((v) => v.model === m);
    const existing = shown(model);
    if (existing) return created(existing, input);
    for (const end of endsOf(model)) {
      if (!shown(end)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${end.constructor.name} ${end._id} at an end of ${input.ref} is not on the diagram; show it first`,
        );
      }
    }
    const editor = editorShowing(diagram);
    const view =
      inStarUML(() =>
        app.factory.createViewOf({
          model,
          diagram,
          x: input.x ?? 100,
          y: input.y ?? 100,
          editor,
        }),
      ) ?? shown(model);
    if (!view) {
      throw new ApiError(
        "STARUML_ERROR",
        `StarUML cannot show a ${model.constructor.name} on a ${diagram.constructor.name}`,
      );
    }
    return created(view, input);
  },
});
