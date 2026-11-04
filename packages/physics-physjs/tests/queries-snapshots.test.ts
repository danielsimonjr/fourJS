import { isFourError } from "@fourjs/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@fourjs/math";
import type { CollisionShape, PhysicsBodyHandle } from "@fourjs/physics";
import { describe, expect, it } from "vitest";

import { PhysJSAdapter2D, PhysJSAdapter3D } from "../src/index.js";

type Adapter = PhysJSAdapter2D | PhysJSAdapter3D;
type Dim = "2d" | "3d";
const DT = 1 / 60;

function make(d: Dim): Adapter {
  const a = d === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
  a.initialize({ dimension: d });
  return a;
}

const BALL: Record<Dim, CollisionShape> = {
  "2d": { type: "circle", radius: 0.5 },
  "3d": { type: "sphere", radius: 0.5 },
};

function add(
  a: Adapter,
  d: Dim,
  type: "static" | "dynamic",
  at: Vector3,
): PhysicsBodyHandle {
  const body = a.createBody({ type, position: at });
  a.createCollider({ body, shape: BALL[d] });
  return body;
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isFourError(error) ? error.code : "other";
  }
  return undefined;
}

function run(a: Adapter, n: number): void {
  for (let i = 0; i < n; i += 1) {
    a.step(DT);
    a.drainEvents();
  }
}

function diag(): Matrix3 {
  const m = new Matrix3();
  m.elements.fill(0);
  m.elements[0] = 2;
  m.elements[4] = 3;
  m.elements[8] = 4;
  return m;
}

function scene(d: Dim) {
  const a = make(d);
  const near = add(a, d, "static", new Vector3(3, 0, 0));
  const far = add(a, d, "static", new Vector3(6, 0, 0));
  const fall = add(a, d, "dynamic", new Vector3(0, 10, 0));
  const anchor = add(a, d, "static", new Vector3(0, 20, 0));
  a.createJoint({
    type: "spring",
    bodyA: anchor,
    bodyB: fall,
    restLength: 5,
    stiffness: 3,
  });
  return { a, near, far, fall };
}

