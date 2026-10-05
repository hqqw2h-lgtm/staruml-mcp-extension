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

import * as z from "zod/mini";
import { doc } from "../endpoint.js";
import { ApiError } from "../errors.js";
import { multiline, parseOperation } from "./members.js";
import {
  Builder,
  common,
  LABEL_PADDING,
  name,
  nameOr,
  type Plan,
  str,
  strings,
  textWidth,
} from "./plan.js";

/*
 * The structural kinds of /build_diagram (issue #35): package diagrams
 * (packages, nesting, dependencies and imports), component diagrams
 * (components with provided and required interfaces, ports, connectors)
 * and deployment diagrams (nodes, artifacts, deploy and manifest
 * dependencies, communication paths). Each is a Plan like the other kinds.
 */

/** Dependency stereotypes UML 2.5 gives package relationships (§7.4.3, §12.2.3). */
export const PACKAGE_DEPENDENCIES = [
  "dependency",
  "import",
  "access",
  "merge",
  "use",
] as const;

export const packageSpec = () =>
  z.object({
    ...common(),
    packages: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            parent: z.optional(
              doc(name(), "Package this one is nested in, by name."),
            ),
            stereotype: z.optional(z.string()),
            documentation: z.optional(z.string()),
          }),
        ),
      ),
    ),
    dependencies: z.optional(
      z.array(
        z.object({
          from: name(),
          to: name(),
          type: z.optional(
            doc(
              z.enum(PACKAGE_DEPENDENCIES),
              "Default dependency; import, access, merge and use are dependencies with that stereotype.",
            ),
          ),
          name: z.optional(z.string()),
        }),
      ),
    ),
  });

export const componentSpec = () =>
  z.object({
    ...common(),
    components: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            stereotype: z.optional(z.string()),
            ports: z.optional(
              doc(strings(), "Ports on the component's border, by name."),
            ),
            provides: z.optional(
              doc(
                strings(),
                "Interfaces it realizes, drawn as lollipops; made when not declared.",
              ),
            ),
            requires: z.optional(
              doc(
                strings(),
                "Interfaces it uses, drawn as sockets; made when not declared.",
              ),
            ),
          }),
        ),
      ),
    ),
    interfaces: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            operations: z.optional(strings()),
          }),
        ),
      ),
    ),
    connectors: z.optional(
      z.array(
        z.object({
          from: doc(name(), "A port as 'Component.port'."),
          to: doc(name(), "A port as 'Component.port'."),
          name: z.optional(z.string()),
        }),
      ),
    ),
    dependencies: z.optional(
      z.array(
        z.object({ from: name(), to: name(), name: z.optional(z.string()) }),
      ),
    ),
  });

export const deploymentSpec = () =>
  z.object({
    ...common(),
    nodes: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            stereotype: z.optional(
              doc(z.string(), "E.g. device, executionEnvironment."),
            ),
            parent: z.optional(
              doc(name(), "Node this one is nested in, by name."),
            ),
            deploys: z.optional(
              doc(strings(), "Artifacts deployed on it («deploy»)."),
            ),
          }),
        ),
      ),
    ),
    artifacts: z.optional(
      z.array(
        nameOr(
          z.object({
            name: name(),
            stereotype: z.optional(z.string()),
            manifests: z.optional(
              doc(strings(), "Components it manifests («manifest»)."),
            ),
          }),
        ),
      ),
    ),
    components: z.optional(strings()),
    paths: z.optional(
      doc(
        z.array(
          z.object({
            from: name(),
            to: name(),
            name: z.optional(
              doc(z.string(), "Protocol or label, e.g. 'HTTPS'."),
            ),
          }),
        ),
        "Communication paths between nodes.",
      ),
    ),
  });

type Out<T extends () => z.ZodMiniType> = z.output<ReturnType<T>>;

/** A node's size: its widest line, and room for `lines` of text under its name. */
const sized = (min: number, label: string, lines = 0) => ({
  width: Math.max(min, textWidth(label) + 2 * LABEL_PADDING),
  height: 60 + 16 * lines,
});

