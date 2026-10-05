import { describe, expect, it } from "vitest";

import { GeometryCache, type CacheableGeometry } from "../src/gl-geometry.js";
import {
  GL,
  type GlBuffer,
  type GlVertexArray,
  type WebglContext,
} from "../src/gl-program.js";

/** A stateful geometry-only GL seam: uploads are associated with real bindings. */
function geometryContext() {
  const calls: string[] = [];
  const buffers = new Map<GlBuffer, Uint8Array>();
  const vaos = new Map<
    GlVertexArray | null,
    {
      index: GlBuffer | null;
      attributes: Map<number, GlBuffer | null>;
    }
  >();
  vaos.set(null, { index: null, attributes: new Map() });
  let vao: GlVertexArray | null = null;
  let array: GlBuffer | null = null;
  const control = { failBuffer: false };
  const state = () => vaos.get(vao)!;
  const gl = {
    createVertexArray() {
      calls.push("createVertexArray");
      const handle = {};
      vaos.set(handle, { index: null, attributes: new Map() });
      return handle;
    },
    createBuffer() {
      calls.push("createBuffer");
      if (control.failBuffer) return null;
      const handle = {};
      buffers.set(handle, new Uint8Array());
      return handle;
    },
    bindVertexArray(handle: GlVertexArray | null) {
      calls.push("bindVertexArray");
      vao = handle;
      expect(vaos.has(handle)).toBe(true);
    },
    bindBuffer(target: number, handle: GlBuffer | null) {
      calls.push("bindBuffer");
      if (target === GL.ARRAY_BUFFER) array = handle;
      else state().index = handle;
    },
    bufferData(target: number, data: ArrayBufferView) {
      calls.push("bufferData");
      const handle = target === GL.ARRAY_BUFFER ? array : state().index;
      expect(handle).not.toBeNull();
      expect(buffers.has(handle!)).toBe(true);
      buffers.set(
        handle!,
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(),
      );
    },
    enableVertexAttribArray() {
      calls.push("enableVertexAttribArray");
    },
    vertexAttribPointer(slot: number) {
      calls.push("vertexAttribPointer");
      state().attributes.set(slot, array);
    },
    deleteVertexArray(handle: GlVertexArray) {
      calls.push("deleteVertexArray");
      expect(vaos.delete(handle)).toBe(true);
    },
    deleteBuffer(handle: GlBuffer) {
      calls.push("deleteBuffer");
      expect(buffers.delete(handle)).toBe(true);
    },
  } satisfies Pick<
    WebglContext,
    | "createVertexArray"
    | "createBuffer"
    | "bindVertexArray"
    | "bindBuffer"
    | "bufferData"
    | "enableVertexAttribArray"
    | "vertexAttribPointer"
    | "deleteVertexArray"
    | "deleteBuffer"
  >;
  return {
    gl: gl as unknown as WebglContext,
    buffers,
    vaos,
    calls,
    control,
    get boundVao() {
      return vao;
    },
    get boundArray() {
      return array;
    },
  };
}

const optionalStreams = [
  "normals",
  "uvs",
  "colors",
  "joints",
  "weights",
  "indices",
] as const;
let nextId = 0;

/** Real buffer data, without introducing a geometry dependency to this backend. */
function geometry(mask = 0) {
  const data = {
    id: `refresh-${String(nextId++)}`,
    version: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: undefined as Float32Array | undefined,
    uvs: undefined as Float32Array | undefined,
    colors: undefined as Float32Array | undefined,
    joints: undefined as Uint16Array | undefined,
    weights: undefined as Float32Array | undefined,
    positions1: undefined as Float32Array | undefined,
    normals1: undefined as Float32Array | undefined,
    indices: undefined as Uint16Array | Uint32Array | undefined,
    mode: "triangles" as "triangles" | "lines",
    get drawCount() {
      return this.indices?.length ?? this.positions.length / 3;
    },
  };
  if (mask & 1) data.normals = new Float32Array(9).fill(1);
  if (mask & 2) data.uvs = new Float32Array(6).fill(0.5);
  if (mask & 4) data.colors = new Float32Array(12).fill(1);
  if (mask & 8) data.joints = new Uint16Array(12);
  if (mask & 16) data.weights = new Float32Array(12).fill(0.25);
  if (mask & 32) data.indices = new Uint16Array([0, 1, 2]);
  return data;
}

function cacheable(data: ReturnType<typeof geometry>): CacheableGeometry {
  return data as unknown as CacheableGeometry;
}

