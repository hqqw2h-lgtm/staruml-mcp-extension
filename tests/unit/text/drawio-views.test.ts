import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { toDrawio, xmlAttr } from "../../../src/text/drawio-writer.js";
import {
  builtInProfiles,
  mergePatch,
  type Profile,
} from "../../../src/style/profile.js";
import {
  create,
  installMockApp,
  type MockElement,
  mockPoints,
} from "../../mock/staruml.js";
import { drawioProblems, parseXml, type XmlNode } from "./drawio-xsd.js";

beforeEach(() => {
  installMockApp();
});

type M = MockElement & Record<string, unknown>;
type Box = [number, number, number, number];

const standard = () => builtInProfiles()["uml-standard"]!;

const model = (typeName: string, fields: Record<string, unknown> = {}) =>
  Object.assign(create(typeName), fields) as M;

function diagram(typeName = "UMLClassDiagram", name = "D"): M {
  return model(typeName, { name });
}

function node(
  d: M,
  viewType: string,
  m: M | null,
  [left, top, width, height]: Box,
  extra: Record<string, unknown> = {},
): M {
  const v = model(viewType, { model: m, left, top, width, height, ...extra });
  (d.ownedViews as M[]).push(v);
  return v;
}

function edge(
  d: M,
  viewType: string,
  m: M | null,
  tail: M | null,
  head: M | null,
  pts?: [number, number][],
  extra: Record<string, unknown> = {},
): M {
  const v = model(viewType, { model: m, tail, head, ...extra });
  if (pts) v.points = mockPoints(pts.map(([x, y]) => ({ x, y })));
  (d.ownedViews as M[]).push(v);
  return v;
}

function write(d: M, profile: Profile = standard()) {
  const out = toDrawio(d as never, profile);
  expect(drawioProblems(out.text)).toEqual([]);
  const cells = new Map<string, XmlNode>(
    parseXml(out.text).children[0]!.children[0]!.children[0]!.children.map(
      (c) => [c.attrs.id!, c],
    ),
  );
  return { ...out, cells };
}

const cls = (name: string, fields: Record<string, unknown> = {}) =>
  model("UMLClass", { name, ...fields });

