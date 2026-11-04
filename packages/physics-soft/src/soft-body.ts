/**
 * Soft bodies (RFC 0011, §35/§35a): the `SoftBody` component and the
 * `SoftBodySystem` that will drive it. This is the design skeleton: the
 * component validates and attaches, the system refuses to step.
 */
import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { BufferGeometry } from "@fourjs/geometry";
import { Matrix4, Vector3 } from "@fourjs/math";
import { Node, resolveWorldTransform } from "@fourjs/scene";
import {
  PRIORITY_PHYSICS_SOLVE,
  type FixedUpdateContext,
  type SimulationContext,
  type SimulationSystem,
} from "@fourjs/motion";

import {
  PbdSolver,
  clothTopology,
  computeNormals,
  pressureTopology,
  ropeTopology,
  type ParticleCollider,
  type PbdSolver as PbdSolverType,
  type SoftTopology,
} from "./pbd.js";

/** Priority of {@link SoftBodySystem}: just after the rigid solve (RFC 0011 #5). */
export const PRIORITY_SOFT_BODY = PRIORITY_PHYSICS_SOLVE + 10;

/** Solver tuning shared by every descriptor. */
export interface SoftBodyTuning {
  /** Substeps per fixed step (integer >= 1, default 4). */
  substeps?: number;
  /** Constraint-projection iterations per substep (integer >= 1, default 4). */
  iterations?: number;
  /** Stretch stiffness fraction in [0, 1] (default 1). */
  stiffness?: number;
  /** Bending stiffness fraction in [0, 1] (default 0.1). */
  bendingStiffness?: number;
  /** Velocity damping per second, >= 0 (default 0.1). */
  damping?: number;
  /** Total mass in kilograms, > 0 (default 1). */
  mass?: number;
}

/** A chain of particles. */
export interface RopeDescriptor extends SoftBodyTuning {
  kind: "rope";
  /** Particle count (integer >= 2). */
  segments: number;
  /** Rest length in metres, > 0. */
  length: number;
  /** Indices of particles pinned to the node transform (default `[0]`, the top end). */
  pinned?: readonly number[];
}

/** A rows x columns particle grid. */
export interface ClothDescriptor extends SoftBodyTuning {
  kind: "cloth";
  /** Integer >= 2. */
  columns: number;
  /** Integer >= 2. */
  rows: number;
  /** Width in metres, > 0. */
  width: number;
  /** Height in metres, > 0. */
  height: number;
  /** Indices of particles pinned to the node transform. */
  pinned?: readonly number[];
}

/** A closed triangle mesh kept at a target volume. */
export interface PressureDescriptor extends SoftBodyTuning {
  kind: "pressure";
  positions: Float32Array;
  indices: Uint32Array;
  /** Target volume as a multiple of the rest volume, > 0 (default 1). */
  pressure?: number;
  /** Volume-constraint stiffness fraction in [0, 1] (default 1). */
  pressureStiffness?: number;
}

export type SoftBodyDescriptor =
  RopeDescriptor | ClothDescriptor | PressureDescriptor;

function fail(message: string): never {
  throw new FourError("INVALID_APPLICATION_STATE", `SoftBody: ${message}`);
}

function positiveInt(name: string, v: number, min: number): void {
  if (!Number.isInteger(v) || v < min) {
    fail(`${name} must be an integer >= ${min}, got ${v}`);
  }
}

function positive(name: string, v: number): void {
  if (!(v > 0) || !Number.isFinite(v)) {
    fail(`${name} must be a finite number > 0, got ${v}`);
  }
}

function fraction(name: string, v: number): void {
  if (!(v >= 0 && v <= 1)) {
    fail(`${name} must be in [0, 1], got ${v}`);
  }
}

