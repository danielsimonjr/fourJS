/**
 * §51 Boolean operations on flattened closed contours.
 *
 * Curves are flattened first ({@link Path.flatten}); the clip then runs on
 * polygons. That is a deliberate quality trade: Bézier/arc Boolean of the
 * arrangement is the same planar-subdivision packet §52 still wants for
 * self-intersections, and this module does not pretend to be that packet.
 *
 * | operation   | algorithm                                                                 |
 * | ----------- | ------------------------------------------------------------------------- |
 * | `intersect` | Sutherland–Hodgman when the clip operand is a single convex ring; otherwise an even-odd (or the clip's fill-rule) classification of split edge fragments, then a stitch |
 * | `union`     | fragment classify + stitch on flattened closed contours                   |
 * | `subtract`  | as union, keeping subject-outside-clip and clip-inside-subject (reversed) |
 * | `xor`       | both differences, as two (or more) contours                               |
 *
 * ## Honesty about concave rings and holes
 *
 * Axis-aligned rectangles, and other simple convex operands that cross in
 * proper edge interiors, come back exact: one contour for an overlapping
 * pair's intersection, two contours for a disjoint union. Concave clip
 * polygons take the fragment path, which is correct for ordinary crossings
 * but can drop or duplicate a sliver when rings only *touch* (a vertex on a
 * foreign edge, a shared collinear run) or when a hole's boundary is not a
 * clean subset of its outline after flattening. Nested holes are best-effort:
 * a hole is emitted as a second contour with opposite winding when the
 * fragment walk produces one, which {@link Path.fillRings} then groups under
 * `nonzero`. Self-intersecting input is out of scope — §52 still refuses it.
 *
 * Vertex order is deterministic: each contour is rotated to start at its
 * lexicographically smallest vertex, and contours are sorted by that vertex
 * (then by the rest of the ring).
 */

import type { FillRule } from "./path.js";
import type { Point2D } from "./tessellation.js";

/** The four §51 Boolean combinations. */
export type BooleanOp = "union" | "intersect" | "subtract" | "xor";

const BOOLEAN_OPS: readonly BooleanOp[] = [
  "union",
  "intersect",
  "subtract",
  "xor",
];

/** Interior-side probe, relative to an edge of length ~1, in world units. */
const INTERIOR_NUDGE = 1e-8;

/** Treat two coordinates as the same split vertex. */
const SNAP = 1e-10;

/**
 * Boolean-combines two sets of flattened closed rings.
 *
 * Rings are closed (last point not repeated). Degenerate rings (fewer than
 * three vertices, or zero signed area) are ignored.
 */
export function booleanPolygons(
  subject: readonly (readonly Point2D[])[],
  clip: readonly (readonly Point2D[])[],
  op: BooleanOp,
  subjectFill: FillRule = "nonzero",
  clipFill: FillRule = "nonzero",
): Point2D[][] {
  if (!BOOLEAN_OPS.includes(op)) {
    throw new RangeError(`booleanOp: unknown operation ${String(op)} (§85).`);
  }
  const subjectRings = usableRings(subject);
  const clipRings = usableRings(clip);
  if (subjectRings.length === 0) {
    return op === "union" || op === "xor" ? finalize(clipRings) : [];
  }
  if (clipRings.length === 0) {
    return op === "intersect" ? [] : finalize(subjectRings);
  }

  if (op === "intersect" && isSingleConvex(clipRings)) {
    const clipped: Point2D[][] = [];
    for (const ring of subjectRings) {
      const piece = sutherlandHodgman(ring, clipRings[0]);
      if (piece.length >= 3 && doubleArea(piece) !== 0) {
        clipped.push(piece);
      }
    }
    return finalize(clipped);
  }

  return finalize(
    fragmentBoolean(subjectRings, clipRings, op, subjectFill, clipFill),
  );
}

/** Drops rings that cannot bound a filled region. */
function usableRings(rings: readonly (readonly Point2D[])[]): Point2D[][] {
  const out: Point2D[][] = [];
  for (const ring of rings) {
    const copy = dedupeRing(ring);
    if (copy.length >= 3 && doubleArea(copy) !== 0) {
      out.push(copy);
    }
  }
  return out;
}

