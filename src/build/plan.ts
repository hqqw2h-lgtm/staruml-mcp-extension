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
import { doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import {
  type AttributeSpec,
  multiline,
  type OperationSpec,
} from "./members.js";
import type { Kind } from "./spec.js";

/*
 * What every /build_diagram kind plans with: the plan's nodes and edges,
 * the Builder that keys them, the schema parts every spec shares, and the
 * text measures that size nodes before StarUML draws them.
 */

export interface ColumnSpec {
  name: string;
  type?: string;
  length?: string;
  primaryKey?: boolean;
  foreignKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanNode {
  key: string;
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  /** Key of the node whose model owns this one's, e.g. a class's package. */
  owner?: string;
  attributes?: AttributeSpec[];
  operations?: OperationSpec[];
  literals?: string[];
  columns?: ColumnSpec[];
  /** Activity lane key; placement puts the node inside that lane. */
  lane?: string;
  /** Guard of a combined fragment's first operand. */
  guard?: string;
  /** Guards of a combined fragment's further operands. */
  operands?: string[];
  /**
   * Names of a combined fragment's operands, the first one included, so
   * StarUML's UML001 ("Name expected") holds for a generated interaction.
   */
  operandNames?: string[];
  /**
   * View attributes set with /update_element after the view is made, e.g.
   * an interface view's suppressOperations.
   */
  viewProperties?: Record<string, unknown>;
  /** /set_view_style options for the new view. */
  style?: Record<string, unknown>;
  /**
   * Key of the node whose view hosts this one's on its border, e.g. a
   * component's port: the view is made with that view as its container.
   */
  host?: string;
  /** Key of the node whose view contains this one's, e.g. a composite state. */
  container?: string;
  /** Text of a note, which is a view without a model. */
  text?: string;
  /** Diagram y where each operand after a fragment's first begins. */
  operandAt?: number[];
  width: number;
  height: number;
  /** Fixed geometry; otherwise placement decides. */
  box?: Box;
}

export interface PlanEdge {
  type: string;
  from: string;
  to: string;
  name?: string;
  properties?: Record<string, unknown>;
  tailEnd?: Record<string, unknown>;
  headEnd?: Record<string, unknown>;
  /** Sequence messages are drawn at their place in time. */
  geometry?: { x1: number; y1: number; x2: number; y2: number };
}

export type Direction = "TB" | "BT" | "LR" | "RL";

export interface Plan {
  kind: Kind;
  nodes: PlanNode[];
  edges: PlanEdge[];
  /** Placement is fixed by the kind (sequence) or by lanes and boundaries. */
  fixed: boolean;
  /** Bounds of a sequence diagram's frame, which holds every lifeline. */
  frame?: Box;
  /**
   * Width of the widest edge label, which the engine layout leaves room
   * for between nodes so labels do not sit on each other or on nodes.
   */
  edgeLabelWidth?: number;
  /** Size node views to their content before the engine layout. */
  fit?: boolean;
}

export const name = () => z.string().check(z.minLength(1));
export const strings = () => z.array(name());
export const nameOr = <T extends z.ZodMiniType>(object: T) =>
  z.union([name(), object]);

export const hex = (what: string) =>
  z.optional(
    doc(
      z.string().check(z.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)),
      `${what}, CSS hex such as '#ffcc00'.`,
    ),
  );

export interface ViewStyle {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
}

/** Notes and colours, which every kind takes. */
export const common = () => ({
  notes: z.optional(
    doc(
      z.array(
        z.object({
          text: z.string().check(z.minLength(1)),
          on: z.optional(
            doc(
              z.union([name(), strings()]),
              "Nodes the note is linked to; on a sequence diagram, the lifelines it is drawn at.",
            ),
          ),
          side: z.optional(
            doc(
              z.enum(["left", "right", "over"]),
              "sequence: where the note sits against its one lifeline; default right, over for several.",
            ),
          ),
          at: z.optional(
            doc(
              z.int().check(z.minimum(0)),
              "sequence: the number of messages above the note; default all of them.",
            ),
          ),
        }),
      ),
      "Notes (UMLNote), each linked to the nodes it is on.",
    ),
  ),
  styles: z.optional(
    doc(
      z.record(
        name(),
        z.object({
          fillColor: hex("Fill colour"),
          lineColor: hex("Line colour"),
          fontColor: hex("Text colour"),
        }),
      ),
      "Colours of node views by node name (or id).",
    ),
  ),
});

/** Holds the nodes by key and refuses duplicates and dangling edge ends. */
export class Builder {
  readonly nodes: PlanNode[] = [];
  readonly edges: PlanEdge[] = [];
  private readonly byKey = new Map<string, PlanNode>();

  constructor(readonly kind: Kind) {}

  node(
    node: Omit<PlanNode, "width" | "height"> &
      Partial<Pick<PlanNode, "width" | "height">>,
  ): PlanNode {
    if (this.byKey.has(node.key)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec: ${node.key} is defined twice; give one of them another name or id`,
      );
    }
    const full: PlanNode = { width: 120, height: 60, ...node };
    this.nodes.push(full);
    this.byKey.set(full.key, full);
    return full;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): PlanNode | undefined {
    return this.byKey.get(key);
  }

  /** Ends are names as nodes are, so "a<br/>b" finds the node named "a\nb". */
  edge(spec: PlanEdge, where: string): void {
    const edge = {
      ...spec,
      from: multiline(spec.from),
      to: multiline(spec.to),
    };
    for (const end of [edge.from, edge.to]) {
      if (!this.byKey.has(end)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.${where}: no node named ${end}`,
        );
      }
    }
    this.edges.push(edge);
  }

  plan(fixed = false): Plan {
    return { kind: this.kind, nodes: this.nodes, edges: this.edges, fixed };
  }
}

export const str = (value: string | { name: string }) =>
  multiline(typeof value === "string" ? value : value.name);

/** Line height and average glyph width of StarUML's default 13px font. */
export const LINE_HEIGHT = 16;
export const GLYPH_WIDTH = 7;
export const LABEL_PADDING = 20;

/** Width of the longest line of `text` in the default font, estimated. */
export function textWidth(text: string): number {
  return GLYPH_WIDTH * Math.max(0, ...text.split("\n").map((l) => l.length));
}
