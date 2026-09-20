import { beforeEach, describe, expect, it } from "vitest";

import {
  constructionCount,
  resetConstructionCount,
  Vector2,
  Vector3,
  Vector4,
} from "../src/index.js";

describe("Vector2", () => {
  it("defaults every component to zero and stores constructor arguments", () => {
    const zero = new Vector2();
    expect([zero.x, zero.y]).toEqual([0, 0]);
    const v = new Vector2(1, -2);
    expect(v.x).toBe(1);
    expect(v.y).toBe(-2);
  });

  it("set overwrites both components and returns this", () => {
    const v = new Vector2(1, 2);
    expect(v.set(-3, 4)).toBe(v);
    expect(v.x).toBe(-3);
    expect(v.y).toBe(4);
  });

  it("copy takes the components of the source without linking the objects", () => {
    const source = new Vector2(5, 6);
    const target = new Vector2();
    expect(target.copy(source)).toBe(target);
    expect(target.x).toBe(5);
    expect(target.y).toBe(6);
    source.set(0, 0);
    expect(target.x).toBe(5);
  });

  it("clone allocates an independent copy without the change hook", () => {
    const v = new Vector2(7, 8);
    v.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = v.clone();
    expect(copy).not.toBe(v);
    expect(copy.x).toBe(7);
    expect(copy.y).toBe(8);
    expect(copy.onChanged).toBeUndefined();
    copy.set(1, 1);
    expect(v.x).toBe(7);
  });

  it("add and sub work component-wise and return this", () => {
    const v = new Vector2(1, 2);
    expect(v.add(new Vector2(10, 20))).toBe(v);
    expect([v.x, v.y]).toEqual([11, 22]);
    expect(v.sub(new Vector2(1, 2))).toBe(v);
    expect([v.x, v.y]).toEqual([10, 20]);
  });

  it("scale multiplies every component", () => {
    const v = new Vector2(2, -3);
    expect(v.scale(-2)).toBe(v);
    expect([v.x, v.y]).toEqual([-4, 6]);
  });

  it("dot returns the scalar product and does not mutate", () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(3, 4);
    expect(a.dot(b)).toBe(11);
    expect([a.x, a.y]).toEqual([1, 2]);
    expect(new Vector2(1, 0).dot(new Vector2(0, 1))).toBe(0);
  });

  it("lengthSq and length report known magnitudes", () => {
    const v = new Vector2(3, 4);
    expect(v.lengthSq()).toBe(25);
    expect(v.length()).toBe(5);
    expect(new Vector2().length()).toBe(0);
  });

  it("normalize produces a unit vector", () => {
    const v = new Vector2(3, 4).normalize();
    expect(v.x).toBeCloseTo(0.6, 12);
    expect(v.y).toBeCloseTo(0.8, 12);
    expect(v.length()).toBeCloseTo(1, 12);
  });

  it("normalize leaves a zero-length vector at zero", () => {
    const v = new Vector2().normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(Number.isNaN(v.x)).toBe(false);
  });

  it("lerp mutates this toward the target", () => {
    const target = new Vector2(10, 20);
    const v = new Vector2(0, 0);
    expect(v.lerp(target, 0)).toBe(v);
    expect([v.x, v.y]).toEqual([0, 0]);
    v.lerp(target, 0.5);
    expect([v.x, v.y]).toEqual([5, 10]);
    v.set(0, 0).lerp(target, 1);
    expect([v.x, v.y]).toEqual([10, 20]);
    expect([target.x, target.y]).toEqual([10, 20]);
  });

  it("lerp extrapolates outside [0, 1] without clamping", () => {
    const v = new Vector2(0, 0).lerp(new Vector2(10, 10), 2);
    expect([v.x, v.y]).toEqual([20, 20]);
  });

  it("equalsApprox compares within an absolute tolerance", () => {
    const v = new Vector2(1, 2);
    expect(v.equalsApprox(new Vector2(1, 2))).toBe(true);
    expect(v.equalsApprox(new Vector2(1 + 5e-7, 2 - 5e-7))).toBe(true);
    expect(v.equalsApprox(new Vector2(1 + 2e-6, 2))).toBe(false);
    expect(v.equalsApprox(new Vector2(1.5, 2), 0.5)).toBe(true);
    expect(v.equalsApprox(new Vector2(1.5, 2), 0.4)).toBe(false);
  });
});

