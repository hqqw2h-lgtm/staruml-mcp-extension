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
import { defineEndpoint, doc, type Endpoint } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { isMetaClass, lineage } from "../metamodel.js";
import { Planner, type PropertyChange } from "../model/planner.js";
import { planPattern } from "../patterns/apply.js";
import {
  detect,
  type Detection,
  sharingRelationships,
} from "../patterns/detect.js";
import glossary from "../patterns/glossary.json";
import { findPattern, patterns, withVariant } from "../patterns/index.js";
import { allPresets, PRESET_NAMES } from "../patterns/presets.js";
import { pathOf, tryResolve } from "../refs.js";
import { ref } from "../schemas.js";
import {
  normalizeOps,
  Renames,
  styleDiagram,
  styleReport,
  styleReportSchema,
} from "../style/apply.js";
import { effectiveProfile } from "../style/profile.js";
import { oneStep } from "../undo.js";
import { deselect } from "../quality/geometry.js";
import { improve, qualitySchema } from "../quality/loop.js";
import type { Element } from "../types.js";
import { batchRunner, type OpResult } from "./batch.js";
import { planOf, planSchema } from "./build.js";
import { MODEL_MAX_OPS } from "./model.js";

/*
 * Design patterns as data (issue #30): list and describe the library,
 * apply a pattern with every property it prescribes, find instances of
 * patterns in a model, apply element presets, and describe a metamodel
 * type's properties.
 */

const changeSchema = () =>
  z.object({
    path: z.string(),
    type: z.string(),
    fields: z.optional(z.array(z.string())),
  });

const propertySchema = () =>
  z.object({ path: z.string(), field: z.string(), value: z.unknown() });

export const listPatterns = defineEndpoint({
  path: "/list_patterns",
  description:
    "The design patterns /apply_pattern applies and /detect_patterns finds: the 23 GoF patterns and Repository, Unit of Work, Specification, Value Object, Entity, Service and DTO, each with its intent, roles and variants. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    category: z.optional(
      z.enum(["creational", "structural", "behavioral", "domain"]),
    ),
  }),
  response: z.object({
    count: z.int(),
    patterns: z.array(
      z.object({
        name: z.string(),
        category: z.string(),
        intent: z.string(),
        roles: doc(
          z.array(z.string()),
          "Role names; '*' marks a role binding several elements, '?' an optional one.",
        ),
        variants: z.array(z.string()),
        sequence: doc(z.boolean(), "Has messages for a sequence diagram."),
      }),
    ),
  }),
  handle: (input) => {
    const list = patterns()
      .filter(
        (p) => input.category === undefined || p.category === input.category,
      )
      .map((p) => ({
        name: p.name,
        category: p.category,
        intent: p.intent,
        roles: p.roles.map(
          (r) =>
            `${r.name}${r.cardinality === "many" ? "*" : ""}${r.optional ? "?" : ""}`,
        ),
        variants: Object.keys(p.variants ?? {}),
        sequence: p.sequence !== undefined,
      }));
    return { count: list.length, patterns: list };
  },
});

export const describePattern = defineEndpoint({
  path: "/describe_pattern",
  description:
    "A pattern's roles with the element type, properties, stereotype, documentation and members each gets, its relationships with the properties of their ends, its sequence messages and the checks uml_lint holds an instance to: what /apply_pattern sets. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    name: doc(
      z.string().check(z.minLength(1)),
      "Pattern name, e.g. 'Strategy', 'factory-method'.",
    ),
    variant: z.optional(z.string()),
  }),
  response: z.looseObject({
    name: z.string(),
    category: z.string(),
    intent: z.string(),
    roles: z.array(z.unknown()),
    relationships: z.array(z.unknown()),
  }),
  handle: (input) => {
    const { $schema: _schema, ...pattern } = withVariant(
      findPattern(input.name),
      input.variant,
    );
    return pattern;
  },
});

const bindingSchema = () =>
  z.union([
    z.string().check(z.minLength(1)),
    z.object({ new: z.object({ name: z.string().check(z.minLength(1)) }) }),
  ]);

