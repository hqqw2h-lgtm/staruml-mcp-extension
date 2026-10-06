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

import type { Fail, TextLine } from "./c4.js";
import { multiline } from "./members.js";
import { unquote } from "./mermaid.js";

/*
 * PlantUML package, component and deployment diagrams read into the
 * package, component and deployment specs: what /export_text writes for
 * those kinds (text/plantuml-writer.ts), and the same statements written
 * by hand (plantuml.com/component-diagram, /deployment-diagram):
 * declarations with "Name" as Alias and <<stereotype>>, { } nesting, ports
 * inside a component, [Name] and () Name shorthands, and arrows with
 * : labels or : <<stereotype>>.
 */

export type StructureKind = "package" | "component" | "deployment";

interface Entry {
  type: string;
  operations?: string[];
  key: string;
  name: string;
  stereotype?: string;
  parent?: Entry;
}

const DECLARATION =
  /^(package|component|node|artifact|interface|port|portin|portout)\s+(.+?)\s*(\{)?$/;
const SHORT_COMPONENT = /^\[([^\]]+)\](?:\s+as\s+([\w.$:]+))?\s*(<<[^>]+>>)?$/;
const SHORT_INTERFACE = /^\(\)\s+(.+)$/;
const ARROW =
  /^("[^"]+"|\[[^\]]+\]|[\w.$:]+)\s+(<?[-.]+>?)\s+("[^"]+"|\[[^\]]+\]|[\w.$:]+)\s*(?::\s*(.*))?$/;

/** The text after "name" as Alias, its alias the key. */
function declared(text: string): { key: string; name: string; st?: string } {
  let rest = text;
  let st: string | undefined;
  rest = rest.replace(/<<\s*([^>]+?)\s*>>/g, (_, s: string) => {
    st ??= s;
    return "";
  });
  rest = rest.replace(/#[\w]+/g, "").trim();
  const m =
    /^"([^"]+)"\s+as\s+([\w.$:]+)$/.exec(rest) ??
    /^([\w.$:]+)\s+as\s+"([^"]+)"$/.exec(rest);
  if (m) {
    const quotedFirst = rest.startsWith('"');
    return {
      key: quotedFirst ? m[2]! : m[1]!,
      name: multiline(quotedFirst ? m[1]! : m[2]!),
      ...(st !== undefined && { st }),
    };
  }
  const plain = unquote(rest);
  return {
    key: plain,
    name: multiline(plain),
    ...(st !== undefined && { st }),
  };
}

/** A label: "<<use>>", "name", or both as "<<merge>> name". */
function labelled(text: string | undefined): {
  stereotype?: string;
  name?: string;
} {
  const t = text?.trim();
  if (!t) return {};
  const m = /^<<\s*([^>]+?)\s*>>\s*(.*)$/.exec(t);
  const name = m ? m[2]! : t;
  return {
    ...(m && { stereotype: m[1]! }),
    ...(name && { name: multiline(unquote(name)) }),
  };
}

