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

import {
  formatAttribute,
  formatOperation,
  typeText,
} from "../build/members.js";
import { list } from "../handlers/describe.js";
import { LINE_STYLES } from "../handlers/views.js";
import { fontOf, visualFor } from "../style/apply.js";
import type { Profile, Visual } from "../style/profile.js";
import type { Element, View } from "../types.js";
import table from "./drawio-styles.json";

/*
 * Writes a diagram as an uncompressed draw.io file (issue #41): one mxCell
 * per view, at the view's own bounds, so the picture draw.io renders is the
 * one StarUML lays out. Edges keep StarUML's polyline: the first and last
 * points become fixed exit and entry constraints on their terminals and the
 * rest waypoints, so draw.io routes nothing itself. Shapes come from
 * drawio-styles.json by model type; colours and fonts come from the style
 * profile over the view's own, as /apply_style_profile would set them.
 *
 * Format: mxfile > diagram > mxGraphModel > root, cells "0" (root) and "1"
 * (layer) first (jgraph/drawio-mcp shared/mxfile.xsd and xml-reference.md).
 * Child cells of a container are placed relative to it; edges all live in
 * the layer, so their waypoints are absolute.
 */

interface NodeStyle {
  style: string;
  label?: string;
  container?: boolean;
  fixed?: boolean;
  stereotype?: string;
  text?: string;
  suffix?: string;
  on?: string;
  off?: string;
}

interface EdgeStyle {
  style: string;
  label?: string;
  stereotype?: string;
}

const NODES = table.nodes as Record<string, NodeStyle>;
const PSEUDOSTATES = table.pseudostates as Record<string, NodeStyle>;
const VIEWS = table.views as Record<string, NodeStyle>;
const EDGES = table.edges as Record<string, EdgeStyle>;
const EDGE_VIEWS = table.edgeViews as Record<string, EdgeStyle>;
const MESSAGES = table.messages as Record<string, string>;
const AGGREGATION = table.aggregation as Record<string, string>;
const CARDINALITIES = table.cardinalities as Record<string, string>;
const LINE = table.lineStyles as Record<string, string>;
const VISUAL = table.visual as Record<keyof Visual, string>;

const LINE_NAMES = Object.fromEntries(
  Object.entries(LINE_STYLES).map(([name, n]) => [n, name]),
) as Record<number, string>;

export interface DrawioResult {
  text: string;
  warnings: string[];
  /** Ids of the views written as cells, in document order. */
  views: string[];
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const typeOf = (e: Element) => e.constructor.name;
const str = (value: unknown) => (typeof value === "string" ? value : "");
/** Two decimals: StarUML measures text in fractions of a pixel. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/** XML attribute text: markup characters, quotes and line breaks escaped, control characters XML 1.0 forbids dropped. */
export function xmlAttr(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n/g, "&#xa;")
      .replace(/\t/g, "&#x9;")
  );
}

/** Text for an html=1 label: markup escaped, line breaks as <br>. */
const html = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");

const guillemets = (s: string) => `«${html(s)}»`;

/** A stereotype's name, whether StarUML holds it as text or as an element. */
function stereotypeOf(model: Element | null | undefined): string {
  const st = model?.stereotype;
  return typeof st === "string" ? st : st ? str((st as Element).name) : "";
}

const rectOf = (v: View): Rect => ({
  x: v.left as number,
  y: v.top as number,
  w: v.width as number,
  h: v.height as number,
});

const within = (a: Rect, b: Rect) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5;

const points = (v: View) =>
  (v.points as { points?: { x: number; y: number }[] } | null | undefined)
    ?.points ?? [];

/** What a node view is drawn as: by its view type, pseudostate kind or model type. */
function nodeStyle(view: View): NodeStyle | undefined {
  const m = view.model;
  if (VIEWS[typeOf(view)]) return VIEWS[typeOf(view)];
  if (!m) return undefined;
  if (typeOf(m) === "UMLPseudostate") return PSEUDOSTATES[str(m.kind)];
  return NODES[typeOf(m)];
}

const FALLBACK: NodeStyle = { style: table.node };

