/**
 * Per-particle position history and ribbon mesh generation (§36 trails, plan P9).
 *
 * Each live slot owns a fixed-length ring buffer of recent positions. After
 * every CPU integration step the emitter pushes the new centre; on swap-remove
 * the buffer moves with the slot. {@link buildTrailRibbonMesh} turns those
 * histories into a single batched triangle list for one draw call.
 */

/** World-space Y used to build a ribbon side vector when the segment is not vertical. */
const TRAIL_UP_Y = 1;

/** Floats per trail vertex: centre `xyz` plus straight-alpha `rgba`. */
export const TRAIL_VERTEX_FLOATS = 7;

/** Default ring-buffer length when {@link ParticleTrailOptions.length} is omitted. */
export const DEFAULT_TRAIL_LENGTH = 8;

/** Default ribbon width in world units when {@link ParticleTrailOptions.width} is omitted. */
export const DEFAULT_TRAIL_WIDTH = 0.05;

/** Default minimum distance between consecutive trail samples (world units). */
export const DEFAULT_TRAIL_MIN_DISTANCE = 0;

/** Default width at the tail as a fraction of the head width. */
export const DEFAULT_TRAIL_TAIL_WIDTH_FACTOR = 0;

/**
 * §36 trail options, CPU simulation tier.
 *
 * Omit `trail` entirely (or set `enabled: false`) for no history. GPU
 * simulation refuses trails for the same reason it refuses §27 fields — the
 * device integrator does not mirror history yet.
 */
export interface ParticleTrailOptions {
  /** When `false`, no ring buffer is allocated. Default `true` when `trail` is set. */
  readonly enabled?: boolean;

  /**
   * Number of position samples per particle (≥ 2). Default
   * {@link DEFAULT_TRAIL_LENGTH}.
   */
  readonly length?: number;

  /**
   * Ribbon half-width at the particle head, in world units. When omitted, each
   * segment uses half the particle's current drawn size.
   */
  readonly width?: number;

  /**
   * Minimum distance between consecutive samples. `0` records every step.
   * Default {@link DEFAULT_TRAIL_MIN_DISTANCE}.
   */
  readonly minDistance?: number;

  /**
   * Tail width as a fraction of the head width, in `[0, 1]`. Default
   * {@link DEFAULT_TRAIL_TAIL_WIDTH_FACTOR} (ribbon tapers to zero).
   */
  readonly tailWidthFactor?: number;
}

/**
 * Fixed-capacity ring buffers — one history chain per pool slot.
 *
 * Storage is allocated once in the constructor; {@link pushSample} and
 * {@link copySlot} are the only mutators the emitter calls on the hot path.
 */
export class ParticleTrailStore {
  /** Samples per slot. */
  readonly length: number;

  /** `capacity × length × 3` world-space centres, `xyz` stride 3. */
  readonly positions: Float32Array;

  /** Next write index per slot, in `[0, length)`. */
  readonly head: Uint16Array;

  /** Valid sample count per slot, in `[0, length]`. */
  readonly count: Uint8Array;

  readonly #capacity: number;