for (const d of ["2d", "3d"] as const) {
  describe(`${d} queries`, () => {
    it("raycast hits nearest, all, sorted, limited, and misses", () => {
      const { a, near, far } = scene(d);
      const origin = new Vector3(0, 0, 0);
      const direction = new Vector3(1, 0, 0);
      const first = a.raycast({ origin, direction, mode: "first" });
      expect(first).toHaveLength(1);
      expect(first[0].body).toBe(near);
      expect(first[0].distance).toBeCloseTo(2.5, 6);
      expect(first[0].point.x).toBeCloseTo(2.5, 6);
      expect(first[0].normal.x).toBeCloseTo(-1, 6);
      const all = a.raycast({ origin, direction, sorted: true });
      expect(all.map((h) => h.body)).toEqual([near, far]);
      expect(a.raycast({ origin, direction, maxHits: 1 })).toHaveLength(1);
      expect(a.raycast({ origin, direction, maxHits: 0 })).toHaveLength(0);
      expect(a.raycast({ origin, direction, maxDistance: 1 })).toHaveLength(0);
      expect(
        a.raycast({ origin, direction: new Vector3(0, -1, 0) }),
      ).toHaveLength(0);
      // filtered nearest -> the farther one is found on the scratch world
      const skipped = a.raycast({ origin, direction, ignoredBodies: [near] });
      expect(skipped.map((h) => h.body)).toEqual([far]);
      const byPredicate = a.raycast({
        origin,
        direction,
        mode: "first",
        predicate: (c) => c.body !== near,
      });
      expect(byPredicate.map((h) => h.body)).toEqual([far]);
      expect(a.raycast({ origin, direction, collisionGroups: 0 })).toHaveLength(
        0,
      );
      expect(code(() => a.raycast({ origin, direction: new Vector3() }))).toBe(
        "INVALID_APPLICATION_STATE",
      );
    });

    it("overlap and pointQuery hit, miss, filter and cap", () => {
      const { a, near, far } = scene(d);
      const shape: CollisionShape =
        d === "2d"
          ? { type: "circle", radius: 4 }
          : { type: "sphere", radius: 4 };
      const hits = a.overlap({ shape, position: new Vector3(4.5, 0, 0) });
      expect(hits.map((h) => h.body)).toEqual([near, far]);
      expect(
        a.overlap({ shape, position: new Vector3(4.5, 0, 0), maxHits: 1 }),
      ).toHaveLength(1);
      expect(
        a
          .overlap({
            shape,
            position: new Vector3(4.5, 0, 0),
            ignoredBodies: [near],
          })
          .map((h) => h.body),
      ).toEqual([far]);
      expect(
        a.overlap({ shape, position: new Vector3(-50, 0, 0) }),
      ).toHaveLength(0);
      const rotated = a.overlap({
        shape:
          d === "2d"
            ? { type: "rectangle", halfExtents: new Vector2(4, 0.1) }
            : { type: "box", halfExtents: new Vector3(4, 0.1, 0.1) },
        position: new Vector3(4.5, 0, 0),
        rotation: d === "2d" ? 0.1 : new Quaternion(0, 0, 0, 1),
      });
      expect(rotated.length).toBeGreaterThan(0);
      expect(
        code(() =>
          a.overlap({
            shape: { type: "polyline", vertices: [] } as never,
            position: new Vector3(),
          }),
        ),
      ).toBeDefined();

      const inside = a.pointQuery({ point: new Vector3(3.1, 0, 0) });
      expect(inside).toHaveLength(1);
      expect(inside[0].body).toBe(near);
      expect(inside[0].distance).toBe(0);
      expect(inside[0].point.x).toBeCloseTo(3.1, 12);
      expect(a.pointQuery({ point: new Vector3(1, 0, 0) })).toHaveLength(0);
      expect(
        a.pointQuery({ point: new Vector3(3.1, 0, 0), maxHits: 0 }),
      ).toHaveLength(0);
      expect(
        a.pointQuery({ point: new Vector3(3.1, 0, 0), ignoredBodies: [near] }),
      ).toHaveLength(0);
    });

    it("queries are read-only: the checksum stream is identical", () => {
      const run1 = (withQueries: boolean): string[] => {
        const { a } = scene(d);
        const stream: string[] = [];
        for (let i = 0; i < 20; i += 1) {
          if (withQueries) {
            a.raycast({
              origin: new Vector3(0, 0, 0),
              direction: new Vector3(1, 0, 0),
              ignoredBodies: [],
              predicate: () => true,
            });
            a.raycast({
              origin: new Vector3(0, 0, 0),
              direction: new Vector3(1, 0, 0),
              mode: "first",
            });
            a.overlap({
              shape: BALL[d],
              position: new Vector3(3, 0, 0),
            });
            a.pointQuery({ point: new Vector3(3, 0, 0) });
          }
          run(a, 1);
          stream.push(a.checksum());
        }
        return stream;
      };
      expect(run1(true)).toEqual(run1(false));
    });

    it("refuses shapeCast", () => {
      const { a } = scene(d);
      expect(code(() => a.shapeCast({} as never))).toBe("NOT_IMPLEMENTED");
    });
  });

  describe(`${d} snapshots`, () => {
    it("snapshot -> restore -> step is bit-identical to continuous stepping", () => {
      const { a, fall } = scene(d);
      a.applyForce(fall, new Vector3(0.5, 0, 0));
      run(a, 30);
      const snap = a.createSnapshot();
      const before = a.checksum();
      run(a, 40);
      const continuous = a.checksum();
      const pos = new Vector3();
      a.getBodyTransform(fall, pos, new Quaternion());
      const x = pos.x;

      a.restoreSnapshot(snap);
      expect(a.checksum()).toBe(before);
      run(a, 40);
      expect(a.checksum()).toBe(continuous);
      a.getBodyTransform(fall, pos, new Quaternion());
      expect(pos.x).toBe(x);

      // Restoring into a fresh adapter reproduces it too (same id history).
      const fresh = scene(d).a;
      fresh.restoreSnapshot(snap);
      expect(fresh.checksum()).toBe(before);
      run(fresh, 40);
      expect(fresh.checksum()).toBe(continuous);
    });

    it("keeps ids monotonic across restore and kills later records", () => {
      const { a, fall } = scene(d);
      run(a, 5);
      const snap = a.createSnapshot();
      const late = add(a, d, "dynamic", new Vector3(0, 30, 0));
      const lateJoint = a.createJoint({
        type: "fixed",
        bodyA: late,
        bodyB: fall,
      });
      a.destroyBody(fall);
      a.restoreSnapshot(snap);
      expect(code(() => a.getBodyId(late))).toBeDefined();
      expect(code(() => a.getJointId(lateJoint))).toBeDefined();
      // `fall` was destroyed before the restore: its handle stays dead.
      expect(code(() => a.getBodyId(fall))).toBeDefined();
      const next = add(a, d, "dynamic", new Vector3(0, 40, 0));
      expect(a.getBodyId(next)).toBe(5);
      const ids: number[] = [];
      a.forEachBody((_h, id) => ids.push(id));
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
      const cids: number[] = [];
      a.forEachCollider((_h, id) => cids.push(id));
      expect(cids).toEqual([...cids].sort((x, y) => x - y));
    });

    it("restores destroyed bodies, pending kinematic targets and touching pairs", () => {
      const a = make(d);
      const floor = add(a, d, "static", new Vector3(0, 0, 0));
      const dropper = add(a, d, "dynamic", new Vector3(0, 0.9, 0));
      const mover = a.createBody({
        type: "kinematic-position",
        position: new Vector3(20, 0, 0),
      });
      a.createCollider({ body: mover, shape: BALL[d] });
      a.setBodyMassProperties(dropper, 2, undefined, undefined);
      run(a, 10);
      a.setNextKinematicTransform(mover, new Vector3(21, 0, 0));
      const snap = a.createSnapshot();
      const expected = (() => {
        run(a, 5);
        return a.checksum();
      })();
      a.destroyBody(floor);
      a.destroyBody(dropper);
      a.restoreSnapshot(snap);
      run(a, 5);
      expect(a.checksum()).toBe(expected);
      expect(code(() => a.getBodyId(floor))).toBeDefined();
      const ids: number[] = [];
      a.forEachBody((_h, id) => ids.push(id));
      expect(ids).toEqual([1, 2, 3]);
    });

    it("refuses foreign and malformed envelopes", () => {
      const { a } = scene(d);
      const snap = a.createSnapshot();
      const other = scene(d === "2d" ? "3d" : "2d").a;
      expect(code(() => other.restoreSnapshot(snap))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(code(() => a.restoreSnapshot(new ArrayBuffer(4)))).toBe(
        "UNTRUSTED_INPUT_REJECTED",
      );
      const tamper = (
        edit: (v: DataView, b: Uint8Array) => void,
      ): ArrayBuffer => {
        const copy = snap.slice(0);
        edit(new DataView(copy), new Uint8Array(copy));
        return copy;
      };
      expect(
        code(() => a.restoreSnapshot(tamper((v) => v.setUint32(0, 1, true)))),
      ).toBe("INVALID_APPLICATION_STATE");
      expect(
        code(() => a.restoreSnapshot(tamper((v) => v.setUint32(4, 9, true)))),
      ).toBe("SERIALIZATION_VERSION_MISMATCH");
      expect(
        code(() =>
          a.restoreSnapshot(tamper((v) => v.setUint32(12, 1 << 30, true))),
        ),
      ).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(
        code(() => a.restoreSnapshot(tamper((_v, b) => b.fill(0x7e, 16, 24)))),
      ).toBe("UNTRUSTED_INPUT_REJECTED");
      // wrong PhysJS version in the meta
      const meta = new TextEncoder().encode(
        JSON.stringify({ adapter: a.name, version: "0.0.1", bodies: [] }),
      );
      const forged = new ArrayBuffer(16 + meta.byteLength);
      const view = new DataView(forged);
      view.setUint32(0, new DataView(snap).getUint32(0, true), true);
      view.setUint32(4, 1, true);
      view.setUint32(8, meta.byteLength, true);
      new Uint8Array(forged).set(meta, 16);
      expect(code(() => a.restoreSnapshot(forged))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      // corrupt PhysJS bytes under a valid meta
      const metaLen = new DataView(snap).getUint32(8, true);
      const bad = snap.slice(0);
      new Uint8Array(bad).fill(1, 16 + metaLen);
      expect(code(() => a.restoreSnapshot(bad))).toBe(
        "UNTRUSTED_INPUT_REJECTED",
      );
    });
  });
}

describe("joint ids survive restore", () => {
  it("keeps joint handles and ids", () => {
    const { a } = scene("3d");
    const snap = a.createSnapshot();
    const ids: number[] = [];
    a.forEachJoint((_h, id) => ids.push(id));
    a.restoreSnapshot(snap);
    const after: number[] = [];
    a.forEachJoint((h, id) => {
      after.push(id);
      expect(a.getJointId(h)).toBe(id);
    });
    expect(after).toEqual(ids);
  });

  it("rebuilds a joint that the live adapter no longer has", () => {
    const { a, fall } = scene("2d");
    const other = add(a, "2d", "dynamic", new Vector3(5, 5, 0));
    const j = a.createJoint({ type: "fixed", bodyA: other, bodyB: fall });
    const snap = a.createSnapshot();
    a.destroyJoint(j);
    a.restoreSnapshot(snap);
    const ids: number[] = [];
    a.forEachJoint((_h, id) => ids.push(id));
    expect(ids).toEqual([1, 2]);
    expect(code(() => a.getJointId(j))).toBeDefined();
  });
});

describe("authored mass and inertia survive the envelope", () => {
  for (const d of ["2d", "3d"] as const) {
    it(`${d} round-trips through a fresh adapter and dispose kills joints`, () => {
      const build = (): Adapter => {
        const a = make(d);
        const b = a.createBody({
          type: "dynamic",
          mass: 3,
          inertiaTensor: diag(),
          position: new Vector3(0, 5, 0),
        });
        a.createCollider({ body: b, shape: BALL[d] });
        const s = add(a, d, "static", new Vector3(0, 8, 0));
        a.createJoint({
          type: "spring",
          bodyA: s,
          bodyB: b,
          restLength: 1,
          stiffness: 5,
        });
        return a;
      };
      const a = build();
      run(a, 10);
      const snap = a.createSnapshot();
      const fresh = build();
      fresh.restoreSnapshot(snap);
      expect(fresh.checksum()).toBe(a.checksum());
      run(a, 20);
      run(fresh, 20);
      expect(fresh.checksum()).toBe(a.checksum());
      let joint: unknown;
      a.forEachJoint((h) => (joint = h));
      a.dispose();
      expect(code(() => a.getJointId(joint as never))).toBeDefined();
    });
  }
});
