/**
 * The page `tests/browser/skinning.spec.ts` drives — §54's GPU skinning
 * against a **real** WebGL 2 context (RFC 0003, 2026-08-28).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it — `clipping-page.ts`'s argument, unchanged,
 * plus this packet's own: no example calls `registerSkinningPipeline()`, and
 * that is deliberate (the pipeline-cost law — a build that never skins
 * carries none of the skinned programs), so the registered path can only be
 * proven on a page built for it.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourSkinningProbe(angle: number): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which rotates the rig's second bone by `angle` about +Z, renders, and reads
 * the framebuffer back inside the same call.
 *
 * ## The scene is the deformation claim, and nothing else
 *
 * One orange column, two stacked quads: the lower quad's four vertices follow
 * joint 0 (the root bone, at the mesh origin), the upper quad's follow joint
 * 1 (a child bone at `y = 1.5`), each with full weight — §53's
 * `joints`/`weights` at their fixed locations, through the ordinary geometry
 * cache. The inverse bind matrices put the rig's rest pose exactly where the
 * vertices are authored, so at `angle = 0` the column stands upright, and at
 * `angle = −π/2` the upper segment swings to the right about the elbow —
 * pixels appear in a region the bind pose cannot produce, and vanish from one
 * only the bind pose fills. That double displacement, measured in world
 * rectangles, is what separates "the vertex stage skinned" from every
 * bind-pose failure mode (an ignored palette, an identity skin matrix, a
 * skipped upload) — any of those renders the same picture at both angles.
 */

import { BufferGeometry } from "@fourjs/geometry";
import { Vector3 } from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import {
  Mesh,
  createRenderStatistics,
  resetRenderStatistics,
} from "@fourjs/render";
import { WebglRenderer, registerSkinningPipeline } from "@fourjs/render-webgl";
import {
  Bone,
  OrthographicCamera,
  Scene,
  Skeleton,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";

/** Canvas size the spec creates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units. */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

/** Where the elbow — the second bone — sits on the column. */
const ELBOW_Y = 1.5;

/** The content's colour, unambiguous against the black clear. */
const ORANGE: [number, number, number, number] = [0.95, 0.45, 0.1, 1];

declare global {
  interface Window {
    /** Set by the spec before the bundle runs: `"texture"` = bone-texture palette. */
    fourSkinningMode?: "gpu" | "texture";
    fourSkinningProbe?: (angle: number) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "skinning-canvas";
document.body.append(canvas);

// The opt-in this fixture exists to exercise (RFC 0003 §5): without this call
// the skinned draw below would be skipped with a warning.
registerSkinningPipeline();

const scene = new Scene();

// Two stacked quads, deliberately not sharing their seam vertices: each
// segment is rigidly bound to one joint with full weight, so the expected
// picture is exact geometry rather than a blend to eyeball.
const geometry = new BufferGeometry({
  positions: new Float32Array([
    -0.5,
    0,
    0,
    0.5,
    0,
    0,
    0.5,
    ELBOW_Y,
    0,
    -0.5,
    ELBOW_Y,
    0,
    -0.5,
    ELBOW_Y,
    0,
    0.5,
    ELBOW_Y,
    0,
    0.5,
    3,
    0,
    -0.5,
    3,
    0,
  ]),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  joints: new Uint16Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
    0, 0, 0, 1, 0, 0, 0,
  ]),
  weights: new Float32Array([
    1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
    0, 0, 0, 1, 0, 0, 0,
  ]),
});

const mesh = new Mesh(geometry, new UnlitMaterial({ color: ORANGE }));
// The bone-texture variant (decision D7): same fixture, same pixel gate.
if (window.fourSkinningMode === "texture") {
  mesh.skinningMode = "texture";
}
const root = new Bone();
const elbow = new Bone();
elbow.transform.position.set(0, ELBOW_Y, 0);
root.add(elbow);
mesh.add(root);

// Bind pose = authored pose: root at the origin (identity bind), elbow at
// (0, 1.5, 0) — its inverse bind translates back down.
const binds = new Float32Array(32);
for (const base of [0, 16]) {
  binds[base] = 1;
  binds[base + 5] = 1;
  binds[base + 10] = 1;
  binds[base + 15] = 1;
}
binds[16 + 13] = -ELBOW_Y;
mesh.skeleton = new Skeleton([root, elbow], binds);
scene.add(mesh);

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

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourSkinningProbe = (angle: number) => {
    elbow.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), angle);
    resolveWorldTransforms(scene);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back inside the same task, before the compositor can see the
    // surface — the `preserveDrawingBuffer`-free idiom every fixture here
    // uses.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["skinningReady"] = "1";
});
