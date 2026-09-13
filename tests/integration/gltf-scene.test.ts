/**
 * §78 end to end: the committed fixtures round-trip into a renderable scene
 * (A-19's closing packet, 2026-08-29).
 *
 * Two cross-package claims, each running the real seams:
 *
 * 1. **`quad.gltf` + `quad.bin`** — a `.gltf` with a *separate* buffer —
 *    loads through the `AssetManager` with the same injected `FetchLike`
 *    serving both files, instantiates into a `StandardMaterial` mesh, and
 *    draws through the real `WebglRenderer` against the recording double.
 * 2. **`skinned-column.glb`** — the GLB container — instantiates into
 *    `Bone`s and a `Skeleton`, and its `"bend"` clip plays through the
 *    `AnimationMixer` onto the instance: the elbow bone rotates and the
 *    joint palette leaves the bind pose.
 *
 * The fixtures are hand-built and committed under `tests/fixtures/gltf/`
 * (regenerable; `asset.generator` says so), so this suite also pins the
 * loader against real files rather than in-memory documents only.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AnimationMixer } from "@fourjs/animation";
import {
  AssetManager,
  createGltfLoader,
  type FetchResponse,
} from "@fourjs/assets";
import { StandardMaterial } from "@fourjs/materials";
import { Mesh } from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  Bone,
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { instantiateGltf } from "fourJS";
import { describe, expect, it } from "vitest";

import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";

// §59's standard surface is a registration seam on WebGL 2 since 2026-09-11
// (owner decision; the skinning shape): one explicit call links the program,
// and the renderer compiles it on the first `StandardMaterial` draw.
// Registered for the file, as an application registers once at setup.
registerStandardPipeline();

/**
 * The fixture directory **as a URL** — see `tests/determinism/gltf-load.test.ts` for the
 * full reason. `@fourjs/assets` resolves a glTF's relative URIs against the asset's URL by
 * splitting on "/", so a native Windows path collapses the base to "" and sends
 * `quad.bin` to the process CWD.
 */
const FIXTURES = new URL("../fixtures/gltf/", import.meta.url).href;

/** A `FetchLike` over the fixtures directory — the documented wiring. */
async function fetchFile(url: string): Promise<FetchResponse> {
  // The one place that touches the filesystem, so the one place a URL becomes a path.
  const bytes = await readFile(fileURLToPath(url));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(buffer),
    text: () => Promise.resolve(bytes.toString("utf8")),
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
  };
}

/** One loader per suite run — cache identity is the loader object. */
const gltfLoader = createGltfLoader({ fetch: fetchFile });

describe("§78: a .gltf with a separate .bin becomes a renderable scene", () => {
  it("loads, instantiates, and draws through the real renderer", async () => {
    const assets = new AssetManager({ fetch: fetchFile });
    const asset = await assets.load(`${FIXTURES}quad.gltf`, gltfLoader);

    // The parse tier carried the file's content faithfully.
    // NOT rebranded to "fourJS": this asserts the FIXTURE FILE's own `extras`,
    // i.e. that the parse tier carried the document's content faithfully. The
    // string belongs to `tests/fixtures/gltf/quad.gltf`, not to our branding, so
    // it changes only if that file changes. The 2026-09-07 rebrand rewrote this
    // expectation without touching the `.gltf` (its extension was outside the
    // pass), and turned CI red.
    expect(asset.extras).toEqual({ fixture: "four.js §78 integration quad" });
    const primitive = asset.meshes[0].primitives[0];
    expect(primitive.positions).toHaveLength(12);
    // The fixture authors v top-down (image convention); the loader flips it
    // to §7a's bottom-up v, matching the texture tier's row flip.
    expect([...(primitive.uvs ?? [])]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);

    const instance = instantiateGltf(asset);
    expect(instance.scene).not.toBeNull();
    const mesh = instance.nodes[0] as Mesh<StandardMaterial>;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.name).toBe("quad");
    expect(mesh.transform.position.x).toBe(0.5);
    expect(mesh.material.emissive[0]).toBeCloseTo(0.95, 12);

    // A loaded scene draws exactly like an authored one.
    const recorder = createRecordingGl();
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
    renderer.resize(256, 256);
    const scene = new Scene();
    const camera = new OrthographicCamera({
      left: -2,
      right: 2,
      bottom: -2,
      top: 2,
    });
    camera.transform.position.set(0, 0, 5);
    scene.add(camera);
    if (instance.scene !== null) {
      scene.add(instance.scene);
    }
    const views: Viewport[] = [createFullscreenViewport(camera)];
    renderer.render(scene, views);
    expect(recorder.countOf("drawElements")).toBe(1);

    assets.release(`${FIXTURES}quad.gltf`, gltfLoader);
    renderer.dispose();
  });
});

describe("§78: the GLB skinned fixture animates through the mixer", () => {
  it("plays the bend clip: the elbow rotates and the palette leaves bind", async () => {
    const assets = new AssetManager({ fetch: fetchFile });
    const asset = await assets.load(
      `${FIXTURES}skinned-column.glb`,
      gltfLoader,
    );
    const instance = instantiateGltf(asset);

    const column = instance.nodes[0] as Mesh<StandardMaterial>;
    const elbow = instance.nodes[2];
    expect(column).toBeInstanceOf(Mesh);
    expect(elbow).toBeInstanceOf(Bone);
    const skeleton = column.skeleton;
    expect(skeleton).not.toBeNull();
    expect(skeleton?.jointCount).toBe(2);

    const scene = new Scene();
    if (instance.scene !== null) {
      scene.add(instance.scene);
    }

    // Bind pose: resolve, update — the palette is the identity per joint.
    resolveWorldTransforms(scene);
    skeleton?.update(column);
    const bind = [...(skeleton?.jointMatrices ?? [])];
    expect(bind[0]).toBeCloseTo(1, 12);
    expect(bind[16 + 13]).toBeCloseTo(0, 12);

    // Play the loaded clip onto the instance (RFC 0003's binding form).
    const mixer = new AnimationMixer(instance);
    mixer.play(instance.animations[0]);
    mixer.advance(1);
    expect(elbow.transform.rotation.z).toBeCloseTo(-Math.SQRT1_2, 5);

    resolveWorldTransforms(scene);
    skeleton?.update(column);
    const bent = [...(skeleton?.jointMatrices ?? [])];
    // Joint 0 (the root) is untouched; joint 1 (the elbow) has left bind.
    for (let i = 0; i < 16; i += 1) {
      expect(bent[i]).toBeCloseTo(bind[i], 10);
    }
    // A -π/2 turn about +Z writes ±1 into the palette's rotation block.
    expect(bent[16 + 0]).toBeCloseTo(0, 5);
    expect(bent[16 + 1]).toBeCloseTo(-1, 5);
    expect(bent[16 + 4]).toBeCloseTo(1, 5);

    asset.dispose();
  });
});
