/**
 * §78 — loading a glTF model, end to end.
 *
 * Added 2026-09-07 because §78 shipped **tested but undemonstrated**: a browser
 * gate and unit tests covered the loader, and no example loaded a model. "Load
 * my model" is the first thing anyone tries with a 3D engine, so the absence
 * was an adoption gap rather than a correctness one.
 *
 * It exists to show the two things a first attempt gets wrong:
 *
 * 1. **The entry point is `createGltfLoader`, not a `loadGltf`.** The loader is
 *    built once and handed to `AssetManager.load`, which owns the cache, the
 *    refcount and the single fetch per URL (§76).
 * 2. **A `.gltf` with an external buffer just works now.** The loader defaults
 *    its transport to `globalThis.fetch`, the same default `AssetManager` makes,
 *    so `createGltfLoader()` fetches the `.bin` beside the document. It did not
 *    until 2026-09-07: this example was written because that first attempt
 *    failed, and the fix came out of writing it. A runtime with no global fetch
 *    still refuses loudly and names `{ fetch }` as the way in.
 *
 * The model is the same `quad.gltf` fixture the browser gate uses: one mesh, one
 * material, one external buffer, no images — the smallest file that still
 * exercises the buffer path that trips people up.
 */
import { Application } from "fourJS/application";
import { AssetManager, createGltfLoader } from "fourJS/assets";
import { instantiateGltf } from "fourJS";
import { PerspectiveCamera, createFullscreenViewport } from "fourJS/scene";
import { WebglRenderer, registerStandardPipeline } from "fourJS/render-webgl";

/** The example's drawing surface. */
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("fourJS example: no #scene in the document.");
const status = document.querySelector<HTMLElement>("#status");
if (status === null) throw new Error("fourJS example: no #status in the document.");

// The loader assembles a StandardMaterial, and §59's pipeline is a registration
// seam on WebGL 2 since 2026-09-11. Without this the standard draws are SKIPPED
// and this example renders an empty canvas.
registerStandardPipeline();
const renderer = new WebglRenderer();
const camera = new PerspectiveCamera({ aspect: 640 / 400, near: 0.1, far: 100 });
// The quad is authored around the origin in the XY plane; back off along +Z.
camera.position.set(0, 0, 3);

const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(640, 400, window.devicePixelRatio);
app.scene.add(camera);

/**
 * The manager owns the cache and the fetch for the document (§76); the loader
 * needs its own transport for the buffers the document names.
 */
const assets = new AssetManager();
const gltfLoader = createGltfLoader();

let meshCount = 0;

const asset = await assets.load("./quad.gltf", gltfLoader);
const instance = instantiateGltf(asset);
if (instance.scene !== null) {
  app.scene.add(instance.scene);
  instance.scene.traverse(() => {
    meshCount += 1;
  });
}

await app.initialize();
app.start();

// §45 phase 1 installs no driver — the host owns the cadence and calls `step`.
let last = performance.now();
requestAnimationFrame(function frame(now) {
  app.step(Math.max(0, now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
});

status.dataset["state"] = "running";
status.dataset["nodes"] = String(meshCount);
status.textContent = `loaded quad.gltf — ${String(meshCount)} node(s) instantiated`;