/** The project's first model, where new elements go by default. */
function defaultParent(): Element {
  const project = requireProject();
  const model = (project.ownedElements as Element[]).find(
    (e) => e instanceof type.UMLModel,
  );
  if (!model) {
    throw new ApiError("NOT_FOUND", "The project has no model; pass parent");
  }
  return model;
}

/** Ids for a plan's "$name" refs to elements once its batch ran. */
function resolver(results: readonly OpResult[]) {
  const byAlias = new Map(
    results.flatMap((r) => (r.as ? [[r.as, r.data]] : [])),
  );
  return (ref: string): string =>
    ref.startsWith("$")
      ? (byAlias.get(ref.slice(1)) as { _id: string })._id
      : ref;
}

const resolveValue = (value: unknown, id: (ref: string) => string): unknown =>
  value && typeof value === "object" && "$ref" in value
    ? { $ref: id((value as { $ref: string }).$ref) }
    : value;

export function applyPatternEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/apply_pattern",
    description:
      "Apply a design pattern: bind each role to existing elements by path or name, or to new ones, and set every property the pattern prescribes on them, their attributes, operations and parameters, and the ends of the relationships between them; optionally show it on a class diagram (laid out) and a sequence diagram of its messages. One undo step. Answers each role's elements by id and path and every property set; dryRun lists the same and the ops without changing anything.",
    readOnly: false,
    destructive: false,
    request: z.object({
      pattern: doc(
        z.string().check(z.minLength(1)),
        "Pattern name, see /list_patterns.",
      ),
      bindings: z.optional(
        doc(
          z.record(
            z.string(),
            z.union([bindingSchema(), z.array(bindingSchema())]),
          ),
          "By role: a path or name of an existing element, a name for a new one, {new: {name}}, or a list of those for a role marked many. Unbound roles get a new element named after the role; optional roles are left out.",
        ),
      ),
      variant: z.optional(
        doc(z.string(), "A variant of the pattern, see /describe_pattern."),
      ),
      parent: z.optional(
        ref(
          "Owner of new elements and diagrams; default the diagram's owner, else the project's first model.",
        ),
      ),
      diagram: z.optional(
        doc(
          z.string().check(z.minLength(1)),
          "A class diagram to show the pattern on: a reference to one, or the name of a new one.",
        ),
      ),
      sequence: z.optional(
        doc(
          z.boolean(),
          "Also make a sequence diagram of the pattern's messages.",
        ),
      ),
      upsert: z.optional(
        doc(
          z.boolean(),
          "Reuse an element of the parent named like a new one instead of refusing it (DUPLICATE_NAME).",
        ),
      ),
      dryRun: z.optional(
        doc(
          z.boolean(),
          "Answer what would be made and set, and change nothing.",
        ),
      ),
    }),
    response: z.object({
      pattern: z.string(),
      variant: z.optional(z.string()),
      roles: doc(
        z.record(
          z.string(),
          z.array(
            z.object({
              _id: z.string(),
              path: z.string(),
              created: z.boolean(),
            }),
          ),
        ),
        "Each role's elements; _id is a '$name' placeholder on a dry run for what is new.",
      ),
      created: z.int(),
      updated: z.int(),
      unchanged: z.int(),
      changes: z.object({
        created: z.array(changeSchema()),
        updated: z.array(changeSchema()),
      }),
      properties: doc(
        z.array(propertySchema()),
        "Every attribute value set, by element path.",
      ),
      diagram: z.optional(doc(z.string(), "The class diagram's id.")),
      sequenceDiagram: z.optional(
        doc(z.string(), "The sequence diagram's id."),
      ),
      warnings: z.optional(z.array(z.string())),
      dryRun: z.optional(z.boolean()),
      plan: z.optional(planSchema()),
      style: z.optional(styleReportSchema()),
      quality: z.optional(qualitySchema()),
    }),
    handle: async (input) => {
      const pattern = withVariant(findPattern(input.pattern), input.variant);
      let existing: Element | null = null;
      if (input.diagram !== undefined) {
        existing = tryResolve(input.diagram, { kind: "diagram" });
        if (existing && !(existing instanceof type.UMLClassDiagram)) {
          throw new ApiError(
            "INVALID_ARGUMENT",
            `diagram: ${input.diagram} is a ${existing.constructor.name}, not a class diagram`,
          );
        }
      }
      const parent =
        input.parent !== undefined
          ? requireElement(input.parent, "Parent")
          : (existing?._parent ?? defaultParent());
      if (!(parent instanceof type.UMLPackage)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `parent: new elements go in a model or package; ${pathOf(parent) ?? parent._id} is a ${parent.constructor.name}`,
        );
      }
      const plan = planPattern(pattern, {
        bindings: input.bindings ?? {},
        parent,
        upsert: input.upsert ?? false,
        ...(input.diagram !== undefined && {
          diagram: { existing, name: input.diagram },
        }),
        ...(input.sequence && { sequence: true }),
      });
      const p = plan.planner;
      const answer = (
        id: (ref: string) => string,
        properties: PropertyChange[],
      ) => ({
        pattern: pattern.name,
        ...(input.variant !== undefined && { variant: input.variant }),
        roles: Object.fromEntries(
          Object.entries(plan.roles).map(([role, list]) => [
            role,
            list.map((b) => ({
              _id: id(b.ref),
              path: b.path,
              created: b.created,
            })),
          ]),
        ),
        created: p.created.length,
        updated: p.updated.length,
        unchanged: p.unchanged,
        changes: { created: p.created, updated: p.updated },
        properties,
        ...(plan.diagram && { diagram: id(plan.diagram) }),
        ...(plan.sequenceDiagram && {
          sequenceDiagram: id(plan.sequenceDiagram),
        }),
        ...(plan.warnings.length > 0 && { warnings: plan.warnings }),
      });
      if (input.dryRun) {
        return {
          ...answer((r) => r, p.properties),
          dryRun: true,
          plan: planOf(plan.ops),
        };
      }
      const profile = effectiveProfile().profile;
      // A pattern names its roles' elements by its own vocabulary; names
      // off the profile are reported, not rewritten, so the roles stay
      // recognisable to /detect_patterns.
      const renames = new Renames({
        ...profile,
        naming: Object.fromEntries(
          Object.entries(profile.naming).map(([k, r]) => [
            k,
            r && { ...r, fix: "none" as const },
          ]),
        ) as typeof profile.naming,
      });
      normalizeOps(plan.ops, renames);
      const { run, styled, quality } = await oneStep(
        "apply pattern",
        async () => {
          const run = await batchRunner.run(
            endpoints(),
            plan.ops,
            true,
            MODEL_MAX_OPS,
          );
          const id = resolver(run.results);
          const diagrams = [plan.diagram, plan.sequenceDiagram]
            .filter((d) => d !== undefined)
            .map((d) => requireElement(id(d)));
          const styled = diagrams.reduce(
            (n, d) => n + styleDiagram(d, profile),
            0,
          );
          const quality = diagrams.map((d) => improve(d, profile))[0];
          diagrams.forEach(deselect);
          return { run, styled, quality };
        },
      );
      const id = resolver(run.results);
      return {
        ...answer(
          id,
          p.properties.map((c) => ({
            ...c,
            value: resolveValue(c.value, id),
          })),
        ),
        style: styleReport(profile, renames, styled),
        ...(quality && { quality }),
      };
    },
  });
}

