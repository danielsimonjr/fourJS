/**
 * `Rapier2dAdapter` against the **real** Rapier 2D wasm (§37, §108, WP-5.4).
 *
 * There is no fake solver in this file on purpose: the point of an adapter
 * packet is to prove the mapping onto a real engine, and a mock would only
 * re-assert this file's own assumptions. `@fourjs/physics`'s structural
 * `FakeSolverAdapter` (WP-5.3) is where the *contract* is exercised without a
 * solver.
 *
 * ## The discrete expectations these tests are written against
 *
 * Rapier 0.19.3 does **not** integrate a step as one semi-implicit Euler step:
 * `World.step` runs `numSolverIterations` substeps of `dt / numSolverIterations`
 * (4 by default). Measured, then derived:
 *
 * ```text
 * h = dt / S,  K = N * S
 * v_N = g * h * K            = g * dt * N        (identical to the single-step form)
 * y_N = y0 + g * h² * K(K+1)/2                    (NOT g * dt² * N(N+1)/2)
 * ```
 *
 * Linear damping, by contrast, is applied once per **full** step:
 * `v ← v / (1 + dt · damping)`. Both forms are asserted below to a documented
 * tolerance — Rapier stores and integrates in 32-bit floats, so ~1e-5 of
 * absolute drift accumulates over a few hundred substeps.
 */

import { FourError } from "@fourjs/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@fourjs/math";
import { ALL_COLLISION_GROUPS, PhysicsMaterial } from "@fourjs/physics";
import type {
  ColliderDescriptor,
  CollisionEvent,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsEvent,
  PhysicsWorldOptions,
  SleepEvent,
  TriggerEvent,
} from "@fourjs/physics";
import { beforeAll, describe, expect, it } from "vitest";

import {
  initializeRapier2d,
  rapier2dModule,
  rapier2dVersion,
} from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";

/** Rapier 0.19.3's default `World.numSolverIterations` — see the file header. */
const SUBSTEPS = 4;

/** Appendix A gravity, and the value every test below assumes. */
const GRAVITY_Y = -9.81;

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Free-fall position after `steps` steps, in Rapier's substepped form. */
function fallDistance(steps: number, gravity = GRAVITY_Y): number {
  const h = DT / SUBSTEPS;
  const k = steps * SUBSTEPS;
  return (gravity * h * h * k * (k + 1)) / 2;
}

async function createAdapter(
  options?: Partial<PhysicsWorldOptions>,
): Promise<Rapier2dAdapter> {
  const adapter = new Rapier2dAdapter();
  await adapter.initialize({ dimension: "2d", ...options });
  return adapter;
}

/** A static floor whose surface sits at `y = 0`. */
function createFloor(
  adapter: Rapier2dAdapter,
  options: { restitution?: number; friction?: number } = {},
): { body: PhysicsBodyHandle; collider: PhysicsColliderHandle } {
  const body = adapter.createBody({
    type: "static",
    position: new Vector2(0, -0.5),
  });
  const collider = adapter.createCollider({
    body,
    shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
    ...options,
  });
  return { body, collider };
}

function positionOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(body, position, new Quaternion());
  return position;
}

function velocityOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const linear = new Vector3();
  adapter.getBodyVelocities(body, linear, new Vector3());
  return linear;
}

function isCollision(event: PhysicsEvent): event is CollisionEvent {
  return (
    event.type === "collisionstart" ||
    event.type === "collisionstay" ||
    event.type === "collisionend"
  );
}

function isTrigger(event: PhysicsEvent): event is TriggerEvent {
  return event.type === "triggerenter" || event.type === "triggerexit";
}

function isSleep(event: PhysicsEvent): event is SleepEvent {
  return event.type === "sleep" || event.type === "wake";
}

/** Steps `count` times and returns every event drained along the way. */
function stepAndDrain(
  adapter: Rapier2dAdapter,
  count: number,
  delta = DT,
): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    adapter.syncSceneToSolver();
    adapter.step(delta);
    adapter.syncSolverToScene();
    events.push(...adapter.drainEvents());
  }
  return events;
}

beforeAll(async () => {
  await initializeRapier2d();
});

