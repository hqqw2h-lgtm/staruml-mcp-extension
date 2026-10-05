import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appModule, diagramExport } from "../../src/app-modules.js";

const proc = process as { resourcesPath?: string };

afterEach(() => {
  delete proc.resourcesPath;
});

describe("StarUML module loader", () => {
  it("resolves modules under Electron's resources path", () => {
    const resources = mkdtempSync(join(tmpdir(), "resources-"));
    mkdirSync(join(resources, "app", "src", "engine"), { recursive: true });
    writeFileSync(
      join(resources, "app", "src", "engine", "diagram-export.js"),
      "exports.getSVGImageData = () => '<svg/>';",
    );
    proc.resourcesPath = resources;
    expect(diagramExport().getSVGImageData({ _id: "d" })).toBe("<svg/>");
    expect(appModule("engine/diagram-export.js")).toBe(diagramExport());
  });

  it("refuses outside StarUML", () => {
    expect(() => diagramExport()).toThrow(
      "StarUML's modules are only available inside StarUML",
    );
  });
});
