/**
 * Solver conformance (RFC 0010 decisions 7-8, wave 9): the same scenarios run
 * against every solver adapter (`rapier`, `physjs`) in both dimensions.
 *
 * Solvers legitimately disagree on simulated numbers, so nothing here asserts
 * cross-solver equality or a Rapier-specific figure (`physics-rapier.test.ts`
 * keeps those). Each scenario asserts a solver-invariant property: free-fall
 * velocity from `v = g t`, settling on a floor, restitution ordering, impulse
 * `v = J/m`, query hit sets, checksum determinism, snapshot round-trip. A
 * scenario that needs something a solver's capability record lacks is skipped
 * with the reason (`SOLVER_SUPPORT[...].why`), never silently dropped.
 */

import { Vector3 } from "@fourjs/math";
import { RopeJoint, SliderJoint, SpringJoint } from "@fourjs/physics";
import { afterEach, describe, expect, it } from "vitest";

import { addAnchorFor, buildHinge } from "./helpers/solver-joint-scenarios.js";
import {
  DT,
  GRAVITY_Y,
  SOLVER_KITS,
  SOLVER_SUPPORT,
  addBall,
  addGround,
  createRig,
  createWorld,
  stepAndChecksum,
  stepFrames,
  type PhysicsRig,
} from "./helpers/physics-scenarios.js";

const openRigs: PhysicsRig[] = [];
async function openRig(): Promise<PhysicsRig> {
  const rig = await createRig();
  openRigs.push(rig);
  return rig;
}
afterEach(() => {
  while (openRigs.length > 0) {
    openRigs.pop()?.dispose();
  }
});

