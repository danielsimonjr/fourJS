/**
 * W8.4: `@fourjs/physics-box2d` conformance through the public `PhysicsWorld`
 * API (§20–§34, §37). A representative subset of the scenario intents the
 * Rapier suites (`physics-rapier.test.ts`, `physics-joints.test.ts`) cover,
 * run against `"box2d"`; `helpers/physics-scenarios.ts` is intentionally not
 * touched (it is Rapier-shaped and being generalised on another branch).
 *
 * Tolerances are analytic-with-slack and stated at each assertion. Differences
 * from Rapier that are *recorded rather than hidden*: friction combines by
 * `sqrt(a*b)` (Rapier / Appendix A: average), restitution by `max`, and a
 * §34 snapshot does not capture warm-start impulses, so the replay assertion
 * below starts from a quiescent state (a body in free fall: no touching
 * contacts, no loaded joints) — which is exactly the guarantee the adapter
 * makes, no more.
 */

import { isFourError } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import { HingeJoint, PhysicsWorld } from "@fourjs/physics";
import { BOX2D_CAPABILITIES } from "@fourjs/physics-box2d";
import { afterEach, describe, expect, it } from "vitest";

import {
  type Box2dWorldExtra,
  DT,
  ball,
  box2dRegistry,
  createBox2dWorld,
  ground,
  run,
  slab,
} from "./helpers/box2d-world.js";

const worlds: PhysicsWorld[] = [];
async function make(extra: Box2dWorldExtra = {}): Promise<PhysicsWorld> {
  const world = await createBox2dWorld(extra);
  worlds.push(world);
  return world;
}
afterEach(() => {
  for (const world of worlds.splice(0)) {
    world.dispose();
  }
});

