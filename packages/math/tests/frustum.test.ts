/**
 * `Frustum` — plane extraction and the sphere test (§87, R-8).
 *
 * The plane extraction is checked against an *independent* description of the
 * same volume rather than against itself: an orthographic projection's clip
 * planes are known in closed form (`x = left`, `x = right`, and so on in camera
 * space), so every plane can be asserted as a number rather than compared with
 * a second implementation of the same formula. That is the same technique
 * `look-at.test.ts` uses for `gluLookAt`, and for the same reason — a test that
 * recomputes the thing it is testing proves only that the code is consistent
 * with itself.
 */

import { describe, expect, it } from "vitest";

import {
  constructionCount,
  Frustum,
  Matrix4,
  resetConstructionCount,
  Vector3,
} from "../src/index.js";

/** The six planes as `[nx, ny, nz, d]` tuples, for readable assertions. */
function planesOf(frustum: Frustum): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 24; i += 4) {
    out.push([...frustum.planes.slice(i, i + 4)]);
  }
  return out;
}

/** An orthographic view-projection with the camera at the origin. */
function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near = 0.1,
  far = 100,
): Matrix4 {
  return new Matrix4().setOrthographic(left, right, bottom, top, near, far);
}

describe("Frustum — plane extraction (§87)", () => {
  it("extracts the six planes of an orthographic box in closed form", () => {
    // Camera at the origin looking down −Z, so the box is
    // `x ∈ [-2, 3]`, `y ∈ [-1, 4]`, `z ∈ [-100, -0.1]`.
    const frustum = new Frustum().setFromViewProjection(
      orthographic(-2, 3, -1, 4),
    );

    const planes = planesOf(frustum);
    expect(planes.slice(0, 4)).toEqual([
      // left: `x ≥ -2` — inward normal +X, distance 2.
      [1, 0, 0, 2],
      // right: `x ≤ 3`.
      [-1, 0, 0, 3],
      // bottom: `y ≥ -1`.
      [0, 1, 0, 1],
      // top: `y ≤ 4`.
      [0, -1, 0, 4],
    ]);
    // near: `z ≤ -0.1` — the camera looks down −Z, so the inward normal is −Z
    // and a point exactly on the near plane has distance 0. The depth planes
    // are the two the projection reaches through a `1 / (far - near)`, so their
    // offsets carry rounding where the four side planes are exact.
    expect(planes[4].slice(0, 3)).toEqual([0, 0, -1]);
    expect(planes[4][3]).toBeCloseTo(-0.1, 12);
    // far: `z ≥ -100`.
    expect(planes[5].slice(0, 3)).toEqual([0, 0, 1]);
    expect(planes[5][3]).toBeCloseTo(100, 12);
  });

  it("puts the near plane at z = 0 under the WebGPU depth convention", () => {
    const projection = orthographic(-1, 1, -1, 1, 2, 10);
    const webgpu = new Matrix4().setOrthographic(
      -1,
      1,
      -1,
      1,
      2,
      10,
      "zero-to-one",
    );

    const gl = planesOf(new Frustum().setFromViewProjection(projection));
    const wgpu = planesOf(
      new Frustum().setFromViewProjection(webgpu, "zero-to-one"),
    );

    // Both conventions bound the same volume; only the arithmetic that gets
    // there differs, which is exactly what the parameter exists for.
    expect(wgpu).toEqual(gl);
    expect(gl[4]).toEqual([0, 0, -1, -2]);
    expect(gl[5]).toEqual([0, 0, 1, 10]);
  });

  it("reading the wrong depth convention moves only the near plane", () => {
    const webgpu = new Matrix4().setOrthographic(
      -1,
      1,
      -1,
      1,
      2,
      10,
      "zero-to-one",
    );

    // Deliberately mis-declared: the four side planes and the far plane survive
    // it, which is why the parameter defaults rather than being required — a
    // caller that forgets it on a WebGL matrix (the default) is right, and one
    // that forgets it on a WebGPU matrix loses the near plane only.
    const wrong = planesOf(new Frustum().setFromViewProjection(webgpu));
    const right = planesOf(
      new Frustum().setFromViewProjection(webgpu, "zero-to-one"),
    );

    expect(wrong.slice(0, 4)).toEqual(right.slice(0, 4));
    expect(wrong[5]).toEqual(right[5]);
    expect(wrong[4]).not.toEqual(right[4]);
  });

  it("normalizes every plane, so a distance is in world units", () => {
    // A perspective projection's side planes are not axis-aligned, so this is
    // where an unnormalized extraction would show: the normals must be unit
    // length whatever the field of view.
    const frustum = new Frustum().setFromViewProjection(
      new Matrix4().setPerspective(Math.PI / 3, 16 / 9, 0.5, 500),
    );

    for (const [nx, ny, nz] of planesOf(frustum)) {
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 12);
    }
  });

  it("composes with a view matrix: the planes move with the camera", () => {
    const projection = orthographic(-1, 1, -1, 1);
    const view = new Matrix4();
    // A camera at `(5, 0, 0)`: `view` is the inverse of its world transform.
    view.elements[12] = -5;

    const frustum = new Frustum().setFromViewProjection(
      new Matrix4().copy(projection).multiply(view),
    );

    // `x ≥ 4` and `x ≤ 6` in world space.
    expect(planesOf(frustum)[0]).toEqual([1, 0, 0, -4]);
    expect(planesOf(frustum)[1]).toEqual([-1, 0, 0, 6]);
  });
});

