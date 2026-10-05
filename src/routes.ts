import type { Handler } from "./http-server.js";
import { executeCommand, getAllCommands } from "./handlers/commands.js";
import { debug } from "./handlers/debug.js";
import {
  closeDiagramById,
  createDiagram,
  switchDiagram,
} from "./handlers/diagrams.js";
import {
  createEdgeWithView,
  createElement,
  createElementWithView,
  deleteElement,
  findElements,
  getElementById,
  updateElement,
} from "./handlers/elements.js";
import {
  getProjectInfo,
  newProject,
  openProject,
  saveProject,
  saveProjectAs,
} from "./handlers/project.js";

/** Endpoint paths are part of the contract with the staruml-mcp server; do not rename. */
export const routes: Readonly<Record<string, Handler>> = {
  "/get_all_commands": getAllCommands,
  "/execute_command": executeCommand,

  "/get_project_info": getProjectInfo,
  "/save_project": saveProject,
  "/save_project_as": saveProjectAs,
  "/new_project": newProject,
  "/open_project": openProject,

  "/get_element_by_id": getElementById,
  "/find_elements": findElements,
  "/create_element": createElement,
  "/update_element": updateElement,
  "/delete_element": deleteElement,
  "/create_element_with_view": createElementWithView,
  "/create_edge_with_view": createEdgeWithView,

  "/create_diagram": createDiagram,
  "/switch_diagram": switchDiagram,
  "/close_diagram": closeDiagramById,

  "/debug": debug,
};
