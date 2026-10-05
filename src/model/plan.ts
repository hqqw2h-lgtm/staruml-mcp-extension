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

import { ApiError } from "../errors.js";
import type { AttributeSpec, OperationSpec } from "../build/members.js";
import { type Change, type ModelOp, type Node, Planner } from "./planner.js";
import { uniqueNames } from "../build/spec.js";
import { pathOf, tryResolve } from "../refs.js";
import type { Element } from "../types.js";
import type {
  ClassSpec,
  CollaborationSpec,
  LifecycleSpec,
  MessageKind,
  ModelSpec,
  RelationSpec,
  StateType,
} from "./spec.js";

/*
 * Turns a /build_model spec into the /batch ops that make or update the
 * model, without views: one undo step, and with dryRun the same ops
 * listed instead of run. Existing elements are matched by owner, type and
 * name, members by name, relationships by type, ends and name; upsert
 * updates what differs and adds what is missing.
 */

export type { Change, ModelOp } from "./planner.js";

export interface ModelPlan {
  ops: ModelOp[];
  created: Change[];
  updated: Change[];
  unchanged: number;
  /** Ids (or "$name" placeholders) of the containers and classifiers, by path. */
  refs: Map<string, string>;
  root: { ref: string; path: string };
}

const CLASS_TYPES = {
  class: "UMLClass",
  abstract: "UMLClass",
  interface: "UMLInterface",
  enum: "UMLEnumeration",
} as const;

const MESSAGE_SORTS: Record<MessageKind, string> = {
  sync: "synchCall",
  async: "asynchCall",
  reply: "reply",
  create: "createMessage",
  delete: "deleteMessage",
};

const STATE_TYPES: Record<StateType, [type: string, kind?: string]> = {
  state: ["UMLState"],
  initial: ["UMLPseudostate", "initial"],
  final: ["UMLFinalState"],
  choice: ["UMLPseudostate", "choice"],
  fork: ["UMLPseudostate", "fork"],
  join: ["UMLPseudostate", "join"],
};

/** A message's operation name: "save(entity)" calls save; prose calls nothing. */
export function calledName(text: string): string | null {
  const name = text.replace(/\(.*$/s, "").trim();
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
}

function attributeProps(a: AttributeSpec, type: unknown) {
  return {
    ...(type !== undefined && { type }),
    ...(a.visibility !== undefined && { visibility: a.visibility }),
    ...(a.isStatic !== undefined && { isStatic: a.isStatic }),
    ...(a.multiplicity !== undefined && { multiplicity: a.multiplicity }),
    ...(a.defaultValue !== undefined && { defaultValue: a.defaultValue }),
  };
}

function operationProps(o: OperationSpec) {
  return {
    ...(o.visibility !== undefined && { visibility: o.visibility }),
    ...(o.isStatic !== undefined && { isStatic: o.isStatic }),
    ...(o.isAbstract !== undefined && { isAbstract: o.isAbstract }),
  };
}

/** Ends of an association a relationship word makes. */
function associationEnds(r: RelationSpec) {
  const end = (multiplicity?: string, role?: string) => ({
    ...(multiplicity !== undefined && { multiplicity }),
    ...(role !== undefined && { name: role }),
  });
  const tail = end(r.fromMultiplicity, r.fromRole);
  const head = end(r.toMultiplicity, r.toRole);
  switch (r.type) {
    case "owns":
      return {
        tailEnd: { ...tail, aggregation: "composite" },
        headEnd: { ...head, navigable: "navigable" },
      };
    case "has":
      return {
        tailEnd: { ...tail, aggregation: "shared" },
        headEnd: { ...head, navigable: "navigable" },
      };
    case "knows":
      return {
        tailEnd: { ...tail, navigable: "notNavigable" },
        headEnd: { ...head, navigable: "navigable" },
      };
    default:
      return {
        ...(Object.keys(tail).length > 0 && { tailEnd: tail }),
        ...(Object.keys(head).length > 0 && { headEnd: head }),
      };
  }
}

const DIRECTED: Partial<Record<RelationSpec["type"], string>> = {
  uses: "UMLDependency",
  isA: "UMLGeneralization",
  implements: "UMLInterfaceRealization",
};

/** Packages owners first, refusing an undeclared parent or a loop. */
function packagesInOrder(spec: ModelSpec) {
  const byKey = new Map<string, ModelSpec["packages"][number]>();
  for (const p of spec.packages) {
    byKey.set(p.key, p);
    if (!byKey.has(p.name)) byKey.set(p.name, p);
  }
  const out: ModelSpec["packages"] = [];
  const state = new Map<string, "open" | "done">();
  const visit = (p: ModelSpec["packages"][number], i: number) => {
    if (state.get(p.key) === "done") return;
    if (state.get(p.key) === "open") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.packages.${i}.parent: ${p.name} would be nested in itself`,
      );
    }
    state.set(p.key, "open");
    if (p.parent !== undefined) {
      const parent = byKey.get(p.parent);
      if (!parent) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.packages.${i}.parent: no package ${p.parent}`,
        );
      }
      visit(parent, spec.packages.indexOf(parent));
    }
    state.set(p.key, "done");
    out.push(p);
  };
  spec.packages.forEach((p, i) => visit(p, i));
  return { ordered: out, byKey };
}