/** Removes consecutive duplicate vertices and a repeated closer. */
function dedupeRing(ring: readonly Point2D[]): Point2D[] {
  const points: Point2D[] = [];
  for (const point of ring) {
    const last = points[points.length - 1];
    if (last !== undefined && samePoint(last, point)) {
      continue;
    }
    points.push({ x: point.x, y: point.y });
  }
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
    points.pop();
  }
  return points;
}

/** True when `clip` is one convex ring — the Sutherland–Hodgman case. */
function isSingleConvex(rings: readonly Point2D[][]): boolean {
  return rings.length === 1 && isConvex(rings[0]);
}

/** All turns of `ring` share a sign (collinear vertices are skipped). */
export function isConvex(ring: readonly Point2D[]): boolean {
  const count = ring.length;
  if (count < 3) {
    return false;
  }
  let sign = 0;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % count];
    const c = ring[(i + 2) % count];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) {
      continue;
    }
    const next = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = next;
    } else if (next !== sign) {
      return false;
    }
  }
  return true;
}

/**
 * Sutherland–Hodgman clip of `subject` against a convex `clip` ring.
 *
 * The clip ring is walked as given; "inside" is the left side of each directed
 * clip edge when the clip is counter-clockwise, and the right side when it is
 * clockwise, so either winding is accepted.
 */
