/**
 * WP-R1.5 — §68's light set and §59's standard surface on the WebGPU backend,
 * across the packages that have to agree on them (2026-08-28).
 *
 * The cross-package half of the packet: `@fourjs/scene` owns the light nodes,
 * `@fourjs/render` owns `collectSceneLights` — the *same* collector, selection
 * rule and packed arrays the GL backend consumes, which is what makes the two
 * backends' light sets §84-consistent by construction — and
 * `@fourjs/render-webgpu` is where the record becomes one uniform buffer
 * instead of five `uniform3fv`/`uniform4fv` calls.
 *
 * Four claims:
 *
 * 1. **A scene with no lit material allocates none of it.** Not the lights
 *    layout, not the buffer, not a normal stream — even over `planeGeometry`,
 *    which carries normals — so every pre-WP-R1.5 transcript is unchanged to
 *    the byte. The frame-level A/B (same-id geometry with and without
 *    normals) is `webgpu-renderer.test.ts`'s; here the claim runs over the
 *    real geometry builders.
 * 2. **A skinned-lit item does not count as lit on this backend.** The
 *    hasLit scan deliberately excludes RFC 0003's kinds — a skinned item is
 *    transcript-invisible here (WP-R1.4), and a light block allocated for
 *    draws that are skipped would break that byte-identity from the side.
 * 3. **One frame's lamps arrive in the uploaded block exactly as the shared
 *    record packs them**: first-eight-in-scene-order selection, premultiplied
 *    colours, `KHR_lights_punctual` cone words, the directional pair, the
 *    ambient term, and — for §59's specular lobe — the view's eye position.
 * 4. **Each shaded variant is its own WGSL module**, compiled once per frame
 *    however many pipelines draw with it (the WP-R1.4 variant-evidence rule's
 *    transcript half; the compile-and-rasterise half is
 *    `tests/browser/webgpu/webgpu-lit.spec.ts`).
 */

import { boxGeometry, planeGeometry } from "@fourjs/geometry";
import {
  LitMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  MAX_PUNCTUAL_LIGHTS,
  Mesh,
  Renderable,
  Texture,
  collectSceneLights,
  createSceneLights,
} from "@fourjs/render";
import { WebgpuRenderer } from "@fourjs/render-webgpu";
import {
  LIGHT_CAMERA_OFFSET,
  LIGHT_COLOR_OFFSET,
  LIGHT_COUNTS_OFFSET,
  LIGHT_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_PARAMS_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
} from "@fourjs/render-webgpu";
import {
  Bone,
  DirectionalLight,
  OrthographicCamera,
  PointLight,
  Scene,
  Skeleton,
  SpotLight,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly gpu: RecordingGpu;
  readonly scene: Scene;
  readonly views: readonly Viewport[];
}

/** The 8 × 8 orthographic rig the other WebGPU suites use. */
async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);
  gpu.reset();
  return { renderer, gpu, scene, views: [createFullscreenViewport(camera)] };
}

/** The labels of every buffer the tape allocated. */
function bufferLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createBuffer")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every WGSL module the tape compiled. */
function moduleLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The frame's lights upload — the last `writeBuffer` of a shaded frame. */
function lightsUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("the frame uploaded nothing");
  }
  return last.args[2] as number[];
}

/** One vec4 slot of the first light block. */
function slot(floats: number[], byteOffset: number): number[] {
  return floats.slice(byteOffset / 4, byteOffset / 4 + 4);
}

