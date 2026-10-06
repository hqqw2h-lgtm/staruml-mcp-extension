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
import { inStarUML } from "../errors.js";
import type { Kind, Plan } from "../build/spec.js";
import { editorShowing, LINE_STYLES } from "../handlers/views.js";
import type { ModelSpec, ModelViews } from "../model/spec.js";
import { modelTypeOf } from "../handlers/elements.js";
import { resolveCreateType } from "../toolbox.js";
import { escapeName } from "../refs.js";
import type { Element, View } from "../types.js";
import { normalize, settle } from "./naming.js";
import {
  type NamingKind,
  type Profile,
  SHOW_SWITCHES,
  type Visual,
} from "./profile.js";

/*
 * Applying the style profile: names normalised before anything is made,
 * so an upsert finds again what it made, and views given the profile's
 * look after they are made. Both answer what they changed.
 */

const CLASSIFIERS = new Set([
  "UMLClass",
  "UMLInterface",
  "UMLEnumeration",
  "UMLSignal",
  "UMLDataType",
]);

/** The naming rule a model type falls under, if any. */
export function namingKindOf(typeName: string | null): NamingKind | null {
  if (typeName !== null && CLASSIFIERS.has(typeName)) return "classifier";
  switch (typeName) {
    case "UMLOperation":
      return "operation";
    case "UMLEnumerationLiteral":
      return "literal";
    case "UMLUseCase":
      return "usecase";
    case "UMLPackage":
      return "package";
    default:
      return null;
  }
}

/**
 * An attribute's rule: a static one already written in capitals is a
 * constant (static final in Java, const in C#), any other an attribute.
 */
export const attributeKind = (name: string, isStatic: unknown): NamingKind =>
  isStatic === true && !/[a-z]/.test(name) ? "constant" : "attribute";

export interface Rename {
  kind: NamingKind;
  from: string;
  to: string;
}

/** Renames made while normalising one call, and the names reported unfixable. */
export class Renames {
  readonly list: Rename[] = [];
  readonly unfixed: { kind: NamingKind; name: string }[] = [];
  constructor(private readonly profile: Profile) {}

  /** `name` under the rule of `kind`, recording a change. */
  name(name: string, kind: NamingKind | null): string {
    const rule = kind && this.profile.naming[kind];
    if (!rule) return name;
    const n = normalize(name, rule);
    if (n.fixed) this.list.push({ kind: kind!, from: name, to: n.name });
    else if (n.violated) this.unfixed.push({ kind: kind!, name });
    return n.name;
  }
}

/**
 * Diagram kinds whose names are UML identifiers. A requirement diagram's
 * element attributes (Type, DocRef) and an ERD's tables follow their own
 * notations, which /export_text writes back as they were.
 */
const NAMED_KINDS = new Set<Kind>([
  "class",
  "package",
  "usecase",
  "component",
  "deployment",
]);

/**
 * A node name that picks an existing element by its owners
 * ("Billing::Invoice", "Model/Billing/Invoice"), or carries line breaks
 * for the picture, is left as written.
 */
const isReference = (name: string) => /::|\/|\n/.test(name);

/** The naming rule of a build node, by the model its create id makes. */
function nodeKind(createType: string): NamingKind | null {
  if (createType === "Note") return null;
  const { id } = resolveCreateType(createType);
  return namingKindOf(modelTypeOf(id));
}

/**
 * A build plan with its names normalised. Notes, lifelines and other
 * names outside the naming rules keep their text; a renamed node that
 * would now share its name with another of its type gets a number, so two
 * nodes stay two elements.
 */
export function normalizePlan(plan: Plan, renames: Renames): Plan {
  if (!NAMED_KINDS.has(plan.kind)) return plan;
  const nodes = plan.nodes.map((node) => ({
    ...node,
    name: isReference(node.name)
      ? node.name
      : renames.name(node.name, nodeKind(node.type)),
    ...(node.attributes && {
      attributes: node.attributes.map((a) => ({
        ...a,
        name: renames.name(a.name, attributeKind(a.name, a.isStatic)),
      })),
    }),
    ...(node.operations && {
      operations: node.operations.map((o) => ({
        ...o,
        name: renames.name(o.name, "operation"),
      })),
    }),
    ...(node.literals && {
      literals: node.literals.map((l) => renames.name(l, "literal")),
    }),
  }));
  // Names are compared within a type: a class and a package may share one.
  const settled = settle(
    nodes.map((n, i) => ({
      from: `${n.type}|${plan.nodes[i]!.name}`,
      to: `${n.type}|${n.name}`,
    })),
  );
  return {
    ...plan,
    nodes: nodes.map((n, i) => ({
      ...n,
      name: settled[i]!.slice(n.type.length + 1),
    })),
  };
}

