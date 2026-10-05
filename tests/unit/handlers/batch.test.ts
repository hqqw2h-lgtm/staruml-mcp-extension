import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import type { Endpoint } from "../../../src/endpoint.js";
import {
  batchEndpoint,
  resolveReferences,
} from "../../../src/handlers/batch.js";
import { endpoints } from "../../../src/routes.js";
import { PREF } from "../../../src/settings.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, fullResults, ok } from "../support.js";

let env: MockEnvironment;
const batch = fullResults(batchEndpoint(() => endpoints));

beforeEach(() => {
  env = installMockApp();
});

interface Result {
  path: string;
  as?: string;
  success: boolean;
  data?: Record<string, { _id: string }>;
  code?: string;
  error?: string;
}
interface Batch {
  atomic: boolean;
  succeeded: number;
  failed: number;
  results: Result[];
}

const classOp = (as: string, x = 100) => ({
  path: "/create_element_with_view",
  as,
  body: { type: "UMLClass", diagramId: env.mainDiagram._id, name: as, x },
});

describe("reference resolution", () => {
  const results = new Map([
    [
      "c",
      {
        success: true,
        data: {
          view: { _id: "V1", model: { $ref: "M1" } },
          model: {
            _id: "M1",
            name: "C",
            size: 3,
            flag: true,
            operands: [{ $ref: "O1" }],
          },
        },
      },
    ],
    ["bad", { success: false }],
  ]);

  it("resolves ids, nested paths, refs and plain values", () => {
    expect(
      resolveReferences(
        {
          view: "$c.view",
          model: "$c.model.id",
          viaRef: "$c.view.model",
          name: "$c.model.name",
          size: "$c.model.size",
          flag: "$c.model.flag",
          operand: "$c.model.operands.0",
          list: ["$c.view", 4, null, "plain"],
          escaped: "$$c",
          dollar: "$",
        },
        results,
      ),
    ).toEqual({
      view: "V1",
      model: "M1",
      viaRef: "M1",
      name: "C",
      size: 3,
      flag: true,
      operand: "O1",
      list: ["V1", 4, null, "plain"],
      escaped: "$c",
      dollar: "$",
    });
  });

  it.each([
    ["$nope", "$nope: no earlier op is named nope"],
    ["$bad.id", "$bad.id: op bad failed"],
    ["$c", "$c does not name a value"],
    ["$c.view.size.more", "$c.view.size.more does not name a value"],
    ["$c.model.operands.1", "$c.model.operands.1 does not name a value"],
  ])("refuses %s", (text, message) => {
    expect(() => resolveReferences(text, results)).toThrow(message);
  });
});

describe("/batch, not atomic", () => {
  it("runs every op, wiring later ops to earlier results", async () => {
    const data = await ok<Batch>(batch, {
      atomic: false,
      ops: [
        classOp("a"),
        classOp("b", 400),
        {
          path: "/create_edge_with_view",
          as: "rel",
          body: {
            type: "UMLAssociation",
            diagramId: env.mainDiagram._id,
            tailViewId: "$a.view",
            headViewId: "$b.view",
          },
        },
        { path: "/get_element_by_id", body: { id: "missing" } },
        { path: "/get_element_by_id", body: { id: "$nobody" } },
        { path: "/is_modified" },
      ],
    });
    expect(data).toMatchObject({ atomic: false, succeeded: 4, failed: 2 });
    expect(data.results[2]).toMatchObject({ as: "rel", success: true });
    expect(data.results[3]).toMatchObject({
      path: "/get_element_by_id",
      success: false,
      code: "NOT_FOUND",
    });
    expect(data.results[4]).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: "$nobody: no earlier op is named nobody",
    });
    expect(data.results[5]).not.toHaveProperty("as");
    const rel = env.app.repository.get(data.results[2]!.data!.model._id)!;
    expect(rel.end1).toMatchObject({
      reference: env.app.repository.get(data.results[0]!.data!.model._id),
    });
  });

  it("allows paths an atomic batch refuses", async () => {
    const data = await ok<Batch>(batch, {
      atomic: false,
      ops: [{ path: "/undo" }],
    });
    expect(data.succeeded).toBe(1);
  });

  it("reports an op that throws as INTERNAL and goes on", async () => {
    const boom: Endpoint = {
      path: "/boom",
      description: "",
      readOnly: true,
      destructive: false,
      request: z.object({}),
      response: z.object({}),
      handler: () => {
        throw new Error("kaboom");
      },
    };
    const custom = batchEndpoint(() => [...endpoints, boom]);
    const data = await ok<Batch>(custom, {
      atomic: false,
      ops: [{ path: "/boom" }, { path: "/is_modified" }],
    });
    expect(data.results[0]).toEqual({
      path: "/boom",
      success: false,
      code: "INTERNAL",
      error: "Error: kaboom",
    });
    expect(data.succeeded).toBe(1);
  });
});

