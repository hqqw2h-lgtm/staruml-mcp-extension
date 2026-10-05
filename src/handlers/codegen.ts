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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import * as z from "zod/mini";
import { withoutDialogs } from "../dialog-guard.js";
import { defineEndpoint, doc } from "../endpoint.js";
import { ApiError, errorMessage } from "../errors.js";
import { requireElement, requireProject } from "../lookup.js";
import { id } from "../schemas.js";
import { summarize } from "../serialize.js";

/**
 * StarUML's code generators are separate extensions, installed from Tools >
 * Extension Manager. Each registers "<language>:generate" taking
 * (base, path, options), which opens an element picker or a folder dialog
 * only for an argument left out (staruml-java 0.9.7 main.js
 * _handleGenerate; the C++, C# and Python generators follow the same
 * layout). Reverse engineering goes to the extension's code-analyzer.js
 * analyze(basePath, options) directly: "java:reverse" in 0.9.7 analyzes only
 * when it has asked for the folder itself and ignores a passed path.
 */
export const GENERATORS = {
  java: { extension: "staruml.java", analyzer: "code-analyzer.js" },
  cpp: { extension: "staruml.cpp", analyzer: "code-analyzer.js" },
  csharp: { extension: "staruml.csharp", analyzer: "code-analyzer.js" },
  python: { extension: "staruml.python", analyzer: null },
} as const;

export type Language = keyof typeof GENERATORS;
const LANGUAGES = Object.keys(GENERATORS) as [Language, ...Language[]];

const generateCommand = (language: Language) => `${language}:generate`;

const nodeRequire = createRequire(__filename);

/**
 * The directory an extension was loaded from. Extensions are loaded with
 * Node's require (extensibility/extension-loader.js loadExtension), so their
 * main.js sits in the shared module cache whichever extensions folder
 * (user, dev or default) holds them.
 */
export function extensionDir(extension: string): string | null {
  const suffix = `${sep}${extension}${sep}main.js`;
  const main = Object.keys(nodeRequire.cache).find((p) => p.endsWith(suffix));
  return main === undefined ? null : dirname(main);
}

interface PreferenceSchema {
  id?: string;
  schema?: Record<string, { type?: string }>;
}

/**
 * The options the generator's own command would use: every
 * "<id>.<section>.<name>" preference of its preferences/preference.json
 * (docs: developing-extensions/defining-preferences), read through
 * app.preferences so values set in the preference dialog apply.
 */
export function preferenceOptions(
  dir: string,
  section: "gen" | "rev",
): Record<string, unknown> {
  const file = join(dir, "preferences", "preference.json");
  if (!existsSync(file)) return {};
  const { id: prefix, schema = {} } = JSON.parse(
    readFileSync(file, "utf-8"),
  ) as PreferenceSchema;
  const start = `${prefix}.${section}.`;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key, item]) => key.startsWith(start) && item.type !== "section")
      .map(([key]) => [key.slice(start.length), app.preferences.get(key)]),
  );
}

function requireGenerator(language: Language): string {
  const dir = extensionDir(GENERATORS[language].extension);
  if (dir === null) {
    throw new ApiError(
      "NOT_FOUND",
      `The ${language} code generator (${GENERATORS[language].extension}) is not installed; install it from Tools > Extension Manager`,
    );
  }
  return dir;
}

/** Modification times of the files under `dir`, by path relative to it. */
export function snapshot(dir: string): Map<string, number> {
  const files = new Map<string, number>();
  const visit = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.set(relative(dir, full), statSync(full).mtimeMs);
    }
  };
  visit(dir);
  return files;
}

const absoluteDir = (description: string) =>
  doc(
    z
      .string()
      .check(z.refine((p) => isAbsolute(p), "must be an absolute path")),
    description,
  );

const languageField = () =>
  doc(z.enum(LANGUAGES), "Generator language: java, cpp, csharp or python.");

const optionsField = (description: string) =>
  z.optional(doc(z.record(z.string(), z.unknown()), description));

export const listCodeGenerators = defineEndpoint({
  path: "/list_code_generators",
  description:
    "Which code generator extensions are installed, for /generate_code and /reverse_code, with the options each takes from its preferences.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: z.object({
    generators: z.array(
      z.object({
        language: z.string(),
        extension: z.string(),
        installed: z.boolean(),
        reverse: doc(z.boolean(), "Whether /reverse_code supports it."),
        path: z.optional(doc(z.string(), "Extension directory, if installed.")),
        generateOptions: z.optional(z.record(z.string(), z.unknown())),
        reverseOptions: z.optional(z.record(z.string(), z.unknown())),
      }),
    ),
  }),
  handle: () => ({
    generators: LANGUAGES.map((language) => {
      const { extension, analyzer } = GENERATORS[language];
      const dir = extensionDir(extension);
      return {
        language,
        extension,
        installed: dir !== null,
        reverse: analyzer !== null,
        ...(dir !== null && {
          path: dir,
          generateOptions: preferenceOptions(dir, "gen"),
          ...(analyzer !== null && {
            reverseOptions: preferenceOptions(dir, "rev"),
          }),
        }),
      };
    }),
  }),
});

