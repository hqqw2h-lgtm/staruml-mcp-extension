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
import { ApiError } from "../errors.js";
import { builtInProfiles, type Profile } from "../style/profile.js";
import type { Element } from "../types.js";
import {
  type Catalogue,
  findViewpoint,
  viewpointCatalogue,
} from "../viewpoints/index.js";
import type { PartTexts } from "../viewpoints/parts.js";
import actorsGoalsFeatures from "./actors-goals-features.json";
import actorsGoalsUsecases from "./actors-goals-usecases.json";
import codeClasses from "./code-classes.json";
import componentC4 from "./component-c4.json";
import componentPackages from "./component-packages.json";
import componentUml from "./component-uml.json";
import containerOverview from "./container-overview.json";
import contextLandscape from "./context-landscape.json";
import dataErd from "./data-erd.json";
import deploymentNodes from "./deployment-nodes.json";
import lifecycleStates from "./lifecycle-states.json";
import runtimeActivity from "./runtime-activity.json";
import runtimeCommunication from "./runtime-communication.json";
import runtimeSequence from "./runtime-sequence.json";
import { type Template, templateSchema } from "./schema.js";

/*
 * The template catalogue (issue #43), parsed and cross-checked once with
 * the viewpoints: a template draws a kind its viewpoint is drawn as, every
 * viewpoint and kind has exactly one default template, a viewpoint that
 * requires a legend gets one from each of its templates, and every
 * decision rule names a template of its own viewpoint and kind.
 */

export const TEMPLATE_FILES: readonly unknown[] = [
  contextLandscape,
  containerOverview,
  componentPackages,
  componentC4,
  componentUml,
  codeClasses,
  runtimeSequence,
  runtimeCommunication,
  runtimeActivity,
  lifecycleStates,
  actorsGoalsUsecases,
  actorsGoalsFeatures,
  deploymentNodes,
  dataErd,
];

/** Problems the template schema cannot see, against the viewpoint catalogue. */
export function crossCheckTemplates(
  templates: readonly Template[],
  catalogue: Catalogue,
): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const t of templates) {
    if (names.has(t.name)) problems.push(`template ${t.name}: defined twice`);
    names.add(t.name);
    const vp = catalogue.byName.get(t.viewpoint)!;
    if (!(vp.kinds as string[]).includes(t.kind)) {
      problems.push(
        `template ${t.name}: ${t.viewpoint} is not drawn as ${t.kind}`,
      );
    }
    if (vp.required.includes("legend") && t.parts.legend.length === 0) {
      problems.push(`template ${t.name}: ${t.viewpoint} requires a legend`);
    }
  }
  for (const vp of catalogue.viewpoints) {
    for (const kind of vp.kinds) {
      const defaults = templates.filter(
        (t) => t.default && t.viewpoint === vp.name && t.kind === kind,
      );
      if (defaults.length !== 1) {
        problems.push(
          `${vp.name} as ${kind}: ${defaults.length} default templates, not one`,
        );
      }
    }
  }
  for (const r of catalogue.table.rules) {
    const t = templates.find((x) => x.name === r.template);
    if (!t) problems.push(`rule ${r.id}: no template ${r.template}`);
    else if (t.viewpoint !== r.viewpoint || t.kind !== r.kind) {
      problems.push(
        `rule ${r.id}: template ${r.template} draws ${t.viewpoint} as ${t.kind}`,
      );
    }
  }
  return problems;
}

/** Templates from their files, parsed and cross-checked; any problem throws. */
export function loadTemplates(files: readonly unknown[]): Template[] {
  const templates = files.map((t) => z.parse(templateSchema(), t));
  const problems = crossCheckTemplates(templates, viewpointCatalogue());
  if (problems.length > 0) {
    throw new Error(`template catalogue: ${problems.join("; ")}`);
  }
  return templates;
}

let catalogue: Template[] | null = null;

export function templates(): Template[] {
  catalogue ??= loadTemplates(TEMPLATE_FILES);
  return catalogue;
}

/** A template by name; another is NOT_FOUND with the names there are. */
export function findTemplate(name: string): Template {
  const found = templates().find((t) => t.name === name);
  if (!found) {
    throw new ApiError(
      "NOT_FOUND",
      `No template ${name}; the templates are ${templates()
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  return found;
}

/** The default template of a viewpoint drawn as a kind (the cross-check makes it exist). */
export const defaultTemplate = (viewpoint: string, kind: string): Template =>
  templates().find(
    (t) => t.default && t.viewpoint === viewpoint && t.kind === kind,
  )!;

/**
 * The profile a template draws with: the project's, or the built-in it
 * names for visuals, layout and quality, the project keeping its naming,
 * rules, policy and strictness.
 */
export function templateProfile(project: Profile, t: Template): Profile {
  if (t.style === "project") return project;
  const house = builtInProfiles()[t.style]!;
  return {
    ...house,
    strict: project.strict,
    blockSaveOnErrors: project.blockSaveOnErrors,
    naming: project.naming,
    rules: project.rules,
    policy: project.policy,
  };
}

/**
 * Where a diagram sits, as a reader says it: owner names from the model
 * down, unescaped; an owner named like the diagram (a collaboration, a
 * state machine) is the diagram's subject, not its scope.
 */
export function scopeText(
  parent: Element,
  name: string | null | undefined,
): string {
  const names: string[] = [];
  for (let e: Element | null | undefined = parent; e?._parent; e = e._parent) {
    names.unshift(String(e.name));
  }
  // A collaboration holds an interaction of its own name: one step.
  const steps = names.filter((n, i) => n !== names[i - 1]);
  while (steps.length > 1 && name?.startsWith(steps.at(-1)!)) steps.pop();
  return steps.join(" / ");
}

/** The title block and legend a template draws on a diagram named `name` under `parent`. */
export function templateParts(
  t: Template,
  name: string | null | undefined,
  parent: Element,
): PartTexts {
  const vp = findViewpoint(t.viewpoint);
  const where = scopeText(parent, name);
  return {
    ...(t.parts.titleBlock && {
      title: [
        name || vp.title,
        `${vp.title}: ${vp.question}`,
        ...(where ? [`Scope: ${where}`] : []),
        `Template: ${t.name} v${t.version}`,
      ].join("\n"),
    }),
    ...(t.parts.legend.length > 0 && {
      legend: ["Legend", ...t.parts.legend].join("\n"),
    }),
  };
}
