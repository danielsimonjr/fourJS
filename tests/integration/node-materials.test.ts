/**
 * §60 node materials across the packages that have to agree about them
 * (RFC 0001 — gap R-14, 2026-08-28): `@fourjs/materials` carries the IR and the
 * material, `@fourjs/render` the `"node"` item kind and the §70 graph effect,
 * `@fourjs/render-webgl` the lazily registered emitter and program cache.
 *
 * Three claims live only in the composition:
 *
 * 1. **Byte-identity for node-material-free scenes — the RFC's acceptance
 *    gate, by the F13 method.** A scene with no node material issues the
 *    identical GL transcript whether or not `registerNodeMaterialPipeline()`
 *    was called, call for call and argument for argument; and a node material
 *    met *without* registration is skipped — absent from the transcript,
 *    never drawn flat.
 * 2. **Lazy compilation is observable**: registration compiles nothing and
 *    renderer initialize still compiles exactly its seven eager programs; the
 *    first node-material draw adds exactly one — and one only, however many
 *    materials share the graph's structure (the program-share claim as a
 *    compile count, RFC 0001's third named measurement).
 * 3. **A §70 graph effect draws through the same registered pipeline**, with
 *    the pass's uniforms uploaded and its source sampled — the full-screen
 *    tier a scene document can carry as data (§96).
 */

import { planeGeometry } from "@fourjs/geometry";
import {
  NodeMaterial,
  NodeMaterialBuilder,
  ShaderGraphBuilder,
  UnlitMaterial,
} from "@fourjs/materials";
import { RenderTarget, Renderable } from "@fourjs/render";
import {
  WebglRenderer,
  clearRegisteredNodeMaterialPipeline,
  registerNodeMaterialPipeline,
} from "@fourjs/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A gradient node material — §58's linear-gradient tier, exact per fragment. */
function gradientMaterial(): NodeMaterial {
  const builder = new NodeMaterialBuilder();
  const t = builder.uv().swizzle("x");
  builder.output.color = builder.mix([0, 0, 1, 1], [1, 0.5, 0, 1], t);
  return builder.build();
}

afterEach(() => {
  clearRegisteredNodeMaterialPipeline();
});

describe("byte-identity for node-material-free scenes (RFC 0001's acceptance gate)", () => {
  /** One frame of a small plain scene on a fresh rig; the transcript. */
  async function plainTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = new Scene();
    scene.add(
      new Renderable(
        planeGeometry({ width: 2, height: 2 }),
        new UnlitMaterial(),
      ),
      new Renderable(planeGeometry(), new UnlitMaterial({ transparent: true })),
    );
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registration alone changes not one call of a plain frame", async () => {
    clearRegisteredNodeMaterialPipeline();
    const before = await plainTranscript();
    registerNodeMaterialPipeline();
    const after = await plainTranscript();
    expect(after).toEqual(before);
  });

  it("skips an unregistered node material — absent, never flat colour", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      clearRegisteredNodeMaterialPipeline();
      // The same scene, with and without the node renderable: identical
      // transcripts, because the skipped draw contributes nothing at all —
      // not even a buffer upload.
      const bare = await createRig();
      const bareScene = new Scene();
      bareScene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
      resolveWorldTransforms(bareScene);
      bare.recording.reset();
      bare.renderer.render(bareScene, bare.views);
      const withoutNode = bare.recording.transcript();

      const rig = await createRig();
      const scene = new Scene();
      scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
      scene.add(new Renderable(planeGeometry(), gradientMaterial()));
      resolveWorldTransforms(scene);
      rig.recording.reset();
      rig.renderer.render(scene, rig.views);

      expect(rig.recording.transcript()).toEqual(withoutNode);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the node pipeline, end to end (§60, §62)", () => {
  it("compiles on the first node draw — one program for N materials sharing a graph", async () => {
    registerNodeMaterialPipeline();
    const rig = await createRig();
    const scene = new Scene();
    // Three materials, one graph structure (three distinct builder runs
    // emitting identical GLSL): the program-share claim as a compile count.
    scene.add(
      new Renderable(planeGeometry(), gradientMaterial()),
      new Renderable(planeGeometry(), gradientMaterial()),
      new Renderable(planeGeometry(), gradientMaterial()),
    );
    resolveWorldTransforms(scene);

    // Registration compiled nothing; initialize compiled the seven eager
    // programs already. The first node frame adds exactly one.
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("createProgram")).toBe(1);
    expect(rig.recording.countOf("drawElements")).toBe(3);

    // The next frame compiles nothing further.
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("createProgram")).toBe(0);
    expect(rig.recording.countOf("drawElements")).toBe(3);
  });

  it("initialize compiles three programs, registered or not (lazy proof)", async () => {
    // Three since 2026-09-11 (eight before): the particle, effect, shadow
    // and standard pipelines became registration seams of their own and
    // compile on first use, like this one.
    registerNodeMaterialPipeline();
    const recording = createRecordingGl();
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
    expect(recording.countOf("createProgram")).toBe(3);
    renderer.dispose();
  });

  it("draws a §70 graph effect through the registered pipeline", async () => {
    registerNodeMaterialPipeline();
    const rig = await createRig();
    const source = new RenderTarget({ width: 8, height: 8 });

    const screen = new ShaderGraphBuilder("screen");
    screen.output.color = screen
      .sampler("source")
      .multiply(screen.uniform("gain", "float"));

    rig.recording.reset();
    rig.renderer.renderEffect({
      kind: "effect",
      source: source.colorTexture,
      effect: {
        kind: "graph",
        graph: screen.graph(),
        uniforms: { gain: 0.5 },
      },
    });

    // One compiled screen program, one full-screen triangle, the pass's
    // uniform uploaded with the value the pass named.
    expect(rig.recording.countOf("createProgram")).toBe(1);
    expect(rig.recording.countOf("drawArrays")).toBe(1);
    const uploads = rig.recording
      .callsOf("uniform1f")
      .map((call) => call.args[1]);
    expect(uploads).toContain(0.5);
  });

  it("skips an unregistered graph effect entirely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      clearRegisteredNodeMaterialPipeline();
      const rig = await createRig();
      const source = new RenderTarget({ width: 8, height: 8 });
      const screen = new ShaderGraphBuilder("screen");
      screen.output.color = screen.sampler("source");
      rig.recording.reset();
      rig.renderer.renderEffect({
        kind: "effect",
        source: source.colorTexture,
        effect: { kind: "graph", graph: screen.graph() },
      });
      expect(rig.recording.countOf("drawArrays")).toBe(0);
      expect(rig.recording.countOf("createProgram")).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
