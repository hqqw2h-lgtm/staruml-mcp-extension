import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Built {
  diagram: { _id: string };
  preset?: string;
  ids: Record<string, { model: string | null; view: string }>;
  edges: { view: string }[];
}

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function bounds(view: string): Promise<Bounds> {
  const res = await call<Bounds>("/get_element_by_id", {
    id: view,
    fields: ["left", "top", "width", "height"],
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data;
}

async function build(body: Record<string, unknown>): Promise<Built> {
  const res = await call<Built>("/build_diagram", body);
  expect(res.success, JSON.stringify(res).slice(0, 800)).toBe(true);
  return res.data;
}

const FLOW = "S([start]) --> A[Check] --> B[Ship] --> E([end])";

// Issues #17 and #12: layout presets, fit and edge routing against StarUML
// 7.1.1's dagre layout.
describeLive("layout presets and edge routing", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("lays a TD flowchart read as an activity out top down, initial node first (#12)", async () => {
    const built = await build({
      kind: "activity",
      mermaid: `flowchart TD\n  ${FLOW}`,
    });
    expect(built.preset).toBe("flow-down");
    const tops = await Promise.all(
      ["S", "A", "B", "E"].map(
        async (k) => (await bounds(built.ids[k]!.view)).top,
      ),
    );
    expect(tops[0]).toBe(Math.min(...tops));
    expect(tops[3]).toBe(Math.max(...tops));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it("lays an LR flowchart out left to right, start leftmost", async () => {
    const built = await build({ mermaid: `flowchart LR\n  ${FLOW}` });
    expect(built.preset).toBe("flow-right");
    const lefts = await Promise.all(
      ["S", "A", "B", "E"].map(
        async (k) => (await bounds(built.ids[k]!.view)).left,
      ),
    );
    expect(lefts[0]).toBe(Math.min(...lefts));
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });

  it("puts a superclass above its subclass with hierarchy-down", async () => {
    const built = await build({
      kind: "class",
      spec: {
        classes: [{ name: "Child" }, { name: "Parent" }],
        relations: [{ from: "Child", to: "Parent", type: "generalization" }],
      },
    });
    expect(built.preset).toBe("hierarchy-down");
    const parent = await bounds(built.ids.Parent!.view);
    const child = await bounds(built.ids.Child!.view);
    expect(parent.top).toBeLessThan(child.top);
    // The same diagram as a flow puts the subclass first.
    const res = await call("/layout_diagram", {
      diagramId: built.diagram._id,
      preset: "flow-down",
    });
    expect(res.data).toMatchObject({ direction: "BT", preset: "flow-down" });
    expect((await bounds(built.ids.Child!.view)).top).toBeLessThan(
      (await bounds(built.ids.Parent!.view)).top,
    );
  });

  it("fits node views to their content and spaces ranks as asked", async () => {
    const built = await build({
      kind: "flowchart",
      spec: { nodes: ["One", "Two"], flows: [{ from: "One", to: "Two" }] },
    });
    const one = built.ids.One!.view;
    await call("/resize_node", { id: one, width: 600, height: 400 });
    const res = await call<{ fitted: number }>("/layout_diagram", {
      diagramId: built.diagram._id,
      preset: "flow-down",
      rankSeparation: 120,
      fit: true,
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.data.fitted).toBeGreaterThanOrEqual(1);
    const a = await bounds(one);
    const b = await bounds(built.ids.Two!.view);
    expect(a.width).toBeLessThan(600);
    expect(a.height).toBeLessThan(400);
    // The quality loop after a layout snaps boxes to the style profile's
    // 10-unit grid, which may take a few units off the asked separation.
    expect(b.top - (a.top + a.height)).toBeGreaterThanOrEqual(110);
  });

  it("routes every edge in one undoable step", async () => {
    const built = await build({ mermaid: `flowchart LR\n  ${FLOW}` });
    const style = async () =>
      (
        await call<{ lineStyle: number }>("/get_element_by_id", {
          id: built.edges[0]!.view,
          fields: ["lineStyle"],
        })
      ).data.lineStyle;
    const before = await style();
    const res = await call("/route_edges", {
      diagramId: built.diagram._id,
      lineStyle: "curve",
    });
    expect(res.data).toEqual({
      diagram: built.diagram._id,
      lineStyle: "curve",
      edges: 3,
    });
    expect(await style()).toBe(3);
    await call("/undo");
    expect(await style()).toBe(before);
  });
});
