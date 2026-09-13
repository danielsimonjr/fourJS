/**
 * R-6 — §70's full-screen effects, driving the real WebGL 2 backend
 * (2026-08-07).
 *
 * `EffectRenderPass` lives in `@fourjs/render` and names no GL type; the WebGL 2
 * backend runs it; `RenderGraph` orders it against the scene passes that
 * produce its input. Those are three packages agreeing, and no unit test
 * inside any one of them can check the agreement — which is what this file is
 * for. Four claims:
 *
 * 1. **The no-post path is byte-identical.** An application that runs no
 *    effect must emit the GL call sequence it emitted before §70 existed —
 *    same calls, same arguments, same order. The expected transcript below was
 *    recorded from the build immediately before R-6 (commit `9285d4b`) and is
 *    pinned here, so this is a genuine before/after comparison rather than a
 *    restatement of what the code currently happens to do.
 * 2. **The graph is still a driver, not a backend.** A graph whose last pass
 *    is an effect emits exactly what the hand-written
 *    `render` + `renderEffect` pair emits, call for call — R-5's property,
 *    re-proved for the second verb.
 * 3. **The static rule and the runtime refusal are the same rule.** A pass
 *    that draws into the surface it samples is reported `"feedback"` by
 *    `validate()` and then not drawn by the backend, on one graph.
 * 4. **A ping-pong chain really composes.** Two effects and a present pass
 *    over two targets: three draws, three framebuffer bindings, one on-screen
 *    pass, and a clean validation.
 *
 * The scenes are real and only the GL context is a double, for the reason
 * `render-graph.test.ts` gives at length.
 */

import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import {
  COPY_EFFECT,
  RenderGraph,
  RenderTarget,
  Renderable,
  createRenderStatistics,
  supportsScreenEffects,
  type EffectRenderPass,
} from "@fourjs/render";
import { WebglRenderer, registerEffectPipeline } from "@fourjs/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

// §70's fixed effects are a registration seam on WebGL 2 since 2026-09-11
// (the skinning shape): one explicit call links the full-screen program, and
// the renderer compiles it on the first effect pass. Registered for the file,
// as an application registers once at setup.
registerEffectPipeline();

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 4, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 4 × 4 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order.
 *
 * Two transcripts recorded from *different builds* cannot share raw handle
 * serials: the double mints them in creation order, so compiling one more
 * program at initialization shifts every handle minted afterwards by a
 * constant. What "the same GL sequence" means across builds is therefore this:
 * the same calls, in the same order, with the same non-handle arguments, and
 * with each handle in the same position **relative to the other handles of the
 * frame**. Aliasing says exactly that, and says nothing weaker — a frame that
 * bound a different texture, or bound them in a different order, does not
 * survive it.
 */
function aliasHandles(transcript: readonly string[]): string[] {
  const alias = new Map<string, string>();
  const counts = new Map<string, number>();
  return transcript.map((line) =>
    line.replace(/\{"kind":"[A-Za-z]+","serial":\d+\}/g, (handle) => {
      const existing = alias.get(handle);
      if (existing !== undefined) {
        return existing;
      }
      const kind = (JSON.parse(handle) as { kind: string }).kind;
      const index = counts.get(kind) ?? 0;
      counts.set(kind, index + 1);
      const name = `${kind}#${String(index)}`;
      alias.set(handle, name);
      return name;
    }),
  );
}

/**
 * The GL a steady-state two-pass frame emitted on **2026-08-07, at commit
 * `9285d4b`** — the last build before §70's effects existed — for the scene
 * {@link twoPassScene} builds: an off-screen quad into a 64×64 target, then an
 * on-screen quad sampling it.
 *
 * Recorded, not written. Do not "fix" a failure here by re-recording: this
 * list is the regression guard for every pixel golden and every browser test,
 * and a change to it is a change to what a frame that uses none of §70 draws.
 */
