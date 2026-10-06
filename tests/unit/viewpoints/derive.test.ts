import { beforeEach, describe, expect, it } from "vitest";
import { trusted } from "../../../src/style/guard.js";
import { countNodes, type Derived, derive } from "../../../src/model/derive.js";
import { endpoints } from "../../../src/routes.js";
import { builtInProfiles } from "../../../src/style/profile.js";
import type { Element, View } from "../../../src/types.js";
import { readMark } from "../../../src/viewpoints/mark.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";
import { KIOSK } from "./fixtures.js";

// Issue #42: every derived diagram is a view of one viewpoint, marked so,
// with the parts its viewpoint requires.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;
const standard = () => builtInProfiles()["uml-standard"]!;

beforeEach(() => {
  env = installMockApp();
});

interface Out {
  diagrams: {
    kind: string;
    name: string;
    diagram: string;
    viewpoint: string;
    conforms?: boolean;
  }[];
  counts: { created: number; deleted: number; updated: number };
}

const notes = (diagram: string) =>
  (get(diagram).ownedViews as View[]).filter(
    (v) => v.constructor.name === "UMLNoteView",
  );

describe("derive by viewpoint", () => {
  it("names the viewpoint of every derived diagram, each conforming, and derives the context only when asked", async () => {
    await ok(ep("/build_model"), { spec: KIOSK });
    const all = await ok<Out>(ep("/derive_diagrams"), {
      scope: "Kiosk",
      kinds: [
        "package",
        "class",
        "sequence",
        "usecase",
        "statemachine",
        "activity",
        "erd",
        "c4",
        "deployment",
        "mindmap",
        "communication",
      ],
    });
    expect(all.diagrams.map((d) => `${d.viewpoint}:${d.name}`)).toEqual([
      "component:Kiosk packages",
      "code:Sales",
      "code:Stock",
      "runtime:Checkout",
      "runtime:Restock",
      "actors-goals:Kiosk",
      "lifecycle:Order life",
      "lifecycle:Shift",
      "runtime:Close day",
      "data:Kiosk data model",
      "container:Kiosk containers",
      "component:Kiosk containers components",
      "deployment:Shop floor",
      "actors-goals:Kiosk features",
      "runtime:Checkout communication",
      "runtime:Restock communication",
    ]);
    // Shift belongs to no class: the one view that does not conform.
    expect(all.diagrams.filter((d) => !d.conforms).map((d) => d.name)).toEqual([
      "Shift",
    ]);
    for (const d of all.diagrams) {
      expect(readMark(get(d.diagram))!.viewpoint).toBe(d.viewpoint);
    }
    // A title block on every one; a legend under the views that require one.
    const legendOf = (d: string) =>
      notes(d).filter((n) => String(n.text).startsWith("Legend\n"));
    const legends = all.diagrams.filter((d) => legendOf(d.diagram).length > 0);
    expect(legends.map((d) => d.name)).toEqual([
      "Kiosk containers",
      "Shop floor",
    ]);
    const legend = legendOf(legends[0]!.diagram)[0]!;
    expect(String(legend.text)).toMatch(/^Legend\nPerson: /);
    const mark = readMark(get(legends[0]!.diagram))!;
    expect(mark).toMatchObject({
      viewpoint: "container",
      template: "container-overview",
      version: 1,
      derived: true,
      parts: { legend: legend._id },
    });
    for (const d of all.diagrams) {
      const title = notes(d.diagram).find(
        (n) => n._id === readMark(get(d.diagram))!.parts!.title,
      )!;
      expect(String(title.text).split("\n")[0]).toBe(d.name);
    }
    const context = await ok<Out>(ep("/derive_diagrams"), {
      scope: "Kiosk",
      viewpoints: ["context", "container"],
    });
    expect(context.diagrams.map((d) => `${d.viewpoint}:${d.name}`)).toEqual([
      "context:Kiosk context",
      "container:Kiosk containers",
    ]);
    // The context's people and outside systems are the container view's.
    expect(env.app.repository.getInstancesOf("C4Person")).toHaveLength(1);
    expect(
      env.app.repository.getInstancesOf("C4SoftwareSystem").map((e) => e.name),
    ).toEqual(["Payments", "Kiosk"]);
    const again = await ok<Out>(ep("/derive_diagrams"), { scope: "Kiosk" });
    expect(again.counts).toMatchObject({ created: 0, deleted: 0 });
  });

  it("collapses the system's inside into one box on the context, its technologies merged", async () => {
    await ok(ep("/build_model"), { spec: KIOSK });
    const model = env.app.repository
      .getInstancesOf("UMLModel")
      .find((m) => m.name === "Kiosk")!;
    const [context] = derive(model, standard(), new Set(["c4"]), {
      context: true,
    });
    expect(context!.spec).toEqual({
      elements: [
        { id: "buyer", name: "Buyer", type: "person" },
        { id: "system in scope", name: "Kiosk", type: "system" },
        { id: "pay", name: "Payments", type: "system", external: true },
      ],
      relations: [
        {
          from: "buyer",
          to: "system in scope",
          label: "Buys",
          technology: "HTTPS, SQL",
        },
        {
          from: "system in scope",
          to: "pay",
          label: "Charges",
          technology: "REST",
        },
      ],
    });
  });

  it("takes the section's own system as the box, and keeps a section of components alone", async () => {
    const model = async (system: string, elements: unknown[]) => {
      await ok(ep("/build_model"), {
        spec: {
          system,
          components: { elements, relations: [["c", "me", "in"]] },
        },
      });
      return env.app.repository
        .getInstancesOf("UMLModel")
        .find((m) => m.name === system)!;
    };
    const solo = await model("Solo", [
      { id: "me", name: "Solo app", type: "system" },
      { id: "c", name: "Core", type: "container" },
    ]);
    const views = derive(solo, standard(), undefined, { context: true });
    expect(views.map((d) => `${d.viewpoint}:${d.name}`)).toEqual([
      "context:Solo context",
      "container:Solo containers",
    ]);
    expect(views[0]!.spec).toEqual({
      elements: [{ id: "me", name: "Solo app", type: "system" }],
      relations: [],
    });
    const parts = await model("Parts", [
      { id: "c", name: "Core", type: "component" },
      { id: "me", name: "Edge", type: "component" },
    ]);
    expect(
      derive(parts, standard(), undefined).map(
        (d) => `${d.viewpoint}:${d.name}`,
      ),
    ).toEqual(["component:Parts containers"]);
    // Without relations the context is its boxes alone.
    await ok(ep("/build_model"), {
      spec: {
        system: "Lone",
        components: { elements: [{ name: "Ops", type: "person" }] },
      },
    });
    const lone = env.app.repository
      .getInstancesOf("UMLModel")
      .find((m) => m.name === "Lone")!;
    expect(
      derive(lone, standard(), new Set(["c4"]), { context: true })[0]!.spec,
    ).toEqual({
      elements: [
        { name: "Ops", type: "person" },
        { id: "system in scope", name: "Lone", type: "system" },
      ],
      relations: [],
    });
    // A person without an id is found again by name.
    for (let i = 0; i < 2; i++) {
      await ok(ep("/derive_diagrams"), {
        scope: "Lone",
        viewpoints: ["context", "container"],
      });
    }
    expect(env.app.repository.getInstancesOf("C4Person")).toHaveLength(1);
  });

  it("counts what each kind draws", () => {
    const d = (kind: string, spec: Record<string, unknown>) =>
      countNodes({ kind, spec } as unknown as Derived);
    expect(d("sequence", { participants: [1, 2] })).toEqual({
      nodes: 2,
      lifelines: 2,
    });
    expect(d("communication", { nodes: [1] })).toEqual({
      nodes: 1,
      lifelines: 1,
    });
    expect(d("class", { classes: [1, 2, 3] }).nodes).toBe(3);
    expect(d("package", { packages: [1] }).nodes).toBe(1);
    expect(d("usecase", { actors: [1], useCases: [1, 2] }).nodes).toBe(3);
    expect(d("statemachine", { states: [] }).nodes).toBe(0);
    expect(d("erd", { entities: [1] }).nodes).toBe(1);
    expect(d("c4", { elements: [1, 2] }).nodes).toBe(2);
    expect(d("deployment", { nodes: [1], artifacts: [1, 2] }).nodes).toBe(3);
    expect(
      d("mindmap", { root: { name: "r", children: [{ name: "a" }] } }).nodes,
    ).toBe(2);
    expect(d("mindmap", {}).nodes).toBe(0);
    expect(d("activity", { nodes: [1, 2] }).nodes).toBe(2);
    expect(d("activity", {}).nodes).toBe(0);
  });
});