function validate(d: SoftBodyDescriptor): void {
  positiveInt("substeps", d.substeps ?? 4, 1);
  positiveInt("iterations", d.iterations ?? 4, 1);
  fraction("stiffness", d.stiffness ?? 1);
  fraction("bendingStiffness", d.bendingStiffness ?? 0.1);
  const damping = d.damping ?? 0.1;
  if (!(damping >= 0) || !Number.isFinite(damping)) {
    fail(`damping must be a finite number >= 0, got ${damping}`);
  }
  positive("mass", d.mass ?? 1);
  if (d.kind === "rope") {
    positiveInt("segments", d.segments, 2);
    positive("length", d.length);
    for (const i of d.pinned ?? [0]) {
      if (!Number.isInteger(i) || i < 0 || i >= d.segments) {
        fail(`pinned index ${i} is outside 0..${d.segments - 1}`);
      }
    }
  } else if (d.kind === "cloth") {
    positiveInt("columns", d.columns, 2);
    positiveInt("rows", d.rows, 2);
    positive("width", d.width);
    positive("height", d.height);
    const count = d.columns * d.rows;
    for (const i of d.pinned ?? []) {
      if (!Number.isInteger(i) || i < 0 || i >= count) {
        fail(`pinned index ${i} is outside 0..${count - 1}`);
      }
    }
  } else {
    if (d.positions.length < 9 || d.positions.length % 3 !== 0) {
      fail("positions must hold at least 3 vertices (x, y, z each)");
    }
    if (d.indices.length < 3 || d.indices.length % 3 !== 0) {
      fail("indices must be a non-empty multiple of 3");
    }
    positive("pressure", d.pressure ?? 1);
    fraction("pressureStiffness", d.pressureStiffness ?? 1);
  }
}

/** Particle count a descriptor will simulate. */
function particleCountOf(d: SoftBodyDescriptor): number {
  if (d.kind === "rope") return d.segments;
  if (d.kind === "cloth") return d.columns * d.rows;
  return d.positions.length / 3;
}

function topologyOf(d: SoftBodyDescriptor): SoftTopology {
  if (d.kind === "pressure") {
    try {
      return pressureTopology(d.positions, d.indices);
    } catch (e) {
      return fail(`pressure mesh: ${(e as Error).message}`);
    }
  }
  return d.kind === "rope"
    ? ropeTopology(d.segments, d.length, d.pinned ?? [0])
    : clothTopology(d.columns, d.rows, d.width, d.height, d.pinned ?? []);
}

/** Rest geometry: line strip for ropes, triangle grid for cloth, the mesh itself for pressure. */
function buildGeometry(
  d: SoftBodyDescriptor,
  count: number,
  topology: SoftTopology | null,
): BufferGeometry {
  if (d.kind === "pressure") {
    const positions = Float32Array.from(d.positions);
    const indices = Uint32Array.from(d.indices);
    const normals = new Float32Array(count * 3);
    computeNormals(positions, indices, normals);
    return new BufferGeometry({ positions, normals, indices });
  }
  if (topology === null) return fail("missing topology");
  const positions = Float32Array.from(topology.rest);
  if (d.kind === "rope") {
    const indices = new Uint32Array((count - 1) * 2);
    for (let i = 0; i < count - 1; i++) {
      indices[i * 2] = i;
      indices[i * 2 + 1] = i + 1;
    }
    return new BufferGeometry({ positions, indices, mode: "lines" });
  }
  const indices = new Uint32Array((d.columns - 1) * (d.rows - 1) * 6);
  let k = 0;
  for (let y = 0; y < d.rows - 1; y++) {
    for (let x = 0; x < d.columns - 1; x++) {
      const i = y * d.columns + x;
      indices.set(
        [i, i + d.columns, i + 1, i + 1, i + d.columns, i + d.columns + 1],
        k,
      );
      k += 6;
    }
  }
  const normals = new Float32Array(count * 3);
  computeNormals(positions, indices, normals);
  return new BufferGeometry({ positions, normals, indices });
}

/**
 * A soft body (RFC 0011): one per node (§6a). Under §42 the `"physics"` owner
 * holds its vertex positions, which live in {@link SoftBody.geometry}; the node
 * transform is untouched.
 */
export class SoftBody implements Component {
  /** Component key (§6a) and §79 serialization name. */
  static readonly typeName = "soft-body";

  /** Written by the component registry alone (§6a). */
  host: ComponentHost | null = null;

  /** The validated descriptor. */
  readonly descriptor: Readonly<SoftBodyDescriptor>;

  /** Number of simulated particles. */
  readonly particleCount: number;

  readonly #geometry: BufferGeometry;

  /** The PBD solver (every descriptor kind). */
  readonly solver: PbdSolver;

