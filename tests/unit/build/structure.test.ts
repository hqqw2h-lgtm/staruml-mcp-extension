import { describe, expect, it } from "vitest";
import { place } from "../../../src/build/place.js";
import { planFor } from "../../../src/build/spec.js";
import { ApiError } from "../../../src/errors.js";

const refused = (kind: Parameters<typeof planFor>[0], spec: unknown) => {
  try {
    planFor(kind, spec);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).message;
  }
  throw new Error("expected a refusal");
};

describe("package diagrams", () => {
  it("nests packages owner first and stereotypes their dependencies", () => {
    const plan = planFor("package", {
      packages: [
        { name: "Inner", parent: "Outer", documentation: "d" },
        { name: "Outer", stereotype: "layer" },
        "Lone",
      ],
      dependencies: [
        { from: "Inner", to: "Lone", type: "import" },
        { from: "Lone", to: "Outer", name: "uses" },
      ],
    });
    expect(plan.nodes.map((n) => [n.key, n.owner, n.container])).toEqual([
      ["Outer", undefined, undefined],
      ["Inner", "Outer", "Outer"],
      ["Lone", undefined, undefined],
    ]);
    expect(plan.nodes[0]!.properties).toEqual({ stereotype: "layer" });
    expect(plan.nodes[1]!.properties).toEqual({ documentation: "d" });
    expect(plan.nodes[2]!.properties).toBeUndefined();
    expect(plan.edges).toEqual([
      {
        type: "UMLDependency",
        from: "Inner",
        to: "Lone",
        properties: { stereotype: "import" },
      },
      { type: "UMLDependency", from: "Lone", to: "Outer", name: "uses" },
    ]);
    expect(plan.fixed).toBe(true);
    expect(planFor("package", { packages: ["A"] }).fixed).toBe(false);
    expect(planFor("package", {}).nodes).toEqual([]);
  });

  it("refuses an undeclared parent and a nesting loop", () => {
    expect(refused("package", { packages: [{ name: "A", parent: "B" }] })).toBe(
      "spec.packages.0.parent: no package named B; declare it in spec.packages",
    );
    expect(
      refused("package", {
        packages: [
          { name: "A", parent: "B" },
          { name: "B", parent: "A" },
        ],
      }),
    ).toBe("spec.packages.0.parent: A would be nested in itself");
  });
});

describe("component diagrams", () => {
  it("makes interfaces named in provides and requires, and ports on their component", () => {
    const plan = planFor("component", {
      components: [
        { name: "A", ports: ["p", "q"], provides: ["IA"], requires: ["IB"] },
        { name: "B", ports: ["r"], stereotype: "service" },
        "C",
      ],
      interfaces: [{ name: "IA", operations: ["run(): void"] }, "IB"],
      connectors: [{ from: "A.q", to: "B.r", name: "wire" }],
      dependencies: [{ from: "C", to: "A" }],
    });
    expect(plan.nodes.map((n) => [n.key, n.type, n.host])).toEqual([
      ["A", "UMLComponent", undefined],
      ["B", "UMLComponent", undefined],
      ["C", "UMLComponent", undefined],
      ["IA", "UMLInterface", undefined],
      ["IB", "UMLInterface", undefined],
      ["A.p", "UMLPort", "A"],
      ["A.q", "UMLPort", "A"],
      ["B.r", "UMLPort", "B"],
    ]);
    expect(plan.nodes[3]!.operations).toEqual([
      { name: "run", returnType: "void" },
    ]);
    expect(plan.nodes[4]!.operations).toBeUndefined();
    expect(plan.edges.map((e) => [e.type, e.from, e.to, e.name])).toEqual([
      ["UMLInterfaceRealization", "A", "IA", undefined],
      ["UMLDependency", "A", "IB", undefined],
      ["UMLConnector", "A.q", "B.r", "wire"],
      ["UMLDependency", "C", "A", undefined],
    ]);
    expect(plan.fixed).toBe(true);
    // Ports sit on their component's right border, one under the other.
    const boxes = place(plan, "TB");
    const a = boxes.get("A")!;
    expect(boxes.get("A.p")).toEqual({
      x: a.x + a.width - 10,
      y: a.y + 10,
      width: 20,
      height: 20,
    });
    expect(boxes.get("A.q")!.y).toBe(a.y + 40);
    expect(planFor("component", { components: ["X"] }).fixed).toBe(false);
  });

  it("refuses a connector end that is not a port", () => {
    expect(
      refused("component", {
        components: [{ name: "A", ports: ["p"] }, "B"],
        connectors: [{ from: "A.p", to: "B" }],
      }),
    ).toBe(
      "spec.connectors.0: B is not a port; connectors join ports, written 'Component.port'",
    );
  });
});

describe("deployment diagrams", () => {
  it("nests nodes and deploys and manifests artifacts", () => {
    const plan = planFor("deployment", {
      nodes: [
        { name: "Pod", parent: "Cluster", deploys: ["app.jar"] },
        { name: "Cluster", stereotype: "executionEnvironment" },
        "Db",
      ],
      artifacts: [
        { name: "app.jar", stereotype: "jar", manifests: ["Svc"] },
        "x.sql",
      ],
      components: ["Svc"],
      paths: [
        { from: "Pod", to: "Db", name: "JDBC" },
        { from: "Pod", to: "Cluster" },
      ],
    });
    expect(plan.nodes.map((n) => [n.key, n.type, n.container])).toEqual([
      ["Cluster", "UMLNode", undefined],
      ["Pod", "UMLNode", "Cluster"],
      ["Db", "UMLNode", undefined],
      ["app.jar", "UMLArtifact", undefined],
      ["x.sql", "UMLArtifact", undefined],
      ["Svc", "UMLComponent", undefined],
    ]);
    expect(plan.nodes[0]!.properties).toEqual({
      stereotype: "executionEnvironment",
    });
    expect(plan.nodes[3]!.properties).toEqual({ stereotype: "jar" });
    expect(plan.edges.map((e) => [e.type, e.from, e.to, e.name])).toEqual([
      ["UMLDeployment", "app.jar", "Pod", undefined],
      ["UMLDependency", "app.jar", "Svc", undefined],
      ["UMLCommunicationPath", "Pod", "Db", "JDBC"],
      ["UMLCommunicationPath", "Pod", "Cluster", undefined],
    ]);
    expect(plan.edges[1]!.properties).toEqual({ stereotype: "manifest" });
    expect(plan.fixed).toBe(true);
    expect(planFor("deployment", { nodes: ["N"] }).fixed).toBe(false);
  });

  it("refuses an undeclared parent node", () => {
    expect(refused("deployment", { nodes: [{ name: "A", parent: "B" }] })).toBe(
      "spec.nodes.0.parent: no node named B; declare it in spec.nodes",
    );
  });
});
