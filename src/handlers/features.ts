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
import { createOwned, initialValues, instantiate } from "../create.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { inStarUML } from "../errors.js";
import { requireElement } from "../lookup.js";
import {
  ATTRIBUTE_VALUES_HELP,
  elementSchema,
  id,
  projectionShape,
  properties,
  reference,
  text,
  typeValue,
} from "../schemas.js";
import { serialize } from "../serialize.js";
import type { Element } from "../types.js";
import { settableAttribute, toModelValue } from "../values.js";

/*
 * Typed endpoints for the parts of a model element that StarUML edits in
 * place: features of classifiers, enumeration literals, template parameters,
 * slots, tags, stereotypes and documentation. Each creates the part with
 * Factory.createModel in the owner list StarUML keeps it in (UML metamodel,
 * extensions/essential/uml/metamodel.json in 7.1.1), so it appears in the
 * model explorer and on the owner's views like one added through the UI.
 */

// Literals of UMLVisibilityKind, UMLAggregationKind and UMLDirectionKind in
// the 7.1.1 UML metamodel; values are checked against the live metamodel too.
const visibility = () =>
  z.optional(
    doc(
      z.enum(["public", "protected", "private", "package"]),
      "Default public.",
    ),
  );
const aggregation = () =>
  z.optional(doc(z.enum(["none", "shared", "composite"]), "Default none."));
const direction = () =>
  z.optional(doc(z.enum(["in", "inout", "out", "return"]), "Default in."));

const flag = (description: string) => z.optional(doc(z.boolean(), description));
const str = (description: string) => z.optional(text(description));

/** Request fields that map one-to-one onto attributes of the created element. */
function pick(
  input: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) {
    if (input[name] !== undefined) out[name] = input[name];
  }
  return out;
}

const STRUCTURAL = [
  "type",
  "visibility",
  "multiplicity",
  "defaultValue",
  "isStatic",
  "isReadOnly",
  "isDerived",
  "isID",
  "aggregation",
  "documentation",
] as const;

const structuralShape = () => ({
  type: z.optional(
    typeValue(
      "A type name such as 'String', or {$ref: id} of a classifier in the model.",
    ),
  ),
  visibility: visibility(),
  multiplicity: str("E.g. '0..1', '1', '*', '1..*'."),
  defaultValue: str("Default value as text."),
  isStatic: flag("Class-level feature."),
  isReadOnly: flag("Read only."),
  isDerived: flag("Derived."),
  isID: flag("Part of the identity."),
  aggregation: aggregation(),
  documentation: str("Documentation text."),
  properties: properties(ATTRIBUTE_VALUES_HELP),
});

/** Initial values of a feature, from its typed request fields and `properties`. */
function featureValues(
  typeName: string,
  input: { name?: string; properties?: Record<string, unknown> },
  names: readonly string[],
): Record<string, unknown> {
  return initialValues(typeName, input.name, {
    ...input.properties,
    ...pick(input as Record<string, unknown>, names),
  });
}

