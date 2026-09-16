/**
 * Direct coverage of {@link GlGpuTimer} — the branches the renderer suite
 * does not walk (null queries, spare reuse, forget/dispose, missing
 * entry points, a non-finite sample).
 */

import { describe, expect, it } from "vitest";

import { GlGpuTimer, hasDisjointTimerQuery } from "../src/gl-gpu-timer.js";
import { GL } from "../src/gl-program.js";

interface FakeTimerGl {
  extension: unknown;
  disjoint: boolean;
  available: boolean;
  result: unknown;
  created: object[];
  deleted: object[];
  begins: number;
  ends: number;
  failCreate: boolean;
  getExtension?(name: string): unknown;
  getParameter(pname: number): unknown;
  createQuery?(): object | null;
  deleteQuery?(query: object): void;
  beginQuery?(target: number, query: object): void;
  endQuery?(target: number): void;
  getQueryParameter?(query: object, pname: number): unknown;
}

function fakeGl(overrides: Partial<FakeTimerGl> = {}): FakeTimerGl {
  const gl: FakeTimerGl = {
    extension: { name: "EXT_disjoint_timer_query_webgl2" },
    disjoint: false,
    available: true,
    result: 2_000_000,
    created: [],
    deleted: [],
    begins: 0,
    ends: 0,
    failCreate: false,
    getExtension(name: string): unknown {
      return name === "EXT_disjoint_timer_query_webgl2" ? gl.extension : null;
    },
    getParameter(pname: number): unknown {
      return pname === GL.GPU_DISJOINT_EXT ? gl.disjoint : 0;
    },
    createQuery(): object | null {
      if (gl.failCreate) return null;
      const query = { id: gl.created.length };
      gl.created.push(query);
      return query;
    },
    deleteQuery(query: object): void {
      gl.deleted.push(query);
    },
    beginQuery(): void {
      gl.begins += 1;
    },
    endQuery(): void {
      gl.ends += 1;
    },
    getQueryParameter(_query: object, pname: number): unknown {
      if (pname === GL.QUERY_RESULT_AVAILABLE) return gl.available;
      if (pname === GL.QUERY_RESULT) return gl.result;
      return 0;
    },
    ...overrides,
  };
  return gl;
}

function armedTimer(): GlGpuTimer {
  const timer = new GlGpuTimer();
  timer.arm();
  return timer;
}

describe("GlGpuTimer", () => {
  it("is unarmed until arm() and stays NaN", () => {
    const timer = new GlGpuTimer();
    const gl = fakeGl();
    expect(timer.armed).toBe(false);
    timer.begin(gl);
    timer.end(gl);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
    expect(gl.begins).toBe(0);
    timer.arm();
    expect(timer.armed).toBe(true);
  });

  it("is unsupported without the extension or query methods", () => {
    expect(armedTimer().isSupported(fakeGl({ extension: null }))).toBe(false);
    expect(armedTimer().isSupported(fakeGl({ createQuery: undefined }))).toBe(
      false,
    );
    expect(hasDisjointTimerQuery({})).toBe(false);
    expect(hasDisjointTimerQuery({ getExtension: () => null })).toBe(false);
    expect(
      hasDisjointTimerQuery({
        getExtension: () => ({ name: "EXT_disjoint_timer_query_webgl2" }),
      }),
    ).toBe(true);
  });

  it("no-ops begin when createQuery returns null", () => {
    const timer = armedTimer();
    const gl = fakeGl({ failCreate: true });
    timer.begin(gl);
    timer.end(gl);
    expect(gl.begins).toBe(0);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
  });

  it("reuses a spare query after a completed poll", () => {
    const timer = armedTimer();
    const gl = fakeGl();
    timer.begin(gl);
    timer.end(gl);
    expect(gl.created).toHaveLength(1);
    timer.begin(gl);
    timer.end(gl);
    expect(gl.created).toHaveLength(1);
    expect(timer.lastGpuFrameTimeSeconds).toBeCloseTo(0.002, 12);
  });

  it("leaves the pending query when the result is not available", () => {
    const timer = armedTimer();
    const gl = fakeGl({ available: false });
    timer.begin(gl);
    timer.end(gl);
    timer.begin(gl);
    timer.end(gl);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
    expect(gl.created).toHaveLength(2);
  });

  it("ignores a non-finite query result", () => {
    const timer = armedTimer();
    const gl = fakeGl({ result: Number.POSITIVE_INFINITY });
    timer.begin(gl);
    timer.end(gl);
    timer.begin(gl);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
  });

  it("skips poll when getQueryParameter is missing after a pending query", () => {
    const timer = armedTimer();
    const gl = fakeGl();
    timer.begin(gl);
    timer.end(gl);
    const next = fakeGl();
    delete next.getQueryParameter;
    timer.begin(next);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
  });

  it("does not start a second query while one is active", () => {
    const timer = armedTimer();
    const gl = fakeGl();
    timer.begin(gl);
    timer.begin(gl);
    expect(gl.begins).toBe(1);
    timer.end(gl);
    timer.end(gl);
    expect(gl.ends).toBe(1);
  });

  it("forget drops handles without deleting them", () => {
    const timer = armedTimer();
    const gl = fakeGl();
    timer.begin(gl);
    timer.end(gl);
    timer.forget();
    expect(gl.deleted).toHaveLength(0);
    expect(timer.lastGpuFrameTimeSeconds).toBeNaN();
    timer.begin(gl);
    expect(gl.created).toHaveLength(2);
  });

  it("dispose deletes active, pending, and spare queries", () => {
    const timer = armedTimer();
    const gl = fakeGl();
    timer.begin(gl);
    timer.dispose(gl);
    expect(gl.deleted).toHaveLength(1);

    const pending = fakeGl();
    timer.arm();
    timer.begin(pending);
    timer.end(pending);
    timer.dispose(pending);
    expect(pending.deleted).toHaveLength(1);

    const spare = fakeGl();
    timer.arm();
    timer.begin(spare);
    timer.end(spare);
    spare.available = true;
    timer.begin(spare);
    timer.end(spare);
    timer.dispose(spare);
    expect(spare.deleted.length).toBeGreaterThanOrEqual(1);
  });
});
