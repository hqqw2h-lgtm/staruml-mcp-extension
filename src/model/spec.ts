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
import {
  type AttributeSpec,
  multiline,
  type OperationSpec,
  parseAttribute,
  parseOperation,
} from "../build/members.js";

/*
 * The object-level spec /build_model reads (issue #23): packages, classes
 * with members and responsibilities, semantic relationships, actors and
 * use cases, collaborations as message sequences and lifecycles as state
 * machines. It is the shape an object-oriented analysis writes down (the
 * ThingsBoard spec in tests/fixtures/domains is one), so its field names
 * follow that vocabulary: a context is a package, a responsibility,
 * what a class knows and does and whom it collaborates with become its
 * documentation.
 */

const name = () => z.string().check(z.minLength(1));
const names = () => z.array(name());

/**
 * Relationship words and the UML they mean. `from` is always the subject
 * of the sentence: the whole that owns or has, the client that uses, the
 * specific that is a, the class that implements, the one that knows.
 */
export const RELATIONS = {
  owns: "composition: from is the whole (end1, composite), to the part",
  has: "aggregation: from is the whole (end1, shared), to the part",
  uses: "dependency: from is the client, to the supplier",
  isA: "generalization: from is the specific, to the general",
  implements: "interface realization: from implements the interface to",
  knows: "directed association: from navigates to to",
  association: "association with no navigability or aggregation",
} as const;
export type RelationType = keyof typeof RELATIONS;

const RELATION_ALIASES: Record<string, RelationType> = {
  composition: "owns",
  aggregation: "has",
  dependency: "uses",
  generalization: "isA",
  realization: "implements",
  directed: "knows",
};

const memberList = () =>
  z.optional(z.array(z.union([z.string(), z.object({ name: name() })])));

const packageSchema = () =>
  z.union([
    name(),
    z.object({
      id: z.optional(
        doc(name(), "Key classes use in context; default the name."),
      ),
      name: name(),
      parent: z.optional(
        doc(name(), "Package this one is nested in, by id or name."),
      ),
      responsibility: z.optional(z.string()),
      documentation: z.optional(z.string()),
      stereotype: z.optional(z.string()),
      dependsOn: z.optional(
        doc(names(), "Packages it depends on, by id or name."),
      ),
    }),
  ]);

const classSchema = () =>
  z.object({
    name: name(),
    context: z.optional(
      doc(name(), "Owning package by id or name; package is a synonym."),
    ),
    package: z.optional(name()),
    kind: z.optional(z.enum(["class", "abstract", "interface", "enum"])),
    stereotype: z.optional(z.string()),
    responsibility: z.optional(z.string()),
    documentation: z.optional(z.string()),
    knows: z.optional(z.array(z.string())),
    does: z.optional(z.array(z.string())),
    collaboratesWith: z.optional(z.array(z.string())),
    attributes: memberList(),
    operations: memberList(),
    literals: z.optional(names()),
    isLeaf: z.optional(z.boolean()),
    isActive: z.optional(z.boolean()),
  });

const relationSchema = () =>
  z.object({
    from: name(),
    to: name(),
    type: doc(
      z.enum([
        ...(Object.keys(RELATIONS) as RelationType[]),
        ...Object.keys(RELATION_ALIASES),
      ] as [string, ...string[]]),
      Object.entries(RELATIONS)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ),
    name: z.optional(z.string()),
    fromMult: z.optional(z.string()),
    toMult: z.optional(z.string()),
    fromMultiplicity: z.optional(z.string()),
    toMultiplicity: z.optional(z.string()),
    fromRole: z.optional(z.string()),
    toRole: z.optional(z.string()),
  });

