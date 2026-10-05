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
import { ApiError } from "../errors.js";
import { KINDS, type Kind } from "../build/spec.js";
import {
  LINE_STYLES,
  PRESET_NAMES,
  STEREOTYPE_DISPLAYS,
} from "../handlers/views.js";
import type { Element } from "../types.js";
import data from "./profiles.json";
import { compilePattern, FIXES } from "./naming.js";

/*
 * The project style profile (issue #31): naming, visuals, layout, limits,
 * modelling rules, quality thresholds and the derivation policy in one
 * object. It is stored in the project as a hidden Tag on the Project
 * element, so it travels with the .mdj; a project without one uses the
 * built-in profile the preference mcp-ext.style.profile names.
 */

export const PROFILE_TAG = "mcp.styleProfile";
export const PROFILE_PREF = "mcp-ext.style.profile";
export const DEFAULT_PROFILE = "uml-standard";

const colour = () =>
  z.optional(z.string().check(z.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)));

export const visualSchema = () =>
  z.strictObject({
    fillColor: colour(),
    lineColor: colour(),
    fontColor: colour(),
    fontFace: z.optional(z.string().check(z.minLength(1))),
    fontSize: z.optional(z.number().check(z.positive(), z.maximum(72))),
    stereotypeDisplay: z.optional(z.enum(STEREOTYPE_DISPLAYS)),
  });
export type Visual = z.output<ReturnType<typeof visualSchema>>;

/** View attributes StarUML's Format menu toggles (core/core.js, uml views, 7.1.1). */
export const SHOW_SWITCHES = [
  "showVisibility",
  "showOperationSignature",
  "showProperty",
  "showType",
  "showMultiplicity",
  "suppressAttributes",
  "suppressOperations",
  "wordWrap",
] as const;
export type ShowSwitch = (typeof SHOW_SWITCHES)[number];

const namingRule = () =>
  z.strictObject({
    pattern: doc(
      z.string().check(z.minLength(1)),
      "PascalCase, camelCase, UPPER_CASE, snake_case, lowercase, 'Verb noun', or a regular expression.",
    ),
    fix: doc(
      z.enum(FIXES),
      "How a name off the pattern is rewritten: pascal, camel, upperSnake, snake, lower, sentence, or none to report only.",
    ),
  });

export const NAMING_KINDS = [
  "classifier",
  "attribute",
  "operation",
  "constant",
  "literal",
  "usecase",
  "package",
] as const;
export type NamingKind = (typeof NAMING_KINDS)[number];

const RELATION_KINDS = [
  "association",
  "directed",
  "aggregation",
  "composition",
  "generalization",
  "realization",
  "dependency",
] as const;

const DOCUMENTED = ["package", "class", "interface"] as const;

const separation = () => z.number().check(z.minimum(0), z.maximum(1000));

/** Every field is required in a stored profile; a patch is merged first. */
export const profileSchema = () =>
  z.strictObject({
    name: z.string().check(z.minLength(1)),
    description: z.string(),
    strict: doc(
      z.boolean(),
      "Refuse free-form style and geometry calls with STYLE_LOCKED unless override: true, report naming as errors.",
    ),
    blockSaveOnErrors: doc(
      z.boolean(),
      "/save_project and /export_* refuse with SAVE_BLOCKED while /uml_lint or /model_lint report errors, unless override: true.",
    ),
    naming: z.strictObject(
      Object.fromEntries(
        NAMING_KINDS.map((k) => [k, z.nullable(namingRule())]),
      ) as Record<NamingKind, z.ZodMiniNullable<ReturnType<typeof namingRule>>>,
    ),
    visuals: z.strictObject({
      kinds: doc(
        z.record(z.string(), visualSchema()),
        "By model type ('UMLClass', 'ERDEntity', 'UMLNote' for notes) or '*' for any node.",
      ),
      stereotypes: doc(
        z.record(z.string(), visualSchema()),
        "By stereotype name; applied over the kind's.",
      ),
      edges: z.strictObject({
        lineStyle: z.optional(
          z.enum(Object.keys(LINE_STYLES) as [keyof typeof LINE_STYLES]),
        ),
        lineColor: colour(),
        fontColor: colour(),
      }),
      show: z.strictObject(
        Object.fromEntries(
          SHOW_SWITCHES.map((s) => [s, z.optional(z.boolean())]),
        ) as Record<ShowSwitch, z.ZodMiniOptional<z.ZodMiniBoolean>>,
      ),
      grid: z.strictObject({
        size: doc(
          z.int().check(z.minimum(1), z.maximum(100)),
          "Grid cell in diagram units (px at 100%).",
        ),
        snap: z.boolean(),
      }),
    }),
    layout: z.strictObject({
      presets: doc(
        z.partialRecord(z.enum(KINDS), z.enum(PRESET_NAMES)),
        "Layout preset per diagram kind; kinds not listed use the build default.",
      ),
      spacing: z.strictObject({ node: separation(), rank: separation() }),
      maxElements: doc(
        z.int().check(z.minimum(2), z.maximum(500)),
        "Nodes per diagram above which a split is suggested.",
      ),
      page: doc(
        z.strictObject({
          width: z.int().check(z.minimum(200)),
          height: z.int().check(z.minimum(200)),
        }),
        "Target canvas in diagram units (px at 100%); the quality metric penalises diagrams far wider or taller.",
      ),
      labelWrap: doc(
        z.int().check(z.minimum(40), z.maximum(1000)),
        "Width in px past which a node's name is wrapped.",
      ),
    }),
    rules: z.strictObject({
      requireMultiplicities: z.boolean(),
      allowedRelationships: doc(
        z.partialRecord(z.enum(KINDS), z.array(z.enum(RELATION_KINDS))),
        "Relationship kinds a diagram kind may draw; kinds not listed allow all.",
      ),
      documentationRequired: z.array(z.enum(DOCUMENTED)),
      forbidDuplicateNames: z.boolean(),
    }),
    quality: z.strictObject({
      minScore: doc(
        z.int().check(z.minimum(0), z.maximum(100)),
        "Score the quality loop aims for.",
      ),
      maxIterations: z.int().check(z.minimum(1), z.maximum(10)),
      thresholds: doc(
        z.partialRecord(
          z.enum(KINDS),
          z.int().check(z.minimum(0), z.maximum(100)),
        ),
        "minScore per diagram kind.",
      ),
    }),
    policy: z.strictObject({
      classDiagrams: doc(
        z.enum(["perPackage", "views"]),
        "/derive_diagrams: one class diagram per package, or the model's class views where it has them.",
      ),
      hideGetters: doc(
        z.boolean(),
        "Derived class diagrams hide getX/setX/isX operations.",
      ),
      neighbours: doc(
        z.boolean(),
        "Derived class diagrams also show the direct collaborators from other packages.",
      ),
      packageOverview: z.boolean(),
    }),
  });
