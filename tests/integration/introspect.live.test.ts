import { expect, it } from "vitest";
import recorded from "../fixtures/introspect.7.1.1.json";
import { BASE_URL, call, describeLive, headers } from "./support.js";

// Issue #5: the catalogue and manifest the MCP server is generated from. The
// unit-test mock is built from the recorded copy, so a difference here means
// either StarUML or the endpoint list changed: re-run
// `npm run snapshot:introspect` and review the diff.
describeLive("/introspect against StarUML 7.1.1", () => {
  it("answers exactly the recorded catalogue, toolbox and manifest", async () => {
    const res = await call<typeof recorded>("/introspect");
    expect(res.status).toBe(200);
    for (const section of Object.keys(recorded) as (keyof typeof recorded)[]) {
      expect(res.data[section], section).toEqual(recorded[section]);
    }
    expect(Object.keys(res.data).sort()).toEqual(Object.keys(recorded).sort());
  });

  it("lists the same endpoints in the manifest as on GET /", async () => {
    const root = (await (
      await fetch(BASE_URL + "/", { headers: headers() })
    ).json()) as {
      endpoints: string[];
    };
    expect(recorded.endpoints.map((e) => e.path).sort()).toEqual(
      root.endpoints,
    );
  });

  it("filters sections and types and flattens inherited attributes", async () => {
    const res = await call<{
      metamodel: Record<string, { attributes: { name: string }[] }>;
      factory?: unknown;
    }>("/introspect", {
      include: ["metamodel"],
      types: ["UMLClass"],
      inherited: true,
    });
    expect(Object.keys(res.data.metamodel)).toEqual(["UMLClass"]);
    expect(res.data.factory).toBeUndefined();
    expect(res.data.metamodel.UMLClass!.attributes.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "name",
        "ownedElements",
        "attributes",
        "isActive",
      ]),
    );
  });

  it("validates each request against the endpoint's own schema", async () => {
    for (const [path, body] of [
      ["/introspect", { include: ["nope"] }],
      ["/create_element", { type: "UMLClass" }],
      ["/update_element", { id: "x", op: "merge" }],
      ["/add_attribute", { ownerId: "x", name: 3 }],
      ["/create_relationship", { type: "UMLDependency", tailId: "a" }],
    ] as const) {
      expect(await call(path, body), path).toMatchObject({
        status: 400,
        code: "INVALID_ARGUMENT",
        details: expect.any(Array),
      });
    }
  });
});
