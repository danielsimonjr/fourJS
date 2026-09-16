import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { SeededRandom } from "../src/random.js";
import {
  SteeringAgent,
  WanderState,
  alignment,
  arrive,
  cohesion,
  evade,
  flee,
  pursue,
  seek,
  separation,
  truncate,
  wander,
  wanderSpherical,
  type SteeringContext,
  type SteeringNeighbor,
} from "../src/steering.js";

/** Fixed simulation step used by every simulated test, in seconds (§7a). */
const DT = 1 / 60;

/** A plain mutable {@link SteeringContext}, so tests never depend on `SteeringAgent`. */
function makeContext(options: {
  position?: [number, number, number];
  velocity?: [number, number, number];
  maxSpeed?: number;
  maxAcceleration?: number;
}): {
  position: Vector3;
  velocity: Vector3;
  maxSpeed: number;
  maxAcceleration: number;
} {
  const [px, py, pz] = options.position ?? [0, 0, 0];
  const [vx, vy, vz] = options.velocity ?? [0, 0, 0];
  return {
    position: new Vector3(px, py, pz),
    velocity: new Vector3(vx, vy, vz),
    maxSpeed: options.maxSpeed ?? 10,
    maxAcceleration: options.maxAcceleration ?? 20,
  };
}

/** A neighbour record for the flocking behaviours. */
function makeNeighbor(
  position: [number, number, number],
  velocity: [number, number, number] = [0, 0, 0],
): SteeringNeighbor {
  return {
    position: new Vector3(...position),
    velocity: new Vector3(...velocity),
  };
}

/** Asserts a vector equals `(x, y, z)` to `digits` decimal places. */
function expectVector(
  actual: Vector3,
  x: number,
  y: number,
  z: number,
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
  expect(actual.z).toBeCloseTo(z, digits);
}

// ---------------------------------------------------------------------------
// seek
// ---------------------------------------------------------------------------

