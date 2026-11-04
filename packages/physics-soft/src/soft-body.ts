/**
 * Soft bodies (RFC 0011, §35/§35a): the `SoftBody` component and the
 * `SoftBodySystem` that will drive it. This is the design skeleton: the
 * component validates and attaches, the system refuses to step.
 */
import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { BufferGeometry } from "@fourjs/geometry";
import {
  PRIORITY_PHYSICS_SOLVE,
  type FixedUpdateContext,
  type SimulationContext,
  type SimulationSystem,
} from "@fourjs/motion";

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

/** Rest geometry: line strip for ropes, triangle grid for cloth, the mesh itself for pressure. */
function buildGeometry(d: SoftBodyDescriptor, count: number): BufferGeometry {
  if (d.kind === "pressure") {
    return new BufferGeometry({
      positions: Float32Array.from(d.positions),
      indices: Uint32Array.from(d.indices),
    });
  }
  const positions = new Float32Array(count * 3);
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
  return new BufferGeometry({ positions, indices });
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

  constructor(descriptor: SoftBodyDescriptor) {
    validate(descriptor);
    this.descriptor = descriptor;
    this.particleCount = particleCountOf(descriptor);
    this.#geometry = buildGeometry(descriptor, this.particleCount);
  }

  /** The dynamic geometry the system writes each step. */
  get geometry(): BufferGeometry {
    return this.#geometry;
  }

  dispose(): void {
    this.#geometry.dispose();
  }
}

/** The fixed-step system that will advance every {@link SoftBody} (RFC 0011). */
export class SoftBodySystem implements SimulationSystem {
  priority = PRIORITY_SOFT_BODY;

  initialize(_context: SimulationContext): void {}

  fixedUpdate(_context: FixedUpdateContext): void {
    throw new FourError(
      "NOT_IMPLEMENTED",
      "SoftBodySystem.fixedUpdate is not implemented yet (RFC 0011, packet W10.2).",
    );
  }

  dispose(): void {}
}
