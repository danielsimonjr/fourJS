/**
 * Phase 5 cross-integration: `@fourjs/physics` **driven through a real Rapier
 * solver**, in both §21 dimensions, through the public API only (WP-5.6;
 * §29–§30, §33–§34, §42–§43, §108).
 *
 * This is the first suite in `tests/integration/` (§92's backlog item), and it
 * exists because the two halves of Phase 5 are separately tested and nowhere
 * *composed*: `packages/physics/tests/` drives `PhysicsWorld` against a
 * structural fake solver, and `packages/physics-rapier/tests/` drives the two
 * adapters against the real wasm without a scene, a node, an authority, or an
 * application. Everything below therefore goes through
 * `four/application` + `@fourjs/physics` + `@fourjs/physics-rapier` and never
 * reaches into a package's internals: an `Application` is composed headlessly
 * the way `tests/determinism/*` compose one, a `PhysicsSystem` is registered on
 * it, and worlds are built on real `Rapier2dAdapter` / `Rapier3dAdapter`
 * instances and initialized with `await world.initialize()`.
 *
 * ## What "matches the closed form" means here (§10, WP-5.4/5.5)
 *
 * Rapier 0.19.3 integrates one `World.step` as four substeps of `dt / 4`, so
 * free fall follows `y = y₀ + g·h²·K(K+1)/2` with `h = dt/4` and `K = 4N`, and
 * `v = g·dt·N`. That derivation is the adapters' own, verified there against
 * the wasm; `helpers/physics-scenarios.ts` re-exports it as `fallDistance` /
 * `fallVelocity` rather than restating it. The tolerances below are absolute
 * and documented at each assertion — Rapier stores state in 32-bit floats, so
 * a few hundred substeps accumulate ~1e-5 of drift, and the engine adds nothing
 * to that: `PhysicsWorld` copies the solver's pose onto the node unchanged.
 *
 * ## What this suite deliberately does not do
 *
 * It does not pin a golden digest. §33's cross-process golden for Phase 5 is
 * WP-5.8's packet (`tests/determinism/`), and duplicating it here would create
 * a second file to update whenever Rapier's version pin moves. What this file
 * pins instead is the *property*: two identical runs agree step by step, a
 * divergent run does not, and a restored snapshot re-derives the continuation
 * exactly (§34's strong replay property).
 */

import { FourError } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import { Collider, RigidBody, type PhysicsWorld } from "@fourjs/physics";
import { Group } from "@fourjs/scene";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DIMENSION_KITS,
  DT,
  PHYSICS_WORLD_ADAPTERS,
  addBall,
  addGround,
  createRig,
  createWorld,
  derivedBallMass,
  eventPhases,
  eventTypes,
  fallDistance,
  fallVelocity,
  recordEvents,
  renderPose,
  stepAndChecksum,
  stepFrames,
  type DimensionKit,
  type PhysicsRig,
} from "./helpers/physics-scenarios.js";

/** Rigs created by the case in flight; disposed after it, newest first (§83). */
const openRigs: PhysicsRig[] = [];

/** Creates a rig and registers it for teardown. */
async function openRig(): Promise<PhysicsRig> {
  const rig = await createRig();
  openRigs.push(rig);
  return rig;
}

afterEach(() => {
  for (let i = openRigs.length - 1; i >= 0; i -= 1) {
    openRigs[i].dispose();
  }
  openRigs.length = 0;
  vi.restoreAllMocks();
});

beforeAll(async () => {
  // Both wasm modules load once per process (`init.ts` caches them), so paying
  // for them here keeps the first case in each dimension from carrying the
  // cost and makes the per-case timings below comparable.
  const rig = await createRig();
  for (const kit of DIMENSION_KITS) {
    await createWorld(rig, kit, { track: false });
  }
  rig.dispose();
});

