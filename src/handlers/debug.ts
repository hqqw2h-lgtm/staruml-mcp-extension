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
import { defineEndpoint } from "../endpoint.js";

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
  "metamodels",
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

const surfaceSchema = () =>
  z.object({
    type: z.string(),
    keys: z.nullable(z.array(z.string())),
    proto: z.nullable(z.array(z.string())),
  });

const debugResponse = z.object({
  app_keys: z.array(z.string()),
  ...(Object.fromEntries(
    INTROSPECTED_MANAGERS.map((name) => [name, surfaceSchema()]),
  ) as Record<
    (typeof INTROSPECTED_MANAGERS)[number],
    ReturnType<typeof surfaceSchema>
  >),
});

export const debug = defineEndpoint({
  path: "/debug",
  description:
    "Own keys of `app` and the own and prototype members of its managers.",
  readOnly: true,
  destructive: false,
  request: z.object({}),
  response: debugResponse,
  handle: () => {
    const data: Record<string, unknown> = { app_keys: Object.keys(app).sort() };
    for (const name of INTROSPECTED_MANAGERS) {
      data[name] = describeSurface(app[name]);
    }
    return data as z.output<typeof debugResponse>;
  },
});
