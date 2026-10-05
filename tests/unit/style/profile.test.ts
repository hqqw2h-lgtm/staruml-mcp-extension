import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../../src/errors.js";
import {
  BUILT_IN_NAMES,
  builtInProfiles,
  DEFAULT_PROFILE,
  effectiveProfile,
  mergePatch,
  parseProfile,
  presetFor,
  PROFILE_PREF,
  PROFILE_TAG,
  profileTag,
  thresholdFor,
} from "../../../src/style/profile.js";
import type { Element } from "../../../src/types.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
} from "../../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

/** Stores `value` as the project's profile tag, the way /set_style_profile does. */
function store(value: string): Element {
  const tag = create("Tag");
  tag.name = PROFILE_TAG;
  tag.value = value;
  tag._parent = env.project;
  (env.project.tags as Element[]).push(tag);
  return tag;
}

describe("built-in profiles", () => {
  it("are the four the issue names, each valid", () => {
    expect(BUILT_IN_NAMES).toEqual([
      "uml-standard",
      "minimal",
      "presentation",
      "print",
    ]);
    for (const [name, p] of Object.entries(builtInProfiles())) {
      expect(p.name).toBe(name);
      expect(parseProfile(p)).toEqual(p);
    }
    expect(builtInProfiles()).toBe(builtInProfiles());
  });

  it("lay class diagrams out as hierarchies and state machines to the right", () => {
    const p = builtInProfiles()[DEFAULT_PROFILE]!;
    expect(presetFor(p, "class")).toBe("hierarchy-down");
    expect(presetFor(p, "statemachine")).toBe("flow-right");
    expect(presetFor(p, "erd")).toBe("hierarchy-right");
    expect(presetFor(p, "sequence")).toBeUndefined();
    expect(thresholdFor(p, "class")).toBe(p.quality.minScore);
    expect(
      thresholdFor(
        { ...p, quality: { ...p.quality, thresholds: { erd: 60 } } },
        "erd",
      ),
    ).toBe(60);
  });
});

describe("parseProfile", () => {
  const base = () => builtInProfiles()["uml-standard"]!;

  it("names the field of the first problem", () => {
    expect(() => parseProfile({ ...base(), strict: "yes" })).toThrow(
      /^profile.strict: /,
    );
    expect(() => parseProfile({ ...base(), colour: 1 }, "patch")).toThrow(
      /^patch: /,
    );
    expect(() =>
      parseProfile(
        mergePatch(base(), {
          naming: { classifier: { pattern: "([", fix: "pascal" } },
        }),
      ),
    ).toThrow(/naming.classifier.pattern: \(\[ is neither/);
  });

  it("never throws anything but INVALID_ARGUMENT (fuzz)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.record({ name: fc.string(), strict: fc.anything() }),
          fc
            .dictionary(fc.string(), fc.jsonValue())
            .map((patch) => mergePatch(base(), patch)),
        ),
        (value) => {
          try {
            parseProfile(value);
          } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).code).toBe("INVALID_ARGUMENT");
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("mergePatch", () => {
  it("merges objects field by field and replaces anything else", () => {
    expect(
      mergePatch({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 3 }, d: [2] }),
    ).toEqual({ a: { b: 3, c: 2 }, d: [2] });
    expect(mergePatch({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
    expect(mergePatch({ a: 1 }, { e: { f: 1 } })).toEqual({
      a: 1,
      e: { f: 1 },
    });
    expect(mergePatch(1, { a: 1 })).toEqual({ a: 1 });
  });

  it("takes a __proto__ key as data, not as the prototype", () => {
    const merged = mergePatch(
      { a: 1 },
      JSON.parse('{"__proto__": {"polluted": true}}'),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() =>
      parseProfile(
        mergePatch(builtInProfiles()["print"]!, JSON.parse('{"__proto__": 1}')),
      ),
    ).toThrow(/^profile: /);
  });

  it("keeps every field of the base a patch does not name (property)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.jsonValue()),
        fc.dictionary(fc.string(), fc.jsonValue()),
        (base, patch) => {
          const merged = mergePatch(base, patch) as Record<string, unknown>;
          for (const k of Object.keys(base)) {
            if (!Object.hasOwn(patch, k)) expect(merged[k]).toEqual(base[k]);
          }
          for (const k of Object.keys(patch)) {
            expect(Object.hasOwn(merged, k)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("effectiveProfile", () => {
  it("is the preference's built-in when the project stores none", () => {
    expect(profileTag()).toBeNull();
    expect(effectiveProfile()).toEqual({
      profile: builtInProfiles()["uml-standard"],
      source: "preferences",
    });
    env.app.preferences.set(PROFILE_PREF, "print");
    expect(effectiveProfile().profile.name).toBe("print");
    env.app.preferences.set(PROFILE_PREF, "no-such");
    expect(effectiveProfile().profile.name).toBe("uml-standard");
    env.app.preferences.set(PROFILE_PREF, 3);
    expect(effectiveProfile().profile.name).toBe("uml-standard");
  });

  it("is the project's stored profile, read once per text", () => {
    const minimal = builtInProfiles()["minimal"]!;
    const tag = store(JSON.stringify({ ...minimal, name: "mine" }));
    const first = effectiveProfile();
    expect(first).toMatchObject({
      profile: { name: "mine" },
      source: "project",
    });
    expect(effectiveProfile()).toBe(first);
    tag.value = JSON.stringify(minimal);
    expect(effectiveProfile().profile.name).toBe("minimal");
  });

  it("falls back to the preference and says why when the stored one is broken", () => {
    store("{not json");
    const e = effectiveProfile();
    expect(e.source).toBe("preferences");
    expect(e.profile.name).toBe("uml-standard");
    expect(e.problem).toMatch(/mcp.styleProfile tag is not a valid profile/);
  });

  it("treats a tag without a value as broken, and no project as none", () => {
    const tag = store("");
    tag.value = null;
    expect(effectiveProfile().problem).toBeDefined();
    env.app.project.getProject = () => null as never;
    expect(profileTag()).toBeNull();
  });
});
