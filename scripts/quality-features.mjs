// Geometry features of every diagram in a saved .mdj, measured with
// src/quality/metric.ts, read the way src/quality/geometry.ts reads a live
// diagram; the data behind tests/fixtures/quality/human-ratings.json.
// Usage: node scripts/quality-features.mjs project.mdj > features.json
import fs from "node:fs";

const AREA =
  /Frame|Subject|Swimlane|Partition|CombinedFragment|Operand|Region|Boundary|Lane|Pool/;
const THROUGH = /Lifeline/;
const p = JSON.parse(fs.readFileSync(process.argv[2]));
const byId = new Map();
const parentOf = new Map();
const diagrams = [];
(function walk(e, parent) {
  if (!e || typeof e !== "object") return;
  if (e._id) {
    byId.set(e._id, e);
    if (parent) parentOf.set(e._id, parent);
  }
  if (e.ownedViews && /Diagram$/.test(e._type)) diagrams.push(e);
  for (const k of Object.keys(e)) {
    if (k === "_parent") continue;
    const v = e[k];
    if (Array.isArray(v)) v.forEach((x) => walk(x, e._id ? e : parent));
    else if (v && typeof v === "object" && !v.$ref) walk(v, e._id ? e : parent);
  }
})(p, null);
const ref = (r) => (r && r.$ref ? byId.get(r.$ref) : null);
const isView = (o) => o && /View$/.test(o._type) && !/Diagram$/.test(o._type);
const pts = (s) =>
  String(s ?? "")
    .split(";")
    .filter(Boolean)
    .map((t) => {
      const [x, y] = t.split(":").map(Number);
      return { x, y };
    });
const r1 = (n) => Math.round(n * 10) / 10;
const out = [];
for (const d of diagrams) {
  const views = d.ownedViews
    .filter(
      (v) =>
        (!v.head &&
          !v.tail &&
          !/Edge|Message|Link|Flow|Path|Transition|Relationship|Dependency|Association|Generalization|Realization|Connector|Include|Extend|Deployment$/.test(
            v._type,
          )) ||
        (v.left !== undefined && !v.points),
    )
    .filter((v) => v.visible !== false && v.points === undefined);
  const listed = new Set(views.map((v) => v._id));
  const holder = (v) => {
    let c = ref(v.containerView) ?? null;
    while (c && !listed.has(c._id)) {
      const up = ref(c.containerView) ?? parentOf.get(c._id) ?? null;
      if (up && !isView(up)) return null;
      c = up;
    }
    return c ? c._id : null;
  };
  const nodes = views.map((v) => ({
    id: v._id,
    left: r1(v.left),
    top: r1(v.top),
    width: r1(v.width),
    height: r1(v.height),
    area: AREA.test(v._type) || ref(v.model)?._id === d._id,
    through: THROUGH.test(v._type),
    parent: holder(v),
    type: v._type,
  }));
  // Operands of a combined fragment: the dividers are their tops.
  for (const v of views.filter((v) => v._type === "UMLCombinedFragmentView")) {
    for (const s of v.subViews ?? []) {
      for (const o of s.subViews ?? []) {
        if (o._type !== "UMLInteractionOperandView" || o.visible === false)
          continue;
        nodes.push({
          id: o._id,
          left: r1(o.left),
          top: r1(o.top),
          width: r1(o.width),
          height: r1(o.height),
          area: true,
          through: false,
          parent: v._id,
          type: o._type,
        });
      }
    }
  }
  const ownerNode = (v) => {
    let x = v;
    for (
      let up = parentOf.get(x._id);
      up && isView(up);
      up = parentOf.get(x._id)
    )
      x = up;
    return x._id;
  };
  const edgeViews = d.ownedViews.filter(
    (v) =>
      v.points !== undefined &&
      v.visible !== false &&
      ref(v.tail) &&
      ref(v.head),
  );
  const edges = edgeViews.map((e) => ({
    id: e._id,
    points: pts(e.points),
    ends: [ownerNode(ref(e.tail)), ownerNode(ref(e.head))],
    type: e._type,
  }));
  edgeViews.forEach((e, i) => {
    for (const [field, kind] of [
      ["nameLabel", "name"],
      ["stereotypeLabel", "stereotype"],
      ["tailRoleNameLabel", "end"],
      ["headRoleNameLabel", "end"],
      ["tailMultiplicityLabel", "end"],
      ["headMultiplicityLabel", "end"],
    ]) {
      const l = ref(e[field]);
      if (
        !l ||
        l.visible === false ||
        !String(l.text ?? "") ||
        !(l.width > 0 && l.height > 0)
      )
        continue;
      nodes.push({
        id: l._id,
        left: r1(l.left),
        top: r1(l.top),
        width: r1(l.width),
        height: r1(l.height),
        area: false,
        through: false,
        label: true,
        labelKind: kind,
        edge: e._id,
        parent: null,
        attachedTo: edges[i].ends,
      });
    }
  });
  // Activations: drawn over their lifeline, under nothing else.
  edgeViews.forEach((e, i) => {
    for (const s of e.subViews ?? []) {
      if (
        s._type !== "UMLActivationView" ||
        s.visible === false ||
        !(s.width > 0 && s.height > 0)
      )
        continue;
      const lifeline = edges[i].ends[1];
      nodes.push({
        id: s._id,
        left: r1(s.left),
        top: r1(s.top),
        width: r1(s.width),
        height: r1(s.height),
        area: false,
        through: false,
        label: true,
        group: lifeline,
        parent: null,
        attachedTo: edges[i].ends,
      });
    }
  });
  out.push({ name: d.name, type: d._type, nodes, edges });
}
// Node 22.18+ strips the types of the metric's source itself.
const { measure } = await import("../src/quality/metric.ts");
process.stdout.write(
  JSON.stringify(
    out.map((d) => ({ name: d.name, type: d.type, metrics: measure(d) })),
    null,
    1,
  ),
);
