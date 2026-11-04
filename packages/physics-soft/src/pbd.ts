/**
 * The CPU position-based-dynamics kernel (RFC 0011 #1-#4, #8).
 *
 * All state lives in typed arrays sized once at construction; `step` allocates
 * nothing (7b). Particles and constraints are processed in index order only (8).
 */

/** A rest layout and the constraint set a descriptor expands to. */
export interface SoftTopology {
  /** Local-space rest positions, xyz triplets. */
  readonly rest: Float64Array;
  /** Constraint endpoints, `a[i]`-`b[i]`. */
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  /** Rest length per constraint. */
  readonly length: Float64Array;
  /** `1` for a stretch constraint, `0` for a bending constraint. */
  readonly stretch: Uint8Array;
  /** Pinned particle indices, ascending. */
  readonly pinned: Uint32Array;
  /** Triangle indices of a closed mesh; present only for a pressure body. */
  readonly triangles?: Uint32Array;
}

/** Per-body numeric tuning, already defaulted. */
export interface PbdTuning {
  substeps: number;
  iterations: number;
  stiffness: number;
  bendingStiffness: number;
  damping: number;
  mass: number;
  /** Target volume as a multiple of the volume at `reset` (default 1). */
  pressure?: number;
  /** Volume-constraint stiffness fraction in [0, 1] (default 1). */
  pressureStiffness?: number;
}

/**
 * Called once per substep after constraint projection and before the velocity
 * update, so it may move `solver.positions` (one-way rigid coupling, RFC 0011 #7).
 */
export type ParticleCollider = (solver: PbdSolver) => void;

/** Signed volume of a closed triangle mesh: `1/6 * sum(p0 . (p1 x p2))`. */
export function signedVolume(
  pos: ArrayLike<number>,
  tris: ArrayLike<number>,
): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    v +=
      pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) +
      pos[a + 1] * (pos[b + 2] * pos[c] - pos[b] * pos[c + 2]) +
      pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

/**
 * Builds the pressure-body topology from a closed triangle mesh: one stretch
 * constraint per unique edge (ascending key order), one bending constraint per
 * adjacent triangle pair (across the hinge), and the triangle list for the
 * volume constraint. @throws Error naming the defect if the mesh is not a
 * closed 2-manifold, an index is out of range, or the volume is degenerate.
 */
