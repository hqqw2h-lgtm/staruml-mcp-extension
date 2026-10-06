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

/*
 * The shape of a design pattern as data (issue #30): roles bound to model
 * elements, the UML properties each role's element and members get, the
 * relationships between roles with the properties of their ends, and the
 * checks uml_lint holds a detected instance to. src/patterns/library holds
 * one JSON file per pattern; pattern.schema.json is this schema as JSON
 * Schema, which the files name in $schema.
 */

const name = () => z.string().check(z.minLength(1));

/** "{Role}" stands for the element bound to that role (its first, for many). */
const typeText = (what: string) =>
  doc(
    z.string().check(z.minLength(1)),
    `${what}: a type name, or {Role} for the element bound to that role.`,
  );

const visibility = () =>
  z.optional(z.enum(["public", "protected", "private", "package"]));

export const attributeSchema = () =>
  z.object({
    name: name(),
    type: z.optional(typeText("Type")),
    visibility: visibility(),
    isStatic: z.optional(z.boolean()),
    isReadOnly: z.optional(z.boolean()),
    isDerived: z.optional(z.boolean()),
    isID: z.optional(z.boolean()),
    multiplicity: z.optional(z.string()),
    defaultValue: z.optional(z.string()),
    documentation: z.optional(z.string()),
  });

export const parameterSchema = () =>
  z.object({
    name: name(),
    type: z.optional(typeText("Type")),
    direction: z.optional(z.enum(["in", "inout", "out"])),
  });

export const operationSchema = () =>
  z.object({
    name: doc(
      name(),
      "Operation name; {Role} names a constructor after the class.",
    ),
    visibility: visibility(),
    isStatic: z.optional(z.boolean()),
    isAbstract: z.optional(z.boolean()),
    isLeaf: z.optional(
      doc(z.boolean(), "Final: subclasses do not override it."),
    ),
    isQuery: z.optional(doc(z.boolean(), "Changes no state.")),
    stereotype: z.optional(doc(z.string(), "E.g. create for a constructor.")),
    parameters: z.optional(z.array(parameterSchema())),
    returnType: z.optional(typeText("Return type")),
    documentation: z.optional(z.string()),
  });

export const ELEMENT_TYPES = [
  "UMLClass",
  "UMLInterface",
  "UMLEnumeration",
] as const;

export const roleSchema = () =>
  z.object({
    name: name(),
    type: z.enum(ELEMENT_TYPES),
    cardinality: doc(
      z.enum(["1", "many"]),
      "many: the role binds a list of elements, e.g. every concrete strategy.",
    ),
    optional: z.optional(
      doc(z.boolean(), "Made only when bound; its relationships likewise."),
    ),
    description: z.string(),
    properties: z.optional(
      doc(
        z.object({
          isAbstract: z.optional(z.boolean()),
          isLeaf: z.optional(z.boolean()),
          isActive: z.optional(z.boolean()),
        }),
        "Properties of the bound element.",
      ),
    ),
    stereotype: z.optional(z.string()),
    documentation: z.optional(
      doc(
        z.string(),
        "Documentation template, {Role} replaced by bound names; set on elements without documentation.",
      ),
    ),
    attributes: z.optional(z.array(attributeSchema())),
    operations: z.optional(z.array(operationSchema())),
  });

const endSchema = () =>
  z.object({
    name: z.optional(z.string()),
    navigable: z.optional(z.enum(["unspecified", "navigable", "notNavigable"])),
    multiplicity: z.optional(z.string()),
  });

export const RELATIONSHIP_TYPES = [
  "association",
  "aggregation",
  "composition",
  "generalization",
  "realization",
  "dependency",
] as const;

export const relationshipSchema = () =>
  z.object({
    type: doc(
      z.enum(RELATIONSHIP_TYPES),
      "aggregation and composition: from is the whole, whose end (end1) gets the diamond; generalization: from is the specific; realization: from implements to; dependency: from uses to.",
    ),
    from: name(),
    to: name(),
    stereotype: z.optional(z.string()),
    fromEnd: z.optional(endSchema()),
    toEnd: z.optional(endSchema()),
  });

export const checkSchema = () =>
  z.object({
    id: name(),
    role: name(),
    member: z.optional(
      doc(
        name(),
        "An attribute or operation of the role's element, by name or {Role}.",
      ),
    ),
    members: z.optional(
      doc(
        z.enum(["attributes", "operations"]),
        "Every attribute or operation.",
      ),
    ),
    relationship: z.optional(
      doc(
        z.int().check(z.minimum(0)),
        "Index in relationships; with end, an end of it.",
      ),
    ),
    end: z.optional(z.enum(["from", "to"])),
    property: name(),
    equals: z.union([z.string(), z.boolean()]),
    message: name(),
  });

const variantSchema = () =>
  z.object({
    description: z.string(),
    roles: z.optional(
      doc(
        z.record(z.string(), z.partial(roleSchema())),
        "Role fields that replace the pattern's, by role name.",
      ),
    ),
    relationships: z.optional(
      doc(
        z.array(relationshipSchema()),
        "Replaces the pattern's relationships.",
      ),
    ),
  });

export const patternSchema = () =>
  z.object({
    $schema: z.optional(z.string()),
    name: name(),
    category: z.enum(["creational", "structural", "behavioral", "domain"]),
    intent: name(),
    alsoKnownAs: z.optional(z.array(z.string())),
    roles: z.array(roleSchema()).check(z.minLength(1)),
    relationships: z.array(relationshipSchema()),
    sequence: z.optional(
      doc(
        z.object({
          participants: z.array(name()),
          messages: z.array(
            z.object({ from: name(), to: name(), text: z.string() }),
          ),
        }),
        "Messages of a sequence diagram of the pattern; participants are role names or other lifelines such as Client.",
      ),
    ),
    variants: z.optional(z.record(z.string(), variantSchema())),
    checks: z.optional(z.array(checkSchema())),
  });

export type Pattern = z.output<ReturnType<typeof patternSchema>>;
export type Role = z.output<ReturnType<typeof roleSchema>>;
export type PatternRelationship = z.output<
  ReturnType<typeof relationshipSchema>
>;
export type PatternAttribute = z.output<ReturnType<typeof attributeSchema>>;
export type PatternOperation = z.output<ReturnType<typeof operationSchema>>;
export type PatternCheck = z.output<ReturnType<typeof checkSchema>>;
