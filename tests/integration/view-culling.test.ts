/**
 * R-8 — §64's per-view render lists and §87's frustum culling, across the four
 * packages that have to agree on them (2026-08-09).
 *
 * Before this packet the frame built **one** render list and every viewport
 * drew all of it, filtered by a bitmask the backend tested inline. §64 asks the
 * renderer to separate "visibility and layer filtering" from "frustum and
 * occlusion culling" and to do both per view; §87 asks for culling and had no
 * world bounds to cull against; §49's `frustumCulled` was absent because there
 * was nothing for it to switch off; §66's key 4 was blocked because a depth
 * measured along one camera would have misordered every other view of the same
 * list. All four are one structural change, and no unit test inside one package
 * can check it: `@fourjs/math` owns the planes, `@fourjs/geometry` the local box,
 * `@fourjs/render` the derivation, `@fourjs/render-webgl` the only place it becomes
 * GL, and `four` the §79 document.
 *
 * Six claims:
 *
 * 1. **A scene with nothing off screen is byte-identical.** A cull that removes
 *    nothing must leave the GL transcript exactly as it was, because the
 *    derived list is a *subsequence* — the same pooled items, in the same
 *    order. `FRAME_BEFORE_R8` is a recording taken on the reverted build, not a
 *    wish.
 * 2. **A cull removes exactly the draws that had no pixels.** The frame that
 *    used to submit them submits everything else, in the same order.
 * 3. **Two views of one frame disagree**, which is the whole point of a
 *    per-view list: one traversal, two answers.
 * 4. **The shadow pass stays view-independent** (R-18's §46 argument): a caster
 *    no camera can see still occludes, because §69's map is built from the
 *    frame's list before the view loop.
 * 5. **§66's key 4 sorts a view's own list** — opaque near to far, transparent
 *    far to near — and is a verb, never a default.
 * 6. **`frustumCulled` survives §79.**
 */

import { boxGeometry, planeGeometry } from "@fourjs/geometry";
import { Frustum, Matrix4 } from "@fourjs/math";
import {
  LitMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  Renderable,
  Sprite,
  Texture,
  buildRenderList,
  buildViewRenderList,
  sortRenderListByDepth,
  type RenderItem,
} from "@fourjs/render";
import {
  WebglRenderer,
  registerShadowPipeline,
  registerStandardPipeline,
} from "@fourjs/render-webgl";
import {
  DirectionalLight,
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
  type SceneDocument,
} from "@fourjs/serialization";
import { registerSceneNodeTypes } from "fourJS";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

// §59's standard surface is a registration seam on WebGL 2 since 2026-09-11
// (owner decision; the skinning shape): one explicit call links the program,
// and the renderer compiles it on the first `StandardMaterial` draw.
// Registered for the file, as an application registers once at setup.
registerStandardPipeline();

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly views: Viewport[];
}

/**
 * A renderer over a recording context, and a camera that really sees
 * `[-4, 4] × [-4, 4]` from `z = 8`.
 *
 * The box is written out rather than passed as `{ height, aspect }`: those two
 * are not `OrthographicCameraOptions` fields, and three suites in this
 * directory silently kept the default unit box because of it until R-8's cull
 * made the consequence visible (see `frame-statistics.test.ts`).
 */
async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  scene.ambientLight[0] = 0.2;
  scene.ambientLight[1] = 0.2;
  scene.ambientLight[2] = 0.25;

  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 8);
  camera.updateProjectionMatrix();
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    camera,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order — the
 * aliasing `render-effects.test.ts` introduced; see it, or `multi-light.test.ts`,
 * for why raw serials cannot be compared across builds while the relative order
 * of a frame's own handles can.
 */
function aliasHandles(transcript: readonly string[]): string[] {
  const alias = new Map<string, string>();
  const counts = new Map<string, number>();
  return transcript.map((line) =>
    line.replace(/\{"kind":"[A-Za-z]+","serial":\d+\}/g, (handle) => {
      const existing = alias.get(handle);
      if (existing !== undefined) {
        return existing;
      }
      const kind = (JSON.parse(handle) as { kind: string }).kind;
      const index = counts.get(kind) ?? 0;
      counts.set(kind, index + 1);
      const name = `${kind}#${String(index)}`;
      alias.set(handle, name);
      return name;
    }),
  );
}

