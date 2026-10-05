// Injected by esbuild and vitest `define` from package.json so the version
// reported on `GET /` cannot drift from the published manifest.
declare const __EXTENSION_VERSION__: string;

export const EXTENSION_NAME = "staruml-mcp-extension";
export const EXTENSION_VERSION: string = __EXTENSION_VERSION__;
