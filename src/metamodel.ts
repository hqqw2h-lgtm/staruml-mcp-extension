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

import { ApiError } from "./errors.js";
import type { Element, MetaAttribute } from "./types.js";

/*
 * Queries over the `meta` global, which MetamodelManager.register fills from
 * the metamodel.json of the core and of every loaded extension
 * (core/metamodel-manager.js, extensibility/extension-loader.js in 7.1.1).
 */

export function isMetaClass(name: string): boolean {
  return Object.hasOwn(meta, name) && meta[name]!.kind === "class";
}

/** The type and its ancestors, nearest first. */
export function lineage(name: string): string[] {
  const out: string[] = [];
  for (let t: string | undefined = name; t; t = meta[t]?.super) out.push(t);
  return out;
}

export function attributeOf(
  typeName: string,
  name: string,
): MetaAttribute | undefined {
  return app.metamodels
    .getMetaAttributes(typeName)
    .find((attr) => attr.name === name);
}

/**
 * The owner attribute a new `childType` goes into: the owner's obj/objs
 * attribute with the most specific type the child is a kind of, so a
 * UMLAttribute lands in `attributes` and a UMLMessage in `messages` rather
 * than in the catch-all `ownedElements` (typed Element). The model explorer
 * files elements the same way.
 */
export function ownerField(owner: Element, childType: string): string | null {
  let best: { name: string; depth: number } | null = null;
  for (const attr of app.metamodels.getMetaAttributes(owner.constructor.name)) {
    if (attr.kind !== "objs" || !app.metamodels.isKindOf(childType, attr.type))
      continue;
    const depth = lineage(attr.type).length;
    if (!best || depth > best.depth) best = { name: attr.name, depth };
  }
  return best?.name ?? null;
}

/**
 * `field`, which must be an owner list typed for `childType`, else the field
 * ownerField picks. Factory.createModel and Engine.addModel only log for a
 * missing field and insert into any array without a type check.
 */
export function resolveOwnerField(
  owner: Element,
  childType: string,
  field: string | undefined,
): string {
  const ownerType = owner.constructor.name;
  if (field === undefined) {
    const chosen = ownerField(owner, childType);
    if (!chosen) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${ownerType} has no list that holds ${childType}`,
      );
    }
    return chosen;
  }
  const attr = attributeOf(ownerType, field);
  if (!attr || attr.kind !== "objs") {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${ownerType} has no owned-element list '${field}'`,
    );
  }
  if (!app.metamodels.isKindOf(childType, attr.type)) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${ownerType}.${field} holds ${attr.type}, not ${childType}`,
    );
  }
  return field;
}

export type RelationshipKind = "directed" | "undirected";

/** Directed relationships hold source/target, undirected ones end1/end2 (core metamodel). */
export function relationshipKind(typeName: string): RelationshipKind | null {
  if (app.metamodels.isKindOf(typeName, "DirectedRelationship"))
    return "directed";
  if (app.metamodels.isKindOf(typeName, "UndirectedRelationship"))
    return "undirected";
  return null;
}
