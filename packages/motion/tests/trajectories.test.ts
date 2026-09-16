import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  BallisticTrajectory,
  CENTRAL_DIFFERENCE_STEP,
  CatmullRomTrajectory,
  CircularTrajectory,
  CubicBezierTrajectory,
  DEFAULT_BALLISTIC_ACCELERATION_Y,
  DampedSpringTrajectory,
  EllipticalTrajectory,
  LinearTrajectory,
  ParabolicTrajectory,
  ParametricTrajectory,
  type Trajectory,
} from "../src/trajectories.js";

/** Asserts a sample equals `(x, y, z)` to `digits` decimal places. */
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
 * Compares the analytic derivatives against central differences of
 * `samplePosition` — an independent check that velocity really is the
 * derivative of position, and acceleration the derivative of velocity.
 */
function expectDerivativesConsistent(
  trajectory: Trajectory,
  time: number,
  positionDigits = 6,
  velocityDigits = 4,
): void {
  const h = 1e-4;
  const after = trajectory.samplePosition(time + h);
  const before = trajectory.samplePosition(time - h);
  const velocity = trajectory.sampleVelocity(time);
  expectVector(
    velocity,
    (after.x - before.x) / (2 * h),
    (after.y - before.y) / (2 * h),
    (after.z - before.z) / (2 * h),
    positionDigits,
  );

  const velocityAfter = trajectory.sampleVelocity(time + h);
  const velocityBefore = trajectory.sampleVelocity(time - h);
  expectVector(
    trajectory.sampleAcceleration(time),
    (velocityAfter.x - velocityBefore.x) / (2 * h),
    (velocityAfter.y - velocityBefore.y) / (2 * h),
    (velocityAfter.z - velocityBefore.z) / (2 * h),
    velocityDigits,
  );
}