/**
 * A model spec with its names normalised; references to a renamed class,
 * package or use case follow it.
 */
export function normalizeModelSpec(
  spec: ModelSpec,
  renames: Renames,
): ModelSpec {
  const classes = new Map<string, string>();
  const packages = new Map<string, string>();
  const cases = new Map<string, string>();
  const mapped = (map: Map<string, string>, name: string) =>
    map.get(name) ?? name;
  const pkgs = spec.packages.map((p) => {
    const name = renames.name(p.name, "package");
    packages.set(p.name, name);
    return { ...p, name, key: p.key === p.name ? name : p.key };
  });
  const keyOf = (k: string) => mapped(packages, k);
  const out: ModelSpec = {
    ...spec,
    packages: pkgs.map((p) => ({
      ...p,
      ...(p.parent !== undefined && { parent: keyOf(p.parent) }),
      dependsOn: p.dependsOn.map((d) => mapped(packages, d)),
    })),
    classes: spec.classes.map((c) => {
      const name = renames.name(c.name, "classifier");
      classes.set(c.name, name);
      return {
        ...c,
        name,
        ...(c.package !== undefined && { package: keyOf(c.package) }),
        attributes: c.attributes.map((a) => ({
          ...a,
          name: renames.name(a.name, attributeKind(a.name, a.isStatic)),
        })),
        operations: c.operations.map((o) => ({
          ...o,
          name: renames.name(o.name, "operation"),
        })),
        literals: c.literals.map((l) => renames.name(l, "literal")),
      };
    }),
    useCases: spec.useCases.map((u) => {
      const name = renames.name(u.name, "usecase");
      cases.set(u.name, name);
      return { ...u, name };
    }),
  };
  const ref = (name: string) => cases.get(name) ?? mapped(classes, name);
  return {
    ...out,
    relationships: out.relationships.map((r) => ({
      ...r,
      from: ref(r.from),
      to: ref(r.to),
    })),
    useCases: out.useCases.map((u) => ({
      ...u,
      includes: u.includes.map((x) => mapped(cases, x)),
      extends: u.extends.map((x) => mapped(cases, x)),
    })),
    collaborations: out.collaborations.map((c) => ({
      ...c,
      ...(c.package !== undefined && { package: keyOf(c.package) }),
      participants: c.participants.map((p) => ({
        ...p,
        // A lifeline named like a class is typed with it, so the name follows.
        name: mapped(classes, p.name),
        ...(p.type !== undefined && { type: mapped(classes, p.type) }),
      })),
      messages: c.messages.map((m) => ({
        ...m,
        from: mapped(classes, m.from),
        to: mapped(classes, m.to),
      })),
    })),
    lifecycles: out.lifecycles.map((l) => ({
      ...l,
      ...(l.subject !== undefined && { subject: ref(l.subject) }),
    })),
    views: normalizeViews(spec.views, classes, packages, cases),
  };
}

/** The view sections' names of renamed classes, packages and use cases. */
function normalizeViews(
  views: ModelViews,
  classes: ReadonlyMap<string, string>,
  packages: ReadonlyMap<string, string>,
  cases: ReadonlyMap<string, string>,
): ModelViews {
  const map = (m: ReadonlyMap<string, string>, list?: string[]) =>
    list?.map((n) => m.get(n) ?? n);
  return {
    ...views,
    ...(views.classViews && {
      classViews: views.classViews.map((v) => ({
        ...v,
        ...(v.contexts && { contexts: map(packages, v.contexts) }),
        ...(v.classes && { classes: map(classes, v.classes) }),
        ...(v.exclude && { exclude: map(classes, v.exclude) }),
        ...(v.also && { also: map(classes, v.also) }),
      })),
    }),
    ...(views.useCaseViews && {
      useCaseViews: views.useCaseViews.map((v) => ({
        ...v,
        ...(v.cases && { cases: map(cases, v.cases) }),
      })),
    }),
    ...(views.contexts && {
      contexts: Object.fromEntries(
        Object.entries(views.contexts).map(([k, n]) => [
          k,
          packages.get(n) ?? n,
        ]),
      ),
    }),
    ...(views.subjects && {
      subjects: Object.fromEntries(
        Object.entries(views.subjects).map(([u, s]) => [cases.get(u) ?? u, s]),
      ),
    }),
  };
}