  constructor(descriptor: SoftBodyDescriptor) {
    validate(descriptor);
    this.descriptor = descriptor;
    this.particleCount = particleCountOf(descriptor);
    const topology = topologyOf(descriptor);
    this.#geometry = buildGeometry(descriptor, this.particleCount, topology);
    this.solver = new PbdSolver(topology, {
      substeps: descriptor.substeps ?? 4,
      iterations: descriptor.iterations ?? 4,
      stiffness: descriptor.stiffness ?? 1,
      bendingStiffness: descriptor.bendingStiffness ?? 0.1,
      damping: descriptor.damping ?? 0.1,
      mass: descriptor.mass ?? 1,
      ...(descriptor.kind === "pressure"
        ? {
            pressure: descriptor.pressure ?? 1,
            pressureStiffness: descriptor.pressureStiffness ?? 1,
          }
        : {}),
    });
  }

  /** The dynamic geometry the system writes each step. */
  get geometry(): BufferGeometry {
    return this.#geometry;
  }

  dispose(): void {
    this.#geometry.dispose();
  }
}

/** Anything that exposes a gravity vector, e.g. a `PhysicsWorld`. */
export interface GravitySource {
  readonly gravity: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

/** A ray query as {@link SoftCollisionWorld} receives it (a subset of §30 `RaycastQuery`). */
export interface SoftRaycastQuery {
  origin: Vector3;
  direction: Vector3;
  maxDistance: number;
  mode: "first";
}

/** A ray hit as {@link SoftCollisionWorld} reads it (a subset of §30 `WorldRaycastHit`). */
export interface SoftRaycastHit {
  readonly point: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly normal: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly distance: number;
}

/**
 * The §30 query surface soft bodies collide against: structurally a
 * `PhysicsWorld` (its `raycast`), or any fake with a `raycast`.
 *
 * Coupling is raycast-only. §30 point and overlap queries return no surface
 * normal or penetration depth for a point inside a collider, so a particle is
 * tested by a short ray from its position before the substep to its position
 * after, extended by {@link SoftBodySystemOptions.particleRadius}. Limit: a
 * particle that begins a substep already inside a collider (e.g. a collider
 * teleported onto it) is not detected and is not pushed out; it escapes only
 * once the ray finds a surface ahead of it. Colliders are solid whether their
 * body sleeps or not, and nothing is applied back to the rigid world.
 * Allocation note: a real `PhysicsWorld.raycast` allocates its result array;
 * the coupling itself allocates nothing beyond what the world returns.
 */
export interface SoftCollisionWorld {
  raycast(query: SoftRaycastQuery): readonly SoftRaycastHit[];
}

/** Options for {@link SoftBodySystem}. */
export interface SoftBodySystemOptions {
  /** Execution order key (default {@link PRIORITY_SOFT_BODY}). */
  priority?: number;
  /** Take gravity from this rigid world, read live each step. Wins over `gravity`. */
  world?: GravitySource | (GravitySource & SoftCollisionWorld);
  /** Gravity in m/s^2 when no world is given (default `(0, -9.81, 0)`). */
  gravity?: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Particle contact thickness in metres (default 0.01): particles rest this far
   * above a collider surface. Only used when `world` has a `raycast`.
   */
  particleRadius?: number;
}

/** The §34-style snapshot of one soft body (RFC 0011 #9). */
export interface SoftBodySnapshotEntry {
  /** Node id; bodies with no node host use their track index as a string. */
  readonly id: string;
  readonly kind: SoftBodyDescriptor["kind"];
  readonly particleCount: number;
  /** Exact float64 bits. */
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly velocities: Float64Array;
}

/** Envelope of {@link SoftBodySystem.createSnapshot}. */
export interface SoftBodySnapshot {
  readonly version: 1;
  readonly kind: "soft-bodies";
  readonly bodies: readonly SoftBodySnapshotEntry[];
}

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const TWO_POW_32 = 4294967296;

function absorbWord(state: number, word: number): number {
  const w = word >>> 0;
  let h = state;
  h = Math.imul(h ^ (w & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 24) & 0xff), FNV_PRIME) >>> 0;
  return h;
}

/**
 * Absorbs one float as its 1e-6-quantized low then high uint32 word. This is
 * `PhysicsWorld.checksum`'s and `@fourjs/diagnostics`'s `hashFloats` encoding
 * (D6); re-implemented because the dependency matrix excludes diagnostics.
 */
function absorbFloat(state: number, x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`Checksum inputs must be finite numbers, got ${x}`);
  }
  const q = Math.round((x === 0 ? 0 : x) * 1e6);
  let low = q % TWO_POW_32;
  if (low < 0) low += TWO_POW_32;
  const high = (q - low) / TWO_POW_32;
  return absorbWord(absorbWord(state, low), high);
}

