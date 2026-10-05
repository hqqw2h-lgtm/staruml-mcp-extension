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

import { ApiError } from "../errors.js";
import type { Parsed } from "./mermaid.js";
import type { ColumnSpec, Kind } from "./spec.js";

/*
 * JSON Schema (draft-07 and 2020-12 keywords) into a class diagram or an
 * ERD. Every object schema, the root (named by its title) and each entry
 * of $defs or definitions, is a class or entity; its properties are
 * attributes or columns with their JSON types (format where given, items
 * of arrays); a $ref to another definition is an association, or a
 * foreign key column and relationship; an inline object schema is a class
 * or entity of its own, named after its owner and property; allOf with one
 * $ref is a generalization. A string enum definition is an enumeration.
 * Nullable types (["string", "null"], or anyOf with {"type": "null"}) are
 * optional. Other anyOf, oneOf and not schemas, references outside the
 * document and dynamic references are refused as UNSUPPORTED_SYNTAX.
 */

type Schema = Record<string, unknown>;

const fail = (
  pointer: string,
  message: string,
  code: "INVALID_ARGUMENT" | "UNSUPPORTED_SYNTAX" = "INVALID_ARGUMENT",
): never => {
  throw new ApiError(code, `json schema ${pointer || "#"}: ${message}`);
};

const isObject = (v: unknown): v is Schema =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Pascal case for names made from property names: "line_items" is LineItems. */
const pascal = (s: string) =>
  s.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c: string) =>
    c.toUpperCase(),
  );

/** A property's type: a scalar, a reference, or an inline object, maybe many. */
interface Shape {
  scalar?: string;
  ref?: string;
  inline?: Schema;
  many: boolean;
  nullable: boolean;
}

const SQL_TYPES: Record<string, string> = {
  string: "varchar",
  integer: "integer",
  number: "numeric",
  boolean: "boolean",
  "date-time": "timestamp",
  date: "date",
  time: "time",
  uuid: "uuid",
};

