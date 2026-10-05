import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { elementSchema } from "../../src/schemas.js";
import {
  isElement,
  serialize,
  serializeValue,
  summarize,
} from "../../src/serialize.js";
import {
  create,
  installMockApp,
  META,
  mockTypes,
  type Element,
  type MockEnvironment,
  type View,
} from "../mock/staruml.js";

let env: MockEnvironment;

beforeEach(() => {
  env = installMockApp();
});

function classWithView(name: string): View {
  return env.app.factory.createModelAndView({
    id: "UMLClass",
    parent: env.model,
    diagram: env.mainDiagram,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 50,
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

function attribute(owner: Element, name: string): Element {
  return env.app.factory.createModel({
    id: "UMLAttribute",
    parent: owner,
    field: "attributes",
    modelInitializer: (m) => {
      m.name = name;
    },
  })!;
}

describe("summarize", () => {
  it("returns _id, _type, name and the parent id", () => {
    expect(summarize(env.model)).toEqual({
      _id: env.model._id,
      _type: "UMLModel",
      name: "Model",
      _parent: env.project._id,
    });
  });

  it("reports no parent for the project and no name for a view", () => {
    expect(summarize(env.project)).toMatchObject({ _parent: null });
    expect(summarize(classWithView("A"))).toMatchObject({
      _type: "UMLClassView",
      name: null,
      _parent: env.mainDiagram._id,
    });
  });
});

describe("serialize", () => {
  it("defaults to the summary", () => {
    expect(serialize(env.model)).toEqual(summarize(env.model));
    expect(serialize(env.model, { summary: true, depth: 3 })).toEqual(
      summarize(env.model),
    );
  });

  it("returns every saved attribute when summary is false, owned elements as refs", () => {
    const view = classWithView("Book");
    const cls = view.model!;
    const attr = attribute(cls, "title");
    const full = serialize(cls, { summary: false });
    expect(full).toMatchObject({
      _id: cls._id,
      _type: "UMLClass",
      _parent: env.model._id,
      name: "Book",
      visibility: "public",
      isAbstract: false,
      attributes: [{ $ref: attr._id }],
      operations: [],
      tags: [],
      stereotype: null,
    });
    // The Element attributes _id and _parent stay plain ids, not {$ref}s.
    expect(typeof full._parent).toBe("string");
  });

  it("covers every attribute kind of a view: ref, refs, objs, custom, and skips transient ones", () => {
    const view = classWithView("Book");
    const other = classWithView("Other");
    view.containedViews = [other, "not an element"];
    const full = serialize(view, { summary: false });
    expect(full).toMatchObject({
      _type: "UMLClassView",
      model: { $ref: view.model!._id },
      containedViews: [{ $ref: other._id }],
      font: "Arial;13;0",
      left: 0,
      width: 100,
    });
    expect(full).not.toHaveProperty("selected");
    expect(full).not.toHaveProperty("name");
  });

  it("returns a relationship's ends (obj) as refs, or nested with depth", () => {
    const tail = classWithView("A");
    const head = classWithView("B");
    const edge = env.app.factory.createModelAndView({
      id: "UMLAssociation",
      parent: env.model,
      diagram: env.mainDiagram,
      tailView: tail,
      headView: head,
      tailModel: tail.model,
      headModel: head.model,
    })!;
    const assoc = edge.model!;
    const end1 = assoc.end1 as Element;
    expect(serialize(assoc, { fields: ["end1"] })).toEqual({
      _id: assoc._id,
      _type: "UMLAssociation",
      end1: { $ref: end1._id },
    });
    expect(
      serialize(assoc, { fields: ["end1", "reference"], depth: 1 }),
    ).toEqual({
      _id: assoc._id,
      _type: "UMLAssociation",
      end1: {
        _id: end1._id,
        _type: "UMLAssociationEnd",
        reference: { $ref: tail.model!._id },
      },
    });
    expect(serialize(edge, { fields: ["tail", "head", "points"] })).toEqual({
      _id: edge._id,
      _type: "UMLAssociationView",
      tail: { $ref: tail._id },
      head: { $ref: head._id },
      points: "",
    });
  });

  it("expands owned elements depth levels deep with the same projection", () => {
    const view = classWithView("Book");
    const attr = attribute(view.model!, "title");
    const tree = serialize(env.model, {
      fields: ["name", "ownedElements", "attributes"],
      depth: 2,
    });
    expect(tree).toEqual({
      _id: env.model._id,
      _type: "UMLModel",
      name: "Model",
      ownedElements: [
        {
          _id: env.mainDiagram._id,
          _type: "UMLClassDiagram",
          name: "Main",
          ownedElements: [],
        },
        {
          _id: view.model!._id,
          _type: "UMLClass",
          name: "Book",
          ownedElements: [],
          attributes: [
            {
              _id: attr._id,
              _type: "UMLAttribute",
              name: "title",
              ownedElements: [],
            },
          ],
        },
      ],
    });
    // One level less leaves the class's attributes as refs.
    const shallow = serialize(env.model, {
      fields: ["ownedElements", "attributes"],
      depth: 1,
    });
    expect(
      (shallow.ownedElements as Record<string, unknown>[])[1]!.attributes,
    ).toEqual([{ $ref: attr._id }]);
  });

  it("returns only _id, _type and the listed fields, including _parent on request", () => {
    expect(
      serialize(env.model, { fields: ["_parent", "noSuchField"] }),
    ).toEqual({
      _id: env.model._id,
      _type: "UMLModel",
      _parent: env.project._id,
    });
    expect(serialize(env.project, { fields: ["_parent"] })).toEqual({
      _id: env.project._id,
      _type: "Project",
      _parent: null,
    });
  });

  it("returns a var attribute as a ref when it holds an element and as-is otherwise", () => {
    const cls = classWithView("Book").model!;
    const attr = attribute(cls, "title");
    attr.type = cls;
    expect(serialize(attr, { fields: ["type"] })).toEqual({
      _id: attr._id,
      _type: "UMLAttribute",
      type: { $ref: cls._id },
    });
    attr.type = "String";
    expect(serialize(attr, { fields: ["type"] }).type).toBe("String");
  });

  it("tolerates values that do not match their declared kind", () => {
    const cls = classWithView("Book").model!;
    const view = classWithView("Other");
    Object.assign(view, {
      model: "dangling",
      containedViews: null,
      font: "not custom",
    });
    Object.assign(cls, { attributes: "x", stereotype: undefined });
    const end = create("UMLAssociationEnd");
    end.reference = 5;
    const assoc = create("UMLAssociation");
    assoc.end1 = "broken";
    expect(
      serialize(view, { fields: ["model", "containedViews", "font"] }),
    ).toEqual({
      _id: view._id,
      _type: "UMLClassView",
      model: null,
      containedViews: [],
      font: null,
    });
    expect(serialize(cls, { fields: ["attributes", "stereotype"] })).toEqual({
      _id: cls._id,
      _type: "UMLClass",
      attributes: [],
    });
    expect(serialize(end, { fields: ["reference"] }).reference).toBeNull();
    expect(serialize(assoc, { fields: ["end1"] }).end1).toBeNull();
  });
});

// Issue #8: projection holds for every element class in the 7.1.1 metamodel.
describe("projection on every element kind", () => {
  const schema = elementSchema();
  const classNames = Object.keys(mockTypes).filter(
    (name) => META[name]!.kind === "class",
  );

  it("generates a class for each of the 7.1.1 meta classes", () => {
    expect(classNames.length).toBeGreaterThan(600);
  });

  it.each(classNames)("%s", (name) => {
    const elem = create(name);
    elem._parent = env.model;
    for (const projection of [
      {},
      { summary: false },
      { summary: false, depth: 1 },
      { fields: ["name", "ownedElements"] },
    ]) {
      const json = serialize(elem, projection);
      z.parse(schema, json);
      expect(json._id).toBe(elem._id);
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    }
    expect(serialize(elem)).toEqual({
      _id: elem._id,
      _type: name,
      name: typeof elem.name === "string" ? elem.name : null,
      _parent: env.model._id,
    });
  });
});

describe("isElement", () => {
  it("recognises instances of type.Element only", () => {
    expect(isElement(env.model)).toBe(true);
    expect(isElement({ _id: "x" })).toBe(false);
    expect(isElement(null)).toBe(false);
  });
});

describe("serializeValue", () => {
  it.each([
    [undefined, null],
    [null, null],
    [3, 3],
    ["s", "s"],
    [true, true],
    [{ a: [1] }, { a: [1] }],
    [() => 1, "[function]"],
  ])("maps %s to %j", (value, expected) => {
    expect(serializeValue(value)).toEqual(expected);
  });

  it("projects elements, also inside arrays", () => {
    expect(serializeValue([env.model, 1])).toEqual([summarize(env.model), 1]);
    expect(serializeValue(env.model, { fields: ["name"] })).toEqual({
      _id: env.model._id,
      _type: "UMLModel",
      name: "Model",
    });
  });

  it("marks values JSON cannot represent", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeValue(cyclic)).toBe("[non-serializable]");
  });
});
