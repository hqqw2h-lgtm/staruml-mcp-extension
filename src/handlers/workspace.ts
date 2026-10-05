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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import * as z from "zod/mini";
import { extensionRoots } from "../app-modules.js";
import { withoutDialogs } from "../dialog-guard.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, inStarUML } from "../errors.js";
import { requireDiagram, requireElement, requireProject } from "../lookup.js";
import { elementSchema, ref } from "../schemas.js";
import { serialize, summarize } from "../serialize.js";
import { PREF } from "../settings.js";
import type { Element } from "../types.js";
import { oneStep } from "../undo.js";

/*
 * What StarUML 7.1.1 offers only through its windows (issue #28):
 * preferences, model fragments, XMI, templates, quick find, the editor's
 * working diagrams, the installed extensions and the project's own fields.
 */

const absoluteFile = (description: string) =>
  doc(
    z
      .string()
      .check(z.refine((p) => isAbsolute(p), "must be an absolute path")),
    description,
  );

const summarySchema = () =>
  z.object({
    _id: z.string(),
    _type: z.string(),
    name: z.nullable(z.string()),
    _parent: z.nullable(z.string()),
    path: z.optional(z.string()),
  });

// ------------------------------------------------------------ preferences

/** A preference item as preference.json declares it (core/preference-manager.js). */
interface PreferenceItem {
  text?: string;
  type?: string;
  default?: unknown;
  options?: { value: unknown; text?: string }[];
}

interface Preferences {
  getItem?(key: string): PreferenceItem | undefined;
}

const itemOf = (key: string): PreferenceItem | undefined =>
  (app.preferences as unknown as Preferences).getItem?.(key);

/** Never answered: the access token is a secret. */
const SECRET = new Set<string>([PREF.token]);

/**
 * Keys a caller may change: how diagrams are drawn and edited, each
 * extension's defaults for new views, and this extension's limits and log
 * level. Left out: what decides who may call this server (enabled, port,
 * token, allowed origins), where StarUML saves files and its update check.
 */
export const SETTABLE = [
  "view.",
  "diagramEditor.",
  "theme.",
  "validation.",
  "uml.",
  "sysml.",
  "bpmn.",
  "c4.",
  "dfd.",
  "erd.",
  "flowchart.",
  "mindmap.",
  "aws.",
  "azure.",
  "gcp.",
  "wireframe.",
  "mcp-ext.limits.",
  "mcp-ext.ui.",
  PREF.logLevel,
];

const settable = (key: string) =>
  SETTABLE.some((p) => (p.endsWith(".") ? key.startsWith(p) : key === p));

/** A registered preference key that may be read. */
function readableItem(key: string): PreferenceItem {
  const item = itemOf(key);
  if (!item || item.type === "section" || SECRET.has(key)) {
    throw new ApiError(
      "NOT_FOUND",
      SECRET.has(key)
        ? `${key} is a secret and is not answered; set it in Tools > MCP Extension`
        : `No preference ${key}; File > Preferences lists the keys`,
    );
  }
  return item;
}

