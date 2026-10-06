import { afterAll, beforeAll, expect, it } from "vitest";
import tb from "../fixtures/domains/thingsboard.oo.json";
import { call, describeLive } from "./support.js";

// Issue #43 on StarUML 7.1.1: diagram templates, strict template-only
// building, locked derived diagrams, deterministic application.

interface Built {
  diagram: { _id: string };
  ids: Record<string, { view: string }>;
  template: { name: string; accepted: boolean };
}

describeLive(
  "templates: catalogue, strict building, locked derived diagrams",
  () => {
    let lifeline = "";
    let derivedDiagram = "";

    beforeAll(async () => {
      await call("/new_project");
      const built = await call<{ model: { _id: string } }>("/build_model", {
        spec: tb,
      });
      const out = await call<{ diagrams: { name: string; diagram: string }[] }>(
        "/derive_diagrams",
        { scope: built.data.model._id, kinds: ["sequence"] },
      );
      derivedDiagram = out.data.diagrams[0]!.diagram;
      const views = await call<{ ownedViews: { $ref: string }[] }>(
        "/get_element_by_id",
        { ref: derivedDiagram, fields: ["ownedViews"] },
      );
      lifeline = views.data.ownedViews[1]!.$ref;
    }, 300_000);

    afterAll(async () => {
      await call("/set_style_profile", { reset: true });
      await call("/new_project");
    });

    it("lists the diagram templates and describes one", async () => {
      const list = await call<{
        diagramTemplates: { name: string; viewpoint: string }[];
      }>("/list_templates");
      expect(list.data.diagramTemplates).toHaveLength(14);
      const one = await call<{ template: { kind: string }; question: string }>(
        "/describe_template",
        { name: "lifecycle-states" },
      );
      expect(one.data.template.kind).toBe("statemachine");
      expect(JSON.stringify(one.data)).not.toMatch(/fingerprint/);
    });

    it("refuses direct edits on a derived diagram, the model staying editable", async () => {
      const moved = await call("/move_views", {
        refs: [lifeline],
        dx: 40,
        dy: 0,
      });
      expect(moved).toMatchObject({ status: 409, code: "DIAGRAM_DERIVED" });
      const renamed = await call("/update_element", {
        ref: derivedDiagram,
        field: "name",
        value: "Mine",
      });
      expect(renamed).toMatchObject({ code: "DIAGRAM_DERIVED" });
      const doc = await call("/set_documentation", {
        ref: "ThingsBoard/Domain Model \\(common\\.data\\)/Device",
        documentation: "A connected thing.",
      });
      expect(doc.success).toBe(true);
      const forced = await call("/move_views", {
        refs: [lifeline],
        dx: 0,
        dy: 0,
        override: true,
      });
      expect(forced.success).toBe(true);
      await call("/set_style_profile", { patch: { strict: true } });
      const strict = await call("/move_views", {
        refs: [lifeline],
        dx: 0,
        dy: 0,
        override: true,
      });
      expect(strict).toMatchObject({ code: "DIAGRAM_DERIVED" });
      const styled = await call("/build_diagram", {
        template: "code-classes",
        layout: "flow-down",
        spec: { classes: [{ name: "A" }] },
      });
      expect(styled).toMatchObject({
        status: 403,
        code: "TEMPLATE_ONLY",
        details: { fields: ["layout"] },
      });
      await call("/set_style_profile", { reset: true });
    }, 120_000);

    it("applies a template to the same content the same way, twice", async () => {
      const runs: string[] = [];
      for (let i = 0; i < 2; i++) {
        await call("/new_project");
        const built = await call<Built>("/build_diagram", {
          template: "data-erd",
          name: "Orders",
          spec: {
            entities: [
              { name: "orders", columns: ["id int PK", "customer_id int FK"] },
              { name: "customers", columns: ["id int PK"] },
              { name: "lines", columns: ["id int PK", "order_id int FK"] },
            ],
            relationships: [
              { from: "customers", to: "orders", toCardinality: "0..*" },
              { from: "orders", to: "lines", toCardinality: "1..*" },
            ],
          },
        });
        expect(built.data.template).toMatchObject({
          name: "data-erd",
          accepted: true,
        });
        const geometry = await Promise.all(
          Object.entries(built.data.ids)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(async ([key, r]) => {
              const v = await call<Record<string, number>>(
                "/get_element_by_id",
                { ref: r.view, fields: ["left", "top", "width", "height"] },
              );
              return `${key}@${v.data.left},${v.data.top},${v.data.width},${v.data.height}`;
            }),
        );
        runs.push(geometry.join(";"));
      }
      expect(runs[1]).toBe(runs[0]);
    }, 120_000);
  },
);