/** draw.io style keys for a visual, in the table's key order. */
function visualStyle(visual: Visual, skipColours: boolean): string {
  return (Object.keys(VISUAL) as (keyof Visual)[])
    .filter((k) => visual[k] !== undefined)
    .filter((k) => !skipColours || (k !== "fillColor" && k !== "lineColor"))
    .map((k) => `${VISUAL[k]}=${String(visual[k])};`)
    .join("");
}

/** The view's own look, as /set_view_style reads it. */
function ownVisual(view: View): Visual {
  const font = fontOf(view);
  const colour = (k: string) =>
    str(view[k]) ? { [k]: str(view[k]) } : ({} as Visual);
  return {
    ...colour("fillColor"),
    ...colour("lineColor"),
    ...colour("fontColor"),
    ...(font && { fontFace: font.face, fontSize: font.size }),
  };
}

function classifierLabel(view: View, m: Element): string {
  const keyword: Record<string, string> = {
    UMLInterface: "interface",
    UMLEnumeration: "enumeration",
    UMLDataType: "dataType",
    UMLPrimitiveType: "primitive",
    UMLSignal: "signal",
  };
  const stereotypes = [keyword[typeOf(m)], stereotypeOf(m)].filter(
    (s): s is string => Boolean(s),
  );
  const name = m.isAbstract ? `<i>${html(str(m.name))}</i>` : html(str(m.name));
  const head = [...stereotypes.map(guillemets), `<b>${name}</b>`].join("<br>");
  const compartments: string[][] = [];
  if (!view.suppressAttributes) {
    compartments.push(list(m.attributes).map((a) => formatAttribute(a)));
  }
  if (!view.suppressOperations) {
    compartments.push(list(m.operations).map((o) => formatOperation(o)));
  }
  if (typeOf(m) === "UMLEnumeration" && !view.suppressLiterals) {
    compartments.push(list(m.literals).map((l) => str(l.name)));
  }
  return (
    `<p style="margin:0;margin-top:4px;text-align:center;">${head}</p>` +
    compartments
      .map(
        (lines) =>
          `<hr size="1" style="border-style:solid;"><p style="margin:0;margin-left:4px;">${lines.map(html).join("<br>")}</p>`,
      )
      .join("")
  );
}

function entityLabel(m: Element): string {
  const rows = list(m.columns).map((c) => {
    const keys = [
      c.primaryKey === true && "PK",
      c.foreignKey === true && "FK",
      c.unique === true && "U",
      c.nullable === true && "N",
    ].filter(Boolean);
    const length =
      str(c.length) && str(c.length) !== "0" ? `(${str(c.length)})` : "";
    const name = html(str(c.name));
    return `<tr><td>${keys.join(", ")}</td><td>${c.primaryKey === true ? `<u>${name}</u>` : name}</td><td>${html(typeText(c.type) + length)}</td></tr>`;
  });
  return (
    `<p style="margin:0;margin-top:4px;text-align:center;"><b>${html(str(m.name))}</b></p>` +
    `<hr size="1" style="border-style:solid;"><table style="width:100%;font-size:1em;" cellpadding="2" cellspacing="0">${rows.join("")}</table>`
  );
}

const C4_KINDS: Record<string, string> = {
  C4Person: "Person",
  C4SoftwareSystem: "Software System",
  C4Container: "Container",
  C4Component: "Component",
};

function c4Label(m: Element): string {
  const tech = str(m.technology);
  const kind = C4_KINDS[typeOf(m)]!;
  const description = str(m.description);
  return (
    `<b>${html(str(m.name))}</b><br><span style="font-size:0.8em;">[${kind}${tech ? `: ${html(tech)}` : ""}]</span>` +
    (description ? `<br><br>${html(description)}` : "")
  );
}

function requirementLabel(m: Element): string {
  const st = stereotypeOf(m) || "requirement";
  return (
    `<p style="margin:0;margin-top:4px;text-align:center;">${guillemets(st)}<br><b>${html(str(m.name))}</b></p>` +
    `<hr size="1" style="border-style:solid;"><p style="margin:0;margin-left:4px;">id = ${html(str(m.id))}<br>text = ${html(str(m.text))}</p>`
  );
}

/** «stereotype» lines above the name, as StarUML's label decoration shows them. */
function namedLabel(m: Element, fixed: string | undefined): string {
  const lines = [fixed, stereotypeOf(m)]
    .filter((s): s is string => Boolean(s))
    .map(guillemets);
  return [...lines, html(str(m.name))].filter(Boolean).join("<br>");
}

