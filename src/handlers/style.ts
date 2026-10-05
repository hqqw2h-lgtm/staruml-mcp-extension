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
import { ApiError, inStarUML } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { pathOf } from "../refs.js";
import { ref } from "../schemas.js";
import {
  namingKindOf,
  Renames,
  styleDiagram,
  visualFor,
} from "../style/apply.js";
import { normalize, settle } from "../style/naming.js";
import {
  BUILT_IN_NAMES,
  builtInProfiles,
  effectiveProfile,
  mergePatch,
  NAMING_KINDS,
  type NamingKind,
  parseProfile,
  type Profile,
  PROFILE_TAG,
  profileTag,
} from "../style/profile.js";
import type { Element, View } from "../types.js";
import { oneStep } from "../undo.js";
import { batchRunner } from "./batch.js";

/*
 * The style profile endpoints (issue #31): read it, set it (a built-in, a
 * whole profile or a patch), normalise what a scope already has, and say
 * why an element breaks it.
 */

const profileOut = () =>
  doc(
    z.record(z.string(), z.unknown()),
    "The profile: name, description, strict, blockSaveOnErrors, naming, visuals, layout, rules, quality, policy.",
  );

export const getStyleProfile = defineEndpoint({
  path: "/get_style_profile",
  description:
    "The style profile authoring applies: the project's (stored in the .mdj), else the built-in the preference mcp-ext.style.profile names (default uml-standard). name returns a built-in instead: uml-standard, minimal, presentation, print.",
  readOnly: true,
  destructive: false,
  request: z.object({
    name: z.optional(doc(z.enum(BUILT_IN_NAMES), "A built-in profile.")),
  }),
  response: z.object({
    profile: profileOut(),
    source: doc(
      z.enum(["project", "preferences", "built-in"]),
      "Where it comes from.",
    ),
    builtIns: z.array(z.string()),
    problem: z.optional(
      doc(z.string(), "Why the project's stored profile was not used."),
    ),
  }),
  handle: (input) => {
    if (input.name !== undefined) {
      return {
        profile: builtInProfiles()[input.name]!,
        source: "built-in" as const,
        builtIns: [...BUILT_IN_NAMES],
      };
    }
    const e = effectiveProfile();
    return {
      profile: e.profile,
      source: e.source,
      builtIns: [...BUILT_IN_NAMES],
      ...(e.problem !== undefined && { problem: e.problem }),
    };
  },
});

export function setStyleProfileEndpoint(
  endpoints: () => readonly Endpoint[],
): Endpoint {
  return defineEndpoint({
    path: "/set_style_profile",
    description:
      "Store a style profile in the project, as one undo step: a built-in by name, a whole profile, or a patch merged into the current one (objects field by field; null turns a naming rule off). reset removes the project's profile, so the preference's built-in applies again. The profile is checked whole; an unknown field or a bad pattern is INVALID_ARGUMENT.",
    readOnly: false,
    destructive: false,
    request: z.object({
      profile: z.optional(
        doc(
          z.union([z.enum(BUILT_IN_NAMES), z.record(z.string(), z.unknown())]),
          "A built-in name, or a whole profile (see /get_style_profile).",
        ),
      ),
      patch: z.optional(
        doc(
          z.record(z.string(), z.unknown()),
          "Fields to change, merged into profile (or the current one), e.g. {strict: true} or {naming: {package: null}}.",
        ),
      ),
      reset: z.optional(
        doc(
          z.boolean(),
          "Remove the project's profile; nothing else may be given.",
        ),
      ),
    }),
    response: z.object({
      profile: profileOut(),
      source: z.enum(["project", "preferences"]),
      changed: doc(z.boolean(), "The project's stored profile changed."),
    }),
    handle: async (input) => {
      const project = requireProject();
      const tag = profileTag();
      if (input.reset) {
        if (input.profile !== undefined || input.patch !== undefined) {
          throw new ApiError(
            "INVALID_ARGUMENT",
            "reset: pass it alone, without profile or patch",
          );
        }
        if (tag) {
          await batchRunner.run(endpoints(), [
            { path: "/delete_element", body: { ref: tag._id } },
          ]);
        }
        const e = effectiveProfile();
        return { profile: e.profile, source: e.source, changed: tag !== null };
      }
      if (input.profile === undefined && input.patch === undefined) {
        throw new ApiError("INVALID_ARGUMENT", "Pass profile, patch or reset");
      }
      const base =
        typeof input.profile === "string"
          ? builtInProfiles()[input.profile]!
          : (input.profile ?? effectiveProfile().profile);
      const next = parseProfile(
        input.patch === undefined ? base : mergePatch(base, input.patch),
      );
      const text = JSON.stringify(next);
      const changed = String(tag?.value ?? "") !== text;
      if (changed) {
        await batchRunner.run(endpoints(), [
          tag
            ? {
                path: "/update_element",
                body: { ref: tag._id, field: "value", value: text },
              }
            : {
                path: "/add_tag",
                body: {
                  ref: project._id,
                  name: PROFILE_TAG,
                  kind: "string",
                  value: text,
                  hidden: true,
                },
              },
        ]);
      }
      return { profile: next, source: "project" as const, changed };
    },
  });
}

