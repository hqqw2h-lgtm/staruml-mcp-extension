import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extensionDir,
  generateCode,
  listCodeGenerators,
  preferenceOptions,
  reverseCode,
  snapshot,
} from "../../../src/handlers/codegen.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

const nodeRequire = createRequire(__filename);

let env: MockEnvironment;
let root: string;
let loaded: string[];

/** Lays out an extension directory and loads its main.js the way StarUML's loader does. */
function install(
  name: string,
  files: Record<string, string>,
  preferences?: unknown,
): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "preferences"), { recursive: true });
  writeFileSync(join(dir, "main.js"), "exports.init = () => {};");
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(dir, file), text);
  }
  if (preferences !== undefined) {
    writeFileSync(
      join(dir, "preferences", "preference.json"),
      JSON.stringify(preferences),
    );
  }
  nodeRequire(join(dir, "main.js"));
  loaded.push(dir);
  return dir;
}

const JAVA_PREFERENCES = {
  id: "java",
  schema: {
    "java.gen": { type: "section" },
    "java.gen.javaDoc": { type: "check", default: true },
    "java.gen.indentSpaces": { type: "number", default: 4 },
    "java.rev.publicOnly": { type: "check", default: false },
    "other.gen.x": { type: "check", default: true },
  },
};

beforeEach(() => {
  env = installMockApp();
  root = realpathSync(mkdtempSync(join(tmpdir(), "codegen-test-")));
  loaded = [];
});

afterEach(() => {
  for (const dir of loaded) {
    for (const key of Object.keys(nodeRequire.cache)) {
      if (key.startsWith(dir)) delete nodeRequire.cache[key];
    }
  }
  rmSync(root, { recursive: true, force: true });
});

describe("extension discovery", () => {
  it("finds a loaded extension by its main.js and reads its preferences", () => {
    expect(extensionDir("staruml.java")).toBeNull();
    const dir = install("staruml.java", {}, JAVA_PREFERENCES);
    expect(extensionDir("staruml.java")).toBe(dir);
    env.app.preferences.set("java.gen.indentSpaces", 2);
    env.app.preferences.set("java.gen.javaDoc", true);
    expect(preferenceOptions(dir, "gen")).toEqual({
      javaDoc: true,
      indentSpaces: 2,
    });
    expect(preferenceOptions(dir, "rev")).toEqual({ publicOnly: null });
  });

  it("takes no options from an extension without preferences or schema", () => {
    const dir = install("staruml.python", {});
    expect(preferenceOptions(dir, "gen")).toEqual({});
    writeFileSync(
      join(dir, "preferences", "preference.json"),
      JSON.stringify({ id: "python" }),
    );
    expect(preferenceOptions(dir, "gen")).toEqual({});
  });

  it("lists every known generator with what is installed", async () => {
    const dir = install("staruml.java", {}, JAVA_PREFERENCES);
    install("staruml.python", {});
    const { generators } = await ok<{
      generators: Record<string, unknown>[];
    }>(listCodeGenerators);
    expect(generators).toEqual([
      {
        language: "java",
        extension: "staruml.java",
        installed: true,
        reverse: true,
        path: dir,
        generateOptions: { javaDoc: null, indentSpaces: null },
        reverseOptions: { publicOnly: null },
      },
      {
        language: "cpp",
        extension: "staruml.cpp",
        installed: false,
        reverse: true,
      },
      {
        language: "csharp",
        extension: "staruml.csharp",
        installed: false,
        reverse: true,
      },
      {
        language: "python",
        extension: "staruml.python",
        installed: true,
        reverse: false,
        path: join(root, "staruml.python"),
        generateOptions: {},
      },
    ]);
  });
});

