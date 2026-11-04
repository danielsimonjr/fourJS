/**
 * The page `tests/browser/backends-svg.spec.ts` drives — the SVG backend
 * (`@fourjs/render-svg`, §62) against a real `<svg>` element. Bundled by the
 * spec with Vite's JavaScript API; not an example and not served.
 *
 * `fourSvgProbe(planes)` renders `planes` unit planes (two triangles each) on a
 * fresh `<svg>` twice, and reports the element counts and `outerHTML` of both
 * runs.
 */

import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import { Mesh } from "@fourjs/render";
import { SvgRenderer } from "@fourjs/render-svg";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

interface Run {
  readonly elementCount: number;
  readonly outerHTML: string;
}

interface Probe {
  readonly runs: readonly [Run, Run];
  readonly polygons: number;
  readonly rects: number;
}

declare global {
  interface Window {
    fourSvgProbe?: (planes: number) => Promise<Probe>;
  }
}

async function once(
  planes: number,
): Promise<Run & { polygons: number; rects: number }> {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.appendChild(svg);
  const renderer = new SvgRenderer();
  await renderer.initialize({ canvas: svg });
  renderer.resize(320, 240);
  const scene = new Scene();
  for (let i = 0; i < planes; i += 1) {
    const mesh = new Mesh(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({ color: [1, 0.25 * (i % 4), 0, 1] }),
    );
    mesh.position.set(-6 + i * 3, i % 2 === 0 ? 1 : -1, 0);
    scene.add(mesh);
  }
  const camera = new OrthographicCamera({
    left: -8,
    right: 8,
    bottom: -6,
    top: 6,
  });
  camera.transform.position.set(0, 0, 20);
  camera.updateProjectionMatrix();
  scene.add(camera);
  resolveWorldTransforms(scene);
  const view = createFullscreenViewport(camera);
  view.clearColor = [0, 0, 0, 1];
  renderer.render(scene, [view]);
  const result = {
    elementCount: svg.children.length,
    outerHTML: svg.outerHTML,
    polygons: svg.querySelectorAll("polygon").length,
    rects: svg.querySelectorAll("rect").length,
  };
  renderer.dispose();
  svg.remove();
  return result;
}

window.fourSvgProbe = async (planes: number): Promise<Probe> => {
  const a = await once(planes);
  const b = await once(planes);
  return { runs: [a, b], polygons: a.polygons, rects: a.rects };
};
document.body.dataset["svgReady"] = "1";
