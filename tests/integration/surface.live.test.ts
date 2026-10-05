import { expect, it } from "vitest";
import surface from "../fixtures/app-surface.7.1.1.json";
import { BASE_URL, call, describeLive } from "./support.js";

// Guards the unit-test mock: it is checked against this fixture, and this
// checks the fixture against the running StarUML.
describeLive("StarUML runtime surface", () => {
  it("matches the recorded 7.1.1 prototypes for every introspected manager", async () => {
    const res = await call<Record<string, { proto: string[] }>>("/debug");
    expect(res.success).toBe(true);
    for (const [name, recorded] of Object.entries(surface.managers)) {
      expect(res.data[name]?.proto, `app.${name}`).toEqual(recorded.proto);
    }
  });

  it("answers GET / with the endpoint list", async () => {
    const res = await fetch(BASE_URL + "/");
    const json = (await res.json()) as { name: string; endpoints: string[] };
    expect(json.name).toBe("staruml-mcp-extension");
    expect(json.endpoints).toContain("/create_edge_with_view");
  });
});
