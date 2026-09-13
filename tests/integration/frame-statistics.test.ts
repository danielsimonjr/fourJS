/**
 * A-1 — §84's `app.stats`, end to end (2026-08-07).
 *
 * §84 is a claim about four packages agreeing, and no unit test inside any one
 * of them can check it:
 *
 * 1. `@fourjs/diagnostics` owns the {@link FrameStats} record (§98 gives it
 *    "statistics, overlays, validation") and may import neither `render` nor
 *    `physics` — so its render counters arrive through a *transcribed* shape;
 * 2. `@fourjs/render` declares the optional `Renderer.statistics` capability
 *    without knowing what a draw call is made of;
 * 3. `@fourjs/render-webgl` counts the draws it actually submits to GL;
 * 4. `four`'s `Application` owns one record, resets it at the frame boundary,
 *    measures the two times it can measure, and copies the backend's counters
 *    back.
 *
 * The scene is real — a real `Scene`, a real camera, real `planeGeometry` and
 * `UnlitMaterial` — and only the GL context is a double, for the reason
 * `packages/render-webgl/tests` gives at length: the backend's whole GL surface
 * is one interface, so a recording object implementing it is a complete double,
 * call *counts* and call *order* included, with no GPU and no browser.
 *
 * The load-bearing assertion is the last one: **`app.stats.drawCalls` equals
 * the number of draw entry points the fake context actually recorded**. A
 * statistics surface that counted the render list instead would pass every
 * assertion above it and be wrong exactly when a frame is interesting.
 */

