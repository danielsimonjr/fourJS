/**
 * Soft bodies (RFC 0011, §35/§35a): the `SoftBody` component and the
 * `SoftBodySystem` that will drive it. This is the design skeleton: the
 * component validates and attaches, the system refuses to step.
 */
import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { BufferGeometry } from "@fourjs/geometry";
import { Matrix4 } from "@fourjs/math";
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
  ropeTopology,
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
  }
}

/** Particle count a descriptor will simulate. */
function particleCountOf(d: SoftBodyDescriptor): number {
  if (d.kind === "rope") return d.segments;
  if (d.kind === "cloth") return d.columns * d.rows;
  return d.positions.length / 3;
}

function topologyOf(d: RopeDescriptor | ClothDescriptor): SoftTopology {
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
  if (d.kind === "pressure" || topology === null) {
    const p = d as PressureDescriptor;
    return new BufferGeometry({
      positions: Float32Array.from(p.positions),
      indices: Uint32Array.from(p.indices),
    });
  }
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

  /** The PBD solver; `null` for a (not yet implemented) pressure body. */
  readonly solver: PbdSolver | null;

  constructor(descriptor: SoftBodyDescriptor) {
    validate(descriptor);
    this.descriptor = descriptor;
    this.particleCount = particleCountOf(descriptor);
    const topology =
      descriptor.kind === "pressure" ? null : topologyOf(descriptor);
    this.#geometry = buildGeometry(descriptor, this.particleCount, topology);
    this.solver =
      topology === null
        ? null
        : new PbdSolver(topology, {
            substeps: descriptor.substeps ?? 4,
            iterations: descriptor.iterations ?? 4,
            stiffness: descriptor.stiffness ?? 1,
            bendingStiffness: descriptor.bendingStiffness ?? 0.1,
            damping: descriptor.damping ?? 0.1,
            mass: descriptor.mass ?? 1,
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

/** Options for {@link SoftBodySystem}. */
export interface SoftBodySystemOptions {
  /** Execution order key (default {@link PRIORITY_SOFT_BODY}). */
  priority?: number;
  /** Take gravity from this rigid world, read live each step. Wins over `gravity`. */
  world?: GravitySource;
  /** Gravity in m/s^2 when no world is given (default `(0, -9.81, 0)`). */
  gravity?: { readonly x: number; readonly y: number; readonly z: number };
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
  readonly #world: GravitySource | undefined;
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
    this.#gravity = options.gravity ?? DEFAULT_GRAVITY;
  }

  /** Tracked bodies, in step order. */
  get bodies(): readonly SoftBody[] {
    return this.#bodies;
  }

  /**
   * Starts stepping `body` and places its particles at the node's current world
   * pose. @throws FourError for a pressure body (W10.3) or a double track.
   */
  track(body: SoftBody): SoftBody {
    if (body.solver === null) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        "SoftBody pressure descriptors are not implemented yet (RFC 0011, packet W10.3).",
      );
    }
    if (this.#bodies.includes(body)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "SoftBody is already tracked by this SoftBodySystem.",
      );
    }
    body.solver.reset(this.#worldOf(body).elements);
    this.#bodies.push(body);
    return body;
  }

  /** Stops stepping `body`; returns whether it was tracked. */
  untrack(body: SoftBody): boolean {
    const i = this.#bodies.indexOf(body);
    if (i < 0) return false;
    this.#bodies.splice(i, 1);
    return true;
  }

  initialize(_context: SimulationContext): void {}

  fixedUpdate(context: FixedUpdateContext): void {
    const dt = context.time.fixedDeltaTime;
    const g = this.#world?.gravity ?? this.#gravity;
    for (let n = 0; n < this.#bodies.length; n++) {
      const body = this.#bodies[n];
      const solver = body.solver!;
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