describe("Vector3", () => {
  it("defaults every component to zero and stores constructor arguments", () => {
    const zero = new Vector3();
    expect([zero.x, zero.y, zero.z]).toEqual([0, 0, 0]);
    const v = new Vector3(1, -2, 3);
    expect([v.x, v.y, v.z]).toEqual([1, -2, 3]);
  });

  it("set overwrites all components and returns this", () => {
    const v = new Vector3();
    expect(v.set(1, 2, 3)).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it("copy takes the components of the source without linking the objects", () => {
    const source = new Vector3(4, 5, 6);
    const target = new Vector3().copy(source);
    expect([target.x, target.y, target.z]).toEqual([4, 5, 6]);
    source.set(0, 0, 0);
    expect(target.x).toBe(4);
  });

  it("clone allocates an independent copy without the change hook", () => {
    const v = new Vector3(1, 2, 3);
    v.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = v.clone();
    expect(copy).not.toBe(v);
    expect([copy.x, copy.y, copy.z]).toEqual([1, 2, 3]);
    expect(copy.onChanged).toBeUndefined();
  });

  it("add and sub work component-wise and return this", () => {
    const v = new Vector3(1, 2, 3);
    expect(v.add(new Vector3(10, 20, 30))).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([11, 22, 33]);
    expect(v.sub(new Vector3(1, 2, 3))).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([10, 20, 30]);
  });

  it("scale multiplies every component", () => {
    const v = new Vector3(1, -2, 0.5).scale(4);
    expect([v.x, v.y, v.z]).toEqual([4, -8, 2]);
  });

  it("dot returns the scalar product and does not mutate", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, -5, 6);
    expect(a.dot(b)).toBe(12);
    expect([a.x, a.y, a.z]).toEqual([1, 2, 3]);
  });

  it("cross follows the right-hand rule on the basis vectors", () => {
    const x = new Vector3(1, 0, 0);
    const y = new Vector3(0, 1, 0);
    const z = new Vector3(0, 0, 1);
    expect(x.clone().cross(y).equalsApprox(z)).toBe(true);
    expect(y.clone().cross(z).equalsApprox(x)).toBe(true);
    expect(z.clone().cross(x).equalsApprox(y)).toBe(true);
  });

  it("cross computes known values, mutates this, and returns this", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    expect(a.cross(b)).toBe(a);
    expect([a.x, a.y, a.z]).toEqual([-3, 6, -3]);
    expect([b.x, b.y, b.z]).toEqual([4, 5, 6]);
  });

  it("cross is anti-commutative and zero for parallel vectors", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    const ab = a.clone().cross(b);
    const ba = b.clone().cross(a);
    expect(ab.equalsApprox(ba.clone().scale(-1))).toBe(true);
    expect(a.clone().cross(a).equalsApprox(new Vector3())).toBe(true);
    expect(
      a.clone().cross(a.clone().scale(2)).equalsApprox(new Vector3()),
    ).toBe(true);
  });

  it("cross is aliasing-safe: the argument may be the receiver", () => {
    // Every assertion above clones first, so none of them passes the SAME
    // object as both operands — which is exactly the case that was wrong
    // (dogfood cycle 10: `a.cross(a)` on `(1, 2, 3)` returned `(0, -3, -3)`
    // because the receiver was read into scalars and the argument was not).
    const a = new Vector3(1, 2, 3);
    expect(a.cross(a)).toBe(a);
    expect([a.x, a.y, a.z]).toEqual([0, 0, 0]);

    // and the non-aliased result is unchanged by the fix
    const b = new Vector3(1, 2, 3).cross(new Vector3(4, 5, 6));
    expect([b.x, b.y, b.z]).toEqual([-3, 6, -3]);
  });

  it("cross result is perpendicular to both inputs", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(-4, 5, 6);
    const c = a.clone().cross(b);
    expect(c.dot(a)).toBeCloseTo(0, 12);
    expect(c.dot(b)).toBeCloseTo(0, 12);
  });

  it("lengthSq and length report known magnitudes", () => {
    const v = new Vector3(2, 3, 6);
    expect(v.lengthSq()).toBe(49);
    expect(v.length()).toBe(7);
  });

  it("normalize produces a unit vector", () => {
    const v = new Vector3(0, 3, 4).normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBeCloseTo(0.6, 12);
    expect(v.z).toBeCloseTo(0.8, 12);
    expect(v.length()).toBeCloseTo(1, 12);
  });

  it("normalize leaves a zero-length vector at zero", () => {
    const v = new Vector3().normalize();
    expect([v.x, v.y, v.z]).toEqual([0, 0, 0]);
  });

  it("lerp mutates this toward the target", () => {
    const v = new Vector3(0, 0, 0);
    v.lerp(new Vector3(4, 8, 12), 0.25);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it("equalsApprox compares within an absolute tolerance", () => {
    const v = new Vector3(1, 2, 3);
    expect(v.equalsApprox(new Vector3(1, 2, 3))).toBe(true);
    expect(v.equalsApprox(new Vector3(1, 2, 3 + 5e-7))).toBe(true);
    expect(v.equalsApprox(new Vector3(1, 2, 3 + 1e-5))).toBe(false);
    expect(v.equalsApprox(new Vector3(1, 2, 4), 1)).toBe(true);
    // The default tolerance is inclusive: a difference of exactly 1e-6 passes.
    expect(new Vector3().equalsApprox(new Vector3(1e-6, 0, 0))).toBe(true);
    expect(new Vector3().equalsApprox(new Vector3(1.5e-6, 0, 0))).toBe(false);
  });
});

