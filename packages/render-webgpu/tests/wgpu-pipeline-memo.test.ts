/**
 * `wgpu-pipeline-memo.ts` — the "same as the previous draw" pipeline fast path
 * (performance audit 2026-09-11, A3).
 *
 * What the memo promises: a repeat request answers the previous pipeline
 * without touching the cache; any changed key scalar — including a §57 stencil
 * field mutated in place on the same record — goes back through
 * `WgpuPipelineCache.acquire`, whose key is unchanged (so the
 * `fourJS:<key>` labels are byte-identical to the descriptor-per-draw path);
 * and a disposed or replaced cache is never answered from memory (§61).
 */

import { describe, expect, it, vi } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  WgpuPipelineCache,
  createDrawBindGroupLayout,
  pipelineKey,
  type GpuDevice,
} from "../src/index.js";
import {
  WgpuPipelineMemo,
  createPipelineRequest,
} from "../src/wgpu-pipeline-memo.js";

function fixture(): {
  cache: WgpuPipelineCache;
  gpu: ReturnType<typeof createRecordingGpu>;
} {
  const gpu = createRecordingGpu();
  const device = gpu.device as GpuDevice;
  const cache = new WgpuPipelineCache(
    device,
    createDrawBindGroupLayout(device),
  );
  gpu.reset();
  return { cache, gpu };
}

