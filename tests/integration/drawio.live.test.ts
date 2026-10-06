import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import { imageSize } from "../../src/handlers/export.js";
import { drawioProblems, parseXml } from "../unit/text/drawio-xsd.js";
import { BASE_URL, call, describeLive } from "./support.js";

/** The draw.io desktop CLI (31.3.2 on the development machine). */
const DRAWIO = process.env.DRAWIO_CLI ?? "/usr/local/bin/drawio";

interface Built {
  diagram: { _id: string };
  kind: string;
}

/** One case per build kind, as the unit goldens take them. */
const perKind = Object.entries(cases).filter(
  ([, body], i, all) =>
    (body as { kind?: string }).kind !== undefined &&
    all.findIndex(
      ([, b]) =>
        (b as { kind?: string }).kind === (body as { kind?: string }).kind,
    ) === i,
);

// Issue #41: every kind built in StarUML 7.1.1, written as .drawio by
// /export_diagram, opened and rendered by draw.io's own CLI.
describeLive("draw.io export", () => {
  const dir = mkdtempSync(join(tmpdir(), "drawio-live-"));

  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it.each(perKind)(
    "%s renders in draw.io with a cell per view",
    async (label, body) => {
      // The previous case idled past the server's 5 s keep-alive while
      // draw.io rendered; a throwaway GET takes the pooled socket the
      // server may have closed, so the build below gets a live one.
      await fetch(`${BASE_URL}/`).catch(() => undefined);
      const built = await call<Built>(
        "/build_diagram",
        body as Record<string, unknown>,
      );
      expect(built.success, JSON.stringify(built)).toBe(true);
      const id = built.data.diagram._id;
      const file = join(dir, `${label}.drawio`);
      const written = await call<{ path: string; bytes: number }>(
        "/export_diagram",
        { diagram: id, format: "drawio", path: file },
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
      const text = readFileSync(file, "utf-8");
      expect(written.data.bytes).toBe(Buffer.byteLength(text));
      expect(drawioProblems(text)).toEqual([]);

      // The same file as /export_text writes it.
      const exported = await call<{ text: string; warnings: string[] }>(
        "/export_text",
        { diagram: id, format: "drawio" },
      );
      expect(exported.data.text).toBe(text);
      expect(exported.data.warnings).toEqual([]);

      // A cell per view StarUML shows, under the view's id.
      const diagram = await call<{
        ownedViews: { _id: string; visible: boolean }[];
      }>("/get_element_by_id", {
        ref: id,
        fields: ["ownedViews", "visible"],
        depth: 1,
      });
      const views = diagram.data.ownedViews
        .filter((v) => v.visible !== false)
        .map((v) => v._id)
        .sort();
      const cells = parseXml(text)
        .children[0]!.children[0]!.children[0]!.children.map((c) => c.attrs.id!)
        .filter((c) => views.includes(c))
        .sort();
      expect(cells).toEqual(views);

      const png = join(dir, `${label}.png`);
      execFileSync(DRAWIO, ["-x", "-f", "png", "-o", png, file], {
        timeout: 90_000,
        stdio: "pipe",
      });
      const size = imageSize(readFileSync(png));
      expect(size.width).toBeGreaterThan(40);
      expect(size.height).toBeGreaterThan(40);
    },
    120_000,
  );
});
