import { beforeEach, describe, expect, it } from "vitest";
import { endpoints, routes } from "../../src/routes.js";
import { quiet, quieted, quietly } from "../../src/quiet.js";
import type { Element } from "../../src/types.js";
import { installMockApp, type MockEnvironment } from "../mock/staruml.js";
import { ok } from "./support.js";

let env: MockEnvironment;

/** The model explorer's select, with the jQuery panel's fx queue. */
class Explorer {
  selected: [string, boolean | undefined][] = [];
  queue: unknown[] = ["scroll", "scroll"];
  stopped = 0;
  $viewContent = {
    stop: () => {
      this.queue = [];
      this.stopped++;
    },
    queue: () => this.queue,
  };
  select(elem: Element, scrollTo?: boolean): void {
    this.selected.push([elem._id, scrollTo]);
  }
}

beforeEach(() => {
  env = installMockApp();
});

const install = () => {
  const explorer = new Explorer();
  (env.app as unknown as { modelExplorer: Explorer }).modelExplorer = explorer;
  return explorer;
};

describe("quiet requests (issue #26)", () => {
  it("holds selection back to the end and drops queued scrolling", async () => {
    const explorer = install();
    await env.app.diagrams.setCurrentDiagram(env.mainDiagram);
    const value = await quietly(async () => {
      expect(quiet()).toBe(true);
      const ex = (env.app as unknown as { modelExplorer: Explorer })
        .modelExplorer;
      ex.select(env.model as unknown as Element, true);
      ex.select(env.mainDiagram as unknown as Element, true);
      // Nested requests leave it to the outermost.
      await quietly(() => ex.select(env.model as unknown as Element, true));
      return 7;
    });
    expect(value).toBe(7);
    expect(quiet()).toBe(false);
    // Nothing is selected unless the preference asks for it.
    expect(explorer.selected).toEqual([]);
    expect(explorer.stopped).toBe(1);
    expect(explorer.queue).toEqual([]);
    // The prototype's select is back.
    expect(Object.hasOwn(explorer, "select")).toBe(false);
  });

  it("selects the last created element without scrolling when the preference asks", async () => {
    const explorer = install();
    env.app.preferences.set("mcp-ext.ui.selectCreated", true);
    await quietly(() => {
      const ex = (env.app as unknown as { modelExplorer: Explorer })
        .modelExplorer;
      ex.select(env.mainDiagram as unknown as Element, true);
      ex.select(env.model as unknown as Element, true);
    });
    expect(explorer.selected).toEqual([[env.model._id, false]]);
  });

  it("restores an own select, skips a deleted element and passes errors on", async () => {
    env.app.preferences.set("mcp-ext.ui.selectCreated", true);
    const explorer = install();
    const own = (elem: Element) => explorer.selected.push([elem._id, true]);
    Object.defineProperty(explorer, "select", {
      value: own,
      writable: true,
      configurable: true,
    });
    const gone = { _id: "nowhere" } as Element;
    await expect(
      quietly(() => {
        (
          env.app as unknown as { modelExplorer: Explorer }
        ).modelExplorer.select(gone);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(explorer.select).toBe(own);
    expect(explorer.selected).toEqual([]);
  });

  it("works without an explorer", async () => {
    expect(await quietly(() => 1)).toBe(1);
  });

  it("wraps the writing endpoints of the routes only", () => {
    const read = endpoints.find((e) => e.path === "/get_project_info")!;
    expect(quieted(read)).toBe(read);
    const write = endpoints.find((e) => e.path === "/create_element")!;
    expect(quieted(write)).not.toBe(write);
    expect(routes["/get_project_info"]).toBe(read.handler);
    expect(routes["/create_element"]).not.toBe(write.handler);
  });

  it("serves writes through the quiet route", async () => {
    const explorer = install();
    const res = await routes["/create_element"]!({
      type: "UMLClass",
      parent: env.model._id,
      name: "Quiet",
    });
    expect(res.success).toBe(true);
    expect(explorer.stopped).toBe(1);
  });
});

describe("/performance_stats", () => {
  const stats = endpoints.find((e) => e.path === "/performance_stats")!;

  it("reports listeners, history, elements, tabs, queued animations and heap", async () => {
    install();
    const listener = () => {};
    env.app.repository.on("operationExecuted", listener);
    const data = await ok<{
      listeners: Record<string, number>;
      undo: number;
      elements: number;
      explorerAnimations: number;
      heapUsedMiB: number;
      quiet: boolean;
    }>(stats);
    env.app.repository.off("operationExecuted", listener);
    expect(data.listeners.operationExecuted).toBe(1);
    expect(data.listeners.created).toBe(0);
    expect(data.elements).toBeGreaterThan(0);
    expect(data.explorerAnimations).toBe(2);
    expect(data.heapUsedMiB).toBeGreaterThan(0);
    expect(data.quiet).toBe(false);
  });

  it("answers zeros for what this StarUML does not expose", async () => {
    const repo = env.app.repository as unknown as Record<string, unknown>;
    repo.listenerCount = undefined;
    repo._undoStack = undefined;
    repo._redoStack = undefined;
    const data = await ok<Record<string, unknown>>(stats);
    expect(data).toMatchObject({
      undo: 0,
      redo: 0,
      explorerAnimations: 0,
      listeners: { operationExecuted: 0 },
    });
  });
});
