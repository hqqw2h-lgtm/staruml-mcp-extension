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
import { ERROR_CODES, ERROR_STATUS } from "../errors.js";
import { isMetaClass, lineage, relationshipKind } from "../metamodel.js";
import { serializeValue } from "../serialize.js";
import type { MetaAttribute } from "../types.js";
import { DRAWING_ENDPOINTS } from "../style/guard.js";
import { effectiveProfile } from "../style/profile.js";
import { EXTENSION_NAME, EXTENSION_VERSION } from "../version.js";

const SECTIONS = ["factory", "metamodel", "toolbox", "endpoints"] as const;
type Section = (typeof SECTIONS)[number];

const attributeSchema = () =>
  z.object({
    name: z.string(),
    kind: doc(
      z.enum(["prim", "enum", "var", "ref", "refs", "obj", "objs", "custom"]),
      "prim/enum: value; ref/refs: reference(s) to other elements; obj/objs: owned element(s); var: a reference or a plain value; custom: an object StarUML stores as a string (Font, Points).",
    ),
    type: doc(
      z.string(),
      "Integer, Real, String, Boolean or Image for prim; otherwise a metamodel type name.",
    ),
    default: z.optional(z.unknown()),
    transient: z.optional(
      doc(z.boolean(), "Runtime state; not saved or returned."),
    ),
    options: z.optional(
      doc(z.array(z.string()), "Suggested values, e.g. multiplicities."),
    ),
  });

const metaTypeSchema = () =>
  z.object({
    kind: z.enum(["class", "enum"]),
    super: z.nullable(z.string()),
    supers: doc(z.array(z.string()), "Ancestors, nearest first."),
    attributes: doc(
      z.array(attributeSchema()),
      "Own attributes; with inherited: true, inherited ones first.",
    ),
    literals: z.optional(z.array(z.string())),
    viewType: doc(
      z.nullable(z.string()),
      "View class that shows this model class on a diagram.",
    ),
    viewTypes: z.optional(
      doc(
        z.array(z.string()),
        "Diagrams only: view classes the diagram accepts.",
      ),
    ),
    relationship: doc(
      z.nullable(z.enum(["directed", "undirected"])),
      "directed: source/target; undirected: end1/end2 elements.",
    ),
    isView: z.boolean(),
    isDiagram: z.boolean(),
    creatable: doc(
      z.object({
        model: z.boolean(),
        modelAndView: z.boolean(),
        diagram: z.boolean(),
      }),
      "Which factory registers this name: /create_element, /create_element_with_view and /create_relationship, /create_diagram.",
    ),
  });

const modelAndViewSchema = () =>
  z.object({
    id: z.string(),
    modelType: z.nullable(z.string()),
    viewType: z.nullable(z.string()),
    relationship: z.nullable(z.enum(["directed", "undirected"])),
  });

const toolboxSchema = () =>
  z.object({
    groups: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        diagramTypes: doc(
          z.nullable(z.array(z.string())),
          "Diagrams the group is shown for; null for every diagram.",
        ),
      }),
    ),
    items: doc(
      z.array(
        z.object({
          id: doc(
            z.string(),
            "Pass as 'type' to /create_element_with_view, /create_edge_with_view or /create_relationship.",
          ),
          group: z.string(),
          title: z.string(),
          rubberband: doc(
            z.string(),
            "line for edges; rect or point for nodes.",
          ),
          creates: doc(z.string(), "The model-and-view id the item creates."),
          options: doc(
            z.record(z.string(), z.unknown()),
            "Presets the item adds, e.g. model-init attribute values or parasitic: true for elements placed on a host view (pass containerViewId).",
          ),
          command: z.optional(
            doc(
              z.string(),
              "A command other than factory:create-model-and-view; such items cannot be created through this API unless `creates` is itself a model-and-view id.",
            ),
          ),
        }),
      ),
      "The diagram editor's palette entries; an id in several groups is listed once.",
    ),
  });

const manifestEntrySchema = () =>
  z.object({
    path: z.string(),
    description: z.string(),
    readOnly: z.boolean(),
    destructive: z.boolean(),
    request: doc(z.record(z.string(), z.unknown()), "JSON Schema (2020-12)."),
    response: doc(
      z.record(z.string(), z.unknown()),
      "JSON Schema (2020-12) of `data` in a successful response.",
    ),
  });

const errorBodySchema = () =>
  z.object({
    success: z.literal(false),
    code: z.enum(ERROR_CODES as [string, ...string[]]),
    error: z.string(),
    details: z.optional(z.unknown()),
  });