/** The statements of one structural diagram as the spec of `kind`. */
export function readStructure(
  lines: readonly TextLine[],
  kind: StructureKind,
  fail: Fail,
): { spec: Record<string, unknown>; warnings: string[] } {
  const entries: Entry[] = [];
  const byRef = new Map<string, Entry>();
  const stack: Entry[] = [];
  const add = (type: string, text: string, no: number): Entry => {
    const d = declared(text);
    if (!d.key) fail(no, `${type} needs a name`);
    const parent = stack.at(-1);
    const e: Entry = {
      type,
      key: d.key,
      name: d.name,
      ...(d.st !== undefined && { stereotype: d.st }),
      ...(parent && { parent }),
    };
    entries.push(e);
    byRef.set(d.key, e);
    byRef.set(d.name, e);
    // A port is also named through its component, "Api.db".
    if (parent) byRef.set(`${parent.key}.${d.key}`, e);
    return e;
  };
  const arrows: { no: number; m: RegExpExecArray }[] = [];
  for (const { no, text } of lines) {
    let m: RegExpExecArray | null;
    const open = stack.at(-1);
    if (open?.type === "interface" && text !== "}") {
      // An interface's body lists its operations, as /export_text writes them.
      (open.operations ??= []).push(text);
      continue;
    }
    if (text === "}") {
      if (stack.length === 0) fail(no, "a } closes nothing");
      stack.pop();
    } else if ((m = DECLARATION.exec(text))) {
      const type = m[1]!.startsWith("port") ? "port" : m[1]!;
      const e = add(type, m[2]!, no);
      if (m[3]) stack.push(e);
    } else if ((m = SHORT_COMPONENT.exec(text))) {
      add(
        "component",
        `"${m[1]!}"${m[2] ? ` as ${m[2]}` : ""} ${m[3] ?? ""}`,
        no,
      );
    } else if ((m = SHORT_INTERFACE.exec(text))) {
      add("interface", m[1]!, no);
    } else if ((m = ARROW.exec(text))) {
      arrows.push({ no, m });
    } else {
      fail(no, `cannot read "${text}"`);
    }
  }
  // [Name] in an arrow declares the component it names, as PlantUML does.
  const ref = (text: string, no: number): Entry => {
    const bracketed = text.startsWith("[");
    const key = bracketed ? text.slice(1, -1) : unquote(text);
    const found = byRef.get(key);
    if (found) return found;
    if (bracketed) return add("component", `"${key}"`, no);
    return fail(no, `${key} is not declared`);
  };
  // Ends first: an arrow can declare a component, which the spec lists.
  const links = arrows.map(({ no, m }) => ({
    no,
    m,
    a: ref(m[1]!, no),
    b: ref(m[3]!, no),
  }));
  const of = (type: string) => entries.filter((e) => e.type === type);
  const shown = (e: Entry) => ({
    name: e.name,
    ...(e.parent && e.type !== "port" && { parent: e.parent.name }),
    ...(e.stereotype !== undefined && { stereotype: e.stereotype }),
  });
  if (kind === "package") {
    const dependencies = links.map(({ m, a, b }) => {
      const l = labelled(m[4]);
      return {
        from: a.name,
        to: b.name,
        ...(l.stereotype !== undefined && { type: l.stereotype }),
        ...(l.name !== undefined && { name: l.name }),
      };
    });
    return {
      spec: { packages: of("package").map(shown), dependencies },
      warnings: [],
    };
  }
  if (kind === "component") {
    const components = new Map(
      of("component").map((c) => [
        c,
        {
          name: c.name,
          ...(c.stereotype !== undefined && { stereotype: c.stereotype }),
          ports: of("port")
            .filter((p) => p.parent === c)
            .map((p) => p.name),
          provides: [] as string[],
          requires: [] as string[],
        },
      ]),
    );
    const connectors: Record<string, unknown>[] = [];
    const dependencies: Record<string, unknown>[] = [];
    const portName = (p: Entry) => `${p.parent!.name}.${p.name}`;
    for (const { m, a, b } of links) {
      const l = labelled(m[4]);
      const dotted = m[2]!.includes(".");
      if (a.type === "port" && b.type === "port") {
        connectors.push({
          from: portName(a),
          to: portName(b),
          ...(l.name !== undefined && { name: l.name }),
        });
      } else if (b.type === "interface" && components.has(a)) {
        const c = components.get(a)!;
        if (dotted) c.requires.push(b.name);
        else c.provides.push(b.name);
      } else {
        dependencies.push({
          from: a.name,
          to: b.name,
          ...(l.name !== undefined && { name: l.name }),
        });
      }
    }
    return {
      spec: {
        components: [...components.values()].map((c) => ({
          name: c.name,
          ...(c.stereotype !== undefined && { stereotype: c.stereotype }),
          ...(c.ports.length > 0 && { ports: c.ports }),
          ...(c.provides.length > 0 && { provides: c.provides }),
          ...(c.requires.length > 0 && { requires: c.requires }),
        })),
        interfaces: of("interface").map((i) =>
          i.operations ? { name: i.name, operations: i.operations } : i.name,
        ),
        connectors,
        dependencies,
      },
      warnings: [],
    };
  }
  const nodes = new Map(
    of("node").map((n) => [n, { ...shown(n), deploys: [] as string[] }]),
  );
  const artifacts = new Map(
    of("artifact").map((a) => [a, { ...shown(a), manifests: [] as string[] }]),
  );
  const paths: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const { no, m, a, b } of links) {
    const l = labelled(m[4]);
    if (l.stereotype === "deploy" && artifacts.has(a) && nodes.has(b)) {
      nodes.get(b)!.deploys.push(a.name);
    } else if (l.stereotype === "manifest" && artifacts.has(a)) {
      artifacts.get(a)!.manifests.push(b.name);
    } else if (nodes.has(a) && nodes.has(b)) {
      paths.push({
        from: a.name,
        to: b.name,
        ...(l.name !== undefined && { name: l.name }),
      });
    } else {
      warnings.push(
        `line ${no}: ${a.name} ${m[2]} ${b.name} is not a deployment, manifestation or communication path; left out`,
      );
    }
  }
  return {
    spec: {
      nodes: [...nodes.values()].map(({ deploys, ...n }) => ({
        ...n,
        ...(deploys.length > 0 && { deploys }),
      })),
      artifacts: [...artifacts.values()].map(({ manifests, ...a }) => ({
        ...a,
        ...(manifests.length > 0 && { manifests }),
      })),
      components: of("component").map((c) => c.name),
      paths,
    },
    warnings,
  };
}
