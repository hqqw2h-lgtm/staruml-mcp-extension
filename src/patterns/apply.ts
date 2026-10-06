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

import { opsFor } from "../handlers/build.js";
import { planFor } from "../build/spec.js";
import { ApiError } from "../errors.js";
import { type ModelOp, type Node, Planner } from "../model/planner.js";
import { pathOf, tryResolve } from "../refs.js";
import type { Element } from "../types.js";
import { adaptation, adaptRole, relationType } from "./adapt.js";
import type {
  Pattern,
  PatternAttribute,
  PatternOperation,
  PatternRelationship,
  Role,
} from "./schema.js";

/*
 * Plans /apply_pattern: each role bound to existing elements by path or to
 * new ones, every property the pattern prescribes set on the element, its
 * members and the ends of its relationships, and, when asked, the views
 * on a class diagram and a sequence diagram of the pattern; one list of
 * /batch ops, so one undo step, which a dry run lists instead.
 */

/** A role's binding: a path or name, or a new element's name. */
export type Binding = string | { new: { name: string } };

export interface ApplyOptions {
  bindings: Record<string, Binding | Binding[]>;
  /** Owner of new elements and diagrams. */
  parent: Element;
  upsert: boolean;
  /** A class diagram to show the pattern on: an existing one, or a name for a new one. */
  diagram?: { existing: Element | null; name: string };
  /** Also make a sequence diagram of the pattern's messages. */
  sequence?: boolean;
}

export interface BoundElement {
  ref: string;
  path: string;
  created: boolean;
}

export interface ApplyPlan {
  ops: ModelOp[];
  planner: Planner;
  roles: Record<string, BoundElement[]>;
  warnings: string[];
  /** "$pdiagram", the class diagram's id, or nothing. */
  diagram?: string;
  sequenceDiagram?: string;
}

/** {Role} placeholders in a template, replaced by the names bound. */
export function fill(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(
    /\{([^{}]+)\}/g,
    (all, role: string) => names.get(role) ?? all,
  );
}

const ROLE_REF = /^\{([^{}]+)\}$/;

const ASSOCIATIONS: Record<string, string | undefined> = {
  association: undefined,
  aggregation: "shared",
  composition: "composite",
};

/** The elements a role is bound to: existing ones, or names to make. */
function resolveBinding(
  role: Role,
  binding: Binding | Binding[] | undefined,
): ({ elem: Element } | { name: string })[] {
  if (binding === undefined) {
    return role.optional ? [] : [{ name: role.name }];
  }
  const list = Array.isArray(binding) ? binding : [binding];
  if (role.cardinality === "1" && list.length !== 1) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `bindings.${role.name}: the role takes one element, got ${list.length}`,
    );
  }
  return list.map((b) => {
    if (typeof b !== "string") return { name: b.new.name };
    const elem = tryResolve(b);
    if (!elem) {
      if (b.includes("/")) {
        throw new ApiError(
          "NOT_FOUND",
          `bindings.${role.name}: nothing at ${b}; pass a name or {new: {name}} for a new element`,
        );
      }
      return { name: b };
    }
    if (!(elem instanceof type.UMLClassifier)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `bindings.${role.name}: ${b} is a ${elem.constructor.name}, not a classifier`,
      );
    }
    return { elem };
  });
}