export const detectPatterns = defineEndpoint({
  path: "/detect_patterns",
  description:
    "Find instances of the library's patterns in the model by structure: roles bound along the relationships the pattern prescribes, scored by the share of its element types, properties, members and relationship ends the model has. Answers candidates with their confidence (1: everything the pattern prescribes), the elements in each role and what is missing. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    scope: z.optional(
      ref("Only classifiers within this element; default the project."),
    ),
    patterns: z.optional(
      doc(z.array(z.string().check(z.minLength(1))), "Only these patterns."),
    ),
    minConfidence: z.optional(
      doc(z.number().check(z.minimum(0), z.maximum(1)), "Default 0.6."),
    ),
    limit: z.optional(
      doc(z.int().check(z.minimum(1), z.maximum(500)), "Default 50."),
    ),
  }),
  response: z.object({
    count: doc(z.int(), "Candidates found, before limit."),
    detections: z.array(
      z.object({
        pattern: z.string(),
        variant: z.optional(z.string()),
        confidence: z.number(),
        roles: z.record(
          z.string(),
          z.array(z.object({ _id: z.string(), path: z.nullable(z.string()) })),
        ),
        missing: z.array(z.string()),
      }),
    ),
  }),
  handle: (input) => {
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    const found = detectIn(
      scope,
      input.patterns === undefined
        ? patterns()
        : input.patterns.map(findPattern),
      input.minConfidence ?? 0.6,
    );
    return {
      count: found.length,
      detections: found
        .slice(0, input.limit ?? 50)
        .map(({ binding: _b, ...d }) => d),
    };
  },
});

