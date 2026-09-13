/**
 * §26/§27 force fields reach rigid bodies — and `@fourjs/particles`' §27 field set
 * is the same contract (PH-8, 2026-08-09).
 *
 * `@fourjs/physics` declares `ForceField` and `@fourjs/particles` declares
 * `ParticleForceField`. Both are §27's interface transcribed member-for-member,
 * and the frozen §3.1 dependency matrix has no edge between the two packages —
 * so **nothing type-checks the two declarations against each other except a
 * file that can import both**. This is that file, exactly as
 * `tests/determinism/phase9-particles.test.ts` is the one place `ParticleSystem`
 * can be checked against `@fourjs/motion`'s `SimulationSystem`.
 *
 * The claim being pinned has four parts:
 *
 * 1. **Assignability.** Every built-in field factory in `@fourjs/particles`
 *    produces a value assignable to `@fourjs/physics`' `ForceField`, with no
 *    adapter, no cast and no import in either direction. The assignment happens
 *    in ordinary source, so `tsc` (via `tests/tsconfig.json` and `bun run
 *    docs`) is the real check and the runtime assertions only confirm the
 *    values arrive.
 * 2. **The units mean what §41 says.** A particle field authored as an
 *    acceleration accelerates a 1 kg and a 7 kg body equally when registered as
 *    `"acceleration"`, and in a 7:1 ratio when registered as `"force"` — which
 *    is the whole reason the units are a required argument rather than a
 *    documented convention.
 * 3. **§27's volume inclusion needs nothing new**: `volumeField` wraps a
 *    physics-side field as happily as a particle-side one, because inclusion is
 *    a property of a field rather than of the system that samples it.
 * 4. **A registered-but-empty generator changes nothing** — the §33 half of
 *    "this packet moves no existing golden", stated as an equality of two real
 *    solver checksums rather than as an argument.
 *
 * The worlds run on the real Rapier 2D adapter rather than a double: the point
 * of the packet is that a §27 field moves a *solver's* body, and a fake
 * integrator could not tell an applied force from a wished-for one. World
 * gravity is switched off in every world here so that the only thing moving a
 * body is the field under test.
 */

import { Vector3 } from "@fourjs/math";
import { PRIORITY_FORCES, SystemRegistry, createTimeState } from "@fourjs/motion";
import {
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
} from "@fourjs/particles";
import {
  Collider,
  ForceFieldSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type ForceField,
} from "@fourjs/physics";
import { Rapier2dAdapter } from "@fourjs/physics-rapier";
import { Group } from "@fourjs/scene";
import { afterEach, describe, expect, it } from "vitest";

/** One fixed step in seconds (§7a, §10; Appendix A's 1/60). */
const DT = 1 / 60;

/** Worlds opened by the case in flight, disposed after it, newest first (§83). */
const openWorlds: PhysicsWorld[] = [];

afterEach(() => {
  for (let i = openWorlds.length - 1; i >= 0; i -= 1) {
    openWorlds[i].dispose();
  }
  openWorlds.length = 0;
});

/** A ready `"2d"` world on the real Rapier adapter, with world gravity off. */
async function gravitylessWorld(): Promise<PhysicsWorld> {
  const world = new PhysicsWorld({
    dimension: "2d",
    gravity: new Vector3(0, 0, 0),
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();
  openWorlds.push(world);
  return world;
}

/** A dynamic body of `mass` kg at `x`, with a small circle collider. */
function ball(
  world: PhysicsWorld,
  mass: number,
  x: number,
): { node: Group; body: RigidBody } {
  const node = new Group();
  node.transformAuthority = "physics";
  node.transform.position.set(x, 0, 0);
  const body = new RigidBody({ type: "dynamic", mass });
  node.addComponent(body);
  node.addComponent(new Collider({ shape: { type: "circle", radius: 0.25 } }));
  world.addBody(node);
  return { node, body };
}

/** Runs `steps` clean fixed steps through a registry holding `systems`. */
function run(steps: number, ...systems: SystemRegistry[]): void {
  const time = createTimeState({ fixedDeltaTime: DT });
  for (let step = 0; step < steps; step += 1) {
    time.simulationStep = step + 1;
    time.simulationTime = (step + 1) * DT;
    for (const registry of systems) {
      registry.runFixedStep(time);
    }
  }
}

/** A registry running `forces` at §39 step 5 and `world` at step 6. */
function pipeline(
  world: PhysicsWorld,
  forces: ForceFieldSystem,
): SystemRegistry {
  const registry = new SystemRegistry();
  registry.register(forces);
  registry.register(new PhysicsSystem({ worlds: [world] }));
  return registry;
}

describe("§27 fields from @fourjs/particles satisfy @fourjs/physics' ForceField", () => {
  it("accepts every built-in field factory with no adapter and no cast", () => {
    // The assignment *is* the assertion: each of these is a
    // `ParticleForceField` widened to a `ForceField` in ordinary source, so a
    // divergence between the two transcriptions is a compile error.
    const fields: ForceField[] = [
      uniformGravityField(),
      uniformGravityField(new Vector3(0, -3, 0)),
      dragField(0.4),
      windField(new Vector3(4, 0, 0), 0.5),
      radialField(new Vector3(0, 0, 0), -12),
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 0, 1), 3),
      turbulenceField(1337, { frequency: 0.5, amplitude: 2 }),
      volumeField(dragField(0.2), {
        shape: "sphere",
        center: new Vector3(0, 0, 0),
        radius: 5,
      }),
    ];

    expect(fields).toHaveLength(8);
    for (const field of fields) {
      const out = field.sample(
        new Vector3(1, 2, 0),
        new Vector3(0.5, 0, 0),
        0.25,
        new Vector3(),
      );
      expect(Number.isFinite(out.x)).toBe(true);
      expect(Number.isFinite(out.y)).toBe(true);
      expect(Number.isFinite(out.z)).toBe(true);
    }
  });

  it("wraps a physics-side field in the particle volume wrapper (§27)", () => {
    // The other direction of the same structural claim: `volumeField` takes a
    // `ParticleForceField`, and a field written against `@fourjs/physics`' own
    // interface is one — so §27's "volume-based inclusion and filtering" needed
    // nothing added to `@fourjs/physics`.
    const push: ForceField = {
      sample(_position, _velocity, _time, out) {
        return (out ?? new Vector3()).set(10, 0, 0);
      },
    };
    const bounded = volumeField(push, {
      shape: "sphere",
      center: new Vector3(0, 0, 0),
      radius: 1,
    });

    const inside = bounded.sample(
      new Vector3(0, 0, 0),
      new Vector3(),
      0,
      new Vector3(),
    );
    const outside = bounded.sample(
      new Vector3(50, 0, 0),
      new Vector3(),
      0,
      new Vector3(),
    );
    expect(inside.x).toBe(10);
    expect(outside.x).toBe(0);
  });
});