describe("WgpuPipelineMemo", () => {
  it("answers a repeated request from memory without consulting the cache", () => {
    const { cache } = fixture();
    const memo = new WgpuPipelineMemo();
    const request = createPipelineRequest();
    request.colorFormat = "bgra8unorm";
    request.depthFormat = "depth24plus";
    request.depthTest = true;
    request.depthWrite = true;

    const first = memo.acquire(cache, request);
    expect(first).not.toBeNull();
    expect(cache.size).toBe(1);

    const acquire = vi.spyOn(cache, "acquire");
    expect(memo.acquire(cache, request)).toBe(first);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("hands the cache the descriptor the draw arms used to build", () => {
    // The key — and so the `fourJS:<key>` label — must be byte-identical to
    // the descriptor-per-draw path: `normals` carried only when defined, the
    // trailing flags only when true, the stencil resolved through
    // `stencilDescriptor`.
    const { cache } = fixture();
    const memo = new WgpuPipelineMemo();
    const acquire = vi.spyOn(cache, "acquire");
    const request = createPipelineRequest();
    request.colorFormat = "bgra8unorm";
    request.depthFormat = "depth24plus-stencil8";
    request.depthTest = true;
    request.depthWrite = true;

    memo.acquire(cache, request);
    const unlit = acquire.mock.calls[0][0];
    expect(unlit).toEqual({
      kind: "unlit",
      vertexColors: false,
      map: false,
      blend: "none",
      depthTest: true,
      depthWrite: true,
      colorWrite: true,
      topology: "triangle-list",
      colorFormat: "bgra8unorm",
      depthFormat: "depth24plus-stencil8",
      stencil: null,
      batch: null,
    });
    expect("normals" in unlit).toBe(false);
    expect("shadow" in unlit).toBe(false);

    request.kind = "lit";
    request.normals = true;
    request.stencil = { func: "equal", ref: 1 };
    memo.acquire(cache, request);
    const lit = acquire.mock.calls[1][0];
    expect(pipelineKey(lit)).toBe(
      pipelineKey({
        kind: "lit",
        vertexColors: false,
        map: false,
        blend: "none",
        depthTest: true,
        depthWrite: true,
        colorWrite: true,
        topology: "triangle-list",
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        stencil: {
          func: "equal",
          readMask: 0xff,
          writeMask: 0xff,
          failOp: "keep",
          depthFailOp: "keep",
          passOp: "keep",
        },
        batch: null,
        normals: true,
        shadow: false,
        metalRoughness: false,
      }),
    );
    expect(lit.normals).toBe(true);
    expect("shadow" in lit).toBe(false);
    expect("metalRoughness" in lit).toBe(false);

    request.shadow = true;
    request.metalRoughness = true;
    memo.acquire(cache, request);
    expect(pipelineKey(acquire.mock.calls[2][0])).toMatch(/\|sh:y\|mr:y$/);

    request.kind = "particles";
    request.normals = undefined;
    request.shadow = false;
    request.metalRoughness = false;
    request.gpuInstances = true;
    memo.acquire(cache, request);
    const particles = acquire.mock.calls[3][0];
    expect(pipelineKey(particles)).toMatch(/^particles\|.*\|gi:y$/);
    expect("normals" in particles).toBe(false);
  });

  it("misses when any key scalar changes, and hits again on the way back", () => {
    const { cache } = fixture();
    const memo = new WgpuPipelineMemo();
    const request = createPipelineRequest();
    request.colorFormat = "bgra8unorm";
    request.depthFormat = "depth24plus";

    const opaque = memo.acquire(cache, request);
    request.blend = "additive";
    const additive = memo.acquire(cache, request);
    expect(additive).not.toBe(opaque);
    expect(cache.size).toBe(2);

    request.blend = "none";
    const acquire = vi.spyOn(cache, "acquire");
    expect(memo.acquire(cache, request)).toBe(opaque);
    // A different descriptor is a cache hit on the string key, not a memo hit.
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it("re-keys when a stencil field is mutated in place on the same record", () => {
    // `StencilState` is mutable and its fields do not bump `material.version`
    // (R-12), so the memo compares the six §57 fields, not the record.
    const { cache } = fixture();
    const memo = new WgpuPipelineMemo();
    const request = createPipelineRequest();
    request.colorFormat = "bgra8unorm";
    request.depthFormat = "depth24plus-stencil8";
    const stencil: {
      func?: "always" | "equal";
      readMask?: number;
      writeMask?: number;
      failOp?: "keep" | "replace";
      depthFailOp?: "keep" | "replace";
      passOp?: "keep" | "replace";
    } = { func: "always" };
    request.stencil = stencil;

    const first = memo.acquire(cache, request);
    expect(memo.acquire(cache, request)).toBe(first);
    expect(cache.size).toBe(1);

    for (const mutate of [
      (): void => {
        stencil.func = "equal";
      },
      (): void => {
        stencil.readMask = 0x0f;
      },
      (): void => {
        stencil.writeMask = 0x0f;
      },
      (): void => {
        stencil.failOp = "replace";
      },
      (): void => {
        stencil.depthFailOp = "replace";
      },
      (): void => {
        stencil.passOp = "replace";
      },
    ]) {
      const before = cache.size;
      mutate();
      memo.acquire(cache, request);
      expect(cache.size).toBe(before + 1);
    }

    // Dropping the stencil altogether is a miss too, and the spelled-out
    // defaults compare equal to an omitted field.
    request.stencil = null;
    memo.acquire(cache, request);
    expect(cache.size).toBe(8);
    request.stencil = {};
    const bare = memo.acquire(cache, request);
    request.stencil = {
      func: "always",
      readMask: 0xff,
      writeMask: 0xff,
      failOp: "keep",
      depthFailOp: "keep",
      passOp: "keep",
    };
    const acquire = vi.spyOn(cache, "acquire");
    expect(memo.acquire(cache, request)).toBe(bare);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("never answers from memory for a disposed or replaced cache (§61)", () => {
    const { cache } = fixture();
    const memo = new WgpuPipelineMemo();
    const request = createPipelineRequest();
    request.colorFormat = "bgra8unorm";

    const pipeline = memo.acquire(cache, request);
    expect(pipeline).not.toBeNull();

    cache.dispose();
    expect(memo.acquire(cache, request)).toBeNull();

    const { cache: replacement } = fixture();
    const fresh = memo.acquire(replacement, request);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(pipeline);
    expect(memo.acquire(replacement, request)).toBe(fresh);

    memo.reset();
    const acquire = vi.spyOn(replacement, "acquire");
    expect(memo.acquire(replacement, request)).toBe(fresh);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
