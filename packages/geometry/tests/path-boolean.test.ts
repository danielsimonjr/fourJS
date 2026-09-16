/**
 * Unit tests for §51 Boolean operations (`R-23`).
 *
 * The required cases are two overlapping axis-aligned rectangles for all four
 * ops, and a disjoint union of two contours. Area (shoelace of `fillRings`)
 * is the oracle: vertex lists can grow a collinear extra and still be the
 * same polygon; area cannot.
 */

import { describe, expect, it } from "vitest";

import { Path, booleanOp, type BooleanOp, type Point2D } from "../src/index.js";
import { isConvex, sutherlandHodgman } from "../src/path-boolean.js";

/** Axis-aligned rectangle as a closed CCW path. */
function rect(x0: number, y0: number, x1: number, y1: number): Path {
  return new Path()
    .moveTo(x0, y0)
    .lineTo(x1, y0)
    .lineTo(x1, y1)
    .lineTo(x0, y1)
    .close();
}

/** Signed area of a closed ring; positive when counter-clockwise. */
function ringArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Net filled area of a path, holes subtracted. */
function filledArea(path: Path): number {
  let area = 0;
  for (const group of path.fillRings()) {
    area += Math.abs(ringArea(group.outline));
    for (const hole of group.holes) {
      area -= Math.abs(ringArea(hole));
    }
  }
  return area;
}

/** Closed contour count (flatten, open subpaths ignored if < 3). */
function contourCount(path: Path): number {
  return path.flatten().filter((ring) => ring.length >= 3).length;
}

describe("booleanOp — overlapping axis-aligned rects", () => {
  const a = rect(0, 0, 2, 2);
  const b = rect(1, 1, 3, 3);

  it("intersects as the overlapping unit square (Sutherland–Hodgman)", () => {
    const result = booleanOp(a, b, "intersect");
    expect(contourCount(result)).toBe(1);
    expect(filledArea(result)).toBeCloseTo(1, 9);
    const [ring] = result.flatten();
    expect(ring[0]).toEqual({ x: 1, y: 1 });
    expect(isConvex(ring)).toBe(true);
  });

  it("unions as a single hexagon of area 7", () => {
    const result = booleanOp(a, b, "union");
    expect(contourCount(result)).toBe(1);
    expect(filledArea(result)).toBeCloseTo(7, 9);
  });

  it("subtracts as an L of area 3", () => {
    const result = booleanOp(a, b, "subtract");
    expect(contourCount(result)).toBe(1);
    expect(filledArea(result)).toBeCloseTo(3, 9);
  });

  it("xors as two L-shaped contours of total area 6", () => {
    const result = booleanOp(a, b, "xor");
    expect(contourCount(result)).toBe(2);
    expect(filledArea(result)).toBeCloseTo(6, 9);
  });

  it("is also available as Path methods, leaving the operands untouched", () => {
    const before = a.commands.length;
    expect(filledArea(a.intersect(b))).toBeCloseTo(1, 9);
    expect(filledArea(a.union(b))).toBeCloseTo(7, 9);
    expect(filledArea(a.subtract(b))).toBeCloseTo(3, 9);
    expect(filledArea(a.xor(b))).toBeCloseTo(6, 9);
    expect(filledArea(a.booleanOp(b, "intersect"))).toBeCloseTo(1, 9);
    expect(a.commands.length).toBe(before);
  });
});

describe("booleanOp — disjoint and containment", () => {
  it("unions two disjoint rects as two contours", () => {
    const result = booleanOp(rect(0, 0, 2, 2), rect(5, 0, 7, 2), "union");
    expect(contourCount(result)).toBe(2);
    expect(filledArea(result)).toBeCloseTo(8, 9);
  });

  it("intersects disjoint rects as empty", () => {
    const result = booleanOp(rect(0, 0, 2, 2), rect(5, 0, 7, 2), "intersect");
    expect(result.isEmpty).toBe(true);
    expect(filledArea(result)).toBe(0);
  });

  it("subtracts a disjoint clip as the subject unchanged in area", () => {
    const result = booleanOp(rect(0, 0, 2, 2), rect(5, 0, 7, 2), "subtract");
    expect(contourCount(result)).toBe(1);
    expect(filledArea(result)).toBeCloseTo(4, 9);
  });

  it("xors two disjoint rects as two contours", () => {
    const result = booleanOp(rect(0, 0, 2, 2), rect(5, 0, 7, 2), "xor");
    expect(contourCount(result)).toBe(2);
    expect(filledArea(result)).toBeCloseTo(8, 9);
  });

  it("treats identical rects as equal fills", () => {
    const a = rect(0, 0, 2, 2);
    const b = rect(0, 0, 2, 2);
    expect(filledArea(booleanOp(a, b, "intersect"))).toBeCloseTo(4, 9);
    expect(filledArea(booleanOp(a, b, "union"))).toBeCloseTo(4, 9);
    expect(booleanOp(a, b, "subtract").isEmpty).toBe(true);
    expect(booleanOp(a, b, "xor").isEmpty).toBe(true);
  });

  it("handles a subject strictly inside the clip", () => {
    const inner = rect(1, 1, 2, 2);
    const outer = rect(0, 0, 4, 4);
    expect(filledArea(booleanOp(inner, outer, "intersect"))).toBeCloseTo(1, 9);
    expect(filledArea(booleanOp(inner, outer, "union"))).toBeCloseTo(16, 9);
    expect(booleanOp(inner, outer, "subtract").isEmpty).toBe(true);
    expect(filledArea(booleanOp(outer, inner, "subtract"))).toBeCloseTo(15, 9);
    expect(filledArea(booleanOp(outer, inner, "xor"))).toBeCloseTo(15, 9);
  });

  it("returns the other operand when one side is empty", () => {
    expect(
      booleanOp(new Path(), rect(0, 0, 1, 1), "union").flatten(),
    ).toHaveLength(1);
    expect(
      booleanOp(rect(0, 0, 1, 1), new Path(), "union").flatten(),
    ).toHaveLength(1);
    expect(booleanOp(new Path(), rect(0, 0, 1, 1), "intersect").isEmpty).toBe(
      true,
    );
    expect(
      booleanOp(rect(0, 0, 1, 1), new Path(), "subtract").flatten(),
    ).toHaveLength(1);
    expect(
      booleanOp(new Path(), rect(0, 0, 1, 1), "xor").flatten(),
    ).toHaveLength(1);
  });
});

