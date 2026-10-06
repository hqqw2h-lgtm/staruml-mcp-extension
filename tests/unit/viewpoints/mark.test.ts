import { beforeEach, describe, expect, it } from "vitest";
import type { Element } from "../../../src/types.js";
import {
  MARK_TAG,
  markOps,
  partViews,
  readMark,
  writeMark,
} from "../../../src/viewpoints/mark.js";
import { create, installMockApp } from "../../mock/staruml.js";

beforeEach(() => {
  installMockApp();
});

/** A diagram with a mark tag holding `value`. */
function tagged(value: unknown): Element {
  const d = create("UMLClassDiagram") as Element;
  const tag = create("Tag") as Element;
  Object.assign(tag, { name: MARK_TAG, value, _parent: d });
  d.tags = [tag];
  return d;
}

describe("diagram mark", () => {
  it("reads nothing from a diagram without one, or one that says nothing usable", () => {
    expect(readMark(create("UMLClassDiagram") as Element)).toBeNull();
    expect(readMark({ tags: undefined } as unknown as Element)).toBeNull();
    expect(readMark(tagged(""))).toBeNull();
    expect(readMark(tagged(null))).toBeNull();
    expect(readMark(tagged("{broken"))).toBeNull();
    expect(readMark(tagged("{}"))).toBeNull();
  });

  it("reads a bare viewpoint name typed by hand, and the full JSON", () => {
    expect(readMark(tagged(" code "))).toEqual({ viewpoint: "code" });
    expect(
      readMark(
        tagged(
          JSON.stringify({
            viewpoint: "container",
            template: "t",
            version: 2,
            derived: true,
            parts: { title: "T", legend: "L", other: 1 },
          }),
        ),
      ),
    ).toEqual({
      viewpoint: "container",
      template: "t",
      version: 2,
      derived: true,
      parts: { title: "T", legend: "L" },
    });
    expect(
      readMark(
        tagged(JSON.stringify({ viewpoint: "x", derived: "yes", parts: [] })),
      ),
    ).toEqual({ viewpoint: "x" });
    expect(
      readMark(
        tagged(JSON.stringify({ viewpoint: "x", parts: { legend: "L" } })),
      ),
    ).toEqual({ viewpoint: "x", parts: { legend: "L" } });
  });

  it("writes fields in one order, so equal marks are equal text", () => {
    const a = writeMark({
      parts: { legend: "L", title: "T" },
      derived: true,
      viewpoint: "v",
      version: 1,
      template: "t",
    });
    expect(a).toBe(
      '{"viewpoint":"v","template":"t","version":1,"derived":true,"parts":{"title":"T","legend":"L"}}',
    );
    expect(writeMark({ viewpoint: "v", parts: {} })).toBe('{"viewpoint":"v"}');
    expect(writeMark({ viewpoint: "v", parts: { legend: "L" } })).toBe(
      '{"viewpoint":"v","parts":{"legend":"L"}}',
    );
  });

  it("stores a mark with the op it needs, or none", () => {
    expect(markOps("$diagram", { viewpoint: "code" })).toEqual([
      {
        path: "/add_tag",
        body: {
          ref: "$diagram",
          name: MARK_TAG,
          kind: "string",
          value: '{"viewpoint":"code"}',
          hidden: true,
        },
      },
    ]);
    const plain = create("UMLClassDiagram") as Element;
    expect(markOps(plain, { viewpoint: "code" })[0]!.body.ref).toBe(plain._id);
    const d = tagged('{"viewpoint":"code"}');
    expect(markOps(d, { viewpoint: "code" })).toEqual([]);
    expect(markOps(d, { viewpoint: "data" })).toEqual([
      {
        path: "/update_element",
        body: {
          ref: (d.tags as Element[])[0]!._id,
          field: "value",
          value: '{"viewpoint":"data"}',
        },
      },
    ]);
  });

  it("finds the part views a mark names that are still on the diagram", () => {
    const d = tagged("");
    const note = create("UMLNoteView") as Element;
    d.ownedViews = [note];
    expect(partViews(d, null)).toEqual([]);
    expect(
      partViews(d, {
        viewpoint: "v",
        parts: { legend: note._id, title: "gone" },
      }),
    ).toEqual([note]);
  });
});