describe("/generate_code", () => {
  it("runs the generator command with merged options and lists new and rewritten files", async () => {
    install("staruml.java", {}, JAVA_PREFERENCES);
    env.app.preferences.set("java.gen.indentSpaces", 4);
    const out = join(root, "out");
    mkdirSync(join(out, "keep"), { recursive: true });
    writeFileSync(join(out, "keep", "Same.java"), "same");
    writeFileSync(join(out, "Old.java"), "old");
    utimesSync(join(out, "Old.java"), 1, 1);
    const calls: unknown[][] = [];
    env.app.commands.register("java:generate", (base, path, options) => {
      calls.push([base, path, options]);
      mkdirSync(join(path as string, "Model"));
      writeFileSync(join(path as string, "Model", "A.java"), "class A {}");
      writeFileSync(join(path as string, "Old.java"), "new");
    });
    const data = await ok(generateCode, {
      language: "java",
      baseId: env.model._id,
      path: out,
      options: { javaDoc: false },
    });
    expect(data).toEqual({
      language: "java",
      base: env.model._id,
      path: out,
      count: 2,
      files: [join("Model", "A.java"), "Old.java"],
    });
    expect(calls).toEqual([
      [env.model, out, { javaDoc: false, indentSpaces: 4 }],
    ]);
  });

  it("creates the output directory and accepts no options", async () => {
    install("staruml.java", {});
    env.app.commands.register("java:generate", (_b, path) =>
      writeFileSync(join(path as string, "A.java"), ""),
    );
    const out = join(root, "a", "b");
    const data = await ok<{ files: string[] }>(generateCode, {
      language: "java",
      baseId: env.model._id,
      path: out,
    });
    expect(data.files).toEqual(["A.java"]);
  });

  it("explains a missing generator, command or base", async () => {
    const body = { language: "cpp", baseId: env.model._id, path: root };
    await fails(
      generateCode,
      body,
      "NOT_FOUND",
      "The cpp code generator (staruml.cpp) is not installed; install it from Tools > Extension Manager",
    );
    install("staruml.cpp", {});
    await fails(
      generateCode,
      body,
      "STARUML_ERROR",
      "staruml.cpp registered no cpp:generate command",
    );
    env.app.commands.register("cpp:generate", () => {});
    await fails(generateCode, { ...body, baseId: "nope" }, "NOT_FOUND");
  });

  it("reports generator failures, refused dialogs and unwritable paths", async () => {
    install("staruml.java", {});
    let mode = "throw";
    env.app.commands.register("java:generate", () => {
      if (mode === "throw") throw new Error("EEXIST: file already exists");
      env.app.dialogs.showInfoDialog("pick a folder");
    });
    const body = { language: "java", baseId: env.model._id, path: root };
    await fails(
      generateCode,
      body,
      "STARUML_ERROR",
      "java:generate failed: EEXIST: file already exists",
    );
    mode = "dialog";
    await fails(generateCode, body, "DIALOG_REQUIRED", /^java:generate opens/);
    const file = join(root, "file");
    writeFileSync(file, "");
    await fails(
      generateCode,
      { ...body, path: join(file, "sub") },
      "STARUML_ERROR",
      /^Cannot create /,
    );
    await fails(
      generateCode,
      { ...body, path: "rel" },
      "INVALID_ARGUMENT",
      "path: must be an absolute path",
    );
    await fails(
      generateCode,
      { ...body, language: "go" },
      "INVALID_ARGUMENT",
      /^language/,
    );
  });

  it("snapshots nested files by relative path", () => {
    mkdirSync(join(root, "x", "y"), { recursive: true });
    writeFileSync(join(root, "x", "y", "z.txt"), "");
    expect([...snapshot(root).keys()]).toEqual([join("x", "y", "z.txt")]);
  });
});

describe("/reverse_code", () => {
  const ANALYZER = `
    exports.analyze = (basePath, options) => {
      globalThis.__analyzed = { basePath, options };
      globalThis.__analyze();
    };`;
  const g = globalThis as unknown as Record<string, unknown>;

  afterEach(() => {
    delete g.__analyzed;
    delete g.__analyze;
  });

  it("calls the extension's analyzer and summarizes what it added", async () => {
    install("staruml.java", { "code-analyzer.js": ANALYZER }, JAVA_PREFERENCES);
    const src = join(root, "src");
    mkdirSync(src);
    g.__analyze = () => {
      const pkg = create("UMLPackage");
      pkg.name = "com";
      pkg._parent = env.project;
      const cls = create("UMLClass");
      cls.name = "A";
      cls._parent = pkg;
      env.app.repository.index(pkg);
      env.app.repository.index(cls);
      const orphan = create("UMLClass");
      orphan._parent = null;
      env.app.repository.index(orphan);
    };
    const data = await ok<{
      created: number;
      roots: { name: string | null }[];
    }>(reverseCode, {
      language: "java",
      path: src,
      options: { association: false },
    });
    expect(data.created).toBe(3);
    expect(data.roots.map((r) => r.name)).toEqual(["com", ""]);
    expect(g.__analyzed).toEqual({
      basePath: src,
      options: { publicOnly: null, association: false },
    });
  });

  it("refuses python, a missing directory, no project and analyzer failures", async () => {
    await fails(
      reverseCode,
      { language: "python", path: root },
      "INVALID_ARGUMENT",
      "language: the python generator has no reverse engineering",
    );
    await fails(
      reverseCode,
      { language: "java", path: root },
      "NOT_FOUND",
      /is not installed/,
    );
    install("staruml.java", { "code-analyzer.js": ANALYZER });
    await fails(
      reverseCode,
      { language: "java", path: join(root, "none") },
      "NOT_FOUND",
      `No such directory: ${join(root, "none")}`,
    );
    writeFileSync(join(root, "f"), "");
    await fails(
      reverseCode,
      { language: "java", path: join(root, "f") },
      "NOT_FOUND",
    );
    g.__analyze = () => {
      throw new Error("parse error");
    };
    await fails(
      reverseCode,
      { language: "java", path: root },
      "STARUML_ERROR",
      "java reverse engineering failed: parse error",
    );
    env.app.project.closeProject();
    await fails(reverseCode, { language: "java", path: root }, "NO_PROJECT");
    expect(existsSync(root)).toBe(true);
    expect(readFileSync(join(root, "f"), "utf-8")).toBe("");
  });
});
