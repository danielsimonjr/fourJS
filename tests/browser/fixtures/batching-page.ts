/**
 * The page `tests/browser/batching.spec.ts` drives — §65's batched draw path
 * against a **real** WebGL 2 context (R-9, 2026-08-09).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, because a batching
 * demonstration is a gate fixture rather than a site anyone should visit. That
 * is also why it lives under `tests/browser/` — see the spec's header for the
 * whole argument.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourBatchingProbe(batched: boolean): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which renders the same scene with §65 batching on or off and reads the
 * framebuffer back **inside the same call**, before the compositor can see it —
 * so no `preserveDrawingBuffer` is needed and the two reads are of the same
 * surface under the same driver.
 */

import { Vector3 } from "@fourjs/math";
import {
  LitMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  Rectangle,
  Renderable,
  Sprite,
  Texture,
  createRenderStatistics,
  resetRenderStatistics,
} from "@fourjs/render";
import {
  WebglRenderer,
  createGlBatching,
  registerStandardPipeline,
} from "@fourjs/render-webgl";
import {
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  createFullscreenViewport,
  type Viewport,
  resolveWorldTransforms,
} from "@fourjs/scene";
import { boxGeometry, planeGeometry, sphereGeometry } from "@fourjs/geometry";

/** Canvas size the spec creates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** The axis every sprite in the row is spun about, so the batch bakes a rotation. */
const AXIS_Z = new Vector3(0, 0, 1);

/** A 4 × 4 checker, opaque, so a sprite's uv mapping is visible in the pixels. */
function checker(): Texture {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i += 1) {
    const on = ((i % 4) + Math.floor(i / 4)) % 2 === 0;
    data[i * 4] = on ? 255 : 40;
    data[i * 4 + 1] = on ? 90 : 200;
    data[i * 4 + 2] = on ? 40 : 220;
    data[i * 4 + 3] = 255;
  }
  return new Texture({ width: 4, height: 4, data });
}

/**
 * The scene: a row of rectangles over one material, a row of sprites over one
 * atlas material, and one lone rectangle over a material of its own — so the
 * frame contains two batchable runs and one draw that can never join either.
 */
function buildScene(): Scene {
  const scene = new Scene();
  const shapeMaterial = new UnlitMaterial({ color: [0.95, 0.35, 0.2, 1] });
  for (let i = 0; i < 6; i += 1) {
    const shape = new Rectangle({
      material: shapeMaterial,
      width: 1.1,
      height: 1.1,
    });
    shape.transform.position.set(i * 1.3 - 3.2, 1.4, 0);
    scene.add(shape);
  }

  const spriteMaterial = new SpriteMaterial({ texture: checker() });
  for (let i = 0; i < 6; i += 1) {
    const quad = new Sprite(spriteMaterial, { width: 1.1, height: 1.1 });
    quad.transform.position.set(i * 1.3 - 3.2, -0.2, 0);
    quad.transform.rotation.setFromAxisAngle(AXIS_Z, i * 0.2);
    scene.add(quad);
  }

  const lone = new Renderable(
    planeGeometry({ width: 2, height: 0.8 }),
    new UnlitMaterial({ color: [0.2, 0.4, 0.95, 1] }),
  );
  lone.transform.position.set(0, -1.8, 0);
  scene.add(lone);

  resolveWorldTransforms(scene);
  return scene;
}

declare global {
  interface Window {
    fourBatchingProbe?: (batched: boolean) => {
      pixels: number[];
      drawCalls: number;
    };
    /** W11.4: eight sprites over eight distinct textures (two samplers). */
    fourAtlasProbe?: (
      atlas: boolean,
      frames: number,
    ) => {
      pixels: number[];
      drawCalls: number;
      uploads: number;
      stats: unknown;
    };
    /** R-22: two runs of shared-geometry shaded meshes (lit, standard). */
    fourShadedBatchingProbe?: (instanced: boolean) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "batching-canvas";
document.body.append(canvas);

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;
const scene = buildScene();
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
// A camera is a node: content at z = 0 is only in front of it once it is moved
// back past its own near plane (§47), exactly as `examples/first-2d-scene` does.
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);
// Tests typecheck gate (2026-08-21): this read
// `createFullscreenViewport(camera, { clearColor: [0, 0, 0, 1] })`, whose
// second parameter is the view **id** (a string), not an options object — so
// the page asked for an opaque black clear and got a view with no
// `clearColor` at all, i.e. one that never cleared. Spreading the fullscreen
// viewport and setting the field is how `viewport.ts` documents it.
const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];
const batching = createGlBatching();

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourBatchingProbe = (batched: boolean) => {
    renderer.batching = batched ? batching : null;
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so no `preserveDrawingBuffer` is needed and both probes read the
    // same surface.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["batchingReady"] = "1";
  installShadedProbe(gl);
  installAtlasProbe(gl);
});

// --- R-22: instanced shaded meshes -----------------------------------------

registerStandardPipeline();

/**
 * Two rows of meshes over one geometry and one material each - a lit row of
 * spheres and a standard row of boxes - with rotation and NON-UNIFORM scale on
 * every instance, so a wrong per-instance normal matrix shows up as a changed
 * shading rather than hiding behind uniform scale.
 */