export function sutherlandHodgman(
  subject: readonly Point2D[],
  clip: readonly Point2D[],
): Point2D[] {
  const clipArea = doubleArea(clip);
  if (clipArea === 0) {
    return [];
  }
  const leftIsInside = clipArea > 0;
  let output: Point2D[] = subject.map((point) => ({ x: point.x, y: point.y }));
  for (let c = 0; c < clip.length; c += 1) {
    const c0 = clip[c];
    const c1 = clip[(c + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) {
      break;
    }
    let previous = input[input.length - 1];
    for (const current of input) {
      const currentIn = insideHalfPlane(current, c0, c1, leftIsInside);
      const previousIn = insideHalfPlane(previous, c0, c1, leftIsInside);
      if (currentIn) {
        if (!previousIn) {
          output.push(lineIntersection(previous, current, c0, c1));
        }
        output.push(current);
      } else if (previousIn) {
        output.push(lineIntersection(previous, current, c0, c1));
      }
      previous = current;
    }
  }
  return dedupeRing(output);
}

/** Point is on the interior side of directed clip edge `c0 → c1`. */
function insideHalfPlane(
  point: Point2D,
  c0: Point2D,
  c1: Point2D,
  leftIsInside: boolean,
): boolean {
  const side =
    (c1.x - c0.x) * (point.y - c0.y) - (c1.y - c0.y) * (point.x - c0.x);
  return leftIsInside ? side >= 0 : side <= 0;
}

/** Intersection of segment `s0→s1` with the infinite line `c0→c1`. */
function lineIntersection(
  s0: Point2D,
  s1: Point2D,
  c0: Point2D,
  c1: Point2D,
): Point2D {
  const dxs = s1.x - s0.x;
  const dys = s1.y - s0.y;
  const dxc = c1.x - c0.x;
  const dyc = c1.y - c0.y;
  const den = dxs * dyc - dys * dxc;
  if (den === 0) {
    return { x: s1.x, y: s1.y };
  }
  const t = ((c0.x - s0.x) * dyc - (c0.y - s0.y) * dxc) / den;
  return { x: s0.x + t * dxs, y: s0.y + t * dys };
}

/**
 * Classify-and-stitch Boolean used for union / subtract / xor, and for
 * intersection when the clip is not a single convex ring.
 *
 * Each operand's edges are split at crossings and at foreign vertices that
 * land on an edge. A fragment is kept according to `op` by probing a point
 * just inside the fragment's own ring against the other operand's fill.
 * Surviving directed fragments are walked, turning leftmost at each vertex.
 */
function fragmentBoolean(
  subject: readonly Point2D[][],
  clip: readonly Point2D[][],
  op: BooleanOp,
  subjectFill: FillRule,
  clipFill: FillRule,
): Point2D[][] {
  const splits = collectIntersections(subject, clip);
  const subjectFragments = splitRings(subject, splits.subject);
  const clipFragments = splitRings(clip, splits.clip);

  if (splits.count === 0) {
    return containmentBoolean(subject, clip, op, subjectFill, clipFill);
  }

  const kept: DirectedEdge[] = [];
  keepFragments(subjectFragments, subject, clip, clipFill, op, "subject", kept);
  keepFragments(clipFragments, clip, subject, subjectFill, op, "clip", kept);
  return stitch(kept);
}

/** No-crossing Boolean: each ring is entirely inside or entirely outside. */
function containmentBoolean(
  subject: readonly Point2D[][],
  clip: readonly Point2D[][],
  op: BooleanOp,
  subjectFill: FillRule,
  clipFill: FillRule,
): Point2D[][] {
  const subjectInside = subject.map((ring) => ringOnOrIn(ring, clip, clipFill));
  const clipInside = clip.map((ring) => ringOnOrIn(ring, subject, subjectFill));
  // Mutual containment: identical fills (the two-rect-equal case). Union and
  // intersect are either operand; subtract and xor are empty.
  if (
    subjectInside.every(Boolean) &&
    clipInside.every(Boolean) &&
    subject.length > 0 &&
    clip.length > 0
  ) {
    return op === "intersect" || op === "union"
      ? subject.map((ring) => copyRing(ring, false))
      : [];
  }
  const result: Point2D[][] = [];
  for (let i = 0; i < subject.length; i += 1) {
    const inside = subjectInside[i];
    if (keepWhole("subject", op, inside)) {
      result.push(
        copyRing(subject[i], inside && (op === "xor" || op === "subtract")),
      );
    }
  }
  for (let i = 0; i < clip.length; i += 1) {
    const inside = clipInside[i];
    if (keepWhole("clip", op, inside)) {
      result.push(
        copyRing(clip[i], inside && (op === "xor" || op === "subtract")),
      );
    }
  }
  return result;
}

/**
 * Whether a whole ring of one operand is kept when there are no crossings.
 *
 * `inside` means every vertex is on or in the other operand's fill — identical
 * rectangles are inside each other, and subtract/xor of equals is empty.
 */
function keepWhole(
  side: "subject" | "clip",
  op: BooleanOp,
  inside: boolean,
): boolean {
  if (side === "subject") {
    if (op === "intersect") {
      return inside;
    }
    if (op === "union") {
      return !inside;
    }
    // subtract, xor: keep the ring (xor reverses it when inside)
    return op === "subtract" ? !inside : true;
  }
  if (op === "intersect") {
    return false;
  }
  if (op === "union") {
    return !inside;
  }
  if (op === "subtract") {
    return inside;
  }
  return true;
}

function copyRing(ring: readonly Point2D[], reversed: boolean): Point2D[] {
  const copy = ring.map((point) => ({ x: point.x, y: point.y }));
  if (reversed) {
    copy.reverse();
  }
  return copy;
}

function ringOnOrIn(
  ring: readonly Point2D[],
  other: readonly Point2D[][],
  fill: FillRule,
): boolean {
  return ring.every((point) => onOrIn(point, other, fill));
}

function onOrIn(
  point: Point2D,
  rings: readonly Point2D[][],
  fill: FillRule,
): boolean {
  if (ringsContain(rings, point.x, point.y, fill)) {
    return true;
  }
  for (const ring of rings) {
    if (pointOnRing(point, ring)) {
      return true;
    }
  }
  return false;
}

function keepFragments(
  fragments: readonly RingFragment[],
  ownRings: readonly Point2D[][],
  otherRings: readonly Point2D[][],
  otherFill: FillRule,
  op: BooleanOp,
  side: "subject" | "clip",
  out: DirectedEdge[],
): void {
  for (const fragment of fragments) {
    if (samePoint(fragment.a, fragment.b)) {
      continue;
    }
    const inside = probeInside(
      fragment,
      ownRings[fragment.ring],
      otherRings,
      otherFill,
    );
    const keep = classifyFragment(side, op, inside);
    if (keep === "drop") {
      continue;
    }
    if (keep === "reverse") {
      out.push({ a: fragment.b, b: fragment.a });
    } else {
      out.push({ a: fragment.a, b: fragment.b });
    }
  }
}

type Keep = "keep" | "reverse" | "drop";

function classifyFragment(
  side: "subject" | "clip",
  op: BooleanOp,
  inside: boolean,
): Keep {
  if (side === "subject") {
    switch (op) {
      case "intersect":
        return inside ? "keep" : "drop";
      case "union":
        return inside ? "drop" : "keep";
      case "subtract":
        return inside ? "drop" : "keep";
      case "xor":
        return inside ? "reverse" : "keep";
    }
  }
  switch (op) {
    case "intersect":
      return inside ? "keep" : "drop";
    case "union":
      return inside ? "drop" : "keep";
    case "subtract":
      return inside ? "reverse" : "drop";
    case "xor":
      return inside ? "reverse" : "keep";
  }
}

/**
 * Probes a point just toward the fragment's own interior, so a shared
 * boundary is classified from the filled side rather than "on the line".
 */
function probeInside(
  fragment: RingFragment,
  ownRing: readonly Point2D[],
  other: readonly Point2D[][],
  otherFill: FillRule,
): boolean {
  const dx = fragment.b.x - fragment.a.x;
  const dy = fragment.b.y - fragment.a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return false;
  }
  const midX = (fragment.a.x + fragment.b.x) / 2;
  const midY = (fragment.a.y + fragment.b.y) / 2;
  const inward = doubleArea(ownRing) >= 0 ? 1 : -1;
  const px = midX - inward * (dy / length) * INTERIOR_NUDGE;
  const py = midY + inward * (dx / length) * INTERIOR_NUDGE;
  return ringsContain(other, px, py, otherFill);
}

