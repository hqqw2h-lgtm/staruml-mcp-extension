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

import type { Pattern, PatternRelationship, Role } from "./schema.js";

/*
 * A role bound to an element of another metaclass than the pattern names
 * (issue #40): /apply_pattern and /detect_patterns read the role the same
 * adapted way, so detection scores 1 for what applying built.
 *
 * An abstract class role may be played by an interface (UML 2.5.1 §10.4:
 * an interface is an abstract classifier) when the role has no concrete
 * behaviour of its own to keep: its operations become abstract and public
 * (§10.4.3, an interface's features are public) and a class specialising
 * it realizes it instead (§10.4.4). An interface role may be played by a
 * class, which is then made abstract and is specialised, not realized.
 * Anything else is refused: a concrete class role is instantiated by the
 * pattern, and an enumeration plays no class or interface role.
 */

/** A role as an element of metaclass `type` plays it, or why it cannot. */
export function adaptRole(
  pattern: Pattern,
  role: Role,
  type: string,
): Role | string {
  if (type === role.type) return role;
  if (role.type === "UMLClass" && type === "UMLInterface") {
    if (role.properties?.isAbstract !== true) {
      return `${role.name} is a concrete class in ${pattern.name}, which the pattern instantiates; bind a class`;
    }
    const ops = role.operations ?? [];
    if (
      ops.some((o) => o.isAbstract === true) &&
      ops.some((o) => o.isAbstract !== true)
    ) {
      return `${role.name} keeps concrete operations next to abstract ones in ${pattern.name}, which an interface cannot hold; bind a class`;
    }
    const { isAbstract: _abstract, ...properties } = role.properties;
    return {
      ...role,
      type: "UMLInterface",
      ...(Object.keys(properties).length > 0
        ? { properties }
        : { properties: undefined }),
      operations: ops.map((o) => ({
        ...o,
        isAbstract: true,
        ...(o.visibility !== undefined && { visibility: "public" as const }),
      })),
    };
  }
  if (role.type === "UMLInterface" && type === "UMLClass") {
    return {
      ...role,
      type: "UMLClass",
      properties: { ...role.properties, isAbstract: true },
    };
  }
  return `${role.name} is a ${role.type} in ${pattern.name}; a ${type} cannot play it`;
}

/** The transformation `adaptRole` made, said once per element. */
export function adaptation(
  pattern: Pattern,
  role: Role,
  type: string,
  path: string,
): string {
  return role.type === "UMLClass"
    ? `${role.name} is an abstract class in ${pattern.name}; ${path} is a ${type}: its operations are abstract and public, and generalizations to it are realizations`
    : `${role.name} is an interface in ${pattern.name}; ${path} is a ${type}: it is made abstract, and realizations of it are generalizations`;
}

/**
 * The relationship a pattern's generalization or realization becomes
 * between elements of these metaclasses: a class realizes an interface
 * and specialises a class; interfaces specialise each other.
 */
export function relationType(
  written: PatternRelationship["type"],
  from: string,
  to: string,
): PatternRelationship["type"] {
  if (written !== "generalization" && written !== "realization") {
    return written;
  }
  return to === "UMLInterface" && from !== "UMLInterface"
    ? "realization"
    : "generalization";
}