describe("module loading", () => {
  it("caches the module and reports Rapier's own version", async () => {
    const first = await initializeRapier2d();
    const second = await initializeRapier2d();
    expect(second).toBe(first);
    expect(rapier2dModule()).toBe(first);
    expect(rapier2dVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});

describe("capabilities and identity (§37)", () => {
  it("declares an honest, frozen capability record", () => {
    const adapter = new Rapier2dAdapter();
    expect(adapter.name).toBe("rapier2d");
    expect(adapter.capabilities).toEqual({
      dimensions: ["2d"],
      // The plan P6-1 planar tier, landed by WP-6.2; `rapier2d-joints.test.ts`
      // is where each of these is exercised against the wasm.
      jointTypes: ["fixed", "spring", "revolute", "prismatic", "rope"],
      ccdModes: ["disabled", "speculative", "swept"],
      determinism: "same-runtime",
      snapshots: true,
      queries: { raycast: true, shapeCast: true, overlap: true, point: true },
      // Rapier 0.19.3 binds none of these three (§25 rolling/spinning
      // friction, §32 sleeping thresholds), and says so rather than accepting
      // and dropping them — `PhysicsWorld` turns the declaration into a
      // once-per-world warning (2026-08-06).
      tuning: {
        rollingFriction: false,
        spinningFriction: false,
        sleepThresholds: false,
        jointMotorEffortCap: false,
      },
    });
    expect(Object.isFrozen(adapter.capabilities)).toBe(true);
    expect(Object.isFrozen(adapter.capabilities.ccdModes)).toBe(true);
    expect(Object.isFrozen(adapter.capabilities.tuning)).toBe(true);
  });

  it("has no version before initialize and Rapier's version after", async () => {
    const adapter = new Rapier2dAdapter();
    expect(adapter.version).toBe("");
    await adapter.initialize({ dimension: "2d" });
    expect(adapter.version).toBe(rapier2dVersion());
    adapter.dispose();
  });
});

describe("initialize (§37, §21, §32, §33)", () => {
  it("refuses a second initialize", async () => {
    const adapter = await createAdapter();
    await expect(adapter.initialize({ dimension: "2d" })).rejects.toThrowError(
      /called twice/u,
    );
    adapter.dispose();
  });

  it("refuses a 3d world", async () => {
    const adapter = new Rapier2dAdapter();
    await expect(adapter.initialize({ dimension: "3d" })).rejects.toThrowError(
      /simulates "2d" worlds only/u,
    );
  });

  it("refuses a determinism tier stronger than it declares (§33)", async () => {
    const adapter = new Rapier2dAdapter();
    await expect(
      adapter.initialize({ dimension: "2d", determinism: "cross-platform" }),
    ).rejects.toThrowError(/declares determinism/u);
  });

  it("accepts a tier it can meet", async () => {
    const adapter = await createAdapter({ determinism: "same-runtime" });
    expect(adapter.version).not.toBe("");
    adapter.dispose();
  });

  it("rejects gravity with a z component (§21, §85)", async () => {
    const adapter = new Rapier2dAdapter();
    await expect(
      adapter.initialize({
        dimension: "2d",
        gravity: new Vector3(0, -9.81, 1),
      }),
    ).rejects.toThrowError(FourError);
  });

  it("throws for every method used before initialize completes", () => {
    const adapter = new Rapier2dAdapter();
    expect(() => adapter.createBody({ type: "dynamic" })).toThrowError(
      /has not completed/u,
    );
    expect(() => adapter.step(DT)).toThrowError(/has not completed/u);
    expect(() => adapter.syncSceneToSolver()).toThrowError(
      /has not completed/u,
    );
    expect(() => adapter.syncSolverToScene()).toThrowError(
      /has not completed/u,
    );
    expect(() => adapter.createSnapshot()).toThrowError(/has not completed/u);
    expect(() => adapter.restoreSnapshot(new ArrayBuffer(64))).toThrowError(
      /has not completed/u,
    );
    expect(() => adapter.forEachBody(() => undefined)).toThrowError(
      /has not completed/u,
    );
  });
});

describe("body lifecycle and §22 type mapping", () => {
  it("creates each §22 body type and reports its transform", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const types = [
      "static",
      "dynamic",
      "kinematic-position",
      "kinematic-velocity",
    ] as const;
    for (const [index, type] of types.entries()) {
      const body = adapter.createBody({
        type,
        position: new Vector2(index, index * 2),
        rotation: Math.PI / 4,
      });
      const position = new Vector3();
      const rotation = new Quaternion();
      adapter.getBodyTransform(body, position, rotation);
      expect(position.x).toBeCloseTo(index, 5);
      expect(position.y).toBeCloseTo(index * 2, 5);
      expect(position.z).toBe(0);
      expect(rotation.x).toBe(0);
      expect(rotation.y).toBe(0);
      expect(rotation.z).toBeCloseTo(Math.sin(Math.PI / 8), 5);
      expect(adapter.getBodyId(body)).toBe(index + 1);
    }
    adapter.dispose();
  });

  it("only a dynamic body falls; static and kinematic bodies do not", async () => {
    const adapter = await createAdapter();
    const dynamic = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 10),
    });
    const staticBody = adapter.createBody({
      type: "static",
      position: new Vector2(2, 10),
    });
    const kinematic = adapter.createBody({
      type: "kinematic-velocity",
      position: new Vector2(4, 10),
    });
    for (const body of [dynamic, staticBody, kinematic]) {
      adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    }
    stepAndDrain(adapter, 30);
    expect(positionOf(adapter, dynamic).y).toBeLessThan(10);
    expect(positionOf(adapter, staticBody).y).toBe(10);
    expect(positionOf(adapter, kinematic).y).toBe(10);
    adapter.dispose();
  });

  it("destroys a body together with its colliders and rejects stale handles", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.destroyBody(body);

    expect(() => adapter.getBodyId(body)).toThrowError(/not valid/u);
    expect(() => adapter.getColliderId(collider)).toThrowError(/not valid/u);

    const colliders: number[] = [];
    adapter.forEachCollider((_handle, id) => colliders.push(id));
    expect(colliders).toEqual([]);
    adapter.dispose();
  });

  it("forgets only the touching pairs of the collider it destroys", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const handles = [0, 4].map((x) => {
      const body = adapter.createBody({
        type: "dynamic",
        position: new Vector2(x, 0.5),
      });
      return adapter.createCollider({
        body,
        shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      });
    });
    stepAndDrain(adapter, 30);

    adapter.destroyCollider(handles[0]);
    const stays = stepAndDrain(adapter, 3).filter(
      (event) => event.type === "collisionstay",
    );
    expect(stays.length).toBeGreaterThan(0);
    for (const event of stays) {
      if (isCollision(event)) {
        expect(event.colliderA).not.toBe(handles[0]);
        expect(event.colliderB).not.toBe(handles[0]);
      }
    }
    adapter.dispose();
  });

  it("destroys a collider on its own", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.destroyCollider(collider);
    expect(() => adapter.getColliderId(collider)).toThrowError(/not valid/u);
    expect(adapter.getBodyId(body)).toBe(1);
    adapter.dispose();
  });

  it("rejects a handle minted by another adapter", async () => {
    const first = await createAdapter();
    const second = await createAdapter();
    const foreign = first.createBody({ type: "dynamic" });
    expect(() => second.getBodyId(foreign)).toThrowError(/another adapter/u);
    first.dispose();
    second.dispose();
  });

  it("keeps ids monotonic and iteration ordered across destroy + create (§33)", async () => {
    const adapter = await createAdapter();
    const first = adapter.createBody({ type: "dynamic" });
    const second = adapter.createBody({ type: "dynamic" });
    adapter.createBody({ type: "dynamic" });
    adapter.destroyBody(second);
    adapter.createBody({ type: "dynamic" });
    adapter.destroyBody(first);
    adapter.createBody({ type: "dynamic" });

    const ids: number[] = [];
    adapter.forEachBody((_handle, id) => ids.push(id));
    expect(ids).toEqual([3, 4, 5]);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    adapter.dispose();
  });
});

describe("integration against derived closed forms", () => {
  it("falls exactly as Rapier's substepped semi-implicit integrator predicts", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 100),
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });

    const steps = 60;
    stepAndDrain(adapter, steps);
    // 1e-3 covers Rapier's 32-bit accumulation over 240 substeps; the measured
    // deviation from the closed form is ~1.3e-5.
    expect(positionOf(adapter, body).y).toBeCloseTo(
      100 + fallDistance(steps),
      3,
    );
    expect(velocityOf(adapter, body).y).toBeCloseTo(GRAVITY_Y * DT * steps, 4);
    adapter.dispose();
  });

  it("scales gravity per body (§23)", async () => {
    const adapter = await createAdapter();
    const half = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 100),
      gravityScale: 0.5,
    });
    const weightless = adapter.createBody({
      type: "dynamic",
      position: new Vector2(5, 100),
      gravityScale: 0,
    });
    adapter.createCollider({
      body: half,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.createCollider({
      body: weightless,
      shape: { type: "circle", radius: 0.5 },
    });
    stepAndDrain(adapter, 30);
    expect(velocityOf(adapter, half).y).toBeCloseTo(
      GRAVITY_Y * 0.5 * DT * 30,
      4,
    );
    expect(velocityOf(adapter, weightless).y).toBe(0);
    adapter.dispose();
  });

  it("damps linear velocity once per full step (§23)", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const damping = 2;
    const body = adapter.createBody({
      type: "dynamic",
      linearVelocity: new Vector2(10, 0),
      linearDamping: damping,
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    const steps = 30;
    stepAndDrain(adapter, steps);
    expect(velocityOf(adapter, body).x).toBeCloseTo(
      10 * Math.pow(1 / (1 + DT * damping), steps),
      4,
    );
    adapter.dispose();
  });

  it("damps angular velocity too", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const body = adapter.createBody({
      type: "dynamic",
      angularVelocity: 4,
      angularDamping: 3,
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    stepAndDrain(adapter, 30);
    const angular = new Vector3();
    adapter.getBodyVelocities(body, new Vector3(), angular);
    expect(angular.z).toBeGreaterThan(0);
    expect(angular.z).toBeLessThan(4);
    adapter.dispose();
  });

  it("bounces according to restitution (§24, §25)", async () => {
    const bounceHeight = async (restitution: number): Promise<number> => {
      const adapter = await createAdapter();
      createFloor(adapter, { restitution });
      const body = adapter.createBody({
        type: "dynamic",
        position: new Vector2(0, 3),
      });
      adapter.createCollider({
        body,
        shape: { type: "circle", radius: 0.5 },
        restitution,
      });
      let peak = 0;
      let touched = false;
      for (let i = 0; i < 240; i += 1) {
        adapter.step(DT);
        adapter.drainEvents();
        const y = positionOf(adapter, body).y;
        touched ||= y < 0.55;
        if (touched) {
          peak = Math.max(peak, y);
        }
      }
      adapter.dispose();
      return peak;
    };

    const dead = await bounceHeight(0);
    const bouncy = await bounceHeight(0.9);
    expect(dead).toBeLessThan(0.7);
    expect(bouncy).toBeGreaterThan(1.5);
  });
});