export const addAttribute = defineEndpoint({
  path: "/add_attribute",
  description:
    "Add a UMLAttribute to a classifier (class, interface, data type, signal, ...).",
  readOnly: false,
  destructive: false,
  request: z.object({
    ownerId: id("Classifier id."),
    name: text("Attribute name."),
    ...structuralShape(),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLAttribute", input, STRUCTURAL);
    return serialize(
      createOwned(owner, "UMLAttribute", "attributes", values),
      input,
    );
  },
});

const PARAMETER = [
  "type",
  "direction",
  "multiplicity",
  "defaultValue",
  "isReadOnly",
  "documentation",
] as const;

const parameterShape = () => ({
  name: text("Parameter name."),
  type: z.optional(
    typeValue("A type name, or {$ref: id} of a classifier in the model."),
  ),
  direction: direction(),
  multiplicity: str("E.g. '0..1', '*'."),
  defaultValue: str("Default value as text."),
  isReadOnly: flag("Read only."),
  documentation: str("Documentation text."),
  properties: properties(ATTRIBUTE_VALUES_HELP),
});

const OPERATION = [
  "visibility",
  "isStatic",
  "isAbstract",
  "isQuery",
  "specification",
  "documentation",
] as const;

/**
 * Parameters, and the return type as a parameter with direction "return" (how
 * StarUML stores it, UMLOperation in the UML metamodel), are built inside the
 * operation's initializer so the whole operation is one undo step.
 */
export const addOperation = defineEndpoint({
  path: "/add_operation",
  description:
    "Add a UMLOperation with its parameters and return type to a classifier.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ownerId: id("Classifier id."),
    name: text("Operation name."),
    visibility: visibility(),
    isStatic: flag("Class-level operation."),
    isAbstract: flag("Abstract."),
    isQuery: flag("Does not change state."),
    specification: str("Body or specification text."),
    documentation: str("Documentation text."),
    parameters: z.optional(
      doc(z.array(z.object(parameterShape())), "In declaration order."),
    ),
    returnType: z.optional(
      typeValue(
        "Return type: a type name or {$ref: id}; stored as a parameter with direction 'return'.",
      ),
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLOperation", input, OPERATION);
    const parameters = [
      ...(input.parameters ?? []).map((p) =>
        featureValues("UMLParameter", p, PARAMETER),
      ),
      ...(input.returnType === undefined
        ? []
        : [
            initialValues("UMLParameter", "", {
              type: input.returnType,
              direction: "return",
            }),
          ]),
    ];
    const operation = createOwned(
      owner,
      "UMLOperation",
      "operations",
      values,
      (op) => {
        for (const paramValues of parameters) {
          const param = Object.assign(instantiate("UMLParameter"), paramValues);
          param._parent = op;
          (op.parameters as Element[]).push(param);
        }
      },
    );
    return serialize(operation, input);
  },
});

export const addParameter = defineEndpoint({
  path: "/add_parameter",
  description:
    "Add a UMLParameter to an operation (or another behavioral feature).",
  readOnly: false,
  destructive: false,
  request: z.object({
    operationId: id("Operation id."),
    ...parameterShape(),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.operationId, "Operation");
    const values = featureValues("UMLParameter", input, PARAMETER);
    return serialize(
      createOwned(owner, "UMLParameter", "parameters", values),
      input,
    );
  },
});

export const addEnumerationLiteral = defineEndpoint({
  path: "/add_enumeration_literal",
  description: "Add a UMLEnumerationLiteral to a UMLEnumeration.",
  readOnly: false,
  destructive: false,
  request: z.object({
    enumerationId: id("UMLEnumeration id."),
    name: text("Literal name."),
    documentation: str("Documentation text."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.enumerationId, "Enumeration");
    const values = featureValues("UMLEnumerationLiteral", input, [
      "documentation",
    ]);
    return serialize(
      createOwned(owner, "UMLEnumerationLiteral", "literals", values),
      input,
    );
  },
});

export const addTemplateParameter = defineEndpoint({
  path: "/add_template_parameter",
  description:
    "Add a UMLTemplateParameter to a model element, e.g. T of a generic class.",
  readOnly: false,
  destructive: false,
  request: z.object({
    ownerId: id("Templated element id."),
    name: text("Parameter name, e.g. 'T'."),
    parameterType: z.optional(
      typeValue("Kind of argument, e.g. 'class', or {$ref: id}."),
    ),
    defaultValue: z.optional(
      typeValue("Default argument: text or {$ref: id}."),
    ),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.ownerId, "Owner");
    const values = featureValues("UMLTemplateParameter", input, [
      "parameterType",
      "defaultValue",
    ]);
    return serialize(
      createOwned(owner, "UMLTemplateParameter", "templateParameters", values),
      input,
    );
  },
});

export const addSlot = defineEndpoint({
  path: "/add_slot",
  description:
    "Add a UMLSlot (attribute value) to an instance such as a UMLObject.",
  readOnly: false,
  destructive: false,
  request: z.object({
    instanceId: id("Instance id, e.g. a UMLObject."),
    name: str("Slot name; usually the defining attribute's name."),
    definingFeature: z.optional(
      reference(
        "The UMLAttribute (or other structural feature) the slot sets.",
      ),
    ),
    value: str("Value as text."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.instanceId, "Instance");
    const values = featureValues("UMLSlot", input, [
      "definingFeature",
      "value",
    ]);
    return serialize(createOwned(owner, "UMLSlot", "slots", values), input);
  },
});

/**
 * Which Tag attribute holds the value for each TagKind (core metamodel;
 * docs: developing-extensions/creating-deleting-and-modifying-elements).
 */
const TAG_VALUE_FIELD = {
  string: "value",
  enum: "value",
  number: "number",
  boolean: "checked",
  reference: "reference",
} as const;

export const addTag = defineEndpoint({
  path: "/add_tag",
  description:
    "Add a Tag (name/value extension property) to an element. Tags show in the property editor and, unless hidden, on diagrams with Format > Show Property.",
  readOnly: false,
  destructive: false,
  request: z.object({
    elementId: id("Element to tag."),
    name: text("Tag name."),
    kind: doc(
      z.enum(["string", "number", "boolean", "reference", "enum"]),
      "TagKind; decides which value attribute is set.",
    ),
    value: doc(
      z.unknown(),
      "string/enum: text; number: an integer; boolean: true/false; reference: an id or {$ref: id}.",
    ),
    hidden: flag("Hide the tag on diagrams."),
    properties: properties(ATTRIBUTE_VALUES_HELP),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const owner = requireElement(input.elementId, "Element");
    const values = initialValues("Tag", input.name, {
      ...input.properties,
      kind: input.kind,
      [TAG_VALUE_FIELD[input.kind]]: input.value,
      ...(input.hidden !== undefined && { hidden: input.hidden }),
    });
    return serialize(createOwned(owner, "Tag", "tags", values), input);
  },
});

/** Engine.setProperty on one attribute, with the value converted by its kind. */
function setAttribute(elem: Element, field: string, value: unknown): void {
  const typeName = elem.constructor.name;
  const converted = toModelValue(
    typeName,
    settableAttribute(typeName, field),
    value,
  );
  inStarUML(() => app.engine.setProperty(elem, field, converted));
}

export const setStereotype = defineEndpoint({
  path: "/set_stereotype",
  description:
    "Set or clear an element's stereotype: a name shown as «name», or a UMLStereotype from a profile.",
  readOnly: false,
  destructive: true,
  request: z.object({
    elementId: id("Element id."),
    stereotype: doc(
      z.nullable(
        z.union([
          z.string(),
          z.object({ $ref: z.string().check(z.minLength(1)) }),
        ]),
      ),
      "Stereotype name, {$ref: id} of a UMLStereotype, or null to clear.",
    ),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.elementId);
    setAttribute(elem, "stereotype", input.stereotype);
    return serialize(elem, input);
  },
});

export const setDocumentation = defineEndpoint({
  path: "/set_documentation",
  description: "Set an element's documentation text.",
  readOnly: false,
  destructive: true,
  request: z.object({
    elementId: id("Element id."),
    documentation: text("Documentation; replaces the current text."),
    ...projectionShape(),
  }),
  response: elementSchema(),
  handle: (input) => {
    const elem = requireElement(input.elementId);
    setAttribute(elem, "documentation", input.documentation);
    return serialize(elem, input);
  },
});