/** An element and everything it owns, owners first. */
function walk(root: Element, visit: (elem: Element) => void): void {
  visit(root);
  for (const field of [
    "ownedElements",
    "attributes",
    "operations",
    "literals",
  ]) {
    const list = root[field];
    if (Array.isArray(list)) for (const e of list as Element[]) walk(e, visit);
  }
}

/** The naming rule an element falls under. */
function kindOf(elem: Element): NamingKind | null {
  const name = elem.constructor.name;
  if (name !== "UMLAttribute") return namingKindOf(name);
  return elem.isStatic === true && elem.isReadOnly === true
    ? "constant"
    : "attribute";
}

interface Rename {
  elem: Element;
  kind: NamingKind;
  from: string;
  to: string;
}

/**
 * The renames the profile makes in `scope`, settled per owner and type so
 * a fixed name never takes a sibling's.
 */
function renamesIn(scope: Element, renames: Renames) {
  const groups = new Map<
    string,
    { elem: Element; from: string; to: string }[]
  >();
  walk(scope, (elem) => {
    const kind = kindOf(elem);
    const from = elem.name;
    if (kind === null || typeof from !== "string" || from === "") return;
    const to = renames.name(from, kind);
    const key = `${elem._parent?._id}|${elem.constructor.name}`;
    groups.set(key, [...(groups.get(key) ?? []), { elem, from, to }]);
  });
  const out: Rename[] = [];
  for (const group of groups.values()) {
    const names = settle(group);
    group.forEach((g, i) => {
      if (names[i] !== g.from) {
        out.push({
          elem: g.elem,
          kind: kindOf(g.elem)!,
          from: g.from,
          to: names[i]!,
        });
      }
    });
  }
  return out;
}

function diagramsIn(scope: Element): Element[] {
  if (scope instanceof type.Diagram) return [scope];
  const out: Element[] = [];
  walk(scope, (e) => {
    if (e instanceof type.Diagram) out.push(e);
  });
  return out;
}

export const applyStyleProfile = defineEndpoint({
  path: "/apply_style_profile",
  description:
    "Normalise what a scope already has to the style profile, as one undo step: names off the naming rules are rewritten (siblings stay distinct), every view on the scope's diagrams takes the profile's colours, fonts, edge style and show/hide switches. Answers what changed; a second call changes nothing. dryRun answers the renames without changing anything.",
  readOnly: false,
  destructive: false,
  request: z.object({
    scope: z.optional(
      ref("A diagram, a package or model; default the project."),
    ),
    names: z.optional(
      doc(z.boolean(), "Default true: apply the naming rules."),
    ),
    visuals: z.optional(
      doc(z.boolean(), "Default true: apply the visuals to the diagrams."),
    ),
    dryRun: z.optional(z.boolean()),
  }),
  response: z.object({
    profile: z.string(),
    diagrams: doc(z.int(), "Diagrams looked at."),
    styled: doc(z.int(), "Views given the profile's look."),
    renamed: z.array(
      z.object({
        path: z.nullable(z.string()),
        kind: z.string(),
        from: z.string(),
        to: z.string(),
      }),
    ),
    unfixed: doc(
      z.array(z.string()),
      "Names off the rules the profile only reports.",
    ),
    dryRun: z.optional(z.boolean()),
  }),
  handle: async (input) => {
    const scope =
      input.scope === undefined
        ? requireProject()
        : requireElement(input.scope, "Scope");
    const profile = effectiveProfile().profile;
    const renames = new Renames(profile);
    const toRename = input.names === false ? [] : renamesIn(scope, renames);
    const diagrams = input.visuals === false ? [] : diagramsIn(scope);
    const renamed = toRename.map((r) => ({
      path: pathOf(r.elem),
      kind: r.kind,
      from: r.from,
      to: r.to,
    }));
    const unfixed = renames.unfixed.map((u) => `${u.kind} ${u.name}`);
    if (input.dryRun) {
      return {
        profile: profile.name,
        diagrams: diagrams.length,
        styled: 0,
        renamed,
        unfixed,
        dryRun: true,
      };
    }
    const styled = await oneStep("apply style profile", () => {
      if (toRename.length > 0) {
        const builder = app.repository.getOperationBuilder();
        builder.begin("rename to style profile");
        for (const r of toRename) builder.fieldAssign(r.elem, "name", r.to);
        builder.end();
        inStarUML(() => app.repository.doOperation(builder.getOperation()));
      }
      return diagrams.reduce((n, d) => n + styleDiagram(d, profile), 0);
    });
    return {
      profile: profile.name,
      diagrams: diagrams.length,
      styled,
      renamed,
      unfixed,
    };
  },
});

const violationSchema = () =>
  z.object({
    rule: doc(z.string(), "naming.<kind>, visuals, documentation, duplicates."),
    setting: doc(z.string(), "What the profile says."),
    actual: z.string(),
    expected: z.optional(z.string()),
    fix: doc(z.string(), "One line on how to fix it."),
    autofix: z.nullable(
      z.object({ path: z.string(), body: z.record(z.string(), z.unknown()) }),
    ),
  });