describe("mass composition (§23, §25)", () => {
  it("derives mass from collider density by default", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      density: 3,
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(3, 5);
    adapter.dispose();
  });

  it("falls back to the material density when the collider sets none (§25)", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      material: new PhysicsMaterial({ density: 7 }),
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(7, 5);
    adapter.dispose();
  });

  it("makes an explicit mass authoritative over density", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic", mass: 5 });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      density: 1000,
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);
    adapter.dispose();
  });

  it("reads the world-space centre of mass through the seam (§25, 2026-08-04)", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(3, 1),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      // Structural `Transform` stand-in, as in the offset test below.
      offset: {
        position: new Vector3(1, 0, 0),
        rotation: new Quaternion(),
      } as unknown as NonNullable<ColliderDescriptor["offset"]>,
    });
    const com = new Vector3();
    adapter.getBodyCenterOfMass(body, com);
    // Rapier derives the centre of mass from the collider layout: one circle
    // offset +1 in x puts it at origin.x + 1 — visibly NOT the transform
    // origin, which is exactly what the seam member exists to report.
    expect(com.x).toBeCloseTo(4, 5);
    expect(com.y).toBeCloseTo(1, 5);
    expect(com.z).toBe(0);
    adapter.dispose();
  });

  it("carries mass on the body when an inertia tensor is given", async () => {
    const adapter = await createAdapter();
    const inertiaTensor = new Matrix3();
    inertiaTensor.elements[8] = 3;
    const body = adapter.createBody({
      type: "dynamic",
      mass: 5,
      centerOfMass: new Vector2(0, 0),
      inertiaTensor,
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);
    adapter.dispose();
  });

  it("accepts a centre of mass or an inertia tensor on its own with a mass", async () => {
    const adapter = await createAdapter();
    const offsetCom = adapter.createBody({
      type: "dynamic",
      mass: 4,
      centerOfMass: new Vector2(0.25, 0),
    });
    adapter.createCollider({
      body: offsetCom,
      shape: { type: "circle", radius: 0.5 },
    });
    expect(adapter.getBodyMass(offsetCom)).toBeCloseTo(4, 5);

    const inertiaTensor = new Matrix3();
    inertiaTensor.elements[8] = 2;
    const spinning = adapter.createBody({
      type: "dynamic",
      mass: 6,
      inertiaTensor,
    });
    adapter.createCollider({
      body: spinning,
      shape: { type: "circle", radius: 0.5 },
    });
    expect(adapter.getBodyMass(spinning)).toBeCloseTo(6, 5);
    adapter.dispose();
  });

  it("rejects a mass distribution without a mass", async () => {
    const adapter = await createAdapter();
    expect(() =>
      adapter.createBody({ type: "dynamic", centerOfMass: new Vector2(1, 0) }),
    ).toThrowError(/requires an explicit mass/u);
    adapter.dispose();
  });
});

// Regression suite for the 2026-08-06 fix: `destroyCollider` never decremented
// the body's collider count and never rebuilt its mass, so a `"first-collider"`
// body silently lost its whole authored mass and its replacement collider was
// created with `density: 0`. Every expectation below fails on the old code.
describe("mass after a collider is destroyed (§23, §24, §37)", () => {
  it("hands an authored mass to the surviving collider", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic", mass: 5 });
    const bearer = adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      density: 1000,
    });
    const second = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);

    // The mass-bearing collider dies; the body keeps its §23 mass.
    adapter.destroyCollider(bearer);
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);

    // …and it is the *survivor* that now carries it, so destroying that one
    // too leaves a massless body rather than a doubled one.
    adapter.destroyCollider(second);
    expect(adapter.getBodyMass(body)).toBeCloseTo(0, 5);
    adapter.dispose();
  });

  // 2026-08-07: the heir is chosen from the body's **own** collider list (a
  // per-body array) rather than by scanning every collider in the world. The
  // choice must still be the body's lowest monotonic id, with other bodies'
  // colliders — created both before and after it — ignored.
  it("picks the body's own lowest-id collider as the heir", async () => {
    const adapter = await createAdapter();
    const other = adapter.createBody({ type: "dynamic", mass: 9 });
    adapter.createCollider({
      body: other,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });

    const body = adapter.createBody({ type: "dynamic", mass: 5 });
    const bearer = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    const middle = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.25 },
      density: 1000,
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.25 },
      density: 1000,
    });
    // A later collider on the *other* body: a global scan could reach it.
    adapter.createCollider({
      body: other,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });

    adapter.destroyCollider(bearer);
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);
    expect(adapter.getBodyMass(other)).toBeCloseTo(9, 5);

    // `middle` is now the heir; destroying it moves the mass on again rather
    // than losing it.
    adapter.destroyCollider(middle);
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);
    adapter.dispose();
  });

  it("keeps the heir list across a §34 snapshot restore", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic", mass: 6 });
    const bearer = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.25 },
      density: 1000,
    });

    // The envelope carries a per-body *count*; the ids are re-derived from its
    // collider table, so a restored world can still find a body's own heir.
    adapter.restoreSnapshot(adapter.createSnapshot());

    adapter.destroyCollider(bearer);
    expect(adapter.getBodyMass(body)).toBeCloseTo(6, 5);
    adapter.dispose();
  });

  it("gives the mass back to a replacement collider", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic", mass: 4 });
    const only = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.destroyCollider(only);
    expect(adapter.getBodyMass(body)).toBeCloseTo(0, 5);

    // The collider count is back to zero, so this one is created carrying the
    // authored mass instead of `density: 0` (the old defect).
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    expect(adapter.getBodyMass(body)).toBeCloseTo(4, 5);
    adapter.dispose();
  });

  it("recomputes a density-derived mass when a collider goes", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    const first = adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      density: 3,
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      offset: {
        position: new Vector3(2, 0, 0),
        rotation: new Quaternion(),
      } as unknown as NonNullable<ColliderDescriptor["offset"]>,
      density: 3,
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(6, 5);

    adapter.destroyCollider(first);
    expect(adapter.getBodyMass(body)).toBeCloseTo(3, 5);
    adapter.dispose();
  });

  it("leaves a body-mode body's authored triple alone", async () => {
    const adapter = await createAdapter();
    const inertiaTensor = new Matrix3();
    inertiaTensor.elements[8] = 3;
    const body = adapter.createBody({
      type: "dynamic",
      mass: 5,
      centerOfMass: new Vector2(0, 0),
      inertiaTensor,
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      density: 1000,
    });
    adapter.destroyCollider(collider);
    // `"body"` mass mode puts the mass on the body itself, so losing a
    // zero-density collider changes nothing.
    expect(adapter.getBodyMass(body)).toBeCloseTo(5, 5);
    adapter.dispose();
  });

  it("still destroys every collider with its body", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic", mass: 2 });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.destroyBody(body);
    // The collider handle died with the body, and the count bookkeeping in
    // `#forgetCollider` did not throw on the way (its body record is still
    // present at that point, and is dropped immediately after).
    expect(() => adapter.getColliderId(collider)).toThrowError(/destroyed/u);
    adapter.dispose();
  });
});