export function parseJsonSchema(source: string, as?: Kind): Parsed {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch (err) {
    return fail("", `not JSON: ${(err as Error).message}`);
  }
  if (!isObject(root)) return fail("", "a schema is a JSON object");
  if (as !== undefined && as !== "class" && as !== "erd") {
    fail(
      "",
      `JSON Schema is read as a class diagram or an ERD, not ${as}`,
      "UNSUPPORTED_SYNTAX",
    );
  }
  const kind = as === "erd" ? "erd" : "class";
  const defs = (root.$defs ?? root.definitions ?? {}) as Record<
    string,
    unknown
  >;
  const defsKey = root.$defs ? "$defs" : "definitions";
  const named = new Map<string, Schema>();
  const pointers = new Map<Schema, string>();
  const rootName =
    typeof root.title === "string" && root.title ? root.title : "Root";
  if (root.properties || root.allOf) {
    named.set(rootName, root);
    pointers.set(root, "#");
  }
  for (const [name, schema] of Object.entries(defs)) {
    if (!isObject(schema)) {
      return fail(`#/${defsKey}/${name}`, "is not a schema");
    }
    named.set(name, schema);
    pointers.set(schema, `#/${defsKey}/${name}`);
  }
  if (named.size === 0)
    fail("", "no object schema: give the root properties, or $defs");
  const target = (ref: string, pointer: string): string => {
    const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
    if (ref === "#") return rootName;
    if (!m) {
      return fail(
        pointer,
        `$ref ${ref} points outside this document's definitions`,
        "UNSUPPORTED_SYNTAX",
      );
    }
    const name = decodeURIComponent(
      m[2]!.replace(/~1/g, "/").replace(/~0/g, "~"),
    );
    if (!named.has(name)) fail(pointer, `$ref ${ref} names no definition`);
    return name;
  };
  const shape = (s: Schema, pointer: string): Shape => {
    for (const keyword of ["oneOf", "not", "$dynamicRef", "$recursiveRef"]) {
      if (keyword in s) {
        fail(
          pointer,
          `${keyword} has no class or ERD form`,
          "UNSUPPORTED_SYNTAX",
        );
      }
    }
    if (Array.isArray(s.anyOf)) {
      const options = (s.anyOf as Schema[]).filter((o) => o.type !== "null");
      if (options.length !== 1 || options.length === s.anyOf.length) {
        fail(
          pointer,
          "anyOf is read only as one schema or null",
          "UNSUPPORTED_SYNTAX",
        );
      }
      return { ...shape(options[0]!, `${pointer}/anyOf`), nullable: true };
    }
    if (typeof s.$ref === "string") {
      return { ref: target(s.$ref, pointer), many: false, nullable: false };
    }
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type];
    const nullable = types.includes("null");
    const t = types.find((x) => x !== "null");
    if (t === "array") {
      const items = isObject(s.items) ? s.items : {};
      return { ...shape(items, `${pointer}/items`), many: true, nullable };
    }
    if (t === "object" || (t === undefined && isObject(s.properties))) {
      return { inline: s, many: false, nullable };
    }
    const scalar =
      typeof s.format === "string" && kind === "erd" && SQL_TYPES[s.format]
        ? s.format
        : typeof s.format === "string" && kind === "class"
          ? s.format
          : ((t as string | undefined) ??
            (Array.isArray(s.enum) ? "string" : "any"));
    return { scalar, many: false, nullable };
  };

  const classes: Record<string, unknown>[] = [];
  const relations: Record<string, unknown>[] = [];
  const entities: { name: string; columns: ColumnSpec[] }[] = [];
  const relationships: Record<string, unknown>[] = [];
  const done = new Set<string>();

  const visit = (name: string, s: Schema, pointer: string) => {
    if (done.has(name)) return;
    done.add(name);
    let own: Schema = s;
    if (Array.isArray(s.allOf)) {
      const parts = s.allOf as Schema[];
      const bases = parts.filter((p) => typeof p.$ref === "string");
      const rest = parts.filter((p) => typeof p.$ref !== "string");
      if (
        bases.length > 1 ||
        rest.some((p) => !isObject(p.properties) && Object.keys(p).length > 0)
      ) {
        fail(
          pointer,
          "allOf is read only as one $ref base and properties",
          "UNSUPPORTED_SYNTAX",
        );
      }
      own = {
        ...s,
        properties: Object.assign(
          {},
          s.properties,
          ...rest.map((p) => p.properties),
        ),
        required: [
          ...((s.required as string[] | undefined) ?? []),
          ...rest.flatMap((p) => (p.required as string[] | undefined) ?? []),
        ],
      };
      for (const base of bases) {
        const parent = target(base.$ref as string, `${pointer}/allOf`);
        if (kind === "class")
          relations.push({ from: name, to: parent, type: "generalization" });
        else
          relationships.push({
            from: parent,
            to: name,
            fromCardinality: "1",
            toCardinality: "0..1",
            identifying: true,
          });
      }
    }
    if (Array.isArray(own.enum) && !isObject(own.properties)) {
      if (kind === "class") {
        classes.push({
          name,
          kind: "enum",
          literals: (own.enum as unknown[]).map(String),
        });
      } else {
        entities.push({
          name,
          columns: [{ name: "value", type: "varchar", primaryKey: true }],
        });
      }
      return;
    }
    const required = new Set((own.required as string[] | undefined) ?? []);
    const props = isObject(own.properties) ? own.properties : {};
    const attributes: Record<string, unknown>[] = [];
    const columns: ColumnSpec[] = [];
    for (const [prop, raw] of Object.entries(props)) {
      const at = `${pointer}/properties/${prop}`;
      if (!isObject(raw)) fail(at, "is not a schema");
      const sh = shape(raw as Schema, at);
      const optional = !required.has(prop) || sh.nullable;
      let other = sh.ref;
      if (sh.inline) {
        other =
          typeof sh.inline.title === "string"
            ? sh.inline.title
            : `${name}${pascal(prop)}`;
        named.set(other, sh.inline);
        visit(other, sh.inline, at);
      }
      if (kind === "class") {
        if (other === undefined) {
          attributes.push({
            name: prop,
            type: sh.scalar,
            ...(sh.many
              ? { multiplicity: "*" }
              : optional
                ? { multiplicity: "0..1" }
                : {}),
          });
        } else if (sh.inline) {
          relations.push({
            from: name,
            to: other,
            type: "composition",
            toMultiplicity: sh.many ? "*" : optional ? "0..1" : "1",
          });
        } else {
          relations.push({
            from: name,
            to: other,
            type: "directed",
            name: prop,
            toMultiplicity: sh.many ? "*" : optional ? "0..1" : "1",
          });
        }
      } else if (other === undefined) {
        columns.push({
          name: prop,
          type: sh.many
            ? `${SQL_TYPES[sh.scalar!] ?? sh.scalar}[]`
            : (SQL_TYPES[sh.scalar!] ?? sh.scalar!),
          ...(prop === "id"
            ? { primaryKey: true }
            : optional
              ? { nullable: true }
              : {}),
        });
      } else if (sh.many) {
        // A list of children: each child row points back at its owner.
        relationships.push({
          from: name,
          to: other,
          fromCardinality: "1",
          toCardinality: "0..*",
          identifying: false,
        });
      } else {
        const key: ColumnSpec = {
          name: `${prop}_id`,
          foreignKey: true,
          ...(optional && { nullable: true }),
        };
        columns.push(key);
        keys.push([key, other]);
        relationships.push({
          from: other,
          to: name,
          fromCardinality: optional ? "0..1" : "1",
          toCardinality: "0..*",
          identifying: false,
        });
      }
    }
    if (kind === "class") {
      classes.push({ name, ...(attributes.length > 0 && { attributes }) });
    } else {
      entities.push({ name, columns });
    }
  };
  /** Foreign key columns, typed once their target's key is known. */
  const keys: [ColumnSpec, string][] = [];
  for (const [name, schema] of [...named])
    visit(name, schema, pointers.get(schema)!);
  for (const [column, other] of keys) {
    const type = entities
      .find((e) => e.name === other)!
      .columns.find((c) => c.primaryKey)?.type;
    if (type !== undefined) column.type = type;
  }
  const title = typeof root.title === "string" ? root.title : undefined;
  return {
    kind,
    ...(title && { title }),
    spec:
      kind === "class"
        ? { classes, relations }
        : {
            entities: entities.map((e) => ({
              name: e.name,
              ...(e.columns.length > 0 && { columns: e.columns }),
            })),
            relationships,
          },
  };
}
