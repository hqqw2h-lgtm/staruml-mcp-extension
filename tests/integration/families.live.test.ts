import { afterAll, beforeAll, expect, it } from "vitest";
import { DIAGRAM_TYPES } from "../../src/build/spec.js";
import { call, describeLive } from "./support.js";

interface Built {
  diagram: { _id: string };
  kind: string;
  created: number;
  ids: Record<string, { model: string | null; view: string }>;
}

/**
 * Diagram ids StarUML 7.1.1 registers that /build_diagram has no kind for,
 * each with the reason. Empty: issue #25 gave every one a kind.
 * Kubernetes, asked for in the issue, is not among them: 7.1.1 ships no
 * Kubernetes extension (extensions/essential holds aws, azure, gcp).
 */
const WITHOUT_KIND: Record<string, string> = {};

// Issue #25 against StarUML 7.1.1: every diagram family it offers.
describeLive("diagram families", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("has a build kind for every diagram id StarUML registers", async () => {
    const res = await call<{ factory: { diagramIds: string[] } }>(
      "/introspect",
      { include: ["factory"] },
    );
    const kinds = new Set(Object.values(DIAGRAM_TYPES));
    const missing = res.data.factory.diagramIds.filter(
      (id) => !kinds.has(id) && !(id in WITHOUT_KIND),
    );
    expect(missing).toEqual([]);
    expect(res.data.factory.diagramIds).not.toContain("KubernetesDiagram");
  });

  it("binds parametric parameters to a constraint typed by a constraint block", async () => {
    const bdd = await call<Built>("/build_diagram", {
      kind: "bdd",
      name: "Laws",
      result: "ids",
      spec: { nodes: [{ name: "Newton", type: "constraintBlock" }] },
    });
    expect(bdd.success).toBe(true);
    const law = bdd.data.ids.Newton!.model!;
    const par = await call<Built>("/build_diagram", {
      kind: "parametric",
      name: "Dynamics",
      result: "ids",
      spec: {
        block: "Rocket",
        nodes: [
          { name: "f = m * a", properties: { type: { $ref: law } } },
          { name: "m", type: "parameter", in: "f = m * a" },
          { name: "a", type: "parameter", in: "f = m * a" },
          { name: "mass", type: "value" },
        ],
        edges: [{ from: "m", to: "mass" }],
      },
    });
    expect(par.success, JSON.stringify(par)).toBe(true);
    expect(Object.keys(par.data.ids)).toHaveLength(4);
    const m = await call<{ _type: string; name: string }>(
      "/get_element_by_id",
      { id: par.data.ids.m!.model },
    );
    expect(m.data).toMatchObject({ _type: "SysMLProperty", name: "m" });
  });

  it("keeps the names given to metaclasses, which StarUML renames on creation", async () => {
    const res = await call<Built>("/build_diagram", {
      kind: "profile",
      name: "Names",
      result: "ids",
      spec: {
        nodes: ["Entity", { name: "Class", type: "metaclass" }],
        edges: [{ from: "Entity", to: "Class" }],
      },
    });
    expect(res.success).toBe(true);
    const meta = await call<{ name: string }>("/get_element_by_id", {
      id: res.data.ids.Class!.model,
    });
    expect(meta.data.name).toBe("Class");
  });

  it("derives a communication diagram from the model's own lifelines and messages", async () => {
    const built = await call<{ model: { _id: string } }>("/build_model", {
      spec: {
        system: "Billing",
        classes: [{ name: "Order" }, { name: "Invoice" }],
        collaborations: [
          {
            name: "Pay",
            participants: ["Order", "Invoice"],
            messages: [
              ["Order", "Invoice", "pay()"],
              ["Invoice", "Order", "paid", "reply"],
            ],
          },
        ],
      },
    });
    expect(built.success, JSON.stringify(built)).toBe(true);
    const messages = async () =>
      (
        await call<{ elements: unknown[] }>("/find_elements", {
          type: "UMLMessage",
        })
      ).data.elements.length;
    const before = await messages();
    const first = await call<{
      diagrams: { kind: string; diagram: string; created: number }[];
    }>("/derive_diagrams", {
      scope: built.data.model._id,
      kinds: ["communication"],
    });
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.data.diagrams.map((d) => d.kind)).toEqual(["communication"]);
    expect(await messages()).toBe(before);
    const again = await call<{ counts: { created: number; deleted: number } }>(
      "/derive_diagrams",
      { scope: built.data.model._id, kinds: ["communication"] },
    );
    expect(again.data.counts).toMatchObject({ created: 0, deleted: 0 });
    const image = await call<{ width: number }>("/export_diagram", {
      id: first.data.diagrams[0]!.diagram,
    });
    expect(image.data.width).toBeGreaterThan(100);
  });
});
