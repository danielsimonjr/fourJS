/**
 * §63 transient targets on the real WebGL 2 backend (W6.1): a chain of
 * transient passes aliases two physical slots, the slots persist across
 * frames (no new GL framebuffers after the first frame), and the renderer's
 * pool owns and releases them.
 */
import { RenderGraph, Renderable } from "@fourjs/render";
import { WebglRenderer } from "@fourjs/render-webgl";
import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";

describe("RenderGraph transients on WebGL 2", () => {
  it("aliases, persists across frames, and releases on dispose", async () => {
    const recorder = createRecordingGl();
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
    renderer.resize(128, 128);
    const scene = new Scene();
    const camera = new OrthographicCamera({
      left: -1,
      right: 1,
      bottom: -1,
      top: 1,
    });
    camera.transform.position.set(0, 0, 5);
    scene.add(camera);
    scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [1, 0, 0, 1] }),
      ),
    );
    const views = [createFullscreenViewport(camera)];

    const graph = new RenderGraph();
    const spec = { width: 32, height: 32 };
    graph.addPass("a", { root: scene, views }, { transient: spec });
    graph.addPass(
      "b",
      { root: scene, views },
      { transient: spec, inputs: ["a"] },
    );
    graph.addPass(
      "c",
      { root: scene, views },
      { transient: spec, inputs: ["b"] },
    );
    graph.addPass("screen", { root: scene, views }, { inputs: ["c"] });

    resolveWorldTransforms(scene);
    expect(
      graph.execute(renderer, undefined, { width: 128, height: 128 }),
    ).toBe(4);
    const plan = graph.compile(renderer);
    expect(plan?.slots).toHaveLength(2);
    expect(graph.transientTarget("a")).toBe(graph.transientTarget("c"));
    const first = graph.transientTarget("a");
    const callsAfterFirst = recorder.calls.filter(
      (c) => c.name === "createFramebuffer",
    ).length;
    resolveWorldTransforms(scene);
    graph.execute(renderer);
    expect(graph.transientTarget("a")).toBe(first);
    expect(
      recorder.calls.filter((c) => c.name === "createFramebuffer").length,
    ).toBe(callsAfterFirst);
    expect(graph.usageTransitions().length).toBeGreaterThan(0);
    renderer.dispose();
    expect(first?.disposed).toBe(true);
  });
});
