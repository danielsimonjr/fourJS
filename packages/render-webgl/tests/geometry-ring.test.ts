import { describe, expect, it } from "vitest";

import {
  GEOMETRY_RING_PROMOTE_AFTER,
  GEOMETRY_RING_SLOTS,
  GeometryCache,
  type CacheableGeometry,
} from "../src/gl-geometry.js";
import type { GlBuffer, WebglContext } from "../src/gl-program.js";

/** Counting GL seam with `bufferSubData`, recording every call name. */
function ringContext(withSubData = true) {
  const calls: string[] = [];
  const live = new Set<unknown>();
  let failAt = Infinity;
  let creates = 0;
  const gl: Record<string, unknown> = {
    createVertexArray() {
      calls.push("createVertexArray");
      const h = {};
      live.add(h);
      return h;
    },
    createBuffer() {
      calls.push("createBuffer");
      if (++creates >= failAt) return null;
      const h = {};
      live.add(h);
      return h;
    },
    bindVertexArray: () => calls.push("bindVertexArray"),
    bindBuffer: () => calls.push("bindBuffer"),
    bufferData: () => calls.push("bufferData"),
    enableVertexAttribArray: () => calls.push("enableVertexAttribArray"),
    vertexAttribPointer: () => calls.push("vertexAttribPointer"),
    deleteVertexArray(h: unknown) {
      calls.push("deleteVertexArray");
      live.delete(h);
    },
    deleteBuffer(h: unknown) {
      calls.push("deleteBuffer");
      live.delete(h);
    },
  };
  if (withSubData) gl.bufferSubData = () => calls.push("bufferSubData");
  return {
    gl: gl as unknown as WebglContext,
    calls,
    live,
    failAfter: (n: number) => (failAt = creates + n),
  };
}

let nextId = 0;
function geo(positions = 9, withNormals = false) {
  return {
    id: `ring-${String(nextId++)}`,
    version: 0,
    positions: new Float32Array(positions),
    normals: withNormals ? new Float32Array(positions) : undefined,
    uvs: undefined,
    colors: undefined,
    joints: undefined,
    weights: undefined,
    positions1: undefined,
    normals1: undefined,
    indices: undefined as Uint16Array | undefined,
    mode: "triangles" as const,
    get drawCount() {
      return this.indices?.length ?? this.positions.length / 3;
    },
  };
}
const c = (g: ReturnType<typeof geo>) => g as unknown as CacheableGeometry;

function bump(cache: GeometryCache, g: ReturnType<typeof geo>, times: number) {
  let record: ReturnType<GeometryCache["acquire"]> = null;
  for (let i = 0; i < times; i++) {
    g.version++;
    record = cache.acquire(c(g));
  }
  return record!;
}

describe("GeometryCache VBO ring (§65)", () => {
  it("keeps static and once-refreshed geometry on the unchanged path", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    cache.acquire(c(g));
    ctx.calls.length = 0;
    bump(cache, g, GEOMETRY_RING_PROMOTE_AFTER - 1);
    expect(ctx.calls).toEqual([
      "bindVertexArray",
      "bindBuffer",
      "bufferData",
      "bindVertexArray",
      "bindBuffer",
    ]);
    expect(cache.isRinged(g.id)).toBe(false);
    expect(cache.ringBytes).toBe(0);
    expect(cache.isRinged("missing")).toBe(false);
  });

  it("refreshes a ringed record in place (same object, no spread)", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo(9, true);
    cache.acquire(c(g));
    bump(cache, g, GEOMETRY_RING_PROMOTE_AFTER);
    const first = bump(cache, g, 1);
    const second = bump(cache, g, 1);
    expect(second).toBe(first);
    expect(second.version).toBe(g.version);
  });

  it("promotes, rotates slots, and allocates nothing after warm-up", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo(9, true);
    cache.acquire(c(g));
    bump(cache, g, GEOMETRY_RING_PROMOTE_AFTER);
    expect(cache.isRinged(g.id)).toBe(true);
    // Promotion created (slots - 1) extra buffers for each of two streams.
    expect(ctx.calls.filter((n) => n === "createBuffer")).toHaveLength(
      2 + 2 * (GEOMETRY_RING_SLOTS - 1),
    );
    const seen = new Set<GlBuffer>();
    // Warm every slot once (first write per slot sizes it via bufferData).
    for (let i = 0; i < GEOMETRY_RING_SLOTS; i++) {
      seen.add(bump(cache, g, 1).positionBuffer);
    }
    expect(seen.size).toBe(GEOMETRY_RING_SLOTS);
    ctx.calls.length = 0;
    const order: GlBuffer[] = [];
    for (let i = 0; i < GEOMETRY_RING_SLOTS * 2; i++) {
      order.push(bump(cache, g, 1).positionBuffer);
    }
    expect(ctx.calls).not.toContain("createBuffer");
    expect(ctx.calls).not.toContain("deleteBuffer");
    expect(ctx.calls).not.toContain("bufferData");
    expect(ctx.calls.filter((n) => n === "bufferSubData")).toHaveLength(
      GEOMETRY_RING_SLOTS * 2 * 2,
    );
    expect(order.slice(0, 3)).toEqual(order.slice(3));
    expect(cache.ringBytes).toBe(GEOMETRY_RING_SLOTS * 2 * 36);
  });

  it("re-sizes with an orphaning bufferData when the stream length changes", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    cache.acquire(c(g));
    bump(cache, g, 3);
    g.positions = new Float32Array(18);
    ctx.calls.length = 0;
    bump(cache, g, 1);
    expect(ctx.calls).toContain("bufferData");
    expect(ctx.calls).not.toContain("bufferSubData");
  });

  it("refreshes indices on the bufferData path while ringed", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    g.indices = new Uint16Array([0, 1, 2]);
    cache.acquire(c(g));
    bump(cache, g, 2 + GEOMETRY_RING_SLOTS);
    ctx.calls.length = 0;
    bump(cache, g, 1);
    expect(ctx.calls.filter((n) => n === "bufferData")).toHaveLength(1);
  });

  it("dispose frees the VAO and every ring buffer", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    g.indices = new Uint16Array([0, 1, 2]);
    cache.acquire(c(g));
    bump(cache, g, 3);
    cache.dispose();
    expect(ctx.live.size).toBe(0);
  });

  it("deletes the ring when the layout changes, and rebuilds from scratch", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    cache.acquire(c(g));
    bump(cache, g, 3);
    (g as { normals: Float32Array | undefined }).normals = new Float32Array(9);
    g.version++;
    cache.acquire(c(g));
    expect(cache.isRinged(g.id)).toBe(false);
    cache.dispose();
    expect(ctx.live.size).toBe(0);
  });

  it("stays on the bufferData path without bufferSubData", () => {
    const ctx = ringContext(false);
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    cache.acquire(c(g));
    bump(cache, g, 4);
    expect(cache.isRinged(g.id)).toBe(false);
    expect(ctx.calls.filter((n) => n === "createBuffer")).toHaveLength(1);
  });

  it("falls back cleanly when promotion cannot allocate", () => {
    const ctx = ringContext();
    const cache = new GeometryCache(ctx.gl);
    const g = geo();
    cache.acquire(c(g));
    ctx.failAfter(2);
    bump(cache, g, 2);
    expect(cache.isRinged(g.id)).toBe(false);
    // One of the two created slots was deleted again; none leaked.
    expect(ctx.live.size).toBe(2); // VAO + position buffer
  });
});
