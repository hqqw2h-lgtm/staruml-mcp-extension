#!/usr/bin/env node
/**
 * Copy built extension to the StarUML user extensions folder.
 * Run with: npm run install:local (after npm run build)
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const EXT_NAME = "staruml-mcp-extension";

function extensionsDir() {
  const home = homedir();
  switch (platform()) {
    case "win32":
      return join(home, "AppData", "Roaming", "StarUML", "extensions", "user");
    case "darwin":
      return join(
        home,
        "Library",
        "Application Support",
        "StarUML",
        "extensions",
        "user",
      );
    default:
      return join(home, ".config", "StarUML", "extensions", "user");
  }
}

function main() {
  const target = join(extensionsDir(), EXT_NAME);
  const mainJs = "main.js";
  const pkgJson = "package.json";

  if (!existsSync(mainJs)) {
    console.error(`❌ ${mainJs} not found. Run "npm run build" first.`);
    process.exit(1);
  }

  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });

  cpSync(mainJs, join(target, "main.js"));

  const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
  // Trim dev-only fields before installing
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );

  console.log(`✅ Installed to: ${target}`);
  console.log(
    `   Restart StarUML or press Debug → Reload (Ctrl+R) in StarUML to load.`,
  );
}

main();