describe("continuous collision detection (§31)", () => {
  it("passes the swept mode through as Rapier CCD", async () => {
    const adapter = await createAdapter();
    const swept = adapter.createBody({
      type: "dynamic",
      continuousCollisionDetection: true,
    });
    const explicit = adapter.createBody({ type: "dynamic", ccdMode: "swept" });
    const speculative = adapter.createBody({
      type: "dynamic",
      ccdMode: "speculative",
    });
    const off = adapter.createBody({ type: "dynamic" });

    expect(adapter.getBodyCcdMode(swept)).toBe("swept");
    expect(adapter.getBodyCcdMode(explicit)).toBe("swept");
    expect(adapter.getBodyCcdMode(speculative)).toBe("speculative");
    expect(adapter.getBodyCcdMode(off)).toBe("disabled");
    adapter.dispose();
  });
});

describe("events (§29, §32)", () => {
  it("reports collisionstart with contact data, then collisionstay", async () => {
    const adapter = await createAdapter();
    const floor = createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 2),
    });
    const ball = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });

    const events = stepAndDrain(adapter, 120);
    const starts = events.filter((event) => event.type === "collisionstart");
    const stays = events.filter((event) => event.type === "collisionstay");
    expect(starts.length).toBeGreaterThan(0);
    expect(stays.length).toBeGreaterThan(0);

    const start = starts[0];
    expect(isCollision(start)).toBe(true);
    if (!isCollision(start)) {
      return;
    }
    expect([start.colliderA, start.colliderB]).toContain(ball);
    expect([start.colliderA, start.colliderB]).toContain(floor.collider);
    expect([start.bodyA, start.bodyB]).toContain(body);
    expect(start.contacts.length).toBeGreaterThan(0);

    const contact = start.contacts[0];
    // The normal points from A towards B, so it is ±Y for a ball on a floor.
    expect(Math.abs(contact.normal.y)).toBeCloseTo(1, 4);
    expect(contact.normal.z).toBe(0);
    // Rapier 0.20 reports a small positive allowed-margin distance (~0.005)
    // at first contact; 0.19.3 reported <= 0. Either is a touching pair.
    expect(contact.separation).toBeLessThanOrEqual(0.01);
    expect(contact.impulse).toBeGreaterThan(0);
    // Contact points are world space: the floor's surface is y = 0, and the
    // ball's witness point sits at most one penetration depth below it.
    expect(Math.abs(contact.pointOnA.x)).toBeLessThan(0.2);
    expect(Math.abs(contact.pointOnA.y)).toBeLessThan(0.2);
    expect(Math.abs(contact.pointOnB.y)).toBeLessThan(0.2);
    expect(contact.pointOnA.z).toBe(0);
    expect(start.totalImpulse.length()).toBeGreaterThan(0);
    expect(start.relativeVelocity.z).toBe(0);
    adapter.dispose();
  });

  it("reports collisionend with no contacts when a bouncing pair separates", async () => {
    const adapter = await createAdapter();
    createFloor(adapter, { restitution: 0.9 });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 3),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      restitution: 0.9,
    });

    const events = stepAndDrain(adapter, 180);
    const ends = events.filter((event) => event.type === "collisionend");
    expect(ends.length).toBeGreaterThan(0);
    const end = ends[0];
    if (!isCollision(end)) {
      throw new Error("expected a collision event");
    }
    expect(end.contacts).toEqual([]);
    expect(end.totalImpulse.lengthSq()).toBe(0);
    expect(end.relativeVelocity.lengthSq()).toBe(0);
    adapter.dispose();
  });

  it("reports triggerenter and triggerexit for a sensor (§24, §29)", async () => {
    const adapter = await createAdapter();
    const sensorBody = adapter.createBody({
      type: "static",
      position: new Vector2(0, 0),
    });
    const sensor = adapter.createCollider({
      body: sensorBody,
      shape: { type: "circle", radius: 1 },
      sensor: true,
    });
    const fallingBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 5),
    });
    const fallingCollider = adapter.createCollider({
      body: fallingBody,
      shape: { type: "circle", radius: 0.25 },
    });

    const events = stepAndDrain(adapter, 180).filter(isTrigger);
    expect(events.map((event) => event.type)).toEqual([
      "triggerenter",
      "triggerexit",
    ]);
    for (const event of events) {
      expect(event.sensor).toBe(sensor);
      expect(event.sensorBody).toBe(sensorBody);
      expect(event.other).toBe(fallingCollider);
      expect(event.otherBody).toBe(fallingBody);
    }
    // A sensor exerts no force, so the body keeps falling straight through.
    expect(positionOf(adapter, fallingBody).y).toBeLessThan(-1);
    adapter.dispose();
  });

  it("reports a sensor/sensor overlap once from each side (§29)", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const leftBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(-3, 0),
      linearVelocity: new Vector2(3, 0),
    });
    const left = adapter.createCollider({
      body: leftBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true,
    });
    const rightBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(3, 0),
      linearVelocity: new Vector2(-3, 0),
    });
    const right = adapter.createCollider({
      body: rightBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true,
    });

    const enters = stepAndDrain(adapter, 120)
      .filter(isTrigger)
      .filter((event) => event.type === "triggerenter");
    expect(enters).toHaveLength(2);
    expect(enters.map((event) => event.sensor)).toContain(left);
    expect(enters.map((event) => event.sensor)).toContain(right);
    expect(enters[0].other).toBe(enters[1].sensor);
    adapter.dispose();
  });

  it("reports sleep and wake transitions in body order (§32)", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });

    const sleepEvents = stepAndDrain(adapter, 300).filter(isSleep);
    expect(sleepEvents.map((event) => event.type)).toContain("sleep");
    expect(adapter.isBodySleeping(body)).toBe(true);

    adapter.wakeBody(body);
    const woken = stepAndDrain(adapter, 1).filter(isSleep);
    expect(woken.map((event) => event.type)).toEqual(["wake"]);

    adapter.sleepBody(body);
    expect(adapter.isBodySleeping(body)).toBe(true);
    adapter.dispose();
  });

  it("never leaves bodies asleep when sleeping is disabled (§32)", async () => {
    const adapter = await createAdapter({ sleeping: { enabled: false } });
    createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    stepAndDrain(adapter, 300);
    expect(adapter.isBodySleeping(body)).toBe(false);
    adapter.dispose();
  });

  it("hands the event buffer over and starts a new one", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.6),
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    adapter.step(DT);
    adapter.step(DT);
    const first = adapter.drainEvents();
    const second = adapter.drainEvents();
    expect(second).not.toBe(first);
    expect(second).toEqual([]);
    adapter.dispose();
  });

  it("rejects a non-positive or non-finite step (§7a, §10)", async () => {
    const adapter = await createAdapter();
    expect(() => adapter.step(0)).toThrowError(/finite positive/u);
    expect(() => adapter.step(-1)).toThrowError(/finite positive/u);
    expect(() => adapter.step(Number.NaN)).toThrowError(/finite positive/u);
    adapter.dispose();
  });
});

