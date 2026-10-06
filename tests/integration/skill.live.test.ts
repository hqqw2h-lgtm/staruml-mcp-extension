import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BASE_URL, call, describeLive, headers } from "./support.js";

/*
 * Issue #27: every example of the MCP server's skill (the staruml-mcp
 * repository's plugins/claude-code/skills/staruml/SKILL.md), replayed in
 * order against the real app as the endpoint each MCP tool calls. A
 * ```json <tool> block is one example; SKILL_PATH points at the file, by
 * default in a staruml-mcp checkout next to this one.
 */

const SKILL =
  process.env.SKILL_PATH ??
  resolve(
    __dirname,
    "../../../staruml-mcp/plugins/claude-code/skills/staruml/SKILL.md",
  );

interface Example {
  tool: string;
  args: Record<string, unknown>;
  line: number;
}

function examples(text: string): Example[] {
  const out: Example[] = [];
  const re = /```json ([\w-]+)[^\n]*\n([\s\S]*?)```/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({
      tool: m[1]!,
      args: JSON.parse(m[2]!) as Record<string, unknown>,
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** The extension request an MCP tool sends for `args`, or null for a tool of the MCP server alone. */
function request(
  tool: string,
  args: Record<string, unknown>,
): { path: string; body: Record<string, unknown> } | null {
  switch (tool) {
    case "call_endpoint":
      return {
        path: `/${String(args.name)}`,
        body: (args.body as Record<string, unknown> | undefined) ?? {},
      };
    case "diagram_as_text":
      return {
        path: "/export_text",
        body: { format: "mermaid", ...args },
      };
    case "describe_endpoints":
      return { path: "/introspect", body: { include: ["endpoints"] } };
    case "view_diagram":
    case "export_diagram": {
      const { diagram, ...rest } = args;
      return {
        path: "/export_diagram",
        body: { ...(diagram !== undefined && { id: diagram }), ...rest },
      };
    }
    case "doctor":
    case "generate_diagram":
      // The MCP server's own health check, and StarUML's built-in API
      // server (port 58321), not this extension.
      return null;
    default:
      return { path: `/${tool}`, body: args };
  }
}

describeLive("MCP skill examples", () => {
  const found = existsSync(SKILL);

  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it.skipIf(!found)("replays every example the skill gives", async () => {
    const all = examples(readFileSync(SKILL, "utf-8"));
    expect(all.length).toBeGreaterThan(20);
    const failures: string[] = [];
    let replayed = 0;
    for (const { tool, args, line } of all) {
      const req = request(tool, args);
      if (req === null) {
        const res = await fetch(`${BASE_URL}/`, { headers: headers() });
        expect(res.status).toBe(200);
        continue;
      }
      replayed++;
      const res = await call(req.path, req.body);
      if (!res.success) {
        failures.push(
          `SKILL.md:${line} ${tool} ${req.path}: ${res.code} ${res.error}`,
        );
      }
      if (tool === "describe_endpoints") {
        const listed = (
          res.data as { endpoints: { path: string }[] }
        ).endpoints.map((e) => e.path);
        for (const name of args.names as string[]) {
          if (!listed.includes(`/${name}`)) {
            failures.push(
              `SKILL.md:${line} names /${name}, which is no endpoint`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(replayed).toBeGreaterThan(20);
  });
});