interface Op {
  path: string;
  body: Record<string, unknown>;
  as?: string;
}

const NAMED_OPS: Record<string, (body: Record<string, unknown>) => string> = {
  "/create_element": (b) => String(b.type),
  "/create_element_with_view": (b) => String(b.type),
  "/add_attribute": () => "UMLAttribute",
  "/add_operation": () => "UMLOperation",
  "/add_enumeration_literal": () => "UMLEnumerationLiteral",
};

/** Ops whose new elements are named under the profile; refs between ops are "$name", so nothing else changes. */
export function normalizeOps(ops: readonly Op[], renames: Renames): Op[] {
  return ops.map((op) => {
    const typeOf = NAMED_OPS[op.path];
    const name = op.body.name;
    if (!typeOf || typeof name !== "string") return op;
    const typeName = typeOf(op.body);
    const kind =
      typeName === "UMLAttribute"
        ? attributeKind(name, op.body.isStatic)
        : namingKindOf(typeName);
    const fixed = renames.name(name, kind);
    return fixed === name ? op : { ...op, body: { ...op.body, name: fixed } };
  });
}

/** The stereotype's name, whether StarUML holds it as text or as an element. */
function stereotypeOf(model: Element | null | undefined): string | null {
  const st = model?.stereotype;
  if (typeof st === "string") return st || null;
  return st && typeof st === "object" ? String((st as Element).name) : null;
}

/** A node view's look: '*', then its kind's, then its stereotype's. */
export function visualFor(view: View, profile: Profile): Visual {
  const kind = view.model?.constructor.name ?? "UMLNote";
  const st = stereotypeOf(view.model);
  return {
    ...profile.visuals.kinds["*"],
    ...profile.visuals.kinds[kind],
    ...(st !== null && profile.visuals.stereotypes[st]),
  };
}

/** Face and size of a view's font, from Font's "face;size;style" form (core/graphics.js). */
export function fontOf(view: View): { face: string; size: number } | null {
  const font = view.font as { __write?: () => unknown } | null | undefined;
  if (!font || typeof font.__write !== "function") return null;
  const [face, size] = String(font.__write()).split(";");
  return { face: face!, size: Number(size) };
}

type Assign = [View, string, unknown];

/** What the profile changes on `view`, as field assignments, and its font. */
function viewChanges(view: View, profile: Profile) {
  const assigns: Assign[] = [];
  const set = (field: string, value: unknown) => {
    if (value === undefined || !(field in view) || view[field] === value) {
      return;
    }
    assigns.push([view, field, value]);
  };
  let face: string | undefined;
  let size: number | undefined;
  if (view instanceof type.EdgeView) {
    const e = profile.visuals.edges;
    set(
      "lineStyle",
      e.lineStyle === undefined ? undefined : LINE_STYLES[e.lineStyle],
    );
    set("lineColor", e.lineColor);
    set("fontColor", e.fontColor);
  } else {
    const v = visualFor(view, profile);
    set("fillColor", v.fillColor);
    set("lineColor", v.lineColor);
    set("fontColor", v.fontColor);
    set("stereotypeDisplay", v.stereotypeDisplay);
    for (const s of SHOW_SWITCHES) {
      // A switch applies only where the view has it as a flag.
      if (typeof view[s] === "boolean") set(s, profile.visuals.show[s]);
    }
    const font = fontOf(view);
    if (font && v.fontFace !== undefined && font.face !== v.fontFace) {
      face = v.fontFace;
    }
    if (font && v.fontSize !== undefined && font.size !== v.fontSize) {
      size = v.fontSize;
    }
  }
  return { assigns, face, size };
}