describe("collision filtering (§24)", () => {
  it("keeps colliders apart when their groups and masks do not match", async () => {
    const adapter = await createAdapter();
    const floor = adapter.createBody({
      type: "static",
      position: new Vector2(0, -0.5),
    });
    adapter.createCollider({
      body: floor,
      shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
      collisionGroups: 0b01,
      collisionMask: 0b01,
    });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 2),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      collisionGroups: 0b10,
      collisionMask: 0b10,
    });
    stepAndDrain(adapter, 120);
    expect(positionOf(adapter, body).y).toBeLessThan(-1);
    adapter.dispose();
  });
});

describe("queries (§30)", () => {
  interface Scene {
    adapter: Rapier2dAdapter;
    floorBody: PhysicsBodyHandle;
    floor: PhysicsColliderHandle;
    ballBody: PhysicsBodyHandle;
    ball: PhysicsColliderHandle;
    sensor: PhysicsColliderHandle;
  }

  async function createScene(): Promise<Scene> {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const floor = createFloor(adapter);
    const ballBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 3),
    });
    const ball = adapter.createCollider({
      body: ballBody,
      shape: { type: "circle", radius: 0.5 },
    });
    const sensorBody = adapter.createBody({
      type: "static",
      position: new Vector2(0, 6),
    });
    const sensor = adapter.createCollider({
      body: sensorBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true,
    });
    // Rapier only inserts colliders into the broad phase during a step, so
    // queries cannot see them before one has run (verified at 0.19.3).
    adapter.step(DT);
    adapter.drainEvents();
    return {
      adapter,
      floorBody: floor.body,
      floor: floor.collider,
      ballBody,
      ball,
      sensor,
    };
  }

  it("casts a ray and reports every hit, sorted on request", async () => {
    const scene = await createScene();
    const hits = scene.adapter.raycast({
      origin: new Vector2(0, 10),
      direction: new Vector2(0, -1),
      sorted: true,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0].collider).toBe(scene.ball);
    expect(hits[1].collider).toBe(scene.floor);
    expect(hits[0].distance).toBeCloseTo(6.5, 4);
    expect(hits[0].point.y).toBeCloseTo(3.5, 4);
    expect(hits[0].point.z).toBe(0);
    expect(hits[0].normal.y).toBeCloseTo(1, 4);
    expect(hits[0].body).toBe(scene.ballBody);
    scene.adapter.dispose();
  });

  it('returns the nearest hit for mode "first"', async () => {
    const scene = await createScene();
    const hits = scene.adapter.raycast({
      origin: new Vector2(0, 10),
      direction: new Vector2(0, -1),
      mode: "first",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(scene.ball);
    scene.adapter.dispose();
  });

  it("misses when nothing is along the ray or the range is too short", async () => {
    const scene = await createScene();
    expect(
      scene.adapter.raycast({
        origin: new Vector2(50, 50),
        direction: new Vector2(1, 0),
      }),
    ).toEqual([]);
    expect(
      scene.adapter.raycast({
        origin: new Vector2(0, 10),
        direction: new Vector2(0, -1),
        maxDistance: 1,
        mode: "first",
      }),
    ).toEqual([]);
    scene.adapter.dispose();
  });

  it("applies every §30 filter through the shared helpers", async () => {
    const scene = await createScene();
    const ray = { origin: new Vector2(0, 10), direction: new Vector2(0, -1) };

    const ignoredBody = scene.adapter.raycast({
      ...ray,
      ignoredBodies: [scene.ballBody],
    });
    expect(ignoredBody).toHaveLength(1);
    expect(ignoredBody[0].collider).toBe(scene.floor);

    const ignoredCollider = scene.adapter.raycast({
      ...ray,
      ignoredColliders: [scene.ball],
    });
    expect(ignoredCollider).toHaveLength(1);
    expect(ignoredCollider[0].collider).toBe(scene.floor);

    // Sensors are excluded by default and included on request.
    const withSensors = scene.adapter.raycast({
      ...ray,
      origin: new Vector2(0, 10),
      includeSensors: true,
      sorted: true,
    });
    expect(withSensors).toHaveLength(3);
    expect(withSensors[0].collider).toBe(scene.sensor);
    expect(withSensors[1].collider).toBe(scene.ball);
    expect(withSensors[2].collider).toBe(scene.floor);

    // The scene's colliders belong to every group, so exclusion has to come
    // from the query's own mask — that is §30's mutual rule, not a one-way one.
    expect(
      scene.adapter.raycast({
        ...ray,
        collisionGroups: 0b10,
        collisionMask: 0,
      }),
    ).toEqual([]);
    expect(
      scene.adapter.raycast({
        ...ray,
        collisionGroups: 0,
        collisionMask: 0b10,
      }),
    ).toEqual([]);

    expect(
      scene.adapter.raycast({
        ...ray,
        predicate: (candidate) => candidate.collider === scene.floor,
      }).length,
    ).toBe(1);

    expect(scene.adapter.raycast({ ...ray, maxHits: 1 })).toHaveLength(1);
    expect(
      scene.adapter.raycast({
        ...ray,
        collisionGroups: ALL_COLLISION_GROUPS,
        collisionMask: ALL_COLLISION_GROUPS,
      }),
    ).toHaveLength(2);
    scene.adapter.dispose();
  });

  it("rejects a degenerate ray or sweep direction", async () => {
    const scene = await createScene();
    expect(() =>
      scene.adapter.raycast({
        origin: new Vector2(0, 0),
        direction: new Vector2(0, 0),
      }),
    ).toThrowError(/non-zero length/u);
    expect(() =>
      scene.adapter.shapeCast({
        shape: { type: "circle", radius: 0.25 },
        position: new Vector2(0, 10),
        direction: new Vector2(0, 0),
      }),
    ).toThrowError(/non-zero length/u);
    scene.adapter.dispose();
  });

  it("sweeps a shape onto the first collider it touches", async () => {
    const scene = await createScene();
    const hits = scene.adapter.shapeCast({
      shape: { type: "circle", radius: 0.25 },
      position: new Vector2(0, 10),
      rotation: 0,
      direction: new Vector2(0, -1),
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(scene.ball);
    expect(hits[0].body).toBe(scene.ballBody);
    expect(hits[0].distance).toBeCloseTo(6.25, 3);
    expect(hits[0].point.y).toBeCloseTo(3.5, 3);
    expect(hits[0].normal.y).toBeCloseTo(1, 3);
    scene.adapter.dispose();
  });

  it("returns nothing from a sweep that hits nothing", async () => {
    const scene = await createScene();
    expect(
      scene.adapter.shapeCast({
        shape: { type: "circle", radius: 0.25 },
        position: new Vector2(60, 60),
        direction: new Vector2(1, 0),
        maxDistance: 1,
      }),
    ).toEqual([]);
    scene.adapter.dispose();
  });

  it("overlaps a circle and a rectangle in the XY plane (§21, §30)", async () => {
    const scene = await createScene();
    const circle = scene.adapter.overlap({
      shape: { type: "circle", radius: 0.6 },
      position: new Vector2(0, 3),
    });
    expect(circle).toHaveLength(1);
    expect(circle[0].collider).toBe(scene.ball);

    const rectangle = scene.adapter.overlap({
      shape: { type: "rectangle", halfExtents: new Vector2(0.2, 0.2) },
      position: new Vector2(0, 3),
      rotation: Math.PI / 4,
    });
    expect(rectangle).toHaveLength(1);
    expect(rectangle[0].body).toBe(scene.ballBody);

    expect(
      scene.adapter.overlap({
        shape: { type: "circle", radius: 0.1 },
        position: new Vector2(40, 40),
      }),
    ).toEqual([]);
    scene.adapter.dispose();
  });

  it("finds the colliders containing a point (§30)", async () => {
    const scene = await createScene();
    const hits = scene.adapter.pointQuery({
      point: new Vector2(0, 3),
      sorted: true,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(scene.ball);
    expect(hits[0].distance).toBe(0);
    expect(hits[0].point.x).toBeCloseTo(0, 5);
    expect(hits[0].point.y).toBeCloseTo(3, 5);
    expect(scene.adapter.pointQuery({ point: new Vector2(0, 100) })).toEqual(
      [],
    );
    scene.adapter.dispose();
  });
});

describe("per-handle access seam (§26, §42)", () => {
  it("reads and writes transforms and velocities", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const body = adapter.createBody({ type: "dynamic" });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });

    adapter.setBodyTransform(body, new Vector2(2, 3), Math.PI / 2);
    const position = new Vector3();
    const rotation = new Quaternion();
    adapter.getBodyTransform(body, position, rotation);
    expect(position.x).toBeCloseTo(2, 5);
    expect(position.y).toBeCloseTo(3, 5);
    expect(rotation.z).toBeCloseTo(Math.SQRT1_2, 5);

    adapter.setBodyVelocities(body, new Vector2(1, -2), 0.5);
    const linear = new Vector3();
    const angular = new Vector3();
    adapter.getBodyVelocities(body, linear, angular);
    expect(linear.x).toBeCloseTo(1, 5);
    expect(linear.y).toBeCloseTo(-2, 5);
    expect(linear.z).toBe(0);
    expect(angular.z).toBeCloseTo(0.5, 5);
    adapter.dispose();
  });

  it("applies §26's six force and impulse entry points", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const body = adapter.createBody({ type: "dynamic", mass: 2 });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });

    adapter.applyImpulse(body, new Vector2(4, 0));
    expect(velocityOf(adapter, body).x).toBeCloseTo(2, 4);

    adapter.applyImpulseAtPoint(body, new Vector2(0, 2), new Vector2(0.5, 0));
    expect(velocityOf(adapter, body).y).toBeCloseTo(1, 4);

    adapter.applyAngularImpulse(body, new Vector3(0, 0, 0.1));
    const angular = new Vector3();
    adapter.getBodyVelocities(body, new Vector3(), angular);
    expect(angular.z).not.toBe(0);

    adapter.setBodyVelocities(body, new Vector2(0, 0), 0);
    adapter.applyForce(body, new Vector2(20, 0));
    adapter.step(DT);
    adapter.drainEvents();
    expect(velocityOf(adapter, body).x).toBeGreaterThan(0);

    adapter.setBodyVelocities(body, new Vector2(0, 0), 0);
    adapter.resetForces(body);
    adapter.step(DT);
    adapter.drainEvents();
    expect(velocityOf(adapter, body).x).toBeCloseTo(0, 6);

    adapter.applyForceAtPoint(body, new Vector2(0, 10), new Vector2(0.5, 0));
    adapter.applyTorque(body, 1);
    adapter.step(DT);
    adapter.drainEvents();
    expect(velocityOf(adapter, body).y).toBeGreaterThan(0);
    adapter.dispose();
  });

  it("drives a kinematic-position body to its next target (§22)", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "kinematic-position",
      position: new Vector2(0, 0),
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    adapter.setNextKinematicTransform(body, new Vector2(1, 2), Math.PI / 2);
    adapter.step(DT);
    adapter.drainEvents();
    const position = new Vector3();
    const rotation = new Quaternion();
    adapter.getBodyTransform(body, position, rotation);
    expect(position.x).toBeCloseTo(1, 5);
    expect(position.y).toBeCloseTo(2, 5);
    expect(rotation.z).toBeCloseTo(Math.SQRT1_2, 5);

    adapter.setNextKinematicTransform(body, new Vector2(2, 2));
    adapter.step(DT);
    adapter.drainEvents();
    adapter.getBodyTransform(body, position, rotation);
    expect(position.x).toBeCloseTo(2, 5);
    adapter.dispose();
  });

  it("maps a collider back to its body and iterates in creation order", async () => {
    const adapter = await createAdapter();
    const first = adapter.createBody({ type: "dynamic" });
    const second = adapter.createBody({ type: "dynamic" });
    const colliderA = adapter.createCollider({
      body: first,
      shape: { type: "circle", radius: 0.5 },
    });
    const colliderB = adapter.createCollider({
      body: second,
      shape: { type: "circle", radius: 0.5 },
    });
    expect(adapter.getColliderBody(colliderA)).toBe(first);
    expect(adapter.getColliderBody(colliderB)).toBe(second);

    const seen: number[] = [];
    adapter.forEachCollider((handle, id) => {
      seen.push(id);
      expect(adapter.getColliderId(handle)).toBe(id);
    });
    expect(seen).toEqual([1, 2]);
    adapter.dispose();
  });
});