describe("WP-R1.5 — a scene with no lit material allocates none of it", () => {
  it("records no lights, no normals, no standard block for an unlit scene", async () => {
    const rig = await createRig();
    // `planeGeometry` carries normals and uvs; drawn unlit, neither the
    // normal stream nor any lighting machinery may reach the device.
    rig.scene.add(
      new Renderable(
        planeGeometry({ width: 2, height: 2 }),
        new UnlitMaterial({ color: [1, 0.5, 0.25, 1] }),
      ),
    );
    resolveWorldTransforms(rig.scene);
    rig.renderer.render(rig.scene, rig.views);

    const labels = bufferLabels(rig.gpu);
    expect(labels.some((label) => label === "fourJS:lights")).toBe(false);
    expect(labels.some((label) => label.startsWith("fourJS:normals:"))).toBe(
      false,
    );
    expect(
      moduleLabels(rig.gpu).some(
        (label) =>
          label.startsWith("fourJS:lit") || label.startsWith("fourJS:standard"),
      ),
    ).toBe(false);
    expect(
      rig.gpu
        .callsOf("device.createBindGroupLayout")
        .map((call) => String((call.args[0] as { label?: string }).label))
        .filter(
          (label) =>
            label === "fourJS:lights" || label === "fourJS:standard-uniforms",
        ),
    ).toEqual([]);
  });

  it("does not count a skinned-lit item as lit — WP-R1.4's byte identity holds", async () => {
    // A skinned mesh over a LitMaterial builds a `"skinned-lit"` item, which
    // this backend skips whole. The lights scan must skip it too: the scene
    // with the mesh records the byte-identical tape of the scene without it,
    // light machinery included.
    const shared = planeGeometry({ width: 2, height: 2 });
    const skinned = (): Mesh<LitMaterial> => {
      const geometry = planeGeometry({ width: 2, height: 2 });
      const vertexCount = geometry.vertexCount;
      geometry.joints = new Uint16Array(vertexCount * 4);
      const weights = new Float32Array(vertexCount * 4);
      for (let index = 0; index < vertexCount; index += 1) {
        weights[index * 4] = 1;
      }
      geometry.weights = weights;
      const mesh = new Mesh(geometry, new LitMaterial());
      const bone = new Bone();
      mesh.add(bone);
      mesh.skeleton = new Skeleton([bone]);
      return mesh;
    };

    const withMesh = await createRig();
    withMesh.scene.add(new Renderable(shared, new UnlitMaterial()));
    withMesh.scene.add(skinned());
    resolveWorldTransforms(withMesh.scene);
    withMesh.renderer.render(withMesh.scene, withMesh.views);

    const without = await createRig();
    without.scene.add(new Renderable(shared, new UnlitMaterial()));
    resolveWorldTransforms(without.scene);
    without.renderer.render(without.scene, without.views);

    expect(withMesh.gpu.transcript()).toEqual(without.gpu.transcript());
  });
});