function nodeLabel(view: View, spec: NodeStyle, diagram: Element): string {
  const m = view.model;
  switch (spec.label) {
    case "text":
      return html(str(view.text) || str(m?.text));
    case "frame": {
      // The frame's kind ("sd", "cd", ...) is its frameTypeLabel's text.
      const kind = str((view.frameTypeLabel as View | undefined)?.text);
      const name = html(str((m ?? diagram).name));
      return kind ? `<b>${html(kind)}</b> ${name}` : name;
    }
    case "fixed":
      return html(spec.text!);
  }
  // A view of no model the table does not list, e.g. an image or a shape.
  if (!m) return html(str(view.text));
  const model = m;
  switch (spec.label) {
    case "classifier":
      return classifierLabel(view, model);
    case "entity":
      return entityLabel(model);
    case "c4":
      return c4Label(model);
    case "requirement":
      return requirementLabel(model);
    case "lifeline": {
      const type = typeText(
        (model.represent as Element | null | undefined)?.type,
      );
      return html(str(model.name) + (type ? ` : ${type}` : ""));
    }
    case "fragment":
      return `<b>${html(str(model.interactionOperator))}</b>`;
    case "checked":
      return html((model.checked ? spec.on! : spec.off!) + str(model.name));
    case "suffixed":
      return html(str(model.name) + spec.suffix!);
    default:
      return namedLabel(model, spec.stereotype);
  }
}

interface Cell {
  id: string;
  parent: string;
  value: string;
  style: string;
  kind: "vertex" | "edge";
  source?: string;
  target?: string;
  geometry: string;
  /** Edge labels: not connectable. */
  label?: boolean;
}

function geometry(r: Rect, origin: Rect | undefined): string {
  const x = r.x - (origin?.x ?? 0);
  const y = r.y - (origin?.y ?? 0);
  return `<mxGeometry x="${num(x)}" y="${num(y)}" width="${num(r.w)}" height="${num(r.h)}" as="geometry" />`;
}

function writeCell(c: Cell): string {
  const attrs = [
    `id="${xmlAttr(c.id)}"`,
    `value="${xmlAttr(c.value)}"`,
    `style="${xmlAttr(c.style)}"`,
    c.kind === "vertex" ? `vertex="1"` : `edge="1"`,
    ...(c.label ? [`connectable="0"`] : []),
    `parent="${xmlAttr(c.parent)}"`,
    ...(c.source !== undefined ? [`source="${xmlAttr(c.source)}"`] : []),
    ...(c.target !== undefined ? [`target="${xmlAttr(c.target)}"`] : []),
  ];
  return `        <mxCell ${attrs.join(" ")}>\n          ${c.geometry}\n        </mxCell>`;
}

/**
 * Where `p` sits on `r`, as draw.io's 0..1 constraint fractions. draw.io
 * mirrors constraints on a flipH shape (mxGraph.getConnectionPoint), so the
 * fraction for one is mirrored first.
 */
function anchor(p: { x: number; y: number }, r: Rect, flipped: boolean) {
  const f = (v: number, from: number, size: number) =>
    Math.min(1, Math.max(0, size > 0 ? (v - from) / size : 0.5));
  const x = f(p.x, r.x, r.w);
  return { x: num(flipped ? 1 - x : x), y: num(f(p.y, r.y, r.h)) };
}