/** Whether `(px, py)` is inside the filled region of `rings`. */
export function ringsContain(
  rings: readonly (readonly Point2D[])[],
  px: number,
  py: number,
  fill: FillRule,
): boolean {
  if (fill === "even-odd") {
    let inside = false;
    for (const ring of rings) {
      if (windingNumber(px, py, ring) !== 0) {
        inside = !inside;
      }
    }
    return inside;
  }
  let winding = 0;
  for (const ring of rings) {
    winding += windingNumber(px, py, ring);
  }
  return winding !== 0;
}

function windingNumber(
  px: number,
  py: number,
  ring: readonly Point2D[],
): number {
  let winding = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) {
        winding += 1;
      }
    } else if (b.y <= py && side < 0) {
      winding -= 1;
    }
  }
  return winding;
}

interface DirectedEdge {
  a: Point2D;
  b: Point2D;
}

interface RingFragment extends DirectedEdge {
  ring: number;
}

interface EdgeSplits {
  readonly subject: Map<string, Point2D[]>;
  readonly clip: Map<string, Point2D[]>;
  readonly count: number;
}

function edgeKey(ring: number, edge: number): string {
  return `${String(ring)}:${String(edge)}`;
}

function collectIntersections(
  subject: readonly Point2D[][],
  clip: readonly Point2D[][],
): EdgeSplits {
  const subjectSplits = new Map<string, Point2D[]>();
  const clipSplits = new Map<string, Point2D[]>();
  const pool: Point2D[] = [];
  let count = 0;

  const add = (
    map: Map<string, Point2D[]>,
    ring: number,
    edge: number,
    point: Point2D,
  ): void => {
    const key = edgeKey(ring, edge);
    const list = map.get(key);
    const snapped = snapPoint(point, pool);
    if (list === undefined) {
      map.set(key, [snapped]);
    } else if (!list.some((existing) => samePoint(existing, snapped))) {
      list.push(snapped);
    }
  };

  for (let si = 0; si < subject.length; si += 1) {
    const sRing = subject[si];
    for (let se = 0; se < sRing.length; se += 1) {
      const s0 = sRing[se];
      const s1 = sRing[(se + 1) % sRing.length];
      for (let ci = 0; ci < clip.length; ci += 1) {
        const cRing = clip[ci];
        for (let ce = 0; ce < cRing.length; ce += 1) {
          const c0 = cRing[ce];
          const c1 = cRing[(ce + 1) % cRing.length];
          const hit = segmentIntersection(s0, s1, c0, c1);
          if (hit !== undefined) {
            // A shared vertex (t = 0 or 1 on both edges) is not a crossing —
            // identical rectangles meet at every corner and must fall through
            // to the containment Boolean, not an empty stitch.
            const proper =
              (hit.tA > 0 && hit.tA < 1) || (hit.tB > 0 && hit.tB < 1);
            if (proper) {
              count += 1;
            }
            if (hit.tA > 0 && hit.tA < 1) {
              add(subjectSplits, si, se, hit.point);
            }
            if (hit.tB > 0 && hit.tB < 1) {
              add(clipSplits, ci, ce, hit.point);
            }
          }
        }
        for (const vertex of cRing) {
          const t = parameterOnSegment(vertex, s0, s1);
          if (t !== undefined && t > 0 && t < 1) {
            count += 1;
            add(subjectSplits, si, se, vertex);
          }
        }
      }
    }
  }

  for (let ci = 0; ci < clip.length; ci += 1) {
    const cRing = clip[ci];
    for (let ce = 0; ce < cRing.length; ce += 1) {
      const c0 = cRing[ce];
      const c1 = cRing[(ce + 1) % cRing.length];
      for (const sRing of subject) {
        for (const vertex of sRing) {
          const t = parameterOnSegment(vertex, c0, c1);
          if (t !== undefined && t > 0 && t < 1) {
            count += 1;
            add(clipSplits, ci, ce, vertex);
          }
        }
      }
    }
  }

  return { subject: subjectSplits, clip: clipSplits, count };
}