describe("toDrawio nodes", () => {
  it("writes classifiers as compartments in an HTML label", () => {
    const d = diagram();
    const a = cls("Order<T>", {
      isAbstract: true,
      stereotype: "entity",
      attributes: [model("UMLAttribute", { name: "id", type: "long" })],
      operations: [model("UMLOperation", { name: "pay" })],
    });
    const i = model("UMLInterface", {
      name: "Pay",
      stereotype: model("UMLStereotype", { name: "api" }),
    });
    const e = model("UMLEnumeration", {
      name: "Kind",
      literals: [model("UMLEnumerationLiteral", { name: "NEW" })],
    });
    const va = node(d, "UMLClassView", a, [10, 10, 100, 80]);
    const vi = node(d, "UMLInterfaceView", i, [200, 10, 100, 80], {
      suppressAttributes: true,
      suppressOperations: true,
    });
    const ve = node(d, "UMLEnumerationView", e, [400, 10, 100, 80]);
    const ve2 = node(d, "UMLEnumerationView", e, [600, 10, 100, 80], {
      suppressLiterals: true,
    });
    const { cells } = write(d);
    expect(cells.get(va._id)!.attrs.value).toBe(
      '<p style="margin:0;margin-top:4px;text-align:center;">«entity»<br><b><i>Order&lt;T&gt;</i></b></p>' +
        '<hr size="1" style="border-style:solid;"><p style="margin:0;margin-left:4px;">+id: long</p>' +
        '<hr size="1" style="border-style:solid;"><p style="margin:0;margin-left:4px;">+pay()</p>',
    );
    expect(cells.get(vi._id)!.attrs.value).toBe(
      '<p style="margin:0;margin-top:4px;text-align:center;">«interface»<br>«api»<br><b>Pay</b></p>',
    );
    expect(cells.get(ve._id)!.attrs.value).toContain(
      '<p style="margin:0;margin-left:4px;">NEW</p>',
    );
    expect(cells.get(ve2._id)!.attrs.value).not.toContain("NEW");
    expect(cells.get(va._id)!.attrs.style).toBe(
      "verticalAlign=top;align=left;overflow=fill;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#000000;fontColor=#000000;fontFamily=Arial;fontSize=13;",
    );
  });

  it("writes ERD entities as tables marking keys", () => {
    const d = diagram("ERDDiagram");
    const col = (name: string, f: Record<string, unknown>) =>
      model("ERDColumn", { name, type: "int", ...f });
    const ent = model("ERDEntity", {
      name: "orders",
      columns: [
        col("id", { primaryKey: true, length: "0" }),
        col("ref", { foreignKey: true, unique: true, length: "10" }),
        col("note", { nullable: true, type: "" }),
      ],
    });
    const v = node(d, "ERDEntityView", ent, [0, 0, 100, 60]);
    expect(write(d).cells.get(v._id)!.attrs.value).toBe(
      '<p style="margin:0;margin-top:4px;text-align:center;"><b>orders</b></p>' +
        '<hr size="1" style="border-style:solid;"><table style="width:100%;font-size:1em;" cellpadding="2" cellspacing="0">' +
        "<tr><td>PK</td><td><u>id</u></td><td>int</td></tr>" +
        "<tr><td>FK, U</td><td>ref</td><td>int(10)</td></tr>" +
        "<tr><td>N</td><td>note</td><td></td></tr></table>",
    );
  });

  it("labels C4, requirement, lifeline, wireframe and history views", () => {
    const d = diagram("UMLClassDiagram");
    const views = [
      node(
        d,
        "C4PersonView",
        model("C4Person", { name: "U", description: "uses" }),
        [0, 0, 50, 50],
      ),
      node(
        d,
        "C4ContainerView",
        model("C4Container", { name: "App", technology: "React" }),
        [60, 0, 50, 50],
      ),
      node(
        d,
        "SysMLRequirementView",
        model("SysMLRequirement", { name: "R", id: "1", text: "a<b" }),
        [120, 0, 50, 50],
      ),
      node(
        d,
        "SysMLRequirementView",
        model("SysMLRequirement", {
          name: "F",
          stereotype: "functionalRequirement",
        }),
        [180, 0, 50, 50],
      ),
      node(
        d,
        "UMLSeqLifelineView",
        model("UMLLifeline", {
          name: "a",
          represent: model("UMLAttribute", { type: cls("Shop") }),
        }),
        [240, 0, 50, 300],
      ),
      node(
        d,
        "UMLSeqLifelineView",
        model("UMLLifeline", { name: "b" }),
        [300, 0, 50, 300],
      ),
      node(
        d,
        "WFCheckboxView",
        model("WFCheckbox", { name: "on", checked: true }),
        [360, 0, 50, 20],
      ),
      node(
        d,
        "WFCheckboxView",
        model("WFCheckbox", { name: "off" }),
        [360, 30, 50, 20],
      ),
      node(
        d,
        "WFDropdownView",
        model("WFDropdown", { name: "pick" }),
        [360, 60, 50, 20],
      ),
      node(
        d,
        "UMLPseudostateView",
        model("UMLPseudostate", { kind: "deepHistory" }),
        [420, 0, 20, 20],
      ),
      node(
        d,
        "UMLPseudostateView",
        model("UMLPseudostate", { kind: "initial" }),
        [450, 0, 20, 20],
      ),
      node(
        d,
        "UMLArtifactView",
        model("UMLArtifact", { name: "a.jar" }),
        [480, 0, 40, 40],
      ),
    ];
    const { cells } = write(d);
    expect(views.map((v) => cells.get(v._id)!.attrs.value)).toEqual([
      '<b>U</b><br><span style="font-size:0.8em;">[Person]</span><br><br>uses',
      '<b>App</b><br><span style="font-size:0.8em;">[Container: React]</span>',
      '<p style="margin:0;margin-top:4px;text-align:center;">«requirement»<br><b>R</b></p><hr size="1" style="border-style:solid;"><p style="margin:0;margin-left:4px;">id = 1<br>text = a&lt;b</p>',
      expect.stringContaining("«functionalRequirement»"),
      "a : Shop",
      "b",
      "☑ on",
      "☐ off",
      "pick ▾",
      "H*",
      "",
      "«artifact»<br>a.jar",
    ]);
    // A pseudostate keeps the black fill its shape means.
    expect(cells.get(views[10]!._id)!.attrs.style).toBe(
      "ellipse;shape=startState;fillColor=#000000;strokeColor=#000000;html=1;fontColor=#000000;fontFamily=Arial;fontSize=13;",
    );
    expect(cells.get(views[4]!._id)!.attrs.style).toContain(
      "size=40;container=1;",
    );
  });

  it("writes frames, notes, text and unknown views", () => {
    const d = diagram("UMLSequenceDiagram", "Checkout");
    const sd = model("LabelView", { text: "sd" });
    const f1 = node(d, "UMLFrameView", d, [0, 0, 500, 500], {
      frameTypeLabel: sd,
    });
    const f2 = node(d, "UMLFrameView", null, [600, 0, 50, 50]);
    const note = node(d, "UMLNoteView", null, [10, 400, 80, 40], {
      text: "why\nnot",
    });
    const text = node(d, "UMLTextView", null, [100, 400, 80, 40], {
      text: "t",
    });
    const ann = node(
      d,
      "BPMNTextAnnotationView",
      model("BPMNTextAnnotation", { text: "ann" }),
      [200, 400, 80, 40],
    );
    // A view of a model type the table does not list: a plain box.
    const other = node(
      d,
      "UMLClassView",
      model("UMLCollaboration"),
      [300, 400, 80, 40],
    );
    const bare = node(d, "UMLClassView", null, [400, 400, 80, 40]);
    const { cells } = write(d);
    expect(cells.get(f1._id)!.attrs.value).toBe("<b>sd</b> Checkout");
    expect(cells.get(f2._id)!.attrs.value).toBe("Checkout");
    expect(cells.get(note._id)!.attrs.value).toBe("why<br>not");
    expect(cells.get(text._id)!.attrs.style).not.toContain("fillColor");
    expect(cells.get(ann._id)!.attrs.value).toBe("ann");
    expect(cells.get(other._id)!.attrs.style).toMatch(
      /^rounded=0;whiteSpace=wrap;html=1;fillColor/,
    );
    expect(cells.get(bare._id)!.attrs.value).toBe("");
  });

  it("skips hidden views and views that are neither node nor edge", () => {
    const d = diagram();
    node(d, "UMLClassView", cls("A"), [0, 0, 10, 10], { visible: false });
    node(d, "UMLClassView", cls("B"), [0, 0, 10, 10], { left: undefined });
    node(d, "UMLClassView", cls("C"), [0, 0, 10, 10], { visible: false });
    (d.ownedViews as M[]).push(cls("D"));
    expect(write(d).warnings).toEqual([
      "3 UMLClassView views are not drawn",
      "1 UMLClass view is not drawn",
    ]);
  });

  it("nests views in declared and drawn containers, relative to them", () => {
    const d = diagram("UMLActivityDiagram");
    const lane = node(
      d,
      "UMLSwimlaneView",
      model("UMLActivityPartition", { name: "L" }),
      [100, 100, 300, 300],
    );
    const big = node(
      d,
      "UMLSwimlaneView",
      model("UMLActivityPartition", { name: "Big" }),
      [0, 0, 1000, 1000],
    );
    const act = node(
      d,
      "UMLActionView",
      model("UMLAction", { name: "go" }),
      [150, 160, 50, 20],
    );
    // A component holds its port by declaration, though it sticks out.
    const comp = node(
      d,
      "UMLComponentView",
      model("UMLComponent", { name: "C" }),
      [500, 500, 100, 100],
    );
    const port = node(d, "UMLPortView", model("UMLPort"), [590, 540, 20, 20], {
      containerView: comp,
    });
    // A container the diagram does not draw is ignored.
    const loose = node(d, "UMLPortView", model("UMLPort"), [5, 5, 2, 2], {
      containerView: model("UMLComponentView"),
    });
    const { cells, text } = write(d);
    expect(cells.get(act._id)!.attrs.parent).toBe(lane._id);
    expect(cells.get(lane._id)!.attrs.parent).toBe(big._id);
    expect(cells.get(act._id)!.children[0]!.attrs).toMatchObject({
      x: "50",
      y: "60",
    });
    expect(cells.get(port._id)!.attrs.parent).toBe(comp._id);
    expect(cells.get(port._id)!.children[0]!.attrs.x).toBe("90");
    expect(cells.get(loose._id)!.attrs.parent).toBe(big._id);
    // Parents come before their children.
    expect(text.indexOf(big._id)).toBeLessThan(text.indexOf(`id="${lane._id}`));
  });

  it("puts views of a declared container cycle in the layer", () => {
    const d = diagram();
    const a = node(d, "UMLPackageView", model("UMLPackage"), [0, 0, 50, 50]);
    const b = node(d, "UMLPackageView", model("UMLPackage"), [0, 0, 60, 60]);
    a.containerView = b;
    b.containerView = a;
    const { cells } = write(d);
    expect(cells.get(a._id)!.attrs.parent).toBe("1");
    expect(cells.get(b._id)!.attrs.parent).toBe("1");
  });

  it("applies the profile's visuals over the view's own", () => {
    const d = diagram();
    const v = node(d, "UMLInterfaceView", model("UMLInterface"), [0, 0, 9, 9], {
      fillColor: "",
      font: null,
    });
    const profile = builtInProfiles()["presentation"]!;
    expect(write(d, profile).cells.get(v._id)!.attrs.style).toContain(
      "fillColor=#e8f4fd;strokeColor=#2b6cb0;fontColor=#1a365d;fontSize=15;",
    );
  });
});