const FRAME_BEFORE_R6: readonly string[] = [
  "bindFramebuffer(36160, createFramebuffer#0)",
  "useProgram(createProgram#0)",
  "scissor(0, 0, 64, 64)",
  "viewport(0, 0, 64, 64)",
  "clearDepth(1)",
  "clear(256)",
  "uniformMatrix4fv(getUniformLocation#0, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform1i(getUniformLocation#1, 0)",
  "uniformMatrix4fv(getUniformLocation#2, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#3, [1,1,1,1])",
  "bindVertexArray(createVertexArray#0)",
  "drawElements(4, 6, 5123, 0)",
  "bindVertexArray(null)",
  "bindFramebuffer(36160, null)",
  "useProgram(createProgram#0)",
  "scissor(0, 0, 256, 256)",
  "viewport(0, 0, 256, 256)",
  "clearDepth(1)",
  "clear(256)",
  "uniformMatrix4fv(getUniformLocation#0, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "activeTexture(33984)",
  "bindTexture(3553, createTexture#0)",
  "uniform1i(getUniformLocation#1, 1)",
  "uniformMatrix4fv(getUniformLocation#2, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#3, [1,1,1,1])",
  "bindVertexArray(createVertexArray#1)",
  "drawElements(4, 6, 5123, 0)",
  "bindTexture(3553, null)",
  "bindVertexArray(null)",
];

/**
 * The scene `FRAME_BEFORE_R6` was recorded from — the same one R-5's suite
 * uses, so the two files are talking about the same frame.
 */
function twoPassScene(test: Harness): {
  target: RenderTarget;
  offscreenRoot: Scene;
  offscreenViews: Viewport[];
} {
  const target = new RenderTarget({ width: 64, height: 64 });

  const offscreenRoot = new Scene();
  offscreenRoot.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ color: [1, 0, 0, 1] })),
  );

  test.scene.add(
    new Renderable(
      planeGeometry(),
      new UnlitMaterial({ color: [1, 1, 1, 1], map: target.colorTexture }),
    ),
  );

  return {
    target,
    offscreenRoot,
    offscreenViews: [
      createFullscreenViewport(new OrthographicCamera(), "offscreen"),
    ],
  };
}

/** Resolves world transforms (§7, §64) the way `Application` does per frame. */
function resolve(test: Harness, ...roots: readonly Scene[]): void {
  resolveWorldTransforms(test.scene);
  for (const root of roots) {
    resolveWorldTransforms(root);
  }
}

describe("R-6 — the no-post path is byte-identical (§70)", () => {
  it("emits the GL sequence recorded before §70's effects existed", async () => {
    const test = await harness();
    const { target, offscreenRoot, offscreenViews } = twoPassScene(test);

    // Warm every cache — programs, geometry buffers, the target's framebuffer
    // — so the comparison is about a steady-state frame, as it was when the
    // expected transcript was recorded.
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    test.renderer.render(test.scene, test.views);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R6);
  });

  it("compiles the effect pipeline once, on the first effect pass, and never again", async () => {
    // Until 2026-09-11 the program was built at initialize beside the other
    // pipelines (R-6's §61 argument: a compile inside a frame can throw).
    // Behind `registerEffectPipeline()` it compiles on the first effect pass
    // instead, inside that pass's own `try` with a fail-once latch — so an
    // application that runs no effect carries neither the program nor its
    // shaders, and one that does pays the compile exactly once per context.
    const test = await harness();
    const { target, offscreenRoot, offscreenViews } = twoPassScene(test);
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    test.recorder.reset();

    const present: EffectRenderPass = {
      kind: "effect",
      source: target.colorTexture,
      effect: COPY_EFFECT,
    };
    test.renderer.renderEffect(present);
    expect(test.recorder.countOf("createProgram")).toBe(1);
    expect(test.recorder.countOf("drawArrays")).toBe(1);

    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    test.renderer.renderEffect(present);

    expect(test.recorder.countOf("createProgram")).toBe(0);
    expect(test.recorder.countOf("compileShader")).toBe(0);
    expect(test.recorder.countOf("drawArrays")).toBe(1);
  });
});