describe("Frustum.intersectsSphere (§87)", () => {
  const frustum = new Frustum().setFromViewProjection(
    orthographic(-2, 2, -2, 2, 1, 10),
  );

  it("keeps a sphere inside the volume", () => {
    expect(frustum.intersectsSphere(new Vector3(0, 0, -5), 0.5)).toBe(true);
  });

  it("keeps a sphere that only straddles a plane", () => {
    // Centre one unit outside the right plane, radius 1.5: the sphere crosses
    // it, so part of the volume it bounds is visible.
    expect(frustum.intersectsSphere(new Vector3(3, 0, -5), 1.5)).toBe(true);
  });

  it("rejects a sphere wholly beyond one plane", () => {
    expect(frustum.intersectsSphere(new Vector3(4, 0, -5), 1)).toBe(false);
    expect(frustum.intersectsSphere(new Vector3(0, -4, -5), 1)).toBe(false);
  });

  it("rejects a sphere in front of the near plane and behind the far one", () => {
    // The near plane is the case every 2D scene with a camera at the origin
    // hits: content at `z = 0` is in front of it and draws nothing.
    expect(frustum.intersectsSphere(new Vector3(0, 0, 0), 0.5)).toBe(false);
    expect(frustum.intersectsSphere(new Vector3(0, 0, -20), 1)).toBe(false);
  });

  it("treats a sphere exactly touching a plane as visible", () => {
    // Distance to the right plane is exactly `-radius`, and the test is `<`, so
    // a tangent sphere is kept. The inclusive side is the safe side.
    expect(frustum.intersectsSphere(new Vector3(3, 0, -5), 1)).toBe(true);
  });

  it("keeps everything when the centre or the radius is not a number", () => {
    // §61 forbids throwing inside a frame and §85's refusals do not apply to a
    // filter that runs there, so the contract is "fail towards drawing".
    expect(frustum.intersectsSphere(new Vector3(NaN, 0, -5), 1)).toBe(true);
    expect(frustum.intersectsSphere(new Vector3(40, 0, -5), NaN)).toBe(true);
    expect(frustum.intersectsSphere(new Vector3(40, 0, -5), Infinity)).toBe(
      true,
    );
  });
});

describe("Frustum — degenerate matrices cull nothing (§61, §85)", () => {
  it("keeps every sphere for an all-zero matrix", () => {
    const zero = new Matrix4();
    zero.elements.fill(0);

    const frustum = new Frustum().setFromViewProjection(zero);

    expect(planesOf(frustum)).toEqual([
      [0, 0, 0, Infinity],
      [0, 0, 0, Infinity],
      [0, 0, 0, Infinity],
      [0, 0, 0, Infinity],
      [0, 0, 0, Infinity],
      [0, 0, 0, Infinity],
    ]);
    expect(frustum.intersectsSphere(new Vector3(1e9, 1e9, 1e9), 0)).toBe(true);
  });

  it("keeps every sphere for a matrix carrying NaN", () => {
    const broken = new Matrix4();
    broken.elements[0] = NaN;

    const frustum = new Frustum().setFromViewProjection(broken);

    expect(frustum.intersectsSphere(new Vector3(0, 0, 0), 0)).toBe(true);
  });

  it("keeps every sphere for the identity, which bounds the NDC cube", () => {
    // Not degenerate — the identity is a legal view-projection, and its frustum
    // is the unit cube. Stated here because it is what a camera double with an
    // unwritten projection matrix produces, and a reader hitting that in a test
    // should find the answer written down.
    const frustum = new Frustum().setFromViewProjection(new Matrix4());

    expect(frustum.intersectsSphere(new Vector3(0, 0, 0), 0)).toBe(true);
    expect(frustum.intersectsSphere(new Vector3(2, 0, 0), 0.5)).toBe(false);
  });
});

describe("Frustum — allocation and reuse (§7b, plan D7)", () => {
  it("reuses one plane array across rebuilds", () => {
    const frustum = new Frustum();
    const planes = frustum.planes;

    frustum.setFromViewProjection(orthographic(-1, 1, -1, 1));
    frustum.setFromViewProjection(orthographic(-9, 9, -9, 9));

    expect(frustum.planes).toBe(planes);
    expect(planes[3]).toBe(9);
  });

  it("returns itself, so extraction chains", () => {
    const frustum = new Frustum();
    expect(frustum.setFromViewProjection(new Matrix4())).toBe(frustum);
  });

  it("reports its own construction to the §83 counter, and rebuilds do not", () => {
    // Dogfood cycle 10: this constructor was the one math constructor that did
    // not call `noteConstruction`, so a per-view `new Frustum()` — which does
    // allocate a `Float64Array(24)` — was invisible to the audit that exists to
    // catch exactly that. A gauge that cannot move is dead, not stable.
    resetConstructionCount();
    const frustum = new Frustum();
    expect(constructionCount()).toBe(1);

    // the build itself stays allocation-free (the Matrix4 argument is the only
    // other construction, so the delta is 1, not 2)
    resetConstructionCount();
    const viewProjection = new Matrix4();
    frustum.setFromViewProjection(viewProjection);
    frustum.setFromViewProjection(viewProjection);
    expect(constructionCount()).toBe(1);
  });
});
