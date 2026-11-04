/**
 * R-32 appearance options and the §36 `collisions: "depth-buffer"` CPU
 * fallback — defaults stay on the 8-float stream.
 */

import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_ROTATION_OFFSET,
  PARTICLE_SOFTNESS_OFFSET,
  PARTICLE_WIDE_INSTANCE_FLOATS,
  ParticleEmitter,
  ParticleRenderable,
  radialField,
  windField,
  type ParticleCollisionMode,
} from "../src/index.js";

const DT = 1 / 60;

describe("ParticleEmitter appearance options (R-32)", () => {
  it("defaults stay on the 8-float stream", () => {
    const emitter = new ParticleEmitter({ maxParticles: 4 });
    expect(emitter.texture).toBeUndefined();
    expect(emitter.alignToVelocity).toBe(false);
    expect(emitter.softness).toBe(0);
    expect(emitter.collisions).toBe("none");
    expect(emitter.instanceFloats).toBe(PARTICLE_INSTANCE_FLOATS);
    expect(emitter.gpuRadial).toBeUndefined();
  });

  it("opts into the wide stream for texture, alignToVelocity, or softness", () => {
    expect(
      new ParticleEmitter({ maxParticles: 1, texture: true }).instanceFloats,
    ).toBe(PARTICLE_WIDE_INSTANCE_FLOATS);
    expect(
      new ParticleEmitter({ maxParticles: 1, alignToVelocity: true })
        .instanceFloats,
    ).toBe(PARTICLE_WIDE_INSTANCE_FLOATS);
    expect(
      new ParticleEmitter({ maxParticles: 1, softness: 0.25 }).instanceFloats,
    ).toBe(PARTICLE_WIDE_INSTANCE_FLOATS);
    expect(
      new ParticleEmitter({ maxParticles: 1, softness: 0 }).instanceFloats,
    ).toBe(PARTICLE_INSTANCE_FLOATS);
  });

  it("rejects softness outside [0, 1]", () => {
    expect(
      () => new ParticleEmitter({ maxParticles: 1, softness: -0.1 }),
    ).toThrow(/softness/);
    expect(
      () => new ParticleEmitter({ maxParticles: 1, softness: 1.1 }),
    ).toThrow(/softness/);
  });

  it("rejects an unknown collisions value", () => {
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          collisions: "mesh" as ParticleCollisionMode,
        }),
    ).toThrow(/collisions must be "none" or "depth-buffer"/);
  });

  it("accepts a texture handle object", () => {
    const handle = { id: "spark" };
    const emitter = new ParticleEmitter({ maxParticles: 1, texture: handle });
    expect(emitter.texture).toBe(handle);
  });
});

describe("ParticleRenderable wide stream (R-32)", () => {
  it("allocates 8 floats per particle when appearance is off", () => {
    const node = new ParticleRenderable(
      new ParticleEmitter({ maxParticles: 8 }),
    );
    expect(node.particleInstanceFloats).toBe(8);
    expect(node.particleInstances.length).toBe(8 * PARTICLE_INSTANCE_FLOATS);
    expect(node.particleTexture).toBeUndefined();
  });

  it("writes rotation from velocity atan2 and the emitter softness", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 1,
      alignToVelocity: true,
      softness: 0.5,
    });
    emitter.emit(1);
    emitter.pool.setVelocity(0, 0, 2, 0);
    const node = new ParticleRenderable(emitter);
    node.updateParticleInstances();

    const stride = PARTICLE_WIDE_INSTANCE_FLOATS;
    expect(node.particleInstances.length).toBe(stride);
    expect(node.particleInstances[PARTICLE_ROTATION_OFFSET]).toBeCloseTo(
      Math.atan2(2, 0),
      6,
    );
    expect(node.particleInstances[PARTICLE_SOFTNESS_OFFSET]).toBe(0.5);
  });

  it("writes rotation 0 when alignToVelocity is off", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 1,
      softness: 0.2,
    });
    emitter.emit(1);
    emitter.pool.setVelocity(0, 3, 4, 0);
    const node = new ParticleRenderable(emitter);
    node.updateParticleInstances();
    expect(node.particleInstances[PARTICLE_ROTATION_OFFSET]).toBe(0);
    expect(node.particleInstances[PARTICLE_SOFTNESS_OFFSET]).toBeCloseTo(0.2);
  });
});

describe('collisions: "depth-buffer" — CPU kill below ground', () => {
  it("kills particles that fall below y = 0 when collisionPlaneY is omitted", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      collisions: "depth-buffer",
      gravity: new Vector3(0, 0, 0),
    });
    emitter.emit(2);
    emitter.pool.setPosition(0, 0, 1, 0);
    emitter.pool.setPosition(1, 0, -0.1, 0);
    emitter.pool.setVelocity(0, 0, 0, 0);
    emitter.pool.setVelocity(1, 0, 0, 0);
    emitter.pool.setLifetime(0, 10);
    emitter.pool.setLifetime(1, 10);

    emitter.step(DT, 0);

    expect(emitter.particleCount).toBe(1);
    expect(emitter.pool.positions[1]).toBe(1);
  });

  it("uses collisionPlaneY as the ground when both are set (kill, not bounce)", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 1,
      collisions: "depth-buffer",
      collisionPlaneY: 2,
      restitution: 1,
      gravity: new Vector3(0, 0, 0),
    });
    emitter.emit(1);
    emitter.pool.setPosition(0, 0, 1.5, 0);
    emitter.pool.setVelocity(0, 0, -1, 0);
    emitter.pool.setLifetime(0, 10);

    emitter.step(DT, 0);

    expect(emitter.particleCount).toBe(0);
  });
});

describe("GPU mode — radial field and depth-buffer (R-31 residue)", () => {
  it("accepts a single radialField on the GPU path", () => {
    const field = radialField(new Vector3(1, 2, 3), -4, { minDistance: 0.5 });
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      simulation: "gpu",
      fields: [field],
    });
    expect(emitter.gpuRadial).toEqual({
      kind: "radial",
      originX: 1,
      originY: 2,
      originZ: 3,
      strength: -4,
      minDistance: 0.5,
    });
  });

  it("accepts a wind field on the GPU path (the full field stack)", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      simulation: "gpu",
      fields: [windField(new Vector3(1, 0, 0), 1)],
    });
    expect(emitter.gpuFields).toHaveLength(1);
    expect(emitter.gpuRadial).toBeUndefined();
  });

  it("accepts collisions: depth-buffer with collisionPlaneY as the ground", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      simulation: "gpu",
      collisions: "depth-buffer",
      collisionPlaneY: -1,
    });
    expect(emitter.collisions).toBe("depth-buffer");
    expect(emitter.collisionPlaneY).toBe(-1);
  });
});