type Violation = z.output<ReturnType<typeof violationSchema>>;

const DOCUMENTED_TYPES: Record<string, string> = {
  UMLPackage: "package",
  UMLClass: "class",
  UMLInterface: "interface",
};

function explainElement(elem: Element, profile: Profile): Violation[] {
  const out: Violation[] = [];
  const kind = kindOf(elem);
  const rule = kind && profile.naming[kind];
  const name = String(elem.name ?? "");
  if (rule && name) {
    const n = normalize(name, rule);
    if (n.violated) {
      out.push({
        rule: `naming.${kind}`,
        setting: `${rule.pattern} (fix ${rule.fix})`,
        actual: name,
        ...(n.fixed && { expected: n.name }),
        fix: n.fixed
          ? `Rename it to ${n.name}, or run /apply_style_profile on its owner.`
          : `No automatic fix (${rule.fix === "none" ? "the rule reports only" : "the fix does not match the pattern"}); rename it by hand to match ${rule.pattern}.`,
        autofix: n.fixed
          ? {
              path: "/update_element",
              body: { ref: elem._id, field: "name", value: n.name },
            }
          : null,
      });
    }
  }
  const documented = DOCUMENTED_TYPES[elem.constructor.name];
  if (
    documented &&
    (profile.rules.documentationRequired as string[]).includes(documented) &&
    !String(elem.documentation).trim()
  ) {
    out.push({
      rule: "documentation",
      setting: `documentation required on ${profile.rules.documentationRequired.join(", ")}`,
      actual: "no documentation",
      fix: "Write what it is responsible for.",
      autofix: null,
    });
  }
  if (profile.rules.forbidDuplicateNames && name && elem._parent) {
    const siblings = (elem._parent.ownedElements as Element[]).filter(
      (s) =>
        s !== elem &&
        s.constructor === elem.constructor &&
        s.name === elem.name,
    );
    if (siblings.length > 0) {
      out.push({
        rule: "duplicates",
        setting: "forbidDuplicateNames",
        actual: `${siblings.length + 1} ${elem.constructor.name} named ${name} in ${pathOf(elem._parent) ?? "the project"}`,
        fix: "Rename or merge them.",
        autofix: null,
      });
    }
  }
  for (const view of app.repository.getViewsOf(elem)) {
    const want = visualFor(view, profile);
    const off = (["fillColor", "lineColor", "fontColor"] as const).filter(
      (f) => want[f] !== undefined && view[f] !== want[f],
    );
    if (off.length === 0) continue;
    out.push({
      rule: "visuals",
      setting: off.map((f) => `${f} ${want[f]}`).join(", "),
      actual: off.map((f) => `${f} ${String(view[f])}`).join(", "),
      fix: "Apply the profile to the diagram.",
      autofix: {
        path: "/apply_style_profile",
        body: { scope: (view as View)._parent!._id, names: false },
      },
    });
  }
  return out;
}

export const explainStyleViolation = defineEndpoint({
  path: "/explain_style_violation",
  description:
    "Say which rules of the style profile an element breaks and why: its naming rule (pattern, the fixed name), documentation required, duplicate names, and views off the profile's colours, each with a one-line fix and an autofix request. Or, with kind and name, check a name before creating it.",
  readOnly: true,
  destructive: false,
  request: z.object({
    ref: z.optional(ref("The element.")),
    kind: z.optional(
      doc(
        z.enum(NAMING_KINDS),
        "Instead of ref: the naming rule to check name against.",
      ),
    ),
    name: z.optional(doc(z.string(), "With kind: the name to check.")),
  }),
  response: z.object({
    profile: z.string(),
    element: z.optional(z.nullable(z.string())),
    ok: doc(z.boolean(), "Nothing is off the profile."),
    violations: z.array(violationSchema()),
  }),
  handle: (input) => {
    const profile = effectiveProfile().profile;
    if (input.ref !== undefined) {
      const elem = requireElement(input.ref);
      const violations = explainElement(elem, profile);
      return {
        profile: profile.name,
        element: pathOf(elem),
        ok: violations.length === 0,
        violations,
      };
    }
    if (input.kind === undefined || input.name === undefined) {
      throw new ApiError("INVALID_ARGUMENT", "Pass ref, or kind and name");
    }
    const rule = profile.naming[input.kind];
    if (!rule) {
      return { profile: profile.name, ok: true, violations: [] };
    }
    const n = normalize(input.name, rule);
    return {
      profile: profile.name,
      ok: !n.violated,
      violations: n.violated
        ? [
            {
              rule: `naming.${input.kind}`,
              setting: `${rule.pattern} (fix ${rule.fix})`,
              actual: input.name,
              ...(n.fixed && { expected: n.name }),
              fix: n.fixed
                ? `Name it ${n.name}.`
                : `Choose a name matching ${rule.pattern}.`,
              autofix: null,
            },
          ]
        : [],
    };
  },
});