describe("Vector4", () => {
  it("defaults every component to zero and stores constructor arguments", () => {
    const zero = new Vector4();
    expect([zero.x, zero.y, zero.z, zero.w]).toEqual([0, 0, 0, 0]);
    const v = new Vector4(1, 2, 3, 4);
    expect([v.x, v.y, v.z, v.w]).toEqual([1, 2, 3, 4]);
  });

  it("set overwrites all components and returns this", () => {
    const v = new Vector4();
    expect(v.set(1, 2, 3, 4)).toBe(v);
    expect([v.x, v.y, v.z, v.w]).toEqual([1, 2, 3, 4]);
  });

  it("copy takes the components of the source without linking the objects", () => {
    const source = new Vector4(1, 2, 3, 4);
    const target = new Vector4().copy(source);
    expect([target.x, target.y, target.z, target.w]).toEqual([1, 2, 3, 4]);
    source.set(0, 0, 0, 0);
    expect(target.w).toBe(4);
  });

  it("clone allocates an independent copy without the change hook", () => {
    const v = new Vector4(1, 2, 3, 4);
    v.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = v.clone();
    expect(copy).not.toBe(v);
    expect([copy.x, copy.y, copy.z, copy.w]).toEqual([1, 2, 3, 4]);
    expect(copy.onChanged).toBeUndefined();
  });

  it("add and sub work component-wise and return this", () => {
    const v = new Vector4(1, 2, 3, 4);
    expect(v.add(new Vector4(1, 1, 1, 1))).toBe(v);
    expect([v.x, v.y, v.z, v.w]).toEqual([2, 3, 4, 5]);
    v.sub(new Vector4(2, 2, 2, 2));
    expect([v.x, v.y, v.z, v.w]).toEqual([0, 1, 2, 3]);
  });

  it("scale multiplies every component including w", () => {
    const v = new Vector4(1, 2, 3, 4).scale(0.5);
    expect([v.x, v.y, v.z, v.w]).toEqual([0.5, 1, 1.5, 2]);
  });

  it("dot includes the w component and does not mutate", () => {
    const a = new Vector4(1, 2, 3, 4);
    const b = new Vector4(5, 6, 7, 8);
    expect(a.dot(b)).toBe(70);
    expect([a.x, a.y, a.z, a.w]).toEqual([1, 2, 3, 4]);
  });

  it("lengthSq and length report known magnitudes", () => {
    const v = new Vector4(1, 2, 2, 4);
    expect(v.lengthSq()).toBe(25);
    expect(v.length()).toBe(5);
  });

  it("normalize produces a unit vector", () => {
    const v = new Vector4(1, 1, 1, 1).normalize();
    expect([v.x, v.y, v.z, v.w]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(v.length()).toBeCloseTo(1, 12);
  });

  it("normalize leaves a zero-length vector at zero", () => {
    const v = new Vector4().normalize();
    expect([v.x, v.y, v.z, v.w]).toEqual([0, 0, 0, 0]);
  });

  it("lerp mutates this toward the target", () => {
    const v = new Vector4(0, 0, 0, 0).lerp(new Vector4(2, 4, 6, 8), 0.5);
    expect([v.x, v.y, v.z, v.w]).toEqual([1, 2, 3, 4]);
  });

  it("equalsApprox compares within an absolute tolerance", () => {
    const v = new Vector4(1, 2, 3, 4);
    expect(v.equalsApprox(new Vector4(1, 2, 3, 4))).toBe(true);
    expect(v.equalsApprox(new Vector4(1, 2, 3, 4.001))).toBe(false);
    expect(v.equalsApprox(new Vector4(1, 2, 3, 4.001), 0.01)).toBe(true);
  });
});

describe("changed hook (plan D3)", () => {
  it("fires once per Vector2 mutator and never for queries", () => {
    let calls = 0;
    const v = new Vector2(1, 2);
    v.onChanged = () => {
      calls += 1;
    };
    const other = new Vector2(3, 4);

    const mutators: Array<[string, () => void]> = [
      ["set", () => void v.set(1, 2)],
      ["copy", () => void v.copy(other)],
      ["add", () => void v.add(other)],
      ["sub", () => void v.sub(other)],
      ["scale", () => void v.scale(2)],
      ["normalize", () => void v.normalize()],
      ["lerp", () => void v.lerp(other, 0.5)],
    ];
    for (const [name, run] of mutators) {
      const before = calls;
      run();
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        before + 1,
      );
    }
    expect(calls).toBe(mutators.length);

    const after = calls;
    v.clone();
    v.dot(other);
    v.lengthSq();
    v.length();
    v.equalsApprox(other);
    expect(calls).toBe(after);
  });

  it("fires once per Vector3 mutator, cross included, and never for queries", () => {
    let calls = 0;
    const v = new Vector3(1, 2, 3);
    v.onChanged = () => {
      calls += 1;
    };
    const other = new Vector3(4, 5, 6);

    const mutators: Array<[string, () => void]> = [
      ["set", () => void v.set(1, 2, 3)],
      ["copy", () => void v.copy(other)],
      ["add", () => void v.add(other)],
      ["sub", () => void v.sub(other)],
      ["scale", () => void v.scale(2)],
      ["cross", () => void v.cross(other)],
      ["normalize", () => void v.normalize()],
      ["lerp", () => void v.lerp(other, 0.5)],
    ];
    for (const [name, run] of mutators) {
      const before = calls;
      run();
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        before + 1,
      );
    }
    expect(calls).toBe(mutators.length);

    const after = calls;
    v.clone();
    v.dot(other);
    v.lengthSq();
    v.length();
    v.equalsApprox(other);
    expect(calls).toBe(after);
  });

  it("fires once per Vector4 mutator and never for queries", () => {
    let calls = 0;
    const v = new Vector4(1, 2, 3, 4);
    v.onChanged = () => {
      calls += 1;
    };
    const other = new Vector4(5, 6, 7, 8);

    const mutators: Array<[string, () => void]> = [
      ["set", () => void v.set(1, 2, 3, 4)],
      ["copy", () => void v.copy(other)],
      ["add", () => void v.add(other)],
      ["sub", () => void v.sub(other)],
      ["scale", () => void v.scale(2)],
      ["normalize", () => void v.normalize()],
      ["lerp", () => void v.lerp(other, 0.5)],
    ];
    for (const [name, run] of mutators) {
      const before = calls;
      run();
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        before + 1,
      );
    }
    expect(calls).toBe(mutators.length);

    const after = calls;
    v.clone();
    v.dot(other);
    v.lengthSq();
    v.length();
    v.equalsApprox(other);
    expect(calls).toBe(after);
  });

  it("fires on normalize even when the vector is zero-length", () => {
    let calls = 0;
    const v = new Vector3();
    v.onChanged = () => {
      calls += 1;
    };
    v.normalize();
    expect(calls).toBe(1);
  });

  it("does not fire for direct field writes (owners must markDirty)", () => {
    let calls = 0;
    const v = new Vector3();
    v.onChanged = () => {
      calls += 1;
    };
    v.x = 5;
    expect(calls).toBe(0);
  });
});

