import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  center,
  createModelAndView,
  createOwned,
  diagramOf,
  endView,
  initialValues,
  instantiate,
  requireModelId,
} from "../../src/create.js";
import {
  create,
  installMockApp,
  type MockEnvironment,
  type View,
} from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function classView(name = "A"): View {
  return env.app.factory.createModelAndView({
    id: "UMLClass",
    parent: env.model,
    diagram: env.mainDiagram,
    x1: 10,
    y1: 20,
    x2: 110,
    y2: 60,
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

describe("initialValues", () => {
  it("merges the name into the converted properties", () => {
    expect(initialValues("UMLClass", "A", { isAbstract: true })).toEqual({
      isAbstract: true,
      name: "A",
    });
    expect(initialValues("UMLClass", undefined, undefined)).toEqual({});
  });
});

describe("requireModelId", () => {
  it("refuses a registered id without a metamodel class", () => {
    expect(() => requireModelId("SysMLOperation")).toThrow(
      "SysMLOperation is registered with the factory but has no metamodel class, so StarUML cannot create it",
    );
  });

  it("accepts registered model ids only", () => {
    expect(() => requireModelId("UMLClass")).not.toThrow();
    expect(() => requireModelId("UMLClassView")).toThrow(
      expect.objectContaining({
        code: "UNKNOWN_TYPE",
        message: "Unknown model type: UMLClassView",
      }),
    );
  });
});

describe("createOwned", () => {
  it("creates in the fitting list with the values and runs the initializer", () => {
    const cls = classView().model!;
    const init = vi.fn();
    const attr = createOwned(
      cls,
      "UMLAttribute",
      undefined,
      { name: "a" },
      init,
    );
    expect(cls.attributes).toContain(attr);
    expect(attr.name).toBe("a");
    expect(init).toHaveBeenCalledWith(attr);
  });

  it("reports a factory that returns nothing", () => {
    vi.spyOn(env.app.factory, "createModel").mockReturnValue(null);
    expect(() => createOwned(env.model, "UMLClass", undefined, {})).toThrow(
      expect.objectContaining({
        code: "STARUML_ERROR",
        message: "StarUML did not create UMLClass in UMLModel.ownedElements",
      }),
    );
  });
});

describe("instantiate", () => {
  it("builds a detached element and refuses non-classes", () => {
    const param = instantiate("UMLParameter");
    expect(param.constructor.name).toBe("UMLParameter");
    expect(env.app.repository.get(param._id)).toBeUndefined();
    for (const name of ["UMLDirectionKind", "Nope"]) {
      expect(() => instantiate(name)).toThrow(
        expect.objectContaining({ code: "UNKNOWN_TYPE" }),
      );
    }
  });
});

describe("diagramOf", () => {
  it("walks up from sub-views and returns null outside a diagram", () => {
    const view = classView();
    const sub = create<View>("LabelView");
    sub._parent = view;
    expect(diagramOf(sub)).toBe(env.mainDiagram);
    expect(diagramOf(create("UMLClassView"))).toBeNull();
  });
});

describe("endView", () => {
  it("takes a view on the diagram, or the model's view there", () => {
    const view = classView();
    expect(endView(view._id, env.mainDiagram, "Tail")).toBe(view);
    expect(endView(view.model!._id, env.mainDiagram, "Tail")).toBe(view);
  });

  it("refuses a view on another diagram and a model not shown there", () => {
    const view = classView();
    const other = env.app.factory.createDiagram({
      id: "UMLClassDiagram",
      parent: env.model,
    })!;
    expect(() => endView(view._id, other, "Head")).toThrow(
      expect.objectContaining({
        code: "NOT_FOUND",
        message: `Head ${view._id} is not on diagram ${other._id}`,
      }),
    );
    expect(() => endView(view.model!._id, other, "Head")).toThrow(
      `Head: no view of ${view.model!._id} on diagram ${other._id}`,
    );
    expect(() => endView("missing", other, "Head")).toThrow(
      "Head not found: missing",
    );
  });
});

describe("center", () => {
  it("is the middle of a node view and null for other views", () => {
    expect(center(classView())).toEqual({ x: 60, y: 40 });
    expect(center(create<View>("UMLAssociationView"))).toBeNull();
  });
});

describe("createModelAndView", () => {
  it("passes the editor along", () => {
    const spy = vi.spyOn(env.app.factory, "createModelAndView");
    createModelAndView({
      id: "UMLClass",
      parent: env.model,
      diagram: env.mainDiagram,
    });
    expect(spy.mock.calls[0]![0]).toMatchObject({
      editor: env.app.diagrams.getEditor(),
    });
  });

  it("reports an unregistered id and a factory that returns nothing", () => {
    const options = { parent: env.model, diagram: env.mainDiagram };
    expect(() => createModelAndView({ ...options, id: "Nope" })).toThrow(
      expect.objectContaining({
        code: "UNKNOWN_TYPE",
        message: "Unknown model-and-view type: Nope",
      }),
    );
    vi.spyOn(env.app.factory, "createModelAndView").mockReturnValue(null);
    expect(() => createModelAndView({ ...options, id: "UMLClass" })).toThrow(
      expect.objectContaining({
        code: "STARUML_ERROR",
        message: `StarUML did not create UMLClass on diagram ${env.mainDiagram._id}`,
      }),
    );
  });
});
