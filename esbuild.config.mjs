import { readFileSync } from "node:fs";
import esbuild from "esbuild";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: [
    // Provided by StarUML runtime (Electron)
    "electron",
  ],
  define: { __EXTENSION_VERSION__: JSON.stringify(version) },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(options);
}
