import { expect, it } from "vitest";
import { BASE_URL, call, describeLive, headers } from "./support.js";

const post = (path: string, init: RequestInit = {}) =>
  fetch(BASE_URL + path, { method: "POST", body: "{}", ...init });

// Issue #10: request checks against the running StarUML. The access token is
// set and cleared through the extension's own mcp-ext:set-token command.
describeLive("access rules", () => {
  it("requires Content-Type: application/json", async () => {
    const plain = await post("/get_project_info", {
      headers: { "Content-Type": "text/plain" },
    });
    expect(plain.status).toBe(415);
    expect(await plain.json()).toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    const json = await post("/get_project_info", {
      headers: headers({ "Content-Type": "application/json; charset=utf-8" }),
    });
    expect(json.status).toBe(200);
  });

  it("refuses requests from web pages", async () => {
    const res = await post("/get_project_info", {
      headers: headers({ Origin: "https://example.com" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    const listing = await fetch(BASE_URL + "/", {
      headers: headers({ Origin: "null" }),
    });
    expect(listing.status).toBe(403);
  });

  it("enforces an access token once one is set", async () => {
    // call() loads the manifest on first use, which needs no token yet.
    await call("/is_modified");
    const set = await call("/execute_command", {
      id: "mcp-ext:set-token",
      args: ["live-token"],
    });
    expect(set.data).toMatchObject({ result: "set" });
    try {
      const none = await post("/get_project_info", { headers: headers() });
      expect(none.status).toBe(401);
      expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
      expect((await fetch(BASE_URL + "/")).status).toBe(401);
      const ok = await post("/get_project_info", {
        headers: headers({ Authorization: "Bearer live-token" }),
      });
      expect(ok.status).toBe(200);
    } finally {
      const cleared = await post("/execute_command", {
        headers: headers({ Authorization: "Bearer live-token" }),
        body: JSON.stringify({ id: "mcp-ext:set-token", args: [""] }),
      });
      expect(await cleared.json()).toMatchObject({
        data: { result: "cleared" },
      });
    }
    expect(
      (await post("/get_project_info", { headers: headers() })).status,
    ).toBe(200);
  });

  // Last: it uses up the shared /execute_command budget (60 per minute by
  // default) and then waits the window out so later runs start clean.
  it("rate limits /execute_command", async () => {
    let limited: Response | null = null;
    for (let i = 0; i < 61 && !limited; i++) {
      const res = await post("/execute_command", {
        headers: headers(),
        body: JSON.stringify({ id: "no-such-command" }),
      });
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(404);
    }
    expect(limited, "no 429 within 61 calls").not.toBeNull();
    expect(await limited!.json()).toMatchObject({ code: "RATE_LIMITED" });
    const wait = Number(limited!.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    const other = await post("/get_all_commands", { headers: headers() });
    expect(other.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 500));
    const again = await post("/execute_command", {
      headers: headers(),
      body: JSON.stringify({ id: "no-such-command" }),
    });
    expect(again.status).toBe(404);
  }, 90_000);
});
