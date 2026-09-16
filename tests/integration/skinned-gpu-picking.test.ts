/**
 * Consumer-seat WebGL skinned GPU picking (dogfood cycle 7, 2026-09-09).
 *
 * Package units already cover `SkinnedIdProgram` on a fake GL host
 * (`packages/render-webgl/tests/gl-picking.test.ts`). This file is the
 * outside-the-engine check: a one-bone skinned `Mesh`, both registration
 * seams, public `@fourjs/*` APIs only.
 *
 * Claims:
 *
 * 1. `registerPickingPipeline` + `registerSkinningPipeline` then
 *    `createPickingService` draws the id pass through the skinned program
 *    (`skinMatrix()`, `jointMatrices[0]`, the live palette — not bind pose).
 * 2. Recording GL cannot rasterise, so a true deformed-vs-bind hit/miss
 *    read-back is not available here. Staged texels still resolve through
 *    the §33 table; the silhouette claim is the program + palette.
 * 3. An unskinned control scene is unchanged: its id-pass transcript
 *    (and its colour frame) match picking-only registration.
 */

import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import {
  Mesh,
  Renderable,
  encodePickId,
  supportsPicking,
  type PickingService,
} from "@fourjs/render";
import {
  JOINTS_ATTRIBUTE_LOCATION,
  SKINNING_GLSL,
  WEIGHTS_ATTRIBUTE_LOCATION,
  WebglRenderer,
  clearRegisteredPickingPipeline,
  clearRegisteredSkinningPipeline,
  registerPickingPipeline,
  registerSkinningPipeline,
} from "@fourjs/render-webgl";
import {
  Bone,
  OrthographicCamera,
  Scene,
  Skeleton,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { afterEach, describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

const SURFACE_WIDTH = 64;
const SURFACE_HEIGHT = 48;
const ORTHO_HALF_WIDTH = 4;
const ORTHO_HALF_HEIGHT = 3;

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly view: Viewport;
  readonly views: readonly Viewport[];
}

/** The pick a test stages: what the simulated read-back will answer. */
interface ReadbackSeam {
  set(texel: readonly number[]): void;
  readonly reads: (readonly unknown[])[];
}

/**
 * Extends the shared recording double with `readPixels` — the same optional
 * member `pixel-picking.test.ts` attaches here rather than in the helper,
 * because absence elsewhere is what keeps proving presence-is-the-capability.
 */
function attachReadback(recording: RecordingGl): ReadbackSeam {
  let texel: readonly number[] = [0, 0, 0, 0];
  const reads: (readonly unknown[])[] = [];
  const target = recording.gl as unknown as Record<string, unknown>;
  target.readPixels = (...args: unknown[]): void => {
    reads.push(args);
    const into = args[6];
    if (ArrayBuffer.isView(into)) {
      (into as Uint8Array).set(texel);
    }
  };
  return {
    set(next) {
      texel = next;
    },
    reads,
  };
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  renderer.resize(SURFACE_WIDTH, SURFACE_HEIGHT);
  const camera = new OrthographicCamera({
    left: -ORTHO_HALF_WIDTH,
    right: ORTHO_HALF_WIDTH,
    bottom: -ORTHO_HALF_HEIGHT,
    top: ORTHO_HALF_HEIGHT,
  });
  camera.transform.position.set(0, 0, 5);
  const view = createFullscreenViewport(camera);
  return { renderer, recording, view, views: [view] };
}

/** A plane whose four vertices all follow joint 0 with full weight. */
function skinnedPlaneGeometry(): ReturnType<typeof planeGeometry> {
  const geometry = planeGeometry({ width: 2, height: 2 });
  const vertexCount = geometry.vertexCount;
  geometry.joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    weights[i * 4] = 1;
  }
  geometry.weights = weights;
  return geometry;
}

/** One-bone skinned mesh, bone parented under it. */
function skinnedMesh(): { mesh: Mesh; bone: Bone } {
  const mesh = new Mesh(skinnedPlaneGeometry(), new UnlitMaterial());
  const bone = new Bone();
  mesh.add(bone);
  mesh.skeleton = new Skeleton([bone]);
  return { mesh, bone };
}

function unskinnedScene(): Scene {
  const scene = new Scene();
  scene.add(
    new Renderable(planeGeometry({ width: 2, height: 2 }), new UnlitMaterial()),
  );
  resolveWorldTransforms(scene);
  return scene;
}

/** The RGBA bytes a draw of table index `index` writes. */
function texelOf(index: number): number[] {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return Array.from(encoded, (component) => Math.round(component * 255));
}

function worldToNdc(x: number, y: number): { ndcX: number; ndcY: number } {
  return { ndcX: x / ORTHO_HALF_WIDTH, ndcY: y / ORTHO_HALF_HEIGHT };
}

/** The service's NDC → pixel map (`gl-picking.ts`, +Y up, edges clamped). */
function ndcToPixel(ndcX: number, ndcY: number): { x: number; y: number } {
  return {
    x: Math.min(
      SURFACE_WIDTH - 1,
      Math.floor(((ndcX + 1) / 2) * SURFACE_WIDTH),
    ),
    y: Math.min(
      SURFACE_HEIGHT - 1,
      Math.floor(((ndcY + 1) / 2) * SURFACE_HEIGHT),
    ),
  };
}

function shaderSources(recording: RecordingGl): string[] {
  return recording
    .callsOf("shaderSource")
    .map((call) => call.args[1] as string);
}

function matrixUploads(recording: RecordingGl): number[][] {
  return recording
    .callsOf("uniformMatrix4fv")
    .map((call) => Array.from(call.args[2] as Float32Array));
}

afterEach(() => {
  clearRegisteredPickingPipeline();
  clearRegisteredSkinningPipeline();
});