describe("seek (§12)", () => {
  it("accelerates at exactly maxAcceleration toward the target from rest", () => {
    // From rest the velocity error is the desired speed, so the magnitude is
    // min(maxSpeed, maxAcceleration); this scenario is budget-limited.
    const context = makeContext({ maxSpeed: 100, maxAcceleration: 20 });
    const out = new Vector3();
    seek(context, new Vector3(3, 4, 0), out);
    expectVector(out, 12, 16, 0);
    expect(out.length()).toBeCloseTo(20, 12);
  });

  it("is limited by maxSpeed when that is the smaller of the two", () => {
    const context = makeContext({ maxSpeed: 5, maxAcceleration: 1000 });
    const out = new Vector3();
    seek(context, new Vector3(0, 0, 7), out);
    expectVector(out, 0, 0, 5);
  });

  it("returns desired − velocity untruncated when the error fits the budget", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [1, 2, 3],
      maxSpeed: 6,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    seek(context, new Vector3(0, 0, 12), out);
    // desired = (0, 0, 6); steering = (0, 0, 6) − (1, 2, 3).
    expectVector(out, -1, -2, 3);
  });

  it("brakes instead of producing NaN when standing on the target", () => {
    const context = makeContext({
      position: [5, -2, 1],
      velocity: [3, 0, -4],
      maxSpeed: 10,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    seek(context, new Vector3(5, -2, 1), out);
    expectVector(out, -3, 0, 4);
  });

  it("returns exactly zero when stopped on the target", () => {
    const context = makeContext({ position: [1, 1, 0] });
    const out = new Vector3(9, 9, 9);
    seek(context, new Vector3(1, 1, 0), out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("keeps a 2D scenario on the z = 0 plane (§21)", () => {
    const context = makeContext({ position: [2, 3, 0], velocity: [-1, 4, 0] });
    const out = new Vector3();
    seek(context, new Vector3(-7, 11, 0), out);
    expect(out.z).toBe(0);
  });

  it("respects a zero acceleration budget", () => {
    const context = makeContext({ maxAcceleration: 0 });
    const out = new Vector3(1, 1, 1);
    seek(context, new Vector3(10, 0, 0), out);
    expectVector(out, 0, 0, 0);
  });
});

// ---------------------------------------------------------------------------
// flee
// ---------------------------------------------------------------------------

describe("flee (§12)", () => {
  it("is the exact componentwise negation of seek from rest", () => {
    const context = makeContext({ position: [1, -2, 3], maxAcceleration: 7 });
    const target = new Vector3(-4, 6, -9);
    const sought = new Vector3();
    const fled = new Vector3();
    seek(context, target, sought);
    flee(context, target, fled);
    expect(fled.x).toBe(-sought.x);
    expect(fled.y).toBe(-sought.y);
    expect(fled.z).toBe(-sought.z);
  });

  it("reverses hard when the agent is charging at the threat", () => {
    // At full speed straight at the threat, seek is satisfied (≈ 0) but flee
    // must brake and reverse — which is why flee is not implemented as −seek.
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [10, 0, 0],
      maxSpeed: 10,
      maxAcceleration: 20,
    });
    const threat = new Vector3(50, 0, 0);
    const sought = new Vector3();
    const fled = new Vector3();
    seek(context, threat, sought);
    flee(context, threat, fled);
    expectVector(sought, 0, 0, 0);
    expectVector(fled, -20, 0, 0);
  });

  it("brakes instead of producing NaN when standing on the threat", () => {
    const context = makeContext({
      position: [2, 2, 2],
      velocity: [0, 5, 0],
      maxAcceleration: 100,
    });
    const out = new Vector3();
    flee(context, new Vector3(2, 2, 2), out);
    expectVector(out, 0, -5, 0);
  });
});

// ---------------------------------------------------------------------------
// arrive
// ---------------------------------------------------------------------------

describe("arrive (§12)", () => {
  it("is bit-identical to seek outside the slow radius", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [1, -1, 2],
      maxSpeed: 8,
      maxAcceleration: 30,
    });
    const target = new Vector3(0, 20, 0);
    const sought = new Vector3();
    const arrived = new Vector3();
    seek(context, target, sought);
    arrive(context, target, 5, arrived);
    expect(arrived.x).toBe(sought.x);
    expect(arrived.y).toBe(sought.y);
    expect(arrived.z).toBe(sought.z);
  });

  it("ramps the desired speed linearly inside the slow radius", () => {
    const context = makeContext({
      maxSpeed: 10,
      maxAcceleration: 100,
      position: [0, 0, 0],
    });
    // Desired speed at distance d inside slowRadius = maxSpeed · d / slowRadius.
    for (const distance of [4, 3, 2, 1, 0.5]) {
      const out = new Vector3();
      arrive(context, new Vector3(0, distance, 0), 4, out);
      expectVector(out, 0, (10 * distance) / 4, 0);
    }
  });

  it("is exactly zero at the target, with no jitter", () => {
    const context = makeContext({ position: [3, 3, 3] });
    const out = new Vector3(1, 2, 3);
    arrive(context, new Vector3(3, 3, 3), 4, out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("degenerates to seek for a non-positive slow radius", () => {
    const context = makeContext({ position: [0, 0, 0], velocity: [0, 1, 0] });
    const target = new Vector3(0, 0.25, 0);
    const sought = new Vector3();
    const zeroRadius = new Vector3();
    const negativeRadius = new Vector3();
    seek(context, target, sought);
    arrive(context, target, 0, zeroRadius);
    arrive(context, target, -3, negativeRadius);
    expect(zeroRadius.y).toBe(sought.y);
    expect(negativeRadius.y).toBe(sought.y);
  });

  it("decelerates onto the target and stops there", () => {
    const agent = new SteeringAgent({
      position: new Vector3(-40, 0, 0),
      maxSpeed: 10,
      maxAcceleration: 40,
    });
    const target = new Vector3(0, 0, 0);
    const acceleration = new Vector3();
    let maximumSpeed = 0;
    // The approach inside the slow radius is a lightly damped second-order
    // system (`v̇ = −(maxSpeed/slowRadius)·d − v`, ζ ≈ 0.32), so it rings down
    // as e^(−t/2) rather than snapping: 30 s is ~15 time constants.
    for (let step = 0; step < 60 * 30; step += 1) {
      arrive(agent, target, 4, acceleration);
      agent.integrate(DT, acceleration);
      maximumSpeed = Math.max(maximumSpeed, agent.velocity.length());
    }
    // It reaches cruise speed on the way in, then ramps down inside the radius.
    expect(maximumSpeed).toBeGreaterThan(9.9);
    expect(agent.position.length()).toBeLessThan(1e-3);
    expect(agent.velocity.length()).toBeLessThan(1e-3);
  });
});

// ---------------------------------------------------------------------------
// pursue and evade
// ---------------------------------------------------------------------------

/**
 * Closed-form interception time, recomputed here from the quadratic
 * `|r + v·t| = s·t` with a plain (non-stabilized) solve — an independent oracle
 * for the module's stabilized root selection.
 */
function referenceInterceptTime(
  context: SteeringContext,
  targetPosition: Vector3,
  targetVelocity: Vector3,
): number {
  const rx = targetPosition.x - context.position.x;
  const ry = targetPosition.y - context.position.y;
  const rz = targetPosition.z - context.position.z;
  const s = context.maxSpeed;
  const a =
    targetVelocity.x * targetVelocity.x +
    targetVelocity.y * targetVelocity.y +
    targetVelocity.z * targetVelocity.z -
    s * s;
  const b =
    2 * (rx * targetVelocity.x + ry * targetVelocity.y + rz * targetVelocity.z);
  const c = rx * rx + ry * ry + rz * rz;
  const candidates: number[] = [];
  if (a === 0) {
    if (b !== 0) {
      candidates.push(-c / b);
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      candidates.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  const feasible = candidates.filter((t) => t >= 0).sort((x, y) => x - y);
  return feasible.length > 0 ? feasible[0] : Math.sqrt(c) / s;
}

/** Asserts that `pursue` seeks the point the closed form predicts. */
function expectPursuesPredictedPoint(
  context: SteeringContext,
  targetPosition: Vector3,
  targetVelocity: Vector3,
): number {
  const t = referenceInterceptTime(context, targetPosition, targetVelocity);
  const predicted = new Vector3(
    targetPosition.x + targetVelocity.x * t,
    targetPosition.y + targetVelocity.y * t,
    targetPosition.z + targetVelocity.z * t,
  );
  const pursued = new Vector3();
  const sought = new Vector3();
  pursue(context, targetPosition, targetVelocity, pursued);
  seek(context, predicted, sought);
  expectVector(pursued, sought.x, sought.y, sought.z, 9);
  return t;
}

describe("pursue (§12) — constant-velocity lead", () => {
  it("seeks the point the interception quadratic predicts", () => {
    const context = makeContext({ maxSpeed: 10, maxAcceleration: 100 });
    const t = expectPursuesPredictedPoint(
      context,
      new Vector3(20, 0, 0),
      new Vector3(0, 3, 0),
    );
    // |r + v·t| must equal maxSpeed · t at the solution.
    const reach = Math.hypot(20, 3 * t);
    expect(reach).toBeCloseTo(10 * t, 9);
    expect(t).toBeCloseTo(2.0966, 3);
  });

  it("degenerates to seek for a stationary target", () => {
    const context = makeContext({ position: [1, 2, 3], maxSpeed: 5 });
    const target = new Vector3(9, 2, 3);
    const pursued = new Vector3();
    const sought = new Vector3();
    pursue(context, target, new Vector3(), pursued);
    seek(context, target, sought);
    expectVector(pursued, sought.x, sought.y, sought.z);
  });

  it("solves the linear case when the target moves at exactly maxSpeed", () => {
    // a = |v|² − s² = 0, b < 0: the single root is −c/b.
    const context = makeContext({ maxSpeed: 4, maxAcceleration: 100 });
    const targetPosition = new Vector3(10, 0, 0);
    const targetVelocity = new Vector3(-4, 0, 0);
    const t = expectPursuesPredictedPoint(
      context,
      targetPosition,
      targetVelocity,
    );
    expect(t).toBeCloseTo(1.25, 12);
  });

  it("falls back to the heuristic horizon for an uncatchable target", () => {
    // Faster than the pursuer and opening the range: no non-negative root.
    const context = makeContext({ maxSpeed: 3, maxAcceleration: 100 });
    const targetPosition = new Vector3(10, 0, 0);
    const targetVelocity = new Vector3(9, 0, 0);
    const t = expectPursuesPredictedPoint(
      context,
      targetPosition,
      targetVelocity,
    );
    expect(t).toBeCloseTo(10 / 3, 12);
  });

  it("predicts t = 0 when the agent already stands on the target", () => {
    const context = makeContext({
      position: [4, 4, 0],
      velocity: [2, 0, 0],
      maxSpeed: 6,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    pursue(context, new Vector3(4, 4, 0), new Vector3(1, 1, 0), out);
    // Predicted point is the target's current position, so the agent brakes.
    expectVector(out, -2, 0, 0);
  });

  /**
   * Chases a constant-velocity target with semi-implicit Euler at {@link DT} and
   * reports the first time the range falls inside `tolerance`, plus the closest
   * approach seen.
   */
  function chase(
    agent: SteeringAgent,
    targetPosition: Vector3,
    targetVelocity: Vector3,
    tolerance: number,
    seconds: number,
  ): { interceptTime: number; closest: number } {
    const acceleration = new Vector3();
    let closest = Number.POSITIVE_INFINITY;
    let interceptTime = Number.POSITIVE_INFINITY;
    for (let step = 1; step <= Math.round(seconds / DT); step += 1) {
      pursue(agent, targetPosition, targetVelocity, acceleration);
      agent.integrate(DT, acceleration);
      targetPosition.set(
        targetPosition.x + targetVelocity.x * DT,
        targetPosition.y + targetVelocity.y * DT,
        targetPosition.z + targetVelocity.z * DT,
      );
      const distance = Math.hypot(
        targetPosition.x - agent.position.x,
        targetPosition.y - agent.position.y,
        targetPosition.z - agent.position.z,
      );
      closest = Math.min(closest, distance);
      if (distance < tolerance && step * DT < interceptTime) {
        interceptTime = step * DT;
      }
    }
    return { interceptTime, closest };
  }

  it("intercepts a cruising pursuer at the closed-form time, within a step", () => {
    // Launched at maxSpeed straight at the predicted point, so the only error
    // left is the integrator's: the closed form assumes the pursuer is already
    // at maxSpeed, which it is here.
    const targetPosition = new Vector3(20, 0, 0);
    const targetVelocity = new Vector3(0, 3, 0);
    const agent = new SteeringAgent({ maxSpeed: 10, maxAcceleration: 200 });
    const predictedTime = referenceInterceptTime(
      agent,
      targetPosition,
      targetVelocity,
    );
    const leadX = 20;
    const leadY = 3 * predictedTime;
    const leadDistance = Math.hypot(leadX, leadY);
    agent.velocity.set(
      (leadX / leadDistance) * agent.maxSpeed,
      (leadY / leadDistance) * agent.maxSpeed,
      0,
    );

    // Tolerance from the step: the pursuer covers maxSpeed · dt per step, so
    // the range is only resolvable to that.
    const tolerance = agent.maxSpeed * DT;
    const { interceptTime, closest } = chase(
      agent,
      targetPosition,
      targetVelocity,
      tolerance,
      4,
    );
    expect(closest).toBeLessThan(tolerance);
    expect(Math.abs(interceptTime - predictedTime)).toBeLessThan(2 * DT);
  });

  it("intercepts from rest, late by the implicit one-second gain", () => {
    const targetPosition = new Vector3(20, 0, 0);
    const targetVelocity = new Vector3(0, 3, 0);
    const agent = new SteeringAgent({ maxSpeed: 10, maxAcceleration: 200 });
    const predictedTime = referenceInterceptTime(
      agent,
      targetPosition,
      targetVelocity,
    );
    const tolerance = 2 * agent.maxSpeed * DT;
    const { interceptTime, closest } = chase(
      agent,
      targetPosition,
      targetVelocity,
      tolerance,
      6,
    );
    expect(closest).toBeLessThan(tolerance);
    // Never early, and late by about one time constant: `steering = desired −
    // velocity` approaches maxSpeed exponentially with a 1 s constant, which
    // costs `1 − e⁻ᵗ ≈ 0.9` seconds of travel (see the module header).
    expect(interceptTime).toBeGreaterThan(predictedTime);
    expect(interceptTime - predictedTime).toBeLessThan(1.2);
  });
});

describe("evade (§12)", () => {
  it("is the exact componentwise negation of pursue from rest", () => {
    const context = makeContext({
      position: [1, 1, 1],
      maxSpeed: 7,
      maxAcceleration: 13,
    });
    const threatPosition = new Vector3(-5, 8, 2);
    const threatVelocity = new Vector3(2, -1, 4);
    const pursued = new Vector3();
    const evaded = new Vector3();
    pursue(context, threatPosition, threatVelocity, pursued);
    evade(context, threatPosition, threatVelocity, evaded);
    expect(evaded.x).toBe(-pursued.x);
    expect(evaded.y).toBe(-pursued.y);
    expect(evaded.z).toBe(-pursued.z);
  });

  it("brakes when standing on the predicted threat point", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [1, 2, 0],
      maxSpeed: 5,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    evade(context, new Vector3(0, 0, 0), new Vector3(0, 0, 0), out);
    expectVector(out, -1, -2, 0);
  });

  it("opens the range on a slower pursuer", () => {
    const agent = new SteeringAgent({
      position: new Vector3(0, 0, 0),
      maxSpeed: 10,
      maxAcceleration: 60,
    });
    // A pursuer closing from behind at 4 units/s; the evader runs at 10.
    const threatPosition = new Vector3(-10, 0, 0);
    const threatVelocity = new Vector3(4, 0, 0);
    const acceleration = new Vector3();
    const initial = 10;
    for (let step = 0; step < 60 * 6; step += 1) {
      evade(agent, threatPosition, threatVelocity, acceleration);
      agent.integrate(DT, acceleration);
      threatPosition.set(
        threatPosition.x + threatVelocity.x * DT,
        threatPosition.y + threatVelocity.y * DT,
        threatPosition.z + threatVelocity.z * DT,
      );
    }
    const final = Math.hypot(
      threatPosition.x - agent.position.x,
      threatPosition.y - agent.position.y,
      threatPosition.z - agent.position.z,
    );
    // Six units per second of relative escape over six seconds, less the ~1 s
    // gain lag: comfortably more than double the starting gap.
    expect(final).toBeGreaterThan(initial * 2);
  });
});

// ---------------------------------------------------------------------------
// wander
// ---------------------------------------------------------------------------

/** Runs `steps` of wander on a fresh agent and returns its path. */
function runWander(seed: number, steps: number, angle = 0): number[] {
  const agent = new SteeringAgent({
    velocity: new Vector3(3, 0, 0),
    maxSpeed: 6,
    maxAcceleration: 12,
  });
  const state = new WanderState({
    radius: 2,
    distance: 3,
    jitter: 8,
    angle,
  });
  const random = new SeededRandom(seed);
  const acceleration = new Vector3();
  const path: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    wander(agent, state, random, DT, acceleration);
    agent.integrate(DT, acceleration);
    path.push(agent.position.x, agent.position.y, agent.position.z);
  }
  return path;
}

describe("wander (§12, §111) — seeded jitter on a circle", () => {
  it("traces bit-identical paths from identical streams", () => {
    const first = runWander(2468, 300);
    const second = runWander(2468, 300);
    expect(first.length).toBe(900);
    for (let i = 0; i < first.length; i += 1) {
      expect(Object.is(first[i], second[i]), `sample ${i}`).toBe(true);
    }
  });

  it("diverges for different seeds", () => {
    const first = runWander(2468, 300);
    const other = runWander(2469, 300);
    const difference = Math.hypot(
      first[897] - other[897],
      first[898] - other[898],
      first[899] - other[899],
    );
    expect(difference).toBeGreaterThan(1e-3);
  });

  it("draws exactly one number per call and walks the angle by it", () => {
    const agent = new SteeringAgent({ maxSpeed: 4, maxAcceleration: 8 });
    const state = new WanderState({ radius: 1, distance: 2, jitter: 5 });
    const random = new SeededRandom(31);
    const oracle = new SeededRandom(31);
    const out = new Vector3();
    let expectedAngle = 0;
    for (let step = 0; step < 200; step += 1) {
      wander(agent, state, random, DT, out);
      expectedAngle += oracle.nextRange(-5 * DT, 5 * DT);
      expectedAngle -=
        2 * Math.PI * Math.floor((expectedAngle + Math.PI) / (2 * Math.PI));
      expect(state.angle).toBeCloseTo(expectedAngle, 12);
    }
  });

  it("keeps the angle wrapped to [−π, π) even for absurd jitter", () => {
    const agent = new SteeringAgent({ maxSpeed: 4, maxAcceleration: 8 });
    const state = new WanderState({ radius: 1, distance: 2, jitter: 1000 });
    const random = new SeededRandom(9);
    const out = new Vector3();
    for (let step = 0; step < 500; step += 1) {
      wander(agent, state, random, 1, out);
      expect(state.angle).toBeGreaterThanOrEqual(-Math.PI);
      expect(state.angle).toBeLessThan(Math.PI);
    }
  });

  it("centres the circle on the agent when it has no heading", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 100,
    });
    const state = new WanderState({
      radius: 2,
      distance: 10,
      jitter: 0,
      angle: 0,
    });
    const random = new SeededRandom(1);
    const out = new Vector3();
    wander(context, state, random, DT, out);
    // Zero jitter keeps the angle at 0, so the target is (radius, 0, 0) — the
    // heading offset is absent because there is no heading.
    expectVector(out, 5, 0, 0);
  });

  it("offsets the circle along the heading when the agent is moving", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [0, 4, 0],
      maxSpeed: 4,
      maxAcceleration: 100,
    });
    const state = new WanderState({
      radius: 3,
      distance: 4,
      jitter: 0,
      angle: 0,
    });
    const out = new Vector3();
    wander(context, state, new SeededRandom(1), DT, out);
    // Centre (0, 4, 0) + circle offset (3, 0, 0) → target (3, 4, 0), 5 away;
    // desired = (3, 4, 0)/5 · 4 = (2.4, 3.2, 0); steering = desired − (0, 4, 0).
    expectVector(out, 2.4, -0.8, 0);
  });

  it("never exceeds the acceleration budget", () => {
    const agent = new SteeringAgent({
      velocity: new Vector3(2, 0, 0),
      maxSpeed: 6,
      maxAcceleration: 9,
    });
    const state = new WanderState({ radius: 2, distance: 3, jitter: 12 });
    const random = new SeededRandom(555);
    const out = new Vector3();
    let maximum = 0;
    for (let step = 0; step < 1000; step += 1) {
      wander(agent, state, random, DT, out);
      agent.integrate(DT, out);
      maximum = Math.max(maximum, out.length());
    }
    expect(maximum).toBeLessThanOrEqual(9 + 1e-12);
  });

  it("keeps a 2D agent on the z = 0 plane (§21)", () => {
    const path = runWander(4321, 200);
    for (let i = 2; i < path.length; i += 3) {
      expect(path[i]).toBe(0);
    }
  });
});