function splitRings(
  rings: readonly Point2D[][],
  splits: Map<string, Point2D[]>,
): RingFragment[] {
  const fragments: RingFragment[] = [];
  for (let r = 0; r < rings.length; r += 1) {
    const ring = rings[r];
    for (let e = 0; e < ring.length; e += 1) {
      const a = ring[e];
      const b = ring[(e + 1) % ring.length];
      const extras = splits.get(edgeKey(r, e)) ?? [];
      const ordered = [a, ...sortAlong(extras, a, b), b];
      for (let i = 0; i + 1 < ordered.length; i += 1) {
        if (!samePoint(ordered[i], ordered[i + 1])) {
          fragments.push({ ring: r, a: ordered[i], b: ordered[i + 1] });
        }
      }
    }
  }
  return fragments;
}

function sortAlong(
  points: readonly Point2D[],
  a: Point2D,
  b: Point2D,
): Point2D[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return points.slice().sort((p, q) => {
    const tp = (p.x - a.x) * dx + (p.y - a.y) * dy;
    const tq = (q.x - a.x) * dx + (q.y - a.y) * dy;
    return tp - tq;
  });
}

function segmentIntersection(
  a0: Point2D,
  a1: Point2D,
  b0: Point2D,
  b1: Point2D,
): { point: Point2D; tA: number; tB: number } | undefined {
  const dxa = a1.x - a0.x;
  const dya = a1.y - a0.y;
  const dxb = b1.x - b0.x;
  const dyb = b1.y - b0.y;
  const den = dxa * dyb - dya * dxb;
  if (den === 0) {
    return undefined;
  }
  const tA = ((b0.x - a0.x) * dyb - (b0.y - a0.y) * dxb) / den;
  const tB = ((b0.x - a0.x) * dya - (b0.y - a0.y) * dxa) / den;
  if (tA < 0 || tA > 1 || tB < 0 || tB > 1) {
    return undefined;
  }
  return { point: { x: a0.x + tA * dxa, y: a0.y + tA * dya }, tA, tB };
}

function parameterOnSegment(
  point: Point2D,
  a: Point2D,
  b: Point2D,
): number | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return samePoint(point, a) ? 0 : undefined;
  }
  const cross = (point.x - a.x) * dy - (point.y - a.y) * dx;
  if (Math.abs(cross) > SNAP * Math.hypot(dx, dy)) {
    return undefined;
  }
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  if (t < 0 || t > 1) {
    return undefined;
  }
  return t;
}