const MESSAGE_KINDS = ["sync", "async", "reply", "create", "delete"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

const messageSchema = () =>
  z.union([
    z.array(z.string()).check(z.minLength(2), z.maxLength(4)),
    z.object({
      from: name(),
      to: name(),
      text: z.optional(z.string()),
      kind: z.optional(z.enum(MESSAGE_KINDS)),
    }),
  ]);

const STATE_TYPES = [
  "state",
  "initial",
  "final",
  "choice",
  "fork",
  "join",
] as const;
export type StateType = (typeof STATE_TYPES)[number];

export const modelSpecSchema = () =>
  z.object({
    system: z.optional(doc(name(), "Name of the model; default 'Model'.")),
    name: z.optional(doc(name(), "Synonym of system.")),
    summary: z.optional(doc(z.string(), "The model's documentation.")),
    contexts: z.optional(
      doc(z.array(packageSchema()), "Packages (bounded contexts)."),
    ),
    packages: z.optional(doc(z.array(packageSchema()), "Synonym of contexts.")),
    classes: z.optional(
      doc(
        z.array(classSchema()),
        "Classes, interfaces, enumerations; members as '+name: Type' and '+op(p: T): R'. responsibility, knows, does and collaboratesWith become the documentation.",
      ),
    ),
    relationships: z.optional(z.array(relationSchema())),
    actors: z.optional(
      z.array(
        z.union([
          name(),
          z.object({
            name: name(),
            kind: z.optional(z.string()),
            goals: z.optional(z.array(z.string())),
            documentation: z.optional(z.string()),
          }),
        ]),
      ),
    ),
    useCases: z.optional(
      z.array(
        z.union([
          name(),
          z.object({
            name: name(),
            system: z.optional(
              z.nullable(doc(z.string(), "The subject it belongs to.")),
            ),
            actors: z.optional(names()),
            includes: z.optional(names()),
            extends: z.optional(names()),
            documentation: z.optional(z.string()),
          }),
        ]),
      ),
    ),
    collaborations: z.optional(
      doc(
        z.array(
          z.object({
            name: name(),
            context: z.optional(name()),
            package: z.optional(name()),
            participants: z.optional(
              z.array(
                z.union([
                  name(),
                  z.object({
                    name: name(),
                    kind: z.optional(z.string()),
                    type: z.optional(
                      doc(
                        name(),
                        "Classifier the lifeline is; default the class or actor of its name.",
                      ),
                    ),
                  }),
                ]),
              ),
            ),
            messages: z.optional(
              doc(
                z.array(messageSchema()),
                "[from, to, text, kind] or {from, to, text, kind}; kind sync (default), async, reply, create, delete.",
              ),
            ),
            fragments: z.optional(
              z.array(
                z.object({
                  operator: z.enum([
                    "alt",
                    "opt",
                    "loop",
                    "par",
                    "break",
                    "critical",
                    "neg",
                    "strict",
                    "seq",
                    "ignore",
                    "consider",
                    "assert",
                  ]),
                  guard: z.optional(z.string()),
                  operands: z.optional(z.array(z.string())),
                  from: z.optional(z.int()),
                  to: z.optional(z.int()),
                }),
              ),
            ),
          }),
        ),
        "Interactions: lifelines for the participants and their messages, in a collaboration.",
      ),
    ),
    lifecycles: z.optional(
      doc(
        z.array(
          z.object({
            name: name(),
            subject: z.optional(
              doc(name(), "Classifier whose behavior it is."),
            ),
            states: z.optional(
              z.array(
                z.union([
                  name(),
                  z.object({
                    id: z.optional(name()),
                    name: z.optional(z.string()),
                    type: z.optional(z.enum(STATE_TYPES)),
                    parent: z.optional(name()),
                  }),
                ]),
              ),
            ),
            transitions: z.optional(
              z.array(
                z.object({
                  from: name(),
                  to: name(),
                  trigger: z.optional(z.string()),
                  guard: z.optional(z.string()),
                  effect: z.optional(z.string()),
                }),
              ),
            ),
          }),
        ),
        "State machines, owned by their subject.",
      ),
    ),
  });

/** Sections an analysis spec may carry that describe diagrams, not the model. */
export const DIAGRAM_SECTIONS = {
  classViews: "class diagrams: /build_diagram kind class",
  useCaseViews: "use case diagrams: /build_diagram kind usecase",
  activities: "activity diagrams: /build_diagram kind activity",
  erd: "an ERD: /build_diagram kind erd",
  components: "a C4 or component diagram: /build_diagram kind c4 or component",
  deployments: "deployment diagrams: /build_diagram kind deployment",
  features: "a mind map: /build_diagram kind mindmap",
} as const;

export interface PackageSpec {
  key: string;
  name: string;
  parent?: string;
  documentation?: string;
  stereotype?: string;
  dependsOn: string[];
}

export interface ClassSpec {
  name: string;
  package?: string;
  kind: "class" | "abstract" | "interface" | "enum";
  stereotype?: string;
  documentation?: string;
  attributes: AttributeSpec[];
  operations: OperationSpec[];
  literals: string[];
  isLeaf?: boolean;
  isActive?: boolean;
}

export interface RelationSpec {
  from: string;
  to: string;
  type: RelationType;
  name?: string;
  fromMultiplicity?: string;
  toMultiplicity?: string;
  fromRole?: string;
  toRole?: string;
}

export interface ActorSpec {
  name: string;
  documentation?: string;
}

export interface UseCaseSpec {
  name: string;
  subject?: string;
  actors: string[];
  includes: string[];
  extends: string[];
  documentation?: string;
}

export interface Participant {
  name: string;
  /** Classifier name the lifeline's role is typed with. */
  type?: string;
  actor: boolean;
}

export interface MessageSpec {
  from: string;
  to: string;
  text: string;
  kind: MessageKind;
}

export interface CollaborationSpec {
  name: string;
  package?: string;
  participants: Participant[];
  messages: MessageSpec[];
  fragments: { operator: string; guard?: string; operands: string[] }[];
}

export interface StateSpec {
  key: string;
  name: string;
  type: StateType;
  parent?: string;
}

export interface LifecycleSpec {
  name: string;
  subject?: string;
  states: StateSpec[];
  transitions: {
    from: string;
    to: string;
    trigger?: string;
    guard?: string;
    effect?: string;
  }[];
}

export interface ModelSpec {
  name: string;
  documentation?: string;
  packages: PackageSpec[];
  classes: ClassSpec[];
  relationships: RelationSpec[];
  actors: ActorSpec[];
  useCases: UseCaseSpec[];
  collaborations: CollaborationSpec[];
  lifecycles: LifecycleSpec[];
  /** Sections left to /build_diagram, with what to build them as. */
  skipped: { section: string; reason: string }[];
}

type Raw = z.output<ReturnType<typeof modelSpecSchema>>;

/** Paragraphs and "Label: a, b." lines, without the empty ones. */
function documentation(
  ...parts: (
    string | [label: string, items: readonly string[] | undefined] | undefined
  )[]
): string | undefined {
  const lines = parts.flatMap((p) => {
    if (p === undefined) return [];
    if (typeof p === "string") return p.trim() ? [p.trim()] : [];
    const [label, items] = p;
    return items && items.length > 0 ? [`${label}: ${items.join(", ")}.`] : [];
  });
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const memberText = (m: string | { name: string }) =>
  typeof m === "string" ? m : m.name;

/**
 * Reads and checks a /build_model spec into its normalized form. Total:
 * anything that is not a valid spec is an INVALID_ARGUMENT naming the
 * field, never another error.
 */
export function parseModelSpec(input: unknown): ModelSpec {
  const parsed = z.safeParse(modelSpecSchema(), input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiError(
      "INVALID_ARGUMENT",
      `spec.${issue.path.map(String).join(".")}: ${issue.message}`,
      parsed.error.issues,
    );
  }
  const raw: Raw = parsed.data;
  if (raw.contexts && raw.packages) {
    throw new ApiError(
      "INVALID_ARGUMENT",
      "spec: pass contexts or packages, not both",
    );
  }
  const skipped = Object.entries(DIAGRAM_SECTIONS)
    .filter(
      ([section]) => (input as Record<string, unknown>)[section] !== undefined,
    )
    .map(([section, reason]) => ({ section, reason }));
  const packages = (raw.contexts ?? raw.packages ?? []).map(
    (p): PackageSpec => {
      if (typeof p === "string")
        return { key: multiline(p), name: multiline(p), dependsOn: [] };
      const doc = documentation(p.responsibility, p.documentation);
      return {
        key: p.id ?? multiline(p.name),
        name: multiline(p.name),
        ...(p.parent !== undefined && { parent: p.parent }),
        ...(doc !== undefined && { documentation: doc }),
        ...(p.stereotype !== undefined && { stereotype: p.stereotype }),
        dependsOn: p.dependsOn ?? [],
      };
    },
  );
  const classes = (raw.classes ?? []).map((c, i): ClassSpec => {
    if (c.context !== undefined && c.package !== undefined) {
      throw new ApiError(
        "INVALID_ARGUMENT",
        `spec.classes.${i}: pass context or package, not both`,
      );
    }
    const doc = documentation(
      c.responsibility,
      c.documentation,
      ["Knows", c.knows],
      ["Does", c.does],
      ["Collaborates with", c.collaboratesWith],
    );
    const pkg = c.context ?? c.package;
    return {
      name: multiline(c.name),
      ...(pkg !== undefined && { package: pkg }),
      kind: c.kind ?? "class",
      ...(c.stereotype !== undefined && { stereotype: c.stereotype }),
      ...(doc !== undefined && { documentation: doc }),
      attributes: (c.attributes ?? []).map((a) =>
        parseAttribute(memberText(a)),
      ),
      operations: (c.operations ?? []).map((o) => {
        const text = memberText(o);
        return parseOperation(text.includes("(") ? text : `${text}()`);
      }),
      literals: c.literals ?? [],
      ...(c.isLeaf !== undefined && { isLeaf: c.isLeaf }),
      ...(c.isActive !== undefined && { isActive: c.isActive }),
    };
  });
  const relationships = (raw.relationships ?? []).map((r): RelationSpec => {
    const from = r.fromMultiplicity ?? r.fromMult;
    const to = r.toMultiplicity ?? r.toMult;
    return {
      from: r.from,
      to: r.to,
      type: RELATION_ALIASES[r.type] ?? (r.type as RelationType),
      ...(r.name !== undefined && { name: r.name }),
      ...(from !== undefined && { fromMultiplicity: from }),
      ...(to !== undefined && { toMultiplicity: to }),
      ...(r.fromRole !== undefined && { fromRole: r.fromRole }),
      ...(r.toRole !== undefined && { toRole: r.toRole }),
    };
  });
  const actors = (raw.actors ?? []).map((a): ActorSpec => {
    if (typeof a === "string") return { name: multiline(a) };
    const doc = documentation(
      a.documentation,
      a.kind !== undefined ? `Kind: ${a.kind}.` : undefined,
      ["Goals", a.goals],
    );
    return {
      name: multiline(a.name),
      ...(doc !== undefined && { documentation: doc }),
    };
  });
  const useCases = (raw.useCases ?? []).map((u): UseCaseSpec => {
    if (typeof u === "string") {
      return { name: multiline(u), actors: [], includes: [], extends: [] };
    }
    return {
      name: multiline(u.name),
      ...(u.system && { subject: multiline(u.system) }),
      actors: u.actors ?? [],
      includes: u.includes ?? [],
      extends: u.extends ?? [],
      ...(u.documentation !== undefined && { documentation: u.documentation }),
    };
  });
  const collaborations = (raw.collaborations ?? []).map(
    (c, i): CollaborationSpec => {
      const participants = (c.participants ?? []).map((p): Participant =>
        typeof p === "string"
          ? { name: multiline(p), actor: false }
          : {
              name: multiline(p.name),
              ...(p.type !== undefined && { type: p.type }),
              actor: p.kind === "actor",
            },
      );
      const messages = (c.messages ?? []).map((m, k): MessageSpec => {
        if (!Array.isArray(m)) {
          return {
            from: multiline(m.from),
            to: multiline(m.to),
            text: m.text ?? "",
            kind: m.kind ?? "sync",
          };
        }
        const [from, to, text, kind] = m as [string, string, string?, string?];
        if (!from || !to) {
          throw new ApiError(
            "INVALID_ARGUMENT",
            `spec.collaborations.${i}.messages.${k}: from and to must be names`,
          );
        }
        if (
          kind !== undefined &&
          !(MESSAGE_KINDS as readonly string[]).includes(kind)
        ) {
          throw new ApiError(
            "INVALID_ARGUMENT",
            `spec.collaborations.${i}.messages.${k}: kind ${kind} is not one of ${MESSAGE_KINDS.join(", ")}`,
          );
        }
        return {
          from: multiline(from),
          to: multiline(to),
          text: text ?? "",
          kind: (kind as MessageKind | undefined) ?? "sync",
        };
      });
      // Participants used only in messages are declared in order of appearance.
      for (const m of messages) {
        for (const end of [m.from, m.to]) {
          if (!participants.some((p) => p.name === end)) {
            participants.push({ name: end, actor: false });
          }
        }
      }
      const pkg = c.context ?? c.package;
      return {
        name: multiline(c.name),
        ...(pkg !== undefined && { package: pkg }),
        participants,
        messages,
        fragments: (c.fragments ?? []).map((f) => ({
          operator: f.operator,
          ...(f.guard !== undefined && { guard: f.guard }),
          operands: f.operands ?? [],
        })),
      };
    },
  );
  const lifecycles = (raw.lifecycles ?? []).map((l, i): LifecycleSpec => {
    const states = (l.states ?? []).map((s, k): StateSpec => {
      const o = typeof s === "string" ? { name: s } : s;
      const key =
        o.id ?? (o.name !== undefined ? multiline(o.name) : undefined);
      if (key === undefined) {
        throw new ApiError(
          "INVALID_ARGUMENT",
          `spec.lifecycles.${i}.states.${k}: needs a name or an id`,
        );
      }
      const type = o.type ?? "state";
      return {
        key,
        name:
          o.name !== undefined
            ? multiline(o.name)
            : type === "state"
              ? key
              : "",
        type,
        ...(o.parent !== undefined && { parent: o.parent }),
      };
    });
    return {
      name: multiline(l.name),
      ...(l.subject !== undefined && { subject: l.subject }),
      states,
      transitions: l.transitions ?? [],
    };
  });
  const doc = documentation(raw.summary);
  return {
    name: multiline(raw.system ?? raw.name ?? "Model"),
    ...(doc !== undefined && { documentation: doc }),
    packages,
    classes,
    relationships,
    actors,
    useCases,
    collaborations,
    lifecycles,
    skipped,
  };
}