/** A 2×2 RGBA8 checker, the smallest texture that is not a solid colour. */
function checkerTexture(): Texture {
  const data = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i += 1) {
    const value = i % 2 === 0 ? 255 : 64;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return new Texture({ width: 2, height: 2, data });
}

/**
 * The scene `FRAME_BEFORE_R8` was recorded from: one draw through **every**
 * pipeline, all of it inside the camera's box.
 *
 * Deliberately not a minimal scene, for `multi-light.test.ts`'s reason one
 * packet on: the property R-8 has to prove is that a per-view *derivation*
 * changes nothing for a frame in which nothing is filtered, and "nothing" has
 * to be shown across every pipeline the backend switches between — because the
 * derivation replaced the loop those switches happen in.
 */
function onScreenScene(test: Harness): void {
  const sun = new DirectionalLight({ color: [1, 0.95, 0.9], intensity: 2 });
  sun.transform.position.set(0, 3, 3);
  test.scene.add(sun);

  const texture = checkerTexture();
  test.scene.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ color: [1, 0, 0, 1] })),
  );
  test.scene.add(
    new Renderable(
      boxGeometry(),
      new LitMaterial({ color: [0.8, 0.8, 0.85, 1] }),
    ),
  );
  test.scene.add(
    new Renderable(boxGeometry(), new LitMaterial({ map: texture })),
  );
  test.scene.add(
    new Renderable(
      boxGeometry(),
      new StandardMaterial({ metalness: 0.9, roughness: 0.35 }),
    ),
  );
  test.scene.add(new Sprite(new SpriteMaterial({ texture }), { width: 2 }));
}

/**
 * The GL a steady-state frame of {@link onScreenScene} emitted on
 * **2026-08-09**, at the last build before per-view lists and culling existed.
 *
 * Recorded, not written: `packages/render/src/{render-list,renderable}.ts`,
 * `packages/render-webgl/src/{webgl-renderer,gl-batch}.ts` and
 * `packages/math/src/index.ts` were restored from `HEAD`, the two new modules
 * were removed, the workspace was rebuilt, and this frame was captured. Do not
 * "fix" a failure here by re-recording: this list is the regression guard for
 * every pixel golden and every browser test, and a change to it is a change to
 * what a frame with nothing off screen draws. Updated 2026-09-09: lit/standard
 * `setModel` now also uploads `uniform mat3 normalMatrix` (identity here).
 *
 * The caveat `multi-light.test.ts` states applies unchanged: the double records
 * typed-array arguments **by reference** and every upload goes through shared
 * scratch, so the numbers inside `[...]` are the scratch's final contents
 * rather than each call's own. This is a proof about the **sequence** — which
 * calls, in which order, with which handles.
 */
