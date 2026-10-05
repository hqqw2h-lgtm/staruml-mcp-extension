import { describe, expect, it } from "vitest";
import { parsePlantUml } from "../../../src/build/plantuml.js";
import { ApiError } from "../../../src/errors.js";

const puml = (body: string) => `@startuml\n${body}\n@enduml`;

const refused = (source: string) => {
  try {
    parsePlantUml(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return `${(err as ApiError).code} ${(err as ApiError).message}`;
  }
  throw new Error("expected a refusal");
};

describe("PlantUML package, component and deployment diagrams (issue #25)", () => {
  it("reads nested packages and their stereotyped and named dependencies", () => {
    expect(
      parsePlantUml(
        puml(
          [
            'package "Domain" as D <<layer>> {',
            "  package Model #ccc",
            "}",
            'package Web as "Web tier"',
            "Web ..> Model : <<import>>",
            "Web ..> D : <<use>> calls",
            "D ..> Web",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      kind: "package",
      spec: {
        packages: [
          { name: "Domain", stereotype: "layer" },
          { name: "Model", parent: "Domain" },
          { name: "Web tier" },
        ],
        dependencies: [
          { from: "Web tier", to: "Model", type: "import" },
          { from: "Web tier", to: "Domain", type: "use", name: "calls" },
          { from: "Domain", to: "Web tier" },
        ],
      },
    });
  });

  it("reads components, shorthands, ports, lollipops, sockets, connectors and dependencies", () => {
    expect(
      parsePlantUml(
        puml(
          [
            "component Api <<service>> {",
            "  portin http",
            "  portout db",
            "}",
            "[Store] as S <<db>>",
            "[Queue]",
            "() Auth",
            "interface Billing",
            "component Worker {",
            "  port q",
            "}",
            "Api - Billing",
            "Api ..> Auth",
            "Api.db -- Worker.q",
            "db -- q : queue",
            "[Store] --> [Cache] : reads",
            "Worker ..> Api",
          ].join("\n"),
        ),
      ).spec,
    ).toEqual({
      components: [
        {
          name: "Api",
          stereotype: "service",
          ports: ["http", "db"],
          provides: ["Billing"],
          requires: ["Auth"],
        },
        { name: "Store", stereotype: "db" },
        { name: "Queue" },
        { name: "Worker", ports: ["q"] },
        { name: "Cache" },
      ],
      interfaces: ["Auth", "Billing"],
      connectors: [
        { from: "Api.db", to: "Worker.q" },
        { from: "Api.db", to: "Worker.q", name: "queue" },
      ],
      dependencies: [
        { from: "Store", to: "Cache", name: "reads" },
        { from: "Worker", to: "Api" },
      ],
    });
  });

  it("reads nodes, artifacts, deployments, manifestations and paths, and leaves out other arrows", () => {
    const parsed = parsePlantUml(
      puml(
        [
          "node Cluster <<executionEnvironment>> {",
          '  node "app node" as N1',
          "}",
          "node DB <<device>>",
          "artifact app.jar",
          "artifact lib.jar",
          "component Core",
          "app.jar ..> N1 : <<deploy>>",
          "app.jar ..> Core : <<manifest>>",
          "N1 -- DB : JDBC",
          "N1 -- Cluster",
          "lib.jar --> Core",
        ].join("\n"),
      ),
    );
    expect(parsed).toEqual({
      kind: "deployment",
      spec: {
        nodes: [
          { name: "Cluster", stereotype: "executionEnvironment" },
          { name: "app node", parent: "Cluster", deploys: ["app.jar"] },
          { name: "DB", stereotype: "device" },
        ],
        artifacts: [
          { name: "app.jar", manifests: ["Core"] },
          { name: "lib.jar" },
        ],
        components: ["Core"],
        paths: [
          { from: "app node", to: "DB", name: "JDBC" },
          { from: "app node", to: "Cluster" },
        ],
      },
      warnings: [
        "line 13: lib.jar --> Core is not a deployment, manifestation or communication path; left out",
      ],
    });
  });

  it("refuses what it cannot read", () => {
    expect(refused(puml("package P\n}"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: a } closes nothing",
    );
    expect(refused(puml("package P\nP ..> Q"))).toBe(
      "INVALID_ARGUMENT plantuml line 3: Q is not declared",
    );
    expect(refused(puml("node N\nwhat is this"))).toBe(
      'INVALID_ARGUMENT plantuml line 3: cannot read "what is this"',
    );
    expect(refused(puml('package ""'))).toBe(
      "INVALID_ARGUMENT plantuml line 2: package needs a name",
    );
  });
});
