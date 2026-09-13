/**
 * The page `tests/browser/gltf.spec.ts` drives — §78's loader against a
 * **real** WebGL 2 context (A-19's closing packet, 2026-08-29).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it (`clipping-page.ts`'s argument). It renders
 * nothing on its own — the spec reads the **committed fixture files** from
 * `tests/fixtures/gltf/` on the Node side and hands their bytes in, so what
 * this gate proves is that the very files in the repository load, assemble,
 * and draw. The page publishes exactly one function:
 *
 * ```ts
 * fourGltfProbe(files: Record<string, string>): Promise<{
 *   pixels: number[]; drawCalls: number;
 * }>
 * ```
 *
 * where `files` maps fixture-relative names to base64 bodies. The probe
 * builds an `AssetManager` whose injected `FetchLike` serves from that map —
 * the same seam a network build would use — loads `quad.gltf` (which fetches
 * its separate `quad.bin` through the same seam), instantiates it, renders
 * once, and reads the framebuffer back in the same task.
 *
 * The fixture material is deliberately **emissive** orange over a black base
 * colour: emission is light-independent, so the expected picture is exact
 * geometry — the quad's unit square at its node translation — rather than a
 * shaded gradient to eyeball.
 */

import {
  AssetManager,
  createGltfLoader,
  type FetchResponse,
} from "@fourjs/assets";
import { instantiateGltf } from "fourJS";
import { createRenderStatistics, resetRenderStatistics } from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";

/** Canvas size the page creates and the spec reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units (320/8 = 240/6 = 40). */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

declare global {
  interface Window {
    fourGltfProbe?: (files: Record<string, string>) => Promise<{
      pixels: number[];
      drawCalls: number;
    }>;
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "gltf-canvas";
document.body.append(canvas);

/** Decodes a base64 body into the buffer a `FetchResponse` hands out. */
function bufferOf(base64: string): ArrayBuffer {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes.buffer;
}

const scene = new Scene();
const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 10,
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);
const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];

// The loader assembles a `StandardMaterial`, and §59's pipeline is a
// registration seam on WebGL 2 since 2026-09-11.
registerStandardPipeline();
const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourGltfProbe = async (files: Record<string, string>) => {
    // The injected transport: exactly the manager's own seam, served from
    // the committed bytes the spec handed over.
    const fetchFixture = (url: string): Promise<FetchResponse> => {
      const name = url.split("/").pop() ?? url;
      const body = files[name];
      if (body === undefined) {
        return Promise.reject(new Error(`no fixture body for "${url}"`));
      }
      const buffer = bufferOf(body);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(buffer),
        text: () => Promise.reject(new Error("binary")),
        json: () => Promise.reject(new Error("binary")),
      });
    };
    const assets = new AssetManager({ fetch: fetchFixture });
    const loader = createGltfLoader({ fetch: fetchFixture });
    const asset = await assets.load("/fixtures/quad.gltf", loader);
    const instance = instantiateGltf(asset);
    if (instance.scene !== null) {
      scene.add(instance.scene);
    }

    resolveWorldTransforms(scene);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back inside the same task, before the compositor can see the
    // surface — the `preserveDrawingBuffer`-free idiom every fixture uses.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["gltfReady"] = "1";
});
