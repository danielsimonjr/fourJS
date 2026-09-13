/**
 * R-13 — §59's `StandardMaterial` and the metallic-roughness pipeline, driving
 * the real WebGL 2 backend (2026-08-08).
 *
 * `StandardMaterial` lives in `@fourjs/materials` and names no GL type;
 * `@fourjs/render`'s render list turns it into a `"standard"` item; the WebGL 2
 * backend draws it through `StandardProgram`. Those are three packages
 * agreeing, and no unit test inside any one of them can check the agreement —
 * which is what this file is for. Four claims:
 *
 * 1. **A scene without a `StandardMaterial` is byte-identical.** The steady-
 *    state transcript below was recorded from the build immediately before
 *    R-13 (HEAD `e0ddd3b`) for a scene that exercises every pipeline that
 *    existed then — flat unlit, unlit + texture + vertex colours, lit under a
 *    directional light, lit + texture, and a blended sprite — and is pinned
 *    here, so this is a genuine before/after comparison rather than a
 *    restatement of what the code currently happens to do. This is the sixth
 *    run of the recorded-sequence method (R-4, R-5, R-6, F13, A-1, and now
 *    R-13).
 * 2. **The sixth program is compiled at initialization and never in a frame.**
 *    §61 forbids `render` from throwing, and a shader compile is exactly the
 *    operation that can. That is the one thing R-13 costs an application which
 *    never uses §59.
 * 3. **A standard draw really is a different pipeline, not a renamed lit one.**
 *    It switches programs, uploads the eye position a specular lobe needs, and
 *    uploads §59's own three surface parameters — while reading the *same*
 *    §68 lights the lit pipeline reads.
 * 4. **The two surface families compose in one scene.** A `LitMaterial` and a
 *    `StandardMaterial` in one render list produce one program switch each and
 *    one light collection walk between them, in scene-graph order.
 *
 * The scenes are real and only the GL context is a double, for the reason
 * `render-graph.test.ts` gives at length.
 */

import { BufferGeometry, boxGeometry, planeGeometry } from "@fourjs/geometry";
import {
  LitMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  Renderable,
  Sprite,
  Texture,
  buildRenderList,
  isStandardItem,
  type RenderItem,
} from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  DirectionalLight,
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

// §59's standard surface is a registration seam on WebGL 2 since 2026-09-11
// (owner decision; the skinning shape): one explicit call links the program,
// and the renderer compiles it on the first `StandardMaterial` draw.
// Registered for the file, as an application registers once at setup.
registerStandardPipeline();

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  scene.ambientLight[0] = 0.2;
  scene.ambientLight[1] = 0.2;
  scene.ambientLight[2] = 0.25;

  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 6, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 6 × 6 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 8);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    camera,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order — the
 * aliasing `render-effects.test.ts` introduced and the reason it gives:
 * compiling one more program at initialization shifts every handle minted
 * afterwards by a constant, so raw serials cannot be compared across builds
 * while the *relative* order of the frame's own handles can, and must.
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

/** A 2×2 RGBA8 checker, the smallest texture that is not a solid colour. */
function checkerTexture(): Texture {
  const data = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i += 1) {
    const value = i % 2 === 0 ? 255 : 64;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return new Texture({ width: 2, height: 2, data });
}

/** Positions, uvs and per-vertex colours — R-19's two unlit multipliers. */
function coloredQuad(): BufferGeometry {
  return new BufferGeometry({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    mode: "triangles",
  });
}

/**
 * The scene `FRAME_BEFORE_R13` was recorded from: one draw through every
 * pipeline that existed before §59's, in scene-graph order.
 *
 * Deliberately **not** a minimal scene. The property R-13 has to prove is that
 * a sixth pipeline changes nothing for anybody else, and "anybody else" is the
 * unlit, lit and sprite families with their texture and vertex-colour switches
 * — the paths a one-quad scene would leave untested.
 */