describe("unskinned control scene (pipeline-cost law, both seams)", () => {
  async function unskinnedIdTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = unskinnedScene();
    const service = rig.renderer.createPickingService();
    rig.recording.reset();
    service.update(scene, rig.view);
    return rig.recording.transcript();
  }

  async function unskinnedColorTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = unskinnedScene();
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registering skinning changes no id-pass or colour call of a skinless frame", async () => {
    registerPickingPipeline();
    const idWithoutSkinning = await unskinnedIdTranscript();
    const colorWithoutSkinning = await unskinnedColorTranscript();

    registerSkinningPipeline();
    const idWithSkinning = await unskinnedIdTranscript();
    const colorWithSkinning = await unskinnedColorTranscript();

    expect(idWithSkinning).toEqual(idWithoutSkinning);
    expect(colorWithSkinning).toEqual(colorWithoutSkinning);
    expect(idWithoutSkinning.some((line) => line.includes("skinMatrix"))).toBe(
      false,
    );
    expect(
      idWithoutSkinning.some((line) => line.includes("jointMatrices")),
    ).toBe(false);
  });
});

describe("the skinned id pass, consumer seat (§54 + §71)", () => {
  async function pickingRig(): Promise<{
    rig: Rig;
    service: PickingService;
    seam: ReadbackSeam;
  }> {
    registerPickingPipeline();
    registerSkinningPipeline();
    const rig = await createRig();
    expect(supportsPicking(rig.renderer)).toBe(true);
    const service = rig.renderer.createPickingService();
    const seam = attachReadback(rig.recording);
    return { rig, service, seam };
  }

  it("draws the deformed silhouette program and uploads the live palette", async () => {
    const { rig, service } = await pickingRig();
    const scene = new Scene();
    const { mesh, bone } = skinnedMesh();
    scene.add(mesh);
    bone.transform.position.set(0, 1, 0);
    resolveWorldTransforms(scene);

    // Id pass before any colour frame so the tape includes the skinned
    // VAO setup (joints / weights) and `SkinnedIdProgram` compile.
    rig.recording.reset();
    service.update(scene, rig.view);

    const sources = shaderSources(rig.recording);
    const skinnedVertex = sources.find(
      (source) =>
        source.includes("skinMatrix()") && source.includes("viewProjection"),
    );
    expect(skinnedVertex).toBeDefined();
    expect(skinnedVertex).toContain(SKINNING_GLSL);
    const skinnedIndex = sources.indexOf(skinnedVertex!);
    expect(sources[skinnedIndex + 1]).toContain("pickId");

    expect(
      rig.recording
        .callsOf("getUniformLocation")
        .some((call) => call.args[1] === "jointMatrices[0]"),
    ).toBe(true);

    const attribs = rig.recording
      .callsOf("enableVertexAttribArray")
      .map((call) => call.args[0]);
    expect(attribs).toContain(JOINTS_ATTRIBUTE_LOCATION);
    expect(attribs).toContain(WEIGHTS_ATTRIBUTE_LOCATION);

    // One-bone translation (0, 1, 0), identity inverse bind: the palette's
    // y-translation column is 1. Bind-pose would have uploaded 0.
    const palette = matrixUploads(rig.recording).find(
      (values) => values.length === 16 && values[13] === 1,
    );
    expect(palette).toBeDefined();
    expect(palette?.[12]).toBe(0);
    expect(palette?.[14]).toBe(0);

    // Scene is not a Renderable; the mesh is table index 0. Indexed plane.
    const lastUpload = new Float32Array(4);
    encodePickId(0, lastUpload);
    const idUploads = rig.recording
      .callsOf("uniform4fv")
      .map((call) => Array.from(call.args[1] as Float32Array));
    expect(idUploads).toContainEqual(Array.from(lastUpload));
    expect(rig.recording.countOf("drawElements")).toBe(1);

    // Colour frame on the same scene: `registerSkinningPipeline` still draws.
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("drawElements")).toBe(1);
  });

  it("resolves staged texels at the deformed-only and bind-pose-only pixels", async () => {
    const { rig, service, seam } = await pickingRig();
    const scene = new Scene();
    const { mesh, bone } = skinnedMesh();
    scene.add(mesh);
    bone.transform.position.set(0, 1, 0);
    resolveWorldTransforms(scene);
    service.update(scene, rig.view);

    // 2×2 plane at the origin, all vertices on joint 0. After +1 Y:
    // bind-pose covers |x|≤1, |y|≤1; deformed covers |x|≤1, 0≤y≤2.
    // Recording GL does not rasterise — these NDCs name the claim; the
    // staged texels prove the table + read-back, not the fragment.
    const deformedOnly = worldToNdc(0, 1.5);
    const bindPoseOnly = worldToNdc(0, -0.5);

    seam.set(texelOf(0));
    const hit = await service.pick({
      viewport: rig.view,
      ndcX: deformedOnly.ndcX,
      ndcY: deformedOnly.ndcY,
    });
    expect(hit.nodeId).toBe(mesh.id);
    expect(hit.frame).toBe(1);

    seam.set([0, 0, 0, 0]);
    const miss = await service.pick({
      viewport: rig.view,
      ndcX: bindPoseOnly.ndcX,
      ndcY: bindPoseOnly.ndcY,
    });
    expect(miss.nodeId).toBeUndefined();

    const hitPixel = ndcToPixel(deformedOnly.ndcX, deformedOnly.ndcY);
    const missPixel = ndcToPixel(bindPoseOnly.ndcX, bindPoseOnly.ndcY);
    expect(seam.reads[0].slice(0, 4)).toEqual([hitPixel.x, hitPixel.y, 1, 1]);
    expect(seam.reads[1].slice(0, 4)).toEqual([missPixel.x, missPixel.y, 1, 1]);
  });
});