describe("allocation counter (§7b, §83)", () => {
  beforeEach(() => {
    resetConstructionCount();
  });

  it("counts every vector construction and resets to zero", () => {
    expect(constructionCount()).toBe(0);
    new Vector2();
    new Vector3();
    new Vector4();
    expect(constructionCount()).toBe(3);
    new Vector3(1, 2, 3).clone();
    expect(constructionCount()).toBe(5);
    resetConstructionCount();
    expect(constructionCount()).toBe(0);
  });

  it("performs 1000 iterations of chained ops on scratch vectors with zero constructions", () => {
    const a2 = new Vector2(1, 2);
    const b2 = new Vector2(0.5, -0.25);
    const a3 = new Vector3(1, 2, 3);
    const b3 = new Vector3(0.5, -0.25, 0.125);
    const scratch3 = new Vector3();
    const a4 = new Vector4(1, 2, 3, 4);
    const b4 = new Vector4(0.5, -0.25, 0.125, -0.0625);

    let accumulator = 0;

    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      a2.set(1, 2).add(b2).sub(b2).scale(1.5).normalize().lerp(b2, 0.25);
      accumulator += a2.dot(b2) + a2.lengthSq() + a2.length();
      accumulator += a2.equalsApprox(b2) ? 1 : 0;

      a3.set(1, 2, 3).add(b3).sub(b3).scale(1.5).normalize().lerp(b3, 0.25);
      scratch3.copy(a3).cross(b3);
      accumulator += a3.dot(b3) + scratch3.lengthSq() + scratch3.length();
      accumulator += a3.equalsApprox(b3) ? 1 : 0;

      a4.set(1, 2, 3, 4).add(b4).sub(b4).scale(1.5).normalize().lerp(b4, 0.25);
      accumulator += a4.dot(b4) + a4.lengthSq() + a4.length();
      accumulator += a4.equalsApprox(b4) ? 1 : 0;
    }

    expect(constructionCount()).toBe(0);
    expect(Number.isFinite(accumulator)).toBe(true);
  });
});