export function planPattern(
  pattern: Pattern,
  options: ApplyOptions,
): ApplyPlan {
  for (const key of Object.keys(options.bindings)) {
    if (!pattern.roles.some((r) => r.name === key)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `bindings.${key}: ${pattern.name} has the roles ${pattern.roles.map((r) => r.name).join(", ")}`,
      );
    }
  }
  const p = new Planner(options.upsert);
  const warnings: string[] = [];
  const parent: Node = {
    ref: options.parent._id,
    elem: options.parent,
    path: pathOf(options.parent)!,
  };
  // Bind every role first: members refer to other roles' elements.
  const bound = new Map<
    string,
    { node: Node; created: boolean; name: string; role: Role }[]
  >();
  for (const role of pattern.roles) {
    bound.set(
      role.name,
      resolveBinding(role, options.bindings[role.name]).map((b) => {
        if ("elem" in b) {
          const type = b.elem.constructor.name;
          const path = pathOf(b.elem)!;
          // An element of another metaclass plays the role adapted, the
          // way /detect_patterns reads it back, or not at all.
          const played = adaptRole(pattern, role, type);
          if (typeof played === "string") {
            throw new ApiError(
              "INVALID_ARGUMENT",
              `bindings.${role.name}: ${path} is a ${type}; ${played}`,
            );
          }
          if (played !== role)
            warnings.push(adaptation(pattern, role, type, path));
          return {
            node: { ref: b.elem._id, elem: b.elem, path },
            created: false,
            name: b.elem.name!,
            role: played,
          };
        }
        const node = p.element(parent, role.type, b.name, {});
        return { node, created: node.elem === null, name: b.name, role };
      }),
    );
  }
  const names = new Map(
    [...bound].flatMap(([role, list]) =>
      list.length > 0 ? [[role, list[0]!.name] as const] : [],
    ),
  );
  /** A type written in the pattern: {Role} is the role's (first) element. */
  const typeOf = (text: string | undefined): unknown => {
    if (text === undefined) return undefined;
    const role = ROLE_REF.exec(text)?.[1];
    if (role !== undefined) {
      const first = bound.get(role)?.[0];
      if (first) return { $ref: first.node.ref };
    }
    return fill(text, names);
  };

  for (const { name: roleName } of pattern.roles) {
    for (const { node, name, role } of bound.get(roleName)!) {
      const doc =
        role.documentation !== undefined &&
        (node.elem === null || !node.elem.documentation)
          ? fill(role.documentation, names)
          : undefined;
      const props = {
        ...role.properties,
        ...(role.stereotype !== undefined && { stereotype: role.stereotype }),
        ...(doc !== undefined && { documentation: doc }),
      };
      if (Object.keys(props).length > 0) {
        if (node.elem) p.update(node.elem, props, node.path);
        else setOnNew(p, node, props);
      }
      for (const a of role.attributes ?? [])
        attribute(p, node, a, typeOf, names);
      for (const o of role.operations ?? [])
        operation(p, node, o, typeOf, name, names);
    }
  }

  const edges: Node[] = [];
  for (const r of pattern.relationships) {
    // The library test holds every relationship to roles of its pattern.
    const froms = bound.get(r.from)!;
    const tos = bound.get(r.to)!;
    for (const from of froms) {
      for (const to of tos) {
        const type = relationType(r.type, from.role.type, to.role.type);
        edges.push(relationship(p, { ...r, type }, from.node, to.node));
      }
    }
  }

  const roles = Object.fromEntries(
    [...bound].map(([role, list]) => [
      role,
      list.map((b) => ({
        ref: b.node.ref,
        path: b.node.path,
        created: b.created,
      })),
    ]),
  );
  const ops = [...p.ops];
  let diagram: string | undefined;
  if (options.diagram) {
    const shown = pattern.roles.flatMap((role) =>
      bound.get(role.name)!.map((b) => ({ node: b.node, type: b.role.type })),
    );
    diagram = classDiagram(
      ops,
      options.parent,
      options.diagram,
      shown,
      edges,
      p.created.length > 0,
    );
  }
  let sequenceDiagram: string | undefined;
  if (options.sequence) {
    if (!pattern.sequence) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `sequence: ${pattern.name} has no sequence`,
      );
    }
    const who = (x: string) => names.get(x) ?? x;
    const spec = {
      participants: pattern.sequence.participants.map(who),
      messages: pattern.sequence.messages.map((m) => ({
        from: who(m.from),
        to: who(m.to),
        text: m.text,
      })),
    };
    const built = opsFor(
      planFor("sequence", spec),
      {
        diagram: null,
        parent: options.parent,
        name: `${pattern.name} sequence`,
      },
      "TB",
      false,
    );
    ops.push(...built.ops);
    sequenceDiagram = "$diagram";
  }
  return {
    ops,
    planner: p,
    roles,
    warnings,
    ...(diagram && { diagram }),
    ...(sequenceDiagram && { sequenceDiagram }),
  };
}

/** Properties for an element the plan makes: set right after it, as updates of "$name". */
function setOnNew(p: Planner, node: Node, props: Record<string, unknown>) {
  for (const [field, value] of Object.entries(props)) {
    p.ops.push({
      path: "/update_element",
      body: { ref: node.ref, field, value },
    });
    p.properties.push({ path: node.path, field, value });
  }
}