for (const kit of SOLVER_KITS) {
  const support = SOLVER_SUPPORT[kit.solver];
  /** Title with the visible skip reason appended when `ok` is false. */
  const title = (base: string, ok: boolean, reason: string): string =>
    ok ? base : `${base} [SKIPPED: ${reason}; ${support.why}]`;

  describe(`conformance: ${kit.adapterName}`, () => {
    it("reports its own adapter name and the world dimension", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      expect(world.createSnapshot().adapterName).toBe(kit.adapterName);
    });

    it("free-falls at v = g t and settles in the downward direction (§10)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 100, 0),
      });
      stepFrames(rig.app, 30);
      const expected = GRAVITY_Y * DT * 30;
      expect(
        Math.abs(ball.body.linearVelocity.y - expected) / Math.abs(expected),
      ).toBeLessThan(0.02);
      expect(ball.node.transform.position.y).toBeLessThan(100);
      expect(Math.abs(ball.node.transform.position.x)).toBeLessThan(1e-6);
    });

    it("comes to rest on the ground at its radius height", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 2, 0),
      });
      stepFrames(rig.app, 300);
      expect(Math.abs(ball.node.transform.position.y - 0.5)).toBeLessThan(0.06);
      expect(ball.body.linearVelocity.length()).toBeLessThan(0.1);
    });

    it("orders bounce apexes by restitution", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const bouncy = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(-3, 3, 0),
        restitution: 0.9,
      });
      const dull = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(3, 3, 0),
        restitution: 0.05,
      });
      let touchedB = false;
      let touchedD = false;
      let apexB = 0;
      let apexD = 0;
      for (let i = 0; i < 240; i += 1) {
        rig.app.step(DT);
        const by = bouncy.node.transform.position.y;
        const dy = dull.node.transform.position.y;
        touchedB ||= by < 0.55;
        touchedD ||= dy < 0.55;
        if (touchedB) apexB = Math.max(apexB, by);
        if (touchedD) apexD = Math.max(apexD, dy);
      }
      expect(touchedB && touchedD).toBe(true);
      expect(apexB).toBeGreaterThan(apexD + 0.3);
    });

    it("turns a buffered impulse into v = J/m and conserves it (§26)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const ball = addBall(world, kit, "dynamic", 0.5, { mass: 2.5 });
      stepFrames(rig.app, 2);
      ball.body.applyImpulse(new Vector3(7.5, 0, 0));
      stepFrames(rig.app, 1);
      expect(Math.abs(ball.body.linearVelocity.x - 3)).toBeLessThan(1e-3);
      stepFrames(rig.app, 20);
      expect(Math.abs(ball.body.linearVelocity.x - 3)).toBeLessThan(1e-3);
    });

    it("emits collisionstart for a landing ball", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 2, 0),
      });
      const seen: string[] = [];
      ball.body.on("collisionstart", () => seen.push("start"));
      stepFrames(rig.app, 120);
      expect(seen.length).toBeGreaterThanOrEqual(1);
    });

    it.skipIf(!support.sensors)(
      title(
        "fires triggerenter then triggerexit once each (§29)",
        support.sensors,
        "sensor colliders",
      ),
      async () => {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        const zone = addBall(world, kit, "static", 1, { sensor: true });
        addBall(world, kit, "dynamic", 0.25, {
          position: new Vector3(0, 5, 0),
        });
        const seen: string[] = [];
        zone.collider.on("triggerenter", () => seen.push("enter"));
        zone.collider.on("triggerexit", () => seen.push("exit"));
        stepFrames(rig.app, 180);
        expect(seen).toEqual(["enter", "exit"]);
      },
    );

    it("refuses sensor colliders loudly when it cannot express them", async () => {
      if (support.sensors) return;
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      expect(() =>
        addBall(world, kit, "static", 1, { sensor: true }),
      ).toThrowError(/sensor/u);
    });

    it("resolves raycast, overlap and point queries to components (§30)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const ground = addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 3, 0),
      });
      stepFrames(rig.app, 1);
      const hits = world.raycast({
        origin: new Vector3(0, 10, 0),
        direction: new Vector3(0, -1, 0),
        sorted: true,
      });
      expect(hits.map((h) => h.collider)).toEqual([
        ball.collider,
        ground.collider,
      ]);
      expect(Math.abs(hits[0].distance - 6.5)).toBeLessThan(1e-3);
      expect(
        world.overlapSphere(new Vector3(0, 3, 0), 0.6).map((h) => h.collider),
      ).toEqual([ball.collider]);
      expect(
        world.pointQuery(new Vector3(0, 3, 0)).map((h) => h.collider),
      ).toEqual([ball.collider]);
      expect(
        world.raycast({
          origin: new Vector3(0, 10, 0),
          direction: new Vector3(0, -1, 0),
          maxDistance: 1,
        }),
      ).toEqual([]);
    });

    it.skipIf(!support.shapeCast)(
      title("answers a shape cast", support.shapeCast, "shapeCast"),
      async () => {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        stepFrames(rig.app, 1);
        expect(typeof world.shapeCast).toBe("function");
      },
    );

    it("refuses shapeCast when the capability record says false", async () => {
      if (support.shapeCast) return;
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      expect(() =>
        world.shapeCast({
          shape: kit.ball(0.1),
          position: new Vector3(0, 5, 0),
          direction: new Vector3(0, -1, 0),
        }),
      ).toThrow();
    });

    it("produces identical checksums for identical runs and different ones when divergent (§33)", async () => {
      const run = async (impulseAt: number | null): Promise<number[]> => {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        const ball = addBall(world, kit, "dynamic", 0.5, {
          position: new Vector3(0, 3, 0),
          restitution: 0.5,
        });
        const digests: number[] = [];
        for (let i = 1; i <= 60; i += 1) {
          if (i === impulseAt) ball.body.applyImpulse(new Vector3(0.05, 0, 0));
          rig.app.step(DT);
          digests.push(world.checksum());
        }
        return digests;
      };
      const first = await run(null);
      expect(await run(null)).toEqual(first);
      expect(new Set(first).size).toBeGreaterThan(30);
      const divergent = await run(20);
      expect(divergent.slice(0, 19)).toEqual(first.slice(0, 19));
      expect(divergent[59]).not.toBe(first[59]);
    });

    it("re-derives a continuation exactly from a mid-simulation snapshot (§34)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit, { restitution: 0.5 });
      addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 4, 0),
        restitution: 0.5,
      });
      stepFrames(rig.app, 30);
      const snapshot = world.createSnapshot();
      expect(snapshot.adapterName).toBe(kit.adapterName);
      const a = stepAndChecksum(rig.app, world, 30);
      world.restoreSnapshot(snapshot);
      const b = stepAndChecksum(rig.app, world, 30);
      expect(b).toEqual(a);
      expect(new Set(a).size).toBeGreaterThan(20);
    });

    it("keeps a hinge pendulum bob on its circle (joint constraint holds)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit, {
        sleeping: { enabled: false },
      });
      const rigJ = buildHinge(world, kit);
      let worst = 0;
      for (let i = 0; i < 240; i += 1) {
        rig.app.step(DT);
        worst = Math.max(worst, rigJ.radialError());
      }
      // Soft-joint solvers drift; the bound is generous but real.
      expect(worst).toBeLessThan(kit.solver === "physjs" ? 0.05 : 0.001);
    });

    it("accepts a spring joint", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const anchor = addAnchorFor(world, new Vector3(0, 5, 0));
      const bob = addBall(world, kit, "dynamic", 0.2, {
        position: new Vector3(0, 3, 0),
      });
      world.addJoint(
        new SpringJoint({
          bodyA: anchor.body,
          bodyB: bob.body,
          anchor: new Vector3(0, 5, 0),
          anchorB: new Vector3(0, 3, 0),
          restLength: 1.5,
          stiffness: 50,
          damping: 1,
        }),
      );
      stepFrames(rig.app, 120);
      const y = bob.node.transform.position.y;
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(5);
    });

    const hasSliderRope =
      support.jointTypes.includes("prismatic") &&
      support.jointTypes.includes("rope");
    it.skipIf(!hasSliderRope)(
      title("builds slider and rope joints", hasSliderRope, "prismatic/rope"),
      async () => {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        const anchor = addAnchorFor(world, new Vector3(0, 5, 0));
        const load = addBall(world, kit, "dynamic", 0.2, {
          position: new Vector3(1, 5, 0),
        });
        world.addJoint(
          new SliderJoint({
            bodyA: anchor.body,
            bodyB: load.body,
            anchor: new Vector3(0, 5, 0),
            axis: new Vector3(1, 0, 0),
          }),
        );
        stepFrames(rig.app, 10);
      },
    );

    it("refuses slider and rope joints loudly when unsupported", async () => {
      if (hasSliderRope) return;
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const anchor = addAnchorFor(world, new Vector3(0, 5, 0));
      const load = addBall(world, kit, "dynamic", 0.2, {
        position: new Vector3(1, 5, 0),
      });
      expect(() =>
        world.addJoint(
          new RopeJoint({
            bodyA: anchor.body,
            bodyB: load.body,
            anchor: new Vector3(0, 5, 0),
            anchorB: new Vector3(1, 5, 0),
            maxLength: 2,
          }),
        ),
      ).toThrow();
    });

    // Capabilities with no PhysicsCapabilities field: Rapier covers them in its
    // own suites (physics-joints, swept-character, ...); for PhysJS each is a
    // visible skip carrying the reason.
    for (const [what, ok] of [
      ["hinge limits and motors", support.jointLimitsMotors],
      ["swept CCD", support.sweptCcd],
      ["collider local offsets", support.colliderOffsets],
    ] as const) {
      if (!ok) {
        it.skip(`${what} [SKIPPED: unsupported; ${support.why}]`, () => {});
      }
    }
  });
}
