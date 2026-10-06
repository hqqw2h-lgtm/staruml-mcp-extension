import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as exemplar from "../../../src/templates/exemplar.js";
import { endpoints } from "../../../src/routes.js";
import { findTemplate } from "../../../src/templates/index.js";
import type { Element, View } from "../../../src/types.js";
import { readMark } from "../../../src/viewpoints/mark.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { KIOSK } from "../viewpoints/fixtures.js";
import { fails, ok } from "../support.js";

// Issue #43: building and deriving through templates.

let env: MockEnvironment;
const ep = (path: string) => endpoints.find((e) => e.path === path)!;
const get = (id: string) => env.app.repository.get(id) as Element;

beforeEach(() => {
  env = installMockApp();
});

interface Built {
  diagram: { _id: string };
  kind: string;
  preset?: string;
  quality: { score: number };
  viewpoint?: { name: string; conforms: boolean };
  template?: { name: string; version: number; accepted: boolean };
}

const CLASSES = { spec: { classes: [{ name: "A" }, { name: "B" }] } };

describe("/build_diagram with a template", () => {
  it("draws its kind and viewpoint with its layout, title block and mark", async () => {
    const b = await ok<Built>(ep("/build_diagram"), {
      ...CLASSES,
      template: "code-classes",
      name: "Types",
    });
    expect(b).toMatchObject({
      kind: "class",
      preset: "hierarchy-down",
      viewpoint: { name: "code", conforms: true },
      template: { name: "code-classes", version: 1, accepted: true },
    });
    const d = get(b.diagram._id);
    expect(readMark(d)).toMatchObject({
      viewpoint: "code",
      template: "code-classes",
      version: 1,
    });
    expect(readMark(d)!.derived).toBeUndefined();
    const title = (d.ownedViews as View[]).find(
      (v) => v._id === readMark(d)!.parts!.title,
    )!;
    expect(String(title.text)).toMatch(/^Types\nCode structure: /);
  });

  it("refuses a kind or viewpoint the template does not draw, and content past its limits", async () => {
    await fails(
      ep("/build_diagram"),
      { ...CLASSES, kind: "erd", template: "code-classes" },
      "VIEWPOINT_MISMATCH",
      /the template code-classes draws class, not erd/,
    );
    const v = await fails(
      ep("/build_diagram"),
      { ...CLASSES, template: "code-classes", viewpoint: "data" },
      "VIEWPOINT_MISMATCH",
      /draws the code viewpoint, not data/,
    );
    expect(v.details).toMatchObject({
      alternatives: [
        { viewpoint: "code", kind: "class", template: "code-classes" },
      ],
    });
    await fails(
      ep("/build_diagram"),
      {
        template: "component-packages",
        spec: { packages: Array.from({ length: 21 }, (_, i) => `P${i}`) },
      },
      "VIEWPOINT_MISMATCH",
      /21 elements, more than the 20 the template component-packages holds/,
    );
    const people = Array.from({ length: 13 }, (_, i) => `L${i}`);
    await fails(
      ep("/build_diagram"),
      { template: "runtime-sequence", spec: { participants: people } },
      "VIEWPOINT_MISMATCH",
      /13 lifelines, more than the 12/,
    );
    await fails(
      ep("/build_diagram"),
      { ...CLASSES, template: "x" },
      "NOT_FOUND",
    );
  });

  it("refuses style and layout under a strict profile, naming them", async () => {
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    const refused = await fails(
      ep("/build_diagram"),
      {
        ...CLASSES,
        template: "code-classes",
        layout: "flow-down",
        direction: "LR",
        autoLayout: false,
        showNamespace: true,
      },
      "TEMPLATE_ONLY",
      /without layout, direction, autoLayout, showNamespace$/,
    );
    expect(refused.details).toMatchObject({
      fields: ["layout", "direction", "autoLayout", "showNamespace"],
    });
    await ok(ep("/build_diagram"), { ...CLASSES, template: "code-classes" });
  });

  it("tries the template's own layout once more when the first pass is not accepted", async () => {
    const spy = vi.spyOn(exemplar, "accepts").mockReturnValue(false);
    const b = await ok<Built>(ep("/build_diagram"), {
      ...CLASSES,
      template: "code-classes",
      name: "Again",
      upsert: true,
    });
    expect(b.template!.accepted).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    // Built again unchanged, nothing is redrawn.
    spy.mockClear();
    await ok(ep("/build_diagram"), {
      ...CLASSES,
      template: "code-classes",
      name: "Again",
      upsert: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("/derive_diagrams and /request_diagram with templates", () => {
  it("derives only a template's viewpoint and kind with it, and refuses policy under a strict profile", async () => {
    await ok(ep("/build_model"), { spec: KIOSK });
    const out = await ok<{
      diagrams: { name: string; template: string; accepted: boolean }[];
    }>(ep("/derive_diagrams"), {
      scope: "Kiosk",
      template: "context-landscape",
    });
    expect(out.diagrams).toEqual([
      expect.objectContaining({
        name: "Kiosk context",
        template: "context-landscape",
        accepted: true,
      }),
    ]);
    const req = await ok<{ choice: { template: string } }>(
      ep("/request_diagram"),
      { intent: "the data model", scope: "Kiosk" },
    );
    expect(req.choice.template).toBe("data-erd");
    await ok(ep("/set_style_profile"), { patch: { strict: true } });
    await fails(
      ep("/derive_diagrams"),
      { scope: "Kiosk", policy: { hideGetters: true } },
      "TEMPLATE_ONLY",
      /policy is refused/,
    );
    await ok(ep("/derive_diagrams"), { scope: "Kiosk", kinds: ["erd"] });
  });

  it("folds accessors where the template says so", async () => {
    await ok(ep("/build_model"), {
      spec: {
        system: "Getters",
        classes: [
          { name: "Bean", operations: ["+getX(): int", "+setX(x: int): void"] },
        ],
      },
    });
    const t = findTemplate("code-classes");
    t.content.hideAccessors = true;
    try {
      const out = await ok<{ diagrams: { diagram: string }[] }>(
        ep("/derive_diagrams"),
        { scope: "Getters", kinds: ["class"] },
      );
      const bean = (get(out.diagrams[0]!.diagram).ownedViews as View[]).find(
        (v) => v.model?.name === "Bean",
      )!;
      expect(bean.suppressOperations).toBe(true);
    } finally {
      delete t.content.hideAccessors;
    }
  });
});

describe("template application (property)", () => {
  /** What a derivation drew, without ids: types, names and boxes. */
  function drawing(): string[] {
    return env.app.repository
      .getInstancesOf("View")
      .map((v) => {
        const view = v as View;
        return [
          view.constructor.name,
          view.model?.name ?? String(view.text ?? ""),
          view.left,
          view.top,
          view.width,
          view.height,
        ].join("|");
      })
      .sort();
  }

  const spec = fc
    .uniqueArray(fc.constantFrom("Alpha", "Beta", "Gamma", "Delta", "Omega"), {
      minLength: 1,
      maxLength: 5,
    })
    .chain((names) =>
      fc.record({
        names: fc.constant(names),
        links: fc.array(
          fc.tuple(
            fc.constantFrom(...names),
            fc.constantFrom(...names),
            fc.constantFrom("owns", "knows", "uses"),
          ),
          { maxLength: 4 },
        ),
        states: fc.uniqueArray(fc.constantFrom("New", "Open", "Done"), {
          minLength: 1,
          maxLength: 3,
        }),
      }),
    );

  it("draws the same model to the same diagrams, whatever the template", async () => {
    await fc.assert(
      fc.asyncProperty(spec, async (s) => {
        const model = {
          system: "Prop",
          classes: s.names.map((name) => ({ name })),
          relationships: s.links
            .filter(([a, b]) => a !== b)
            .map(([from, to, type]) => ({ from, to, type })),
          lifecycles: [
            {
              name: "Life",
              subject: s.names[0],
              states: s.states,
              transitions: s.states
                .slice(1)
                .map((to, i) => ({ from: s.states[i]!, to })),
            },
          ],
          collaborations: [
            {
              name: "Talk",
              messages: s.names
                .slice(1)
                .map((to, i) => [s.names[i]!, to, `m${i}()`]),
            },
          ],
        };
        const run = async () => {
          env = installMockApp();
          await ok(ep("/build_model"), { spec: model });
          await ok(ep("/derive_diagrams"), {
            scope: "Prop",
            kinds: ["class", "statemachine", "sequence", "communication"],
          });
          return drawing();
        };
        expect(await run()).toEqual(await run());
      }),
      { numRuns: 8 },
    );
  }, 60_000);
});

describe("exemplar measures", () => {
  it("fingerprints an empty drawing, and accepts by score alone without an exemplar", () => {
    const empty = create("UMLClassDiagram") as Element;
    empty.ownedViews = [];
    expect(exemplar.fingerprint(empty, new Set())).toEqual({
      nodes: {},
      edges: {},
      aspect: 1,
      flow: 0.5,
      density: 0,
    });
    const t = findTemplate("code-classes");
    expect(exemplar.accepts(t, empty, 59, new Set(), () => undefined)).toBe(
      false,
    );
    expect(exemplar.accepts(t, empty, 60, new Set(), () => undefined)).toBe(
      true,
    );
    expect(exemplar.exemplarOf({ ...t, name: "unapproved" })).toBeUndefined();
    const f = exemplar.fingerprint(empty, new Set());
    expect(exemplar.similarity(f, f)).toBe(1);
  });
});
