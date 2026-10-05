import { afterAll, beforeAll, expect, it } from "vitest";
import { call, describeLive } from "./support.js";
import { decodePng, inkIn } from "./png.js";

// Issue #35: package, component and deployment diagrams, mind maps laid out
// sideways, and terse answers, against StarUML 7.1.1.

interface Built {
  diagram: { _id: string };
  kind: string;
  created: number;
  layout: string;
  preset?: string;
  ids?: Record<string, { model: string | null; view: string }>;
  edges?: { key: string; model: string | null; view: string }[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function built(body: Record<string, unknown>): Promise<Built> {
  const res = await call<Built>("/build_diagram", body);
  expect(res.success, JSON.stringify(res).slice(0, 800)).toBe(true);
  return res.data;
}

async function element<T>(ref: string, fields: string[]): Promise<T> {
  const res = await call<T>("/get_element_by_id", { ref, fields });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data;
}

const GEOMETRY = ["left", "top", "width", "height"];

async function plantuml(diagram: string): Promise<string> {
  const res = await call<{ text: string; warnings: string[] }>("/export_text", {
    diagram,
    format: "plantuml",
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  expect(res.data.warnings).toEqual([]);
  return res.data.text;
}

describeLive("issue #35 structural kinds", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it("builds a package diagram with nesting and stereotyped dependencies", async () => {
    const data = await built({
      kind: "package",
      name: "Layers",
      spec: {
        packages: [
          "Web",
          "Domain",
          { name: "Model", parent: "Domain" },
          "Persistence",
        ],
        dependencies: [
          { from: "Web", to: "Model", type: "use" },
          { from: "Persistence", to: "Model", type: "import" },
        ],
      },
    });
    const model = await element<{ _parent: string }>(data.ids!.Model!.model!, [
      "_parent",
    ]);
    expect(model._parent).toBe(data.ids!.Domain!.model);
    const inner = await element<Box & { containerView: { $ref: string } }>(
      data.ids!.Model!.view,
      [...GEOMETRY, "containerView"],
    );
    expect(inner.containerView.$ref).toBe(data.ids!.Domain!.view);
    expect(await plantuml(data.diagram._id)).toBe(
      [
        "@startuml",
        "title Layers",
        'package "Web" as P0',
        'package "Domain" as P1 {',
        '  package "Model" as P2',
        "}",
        'package "Persistence" as P3',
        "P0 ..> P2 : <<use>>",
        "P3 ..> P2 : <<import>>",
        "@enduml",
        "",
      ].join("\n"),
    );
  });

  it("builds a component diagram with interfaces, ports and a connector", async () => {
    const data = await built({
      kind: "component",
      name: "Transport",
      spec: {
        components: [
          {
            name: "Mqtt",
            ports: ["rpc"],
            provides: ["TransportService"],
            requires: ["DeviceAuth"],
          },
          { name: "RuleEngine", ports: ["in"] },
        ],
        connectors: [{ from: "Mqtt.rpc", to: "RuleEngine.in" }],
      },
    });
    expect(data.layout).toBe("placed");
    const port = await element<Box & { containerView: { $ref: string } }>(
      data.ids!["Mqtt.rpc"]!.view,
      [...GEOMETRY, "containerView"],
    );
    const host = await element<Box>(data.ids!.Mqtt!.view, GEOMETRY);
    expect(port.containerView.$ref).toBe(data.ids!.Mqtt!.view);
    // On the host's right border.
    expect(port.left).toBeLessThan(host.left + host.width);
    expect(port.left + port.width).toBeGreaterThan(host.left + host.width);
    const text = await plantuml(data.diagram._id);
    expect(text).toContain('component "Mqtt" as C0 {\n  port "rpc" as C0_0\n}');
    expect(text).toContain("C0 - C2");
    expect(text).toContain("C0 ..> C3 : use");
    expect(text).toContain("C0_0 -- C1_0");
  });

  it("builds a deployment diagram with deploy, manifest and labelled paths", async () => {
    const data = await built({
      kind: "deployment",
      name: "Cluster",
      spec: {
        nodes: [
          { name: "k8s", stereotype: "executionEnvironment" },
          { name: "tb-node", parent: "k8s", deploys: ["tb.jar"] },
          "Postgres",
        ],
        artifacts: [{ name: "tb.jar", manifests: ["Core"] }],
        components: ["Core"],
        paths: [{ from: "tb-node", to: "Postgres", name: "JDBC" }],
      },
    });
    const path = data.edges!.find((e) => e.key === "tb-node -> Postgres")!;
    const model = await element<{ name: string; end1: { $ref: string } }>(
      path.model!,
      ["name", "end1"],
    );
    // The label is the path's own name, not an end's role ("+JDBC").
    expect(model.name).toBe("JDBC");
    const end = await element<{ name: string }>(model.end1.$ref, ["name"]);
    expect(end.name).toBe("");
    const text = await plantuml(data.diagram._id);
    expect(text).toContain("D3 ..> D1 : <<deploy>>");
    expect(text).toContain("D3 ..> D4 : <<manifest>>");
    expect(text).toContain("D1 -- D2 : JDBC");
  });

  it("lays a mind map out sideways from its root", async () => {
    const children = Array.from({ length: 14 }, (_, i) => ({
      name: `Topic ${i + 1}`,
      children: [{ name: `Detail ${i + 1}` }],
    }));
    const data = await built({
      kind: "mindmap",
      name: "Map",
      result: "terse",
      spec: { root: { name: "ThingsBoard", children } },
    });
    expect(data.preset).toBe("flow-right");
    expect(data.ids).toBeUndefined();
    const image = await call<{ base64: string; width: number; height: number }>(
      "/export_diagram",
      { diagram: data.diagram._id, background: "#ffffff" },
    );
    // A row of 28 nodes would be over 3000 px wide; a tree two levels deep
    // grows down instead.
    expect(image.data.width).toBeLessThan(image.data.height);
    const pixels = decodePng(Buffer.from(image.data.base64, "base64"));
    expect(
      inkIn(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height }),
    ).toBeGreaterThan(1000);
  });

  it("answers tersely unless asked, from build_diagram and batch", async () => {
    const terse = await call<Built>("/build_diagram", {
      kind: "class",
      result: "terse",
      spec: { classes: ["A", "B"].map((name) => ({ name })) },
    });
    expect(terse.data.ids).toBeUndefined();
    expect(terse.data.edges).toBeUndefined();
    expect(terse.data.created).toBe(2);
    const batch = await call<{
      results: { success: boolean; id?: string; data?: unknown }[];
    }>("/batch", {
      result: "terse",
      ops: [
        {
          path: "/create_element",
          body: { type: "UMLModel", parent: "@project", name: "Loose" },
        },
      ],
    });
    expect(batch.data.results[0]!.data).toBeUndefined();
    const created = await element<{ name: string }>(
      batch.data.results[0]!.id!,
      ["name"],
    );
    expect(created.name).toBe("Loose");
  });
});
