import { beforeEach, describe, expect, it } from "vitest";
import {
  getEditorState,
  getSelection,
  setEditorState,
  setSelection,
} from "../../../src/handlers/editor.js";
import { createElementWithView } from "../../../src/handlers/elements.js";
import { installMockApp, type MockEnvironment } from "../../mock/staruml.js";
import { fails, ok } from "../support.js";

let env: MockEnvironment;
interface Created {
  view: { _id: string };
  model: { _id: string };
}
interface Selection {
  models: { _id: string }[];
  views: { _id: string }[];
}
const ids = (list: { _id: string }[]) => list.map((e) => e._id);

beforeEach(() => {
  env = installMockApp();
});

describe("/get_selection and /set_selection", () => {
  it("starts empty", async () => {
    expect(await ok(getSelection)).toEqual({ models: [], views: [] });
  });

  it("selects views on their diagram, adding their models and extra models", async () => {
    const node = () =>
      ok<Created>(createElementWithView, {
        type: "UMLClass",
        diagramId: env.mainDiagram._id,
      });
    const a = await node();
    const b = await node();
    const data = await ok<Selection>(setSelection, {
      viewIds: [a.view._id, b.view._id],
      modelIds: [a.model._id, env.model._id],
    });
    expect(ids(data.views)).toEqual([a.view._id, b.view._id]);
    expect(ids(data.models)).toEqual([a.model._id, b.model._id, env.model._id]);
    expect(env.app.diagrams.getCurrentDiagram()).toBe(env.mainDiagram);
    const read = await ok<Selection>(getSelection, { fields: ["name"] });
    expect(ids(read.views)).toEqual([a.view._id, b.view._id]);
  });

  it("selects a view without a model", async () => {
    const note = await ok<Created>(createElementWithView, {
      type: "Note",
      diagramId: env.mainDiagram._id,
    });
    const data = await ok<Selection>(setSelection, {
      viewIds: [note.view._id],
    });
    expect(data.models).toEqual([]);
  });

  it("selects models only, and clears with an empty request", async () => {
    const data = await ok<Selection>(setSelection, {
      modelIds: [env.model._id],
      viewIds: [],
    });
    expect(ids(data.models)).toEqual([env.model._id]);
    expect(await ok(setSelection, {})).toEqual({ models: [], views: [] });
  });

  it("rejects unknown ids", async () => {
    await fails(setSelection, { modelIds: ["nope"] }, "NOT_FOUND");
    await fails(setSelection, { viewIds: [env.model._id] }, "NOT_FOUND");
  });
});

describe("/get_editor_state and /set_editor_state", () => {
  it("describes the editor", async () => {
    expect(await ok(getEditorState)).toEqual({
      currentDiagram: null,
      workingDiagrams: [],
      zoom: 1,
      topLeft: null,
      gridVisible: false,
      snapToGrid: true,
    });
  });

  it("opens a diagram, zooms, scrolls and toggles the grid", async () => {
    const data = await ok(setEditorState, {
      diagramId: env.mainDiagram._id,
      zoom: 2,
      center: { x: 1000, y: 800 },
      gridVisible: true,
      snapToGrid: false,
    });
    expect(data).toEqual({
      currentDiagram: env.mainDiagram._id,
      workingDiagrams: [env.mainDiagram._id],
      zoom: 2,
      topLeft: { x: 800, y: 650 },
      gridVisible: true,
      snapToGrid: false,
    });
    expect(await ok(setEditorState, { gridVisible: false })).toMatchObject({
      gridVisible: false,
    });
    expect(await ok(setEditorState, {})).toMatchObject({ zoom: 2 });
  });

  it("reads an unscrolled diagram's top-left as the origin", async () => {
    expect(
      await ok(setEditorState, { diagramId: env.mainDiagram._id }),
    ).toMatchObject({ topLeft: { x: 0, y: 0 } });
  });

  it("validates its input", async () => {
    await fails(setEditorState, { zoom: 5 }, "INVALID_ARGUMENT", /^zoom: /);
    await fails(setEditorState, { diagramId: env.model._id }, "NOT_FOUND");
  });
});