describe("/build_diagram with a viewpoint", () => {
  const C4 = {
    kind: "c4",
    name: "Shop",
    upsert: true,
    spec: {
      elements: [
        { id: "u", name: "User", type: "person" },
        { id: "a", name: "App", type: "container" },
      ],
      relations: [{ from: "u", to: "a", label: "Uses" }],
    },
  };
  const build = (body: Record<string, unknown>) =>
    ok<{
      diagram: { _id: string };
      created: number;
      quality: { score: number };
      viewpoint?: { name: string; conforms: boolean };
    }>(ep("/build_diagram"), body);

  it("keeps the legend below the drawing: made once, moved when it grows, rewritten, dropped when not required", async () => {
    const first = await build({ ...C4, viewpoint: "container" });
    expect(first.viewpoint).toMatchObject({
      name: "container",
      conforms: true,
    });
    const id = first.diagram._id;
    const [legend] = notes(id);
    const bottom = () =>
      Math.max(
        ...(get(id).ownedViews as View[])
          .filter(
            (v) => v.constructor.name !== "UMLNoteView" && v.top !== undefined,
          )
          .map((v) => Number(v.top) + Number(v.height)),
      );
    expect(Number(legend!.top)).toBe(bottom() + 30);
    // Built again unchanged, it stays: neither matched to the spec nor pruned.
    const again = await build({ ...C4, viewpoint: "container", prune: true });
    expect(again.created).toBe(0);
    expect(notes(id).map((n) => n._id)).toEqual([legend!._id]);
    // Edited by hand, it is written back.
    legend!.text = "scribble";
    await build({ ...C4, viewpoint: "container" });
    expect(String(notes(id)[0]!.text)).toMatch(/^Legend/);
    // The drawing grows: the legend moves down with it.
    const grown = {
      ...C4,
      viewpoint: "container",
      spec: {
        ...C4.spec,
        elements: [
          ...C4.spec.elements,
          { id: "d", name: "DB", type: "container" },
        ],
        relations: [
          ...C4.spec.relations,
          { from: "a", to: "d", label: "Reads" },
        ],
      },
    };
    await build(grown);
    expect(Number(notes(id)[0]!.top)).toBe(bottom() + 30);
    // As a component view it needs no legend: it goes.
    await build({ ...grown, viewpoint: "component" });
    expect(notes(id)).toEqual([]);
    expect(readMark(get(id))).toEqual({ viewpoint: "component" });
  });

  it("places the parts of an empty drawing at the top left", async () => {
    const empty = await build({
      kind: "deployment",
      name: "Nothing yet",
      viewpoint: "deployment",
      spec: { nodes: [] },
    });
    const [legend] = notes(empty.diagram._id);
    expect([legend!.left, legend!.top]).toEqual([20, 20]);
  });

  it("refuses a kind the viewpoint is not drawn as", async () => {
    const refused = await fails(
      ep("/build_diagram"),
      { ...C4, viewpoint: "runtime" },
      "VIEWPOINT_MISMATCH",
      /runtime viewpoint is drawn as sequence, communication, activity, not c4/,
    );
    expect(refused.details).toMatchObject({ reason: "kind" });
  });

  it("refuses a diagram without a template under a strict profile, from outside only", async () => {
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    await fails(ep("/build_diagram"), C4, "TEMPLATE_ONLY", /pass template/);
    await fails(
      ep("/build_diagram"),
      { ...C4, viewpoint: "container" },
      "TEMPLATE_ONLY",
    );
    await fails(
      ep("/create_diagram"),
      { type: "UMLClassDiagram", parent: "@project" },
      "VIEWPOINT_REQUIRED",
      /create_diagram/,
    );
    await trusted(async () => {
      await ok(ep("/build_diagram"), C4);
      await ok(ep("/create_diagram"), {
        type: "UMLClassDiagram",
        parent: "@project",
      });
    });
    await build({ ...C4, name: "Strict", template: "container-overview" });
  });
});