/** The fields of `view` that differ from the profile, font included. */
export function offProfile(view: View, profile: Profile): string[] {
  const c = viewChanges(view, profile);
  return [
    ...c.assigns.map(([, field]) => field),
    ...(c.face !== undefined || c.size !== undefined ? ["font"] : []),
  ];
}

/** Views a diagram draws on its own, the frame of a sequence diagram excepted. */
export function styledViews(diagram: Element): View[] {
  return (diagram.ownedViews as View[]).filter(
    (v) => !(v.model instanceof type.Diagram),
  );
}

/**
 * Gives `views` (all on `diagram`) the profile's look: plain fields in one
 * operation, fonts through Engine.setFontFace/setFontSize, which assign a
 * new Font. Answers how many views changed; a second call changes none.
 */
export function styleViews(
  diagram: Element,
  views: readonly View[],
  profile: Profile,
): number {
  const assigns: Assign[] = [];
  const faces = new Map<string, View[]>();
  const sizes = new Map<number, View[]>();
  const changed = new Set<View>();
  for (const view of views) {
    const c = viewChanges(view, profile);
    assigns.push(...c.assigns);
    for (const [v] of c.assigns) changed.add(v);
    if (c.face !== undefined) {
      faces.set(c.face, [...(faces.get(c.face) ?? []), view]);
      changed.add(view);
    }
    if (c.size !== undefined) {
      sizes.set(c.size, [...(sizes.get(c.size) ?? []), view]);
      changed.add(view);
    }
  }
  if (assigns.length > 0) {
    const builder = app.repository.getOperationBuilder();
    builder.begin("apply style profile");
    for (const [view, field, value] of assigns) {
      builder.fieldAssign(view, field, value);
    }
    builder.end();
    inStarUML(() => app.repository.doOperation(builder.getOperation()));
  }
  if (faces.size > 0 || sizes.size > 0) {
    const editor = editorShowing(diagram);
    for (const [face, vs] of faces) {
      inStarUML(() => app.engine.setFontFace(editor, vs, face));
    }
    for (const [size, vs] of sizes) {
      inStarUML(() => app.engine.setFontSize(editor, vs, size));
    }
  }
  return changed.size;
}

export const styleDiagram = (diagram: Element, profile: Profile): number =>
  styleViews(diagram, styledViews(diagram), profile);

/** What applying the profile did in one call, for the answer. */
export function styleReport(
  profile: Profile,
  renames: Renames,
  styled: number,
) {
  return {
    profile: profile.name,
    ...(renames.list.length > 0 && { renamed: renames.list.slice(0, 50) }),
    ...(renames.unfixed.length > 0 && {
      unfixed: renames.unfixed.slice(0, 50).map((u) => `${u.kind} ${u.name}`),
    }),
    ...escapedNames(renames.unfixed.map((u) => u.name)),
    ...(styled > 0 && { styled }),
  };
}

/**
 * Names kept that a path ref must escape, each as a path writes it: a
 * package "Actor System (application.actors)" is reached by
 * "Actor System \(application\.actors\)/RuleNodeActor" (issue #39).
 */
function escapedNames(names: readonly string[]) {
  const special = [...new Set(names)].filter((n) => escapeName(n) !== n);
  return special.length > 0
    ? { escaped: special.slice(0, 50).map((n) => `${n} -> ${escapeName(n)}`) }
    : {};
}

export const styleReportSchema = () =>
  doc(
    z.object({
      profile: doc(z.string(), "The style profile applied."),
      renamed: z.optional(
        doc(
          z.array(
            z.object({ kind: z.string(), from: z.string(), to: z.string() }),
          ),
          "Names the profile's naming rules rewrote (first 50).",
        ),
      ),
      unfixed: z.optional(
        doc(
          z.array(z.string()),
          "Names off the rules that the profile only reports (fix none, or no fix matches a custom pattern).",
        ),
      ),
      escaped: z.optional(
        doc(
          z.array(z.string()),
          "Kept names holding / . # @ ( ) , or \\, as a path ref writes them escaped (name -> escaped); or rename them in the spec, keeping the id.",
        ),
      ),
      styled: z.optional(doc(z.int(), "Views given the profile's look.")),
    }),
    "What the style profile changed in this call.",
  );
