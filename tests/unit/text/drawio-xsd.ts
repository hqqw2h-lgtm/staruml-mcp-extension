import { readFileSync } from "node:fs";

/*
 * No XSD-capable validator is in the dependency tree (ajv validates JSON
 * Schema only), so this is a validator for the subset of XML Schema 1.0 that
 * the vendored mxfile.xsd uses, driven by that file: global complexType and
 * simpleType definitions, xs:sequence and xs:choice of xs:element with
 * minOccurs/maxOccurs, xs:attribute with type, use and fixed, xs:anyAttribute,
 * and simple types restricting xs:string by xs:enumeration or xs:pattern.
 * Built-in types are checked as XSD Part 2 defines them: xs:double,
 * xs:positiveInteger, xs:string. Anything else in the schema makes it throw,
 * so a newer XSD with constructs this does not understand fails loudly.
 *
 * On top of the schema it checks what mxfile.xsd states only in its
 * documentation: cell ids unique, cells "0" and "1" first, every parent,
 * source and target naming a cell, and every edge carrying an mxGeometry.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Character data directly in the element, whitespace included. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X"))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1)));
    const v = ENTITIES[e];
    if (v === undefined) throw new Error(`unknown entity &${e};`);
    return v;
  });
}

/** A well-formedness-checking parser for XML without DTDs or CDATA sections. */
export function parseXml(text: string): XmlNode {
  let at = 0;
  const fail = (msg: string): never => {
    throw new Error(`${msg} at offset ${at}`);
  };
  const skipMisc = () => {
    for (;;) {
      const ws = /^\s*/.exec(text.slice(at))![0];
      at += ws.length;
      if (text.startsWith("<?", at)) {
        const end = text.indexOf("?>", at);
        if (end < 0) fail("unterminated declaration");
        at = end + 2;
      } else if (text.startsWith("<!--", at)) {
        const end = text.indexOf("-->", at);
        if (end < 0) fail("unterminated comment");
        at = end + 3;
      } else return;
    }
  };
  const element = (): XmlNode => {
    const open = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(at));
    if (!open) fail("expected an element");
    at += open![0].length;
    const node: XmlNode = {
      name: open![1]!,
      attrs: {},
      children: [],
      text: "",
    };
    for (;;) {
      const attr = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(
        text.slice(at),
      );
      if (!attr) break;
      if (Object.hasOwn(node.attrs, attr[1]!))
        fail(`duplicate attribute ${attr[1]}`);
      node.attrs[attr[1]!] = decode(attr[3] ?? attr[4]!);
      at += attr[0].length;
    }
    const close = /^\s*(\/?)>/.exec(text.slice(at));
    if (!close) fail(`malformed start tag <${node.name}>`);
    at += close![0].length;
    if (close![1] === "/") return node;
    for (;;) {
      skipMisc();
      if (text.startsWith("</", at)) {
        const end = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(text.slice(at));
        if (!end || end[1] !== node.name) fail(`expected </${node.name}>`);
        at += end![0].length;
        return node;
      }
      if (text[at] === "<") {
        node.children.push(element());
        continue;
      }
      const end = text.indexOf("<", at);
      if (end < 0) fail(`unterminated <${node.name}>`);
      node.text += decode(text.slice(at, end));
      at = end;
    }
  };
  skipMisc();
  const root = element();
  skipMisc();
  if (at !== text.length) fail("content after the root element");
  return root;
}

interface Particle {
  kind: "element" | "sequence" | "choice";
  name?: string;
  type?: string;
  min: number;
  max: number;
  items: Particle[];
}

interface Attribute {
  type: string;
  required: boolean;
  fixed?: string;
}

interface ComplexType {
  content?: Particle;
  attributes: Map<string, Attribute>;
  anyAttribute: boolean;
}

interface SimpleType {
  enumeration: string[];
  patterns: RegExp[];
}

export interface Schema {
  root: { name: string; type: string };
  complex: Map<string, ComplexType>;
  simple: Map<string, SimpleType>;
}