function everyOlderPipeline(test: Harness): void {
  const light = new DirectionalLight({ color: [1, 0.95, 0.9], intensity: 2 });
  light.transform.position.set(0, 3, 3);
  test.scene.add(light);

  const texture = checkerTexture();
  test.scene.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ color: [1, 0, 0, 1] })),
  );
  test.scene.add(
    new Renderable(
      coloredQuad(),
      new UnlitMaterial({ map: texture, vertexColors: true }),
    ),
  );
  test.scene.add(
    new Renderable(
      boxGeometry(),
      new LitMaterial({ color: [0.8, 0.8, 0.85, 1] }),
    ),
  );
  test.scene.add(
    new Renderable(boxGeometry(), new LitMaterial({ map: texture })),
  );
  test.scene.add(new Sprite(new SpriteMaterial({ texture }), { width: 2 }));
}

/**
 * The GL a steady-state frame of {@link everyOlderPipeline} emitted on
 * **2026-08-08, at commit `e0ddd3b`** — the last build before §59's
 * `StandardMaterial` existed.
 *
 * Recorded, not written. Do not "fix" a failure here by re-recording: this list
 * is the regression guard for every pixel golden and every browser test, and a
 * change to it is a change to what a frame that uses none of §59 draws.
 * Updated 2026-09-09: lit `setModel` now also uploads `uniform mat3
 * normalMatrix` (identity for these identity models) — sequence only; shading
 * of non-singular models is the same inverse-transpose.
 *
 * One caveat stated rather than hidden: the double records typed-array
 * arguments **by reference**, and every upload in this backend goes through one
 * shared scratch buffer (plan D7), so the numbers inside `[...]` below are the
 * scratch's *final* contents rather than each call's own. That is the shared
 * helper's long-standing behaviour and it is why this transcript is a proof
 * about the **sequence** — which calls, in which order, with which handles and
 * which scalar arguments. The per-draw uniform *values* are asserted by the
 * unit tests in `packages/render-webgl`, which snapshot the arrays.
 */
const FRAME_BEFORE_R13: readonly string[] = [
  "useProgram(createProgram#0)",
  "scissor(0, 0, 256, 256)",
  "viewport(0, 0, 256, 256)",
  "clearDepth(1)",
  "clear(256)",
  "uniformMatrix4fv(getUniformLocation#0, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform1i(getUniformLocation#1, 0)",
  "uniform1i(getUniformLocation#2, 0)",
  "uniformMatrix4fv(getUniformLocation#3, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#4, [1,1,1,1])",
  "bindVertexArray(createVertexArray#0)",
  "drawElements(4, 6, 5123, 0)",
  "activeTexture(33984)",
  "bindTexture(3553, createTexture#0)",
  "uniform1i(getUniformLocation#1, 1)",
  "uniform1i(getUniformLocation#2, 1)",
  "uniformMatrix4fv(getUniformLocation#3, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#4, [1,1,1,1])",
  "bindVertexArray(createVertexArray#1)",
  "drawElements(4, 6, 5123, 0)",
  "useProgram(createProgram#1)",
  "uniformMatrix4fv(getUniformLocation#5, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform3fv(getUniformLocation#6, [2,1.899999976158142,1.7999999523162842])",
  "uniform3fv(getUniformLocation#7, [2,1.899999976158142,1.7999999523162842])",
  "uniform3fv(getUniformLocation#8, [2,1.899999976158142,1.7999999523162842])",
  "uniform1i(getUniformLocation#9, 0)",
  "uniformMatrix4fv(getUniformLocation#10, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix3fv(getUniformLocation#11, false, [1,0,0,0,1,0,0,0,1])",
  "uniform4fv(getUniformLocation#12, [1,1,1,1])",
  "bindVertexArray(createVertexArray#2)",
  "drawElements(4, 36, 5123, 0)",
  "bindTexture(3553, createTexture#0)",
  "uniform1i(getUniformLocation#9, 1)",
  "uniformMatrix4fv(getUniformLocation#10, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix3fv(getUniformLocation#11, false, [1,0,0,0,1,0,0,0,1])",
  "uniform4fv(getUniformLocation#12, [1,1,1,1])",
  "bindVertexArray(createVertexArray#3)",
  "drawElements(4, 36, 5123, 0)",
  "useProgram(createProgram#2)",
  "uniform1i(getUniformLocation#13, 0)",
  "activeTexture(33984)",
  "enable(3042)",
  "uniformMatrix4fv(getUniformLocation#14, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix4fv(getUniformLocation#15, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#16, [1,1,1,1])",
  "bindTexture(3553, createTexture#0)",
  "bindVertexArray(createVertexArray#4)",
  "drawElements(4, 6, 5123, 0)",
  "disable(3042)",
  "bindTexture(3553, null)",
  "bindVertexArray(null)",
];

