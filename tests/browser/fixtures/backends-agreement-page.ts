/**
 * The page `tests/browser/backends-agreement.spec.ts` drives — one scene drawn
 * by `@fourjs/render-canvas` and `@fourjs/render-svg`, the SVG rasterized
 * through an `Image`, and the two pixel buffers compared.
 */

import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import { Mesh } from "@fourjs/render";
import { Canvas2dRenderer } from "@fourjs/render-canvas";
import { SvgRenderer } from "@fourjs/render-svg";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

interface Agreement {
  readonly width: number;
  readonly height: number;
  readonly total: number;
  readonly differing: number;
  readonly exact: number;
  readonly litCanvas: number;
  readonly litSvg: number;
}

declare global {
  interface Window {
    fourAgreementProbe?: () => Promise<Agreement>;
  }
}

/** Per-channel difference (of 255) above which a pixel counts as different. */
const TOLERANCE = 16;
const W = 640;
const H = 360;

function buildScene(): { scene: Scene; camera: OrthographicCamera } {
  const scene = new Scene();
  for (let i = 0; i < 6; i += 1) {
    const mesh = new Mesh(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({ color: [1, 0.25 * (i % 4), 0, 1] }),
    );
    mesh.position.set(-6 + i * 2.4, i % 2 === 0 ? 1 : -1, 0);
    scene.add(mesh);
  }
  const camera = new OrthographicCamera({
    left: -8,
    right: 8,
    bottom: -4.5,
    top: 4.5,
  });
  camera.transform.position.set(0, 0, 20);
  camera.updateProjectionMatrix();
  scene.add(camera);
  resolveWorldTransforms(scene);
  return { scene, camera };
}

function pixels(source: CanvasImageSource): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, W, H).data;
}

window.fourAgreementProbe = async (): Promise<Agreement> => {
  const { scene, camera } = buildScene();
  const view = createFullscreenViewport(camera);
  view.clearColor = [0, 0, 0, 1];

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  const canvasRenderer = new Canvas2dRenderer({
    contextAttributes: { willReadFrequently: true },
  });
  await canvasRenderer.initialize({ canvas });
  canvasRenderer.resize(W, H);
  canvasRenderer.render(scene, [view]);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.appendChild(svg);
  const svgRenderer = new SvgRenderer();
  await svgRenderer.initialize({ canvas: svg });
  svgRenderer.resize(W, H);
  svgRenderer.render(scene, [view]);
  // Without this, AA conflation on the shared quad diagonal blends 75% (not
  // 100%) coverage on 480 px; the canvas backend does not exhibit the seam.
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));

  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = (): void => resolve();
    image.onerror = (): void => reject(new Error("svg failed to rasterize"));
    image.src = url;
  });
  URL.revokeObjectURL(url);

  const a = pixels(canvas);
  const b = pixels(image);
  let differing = 0;
  let exact = 0;
  let litCanvas = 0;
  let litSvg = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    const dg = Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
    const db = Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    if (dr + dg + db > 0) exact += 1;
    // Edge antialiasing differs by a few levels between the rasterizers.
    if (Math.max(dr, dg, db) > TOLERANCE) differing += 1;
    if ((a[i] ?? 0) + (a[i + 1] ?? 0) + (a[i + 2] ?? 0) > 0) litCanvas += 1;
    if ((b[i] ?? 0) + (b[i + 1] ?? 0) + (b[i + 2] ?? 0) > 0) litSvg += 1;
  }
  canvasRenderer.dispose();
  svgRenderer.dispose();
  return {
    width: W,
    height: H,
    total: W * H,
    differing,
    exact,
    litCanvas,
    litSvg,
  };
};
document.body.dataset["agreementReady"] = "1";