export type Profile = z.output<ReturnType<typeof profileSchema>>;

export const BUILT_IN_NAMES = Object.keys(data) as [string, ...string[]];

let builtIns: Record<string, Profile> | null = null;

/** The built-in profiles, checked against the schema once. */
export function builtInProfiles(): Record<string, Profile> {
  builtIns ??= Object.fromEntries(
    Object.entries(data).map(([name, p]) => [
      name,
      z.parse(profileSchema(), p),
    ]),
  );
  return builtIns;
}

/** Patterns of a profile compiled, so a bad regular expression is refused on set. */
function checkPatterns(profile: Profile): void {
  for (const k of NAMING_KINDS) {
    const rule = profile.naming[k];
    if (rule) compilePattern(rule.pattern, `naming.${k}.pattern`);
  }
}

/** A profile from its JSON form; anything else is INVALID_ARGUMENT naming the field. */
export function parseProfile(value: unknown, field = "profile"): Profile {
  const parsed = z.safeParse(profileSchema(), value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiError(
      "INVALID_ARGUMENT",
      `${[field, ...issue.path.map(String)].join(".")}: ${issue.message}`,
      parsed.error.issues,
    );
  }
  checkPatterns(parsed.data);
  return parsed.data;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `patch` merged into `base`: objects field by field, anything else
 * replaced; null replaces too, which is how a naming rule is turned off.
 */
export function mergePatch(base: unknown, patch: unknown): unknown {
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    // A "__proto__" key from JSON.parse is data; assigning it would set
    // the prototype instead, so every key is defined as an own property.
    Object.defineProperty(out, k, {
      value: Object.hasOwn(base, k) ? mergePatch(base[k], v) : v,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** The Tag holding the project's profile, if it has one. */
export function profileTag(): Element | null {
  const project = app.project.getProject();
  const tags = (project?.tags ?? []) as Element[];
  return tags.find((t) => t.name === PROFILE_TAG) ?? null;
}

export type ProfileSource = "project" | "preferences";

export interface Effective {
  profile: Profile;
  source: ProfileSource;
  /** Why the project's stored profile was not used, when it was not. */
  problem?: string;
}

let cache: { text: string; effective: Effective } | null = null;

/** The built-in profile the preference names, the default if it names none. */
function preferred(): Profile {
  const name = app.preferences.get(PROFILE_PREF, DEFAULT_PROFILE);
  const all = builtInProfiles();
  return all[
    typeof name === "string" && Object.hasOwn(all, name)
      ? name
      : DEFAULT_PROFILE
  ]!;
}

/**
 * The profile authoring applies: the project's, else the preference's. A
 * stored profile that no longer parses (edited by hand in the .mdj) falls
 * back to the preference and says why, rather than failing every call.
 */
export function effectiveProfile(): Effective {
  const tag = profileTag();
  if (!tag) return { profile: preferred(), source: "preferences" };
  const text = String(tag.value ?? "");
  if (cache?.text === text) return cache.effective;
  let effective: Effective;
  try {
    effective = {
      profile: parseProfile(JSON.parse(text), PROFILE_TAG),
      source: "project",
    };
  } catch (err) {
    effective = {
      profile: preferred(),
      source: "preferences",
      problem: `the project's ${PROFILE_TAG} tag is not a valid profile: ${(err as Error).message}`,
    };
  }
  cache = { text, effective };
  return effective;
}

export const profile = (): Profile => effectiveProfile().profile;

/** The preset a diagram kind is laid out with under the profile, if it names one. */
export const presetFor = (p: Profile, kind: Kind) => p.layout.presets[kind];

/** minScore for a diagram kind. */
export const thresholdFor = (p: Profile, kind: Kind): number =>
  p.quality.thresholds[kind] ?? p.quality.minScore;
