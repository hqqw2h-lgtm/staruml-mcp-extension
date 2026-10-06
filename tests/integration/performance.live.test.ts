import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Stats {
  listeners: Record<string, number>;
  undo: number;
  elements: number;
  explorerAnimations: number;
  heapUsedMiB: number;
  quiet: boolean;
}

// Issue #26 against StarUML 7.1.1: writes leave nothing behind that slows
// the next ones.
describeLive("write path", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("queues no explorer animations and registers no listeners per request", async () => {
    const diagram = await call<{ _id: string }>("/create_diagram", {
      type: "UMLClassDiagram",
      parent: "@project",
      name: "Perf",
    });
    await call("/switch_diagram", { diagram: diagram.data._id });
    const before = await call<Stats>("/performance_stats");
    for (let i = 0; i < 30; i++) {
      const made = await call<{ model: { _id: string } }>(
        "/create_element_with_view",
        { type: "UMLClass", diagram: diagram.data._id, name: `P${i}` },
      );
      expect(made.success).toBe(true);
      if (i % 2) await call("/delete_element", { ref: made.data.model._id });
    }
    await call("/batch", {
      ops: Array.from({ length: 20 }, (_, i) => ({
        path: "/create_element_with_view",
        body: { type: "UMLClass", diagram: diagram.data._id, name: `B${i}` },
      })),
    });
    const after = await call<Stats>("/performance_stats");
    expect(after.data.explorerAnimations).toBe(0);
    expect(after.data.quiet).toBe(false);
    expect(after.data.listeners).toEqual(before.data.listeners);
    expect(after.data.undo).toBeLessThanOrEqual(100);
  });

  it("answers /introspect from its cache after the first call", async () => {
    const time = async () => {
      const started = performance.now();
      const res = await call("/introspect", {
        include: ["metamodel", "factory", "toolbox"],
      });
      expect(res.success).toBe(true);
      return performance.now() - started;
    };
    await time();
    const cached = Math.min(await time(), await time(), await time());
    expect(cached).toBeLessThan(500);
  });
});