const occurs = (v: string | undefined, d: number) =>
  v === undefined ? d : v === "unbounded" ? Infinity : Number(v);

/** The schema at `path`, read into the structures the validator walks. */
export function loadSchema(path: string): Schema {
  const xsd = parseXml(readFileSync(path, "utf-8"));
  const strip = (n: XmlNode) =>
    n.children.filter((c) => c.name !== "xs:annotation");
  const particle = (n: XmlNode): Particle => {
    const base = {
      min: occurs(n.attrs.minOccurs, 1),
      max: occurs(n.attrs.maxOccurs, 1),
    };
    if (n.name === "xs:element") {
      if (!n.attrs.type) throw new Error("anonymous element types unsupported");
      return {
        kind: "element",
        name: n.attrs.name!,
        type: n.attrs.type,
        items: [],
        ...base,
      };
    }
    if (n.name === "xs:sequence" || n.name === "xs:choice") {
      return {
        kind: n.name === "xs:sequence" ? "sequence" : "choice",
        items: strip(n).map(particle),
        ...base,
      };
    }
    throw new Error(`unsupported particle ${n.name}`);
  };
  const schema: Schema = {
    root: { name: "", type: "" },
    complex: new Map(),
    simple: new Map(),
  };
  for (const def of strip(xsd)) {
    if (def.name === "xs:element") {
      schema.root = { name: def.attrs.name!, type: def.attrs.type! };
    } else if (def.name === "xs:complexType") {
      const type: ComplexType = { attributes: new Map(), anyAttribute: false };
      for (const c of strip(def)) {
        if (c.name === "xs:attribute") {
          type.attributes.set(c.attrs.name!, {
            type: c.attrs.type!,
            required: c.attrs.use === "required",
            ...(c.attrs.fixed !== undefined && { fixed: c.attrs.fixed }),
          });
        } else if (c.name === "xs:anyAttribute") type.anyAttribute = true;
        else type.content = particle(c);
      }
      schema.complex.set(def.attrs.name!, type);
    } else if (def.name === "xs:simpleType") {
      const restriction = strip(def)[0]!;
      if (
        restriction.name !== "xs:restriction" ||
        restriction.attrs.base !== "xs:string"
      )
        throw new Error(`unsupported simple type ${def.attrs.name}`);
      const facets = strip(restriction);
      schema.simple.set(def.attrs.name!, {
        enumeration: facets
          .filter((f) => f.name === "xs:enumeration")
          .map((f) => f.attrs.value!),
        // XSD patterns match the whole value.
        patterns: facets
          .filter((f) => f.name === "xs:pattern")
          .map((f) => new RegExp(`^(?:${f.attrs.value})$`)),
      });
    } else throw new Error(`unsupported top-level ${def.name}`);
  }
  return schema;
}

function simpleOk(schema: Schema, type: string, value: string): boolean {
  switch (type) {
    case "xs:string":
      return true;
    case "xs:double":
      return /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|-?INF|NaN)$/.test(
        value,
      );
    case "xs:positiveInteger":
      return /^\+?0*[1-9]\d*$/.test(value);
  }
  const simple = schema.simple.get(type);
  if (!simple) throw new Error(`unknown simple type ${type}`);
  return (
    (simple.enumeration.length === 0 || simple.enumeration.includes(value)) &&
    simple.patterns.every((p) => p.test(value))
  );
}

/**
 * Matches `children` from `i` against particle `p`; returns the possible
 * next positions (a small NFA, enough for this schema's content models).
 */
function match(p: Particle, children: XmlNode[], i: number): number[] {
  const once = (start: number): number[] => {
    if (p.kind === "element")
      return children[start]?.name === p.name ? [start + 1] : [];
    if (p.kind === "choice")
      return p.items.flatMap((q) => match(q, children, start));
    let positions = [start];
    for (const q of p.items)
      positions = positions.flatMap((s) => match(q, children, s));
    return positions;
  };
  // Each repetition that matches anything consumes a child, so more
  // repetitions than children remain cannot reach a new position.
  const limit = Math.min(p.max, children.length - i + 1);
  const reached = new Set<number>();
  let frontier = new Set([i]);
  for (let n = 0; ; n++) {
    if (n >= p.min) for (const s of frontier) reached.add(s);
    if (n >= limit || frontier.size === 0) break;
    frontier = new Set([...frontier].flatMap(once));
  }
  return [...reached];
}