/** Whether `value` fits the item's type (preference.json `type`). */
function fits(item: PreferenceItem, value: unknown): string | null {
  const values = (item.options ?? []).map((o) => o.value);
  switch (item.type) {
    case "check":
      return typeof value === "boolean" ? null : "true or false";
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : "a number";
    case "dropdown":
      return values.includes(value)
        ? null
        : `one of ${values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "combo":
      return typeof value === typeof values[0] ? null : `a ${typeof values[0]}`;
    case "color":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
        ? null
        : "a colour such as '#ffcc00'";
    default:
      return typeof value === "string" ? null : "a string";
  }
}

const preferenceSchema = () =>
  z.object({
    key: z.string(),
    value: z.unknown(),
    default: z.unknown(),
    type: doc(
      z.string(),
      "check, number, string, color, font, dropdown or combo.",
    ),
    settable: doc(z.boolean(), "Whether /set_preference may change it."),
    options: z.optional(z.array(z.unknown())),
  });

function describePreference(key: string, item: PreferenceItem) {
  return {
    key,
    value: app.preferences.get(key),
    // Every item but a section has one (PreferenceManager.validate).
    default: item.default,
    type: item.type!,
    settable: settable(key),
    ...(item.options && { options: item.options.map((o) => o.value) }),
  };
}

export const getPreference = defineEndpoint({
  path: "/get_preference",
  description:
    "Read a StarUML preference (File > Preferences) by key, e.g. 'diagramEditor.showGrid', 'view.lineStyle', 'uml.class.suppressOperations', 'mcp-ext.limits.maxBatchOps', with its default, type and whether /set_preference may change it. The access token is never answered.",
  readOnly: true,
  destructive: false,
  request: z.object({ key: doc(z.string().check(z.minLength(1)), "Key.") }),
  response: preferenceSchema(),
  handle: (input) => describePreference(input.key, readableItem(input.key)),
});

export const setPreference = defineEndpoint({
  path: "/set_preference",
  description:
    "Change a StarUML preference, as File > Preferences does; takes effect for what is drawn next. Allowed: view.*, diagramEditor.*, theme.*, validation.*, each diagram extension's defaults (uml.*, sysml.*, bpmn.*, c4.*, dfd.*, erd.*, flowchart.*, mindmap.*, aws.*, azure.*, gcp.*, wireframe.*), mcp-ext.limits.*, mcp-ext.ui.* and mcp-ext.server.logLevel; what decides who may call this server is not.",
  readOnly: false,
  destructive: false,
  request: z.object({
    key: doc(z.string().check(z.minLength(1)), "Key."),
    value: doc(z.unknown(), "New value, of the preference's type."),
  }),
  response: z.object({ ...preferenceSchema().shape, previous: z.unknown() }),
  handle: (input) => {
    const item = readableItem(input.key);
    if (!settable(input.key)) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `${input.key} is not changed through the API; settable keys start with ${SETTABLE.join(", ")}`,
      );
    }
    const wrong = fits(item, input.value);
    if (wrong) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `value: ${input.key} takes ${wrong}`,
      );
    }
    const previous = app.preferences.get(input.key);
    app.preferences.set(input.key, input.value);
    return { ...describePreference(input.key, item), previous };
  },
});

// -------------------------------------------------------------- fragments

export const exportFragment = defineEndpoint({
  path: "/export_fragment",
  description:
    "Write an element and everything it owns to a model fragment file (.mfj), as File > Export > Fragment does; /import_fragment reads it into any project.",
  readOnly: true,
  destructive: true,
  request: z.object({
    ref: ref("Element to export, e.g. a package."),
    filename: absoluteFile("Absolute .mfj path; overwritten."),
  }),
  response: z.object({ filename: z.string(), element: summarySchema() }),
  handle: (input) => {
    const elem = requireElement(input.ref);
    if (elem === app.project.getProject()) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        "ref: the project itself is saved with /save_project_as, not exported as a fragment",
      );
    }
    inStarUML(() => app.project.exportToFile(elem, input.filename));
    return { filename: input.filename, element: summarize(elem) };
  },
});

export const importFragment = defineEndpoint({
  path: "/import_fragment",
  description:
    "Read a model fragment file (.mfj) into an element's ownedElements, as File > Import > Fragment does. StarUML records the insertion as an operation that undo skips (ProjectManager.importFromFile, 7.1.1): delete the imported element to take it out again.",
  readOnly: false,
  destructive: false,
  request: z.object({
    filename: absoluteFile("Absolute .mfj path."),
    parent: z.optional(
      ref("Owner of the imported element; default the project."),
    ),
  }),
  response: z.object({ element: summarySchema() }),
  handle: (input) => {
    const parent =
      input.parent === undefined
        ? requireProject()
        : requireElement(input.parent, "Parent");
    if (!existsSync(input.filename)) {
      throw new ApiError("NOT_FOUND", `No file ${input.filename}`);
    }
    const elem = inStarUML(() =>
      app.project.importFromFile(parent, input.filename),
    );
    if (!elem) {
      throw new ApiError("STARUML_ERROR", `${input.filename} is empty`);
    }
    return { element: summarize(elem) };
  },
});

// -------------------------------------------------------------------- XMI

/**
 * XMI is the staruml-xmi extension's (Tools > Extension Manager), which
 * registers xmi:* import and export commands; 7.1.1 has none of its own.
 * Found by its commands, as the code generators are by theirs.
 */
function xmiCommand(direction: "import" | "export"): string {
  const id = Object.keys(app.commands.commands)
    .sort()
    .find((c) => c.startsWith("xmi:") && c.includes(direction));
  if (!id) {
    throw new ApiError(
      "NOT_FOUND",
      `XMI ${direction} needs the staruml-xmi extension (Tools > Extension Manager > XMI); no xmi:${direction} command is registered`,
    );
  }
  return id;
}

const xmiRequest = (description: string) =>
  z.object({ filename: absoluteFile(description) });

export const exportXmi = defineEndpoint({
  path: "/export_xmi",
  description:
    "Write the project as XMI 2.1 through the staruml-xmi extension, which must be installed; NOT_FOUND says so otherwise.",
  readOnly: true,
  destructive: true,
  request: xmiRequest("Absolute .xmi path; overwritten."),
  response: z.object({ filename: z.string(), command: z.string() }),
  handle: async (input) => {
    requireProject();
    const command = xmiCommand("export");
    await withoutDialogs(command, () =>
      app.commands.execute(command, input.filename),
    );
    return { filename: input.filename, command };
  },
});

export const importXmi = defineEndpoint({
  path: "/import_xmi",
  description:
    "Read an XMI 2.1 file into the project through the staruml-xmi extension, which must be installed; NOT_FOUND says so otherwise.",
  readOnly: false,
  destructive: false,
  request: xmiRequest("Absolute .xmi path."),
  response: z.object({ filename: z.string(), command: z.string() }),
  handle: async (input) => {
    requireProject();
    if (!existsSync(input.filename)) {
      throw new ApiError("NOT_FOUND", `No file ${input.filename}`);
    }
    const command = xmiCommand("import");
    await withoutDialogs(command, () =>
      app.commands.execute(command, input.filename),
    );
    return { filename: input.filename, command };
  },
});

// -------------------------------------------------------------- templates

interface Template {
  name: string;
  source: string;
  path: string;
}

/**
 * The templates File > New From Template lists: resources/templates and
 * each extension's templates/ folder (extension-loader.js reads them per
 * extension in 7.1.1).
 */
export function templates(): Template[] {
  return scanned("templates", scanTemplates);
}

/**
 * Folder scans, kept per set of roots: StarUML reads extensions and their
 * templates at start-up (extension-loader.js), so they change only with a
 * restart, and a scan of the 25 folders of 7.1.1 took ~100 ms of the
 * renderer per call (load test, issue #28).
 */
const scans = new Map<string, unknown>();

function scanned<T>(what: string, scan: () => T): T {
  const key = `${what} ${JSON.stringify(extensionRoots())}`;
  if (!scans.has(key)) scans.set(key, scan());
  return scans.get(key) as T;
}

function scanTemplates(): Template[] {
  const out: Template[] = [];
  const add = (dir: string, source: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).sort()) {
      if (extname(file) !== ".mdj") continue;
      out.push({
        name: basename(file, ".mdj"),
        source,
        path: join(dir, file),
      });
    }
  };
  for (const root of extensionRoots()) {
    if (root.source === "core") add(join(root.dir, "templates"), "core");
    else {
      for (const ext of extensionDirs(root.dir)) {
        add(join(ext, "templates"), basename(ext));
      }
    }
  }
  return out;
}

const templateSchema = () =>
  z.object({ name: z.string(), source: z.string(), path: z.string() });

export const listTemplates = defineEndpoint({
  path: "/list_templates",
  description:
    "The project templates StarUML offers under File > New From Template, from its resources and its extensions, for /new_from_template.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({ templates: z.array(templateSchema()) }),
  handle: () => ({ templates: templates() }),
});

export const newFromTemplate = defineEndpoint({
  path: "/new_from_template",
  description:
    "Replace the open project with a new one from a template (File > New From Template), by name as /list_templates gives it, e.g. 'UMLConventional', or an absolute .mdj path; unsaved changes are lost and the new project has no file.",
  readOnly: false,
  destructive: true,
  request: z.object({
    template: doc(
      z.string().check(z.minLength(1)),
      "Template name, or an absolute .mdj path.",
    ),
  }),
  response: z.object({
    template: templateSchema(),
    project: elementSchema(),
  }),
  handle: (input) => {
    const all = templates();
    const found = isAbsolute(input.template)
      ? existsSync(input.template)
        ? {
            name: basename(input.template, ".mdj"),
            source: "file",
            path: input.template,
          }
        : undefined
      : all.find((t) => t.name === input.template);
    if (!found) {
      throw new ApiError(
        "NOT_FOUND",
        `No template ${input.template}; templates: ${all.map((t) => t.name).join(", ")}`,
      );
    }
    const project = inStarUML(() => app.project.loadAsTemplate(found.path));
    if (!project) {
      throw new ApiError("STARUML_ERROR", `${found.path} is empty`);
    }
    return { template: found, project: serialize(project, {}) };
  },
});

// ------------------------------------------------------------- quick find

/** The fields quick find reads, each with what the match is reported as. */
function texts(elem: Element): [string, string][] {
  // Model declares name; documentation and tags come with ExtensibleModel
  // (core metamodel), which some models, e.g. ERD columns, are not.
  return [
    ["name", String(elem.name)],
    ["documentation", String(elem.documentation ?? "")],
    ...((elem.tags as Element[] | undefined) ?? []).map(
      (t): [string, string] => [
        `tag ${String(t.name)}`,
        `${String(t.name)} ${String(t.value)}`,
      ],
    ),
  ];
}

/** Up to 40 characters either side of the match, on one line. */
function snippet(text: string, at: number, length: number): string {
  const from = Math.max(0, at - 40);
  const to = Math.min(text.length, at + length + 40);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

export const quickFind = defineEndpoint({
  path: "/quick_find",
  description:
    "Find model elements whose name, documentation or tags contain a text, case-insensitively, as Edit > Find does; each match with its path, where it matched and the text around it. Views are not searched.",
  readOnly: true,
  destructive: false,
  request: z.object({
    text: doc(z.string().check(z.minLength(1)), "Text to find."),
    limit: z.optional(
      doc(
        z.int().check(z.minimum(1), z.maximum(500)),
        "Most matches answered; default 50.",
      ),
    ),
  }),
  response: z.object({
    matches: z.array(
      z.object({
        element: summarySchema(),
        field: doc(z.string(), "name, documentation or 'tag <name>'."),
        text: z.string(),
      }),
    ),
    total: z.int(),
    truncated: z.boolean(),
  }),
  handle: (input) => {
    const needle = input.text.toLowerCase();
    const limit = input.limit ?? 50;
    const matches: {
      element: ReturnType<typeof summarize>;
      field: string;
      text: string;
    }[] = [];
    let total = 0;
    const elements = app.repository.findAll(
      (e) => e instanceof type.Model && !(e instanceof type.Diagram),
    );
    for (const elem of elements) {
      const hit = texts(elem).find(([, t]) => t.toLowerCase().includes(needle));
      if (!hit) continue;
      total++;
      if (matches.length >= limit) continue;
      const at = hit[1].toLowerCase().indexOf(needle);
      matches.push({
        element: summarize(elem),
        field: hit[0],
        text: snippet(hit[1], at, needle.length),
      });
    }
    return { matches, total, truncated: total > matches.length };
  },
});

// ------------------------------------------------------- working diagrams

export const listWorkingDiagrams = defineEndpoint({
  path: "/list_working_diagrams",
  description:
    "The diagrams open in the editor's tabs, in tab order, and which one is current. /switch_diagram opens one, /close_diagram closes one, /close_diagrams several.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({
    diagrams: z.array(
      z.object({ ...summarySchema().shape, current: z.boolean() }),
    ),
  }),
  handle: () => {
    const current = app.diagrams.getCurrentDiagram();
    return {
      diagrams: app.diagrams.getWorkingDiagrams().map((d) => ({
        ...summarize(d),
        current: d === current,
      })),
    };
  },
});

export const closeDiagrams = defineEndpoint({
  path: "/close_diagrams",
  description:
    "Close editor tabs: the diagrams named, or every one but those in keep; the diagrams stay in the model.",
  readOnly: false,
  destructive: false,
  request: z.object({
    diagrams: z.optional(z.array(ref("Diagram."))),
    keep: z.optional(
      doc(z.array(ref("Diagram.")), "With no diagrams: tabs left open."),
    ),
  }),
  response: z.object({ closed: z.array(z.string()) }),
  handle: (input) => {
    const keep = new Set((input.keep ?? []).map((d) => requireDiagram(d)));
    const targets =
      input.diagrams === undefined
        ? [...app.diagrams.getWorkingDiagrams()].filter((d) => !keep.has(d))
        : input.diagrams.map((d) => requireDiagram(d));
    for (const d of targets) inStarUML(() => app.diagrams.closeDiagram(d));
    return { closed: targets.map((d) => d._id) };
  },
});

// ------------------------------------------------------------- extensions

/** Extension folders under `root`: each one with a package.json. */
function extensionDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

/** Every "command" a menu file of the extension names, recursively. */
function menuCommands(dir: string): string[] {
  const menus = join(dir, "menus");
  if (!existsSync(menus)) return [];
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const command = (value as { command?: unknown }).command;
      if (typeof command === "string") found.add(command);
      Object.values(value).forEach(visit);
    }
  };
  for (const file of readdirSync(menus).filter((f) => f.endsWith(".json"))) {
    try {
      visit(JSON.parse(readFileSync(join(menus, file), "utf-8")));
    } catch {
      // A menu file StarUML cannot read either adds no command.
    }
  }
  return [...found].sort();
}

function scanExtensions() {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return extensionRoots()
    .filter((r) => r.source !== "core")
    .flatMap((root) =>
      extensionDirs(root.dir).map((dir) => {
        let pkg: Record<string, unknown> = {};
        try {
          pkg = JSON.parse(
            readFileSync(join(dir, "package.json"), "utf-8"),
          ) as Record<string, unknown>;
        } catch {
          // An unreadable package.json is listed by its folder name.
        }
        return {
          name: str(pkg.name) ?? basename(dir),
          title: str(pkg.title),
          version: str(pkg.version),
          description: str(pkg.description),
          source: root.source,
          path: dir,
          commands: menuCommands(dir),
        };
      }),
    );
}

export const listExtensions = defineEndpoint({
  path: "/list_extensions",
  description:
    "The extensions StarUML loads (essential, default, dev and user folders) with name, title, version and description, and the commands each adds to the menus that are registered now, for /execute_command.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({
    extensions: z.array(
      z.object({
        name: z.string(),
        title: z.nullable(z.string()),
        version: z.nullable(z.string()),
        description: z.nullable(z.string()),
        source: doc(z.string(), "essential, default, dev or user."),
        path: z.string(),
        commands: doc(
          z.array(z.string()),
          "Command ids its menus name that are registered.",
        ),
      }),
    ),
  }),
  handle: () => {
    // Commands are registered at run time, so they are filtered per call.
    const registered = app.commands.commands;
    return {
      extensions: scanned("extensions", scanExtensions).map((e) => ({
        ...e,
        commands: e.commands.filter((c) => Object.hasOwn(registered, c)),
      })),
    };
  },
});

// -------------------------------------------------------- project metadata

const METADATA = [
  "name",
  "author",
  "company",
  "copyright",
  "version",
  "documentation",
] as const;

const metadataSchema = () =>
  z.object(
    Object.fromEntries(METADATA.map((k) => [k, z.string()])) as Record<
      (typeof METADATA)[number],
      z.ZodMiniString
    >,
  );

const metadataOf = (project: Element) =>
  Object.fromEntries(METADATA.map((k) => [k, String(project[k])])) as Record<
    (typeof METADATA)[number],
    string
  >;

export const getProjectMetadata = defineEndpoint({
  path: "/get_project_metadata",
  description:
    "The project's own fields: name, author, company, copyright, version and documentation (the Project's attributes in the core metamodel).",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: metadataSchema(),
  handle: () => metadataOf(requireProject()),
});

export const setProjectMetadata = defineEndpoint({
  path: "/set_project_metadata",
  description:
    "Set any of the project's name, author, company, copyright, version and documentation, as one undo step; answers them all.",
  readOnly: false,
  destructive: false,
  request: z.object(
    Object.fromEntries(
      METADATA.map((k) => [k, z.optional(z.string())]),
    ) as Record<(typeof METADATA)[number], z.ZodMiniOptional<z.ZodMiniString>>,
  ),
  response: metadataSchema(),
  handle: async (input) => {
    const project = requireProject();
    await oneStep("set project metadata", () => {
      for (const k of METADATA) {
        const value = input[k];
        if (value !== undefined && project[k] !== value) {
          inStarUML(() => app.engine.setProperty(project, k, value));
        }
      }
    });
    return metadataOf(project);
  },
});
