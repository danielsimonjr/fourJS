import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  ballisticApexHeight,
  ballisticTimeOfFlightToPlane,
  ballisticTimeToApex,
  interceptPoint,
  interceptTime,
  predictBallistic,
  predictLinear,
} from "../src/prediction.js";

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

/**
 * Independent projectile: steps position and velocity with the exact
 * constant-acceleration update (`x += v·dt + ½·a·dt²`, `v += a·dt`) rather than
 * asking the module under test. Returns the position after `steps` steps.
 */
function integrate(
  position: Vector3,
  velocity: Vector3,
  acceleration: Vector3,
  dt: number,
  steps: number,
): Vector3 {
  const p = position.clone();
  const v = velocity.clone();
  for (let i = 0; i < steps; i += 1) {
    p.set(
      p.x + v.x * dt + 0.5 * acceleration.x * dt * dt,
      p.y + v.y * dt + 0.5 * acceleration.y * dt * dt,
      p.z + v.z * dt + 0.5 * acceleration.z * dt * dt,
    );
    v.set(
      v.x + acceleration.x * dt,
      v.y + acceleration.y * dt,
      v.z + acceleration.z * dt,
    );
  }
  return p;
}

const GRAVITY = new Vector3(0, -9.81, 0);

describe("predictBallistic", () => {
  it("matches the hand-integrated closed form", () => {
    const position = new Vector3(1, 2, 3);
    const velocity = new Vector3(3, 10, -2);
    // p + v·2 + ½·g·4 = (1 + 6, 2 + 20 − 19.62, 3 − 4).
    expectVector(
      predictBallistic(position, velocity, GRAVITY, 2),
      7,
      2 + 20 - 19.62,
      -1,
    );
  });

  it("agrees with an independently stepped projectile", () => {
    const position = new Vector3(-2, 5, 0.5);
    const velocity = new Vector3(4, 7, -1.5);
    const stepped = integrate(position, velocity, GRAVITY, 1 / 2000, 3000);
    const predicted = predictBallistic(position, velocity, GRAVITY, 1.5);
    expectVector(predicted, stepped.x, stepped.y, stepped.z, 9);
  });

  it("returns the launch position at t = 0 and extrapolates backwards", () => {
    const position = new Vector3(1, 2, 3);
    const rest = new Vector3(0, 0, 0);
    expectVector(predictBallistic(position, rest, GRAVITY, 0), 1, 2, 3);
    // Dropped from rest: the parabola is symmetric about t = 0.
    const back = predictBallistic(position, rest, GRAVITY, -0.5);
    const forward = predictBallistic(position, rest, GRAVITY, 0.5);
    expectVector(back, forward.x, forward.y, forward.z);
  });

  it("writes into `out` without allocating, and allocates only when omitted", () => {
    const position = new Vector3(0, 0, 0);
    const velocity = new Vector3(1, 1, 1);
    const out = new Vector3();
    resetConstructionCount();
    const returned = predictBallistic(position, velocity, GRAVITY, 0.25, out);
    predictLinear(position, velocity, 0.25, out);
    expect(constructionCount()).toBe(0);
    expect(returned).toBe(out);

    const first = predictBallistic(position, velocity, GRAVITY, 0.25);
    const second = predictBallistic(position, velocity, GRAVITY, 0.25);
    expect(first).not.toBe(second);
    expect(first.equalsApprox(second)).toBe(true);
  });
});

describe("predictLinear", () => {
  it("advances a constant velocity", () => {
    const position = new Vector3(2, -1, 0);
    const velocity = new Vector3(-4, 0.5, 3);
    expectVector(predictLinear(position, velocity, 3), -10, 0.5, 9);
  });

  it("is the zero-acceleration case of predictBallistic", () => {
    const position = new Vector3(2, -1, 0);
    const velocity = new Vector3(-4, 0.5, 3);
    const zero = new Vector3(0, 0, 0);
    const linear = predictLinear(position, velocity, 1.7);
    const ballistic = predictBallistic(position, velocity, zero, 1.7);
    expectVector(linear, ballistic.x, ballistic.y, ballistic.z);
  });
});

