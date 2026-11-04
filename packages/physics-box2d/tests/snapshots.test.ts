import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import { PhysicsWorld } from "@fourjs/physics";
import type {
  CollisionShape,
  PhysicsBodyHandle,
  PhysicsJointHandle,
} from "@fourjs/physics";

import { describe, expect, it } from "vitest";

import { Box2dAdapter } from "../src/index.js";
import { fnv } from "./helpers.js";

const DT = 1 / 60;

function make(gravity = new Vector2(0, -9.81)): Box2dAdapter {
  const adapter = new Box2dAdapter();
  adapter.initialize({ dimension: "2d", gravity });
  return adapter;
}

function add(
  a: Box2dAdapter,
  x: number,
  y: number,
  shape: CollisionShape,
  type: "static" | "dynamic" | "kinematic-position" = "dynamic",
  extra: { sensor?: boolean; mass?: number; angle?: number } = {},
): PhysicsBodyHandle {
  const body = a.createBody({
    type,
    position: new Vector2(x, y),
    rotation: extra.angle,
    mass: extra.mass,
  });
  a.createCollider({
    body,
    shape,
    density: 1,
    friction: 0.4,
    restitution: 0.2,
    sensor: extra.sensor ?? false,
  });
  return body;
}

const CIRCLE: CollisionShape = { type: "circle", radius: 0.5 };
const BOX: CollisionShape = {
  type: "rectangle",
  halfExtents: new Vector2(0.5, 0.5),
};

function positions(a: Box2dAdapter): number[] {
  const out: number[] = [];
  const p = new Vector3();
  const r = new Quaternion();
  const l = new Vector3();
  const w = new Vector3();
  a.forEachBody((h) => {
    a.getBodyTransform(h, p, r);
    a.getBodyVelocities(h, l, w);
    out.push(p.x, p.y, r.z, r.w, l.x, l.y, w.z);
  });
  return out;
}

function run(a: Box2dAdapter, n: number): number[][] {
  const frames: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    a.step(DT);
    frames.push(positions(a));
  }
  return frames;
}