describe("WanderState", () => {
  it("validates its parameters", () => {
    expect(
      () => new WanderState({ radius: 0, distance: 1, jitter: 1 }),
    ).toThrow(RangeError);
    expect(
      () => new WanderState({ radius: -1, distance: 1, jitter: 1 }),
    ).toThrow(/greater than zero/);
    expect(
      () => new WanderState({ radius: 1, distance: -1, jitter: 1 }),
    ).toThrow(/non-negative/);
    expect(
      () => new WanderState({ radius: 1, distance: 1, jitter: -1 }),
    ).toThrow(/non-negative/);
    expect(
      () => new WanderState({ radius: Number.NaN, distance: 1, jitter: 1 }),
    ).toThrow(/finite/);
    expect(
      () =>
        new WanderState({
          radius: 1,
          distance: Number.POSITIVE_INFINITY,
          jitter: 1,
        }),
    ).toThrow(/finite/);
    expect(
      () => new WanderState({ radius: 1, distance: 1, jitter: Number.NaN }),
    ).toThrow(/finite/);
    expect(
      () =>
        new WanderState({
          radius: 1,
          distance: 1,
          jitter: 1,
          angle: Number.NaN,
        }),
    ).toThrow(/radians/);
  });

  it("defaults the angle to zero and resets it", () => {
    const state = new WanderState({ radius: 1, distance: 2, jitter: 3 });
    expect(state.angle).toBe(0);
    state.angle = 1.25;
    expect(state.reset()).toBe(state);
    expect(state.angle).toBe(0);
    state.reset(Math.PI / 4);
    expect(state.angle).toBe(Math.PI / 4);
  });

  it("defaults elevation to zero and resets it without breaking angle", () => {
    const state = new WanderState({
      radius: 1,
      distance: 2,
      jitter: 3,
      elevation: 0.4,
    });
    expect(state.elevation).toBe(0.4);
    state.reset(1.1, 0.2);
    expect(state.angle).toBe(1.1);
    expect(state.elevation).toBe(0.2);
    state.reset();
    expect(state.angle).toBe(0);
    expect(state.elevation).toBe(0);
  });

  it("rejects a non-finite elevation", () => {
    expect(
      () =>
        new WanderState({
          radius: 1,
          distance: 1,
          jitter: 1,
          elevation: Number.NaN,
        }),
    ).toThrow(/elevation/);
  });
});