describe("R-13 — a scene without a StandardMaterial is byte-identical (§59)", () => {
  it("emits the GL sequence recorded before §59's pipeline existed", async () => {
    const test = await harness();
    everyOlderPipeline(test);

    // Warm every cache — programs, geometry buffers, textures, and the two
    // lazy sampler uploads — so the comparison is about a steady-state frame,
    // as it was when the expected transcript was recorded.
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R13);
  });

  it("compiles the standard pipeline once, on the first standard item, and never again", async () => {
    // Until 2026-09-11 the sixth program was built at initialize beside the
    // other five (R-13's §61 argument: a compile inside a frame can throw).
    // Behind `registerStandardPipeline()` — an owner decision — it compiles
    // on the first `"standard"` item instead, inside the frame's own `try`
    // with a fail-once latch, so a scene that never uses §59 carries neither
    // the program nor its shaders, and one that does pays the compile exactly
    // once per context: a frame of older pipelines compiles nothing, the
    // frame that first meets a StandardMaterial compiles one program, and
    // the frame after that compiles nothing again.
    const test = await harness();
    everyOlderPipeline(test);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();

    test.renderer.render(test.scene, test.views);
    expect(test.recorder.countOf("createProgram")).toBe(0);

    test.scene.add(
      new Renderable(boxGeometry(), new StandardMaterial({ metalness: 1 })),
    );
    resolveWorldTransforms(test.scene);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    expect(test.recorder.countOf("createProgram")).toBe(1);

    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    expect(test.recorder.countOf("createProgram")).toBe(0);
    expect(test.recorder.countOf("compileShader")).toBe(0);
  });
});

describe("R-13 — the render list dispatches §59 on §57's discriminant", () => {
  it("tags a StandardMaterial renderable as a standard item, by material kind", async () => {
    const test = await harness();
    const material = new StandardMaterial({ roughness: 0.4 });
    const mesh = new Renderable(boxGeometry(), material);
    test.scene.add(mesh);
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
    resolveWorldTransforms(test.scene);

    const list: RenderItem[] = [];
    buildRenderList(test.scene, list);

    expect(list.map((item) => item.kind)).toEqual(["standard", "unlit"]);
    const [standard] = list;
    expect(isStandardItem(standard)).toBe(true);
    if (isStandardItem(standard)) {
      // Narrowed by the guard — the point of a separate union arm.
      expect(standard.material).toBe(material);
      expect(standard.material.roughness).toBe(0.4);
    }
  });
});