function elementTypes(p: Particle, out = new Map<string, string>()) {
  if (p.kind === "element") out.set(p.name!, p.type!);
  for (const q of p.items) elementTypes(q, out);
  return out;
}

/** Problems with `node` against `schema`, as "path: message" lines. */
export function validate(schema: Schema, node: XmlNode): string[] {
  const errors: string[] = [];
  const walk = (n: XmlNode, typeName: string, path: string) => {
    const type = schema.complex.get(typeName);
    if (!type) throw new Error(`unknown complex type ${typeName}`);
    for (const [name, value] of Object.entries(n.attrs)) {
      const a = type.attributes.get(name);
      if (!a) {
        if (!type.anyAttribute)
          errors.push(`${path}: attribute ${name} not allowed`);
        continue;
      }
      if (a.fixed !== undefined && value !== a.fixed)
        errors.push(`${path}: ${name} must be "${a.fixed}"`);
      if (!simpleOk(schema, a.type, value))
        errors.push(`${path}: ${name}="${value}" is not a valid ${a.type}`);
    }
    for (const [name, a] of type.attributes)
      if (a.required && !(name in n.attrs))
        errors.push(`${path}: attribute ${name} is required`);
    // None of the schema's complex types is mixed.
    if (n.text.trim() !== "") errors.push(`${path}: text content not allowed`);
    const content = type.content;
    if (!content) {
      if (n.children.length > 0) errors.push(`${path}: no children allowed`);
      return;
    }
    if (!match(content, n.children, 0).includes(n.children.length))
      errors.push(
        `${path}: children (${n.children.map((c) => c.name).join(", ")}) do not match the content model`,
      );
    const types = elementTypes(content);
    n.children.forEach((c, k) => {
      const t = types.get(c.name);
      if (t) walk(c, t, `${path}/${c.name}[${k}]`);
    });
  };
  if (node.name !== schema.root.name)
    return [`root is <${node.name}>, not <${schema.root.name}>`];
  walk(node, schema.root.type, node.name);
  return errors;
}

/** The constraints mxfile.xsd documents but cannot express. */
export function validateCells(node: XmlNode): string[] {
  const errors: string[] = [];
  for (const diagram of node.children) {
    const root = diagram.children[0]?.children[0];
    if (!root) continue;
    const cells = root.children;
    const ids = new Set<string>();
    for (const c of cells) {
      const id = c.attrs.id!;
      if (ids.has(id)) errors.push(`duplicate cell id ${id}`);
      ids.add(id);
    }
    if (cells[0]?.attrs.id !== "0" || cells[0]?.attrs.parent !== undefined)
      errors.push('first cell is not the root "0"');
    if (cells[1]?.attrs.id !== "1" || cells[1]?.attrs.parent !== "0")
      errors.push('second cell is not the layer "1" in "0"');
    for (const c of cells.slice(1)) {
      for (const ref of ["parent", "source", "target"]) {
        const v = c.attrs[ref];
        if (v !== undefined && !ids.has(v))
          errors.push(`cell ${c.attrs.id}: ${ref} ${v} is not a cell`);
      }
      if (c.attrs.edge === "1" && c.children[0]?.name !== "mxGeometry")
        errors.push(`edge ${c.attrs.id} has no mxGeometry`);
    }
  }
  return errors;
}

let schema: Schema | null = null;

/** Every problem with a .drawio text: well-formedness, the XSD, the documented rules. */
export function drawioProblems(text: string): string[] {
  // Vitest runs from the repository root.
  schema ??= loadSchema("tests/fixtures/drawio/mxfile.xsd");
  let tree: XmlNode;
  try {
    tree = parseXml(text);
  } catch (err) {
    return [(err as Error).message];
  }
  return [...validate(schema, tree), ...validateCells(tree)];
}