describe("toDrawio sequence diagrams", () => {
  it("orders messages by y, numbers them and hangs activations and operands", () => {
    const d = diagram("UMLSequenceDiagram");
    const ll = (name: string, x: number) => {
      const head = model("UMLNameCompartmentView", { height: 30 });
      const line = model("UMLLinePartView");
      const v = node(d, "UMLSeqLifelineView", model("UMLLifeline", { name }), [
        x,
        0,
        100,
        400,
      ]);
      v.subViews = [head, line];
      return { v, line };
    };
    const a = ll("a", 0);
    const b = ll("b", 200);
    const msg = (
      name: string,
      y: number,
      sort: string,
      extra: Record<string, unknown> = {},
    ) =>
      edge(
        d,
        "UMLSeqMessageView",
        model("UMLMessage", { name, messageSort: sort, ...extra }),
        a.line,
        b.line,
        [
          [50, y],
          [250, y],
        ],
      );
    const late = msg("late", 300, "reply");
    const early = msg("early", 100, "asynchCall", { arguments: "x" });
    const odd = msg("odd", 200, "lost");
    const act = model("UMLActivationView", {
      left: 243,
      top: 100,
      width: 14,
      height: 30,
    });
    const hidden = model("UMLActivationView", {
      left: 243,
      top: 300,
      width: 14,
      height: 30,
      visible: false,
    });
    early.subViews = [model("EdgeLabelView"), act];
    late.subViews = [hidden];
    // A message whose head is not drawn has no activation.
    const nowhere = edge(
      d,
      "UMLSeqMessageView",
      model("UMLMessage", { name: "x" }),
      a.line,
      model("UMLLinePartView"),
    );
    nowhere.subViews = [model("UMLActivationView")];
    const frag = node(
      d,
      "UMLCombinedFragmentView",
      model("UMLCombinedFragment", { interactionOperator: "alt" }),
      [10, 80, 300, 250],
    );
    const op1 = model("UMLInteractionOperandView", {
      model: model("UMLInteractionOperand", { guard: "ok" }),
      left: 10,
      top: 100,
      width: 300,
      height: 100,
    });
    const op2 = model("UMLInteractionOperandView", {
      model: model("UMLInteractionOperand"),
      left: 10,
      top: 200,
      width: 300,
      height: 100,
    });
    frag.subViews = [
      model("UMLInteractionOperandCompartmentView", { subViews: [op2, op1] }),
    ];
    const { cells, text, warnings } = write(d);
    expect(warnings).toEqual(["1 UMLSeqMessageView view is not drawn"]);
    const order = [early, odd, late].map((e) => text.indexOf(`id="${e._id}"`));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(cells.get(early._id)!.attrs).toMatchObject({
      value: "1 : early(x)",
      source: a.v._id,
      target: b.v._id,
    });
    expect(cells.get(early._id)!.attrs.style).toContain(
      "endArrow=open;endFill=0;",
    );
    expect(cells.get(odd._id)!.attrs.value).toBe("2 : odd");
    expect(cells.get(late._id)!.attrs.style).toContain("dashed=1;");
    expect(cells.get(act._id)!.attrs.parent).toBe(b.v._id);
    expect(cells.get(act._id)!.children[0]!.attrs.x).toBe("43");
    expect(cells.has(hidden._id)).toBe(false);
    expect(cells.get(a.v._id)!.attrs.style).toContain("size=30;");
    expect(cells.get(frag._id)!.attrs.value).toBe("<b>alt</b>");
    expect(cells.get(op1._id)!.attrs).toMatchObject({
      parent: frag._id,
      value: "[ok]",
    });
    expect(cells.get(op1._id)!.attrs.style).toContain("top=0;");
    expect(cells.get(op2._id)!.attrs.value).toBe("");
    expect(cells.get(op2._id)!.attrs.style).not.toContain("top=0;");
  });

  it("leaves numbers out when the diagram hides them", () => {
    const d = diagram("UMLSequenceDiagram");
    d.showSequenceNumber = false;
    const a = node(d, "UMLSeqLifelineView", model("UMLLifeline"), [0, 0, 9, 9]);
    const e = edge(
      d,
      "UMLSeqMessageView",
      model("UMLMessage", { name: "m" }),
      a,
      a,
    );
    expect(write(d).cells.get(e._id)!.attrs.value).toBe("m");
  });
});