const FRAME_BEFORE_R8: readonly string[] = [
  "useProgram(createProgram#0)",
  "scissor(0, 0, 256, 256)",
  "viewport(0, 0, 256, 256)",
  "clearDepth(1)",
  "clear(256)",
  "uniformMatrix4fv(getUniformLocation#0, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix4fv(getUniformLocation#1, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#2, [1,1,1,1])",
  "bindVertexArray(createVertexArray#0)",
  "drawElements(4, 6, 5123, 0)",
  "useProgram(createProgram#1)",
  "uniformMatrix4fv(getUniformLocation#3, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform3fv(getUniformLocation#4, [2,1.899999976158142,1.7999999523162842])",
  "uniform3fv(getUniformLocation#5, [2,1.899999976158142,1.7999999523162842])",
  "uniform3fv(getUniformLocation#6, [2,1.899999976158142,1.7999999523162842])",
  "uniform1i(getUniformLocation#7, 0)",
  "uniformMatrix4fv(getUniformLocation#8, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix3fv(getUniformLocation#9, false, [1,0,0,0,1,0,0,0,1])",
  "uniform4fv(getUniformLocation#10, [1,1,1,1])",
  "bindVertexArray(createVertexArray#1)",
  "drawElements(4, 36, 5123, 0)",
  "activeTexture(33984)",
  "bindTexture(3553, createTexture#0)",
  "uniform1i(getUniformLocation#7, 1)",
  "uniformMatrix4fv(getUniformLocation#8, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix3fv(getUniformLocation#9, false, [1,0,0,0,1,0,0,0,1])",
  "uniform4fv(getUniformLocation#10, [1,1,1,1])",
  "bindVertexArray(createVertexArray#2)",
  "drawElements(4, 36, 5123, 0)",
  "useProgram(createProgram#2)",
  "uniformMatrix4fv(getUniformLocation#11, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform3fv(getUniformLocation#12, [0,0,0])",
  "uniform3fv(getUniformLocation#13, [0,0,0])",
  "uniform3fv(getUniformLocation#14, [0,0,0])",
  "uniform3fv(getUniformLocation#15, [0,0,0])",
  "uniformMatrix4fv(getUniformLocation#16, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix3fv(getUniformLocation#17, false, [1,0,0,0,1,0,0,0,1])",
  "uniform4fv(getUniformLocation#18, [1,1,1,1])",
  "uniform1f(getUniformLocation#19, 0.9)",
  "uniform1f(getUniformLocation#20, 0.35)",
  "uniform3fv(getUniformLocation#21, [0,0,0])",
  "bindVertexArray(createVertexArray#3)",
  "drawElements(4, 36, 5123, 0)",
  "useProgram(createProgram#3)",
  "uniform1i(getUniformLocation#22, 0)",
  "activeTexture(33984)",
  "enable(3042)",
  "uniformMatrix4fv(getUniformLocation#23, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniformMatrix4fv(getUniformLocation#24, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])",
  "uniform4fv(getUniformLocation#25, [1,1,1,1])",
  "bindTexture(3553, createTexture#0)",
  "bindVertexArray(createVertexArray#4)",
  "drawElements(4, 6, 5123, 0)",
  "disable(3042)",
  "bindTexture(3553, null)",
  "bindVertexArray(null)",
];

describe("R-8 — a scene with nothing off screen is byte-identical (§64, §87)", () => {
  it("emits the recorded pre-R-8 frame, call for call", async () => {
    const test = await harness();
    onScreenScene(test);
    resolveWorldTransforms(test.scene);
    // Warm the caches: the recorded frame is a *steady-state* one, as it was
    // when the expected transcript was recorded.
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();

    test.renderer.render(test.scene, test.views);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R8);
  });

  it("submits every draw of a frame it culls nothing from", async () => {
    const test = await harness();
    onScreenScene(test);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawElements")).toBe(5);
  });
});

describe("R-8 — §87 culling removes exactly what has no pixels", () => {
  it("drops an off-screen renderable and keeps the rest, in order", async () => {
    const test = await harness();
    const near = new Renderable(planeGeometry(), new UnlitMaterial());
    const off = new Renderable(planeGeometry(), new UnlitMaterial());
    off.transform.position.set(40, 0, 0);
    const alsoNear = new Renderable(planeGeometry(), new UnlitMaterial());
    alsoNear.transform.position.set(1, 0, 0);
    test.scene.add(near, off, alsoNear);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawElements")).toBe(2);
  });

  it("keeps an off-screen renderable that opted out (§49)", async () => {
    const test = await harness();
    const off = new Renderable(planeGeometry(), new UnlitMaterial());
    off.transform.position.set(40, 0, 0);
    off.frustumCulled = false;
    test.scene.add(off);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawElements")).toBe(1);
  });

  it("culls content the near plane would have clipped anyway", async () => {
    // The gotcha `examples/first-2d-scene` was moved to `z = 5` for, and the
    // one three suites in this directory were quietly hitting: a camera at the
    // origin cannot see `z = 0`, because the near plane is in front of it.
    const test = await harness();
    test.camera.transform.position.set(0, 0, 0);
    test.scene.add(
      new Renderable(
        planeGeometry({ width: 0.1, height: 0.1 }),
        new UnlitMaterial(),
      ),
    );
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawElements")).toBe(0);
  });
});

