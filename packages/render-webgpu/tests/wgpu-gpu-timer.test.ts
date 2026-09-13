/**
 * `WgpuGpuTimer` lifetime (§83 stability audit, 2026-09-11). The timer's
 * measurement path is exercised through the renderer suite (A-1); this file
 * pins the part the renderer cannot show — that disposal is terminal.
 */

import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import type { GpuDevice } from "../src/index.js";
import { WgpuGpuTimer } from "../src/wgpu-gpu-timer.js";

/** Runs `run`, expecting a `FourError` with `INVALID_APPLICATION_STATE` (§83, §89). */
function expectDisposedError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  expect((caught as { code: string }).code).toBe("INVALID_APPLICATION_STATE");
  return caught as Error;
}

describe("WgpuGpuTimer disposal", () => {
  it("disposes idempotently and refuses arming and timestamp writes afterwards", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const timer = new WgpuGpuTimer();
    expect(timer.disposed).toBe(false);
    timer.arm();
    expect(timer.beginPass(device)).toBeDefined();
    expect(gpu.countOf("device.createQuerySet")).toBe(1);

    timer.dispose();
    expect(timer.disposed).toBe(true);
    expect(gpu.countOf("querySet.destroy")).toBe(1);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
    // A second dispose is a no-op (§83: idempotent): nothing is destroyed twice.
    expect(() => timer.dispose()).not.toThrow();
    expect(gpu.countOf("querySet.destroy")).toBe(1);
    expect(timer.disposed).toBe(true);

    // Disposal is terminal (§83): arming and the per-frame write refuse with
    // §89's INVALID_APPLICATION_STATE rather than silently reallocating.
    expect(expectDisposedError(() => timer.arm()).message).toMatch(
      /WgpuGpuTimer is disposed.*§83/s,
    );
    expectDisposedError(() => timer.beginPass(device));
    expect(gpu.countOf("device.createQuerySet")).toBe(1);
    // The post-submit hooks stay inert no-ops, as on a never-armed timer.
    timer.afterSubmit();
    expect(timer.armed).toBe(true);
  });
});
