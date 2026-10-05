import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe } from "vitest";

/**
 * Live tests drive a real StarUML 7.1.1 with this build installed
 * (`npm run build && npm run install:local`, then restart StarUML). They
 * replace the open project, so run them only against a disposable session.
 */
export const LIVE = process.env.STARUML_LIVE === "1";
export const BASE_URL = process.env.STARUML_EXT_URL ?? "http://localhost:58322";

export const describeLive = describe.skipIf(!LIVE);

/** Set STARUML_EXT_TOKEN when StarUML has an access token (mcp-ext.token). */
export function headers(
  extra: Record<string, string> = {},
): Record<string, string> {
  const token = process.env.STARUML_EXT_TOKEN;
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...extra,
  };
}

export interface Envelope<T = Record<string, unknown>> {
  status: number;
  success: boolean;
  data: T;
  code?: string;
  error?: string;
  details?: unknown;
}

/** The summary every endpoint returns for an element by default. */
export interface Summary {
  _id: string;
  _type: string;
  name: string | null;
  _parent: string | null;
}

interface Contract {
  responses: Map<string, ValidateFunction>;
  error: ValidateFunction;
}

let contract: Promise<Contract> | null = null;

/**
 * The manifest StarUML publishes at /introspect, compiled once. Every answer
 * a live test receives is checked against it, so the JSON Schemas the MCP
 * server is generated from are held to what 7.1.1 actually returns.
 */
function loadContract(): Promise<Contract> {
  contract ??= (async () => {
    const res = await fetch(BASE_URL + "/introspect", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ include: ["endpoints"] }),
    });
    const { data } = (await res.json()) as {
      data: {
        endpoints: { path: string; response: object }[];
        errors: { schema: object };
      };
    };
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    return {
      responses: new Map(
        data.endpoints.map((e) => [e.path, ajv.compile(e.response)]),
      ),
      error: ajv.compile(data.errors.schema),
    };
  })();
  return contract;
}

export async function call<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<Envelope<T>> {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Omit<Envelope<T>, "status">;
  const { responses, error } = await loadContract();
  const validate = json.success ? responses.get(path) : error;
  const checked = json.success ? json.data : json;
  if (validate && !validate(checked)) {
    throw new Error(
      `${path} answered outside its manifest schema: ${JSON.stringify(validate.errors)}\n${JSON.stringify(checked).slice(0, 2000)}`,
    );
  }
  return { status: res.status, ...json };
}

/** Directory for .mdj files written by StarUML; override with STARUML_LIVE_DIR. */
export function liveDir(): string {
  return (
    process.env.STARUML_LIVE_DIR ?? mkdtempSync(join(tmpdir(), "staruml-live-"))
  );
}

/** The subset of the .mdj JSON the assertions read. */
export interface MdjElement {
  _type: string;
  _id: string;
  name?: string;
  [field: string]: unknown;
}

/** Every element of a saved .mdj tree, by id. */
export function indexMdj(root: MdjElement): Map<string, MdjElement> {
  const byId = new Map<string, MdjElement>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const elem = value as MdjElement;
      if (typeof elem._id === "string" && typeof elem._type === "string") {
        byId.set(elem._id, elem);
      }
      Object.values(elem).forEach(visit);
    }
  };
  visit(root);
  return byId;
}
