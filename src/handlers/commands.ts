import { errorMessage, failure } from "../errors.js";
import type { Handler } from "../http-server.js";

/**
 * `commands` holds every registered command; `commandNames` only those
 * registered with a display name (engine/command-manager.js), so it undercounts.
 */
function commandIds(): string[] {
  return Object.keys(app.commands.commands);
}

export const getAllCommands: Handler = () => {
  const ids = commandIds().sort();
  return { success: true, data: { count: ids.length, ids } };
};

export const executeCommand: Handler = async (body) => {
  const id = body.id;
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Required field 'id' (string) missing" };
  }
  const args: unknown[] = Array.isArray(body.args) ? body.args : [];

  // execute() returns false for an unknown id, which is indistinguishable from a
  // command that legitimately returns false, so check registration first.
  if (!Object.hasOwn(app.commands.commands, id)) {
    return { success: false, error: `Command not registered: ${id}` };
  }

  try {
    const result: unknown = await app.commands.execute(id, ...args);
    return { success: true, data: { id, result: toJson(result) } };
  } catch (err) {
    return failure(`Command ${id} threw: ${errorMessage(err)}`);
  }
};

/** Command results may be model elements with cyclic references or functions. */
function toJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "[non-serializable]";
  }
}
