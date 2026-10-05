import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";

interface Planned {
  diagram: { _id: string };
  created: number;
  dryRun?: boolean;
  plan?: {
    ops: unknown[];
    creates: { op: string; name?: string }[];
    updates: unknown[];
    deletes: { target: string | null }[];
  };
}

const ok = <T>(res: { success: boolean; data: T }, what: string): T => {
  expect(res.success, `${what}: ${JSON.stringify(res).slice(0, 600)}`).toBe(
    true,
  );
  return res.data;
};

const SPEC = {
  classes: [
    { name: "Order", attributes: ["+id: long"] },
    { name: "Line" },
    { name: "Old" },
  ],
  relations: [{ from: "Order", to: "Line", type: "composition" }],
};

const count = async () =>
  ok(await call<{ count: number }>("/find_elements", { limit: 1 }), "count")
    .count;

// Issue #22 against StarUML 7.1.1: plans that change nothing, diagram
// diffs, and snapshots restored through the real undo history.
describeLive("dryRun, /diff_diagram and snapshots", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("plans a build without changing the model, then builds what it planned", async () => {
    const before = await count();
    const dry = ok(
      await call<Planned>("/build_diagram", {
        kind: "class",
        name: "Shop",
        spec: SPEC,
        dryRun: true,
      }),
      "dry run",
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.diagram._id).toBe("$diagram");
    expect(await count()).toBe(before);
    const modified = ok(
      await call<{ modified: boolean }>("/is_modified"),
      "modified",
    );
    expect(modified.modified).toBe(false);
    const built = ok(
      await call<Planned>("/build_diagram", {
        kind: "class",
        name: "Shop",
        spec: SPEC,
      }),
      "build",
    );
    expect(built.created).toBe(dry.created);
    expect(
      dry.plan!.creates.filter((s) => s.op === "/create_element_with_view")
        .length,
    ).toBe(3);
  });

  it("diffs the diagram against a spec, and plans the prune it implies", async () => {
    const same = ok(
      await call<{ identical: boolean }>("/diff_diagram", {
        diagram: "Shop",
        kind: "class",
        spec: SPEC,
      }),
      "same",
    );
    expect(same.identical).toBe(true);
    const next = {
      classes: [
        { name: "Order", attributes: ["+id: long", "+total: double"] },
        { name: "Line" },
        { name: "New" },
      ],
      relations: SPEC.relations,
    };
    const diff = ok(
      await call<{
        identical: boolean;
        added: { nodes: string[] };
        removed: { path: string | null }[];
        changed: { node: string; changes: string[] }[];
      }>("/diff_diagram", { diagram: "Shop", kind: "class", spec: next }),
      "diff",
    );
    expect(diff).toMatchObject({
      identical: false,
      added: { nodes: ["New"] },
      changed: [{ node: "Order", changes: ["add_attribute total"] }],
    });
    expect(diff.removed.map((r) => r.path)).toEqual([
      expect.stringMatching(/\/Old$/),
    ]);
    const dry = ok(
      await call<Planned>("/build_diagram", {
        kind: "class",
        name: "Shop",
        spec: next,
        upsert: true,
        prune: true,
        dryRun: true,
      }),
      "prune plan",
    );
    expect(dry.plan!.deletes.map((d) => d.target)).toEqual([
      expect.stringMatching(/\/Old$/),
    ]);
  });

  it("lists changes since a snapshot and restores it in one step", async () => {
    const owner = ok(
      await call<{ _parent: string }>("/get_element_by_id", { ref: "Order" }),
      "owner",
    )._parent;
    ok(await call("/snapshot", { label: "before" }), "snapshot");
    ok(
      await call("/create_element", {
        type: "UMLClass",
        parent: owner,
        name: "Invoice",
      }),
      "create",
    );
    ok(
      await call("/update_element", {
        ref: "Line",
        field: "name",
        value: "OrderLine",
      }),
      "rename",
    );
    const old = ok(
      await call<{ _id: string }>("/get_element_by_id", { ref: "Old" }),
      "old",
    );
    ok(await call("/delete_element", { ref: old._id }), "delete");
    const since = ok(
      await call<{
        counts: { added: number; changed: number; removed: number };
        added: { path: string }[];
        changed: { path: string; fields: string[] }[];
        removed: { _id: string }[];
      }>("/diff_since", { snapshot: "before" }),
      "diff_since",
    );
    expect(since.added.map((a) => a.path)).toContainEqual(
      expect.stringMatching(/\/Invoice$/),
    );
    expect(since.changed).toContainEqual(
      expect.objectContaining({
        path: expect.stringMatching(/\/OrderLine$/),
        fields: ["name"],
      }),
    );
    expect(since.removed.map((r) => r._id)).toContain(old._id);
    const restored = ok(
      await call<{ undone: number; remaining: Record<string, number> }>(
        "/restore_snapshot",
        { snapshot: "before" },
      ),
      "restore",
    );
    expect(restored).toMatchObject({
      undone: 3,
      remaining: { added: 0, changed: 0, removed: 0 },
    });
    expect((await call("/get_element_by_id", { ref: old._id })).success).toBe(
      true,
    );
    ok(await call("/redo"), "redo");
    const again = ok(
      await call<{ counts: Record<string, number> }>("/diff_since", {
        snapshot: "before",
      }),
      "after redo",
    );
    expect(again.counts).toEqual(since.counts);
  });
});
