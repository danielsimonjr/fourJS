import {
  MAX_SHADER_STORAGE_COUNT,
  SHADER_VALUE_COMPONENTS,
  type ShaderStorageElementType,
} from "./shader-graph.js";

/**
 * CPU-side data for a read-only storage buffer a node-material graph reads
 * (§82; RFC 0001 addendum, 2026-11-04). The material owns the binding by
 * name (`NodeMaterial.setStorage`); a backend that supports storage buffers
 * uploads `data` whenever {@link version} changes. Plain `Float32Array`
 * storage keeps §7b: updating elements allocates nothing.
 */
export class ShaderStorageBuffer {
  readonly type: ShaderStorageElementType;
  readonly count: number;
  /** `count × components` floats; write in place, then {@link markUpdated}. */
  readonly data: Float32Array;
  /** Bumped by {@link markUpdated}; backends re-upload when it moves. */
  version = 1;
  #disposed = false;

  constructor(type: ShaderStorageElementType, count: number) {
    if (type !== "float" && type !== "vec2" && type !== "vec4") {
      throw new RangeError(
        `ShaderStorageBuffer: element type must be float, vec2 or vec4; got ${JSON.stringify(type)} (§82).`,
      );
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_SHADER_STORAGE_COUNT
    ) {
      throw new RangeError(
        `ShaderStorageBuffer: count must be an integer in [1, ${String(MAX_SHADER_STORAGE_COUNT)}]; got ${String(count)} (§82).`,
      );
    }
    this.type = type;
    this.count = count;
    this.data = new Float32Array(count * SHADER_VALUE_COMPONENTS[type]);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Signals that {@link data} changed. */
  markUpdated(): void {
    this.version += 1;
  }

  /** Marks the buffer unusable; backends release its GPU copy. Idempotent. */
  dispose(): void {
    this.#disposed = true;
  }
}
