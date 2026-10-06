import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import requests from "../fixtures/requests.json";
import { renameAliases } from "../../src/endpoint.js";
import { manifest } from "../../src/handlers/introspect.js";
import { endpoints } from "../../src/routes.js";

/*
 * Issue #27: the manifest the MCP server is generated from accepts every
 * request a live run sent and StarUML 7.1.1 answered with success
 * (tests/fixtures/requests.json, written by scripts/request-fixtures.mjs).
 * The live side of the contract, /introspect equal to the recorded
 * fixture, is tests/integration/introspect.live.test.ts.
 */

/** Endpoints no live suite calls successfully, each with the reason. */
const UNCALLED: Record<string, string> = {
  "/export_xmi":
    "needs the staruml-xmi extension, which this StarUML lacks; its refusal is tested live",
  "/import_xmi": "as /export_xmi",
};

describe("manifest contract", () => {
  const examples = requests as Record<string, Record<string, unknown>[]>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  it("has recorded examples for every endpoint but the listed ones", () => {
    const paths = endpoints.map((e) => e.path);
    const missing = paths.filter((p) => !(p in examples) && !(p in UNCALLED));
    expect(missing).toEqual([]);
    expect(
      Object.keys(examples).filter((p) => !paths.includes(p as never)),
    ).toEqual([]);
  });

  it.each(manifest(endpoints).map((e) => [e.path, e] as const))(
    "%s accepts its recorded requests",
    (path, entry) => {
      const validate = ajv.compile(entry.request);
      const aliases = endpoints.find((e) => e.path === path)!.aliases;
      // A body may use an older field name, which the server renames to the
      // canonical one before the schema applies (endpoint.ts renameAliases).
      for (const raw of examples[path] ?? []) {
        const body = renameAliases(raw, aliases).body;
        expect(
          validate(body),
          `${path} ${JSON.stringify(body)}: ${JSON.stringify(validate.errors)}`,
        ).toBe(true);
      }
    },
  );
});