function pointOnRing(point: Point2D, ring: readonly Point2D[]): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const t = parameterOnSegment(point, ring[i], ring[(i + 1) % ring.length]);
    if (t !== undefined) {
      return true;
    }
  }
  return false;
}

function snapPoint(point: Point2D, pool: Point2D[]): Point2D {
  for (const existing of pool) {
    if (
      Math.abs(existing.x - point.x) <= SNAP &&
      Math.abs(existing.y - point.y) <= SNAP
    ) {
      return existing;
    }
  }
  const fresh = { x: point.x, y: point.y };
  pool.push(fresh);
  return fresh;
}

function stitch(edges: readonly DirectedEdge[]): Point2D[][] {
  const unused = edges.map((edge) => ({ a: edge.a, b: edge.b }));
  const contours: Point2D[][] = [];

  const takeStarting = (): DirectedEdge | undefined => {
    let best: number = -1;
    for (let i = 0; i < unused.length; i += 1) {
      if (
        best < 0 ||
        comparePoints(unused[i].a, unused[best].a) < 0 ||
        (comparePoints(unused[i].a, unused[best].a) === 0 &&
          comparePoints(unused[i].b, unused[best].b) < 0)
      ) {
        best = i;
      }
    }
    if (best < 0) {
      return undefined;
    }
    return unused.splice(best, 1)[0];
  };

  while (unused.length > 0) {
    const start = takeStarting();
    if (start === undefined) {
      break;
    }
    const contour: Point2D[] = [{ x: start.a.x, y: start.a.y }];
    let current = start;
    let guard = unused.length + 2;
    for (;;) {
      contour.push({ x: current.b.x, y: current.b.y });
      if (samePoint(current.b, start.a) && contour.length > 2) {
        contour.pop();
        break;
      }
      const incomingX = current.b.x - current.a.x;
      const incomingY = current.b.y - current.a.y;
      const nextIndex = pickLeftmost(unused, current.b, incomingX, incomingY);
      if (nextIndex < 0) {
        break;
      }
      current = unused.splice(nextIndex, 1)[0];
      guard -= 1;
      if (guard < 0) {
        break;
      }
    }
    if (contour.length >= 3 && doubleArea(contour) !== 0) {
      contours.push(contour);
    }
  }
  return contours;
}

function pickLeftmost(
  unused: readonly DirectedEdge[],
  at: Point2D,
  incomingX: number,
  incomingY: number,
): number {
  let best = -1;
  let bestAngle = -Infinity;
  for (let i = 0; i < unused.length; i += 1) {
    if (!samePoint(unused[i].a, at)) {
      continue;
    }
    const ox = unused[i].b.x - unused[i].a.x;
    const oy = unused[i].b.y - unused[i].a.y;
    const angle = Math.atan2(
      incomingX * oy - incomingY * ox,
      incomingX * ox + incomingY * oy,
    );
    if (angle > bestAngle) {
      bestAngle = angle;
      best = i;
    }
  }
  return best;
}

function finalize(rings: readonly Point2D[][]): Point2D[][] {
  const normalised = rings
    .map((ring) => rotateLex(dedupeRing(ring)))
    .filter((ring) => ring.length >= 3 && doubleArea(ring) !== 0);
  normalised.sort(compareRings);
  return normalised;
}

function rotateLex(ring: Point2D[]): Point2D[] {
  if (ring.length === 0) {
    return ring;
  }
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) {
    if (comparePoints(ring[i], ring[best]) < 0) {
      best = i;
    }
  }
  if (best === 0) {
    return ring;
  }
  return ring.slice(best).concat(ring.slice(0, best));
}

function compareRings(a: readonly Point2D[], b: readonly Point2D[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const cmp = comparePoints(a[i], b[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return a.length - b.length;
}

function comparePoints(a: Point2D, b: Point2D): number {
  if (a.x !== b.x) {
    return a.x < b.x ? -1 : 1;
  }
  if (a.y !== b.y) {
    return a.y < b.y ? -1 : 1;
  }
  return 0;
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return a.x === b.x && a.y === b.y;
}

function doubleArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}
