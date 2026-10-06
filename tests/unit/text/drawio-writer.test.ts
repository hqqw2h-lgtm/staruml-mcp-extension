import { beforeEach, describe, expect, it } from "vitest";
import cases from "../../fixtures/build/cases.json";
import { exportText } from "../../../src/handlers/export-text.js";
import { endpoints } from "../../../src/routes.js";
import {
  installMockApp,
  type MockElement,
  type MockEnvironment,
} from "../../mock/staruml.js";
import { fullResults, ok } from "../support.js";
import { drawioProblems, parseXml, type XmlNode } from "./drawio-xsd.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

const build = fullResults(endpoints.find((e) => e.path === "/build_diagram")!);

interface Built {
  diagram: { _id: string };
  kind: string;
}

interface Exported {
  kind: string;
  format: string;
  text: string;
  warnings: string[];
}

/** Mock ids count up across a run; goldens number them by first use. */
export function normalizeIds(text: string): string {
  const seen = new Map<string, string>();
  return text.replace(
    /MOCK\d{6}/g,
    (id) => seen.get(id) ?? seen.set(id, `ID${seen.size + 1}`).get(id)!,
  );
}

/** One case per build kind: the first cases.json lists for it. */
const perKind = Object.entries(cases).filter(
  ([, body], i, all) =>
    all.findIndex(
      ([, b]) =>
        (b as { kind?: string }).kind === (body as { kind?: string }).kind,
    ) === i && (body as { kind?: string }).kind !== undefined,
);

export const cellsOf = (text: string): XmlNode[] =>
  parseXml(text).children[0]!.children[0]!.children[0]!.children;

describe("/export_text format drawio per kind", () => {
  it.each(perKind)("%s", async (label, body) => {
    const built = await ok<Built>(build, body as Record<string, unknown>);
    const out = await ok<Exported>(exportText, {
      diagram: built.diagram._id,
      format: "drawio",
    });
    expect(out.format).toBe("drawio");
    expect(out.kind).toBe(built.kind);
    expect(drawioProblems(out.text)).toEqual([]);
    // Every view the diagram shows is a cell under its own id.
    const diagram = env.app.repository.get(built.diagram._id)!;
    const views = (diagram.ownedViews as MockElement[])
      .filter((v) => v.visible !== false)
      .map((v) => v._id);
    const ids = new Set(cellsOf(out.text).map((c) => c.attrs.id));
    expect(views.filter((id) => !ids.has(id))).toEqual([]);
    expect(out.warnings).toEqual([]);
    await expect(normalizeIds(out.text)).toMatchFileSnapshot(
      `../../fixtures/drawio/${label}.drawio`,
    );
  });
});

describe("the mxfile.xsd validator the goldens are held to", () => {
  const file = (cells: string, model = "") =>
    `<mxfile><diagram id="d" name="n"><mxGraphModel${model}><root><mxCell id="0" /><mxCell id="1" parent="0" />${cells}</root></mxGraphModel></diagram></mxfile>`;
  const vertex = `<mxCell id="a" value="" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry" /></mxCell>`;

  it("accepts a minimal file", () => {
    expect(drawioProblems(file(vertex))).toEqual([]);
  });

  it.each([
    [
      file(vertex.replace('vertex="1"', 'vertex="true"')),
      'vertex="true" is not a valid booleanInt',
    ],
    [
      file(vertex.replace("<mxCell", '<mxCell bogus="1"')),
      "attribute bogus not allowed",
    ],
    [
      file(vertex, ' pageWidth="0"'),
      'pageWidth="0" is not a valid xs:positiveInteger',
    ],
    [
      file(vertex, ' background="red"'),
      'background="red" is not a valid colorType',
    ],
    [
      file(vertex.replace(' x="1"', ' x="one"')),
      'x="one" is not a valid xs:double',
    ],
    [
      file(vertex.replace('as="geometry"', 'as="other"')),
      'as must be "geometry"',
    ],
    [file(vertex).replace("<root>", "<root>text"), "text content not allowed"],
    [
      file(vertex).replace("</mxGraphModel>", "<root /></mxGraphModel>"),
      "do not match the content model",
    ],
    [
      file(vertex.replace('parent="1"', 'parent="9"')),
      "parent 9 is not a cell",
    ],
    [file(`<mxCell id="e" edge="1" parent="1" />`), "edge e has no mxGeometry"],
    [file(vertex + vertex), "duplicate cell id a"],
    [
      file(vertex).replace('<mxCell id="0" />', ""),
      'first cell is not the root "0"',
    ],
    ["<mxfile><diagram></mxfile>", "expected </diagram>"],
    ["<other />", "root is <other>, not <mxfile>"],
  ])("rejects %#: %s", (text, problem) => {
    expect(drawioProblems(text).join("\n")).toContain(problem);
  });
});