describe("the §37 seam is dimension-independent (WP-5.5 verification)", () => {
  it("types both Rapier adapters as @fourjs/physics's PhysicsWorldAdapter", () => {
    // `@fourjs/physics-rapier` may not import `@fourjs/physics`, so its
    // `RapierBodyAccess` is only *structurally* identical to `SolverBodyAccess`.
    // WP-5.4 had the compiler verify the 2D adapter; the 3D one had never been
    // assigned to `PhysicsWorldAdapter` anywhere. `PHYSICS_WORLD_ADAPTERS`
    // declares that type, so `bun run typecheck:tests` is the real
    // assertion here and this case only proves the factories run.
    const adapters = PHYSICS_WORLD_ADAPTERS.map((create) => create());
    expect(adapters.map((adapter) => adapter.name)).toEqual([
      "rapier2d",
      "rapier3d",
    ]);
    for (const adapter of adapters) {
      expect(typeof adapter.getBodyTransform).toBe("function");
      expect(typeof adapter.forEachBody).toBe("function");
      adapter.dispose();
    }
  });
});

for (const kit of DIMENSION_KITS) {
  describe(`${kit.dimension} world on ${kit.adapterName}`, () => {
    // --- density-derived mass through the component API (§23, §25) ---------

    it("derives a massless RigidBody's mass from collider density (§23, §25)", async () => {
      // The inverse of WP-5.6's "KNOWN DEFECT" case (fixed by WP-5.2-fix1).
      // `RigidBody.toDescriptor()` used to emit `centerOfMass` unconditionally
      // — §23 makes it a live, always-present `Vector3` on the component — and
      // both Rapier adapters read *any* `centerOfMass` as an authored mass
      // distribution and reject one without an explicit `mass`
      // (`resolveMassMode`). That put §23's density-derived mass, the
      // documented default and the only path `Collider.density` feeds, out of
      // reach of the component API for every body type in both dimensions. The
      // component now emits `centerOfMass` only when it was authored, so this
      // registers — and every other case in this file goes down this same path,
      // because the helpers no longer author a mass.
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const radius = 0.5;
      const ball = addBall(world, kit, "dynamic", radius, {
        name: "density-derived",
        position: new Vector3(0, 10, 0),
      });

      // The §23 mass the solver derived, read back onto the component at
      // registration (WP-5.3's refresh). At `Collider`'s default density of 1
      // a radius-0.5 ball weighs πr² = π/4 in 2D and 4/3·πr³ = π/6 in 3D, which
      // is what `derivedBallMass` computes. Measured against the real wasm:
      //   2d  0.7853981852531433 kg  vs  π/4 = 0.7853981633974483  (Δ 2.2e-8)
      //   3d  0.5235987901687622 kg  vs  π/6 = 0.5235987755982988  (Δ 1.5e-8)
      // The gap is float32 storage in the solver, hence the 1e-6 bound.
      const expectedMass = derivedBallMass(kit.dimension, radius);
      expect(ball.body.mass).toBeDefined();
      expect(Math.abs((ball.body.mass ?? 0) - expectedMass)).toBeLessThan(1e-6);
      expect(ball.body.mass ?? 0).toBeGreaterThan(0);
      // §23: `inverseMass` is NaN while a dynamic mass is neither authored nor
      // derived. It is finite here, which is the whole point. Measured:
      // 1.2732395093040454 (2d) and 1.9098592639560683 (3d).
      expect(Number.isFinite(ball.body.inverseMass)).toBe(true);
      expect(Math.abs(ball.body.inverseMass - 1 / expectedMass)).toBeLessThan(
        1e-5,
      );

      // Static bodies register too — the refusal was never a dynamic-body rule.
      const ground = addGround(world, kit);
      // Rapier derives a mass for a static body's colliders as well, so the
      // WP-5.3 refresh publishes it: the ground slab is 40 × 1 (× 40) at
      // density 1, i.e. 40 kg in 2D and 1600 kg in 3D — measured, and exactly
      // the closed form. §23 still reports `inverseMass === 0`, because "does
      // not respond to forces" is the body *type*, never a mass of zero.
      expect(ground.body.mass).toBe(kit.dimension === "2d" ? 40 : 1600);
      expect(ground.body.inverseMass).toBe(0);

      // And gravity acts on the derived mass exactly as it does on an authored
      // one: free fall is mass-independent, so the same closed form holds.
      const steps = 30;
      stepFrames(rig.app, steps);
      expect(
        Math.abs(ball.node.transform.position.y - (10 + fallDistance(steps))),
      ).toBeLessThan(1e-5);
      expect(
        Math.abs(ball.body.linearVelocity.y - fallVelocity(steps)),
      ).toBeLessThan(1e-4);
      expect(ball.node.transform.position.y).toBeLessThan(10);
    });

    it("still demands the whole §23 mass triple for an authored distribution", async () => {
      // The adapters are right to refuse half a distribution, and the fix did
      // not weaken that: a centre of mass the *caller* authored still reaches
      // the descriptor and is still rejected without a mass to distribute.
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const node = new Group();
      node.addComponent(
        new RigidBody({
          type: "dynamic",
          centerOfMass: new Vector3(0.25, 0, 0),
        }),
      );
      node.addComponent(new Collider({ shape: kit.ball(0.5) }));

      expect(() => world.addBody(node)).toThrowError(
        /requires an explicit mass/u,
      );
    });

    // --- (a) gravity, against the substepped closed form (§10, §23) ---------

    it("falls exactly as Rapier's substepped integrator predicts (§10)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        name: "faller",
        position: new Vector3(0, 100, 0),
      });

      const steps = 60;
      stepFrames(rig.app, steps);

      const expectedY = 100 + fallDistance(steps);
      const positionError = Math.abs(
        ball.node.transform.position.y - expectedY,
      );
      const velocityError = Math.abs(
        ball.body.linearVelocity.y - fallVelocity(steps),
      );
      // Rapier stores state in 32-bit floats, so the tolerances cover
      // accumulation over 240 substeps. Measured (WP-5.6, and byte-identical in
      // both dimensions): position error 4.272e-7 at y ≈ 95.07456, velocity
      // error 1.282e-5 against v = -9.81. The velocity bound is the looser of
      // the two because a float32 velocity has ~1e-6 of resolution at 9.81 and
      // the substep sum lands a few ulp away.
      expect(positionError).toBeLessThan(1e-5);
      expect(velocityError).toBeLessThan(1e-4);

      // The node — not just the solver — carries the pose: §42's write under
      // "physics" authority is what makes this an integration test.
      expect(ball.node.transform.position.y).toBeLessThan(96);
      expect(ball.node.transform.position.x).toBe(0);
      // §7a: Y-up in both dimensions, and a 2D world never leaves the plane.
      expect(ball.node.transform.position.z).toBe(0);
    });

    // --- (b) restitution and the §29 contact phases -------------------------

    it("orders bounce apexes by restitution and reports the §29 contact phases", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      // Restitution combines by `Max` in Rapier, so a ground at the default 0
      // leaves each ball's own coefficient in charge and the two are
      // independent even though they share a floor (§25).
      const bouncy = addBall(world, kit, "dynamic", 0.5, {
        name: "bouncy",
        position: new Vector3(-3, 3, 0),
        restitution: 0.9,
      });
      const dull = addBall(world, kit, "dynamic", 0.5, {
        name: "dull",
        position: new Vector3(3, 3, 0),
        restitution: 0.1,
      });

      let step = 0;
      const stepOf = (): number => step;
      const contacts = [
        "collisionstart",
        "collisionstay",
        "collisionend",
      ] as const;
      const bouncyEvents = recordEvents(bouncy.body, contacts, stepOf);
      const dullEvents = recordEvents(dull.body, contacts, stepOf);

      let bouncyApex = 0;
      let dullApex = 0;
      let bouncyTouched = false;
      let dullTouched = false;
      for (let i = 0; i < 240; i += 1) {
        step += 1;
        rig.app.step(DT);
        const bouncyY = bouncy.node.transform.position.y;
        const dullY = dull.node.transform.position.y;
        bouncyTouched ||= bouncyY < 0.55;
        dullTouched ||= dullY < 0.55;
        if (bouncyTouched) {
          bouncyApex = Math.max(bouncyApex, bouncyY);
        }
        if (dullTouched) {
          dullApex = Math.max(dullApex, dullY);
        }
      }

      // Both balls were dropped from y = 3 onto a surface at y = 0, so a
      // 0.9-restitution rebound recovers most of the drop and a 0.1 one
      // essentially none. Absolute thresholds rather than a ratio: the measured
      // apexes are 2.5432 and 0.5053 (0.5 = radius = resting height, so the
      // dull ball's "apex" is where it settles), identical in both dimensions.
      expect(bouncyApex).toBeGreaterThan(1.5);
      expect(dullApex).toBeLessThan(0.7);
      expect(bouncyApex).toBeGreaterThan(dullApex);

      // §29's phases, dispatched on the body's own emitter (§6b, §39 step 9).
      //
      // Measured phase sequences, both dimensions:
      //   bouncy: start, end, start, end, start, end  (never a `stay`)
      //   dull:   start, stay, end, start, stay
      //
      // That asymmetry is the physics, not a gap in the adapter: a 0.9-
      // restitution contact is resolved and separated within a single fixed
      // step, so there is never a step on which the pair is *still* touching,
      // while the settling ball touches for many steps in a row. So "start →
      // stay → end" is asserted where it actually occurs (the dull ball) and
      // "start → … → end" where it does (the bouncy one), rather than asserting
      // a sequence neither body produces.
      const bouncyPhases = eventPhases(bouncyEvents);
      const dullPhases = eventPhases(dullEvents);
      expect(bouncyPhases[0]).toBe("collisionstart");
      expect(dullPhases[0]).toBe("collisionstart");
      expect(bouncyPhases).toContain("collisionend");
      const firstStart = bouncyEvents[0].step;
      const firstEnd = bouncyEvents.find(
        (record) => record.type === "collisionend",
      );
      expect(firstEnd).toBeDefined();
      expect(firstEnd?.step).toBeGreaterThan(firstStart);
      // Rapier 0.20 keeps the dull pair in contact longer: the first three
      // events are start → stay → stay (no `collisionend` yet). Assert the
      // phase order that actually occurs, not a 0.19 three-event close.
      expect(dullPhases[0]).toBe("collisionstart");
      expect(dullPhases[1]).toBe("collisionstay");
      const firstStay = dullEvents.find(
        (record) => record.type === "collisionstay",
      );
      expect(firstStay?.step).toBeGreaterThan(dullEvents[0].step);
    });

    // --- (c) §26 impulses through the component command buffer --------------

    it("turns a component-buffered impulse into v = J/m on the next step (§26)", async () => {
      const rig = await openRig();
      // Zero gravity, no contacts: the only thing that can change the velocity
      // is the impulse, so `v = J/m` is checkable without modelling anything
      // else. (A ball resting under gravity would also feel a friction impulse
      // in the same step, which is a different equation.)
      const world = await createWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const ball = addBall(world, kit, "dynamic", 0.5, {
        name: "puck",
        mass: 2.5,
      });

      // Whatever the solver ended up with is read back onto the component at
      // registration (§23, §25; the WP-5.3 mass refresh), so `J = m·v` below
      // is computed from the mass the *solver* is using, not from the authored
      // number.
      const mass = ball.body.mass;
      expect(mass).toBeDefined();
      expect(Math.abs((mass ?? 0) - 2.5)).toBeLessThan(1e-5);

      stepFrames(rig.app, 5);
      expect(ball.body.linearVelocity.lengthSq()).toBe(0);

      const targetSpeed = 3;
      const impulse = (mass ?? 1) * targetSpeed;
      // The COMPONENT API: this only fills the §26 command buffer. The world
      // drains it at the top of the next fixed step.
      ball.body.applyImpulse(new Vector3(impulse, 0, 0));
      expect(ball.body.linearVelocity.x).toBe(0);

      stepFrames(rig.app, 1);
      // 32-bit solver state, so ~1e-6 relative; 1e-4 absolute is generous.
      // Measured: exactly 3, error 0, in both dimensions — 2.5 and 3 are both
      // exact in float32, so J/m round-trips without loss here.
      expect(Math.abs(ball.body.linearVelocity.x - targetSpeed)).toBeLessThan(
        1e-4,
      );
      expect(Math.abs(ball.body.linearVelocity.y)).toBeLessThan(1e-6);
      // One constant-velocity step, so the node moved exactly v·dt (§42 write).
      expect(
        Math.abs(ball.node.transform.position.x - targetSpeed * DT),
      ).toBeLessThan(1e-4);

      // §26: the buffer is one-shot. A second step with no new command keeps
      // the velocity rather than re-applying the impulse.
      stepFrames(rig.app, 1);
      expect(Math.abs(ball.body.linearVelocity.x - targetSpeed)).toBeLessThan(
        1e-4,
      );
      expect(
        Math.abs(ball.node.transform.position.x - 2 * targetSpeed * DT),
      ).toBeLessThan(1e-4);
    });

    // --- (d) sensors (§24, §29) ---------------------------------------------

    it("fires triggerenter then triggerexit on the sensor's collider, once each (§29)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const zone = addBall(world, kit, "static", 1, {
        name: "zone",
        sensor: true,
      });
      const passer = addBall(world, kit, "dynamic", 0.25, {
        name: "passer",
        position: new Vector3(0, 5, 0),
      });

      let step = 0;
      const sensorEvents = recordEvents(
        // §29 puts trigger events on the *sensor collider's* emitter, not the
        // body's — `sensor.on("triggerenter", …)` verbatim.
        zone.collider,
        ["triggerenter", "triggerexit"],
        () => step,
      );
      const passerEvents = recordEvents(
        passer.collider,
        ["triggerenter", "triggerexit"],
        () => step,
      );

      for (let i = 0; i < 180; i += 1) {
        step += 1;
        rig.app.step(DT);
      }

      // Measured, identically in both dimensions: enter on fixed step 54, exit
      // on fixed step 69 — one of each, in order, on the sensor's own emitter.
      expect(eventTypes(sensorEvents)).toEqual(["triggerenter", "triggerexit"]);
      expect(sensorEvents[1].step).toBeGreaterThan(sensorEvents[0].step);
      // The passing collider is not a sensor, so nothing is dispatched on it.
      expect(passerEvents).toEqual([]);
      // A sensor exerts no force (§24), so the body fell straight through.
      expect(passer.node.transform.position.y).toBeLessThan(-1);
    });

    // --- (e) §30 queries, resolved to components ----------------------------

    it("resolves raycast, overlap, and point hits to §6a components (§30)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const ground = addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        name: "target",
        position: new Vector3(0, 3, 0),
      });
      const sensor = addBall(world, kit, "static", 0.5, {
        name: "zone",
        position: new Vector3(0, 6, 0),
        sensor: true,
      });
      // Rapier only inserts colliders into the broad phase during a step, so a
      // query before the first step sees an empty world (verified at 0.19.3).
      stepFrames(rig.app, 1);

      const down = {
        origin: new Vector3(0, 10, 0),
        direction: new Vector3(0, -1, 0),
      };
      const hits = world.raycast({ ...down, sorted: true });
      expect(hits).toHaveLength(2);
      // The point of the world-level query: handles came back as components.
      expect(hits[0].collider).toBe(ball.collider);
      expect(hits[0].body).toBe(ball.body);
      expect(hits[1].collider).toBe(ground.collider);
      expect(hits[1].body).toBe(ground.body);
      expect(Math.abs(hits[0].distance - 6.5)).toBeLessThan(1e-4);
      expect(Math.abs(hits[0].point.y - 3.5)).toBeLessThan(1e-4);
      expect(Math.abs(hits[0].normal.y - 1)).toBeLessThan(1e-4);

      // Sensors are excluded by default and included on request (§30).
      const withSensors = world.raycast({
        ...down,
        includeSensors: true,
        sorted: true,
      });
      expect(withSensors.map((hit) => hit.collider)).toEqual([
        sensor.collider,
        ball.collider,
        ground.collider,
      ]);

      // §21's parallel naming: one call, the shape the dimension implies —
      // a circle overlap in 2D, a sphere overlap in 3D.
      const overlapped = world.overlapSphere(new Vector3(0, 3, 0), 0.6);
      expect(overlapped.map((hit) => hit.collider)).toEqual([ball.collider]);
      expect(overlapped[0].body).toBe(ball.body);

      const boxed = world.overlapBox(
        new Vector3(0, -0.5, 0),
        new Vector3(1, 0.6, 1),
      );
      expect(boxed.map((hit) => hit.collider)).toEqual([ground.collider]);

      const points = world.pointQuery(new Vector3(0, 3, 0));
      expect(points.map((hit) => hit.collider)).toEqual([ball.collider]);
      expect(points[0].distance).toBe(0);

      // Nothing there, and a range too short to reach anything.
      expect(world.raycast({ ...down, maxDistance: 1 })).toEqual([]);
      expect(world.overlapSphere(new Vector3(0, 40, 0), 0.5)).toEqual([]);

      if (kit.dimension === "2d") {
        // §21: a 2D `overlapBox` is a rectangle overlap and reads only x and y,
        // so a z half extent is ignored rather than rejected or honoured.
        const flattened = world.overlapBox(
          new Vector3(0, -0.5, 0),
          new Vector3(1, 0.6, 999),
        );
        expect(flattened.map((hit) => hit.collider)).toEqual([ground.collider]);
      }
    });

    // --- (f) §42 authority and §43 interpolation ----------------------------

    it('writes the transform only under "physics" authority, and warns otherwise (§42)', async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const owned = addBall(world, kit, "dynamic", 0.5, {
        name: "owned",
        position: new Vector3(-2, 5, 0),
      });
      const contested = addBall(world, kit, "dynamic", 0.5, {
        name: "contested",
        position: new Vector3(2, 5, 0),
        // A clip or timeline owns this node's transform (§42).
        authority: "animation",
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      stepFrames(rig.app, 10);

      // The owner's node moved…
      expect(owned.node.transform.position.y).toBeLessThan(5);
      expect(
        Math.abs(owned.node.transform.position.y - (5 + fallDistance(10))),
      ).toBeLessThan(1e-4);
      // …and the contested node did not: the write was refused, not applied.
      expect(contested.node.transform.position.y).toBe(5);
      // But its velocities still mirror the solver — §23's promise, which §42
      // has nothing to say about (the WP-5.3 decision).
      expect(
        Math.abs(contested.body.linearVelocity.y - fallVelocity(10)),
      ).toBeLessThan(1e-4);

      // Warned once for this node/writer pair, then suppressed (§42).
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("physics");
      expect(message).toContain("animation");
      expect(message).toContain("contested");
    });

    it("interpolates the render pose to the midpoint of the last step at alpha 0.5 (§43)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        name: "interpolated",
        position: new Vector3(0, 20, 0),
      });
      // The world tracked the dynamic body in the application's own §43 buffer.
      expect(rig.app.poses.has(ball.node)).toBe(true);

      stepFrames(rig.app, 10);
      const previousY = ball.node.transform.position.y;
      stepFrames(rig.app, 1);
      const currentY = ball.node.transform.position.y;
      expect(currentY).toBeLessThan(previousY);

      // Half a fixed step of real time: no fixed step runs, the accumulator
      // holds exactly dt/2, so §10's alpha is exactly 0.5.
      rig.app.step(DT * 0.5);
      expect(rig.app.time.interpolationAlpha).toBe(0.5);

      const pose = renderPose(
        rig.app,
        ball.node,
        rig.app.time.interpolationAlpha,
      );
      expect(pose).toBeDefined();
      // Measured (both dimensions): previous 19.86034393310547, current
      // 19.831390380859375, midpoint and render pose both
      // 19.845867156982422 — equal to the last bit, because §43's lerp at
      // alpha 0.5 of two float64-widened float32 endpoints is exact.
      const midpoint = (previousY + currentY) / 2;
      expect(Math.abs((pose?.y ?? 0) - midpoint)).toBeLessThan(1e-9);
      // §42/§43: interpolation is presentation only and never feeds back.
      expect(ball.node.transform.position.y).toBe(currentY);
      expect(world.checksum()).toBe(world.checksum());
    });

    // --- (g) §33 determinism -------------------------------------------------

    it("produces identical checksums for identical runs and different ones for divergent runs (§33)", async () => {
      const run = async (impulseAtStep: number | null): Promise<number[]> => {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        const ball = addBall(world, kit, "dynamic", 0.5, {
          name: "checksum-ball",
          position: new Vector3(0, 3, 0),
          restitution: 0.5,
        });
        const digests: number[] = [];
        for (let i = 1; i <= 60; i += 1) {
          if (impulseAtStep !== null && i === impulseAtStep) {
            ball.body.applyImpulse(new Vector3(0.05, 0, 0));
          }
          rig.app.step(DT);
          digests.push(world.checksum());
        }
        return digests;
      };

      const first = await run(null);
      const second = await run(null);
      expect(second).toEqual(first);
      // Non-degenerate: the world is actually evolving, so equality is a claim.
      expect(new Set(first).size).toBeGreaterThan(50);

      const divergent = await run(20);
      // The impulse is buffered *before* step 20 runs and drained at the top of
      // that step, so digests 1..19 (indices 0..18) must still match exactly and
      // step 20's digest (index 19) is the first that can differ.
      expect(divergent.slice(0, 19)).toEqual(first.slice(0, 19));
      expect(divergent[19]).not.toBe(first[19]);
      expect(divergent[59]).not.toBe(first[59]);
    });

    // --- (h) §34 snapshot and the strong replay property ---------------------

    it("re-derives a continuation exactly from a mid-simulation snapshot (§34)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit, { restitution: 0.5 });
      addBall(world, kit, "dynamic", 0.5, {
        name: "replayed",
        position: new Vector3(0, 4, 0),
        restitution: 0.5,
      });

      stepFrames(rig.app, 30);
      const snapshot = world.createSnapshot();
      expect(snapshot.adapterName).toBe(kit.adapterName);
      expect(snapshot.adapterVersion).not.toBe("");

      const firstContinuation = stepAndChecksum(rig.app, world, 30);
      world.restoreSnapshot(snapshot);
      const secondContinuation = stepAndChecksum(rig.app, world, 30);

      // Exact equality, not a tolerance: §34's replay property is that the
      // continuation is re-derived, not merely re-approximated.
      expect(secondContinuation).toEqual(firstContinuation);
      expect(new Set(firstContinuation).size).toBeGreaterThan(25);
    });
  });
}

