import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alias } from "../../../src/annotate.js";
import { exportDiagram } from "../../../src/handlers/export.js";
import { endpoints } from "../../../src/routes.js";
import type { Element } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, fullResults, ok } from "../support.js";

// Issue #24: labels painted on the exported image, and theme presets.

const modules = vi.hoisted(() => ({
  getImageData: vi.fn(),
  getSVGImageData: vi.fn(),
}));
vi.mock("../../../src/app-modules.js", () => ({
  diagramExport: () => modules,
  graphics: () => ({
    Canvas: class {
      constructor(readonly context: unknown) {}
    },
  }),
}));

let env: MockEnvironment;
let painted: unknown[][];
const g = globalThis as unknown as Record<string, unknown>;
const build = fullResults(endpoints.find((e) => e.path === "/build_diagram")!);
const theme = endpoints.find((e) => e.path === "/apply_theme")!;

/** A PNG holding only its signature and IHDR. */
function png(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

beforeEach(() => {
  env = installMockApp();
  painted = [];
  g.window = { devicePixelRatio: 1 };
  g.createImageBitmap = async () => ({ width: 300, height: 120 });
  g.document = {
    createElement: () => {
      const element = {
        width: 0,
        height: 0,
        getContext: () => ({
          set font(v: string) {
            painted.push(["font", v]);
          },
          set fillStyle(v: string) {
            painted.push(["fill", v]);
          },
          set strokeStyle(v: string) {
            painted.push(["stroke", v]);
          },
          set lineWidth(v: number) {
            painted.push(["width", v]);
          },
          measureText: (t: string) => ({ width: t.length * 6 }),
          fillRect: (...a: number[]) => painted.push(["rect", ...a]),
          strokeRect: (...a: number[]) => painted.push(["frame", ...a]),
          fillText: (...a: unknown[]) => painted.push(["text", ...a]),
          drawImage: () => painted.push(["draw"]),
        }),
        toDataURL: (mime: string) =>
          `data:${mime};base64,${png(element.width, element.height).toString("base64")}`,
      };
      return element;
    },
  };
  modules.getImageData.mockReset();
  modules.getImageData.mockImplementation(() =>
    png(300, 120).toString("base64"),
  );
  modules.getSVGImageData.mockReset();
  modules.getSVGImageData.mockReturnValue(
    '<svg width="300" height="120"><g/></svg>',
  );
});

afterEach(() => {
  delete g.document;
  delete g.window;
  delete g.createImageBitmap;
});

/** Views report bounds as StarUML's do; the diagram's run from (20, 30). */
function bounds(diagramId: string) {
  const diagram = env.app.repository.get(diagramId)!;
  (diagram as unknown as Record<string, unknown>).getBoundingBoxWithChildren =
    () => ({
      x1: 20,
      y1: 30,
      x2: 400,
      y2: 300,
    });
  for (const v of diagram.ownedViews as Element[]) {
    (v as unknown as Record<string, unknown>).getBoundingBox = () => ({
      x1: (v.left as number) ?? 100,
      y1: (v.top as number) ?? 100,
      x2: ((v.left as number) ?? 100) + 50,
      y2: ((v.top as number) ?? 100) + 20,
    });
  }
}

interface Exported {
  annotations?: {
    text: string;
    ref: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  base64?: string;
}

describe("/export_diagram annotate", () => {
  it("paints each view's id or shortest path on the image, at its place", async () => {
    const data = await ok<{
      diagram: { _id: string };
      ids: Record<string, { model: string; view: string }>;
    }>(build, {
      kind: "class",
      autoLayout: false,
      spec: {
        packages: ["P"],
        classes: [{ name: "A" }, { name: "B", package: "P" }],
        relations: [{ from: "A", to: "B" }],
      },
    });
    bounds(data.diagram._id);
    const ids = await ok<Exported>(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "ids",
      scale: 2,
    });
    const a = env.app.repository.get(data.ids.A!.view)!;
    const label = ids.annotations!.find((l) => l.ref === data.ids.A!.model)!;
    expect(label).toMatchObject({
      text: data.ids.A!.model,
      // (view - (diagram - 10 margin)) * scale
      x: ((a.left as number) - 10) * 2,
      y: ((a.top as number) - 20) * 2,
      height: 26,
    });
    expect(painted).toContainEqual(["fill", "#ffe066"]);
    expect(painted).toContainEqual([
      "text",
      data.ids.A!.model,
      label.x + 4,
      label.y + 20,
    ]);
    const paths = await ok<Exported>(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "paths",
    });
    expect(paths.annotations!.map((l) => l.text)).toEqual(
      expect.arrayContaining(["A", "P", "B"]),
    );
    // An unnamed association is labelled by its id, at its middle.
    const edge = paths.annotations!.at(-1)!;
    expect(edge.text).toMatch(/^MOCK/);
    // Labels at one place stack downwards instead of covering each other.
    const at = new Map<string, number>();
    for (const l of paths.annotations!) {
      const key = `${l.x},${l.y}`;
      at.set(key, (at.get(key) ?? 0) + 1);
    }
    expect([...at.values()].every((n) => n === 1)).toBe(true);
    const none = await ok<Exported>(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "none",
    });
    expect(none.annotations).toBeUndefined();
  });

  it("moves a label down off one already at its place", async () => {
    const data = await ok<{ diagram: { _id: string } }>(build, {
      kind: "class",
      spec: { classes: [{ name: "A" }, { name: "B" }] },
    });
    bounds(data.diagram._id);
    const diagram = env.app.repository.get(data.diagram._id)!;
    for (const v of diagram.ownedViews as Element[]) {
      (v as unknown as Record<string, unknown>).getBoundingBox = () => ({
        x1: 50,
        y1: 50,
        x2: 90,
        y2: 70,
      });
    }
    const res = await ok<Exported>(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "ids",
    });
    const [a, b] = res.annotations!;
    expect(b!.x).toBe(a!.x);
    expect(b!.y).toBe(a!.y + a!.height + 1);
  });

  it("annotates JPEG on white and SVG with elements of its own", async () => {
    const data = await ok<{ diagram: { _id: string } }>(build, {
      kind: "class",
      spec: { classes: [{ name: "A <b>" }] },
    });
    bounds(data.diagram._id);
    painted = [];
    await ok(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "ids",
      format: "jpeg",
    });
    expect(painted).toContainEqual(["fill", "#ffffff"]);
    expect(modules.getImageData.mock.calls.at(-1)![1]).toBe("image/png");
    const svg = await ok<Exported>(exportDiagram, {
      diagram: data.diagram._id,
      annotate: "paths",
      format: "svg",
    });
    const text = Buffer.from(svg.base64!, "base64").toString("utf-8");
    expect(text).toMatch(
      /<g class="annotations"><rect x="\d+" y="\d+" width="\d+" height="13" fill="#ffe066" stroke="#8a6d00"\/><text [^>]+>A &lt;b><\/text><\/g><\/svg>$/,
    );
  });

  it("names an element by the shortest path that is its alone", async () => {
    const create = endpoints.find((e) => e.path === "/create_element")!;
    const p = await ok<{ _id: string }>(create, {
      type: "UMLPackage",
      parent: env.model._id,
      name: "P",
    });
    const q = await ok<{ _id: string }>(create, {
      type: "UMLPackage",
      parent: env.model._id,
      name: "Q",
    });
    const a1 = await ok<{ _id: string }>(create, {
      type: "UMLClass",
      parent: p._id,
      name: "A",
    });
    await ok(create, { type: "UMLClass", parent: q._id, name: "A" });
    const get = (id: string) => env.app.repository.get(id)!;
    expect(alias(get(a1._id))).toBe("P/A");
    // Twins under one owner: only the full path, which also names both.
    const twin = await ok<{ _id: string }>(create, {
      type: "UMLClass",
      parent: p._id,
      name: "A",
      allowDuplicateNames: true,
    });
    expect(alias(get(twin._id))).toBe("Model/P/A");
    expect(alias(env.project)).toBe(env.project._id);
  });
});