describe("R-6 — a graph drives the effect pass (§63, §70)", () => {
  it("emits the identical GL sequence as the hand-written calls it replaces", async () => {
    const test = await harness();
    const source = new RenderTarget({ width: 64, height: 64 });
    const offscreenRoot = new Scene();
    offscreenRoot.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [0.25, 0.5, 1, 1] }),
      ),
    );
    const offscreenViews = [
      createFullscreenViewport(new OrthographicCamera(), "offscreen"),
    ];
    const present: EffectRenderPass = {
      kind: "effect",
      source: source.colorTexture,
      effect: { kind: "grade", exposure: 1.25, saturation: 0.5 },
    };

    // Warm the caches, including the effect program's sampler upload and its
    // grade — both are once-per-program, so a first frame is not comparable to
    // a second one.
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, source);
    test.renderer.renderEffect(present);

    // Frame A: written by hand, as an application does today.
    test.recorder.reset();
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, source);
    test.renderer.renderEffect(present);
    const byHand = test.recorder.transcript();

    // Frame B: the same two passes, expressed as a graph.
    const graph = new RenderGraph();
    graph.addPass("world", {
      root: offscreenRoot,
      views: offscreenViews,
      target: source,
    });
    graph.addPass("present", present, { inputs: ["world"] });
    expect(graph.validate()).toEqual([]);

    test.recorder.reset();
    resolve(test, offscreenRoot);
    expect(graph.execute(test.renderer)).toBe(2);
    const byGraph = test.recorder.transcript();

    expect(byGraph).toEqual(byHand);
    // …and the frame really did draw an effect, so the two are not empty lists
    // agreeing: `drawArrays(TRIANGLES, 0, 3)` is the full-screen triangle.
    expect(byGraph).toContain("drawArrays(4, 0, 3)");
  });

  it("reports feedback statically, and the backend then does not draw it", async () => {
    // The static rule and the runtime refusal are one rule (R-4, R-5, R-6),
    // checked against each other on one graph.
    const test = await harness();
    const surface = new RenderTarget({ width: 32, height: 32 });
    const root = new Scene();
    root.add(new Renderable(planeGeometry(), new UnlitMaterial()));

    const graph = new RenderGraph();
    graph.addPass("world", { root, views: test.views, target: surface });
    graph.addPass("self", {
      kind: "effect",
      source: surface.colorTexture,
      effect: COPY_EFFECT,
      target: surface,
    });

    const issues = graph.validate();
    expect(issues.map((issue) => issue.code)).toEqual(["feedback"]);

    resolve(test, root);
    test.renderer.render(root, test.views, undefined, surface);
    test.recorder.reset();
    graph.execute(test.renderer);

    // The scene pass drew; the effect that would have sampled its own
    // destination did not.
    expect(test.recorder.countOf("drawElements")).toBe(1);
    expect(test.recorder.countOf("drawArrays")).toBe(0);
  });

  it("composes a ping-pong chain of two effects and a present pass", async () => {
    const test = await harness();
    const front = new RenderTarget({ width: 64, height: 64 });
    const back = new RenderTarget({ width: 64, height: 64 });
    const root = new Scene();
    root.add(new Renderable(planeGeometry(), new UnlitMaterial()));

    const graph = new RenderGraph();
    graph.addPass("world", { root, views: test.views, target: front });
    graph.addPass(
      "grade",
      {
        kind: "effect",
        source: front.colorTexture,
        effect: { kind: "grade", contrast: 1.4 },
        target: back,
      },
      { inputs: ["world"] },
    );
    graph.addPass(
      "restore",
      {
        kind: "effect",
        source: back.colorTexture,
        effect: { kind: "grade", contrast: 1 },
        target: front,
      },
      { inputs: ["grade"] },
    );
    graph.addPass(
      "present",
      { kind: "effect", source: front.colorTexture, effect: COPY_EFFECT },
      { inputs: ["restore"] },
    );

    // Every consumer runs after its producer and nothing samples what it
    // writes, which is the whole of what the graph can promise statically.
    expect(graph.validate()).toEqual([]);

    const statistics = createRenderStatistics();
    test.renderer.statistics = statistics;
    resolve(test, root);
    graph.execute(test.renderer);
    test.recorder.reset();
    resolve(test, root);
    expect(graph.execute(test.renderer)).toBe(4);

    // Three full-screen triangles and one scene draw…
    expect(statistics.drawCalls).toBe(8);
    expect(test.recorder.countOf("drawArrays")).toBe(3);
    expect(test.recorder.countOf("drawElements")).toBe(1);
    // …and three off-screen passes, each of which bound and unbound its
    // destination, plus a `present` that bound nothing because the screen is
    // the default drawing buffer.
    expect(test.recorder.countOf("bindFramebuffer")).toBe(6);
    expect(
      test.recorder.callsOf("bindFramebuffer").filter((call) => {
        return call.args[1] === null;
      }),
    ).toHaveLength(3);
  });

  it("reports the WebGL 2 backend as a screen-effect renderer", async () => {
    const test = await harness();
    expect(supportsScreenEffects(test.renderer)).toBe(true);
  });
});
