import { describe, expect, it } from "vitest";

import {
  BufferGeometry,
  boxGeometry,
  circleGeometry2D,
  planeGeometry,
} from "../src/index.js";

/** A minimal valid triangle: one CCW face in the XY plane. */
function triangle(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Reads vertex `index` out of a geometry's position array. */
function vertex(geometry: BufferGeometry, index: number): Point {
  const p = geometry.positions;
  return { x: p[index * 3], y: p[index * 3 + 1], z: p[index * 3 + 2] };
}

/** The three corners of indexed triangle `face`. */
function face(
  geometry: BufferGeometry,
  faceIndex: number,
): [Point, Point, Point] {
  const indices = geometry.indices;
  if (indices === undefined) {
    throw new Error("expected an indexed geometry");
  }
  return [
    vertex(geometry, indices[faceIndex * 3]),
    vertex(geometry, indices[faceIndex * 3 + 1]),
    vertex(geometry, indices[faceIndex * 3 + 2]),
  ];
}

/**
 * `(b - a) × (c - a)` — the un-normalized face normal, computed here rather
 * than with `Vector3.cross` so the winding assertions have ground truth
 * independent of `@fourjs/math`.
 */
function faceNormal(a: Point, b: Point, c: Point): Point {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
}

/** Signed area of a triangle projected on XY; positive when wound CCW. */
function signedAreaXY(a: Point, b: Point, c: Point): number {
  return 0.5 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function faceCount(geometry: BufferGeometry): number {
  return geometry.drawCount / 3;
}

describe("BufferGeometry", () => {
  it("defaults to indexless triangles and reports its counts", () => {
    const geometry = new BufferGeometry({ positions: triangle() });

    expect(geometry.mode).toBe("triangles");
    expect(geometry.indices).toBeUndefined();
    expect(geometry.vertexCount).toBe(3);
    expect(geometry.drawCount).toBe(3);
    expect(geometry.version).toBe(0);
    expect(geometry.disposed).toBe(false);
  });

  it("assigns monotonic, unique, never-reused ids", () => {
    const first = new BufferGeometry({ positions: triangle() });
    const second = new BufferGeometry({ positions: triangle() });

    expect(first.id).toMatch(/^geometry-\d+$/);
    expect(second.id).not.toBe(first.id);

    const ordinal = (g: BufferGeometry): number =>
      Number(g.id.slice("geometry-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);

    first.dispose();
    const third = new BufferGeometry({ positions: triangle() });
    expect(ordinal(third)).toBe(ordinal(second) + 1);
  });

  it("counts indexed draws by index count", () => {
    const geometry = new BufferGeometry({
      positions: triangle(),
      indices: new Uint16Array([0, 1, 2, 2, 1, 0]),
    });

    expect(geometry.vertexCount).toBe(3);
    expect(geometry.drawCount).toBe(6);
  });

  it("accepts line geometry with an even number of elements", () => {
    const geometry = new BufferGeometry({
      positions: new Float32Array([0, 0, 0, 1, 1, 0]),
      mode: "lines",
    });

    expect(geometry.mode).toBe("lines");
    expect(geometry.drawCount).toBe(2);
  });

  describe("validation (§85)", () => {
    it("rejects position arrays that are not xyz triplets", () => {
      expect(
        () => new BufferGeometry({ positions: new Float32Array([0, 0]) }),
      ).toThrow(RangeError);
    });

    it("rejects non-finite positions", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: new Float32Array([0, 0, 0, Number.NaN, 0, 0, 1, 1, 0]),
          }),
      ).toThrow(/must be finite/);
      expect(
        () =>
          new BufferGeometry({
            positions: new Float32Array([
              0,
              0,
              0,
              Number.POSITIVE_INFINITY,
              0,
              0,
              1,
              1,
              0,
            ]),
          }),
      ).toThrow(RangeError);
    });

    it("rejects an index that names a vertex the geometry does not have", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            indices: new Uint16Array([0, 1, 3]),
          }),
      ).toThrow(/invalid geometry indices/);
    });

    it("rejects index and vertex counts that do not fill whole primitives", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            indices: new Uint16Array([0, 1]),
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new BufferGeometry({
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
          }),
      ).toThrow(RangeError);
    });

    it("re-validates through every setter and bumps the version", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      geometry.positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
      expect(geometry.version).toBe(1);

      geometry.indices = new Uint16Array([0, 1, 2]);
      expect(geometry.version).toBe(2);
      expect(geometry.drawCount).toBe(3);

      // Three indices cannot make whole lines.
      expect(() => {
        geometry.mode = "lines";
      }).toThrow(RangeError);
      expect(geometry.mode).toBe("triangles");
      expect(geometry.version).toBe(2);

      geometry.indices = undefined;
      expect(geometry.indices).toBeUndefined();
      expect(geometry.version).toBe(3);
    });
  });

  describe("normals (§53, §68)", () => {
    /** One unit +Z normal per triangle() vertex. */
    function triangleNormals(): Float32Array {
      return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    }

    it("are optional and default to undefined", () => {
      const geometry = new BufferGeometry({ positions: triangle() });
      expect(geometry.normals).toBeUndefined();
    });

    it("are accepted at construction and held by reference", () => {
      const normals = triangleNormals();
      const geometry = new BufferGeometry({
        positions: triangle(),
        normals,
      });
      expect(geometry.normals).toBe(normals);
      expect(geometry.version).toBe(0);
    });

    it("rejects normals that are not index-aligned with positions", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            normals: new Float32Array([0, 0, 1]),
          }),
      ).toThrow(/index-aligned/);
    });

    it("rejects non-finite normals", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            normals: new Float32Array([0, 0, 1, 0, Number.NaN, 1, 0, 0, 1]),
          }),
      ).toThrow(/must be finite/);
    });

    it("validates and bumps the version through the setter", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      geometry.normals = triangleNormals();
      expect(geometry.version).toBe(1);

      // Dropping the attribute is legal and versioned.
      geometry.normals = undefined;
      expect(geometry.normals).toBeUndefined();
      expect(geometry.version).toBe(2);

      // A misaligned assignment throws and leaves the geometry untouched.
      expect(() => {
        geometry.normals = new Float32Array([0, 0, 1]);
      }).toThrow(RangeError);
      expect(geometry.version).toBe(2);
    });

    it("pins positions and normals to the same vertex count", () => {
      const geometry = new BufferGeometry({
        positions: triangle(),
        normals: triangleNormals(),
      });

      // Replacing positions with a different vertex count while normals are
      // present must throw — drop the normals first.
      expect(() => {
        geometry.positions = new Float32Array([
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0,
        ]);
      }).toThrow(/index-aligned/);
      expect(geometry.vertexCount).toBe(3);

      geometry.normals = undefined;
      geometry.positions = new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0,
      ]);
      expect(geometry.vertexCount).toBe(6);
    });
  });

  describe("uvs (§53, §55; R-19)", () => {
    /** One uv pair per triangle() vertex. */
    function triangleUvs(): Float32Array {
      return new Float32Array([0, 0, 1, 0, 0, 1]);
    }

    it("are optional and default to undefined", () => {
      expect(new BufferGeometry({ positions: triangle() }).uvs).toBeUndefined();
    });

    it("are accepted at construction and held by reference", () => {
      const uvs = triangleUvs();
      const geometry = new BufferGeometry({ positions: triangle(), uvs });

      expect(geometry.uvs).toBe(uvs);
      expect(geometry.version).toBe(0);
    });

    it("rejects uvs that are not two floats per vertex", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
          }),
      ).toThrow(/index-aligned/);
    });

    it("rejects non-finite uvs", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            uvs: new Float32Array([0, 0, Number.NaN, 0, 0, 1]),
          }),
      ).toThrow(/must be finite/);
    });

    it("validates and bumps the version through the setter", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      geometry.uvs = triangleUvs();
      expect(geometry.version).toBe(1);

      geometry.uvs = undefined;
      expect(geometry.uvs).toBeUndefined();
      expect(geometry.version).toBe(2);

      expect(() => {
        geometry.uvs = new Float32Array([0, 0]);
      }).toThrow(RangeError);
      expect(geometry.version).toBe(2);
    });

    it("pins positions and uvs to the same vertex count", () => {
      const geometry = new BufferGeometry({
        positions: triangle(),
        uvs: triangleUvs(),
      });

      expect(() => {
        geometry.positions = new Float32Array([
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0,
        ]);
      }).toThrow(/index-aligned/);
      expect(geometry.vertexCount).toBe(3);
    });
  });

  describe("colors (§53, §60a; R-19)", () => {
    /** One straight RGBA per triangle() vertex. */
    function triangleColors(): Float32Array {
      return new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
    }

    it("are optional and default to undefined", () => {
      expect(
        new BufferGeometry({ positions: triangle() }).colors,
      ).toBeUndefined();
    });

    it("are accepted at construction and held by reference", () => {
      const colors = triangleColors();
      const geometry = new BufferGeometry({ positions: triangle(), colors });

      expect(geometry.colors).toBe(colors);
      expect(geometry.version).toBe(0);
    });

    it("rejects colors that are not four floats per vertex", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
          }),
      ).toThrow(/index-aligned/);
    });

    it("rejects non-finite colors", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            colors: new Float32Array([
              1,
              0,
              0,
              1,
              0,
              Number.POSITIVE_INFINITY,
              0,
              1,
              0,
              0,
              1,
              1,
            ]),
          }),
      ).toThrow(/must be finite/);
    });

    it("validates and bumps the version through the setter", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      geometry.colors = triangleColors();
      expect(geometry.version).toBe(1);

      geometry.colors = undefined;
      expect(geometry.colors).toBeUndefined();
      expect(geometry.version).toBe(2);

      expect(() => {
        geometry.colors = new Float32Array([1, 1, 1, 1]);
      }).toThrow(RangeError);
      expect(geometry.version).toBe(2);
    });

    it("survives an index and a mode re-assignment, and dies with dispose", () => {
      // The §113 debug-draw layout (R-35): a line list of coloured endpoints.
      const geometry = new BufferGeometry({
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]),
        mode: "lines",
      });

      geometry.indices = new Uint16Array([0, 1]);
      geometry.mode = "lines";
      expect(geometry.colors?.length).toBe(8);

      geometry.dispose();
      expect(geometry.colors).toBeUndefined();
      expect(geometry.uvs).toBeUndefined();
    });
  });

  describe("joints and weights (§53, §54; RFC 0003)", () => {
    /** Four influences per triangle() vertex. */
    function triangleJoints(): Uint16Array {
      return new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
    }

    function triangleWeights(): Float32Array {
      return new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.25, 0.75, 0, 0]);
    }

    it("are optional and default to undefined", () => {
      const geometry = new BufferGeometry({ positions: triangle() });
      expect(geometry.joints).toBeUndefined();
      expect(geometry.weights).toBeUndefined();
    });

    it("are accepted at construction and held by reference", () => {
      const joints = triangleJoints();
      const weights = triangleWeights();
      const geometry = new BufferGeometry({
        positions: triangle(),
        joints,
        weights,
      });
      expect(geometry.joints).toBe(joints);
      expect(geometry.weights).toBe(weights);
      expect(geometry.version).toBe(0);
    });

    it("rejects joints and weights that are not four per vertex", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            joints: new Uint16Array([0, 1, 2]),
          }),
      ).toThrow(/index-aligned/);
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            weights: new Float32Array([1, 0, 0]),
          }),
      ).toThrow(/index-aligned/);
    });

    it("rejects non-finite weights, and never re-checks integer joints", () => {
      const weights = triangleWeights();
      weights[5] = Number.NaN;
      expect(
        () => new BufferGeometry({ positions: triangle(), weights }),
      ).toThrow(/must be finite/);
      // A Uint16Array cannot carry a non-finite value; the finiteness pass is
      // skipped rather than run for show, so this simply constructs.
      expect(
        new BufferGeometry({
          positions: triangle(),
          joints: triangleJoints(),
        }).joints,
      ).toBeDefined();
    });

    it("does not renormalize weights — the sum is the author's contract", () => {
      const weights = new Float32Array([
        2, 0, 0, 0, 0.1, 0.1, 0, 0, 0, 0, 0, 0,
      ]);
      const geometry = new BufferGeometry({ positions: triangle(), weights });
      expect(geometry.weights).toBe(weights);
      expect(geometry.weights?.[0]).toBe(2);
    });

    it("validates and bumps the version through both setters", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      geometry.joints = triangleJoints();
      expect(geometry.version).toBe(1);
      geometry.weights = triangleWeights();
      expect(geometry.version).toBe(2);

      geometry.joints = undefined;
      geometry.weights = undefined;
      expect(geometry.joints).toBeUndefined();
      expect(geometry.weights).toBeUndefined();
      expect(geometry.version).toBe(4);

      expect(() => {
        geometry.joints = new Uint16Array([0]);
      }).toThrow(RangeError);
      expect(() => {
        geometry.weights = new Float32Array([1]);
      }).toThrow(RangeError);
      expect(geometry.version).toBe(4);
    });

    it("pins positions to the same vertex count while either is present", () => {
      const geometry = new BufferGeometry({
        positions: triangle(),
        joints: triangleJoints(),
        weights: triangleWeights(),
      });
      expect(() => {
        geometry.positions = new Float32Array(18);
      }).toThrow(/index-aligned/);
    });

    it("counts into byteLength, clones deep, and dies with dispose (§83)", () => {
      const geometry = new BufferGeometry({
        positions: triangle(),
        joints: triangleJoints(),
        weights: triangleWeights(),
      });
      // 9 position floats + 12 weights floats at 4 bytes, + 12 uint16 joints.
      expect(geometry.byteLength).toBe(9 * 4 + 12 * 4 + 12 * 2);

      const clone = geometry.clone();
      expect(clone.joints).not.toBe(geometry.joints);
      expect(Array.from(clone.joints ?? [])).toEqual(
        Array.from(geometry.joints ?? []),
      );
      expect(clone.weights).not.toBe(geometry.weights);

      geometry.dispose();
      expect(geometry.joints).toBeUndefined();
      expect(geometry.weights).toBeUndefined();
      expect(geometry.byteLength).toBe(0);
      clone.dispose();
    });
  });

  describe("positions1 and normals1 (§54 GPU morph)", () => {
    it("are optional, held by reference, and bound as extra streams", () => {
      const positions1 = new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]);
      const normals1 = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
      const geometry = new BufferGeometry({
        positions: triangle(),
        positions1,
        normals1,
      });
      expect(geometry.positions1).toBe(positions1);
      expect(geometry.normals1).toBe(normals1);
      expect(geometry.byteLength).toBe(9 * 4 + 9 * 4 + 9 * 4);
      const clone = geometry.clone();
      expect(clone.positions1).not.toBe(positions1);
      expect(Array.from(clone.positions1 ?? [])).toEqual(Array.from(positions1));
      geometry.dispose();
      expect(geometry.positions1).toBeUndefined();
      clone.dispose();
    });

    it("rejects a morph stream that is not index-aligned", () => {
      expect(
        () =>
          new BufferGeometry({
            positions: triangle(),
            positions1: new Float32Array([0, 1, 0]),
          }),
      ).toThrow(/index-aligned/);
    });
  });

  describe("bounds", () => {
    it("computes the axis-aligned box of the positions", () => {
      const geometry = new BufferGeometry({
        positions: new Float32Array([-1, 2, 3, 4, -5, 6, 0, 0, 0]),
      });

      const bounds = geometry.computeBounds();
      expect([bounds.min.x, bounds.min.y, bounds.min.z]).toEqual([-1, -5, 0]);
      expect([bounds.max.x, bounds.max.y, bounds.max.z]).toEqual([4, 2, 6]);
    });

    it("caches by version and recomputes after markDirty", () => {
      const geometry = new BufferGeometry({ positions: triangle() });

      const first = geometry.computeBounds();
      const second = geometry.computeBounds();
      expect(second).toBe(first);
      expect(first.max.x).toBe(1);

      // In-place edit: invisible until it is announced.
      geometry.positions[3] = 5;
      expect(geometry.computeBounds().max.x).toBe(1);

      geometry.markDirty();
      const recomputed = geometry.computeBounds();
      expect(recomputed).toBe(first);
      expect(recomputed.max.x).toBe(5);
    });

    it("returns the empty box for a geometry with no vertices", () => {
      const geometry = new BufferGeometry({ positions: new Float32Array(0) });

      const bounds = geometry.computeBounds();
      expect(bounds.min.x).toBe(Number.POSITIVE_INFINITY);
      expect(bounds.max.x).toBe(Number.NEGATIVE_INFINITY);
    });
  });

  describe("dispose (§83)", () => {
    it("releases the buffers, bumps the version, and is idempotent", () => {
      const geometry = boxGeometry();
      const version = geometry.version;

      geometry.dispose();
      expect(geometry.disposed).toBe(true);
      expect(geometry.positions.length).toBe(0);
      expect(geometry.normals).toBeUndefined();
      expect(geometry.indices).toBeUndefined();
      expect(geometry.drawCount).toBe(0);
      expect(geometry.version).toBe(version + 1);

      geometry.dispose();
      expect(geometry.version).toBe(version + 1);
    });
  });
});