describe("toDrawio edges", () => {
  const pair = (d: M, t = "UMLClassView") => [
    node(d, t, cls("A"), [0, 0, 100, 50]),
    node(d, t, cls("B"), [200, 0, 100, 50]),
  ];

  it("keeps StarUML's polyline as constraints and waypoints", () => {
    const d = diagram();
    const [a, b] = pair(d);
    const g = edge(
      d,
      "UMLGeneralizationView",
      model("UMLGeneralization"),
      a!,
      b!,
      [
        [100, 25],
        [150, 25],
        [150, 60],
        [250, 60],
      ],
    );
    const { cells } = write(d);
    const c = cells.get(g._id)!;
    expect(c.attrs.style).toBe(
      "html=1;labelBackgroundColor=default;endArrow=block;endFill=0;endSize=14;strokeColor=#000000;fontColor=#000000;fontFamily=Arial;fontSize=13;exitX=1;exitY=0.5;exitDx=0;exitDy=0;exitPerimeter=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;entryPerimeter=0;",
    );
    expect(
      c.children[0]!.children[0]!.children.map((p) => [p.attrs.x, p.attrs.y]),
    ).toEqual([
      ["150", "25"],
      ["150", "60"],
    ]);
  });

  it("mirrors constraints on flipped shapes and clamps them", () => {
    const d = diagram("UMLDeploymentDiagram");
    const n = node(d, "UMLNodeView", model("UMLNode"), [0, 0, 100, 50]);
    const z = node(d, "UMLNodeView", model("UMLNode"), [300, 0, 0, 0]);
    const p = edge(
      d,
      "UMLCommunicationPathView",
      model("UMLCommunicationPath"),
      n,
      z,
      [
        [80, 70],
        [300, 0],
      ],
    );
    expect(write(d).cells.get(p._id)!.attrs.style).toContain(
      "exitX=0.2;exitY=1;exitDx=0;exitDy=0;exitPerimeter=0;entryX=0.5;entryY=0.5;",
    );
  });

  it("draws association ends, roles and multiplicities", () => {
    const d = diagram();
    const [a, b] = pair(d);
    const assoc = (
      e1: Record<string, unknown>,
      e2: Record<string, unknown>,
      name = "",
    ) =>
      model("UMLAssociation", {
        name,
        end1: model("UMLAssociationEnd", e1),
        end2: model("UMLAssociationEnd", e2),
      });
    const comp = edge(
      d,
      "UMLAssociationView",
      assoc(
        { aggregation: "composite", multiplicity: "1", name: "whole" },
        { navigable: "navigable", multiplicity: "*" },
        "has",
      ),
      a!,
      b!,
    );
    const shared = edge(
      d,
      "UMLAssociationView",
      assoc({ navigable: "navigable" }, { aggregation: "shared" }),
      a!,
      b!,
    );
    const both = edge(
      d,
      "UMLAssociationView",
      assoc({ navigable: "navigable" }, { navigable: "navigable" }),
      a!,
      b!,
    );
    const { cells } = write(d);
    expect(cells.get(comp._id)!.attrs.style).toContain(
      "endArrow=none;startArrow=none;startArrow=diamondThin;startFill=1;startSize=16;endArrow=open;endFill=0;endSize=12;",
    );
    expect(cells.get(comp._id)!.attrs.value).toBe("has");
    expect(cells.get(shared._id)!.attrs.style).toContain(
      "startArrow=open;startFill=0;startSize=12;endArrow=diamondThin;endFill=0;endSize=16;",
    );
    expect(cells.get(both._id)!.attrs.style).toContain(
      "endArrow=none;startArrow=none;strokeColor",
    );
    expect(
      [...cells.values()]
        .filter((c) => c.attrs.parent === comp._id)
        .map((c) => [c.attrs.id, c.attrs.value, c.attrs.connectable]),
    ).toEqual([
      [`${comp._id}#tail-role`, "whole", "0"],
      [`${comp._id}#tail-multiplicity`, "1", "0"],
      [`${comp._id}#head-multiplicity`, "*", "0"],
    ]);
  });

  it("labels flows, transitions, C4 relations and stereotyped edges", () => {
    const d = diagram();
    const [a, b] = pair(d);
    const e = (viewType: string, m: M) => edge(d, viewType, m, a!, b!);
    const views = [
      e("UMLControlFlowView", model("UMLControlFlow", { guard: "x>1" })),
      e("UMLControlFlowView", model("UMLControlFlow", { name: "go" })),
      e(
        "UMLTransitionView",
        model("UMLTransition", {
          triggers: [
            model("UMLEvent", { name: "t1" }),
            model("UMLEvent", { name: "t2" }),
          ],
          guard: "g",
          effects: [model("UMLOpaqueBehavior", { name: "fx" })],
        }),
      ),
      e("UMLTransitionView", model("UMLTransition", { name: "plain" })),
      e(
        "C4RelationshipView",
        model("C4Relationship", { name: "Uses", technology: "HTTPS" }),
      ),
      e("C4RelationshipView", model("C4Relationship", { name: "Reads" })),
      e("UMLIncludeView", model("UMLInclude")),
      e(
        "UMLDependencyView",
        model("UMLDependency", { stereotype: "use", name: "n" }),
      ),
      e("UMLNoteLinkView", null as unknown as M),
      e("UMLDependencyView", model("UMLInformationFlow", { name: "unlisted" })),
    ];
    const { cells } = write(d);
    expect(views.map((v) => cells.get(v._id)!.attrs.value)).toEqual([
      "[x&gt;1]",
      "go",
      "t1, t2 [g] / fx",
      "plain",
      "<b>Uses</b><br>[HTTPS]",
      "<b>Reads</b>",
      "«include»",
      "«use»<br>n",
      "",
      "unlisted",
    ]);
    expect(cells.get(views[8]!._id)!.attrs.style).toMatch(
      /^html=1;labelBackgroundColor=default;dashed=1;endArrow=none;/,
    );
    expect(cells.get(views[9]!._id)!.attrs.style).toMatch(
      /^html=1;labelBackgroundColor=default;endArrow=open;endSize=12;/,
    );
  });

  it("draws ERD cardinalities as crow's feet", () => {
    const d = diagram("ERDDiagram");
    const [a, b] = pair(d, "ERDEntityView");
    const rel = (identifying: boolean, c1: string, c2: string) =>
      edge(
        d,
        "ERDRelationshipView",
        model("ERDRelationship", {
          identifying,
          end1: model("ERDRelationshipEnd", { cardinality: c1 }),
          end2: model("ERDRelationshipEnd", { cardinality: c2 }),
        }),
        a!,
        b!,
      );
    const r1 = rel(true, "1", "0..*");
    const r2 = rel(false, "0..1", "many");
    const { cells } = write(d);
    expect(cells.get(r1._id)!.attrs.style).toContain(
      "startArrow=ERmandOne;endArrow=ERzeroToMany;strokeColor",
    );
    expect(cells.get(r2._id)!.attrs.style).toContain(
      "startArrow=ERzeroToOne;endArrow=none;dashed=1;",
    );
  });

  it("joins edges to edges and skips edges with an end not drawn", () => {
    const d = diagram();
    const [a, b] = pair(d);
    const dep = edge(d, "UMLDependencyView", model("UMLDependency"), a!, b!);
    const note = node(d, "UMLNoteView", null, [0, 100, 50, 30]);
    const link = edge(d, "UMLNoteLinkView", null, note, dep, [
      [25, 100],
      [150, 25],
    ]);
    edge(d, "UMLDependencyView", model("UMLDependency"), a!, null);
    edge(d, "UMLDependencyView", model("UMLDependency"), null, b!);
    const { cells, warnings } = write(d);
    expect(cells.get(link._id)!.attrs.target).toBe(dep._id);
    expect(cells.get(link._id)!.attrs.style).toContain("exitX=0.5;exitY=0;");
    expect(cells.get(link._id)!.attrs.style).not.toContain("entryX");
    expect(warnings).toEqual(["2 UMLDependencyView views are not drawn"]);
  });

  it("takes line style and colours from the profile, else the view", () => {
    const d = diagram();
    const [a, b] = pair(d);
    const curve = edge(
      d,
      "UMLDependencyView",
      model("UMLDependency"),
      a!,
      b!,
      undefined,
      {
        lineStyle: 3,
        lineColor: "",
        fontColor: "",
        font: null,
      },
    );
    const odd = edge(
      d,
      "UMLDependencyView",
      model("UMLDependency"),
      a!,
      b!,
      undefined,
      {
        lineStyle: 9,
      },
    );
    const plain = write(d).cells;
    expect(plain.get(curve._id)!.attrs.style).toBe(
      "html=1;labelBackgroundColor=default;dashed=1;endArrow=open;endSize=12;curved=1;",
    );
    expect(plain.get(odd._id)!.attrs.style).not.toMatch(/curved|rounded/);
    const profile = mergePatch(standard(), {
      visuals: {
        edges: {
          lineStyle: "roundrect",
          lineColor: "#123456",
          fontColor: "#654321",
        },
      },
    }) as Profile;
    expect(write(d, profile).cells.get(odd._id)!.attrs.style).toContain(
      "rounded=1;strokeColor=#123456;fontColor=#654321;",
    );
  });
});