describe("shapes (plan P5-6 tier)", () => {
  it("rests a capsule on its +Y axis and a polygon on its outline", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const capsuleBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(-3, 4),
    });
    adapter.createCollider({
      body: capsuleBody,
      shape: { type: "capsule", radius: 0.25, halfHeight: 1 },
    });
    const polygonBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(3, 4),
    });
    adapter.createCollider({
      body: polygonBody,
      shape: {
        type: "polygon",
        vertices: [
          new Vector2(-0.5, -0.5),
          new Vector2(0.5, -0.5),
          new Vector2(0.5, 0.5),
          new Vector2(-0.5, 0.5),
        ],
      },
    });

    stepAndDrain(adapter, 300);
    // A +Y capsule rests halfHeight + radius above the surface.
    expect(positionOf(adapter, capsuleBody).y).toBeCloseTo(1.25, 1);
    expect(positionOf(adapter, polygonBody).y).toBeCloseTo(0.5, 1);
    adapter.dispose();
  });

  it("honours a collider offset in the body frame (§24)", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 4),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      // `ColliderDescriptor.offset` is a `@fourjs/scene` `Transform`, and this
      // package may not depend on `@fourjs/scene` (§37's layering). Only
      // `position` and `rotation` are read — by the adapter and by
      // `validateColliderDescriptor` alike — so a structural stand-in is
      // enough to exercise the offset path from here.
      offset: {
        position: new Vector3(0, 2, 0),
        rotation: new Quaternion(),
      } as unknown as NonNullable<ColliderDescriptor["offset"]>,
    });
    stepAndDrain(adapter, 300);
    // The collider sits 2 units above the body origin, so the origin settles
    // 2 units below the resting collider centre.
    expect(positionOf(adapter, body).y).toBeCloseTo(-1.5, 1);
    adapter.dispose();
  });
});

