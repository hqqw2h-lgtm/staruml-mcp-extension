import { beforeEach, describe, expect, it } from "vitest";
import { improve } from "../../../src/quality/loop.js";
import { endpoints } from "../../../src/routes.js";
import { builtInProfiles, type Profile } from "../../../src/style/profile.js";
import type { Element, View } from "../../../src/types.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { ok } from "../support.js";

/*
 * The quality loop's notation rules to the unit, as the mutation run of
 * issue #27 asked: where the boundary goes around its use cases and the
 * actors beside it, where lifelines go and how far the frame reaches.
 */

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;
const standard = (): Profile => builtInProfiles()["uml-standard"]!;
const n = (v: Element, f: string) => v[f] as number;

beforeEach(() => {
  env = installMockApp();
});

interface Built {
  diagram: { _id: string };
  ids: Record<string, { model: string; view: string }>;
}

const build = (body: Record<string, unknown>) =>
  ok<Built>(ep("/build_diagram"), { result: "ids", ...body });

describe("use case boundary", () => {
  it("reaches half a gap past its outermost use cases and a gap above, and puts actors a gap left of it", async () => {
    const built = await build({
      kind: "usecase",
      spec: {
        system: "Shop",
        actors: ["Clerk", "Boss"],
        useCases: ["Pay", "Ship", "Return"],
        relations: [
          { from: "Clerk", to: "Pay" },
          { from: "Boss", to: "Ship" },
        ],
      },
    });
    const subject = get(built.ids.Shop!.view);
    const s0 = {
      left: n(subject, "left"),
      top: n(subject, "top"),
      right: n(subject, "left") + n(subject, "width"),
      bottom: n(subject, "top") + n(subject, "height"),
    };
    // One use case pushed past the right and bottom of the boundary, but
    // with its centre still inside, and an actor inside it.
    const ship = get(built.ids.Ship!.view);
    ship.left = s0.right - n(ship, "width") / 2 - 5;
    ship.top = s0.bottom - n(ship, "height") / 2 - 5;
    const boss = get(built.ids.Boss!.view);
    boss.left = s0.left + 30;
    boss.top = s0.top + 70;
    const q = improve(get(built.diagram._id), standard());
    expect(q.steps).toContain("boundary");
    const cases = ["Pay", "Ship", "Return"].map((k) => get(built.ids[k]!.view));
    const right = Math.max(...cases.map((v) => n(v, "left") + n(v, "width")));
    const bottom = Math.max(...cases.map((v) => n(v, "top") + n(v, "height")));
    const left = Math.min(...cases.map((v) => n(v, "left")));
    const top = Math.min(...cases.map((v) => n(v, "top")));
    expect(n(subject, "left") + n(subject, "width")).toBe(
      Math.max(s0.right, right + 20),
    );
    expect(n(subject, "top") + n(subject, "height")).toBe(
      Math.max(s0.bottom, bottom + 20),
    );
    expect(n(subject, "left")).toBe(Math.min(s0.left, left - 20));
    expect(n(subject, "top")).toBe(Math.min(s0.top, top - 40));
    expect(n(boss, "left") + n(boss, "width")).toBe(n(subject, "left") - 40);
  });

  it("leaves a boundary with no use case inside where it is", async () => {
    const built = await build({
      kind: "usecase",
      spec: { system: "Empty", actors: ["A"], useCases: ["Far"] },
    });
    const subject = get(built.ids.Empty!.view);
    const far = get(built.ids.Far!.view);
    // The use case leaves the boundary entirely.
    far.containerView = null;
    far.left = n(subject, "left") + n(subject, "width") + 400;
    far.top = n(subject, "top") + n(subject, "height") + 400;
    const before = { ...subject };
    improve(get(built.diagram._id), standard());
    for (const f of ["left", "top", "width", "height"]) {
      expect(subject[f]).toBe(before[f]);
    }
  });
});

describe("sequence lifelines and frame", () => {
  it("spaces crowded lifelines a gap and a half apart and frames the farthest view twenty units out", async () => {
    const built = await build({
      kind: "sequence",
      spec: {
        participants: ["A", "B", "C"],
        messages: [
          { from: "A", to: "B", text: "x()" },
          { from: "B", to: "C", text: "y()" },
        ],
      },
    });
    const d = get(built.diagram._id);
    const views = ["A", "B", "C"].map((k) => get(built.ids[k]!.view));
    // In order, but on each other.
    views.forEach((v, i) => {
      v.left = 40 + i * 10;
    });
    const q = improve(d, standard());
    expect(q.steps).toContain("lifelines");
    for (let i = 1; i < views.length; i++) {
      expect(n(views[i]!, "left")).toBe(
        n(views[i - 1]!, "left") + n(views[i - 1]!, "width") + 60,
      );
    }
    const frame = (d.ownedViews as View[]).find(
      (v) => v.constructor.name === "UMLFrameView",
    )!;
    const inner = (d.ownedViews as View[]).filter(
      (v) =>
        v !== frame &&
        typeof v.left === "number" &&
        !("tail" in v && v.tail !== undefined),
    );
    const right = Math.max(...inner.map((v) => n(v, "left") + n(v, "width")));
    const bottom = Math.max(...inner.map((v) => n(v, "top") + n(v, "height")));
    expect(n(frame, "left") + n(frame, "width")).toBeGreaterThanOrEqual(
      right + 20,
    );
    expect(n(frame, "top") + n(frame, "height")).toBeGreaterThanOrEqual(
      bottom + 20,
    );
    // Grown only as far as needed when it was too small.
    frame.width = 10;
    frame.height = 10;
    improve(d, standard());
    expect(n(frame, "left") + n(frame, "width")).toBe(right + 20);
    expect(n(frame, "top") + n(frame, "height")).toBe(bottom + 20);
  });

  it("keeps lifelines already in order and apart where they are", async () => {
    const built = await build({
      kind: "sequence",
      spec: {
        participants: ["A", "B"],
        messages: [{ from: "A", to: "B", text: "x()" }],
      },
    });
    const views = ["A", "B"].map((k) => get(built.ids[k]!.view));
    views[1]!.left = n(views[0]!, "left") + n(views[0]!, "width") + 300;
    const before = views.map((v) => n(v, "left"));
    // The frame may still grow; the lifelines stay.
    improve(get(built.diagram._id), standard());
    expect(views.map((v) => n(v, "left"))).toEqual(before);
  });
});