describe("booleanOp — concave clip (even-odd fragment path)", () => {
  /**
   * C-shaped clip opening to the +X side — concave, so intersection must
   * not take Sutherland–Hodgman (which would clip against every half-plane
   * and eat the bottom arm).
   */
  function cee(): Path {
    return new Path()
      .moveTo(0, 0)
      .lineTo(3, 0)
      .lineTo(3, 1)
      .lineTo(1, 1)
      .lineTo(1, 2)
      .lineTo(3, 2)
      .lineTo(3, 3)
      .lineTo(0, 3)
      .close();
  }

  it("intersects a rect against a concave clip without swallowing the arm", () => {
    expect(isConvex(cee().flatten()[0])).toBe(false);
    const hit = booleanOp(rect(2, -1, 4, 1.5), cee(), "intersect");
    expect(filledArea(hit)).toBeCloseTo(1, 6);
  });

  it("honours even-odd on a self-overlapping pair of rings", () => {
    const a = new Path({ fillRule: "even-odd" })
      .moveTo(0, 0)
      .lineTo(4, 0)
      .lineTo(4, 4)
      .lineTo(0, 4)
      .close();
    const b = rect(1, 1, 3, 3);
    expect(filledArea(booleanOp(a, b, "intersect"))).toBeCloseTo(4, 9);
  });
});

describe("booleanOp — refusals and flattening", () => {
  it("refuses an unknown operation", () => {
    expect(() =>
      booleanOp(rect(0, 0, 1, 1), rect(0, 0, 1, 1), "bogus" as BooleanOp),
    ).toThrow(/unknown operation/);
  });

  it("refuses a non-positive tolerance", () => {
    expect(() =>
      booleanOp(rect(0, 0, 1, 1), rect(0, 0, 1, 1), "union", 0),
    ).toThrow(/tolerance/);
  });

  it("treats an open subpath as closed (the fill rule)", () => {
    const open = new Path().moveTo(0, 0).lineTo(2, 0).lineTo(2, 2).lineTo(0, 2);
    const result = booleanOp(open, rect(1, 1, 3, 3), "intersect");
    expect(filledArea(result)).toBeCloseTo(1, 9);
  });

  it("drops a degenerate zero-area ring", () => {
    const line = new Path().moveTo(0, 0).lineTo(1, 0).lineTo(2, 0).close();
    expect(booleanOp(line, rect(0, 0, 1, 1), "union").flatten()).toHaveLength(
      1,
    );
  });
});

describe("sutherlandHodgman", () => {
  it("clips a subject to a convex clip ring", () => {
    const subject = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const clip = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    const out = sutherlandHodgman(subject, clip);
    expect(Math.abs(ringArea(out))).toBeCloseTo(1, 9);
  });

  it("returns empty when the clip has no area", () => {
    expect(
      sutherlandHodgman(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      ),
    ).toEqual([]);
  });

  it("accepts a clockwise convex clip", () => {
    const subject = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const clip = [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 1 },
    ];
    const out = sutherlandHodgman(subject, clip);
    expect(Math.abs(ringArea(out))).toBeCloseTo(1, 9);
  });
});

describe("booleanOp — vertex-on-edge and winding", () => {
  it("splits when a clip vertex sits on a subject edge", () => {
    // B's left-bottom corner sits on A's right edge.
    const a = rect(0, 0, 2, 2);
    const b = rect(2, 1, 4, 3);
    const union = booleanOp(a, b, "union");
    // They share an edge, not an area — union area is 4 + 4.
    expect(filledArea(union)).toBeCloseTo(8, 6);
  });

  it("sorts two equal-start contours deterministically", () => {
    const a = rect(0, 0, 1, 1);
    const b = rect(2, 0, 3, 1);
    const [first, second] = booleanOp(a, b, "union").flatten();
    expect(first[0].x).toBeLessThanOrEqual(second[0].x);
  });
});