function bytes(data: ArrayBufferView): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

const recordBuffers = [
  "normalBuffer",
  "uvBuffer",
  "colorBuffer",
  "jointBuffer",
  "weightBuffer",
  "indexBuffer",
] as const;

function expectNoRebuild(calls: string[]): void {
  for (const name of [
    "createVertexArray",
    "deleteVertexArray",
    "createBuffer",
    "deleteBuffer",
    "vertexAttribPointer",
    "enableVertexAttribArray",
  ]) {
    expect(calls).not.toContain(name);
  }
}

describe("GeometryCache refresh — data, bindings, and lifetimes", () => {
  it.each(Array.from({ length: 64 }, (_, mask) => mask))(
    "refreshes all data and preserves VAO attachments for stream mask %i",
    (mask) => {
      const ctx = geometryContext();
      const cache = new GeometryCache(ctx.gl);
      const data = geometry(mask);
      const first = cache.acquire(cacheable(data))!;
      const attributes = new Map(ctx.vaos.get(first.vertexArray)!.attributes);
      ctx.calls.length = 0;
      data.positions[0] = 7;
      for (const key of optionalStreams) {
        if (data[key] !== undefined) data[key][0] = 1;
      }
      data.version++;
      const next = cache.acquire(cacheable(data))!;
      expect(next.vertexArray).toBe(first.vertexArray);
      expect(next.positionBuffer).toBe(first.positionBuffer);
      expect(next.version).toBe(1);
      expect(first.version).toBe(0); // Acquired metadata is not mutated in place.
      expect(ctx.buffers.get(next.positionBuffer)).toEqual(
        bytes(data.positions),
      );
      let streams = 1;
      optionalStreams.forEach((key, i) => {
        const buffer = next[recordBuffers[i]];
        expect(buffer).toBe(first[recordBuffers[i]]);
        if (data[key] !== undefined) {
          streams++;
          expect(ctx.buffers.get(buffer!)).toEqual(bytes(data[key]));
        } else expect(buffer).toBeNull();
      });
      expect(ctx.calls.filter((name) => name === "bufferData")).toHaveLength(
        streams,
      );
      expectNoRebuild(ctx.calls);
      expect(ctx.vaos.get(next.vertexArray)!.attributes).toEqual(attributes);
      expect(ctx.vaos.get(next.vertexArray)!.index).toBe(next.indexBuffer);
      expect(ctx.vaos.get(null)!.index).toBeNull();
      expect(ctx.boundVao).toBeNull();
      expect(ctx.boundArray).toBeNull();
      ctx.calls.length = 0;
      expect(cache.acquire(cacheable(data))).toBe(next);
      expect(ctx.calls).toHaveLength(0);
      cache.dispose();
      cache.dispose();
      expect(ctx.buffers.size).toBe(0);
      expect(ctx.vaos.size).toBe(1); // Only the default VAO remains.
    },
  );

  it.each(optionalStreams.map((key, bit) => ({ key, bit })))(
    "rebuilds safely when $key is added and removed",
    ({ bit }) => {
      const ctx = geometryContext();
      const cache = new GeometryCache(ctx.gl);
      const data = geometry();
      let old = cache.acquire(cacheable(data))!;
      for (const mask of [1 << bit, 0]) {
        const replacement = geometry(mask);
        replacement.id = data.id;
        replacement.version = old.version + 1;
        const next = cache.acquire(cacheable(replacement))!;
        expect(next.vertexArray).not.toBe(old.vertexArray);
        expect(ctx.vaos.has(old.vertexArray)).toBe(false);
        expect(ctx.buffers.has(old.positionBuffer)).toBe(false);
        expect(cache.size).toBe(1);
        old = next;
      }
      cache.dispose();
      expect(ctx.buffers.size).toBe(0);
    },
  );

  it("resizes stores and changes index width/topology without stale draw metadata", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry(32);
    const first = cache.acquire(cacheable(data))!;
    for (const large of [true, false]) {
      ctx.calls.length = 0;
      const backing = new Float32Array(large ? 24 : 12).fill(9);
      data.positions = backing.subarray(3, large ? 21 : 9);
      const indexBacking = large
        ? new Uint32Array([99, 0, 1, 2, 3, 4, 5, 99])
        : new Uint16Array([99, 0, 1, 99]);
      data.indices = indexBacking.subarray(1, indexBacking.length - 1);
      data.mode = "lines";
      data.version++;
      const next = cache.acquire(cacheable(data))!;
      expectNoRebuild(ctx.calls);
      expect(next.positionBuffer).toBe(first.positionBuffer);
      expect(next.indexBuffer).toBe(first.indexBuffer);
      expect(next.count).toBe(large ? 6 : 2);
      expect(next.mode).toBe(GL.LINES);
      expect(next.indexType).toBe(large ? GL.UNSIGNED_INT : GL.UNSIGNED_SHORT);
      expect(ctx.buffers.get(next.positionBuffer)).toEqual(
        bytes(data.positions),
      );
      expect(ctx.buffers.get(next.indexBuffer!)).toEqual(bytes(data.indices));
    }
    cache.dispose();
  });

  it("refreshes while another VAO is bound without changing its index attachment", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const a = geometry(32);
    const first = cache.acquire(cacheable(a))!;
    const other = cache.acquire(cacheable(geometry(32)))!;
    ctx.gl.bindVertexArray(other.vertexArray);
    a.indices![0] = 2;
    a.version++;
    cache.acquire(cacheable(a));
    expect(ctx.vaos.get(other.vertexArray)!.index).toBe(other.indexBuffer);
    expect(ctx.buffers.get(first.indexBuffer!)).toEqual(bytes(a.indices!));
    cache.dispose();
  });

  it("evicts an emptied geometry after refresh and can upload it again", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry();
    cache.acquire(cacheable(data));
    data.version++;
    cache.acquire(cacheable(data));
    const positions = data.positions;
    data.positions = new Float32Array();
    data.version++;
    expect(cache.acquire(cacheable(data))).toBeNull();
    expect(ctx.buffers.size).toBe(0);
    expect(cache.size).toBe(0);
    data.positions = positions;
    data.version++;
    expect(cache.acquire(cacheable(data))).not.toBeNull();
    cache.dispose();
  });

  it("never resurrects a disposed cache, even after forget", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry(63);
    cache.acquire(cacheable(data));
    data.version++;
    cache.acquire(cacheable(data));
    cache.dispose();
    ctx.calls.length = 0;
    cache.forget();
    expect(cache.acquire(cacheable(data))).toBeNull();
    expect(cache.acquire(cacheable(geometry()))).toBeNull();
    expect(ctx.calls).toHaveLength(0);
    expect(cache.size).toBe(0);
  });

  it("forgets refreshed handles without GL calls, then uploads new ones", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry(63);
    const first = cache.acquire(cacheable(data))!;
    data.version++;
    cache.acquire(cacheable(data));
    ctx.calls.length = 0;
    cache.forget();
    expect(ctx.calls).toHaveLength(0);
    // Context loss invalidates the driver objects, not just the CPU records.
    ctx.buffers.clear();
    ctx.vaos.delete(first.vertexArray);
    const restored = cache.acquire(cacheable(data))!;
    expect(restored.vertexArray).not.toBe(first.vertexArray);
    expect(ctx.buffers.get(restored.positionBuffer)).toEqual(
      bytes(data.positions),
    );
    cache.dispose();
  });

  it("needs no new handles for refresh, but unwinds a refused layout rebuild", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry();
    cache.acquire(cacheable(data));
    ctx.control.failBuffer = true;
    data.version++;
    expect(cache.acquire(cacheable(data))).not.toBeNull();
    data.normals = new Float32Array(9);
    data.version++;
    expect(cache.acquire(cacheable(data))).toBeNull();
    expect(ctx.buffers.size).toBe(0);
    expect(ctx.vaos.size).toBe(1);
    expect(cache.size).toBe(0);
    ctx.control.failBuffer = false;
    expect(cache.acquire(cacheable(data))).not.toBeNull();
    cache.dispose();
  });

  it("uploads positions1 at location 6 and normals1 at location 7", () => {
    const ctx = geometryContext();
    const cache = new GeometryCache(ctx.gl);
    const data = geometry();
    data.positions1 = new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]);
    data.normals1 = new Float32Array(9).fill(1);
    const record = cache.acquire(cacheable(data))!;
    const attributes = ctx.vaos.get(record.vertexArray)!.attributes;
    expect(attributes.get(6)).toBe(record.position1Buffer);
    expect(attributes.get(7)).toBe(record.normal1Buffer);
    expect(ctx.buffers.get(record.position1Buffer!)).toEqual(
      bytes(data.positions1),
    );
    cache.dispose();
  });
});