describe("box2d conformance (public PhysicsWorld API)", () => {
  it("declares the capabilities the suites below rely on", () => {
    expect(BOX2D_CAPABILITIES.dimensions).toEqual(["2d"]);
    expect(BOX2D_CAPABILITIES.snapshots).toBe(true);
    expect(BOX2D_CAPABILITIES.determinism).toBe("same-runtime");
  });

  it("fall and rest: a ball lands on the ground and settles on its surface", async () => {
    const world = await make();
    ground(world);
    const b = ball(world, 0.5, {
      position: new Vector3(0, 3, 0),
      restitution: 0,
    });
    // Free fall: v = g t (semi-implicit Euler, one step of lag at most).
    run(world, 30);
    expect(b.body.linearVelocity.y).toBeLessThan(-4);
    run(world, 240);
    // Rests with its centre one radius above the ground; Box2D's linear slop
    // keeps a ~5 mm skin, so 2 cm absolute.
    expect(Math.abs(b.node.transform.position.y - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(b.body.linearVelocity.y)).toBeLessThan(0.05);
  });

  it("restitution: rebound apex follows e^2 (Box2D combines by max)", async () => {
    const world = await make({ sleeping: { enabled: false } });
    ground(world, { restitution: 0 });
    const b = ball(world, 0.5, {
      position: new Vector3(0, 5.5, 0),
      restitution: 0.5,
    });
    let hit = false;
    let apex = 0;
    for (let i = 0; i < 200; i += 1) {
      run(world, 1);
      const y = b.node.transform.position.y;
      if (!hit && b.body.linearVelocity.y > 0) {
        hit = true;
      }
      if (hit) {
        apex = Math.max(apex, y);
      }
    }
    expect(hit).toBe(true);
    // Drop of 5 m, e = 0.5 -> apex rise 1.25 m above the resting centre (0.5).
    // Measured within ~10 % (discrete restitution threshold and slop).
    expect(apex - 0.5).toBeGreaterThan(1.25 * 0.88);
    expect(apex - 0.5).toBeLessThan(1.25 * 1.12);
  });

  it("friction slide: stopping distance uses sqrt(mu_a * mu_b), not the mean", async () => {
    const world = await make({ sleeping: { enabled: false } });
    ground(world, { friction: 0.8 });
    const box = slab(world, 0.5, 0.5, {
      position: new Vector3(0, 0.5, 0),
      friction: 0.2,
      restitution: 0,
    });
    world.setLinearVelocity(box.node, new Vector3(5, 0, 0));
    run(world, 240);
    const slid = box.node.transform.position.x;
    const sqrtMu = Math.sqrt(0.8 * 0.2); // 0.4
    const expected = 25 / (2 * sqrtMu * 9.81); // 3.186 m
    const averaged = 25 / (2 * 0.5 * 9.81); // 2.549 m (what a mean would give)
    expect(Math.abs(slid - expected) / expected).toBeLessThan(0.06);
    expect(Math.abs(slid - averaged)).toBeGreaterThan(0.4);
  });

  it("joint pendulum with a motor cap: the cap is a hard torque limit", async () => {
    const world = await make({ gravity: new Vector3(0, 0, 0) });
    const anchor = slab(world, 0.1, 0.1, {
      type: "static",
      position: new Vector3(0, 0, 0),
    });
    const bar = slab(world, 0.4, 0.05, { position: new Vector3(0, 0, 0) });
    world.addJoint(
      new HingeJoint({
        bodyA: anchor.body,
        bodyB: bar.body,
        anchor: new Vector3(0, 0, 0),
        axis: new Vector3(0, 0, 1),
        motor: { enabled: true, targetVelocity: 20, maxTorque: 0.01 },
      }),
    );
    run(world, 30); // 0.5 s
    // Bar: m = 0.08 kg, I = m (w^2 + h^2) / 12 = 4.333e-3 kg m^2 (density 1).
    // alpha = 0.01 / I = 2.308 rad/s^2 -> omega(0.5 s) = 1.154 rad/s; an
    // uncapped motor would be at the 20 rad/s target by now.
    const omega = bar.body.angularVelocity.z;
    expect(omega).toBeGreaterThan(1.154 * 0.9);
    expect(omega).toBeLessThan(1.154 * 1.1);
    expect(omega).toBeLessThan(20 / 4);
  });

  it("free pendulum swings at the small-amplitude period", async () => {
    const world = await make();
    const pivot = slab(world, 0.1, 0.1, { type: "static" });
    const length = 1;
    const theta0 = 0.2;
    const bob = ball(world, 0.05, {
      position: new Vector3(
        length * Math.sin(theta0),
        -length * Math.cos(theta0),
        0,
      ),
      mass: 1,
    });
    world.addJoint(
      new HingeJoint({
        bodyA: pivot.body,
        bodyB: bob.body,
        anchor: new Vector3(0, 0, 0),
        axis: new Vector3(0, 0, 1),
      }),
    );
    // Release at +theta0; first return through x = 0 happens at T/4, T = 2 pi sqrt(L/g).
    let quarter = -1;
    for (let i = 1; i <= 120; i += 1) {
      run(world, 1);
      if (bob.node.transform.position.x <= 0) {
        quarter = i * DT;
        break;
      }
    }
    const period = 2 * Math.PI * Math.sqrt(length / 9.81);
    expect(quarter).toBeGreaterThan(0);
    // Finite amplitude adds ~0.25 %; point-mass vs small ball and the step
    // quantum (1/60 s) dominate, so 6 % of T/4.
    expect(Math.abs(quarter - period / 4) / (period / 4)).toBeLessThan(0.06);
  });

  it("sensor: triggerenter then triggerexit on the sensor, no force exerted", async () => {
    const world = await make();
    const sensor = slab(world, 2, 0.5, {
      type: "static",
      position: new Vector3(0, 3, 0),
      sensor: true,
    });
    const faller = ball(world, 0.25, { position: new Vector3(0, 6, 0) });
    const seen: string[] = [];
    sensor.collider.on("triggerenter", () => seen.push("triggerenter"));
    sensor.collider.on("triggerexit", () => seen.push("triggerexit"));
    run(world, 120);
    expect(seen).toEqual(["triggerenter", "triggerexit"]);
    // Fell straight through: well below the sensor slab.
    expect(faller.node.transform.position.y).toBeLessThan(2);
  });

  it("sleep and wake: a settled body sleeps, wake() rouses it", async () => {
    const world = await make();
    ground(world);
    const b = ball(world, 0.5, { position: new Vector3(0, 0.6, 0) });
    const events: string[] = [];
    b.body.on("sleep", () => events.push("sleep"));
    b.body.on("wake", () => events.push("wake"));
    run(world, 180);
    expect(b.body.sleeping).toBe(true);
    expect(events).toContain("sleep");
    b.body.wake();
    run(world, 2);
    expect(b.body.sleeping).toBe(false);
    expect(events).toContain("wake");
  });

  it("same-runtime determinism: two identical runs agree on every step checksum", async () => {
    const trace = async (): Promise<number[]> => {
      const world = await make();
      ground(world);
      for (let i = 0; i < 5; i += 1) {
        ball(world, 0.3, {
          position: new Vector3(i * 0.2, 1 + i, 0),
          restitution: 0.3,
        });
      }
      const sums: number[] = [];
      for (let i = 0; i < 120; i += 1) {
        run(world, 1);
        sums.push(world.checksum());
      }
      return sums;
    };
    const a = await trace();
    const b = await trace();
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(30);
  });

  it("snapshot round trip from a quiescent state re-derives the continuation exactly", async () => {
    const world = await make();
    ground(world);
    const b = ball(world, 0.5, {
      position: new Vector3(0, 20, 0),
      restitution: 0.4,
    });
    run(world, 20); // free fall: no touching contacts, no loaded joints
    expect(b.node.transform.position.y).toBeGreaterThan(10);
    const snapshot = world.createSnapshot();
    expect(snapshot.adapterName).toBe("box2d");
    const first: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      run(world, 1);
      first.push(world.checksum());
    }
    world.restoreSnapshot(snapshot);
    const second: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      run(world, 1);
      second.push(world.checksum());
    }
    // The continuation includes the landing, i.e. contacts formed *after*
    // the restore — fine, because only warm-start state is not captured.
    expect(second).toEqual(first);
  });

  it('solver "auto" skips box2d for a 3d world and names why', () => {
    const rejected: string[] = [];
    let caught: unknown;
    try {
      new PhysicsWorld({
        dimension: "3d",
        solver: "auto",
        solverRegistry: box2dRegistry(),
        onSolverReject: (report) => {
          rejected.push(JSON.stringify(report));
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    expect(String((caught as Error).message)).toContain("box2d");
    expect(rejected.length).toBe(1);
    expect(rejected[0]).toContain("unsupported");
  });

  it('solver "auto" selects box2d for a 2d world when it is the only candidate', async () => {
    const world = await make({ solver: "auto" });
    expect(world.adapter.name).toBe("box2d");
  });
});