describe("toDrawio file", () => {
  it("sizes the page to the profile, or the diagram when larger", () => {
    const d = diagram("UMLClassDiagram", 'A "quoted" & <odd>');
    node(d, "UMLClassView", cls("A"), [1900.4, 10, 100, 1300]);
    const out = write(d);
    expect(out.text).toContain('name="A &quot;quoted&quot; &amp; &lt;odd&gt;"');
    expect(out.text).toContain('pageWidth="2001" pageHeight="1310"');
    expect(out).toMatchObject({ width: 2001, height: 1310 });
    const empty = write(diagram());
    expect(empty.text).toContain('pageWidth="1600" pageHeight="1200"');
    expect(empty.views).toEqual([]);
  });

  it("escapes attribute text for XML 1.0", () => {
    expect(xmlAttr('a\u0001b\r\nc\td"<>&')).toBe(
      "ab&#xa;c&#x9;d&quot;&lt;&gt;&amp;",
    );
  });

  it("is deterministic and valid for any class diagram", () => {
    const name = fc.string({ maxLength: 12 });
    const box = fc.tuple(
      fc.integer({ min: 0, max: 2000 }),
      fc.integer({ min: 0, max: 2000 }),
      fc.integer({ min: 1, max: 400 }),
      fc.integer({ min: 1, max: 400 }),
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ name, box, members: fc.array(name, { maxLength: 3 }) }),
          {
            minLength: 1,
            maxLength: 6,
          },
        ),
        fc.array(
          fc.tuple(
            fc.nat(),
            fc.nat(),
            fc.constantFrom(
              "UMLGeneralization",
              "UMLDependency",
              "UMLAssociation",
            ),
          ),
          {
            maxLength: 6,
          },
        ),
        (classes, links) => {
          installMockApp();
          const d = diagram();
          const views = classes.map((c) =>
            node(
              d,
              "UMLClassView",
              cls(c.name, {
                attributes: c.members.map((m) =>
                  model("UMLAttribute", { name: m }),
                ),
              }),
              c.box as Box,
            ),
          );
          for (const [i, j, t] of links) {
            const m =
              t === "UMLAssociation"
                ? model(t, {
                    end1: model("UMLAssociationEnd"),
                    end2: model("UMLAssociationEnd"),
                  })
                : model(t);
            edge(
              d,
              `${t}View`,
              m,
              views[i % views.length]!,
              views[j % views.length]!,
              [
                [0, 0],
                [5, 5],
              ],
            );
          }
          const first = toDrawio(d as never, standard());
          const second = toDrawio(d as never, standard());
          expect(second.text).toBe(first.text);
          expect(drawioProblems(first.text)).toEqual([]);
          expect(first.views).toHaveLength(classes.length + links.length);
        },
      ),
      { numRuns: 60 },
    );
  });
});
