/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/**
 * Error codes are part of the HTTP contract: clients branch on `code`, while
 * `error` is prose for humans and may change. Each code maps to one status.
 */
export const ERROR_STATUS = {
  /** The body does not match the endpoint's request schema. */
  INVALID_ARGUMENT: 400,
  INVALID_JSON: 400,
  BODY_READ_FAILED: 400,
  /** A type name that is not in the metamodel or has no factory function. */
  UNKNOWN_TYPE: 400,
  /** A bearer token is configured and the request lacks it or has another. */
  UNAUTHORIZED: 401,
  /** The request carries an Origin header not in mcp-ext.security.allowedOrigins. */
  FORBIDDEN_ORIGIN: 403,
  /**
   * The project's style profile is strict and the call would draw freely
   * (a colour, a font, a position, a size) outside the profile; pass
   * override: true to do it anyway (issue #31).
   */
  STYLE_LOCKED: 403,
  /**
   * The style profile is strict and the call would make a diagram that
   * declares no viewpoint (issue #42); pass viewpoint, or draw it through
   * /request_diagram or /derive_diagrams.
   */
  VIEWPOINT_REQUIRED: 403,
  /** An id that names no element, or an element of the wrong kind. */
  NOT_FOUND: 404,
  UNKNOWN_ENDPOINT: 404,
  METHOD_NOT_ALLOWED: 405,
  /** Body over mcp-ext.limits.maxBodyKiB, or a batch over mcp-ext.limits.maxBatchOps. */
  PAYLOAD_TOO_LARGE: 413,
  /** A POST without Content-Type: application/json. */
  UNSUPPORTED_MEDIA_TYPE: 415,
  /** The operation needs an open project, or a saved one. */
  NO_PROJECT: 409,
  /**
   * A path or name that fits several elements; details.candidates lists
   * each one's _id, _type and path.
   */
  AMBIGUOUS_REF: 409,
  /**
   * A new element named like a sibling of its kind, with allowDuplicateNames
   * unset; details.existing is that sibling.
   */
  DUPLICATE_NAME: 409,
  /**
   * /restore_snapshot or /diff_since on a snapshot the undo history no
   * longer reaches, or one taken of another project.
   */
  SNAPSHOT_STALE: 409,
  /**
   * The style profile sets blockSaveOnErrors and /uml_lint or /model_lint
   * report errors; details.findings lists them. Pass override: true to save
   * or export anyway.
   */
  SAVE_BLOCKED: 409,
  /**
   * The view asked for does not fit (issue #42): the intent names a
   * viewpoint not drawn for this scope or not written for this audience,
   * the scope holds nothing to show, or the content is past the
   * viewpoint's limits. details.alternatives lists the views that fit.
   */
  VIEWPOINT_MISMATCH: 422,
  /** StarUML refused the operation, e.g. a factory precondition failed. */
  STARUML_ERROR: 422,
  /**
   * Well-formed diagram text using a construct /build_diagram does not
   * translate, e.g. a PlantUML timing diagram or a SQL CREATE VIEW; the
   * message names it and its line.
   */
  UNSUPPORTED_SYNTAX: 422,
  /**
   * The command would open a modal or native dialog and wait for someone at
   * StarUML; it was refused, or stopped where the dialog would have opened.
   */
  DIALOG_REQUIRED: 422,
  /** Over mcp-ext.limits.commandsPerMinute; Retry-After says when to retry. */
  RATE_LIMITED: 429,
  /** A defect in this extension; details are in StarUML's developer console. */
  INTERNAL: 500,
  /** No answer within mcp-ext.limits.timeoutSeconds; the call may still complete. */
  TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export interface ErrorBody {
  success: false;
  code: ErrorCode;
  error: string;
  details?: unknown;
}

/** Thrown by handlers and lookups; the endpoint wrapper turns it into an ErrorBody. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ErrorBody {
    return {
      success: false,
      code: this.code,
      error: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs a call into StarUML and reports what it throws as STARUML_ERROR, so a
 * refused operation is not mistaken for a defect here. Factory preconditions
 * throw plain strings such as "Invalid connection (UMLGeneralization)"
 * (Factory.assert in engine/factory.js, 7.1.1). An ApiError raised by our own
 * initializer callbacks passes through unchanged.
 */
export function inStarUML<T>(call: () => T): T {
  try {
    return call();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("STARUML_ERROR", errorMessage(err));
  }
}
