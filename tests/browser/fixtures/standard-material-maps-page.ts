import { planeGeometry } from "@fourjs/geometry";
import { StandardMaterial } from "@fourjs/materials";
import { RenderTarget, Renderable, Texture } from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  DirectionalLight,
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

declare global {
  interface Window {
    fourStandardMapsProbe?: () => Promise<Record<string, number[]>>;
  }
}

window.fourStandardMapsProbe = async () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  // This fixture draws a StandardMaterial, and §59's pipeline is a registration
  // seam on WebGL 2 since 2026-09-11. Without this the draws are SKIPPED and
  // every probe reads black - which is exactly what happened.
  registerStandardPipeline();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas });
  const target = new RenderTarget({ width: 16, height: 16 });
  const camera = new OrthographicCamera({
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 10,
  });
  camera.transform.position.z = 2;
  camera.updateProjectionMatrix();
  resolveWorldTransforms(camera);
  const scene = new Scene();
  const light = new DirectionalLight({ intensity: 0.25 });
  const geometry = planeGeometry({ width: 2, height: 2 });
  const material = new StandardMaterial({ baseColor: [0.5, 0.5, 0.5, 1] });
  scene.add(light, new Renderable(geometry, material));
  resolveWorldTransforms(scene);
  const view = {
    ...createFullscreenViewport(camera),
    clearColor: [0, 0, 0, 1] as [number, number, number, number],
  };
  const texture = (rgba: number[]): Texture =>
    new Texture({
      width: 1,
      height: 1,
      data: new Uint8Array(rgba),
      role: "data",
      filter: "nearest",
    });
  const neutral = texture([128, 128, 255, 255]);
  const sideways = texture([255, 128, 128, 255]);
  const blackAo = texture([0, 255, 255, 255]);
  const samples: Record<string, number[]> = {};
  const sample = async (name: string): Promise<void> => {
    renderer.render(scene, [view], undefined, target);
    const pixels = new Uint8Array(await renderer.readPixels(target));
    samples[name] = Array.from(
      pixels.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4),
    );
  };
  try {
    await sample("geometric");
    material.normalMap = neutral;
    await sample("neutral");
    material.normalMap = sideways;
    await sample("sideways");
    material.normalScale = 0;
    await sample("zeroNormalScale");
    material.normalScale = 1;
    const originalUvs = geometry.uvs;
    geometry.uvs = new Float32Array(8);
    await sample("degenerateUvs");
    geometry.uvs = originalUvs;
    material.normalMap = null;

    material.emissive[0] = material.emissive[1] = material.emissive[2] = 0.05;
    scene.ambientLight[0] = scene.ambientLight[1] = scene.ambientLight[2] = 0.4;
    await sample("unoccluded");
    material.occlusionMap = blackAo;
    await sample("fullAo");
    material.occlusionStrength = 0.5;
    await sample("halfAo");
    material.occlusionStrength = 0;
    await sample("zeroAo");
    material.occlusionStrength = 1;
    scene.ambientLight[0] = scene.ambientLight[1] = scene.ambientLight[2] = 0;
    await sample("directAndEmissionWithAo");
    material.occlusionMap = null;
    await sample("directAndEmissionWithoutAo");
    material.occlusionMap = blackAo;
    light.intensity = 0;
    await sample("emissionWithAo");
    return samples;
  } finally {
    neutral.dispose();
    sideways.dispose();
    blackAo.dispose();
    material.dispose();
    geometry.dispose();
    target.dispose();
    renderer.dispose();
  }
};
document.body.dataset["standardMapsReady"] = "1";
