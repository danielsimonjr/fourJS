import { Matrix4, Vector3 } from "@fourjs/math";
import {
  Group,
  OrthographicCamera,
  resolveWorldTransform,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { createPickRay, pick, type Pickable } from "../src/pick.js";

function camera(): OrthographicCamera {
  return new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
    near: 1,
    far: 41,
  });
}

function box(hx = 0.5, hy = 0.5, hz = 0.5): Pickable {
  return {
    node: new Group(),
    boundsMin: new Vector3(-hx, -hy, -hz),
    boundsMax: new Vector3(hx, hy, hz),
  };
}

/** Reference slab test with no broad phase: full inverse, every time. */
function referenceHit(
  cam: OrthographicCamera,
  x: number,
  y: number,
  p: Pickable,
): boolean {
  const o = new Vector3();
  const d = new Vector3();
  createPickRay(cam, x, y, o, d);
  const w = resolveWorldTransform(p.node);
  if (w.determinant() === 0) {
    return false;
  }
  const inv = new Matrix4().copy(w).invert();
  const lo = o.clone().applyMatrix4(inv);
  const ld = d.clone().transformDirection(inv);
  let t0 = 0;
  let t1 = Infinity;
  for (const k of ["x", "y", "z"] as const) {
    if (ld[k] === 0) {
      if (lo[k] < p.boundsMin[k] || lo[k] > p.boundsMax[k]) return false;
      continue;
    }
    let a = (p.boundsMin[k] - lo[k]) / ld[k];
    let b = (p.boundsMax[k] - lo[k]) / ld[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

describe("pick broad phase (M4)", () => {
  it("never rejects a true hit: rotated, sheared-by-rotation, non-uniform scale, translated", () => {
    const cam = camera();
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let hitsSeen = 0;
    for (let n = 0; n < 400; n += 1) {
      const p = box(0.2 + rnd(), 0.2 + rnd(), 0.2 + rnd());
      const t = p.node.transform;
      t.position.set(rnd() * 6 - 3, rnd() * 6 - 3, -5 - rnd() * 10);
      t.rotation.setFromAxisAngle(
        new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        rnd() * 6.28,
      );
      t.scale.set(0.1 + rnd() * 4, 0.1 + rnd() * 4, 0.1 + rnd() * 4);
      for (let k = 0; k < 6; k += 1) {
        const x = rnd() * 2 - 1;
        const y = rnd() * 2 - 1;
        const expected = referenceHit(cam, x, y, p);
        const got = pick(cam, x, y, [p]);
        expect(got.length > 0).toBe(expected);
        hitsSeen += expected ? 1 : 0;
      }
    }
    expect(hitsSeen).toBeGreaterThan(50);
  });

  it("keeps a ray grazing the box corner", () => {
    const cam = camera();
    const p = box(1, 1, 1);
    p.node.transform.position.set(0, 0, -5);
    // Ray x = 0.999999 passes just inside the +x edge; 1.000001 just outside.
    expect(pick(cam, 0.999999 / 4, 0, [p])).toHaveLength(1);
    expect(pick(cam, 1.000001 / 4, 0, [p])).toHaveLength(0);
    p.node.transform.rotation.setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 4,
    );
    // 45 degrees about Z: the corner reaches x = sqrt(2) on the axis.
    expect(pick(cam, (Math.SQRT2 - 1e-6) / 4, 0, [p])).toHaveLength(1);
    expect(pick(cam, (Math.SQRT2 + 1e-6) / 4, 0, [p])).toHaveLength(0);
  });

  it("rejects a distant pickable and still skips singular matrices", () => {
    const cam = camera();
    const far = box();
    far.node.transform.position.set(3, 3, -5);
    const flat = box();
    flat.node.transform.position.set(0, 0, -5);
    flat.node.transform.scale.set(0, 1, 1);
    expect(pick(cam, 0, 0, [far, flat])).toHaveLength(0);
  });

  it("re-inverts after a transform change (cache keyed by worldVersion)", () => {
    const cam = camera();
    const p = box();
    p.node.transform.position.set(0, 0, -5);
    expect(pick(cam, 0, 0, [p])).toHaveLength(1);
    expect(pick(cam, 0, 0, [p])).toHaveLength(1);
    p.node.transform.position.set(3, 0, -5);
    expect(pick(cam, 0, 0, [p])).toHaveLength(0);
    p.node.transform.scale.set(10, 1, 1);
    expect(pick(cam, 0, 0, [p])).toHaveLength(1);
  });
});