describe("/apply_theme", () => {
  it("colours nodes and edges by kind, one set_view_style per colour set", async () => {
    const data = await ok<{
      diagram: { _id: string };
      ids: Record<string, { view: string }>;
    }>(build, {
      kind: "class",
      spec: {
        classes: [{ name: "A" }, { name: "I", kind: "interface" }],
        relations: [{ from: "A", to: "I", type: "realization" }],
        notes: [{ text: "n", on: "A" }],
      },
    });
    const dry = await ok<{
      styles: unknown[];
      plan: { ops: { path: string }[] };
    }>(theme, {
      ref: data.diagram._id,
      theme: "blueprint",
      dryRun: true,
    });
    expect(dry.plan.ops.every((o) => o.path === "/set_view_style")).toBe(true);
    const res = await ok<{ styles: { fillColor?: string; views: number }[] }>(
      theme,
      {
        ref: data.diagram._id,
        theme: "blueprint",
      },
    );
    expect(res.styles.map((s) => [s.fillColor, s.views])).toEqual([
      ["#1f3a68", 1],
      ["#2b4f86", 2],
      [undefined, 2],
    ]);
    const get = (id: string) => env.app.repository.get(id)!;
    expect(get(data.ids.A!.view)).toMatchObject({
      fillColor: "#1f3a68",
      fontColor: "#ffffff",
    });
    expect(get(data.ids.I!.view).fillColor).toBe("#2b4f86");
    // One undo step takes the whole theme back.
    env.app.repository.undo();
    expect(get(data.ids.A!.view).fillColor).not.toBe("#1f3a68");
  });

  it("colours by stereotype and by package, in order of first appearance", async () => {
    const data = await ok<{
      diagram: { _id: string };
      ids: Record<string, { view: string; model: string }>;
    }>(build, {
      kind: "class",
      spec: {
        packages: ["P", "Q"],
        classes: [
          { name: "A", stereotype: "entity", package: "P" },
          { name: "B", stereotype: "service", package: "Q" },
          { name: "C", stereotype: "entity", package: "P" },
          { name: "D" },
        ],
        notes: [{ text: "a note" }],
        // A theme without edge colours leaves edges as they are.
        relations: [{ from: "A", to: "B" }],
      },
    });
    // A stereotype element counts by its name; an empty one is none.
    const d = env.app.repository.get(data.ids.D!.model)!;
    d.stereotype = { name: "entity" } as unknown as string;
    env.app.repository.get(data.ids.P!.model)!.stereotype = "";
    const st = await ok<{
      styles: { group?: string; views: number; fillColor?: string }[];
    }>(theme, {
      ref: data.diagram._id,
      theme: "by-stereotype",
    });
    expect(st.styles.map((s) => [s.group, s.views])).toEqual([
      [undefined, 3],
      ["entity", 3],
      ["service", 1],
    ]);
    const pk = await ok<{ styles: { group?: string; views: number }[] }>(
      theme,
      {
        ref: data.diagram._id,
        theme: "by-package",
      },
    );
    // The packages and D sit in no package of their own.
    expect(pk.styles.map((s) => [s.group, s.views])).toEqual([
      [undefined, 4],
      ["P", 2],
      ["Q", 1],
    ]);
    await fails(
      theme,
      { ref: data.diagram._id, theme: "neon" },
      "INVALID_ARGUMENT",
    );
  });

  it("styles nothing on an empty diagram and leaves views without a model alone", async () => {
    const seq = await ok<{ diagram: { _id: string } }>(build, {
      kind: "sequence",
      spec: {},
    });
    const res = await ok<{ styles: unknown[] }>(theme, {
      ref: seq.diagram._id,
      theme: "monochrome",
    });
    expect(res.styles).toEqual([]);
  });
});