describe("R-13 — a standard draw is its own pipeline (§59, §68)", () => {
  it("switches program, uploads the eye and §59's surface parameters, and reads §68's lights", async () => {
    const test = await harness();
    const light = new DirectionalLight({ color: [1, 1, 1], intensity: 3 });
    test.scene.add(light);
    test.scene.add(
      new Renderable(
        boxGeometry(),
        new StandardMaterial({
          baseColor: [0.9, 0.7, 0.3, 1],
          metalness: 1,
          roughness: 0.25,
          emissive: [0, 0, 0.5],
        }),
      ),
    );

    // Every `vec3` upload in this backend goes through one shared scratch
    // buffer (plan D7), and the recording double keeps the *reference* — so a
    // test that wants the values a draw actually uploaded has to snapshot them
    // as they go past. That is what this wrapper is; the transcript comparison
    // above deliberately does not need it, because it is a proof about the
    // sequence.
    const vec3Uploads: number[][] = [];
    const context = test.recorder.gl as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const inner = context.uniform3fv;
    context.uniform3fv = (...args: unknown[]): unknown => {
      vec3Uploads.push(Array.from(args[1] as Float32Array));
      return inner(...args);
    };

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    vec3Uploads.length = 0;
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    // Per view: the ambient term, the light's direction and its colour ×
    // intensity, the eye — then, per draw, §59's emissive term.
    expect(vec3Uploads).toHaveLength(5);
    expect(vec3Uploads[0].map((v) => Math.round(v * 100) / 100)).toEqual([
      0.2, 0.2, 0.25,
    ]);
    // `-0` for the two zero components: the direction is the light node's
    // world −Z axis, i.e. a negated column of its world matrix.
    expect(vec3Uploads[1].map((v) => v + 0)).toEqual([0, 0, -1]);
    expect(vec3Uploads[2]).toEqual([3, 3, 3]);
    // The camera sits at +8 on Z (see `harness`), and the standard pipeline is
    // the only one that needs to know where the eye is.
    expect(vec3Uploads[3]).toEqual([0, 0, 8]);
    expect(vec3Uploads[4]).toEqual([0, 0, 0.5]);
    // §59's two scalars, uploaded as authored — the material documents 0…1 and
    // does not clamp, so what is uploaded is exactly what was written.
    const scalars = test.recorder
      .callsOf("uniform1f")
      .map((call) => call.args[1]);
    expect(scalars).toEqual([1, 0.25]);
    // Two programs became current this frame: the unlit one the frame starts
    // in, and the standard one.
    expect(test.recorder.countOf("useProgram")).toBe(2);
    expect(test.recorder.countOf("drawElements")).toBe(1);
  });

  it("draws a lit and a standard surface in one scene, one program switch each", async () => {
    // The composition claim the two families' shared colour space is for: a
    // scene may mix them, and the cost is one pipeline switch where the render
    // list changes `kind` — not two light collections, not two frames.
    const test = await harness();
    test.scene.add(new DirectionalLight({ intensity: 1 }));
    test.scene.add(
      new Renderable(boxGeometry(), new LitMaterial({ color: [1, 1, 1, 1] })),
    );
    test.scene.add(
      new Renderable(boxGeometry(), new StandardMaterial({ roughness: 0.5 })),
    );

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    const programs = test.recorder
      .callsOf("useProgram")
      .map((call) => call.args[0]);
    // Unlit (the frame's resting state), then lit, then standard — scene-graph
    // order, three distinct program handles, no switching back and forth.
    expect(programs).toHaveLength(3);
    expect(new Set(programs).size).toBe(3);
    expect(test.recorder.countOf("drawElements")).toBe(2);
  });

  it("shades a normal-less geometry from the ambient term alone, with no extra call", async () => {
    // The documented fallback: a geometry with no `normals` reads GL's
    // constant default and the fragment stage takes its ambient-only branch.
    // Nothing about the *draw* changes, which is what this asserts.
    const test = await harness();
    test.scene.add(
      new Renderable(
        new BufferGeometry({
          positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
          mode: "triangles",
        }),
        new StandardMaterial(),
      ),
    );

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawArrays")).toBe(1);
    expect(test.recorder.countOf("drawElements")).toBe(0);
  });

  it("binds the base-colour map on unit 0 and switches the sampler back off", async () => {
    // §59's one shipped map, through the same uniform switch and the same
    // single texture unit every other textured pipeline uses (R-19).
    const test = await harness();
    const texture = checkerTexture();
    test.scene.add(
      new Renderable(boxGeometry(), new StandardMaterial({ map: texture })),
    );
    test.scene.add(new Renderable(boxGeometry(), new StandardMaterial()));

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    const bound = test.recorder
      .callsOf("bindTexture")
      .map((call) => call.args[1]);
    // One bind for the mapped draw, one `null` unbind in the frame's `finally`.
    expect(bound).toHaveLength(2);
    expect(bound[1]).toBeNull();
    // `useMap` on for the first draw and off again for the second: two
    // `uniform1i` writes on a program whose sampler unit was uploaded in the
    // warm-up frame.
    const switches = test.recorder
      .callsOf("uniform1i")
      .map((call) => call.args[1]);
    expect(switches).toEqual([1, 0]);
  });
});
