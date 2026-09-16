/**
 * `ParticleRenderable` (§36, §49, plan P9-3) — the scene node that puts a
 * {@link ParticleEmitter}'s pool on screen as **one batched draw**.
 *
 * ```ts
 * const particles = new ParticleRenderable(
 *   new ParticleEmitter({ maxParticles: 10000, emissionRate: 500, … }),
 * );
 * scene.add(particles);
 *
 * // per fixed step (§10):
 * particles.emitter.step(1 / 60, simulationTime);
 * // per rendered frame: buildRenderList picks the node up and emits one item.
 * ```
 *
 * ## What it is, and what it deliberately is not
 *
 * §49 lists `ParticleSystem` among the `Renderable` subclasses, and that is
 * where this class belongs. It **cannot extend `Renderable`**, and the reason is
 * a hard constraint rather than a preference: the frozen §3.1 dependency matrix
 * gives `@fourjs/particles` exactly `core`, `math`, and `scene`. `Renderable`,
 * `RenderItem`, `BufferGeometry`, and every material live in packages this one
 * may not import — the matrix is a plan ground rule ("never add or reverse an
 * edge"), and `particles` and `render` sit in the *same* dispatch wave, so an
 * edge between them is not merely undeclared but ordering-illegal.
 *
 * So this class extends `@fourjs/scene`'s `Node` and implements
 * `@fourjs/render`'s **structural** `ParticleDrawable` contract — the brand, the
 * two sort keys, the count, the instance array, and the repack method. Read
 * `@fourjs/render`'s `src/particles.ts` for the contract, the interleaved layout,
 * the blending policy, and the §43 statement; this file implements them and does
 * not restate the arguments.
 *
 * **Nothing type-checks the two declarations against each other** (neither
 * package can see the other). `tests/particle-renderable.test.ts` pins the shape
 * member by member, and `@fourjs/render-webgl`'s suite pins the layout from the
 * other side. When a later revision lets particles depend on render, this class
 * re-parents onto `Renderable`, `implements ParticleDrawable` becomes literal,
 * and nothing else changes. (Decision, WP-9.3 — reported to the orchestrator.)
 *
 * ## Ownership
 *
 * The renderable **owns its instance array** — one `Float32Array` of
 * `capacity × PARTICLE_INSTANCE_FLOATS`, allocated in the constructor and
 * rewritten in place forever after. It does **not** own the emitter's pool, does
 * not step the simulation (the §39 loop does), and has no `dispose()`: there is
 * no GPU resource and no external subscription here, and the array dies with the
 * node.
 *
 * ## Allocation (§7b, plan D7)
 *
 * {@link ParticleRenderable.updateParticleInstances} and
 * {@link ParticleRenderable.computeBounds} allocate **nothing** — no typed
 * arrays, no math objects, no iterators. Both read the pool's channel arrays
 * directly rather than through `ParticlePool`'s accessors, which is the pattern
 * `pool.ts` documents for hot loops (the accessors validate every index; at
 * 100 000 particles that is 100 000 range checks per frame for an invariant the
 * loop bound already guarantees).
 *
 * ## The ramp evaluation is the pool's, to the bit
 *
 * Size and colour are stored as start/end pairs plus age (§36 "color and size
 * over lifetime"), and the drawn value is the ramp at the particle's normalized
 * age. This module evaluates it in exactly the form `ParticlePool.getSize` and
 * `ParticlePool.getColor` use — `start + (end − start) · t`, with `t` from the
 * same clamped `age / lifetime` and the same non-positive-lifetime rule — so
 * what is drawn is bit-identical to what the pool reports. The tests assert that
 * against the pool's own accessors rather than against a re-derivation.
 */

import { Vector3, Vector4 } from "@fourjs/math";
import { Node } from "@fourjs/scene";

import type { ParticleEmitter } from "./emitter.js";
import type { ParticleTexture } from "./types.js";
import { TRAIL_VERTEX_FLOATS, buildTrailRibbonMesh } from "./trail.js";

/**
 * Floats per particle in {@link ParticleRenderable.particleInstances}: centre
 * (3) + current size (1) + current straight-alpha RGBA (4).
 *
 * **A deliberate duplicate** of `@fourjs/render`'s `PARTICLE_INSTANCE_FLOATS`,
 * which is the normative definition. The dependency matrix forbids importing it
 * (see the module header), so the value is restated here, exported so a caller
 * can size or slice the array without guessing, and pinned by the tests on both
 * sides.
 */