describe("LinearTrajectory (§13 linear)", () => {
  const trajectory = new LinearTrajectory({
    from: new Vector3(0, 0, 0),
    to: new Vector3(4, 2, -6),
    duration: 2,
  });

  it("samples the endpoints and the midpoint", () => {
    expectVector(trajectory.samplePosition(0), 0, 0, 0);
    expectVector(trajectory.samplePosition(trajectory.duration / 2), 2, 1, -3);
    expectVector(trajectory.samplePosition(trajectory.duration), 4, 2, -6);
  });

  it("has constant velocity and zero acceleration", () => {
    expectVector(trajectory.sampleVelocity(0), 2, 1, -3);
    expectVector(trajectory.sampleVelocity(1), 2, 1, -3);
    expectVector(trajectory.sampleAcceleration(1), 0, 0, 0);
    expectDerivativesConsistent(trajectory, 1);
  });

  it("extrapolates outside [0, duration]", () => {
    expectVector(trajectory.samplePosition(-1), -2, -1, 3);
    expectVector(trajectory.samplePosition(4), 8, 4, -12);
  });

  it("copies its endpoints", () => {
    const from = new Vector3(1, 1, 1);
    const path = new LinearTrajectory({
      from,
      to: new Vector3(2, 2, 2),
      duration: 1,
    });
    from.set(9, 9, 9);
    expectVector(path.samplePosition(0), 1, 1, 1);
  });

  it("rejects a non-positive duration", () => {
    expect(
      () =>
        new LinearTrajectory({
          from: new Vector3(),
          to: new Vector3(1, 0, 0),
          duration: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe("CircularTrajectory (§13 circular, XY plane)", () => {
  const trajectory = new CircularTrajectory({
    center: new Vector3(1, 2, 3),
    radius: 5,
    angularVelocity: Math.PI,
  });

  it("derives one revolution as its duration", () => {
    expect(trajectory.duration).toBeCloseTo(2, 12);
  });

  it("samples the start and the diametrically opposite point", () => {
    expectVector(trajectory.samplePosition(0), 6, 2, 3);
    expectVector(trajectory.samplePosition(trajectory.duration / 2), -4, 2, 3);
    expectVector(trajectory.samplePosition(trajectory.duration), 6, 2, 3);
  });

  it("sweeps counter-clockwise in XY with centripetal acceleration", () => {
    expectVector(trajectory.sampleVelocity(0), 0, 5 * Math.PI, 0);
    expectVector(
      trajectory.sampleAcceleration(0),
      -5 * Math.PI * Math.PI,
      0,
      0,
    );
    expectDerivativesConsistent(trajectory, 0.37, 5, 3);
  });

  it("honours the phase and a negative sweep rate", () => {
    const clockwise = new CircularTrajectory({
      center: new Vector3(),
      radius: 2,
      angularVelocity: -1,
      phase: Math.PI / 2,
    });
    expectVector(clockwise.samplePosition(0), 0, 2, 0);
    expectVector(clockwise.samplePosition(Math.PI / 2), 2, 0, 0);
    expect(clockwise.duration).toBeCloseTo(2 * Math.PI, 12);
  });

  it("reports an infinite duration for a zero sweep rate", () => {
    const still = new CircularTrajectory({
      center: new Vector3(),
      radius: 1,
      angularVelocity: 0,
    });
    expect(still.duration).toBe(Number.POSITIVE_INFINITY);
    expectVector(still.samplePosition(100), 1, 0, 0);
    expectVector(still.sampleVelocity(100), 0, 0, 0);
    expectVector(still.sampleAcceleration(100), 0, 0, 0);
  });
});

describe("EllipticalTrajectory (§13 elliptical)", () => {
  const trajectory = new EllipticalTrajectory({
    center: new Vector3(),
    radiusX: 3,
    radiusY: 1,
    angularVelocity: 2,
  });

  it("samples the semi-axes", () => {
    expect(trajectory.duration).toBeCloseTo(Math.PI, 12);
    expectVector(trajectory.samplePosition(0), 3, 0, 0);
    expectVector(trajectory.samplePosition(trajectory.duration / 2), -3, 0, 0);
    expectVector(trajectory.samplePosition(Math.PI / 4), 0, 1, 0);
  });

  it("differentiates analytically", () => {
    expectVector(trajectory.sampleVelocity(0), 0, 2, 0);
    expectVector(trajectory.sampleAcceleration(0), -12, 0, 0);
    expectDerivativesConsistent(trajectory, 0.6, 5, 3);
  });

  it("keeps the centre's z and honours the phase", () => {
    const shifted = new EllipticalTrajectory({
      center: new Vector3(0, 0, 4),
      radiusX: 2,
      radiusY: 5,
      angularVelocity: 1,
      phase: Math.PI / 2,
    });
    expectVector(shifted.samplePosition(0), 0, 5, 4);
  });

  it("reports an infinite duration for a zero sweep rate", () => {
    expect(
      new EllipticalTrajectory({
        center: new Vector3(),
        radiusX: 1,
        radiusY: 1,
        angularVelocity: 0,
      }).duration,
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ParabolicTrajectory and BallisticTrajectory (§13 parabolic, ballistic)", () => {
  const speed = 9.81;
  const trajectory = new BallisticTrajectory({
    from: new Vector3(),
    initialVelocity: new Vector3(3, speed, 0),
  });

  it("defaults to gravity (Appendix A) and derives the flight time", () => {
    expect(DEFAULT_BALLISTIC_ACCELERATION_Y).toBe(-9.81);
    expectVector(trajectory.acceleration, 0, -9.81, 0);
    expect(trajectory.duration).toBeCloseTo(2, 12);
  });

  it("samples the launch point and the apex", () => {
    expectVector(trajectory.samplePosition(0), 0, 0, 0);
    const apex = trajectory.duration / 2;
    expectVector(trajectory.samplePosition(apex), 3, speed * 0.5, 0);
    expectVector(trajectory.sampleVelocity(apex), 3, 0, 0);
    expectVector(trajectory.samplePosition(trajectory.duration), 6, 0, 0);
  });

  it("has constant acceleration", () => {
    expectVector(trajectory.sampleVelocity(0), 3, speed, 0);
    expectVector(trajectory.sampleAcceleration(1.7), 0, -9.81, 0);
    expectDerivativesConsistent(trajectory, 0.5, 6, 6);
  });

  it("reports an infinite duration when the path never returns", () => {
    const straight = new ParabolicTrajectory({
      from: new Vector3(),
      initialVelocity: new Vector3(1, 0, 0),
      acceleration: new Vector3(),
    });
    expect(straight.duration).toBe(Number.POSITIVE_INFINITY);
    const downward = new BallisticTrajectory({
      from: new Vector3(),
      initialVelocity: new Vector3(0, -5, 0),
    });
    expect(downward.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it("accepts an explicit duration and a custom acceleration", () => {
    const windowed = new BallisticTrajectory({
      from: new Vector3(),
      initialVelocity: new Vector3(0, 5, 0),
      acceleration: new Vector3(0, -1.62, 0),
      duration: 3,
    });
    expect(windowed.duration).toBe(3);
    expectVector(windowed.samplePosition(2), 0, 10 - 0.5 * 1.62 * 4, 0);
    expect(
      () =>
        new ParabolicTrajectory({
          from: new Vector3(),
          initialVelocity: new Vector3(),
          acceleration: new Vector3(),
          duration: -1,
        }),
    ).toThrow(RangeError);
  });
});

describe("CubicBezierTrajectory (§13 Bézier)", () => {
  const trajectory = new CubicBezierTrajectory({
    p0: new Vector3(0, 0, 0),
    p1: new Vector3(0, 1, 0),
    p2: new Vector3(1, 1, 0),
    p3: new Vector3(1, 0, 0),
    duration: 2,
  });

  it("interpolates its endpoints and its midpoint", () => {
    expectVector(trajectory.samplePosition(0), 0, 0, 0);
    expectVector(trajectory.samplePosition(1), 0.5, 0.75, 0);
    expectVector(trajectory.samplePosition(2), 1, 0, 0);
  });

  it("differentiates analytically", () => {
    // 3·(p1 − p0) / duration at u = 0.
    expectVector(trajectory.sampleVelocity(0), 0, 1.5, 0);
    expectVector(trajectory.sampleVelocity(1), 0.75, 0, 0);
    expectVector(trajectory.sampleAcceleration(1), 0, -1.5, 0);
    expectDerivativesConsistent(trajectory, 0.8);
  });

  it("rejects a non-positive duration", () => {
    expect(
      () =>
        new CubicBezierTrajectory({
          p0: new Vector3(),
          p1: new Vector3(),
          p2: new Vector3(),
          p3: new Vector3(),
          duration: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(RangeError);
  });
});

describe("CatmullRomTrajectory (§13 spline, centripetal)", () => {
  const trajectory = new CatmullRomTrajectory({
    points: [new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Vector3(2, 0, 0)],
    duration: 2,
  });

  it("defaults to the centripetal parameterization", () => {
    expect(trajectory.alpha).toBe(0.5);
  });

  it("passes through every waypoint, the middle one at duration/2", () => {
    expectVector(trajectory.samplePosition(0), 0, 0, 0);
    expectVector(trajectory.samplePosition(trajectory.duration / 2), 1, 1, 0);
    expectVector(trajectory.samplePosition(trajectory.duration), 2, 0, 0);
  });

  it("is symmetric about the middle waypoint", () => {
    const before = trajectory.samplePosition(0.5);
    const after = trajectory.samplePosition(1.5);
    expect(before.x).toBeCloseTo(2 - after.x, 12);
    expect(before.y).toBeCloseTo(after.y, 12);
  });

  it("differentiates analytically inside and across segments", () => {
    expectDerivativesConsistent(trajectory, 0.3, 5, 3);
    expectDerivativesConsistent(trajectory, 1.4, 5, 3);
  });

  it("degenerates to a straight constant-speed line for two points", () => {
    const spline = new CatmullRomTrajectory({
      points: [new Vector3(1, 2, 3), new Vector3(5, 2, -1)],
      duration: 4,
    });
    const line = new LinearTrajectory({
      from: new Vector3(1, 2, 3),
      to: new Vector3(5, 2, -1),
      duration: 4,
    });
    for (const time of [0, 1, 2, 3, 4]) {
      const fromSpline = spline.samplePosition(time);
      const fromLine = line.samplePosition(time);
      expectVector(fromSpline, fromLine.x, fromLine.y, fromLine.z, 10);
    }
    expectVector(spline.sampleVelocity(2), 1, 0, -1, 10);
    expectVector(spline.sampleAcceleration(2), 0, 0, 0, 8);
  });

  it("supports uniform and chordal parameterizations", () => {
    const points = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(4, 0, 0),
    ];
    const uniform = new CatmullRomTrajectory({ points, duration: 2, alpha: 0 });
    const chordal = new CatmullRomTrajectory({ points, duration: 2, alpha: 1 });
    // Uniform gives each segment half the time; chordal splits it 1:3 by length,
    // so the middle waypoint is reached at different times.
    expectVector(uniform.samplePosition(1), 1, 0, 0, 10);
    expectVector(chordal.samplePosition(0.5), 1, 0, 0, 10);
  });

  it("survives coincident waypoints", () => {
    const spline = new CatmullRomTrajectory({
      points: [new Vector3(), new Vector3(), new Vector3(1, 0, 0)],
      duration: 2,
    });
    expect(Number.isFinite(spline.samplePosition(1).x)).toBe(true);
    expectVector(spline.samplePosition(2), 1, 0, 0, 8);
  });

  it("extrapolates the end segments", () => {
    const extrapolated = trajectory.samplePosition(2.5);
    expect(extrapolated.x).toBeGreaterThan(2);
  });

  it("validates its arguments", () => {
    expect(
      () => new CatmullRomTrajectory({ points: [new Vector3()], duration: 1 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new CatmullRomTrajectory({
          points: [new Vector3(), new Vector3(1, 0, 0)],
          duration: 0,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new CatmullRomTrajectory({
          points: [new Vector3(), new Vector3(1, 0, 0)],
          duration: 1,
          alpha: -1,
        }),
    ).toThrow(RangeError);
  });
});

describe("DampedSpringTrajectory (§13 damped spring)", () => {
  const frequencyHz = 1;
  const dampingRatio = 0.5;
  const trajectory = new DampedSpringTrajectory({
    from: new Vector3(1, 0, 0),
    to: new Vector3(),
    frequencyHz,
    dampingRatio,
  });
  const omega = 2 * Math.PI * frequencyHz;

  /** Independent closed form of the underdamped envelope. */
  function envelope(time: number): number {
    const sigma = dampingRatio * omega;
    const damped = omega * Math.sqrt(1 - dampingRatio * dampingRatio);
    return (
      Math.exp(-sigma * time) *
      (Math.cos(damped * time) + (sigma / damped) * Math.sin(damped * time))
    );
  }

  it("starts at `from`, at rest", () => {
    expectVector(trajectory.samplePosition(0), 1, 0, 0);
    expectVector(trajectory.sampleVelocity(0), 0, 0, 0);
    // a(0) = −ωₙ²·(from − to).
    expectVector(trajectory.sampleAcceleration(0), -omega * omega, 0, 0);
  });

  it("derives the 2 % settling time as its duration", () => {
    expect(trajectory.duration).toBeCloseTo(4 / (dampingRatio * omega), 12);
  });

  it("matches the analytic envelope at duration/2", () => {
    const half = trajectory.duration / 2;
    expectVector(trajectory.samplePosition(half), envelope(half), 0, 0);
    expect(
      Math.abs(trajectory.samplePosition(trajectory.duration).x),
    ).toBeLessThan(0.03);
  });

  it("differentiates analytically in every damping regime", () => {
    expectDerivativesConsistent(trajectory, 0.4, 5, 2);
    const critical = new DampedSpringTrajectory({
      from: new Vector3(0, 2, 0),
      to: new Vector3(0, 5, 0),
      frequencyHz: 2,
      dampingRatio: 1,
    });
    expectVector(critical.samplePosition(0), 0, 2, 0);
    expectDerivativesConsistent(critical, 0.3, 5, 2);
    const over = new DampedSpringTrajectory({
      from: new Vector3(0, 0, 1),
      to: new Vector3(0, 0, 0),
      frequencyHz: 1,
      dampingRatio: 3,
    });
    expectDerivativesConsistent(over, 0.7, 5, 3);
  });

  it("settles at `to` and never overshoots when critically damped", () => {
    const critical = new DampedSpringTrajectory({
      from: new Vector3(0, 2, 0),
      to: new Vector3(0, 5, 0),
      frequencyHz: 2,
      dampingRatio: 1,
    });
    expect(critical.duration).toBeCloseTo(4 / (2 * Math.PI * 2), 12);
    for (let time = 0; time <= 2; time += 0.05) {
      const y = critical.samplePosition(time).y;
      expect(y).toBeGreaterThanOrEqual(2 - 1e-12);
      expect(y).toBeLessThanOrEqual(5 + 1e-12);
    }
    expectVector(critical.samplePosition(4), 0, 5, 0, 6);
  });

  it("oscillates forever when undamped", () => {
    const undamped = new DampedSpringTrajectory({
      from: new Vector3(1, 0, 0),
      to: new Vector3(),
      frequencyHz: 1,
      dampingRatio: 0,
    });
    expect(undamped.duration).toBe(Number.POSITIVE_INFINITY);
    expectVector(undamped.samplePosition(0.5), -1, 0, 0, 10);
    expectVector(undamped.samplePosition(1), 1, 0, 0, 10);
  });

  it("accepts an explicit duration and validates its arguments", () => {
    expect(
      new DampedSpringTrajectory({
        from: new Vector3(),
        to: new Vector3(1, 0, 0),
        frequencyHz: 1,
        dampingRatio: 0,
        duration: 5,
      }).duration,
    ).toBe(5);
    expect(
      () =>
        new DampedSpringTrajectory({
          from: new Vector3(),
          to: new Vector3(),
          frequencyHz: 0,
          dampingRatio: 1,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new DampedSpringTrajectory({
          from: new Vector3(),
          to: new Vector3(),
          frequencyHz: 1,
          dampingRatio: -0.5,
        }),
    ).toThrow(RangeError);
  });
});

describe("ParametricTrajectory (§13 custom parametric)", () => {
  const trajectory = new ParametricTrajectory({
    duration: 4,
    position: (time, out) => out.set(time * time, Math.sin(time), 2 * time),
  });

  it("delegates position to the callback", () => {
    expectVector(trajectory.samplePosition(0), 0, 0, 0);
    expectVector(trajectory.samplePosition(2), 4, Math.sin(2), 4);
  });

  it("differentiates by central difference", () => {
    expect(CENTRAL_DIFFERENCE_STEP).toBe(1e-4);
    expectVector(trajectory.sampleVelocity(2), 4, Math.cos(2), 2, 6);
    expectVector(trajectory.sampleAcceleration(2), 2, -Math.sin(2), 0, 4);
  });

  it("tolerates a callback that ignores `out`", () => {
    const owned = new Vector3();
    const path = new ParametricTrajectory({
      duration: 1,
      position: (time) => owned.set(time, time * time, 0),
    });
    expectVector(path.samplePosition(0.5), 0.5, 0.25, 0);
    expectVector(path.sampleVelocity(0.5), 1, 1, 0, 6);
    expectVector(path.sampleAcceleration(0.5), 0, 2, 0, 4);
  });

  it("rejects a non-positive duration", () => {
    expect(
      () =>
        new ParametricTrajectory({
          duration: Number.NaN,
          position: (_time, out) => out,
        }),
    ).toThrow(RangeError);
  });
});

describe("sampling contract (§13, plan D7)", () => {
  const all: readonly (readonly [string, Trajectory])[] = [
    [
      "linear",
      new LinearTrajectory({
        from: new Vector3(),
        to: new Vector3(1, 2, 3),
        duration: 2,
      }),
    ],
    [
      "circular",
      new CircularTrajectory({
        center: new Vector3(),
        radius: 2,
        angularVelocity: 1,
      }),
    ],
    [
      "elliptical",
      new EllipticalTrajectory({
        center: new Vector3(),
        radiusX: 2,
        radiusY: 1,
        angularVelocity: 1,
      }),
    ],
    [
      "parabolic",
      new ParabolicTrajectory({
        from: new Vector3(),
        initialVelocity: new Vector3(1, 2, 0),
        acceleration: new Vector3(0, -9.81, 0),
      }),
    ],
    [
      "ballistic",
      new BallisticTrajectory({
        from: new Vector3(),
        initialVelocity: new Vector3(1, 2, 0),
      }),
    ],
    [
      "cubic-bezier",
      new CubicBezierTrajectory({
        p0: new Vector3(),
        p1: new Vector3(0, 1, 0),
        p2: new Vector3(1, 1, 0),
        p3: new Vector3(1, 0, 0),
        duration: 1,
      }),
    ],
    [
      "catmull-rom",
      new CatmullRomTrajectory({
        points: [
          new Vector3(),
          new Vector3(1, 1, 0),
          new Vector3(2, 0, 0),
          new Vector3(3, 1, 1),
        ],
        duration: 3,
      }),
    ],
    [
      "damped-spring",
      new DampedSpringTrajectory({
        from: new Vector3(1, 0, 0),
        to: new Vector3(),
        frequencyHz: 2,
        dampingRatio: 0.4,
      }),
    ],
    [
      "parametric",
      new ParametricTrajectory({
        duration: 2,
        position: (time, out) => out.set(time, time * time, 0),
      }),
    ],
  ];

  it("writes into `out` and returns it", () => {
    const out = new Vector3();
    for (const [name, trajectory] of all) {
      expect(trajectory.samplePosition(0.25, out), name).toBe(out);
      expect(trajectory.sampleVelocity(0.25, out), name).toBe(out);
      expect(trajectory.sampleAcceleration(0.25, out), name).toBe(out);
    }
  });

  it("allocates nothing when `out` is passed", () => {
    const out = new Vector3();
    for (const [name, trajectory] of all) {
      // Warm up: nothing here caches, but the first call proves the path.
      trajectory.samplePosition(0.1, out);
      resetConstructionCount();
      for (let i = 0; i < 20; i += 1) {
        const time = i * 0.05;
        trajectory.samplePosition(time, out);
        trajectory.sampleVelocity(time, out);
        trajectory.sampleAcceleration(time, out);
      }
      expect(constructionCount(), name).toBe(0);
    }
  });

  it("allocates a fresh vector when `out` is omitted", () => {
    for (const [name, trajectory] of all) {
      const first = trajectory.samplePosition(0.25);
      const second = trajectory.samplePosition(0.25);
      expect(first, name).not.toBe(second);
      expect(first.equalsApprox(second), name).toBe(true);
    }
  });

  it("is a pure function of time (§33)", () => {
    for (const [name, trajectory] of all) {
      const forwards = [0, 0.5, 1, 1.5].map(
        (time) => trajectory.samplePosition(time).x,
      );
      const backwards = [1.5, 1, 0.5, 0]
        .map((time) => trajectory.samplePosition(time).x)
        .reverse();
      expect(backwards, name).toEqual(forwards);
    }
  });

  it("reports a duration in seconds for every built-in", () => {
    for (const [name, trajectory] of all) {
      expect(trajectory.duration, name).toBeGreaterThan(0);
    }
  });
});
