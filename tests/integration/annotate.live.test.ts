import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";
import { colorAt, decodePng, inkIn } from "./png.js";

// Issue #24: labels painted on StarUML 7.1.1's exported image, and theme
// presets, read back from the decoded pixels.

interface Label {
  text: string;
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Exported {
  base64: string;
  width: number;
  height: number;
  annotations?: Label[];
}

const pixels = (res: { data: Exported }) =>
  decodePng(Buffer.from(res.data.base64, "base64"));

describeLive("issue #24 annotate and themes", () => {
  let diagram = "";
  let ids: Record<string, { model: string; view: string }> = {};

  beforeAll(async () => {
    await call("/new_project");
    const built = await call<{
      diagram: { _id: string };
      ids: Record<string, { model: string; view: string }>;
    }>("/build_diagram", {
      kind: "class",
      name: "Shop",
      autoLayout: false,
      spec: {
        classes: [
          { name: "Order", attributes: ["+id: long"] },
          { name: "Line", attributes: ["+qty: int"] },
          { name: "Pay", kind: "interface", operations: ["+pay(): void"] },
        ],
        relations: [{ from: "Order", to: "Line", type: "composition" }],
      },
    });
    expect(built.success, JSON.stringify(built)).toBe(true);
    diagram = built.data.diagram._id;
    ids = built.data.ids;
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("paints each view's id on the PNG, at the place it reports, and nothing on the model", async () => {
    const plain = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
    });
    const res = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
      annotate: "ids",
    });
    expect(res.success, JSON.stringify(res).slice(0, 400)).toBe(true);
    expect(res.data.width).toBe(plain.data.width);
    const labels = res.data.annotations!;
    expect(labels.map((l) => l.ref).sort()).toEqual(
      [...Object.values(ids).map((i) => i.model), expect.any(String)].sort(),
    );
    const image = pixels(res);
    const before = pixels(plain);
    for (const l of labels) {
      // The label's fill, just inside its frame, where the plain image has none.
      expect(colorAt(image, l.x + 1, l.y + l.height - 2)).toBe("#ffe066");
      expect(colorAt(before, l.x + 1, l.y + l.height - 2)).not.toBe("#ffe066");
      // Its text: dark ink inside the box.
      expect(
        inkIn(image, {
          x: l.x + 2,
          y: l.y + 2,
          width: l.width - 4,
          height: l.height - 4,
        }),
      ).toBeGreaterThan(10);
    }
    // The model is untouched: the overlay is not a view.
    const views = await call<{ ownedViews: unknown[] }>("/get_element_by_id", {
      ref: diagram,
      fields: ["ownedViews"],
    });
    expect(views.data.ownedViews).toHaveLength(4);
  });

  it("labels by path at twice the scale, and in SVG", async () => {
    const res = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
      annotate: "paths",
      scale: 2,
    });
    const order = res.data.annotations!.find(
      (l) => l.ref === ids.Order!.model,
    )!;
    expect(order.text).toBe("Order");
    expect(order.height).toBe(26);
    expect(colorAt(pixels(res), order.x + 2, order.y + order.height - 3)).toBe(
      "#ffe066",
    );
    const svg = await call<Exported>("/export_diagram", {
      diagram,
      format: "svg",
      annotate: "paths",
    });
    const text = Buffer.from(svg.data.base64, "base64").toString("utf-8");
    expect(text).toMatch(
      /<g class="annotations">.*>Order<\/text>.*<\/g><\/svg>\s*$/s,
    );
  });

  it("applies a theme as one undo step, as the exported pixels show", async () => {
    const before = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
      annotate: "ids",
    });
    const label = before.data.annotations!.find(
      (l) => l.ref === ids.Order!.model,
    )!;
    // Inside the Order box, below its label.
    const at = { x: label.x + 3, y: label.y + label.height + 3 };
    expect(colorAt(pixels(before), at.x, at.y)).toBe("#ffffff");
    const themed = await call<{
      styles: { fillColor?: string; views: number }[];
    }>("/apply_theme", { ref: diagram, theme: "blueprint" });
    expect(themed.success, JSON.stringify(themed)).toBe(true);
    expect(themed.data.styles.map((s) => s.views)).toEqual([2, 1, 1]);
    const after = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
    });
    expect(colorAt(pixels(after), at.x, at.y)).toBe("#1f3a68");
    const fill = await call<{ fillColor: string }>("/get_element_by_id", {
      ref: ids.Pay!.view,
      fields: ["fillColor"],
    });
    expect(fill.data.fillColor).toBe("#2b4f86");
    await call("/undo");
    const undone = await call<Exported>("/export_diagram", {
      diagram,
      background: "#ffffff",
    });
    expect(colorAt(pixels(undone), at.x, at.y)).toBe("#ffffff");
    const byStereotype = await call<{ styles: unknown[] }>("/apply_theme", {
      ref: diagram,
      theme: "by-stereotype",
      dryRun: true,
    });
    expect(byStereotype.success).toBe(true);
  });
});