describe("ballistic apex", () => {
  it("solves the textbook vertical shot", () => {
    const velocity = new Vector3(6, 10, -3);
    expect(ballisticTimeToApex(velocity, GRAVITY)).toBeCloseTo(10 / 9.81, 12);
    expect(ballisticApexHeight(velocity, GRAVITY)).toBeCloseTo(
      100 / (2 * 9.81),
      12,
    );
  });

  it("satisfies apexHeight = ½·|g|·timeToApex²", () => {
    const cases: readonly (readonly [Vector3, Vector3])[] = [
      [new Vector3(0, 10, 0), GRAVITY],
      [new Vector3(1, 6, 8), new Vector3(0, -6, -8)],
      [new Vector3(-3, 0, 2), new Vector3(1, -2, 3)],
      [new Vector3(0, -5, 0), new Vector3(0, -10, 0)],
    ];
    for (const [velocity, gravity] of cases) {
      const time = ballisticTimeToApex(velocity, gravity);
      expect(ballisticApexHeight(velocity, gravity)).toBeCloseTo(
        0.5 * gravity.length() * time * time,
        12,
      );
    }
  });

  it("puts the vertex where the velocity along gravity vanishes", () => {
    // Tilted gravity: |g| = 10, up axis = (0, 0.6, 0.8), v·up = 10.
    const velocity = new Vector3(1, 6, 8);
    const gravity = new Vector3(0, -6, -8);
    const time = ballisticTimeToApex(velocity, gravity);
    expect(time).toBeCloseTo(1, 12);

    const apexVelocity = new Vector3(
      velocity.x + gravity.x * time,
      velocity.y + gravity.y * time,
      velocity.z + gravity.z * time,
    );
    expect(apexVelocity.dot(gravity)).toBeCloseTo(0, 12);

    const launch = new Vector3(3, -1, 2);
    const apex = predictBallistic(launch, velocity, gravity, time);
    const up = new Vector3(
      -gravity.x / gravity.length(),
      -gravity.y / gravity.length(),
      -gravity.z / gravity.length(),
    );
    const rise =
      (apex.x - launch.x) * up.x +
      (apex.y - launch.y) * up.y +
      (apex.z - launch.z) * up.z;
    expect(rise).toBeCloseTo(ballisticApexHeight(velocity, gravity), 12);
    expect(rise).toBeCloseTo(5, 12);
  });

  it("reports a vertex in the past for a downward shot, with a positive height", () => {
    const velocity = new Vector3(0, -5, 0);
    const gravity = new Vector3(0, -10, 0);
    expect(ballisticTimeToApex(velocity, gravity)).toBeCloseTo(-0.5, 12);
    expect(ballisticApexHeight(velocity, gravity)).toBeCloseTo(1.25, 12);
  });

  it("has no apex without gravity", () => {
    const velocity = new Vector3(0, 10, 0);
    const zero = new Vector3(0, 0, 0);
    expect(ballisticTimeToApex(velocity, zero)).toBe(Number.POSITIVE_INFINITY);
    expect(ballisticApexHeight(velocity, zero)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ballisticTimeOfFlightToPlane", () => {
  const origin = new Vector3(0, 0, 0);

  it("returns the landing, not the launch, for a shot fired from the plane", () => {
    const velocity = new Vector3(2, 10, -1);
    const flight = ballisticTimeOfFlightToPlane(origin, velocity, GRAVITY, 0);
    expect(flight).toBeCloseTo((2 * 10) / 9.81, 12);
    expect(flight).toBeCloseTo(2 * ballisticTimeToApex(velocity, GRAVITY), 12);
    const landing = predictBallistic(origin, velocity, GRAVITY, flight);
    expect(landing.y).toBeCloseTo(0, 12);
  });

  it("returns the rising crossing when both are ahead", () => {
    // ½·(−10)·t² + 10·t − 3.75 = 0 → t = 0.5 (up) and t = 1.5 (down).
    const velocity = new Vector3(0, 10, 0);
    const gravity = new Vector3(0, -10, 0);
    const time = ballisticTimeOfFlightToPlane(origin, velocity, gravity, 3.75);
    expect(time).toBeCloseTo(0.5, 12);
    // The other root is the mirror of this one about the apex.
    const other = 2 * ballisticTimeToApex(velocity, gravity) - time;
    expect(other).toBeCloseTo(1.5, 12);
    expect(predictBallistic(origin, velocity, gravity, other).y).toBeCloseTo(
      3.75,
      12,
    );
  });

  it("ignores horizontal gravity components — the plane is horizontal", () => {
    const from = new Vector3(0, 20, 0);
    const rest = new Vector3(0, 0, 0);
    const plain = ballisticTimeOfFlightToPlane(
      from,
      rest,
      new Vector3(0, -10, 0),
      0,
    );
    const tilted = ballisticTimeOfFlightToPlane(
      from,
      rest,
      new Vector3(3, -10, -7),
      0,
    );
    expect(plain).toBeCloseTo(2, 12);
    expect(tilted).toBe(plain);
  });

  it("reports NaN when the apex never reaches the plane", () => {
    const velocity = new Vector3(0, 10, 0);
    const gravity = new Vector3(0, -10, 0);
    // Apex is 5 units up; the plane is at 10.
    expect(
      ballisticTimeOfFlightToPlane(origin, velocity, gravity, 10),
    ).toBeNaN();
  });

  it("reports NaN when both crossings are in the past", () => {
    // Fired downward from the plane: roots are 0 (now) and −2 (before).
    const velocity = new Vector3(0, -10, 0);
    const gravity = new Vector3(0, -10, 0);
    expect(
      ballisticTimeOfFlightToPlane(origin, velocity, gravity, 0),
    ).toBeNaN();
  });

  it("solves the linear case when gravity has no vertical component", () => {
    const zero = new Vector3(0, 0, 0);
    expect(
      ballisticTimeOfFlightToPlane(origin, new Vector3(0, 5, 0), zero, 10),
    ).toBeCloseTo(2, 12);
    expect(
      ballisticTimeOfFlightToPlane(origin, new Vector3(0, -5, 0), zero, 10),
    ).toBeNaN();
  });

  it("handles level flight: 0 in the plane, NaN off it", () => {
    const zero = new Vector3(0, 0, 0);
    const level = new Vector3(7, 0, 0);
    expect(ballisticTimeOfFlightToPlane(origin, level, zero, 0)).toBe(0);
    expect(ballisticTimeOfFlightToPlane(origin, level, zero, 4)).toBeNaN();
  });
});

describe("interceptTime / interceptPoint", () => {
  const shooter = new Vector3(0, 0, 0);

  it("reduces to d / s against a stationary target", () => {
    const target = new Vector3(60, 80, 0); // |R| = 100
    const still = new Vector3(0, 0, 0);
    expect(interceptTime(shooter, 25, target, still)).toBe(4);
    const point = interceptPoint(shooter, 25, target, still);
    expect(point).not.toBeNull();
    expectVector(point as Vector3, 60, 80, 0);
  });

  it("leads a crossing target so an independently simulated shot hits it", () => {
    const shooterPosition = new Vector3(-5, 1, 0);
    const targetStart = new Vector3(30, 4, -12);
    const targetVelocity = new Vector3(-6, 0, 9);
    const speed = 20;

    const time = interceptTime(
      shooterPosition,
      speed,
      targetStart,
      targetVelocity,
    );
    expect(Number.isFinite(time)).toBe(true);
    const aim = interceptPoint(
      shooterPosition,
      speed,
      targetStart,
      targetVelocity,
    );
    expect(aim).not.toBeNull();
    const aimPoint = aim as Vector3;

    // Fire at exactly `speed` towards the predicted point and step both bodies
    // independently, tracking the closest approach.
    const direction = new Vector3(
      aimPoint.x - shooterPosition.x,
      aimPoint.y - shooterPosition.y,
      aimPoint.z - shooterPosition.z,
    );
    const length = direction.length();
    // The shot must be exactly `speed · time` long — that is the intercept
    // equation itself.
    expect(length).toBeCloseTo(speed * time, 9);
    const projectileVelocity = new Vector3(
      (direction.x / length) * speed,
      (direction.y / length) * speed,
      (direction.z / length) * speed,
    );

    // The step count divides the predicted flight exactly, so the last sample
    // lands on the interception instead of straddling it.
    const steps = 20000;
    const dt = time / steps;
    const projectile = shooterPosition.clone();
    const target = targetStart.clone();
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= steps; i += 1) {
      const dx = projectile.x - target.x;
      const dy = projectile.y - target.y;
      const dz = projectile.z - target.z;
      closest = Math.min(closest, Math.sqrt(dx * dx + dy * dy + dz * dz));
      projectile.set(
        projectile.x + projectileVelocity.x * dt,
        projectile.y + projectileVelocity.y * dt,
        projectile.z + projectileVelocity.z * dt,
      );
      target.set(
        target.x + targetVelocity.x * dt,
        target.y + targetVelocity.y * dt,
        target.z + targetVelocity.z * dt,
      );
    }
    // Both bodies move in straight lines, so the discrete walk is exact and the
    // closest approach is the interception itself.
    expect(closest).toBeLessThan(1e-9);
  });

  it("takes the earlier of two interceptions with a faster target", () => {
    // Target dives straight at the shooter at 50 units/s against a 10 unit/s
    // shot: roots 5/3 (before it arrives) and 5/2 (chasing it afterwards).
    const target = new Vector3(0, 100, 0);
    const velocity = new Vector3(0, -50, 0);
    const time = interceptTime(shooter, 10, target, velocity);
    expect(time).toBeCloseTo(5 / 3, 12);

    // Both roots satisfy |R + V·t| = s·t; the later one is not the answer.
    for (const root of [5 / 3, 5 / 2]) {
      const at = predictLinear(target, velocity, root);
      expect(at.length()).toBeCloseTo(10 * root, 9);
    }
  });

  it("solves the degenerate equal-speed case", () => {
    const target = new Vector3(10, 0, 0);
    // Closing at exactly the projectile speed: linear, t = |R|² / (2·|R·V|).
    expect(interceptTime(shooter, 5, target, new Vector3(-5, 0, 0))).toBe(1);
    // Receding at the projectile speed: never caught.
    expect(interceptTime(shooter, 5, target, new Vector3(5, 0, 0))).toBeNaN();
  });

  it("hits a target that is already at the shooter at t = 0", () => {
    const target = new Vector3(0, 0, 0);
    const velocity = new Vector3(3, 0, 0);
    expect(interceptTime(shooter, 12, target, velocity)).toBe(0);
    const point = interceptPoint(shooter, 12, target, velocity);
    expectVector(point as Vector3, 0, 0, 0);
    // Same when the target's speed equals the projectile's.
    expect(interceptTime(shooter, 3, target, velocity)).toBe(0);
  });

  it("reports NaN and null when the target outruns the projectile", () => {
    const target = new Vector3(10, 0, 0);
    const receding = new Vector3(30, 0, 0);
    expect(interceptTime(shooter, 5, target, receding)).toBeNaN();

    const out = new Vector3(-1, -2, -3);
    expect(interceptPoint(shooter, 5, target, receding, out)).toBeNull();
    // `out` is left exactly as the caller had it.
    expectVector(out, -1, -2, -3);
  });

  it("reports NaN for a stationary projectile against a moving target", () => {
    const target = new Vector3(10, 0, 0);
    expect(interceptTime(shooter, 0, target, new Vector3(1, 0, 0))).toBeNaN();
  });

  it("rejects a negative or non-finite projectile speed", () => {
    const target = new Vector3(10, 0, 0);
    const still = new Vector3(0, 0, 0);
    expect(() => interceptTime(shooter, -1, target, still)).toThrow(RangeError);
    expect(() => interceptTime(shooter, Number.NaN, target, still)).toThrow(
      RangeError,
    );
    expect(() =>
      interceptTime(shooter, Number.POSITIVE_INFINITY, target, still),
    ).toThrow(RangeError);
    expect(() => interceptPoint(shooter, -1, target, still)).toThrow(
      RangeError,
    );
  });

  it("falls back to Reynolds' horizon when onMiss is heuristic", () => {
    // Faster and opening: the default path returns NaN; steering asks for
    // |R| / speed so a pursuer still has a point to seek.
    const target = new Vector3(10, 0, 0);
    const receding = new Vector3(9, 0, 0);
    expect(interceptTime(shooter, 3, target, receding)).toBeNaN();
    expect(
      interceptTime(shooter, 3, target, receding, { onMiss: "heuristic" }),
    ).toBeCloseTo(10 / 3, 12);
  });

  it("does not throw on a bad speed when validateSpeed is false", () => {
    const target = new Vector3(10, 0, 0);
    const still = new Vector3(0, 0, 0);
    // Negative speed is squared in the quadratic, so a root can still exist;
    // the knob only skips the RangeError. NaN speed has no root.
    expect(() =>
      interceptTime(shooter, -1, target, still, { validateSpeed: false }),
    ).not.toThrow();
    expect(
      interceptTime(shooter, Number.NaN, target, still, {
        validateSpeed: false,
      }),
    ).toBeNaN();
  });

  it("writes into `out` without allocating, and allocates only when omitted", () => {
    const target = new Vector3(10, 0, 0);
    const velocity = new Vector3(0, 4, 0);
    const out = new Vector3();
    resetConstructionCount();
    const returned = interceptPoint(shooter, 15, target, velocity, out);
    expect(constructionCount()).toBe(0);
    expect(returned).toBe(out);

    const first = interceptPoint(shooter, 15, target, velocity);
    const second = interceptPoint(shooter, 15, target, velocity);
    expect(first).not.toBe(second);
    expect((first as Vector3).equalsApprox(second as Vector3)).toBe(true);
  });
});

describe("determinism (§33)", () => {
  it("returns bit-identical results for identical inputs", () => {
    const position = new Vector3(1.25, -3.5, 0.75);
    const velocity = new Vector3(2.5, 9, -1.25);
    const targetVelocity = new Vector3(-3, 1, 0.5);
    const shooter = new Vector3(0.5, 0.25, -0.75);

    const scalars = () => [
      ballisticTimeToApex(velocity, GRAVITY),
      ballisticApexHeight(velocity, GRAVITY),
      ballisticTimeOfFlightToPlane(position, velocity, GRAVITY, -2),
      // A no-solution case: NaN is part of the contract, so it is compared too.
      ballisticTimeOfFlightToPlane(position, velocity, GRAVITY, 500),
      interceptTime(shooter, 11, position, targetVelocity),
    ];
    const first = scalars();
    const second = scalars();
    for (let i = 0; i < first.length; i += 1) {
      expect(Object.is(first[i], second[i])).toBe(true);
    }

    const a = predictBallistic(position, velocity, GRAVITY, 0.9);
    const b = predictBallistic(position, velocity, GRAVITY, 0.9);
    expect(Object.is(a.x, b.x)).toBe(true);
    expect(Object.is(a.y, b.y)).toBe(true);
    expect(Object.is(a.z, b.z)).toBe(true);
  });
});