/** Classifiers within `scope` that patterns are made of. */
export function classifiersIn(scope: Element): Element[] {
  return ["UMLClass", "UMLInterface", "UMLEnumeration"].flatMap((t) =>
    app.repository.getInstancesOf(t).filter((e) => {
      for (let x: Element | null | undefined = e; x; x = x._parent) {
        if (x === scope) return true;
      }
      return false;
    }),
  );
}

/** Detections of every pattern and variant, best first, one per binding. */
export function detectIn(
  scope: Element,
  library: readonly ReturnType<typeof patterns>[number][],
  min: number,
): Detection[] {
  return sharingRelationships(() => {
    const classifiers = classifiersIn(scope);
    const best = new Map<string, Detection>();
    for (const pattern of library) {
      for (const variant of [
        undefined,
        ...Object.keys(pattern.variants ?? {}),
      ]) {
        for (const d of detect(
          withVariant(pattern, variant),
          classifiers,
          min,
          variant,
        )) {
          const key = `${d.pattern}|${JSON.stringify(Object.entries(d.roles).sort())}`;
          // On a tie the variant wins: it prescribes more than the pattern.
          const known = best.get(key);
          if (
            !known ||
            known.confidence < d.confidence ||
            (known.confidence === d.confidence && d.variant !== undefined)
          ) {
            best.set(key, d);
          }
        }
      }
    }
    return [...best.values()].sort(
      (a, b) =>
        b.confidence - a.confidence || a.pattern.localeCompare(b.pattern),
    );
  });
}

const isConstructor = (op: Element, owner: Element) =>
  op.name === owner.name ||
  (op.stereotype && typeof op.stereotype === "object"
    ? (op.stereotype as Element).name
    : op.stereotype) === "create";

