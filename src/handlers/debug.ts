import type { Handler } from "../http-server.js";

/**
 * Managers whose runtime surface we report. The prototype lists are the ground
 * truth that `src/types.ts` and the test mock are checked against, because the
 * published API reference (files.staruml.io/api-docs/6.0.0) lags the 7.x runtime.
 */
export const INTROSPECTED_MANAGERS = [
  "commands",
  "project",
  "repository",
  "factory",
  "engine",
  "diagrams",
  "preferences",
  "selections",
  "dialogs",
] as const;

export interface ObjectSurface {
  type: string;
  keys: string[] | null;
  proto: string[] | null;
}

export function describeSurface(target: unknown): ObjectSurface {
  if (target === null || typeof target !== "object") {
    return { type: typeof target, keys: null, proto: null };
  }
  return {
    type: "object",
    keys: Object.keys(target).sort(),
    proto: Object.getOwnPropertyNames(Object.getPrototypeOf(target)).sort(),
  };
}

export const debug: Handler = () => {
  const data: Record<string, unknown> = { app_keys: Object.keys(app).sort() };
  for (const name of INTROSPECTED_MANAGERS) {
    data[name] = describeSurface(app[name]);
  }
  return { success: true, data };
};