describe("joints (§28, plan P6-1)", () => {
  // The staged-out assertions this block used to hold — `createJoint` throwing
  // `NOT_IMPLEMENTED` and an empty `jointTypes` — were retired by WP-6.2, which
  // built the joints. `rapier2d-joints.test.ts` is the suite for them; what
  // stays here is the seam between the two files.
  it("mints a usable joint handle and declares the tier it built", async () => {
    const adapter = await createAdapter();
    const bodyA = adapter.createBody({ type: "dynamic" });
    const bodyB = adapter.createBody({
      type: "dynamic",
      position: new Vector2(1, 0),
    });
    const joint = adapter.createJoint({ type: "fixed", bodyA, bodyB });
    expect(adapter.getJointId(joint)).toBe(1);
    expect(adapter.capabilities.jointTypes).toEqual([
      "fixed",
      "spring",
      "revolute",
      "prismatic",
      "rope",
    ]);
    adapter.destroyJoint(joint);
    // Destroyed once, and a handle from nowhere is rejected the same way a
    // foreign body handle is.
    expect(() => adapter.destroyJoint(joint)).toThrowError(
      /Joint handle is not valid/u,
    );
    expect(() => adapter.destroyJoint({} as never)).toThrowError(
      /Joint handle is not valid/u,
    );
    adapter.dispose();
  });
});

describe("determinism (§33)", () => {
  it("reproduces a bouncing stack exactly across two identical runs", async () => {
    const run = async (): Promise<string> => {
      const adapter = await createAdapter();
      createFloor(adapter, { restitution: 0.4 });
      const bodies: PhysicsBodyHandle[] = [];
      for (let i = 0; i < 5; i += 1) {
        const body = adapter.createBody({
          type: "dynamic",
          position: new Vector2(i * 0.01, 1 + i * 1.2),
          angularVelocity: i * 0.1,
        });
        adapter.createCollider({
          body,
          shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
          restitution: 0.4,
        });
        bodies.push(body);
      }
      stepAndDrain(adapter, 120);

      const state: number[] = [];
      const position = new Vector3();
      const rotation = new Quaternion();
      adapter.forEachBody((handle) => {
        adapter.getBodyTransform(handle, position, rotation);
        state.push(position.x, position.y, rotation.z, rotation.w);
      });
      adapter.dispose();
      expect(bodies).toHaveLength(5);
      return JSON.stringify(state);
    };

    const first = await run();
    const second = await run();
    expect(second).toBe(first);
  });
});