import { geometryMemoryBytes, planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import {
  RenderTarget,
  Renderable,
  Texture,
  textureMemoryBytes,
} from "@fourjs/render";
import {
  GL,
  WebglRenderer,
  type ParticleGlContext,
  type WebglCanvas,
} from "@fourjs/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "@fourjs/scene";
import { Application } from "fourJS/application";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A recording GL context (the `render-to-texture` suite's double, trimmed to
// the entry points a statistics frame needs).
// ---------------------------------------------------------------------------

const CONTEXT_METHODS = [
  "createShader",
  "shaderSource",
  "compileShader",
  "getShaderParameter",
  "getShaderInfoLog",
  "deleteShader",
  "createProgram",
  "attachShader",
  "linkProgram",
  "getProgramParameter",
  "getProgramInfoLog",
  "deleteProgram",
  "getUniformLocation",
  "useProgram",
  "uniformMatrix4fv",
  "uniformMatrix3fv",
  "uniform4fv",
  "uniform3fv",
  "uniform1f",
  "uniform1i",
  "createTexture",
  "bindTexture",
  "texImage2D",
  "texParameteri",
  "deleteTexture",
  "activeTexture",
  "createFramebuffer",
  "bindFramebuffer",
  "framebufferTexture2D",
  "checkFramebufferStatus",
  "deleteFramebuffer",
  "createRenderbuffer",
  "bindRenderbuffer",
  "renderbufferStorage",
  "framebufferRenderbuffer",
  "deleteRenderbuffer",
  "createBuffer",
  "bindBuffer",
  "bufferData",
  "bufferSubData",
  "deleteBuffer",
  "createVertexArray",
  "bindVertexArray",
  "deleteVertexArray",
  "enableVertexAttribArray",
  "vertexAttribDivisor",
  "vertexAttribPointer",
  "getParameter",
  "enable",
  "disable",
  "depthFunc",
  "frontFace",
  "viewport",
  "scissor",
  "clearColor",
  "clearDepth",
  "clear",
  "blendFunc",
  "depthMask",
  "colorMask",
  "drawArrays",
  "drawArraysInstanced",
  "drawElements",
  "isContextLost",
] as const;

interface RecordingGl {
  readonly gl: ParticleGlContext;
  readonly names: string[];
  countOf(name: string): number;
  /** Every draw entry point the context was actually asked to run. */
  drawCount(): number;
  reset(): void;
}

function createRecordingGl(): RecordingGl {
  const names: string[] = [];
  let serial = 0;
  const context: Record<string, (...args: unknown[]) => unknown> = {};

  for (const name of CONTEXT_METHODS) {
    context[name] = (): unknown => {
      names.push(name);
      if (name.startsWith("create") || name === "getUniformLocation") {
        serial += 1;
        return { kind: name, serial };
      }
      if (name === "getShaderParameter" || name === "getProgramParameter") {
        return true;
      }
      if (name === "getShaderInfoLog" || name === "getProgramInfoLog") {
        return "";
      }
      if (name === "getParameter") {
        return 4096;
      }
      if (name === "checkFramebufferStatus") {
        return GL.FRAMEBUFFER_COMPLETE;
      }
      if (name === "isContextLost") {
        return false;
      }
      return undefined;
    };
  }

  const countOf = (name: string): number =>
    names.filter((recorded) => recorded === name).length;

  return {
    gl: context as unknown as ParticleGlContext,
    names,
    countOf,
    drawCount: () =>
      countOf("drawArrays") +
      countOf("drawElements") +
      countOf("drawArraysInstanced"),
    reset: () => {
      names.length = 0;
    },
  };
}

/** A canvas reduced to what the backend touches. */
class RecordingCanvas implements WebglCanvas {
  width = 256;

  height = 256;

  readonly #context: unknown;

  constructor(context: unknown) {
    this.#context = context;
  }

  getContext(): unknown {
    return this.#context;
  }

  addEventListener(): void {
    // Loss and restore are `packages/render-webgl/tests`' business.
  }

  removeEventListener(): void {
    // Ditto.
  }
}

/** A clock the test drives, in seconds (§7a — no milliseconds anywhere). */
function testClock(): { now: () => number; advance: (delta: number) => void } {
  let seconds = 0;
  return {
    now: () => seconds,
    advance: (delta: number) => {
      seconds += delta;
    },
  };
}

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly app: Application;
  readonly clock: ReturnType<typeof testClock>;
}

/**
 * A started application drawing `quadCount` unlit quads through the WebGL 2
 * backend over a recording context.
 */
async function harness(
  quadCount: number,
  options: { stats?: boolean } = {},
): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  const clock = testClock();
  const app = new Application({
    renderer,
    canvas: new RecordingCanvas(recorder.gl),
    stats: options.stats,
    now: clock.now,
    width: 256,
    height: 256,
  });

  // §87 (R-8, 2026-08-09): this said `{ height: 4, aspect: 1 }`, and
  // `OrthographicCameraOptions` has neither field — the object was accepted and
  // every one of its properties ignored, leaving the default unit box
  // `[-1, 1]²`. (Excess-property checking would have caught it; these suites are
  // not part of any `tsc` project, which is the same hole `bun run docs`
  // catches for package sources.) The harness lays quads out at `x = 0…3`, so
  // all but the first two were off screen and the draw counts asserted below
  // were counts of invisible draws. Frustum culling removed them and exposed
  // it; the box below is the one the numbers always assumed.
  const camera = new OrthographicCamera({
    left: -2,
    right: 5,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  app.scene.add(camera);
  app.views.push(createFullscreenViewport(camera));

  for (let index = 0; index < quadCount; index += 1) {
    const quad = new Renderable(
      planeGeometry({ width: 1, height: 1 }),
      new UnlitMaterial({ color: [1, 0.5, 0, 1] }),
    );
    quad.transform.position.set(index, 0, 0);
    app.scene.add(quad);
  }

  await app.initialize();
  app.start();
  recorder.reset();
  return { recorder, renderer, app, clock };
}

const FIXED = 1 / 60;

describe("A-1 — §84 statistics through the whole stack", () => {
  it("reports the draw calls the backend really submitted", async () => {
    const { app, recorder } = await harness(4, { stats: true });

    app.step(FIXED);

    // Four quads, each a two-triangle indexed `planeGeometry`.
    expect(recorder.drawCount()).toBe(4);
    expect(app.stats?.drawCalls).toBe(4);
    expect(app.stats?.triangles).toBe(8);
    expect(app.stats?.instances).toBe(4);
  });

  it("agrees with the context call for call as the scene changes", async () => {
    const { app, recorder } = await harness(2, { stats: true });

    app.step(FIXED);
    const firstFrame = { drawCalls: app.stats?.drawCalls };
    app.scene.add(
      new Renderable(
        planeGeometry({ width: 1, height: 1 }),
        new UnlitMaterial({ color: [0, 1, 0, 1] }),
      ),
    );
    recorder.reset();
    app.step(FIXED);

    expect(firstFrame.drawCalls).toBe(2);
    expect(recorder.drawCount()).toBe(3);
    expect(app.stats?.drawCalls).toBe(3);
  });

  it("counts per frame, not cumulatively", async () => {
    const { app } = await harness(3, { stats: true });

    app.step(FIXED);
    app.step(FIXED);
    app.step(FIXED);

    expect(app.stats?.drawCalls).toBe(3);
  });

  it("does not count a node the frame did not draw", async () => {
    const { app, recorder } = await harness(3, { stats: true });
    const hidden = app.scene.children.at(-1);
    if (hidden !== undefined) {
      hidden.visible = false;
    }
    recorder.reset();

    app.step(FIXED);

    expect(recorder.drawCount()).toBe(2);
    expect(app.stats?.drawCalls).toBe(2);
  });

  it("measures the frame's CPU seconds and its fixed-step seconds separately", async () => {
    const { app, clock } = await harness(1, { stats: true });
    app.on("fixedUpdate", () => {
      clock.advance(0.001);
    });
    app.on("render", () => {
      clock.advance(0.01);
    });

    app.step(FIXED * 2);

    expect(app.stats?.simulationTime).toBeCloseTo(0.002, 12);
    expect(app.stats?.cpuFrameTime).toBeCloseTo(0.012, 12);
  });

  it("leaves the counters no producer can fill unmeasured", async () => {
    const { app } = await harness(1, { stats: true });

    app.step(FIXED);

    // No physics world, and the recording GL context has no timer extension,
    // so these four stay `NaN` — "not measured", not a confident zero.
    for (const staged of [
      app.stats?.gpuFrameTime,
      app.stats?.physicsStepTime,
      app.stats?.activeBodies,
      app.stats?.contacts,
    ]) {
      expect(staged).toBeNaN();
    }
  });

  it("reports §83's live-resource totals as textureMemory/bufferMemory (A-5)", async () => {
    // The A-5 half of the same claim, and the same shape of end-to-end check:
    // `@fourjs/geometry` and `@fourjs/render` each keep a process-wide total of
    // what their live resources hold, `@fourjs/diagnostics` transcribes the pair
    // it may not import, and `Application` reads them at the frame boundary.
    const { app } = await harness(3, { stats: true });

    app.step(FIXED);

    // The harness built three real `planeGeometry` quads, so the total is at
    // least their bytes — and it is the *same* number the producing package
    // reports, which is what makes this a bridge test rather than a re-derived
    // guess.
    expect(app.stats?.bufferMemory).toBe(geometryMemoryBytes());
    expect(app.stats?.textureMemory).toBe(textureMemoryBytes());
    expect(app.stats?.bufferMemory).toBeGreaterThan(0);
  });

  it("follows a texture and a target created and disposed mid-session (A-5)", async () => {
    const { app } = await harness(1, { stats: true });

    app.step(FIXED);
    const before = app.stats?.textureMemory ?? Number.NaN;
    expect(before).not.toBeNaN();

    const atlas = new Texture({ width: 64, height: 64 });
    const target = new RenderTarget({ width: 32, height: 32, depth: false });

    app.step(FIXED);
    expect((app.stats?.textureMemory ?? 0) - before).toBe(
      64 * 64 * 4 + 32 * 32 * 4,
    );

    atlas.dispose();
    target.dispose();

    app.step(FIXED);
    expect(app.stats?.textureMemory).toBe(before);
  });

  it("adds no GL call for the memory counters (A-5)", async () => {
    // The counters are read from CPU-side accounting, never from the driver, so
    // switching statistics on must still produce the byte-identical GL
    // sequence the A-1 test below pins — asserted here with a live texture and
    // target in the process, which is the case a driver query would break.
    const atlas = new Texture({ width: 8, height: 8 });
    const off = await harness(2);
    const on = await harness(2, { stats: true });

    off.app.step(FIXED);
    on.app.step(FIXED);

    expect(on.recorder.names).toEqual(off.recorder.names);
    expect(on.app.stats?.textureMemory).toBeGreaterThanOrEqual(
      atlas.byteLength,
    );
    atlas.dispose();
  });

  it("costs the frame nothing at all when it is off", async () => {
    // The zero-cost claim, measured rather than asserted: the same scene
    // stepped with and without statistics issues the byte-identical GL call
    // sequence — same names, same order, same length — and the unmeasured
    // application never reads its clock.
    const off = await harness(3);
    const on = await harness(3, { stats: true });

    off.app.step(FIXED);
    on.app.step(FIXED);

    expect(off.app.stats).toBeNull();
    expect(off.renderer.statistics).toBeNull();
    expect(on.recorder.names).toEqual(off.recorder.names);
    expect(on.app.stats?.drawCalls).toBe(3);
    // …and the A-5 counters are live in the measured application while the
    // unmeasured one still records nothing at all.
    expect(on.app.stats?.bufferMemory).toBeGreaterThan(0);
  });

  it("hands the backend's statistics slot back when the application is disposed", async () => {
    const { app, renderer } = await harness(1, { stats: true });
    expect(renderer.statistics).not.toBeNull();

    app.dispose();

    // §83: the renderer is the author's, not the application's — and neither is
    // the slot. A renderer outliving its application must not go on
    // accumulating into a record nobody reads.
    expect(renderer.statistics).toBeNull();
    renderer.dispose();
  });
});