describe("boxGeometry", () => {
  it("builds a unit box from 24 per-face vertices and 12 triangles (§68)", () => {
    const geometry = boxGeometry();

    // 4 vertices per face: corners split so each carries its face's normal
    // (the trade the lighting packet made, 2026-08-04).
    expect(geometry.vertexCount).toBe(24);
    expect(geometry.drawCount).toBe(36);
    expect(geometry.mode).toBe("triangles");
    expect(geometry.indices).toBeInstanceOf(Uint16Array);

    const bounds = geometry.computeBounds();
    expect([bounds.min.x, bounds.min.y, bounds.min.z]).toEqual([
      -0.5, -0.5, -0.5,
    ]);
    expect([bounds.max.x, bounds.max.y, bounds.max.z]).toEqual([0.5, 0.5, 0.5]);
  });

  it("gives every vertex its face's outward unit normal (§68)", () => {
    const geometry = boxGeometry({ width: 2, height: 3, depth: 4 });
    const normals = geometry.normals;
    expect(normals).toBeDefined();
    expect(normals?.length).toBe(geometry.positions.length);

    // Independently derive each vertex's expected normal from its position:
    // a box vertex normal is axis-aligned, so it is the axis on which the
    // authored geometric normal — recomputed here per face from positions —
    // says the face lies.
    for (let f = 0; f < faceCount(geometry); f += 1) {
      const [a, b, c] = face(geometry, f);
      const n = faceNormal(a, b, c);
      const magnitude = Math.hypot(n.x, n.y, n.z);
      const indices = geometry.indices ?? new Uint16Array(0);
      for (const vertex of [
        indices[f * 3],
        indices[f * 3 + 1],
        indices[f * 3 + 2],
      ]) {
        const offset = vertex * 3;
        expect(normals?.[offset]).toBeCloseTo(n.x / magnitude, 12);
        expect(normals?.[offset + 1]).toBeCloseTo(n.y / magnitude, 12);
        expect(normals?.[offset + 2]).toBeCloseTo(n.z / magnitude, 12);
      }
    }
  });

  it("honours per-axis extents and stays centred on the origin", () => {
    const geometry = boxGeometry({ width: 2, height: 4, depth: 6 });

    const bounds = geometry.computeBounds();
    expect([bounds.min.x, bounds.min.y, bounds.min.z]).toEqual([-1, -2, -3]);
    expect([bounds.max.x, bounds.max.y, bounds.max.z]).toEqual([1, 2, 3]);
  });

  it("winds every face counter-clockwise as seen from outside (§7a)", () => {
    const geometry = boxGeometry({ width: 2, height: 3, depth: 4 });

    const seen = new Map<string, number>();
    for (let f = 0; f < faceCount(geometry); f += 1) {
      const [a, b, c] = face(geometry, f);
      const n = faceNormal(a, b, c);
      const centroid = {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
      };

      // A CCW-from-outside face has a normal pointing away from the centre,
      // and the box is centred on the origin, so the centroid *is* the
      // outward direction.
      const outward = n.x * centroid.x + n.y * centroid.y + n.z * centroid.z;
      expect(outward, `face ${String(f)} winds inwards`).toBeGreaterThan(0);

      // Each face normal is axis-aligned.
      const magnitude = Math.hypot(n.x, n.y, n.z);
      const axis =
        Math.abs(n.x) === magnitude
          ? `x${n.x > 0 ? "+" : "-"}`
          : Math.abs(n.y) === magnitude
            ? `y${n.y > 0 ? "+" : "-"}`
            : `z${n.z > 0 ? "+" : "-"}`;
      expect(magnitude).toBeGreaterThan(0);
      seen.set(axis, (seen.get(axis) ?? 0) + 1);
    }

    // Six faces, two triangles each.
    expect([...seen.keys()].sort()).toEqual([
      "x+",
      "x-",
      "y+",
      "y-",
      "z+",
      "z-",
    ]);
    expect([...seen.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("maps the whole texture onto each of the six faces (§53, R-19)", () => {
    const geometry = boxGeometry({ width: 2, height: 3, depth: 4 });
    const uvs = geometry.uvs;

    expect(uvs?.length).toBe(geometry.vertexCount * 2);
    // Each face's four corners carry the same unit square, in the order the
    // positions list them: bottom-left, bottom-right, top-right, top-left.
    for (let f = 0; f < 6; f += 1) {
      const base = f * 4 * 2;
      expect([...(uvs ?? []).slice(base, base + 8)]).toEqual([
        0, 0, 1, 0, 1, 1, 0, 1,
      ]);
    }
  });

  it("indexes only vertices it has", () => {
    const geometry = boxGeometry();
    const indices = geometry.indices;
    expect(indices).toBeDefined();
    for (const index of indices ?? []) {
      expect(index).toBeLessThan(geometry.vertexCount);
    }
  });

  it("rejects non-positive or non-finite extents", () => {
    expect(() => boxGeometry({ width: 0 })).toThrow(RangeError);
    expect(() => boxGeometry({ height: -1 })).toThrow(RangeError);
    expect(() => boxGeometry({ depth: Number.NaN })).toThrow(RangeError);
  });
});

describe("planeGeometry", () => {
  it("builds a centred XY quad facing +Z", () => {
    const geometry = planeGeometry({ width: 4, height: 2 });

    expect(geometry.vertexCount).toBe(4);
    expect(geometry.drawCount).toBe(6);

    const bounds = geometry.computeBounds();
    expect([bounds.min.x, bounds.min.y, bounds.min.z]).toEqual([-2, -1, 0]);
    expect([bounds.max.x, bounds.max.y, bounds.max.z]).toEqual([2, 1, 0]);

    let area = 0;
    for (let f = 0; f < faceCount(geometry); f += 1) {
      const [a, b, c] = face(geometry, f);
      expect(faceNormal(a, b, c).z, `face ${String(f)}`).toBeGreaterThan(0);
      area += signedAreaXY(a, b, c);
    }
    expect(area).toBeCloseTo(8, 12);
  });

  it("carries a +Z unit normal on every vertex (§68)", () => {
    const geometry = planeGeometry({ width: 4, height: 2 });
    const normals = geometry.normals;
    expect(normals).toBeDefined();
    expect(normals?.length).toBe(geometry.positions.length);
    for (let i = 0; i < (normals?.length ?? 0); i += 3) {
      expect([normals?.[i], normals?.[i + 1], normals?.[i + 2]]).toEqual([
        0, 0, 1,
      ]);
    }
  });

  it("maps its own unit square, v = 0 at the bottom edge (§53, R-19)", () => {
    const geometry = planeGeometry({ width: 4, height: 2 });

    expect([...(geometry.uvs ?? [])]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // The uv of every vertex agrees with its position in the quad, which is
    // what makes a textured plane and a same-sized `Sprite` show a texture
    // identically (see `@fourjs/render`'s `sprite.ts`).
    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const v = vertex(geometry, i);
      expect(geometry.uvs?.[i * 2]).toBeCloseTo((v.x + 2) / 4, 12);
      expect(geometry.uvs?.[i * 2 + 1]).toBeCloseTo((v.y + 1) / 2, 12);
    }
  });

  it("defaults to a unit quad", () => {
    const bounds = planeGeometry().computeBounds();
    expect([bounds.min.x, bounds.min.y]).toEqual([-0.5, -0.5]);
    expect([bounds.max.x, bounds.max.y]).toEqual([0.5, 0.5]);
  });

  it("rejects non-positive extents", () => {
    expect(() => planeGeometry({ width: 0 })).toThrow(RangeError);
    expect(() => planeGeometry({ height: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });
});

describe("circleGeometry2D", () => {
  it("builds a centre-plus-rim fan as indexed triangles", () => {
    const geometry = circleGeometry2D();

    expect(geometry.vertexCount).toBe(33);
    expect(geometry.drawCount).toBe(96);
    expect(geometry.indices).toBeInstanceOf(Uint16Array);

    // The centre is vertex 0 and every triangle starts there.
    expect(vertex(geometry, 0)).toEqual({ x: 0, y: 0, z: 0 });
    for (let f = 0; f < faceCount(geometry); f += 1) {
      expect(geometry.indices?.[f * 3]).toBe(0);
    }

    // Every rim vertex is exactly `radius` from the centre, in the XY plane.
    for (let i = 1; i < geometry.vertexCount; i += 1) {
      const v = vertex(geometry, i);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
      expect(v.z).toBe(0);
    }
  });

  it("winds counter-clockwise and covers the inscribed polygon's area", () => {
    const segments = 12;
    const radius = 3;
    const geometry = circleGeometry2D({ radius, segments });

    let area = 0;
    for (let f = 0; f < faceCount(geometry); f += 1) {
      const [a, b, c] = face(geometry, f);
      const signed = signedAreaXY(a, b, c);
      expect(signed, `face ${String(f)} winds clockwise`).toBeGreaterThan(0);
      area += signed;
    }

    // Regular n-gon inscribed in a circle: (n / 2) · r² · sin(2π / n).
    const expected =
      (segments / 2) * radius * radius * Math.sin((2 * Math.PI) / segments);
    // Loose only because the positions are stored as Float32 (§53): the
    // relative error here is ~4e-8.
    expect(area).toBeCloseTo(expected, 5);
  });

  it("closes the fan by wrapping the last triangle onto the first rim vertex", () => {
    const geometry = circleGeometry2D({ segments: 5 });
    const indices = geometry.indices;

    expect(indices?.[4 * 3 + 1]).toBe(5);
    expect(indices?.[4 * 3 + 2]).toBe(1);
    for (const index of indices ?? []) {
      expect(index).toBeLessThan(geometry.vertexCount);
    }
  });

  it("stays normal-less — 2D shapes are unlit (§120, 2026-08-04)", () => {
    expect(circleGeometry2D().normals).toBeUndefined();
  });

  it("maps the bounding square, centre at (0.5, 0.5) (§53, R-19)", () => {
    const radius = 3;
    const geometry = circleGeometry2D({ radius, segments: 8 });
    const uvs = geometry.uvs;

    expect(uvs?.length).toBe(geometry.vertexCount * 2);
    expect([uvs?.[0], uvs?.[1]]).toEqual([0.5, 0.5]);
    for (let i = 1; i < geometry.vertexCount; i += 1) {
      const v = vertex(geometry, i);
      expect(uvs?.[i * 2]).toBeCloseTo(0.5 + v.x / (2 * radius), 6);
      expect(uvs?.[i * 2 + 1]).toBeCloseTo(0.5 + v.y / (2 * radius), 6);
    }
  });

  it("widens the index type when 16 bits cannot address every vertex", () => {
    // 65 536 rim vertices plus the centre needs indices above 65 535.
    const geometry = circleGeometry2D({ segments: 65536 });

    expect(geometry.vertexCount).toBe(65537);
    expect(geometry.indices).toBeInstanceOf(Uint32Array);
    expect(geometry.indices?.[geometry.drawCount - 2]).toBe(65536);
  });

  it("rejects radii and segment counts that cannot make a shape", () => {
    expect(() => circleGeometry2D({ radius: 0 })).toThrow(RangeError);
    expect(() => circleGeometry2D({ segments: 2 })).toThrow(RangeError);
    expect(() => circleGeometry2D({ segments: 8.5 })).toThrow(RangeError);
    expect(() => circleGeometry2D({ segments: Number.NaN })).toThrow(
      RangeError,
    );
  });
});