function attribute(
  p: Planner,
  owner: Node,
  a: PatternAttribute,
  typeOf: (t: string | undefined) => unknown,
  names: ReadonlyMap<string, string>,
) {
  const { name, type, defaultValue, ...rest } = a;
  const props = {
    ...rest,
    ...(type !== undefined && { type: typeOf(type) }),
    ...(defaultValue !== undefined && {
      defaultValue: fill(defaultValue, names),
    }),
  };
  p.attribute(owner, name, props);
}

function operation(
  p: Planner,
  owner: Node,
  o: PatternOperation,
  typeOf: (t: string | undefined) => unknown,
  self: string,
  names: ReadonlyMap<string, string>,
) {
  const { name, parameters, returnType, ...props } = o;
  // A constructor is named after its class, whatever the role is called.
  const opName = ROLE_REF.test(name) ? self : fill(name, names);
  p.operation(
    owner,
    opName,
    props,
    (parameters ?? []).map((x) => ({
      name: x.name,
      ...(x.type !== undefined && { type: typeOf(x.type) }),
      ...(x.direction !== undefined && { direction: x.direction }),
    })),
    typeOf(returnType),
    true,
  );
}

function relationship(
  p: Planner,
  r: PatternRelationship,
  from: Node,
  to: Node,
) {
  const properties =
    r.stereotype !== undefined
      ? { properties: { stereotype: r.stereotype } }
      : {};
  if (r.type in ASSOCIATIONS) {
    const aggregation = ASSOCIATIONS[r.type];
    return p.relationship("UMLAssociation", from, to, {
      ...properties,
      tailEnd: {
        ...r.fromEnd,
        ...(aggregation !== undefined && { aggregation }),
      },
      headEnd: { ...r.toEnd },
    });
  }
  const type = {
    generalization: "UMLGeneralization",
    realization: "UMLInterfaceRealization",
    dependency: "UMLDependency",
  }[r.type as "generalization" | "realization" | "dependency"];
  return p.relationship(type, from, to, properties);
}

/**
 * Views of the bound elements and their relationships on a class diagram:
 * the given one, or a new one under the parent; laid out as a hierarchy
 * when anything is new.
 */
function classDiagram(
  ops: ModelOp[],
  parent: Element,
  target: { existing: Element | null; name: string },
  nodes: { node: Node; type: string }[],
  edges: Node[],
  changed: boolean,
): string {
  const diagram = target.existing?._id ?? "$pdiagram";
  if (!target.existing) {
    ops.push({
      path: "/create_diagram",
      as: "pdiagram",
      body: { type: "UMLClassDiagram", parent: parent._id, name: target.name },
    });
  }
  const shown = new Set(
    ((target.existing?.ownedViews ?? []) as Element[]).map((v) => v.model),
  );
  let added = 0;
  nodes.forEach(({ node, type }, i) => {
    if (node.elem && shown.has(node.elem)) return;
    added++;
    const as = `pv${i}`;
    ops.push({
      path: "/create_view_of",
      as,
      body: {
        ref: node.ref,
        diagram,
        x: 40 + (i % 4) * 240,
        y: 40 + Math.floor(i / 4) * 200,
      },
    });
    // As build_diagram shows them: every element by its plain name, an
    // interface as a box with its operations rather than a lollipop.
    ops.push({
      path: "/update_element",
      body: { ref: `$${as}.view`, field: "showNamespace", value: false },
    });
    if (type === "UMLInterface") {
      ops.push(
        {
          path: "/update_element",
          body: {
            ref: `$${as}.view`,
            field: "suppressOperations",
            value: false,
          },
        },
        {
          path: "/set_view_style",
          body: { refs: [`$${as}.view`], stereotypeDisplay: "label" },
        },
      );
    }
  });
  // Showing an element draws its relationships to those already shown;
  // one between two elements shown before is drawn here. An edge already
  // drawn answers its view unchanged.
  for (const edge of edges) {
    if (edge.elem && shown.has(edge.elem)) continue;
    ops.push({ path: "/create_view_of", body: { ref: edge.ref, diagram } });
  }
  if (added > 0 || changed) {
    ops.push({
      path: "/layout_diagram",
      body: { diagram, preset: "hierarchy-down" },
    });
  }
  return diagram;
}
