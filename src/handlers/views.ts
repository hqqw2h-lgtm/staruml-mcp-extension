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
import { requireDiagram, requireView } from "../lookup.js";
import { elementSchema, id, projectionShape } from "../schemas.js";
import { serialize, type Projection } from "../serialize.js";
import type { Element, View } from "../types.js";

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
    "View ids, all on one diagram.",
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

export const layoutDiagram = defineEndpoint({
  path: "/layout_diagram",
  description:
    "Arrange a diagram's node views automatically (Format > Layout in the UI), as one undoable operation. Opens the diagram in the editor.",
  readOnly: false,
  destructive: false,
  request: z.object({
    id: z.optional(id("Diagram id; default the current diagram.")),
    direction: z.optional(
      doc(
        z.enum(LAYOUT_DIRECTIONS),
        "Rank direction: TB top to bottom (default), BT, LR, RL.",
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
    edgeLineStyle: z.optional(
      lineStyle("Line style applied to edges by the layout."),
    ),
  }),
  response: z.object({ _id: z.string(), direction: z.string() }),
  handle: (input) => {
    const diagram =
      input.id === undefined
        ? app.diagrams.getCurrentDiagram()
        : requireDiagram(input.id);
    if (!diagram) {
      throw new ApiError("NOT_FOUND", "No diagram is open; pass 'id'");
    }
    const direction = input.direction ?? "TB";
    const editor = editorShowing(diagram);
    inStarUML(() =>
      app.engine.layoutDiagram(
        editor,
        diagram,
        direction,
        input.separations,
        input.edgeLineStyle === undefined
          ? undefined
          : LINE_STYLES[input.edgeLineStyle],
      ),
    );
    return { _id: diagram._id, direction };
  },
});

export const moveViews = defineEndpoint({
  path: "/move_views",
  description:
    "Move views by an offset, carrying contained views and connected edges along, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ids: viewIds(),
    dx: doc(z.number(), "Horizontal offset in diagram units."),
    dy: doc(z.number(), "Vertical offset in diagram units."),
    ...projectionShape(),
  }),
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
    const editor = editorShowing(diagram);
    inStarUML(() => app.engine.moveViews(editor, views, input.dx, input.dy));
    return viewsResponse(diagram, views, projectionOr(input, GEOMETRY));
  },
});

export const resizeNode = defineEndpoint({
  path: "/resize_node",
  description:
    "Set a node view's bounds; omitted values keep the current ones. Connected edges follow, as one undoable operation.",
  readOnly: false,
  destructive: false,
  request: z.object({
    id: id("Node view id."),
    left: z.optional(doc(z.number(), "Left edge in diagram units.")),
    top: z.optional(doc(z.number(), "Top edge in diagram units.")),
    width: z.optional(doc(z.number().check(z.positive()), "Width.")),
    height: z.optional(doc(z.number().check(z.positive()), "Height.")),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const node = requireView(input.id);
    if (!(node instanceof type.NodeView)) {
      throw new ApiError("NOT_FOUND", `Node view not found: ${input.id}`);
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
    ids: viewIds(),
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
  response: viewsResult(),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
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
    ids: viewIds(),
    position: doc(z.enum(["front", "back"]), "Where to move the views."),
  }),
  response: z.object({
    diagram: z.string(),
    order: doc(
      z.array(z.string()),
      "The diagram's top-level view ids, back to front, after the change.",
    ),
  }),
  handle: (input) => {
    const { views, diagram } = requireViewsOnOneDiagram(input.ids);
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