  constructor(capacity: number, length: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError(
        `ParticleTrailStore: capacity must be a non-negative safe integer; received ${String(capacity)}`,
      );
    }
    if (!Number.isSafeInteger(length) || length < 2) {
      throw new RangeError(
        `ParticleTrailStore: length must be an integer >= 2; received ${String(length)}`,
      );
    }
    this.#capacity = capacity;
    this.length = length;
    this.positions = new Float32Array(capacity * length * 3);
    this.head = new Uint16Array(capacity);
    this.count = new Uint8Array(capacity);
  }

  /** Clears every slot's history without freeing storage. */
  clear(): void {
    this.head.fill(0);
    this.count.fill(0);
  }

  /** Clears one slot — called from {@link ParticlePool.spawn} via the emitter. */
  resetSlot(index: number): void {
    this.#assertSlot(index, "resetSlot");
    this.head[index] = 0;
    this.count[index] = 0;
  }

  /**
   * Copies slot `from` over slot `to` — the trail mirror of
   * {@link ParticlePool.kill}'s swap-remove.
   */
  copySlot(from: number, to: number): void {
    this.#assertSlot(from, "copySlot");
    this.#assertSlot(to, "copySlot");
    if (from === to) {
      return;
    }
    const samples = this.length;
    const fromBase = from * samples * 3;
    const toBase = to * samples * 3;
    this.positions.copyWithin(toBase, fromBase, fromBase + samples * 3);
    this.head[to] = this.head[from];
    this.count[to] = this.count[from];
  }

  /**
   * Appends `(x, y, z)` when it is far enough from the newest sample.
   *
   * The first sample is always accepted so a freshly spawned particle still
   * produces a degenerate one-point history until it moves.
   */
  pushSample(
    index: number,
    x: number,
    y: number,
    z: number,
    minDistance: number,
  ): void {
    this.#assertSlot(index, "pushSample");
    const existing = this.count[index];
    if (existing > 0 && minDistance > 0) {
      const newest = this.#sampleIndex(index, existing - 1);
      const base = index * this.length * 3 + newest * 3;
      const dx = x - this.positions[base];
      const dy = y - this.positions[base + 1];
      const dz = z - this.positions[base + 2];
      if (dx * dx + dy * dy + dz * dz < minDistance * minDistance) {
        return;
      }
    }

    const head = this.head[index];
    const writeBase = index * this.length * 3 + head * 3;
    this.positions[writeBase] = x;
    this.positions[writeBase + 1] = y;
    this.positions[writeBase + 2] = z;
    this.head[index] = (head + 1) % this.length;
    if (this.count[index] < this.length) {
      this.count[index] = existing + 1;
    }
  }

  /** Valid sample count for a live slot. */
  getSampleCount(index: number): number {
    this.#assertSlot(index, "getSampleCount");
    return this.count[index];
  }

  /** Writes sample `sampleIndex` (0 = oldest) into `out`. */
  readSample(
    index: number,
    sampleIndex: number,
    out: { x: number; y: number; z: number },
  ): void {
    this.#assertSlot(index, "readSample");
    const total = this.count[index];
    if (sampleIndex < 0 || sampleIndex >= total) {
      throw new RangeError(
        `ParticleTrailStore.readSample: sampleIndex ${String(sampleIndex)} out of range (count ${String(total)})`,
      );
    }
    const ringIndex = this.#sampleIndex(index, sampleIndex);
    const base = index * this.length * 3 + ringIndex * 3;
    out.x = this.positions[base];
    out.y = this.positions[base + 1];
    out.z = this.positions[base + 2];
  }

  /** Ring index of the `ordinal`-th oldest sample (`0` = oldest). */
  #sampleIndex(index: number, ordinal: number): number {
    const head = this.head[index];
    const total = this.count[index];
    return (head - total + ordinal + this.length) % this.length;
  }

  #assertSlot(index: number, operation: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.#capacity) {
      throw new RangeError(
        `ParticleTrailStore.${operation}: index ${String(index)} out of range (capacity ${String(this.#capacity)})`,
      );
    }
  }
}

/** Scratch for {@link buildTrailRibbonMesh}. */
const trailScratchA = { x: 0, y: 0, z: 0 };
const trailScratchB = { x: 0, y: 0, z: 0 };
const trailScratchDir = { x: 0, y: 0, z: 0 };
const trailScratchSide = { x: 0, y: 0, z: 0 };

/**
 * Builds one batched ribbon mesh covering every live particle with ≥ 2 samples.
 *
 * Each segment becomes two triangles (six vertices). `out` must hold at least
 * `capacity × (trailLength − 1) × 6 × TRAIL_VERTEX_FLOATS` floats; the return
 * value is how many vertices were written.
 *
 * @param headWidth When ≥ 0, used as half-width at the newest sample; otherwise
 *   half the particle's current size is used.
 */
export function buildTrailRibbonMesh(
  store: ParticleTrailStore,
  aliveCount: number,
  ages: Float32Array,
  lifetimes: Float32Array,
  sizes: Float32Array,
  colors: Float32Array,
  out: Float32Array,
  headWidth: number,
  tailWidthFactor: number,
): number {
  const sizeStride = 2;
  const colorStride = 8;
  let vertex = 0;

  for (let particle = 0; particle < aliveCount; particle += 1) {
    const sampleCount = store.getSampleCount(particle);
    if (sampleCount < 2) {
      continue;
    }

    const lifetime = lifetimes[particle];
    const tNorm = normalizedAge(ages[particle], lifetime);
    const sizeBase = particle * sizeStride;
    const startSize = sizes[sizeBase];
    const particleSize = startSize + (sizes[sizeBase + 1] - startSize) * tNorm;

    const colorBase = particle * colorStride;
    const r0 = colors[colorBase];
    const g0 = colors[colorBase + 1];
    const b0 = colors[colorBase + 2];
    const a0 = colors[colorBase + 3];
    const r1 = colors[colorBase + 4];
    const g1 = colors[colorBase + 5];
    const b1 = colors[colorBase + 6];
    const a1 = colors[colorBase + 7];
    const pr = r0 + (r1 - r0) * tNorm;
    const pg = g0 + (g1 - g0) * tNorm;
    const pb = b0 + (b1 - b0) * tNorm;
    const pa = a0 + (a1 - a0) * tNorm;

    const widthHead =
      headWidth >= 0 ? headWidth : Math.max(particleSize * 0.5, 0.0001);
    const widthTail = widthHead * tailWidthFactor;

    for (let segment = 0; segment < sampleCount - 1; segment += 1) {
      store.readSample(particle, segment, trailScratchA);
      store.readSample(particle, segment + 1, trailScratchB);

      const t0 = segment / (sampleCount - 1);
      const t1 = (segment + 1) / (sampleCount - 1);
      const half0 = (widthHead + (widthTail - widthHead) * t0) * 0.5;
      const half1 = (widthHead + (widthTail - widthHead) * t1) * 0.5;
      const alpha0 = pa * t0;
      const alpha1 = pa * t1;

      ribbonSide(
        trailScratchA,
        trailScratchB,
        half0,
        half1,
        trailScratchDir,
        trailScratchSide,
      );

      writeTrailVertex(
        out,
        vertex,
        trailScratchA.x - trailScratchSide.x,
        trailScratchA.y - trailScratchSide.y,
        trailScratchA.z - trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha0,
      );
      vertex += 1;
      writeTrailVertex(
        out,
        vertex,
        trailScratchA.x + trailScratchSide.x,
        trailScratchA.y + trailScratchSide.y,
        trailScratchA.z + trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha0,
      );
      vertex += 1;
      writeTrailVertex(
        out,
        vertex,
        trailScratchB.x + trailScratchSide.x,
        trailScratchB.y + trailScratchSide.y,
        trailScratchB.z + trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha1,
      );
      vertex += 1;

      writeTrailVertex(
        out,
        vertex,
        trailScratchA.x - trailScratchSide.x,
        trailScratchA.y - trailScratchSide.y,
        trailScratchA.z - trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha0,
      );
      vertex += 1;
      writeTrailVertex(
        out,
        vertex,
        trailScratchB.x + trailScratchSide.x,
        trailScratchB.y + trailScratchSide.y,
        trailScratchB.z + trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha1,
      );
      vertex += 1;
      writeTrailVertex(
        out,
        vertex,
        trailScratchB.x - trailScratchSide.x,
        trailScratchB.y - trailScratchSide.y,
        trailScratchB.z - trailScratchSide.z,
        pr,
        pg,
        pb,
        alpha1,
      );
      vertex += 1;
    }
  }

  return vertex;
}