/** Label of an edge view's model, by the table's label kind. */
function edgeLabel(
  m: Element,
  spec: EdgeStyle,
  number: number | undefined,
): string {
  const named = namedLabel(m, spec.stereotype);
  const guard = str(m.guard) ? `[${html(str(m.guard))}]` : "";
  switch (spec.label) {
    case "flow":
      return [html(str(m.name)), guard].filter(Boolean).join(" ");
    case "transition": {
      const triggers = list(m.triggers).map((t) => str(t.name));
      const trigger = html(triggers.join(", ") || str(m.name));
      const effects = list(m.effects).map((e) => html(str(e.name)));
      return [
        trigger,
        guard,
        effects.length > 0 ? `/ ${effects.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "message": {
      const args = str(m.arguments);
      const text = html(str(m.name) + (args ? `(${args})` : ""));
      return number === undefined ? text : `${number} : ${text}`;
    }
    case "c4": {
      const tech = str(m.technology);
      return `<b>${html(str(m.name))}</b>${tech ? `<br>[${html(tech)}]` : ""}`;
    }
    default:
      return named;
  }
}

/** startArrow/endArrow keys for an association's two ends: tail is end1. */
function associationEnds(m: Element): string {
  const end = (e: Element, at: "start" | "end", other: Element) => {
    const aggregation = AGGREGATION[str(e.aggregation)];
    // The diamond sits at the whole; an arrow at a navigable part whose
    // other end is not navigable, as StarUML draws it.
    const navigable =
      e.navigable === "navigable" && other.navigable !== "navigable";
    const keys = aggregation ?? (navigable ? table.navigable : "");
    return at === "start" ? keys.replace(/end/g, "start") : keys;
  };
  const [a, b] = [m.end1 as Element, m.end2 as Element];
  return end(a, "start", b) + end(b, "end", a);
}

function erdEnds(m: Element): string {
  const arrow = (e: Element) => CARDINALITIES[str(e.cardinality)] ?? "none";
  const dashed = m.identifying === false ? "dashed=1;" : "";
  return `startArrow=${arrow(m.end1 as Element)};endArrow=${arrow(m.end2 as Element)};${dashed}`;
}

/** Role and multiplicity labels at an association's ends, as edge children. */
function endLabels(id: string, m: Element): Cell[] {
  const out: Cell[] = [];
  const ends: [Element, string, number][] = [
    [m.end1 as Element, "tail", -1],
    [m.end2 as Element, "head", 1],
  ];
  for (const [e, side, x] of ends) {
    const align = x < 0 ? "left" : "right";
    for (const [text, suffix, vertical, dy] of [
      [str(e.name), "role", "top", 4],
      [str(e.multiplicity), "multiplicity", "bottom", -4],
    ] as const) {
      if (!text) continue;
      out.push({
        id: `${id}#${side}-${suffix}`,
        parent: id,
        value: html(text),
        style: `${table.edgeLabel}align=${align};verticalAlign=${vertical};`,
        kind: "vertex",
        label: true,
        geometry: `<mxGeometry x="${x}" relative="1" as="geometry">\n            <mxPoint x="${-x * 6}" y="${dy}" as="offset" />\n          </mxGeometry>`,
      });
    }
  }
  return out;
}

/** Message views of a sequence diagram ordered by their first point's y. */
const messageY = (v: View) => points(v)[0]?.y ?? Number.POSITIVE_INFINITY;

/** The subviews of `view` and theirs, depth first. */
function descendants(view: View): View[] {
  return view.subViews.flatMap((s) => [s, ...descendants(s)]);
}

/**
 * The draw.io file for `diagram` under `profile`. Views StarUML hides, and
 * views neither a node nor an edge, are left out and named in warnings.
 */