const introspectResponse = z.object({
  staruml: z.object({
    version: z.string(),
    apiVersion: z.nullable(z.string()),
  }),
  extension: z.object({ name: z.string(), version: z.string() }),
  factory: z.optional(
    z.object({
      modelIds: z.array(z.string()),
      diagramIds: z.array(z.string()),
      modelAndViewIds: z.array(z.string()),
      modelAndView: doc(
        z.array(modelAndViewSchema()),
        "What each model-and-view id creates; ids such as UMLInputExpansionNode create another model type.",
      ),
    }),
  ),
  metamodel: z.optional(z.record(z.string(), metaTypeSchema())),
  toolbox: z.optional(toolboxSchema()),
  endpoints: z.optional(z.array(manifestEntrySchema())),
  capabilities: z.optional(
    doc(
      z.object({
        set: z.enum(["all", "oo"]),
        strict: z.boolean(),
        hidden: doc(z.array(z.string()), "Endpoints the set leaves out."),
      }),
      "With capabilities: the set listed and what it hides.",
    ),
  ),
  errors: z.optional(
    z.object({
      status: doc(z.record(z.string(), z.int()), "HTTP status per error code."),
      schema: doc(
        z.record(z.string(), z.unknown()),
        "JSON Schema of an error response body.",
      ),
    }),
  ),
});

function describeAttribute(attr: MetaAttribute) {
  return {
    name: attr.name,
    kind: attr.kind,
    type: attr.type,
    ...(attr.default !== undefined && { default: attr.default }),
    ...(attr.transient && { transient: true }),
    ...(attr.options && { options: [...attr.options] }),
  };
}

interface FactoryIds {
  model: Set<string>;
  modelAndView: Set<string>;
  diagram: Set<string>;
}

function describeType(name: string, ids: FactoryIds, inherited: boolean) {
  const metaType = meta[name]!;
  if (metaType.kind === "enum") {
    return {
      kind: "enum" as const,
      super: null,
      supers: [],
      attributes: [],
      literals: [...(metaType.literals ?? [])],
      viewType: null,
      relationship: null,
      isView: false,
      isDiagram: false,
      creatable: { model: false, modelAndView: false, diagram: false },
    };
  }
  const isDiagram = app.metamodels.isKindOf(name, "Diagram");
  const attributes = inherited
    ? app.metamodels.getMetaAttributes(name)
    : (metaType.attributes ?? []);
  return {
    kind: "class" as const,
    super: metaType.super ?? null,
    supers: lineage(name).slice(1),
    attributes: attributes.map(describeAttribute),
    viewType: app.metamodels.getViewTypeOf(name),
    ...(isDiagram && {
      viewTypes: app.metamodels.getAvailableViewTypes(name),
    }),
    relationship: relationshipKind(name),
    isView: app.metamodels.isKindOf(name, "View"),
    isDiagram,
    creatable: {
      model: ids.model.has(name),
      modelAndView: ids.modelAndView.has(name),
      diagram: ids.diagram.has(name),
    },
  };
}

/**
 * The model type a model-and-view id creates: its registered `modelType`
 * option, else the id itself (Factory.createModelAndView in engine/factory.js).
 * Ids that only create a view, such as UMLFrame, have none.
 */
function describeModelAndView(id: string) {
  const options = app.factory.modelAndViewOptions[id] ?? {};
  const candidate = options.modelType ?? id;
  const modelType = isMetaClass(candidate) ? candidate : null;
  return {
    id,
    modelType,
    viewType:
      options.viewType ??
      (modelType ? app.metamodels.getViewTypeOf(modelType) : null),
    relationship: modelType ? relationshipKind(modelType) : null,
  };
}

function describeToolbox() {
  const { groups, items } = app.toolbox;
  return {
    groups: Object.values(groups).map((g) => ({
      id: g.id,
      title: g.title,
      diagramTypes: g.diagramTypes ? g.diagramTypes.map((t) => t.name) : null,
    })),
    items: Object.values(items).map((item) => {
      const { id, ...options } = item.commandArg ?? {};
      return {
        id: item.id,
        group: item.groupId,
        title: item.title,
        rubberband: item.rubberband,
        creates: typeof id === "string" ? id : item.id,
        options: serializeValue(options) as Record<string, unknown>,
        ...(item.command && { command: item.command }),
      };
    }),
  };
}

type JsonObject = Record<string, unknown>;

/**
 * Lists each alias as a property beside its canonical one, with the same
 * schema, `x-alias-of` naming the canonical field and `deprecated` set, so
 * a client can offer only canonical names and still read old calls.
 */
function withAliases(
  schema: JsonObject,
  aliases: Readonly<Record<string, string>> | undefined,
): JsonObject {
  if (!aliases) return schema;
  const properties = { ...(schema.properties as Record<string, JsonObject>) };
  for (const [alias, canonical] of Object.entries(aliases)) {
    properties[alias] = {
      ...properties[canonical],
      description: `Alias of ${canonical}.`,
      "x-alias-of": canonical,
      deprecated: true,
    };
  }
  return { ...schema, properties };
}

let manifestCache: { endpoints: Endpoint[]; entries: unknown[] } | null = null;

