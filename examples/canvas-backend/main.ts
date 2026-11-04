/**
 * `@fourjs/render-canvas` end to end: a Y-up orthographic scene drawn by the
 * Canvas 2D backend (§62). The page draws once on load and exposes a probe so
 * the browser gate can redraw with and without the meshes.
 */

import { boxGeometry, circleGeometry2D } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import { Vector3 } from "@fourjs/math";
import { Renderable } from "@fourjs/render";
import { Canvas2dRenderer } from "@fourjs/render-canvas";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

export interface CanvasProbe {
  readonly dataUrl: string;
  readonly litPixels: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

declare global {
  interface Window {
    fourCanvasProbe?: (withMeshes: boolean) => CanvasProbe;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("#scene is missing");

function makeScene(): { scene: Scene; camera: OrthographicCamera } {
  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  scene.add(camera);
  return { scene, camera };
}

const full = makeScene();
// The meshes-removed control: the same camera and viewport, nothing to draw.
const control = makeScene();

const disc = new Renderable(
  circleGeometry2D({ radius: 1.5, segments: 64 }),
  new UnlitMaterial({ color: [0.1, 0.6, 1, 1] }),
);
disc.transform.position.set(-1.5, 0.5, 0);
full.scene.add(disc);
const box = new Renderable(
  boxGeometry({ width: 2, height: 2, depth: 0.1 }),
  new UnlitMaterial({ color: [1, 0.4, 0.1, 1] }),
);
box.transform.position.set(1.8, -0.5, 0);
box.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), 0.5);
full.scene.add(box);

// The probe reads pixels back every draw; `willReadFrequently` keeps Chromium
// from migrating the canvas to software mid-run (which would change AA, §33).
const renderer = new Canvas2dRenderer({
  contextAttributes: { willReadFrequently: true },
});

void renderer.initialize({ canvas }).then(() => {
  const context = canvas.getContext("2d");
  window.fourCanvasProbe = (withMeshes: boolean): CanvasProbe => {
    const { scene, camera } = withMeshes ? full : control;
    resolveWorldTransforms(scene);
    const statistics = renderer.statistics;
    if (statistics !== null) {
      statistics.drawCalls = 0;
      statistics.triangles = 0;
    }
    renderer.render(scene, [
      { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
    ]);
    let lit = 0;
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
    if (pixels !== undefined) {
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (
          pixels.data[i] > 8 ||
          pixels.data[i + 1] > 8 ||
          pixels.data[i + 2] > 8
        ) {
          lit += 1;
        }
      }
    }
    return {
      dataUrl: canvas.toDataURL(),
      litPixels: lit,
      drawCalls: statistics?.drawCalls ?? 0,
      triangles: statistics?.triangles ?? 0,
    };
  };
  window.fourCanvasProbe(true);
  document.body.dataset["canvasReady"] = "1";
});