function buildShadedScene(): Scene {
  const shaded = new Scene();
  shaded.add(new DirectionalLight({ intensity: 1 }));
  shaded.ambientLight[0] =
    shaded.ambientLight[1] =
    shaded.ambientLight[2] =
      0.15;
  const litMaterial = new LitMaterial({ color: [0.9, 0.5, 0.3, 1] });
  const sphere = sphereGeometry({ radius: 0.5 });
  for (let i = 0; i < 5; i += 1) {
    const mesh = new Renderable(sphere, litMaterial);
    mesh.transform.position.set(i * 1.5 - 3, 1.1, 0);
    mesh.transform.scale.set(1 + i * 0.12, 1.5 - i * 0.1, 0.8);
    mesh.transform.rotation.setFromAxisAngle(AXIS_Z, i * 0.4);
    shaded.add(mesh);
  }
  const standardMaterial = new StandardMaterial({
    baseColor: [0.3, 0.6, 0.9, 1],
    metalness: 0.2,
    roughness: 0.4,
  });
  const box = boxGeometry({ width: 0.8, height: 0.8, depth: 0.8 });
  for (let i = 0; i < 5; i += 1) {
    const mesh = new Renderable(box, standardMaterial);
    mesh.transform.position.set(i * 1.5 - 3, -1.1, 0);
    mesh.transform.scale.set(1.3 - i * 0.1, 1 + i * 0.15, 0.9);
    mesh.transform.rotation.setFromAxisAngle(AXIS_Z, 0.3 + i * 0.35);
    shaded.add(mesh);
  }
  resolveWorldTransforms(shaded);
  return shaded;
}

const shadedScene = buildShadedScene();
const shadedCamera = new PerspectiveCamera({ aspect: WIDTH / HEIGHT });
shadedCamera.transform.position.set(0, 0, 8);
shadedCamera.updateProjectionMatrix();
resolveWorldTransforms(shadedCamera);
const shadedViews: Viewport[] = [
  { ...createFullscreenViewport(shadedCamera), clearColor: [0, 0, 0, 1] },
];

function installShadedProbe(gl: WebGL2RenderingContext | null): void {
  window.fourShadedBatchingProbe = (instanced: boolean) => {
    renderer.batching = instanced ? batching : null;
    resetRenderStatistics(statistics);
    renderer.render(shadedScene, shadedViews);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["shadedBatchingReady"] = "1";
}

// --- W11.4: atlas grouping of distinct textures -----------------------------

/** An 8 x 8 opaque texture with a per-seed gradient and a diagonal stripe. */
function patterned(seed: number, filter: "nearest" | "linear"): Texture {
  const data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const at = (y * 8 + x) * 4;
      const stripe = (x + y + seed) % 4 === 0;
      data[at] = stripe ? 250 : (seed * 53 + x * 24) % 256;
      data[at + 1] = stripe ? 250 : (seed * 97 + y * 28) % 256;
      data[at + 2] = stripe ? 30 : (seed * 31 + 120) % 256;
      data[at + 3] = 255;
    }
  }
  return new Texture({ width: 8, height: 8, data, filter });
}

/**
 * Two rows of four sprites, every one over its own material and texture:
 * the top row samples `nearest`, the bottom row `linear`. The consecutive-
 * same-material tier cannot merge any of them; the atlas tier makes one run
 * per sampler (two page textures), so two draws instead of eight.
 */
function buildAtlasScene(): Scene {
  const atlasScene = new Scene();
  for (let row = 0; row < 2; row += 1) {
    const filter = row === 0 ? "nearest" : "linear";
    for (let i = 0; i < 4; i += 1) {
      const quad = new Sprite(
        new SpriteMaterial({ texture: patterned(row * 4 + i, filter) }),
        { width: 1.4, height: 1.4 },
      );
      quad.transform.position.set(i * 1.8 - 2.7, row === 0 ? 1.2 : -1.2, 0);
      atlasScene.add(quad);
    }
  }
  resolveWorldTransforms(atlasScene);
  return atlasScene;
}

const atlasScene = buildAtlasScene();
const atlasBatching = createGlBatching({ atlas: { pageSize: 256 } });

function installAtlasProbe(gl: WebGL2RenderingContext | null): void {
  let uploads = 0;
  if (gl !== null) {
    const texImage2D = gl.texImage2D.bind(gl) as (...a: unknown[]) => void;
    const texSubImage2D = gl.texSubImage2D.bind(gl) as (
      ...a: unknown[]
    ) => void;
    (gl as unknown as Record<string, unknown>)["texImage2D"] = (
      ...a: unknown[]
    ) => {
      uploads += 1;
      texImage2D(...a);
    };
    (gl as unknown as Record<string, unknown>)["texSubImage2D"] = (
      ...a: unknown[]
    ) => {
      uploads += 1;
      texSubImage2D(...a);
    };
  }
  window.fourAtlasProbe = (atlas: boolean, frames: number) => {
    renderer.batching = atlas ? atlasBatching : null;
    for (let f = 0; f < frames; f += 1) {
      uploads = 0;
      resetRenderStatistics(statistics);
      renderer.render(atlasScene, views);
    }
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels: Array.from(pixels),
      drawCalls: statistics.drawCalls,
      uploads,
      stats: atlas ? (atlasBatching.atlasStatistics?.() ?? null) : null,
    };
  };
  document.body.dataset["atlasReady"] = "1";
}
