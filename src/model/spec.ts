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
  z.optional(z.array(z.union([z.string(), z.strictObject({ name: name() })])));

const packageSchema = () =>
  z.union([
    name(),
    z.strictObject({
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
  z.strictObject({
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
  z.strictObject({
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
    z.strictObject({
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
  z.strictObject({
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
          z.strictObject({
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
          z.strictObject({
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
          z.strictObject({
            name: name(),
            context: z.optional(name()),
            package: z.optional(name()),
            participants: z.optional(
              z.array(
                z.union([
                  name(),
                  z.strictObject({
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
                z.strictObject({
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
          z.strictObject({
            name: name(),
            subject: z.optional(
              doc(name(), "Classifier whose behavior it is."),
            ),
            states: z.optional(
              z.array(
                z.union([
                  name(),
                  z.strictObject({
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
                z.strictObject({
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
    ...viewSections(),
  });

/** A relationship written as a tuple, [from, to, ...] , or as an object. */
const link = <T extends z.ZodMiniType>(object: T) =>
  z.union([z.array(z.string()).check(z.minLength(2), z.maxLength(5)), object]);

const ACTIVITY_NODES = [
  "action",
  "initial",
  "final",
  "flowFinal",
  "decision",
  "merge",
  "fork",
  "join",
  "object",
] as const;

export interface Feature {
  name: string;
  children?: Feature[];
}

const featureSchema: z.ZodMiniType<Feature> = z.strictObject({
  name: name(),
  get children() {
    return z.optional(z.array(featureSchema));
  },
});

/**
 * Sections of an analysis that are not classes and collaborations but are
 * still the model's, not drawings: which classes a class view groups, use
 * case groupings, activities, the data model, the C4 elements, deployment
 * topologies and a feature tree. None carries a position, a size or a
 * colour; /derive_diagrams draws them (issue #33).
 */
const viewSections = () => ({
  classViews: z.optional(
    doc(
      z.array(
        z.strictObject({
          name: name(),
          contexts: z.optional(
            doc(names(), "Packages whose classes it shows, by id or name."),
          ),
          classes: z.optional(doc(names(), "Classes it shows besides.")),
          exclude: z.optional(names()),
          also: z.optional(
            doc(names(), "Classes from elsewhere it shows too."),
          ),
          note: z.optional(z.string()),
        }),
      ),
      "Class diagrams by what they show; /derive_diagrams draws one each when the policy says views.",
    ),
  ),
  useCaseViews: z.optional(
    doc(
      z.array(
        z.strictObject({
          name: name(),
          actor: z.optional(name()),
          actors: z.optional(names()),
          cases: z.optional(names()),
          extraActors: z.optional(names()),
        }),
      ),
      "Use case diagrams by actor; default one per system (subject).",
    ),
  ),
  activities: z.optional(
    z.array(
      z.strictObject({
        name: name(),
        lanes: z.optional(names()),
        nodes: z.array(
          z.strictObject({
            id: z.optional(name()),
            name: z.optional(z.string()),
            type: z.optional(z.enum(ACTIVITY_NODES)),
            lane: z.optional(name()),
          }),
        ),
        flows: z.array(
          link(
            z.strictObject({
              from: name(),
              to: name(),
              guard: z.optional(z.string()),
            }),
          ),
        ),
      }),
    ),
  ),
  erd: z.optional(
    doc(
      z.strictObject({
        name: z.optional(name()),
        entities: z.array(
          z.strictObject({
            name: name(),
            columns: z.optional(z.array(z.string())),
          }),
        ),
        relationships: z.optional(
          z.array(
            link(
              z.strictObject({
                from: name(),
                to: name(),
                fromCardinality: z.optional(z.string()),
                toCardinality: z.optional(z.string()),
                name: z.optional(z.string()),
                identifying: z.optional(z.boolean()),
              }),
            ),
          ),
        ),
      }),
      "Tables: columns as 'id uuid PK'; relationships as [from, to, fromCardinality, toCardinality].",
    ),
  ),
  components: z.optional(
    doc(
      z.strictObject({
        name: z.optional(name()),
        elements: z.array(
          z.strictObject({
            id: z.optional(name()),
            name: name(),
            type: z.enum(["person", "system", "container", "component"]),
            kind: z.optional(z.string()),
            technology: z.optional(z.string()),
            description: z.optional(z.string()),
            external: z.optional(z.boolean()),
          }),
        ),
        relations: z.optional(
          z.array(
            link(
              z.strictObject({
                from: name(),
                to: name(),
                label: z.optional(z.string()),
                technology: z.optional(z.string()),
                description: z.optional(z.string()),
              }),
            ),
          ),
        ),
      }),
      "C4 people, systems, containers and components; relations as [from, to, label, technology].",
    ),
  ),
  deployments: z.optional(
    z.array(
      z.strictObject({
        name: name(),
        nodes: z.array(
          z.strictObject({
            name: name(),
            kind: z.optional(
              doc(z.string(), "device, node, executionEnvironment."),
            ),
            parent: z.optional(name()),
            contains: z.optional(doc(names(), "Artifacts deployed on it.")),
          }),
        ),
        links: z.optional(
          z.array(
            link(
              z.strictObject({
                from: name(),
                to: name(),
                name: z.optional(z.string()),
              }),
            ),
          ),
        ),
      }),
    ),
  ),
  features: z.optional(
    doc(featureSchema, "A feature tree, drawn as a mind map."),
  ),
});

/** The view sections as /build_model stores them with the model. */
export type ModelViews = z.output<
  z.ZodMiniObject<ReturnType<typeof viewSections>>
> & {
  /** Package names by the ids the spec gives them, where they differ. */
  contexts?: Record<string, string>;
  /** Each use case's system (subject), which the model does not relate. */
  subjects?: Record<string, string>;
  /** Each collaboration's fragments with their message ranges, by name. */
  fragments?: Record<
    string,
    {
      operator: string;
      guard?: string;
      operands: string[];
      from?: number;
      to?: number;
    }[]
  >;
};

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
  /** The sections /derive_diagrams draws, stored with the model. */
  views: ModelViews;
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
  // A use case names the system it belongs to, else it is the spec's own
  // system's: the boundary a use case diagram draws (UML 2.5.1 §18.1.3,
  // a use case's subject).
  const system = raw.system === undefined ? undefined : multiline(raw.system);
  const useCases = (raw.useCases ?? []).map((u): UseCaseSpec => {
    if (typeof u === "string") {
      return {
        name: multiline(u),
        ...(system !== undefined && { subject: system }),
        actors: [],
        includes: [],
        extends: [],
      };
    }
    const subject = u.system ? multiline(u.system) : system;
    return {
      name: multiline(u.name),
      ...(subject !== undefined && { subject }),
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
  const views: ModelViews = Object.fromEntries(
    (
      [
        "classViews",
        "useCaseViews",
        "activities",
        "erd",
        "components",
        "deployments",
        "features",
      ] as const
    ).flatMap((k) => (raw[k] === undefined ? [] : [[k, raw[k]]])),
  );
  const contexts = packages.filter((p) => p.key !== p.name);
  if (contexts.length > 0) {
    views.contexts = Object.fromEntries(contexts.map((p) => [p.key, p.name]));
  }
  const subjects = useCases.filter((u) => u.subject !== undefined);
  if (subjects.length > 0) {
    views.subjects = Object.fromEntries(
      subjects.map((u) => [u.name, u.subject!]),
    );
  }
  const ranged = (raw.collaborations ?? []).filter((c) =>
    (c.fragments ?? []).some((f) => f.from !== undefined),
  );
  if (ranged.length > 0) {
    views.fragments = Object.fromEntries(
      ranged.map((c) => [
        multiline(c.name),
        c.fragments!.map((f) => ({
          operator: f.operator,
          ...(f.guard !== undefined && { guard: f.guard }),
          operands: f.operands ?? [],
          ...(f.from !== undefined && { from: f.from }),
          ...(f.to !== undefined && { to: f.to }),
        })),
      ]),
    );
  }
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
    views,
  };
}