export function applyPresetEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/apply_preset",
    description:
      "Give an existing class, interface or enumeration and its members the properties of a kind of element, as one undo step: interface, abstract, value-object, entity, enum, static-utility, immutable. Answers every property set; dryRun answers it without changing anything.",
    readOnly: false,
    destructive: false,
    request: z.object({
      ref: ref("Class, interface or enumeration."),
      preset: doc(
        z.enum(PRESET_NAMES),
        "The kind; /describe_type lists what each property means.",
      ),
      dryRun: z.optional(z.boolean()),
    }),
    response: z.object({
      element: z.object({ _id: z.string(), path: z.nullable(z.string()) }),
      preset: z.string(),
      description: z.string(),
      changes: z.object({
        created: z.array(changeSchema()),
        updated: z.array(changeSchema()),
      }),
      properties: z.array(propertySchema()),
      warnings: z.optional(z.array(z.string())),
      dryRun: z.optional(z.boolean()),
      plan: z.optional(planSchema()),
    }),
    handle: async (input) => {
      const elem = requireElement(input.ref);
      const preset = allPresets()[input.preset]!;
      if (!(preset.appliesTo as string[]).includes(elem.constructor.name)) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `${input.preset} applies to ${preset.appliesTo.join(", ")}; ${input.ref} is a ${elem.constructor.name}`,
        );
      }
      const p = new Planner(true);
      const node = { ref: elem._id, elem, path: pathOf(elem)! };
      if (preset.element) p.update(elem, preset.element, node.path);
      for (const a of elem.attributes as Element[]) {
        if (preset.attributes)
          p.update(a, preset.attributes, `${node.path}.${a.name}`);
      }
      const warnings: string[] = [];
      for (const o of elem.operations as Element[]) {
        if (isConstructor(o, elem)) continue;
        if (preset.operations)
          p.update(o, preset.operations, `${node.path}#${o.name}()`);
        if (preset.reportSetters && /^set[A-Z_]/.test(o.name as string)) {
          warnings.push(
            `${node.path}#${o.name}() looks like a setter, which a ${input.preset} has none of`,
          );
        }
      }
      for (const a of preset.ensureAttributes ?? []) {
        const { name, ...props } = a;
        p.attribute(node, name, props);
      }
      if (preset.ensureConstructor) {
        p.operation(node, elem.name as string, {
          ...preset.ensureConstructor,
          stereotype: "create",
        });
      }
      const answer = {
        element: { _id: elem._id, path: node.path },
        preset: input.preset,
        description: preset.description,
        changes: { created: p.created, updated: p.updated },
        properties: p.properties,
        ...(warnings.length > 0 && { warnings }),
      };
      if (input.dryRun) return { ...answer, dryRun: true, plan: planOf(p.ops) };
      if (p.ops.length > 0)
        await batchRunner.run(endpoints(), p.ops, true, MODEL_MAX_OPS);
      return answer;
    },
  });
}

const GLOSSARY: Record<string, string> = glossary;

export const describeType = defineEndpoint({
  path: "/describe_type",
  description:
    "The properties of a metamodel type, inherited ones included: kind, value type, default, the allowed values of an enumeration, the type that declares it and, for the properties that carry UML meaning, what it means. Read-only.",
  readOnly: true,
  destructive: false,
  request: z.object({
    type: doc(
      z.string().check(z.minLength(1)),
      "Metamodel class, e.g. 'UMLOperation', 'UMLAssociationEnd'.",
    ),
  }),
  response: z.object({
    type: z.string(),
    supers: doc(z.array(z.string()), "Ancestors, nearest first."),
    properties: z.array(
      z.object({
        name: z.string(),
        kind: z.string(),
        type: z.string(),
        default: z.optional(z.unknown()),
        allowed: z.optional(
          doc(
            z.array(z.string()),
            "Enumeration literals, or suggested values.",
          ),
        ),
        declaredBy: z.string(),
        meaning: z.optional(z.string()),
      }),
    ),
  }),
  handle: (input) => {
    if (!isMetaClass(input.type)) {
      throw new ApiError(
        "UNKNOWN_TYPE",
        `${input.type} is not a metamodel class; /search_types finds one`,
      );
    }
    const supers = lineage(input.type).slice(1);
    const declaredBy = (name: string) =>
      [...lineage(input.type)]
        .reverse()
        .find((t) => (meta[t]!.attributes ?? []).some((a) => a.name === name))!;
    const properties = app.metamodels
      .getMetaAttributes(input.type)
      .filter((a) => !a.transient && a.name !== "_id" && a.name !== "_parent")
      .map((a) => {
        const allowed = a.kind === "enum" ? meta[a.type]?.literals : a.options;
        return {
          name: a.name,
          kind: a.kind,
          type: a.type,
          ...(a.default !== undefined && { default: a.default }),
          ...(allowed && allowed.length > 0 && { allowed }),
          declaredBy: declaredBy(a.name),
          ...(GLOSSARY[a.name] !== undefined && { meaning: GLOSSARY[a.name] }),
        };
      });
    return { type: input.type, supers, properties };
  },
});