export const PARTICLE_INSTANCE_FLOATS = 8;

/**
 * Opt-in stride when the emitter sets `texture`, `alignToVelocity`, or
 * `softness` (R-32). Default emitters stay on {@link PARTICLE_INSTANCE_FLOATS}
 * so goldens and size budgets do not move.
 *
 * | Offset | Components | Meaning                         |
 * | -----: | ---------: | ------------------------------- |
 * | 0      | 3          | centre `x, y, z`                |
 * | 3      | 1          | current size                    |
 * | 4      | 4          | current straight-alpha RGBA     |
 * | 8      | 1          | billboard rotation, radians     |
 * | 9      | 1          | softness in `[0, 1]`            |
 */
export const PARTICLE_WIDE_INSTANCE_FLOATS = 10;

/** Offset of the per-particle billboard rotation in the wide stream. */
export const PARTICLE_ROTATION_OFFSET = 8;

/** Offset of the per-particle softness in the wide stream. */
export const PARTICLE_SOFTNESS_OFFSET = 9;

/** Floats per trail ribbon vertex — duplicate of `@fourjs/render`'s `TRAIL_VERTEX_FLOATS`. */
export const PARTICLE_TRAIL_VERTEX_FLOATS = TRAIL_VERTEX_FLOATS;

/** Components per particle in `ParticlePool.positions` / `velocities`. */
const VECTOR_STRIDE = 3;

/** Components per particle in `ParticlePool.sizes` (start, end). */
const SIZE_STRIDE = 2;

/**
 * `age / lifetime` clamped to `[0, 1]`, matching `ParticlePool.getNormalizedAge`
 * exactly — including its rule that a non-positive lifetime reports `1` rather
 * than `Infinity` or `NaN`.
 */