export interface PlanOptions {
  /** Owner of the model; the project by default. */
  parent: Element;
  upsert: boolean;
}

/** The ops making `spec` under `options.parent`, and what they change. */
export function planModel(spec: ModelSpec, options: PlanOptions): ModelPlan {
  const p = new Planner(options.upsert);
  const parentPath = pathOf(options.parent) ?? "";
  const parent: Node = {
    ref: options.parent._id,
    elem: options.parent,
    path: parentPath,
  };
  const root = p.element(parent, "UMLModel", spec.name, {
    ...(spec.documentation !== undefined && {
      documentation: spec.documentation,
    }),
  });
  p.refs.set(root.path, root.ref);

  // Packages.
  const { ordered, byKey } = packagesInOrder(spec);
  const packages = new Map<string, Node>();
  for (const pkg of ordered) {
    const owner =
      pkg.parent === undefined
        ? root
        : packages.get(byKey.get(pkg.parent)!.key)!;
    const node = p.element(owner, "UMLPackage", pkg.name, {
      ...(pkg.documentation !== undefined && {
        documentation: pkg.documentation,
      }),
      ...(pkg.stereotype !== undefined && { stereotype: pkg.stereotype }),
    });
    packages.set(pkg.key, node);
    p.refs.set(node.path, node.ref);
  }
  const packageOf = (key: string | undefined, where: string): Node => {
    if (key === undefined) return root;
    const pkg = byKey.get(key);
    if (!pkg) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${where}: no package or context ${key}; declare it in spec.contexts or spec.packages`,
      );
    }
    return packages.get(pkg.key)!;
  };

  // Classifiers.
  const classes = new Map<string, { node: Node; spec: ClassSpec }>();
  spec.classes.forEach((c, i) => {
    if (classes.has(c.name)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.classes.${i}: ${c.name} is defined twice`,
      );
    }
    const node = p.element(
      packageOf(c.package, `spec.classes.${i}.context`),
      CLASS_TYPES[c.kind],
      c.name,
      {
        ...(c.kind === "abstract" && { isAbstract: true }),
        ...(c.stereotype !== undefined && { stereotype: c.stereotype }),
        ...(c.documentation !== undefined && {
          documentation: c.documentation,
        }),
        ...(c.isLeaf !== undefined && { isLeaf: c.isLeaf }),
        ...(c.isActive !== undefined && { isActive: c.isActive }),
      },
    );
    classes.set(c.name, { node, spec: c });
    p.refs.set(node.path, node.ref);
  });
  const actors = new Map<string, Node>();
  for (const a of spec.actors) {
    const node = p.element(root, "UMLActor", a.name, {
      ...(a.documentation !== undefined && { documentation: a.documentation }),
    });
    actors.set(a.name, node);
    p.refs.set(node.path, node.ref);
  }
  const subjects = new Map<string, Node>();
  const useCases = new Map<string, Node>();
  for (const u of spec.useCases) {
    if (u.subject !== undefined && !subjects.has(u.subject)) {
      const node = p.element(root, "UMLUseCaseSubject", u.subject, {});
      subjects.set(u.subject, node);
      p.refs.set(node.path, node.ref);
    }
    const node = p.element(root, "UMLUseCase", u.name, {
      ...(u.documentation !== undefined && { documentation: u.documentation }),
    });
    useCases.set(u.name, node);
    p.refs.set(node.path, node.ref);
  }

  /**
   * A classifier the spec names (classes before actors, or actors first),
   * else one the model has at that path or name.
   */
  const lookup = (
    name: string,
    order: "class" | "actor" = "class",
  ): Node | undefined => {
    const inSpec =
      order === "class"
        ? [classes.get(name)?.node, actors.get(name)]
        : [actors.get(name), classes.get(name)?.node];
    const found = [...inSpec, useCases.get(name)].find((n) => n !== undefined);
    if (found) return found;
    const elem = tryResolve(name);
    return elem && elem instanceof type.UMLClassifier
      ? { ref: elem._id, elem, path: pathOf(elem)! }
      : undefined;
  };
  const classifier = (
    name: string,
    where: string,
    order: "class" | "actor" = "class",
  ): Node => {
    const found = lookup(name, order);
    if (!found) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${where}: no class, interface, actor or use case ${name} in the spec or the model`,
      );
    }
    return found;
  };
  /** A type written in a member: a classifier of the spec by name, else the text. */
  const typeOf = (text: string | undefined): unknown => {
    if (text === undefined) return undefined;
    const node = classes.get(text)?.node;
    return node ? { $ref: node.ref } : text;
  };

  // Members.
  const operations = new Map<string, Node>();
  for (const { node, spec: c } of classes.values()) {
    for (const a of c.attributes) {
      p.attribute(node, a.name, attributeProps(a, typeOf(a.type)));
    }
    for (const o of c.operations) {
      operations.set(
        `${c.name}#${o.name}`,
        p.operation(
          node,
          o.name,
          operationProps(o),
          (o.parameters ?? []).map((x) => ({
            name: x.name,
            ...(x.type !== undefined && { type: typeOf(x.type) }),
          })),
          typeOf(o.returnType),
        ),
      );
    }
    for (const l of c.literals) p.literal(node, l);
  }

  // Relationships.
  for (const [key, pkg] of byKey) {
    if (key !== pkg.key) continue;
    pkg.dependsOn.forEach((d, k) => {
      const target = byKey.get(d);
      if (!target) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.packages.${spec.packages.indexOf(pkg)}.dependsOn.${k}: no package ${d}`,
        );
      }
      p.relationship(
        "UMLDependency",
        packages.get(pkg.key)!,
        packages.get(target.key)!,
      );
    });
  }
  spec.relationships.forEach((r, i) => {
    const tail = classifier(r.from, `spec.relationships.${i}.from`);
    const head = classifier(r.to, `spec.relationships.${i}.to`);
    const directed = DIRECTED[r.type];
    if (directed) {
      p.relationship(directed, tail, head, {
        ...(r.name !== undefined && { name: r.name }),
      });
    } else {
      p.relationship("UMLAssociation", tail, head, {
        ...(r.name !== undefined && { name: r.name }),
        ...associationEnds(r),
      });
    }
  });
  spec.useCases.forEach((u, i) => {
    const node = useCases.get(u.name)!;
    u.actors.forEach((a, k) =>
      p.relationship(
        "UMLAssociation",
        classifier(a, `spec.useCases.${i}.actors.${k}`, "actor"),
        node,
      ),
    );
    u.includes.forEach((x, k) =>
      p.relationship(
        "UMLInclude",
        node,
        useCase(x, `spec.useCases.${i}.includes.${k}`),
      ),
    );
    u.extends.forEach((x, k) =>
      p.relationship(
        "UMLExtend",
        node,
        useCase(x, `spec.useCases.${i}.extends.${k}`),
      ),
    );
  });
  function useCase(name: string, where: string): Node {
    const node = useCases.get(name);
    if (!node) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${where}: no use case ${name} in the spec`,
      );
    }
    return node;
  }

  spec.collaborations.forEach((c, i) =>
    collaboration(p, c, `spec.collaborations.${i}`, {
      owner: packageOf(c.package, `spec.collaborations.${i}.context`),
      classifier: (name, actor) => {
        // tryResolve answers null for no element and throws only
        // AMBIGUOUS_REF; a participant named like several model elements
        // stays untyped rather than failing the build.
        try {
          return lookup(name, actor ? "actor" : "class");
        } catch {
          return undefined;
        }
      },
      operation: (receiver, called) => operations.get(`${receiver}#${called}`),
    }),
  );
  spec.lifecycles.forEach((l, i) =>
    lifecycle(
      p,
      l,
      `spec.lifecycles.${i}`,
      l.subject === undefined
        ? root
        : classifier(l.subject, `spec.lifecycles.${i}.subject`),
    ),
  );
  return {
    ops: p.ops,
    created: p.created,
    updated: p.updated,
    unchanged: p.unchanged,
    refs: p.refs,
    root: { ref: root.ref, path: root.path },
  };
}

