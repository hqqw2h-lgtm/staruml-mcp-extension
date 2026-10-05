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
import { candidate, escapeName } from "../refs.js";
import type { Element } from "../types.js";

/*
 * Plans model changes as /batch ops against what the repository holds:
 * owned elements matched by type and name, members by name, relationships
 * by type, ends and name. A match is updated where its values differ; what
 * has no match is made. /build_model and /apply_pattern plan with it, so a
 * dry run lists the exact ops applying runs.
 */

export interface ModelOp {
  path: string;
  body: Record<string, unknown>;
  as?: string;
}

export interface Change {
  path: string;
  type: string;
  /** Updated: the attributes the update sets. */
  fields?: string[];
}

/** One attribute value the plan sets, on a new element or a changed one. */
export interface PropertyChange {
  path: string;
  field: string;
  value: unknown;
}

/** An element of the plan: existing (elem set, ref its id) or to be made. */
export interface Node {
  ref: string;
  elem: Element | null;
  path: string;
}

export interface ParameterProps {
  name: string;
  type?: unknown;
  direction?: string;
  multiplicity?: string;
}

const OPERATION_FIELDS = new Set([
  "visibility",
  "isStatic",
  "isAbstract",
  "isQuery",
  "specification",
  "documentation",
]);

export const list = (value: unknown) =>
  Array.isArray(value) ? (value as Element[]) : [];

const isRef = (v: unknown): v is { $ref: string } =>
  typeof v === "object" && v !== null && "$ref" in v;

/** Whether an element's value already is what the plan asks for. */
export function same(current: unknown, wanted: unknown): boolean {
  if (isRef(wanted)) {
    return (current as Element | null | undefined)?._id === wanted.$ref;
  }
  if (typeof wanted === "string" && current && typeof current === "object") {
    // A type given as text matches a classifier of that name.
    return (current as Element).name === wanted;
  }
  return current === wanted;
}

export const childPath = (owner: string, name: string, sep = "/") =>
  owner ? `${owner}${sep}${escapeName(name)}` : escapeName(name);

/** The relationship of `type` and `name` from `tail` to `head`, if there is one. */
export function findRelationship(
  type: string,
  tail: Element,
  head: Element,
  name: string,
  claimed: ReadonlySet<Element>,
): Element | undefined {
  return app.repository.getRelationshipsOf(tail).find((r) => {
    if (claimed.has(r) || r.constructor.name !== type) return false;
    const [from, to] =
      "source" in r
        ? [r.source, r.target]
        : [(r.end1 as Element).reference, (r.end2 as Element).reference];
    return r.name === name && from === tail && to === head;
  });
}

export class Planner {
  readonly ops: ModelOp[] = [];
  readonly created: Change[] = [];
  readonly updated: Change[] = [];
  readonly properties: PropertyChange[] = [];
  readonly refs = new Map<string, string>();
  unchanged = 0;
  private n = 0;
  /** Existing elements already matched, so two specs never take one. */
  private readonly claimed = new Set<Element>();

  /**
   * `upsert` false refuses an owned element that exists (DUPLICATE_NAME);
   * members and relationships of existing elements are always matched.
   */
  constructor(private readonly upsert: boolean) {}

  private alias(): string {
    return `m${this.n++}`;
  }

  private claim<T extends Element | undefined>(elem: T): T {
    if (elem) this.claimed.add(elem);
    return elem;
  }