/**
 * Orders nested elements owner first, so an owner's model exists before
 * what it owns is made in it, and refuses a parent that is not declared
 * or a nesting that loops.
 */
function ownersFirst<T extends { name: string; parent?: string }>(
  items: readonly T[],
  where: string,
  what: string,
): T[] {
  const byName = new Map(items.map((p) => [p.name, p]));
  const out: T[] = [];
  const state = new Map<string, "open" | "done">();
  const visit = (item: T, i: number) => {
    const s = state.get(item.name);
    if (s === "done") return;
    if (s === "open") {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.${where}.${i}.parent: ${item.name} would be nested in itself`,
      );
    }
    state.set(item.name, "open");
    if (item.parent !== undefined) {
      const parent = byName.get(item.parent);
      if (!parent) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.${where}.${i}.parent: no ${what} named ${item.parent}; declare it in spec.${where}`,
        );
      }
      visit(parent, items.indexOf(parent));
    }
    state.set(item.name, "done");
    out.push(item);
  };
  items.forEach((item, i) => visit(item, i));
  return out;
}

export function packagePlan(spec: Out<typeof packageSpec>): Plan {
  const b = new Builder("package");
  const packages = (spec.packages ?? []).map((p) =>
    typeof p === "string"
      ? { name: multiline(p) }
      : {
          ...p,
          name: multiline(p.name),
          ...(p.parent !== undefined && { parent: multiline(p.parent) }),
        },
  );
  for (const p of ownersFirst(packages, "packages", "package")) {
    const properties = {
      ...(p.stereotype !== undefined && { stereotype: p.stereotype }),
      ...(p.documentation !== undefined && {
        documentation: p.documentation,
      }),
    };
    b.node({
      key: p.name,
      type: "UMLPackage",
      name: p.name,
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(p.parent !== undefined && { owner: p.parent, container: p.parent }),
      ...sized(160, p.name),
    });
  }
  (spec.dependencies ?? []).forEach((d, i) => {
    const type = d.type ?? "dependency";
    b.edge(
      {
        type: "UMLDependency",
        from: d.from,
        to: d.to,
        ...(d.name !== undefined && { name: d.name }),
        ...(type !== "dependency" && { properties: { stereotype: type } }),
      },
      `dependencies.${i}`,
    );
  });
  return b.plan(packages.some((p) => p.parent !== undefined));
}

/** Where ports sit on their component's border. */
export const PORT = { size: 20, first: 30, step: 30 };