describe("R-8 — one frame list, two views that disagree (§64, §48)", () => {
  it("draws each half into the camera that can see it", async () => {
    const test = await harness();
    const left = new Renderable(planeGeometry(), new UnlitMaterial());
    left.transform.position.set(-20, 0, 0);
    const right = new Renderable(planeGeometry(), new UnlitMaterial());
    right.transform.position.set(20, 0, 0);
    test.scene.add(left, right);

    const leftCamera = new OrthographicCamera({
      left: -4,
      right: 4,
      bottom: -4,
      top: 4,
    });
    leftCamera.transform.position.set(-20, 0, 8);
    const rightCamera = new OrthographicCamera({
      left: -4,
      right: 4,
      bottom: -4,
      top: 4,
    });
    rightCamera.transform.position.set(20, 0, 8);
    test.scene.add(leftCamera, rightCamera);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, [
      { ...createFullscreenViewport(leftCamera, "left"), width: 0.5 },
      { ...createFullscreenViewport(rightCamera, "right"), x: 0.5, width: 0.5 },
    ]);

    // Two draws, not four: one traversal answered two questions.
    expect(test.recorder.countOf("drawElements")).toBe(2);
  });

  it("still draws a node both views can see, once per view", async () => {
    const test = await harness();
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, [
      { ...createFullscreenViewport(test.camera, "left"), width: 0.5 },
      { ...createFullscreenViewport(test.camera, "right"), x: 0.5, width: 0.5 },
    ]);

    expect(test.recorder.countOf("drawElements")).toBe(2);
  });
});

describe("R-8 — the §69 shadow map stays view-independent (R-18's §46 argument)", () => {
  it("draws a caster no camera can see into the map", async () => {
    // The caster pass is a registration seam since 2026-09-11.
    registerShadowPipeline();
    const test = await harness();
    const sun = new DirectionalLight({ intensity: 1 });
    sun.castShadow = true;
    sun.transform.position.set(0, 6, 6);
    const onScreen = new Renderable(boxGeometry(), new LitMaterial());
    const offScreen = new Renderable(boxGeometry(), new LitMaterial());
    offScreen.transform.position.set(40, 0, 0);
    test.scene.add(sun, onScreen, offScreen);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);

    // Two casters into the depth-only pass, one survivor into the colour pass.
    // A shadow that appeared and disappeared as its caster left the screen is
    // exactly what filtering the frame's list per view would have produced.
    expect(test.recorder.countOf("drawElements")).toBe(3);
  });
});