/** Validates and normalizes {@link ParticleTrailOptions}. */
export function resolveTrailOptions(
  trail: ParticleTrailOptions | undefined,
): ParticleTrailOptions | undefined {
  if (trail === undefined) {
    return undefined;
  }
  if (trail.enabled === false) {
    return undefined;
  }
  const length = trail.length ?? DEFAULT_TRAIL_LENGTH;
  if (!Number.isSafeInteger(length) || length < 2) {
    throw new RangeError(
      `ParticleEmitter: trail.length must be an integer >= 2; received ${String(length)}`,
    );
  }
  const width = trail.width ?? DEFAULT_TRAIL_WIDTH;
  if (!Number.isFinite(width) || width < 0) {
    throw new RangeError(
      `ParticleEmitter: trail.width must be a finite number >= 0; received ${String(width)}`,
    );
  }
  const minDistance = trail.minDistance ?? DEFAULT_TRAIL_MIN_DISTANCE;
  if (!Number.isFinite(minDistance) || minDistance < 0) {
    throw new RangeError(
      `ParticleEmitter: trail.minDistance must be a finite number >= 0; received ${String(minDistance)}`,
    );
  }
  const tailWidthFactor =
    trail.tailWidthFactor ?? DEFAULT_TRAIL_TAIL_WIDTH_FACTOR;
  if (
    !Number.isFinite(tailWidthFactor) ||
    tailWidthFactor < 0 ||
    tailWidthFactor > 1
  ) {
    throw new RangeError(
      `ParticleEmitter: trail.tailWidthFactor must be in [0, 1]; received ${String(tailWidthFactor)}`,
    );
  }
  return {
    enabled: true,
    length,
    width,
    minDistance,
    tailWidthFactor,
  };
}

function normalizedAge(age: number, lifetime: number): number {
  if (!(lifetime > 0)) {
    return 1;
  }
  const t = age / lifetime;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function ribbonSide(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  half0: number,
  half1: number,
  dir: { x: number; y: number; z: number },
  side: { x: number; y: number; z: number },
): void {
  dir.x = b.x - a.x;
  dir.y = b.y - a.y;
  dir.z = b.z - a.z;
  const dirLenSq = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
  if (dirLenSq <= 0) {
    side.x = half0;
    side.y = 0;
    side.z = 0;
    return;
  }
  const invLen = 1 / Math.sqrt(dirLenSq);
  dir.x *= invLen;
  dir.y *= invLen;
  dir.z *= invLen;

  side.x = dir.y * 0 - dir.z * TRAIL_UP_Y;
  side.y = dir.z * 0 - dir.x * 0;
  side.z = dir.x * TRAIL_UP_Y - dir.y * 0;
  let sideLenSq = side.x * side.x + side.y * side.y + side.z * side.z;
  if (sideLenSq <= 1e-12) {
    side.x = 1;
    side.y = 0;
    side.z = 0;
    sideLenSq = 1;
  }
  const half = (half0 + half1) * 0.5;
  const sideScale = half / Math.sqrt(sideLenSq);
  side.x *= sideScale;
  side.y *= sideScale;
  side.z *= sideScale;
}

function writeTrailVertex(
  out: Float32Array,
  vertex: number,
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const base = vertex * TRAIL_VERTEX_FLOATS;
  out[base] = x;
  out[base + 1] = y;
  out[base + 2] = z;
  out[base + 3] = r;
  out[base + 4] = g;
  out[base + 5] = b;
  out[base + 6] = a;
}
