import {
  constructionCount,
  resetConstructionCount,
  Vector4,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  ParticleEmitter,
  evaluateLifetimeRampColor,
  evaluateLifetimeRampColorInto,
  type ParticleColor,
  type ParticleLifetimeRamp,
} from "../src/index.js";

const c = (r: number, g: number, b: number, a: number): ParticleColor => ({
  r,
  g,
  b,
  a,
});

describe("evaluateLifetimeRampColorInto", () => {
  const ramps: ParticleLifetimeRamp<ParticleColor>[] = [
    { start: c(1, 0, 0, 1), end: c(0, 0, 1, 0) },
    {
      start: c(1, 0, 0, 1),
      end: c(0, 0, 1, 0),
      stops: [{ t: 0.4, value: c(0, 1, 0, 0.5) }],
    },
    {
      start: c(1, 0, 0, 1),
      end: c(0, 0, 1, 0),
      stops: [
        { t: 1e-20, value: c(0, 1, 0, 0.5) },
        { t: 0.5, value: c(1, 1, 1, 1) },
      ],
    },
    {
      start: c(1, 0, 0, 1),
      end: c(0, 0, 1, 0),
      stops: [{ t: 1, value: c(0, 1, 0, 0.5) }],
    },
    {
      start: c(1, 0, 0, 1),
      end: c(0, 0, 1, 0),
      stops: [{ t: 0, value: c(0, 1, 0, 0.5) }],
    },
  ];

  it("matches the allocating form and returns out", () => {
    for (const ramp of ramps) {
      for (const t of [-1, 0, 0.2, 0.4, 0.7, 1, 2]) {
        const out = { r: 9, g: 9, b: 9, a: 9 };
        const got = evaluateLifetimeRampColorInto(ramp, t, out);
        expect(got).toBe(out);
        expect(got).toEqual(evaluateLifetimeRampColor(ramp, t));
      }
    }
  });
});

describe("ParticleEmitter evaluateColor/evaluateSize allocation", () => {
  it("allocates no math objects with and without stops", () => {
    for (const stops of [false, true]) {
      const emitter = new ParticleEmitter({
        maxParticles: 4,
        lifetime: { min: 1, max: 1 },
        color: {
          start: c(1, 0, 0, 1),
          end: c(0, 0, 1, 0),
          stops: stops ? [{ t: 0.5, value: c(0, 1, 0, 1) }] : undefined,
        },
        size: {
          start: 1,
          end: 0,
          stops: stops ? [{ t: 0.5, value: 2 }] : undefined,
        },
      });
      emitter.emit(2);
      emitter.step(0.3);
      const out = new Vector4();
      resetConstructionCount();
      for (let i = 0; i < 100; i += 1) {
        emitter.evaluateColor(0, out);
        emitter.evaluateSize(0);
      }
      expect(constructionCount()).toBe(0);
    }
  });
});