/** JSON Schemas are derived once per endpoint list; the list never changes at runtime. */
export function manifest(endpoints: readonly Endpoint[]) {
  if (manifestCache?.endpoints !== endpoints) {
    manifestCache = {
      endpoints: endpoints as Endpoint[],
      entries: endpoints.map((e) => ({
        path: e.path,
        description: e.description,
        readOnly: e.readOnly,
        destructive: e.destructive,
        request: withAliases(
          z.toJSONSchema(e.request, { io: "input" }) as JsonObject,
          e.aliases,
        ),
        response: z.toJSONSchema(e.response, { io: "output" }),
      })),
    };
  }
  return manifestCache.entries as z.output<
    ReturnType<typeof manifestEntrySchema>
  >[];
}

let catalogue: { key: unknown[]; sections: Map<string, unknown> } | null = null;

/**
 * A catalogue section, computed once while the registries stay the ones
 * the extensions filled at start-up (issue #26): the metamodel section
 * alone took ~30 ms of the renderer per call. A new registry, or one
 * grown by a late registration, starts the cache again.
 */
function cached<T>(name: string, compute: () => T): T {
  const key = [
    meta,
    app.toolbox.items,
    app.factory,
    Object.keys(meta).length,
    Object.keys(app.toolbox.items).length,
    app.factory.getModelAndViewIds().length,
  ];
  if (!catalogue || catalogue.key.some((k, i) => k !== key[i])) {
    catalogue = { key, sections: new Map() };
  }
  if (!catalogue.sections.has(name)) catalogue.sections.set(name, compute());
  return catalogue.sections.get(name) as T;
}

/**
 * `endpoints` is a thunk because the endpoint list includes this endpoint.
 */
export function introspectEndpoint(endpoints: () => readonly Endpoint[]) {
  return defineEndpoint({
    path: "/introspect",
    description:
      "StarUML and extension versions, factory ids, the metamodel catalogue, the diagram editor's toolbox, and this endpoint manifest with JSON Schemas.",
    readOnly: true,
    destructive: false,
    request: z.object({
      include: z.optional(
        doc(
          z.array(z.enum(SECTIONS)),
          "Sections to return besides the versions; default all.",
        ),
      ),
      types: z.optional(
        doc(
          z.array(z.string().check(z.minLength(1))),
          "Restrict the metamodel section to these type names.",
        ),
      ),
      inherited: z.optional(
        doc(
          z.boolean(),
          "List inherited attributes with each type; default false (own attributes and supers).",
        ),
      ),
      capabilities: z.optional(
        doc(
          z.enum(["all", "oo"]),
          "Endpoints to list: all (default), or oo, the model-first set; under a strict style profile oo leaves out every endpoint that draws (styles, positions, sizes, free-form diagrams), so an agent given that set cannot draw.",
        ),
      ),
    }),
    response: introspectResponse,
    handle: (input) => {
      const include = new Set<Section>(input.include ?? SECTIONS);
      const ids = {
        model: app.factory.getModelIds(),
        modelAndView: app.factory.getModelAndViewIds(),
        diagram: app.factory.getDiagramIds(),
      };
      const out: z.output<typeof introspectResponse> = {
        staruml: {
          version: app.version,
          apiVersion: app.metadata.apiVersion ?? null,
        },
        extension: { name: EXTENSION_NAME, version: EXTENSION_VERSION },
      };
      if (include.has("factory")) {
        out.factory = cached("factory", () => ({
          modelIds: [...ids.model].sort(),
          diagramIds: [...ids.diagram].sort(),
          modelAndViewIds: [...ids.modelAndView].sort(),
          modelAndView: [...ids.modelAndView].sort().map(describeModelAndView),
        }));
      }
      if (include.has("metamodel")) {
        const sets: FactoryIds = {
          model: new Set(ids.model),
          modelAndView: new Set(ids.modelAndView),
          diagram: new Set(ids.diagram),
        };
        const names = (input.types ?? Object.keys(meta)).filter((name) =>
          Object.hasOwn(meta, name),
        );
        out.metamodel = cached(
          `metamodel ${input.inherited === true} ${names.sort().join(",")}`,
          () =>
            Object.fromEntries(
              names.map((name) => [
                name,
                describeType(name, sets, input.inherited === true),
              ]),
            ),
        );
      }
      if (include.has("toolbox")) {
        out.toolbox = cached("toolbox", describeToolbox);
      }
      if (include.has("endpoints")) {
        const strict = effectiveProfile().profile.strict;
        const hidden: string[] =
          input.capabilities === "oo" && strict ? [...DRAWING_ENDPOINTS] : [];
        out.endpoints = manifest(endpoints()).filter(
          (e) => !hidden.includes(e.path),
        );
        if (input.capabilities !== undefined) {
          out.capabilities = { set: input.capabilities, strict, hidden };
        }
        out.errors = {
          status: { ...ERROR_STATUS },
          schema: z.toJSONSchema(errorBodySchema()),
        };
      }
      return out;
    },
  });
}