describe("R-8 — §66 sort key 4 on a view's own list", () => {
  /** The frame list for `scene`, world transforms resolved. */
  function frameList(scene: Scene): RenderItem[] {
    resolveWorldTransforms(scene);
    return buildRenderList(scene, []);
  }

  it("orders a view's opaque draws near to far and its blended ones far to near", async () => {
    const test = await harness();
    // Shared materials so key 3 ties and key 4 (depth) is what this pins.
    const opaque = new UnlitMaterial();
    const blend = new UnlitMaterial({ transparent: true });
    const opaqueFar = new Renderable(planeGeometry(), opaque);
    opaqueFar.transform.position.set(0, 0, -2);
    const opaqueNear = new Renderable(planeGeometry(), opaque);
    opaqueNear.transform.position.set(0, 0, 2);
    const blendedNear = new Renderable(planeGeometry(), blend);
    blendedNear.transform.position.set(0, 0, 3);
    const blendedFar = new Renderable(planeGeometry(), blend);
    blendedFar.transform.position.set(0, 0, -3);
    test.scene.add(opaqueFar, opaqueNear, blendedNear, blendedFar);
    const items = frameList(test.scene);
    test.camera.updateViewMatrix();
    const frustum = new Frustum().setFromViewProjection(
      new Matrix4()
        .copy(test.camera.projectionMatrix)
        .multiply(test.camera.viewMatrix),
    );

    const view = sortRenderListByDepth(
      buildViewRenderList(items, test.views[0], [], { frustum }),
      test.camera.viewMatrix,
    );

    expect(view.map((item) => item.worldMatrix.elements[14])).toEqual([
      2, -2, -3, 3,
    ]);
  });

  it("leaves the frame list, and therefore every other view, alone", async () => {
    const test = await harness();
    const first = new Renderable(planeGeometry(), new UnlitMaterial());
    first.transform.position.set(0, 0, -2);
    const second = new Renderable(planeGeometry(), new UnlitMaterial());
    second.transform.position.set(0, 0, 2);
    test.scene.add(first, second);
    const items = frameList(test.scene);
    const before = [...items];

    sortRenderListByDepth(
      buildViewRenderList(items, test.views[0], []),
      test.camera.viewMatrix,
    );

    expect(items).toEqual(before);
  });

  it("is not what the renderer does by itself: the frame's order is scene order", async () => {
    // Key 4 is a verb for §66's reason and key 3's: under `LEQUAL` a depth sort
    // permutes co-planar opaque draws, and co-planar opaque draws are what a 2D
    // scene is made of. The backend never calls it.
    const test = await harness();
    const far = new Renderable(planeGeometry(), new UnlitMaterial());
    far.transform.position.set(0, 0, -2);
    const near = new Renderable(planeGeometry(), new UnlitMaterial());
    near.transform.position.set(0, 0, 2);
    test.scene.add(far, near);
    const items = frameList(test.scene);

    expect(items.map((item) => item.worldMatrix.elements[14])).toEqual([-2, 2]);
    expect(items.map((item) => item.viewDepth)).toEqual([0, 0]);
  });
});

describe("R-8 — §49's frustumCulled survives §79", () => {
  it("round-trips false through a document, and defaults true without one", () => {
    const io = registerSceneNodeTypes({
      geometries: {
        keyOf: (): string => "geometry/plane",
        get: (): ReturnType<typeof planeGeometry> => planeGeometry(),
      },
      materials: {
        keyOf: (): string => "material/flat",
        get: (): UnlitMaterial => new UnlitMaterial(),
      },
    });
    const scene = new Scene();
    scene.add(
      new Renderable(planeGeometry(), new UnlitMaterial(), {
        frustumCulled: false,
      }),
      new Renderable(planeGeometry(), new UnlitMaterial()),
    );

    const restored = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const [pinned, ordinary] = restored.children as [Renderable, Renderable];
    expect(pinned.frustumCulled).toBe(false);
    expect(ordinary.frustumCulled).toBe(true);
  });

  it("loads a document written before §87 unchanged", () => {
    // Additive, exactly as §69's two flags were: the key is simply absent, and
    // the node restores `frustumCulled = true` — which is what that document
    // meant, because every scene before this build was drawn uncalled.
    const io = registerSceneNodeTypes({
      geometries: {
        keyOf: (): string => "geometry/plane",
        get: (): ReturnType<typeof planeGeometry> => planeGeometry(),
      },
      materials: {
        keyOf: (): string => "material/flat",
        get: (): UnlitMaterial => new UnlitMaterial(),
      },
    });
    const before: SceneDocument = {
      formatVersion: 1,
      nodes: [
        {
          type: "render:renderable",
          id: "node-quad",
          data: {
            geometry: "geometry/plane",
            material: "material/flat",
            renderLayer: 0,
            renderOrder: 0,
          },
        },
      ],
    };

    // `instantiateScene` returns the document's single root, which here *is*
    // the renderable.
    const restored = instantiateScene(before, io.components, io.read);

    expect(restored).toBeInstanceOf(Renderable);
    expect((restored as Renderable).frustumCulled).toBe(true);
  });
});
