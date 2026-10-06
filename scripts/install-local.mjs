#!/usr/bin/env node
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

/**
 * Copies the built extension into the per-user StarUML extensions folder
 * (paths from docs: developing-extensions/getting-started). Run after
 * `npm run build`, then restart StarUML or use Debug > Reload.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

// Everything StarUML reads from an extension folder; see the package layout in
// docs: developing-extensions/getting-started.
const PAYLOAD = ["main.js", "menus", "preferences", "LICENSE"];

function main() {
  const target = join(extensionsDir(), EXT_NAME);

  if (!existsSync("main.js")) {
    console.error('main.js not found. Run "npm run build" first.');
    process.exit(1);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const entry of PAYLOAD) {
    cpSync(entry, join(target, entry), { recursive: true });
  }

  // Extension Manager reads package.json; build tooling fields mean nothing there.
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );

  console.log(`Installed to ${target}`);
  console.log("Restart StarUML, or use Debug > Reload, to load it.");
}

main();
