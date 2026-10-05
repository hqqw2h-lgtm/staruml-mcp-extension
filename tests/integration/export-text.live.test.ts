import { afterAll, beforeAll, expect, it } from "vitest";
import cases from "../fixtures/build/cases.json";
import { call, describeLive } from "./support.js";

interface Built {
  diagram: { _id: string };
  kind: string;
}

interface Exported {
  kind: string;
  text: string;
  warnings: string[];
}

/** /describe_diagram's node and edge lines, sorted: what the diagram shows. */
async function shown(diagramId: string): Promise<string[]> {
  const res = await call<{ text: string }>("/describe_diagram", {
    diagramId,
    maxChars: 200_000,
  });
  return res.data.text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .sort();
}

// Issue #15: every build case exported as Mermaid and PlantUML by StarUML
// 7.1.1, and the Mermaid built again into the same nodes, members and edges.
describeLive("/export_text", () => {
  beforeAll(async () => {
    await call("/new_project");
  });

  afterAll(async () => {
    await call("/new_project");
  });

  it.each(Object.entries(cases))(
    "%s round-trips through Mermaid",
    async (_label, body) => {
      const built = await call<Built>(
        "/build_diagram",
        body as Record<string, unknown>,
      );
      expect(built.success, JSON.stringify(built)).toBe(true);
      const id = built.data.diagram._id;
      if (_label.startsWith("f-")) {
        // Issue #25: the families' text is their spec, built again the same.
        const refused = await call("/export_text", {
          diagram: id,
          format: "plantuml",
        });
        expect(refused.code).toBe("INVALID_ARGUMENT");
        const spec = await call<Exported>("/export_text", {
          diagram: id,
          format: "spec",
        });
        expect(spec.data.warnings).toEqual([]);
        const again = await call<Built>("/build_diagram", {
          kind: spec.data.kind,
          spec: JSON.parse(spec.data.text) as Record<string, unknown>,
          name: (body as { name: string }).name,
          allowDuplicateNames: true,
          reuse: false,
        });
        expect(again.success, spec.data.text).toBe(true);
        expect(await shown(again.data.diagram._id)).toEqual(await shown(id));
        return;
      }
      if (["package", "component", "deployment"].includes(built.data.kind)) {
        // Mermaid has no such diagram; PlantUML writes them (issue #35).
        const refused = await call("/export_text", {
          diagram: id,
          format: "mermaid",
        });
        expect(refused.code).toBe("INVALID_ARGUMENT");
        const plantuml = await call<Exported>("/export_text", {
          diagram: id,
          format: "plantuml",
        });
        expect(plantuml.data.warnings).toEqual([]);
        expect(plantuml.data.text).toMatch(/^@startuml\n[\s\S]+\n@enduml\n$/);
        // Read back as PlantUML (issue #25), the same diagram again.
        const again = await call<Built>("/build_diagram", {
          text: plantuml.data.text,
          allowDuplicateNames: true,
          reuse: false,
        });
        expect(again.success, plantuml.data.text).toBe(true);
        expect(again.data.kind).toBe(built.data.kind);
        expect(await shown(again.data.diagram._id)).toEqual(await shown(id));
        return;
      }
      const mermaid = await call<Exported>("/export_text", {
        diagramId: id,
        format: "mermaid",
      });
      expect(mermaid.success, JSON.stringify(mermaid)).toBe(true);
      expect(mermaid.data.kind).toBe(built.data.kind);
      const plantuml = await call<Exported>("/export_text", {
        diagramId: id,
        format: "plantuml",
      });
      expect(plantuml.data.text).toMatch(
        /^@start(uml|mindmap)\n[\s\S]+\n@end(uml|mindmap)\n$/,
      );
      const again = await call<Built>("/build_diagram", {
        mermaid: mermaid.data.text,
        kind: mermaid.data.kind,
      });
      expect(again.success, mermaid.data.text).toBe(true);
      expect(await shown(again.data.diagram._id)).toEqual(await shown(id));
    },
  );

  it("writes message kinds and association ends as StarUML stores them", async () => {
    const seq = await call<Built>("/build_diagram", {
      kind: "sequence",
      spec: {
        messages: [
          { from: "A", to: "B", text: "go", kind: "async" },
          { from: "B", to: "A", text: "back", kind: "reply" },
        ],
      },
    });
    const text = await call<Exported>("/export_text", {
      diagramId: seq.data.diagram._id,
      format: "mermaid",
    });
    expect(text.data.text).toContain("A-)B: go\n  B-->>A: back");
    const cls = await call<Built>("/build_diagram", {
      kind: "class",
      spec: {
        classes: [{ name: "Whole" }, { name: "Part" }, { name: "Other" }],
        relations: [
          { from: "Whole", to: "Part", type: "composition" },
          { from: "Part", to: "Other", type: "directed" },
        ],
      },
    });
    const out = await call<Exported>("/export_text", {
      diagramId: cls.data.diagram._id,
      format: "plantuml",
    });
    expect(out.data.text).toContain("C0 *-- C1");
    expect(out.data.text).toContain("C1 --> C2");
  });

  it("refuses a diagram kind without a text form", async () => {
    const project = await call<{ project: { _id: string } }>(
      "/get_project_info",
    );
    const d = await call<{ _id: string }>("/create_diagram", {
      type: "UMLComponentDiagram",
      parentId: project.data.project._id,
    });
    const res = await call("/export_text", {
      diagramId: d.data._id,
      format: "mermaid",
    });
    expect(res).toMatchObject({ success: false, code: "INVALID_ARGUMENT" });
  });
});