export function componentPlan(spec: Out<typeof componentSpec>): Plan {
  const b = new Builder("component");
  const interfaces = new Map<string, string[]>();
  for (const i of spec.interfaces ?? []) {
    const o = typeof i === "string" ? { name: i } : i;
    interfaces.set(multiline(o.name), o.operations ?? []);
  }
  const components = (spec.components ?? []).map((c) =>
    typeof c === "string" ? { name: c } : c,
  );
  // Interfaces named only in provides or requires are made too.
  for (const c of components) {
    for (const i of [...(c.provides ?? []), ...(c.requires ?? [])]) {
      if (!interfaces.has(multiline(i))) interfaces.set(multiline(i), []);
    }
  }
  for (const c of components) {
    const ports = c.ports ?? [];
    b.node({
      key: multiline(c.name),
      type: "UMLComponent",
      name: multiline(c.name),
      ...(c.stereotype !== undefined && {
        properties: { stereotype: c.stereotype },
      }),
      width: sized(160, c.name).width,
      height: Math.max(80, PORT.first + PORT.step * ports.length),
    });
  }
  for (const [n, operations] of interfaces) {
    b.node({
      key: n,
      type: "UMLInterface",
      name: n,
      ...(operations.length > 0 && {
        operations: operations.map(parseOperation),
      }),
      width: 30,
      height: 30,
    });
  }
  for (const c of components) {
    for (const port of c.ports ?? []) {
      b.node({
        key: `${multiline(c.name)}.${multiline(port)}`,
        type: "UMLPort",
        name: multiline(port),
        owner: multiline(c.name),
        host: multiline(c.name),
        width: PORT.size,
        height: PORT.size,
      });
    }
  }
  components.forEach((c, i) => {
    for (const to of c.provides ?? []) {
      b.edge(
        { type: "UMLInterfaceRealization", from: c.name, to },
        `components.${i}.provides`,
      );
    }
    for (const to of c.requires ?? []) {
      b.edge(
        { type: "UMLDependency", from: c.name, to },
        `components.${i}.requires`,
      );
    }
  });
  (spec.connectors ?? []).forEach((k, i) => {
    for (const end of [k.from, k.to]) {
      if (b.get(multiline(end))?.type !== "UMLPort") {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.connectors.${i}: ${end} is not a port; connectors join ports, written 'Component.port'`,
        );
      }
    }
    b.edge(
      {
        type: "UMLConnector",
        from: k.from,
        to: k.to,
        ...(k.name !== undefined && { name: k.name }),
      },
      `connectors.${i}`,
    );
  });
  (spec.dependencies ?? []).forEach((d, i) =>
    b.edge(
      {
        type: "UMLDependency",
        from: d.from,
        to: d.to,
        ...(d.name !== undefined && { name: d.name }),
      },
      `dependencies.${i}`,
    ),
  );
  // Format > Layout leaves ports where they were while their component
  // moves, so a diagram with ports keeps the computed placement.
  return b.plan(components.some((c) => (c.ports ?? []).length > 0));
}

export function deploymentPlan(spec: Out<typeof deploymentSpec>): Plan {
  const b = new Builder("deployment");
  const nodes = (spec.nodes ?? []).map((n) =>
    typeof n === "string"
      ? { name: multiline(n) }
      : {
          ...n,
          name: multiline(n.name),
          ...(n.parent !== undefined && { parent: multiline(n.parent) }),
        },
  );
  for (const n of ownersFirst(nodes, "nodes", "node")) {
    b.node({
      key: n.name,
      type: "UMLNode",
      name: n.name,
      ...(n.stereotype !== undefined && {
        properties: { stereotype: n.stereotype },
      }),
      ...(n.parent !== undefined && { owner: n.parent, container: n.parent }),
      ...sized(160, n.name, 1),
    });
  }
  const artifacts = (spec.artifacts ?? []).map((a) =>
    typeof a === "string" ? { name: a } : a,
  );
  for (const a of artifacts) {
    b.node({
      key: multiline(a.name),
      type: "UMLArtifact",
      name: multiline(a.name),
      ...(a.stereotype !== undefined && {
        properties: { stereotype: a.stereotype },
      }),
      ...sized(140, a.name),
    });
  }
  for (const c of spec.components ?? []) {
    b.node({
      key: multiline(c),
      type: "UMLComponent",
      name: multiline(c),
      ...sized(140, c),
    });
  }
  (spec.nodes ?? []).forEach((n, i) => {
    if (typeof n === "string") return;
    for (const artifact of n.deploys ?? []) {
      b.edge(
        { type: "UMLDeployment", from: artifact, to: str(n) },
        `nodes.${i}.deploys`,
      );
    }
  });
  artifacts.forEach((a, i) => {
    for (const component of a.manifests ?? []) {
      b.edge(
        {
          type: "UMLDependency",
          from: a.name,
          to: component,
          properties: { stereotype: "manifest" },
        },
        `artifacts.${i}.manifests`,
      );
    }
  });
  (spec.paths ?? []).forEach((p, i) =>
    b.edge(
      {
        type: "UMLCommunicationPath",
        from: p.from,
        to: p.to,
        ...(p.name !== undefined && { name: p.name }),
      },
      `paths.${i}`,
    ),
  );
  return b.plan(nodes.some((n) => n.parent !== undefined));
}
