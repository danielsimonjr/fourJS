/**
 * R-15 — §60a colour management, across the four packages that have to agree
 * on it (2026-08-08).
 *
 * §60a is a policy, not a feature: it says where colours are decoded, what
 * space shading happens in, and where the result is encoded. Every one of those
 * sentences spans packages — `@fourjs/math` owns the transfer functions and the
 * CSS grammar, `@fourjs/materials` and `@fourjs/scene` hold authored colours,
 * `@fourjs/render` carries the resource metadata and the output-transform pass,
 * and `@fourjs/render-webgl` is the only place any of it becomes GL. No unit test
 * inside one package can check the agreement, which is what this file is for.
 *
 * Four claims:
 *
 * 1. **A scene that does not opt in is byte-identical.** The whole R-15 tier is
 *    opt-in — untagged textures upload `RGBA8`, no encode switch is ever
 *    uploaded, no extra pass exists — so the recorded transcripts of every
 *    earlier packet (`render-effects.test.ts`'s `FRAME_BEFORE_R6` above all)
 *    still hold, and the pixel goldens with them.
 * 2. **The authored-colour path is one line and lands unchanged.** A CSS string
 *    denotes sRGB (§60a); `parseColor` + `srgbToLinearRGBA` decodes it; the
 *    decoded numbers are what reach `uniform4fv`. Nothing between the string
 *    and the GPU rewrites them.
 * 3. **`colorSpace: "srgb"` reaches GL as an sRGB internal format**, so the
 *    hardware decodes on sample — §60a's "decoded to linear on sample", made
 *    true through the real `Texture` class rather than a double.
 * 4. **The output transform is §60a's final render-graph pass**, driven by
 *    `RenderGraph` like any other pass, with its double-encode rule enforced at
 *    `addPass` rather than discovered on screen.
 */

import { planeGeometry } from "@fourjs/geometry";
import {
  parseColor,
  parseColorRGB,
  srgbToLinear,
  srgbToLinearRGB,
  srgbToLinearRGBA,
  type ColorRGB,
  type ColorRGBA,
} from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import {
  COPY_EFFECT,
  OUTPUT_TRANSFORM_EFFECT,
  RenderGraph,
  RenderTarget,
  Renderable,
  Texture,
} from "@fourjs/render";
import { WebglRenderer, registerEffectPipeline } from "@fourjs/render-webgl";
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

/** Four opaque white texels — the smallest thing the upload path accepts. */
function texels(): Uint8Array {
  return new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255,
  ]);
}

/** `GL_RGBA8` and `GL_SRGB8_ALPHA8`, written out so the test names them. */
const RGBA8 = 0x8058;
const SRGB8_ALPHA8 = 0x8c43;

describe("R-15 — a scene that does not opt in is unchanged (§60a)", () => {
  it("uploads an untagged texture as RGBA8, exactly as before the field existed", async () => {
    const test = await harness();
    const map = new Texture({ width: 2, height: 2, data: texels() });
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial({ map })));

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    const uploads = test.recorder
      .transcript()
      .filter((call) => call.startsWith("texImage2D"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain(String(RGBA8));
    expect(map.colorSpace).toBe("linear");
  });

  it("never uploads the encode switch for a frame with no output transform", async () => {
    // The whole opt-in argument in one assertion: R-15 added a uniform to the
    // effect program, and a frame that does not ask for §60a's transform still
    // issues the calls it always issued, because the CPU mirror starts where
    // GL starts.
    const test = await harness();
    const source = new RenderTarget({ width: 32, height: 32 });
    test.renderer.renderEffect({
      kind: "effect",
      source: source.colorTexture,
      effect: COPY_EFFECT,
    });
    test.recorder.reset();

    test.renderer.renderEffect({
      kind: "effect",
      source: source.colorTexture,
      effect: COPY_EFFECT,
    });

    expect(test.recorder.countOf("uniform1i")).toBe(0);
  });
});