  private record(path: string, props: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(props)) {
      this.properties.push({ path, field, value });
    }
  }

  /** Sets what differs on an existing element. */
  update(elem: Element, props: Record<string, unknown>, path: string): void {
    const fields = Object.keys(props).filter((k) => !same(elem[k], props[k]));
    if (fields.length === 0) {
      this.unchanged++;
      return;
    }
    for (const field of fields) {
      this.ops.push({
        path: "/update_element",
        body: { ref: elem._id, field, value: props[field] },
      });
      this.properties.push({ path, field, value: props[field] });
    }
    this.updated.push({ path, type: elem.constructor.name, fields });
  }

  private existing(
    owner: Node,
    field: string,
    test: (e: Element) => boolean,
  ): Element | undefined {
    return list(owner.elem?.[field]).find(
      (e) => !this.claimed.has(e) && test(e),
    );
  }

  /** An element owned by `owner`, matched by type and name, made when missing. */
  element(
    owner: Node,
    type: string,
    name: string,
    props: Record<string, unknown>,
    field = "ownedElements",
    extra: (e: Element) => boolean = () => true,
    fields?: string[],
  ): Node {
    const path = childPath(owner.path, name);
    const found = this.claim(
      this.existing(
        owner,
        field,
        (e) => e.constructor.name === type && e.name === name && extra(e),
      ),
    );
    if (found) {
      if (!this.upsert) {
        throw new ApiError(
          "DUPLICATE_NAME",
          `${path} exists; pass upsert: true to update it`,
          { existing: candidate(found) },
        );
      }
      this.update(found, props, path);
      return { ref: found._id, elem: found, path };
    }
    return this.make(owner, type, name, props, field, path, fields);
  }

  /** A new owned element, whatever its owner holds already. */
  make(
    owner: Node,
    type: string,
    name: string,
    props: Record<string, unknown>,
    field = "ownedElements",
    path = childPath(owner.path, name),
    fields?: string[],
  ): Node {
    const as = this.alias();
    this.ops.push({
      path: "/create_element",
      as,
      body: {
        type,
        parent: owner.ref,
        name,
        field,
        ...(Object.keys(props).length > 0 && { properties: props }),
        ...(fields && { fields: ["_parent", ...fields] }),
      },
    });
    this.created.push({ path, type });
    this.record(path, props);
    return { ref: `$${as}`, elem: null, path };
  }

  /** An attribute of `owner` by name, with `props` set. */
  attribute(
    owner: Node,
    name: string,
    props: Record<string, unknown>,
    field = "attributes",
  ): Node {
    const path = childPath(owner.path, name, ".");
    const found = this.claim(
      this.existing(owner, field, (e) => e.name === name),
    );
    if (found) {
      this.update(found, props, path);
      return { ref: found._id, elem: found, path };
    }
    const as = this.alias();
    this.ops.push({
      path: "/add_attribute",
      as,
      body: { ref: owner.ref, name, ...props },
    });
    this.created.push({ path, type: "UMLAttribute" });
    this.record(path, props);
    return { ref: `$${as}`, elem: null, path };
  }

  /**
   * An operation of `owner` by name with `props` set. A new one is made
   * with its parameters and return type; an existing one gains the
   * parameters it lacks and has theirs set when `syncParameters`.
   */
  operation(
    owner: Node,
    name: string,
    props: Record<string, unknown>,
    parameters: readonly ParameterProps[] = [],
    returnType?: unknown,
    syncParameters = false,
  ): Node {
    const types = parameters.map((p) =>
      typeof p.type === "string" ? p.type : "",
    );
    const path = `${owner.path}#${escapeName(name)}(${types.map(escapeName).join(", ")})`;
    const found = this.claim(
      this.existing(owner, "operations", (e) => e.name === name),
    );
    if (found) {
      this.update(found, props, path);
      if (syncParameters) {
        const node = { ref: found._id, elem: found, path };
        for (const p of parameters) {
          const { name: param, ...rest } = p;
          this.member(node, "parameters", param, rest, "/add_parameter");
        }
        if (returnType !== undefined) {
          const ret = list(found.parameters).find(
            (x) => x.direction === "return",
          );
          if (ret) this.update(ret, { type: returnType }, `${path}.return`);
          else {
            this.ops.push({
              path: "/add_parameter",
              body: {
                ref: found._id,
                name: "",
                type: returnType,
                direction: "return",
              },
            });
            this.created.push({ path: `${path}.return`, type: "UMLParameter" });
            this.record(`${path}.return`, { type: returnType });
          }
        }
      }
      return { ref: found._id, elem: found, path };
    }
    // /add_operation takes these as fields of its own and the rest (isLeaf,
    // stereotype, ...) in properties.
    const typed = Object.fromEntries(
      Object.entries(props).filter(([k]) => OPERATION_FIELDS.has(k)),
    );
    const rest = Object.fromEntries(
      Object.entries(props).filter(([k]) => !OPERATION_FIELDS.has(k)),
    );
    const as = this.alias();
    this.ops.push({
      path: "/add_operation",
      as,
      body: {
        ref: owner.ref,
        name,
        ...typed,
        ...(Object.keys(rest).length > 0 && { properties: rest }),
        ...(parameters.length > 0 && { parameters }),
        ...(returnType !== undefined && { returnType }),
      },
    });
    this.created.push({ path, type: "UMLOperation" });
    this.record(path, {
      ...props,
      ...(returnType !== undefined && { returnType }),
    });
    for (const p of parameters) {
      const { name: param, ...rest } = p;
      this.record(childPath(path, param, "."), rest);
    }
    return { ref: `$${as}`, elem: null, path };
  }

  /** A named part of an existing element made with `endpoint` when missing. */
  private member(
    owner: Node,
    field: string,
    name: string,
    props: Record<string, unknown>,
    endpoint: string,
  ): void {
    const path = childPath(owner.path, name, ".");
    const found = this.claim(
      this.existing(owner, field, (e) => e.name === name),
    );
    if (found) {
      this.update(found, props, path);
      return;
    }
    this.ops.push({ path: endpoint, body: { ref: owner.ref, name, ...props } });
    this.created.push({ path, type: "UMLParameter" });
    this.record(path, props);
  }

  literal(owner: Node, name: string): void {
    const found = this.claim(
      this.existing(owner, "literals", (e) => e.name === name),
    );
    if (found) {
      this.unchanged++;
      return;
    }
    this.ops.push({
      path: "/add_enumeration_literal",
      body: { ref: owner.ref, name },
    });
    this.created.push({
      path: childPath(owner.path, name, "."),
      type: "UMLEnumerationLiteral",
    });
  }

  /**
   * A model-only relationship, unless the same one already joins the ends;
   * an existing one has its ends and properties set where they differ.
   */
  relationship(
    type: string,
    tail: Node,
    head: Node,
    more: {
      name?: string;
      tailEnd?: Record<string, unknown>;
      headEnd?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    } = {},
  ): Node {
    const path = `${tail.path} -> ${head.path}`;
    const found =
      tail.elem && head.elem
        ? this.claim(
            findRelationship(
              type,
              tail.elem,
              head.elem,
              more.name ?? "",
              this.claimed,
            ),
          )
        : undefined;
    if (found) {
      const before = this.updated.length;
      const unchanged = this.unchanged;
      this.update(found, more.properties ?? {}, path);
      if (more.tailEnd)
        this.update(found.end1 as Element, more.tailEnd, `${path}.end1`);
      if (more.headEnd)
        this.update(found.end2 as Element, more.headEnd, `${path}.end2`);
      // The relationship counts once, changed or not.
      this.unchanged = unchanged + (this.updated.length === before ? 1 : 0);
      return { ref: found._id, elem: found, path };
    }
    const as = this.alias();
    this.ops.push({
      path: "/create_relationship",
      as,
      body: {
        type,
        tail: tail.ref,
        head: head.ref,
        ...(more.name !== undefined && { name: more.name }),
        ...(more.properties && { properties: more.properties }),
        ...(more.tailEnd && { tailEnd: more.tailEnd }),
        ...(more.headEnd && { headEnd: more.headEnd }),
      },
    });
    this.created.push({ path, type });
    this.record(path, more.properties ?? {});
    this.record(`${path}.end1`, more.tailEnd ?? {});
    this.record(`${path}.end2`, more.headEnd ?? {});
    return { ref: `$${as}.model`, elem: null, path };
  }
}