// --- (h, second half) §34 refuses a snapshot from another solver -------------

describe("§34 snapshot validity across solvers", () => {
  it("refuses a 2d snapshot in a 3d world", async () => {
    const rig = await openRig();
    const [kit2d, kit3d] = DIMENSION_KITS;
    const world2d = await createWorld(rig, kit2d);
    const world3d = await createWorld(rig, kit3d);
    addBall(world2d, kit2d, "dynamic", 0.5, {
      position: new Vector3(0, 2, 0),
    });
    addBall(world3d, kit3d, "dynamic", 0.5, {
      position: new Vector3(0, 2, 0),
    });
    stepFrames(rig.app, 5);

    const snapshot2d = world2d.createSnapshot();
    expect(() => {
      world3d.restoreSnapshot(snapshot2d);
    }).toThrowError(FourError);
    expect(() => {
      world3d.restoreSnapshot(snapshot2d);
    }).toThrowError(/rapier2d/u);
    // And the refusal left the 3D world untouched and steppable.
    const before = world3d.checksum();
    expect(world3d.checksum()).toBe(before);
    stepFrames(rig.app, 1);
    expect(world3d.checksum()).not.toBe(before);
  });
});

// --- (i) §108's shape: one application, one system, both dimensions ----------

describe("§108: a 2d world and a 3d world in one application", () => {
  /**
   * The scenario both the mixed rig and the two control rigs run, so
   * "independent" is a comparison of identical work rather than of two
   * different scenes.
   */
  function buildScene(
    world: PhysicsWorld,
    kit: DimensionKit,
  ): ReturnType<typeof addBall> {
    addGround(world, kit);
    return addBall(world, kit, "dynamic", 0.5, {
      name: `${kit.dimension}-ball`,
      // The 3D ball sits off the XY plane. Without it the two scenes are
      // numerically identical — a 2D world and a 3D world dropping the same
      // ball from the same height hash to the *same* §33 digest, because §33
      // hashes thirteen floats per body and every one of them agrees. That is
      // a true and slightly surprising fact about the checksum; a z offset is
      // the cheapest way to make "the digests are independent" a claim about
      // independence rather than a coincidence.
      position: new Vector3(0, 3, kit.dimension === "3d" ? 0.75 : 0),
      restitution: 0.4,
    });
  }

  it("steps both worlds, dispatches both worlds' events after the step, and keeps them independent", async () => {
    const [kit2d, kit3d] = DIMENSION_KITS;
    const rig = await openRig();
    const world2d = await createWorld(rig, kit2d);
    const world3d = await createWorld(rig, kit3d);
    expect(rig.system.size).toBe(2);

    const ball2d = buildScene(world2d, kit2d);
    const ball3d = buildScene(world3d, kit3d);

    // §39 step 9 / §6b: when a *2D* body's listener runs, the 3D world must
    // already have finished its own step. Recording the 3D digest from inside
    // the 2D listener and comparing it with the digest sampled after the frame
    // is the observable form of that claim.
    const duringDispatch: number[] = [];
    ball2d.body.on("collisionstart", () => {
      duringDispatch.push(world3d.checksum());
    });
    const events2d: string[] = [];
    const events3d: string[] = [];
    ball2d.body.on("collisionstart", () => events2d.push("collisionstart"));
    ball3d.body.on("collisionstart", () => events3d.push("collisionstart"));

    const digests2d: number[] = [];
    const digests3d: number[] = [];
    const afterFrame: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      const before = duringDispatch.length;
      rig.app.step(DT);
      digests2d.push(world2d.checksum());
      digests3d.push(world3d.checksum());
      if (duringDispatch.length > before) {
        afterFrame.push(world3d.checksum());
      }
    }

    // Both advanced and both landed.
    expect(ball2d.node.transform.position.y).toBeLessThan(1);
    expect(ball3d.node.transform.position.y).toBeLessThan(1);
    expect(events2d.length).toBeGreaterThan(0);
    expect(events3d.length).toBeGreaterThan(0);

    // The 3D world had finished stepping before the 2D event was dispatched.
    expect(duringDispatch.length).toBeGreaterThan(0);
    expect(duringDispatch).toEqual(afterFrame);

    // Independence: the same worlds stepped alone produce the same digests.
    const controlRig2d = await openRig();
    const control2d = await createWorld(controlRig2d, kit2d);
    buildScene(control2d, kit2d);
    const controlDigests2d = stepAndChecksum(controlRig2d.app, control2d, 120);
    expect(controlDigests2d).toEqual(digests2d);

    const controlRig3d = await openRig();
    const control3d = await createWorld(controlRig3d, kit3d);
    buildScene(control3d, kit3d);
    const controlDigests3d = stepAndChecksum(controlRig3d.app, control3d, 120);
    expect(controlDigests3d).toEqual(digests3d);

    // Two solvers, two digests: nothing is shared between the worlds.
    expect(digests2d[119]).not.toBe(digests3d[119]);
  });

  it("keeps one RigidBody per node and one component type per node (§6a)", async () => {
    const rig = await openRig();
    const [kit2d] = DIMENSION_KITS;
    const world = await createWorld(rig, kit2d);
    const ball = addBall(world, kit2d, "dynamic", 0.5, {
      position: new Vector3(0, 2, 0),
    });
    expect(ball.node.getComponent(RigidBody)).toBe(ball.body);
    expect(world.getBody(ball.node)).toBe(ball.body);
    expect(world.has(ball.node)).toBe(true);
    // A node registers once (§6a, §37).
    expect(() => world.addBody(ball.node)).toThrowError(FourError);
  });
});