describe("R-15 — the authored-colour path (§60a: strings denote sRGB)", () => {
  it("decodes a CSS string once and hands the linear numbers to the GPU", async () => {
    const test = await harness();

    // §60a's rule, applied: the string is sRGB, the material is linear-light,
    // so the decode happens between them and nowhere else.
    const color: ColorRGBA = [0, 0, 0, 1];
    srgbToLinearRGBA(parseColor("#8000ff"), color);
    test.scene.add(
      new Renderable(planeGeometry(), new UnlitMaterial({ color })),
    );

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // Rounded to `f32` because that is what a `uniform4fv` upload carries; the
    // decode itself is exact in doubles (`@fourjs/math`'s unit tests pin it).
    const expected = [
      Math.fround(srgbToLinear(0x80 / 255)),
      0,
      Math.fround(srgbToLinear(1)),
      1,
    ] as const;
    const uploaded = test.recorder
      .transcript()
      .filter((call) => call.startsWith("uniform4fv"))
      .at(-1);
    expect(uploaded).toBeDefined();
    // The numbers reach GL as they were decoded: no clamp, no re-encode, no
    // second conversion hidden in the material or the backend.
    for (const component of expected) {
      expect(uploaded).toContain(String(component));
    }
  });

  it("decodes a light colour the same way, into §68's three-tuple", () => {
    // `DirectionalLight.color` is `@fourjs/math`'s `ColorRGB` since R-15 — one
    // declaration, re-exported by `@fourjs/scene` — so the same two functions
    // serve a light and a material with no adapter between the packages.
    const light = new DirectionalLight();
    const authored: ColorRGB = parseColorRGB("rgb(255 128 0)");
    srgbToLinearRGB(authored, light.color);

    expect(light.color[0]).toBeCloseTo(1, 12);
    expect(light.color[1]).toBeCloseTo(srgbToLinear(128 / 255), 15);
    expect(light.color[2]).toBe(0);
  });
});

describe("R-15 — sRGB textures decode on sample (§60a, §77)", () => {
  it("allocates an sRGB internal format for a tagged texture", async () => {
    const test = await harness();
    const map = new Texture({
      width: 2,
      height: 2,
      data: texels(),
      colorSpace: "srgb",
    });
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial({ map })));

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    const uploads = test.recorder
      .transcript()
      .filter((call) => call.startsWith("texImage2D"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain(String(SRGB8_ALPHA8));
    expect(uploads[0]).not.toContain(String(RGBA8));
  });
});

describe("R-15 — the output transform is a render-graph pass (§60a, §63)", () => {
  it("presents a linear target to the drawing buffer through one encoded draw", async () => {
    const test = await harness();
    const sceneColor = new RenderTarget({ width: 64, height: 64 });
    const root = new Scene();
    root.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [0.25, 0.5, 1, 1] }),
      ),
    );
    const views = [createFullscreenViewport(new OrthographicCamera(), "world")];

    const graph = new RenderGraph();
    graph.addPass("world", { root, views, target: sceneColor });
    graph.addPass(
      "present",
      {
        kind: "effect",
        source: sceneColor.colorTexture,
        effect: OUTPUT_TRANSFORM_EFFECT,
      },
      { inputs: ["world"] },
    );

    // §60a's "final render-graph pass" is literally that: the graph orders it,
    // validates it, and turns it into one renderer call.
    expect(graph.validate()).toEqual([]);

    resolveWorldTransforms(root);
    test.recorder.reset();
    expect(graph.execute(test.renderer)).toBe(2);

    const transcript = test.recorder.transcript();
    // One scene draw, one full-screen triangle.
    expect(
      transcript.filter((call) => call.startsWith("drawElements")),
    ).toHaveLength(1);
    expect(transcript).toContain("drawArrays(4, 0, 3)");
    // Two `uniform1i` on a cold program: the sampler unit (`0`, once per
    // program lifetime) and §60a's encode switch (`1`, the presenting pass).
    const switches = transcript.filter((call) => call.startsWith("uniform1i"));
    expect(switches).toHaveLength(2);
    expect(switches.filter((call) => call.endsWith(", 1)"))).toHaveLength(1);

    // …and the second identical frame uploads neither: the CPU mirror holds
    // the switch, so presenting through §60a's transform costs nothing per
    // frame beyond the draw itself.
    resolveWorldTransforms(root);
    test.recorder.reset();
    graph.execute(test.renderer);
    expect(test.recorder.countOf("uniform1i")).toBe(0);
  });

  it("refuses a double encode where the mistake is still a wiring error (§85)", () => {
    // The metadata §60a puts on a render target earns its place here: an
    // already-encoded source, or a linear destination, is caught at `addPass`
    // instead of showing up as a washed-out frame.
    const encoded = new RenderTarget({
      width: 32,
      height: 32,
      colorSpace: "srgb",
    });
    const linear = new RenderTarget({ width: 32, height: 32 });
    const graph = new RenderGraph();

    expect(() => {
      graph.addPass("double", {
        kind: "effect",
        source: encoded.colorTexture,
        effect: OUTPUT_TRANSFORM_EFFECT,
      });
    }).toThrow(/double-encode/);

    expect(() => {
      graph.addPass("into-linear", {
        kind: "effect",
        source: linear.colorTexture,
        effect: OUTPUT_TRANSFORM_EFFECT,
        target: linear,
      });
    }).toThrow(/destination render target is tagged "linear"/);

    // …and a correctly wired chain is accepted: linear in, sRGB out.
    expect(() => {
      graph.addPass("present", {
        kind: "effect",
        source: linear.colorTexture,
        effect: OUTPUT_TRANSFORM_EFFECT,
        target: encoded,
      });
    }).not.toThrow();
  });
});