export function toDrawio(diagram: Element, profile: Profile): DrawioResult {
  const owned = diagram.ownedViews as View[];
  const skipped = new Map<string, number>();
  const skip = (v: View) =>
    skipped.set(typeOf(v), (skipped.get(typeOf(v)) ?? 0) + 1);
  const nodes: View[] = [];
  const edges: View[] = [];
  for (const v of owned) {
    if (v.visible === false) skip(v);
    else if (v instanceof type.NodeView && typeof v.left === "number")
      nodes.push(v);
    else if (v instanceof type.EdgeView) edges.push(v);
    else skip(v);
  }
  const rects = new Map(nodes.map((v) => [v, rectOf(v)]));
  const styles = new Map(nodes.map((v) => [v, nodeStyle(v) ?? FALLBACK]));
  const area = (v: View) => rects.get(v)!.w * rects.get(v)!.h;

  // A view sits in the container StarUML says it is in, else in the
  // smallest container drawn around it: swimlanes, subjects and frames hold
  // their views by geometry alone (inside() in text/model.ts).
  const parents = new Map<View, View>();
  for (const v of nodes) {
    const declared = v.containerView as View | null | undefined;
    const parent =
      declared && rects.has(declared)
        ? declared
        : nodes
            .filter(
              (c) =>
                c !== v &&
                styles.get(c)!.container === true &&
                area(c) > area(v) &&
                within(rects.get(v)!, rects.get(c)!),
            )
            .sort((a, b) => area(a) - area(b))[0];
    if (parent) parents.set(v, parent);
  }
  // A declared container cycle (never seen in 7.1.1) would hide its views
  // from the tree; such views go to the layer instead.
  const cycle = (v: View) => {
    const seen = new Set<View>([v]);
    for (let p = parents.get(v); p; p = parents.get(p)) {
      if (seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  for (const v of nodes.filter(cycle)) parents.delete(v);

  const messages = edges
    .filter((e) => e.model && typeOf(e.model) === "UMLMessage")
    .sort((a, b) => messageY(a) - messageY(b));
  const others = edges.filter((e) => !messages.includes(e));

  // Activations hang off the messages that start them (UMLSeqMessageView's
  // activation subview); draw.io draws them as children of the lifeline.
  // A message ends on its lifeline's line part, a subview; the cell is the
  // lifeline's.
  const owners = new Map<View, View>();
  for (const v of nodes) for (const s of descendants(v)) owners.set(s, v);
  const terminal = (t: View | null) =>
    t && owners.has(t) ? owners.get(t)! : t;
  const activations = new Map<View, View[]>();
  for (const m of messages) {
    // The receiving lifeline's activation.
    const head = terminal(m.head as View | null);
    if (!head || !rects.has(head)) continue;
    for (const a of m.subViews.filter(
      (s) => s instanceof type.UMLActivationView && s.visible !== false,
    )) {
      activations.set(head, [...(activations.get(head) ?? []), a]);
    }
  }

  const cells: Cell[] = [];
  const written: string[] = [];
  const nodeCell = (v: View) => {
    const spec = styles.get(v)!;
    const r = rects.get(v)!;
    const parent = parents.get(v);
    const visual = { ...ownVisual(v), ...visualFor(v, profile) };
    const extra =
      spec.label === "lifeline" ? `size=${num(lifelineHead(v))};` : "";
    cells.push({
      id: v._id,
      parent: parent ? parent._id : "1",
      value: nodeLabel(v, spec, diagram),
      style:
        spec.style +
        extra +
        (spec.container ? table.container : "") +
        visualStyle(visual, spec.fixed === true),
      kind: "vertex",
      geometry: geometry(r, parent && rects.get(parent)),
    });
    written.push(v._id);
    for (const a of activations.get(v) ?? []) {
      cells.push({
        id: a._id,
        parent: v._id,
        value: "",
        style:
          table.views.UMLActivationView.style +
          visualStyle(ownVisual(a), false),
        kind: "vertex",
        geometry: geometry(rectOf(a), r),
      });
    }
    if (v.model && typeOf(v.model) === "UMLCombinedFragment") {
      const operands = descendants(v)
        .filter((s) => s instanceof type.UMLInteractionOperandView)
        .sort((a, b) => (a.top as number) - (b.top as number));
      operands.forEach((o, i) => {
        const guard = str(o.model?.guard);
        cells.push({
          id: o._id,
          parent: v._id,
          value: guard ? `[${html(guard)}]` : "",
          // The fragment draws the first operand's top edge itself.
          style: NODES.UMLInteractionOperand!.style + (i === 0 ? "top=0;" : ""),
          kind: "vertex",
          geometry: geometry(rectOf(o), r),
        });
      });
    }
    for (const c of nodes.filter((n) => parents.get(n) === v)) nodeCell(c);
  };
  for (const v of nodes.filter((n) => !parents.has(n))) nodeCell(v);

  const ids = new Set(written);
  const edgeIds = new Set(edges.map((e) => e._id));
  const lineStyle = profile.visuals.edges.lineStyle;
  const number = diagram.showSequenceNumber !== false;
  const edgeCell = (e: View, index: number | undefined) => {
    const tail = terminal(e.tail as View | null);
    const head = terminal(e.head as View | null);
    const known = (t: View | null) =>
      t !== null && (ids.has(t._id) || edgeIds.has(t._id));
    if (!known(tail) || !known(head)) {
      skip(e);
      return;
    }
    const m = e.model;
    const spec: EdgeStyle = EDGE_VIEWS[typeOf(e)] ??
      (m && EDGES[typeOf(m)]) ?? { style: table.edge };
    const pts = points(e);
    const ends = (
      t: View,
      p: { x: number; y: number } | undefined,
      at: string,
    ) => {
      const r = rects.get(t);
      if (!r || !p) return "";
      const flipped = styles.get(t)!.style.includes("flipH=1");
      const { x, y } = anchor(p, r, flipped);
      return `${at}X=${x};${at}Y=${y};${at}Dx=0;${at}Dy=0;${at}Perimeter=0;`;
    };
    const kindStyle =
      m && typeOf(m) === "UMLMessage"
        ? (MESSAGES[str(m.messageSort)] ?? "")
        : m && typeOf(m) === "UMLAssociation"
          ? associationEnds(m)
          : m && typeOf(m) === "ERDRelationship"
            ? erdEnds(m)
            : "";
    const own = ownVisual(e);
    const visual: Visual = {
      ...(own.lineColor && { lineColor: own.lineColor }),
      ...(own.fontColor && { fontColor: own.fontColor }),
      ...(own.fontFace && { fontFace: own.fontFace, fontSize: own.fontSize }),
      ...(profile.visuals.edges.lineColor && {
        lineColor: profile.visuals.edges.lineColor,
      }),
      ...(profile.visuals.edges.fontColor && {
        fontColor: profile.visuals.edges.fontColor,
      }),
    };
    const line =
      LINE[lineStyle ?? LINE_NAMES[e.lineStyle as number] ?? ""] ?? "";
    const waypoints = pts.slice(1, -1);
    cells.push({
      id: e._id,
      parent: "1",
      value: m ? edgeLabel(m, spec, index) : "",
      style:
        spec.style +
        kindStyle +
        line +
        visualStyle(visual, false) +
        ends(tail!, pts[0], "exit") +
        ends(head!, pts.at(-1), "entry"),
      kind: "edge",
      source: tail!._id,
      target: head!._id,
      geometry:
        waypoints.length === 0
          ? `<mxGeometry relative="1" as="geometry" />`
          : `<mxGeometry relative="1" as="geometry">\n            <Array as="points">\n${waypoints
              .map(
                (p) =>
                  `              <mxPoint x="${num(p.x)}" y="${num(p.y)}" />`,
              )
              .join("\n")}\n            </Array>\n          </mxGeometry>`,
    });
    written.push(e._id);
    if (m && typeOf(m) === "UMLAssociation") cells.push(...endLabels(e._id, m));
  };
  for (const e of others) edgeCell(e, undefined);
  messages.forEach((e, i) => edgeCell(e, number ? i + 1 : undefined));

  const right = Math.max(0, ...[...rects.values()].map((r) => r.x + r.w));
  const bottom = Math.max(0, ...[...rects.values()].map((r) => r.y + r.h));
  const page = profile.layout.page;
  const text = [
    `<mxfile host="staruml-mcp-extension" type="device" compressed="false">`,
    `  <diagram id="${xmlAttr(diagram._id)}" name="${xmlAttr(str(diagram.name))}">`,
    `    <mxGraphModel grid="1" gridSize="${profile.visuals.grid.size}" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.max(page.width, Math.ceil(right))}" pageHeight="${Math.max(page.height, Math.ceil(bottom))}" math="0" shadow="0">`,
    `      <root>`,
    `        <mxCell id="0" />`,
    `        <mxCell id="1" parent="0" />`,
    ...cells.map(writeCell),
    `      </root>`,
    `    </mxGraphModel>`,
    `  </diagram>`,
    `</mxfile>`,
    ``,
  ].join("\n");
  return {
    text,
    warnings: [...skipped].map(
      ([t, n]) => `${n} ${t} ${n === 1 ? "view is" : "views are"} not drawn`,
    ),
    views: written,
    width: Math.ceil(right),
    height: Math.ceil(bottom),
  };
}

/** Height of a lifeline's head: its name compartment, 40 as 7.1.1 draws it otherwise. */
function lifelineHead(view: View): number {
  const head = view.subViews.find(
    (s) => s instanceof type.UMLNameCompartmentView,
  );
  return typeof head?.height === "number" ? head.height : 40;
}
