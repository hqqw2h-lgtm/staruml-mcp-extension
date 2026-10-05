import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);
export default defineConfig(({ mode }) => {
  const live = mode === "live" || process.env.STARUML_LIVE === "1";
  return {
    define: { __EXTENSION_VERSION__: JSON.stringify(version) },
    test: {
      environment: "node",
      env: live ? { STARUML_LIVE: "1" } : {},
      // Live tests drive the single StarUML instance on this machine, so they run
      // alone and in file order; unit tests never touch it.
      include: live
        ? ["tests/integration/**/*.live.test.ts"]
        : ["tests/unit/**/*.test.ts"],
      fileParallelism: !live,
      testTimeout: live ? 30_000 : 5_000,
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        // types.ts only declares the StarUML globals and emits no code.
        exclude: ["src/types.ts"],
        reporter: [["text", { skipFull: false }], "html", "json-summary"],
        thresholds: {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  };
});
