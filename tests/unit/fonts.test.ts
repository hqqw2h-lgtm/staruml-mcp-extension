import { describe, expect, it } from "vitest";
import { DIAGRAM_FACES, loadDiagramFonts } from "../../src/fonts.js";

describe("loadDiagramFonts", () => {
  it("loads StarUML's diagram faces before the server listens", async () => {
    const asked: string[] = [];
    const fonts = {
      load: async (f: string) => {
        asked.push(f);
        return [];
      },
    };
    expect(await loadDiagramFonts(fonts)).toBe(true);
    expect(asked).toEqual(DIAGRAM_FACES);
  });

  it("serves anyway without a font set, on a failed face or after the wait", async () => {
    expect(await loadDiagramFonts(undefined)).toBe(false);
    expect(await loadDiagramFonts()).toBe(false);
    expect(
      await loadDiagramFonts({ load: () => Promise.reject(new Error("x")) }),
    ).toBe(false);
    expect(
      await loadDiagramFonts({ load: () => new Promise(() => {}) }, 5),
    ).toBe(false);
  });
});
