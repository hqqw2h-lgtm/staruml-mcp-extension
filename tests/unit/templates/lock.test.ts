import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { defineEndpoint } from "../../../src/endpoint.js";
import { endpoints } from "../../../src/routes.js";
import { trusted } from "../../../src/style/guard.js";
import { derivedLocked } from "../../../src/templates/lock.js";
import type { Element, View } from "../../../src/types.js";
import { readMark } from "../../../src/viewpoints/mark.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { KIOSK } from "../viewpoints/fixtures.js";
import { fails, ok } from "../support.js";

// Issue #43: a derived diagram is the engine's; edits on it are refused
// with DIAGRAM_DERIVED, the model stays editable, and outside a strict
// profile override: true lets an edit through.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;

beforeEach(() => {
  env = installMockApp();
});

/** The Kiosk model derived; answers its Sales class diagram and a view on it. */
async function derived() {
  await ok(ep("/build_model"), { spec: KIOSK });
  const out = await ok<{ diagrams: { name: string; diagram: string }[] }>(
    ep("/derive_diagrams"),
    { scope: "Kiosk", kinds: ["class"] },
  );
  const diagram = out.diagrams.find((d) => d.name === "Sales")!.diagram;
  const views = get(diagram).ownedViews as View[];
  const node = views.find((v) => v.model?.name === "Order")!;
  const line = views.find((v) => v instanceof type.EdgeView)!;
  return { diagram, node, line, model: node.model! };
}

describe("derived diagrams are locked", () => {
  it("refuses every direct edit on the diagram, its views and its mark", async () => {
    const d = await derived();
    expect(readMark(get(d.diagram))).toMatchObject({
      derived: true,
      template: "code-classes",
    });
    const tag = (get(d.diagram).tags as Element[])[0]!;
    const calls: [string, Record<string, unknown>][] = [
      ["/update_element", { ref: d.node._id, field: "left", value: 1 }],
      ["/update_element", { id: d.diagram, field: "name", value: "Mine" }],
      ["/update_element", { ref: tag._id, field: "value", value: "{}" }],
      ["/delete_element", { ref: d.node._id }],
      ["/create_element_with_view", { type: "UMLClass", diagram: d.diagram }],
      ["/create_element_with_view", { type: "UMLClass", diagramId: d.diagram }],
      [
        "/create_edge_with_view",
        { type: "UMLDependency", tail: d.node._id, head: d.node._id },
      ],
      [
        "/create_relationship",
        {
          type: "UMLDependency",
          tail: d.model._id,
          head: d.model._id,
          diagram: d.diagram,
        },
      ],
      ["/create_view_of", { ref: d.model._id, diagram: d.diagram }],
      ["/move_views", { refs: [d.node._id], dx: 5, dy: 5 }],
      ["/move_views", { ids: [d.node._id], dx: 5, dy: 5 }],
      ["/resize_node", { ref: d.node._id, width: 300, height: 90 }],
      ["/set_view_style", { refs: [d.line._id], lineColor: "#ff0000" }],
      ["/set_z_order", { refs: [d.node._id], position: "front" }],
      ["/layout_diagram", { diagram: d.diagram }],
      ["/route_edges", { diagram: d.diagram, lineStyle: "rectilinear" }],
      ["/apply_theme", { ref: d.diagram, theme: "blueprint" }],
      ["/add_tag", { ref: d.diagram, name: "x", kind: "string", value: "" }],
      ["/set_documentation", { ref: d.diagram, documentation: "x" }],
      ["/set_stereotype", { elementId: d.diagram, stereotype: "x" }],
      [
        "/build_diagram",
        {
          kind: "class",
          name: "Sales",
          parent: "Kiosk",
          upsert: true,
          spec: { classes: [{ name: "Other" }] },
        },
      ],
    ];
    for (const [path, body] of calls) {
      const res = await fails(ep(path), body, "DIAGRAM_DERIVED");
      expect(res.error, path).toMatch(
        /Kiosk\/Sales\/Sales is derived from the model with the template code-classes; change the model and derive it again .*, or pass override: true$/,
      );
      expect(res.details).toMatchObject({
        diagram: d.diagram,
        template: "code-classes",
      });
    }
  });

  it("acts on the current diagram when none is named", async () => {
    const d = await derived();
    env.app.diagrams.setCurrentDiagram(get(d.diagram) as never);
    await fails(ep("/layout_diagram"), {}, "DIAGRAM_DERIVED");
    await fails(
      ep("/route_edges"),
      { lineStyle: "oblique" },
      "DIAGRAM_DERIVED",
    );
  });

  it("leaves the model editable, deleting the diagram allowed, and lets an override through outside a strict profile", async () => {
    const d = await derived();
    await ok(ep("/update_element"), {
      ref: d.model._id,
      field: "documentation",
      value: "Placed by a clerk.",
    });
    await ok(ep("/add_attribute"), { ref: d.model._id, name: "note" });
    await ok(ep("/move_views"), {
      refs: [d.node._id],
      dx: 5,
      dy: 5,
      override: true,
    });
    await ok(ep("/update_element"), {
      ref: d.node._id,
      field: "left",
      value: 7,
      override: true,
    });
    await ok(ep("/add_tag"), {
      ref: d.diagram,
      name: "x",
      kind: "string",
      value: "",
      override: true,
    });
    // Refs that name nothing or several are the endpoints' to report.
    await fails(
      ep("/move_views"),
      { refs: ["Nowhere"], dx: 1, dy: 1 },
      "NOT_FOUND",
    );
    await trusted(() =>
      ok(ep("/move_views"), { refs: [d.node._id], dx: 1, dy: 1 }),
    );
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    const strict = await fails(
      ep("/move_views"),
      { refs: [d.node._id], dx: 5, dy: 5, override: true },
      "DIAGRAM_DERIVED",
    );
    expect(strict.error).not.toMatch(/override/);
    await ok(ep("/delete_element"), { ref: d.diagram });
  });

  it("passes calls on diagrams that are not derived, and bodies that are not objects", async () => {
    const built = await ok<{ diagram: { _id: string } }>(ep("/build_diagram"), {
      kind: "class",
      name: "Free",
      spec: { classes: [{ name: "A" }] },
    });
    await ok(ep("/layout_diagram"), { diagram: built.diagram._id });
    // A mark set by hand that says derived locks too, without a template.
    await ok(ep("/add_tag"), {
      ref: built.diagram._id,
      name: "mcp.viewpoint",
      kind: "string",
      value: '{"viewpoint":"code","derived":true}',
    });
    const hand = await fails(
      ep("/layout_diagram"),
      { diagram: built.diagram._id },
      "DIAGRAM_DERIVED",
      /^\/layout_diagram: Free is derived from the model; change/,
    );
    expect(hand.details).not.toHaveProperty("template");
    env.app.diagrams.setCurrentDiagram(null as never);
    await fails(ep("/layout_diagram"), {}, "NOT_FOUND");
    const raw = defineEndpoint({
      path: "/raw",
      description: "",
      readOnly: true,
      destructive: false,
      request: z.object({ ref: z.optional(z.string()) }),
      response: z.unknown(),
      handle: (input) => input,
    });
    const locked = derivedLocked(raw);
    expect(await locked.handler({ ref: "x", override: true })).toEqual({
      success: true,
      data: { ref: "x" },
    });
    expect(
      await locked.handler([] as unknown as Record<string, unknown>),
    ).toMatchObject({ success: false, code: "INVALID_ARGUMENT" });
  });
});