interface Lookups {
  owner: Node;
  classifier: (name: string, actor: boolean) => Node | undefined;
  operation: (receiver: string, called: string) => Node | undefined;
}

/**
 * A collaboration holding an interaction, as StarUML's sequence diagram
 * factory makes them (sequenceDiagramFn, uml-factory.js 7.1.1): each
 * participant a role attribute of the collaboration, typed with its
 * classifier where the spec or model has one, and a lifeline representing
 * it; each message from lifeline to lifeline, with the receiver's
 * operation as its signature when the message names one.
 */
function collaboration(
  p: Planner,
  c: CollaborationSpec,
  where: string,
  find: Lookups,
): void {
  const collab = p.element(find.owner, "UMLCollaboration", c.name, {});
  p.refs.set(collab.path, collab.ref);
  const interaction = p.element(
    collab,
    "UMLInteraction",
    c.name,
    {},
    "ownedElements",
  );
  p.refs.set(interaction.path, interaction.ref);
  const lifelines = new Map<string, Node>();
  const typeNames = new Map<string, string>();
  for (const part of c.participants) {
    const typeNode = find.classifier(part.type ?? part.name, part.actor);
    if (part.type !== undefined && !typeNode) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${where}.participants: no classifier ${part.type} for ${part.name}`,
      );
    }
    if (typeNode) typeNames.set(part.name, part.type ?? part.name);
    const role = p.attribute(
      collab,
      part.name,
      typeNode ? { type: { $ref: typeNode.ref } } : {},
    );
    lifelines.set(
      part.name,
      p.element(
        interaction,
        "UMLLifeline",
        part.name,
        { represent: { $ref: role.ref } },
        "participants",
      ),
    );
  }
  for (const m of c.messages) {
    const called = calledName(m.text);
    const receiver = typeNames.get(m.to);
    const signature =
      called !== null && receiver !== undefined && m.kind !== "reply"
        ? find.operation(receiver, called)
        : undefined;
    p.relationship("UMLMessage", lifelines.get(m.from)!, lifelines.get(m.to)!, {
      name: m.text,
      properties: {
        messageSort: MESSAGE_SORTS[m.kind],
        ...(signature && { signature: { $ref: signature.ref } }),
      },
    });
  }
  const fragmentNames = uniqueNames(
    c.fragments.map((f) => f.guard || f.operator),
  );
  c.fragments.forEach((f, i) => {
    const fragment = p.element(
      interaction,
      "UMLCombinedFragment",
      fragmentNames[i]!,
      { interactionOperator: f.operator },
      "fragments",
    );
    const guards = [f.guard ?? "", ...f.operands];
    uniqueNames(guards.map((g) => g || f.operator)).forEach((name, k) =>
      p.element(
        fragment,
        "UMLInteractionOperand",
        name,
        { guard: guards[k] },
        "operands",
      ),
    );
  });
}

/**
 * A state machine with one region, as StarUML's statechart factory makes
 * it (statechartDiagramFn, uml-factory.js 7.1.1), owned by its subject;
 * a state with a parent sits in a region of that state.
 */
function lifecycle(
  p: Planner,
  l: LifecycleSpec,
  where: string,
  owner: Node,
): void {
  // StarUML's model function for a state machine makes its first region
  // (stateMachineFn, uml-factory.js 7.1.1), so a new machine's region is
  // that one rather than a second.
  const machine = p.element(
    owner,
    "UMLStateMachine",
    l.name,
    {},
    "ownedElements",
    undefined,
    ["regions"],
  );
  p.refs.set(machine.path, machine.ref);
  const regions = new Map<string, Node>();
  const first = (machine.elem?.regions as Element[] | undefined)?.[0];
  if (!machine.elem || first) {
    regions.set("", {
      ref: first?._id ?? `${machine.ref}.regions.0`,
      elem: first ?? null,
      path: `${machine.path}/`,
    });
  }
  const regionOf = (key: string | undefined, holder: Node): Node => {
    const known = regions.get(key ?? "");
    if (known) return known;
    const region = p.element(holder, "UMLRegion", "", {}, "regions");
    regions.set(key ?? "", region);
    return region;
  };
  const states = new Map<string, Node>();
  const byKey = new Map(l.states.map((s) => [s.key, s]));
  const visit = (key: string, i: number, seen: Set<string>): Node => {
    const known = states.get(key);
    if (known) return known;
    const s = byKey.get(key)!;
    if (seen.has(key)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${where}.states.${i}.parent: ${key} would be nested in itself`,
      );
    }
    seen.add(key);
    let holder = machine;
    if (s.parent !== undefined) {
      const parent = byKey.get(s.parent);
      if (!parent || parent.type !== "state") {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${where}.states.${i}.parent: no state ${s.parent}`,
        );
      }
      holder = visit(parent.key, l.states.indexOf(parent), seen);
    }
    const [type, kind] = STATE_TYPES[s.type];
    const node = p.element(
      regionOf(s.parent, holder),
      type,
      s.name,
      kind !== undefined ? { kind } : {},
      "vertices",
      (e) => kind === undefined || e.kind === kind,
    );
    states.set(key, node);
    return node;
  };
  l.states.forEach((s, i) => visit(s.key, i, new Set()));
  l.transitions.forEach((t, i) => {
    const end = (key: string, side: string) => {
      const node = states.get(key);
      if (!node) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${where}.transitions.${i}.${side}: no state ${key}`,
        );
      }
      return node;
    };
    const label = [
      t.trigger ?? "",
      t.effect !== undefined ? ` / ${t.effect}` : "",
    ]
      .join("")
      .trim();
    p.relationship("UMLTransition", end(t.from, "from"), end(t.to, "to"), {
      ...(label && { name: label }),
      ...(t.guard !== undefined && { properties: { guard: t.guard } }),
    });
  });
}