export const generateCode = defineEndpoint({
  path: "/generate_code",
  description:
    "Generate source code from a model element with an installed generator extension (Tools > <Language> > Generate Code) into a directory, and list the files written.",
  readOnly: false,
  destructive: true,
  request: z.object({
    language: languageField(),
    baseId: id(
      "Element to generate from: a package or model generates its whole tree, a class or interface one file.",
    ),
    path: absoluteDir(
      "Absolute output directory; created if missing. A package becomes a subdirectory named after it, and the Java generator fails if that already exists.",
    ),
    options: optionsField(
      "Generator options by name, e.g. {indentSpaces: 2, javaDoc: false} for Java; the rest come from the generator's preferences (see /list_code_generators).",
    ),
  }),
  response: z.object({
    language: z.string(),
    base: z.string(),
    path: z.string(),
    count: z.int(),
    files: doc(
      z.array(z.string()),
      "Files created or rewritten, relative to path, sorted.",
    ),
  }),
  handle: async (input) => {
    const dir = requireGenerator(input.language);
    const command = generateCommand(input.language);
    if (!Object.hasOwn(app.commands.commands, command)) {
      throw new ApiError(
        "STARUML_ERROR",
        `${GENERATORS[input.language].extension} registered no ${command} command`,
      );
    }
    const base = requireElement(input.baseId, "Base element");
    try {
      mkdirSync(input.path, { recursive: true });
    } catch (err) {
      throw new ApiError(
        "STARUML_ERROR",
        `Cannot create ${input.path}: ${errorMessage(err)}`,
      );
    }
    const before = snapshot(input.path);
    const options = { ...preferenceOptions(dir, "gen"), ...input.options };
    await guarded(command, () =>
      app.commands.execute(command, base, input.path, options),
    );
    const files = [...snapshot(input.path)]
      .filter(([file, mtime]) => before.get(file) !== mtime)
      .map(([file]) => file)
      .sort();
    return {
      language: input.language,
      base: base._id,
      path: input.path,
      count: files.length,
      files,
    };
  },
});

/** Runs extension code with dialogs refused, reporting what it throws as STARUML_ERROR. */
async function guarded(what: string, run: () => unknown): Promise<void> {
  try {
    await withoutDialogs(what, run);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("STARUML_ERROR", `${what} failed: ${errorMessage(err)}`);
  }
}

interface Analyzer {
  analyze(basePath: string, options: Record<string, unknown>): unknown;
}

export const reverseCode = defineEndpoint({
  path: "/reverse_code",
  description:
    "Reverse-engineer a source directory into the open project with an installed generator extension (Tools > <Language> > Reverse Code), and summarize the elements it added.",
  readOnly: false,
  destructive: false,
  request: z.object({
    language: languageField(),
    path: absoluteDir(
      "Absolute directory whose source files are read, recursively.",
    ),
    options: optionsField(
      "Analyzer options by name, e.g. {association: false, publicOnly: true} for Java; the rest come from its preferences.",
    ),
  }),
  response: z.object({
    language: z.string(),
    path: z.string(),
    created: doc(z.int(), "Elements added, views and diagrams included."),
    roots: doc(
      z.array(
        z.object({
          _id: z.string(),
          _type: z.string(),
          name: z.optional(z.nullable(z.string())),
          _parent: z.optional(z.nullable(z.string())),
        }),
      ),
      "The added elements whose owner existed before, e.g. the top-level packages.",
    ),
  }),
  handle: async (input) => {
    const { analyzer } = GENERATORS[input.language];
    if (analyzer === null) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `language: the ${input.language} generator has no reverse engineering`,
      );
    }
    const dir = requireGenerator(input.language);
    requireProject();
    if (!existsSync(input.path) || !statSync(input.path).isDirectory()) {
      throw new ApiError("NOT_FOUND", `No such directory: ${input.path}`);
    }
    const module = createRequire(join(dir, "main.js"))(
      `./${analyzer}`,
    ) as Analyzer;
    const before = new Set(Object.keys(app.repository.getIdMap()));
    const options = { ...preferenceOptions(dir, "rev"), ...input.options };
    await guarded(`${input.language} reverse engineering`, () =>
      module.analyze(input.path, options),
    );
    const added = Object.entries(app.repository.getIdMap())
      .filter(([key]) => !before.has(key))
      .map(([, elem]) => elem);
    const fresh = new Set(added);
    return {
      language: input.language,
      path: input.path,
      created: added.length,
      roots: added
        .filter((e) => !e._parent || !fresh.has(e._parent))
        .map(summarize),
    };
  },
});