describe("§26/§27 — a field moves a real solver's rigid bodies", () => {
  it("occupies §39's force-generation slot, ahead of the solve", () => {
    expect(new ForceFieldSystem().priority).toBe(PRIORITY_FORCES);
    expect(PRIORITY_FORCES).toBeLessThan(new PhysicsSystem().priority);
  });

  it("accelerates every mass equally under an acceleration-unit field", async () => {
    const world = await gravitylessWorld();
    const light = ball(world, 1, -2);
    const heavy = ball(world, 7, 2);

    const forces = new ForceFieldSystem({ worlds: [world] });
    // §27's uniform gravity, authored by `@fourjs/particles` in m/s².
    forces.addField(
      uniformGravityField(new Vector3(0, -9.81, 0)),
      "acceleration",
    );
    run(30, pipeline(world, forces));

    // Half a second of free fall from rest under 9.81 m/s² is about −1.23 m;
    // Rapier substeps, so the bound is loose and the *equality* is the point.
    expect(light.node.transform.position.y).toBeLessThan(-1);
    expect(light.node.transform.position.y).toBeCloseTo(
      heavy.node.transform.position.y,
      9,
    );
  });

  it("accelerates a heavy body seven times less under a force-unit field", async () => {
    const world = await gravitylessWorld();
    const light = ball(world, 1, -2);
    const heavy = ball(world, 7, 2);

    const forces = new ForceFieldSystem({ worlds: [world] });
    // The same vector, registered as newtons: F = m·a now means the 7 kg body
    // accelerates at a seventh of the rate. This is exactly the silent unit
    // error a defaulted `units` would have made easy to write and hard to see.
    forces.addField(uniformGravityField(new Vector3(0, -9.81, 0)), "force");
    run(30, pipeline(world, forces));

    const lightY = light.node.transform.position.y;
    const heavyY = heavy.node.transform.position.y;
    expect(lightY).toBeLessThan(heavyY);
    expect(lightY / heavyY).toBeCloseTo(7, 3);
  });

  it("damps a moving body with a drag field authored for particles", async () => {
    const world = await gravitylessWorld();
    const { body } = ball(world, 2, 0);
    // §23: the solver owns velocity, so the launch goes through §26 — 12 N·s on
    // 2 kg is 6 m/s.
    body.applyImpulse(new Vector3(12, 0, 0));

    const forces = new ForceFieldSystem({ worlds: [world] });
    forces.addField(dragField(2), "acceleration");
    const registry = pipeline(world, forces);

    run(1, registry);
    const afterOne = body.linearVelocity.x;
    run(60, registry);

    // a = −2·v, so one second later the speed is down by more than half and the
    // body has not been driven backwards.
    expect(afterOne).toBeGreaterThan(5);
    expect(body.linearVelocity.x).toBeGreaterThanOrEqual(0);
    expect(body.linearVelocity.x).toBeLessThan(afterOne * 0.5);
  });

  it("pushes only what a volume field includes (§27)", async () => {
    const world = await gravitylessWorld();
    const inside = ball(world, 1, 0);
    const outside = ball(world, 1, 20);

    const forces = new ForceFieldSystem({ worlds: [world] });
    forces.addField(
      volumeField(uniformGravityField(new Vector3(0, -9.81, 0)), {
        shape: "sphere",
        center: new Vector3(0, 0, 0),
        radius: 5,
      }),
      "acceleration",
    );
    run(30, pipeline(world, forces));

    expect(inside.node.transform.position.y).toBeLessThan(-1);
    expect(outside.node.transform.position.y).toBe(0);
  });

  it("leaves a world with no registered field bit-identical (§33)", async () => {
    const withSystem = await gravitylessWorld();
    const without = await gravitylessWorld();
    for (const world of [withSystem, without]) {
      ball(world, 1, 0).body.applyImpulse(new Vector3(1, 2, 0));
    }

    const withRegistry = pipeline(
      withSystem,
      new ForceFieldSystem({ worlds: [withSystem] }),
    );
    const withoutRegistry = new SystemRegistry();
    withoutRegistry.register(new PhysicsSystem({ worlds: [without] }));
    run(30, withRegistry, withoutRegistry);

    // A registered-but-empty force generator adds nothing to the step: the two
    // §33 checksums agree exactly.
    expect(withSystem.checksum()).toBe(without.checksum());
  });
});