describe("/batch, atomic", () => {
  it("records the batch's operations as one undo step", async () => {
    const a = await ok<{ view: { _id: string } }>(
      endpoints.find((e) => e.path === "/create_element_with_view")!,
      { type: "UMLClass", diagramId: env.mainDiagram._id },
    );
    const view = env.app.repository.get(a.view._id)!;
    const repo = env.app.repository;
    const data = await ok<Batch>(batch, {
      ops: [
        { path: "/move_views", body: { ids: [a.view._id], dx: 10, dy: 0 } },
        { path: "/move_views", body: { ids: [a.view._id], dx: 5, dy: 0 } },
        {
          path: "/set_view_style",
          body: { ids: [a.view._id], fillColor: "#ff0000" },
        },
      ],
    });
    expect(data).toMatchObject({ atomic: true, succeeded: 3, failed: 0 });
    expect(view).toMatchObject({ left: 115, fillColor: "#ff0000" });
    expect(repo._undoStack.size()).toBe(1);
    expect(repo._undoStack.stack[0]!.name).toBe("batch");
    repo.undo();
    expect(view).toMatchObject({ left: 100, fillColor: "#ffffff" });
    repo.redo();
    expect(view).toMatchObject({ left: 115, fillColor: "#ff0000" });
  });

  it("leaves a single operation as it is", async () => {
    const a = await ok<Batch>(batch, {
      ops: [classOp("a")],
    });
    const viewId = a.results[0]!.data!.view._id;
    await ok(batch, {
      ops: [{ path: "/move_views", body: { ids: [viewId], dx: 1, dy: 1 } }],
    });
    expect(env.app.repository._undoStack.stack[0]!.name).toBe("move views");
  });

  it("rolls back what ran when an op fails, and leaves nothing to redo", async () => {
    const a = await ok<Batch>(batch, { ops: [classOp("a")] });
    const viewId = a.results[0]!.data!.view._id;
    const view = env.app.repository.get(viewId)!;
    const failure = await fails(
      batch,
      {
        ops: [
          { path: "/move_views", body: { ids: [viewId], dx: 10, dy: 0 } },
          { path: "/move_views", body: { ids: ["missing"], dx: 1, dy: 1 } },
          { path: "/move_views", body: { ids: [viewId], dx: 10, dy: 0 } },
        ],
      },
      "NOT_FOUND",
      "ops.1 /move_views failed, batch rolled back: View not found: missing",
    );
    expect(failure.details).toMatchObject({
      index: 1,
      results: [{ success: true }, { success: false }],
    });
    expect(view.left).toBe(100);
    expect(env.app.repository._redoStack.size()).toBe(0);
  });
});