function normalizedAge(age: number, lifetime: number): number {
  if (!(lifetime > 0)) {
    return 1;
  }
  const t = age / lifetime;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Optional construction arguments of {@link ParticleRenderable}. */
export interface ParticleRenderableOptions {
  /** Initial {@link ParticleRenderable.renderLayer}; defaults to 0. */
  renderLayer?: number;
  /** Initial {@link ParticleRenderable.renderOrder}; defaults to 0. */
  renderOrder?: number;
}

/**
 * A scene node drawing one {@link ParticleEmitter}'s live particles (§36, §49).
 *
 * Particle positions are in **this node's local space** — the emitter simulates
 * in whatever frame its options were authored in, and the node's world transform
 * places the result, so a particle system can be parented, moved, and rotated
 * like anything else. (Simulating in local space is what makes a moving emitter
 * carry its particles with it; a world-space "trail behind the emitter" effect
 * is authored by leaving the node at the origin and moving the emitter's spawn
 * position, and a first-class `simulationSpace` option is **staged** — §36 names
 * one and nothing in the MVP tier reads it.)
 *
 * Visibility follows §6 through `Node`: `visible = false` or `enabled = false`
 * removes this node — and its subtree — from the render list.
 */
export class ParticleRenderable extends Node {
  /**
   * The `@fourjs/render` `ParticleDrawable` brand. `readonly` and a literal, so
   * the property's type is `true` and the structural contract is satisfied
   * exactly; see the module header for why this is a brand and not a base
   * class.
   */
  readonly isParticleDrawable = true;

  /**
   * The simulation this node draws. Public because the application steps it
   * (`renderable.emitter.step(dt, time)`) and inspects it; the node never steps
   * it and never writes to the pool.
   */
  readonly emitter: ParticleEmitter;

  /**
   * Symbolic drawing group (§46, §66 sort key 1) — the render list's primary
   * key, identical in meaning to `Renderable.renderLayer`.
   */
  renderLayer = 0;

  /**
   * Explicit ordering within a layer (§66 sort key 5). Lower draws first; ties
   * keep scene-graph order.
   *
   * Particles are blended, and §66's transparency sorting (key 2) is deferred
   * with the material state that would drive it, so this — and sibling order —
   * is the control an author has over what draws on top of what. The same
   * documented limitation the sprite tier carries.
   */
  renderOrder = 0;

  /** The owned upload array; see the module header. Never reallocated. */
  readonly #instances: Float32Array;

  /** Trail ribbon vertices, allocated when the emitter has trails enabled. */
  readonly #trailVertices: Float32Array | undefined;

  /** Particles written by the last {@link ParticleRenderable.updateParticleInstances}. */
  #count = 0;

  /** Trail vertices written by the last repack. */
  #trailVertexCount = 0;

  readonly #colorScratch = new Vector4();

  /**
   * Builds a renderable for `emitter`. The emitter is required and is not
   * defaulted: a particle system without a simulation draws nothing, and
   * inventing one here would hide the mistake behind an empty node rather than
   * a type error (the rule `Renderable` and `Sprite` follow).
   *
   * Allocates the instance array for the emitter's full `maxParticles` budget —
   * `capacity × 8` floats, 32 bytes per particle, so §112's 100 000-particle
   * budget costs 3.2 MB. This is the only allocation the class performs, ever.
   */
  constructor(
    emitter: ParticleEmitter,
    options: ParticleRenderableOptions = {},
  ) {
    super();
    this.emitter = emitter;
    this.renderLayer = options.renderLayer ?? 0;
    this.renderOrder = options.renderOrder ?? 0;
    this.#instances = new Float32Array(
      emitter.pool.capacity * emitter.instanceFloats,
    );
    if (emitter.hasTrail && emitter.trailStore !== undefined) {
      const trailLength = emitter.trailStore.length;
      const maxTrailVertices =
        emitter.pool.capacity * Math.max(trailLength - 1, 0) * 6;
      this.#trailVertices = new Float32Array(
        maxTrailVertices * TRAIL_VERTEX_FLOATS,
      );
    } else {
      this.#trailVertices = undefined;
    }
  }

  /**
   * Live particles in the last repack — the instance count of the batched draw.
   *
   * Valid only after {@link ParticleRenderable.updateParticleInstances}; it is
   * `0` on a node that has never been rendered, whatever the pool holds.
   */
  get particleCount(): number {
    return this.#count;
  }

  /**
   * The interleaved instance array, valid for
   * `particleCount × PARTICLE_INSTANCE_FLOATS` floats.
   *
   * The array instance is stable for the lifetime of the node — a backend may
   * key a GPU buffer on it, and it is the same object every frame — but its
   * *contents* belong to the last repack. Do not mutate it.
   */
  get particleInstances(): Float32Array {
    return this.#instances;
  }

  /**
   * Stride of {@link particleInstances} — `8` by default, `10` when the
   * emitter opted into R-32 appearance. Duplicated on `@fourjs/render`'s
   * `ParticleDrawable.particleInstanceFloats`.
   */
  get particleInstanceFloats(): number {
    return this.emitter.instanceFloats;
  }

  /** Texture handle or `true`, forwarded from the emitter. */
  get particleTexture(): ParticleTexture | undefined {
    return this.emitter.texture;
  }

  /** Whether this node produces a trail ribbon mesh. */
  get hasTrail(): boolean {
    return this.#trailVertices !== undefined;
  }

  /**
   * Trail ribbon vertex count — valid only after
   * {@link ParticleRenderable.updateParticleInstances}.
   */
  get trailVertexCount(): number {
    return this.#trailVertexCount;
  }

  /**
   * Interleaved trail vertices (`xyz` + straight-alpha `rgba`), valid for
   * `trailVertexCount × PARTICLE_TRAIL_VERTEX_FLOATS` floats.
   */
  get trailVertices(): Float32Array | undefined {
    return this.#trailVertices;
  }

  /**
   * Repacks the pool's live particles into {@link particleInstances} and
   * updates {@link particleCount} (§36's ramps evaluated, per the module
   * header).
   *
   * Called by `@fourjs/render`'s `buildRenderList` once per build; calling it by
   * hand is harmless and idempotent between simulation steps. One pass over the
   * live particles, `O(count)`, no allocation, no branch per channel.
   *
   * Slots past `aliveCount` are left exactly as they were: they are stale by
   * definition and never uploaded, and zeroing them would turn a 100-particle
   * frame on a 100 000-particle budget into a 3.2 MB memset.
   */
  updateParticleInstances(): void {
    // GPU mode (§36 `simulation: "gpu"`, R-31 wiring): this repack still
    // runs whole — the size and colour lanes are CPU truth (ramps are
    // functions of age, which never leaves the CPU) — but the position
    // lanes then carry **spawn-time values only**: the live positions are
    // device-resident, and the drawing backend sources them from the bound
    // `ParticleGpuSimulation`'s position buffer (keyed by this node's id),
    // reading past the stale lanes. A backend with no such binding draws
    // the stale lanes; wiring the driver on the renderer that draws the
    // scene is the application's contract (`emitter.ts`, "GPU mode").
    const pool = this.emitter.pool;
    const count = pool.aliveCount;
    const positions = pool.positions;
    const velocities = pool.velocities;
    const ages = pool.ages;
    const lifetimes = pool.lifetimes;
    const sizes = pool.sizes;
    const colors = pool.colors;
    const out = this.#instances;
    const stride = this.emitter.instanceFloats;
    const alignToVelocity = this.emitter.alignToVelocity;
    const softness = this.emitter.softness;

    for (let i = 0; i < count; i += 1) {
      const source = i * VECTOR_STRIDE;
      const target = i * stride;

      out[target] = positions[source];
      out[target + 1] = positions[source + 1];
      out[target + 2] = positions[source + 2];
      out[target + 3] = this.emitter.evaluateSize(i);

      this.emitter.evaluateColor(i, this.#colorScratch);
      out[target + 4] = this.#colorScratch.x;
      out[target + 5] = this.#colorScratch.y;
      out[target + 6] = this.#colorScratch.z;
      out[target + 7] = this.#colorScratch.w;

      if (stride === PARTICLE_WIDE_INSTANCE_FLOATS) {
        const rotation = alignToVelocity
          ? Math.atan2(velocities[source + 1], velocities[source])
          : 0;
        out[target + PARTICLE_ROTATION_OFFSET] = rotation;
        out[target + PARTICLE_SOFTNESS_OFFSET] = softness;
      }
    }

    this.#count = count;

    const trailStore = this.emitter.trailStore;
    const trailOut = this.#trailVertices;
    if (trailStore !== undefined && trailOut !== undefined) {
      this.#trailVertexCount = buildTrailRibbonMesh(
        trailStore,
        count,
        ages,
        lifetimes,
        sizes,
        colors,
        trailOut,
        this.emitter.trailHeadWidth,
        this.emitter.trailTailWidthFactor,
      );
    } else {
      this.#trailVertexCount = 0;
    }
  }

  /**
   * Writes this system's **local-space** axis-aligned bounding box into `outMin`
   * and `outMax`, and returns whether there was anything to bound.
   *
   * Returns `false` — leaving both vectors untouched — when no particle is
   * alive. An empty system has no honest box: reporting the degenerate box at
   * the node's origin would make an empty emitter look like a point-sized object
   * sitting at the origin to a future culling or picking pass, which is a
   * different claim from "nothing here" (decision, WP-9.3).
   *
   * The box covers the **drawn quads**, not just the particle centres: each
   * particle is a screen-aligned quad of its current size, which from any camera
   * angle reaches at most `size / 2` from its centre in every direction, so the
   * centre box is expanded by half the largest current size. That is exact for
   * the worst-case orientation and conservative for every other — the honest
   * bound for a billboard, whose true extent depends on a camera this node does
   * not know about.
   *
   * Computed **on demand, from the current pool** — a second `O(count)` pass,
   * not a by-product of the repack. Nothing calls it per frame yet (§64's
   * culling stage is not implemented), and pinning the bounds to the last
   * repack would make them silently stale for a caller that stepped the
   * simulation since. Allocates nothing.
   */
  computeBounds(outMin: Vector3, outMax: Vector3): boolean {
    if (this.emitter.simulationMode === "gpu") {
      // No honest box (the WP-9.3 empty-pool rule, second application): a
      // GPU-simulated system's positions live on the device (§36, R-31
      // wiring) and the pool's lanes hold spawn values only. A box over
      // spawn positions would confidently mislocate the system for culling
      // or picking — "nothing knowable here" is the truthful answer, and a
      // device-side bounds reduction is the staged fix.
      return false;
    }
    const pool = this.emitter.pool;
    const count = pool.aliveCount;
    if (count === 0) {
      return false;
    }

    const positions = pool.positions;
    const ages = pool.ages;
    const lifetimes = pool.lifetimes;
    const sizes = pool.sizes;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let maxSize = 0;

    for (let i = 0; i < count; i += 1) {
      const base = i * VECTOR_STRIDE;
      const x = positions[base];
      const y = positions[base + 1];
      const z = positions[base + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;

      const sizeBase = i * SIZE_STRIDE;
      const startSize = sizes[sizeBase];
      const size =
        startSize +
        (sizes[sizeBase + 1] - startSize) *
          normalizedAge(ages[i], lifetimes[i]);
      if (size > maxSize) {
        maxSize = size;
      }
    }

    const half = maxSize / 2;
    outMin.set(minX - half, minY - half, minZ - half);
    outMax.set(maxX + half, maxY + half, maxZ + half);
    return true;
  }
}