/** Default gravity, m/s^2 (Appendix A). */
const DEFAULT_GRAVITY = { x: 0, y: -9.81, z: 0 } as const;

/**
 * The fixed-step system that advances every tracked {@link SoftBody} (RFC 0011
 * #5): substep delta `fixedDeltaTime / substeps`, bodies in tracking order.
 */
export class SoftBodySystem implements SimulationSystem {
  priority: number;

  readonly #bodies: SoftBody[] = [];
  readonly #world: (GravitySource & Partial<SoftCollisionWorld>) | undefined;
  readonly #radius: number;
  readonly #query: SoftRaycastQuery = {
    origin: new Vector3(),
    direction: new Vector3(),
    maxDistance: 0,
    mode: "first",
  };
  readonly #gravity: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** Scratch, allocated once: identity fallback and inverse world matrix. */
  readonly #identity = new Matrix4();
  readonly #inverse = new Matrix4();

  constructor(options: SoftBodySystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_SOFT_BODY;
    this.#world = options.world;
    this.#radius = options.particleRadius ?? 0.01;
    if (!(this.#radius >= 0) || !Number.isFinite(this.#radius)) {
      fail(`particleRadius must be a finite number >= 0, got ${this.#radius}`);
    }
    this.#gravity = options.gravity ?? DEFAULT_GRAVITY;
  }

  /** Tracked bodies, in step order. */
  get bodies(): readonly SoftBody[] {
    return this.#bodies;
  }

  /**
   * Starts stepping `body` and places its particles at the node's current world
   * pose (a pressure body captures its target volume here). @throws FourError
   * for a double track.
   */
  track(body: SoftBody): SoftBody {
    if (this.#bodies.includes(body)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "SoftBody is already tracked by this SoftBodySystem.",
      );
    }
    body.solver.reset(this.#worldOf(body).elements);
    const world = this.#world;
    if (world?.raycast !== undefined) {
      body.solver.collider = this.#collide;
    }
    this.#bodies.push(body);
    return body;
  }

  /** Stops stepping `body`; returns whether it was tracked. */
  untrack(body: SoftBody): boolean {
    const i = this.#bodies.indexOf(body);
    if (i < 0) return false;
    this.#bodies.splice(i, 1);
    body.solver.collider = null;
    return true;
  }

  /**
   * One-way rigid coupling for one substep (RFC 0011 #7): for each free
   * particle, cast a ray from its pre-substep position along its displacement,
   * long enough to reach `particleRadius` past the new position. If the surface
   * is nearer than the radius to the new position, the particle is projected
   * onto the plane `surface + normal * radius`: friction-less, so the tangential
   * part of its motion is kept and only the normal part is removed. Velocity
   * follows from the position change in the solver's velocity update, so
   * contact kills inward speed; nothing is applied to the rigid body.
   */
  readonly #collide: ParticleCollider = (solver: PbdSolverType): void => {
    const world = this.#world!;
    const q = this.#query;
    const pos = solver.positions;
    const prev = solver.previous;
    const w = solver.inverseMasses;
    const r = this.#radius;
    for (let i = 0; i < solver.count; i++) {
      if (w[i] === 0) continue;
      const j = i * 3;
      const dx = pos[j] - prev[j];
      const dy = pos[j + 1] - prev[j + 1];
      const dz = pos[j + 2] - prev[j + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-12) continue;
      q.origin.set(prev[j], prev[j + 1], prev[j + 2]);
      q.direction.set(dx / d, dy / d, dz / d);
      q.maxDistance = d + r;
      const hits = world.raycast!(q);
      if (hits.length === 0) continue;
      const h = hits[0];
      const nx = h.normal.x;
      const ny = h.normal.y;
      const nz = h.normal.z;
      const s =
        (pos[j] - h.point.x) * nx +
        (pos[j + 1] - h.point.y) * ny +
        (pos[j + 2] - h.point.z) * nz;
      if (s >= r) continue;
      const push = r - s;
      pos[j] += nx * push;
      pos[j + 1] += ny * push;
      pos[j + 2] += nz * push;
    }
  };

  #idOf(body: SoftBody, index: number): string {
    const host = body.host;
    return host instanceof Node ? host.id : String(index);
  }

  /**
   * Captures every tracked body (RFC 0011 #9): `{ version: 1, kind, bodies }`,
   * exact float64 copies in track order, keyed by node id.
   */
  createSnapshot(): SoftBodySnapshot {
    return {
      version: 1,
      kind: "soft-bodies",
      bodies: this.#bodies.map((b, n) => ({
        id: this.#idOf(b, n),
        kind: b.descriptor.kind,
        particleCount: b.particleCount,
        positions: Float64Array.from(b.solver.positions),
        previous: Float64Array.from(b.solver.previous),
        velocities: Float64Array.from(b.solver.velocities),
      })),
    };
  }

  /**
   * Restores a snapshot onto the currently tracked bodies and republishes their
   * geometry. Stepping afterwards is bit-identical to having stepped on from
   * the snapshot instant provided the node transforms are unchanged (pin
   * targets are recovered from the restored pinned positions).
   * @throws FourError on a version, kind, body-count, id, descriptor-kind or
   * particle-count mismatch; nothing is modified in that case.
   */
  restoreSnapshot(snapshot: SoftBodySnapshot): void {
    if (snapshot.version !== 1 || snapshot.kind !== "soft-bodies") {
      fail(
        `snapshot is ${String(snapshot.kind)} v${String(snapshot.version)}, expected soft-bodies v1`,
      );
    }
    if (snapshot.bodies.length !== this.#bodies.length) {
      fail(
        `snapshot holds ${snapshot.bodies.length} bodies, system tracks ${this.#bodies.length}`,
      );
    }
    for (let n = 0; n < this.#bodies.length; n++) {
      const b = this.#bodies[n];
      const e = snapshot.bodies[n];
      if (e.id !== this.#idOf(b, n) || e.kind !== b.descriptor.kind) {
        fail(
          `snapshot body ${n} (${e.id}, ${e.kind}) does not match the tracked body`,
        );
      }
      const len = b.particleCount * 3;
      if (
        e.particleCount !== b.particleCount ||
        e.positions.length !== len ||
        e.previous.length !== len ||
        e.velocities.length !== len
      ) {
        fail(`snapshot body ${e.id} has a different particle count`);
      }
    }
    for (let n = 0; n < this.#bodies.length; n++) {
      const b = this.#bodies[n];
      const e = snapshot.bodies[n];
      b.solver.restoreState(e.positions, e.previous, e.velocities);
      this.#inverse.copy(this.#worldOf(b)).invert();
      this.#publish(b, b.solver, this.#inverse.elements);
    }
  }

  /**
   * FNV-1a checksum (uint32) over every tracked body's positions, previous
   * positions and velocities, in track order, quantized to 1e-6 like
   * `PhysicsWorld.checksum`. Allocates nothing.
   */
  checksum(): number {
    let state = FNV_OFFSET_BASIS >>> 0;
    for (const b of this.#bodies) {
      const s = b.solver;
      for (let i = 0; i < s.positions.length; i++) {
        state = absorbFloat(state, s.positions[i]);
      }
      for (let i = 0; i < s.previous.length; i++) {
        state = absorbFloat(state, s.previous[i]);
      }
      for (let i = 0; i < s.velocities.length; i++) {
        state = absorbFloat(state, s.velocities[i]);
      }
    }
    return state >>> 0;
  }

  initialize(_context: SimulationContext): void {}

  fixedUpdate(context: FixedUpdateContext): void {
    const dt = context.time.fixedDeltaTime;
    const g = this.#world?.gravity ?? this.#gravity;
    for (let n = 0; n < this.#bodies.length; n++) {
      const body = this.#bodies[n];
      const solver = body.solver;
      const world = this.#worldOf(body);
      solver.step(dt, g.x, g.y, g.z, world.elements);
      this.#inverse.copy(world).invert();
      this.#publish(body, solver, this.#inverse.elements);
    }
  }

  /** Writes particles (node-local, Float32) into the geometry, then marks it dirty once. */
  #publish(body: SoftBody, solver: PbdSolver, inv: Float64Array): void {
    const geometry = body.geometry;
    const out = geometry.positions;
    const p = solver.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      out[i] = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
      out[i + 1] = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
      out[i + 2] = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
    }
    const normals = geometry.normals;
    if (normals !== undefined && geometry.indices !== undefined) {
      computeNormals(out, geometry.indices, normals);
    }
    geometry.markDirty();
  }

  #worldOf(body: SoftBody): Matrix4 {
    const host = body.host;
    return host instanceof Node ? resolveWorldTransform(host) : this.#identity;
  }

  dispose(): void {
    this.#bodies.length = 0;
  }
}