describe("WP-R1.5 — the light block carries the shared record's packing", () => {
  it("uploads the frame's lamps exactly as collectSceneLights packs them", async () => {
    const rig = await createRig();
    rig.scene.ambientLight[0] = 0.1;
    rig.scene.ambientLight[1] = 0.2;
    rig.scene.ambientLight[2] = 0.3;
    const sun = new DirectionalLight({ color: [1, 0.5, 0.25], intensity: 2 });
    rig.scene.add(sun);
    const lamp = new PointLight({
      color: [1, 0.5, 0.25],
      intensity: 4,
      range: 12,
    });
    lamp.transform.position.set(2, 3, -1);
    rig.scene.add(lamp);
    const spot = new SpotLight({
      color: [0, 1, 0],
      intensity: 3,
      range: 10,
      innerConeAngle: Math.PI / 8,
      outerConeAngle: Math.PI / 4,
    });
    spot.transform.position.set(0, 5, 0);
    rig.scene.add(spot);
    rig.scene.add(new Renderable(boxGeometry(), new LitMaterial()));
    rig.scene.add(new Renderable(boxGeometry(), new StandardMaterial()));
    resolveWorldTransforms(rig.scene);

    rig.renderer.render(rig.scene, rig.views);

    // The reference: the same record the GL backend hands to `uniform3fv`,
    // collected off the same scene by the same walk.
    const reference = collectSceneLights(rig.scene, createSceneLights());
    const floats = lightsUpload(rig.gpu);
    expect(slot(floats, LIGHT_COUNTS_OFFSET)[0]).toBe(2);
    expect(slot(floats, LIGHT_DIRECTION_OFFSET).slice(0, 3)).toEqual([
      reference.direction.x,
      reference.direction.y,
      reference.direction.z,
    ]);
    expect(slot(floats, LIGHT_COLOR_OFFSET).slice(0, 3)).toEqual([2, 1, 0.5]);
    // The two lamps, re-strided from the record's packed arrays: position,
    // premultiplied colour, and the cone word — zero for the point light, the
    // precomputed `KHR_lights_punctual` ramp for the spot.
    expect(slot(floats, LIGHT_PUNCTUAL_POSITION_OFFSET).slice(0, 3)).toEqual([
      2, 3, -1,
    ]);
    expect(slot(floats, LIGHT_PUNCTUAL_COLOR_OFFSET).slice(0, 3)).toEqual([
      4, 2, 1,
    ]);
    expect(slot(floats, LIGHT_PUNCTUAL_PARAMS_OFFSET)).toEqual([12, 0, 0, 0]);
    const spotParams = slot(floats, LIGHT_PUNCTUAL_PARAMS_OFFSET + 16);
    expect(spotParams[0]).toBe(10);
    expect(spotParams[1]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    expect(spotParams[2]).toBeCloseTo(
      1 / (Math.cos(Math.PI / 8) - Math.cos(Math.PI / 4)),
      4,
    );
    expect(spotParams[3]).toBe(1);
    // §59's eye, read off the view's camera world matrix.
    expect(slot(floats, LIGHT_CAMERA_OFFSET)).toEqual([0, 0, 5, 0]);
  });

  it("keeps the GL bound: the first eight lamps in scene order, one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const rig = await createRig();
      for (let index = 0; index < MAX_PUNCTUAL_LIGHTS + 1; index += 1) {
        const lamp = new PointLight({ intensity: index + 1 });
        lamp.transform.position.set(index, 0, 0);
        rig.scene.add(lamp);
      }
      rig.scene.add(new Renderable(boxGeometry(), new LitMaterial()));
      resolveWorldTransforms(rig.scene);
      rig.renderer.render(rig.scene, rig.views);

      const floats = lightsUpload(rig.gpu);
      expect(slot(floats, LIGHT_COUNTS_OFFSET)[0]).toBe(MAX_PUNCTUAL_LIGHTS);
      // Scene order decides: the first lamp (intensity 1) holds slot 0 and
      // the eighth (position x = 7) holds the last slot — the ninth never
      // enters the block, whose arrays end at MAX_PUNCTUAL_LIGHTS.
      expect(slot(floats, LIGHT_PUNCTUAL_COLOR_OFFSET)).toEqual([1, 1, 1, 0]);
      expect(slot(floats, LIGHT_PUNCTUAL_POSITION_OFFSET + 7 * 16)[0]).toBe(7);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("WP-R1.5 — each shaded variant is one module, compiled once", () => {
  it("compiles lit, textured-lit and standard modules once for a mixed frame", async () => {
    const rig = await createRig();
    rig.scene.add(new DirectionalLight());
    // Two flat lit boxes: one variant, one module, two draws.
    rig.scene.add(new Renderable(boxGeometry(), new LitMaterial()));
    rig.scene.add(new Renderable(boxGeometry(), new LitMaterial()));
    // A textured lit plane: normals + uvs + a map — the |n|map variant.
    const map = new Texture({ width: 2, height: 2 });
    rig.scene.add(
      new Renderable(
        planeGeometry({ width: 2, height: 2 }),
        new LitMaterial({ map }),
      ),
    );
    // A standard box: its own family, its own module and group-0 block.
    rig.scene.add(new Renderable(boxGeometry(), new StandardMaterial()));
    resolveWorldTransforms(rig.scene);

    rig.renderer.render(rig.scene, rig.views);

    const shaded = moduleLabels(rig.gpu).filter(
      (label) =>
        label.startsWith("fourJS:lit") || label.startsWith("fourJS:standard"),
    );
    expect(shaded.sort()).toEqual([
      "fourJS:lit|n",
      "fourJS:lit|n|map",
      "fourJS:standard|n",
    ]);
    // One light block serves the whole frame: one buffer, one layout.
    expect(
      bufferLabels(rig.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(1);
    // Every shaded geometry uploaded its normal stream, in GL's order.
    expect(
      bufferLabels(rig.gpu).filter((label) =>
        label.startsWith("fourJS:normals:"),
      ).length,
    ).toBe(4);
  });
});