export function pressureTopology(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): SoftTopology {
  const n = positions.length / 3;
  const rest = Float64Array.from(positions);
  const edges = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = indices[t + e];
      const j = indices[t + ((e + 1) % 3)];
      const o = indices[t + ((e + 2) % 3)];
      if (!(i < n && j < n && o < n)) {
        throw new Error(`index out of range 0..${n - 1}`);
      }
      if (i === j || j === o || i === o) throw new Error("degenerate triangle");
      const key = Math.min(i, j) * n + Math.max(i, j);
      const list = edges.get(key);
      if (list === undefined) edges.set(key, [o]);
      else list.push(o);
    }
  }
  const keys = [...edges.keys()].sort((x, y) => x - y);
  for (const k of keys) {
    if (edges.get(k)!.length !== 2) throw new Error("mesh is not closed");
  }
  const total = keys.length * 2;
  const a = new Uint32Array(total);
  const b = new Uint32Array(total);
  const len = new Float64Array(total);
  const stretch = new Uint8Array(total);
  const dist = (i: number, j: number): number => {
    const dx = rest[i * 3] - rest[j * 3];
    const dy = rest[i * 3 + 1] - rest[j * 3 + 1];
    const dz = rest[i * 3 + 2] - rest[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  let c = 0;
  for (const key of keys) {
    a[c] = Math.floor(key / n);
    b[c] = key % n;
    len[c] = dist(a[c], b[c]);
    stretch[c++] = 1;
  }
  for (const key of keys) {
    const [o1, o2] = edges.get(key)!;
    a[c] = o1;
    b[c] = o2;
    len[c] = dist(o1, o2);
    stretch[c++] = 0;
  }
  const triangles = Uint32Array.from(indices);
  if (Math.abs(signedVolume(rest, triangles)) < 1e-12) {
    throw new Error("mesh has zero volume");
  }
  return {
    rest,
    a,
    b,
    length: len,
    stretch,
    pinned: new Uint32Array(0),
    triangles,
  };
}

/** Iteration-count-independent stiffness: `1 - (1 - k)^(1/iterations)` (RFC 0011 #3). */
export function effectiveStiffness(k: number, iterations: number): number {
  return 1 - Math.pow(1 - k, 1 / iterations);
}

/** Builds the rope topology: a chain hanging down -Y from the origin. */
export function ropeTopology(
  segments: number,
  length: number,
  pinned: readonly number[],
): SoftTopology {
  const rest = new Float64Array(segments * 3);
  const spacing = length / (segments - 1);
  for (let i = 0; i < segments; i++) rest[i * 3 + 1] = -i * spacing;
  const count = segments - 1 + Math.max(0, segments - 2);
  const a = new Uint32Array(count);
  const b = new Uint32Array(count);
  const len = new Float64Array(count);
  const stretch = new Uint8Array(count);
  let k = 0;
  for (let i = 0; i < segments - 1; i++, k++) {
    a[k] = i;
    b[k] = i + 1;
    len[k] = spacing;
    stretch[k] = 1;
  }
  for (let i = 0; i < segments - 2; i++, k++) {
    a[k] = i;
    b[k] = i + 2;
    len[k] = spacing * 2;
  }
  return { rest, a, b, length: len, stretch, pinned: sortedUnique(pinned) };
}

/** Builds the cloth topology: a grid in the local XZ plane at y = 0, row 0 at -Z/2. */
export function clothTopology(
  columns: number,
  rows: number,
  width: number,
  height: number,
  pinned: readonly number[],
): SoftTopology {
  const rest = new Float64Array(columns * rows * 3);
  const dx = width / (columns - 1);
  const dz = height / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * 3;
      rest[i] = -width / 2 + c * dx;
      rest[i + 2] = -height / 2 + r * dz;
    }
  }
  const edges = (columns - 1) * rows + columns * (rows - 1);
  const diagonals = 2 * (columns - 1) * (rows - 1);
  const total = edges + diagonals;
  const a = new Uint32Array(total);
  const b = new Uint32Array(total);
  const len = new Float64Array(total);
  const stretch = new Uint8Array(total);
  let k = 0;
  const add = (i: number, j: number, isStretch: number): void => {
    a[k] = i;
    b[k] = j;
    const dx = rest[i * 3] - rest[j * 3];
    const dy = rest[i * 3 + 1] - rest[j * 3 + 1];
    const dz = rest[i * 3 + 2] - rest[j * 3 + 2];
    len[k] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    stretch[k] = isStretch;
    k++;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (c < columns - 1) add(i, i + 1, 1);
      if (r < rows - 1) add(i, i + columns, 1);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i = r * columns + c;
      add(i, i + columns + 1, 0);
      add(i + 1, i + columns, 0);
    }
  }
  return { rest, a, b, length: len, stretch, pinned: sortedUnique(pinned) };
}

function sortedUnique(values: readonly number[]): Uint32Array {
  return Uint32Array.from([...new Set(values)].sort((x, y) => x - y));
}

/** Particle state and the PBD loop for one body. */
export class PbdSolver {
  readonly count: number;
  /** Simulation-space (world) positions, previous positions, velocities. */
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly velocities: Float64Array;
  readonly inverseMasses: Float64Array;
  /** Pin targets at the start and end of the current fixed step (xyz per pin). */
  readonly #pinFrom: Float64Array;
  readonly #pinTo: Float64Array;
  readonly #topology: SoftTopology;
  readonly #tuning: PbdTuning;
  readonly #stretchK: number;
  readonly #bendK: number;
  readonly #volumeK: number;
  readonly #grad: Float64Array;
  /** Volume constraint target (signed, world units^3); 0 without a volume. */
  #volumeTarget = 0;
  /** Optional one-way coupling hook, see {@link ParticleCollider}. */
  collider: ParticleCollider | null = null;
  /** Counters the tests spy on. */
  substepsRun = 0;
  iterationsRun = 0;