/** Runs `steps` of spherical wander and returns the path. */
function runWanderSpherical(seed: number, steps: number): number[] {
  const agent = new SteeringAgent({
    velocity: new Vector3(3, 0, 0),
    maxSpeed: 6,
    maxAcceleration: 12,
  });
  const state = new WanderState({
    radius: 2,
    distance: 3,
    jitter: 8,
  });
  const random = new SeededRandom(seed);
  const acceleration = new Vector3();
  const path: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    wanderSpherical(agent, state, random, DT, acceleration);
    agent.integrate(DT, acceleration);
    path.push(agent.position.x, agent.position.y, agent.position.z);
  }
  return path;
}

describe("wanderSpherical (WP-8.2) — heading-aligned sphere", () => {
  it("traces bit-identical 3D paths from identical streams", () => {
    const first = runWanderSpherical(2468, 300);
    const second = runWanderSpherical(2468, 300);
    expect(first.length).toBe(900);
    for (let i = 0; i < first.length; i += 1) {
      expect(Object.is(first[i], second[i]), `sample ${i}`).toBe(true);
    }
  });

  it("leaves the XY plane", () => {
    const path = runWanderSpherical(4321, 200);
    let maxAbsZ = 0;
    for (let i = 2; i < path.length; i += 3) {
      maxAbsZ = Math.max(maxAbsZ, Math.abs(path[i] ?? 0));
    }
    expect(maxAbsZ).toBeGreaterThan(0.05);
  });

  it("draws exactly two numbers per call (azimuth then elevation)", () => {
    const agent = new SteeringAgent({ maxSpeed: 4, maxAcceleration: 8 });
    const state = new WanderState({ radius: 1, distance: 2, jitter: 5 });
    const random = new SeededRandom(31);
    const oracle = new SeededRandom(31);
    const out = new Vector3();
    let expectedAngle = 0;
    let expectedElevation = 0;
    for (let step = 0; step < 200; step += 1) {
      wanderSpherical(agent, state, random, DT, out);
      expectedAngle += oracle.nextRange(-5 * DT, 5 * DT);
      expectedAngle -=
        2 * Math.PI * Math.floor((expectedAngle + Math.PI) / (2 * Math.PI));
      expectedElevation += oracle.nextRange(-5 * DT, 5 * DT);
      expectedElevation = Math.min(
        Math.PI / 2,
        Math.max(-Math.PI / 2, expectedElevation),
      );
      expect(state.angle).toBeCloseTo(expectedAngle, 12);
      expect(state.elevation).toBeCloseTo(expectedElevation, 12);
    }
  });

  it("clamps elevation to [−π/2, π/2] even for absurd jitter", () => {
    const agent = new SteeringAgent({ maxSpeed: 4, maxAcceleration: 8 });
    const state = new WanderState({ radius: 1, distance: 2, jitter: 1000 });
    const random = new SeededRandom(9);
    const out = new Vector3();
    for (let step = 0; step < 200; step += 1) {
      wanderSpherical(agent, state, random, 1, out);
      expect(state.elevation).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(state.elevation).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it("uses a +X / +Y fallback frame when the agent has no heading", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 100,
    });
    const state = new WanderState({
      radius: 2,
      distance: 10,
      jitter: 0,
      angle: 0,
      elevation: 0,
    });
    const out = new Vector3();
    wanderSpherical(context, state, new SeededRandom(1), DT, out);
    // Forward +X, up +Y, right +Z. az=0, el=0 → target = (10, 0, 0) + (2, 0, 0).
    expectVector(out, 5, 0, 0);
  });

  it("builds a Gram-Schmidt frame when velocity is along +Y", () => {
    const context = makeContext({
      position: [0, 0, 0],
      velocity: [0, 4, 0],
      maxSpeed: 4,
      maxAcceleration: 100,
    });
    const state = new WanderState({
      radius: 2,
      distance: 3,
      jitter: 0,
      angle: Math.PI / 2,
      elevation: 0,
    });
    const out = new Vector3();
    wanderSpherical(context, state, new SeededRandom(1), DT, out);
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
    // Heading +Y, fallback up +Z, right = +Y × +Z = +X. az=π/2 → +right.
    expect(Math.abs(out.z)).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------
// flocking
// ---------------------------------------------------------------------------

describe("separation (§12 flocking)", () => {
  it("pushes two coincident-ish agents apart", () => {
    const context = makeContext({
      position: [0, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 10,
    });
    const out = new Vector3();
    separation(context, [makeNeighbor([2, 0, 0])], out);
    // Desired velocity is maxSpeed away from the neighbour; from rest that is
    // the whole steering, under the 10 units/s² budget.
    expectVector(out, -5, 0, 0);

    const mirrored = makeContext({
      position: [2, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 10,
    });
    separation(mirrored, [makeNeighbor([0, 0, 0])], out);
    expectVector(out, 5, 0, 0);
  });

  it("weights near neighbours more than far ones", () => {
    const context = makeContext({
      position: [0, 0, 0],
      maxSpeed: 4,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    // Near neighbour at +1 contributes −1, far one at −4 contributes +0.25.
    separation(
      context,
      [makeNeighbor([1, 0, 0]), makeNeighbor([-4, 0, 0])],
      out,
    );
    expect(out.x).toBeCloseTo(-4, 12);
  });

  it("abstains with no neighbours, and never brakes", () => {
    const context = makeContext({ velocity: [3, 3, 0] });
    const out = new Vector3(1, 1, 1);
    separation(context, [], out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("abstains when contributions cancel exactly", () => {
    const context = makeContext({ position: [0, 0, 0] });
    const out = new Vector3(1, 1, 1);
    separation(
      context,
      [makeNeighbor([3, 0, 0]), makeNeighbor([-3, 0, 0])],
      out,
    );
    expectVector(out, 0, 0, 0);
  });

  it("skips a neighbour sitting exactly on the agent", () => {
    const context = makeContext({
      position: [0, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 10,
    });
    const out = new Vector3();
    separation(
      context,
      [makeNeighbor([0, 0, 0]), makeNeighbor([0, 1, 0])],
      out,
    );
    expectVector(out, 0, -5, 0);
  });
});

describe("cohesion (§12 flocking)", () => {
  it("pulls a straggler toward the centroid, exactly as seek would", () => {
    const context = makeContext({
      position: [-10, 0, 0],
      maxSpeed: 5,
      maxAcceleration: 12,
    });
    const neighbors = [
      makeNeighbor([0, 3, 0]),
      makeNeighbor([2, -3, 0]),
      makeNeighbor([4, 0, 0]),
    ];
    const cohered = new Vector3();
    const sought = new Vector3();
    cohesion(context, neighbors, cohered);
    seek(context, new Vector3(2, 0, 0), sought);
    expect(cohered.x).toBe(sought.x);
    expect(cohered.y).toBe(sought.y);
    expect(cohered.z).toBe(sought.z);
    expect(cohered.x).toBeGreaterThan(0);
    // maxSpeed 5 is the binding limit here, not the 12 units/s² budget.
    expect(cohered.length()).toBeCloseTo(5, 12);
  });

  it("abstains with no neighbours", () => {
    const context = makeContext({ velocity: [1, 1, 1] });
    const out = new Vector3(5, 5, 5);
    cohesion(context, [], out);
    expectVector(out, 0, 0, 0);
  });
});

describe("alignment (§12 flocking)", () => {
  it("steers toward the mean neighbour velocity", () => {
    const context = makeContext({
      velocity: [0, 0, 0],
      maxSpeed: 10,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    alignment(
      context,
      [
        makeNeighbor([0, 0, 0], [2, 0, 0]),
        makeNeighbor([0, 0, 0], [4, 2, 0]),
        makeNeighbor([0, 0, 0], [0, 1, 0]),
      ],
      out,
    );
    expectVector(out, 2, 1, 0);
  });

  it("clamps the mean to maxSpeed", () => {
    const context = makeContext({
      velocity: [0, 0, 0],
      maxSpeed: 3,
      maxAcceleration: 100,
    });
    const out = new Vector3();
    alignment(context, [makeNeighbor([0, 0, 0], [0, 20, 0])], out);
    expectVector(out, 0, 3, 0);
  });

  it("produces exactly zero once the velocity already matches", () => {
    const context = makeContext({
      velocity: [1, 2, 0],
      maxSpeed: 10,
      maxAcceleration: 100,
    });
    const out = new Vector3(9, 9, 9);
    alignment(context, [makeNeighbor([0, 0, 0], [1, 2, 0])], out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("converges onto the mean velocity when integrated", () => {
    const agent = new SteeringAgent({ maxSpeed: 10, maxAcceleration: 100 });
    const neighbors = [
      makeNeighbor([0, 0, 0], [3, 0, 0]),
      makeNeighbor([0, 0, 0], [1, 4, 0]),
    ];
    const out = new Vector3();
    for (let step = 0; step < 60 * 12; step += 1) {
      alignment(agent, neighbors, out);
      agent.integrate(DT, out);
    }
    expectVector(agent.velocity, 2, 2, 0, 4);
  });

  it("abstains with no neighbours", () => {
    const context = makeContext({ velocity: [1, 1, 1] });
    const out = new Vector3(5, 5, 5);
    alignment(context, [], out);
    expectVector(out, 0, 0, 0);
  });
});

describe("neighbour iteration (§33)", () => {
  const context = makeContext({
    position: [0, 0, 0],
    maxSpeed: 5,
    maxAcceleration: 20,
  });
  const positions: [number, number, number][] = [
    [1, 2, 0],
    [-3, 4, 0],
    [5, -1, 0],
  ];

  it("accepts any iterable and reads it once, in order", () => {
    const asArray = positions.map((p) => makeNeighbor(p));
    const asSet = new Set(asArray);
    function* asGenerator(): Generator<SteeringNeighbor> {
      for (const neighbor of asArray) {
        yield neighbor;
      }
    }
    const fromArray = new Vector3();
    const fromSet = new Vector3();
    const fromGenerator = new Vector3();
    cohesion(context, asArray, fromArray);
    cohesion(context, asSet, fromSet);
    cohesion(context, asGenerator(), fromGenerator);
    expect(fromSet.x).toBe(fromArray.x);
    expect(fromGenerator.x).toBe(fromArray.x);
    expect(fromSet.y).toBe(fromArray.y);
    expect(fromGenerator.y).toBe(fromArray.y);
  });

  it("makes iteration order part of the contract", () => {
    // Summation is not associative in floating point: the same neighbours in a
    // different order can give a different centroid. Insertion order is
    // therefore the reproducibility guarantee, not an implementation detail.
    const forward = [
      makeNeighbor([1, 0, 0]),
      makeNeighbor([1e16, 0, 0]),
      makeNeighbor([-1e16, 0, 0]),
    ];
    const reversed = [...forward].reverse();
    const a = new Vector3();
    const b = new Vector3();
    cohesion(context, forward, a);
    cohesion(context, reversed, b);
    expect(a.x).not.toBe(b.x);
  });

  it("never mutates a neighbour or the context", () => {
    const neighbors = positions.map((p) => makeNeighbor(p, [1, 1, 1]));
    const before = neighbors.map((n) => [
      n.position.x,
      n.position.y,
      n.position.z,
      n.velocity.x,
      n.velocity.y,
      n.velocity.z,
    ]);
    const out = new Vector3();
    separation(context, neighbors, out);
    cohesion(context, neighbors, out);
    alignment(context, neighbors, out);
    seek(context, new Vector3(1, 1, 1), out);
    expect(
      neighbors.map((n) => [
        n.position.x,
        n.position.y,
        n.position.z,
        n.velocity.x,
        n.velocity.y,
        n.velocity.z,
      ]),
    ).toEqual(before);
    expectVector(context.position, 0, 0, 0);
    expectVector(context.velocity, 0, 0, 0);
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("leaves a short vector bit-identical and unwritten", () => {
    const vector = new Vector3(1, 2, 2);
    let writes = 0;
    vector.onChanged = (): void => {
      writes += 1;
    };
    expect(truncate(vector, 3)).toBe(vector);
    expectVector(vector, 1, 2, 2);
    expect(writes).toBe(0);
  });

  it("scales a long vector to exactly the limit", () => {
    const vector = new Vector3(3, 4, 0);
    truncate(vector, 2.5);
    expect(vector.length()).toBeCloseTo(2.5, 12);
    expectVector(vector, 1.5, 2, 0);
  });

  it("zeroes for a non-positive limit", () => {
    expectVector(truncate(new Vector3(3, 4, 0), 0), 0, 0, 0);
    expectVector(truncate(new Vector3(3, 4, 0), -2), 0, 0, 0);
  });

  it("leaves the zero vector alone", () => {
    expectVector(truncate(new Vector3(), 5), 0, 0, 0);
  });
});

// ---------------------------------------------------------------------------
// SteeringAgent
// ---------------------------------------------------------------------------

describe("SteeringAgent", () => {
  it("defaults its limits and copies the vectors it is given", () => {
    const position = new Vector3(1, 2, 3);
    const velocity = new Vector3(4, 5, 6);
    const agent = new SteeringAgent({ position, velocity });
    expect(agent.maxSpeed).toBe(1);
    expect(agent.maxAcceleration).toBe(1);
    expect(agent.position).not.toBe(position);
    expect(agent.velocity).not.toBe(velocity);
    expectVector(agent.position, 1, 2, 3);
    expectVector(agent.velocity, 4, 5, 6);

    const bare = new SteeringAgent();
    expectVector(bare.position, 0, 0, 0);
    expectVector(bare.velocity, 0, 0, 0);
  });

  it("blends weighted contributions and truncates once at the end", () => {
    const agent = new SteeringAgent({ maxSpeed: 10, maxAcceleration: 5 });
    const out = new Vector3();
    expect(agent.beginSteering()).toBe(agent);
    agent.addSteering(new Vector3(3, 0, 0), 2);
    agent.addSteering(new Vector3(0, 4, 0));
    agent.endSteering(out);
    // Sum (6, 4, 0) has length √52 ≈ 7.21, truncated to 5.
    expect(out.length()).toBeCloseTo(5, 12);
    expect(out.y / out.x).toBeCloseTo(4 / 6, 12);

    // The sum survives; beginSteering is what clears it.
    const again = new Vector3();
    agent.endSteering(again);
    expectVector(again, out.x, out.y, out.z);
    agent.beginSteering().endSteering(again);
    expectVector(again, 0, 0, 0);
  });

  it("defaults the blend weight to one", () => {
    const agent = new SteeringAgent({ maxAcceleration: 100 });
    const out = new Vector3();
    agent
      .beginSteering()
      .addSteering(new Vector3(1, 2, 3))
      .addSteering(new Vector3(1, 0, 0))
      .endSteering(out);
    expectVector(out, 2, 2, 3);
  });

  it("integrates with semi-implicit Euler and clamps the speed", () => {
    const agent = new SteeringAgent({ maxSpeed: 100, maxAcceleration: 10 });
    expect(agent.integrate(0.5, new Vector3(4, 0, 0))).toBe(agent);
    // v = 0 + 4·0.5 = 2; x = 0 + 2·0.5 = 1 (the *new* velocity, §38).
    expectVector(agent.velocity, 2, 0, 0);
    expectVector(agent.position, 1, 0, 0);

    const clamped = new SteeringAgent({ maxSpeed: 3 });
    clamped.integrate(1, new Vector3(0, 30, 40));
    expect(clamped.velocity.length()).toBeCloseTo(3, 12);
    expectVector(clamped.velocity, 0, 1.8, 2.4);
    expectVector(clamped.position, 0, 1.8, 2.4);
  });

  it("is usable directly as a SteeringContext", () => {
    const agent = new SteeringAgent({ maxSpeed: 2, maxAcceleration: 4 });
    const context: SteeringContext = agent;
    const out = new Vector3();
    seek(context, new Vector3(0, 10, 0), out);
    expectVector(out, 0, 2, 0);
  });
});

// ---------------------------------------------------------------------------
// allocation, change hooks, and the flock soak test
// ---------------------------------------------------------------------------

describe("allocation and write discipline (§7b, plan D3/D7)", () => {
  const context = makeContext({
    position: [1, 2, 0],
    velocity: [0.5, 0, 0],
    maxSpeed: 6,
    maxAcceleration: 12,
  });
  const target = new Vector3(9, 4, 0);
  const targetVelocity = new Vector3(1, 1, 0);
  const neighbors = [
    makeNeighbor([3, 1, 0], [1, 0, 0]),
    makeNeighbor([-2, 5, 0], [0, 2, 0]),
  ];

  it("allocates nothing in any behaviour after warm-up", () => {
    const out = new Vector3();
    const state = new WanderState({ radius: 2, distance: 3, jitter: 4 });
    const random = new SeededRandom(17);
    const agent = new SteeringAgent();
    const behaviours: [string, () => void][] = [
      ["seek", () => void seek(context, target, out)],
      ["flee", () => void flee(context, target, out)],
      ["arrive", () => void arrive(context, target, 4, out)],
      ["pursue", () => void pursue(context, target, targetVelocity, out)],
      ["evade", () => void evade(context, target, targetVelocity, out)],
      ["wander", () => void wander(context, state, random, DT, out)],
      [
        "wanderSpherical",
        () => void wanderSpherical(context, state, random, DT, out),
      ],
      ["separation", () => void separation(context, neighbors, out)],
      ["cohesion", () => void cohesion(context, neighbors, out)],
      ["alignment", () => void alignment(context, neighbors, out)],
      ["truncate", () => void truncate(out, 3)],
      [
        "agent blend",
        () => {
          agent.beginSteering().addSteering(out, 0.5).endSteering(out);
        },
      ],
      ["agent integrate", () => void agent.integrate(DT, out)],
    ];
    for (const [name, run] of behaviours) {
      run();
      resetConstructionCount();
      for (let i = 0; i < 20; i += 1) {
        run();
      }
      expect(constructionCount(), name).toBe(0);
    }
  });

  it("writes `out` exactly once per behaviour, truncated or not", () => {
    const out = new Vector3();
    let writes = 0;
    out.onChanged = (): void => {
      writes += 1;
    };
    const state = new WanderState({ radius: 2, distance: 3, jitter: 4 });
    const random = new SeededRandom(19);
    // Budget 12 truncates seek/flee here; a huge budget does not.
    for (const maxAcceleration of [12, 1e6]) {
      const scenario = makeContext({
        position: [1, 2, 0],
        velocity: [0.5, 0, 0],
        maxSpeed: 6,
        maxAcceleration,
      });
      const calls: (() => void)[] = [
        () => void seek(scenario, target, out),
        () => void flee(scenario, target, out),
        () => void arrive(scenario, target, 4, out),
        () => void pursue(scenario, target, targetVelocity, out),
        () => void evade(scenario, target, targetVelocity, out),
        () => void wander(scenario, state, random, DT, out),
        () => void wanderSpherical(scenario, state, random, DT, out),
        () => void separation(scenario, neighbors, out),
        () => void cohesion(scenario, neighbors, out),
        () => void alignment(scenario, neighbors, out),
      ];
      for (const call of calls) {
        writes = 0;
        call();
        expect(writes).toBe(1);
      }
    }
  });
});

/**
 * A twelve-agent flock: separation + cohesion + alignment + wander, contained by
 * an `arrive` toward the origin. Rebuilt from scratch on every call — fixed
 * seeds, fixed layout, fixed step — so two calls must agree bit for bit (§33,
 * plan P8-3).
 */
function runFlock(steps: number): number[] {
  const count = 12;
  const agents: SteeringAgent[] = [];
  const states: WanderState[] = [];
  const streams: SeededRandom[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    agents.push(
      new SteeringAgent({
        position: new Vector3(Math.cos(angle) * 6, Math.sin(angle) * 6, 0),
        velocity: new Vector3(-Math.sin(angle) * 2, Math.cos(angle) * 2, 0),
        maxSpeed: 5,
        maxAcceleration: 10,
      }),
    );
    states.push(new WanderState({ radius: 1.5, distance: 3, jitter: 6 }));
    streams.push(new SeededRandom(1000 + i));
  }
  // Neighbour lists are built once, in insertion order (§33).
  const neighbors = agents.map((agent) => agents.filter((a) => a !== agent));

  const origin = new Vector3(0, 0, 0);
  const scratch = new Vector3();
  const steering = new Vector3();
  for (let step = 0; step < steps; step += 1) {
    for (let i = 0; i < count; i += 1) {
      const agent = agents[i];
      agent.beginSteering();
      agent.addSteering(separation(agent, neighbors[i], scratch), 2);
      agent.addSteering(alignment(agent, neighbors[i], scratch), 1);
      agent.addSteering(cohesion(agent, neighbors[i], scratch), 1);
      agent.addSteering(wander(agent, states[i], streams[i], DT, scratch), 0.5);
      agent.addSteering(arrive(agent, origin, 20, scratch), 0.6);
      agent.endSteering(steering);
      agent.integrate(DT, steering);
    }
  }
  const state: number[] = [];
  for (const agent of agents) {
    state.push(
      agent.position.x,
      agent.position.y,
      agent.position.z,
      agent.velocity.x,
      agent.velocity.y,
      agent.velocity.z,
    );
  }
  return state;
}

describe("flocking soak (§33, plan P8-3)", () => {
  it("stays bounded and finite over 3000 steps", () => {
    const state = runFlock(3000);
    expect(state.length).toBe(72);
    for (let i = 0; i < state.length; i += 6) {
      const distance = Math.hypot(state[i], state[i + 1], state[i + 2]);
      const speed = Math.hypot(state[i + 3], state[i + 4], state[i + 5]);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeLessThan(60);
      expect(speed).toBeLessThanOrEqual(5 + 1e-12);
      expect(state[i + 2]).toBe(0);
    }
  });

  it("is bit-identical across two independent runs", () => {
    const first = runFlock(3000);
    const second = runFlock(3000);
    for (let i = 0; i < first.length; i += 1) {
      expect(Object.is(first[i], second[i]), `component ${i}`).toBe(true);
    }
  });
});
