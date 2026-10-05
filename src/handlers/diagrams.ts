import { failure } from "../errors.js";
import type { Handler } from "../http-server.js";
import type { Element } from "../types.js";

export const createDiagram: Handler = (body) => {
  const typeName = body.type;
  const parentId = body.parentId;
  const name = typeof body.name === "string" ? body.name : undefined;

  if (typeof typeName !== "string" || typeName.length === 0) {
    return {
      success: false,
      error:
        "Required field 'type' (string) missing. Example: 'UMLClassDiagram', 'UMLUseCaseDiagram', 'UMLSequenceDiagram', 'UMLActivityDiagram', 'ERDDiagram'",
    };
  }
  if (typeof parentId !== "string" || parentId.length === 0) {
    return {
      success: false,
      error: "Required field 'parentId' (string) missing",
    };
  }

  const parent = app.repository.get(parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${parentId}` };
  }

  try {
    const diagram = app.factory.createDiagram({
      id: typeName,
      parent,
      ...(name !== undefined && {
        diagramInitializer: (d: Element) => {
          d.name = name;
        },
      }),
    });
    if (!diagram) {
      return { success: false, error: `Unknown diagram type: ${typeName}` };
    }
    return {
      success: true,
      data: {
        _id: diagram._id,
        name: diagram.name,
        type: diagram.constructor.name,
      },
    };
  } catch (err) {
    return failure(err);
  }
};

/** Resolves `body.id` to a diagram; setCurrentDiagram accepts any element and would break the editor. */
function requireDiagram(body: Record<string, unknown>): Element | string {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return "Required field 'id' (diagram id) missing";
  }
  const diagram = app.repository.get(id);
  if (!diagram || !(diagram instanceof type.Diagram)) {
    return `Diagram not found: ${id}`;
  }
  return diagram;
}

export const switchDiagram: Handler = (body) => {
  const diagram = requireDiagram(body);
  if (typeof diagram === "string") return { success: false, error: diagram };
  try {
    app.diagrams.setCurrentDiagram(diagram);
    return { success: true, data: { _id: diagram._id } };
  } catch (err) {
    return failure(err);
  }
};

export const closeDiagramById: Handler = (body) => {
  const diagram = requireDiagram(body);
  if (typeof diagram === "string") return { success: false, error: diagram };
  try {
    app.diagrams.closeDiagram(diagram);
    return { success: true, data: { closed: diagram._id } };
  } catch (err) {
    return failure(err);
  }
};