describe("snapshots (§34)", () => {
  it("round-trips a world and continues identically", async () => {
    const adapter = await createAdapter();
    createFloor(adapter, { restitution: 0.5 });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 4),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      restitution: 0.5,
    });
    stepAndDrain(adapter, 30);

    const snapshot = adapter.createSnapshot();
    const bodyIdBefore = adapter.getBodyId(body);
    stepAndDrain(adapter, 30);
    const expected = positionOf(adapter, body).clone();

    // Perturb the world, then restore: state and handle identity both return.
    adapter.setBodyTransform(body, new Vector2(99, 99), 0);
    adapter.createBody({ type: "dynamic" });
    adapter.restoreSnapshot(snapshot);
    expect(adapter.getBodyId(body)).toBe(bodyIdBefore);

    stepAndDrain(adapter, 30);
    const actual = positionOf(adapter, body);
    expect(actual.x).toBe(expected.x);
    expect(actual.y).toBe(expected.y);

    const ids: number[] = [];
    adapter.forEachBody((_handle, id) => ids.push(id));
    expect(ids).toEqual([1, 2]);
    adapter.dispose();
  });

  it("keeps collisionstay alive for pairs that were already touching", async () => {
    const adapter = await createAdapter();
    createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    const sensorBody = adapter.createBody({
      type: "static",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body: sensorBody,
      shape: { type: "circle", radius: 1 },
      sensor: true,
    });
    stepAndDrain(adapter, 30);
    const snapshot = adapter.createSnapshot();
    adapter.restoreSnapshot(snapshot);

    const stays = stepAndDrain(adapter, 5).filter(
      (event) => event.type === "collisionstay",
    );
    expect(stays.length).toBeGreaterThan(0);
    adapter.dispose();
  });

  it("re-creates records for ids that were destroyed since the snapshot", async () => {
    const adapter = await createAdapter();
    const floor = createFloor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 2),
    });
    adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
    stepAndDrain(adapter, 10);
    const snapshot = adapter.createSnapshot();

    adapter.destroyBody(body);
    const extra = adapter.createBody({ type: "dynamic" });
    const extraCollider = adapter.createCollider({
      body: extra,
      shape: { type: "circle", radius: 0.5 },
    });
    adapter.restoreSnapshot(snapshot);

    // The snapshot's ids are back, the ones created after it are gone, and the
    // handles minted after the snapshot are rejected.
    const bodyIds: number[] = [];
    adapter.forEachBody((_handle, id) => bodyIds.push(id));
    expect(bodyIds).toEqual([1, 2]);
    const colliderIds: number[] = [];
    adapter.forEachCollider((_handle, id) => colliderIds.push(id));
    expect(colliderIds).toEqual([1, 2]);
    expect(() => adapter.getBodyId(extra)).toThrowError(/not valid/u);
    expect(() => adapter.getColliderId(extraCollider)).toThrowError(
      /not valid/u,
    );
    // The pre-snapshot handles keep working, including the floor's.
    expect(adapter.getBodyId(floor.body)).toBe(1);
    expect(() => adapter.getBodyId(body)).toThrowError(/not valid/u);
    stepAndDrain(adapter, 5);
    adapter.dispose();
  });

  it("keeps contacts on the right collider when Rapier flips the manifold", async () => {
    const adapter = await createAdapter();
    // Rapier orders a contact pair internally, and that order need not match
    // the order this adapter names the pair in. Consuming and freeing a
    // collider slot first makes the box take the floor's would-be place in
    // Rapier's ordering, so the rebuilt pair queries the narrow phase the
    // "wrong" way round and the manifold comes back flipped (verified at
    // 0.19.3). Without the flip handling, `normal` would point the wrong way.
    const scratchBody = adapter.createBody({
      type: "static",
      position: new Vector2(50, 50),
    });
    const scratchCollider = adapter.createCollider({
      body: scratchBody,
      shape: { type: "circle", radius: 0.1 },
    });
    const floor = createFloor(adapter);
    adapter.destroyCollider(scratchCollider);
    const boxBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    const box = adapter.createCollider({
      body: boxBody,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    stepAndDrain(adapter, 60);

    adapter.restoreSnapshot(adapter.createSnapshot());
    const stays = stepAndDrain(adapter, 3).filter(isCollision);
    expect(stays.length).toBeGreaterThan(0);
    const stay = stays[0];
    expect(stay.colliderA).toBe(floor.collider);
    expect(stay.colliderB).toBe(box);
    expect(stay.contacts.length).toBeGreaterThan(0);
    // A -> B is floor -> box, so the normal is +Y whichever way Rapier stored
    // the pair, and the witness points stay on their own colliders.
    expect(stay.contacts[0].normal.y).toBeCloseTo(1, 3);
    expect(stay.contacts[0].pointOnA.y).toBeCloseTo(0, 1);
    expect(stay.contacts[0].pointOnB.y).toBeCloseTo(0, 1);
    adapter.dispose();
  });

  it("rejects a buffer that is not one of its own envelopes", async () => {
    const adapter = await createAdapter();
    expect(() => adapter.restoreSnapshot(new ArrayBuffer(4))).toThrowError(
      /too small/u,
    );
    expect(() => adapter.restoreSnapshot(new ArrayBuffer(64))).toThrowError(
      /was not produced by rapier2d/u,
    );

    const snapshot = adapter.createSnapshot();
    new DataView(snapshot).setUint32(4, 99, true);
    try {
      adapter.restoreSnapshot(snapshot);
      throw new Error("expected a version mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).code).toBe("SERIALIZATION_VERSION_MISMATCH");
    }
    adapter.dispose();
  });

  it("rejects an envelope written by a different adapter or version", async () => {
    const adapter = await createAdapter();
    const snapshot = adapter.createSnapshot();
    const header = new DataView(snapshot);
    const metaLength = header.getUint32(8, true);
    const bytes = new Uint8Array(snapshot);
    const meta = JSON.parse(
      new TextDecoder().decode(bytes.subarray(16, 16 + metaLength)),
    ) as { adapter: string; version: string };
    meta.version = "0.0.0-not-this-one";
    const rewritten = new TextEncoder().encode(JSON.stringify(meta));
    const rebuilt = new ArrayBuffer(16 + rewritten.byteLength);
    new Uint8Array(rebuilt).set(bytes.subarray(0, 16));
    new Uint8Array(rebuilt).set(rewritten, 16);
    new DataView(rebuilt).setUint32(8, rewritten.byteLength, true);
    new DataView(rebuilt).setUint32(12, 0, true);
    expect(() => adapter.restoreSnapshot(rebuilt)).toThrowError(
      /was written by/u,
    );
    adapter.dispose();
  });
});

describe("dispose (§37, §83)", () => {
  it("is idempotent and terminal", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({ type: "dynamic" });
    adapter.dispose();
    adapter.dispose();
    expect(() => adapter.getBodyId(body)).toThrowError(/disposed/u);
    expect(() => adapter.step(DT)).toThrowError(/disposed/u);
    expect(() => adapter.createBody({ type: "dynamic" })).toThrowError(
      /disposed/u,
    );
  });

  it("refuses to initialize after disposal", async () => {
    const adapter = new Rapier2dAdapter();
    adapter.dispose();
    await expect(adapter.initialize({ dimension: "2d" })).rejects.toThrowError(
      /disposed/u,
    );
  });
});

describe("snapshot envelope hardening (§96, 2026-09-11)", () => {
  it("refuses declared lengths that overrun the buffer, and malformed meta, as UNTRUSTED_INPUT_REJECTED", async () => {
    const adapter = await createAdapter();
    const snapshot = adapter.createSnapshot();
    const overrun = snapshot.slice(0);
    new DataView(overrun).setUint32(12, 0xffffffff, true);
    expect(() => adapter.restoreSnapshot(overrun)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error,
    );
    const garbled = snapshot.slice(0);
    new Uint8Array(garbled)[16] = 0x21; // "!" where the meta JSON's "{" was
    expect(() => adapter.restoreSnapshot(garbled)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error,
    );
    adapter.dispose();
  });

  /** Re-wraps `snapshot` with `meta` as its envelope meta, lengths updated. */
  function withMeta(snapshot: ArrayBuffer, meta: string): ArrayBuffer {
    const header = new DataView(snapshot);
    const oldMetaLength = header.getUint32(8, true);
    const rapierLength = header.getUint32(12, true);
    const metaBytes = new TextEncoder().encode(meta);
    const out = new Uint8Array(16 + metaBytes.byteLength + rapierLength);
    out.set(new Uint8Array(snapshot, 0, 16), 0);
    new DataView(out.buffer).setUint32(8, metaBytes.byteLength, true);
    out.set(metaBytes, 16);
    out.set(
      new Uint8Array(snapshot, 16 + oldMetaLength, rapierLength),
      16 + metaBytes.byteLength,
    );
    return out.buffer;
  }

  it("refuses meta that is not an object, or lacks the string / integer fields (§34, §96)", async () => {
    const adapter = await createAdapter();
    const snapshot = adapter.createSnapshot();
    const original = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(snapshot, 16, new DataView(snapshot).getUint32(8, true)),
      ),
    ) as Record<string, unknown>;
    for (const meta of [
      "null",
      "[]",
      "42",
      JSON.stringify({ ...original, adapter: 7 }),
      JSON.stringify({ ...original, version: null }),
      JSON.stringify({ ...original, nextBodyId: -1 }),
      JSON.stringify({ ...original, nextColliderId: 1.5 }),
      JSON.stringify({ ...original, nextJointId: "3" }),
    ]) {
      expect(() => adapter.restoreSnapshot(withMeta(snapshot, meta))).toThrowError(
        expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error,
      );
    }
    // The same envelope with the original meta re-wrapped still restores.
    expect(() =>
      adapter.restoreSnapshot(withMeta(snapshot, JSON.stringify(original))),
    ).not.toThrow();
    adapter.dispose();
  });
});