describe("/batch plan checks", () => {
  it("is routed over every endpoint", async () => {
    const routed = endpoints.find((e) => e.path === "/batch")!;
    const data = await ok<Batch>(routed, { ops: [{ path: "/is_modified" }] });
    expect(data.succeeded).toBe(1);
  });

  it("limits the number of ops by preference", async () => {
    env.app.preferences.set(PREF.maxBatchOps, 2);
    await fails(
      batch,
      { ops: [classOp("a"), classOp("b"), classOp("c")] },
      "PAYLOAD_TOO_LARGE",
      "A batch takes at most 2 ops (preference mcp-ext.limits.maxBatchOps); got 3",
    );
    expect(env.app.repository.getInstancesOf("UMLClass")).toEqual([]);
  });

  it.each([
    [[{ path: "/nope" }], true, "ops.0.path: no endpoint /nope"],
    [[{ path: "/batch" }], false, "ops.0.path: /batch cannot run in a batch"],
    [
      [{ path: "/is_modified" }, { path: "/undo" }],
      true,
      "ops.1.path: /undo cannot run in an atomic batch",
    ],
    [
      [
        { path: "/is_modified", as: "x" },
        { path: "/is_modified", as: "x" },
      ],
      true,
      "ops.1.as: x is used twice",
    ],
  ])(
    "refuses %j (atomic %s) before running anything",
    async (ops, atomic, error) => {
      await fails(batch, { ops, atomic }, "INVALID_ARGUMENT", error);
    },
  );

  it("validates the request shape", async () => {
    await fails(batch, { ops: [] }, "INVALID_ARGUMENT", /^ops: /);
    await fails(
      batch,
      { ops: [{ path: "x" }] },
      "INVALID_ARGUMENT",
      /^ops\.0\.path: /,
    );
    await fails(
      batch,
      { ops: [{ path: "/undo", as: "1x" }] },
      "INVALID_ARGUMENT",
      /^ops\.0\.as: /,
    );
  });
});

describe("/batch result modes (#35)", () => {
  const raw = batchEndpoint(() => endpoints);
  const ops = () => [
    classOp("A"),
    { path: "/add_attribute", body: { ref: "$A.model", name: "x" } },
    {
      path: "/create_element_with_view",
      body: { type: "Note", diagram: env.mainDiagram._id },
    },
    { path: "/is_modified" },
  ];

  it("answers each op's id by default", async () => {
    const data = await ok<Batch & { results: (Result & { id?: string })[] }>(
      raw,
      { ops: ops() },
    );
    const [cls, attr, note, modified] = data.results;
    expect(cls).toEqual({
      path: "/create_element_with_view",
      as: "A",
      success: true,
      id: expect.any(String),
    });
    expect(env.app.repository.get(cls!.id!)!.constructor.name).toBe("UMLClass");
    expect(attr!.id).toBeDefined();
    // A view without a model is named by its view.
    expect(env.app.repository.get(note!.id!)!.constructor.name).toBe(
      "UMLNoteView",
    );
    expect(modified).toEqual({ path: "/is_modified", success: true });
  });

  it("answers only ids, or everything", async () => {
    const ids = await ok<Batch>(raw, { ops: ops(), result: "ids" });
    expect(ids.results[0]!.data).toEqual({
      view: { _id: expect.any(String) },
      model: { _id: expect.any(String) },
    });
    expect(ids.results[1]!.data).toEqual({ _id: expect.any(String) });
    expect(ids.results[2]!.data).toEqual({
      view: { _id: expect.any(String) },
      model: null,
    });
    expect(ids.results[3]!.data).toBeUndefined();
    env = installMockApp();
    const full = await ok<Batch>(raw, { ops: ops(), result: "full" });
    expect(full.results[3]!.data).toEqual({ modified: true });
  });

  it("keeps a failed op's error whatever the mode", async () => {
    const data = await ok<Batch>(raw, {
      atomic: false,
      ops: [{ path: "/get_element_by_id", body: { ref: "nothing" } }],
    });
    expect(data.results[0]).toMatchObject({
      success: false,
      code: "NOT_FOUND",
    });
  });
});

describe("/batch terse answers of plain values", () => {
  it("names no id for an answer that is not an element", async () => {
    const plain: Endpoint = {
      ...endpoints.find((e) => e.path === "/is_modified")!,
      path: "/plain",
      handler: async () => ({ success: true, data: "text" }),
    };
    const custom = batchEndpoint(() => [...endpoints, plain]);
    const data = await ok<Batch>(custom, {
      ops: [{ path: "/plain" }],
      result: "ids",
    });
    expect(data.results[0]).toEqual({ path: "/plain", success: true });
  });
});