  constructor(topology: SoftTopology, tuning: PbdTuning) {
    this.#topology = topology;
    this.#tuning = tuning;
    this.count = topology.rest.length / 3;
    this.positions = new Float64Array(topology.rest);
    this.previous = new Float64Array(topology.rest);
    this.velocities = new Float64Array(this.count * 3);
    this.inverseMasses = new Float64Array(this.count).fill(
      this.count / tuning.mass,
    );
    for (const p of topology.pinned) this.inverseMasses[p] = 0;
    this.#pinFrom = new Float64Array(topology.pinned.length * 3);
    this.#pinTo = new Float64Array(topology.pinned.length * 3);
    this.#stretchK = effectiveStiffness(tuning.stiffness, tuning.iterations);
    this.#bendK = effectiveStiffness(
      tuning.bendingStiffness,
      tuning.iterations,
    );
    this.#volumeK = effectiveStiffness(
      tuning.pressureStiffness ?? 1,
      tuning.iterations,
    );
    this.#grad = new Float64Array(
      topology.triangles === undefined ? 0 : this.count * 3,
    );
  }

  /**
   * Overwrites the dynamic state (snapshot restore). Pin targets are the
   * restored positions of the pinned particles, which the last substep left
   * exactly on the end-of-step pin target.
   */
  restoreState(
    positions: ArrayLike<number>,
    previous: ArrayLike<number>,
    velocities: ArrayLike<number>,
  ): void {
    this.positions.set(positions);
    this.previous.set(previous);
    this.velocities.set(velocities);
    const pinned = this.#topology.pinned;
    for (let k = 0; k < pinned.length; k++) {
      for (let c = 0; c < 3; c++) {
        this.#pinTo[k * 3 + c] = this.positions[pinned[k] * 3 + c];
      }
    }
    this.#pinFrom.set(this.#pinTo);
  }

  /** Places every particle at `world * rest` and zeroes the velocities. */
  reset(world: ArrayLike<number>): void {
    const rest = this.#topology.rest;
    for (let i = 0; i < this.count; i++) {
      this.#transformPoint(world, rest, i * 3, this.positions, i * 3);
    }
    this.previous.set(this.positions);
    this.velocities.fill(0);
    const tris = this.#topology.triangles;
    if (tris !== undefined) {
      this.#volumeTarget =
        signedVolume(this.positions, tris) * (this.#tuning.pressure ?? 1);
    }
    this.#capturePins(world, this.#pinTo);
    this.#pinFrom.set(this.#pinTo);
  }

  #transformPoint(
    m: ArrayLike<number>,
    src: Float64Array,
    si: number,
    dst: Float64Array,
    di: number,
  ): void {
    const x = src[si];
    const y = src[si + 1];
    const z = src[si + 2];
    dst[di] = m[0] * x + m[4] * y + m[8] * z + m[12];
    dst[di + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    dst[di + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }

  #capturePins(world: ArrayLike<number>, out: Float64Array): void {
    const pinned = this.#topology.pinned;
    for (let k = 0; k < pinned.length; k++) {
      this.#transformPoint(
        world,
        this.#topology.rest,
        pinned[k] * 3,
        out,
        k * 3,
      );
    }
  }

  /** One fixed step of `dt` seconds under gravity `(gx, gy, gz)`. */
  step(
    dt: number,
    gx: number,
    gy: number,
    gz: number,
    world: ArrayLike<number>,
  ): void {
    const { substeps, iterations, damping } = this.#tuning;
    const h = dt / substeps;
    const damp = Math.exp(-damping * h);
    this.#pinFrom.set(this.#pinTo);
    this.#capturePins(world, this.#pinTo);
    const pos = this.positions;
    const prev = this.previous;
    const vel = this.velocities;
    const w = this.inverseMasses;
    const pinned = this.#topology.pinned;
    for (let s = 0; s < substeps; s++) {
      this.substepsRun++;
      const t = (s + 1) / substeps;
      for (let i = 0; i < this.count; i++) {
        const j = i * 3;
        prev[j] = pos[j]!;
        prev[j + 1] = pos[j + 1]!;
        prev[j + 2] = pos[j + 2]!;
        if (w[i] === 0) continue;
        vel[j] = (vel[j] + gx * h) * damp;
        vel[j + 1] = (vel[j + 1] + gy * h) * damp;
        vel[j + 2] = (vel[j + 2] + gz * h) * damp;
        pos[j] = pos[j] + vel[j] * h;
        pos[j + 1] = pos[j + 1] + vel[j + 1] * h;
        pos[j + 2] = pos[j + 2] + vel[j + 2] * h;
      }
      for (let k = 0; k < pinned.length; k++) {
        const j = pinned[k] * 3;
        const f = this.#pinFrom;
        const g = this.#pinTo;
        // t === 1 lands exactly on the target so a snapshot can recover it.
        pos[j] = t === 1 ? g[k * 3] : f[k * 3] + (g[k * 3] - f[k * 3]) * t;
        pos[j + 1] =
          t === 1
            ? g[k * 3 + 1]
            : f[k * 3 + 1] + (g[k * 3 + 1] - f[k * 3 + 1]) * t;
        pos[j + 2] =
          t === 1
            ? g[k * 3 + 2]
            : f[k * 3 + 2] + (g[k * 3 + 2] - f[k * 3 + 2]) * t;
      }
      for (let it = 0; it < iterations; it++) {
        this.iterationsRun++;
        this.#project();
        if (this.#volumeK > 0 && this.#topology.triangles !== undefined) {
          this.#projectVolume(this.#topology.triangles);
        }
      }
      this.collider?.(this);
      for (let i = 0; i < this.count; i++) {
        if (w[i] === 0) continue;
        const j = i * 3;
        vel[j] = (pos[j] - prev[j]) / h;
        vel[j + 1] = (pos[j + 1] - prev[j + 1]) / h;
        vel[j + 2] = (pos[j + 2] - prev[j + 2]) / h;
      }
    }
  }

  #project(): void {
    const { a, b, length, stretch } = this.#topology;
    const pos = this.positions;
    const w = this.inverseMasses;
    for (let c = 0; c < a.length; c++) {
      const i = a[c];
      const k = b[c];
      const wsum = w[i] + w[k];
      if (wsum === 0) continue;
      const ia = i * 3;
      const ib = k * 3;
      const dx = pos[ia] - pos[ib];
      const dy = pos[ia + 1] - pos[ib + 1];
      const dz = pos[ia + 2] - pos[ib + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-12) continue;
      const stiff = stretch[c] === 1 ? this.#stretchK : this.#bendK;
      const s = ((d - length[c]) / d / wsum) * stiff;
      const sa = s * w[i];
      const sb = s * w[k];
      pos[ia] = pos[ia] - dx * sa;
      pos[ia + 1] = pos[ia + 1] - dy * sa;
      pos[ia + 2] = pos[ia + 2] - dz * sa;
      pos[ib] = pos[ib] + dx * sb;
      pos[ib + 1] = pos[ib + 1] + dy * sb;
      pos[ib + 2] = pos[ib + 2] + dz * sb;
    }
  }

  /**
   * Volume constraint (Mueller et al., PBD): `C = V - Vtarget`, gradient per
   * vertex from the adjacent faces (`d V / d p0 = (p1 x p2) / 6`, cyclic),
   * mass-weighted correction `lambda = -C / sum(w |grad|^2)`. Triangles and
   * vertices are visited in index order. Orientation-independent: the signed
   * target carries the sign of the rest volume.
   */
  #projectVolume(tris: Uint32Array): void {
    const pos = this.positions;
    const w = this.inverseMasses;
    const g = this.#grad;
    g.fill(0);
    let v = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3;
      const b = tris[t + 1] * 3;
      const c = tris[t + 2] * 3;
      const bcx = pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1];
      const bcy = pos[b + 2] * pos[c] - pos[b] * pos[c + 2];
      const bcz = pos[b] * pos[c + 1] - pos[b + 1] * pos[c];
      v += (pos[a] * bcx + pos[a + 1] * bcy + pos[a + 2] * bcz) / 6;
      g[a] += bcx / 6;
      g[a + 1] += bcy / 6;
      g[a + 2] += bcz / 6;
      g[b] += (pos[c + 1] * pos[a + 2] - pos[c + 2] * pos[a + 1]) / 6;
      g[b + 1] += (pos[c + 2] * pos[a] - pos[c] * pos[a + 2]) / 6;
      g[b + 2] += (pos[c] * pos[a + 1] - pos[c + 1] * pos[a]) / 6;
      g[c] += (pos[a + 1] * pos[b + 2] - pos[a + 2] * pos[b + 1]) / 6;
      g[c + 1] += (pos[a + 2] * pos[b] - pos[a] * pos[b + 2]) / 6;
      g[c + 2] += (pos[a] * pos[b + 1] - pos[a + 1] * pos[b]) / 6;
    }
    let denom = 0;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      denom += w[i] * (g[j] * g[j] + g[j + 1] * g[j + 1] + g[j + 2] * g[j + 2]);
    }
    if (denom < 1e-18) return;
    const lambda = (-(v - this.#volumeTarget) / denom) * this.#volumeK;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const s = lambda * w[i];
      pos[j] += s * g[j];
      pos[j + 1] += s * g[j + 1];
      pos[j + 2] += s * g[j + 2];
    }
  }

  /** Current signed volume of a pressure body (`0` for rope and cloth). */
  volume(): number {
    const t = this.#topology.triangles;
    return t === undefined ? 0 : signedVolume(this.positions, t);
  }

  /** The signed volume the constraint is holding (`0` for rope and cloth). */
  get targetVolume(): number {
    return this.#volumeTarget;
  }

  /** Total kinetic energy, joules (for tests and diagnostics). */
  kineticEnergy(): number {
    const m = this.#tuning.mass / this.count;
    let e = 0;
    for (let i = 0; i < this.velocities.length; i++) {
      e += 0.5 * m * this.velocities[i] * this.velocities[i];
    }
    return e;
  }
}

function accumulate(
  n: Float32Array,
  v: number,
  x: number,
  y: number,
  z: number,
): void {
  n[v] = n[v] + x;
  n[v + 1] = n[v + 1] + y;
  n[v + 2] = n[v + 2] + z;
}

/** Area-weighted vertex normals into `normals` (no allocation). */
export function computeNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  normals: Float32Array,
): void {
  normals.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t] * 3;
    const j = indices[t + 1] * 3;
    const k = indices[t + 2] * 3;
    const ux = positions[j] - positions[i];
    const uy = positions[j + 1] - positions[i + 1];
    const uz = positions[j + 2] - positions[i + 2];
    const vx = positions[k] - positions[i];
    const vy = positions[k + 1] - positions[i + 1];
    const vz = positions[k + 2] - positions[i + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    accumulate(normals, i, nx, ny, nz);
    accumulate(normals, j, nx, ny, nz);
    accumulate(normals, k, nx, ny, nz);
  }
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v];
    const y = normals[v + 1];
    const z = normals[v + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 0) {
      normals[v] = x / l;
      normals[v + 1] = y / l;
      normals[v + 2] = z / l;
    } else {
      normals[v + 1] = 1;
    }
  }
}