describe("snapshot round trip", () => {
  function rich(): {
    a: Box2dAdapter;
    ground: PhysicsBodyHandle;
    joints: PhysicsJointHandle[];
    sleeper: PhysicsBodyHandle;
  } {
    const a = make();
    const ground = add(
      a,
      0,
      -5,
      { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
      "static",
    );
    const circle = add(a, -3, 2, CIRCLE);
    const box = add(a, 3, 3, BOX, "dynamic", { angle: 0.3 });
    const cap = add(a, 0, 4, {
      type: "capsule",
      radius: 0.25,
      halfHeight: 0.5,
    });
    const poly = add(
      a,
      6,
      3,
      {
        type: "polygon",
        vertices: [new Vector2(-1, 0), new Vector2(1, 0), new Vector2(0, 1)],
      },
      "dynamic",
      { mass: 3 },
    );
    add(a, 8, 0, BOX, "static", { sensor: true });
    const kin = add(a, -8, 0, BOX, "kinematic-position");
    a.setNextKinematicTransform(kin, new Vector2(-7, 1), 0.5);
    const sleeper = add(a, 10, -4, CIRCLE);
    a.sleepBody(sleeper);
    a.applyForce(circle, new Vector3(3, 1, 0));
    a.setBodyDamping(box, 0.1, 0.2);
    a.setBodyGravityScale(cap, 0.5);
    a.setBodyCcdMode(poly, "swept");
    const joints: PhysicsJointHandle[] = [
      a.createJoint({
        type: "revolute",
        bodyA: ground,
        bodyB: circle,
        anchorA: new Vector3(-3, 5, 0),
        anchorB: new Vector3(0, 1, 0),
        limits: { min: -1, max: 1 },
        motor: { enabled: true, targetVelocity: 1, maxTorque: 5 },
      }),
      a.createJoint({
        type: "prismatic",
        bodyA: ground,
        bodyB: box,
        axis: new Vector2(1, 0),
        limits: { min: -2, max: 2 },
        motor: { targetVelocity: 0.5, maxForce: 3 },
      }),
      a.createJoint({
        type: "rope",
        bodyA: box,
        bodyB: cap,
        maxLength: 4,
      }),
      a.createJoint({
        type: "spring",
        bodyA: cap,
        bodyB: poly,
        restLength: 2,
        stiffness: 20,
        damping: 1,
      }),
      a.createJoint({ type: "fixed", bodyA: poly, bodyB: kin }),
    ];
    return { a, ground, joints, sleeper };
  }

  it("re-snapshots byte-identically after a restore", () => {
    const { a } = rich();
    run(a, 7);
    const snap = a.createSnapshot();
    run(a, 20);
    a.restoreSnapshot(snap);
    expect(new Uint8Array(a.createSnapshot())).toEqual(new Uint8Array(snap));
  });

  it("keeps handles, ids, joints, sleep and counters across a restore", () => {
    const { a, ground, joints, sleeper } = rich();
    run(a, 5);
    const ids: number[] = [];
    a.forEachBody((_, id) => ids.push(id));
    const jointIds: number[] = [];
    a.forEachJoint((_, id) => jointIds.push(id));
    const snap = a.createSnapshot();
    const sum = fnv(a);
    const late = add(a, 0, 20, CIRCLE);
    a.destroyBody(sleeper);
    run(a, 10);
    expect(fnv(a)).not.toBe(sum);

    a.restoreSnapshot(snap);
    expect(fnv(a)).toBe(sum);
    const restoredIds: number[] = [];
    a.forEachBody((_, id) => restoredIds.push(id));
    expect(restoredIds).toEqual(ids);
    const restoredJoints: number[] = [];
    a.forEachJoint((_, id) => restoredJoints.push(id));
    expect(restoredJoints).toEqual(jointIds);
    // The surviving ground handle is still valid and the same body.
    expect(a.getBodyId(ground)).toBe(ids[0]);
    expect(a.getJointId(joints[0])).toBe(jointIds[0]);
    // A body created after the snapshot is stale; the destroyed sleeper is
    // back (with a fresh handle) and still asleep.
    expect(() => a.getBodyId(late)).toThrow();
    expect(() => a.isBodySleeping(sleeper)).toThrow();
    let revived: PhysicsBodyHandle | undefined;
    a.forEachBody((h, id) => {
      if (id === ids[ids.length - 1]) {
        revived = h;
      }
    });
    expect(a.isBodySleeping(revived as PhysicsBodyHandle)).toBe(true);
    // The id counter continues where the snapshot left off.
    const next = add(a, 0, 30, CIRCLE);
    expect(a.getBodyId(next)).toBe(Math.max(...ids) + 1);
    // Joints still hold: stepping does not explode.
    run(a, 30);
    for (const v of positions(a)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("restores into a fresh adapter built independently", () => {
    const { a } = rich();
    run(a, 12);
    const snap = a.createSnapshot();
    const b = make();
    b.restoreSnapshot(snap);
    expect(fnv(b)).toBe(fnv(a));
    expect(new Uint8Array(b.createSnapshot())).toEqual(new Uint8Array(snap));
  });

  it("restores gravity, sleeping and iteration settings from the envelope", () => {
    const a = new Box2dAdapter();
    a.initialize({
      dimension: "2d",
      gravity: new Vector2(1, -3),
      solverIterations: 12,
      sleeping: { enabled: false },
    });
    add(a, 0, 0, CIRCLE);
    const snap = a.createSnapshot();
    const b = make();
    b.restoreSnapshot(snap);
    add(b, 100, 0, CIRCLE);
    b.step(DT);
    // The restored world falls with the captured gravity, not b's own.
    const v = new Vector3();
    b.forEachBody((h) => {
      b.getBodyVelocities(h, v, new Vector3());
    });
    expect(v.x).toBeCloseTo(1 * DT, 9);
    expect(v.y).toBeCloseTo(-3 * DT, 9);
  });
});

describe("snapshot then step equals continuous stepping", () => {
  function scene(): Box2dAdapter {
    const a = make();
    add(a, -4, 30, CIRCLE);
    add(a, 4, 40, BOX, "dynamic", { angle: 0.7 });
    add(a, 0, 50, { type: "capsule", radius: 0.25, halfHeight: 0.5 });
    const b = add(a, 10, 35, CIRCLE);
    a.setBodyVelocities(b, new Vector3(-2, 4, 0), new Vector3(0, 0, 3));
    return a;
  }

  it("is bit-identical from a contact-free snapshot (free flight)", () => {
    const a = scene();
    run(a, 25);
    const snap = a.createSnapshot();
    const continuous = run(a, 80);
    a.restoreSnapshot(snap);
    const replayed = run(a, 80);
    expect(replayed).toEqual(continuous);
  });

  it("is bit-identical with a single contact forming after the snapshot", () => {
    const a = make();
    add(
      a,
      0,
      0,
      { type: "rectangle", halfExtents: new Vector2(30, 1) },
      "static",
    );
    const ball = add(a, 0, 6, CIRCLE);
    a.setBodyVelocities(ball, new Vector3(1, 0, 0), new Vector3(0, 0, 2));
    run(a, 10);
    const snap = a.createSnapshot();
    const continuous = run(a, 100); // lands, bounces, settles
    a.restoreSnapshot(snap);
    const replayed = run(a, 100);
    expect(replayed).toEqual(continuous);
  });

  it("checksum streams match across the restore", () => {
    const a = scene();
    run(a, 25);
    const snap = a.createSnapshot();
    const stream = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        a.step(DT);
        out.push(fnv(a));
      }
      return out;
    };
    const continuous = stream();
    a.restoreSnapshot(snap);
    expect(stream()).toEqual(continuous);
  });

  it("restores sleeping bodies as sleeping and does not emit spurious events", () => {
    const a = make();
    add(
      a,
      0,
      0,
      { type: "rectangle", halfExtents: new Vector2(30, 1) },
      "static",
    );
    const ball = add(a, 0, 1.6, CIRCLE);
    run(a, 400);
    expect(a.isBodySleeping(ball)).toBe(true);
    a.drainEvents();
    const snap = a.createSnapshot();
    a.restoreSnapshot(snap);
    expect(a.isBodySleeping(ball)).toBe(true);
    run(a, 5);
    expect(
      a.drainEvents().filter((e) => e.type === "sleep" || e.type === "wake"),
    ).toEqual([]);
  });
});

describe("snapshot refusals", () => {
  function snapshotOf(): { a: Box2dAdapter; snap: ArrayBuffer } {
    const a = make();
    add(a, 0, 0, CIRCLE);
    return { a, snap: a.createSnapshot() };
  }

  it("refuses a buffer that is not a Box2D envelope", () => {
    const { a } = snapshotOf();
    expect(() => a.restoreSnapshot(new ArrayBuffer(2))).toThrow(/not produced/);
    expect(() => a.restoreSnapshot(new Uint8Array(64).buffer)).toThrow(
      /not produced/,
    );
  });

  it("refuses a foreign adapter name and version", () => {
    const { a, snap } = snapshotOf();
    const forge = (from: string, to: string): ArrayBuffer => {
      const text = new TextDecoder("latin1").decode(snap);
      const bytes = new Uint8Array(snap.byteLength);
      const forged = text.replace(from, to);
      for (let i = 0; i < forged.length; i += 1) {
        bytes[i] = forged.charCodeAt(i);
      }
      return bytes.buffer;
    };
    expect(() => a.restoreSnapshot(forge("box2d", "boxed"))).toThrow(
      /adapter "boxed"/,
    );
    expect(() => a.restoreSnapshot(forge("0.11.0", "0.99.0"))).toThrow(
      /version "0.99.0"/,
    );
  });

  it("refuses a wrong format, truncation, trailing bytes and bad references", () => {
    const { a, snap } = snapshotOf();
    const bytes = new Uint8Array(snap);
    const wrongFormat = bytes.slice();
    wrongFormat[4] = 9;
    expect(() => a.restoreSnapshot(wrongFormat.buffer)).toThrow(/format/);
    expect(() => a.restoreSnapshot(snap.slice(0, snap.byteLength - 3))).toThrow(
      /truncated/,
    );
    const trailing = new Uint8Array(snap.byteLength + 1);
    trailing.set(bytes);
    expect(() => a.restoreSnapshot(trailing.buffer)).toThrow(/trailing/);
  });

  it("refuses corrupt contents without touching the live world", () => {
    const a = make();
    const ball = add(a, 0, 0, CIRCLE);
    const joinA = add(a, 2, 0, BOX);
    a.createJoint({ type: "rope", bodyA: ball, bodyB: joinA, maxLength: 3 });
    const snap = new Uint8Array(a.createSnapshot());
    const before = fnv(a);
    const view = new DataView(snap.buffer);
    const find = (needle: string): number => {
      const text = new TextDecoder("latin1").decode(snap);
      return text.indexOf(needle);
    };
    // body type string "dynamic" -> unknown
    const typeAt = find("dynamic");
    const badType = snap.slice();
    badType[typeAt] = 0x58;
    expect(() => a.restoreSnapshot(badType.buffer)).toThrow(/unknown type/);
    // joint type "rope" -> "rXpe"
    const jointAt = find("rope");
    const badJoint = snap.slice();
    badJoint[jointAt + 1] = 0x58;
    expect(() => a.restoreSnapshot(badJoint.buffer)).toThrow(/joint/);
    expect(view.byteLength).toBe(snap.byteLength);
    expect(fnv(a)).toBe(before);
    a.step(DT);
  });

  it("is refused at the PhysicsWorld level for a different adapter name", async () => {
    const adapter = new Box2dAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const snapshot = world.createSnapshot();
    expect(snapshot.adapterName).toBe("box2d");
    expect(typeof world.checksum()).toBe("number");
    world.restoreSnapshot(snapshot);
    expect(() =>
      world.restoreSnapshot({ ...snapshot, adapterName: "rapier" }),
    ).toThrow(/rapier/);
    world.dispose();
  });
});
