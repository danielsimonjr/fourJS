/**
 * R-18 — §69's shadow maps, across the four packages that have to agree on them
 * (2026-08-09).
 *
 * §69 lists ten shadow features and the tree had none of them: `castShadow` was
 * deliberately absent rather than accepted-and-ignored, and R-4's render targets
 * carried a depth *renderbuffer* — writable by a pass, samplable by nothing.
 * This packet ships the one tier that closes the gap honestly: a single
 * directional light's shadow map, a `DEPTH_COMPONENT24` attachment, a
 * depth-only caster pass, and a 3x3 percentage-closer filter in both shaded
 * pipelines. No unit test inside one package can check that agreement:
 * `@fourjs/scene` owns the light and the volume, `@fourjs/render` owns the
 * collection and the item flags, `@fourjs/render-webgl` is the only place any of
 * it becomes GL, and `four` owns the §79 document.
 *
 * Five claims:
 *
 * 1. **A scene whose light does not cast is byte-identical.** The whole feature
 *    is gated on a `bool` uniform seeded at GL's own initial `false` and on a
 *    `hasShadow` flag that suppresses the entire pass, so a frame drawn through
 *    every pipeline that predates §69 — unlit, lit, sprite and §59's standard —
 *    emits the GL sequence recorded before shadows existed, call for call.
 *    `FRAME_BEFORE_R18` is a recording taken on the reverted build, not a wish.
 * 2. **Switching the light on renders a map and samples it.** One extra pass,
 *    one framebuffer, one texture unit, and the light's own matrix.
 * 3. **§49's two flags reach the GPU** — a caster that opted out is not drawn
 *    into the map, and a receiver that opted out is not compared against it.
 * 4. **The volume is the light's own node**, so §69's map follows the same rig
 *    that aims the sun.
 * 5. **A shadowed scene survives §79** — `castShadow`, the settings record, and
 *    the two `Renderable` flags round-trip through the umbrella's serializers,
 *    and a document written before this build still loads.
 */

import { boxGeometry, planeGeometry } from "@fourjs/geometry";
import { Matrix4, Vector3 } from "@fourjs/math";
import {
  LitMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  RenderTarget,
  Renderable,
  Sprite,
  Texture,
  collectSceneLights,
  createSceneLights,
} from "@fourjs/render";
import {
  WebglRenderer,
  registerShadowPipeline,
  registerStandardPipeline,
} from "@fourjs/render-webgl";
import {
  DirectionalLight,
  DirectionalLightShadow,
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

// §69's caster pass is a registration seam on WebGL 2 since 2026-09-11 (the
// skinning shape): one explicit call links the depth-only program, and the
// renderer compiles it on the first shadowed frame. Registered for the file,
// as an application registers once at setup.
registerShadowPipeline();
// …and §59's standard surface, which the receiver scenes below draw.
registerStandardPipeline();

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  scene.ambientLight[0] = 0.2;
  scene.ambientLight[1] = 0.2;
  scene.ambientLight[2] = 0.25;

  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 6, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 6 × 6 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 8);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
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

/** A 2x2 RGBA8 checker, the smallest texture that is not a solid colour. */
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
 * The scene `FRAME_BEFORE_R18` was recorded from — deliberately
 * `multi-light.test.ts`'s scene, unchanged, so the two recordings are directly
 * comparable: one draw through **every** pipeline that can be shaded or
 * textured, under an ambient term and one directional light that does not cast.
 *
 * The sun is added with no `castShadow` at all, which is what a scene authored
 * before §69 looks like and what the recording below was taken from.
 */
function shadowlessScene(test: Harness): void {
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
 * The GL a steady-state frame of {@link shadowlessScene} emitted on
 * **2026-08-09**, recorded at commit `dab68c9` — the last build before §69's
 * shadows existed.
 *
 * Recorded, not written. Do not "fix" a failure here by re-recording: this list
 * is the regression guard for every pixel golden and every browser test, and a
 * change to it is a change to what a frame that casts no shadow draws.
 *
 * It is byte-for-byte `multi-light.test.ts`'s `FRAME_BEFORE_R17`, because the
 * scene is the same one and nothing between the two packets touched it — which
 * is itself the point: two independent recordings, two packets apart, one
 * sequence. Updated 2026-09-09 with the same lit/standard `normalMatrix`
 * per-draw upload as `FRAME_BEFORE_R17`.
 *
 * The same caveat those suites state applies: the double records typed-array
 * arguments **by reference** and every upload goes through shared scratch, so
 * the numbers inside `[...]` are the scratch's final contents rather than each
 * call's own. This transcript is a proof about the **sequence** — which calls,
 * in which order, with which handles. Per-draw uniform *values* are asserted by
 * the unit tests in `packages/render-webgl`.
 */
const FRAME_BEFORE_R18: readonly string[] = [
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

describe("R-18 — a scene whose light does not cast is byte-identical (§69)", () => {
  it("emits the GL sequence recorded before shadows existed", async () => {
    const test = await harness();
    shadowlessScene(test);

    // Warm every cache — programs, geometry buffers, textures, and the lazy
    // sampler uploads — so the comparison is about a steady-state frame, as it
    // was when the expected transcript was recorded.
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R18);
  });

  it("never touches a shadow uniform location in that frame", async () => {
    // The stronger, handle-level form of the same claim — `multi-light.test.ts`'s
    // technique, applied to §69's six names. The double mints handles as
    // `{ kind, serial }` with one shared counter, so the tape can be replayed to
    // recover exactly which objects those names resolved to, and then the frame
    // checked for any mention of them.
    const test = await harness();
    shadowlessScene(test);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    const handles: string[] = [];
    let serial = 0;
    for (const call of test.recorder.calls) {
      if (
        !call.name.startsWith("create") &&
        call.name !== "getUniformLocation"
      ) {
        continue;
      }
      serial += 1;
      if (
        call.name === "getUniformLocation" &&
        /^(useShadow|shadow[A-Z])/.test(String(call.args[1]))
      ) {
        handles.push(JSON.stringify({ kind: "getUniformLocation", serial }));
      }
    }
    // Six names each in the two shaded pipelines — resolved once, at
    // initialization, which is the whole cost of R-18 to a scene that casts
    // nothing. Thirteen until 2026-09-11: the caster pipeline's
    // `shadowViewProjection` no longer resolves at initialize, because the
    // caster compiles behind `registerShadowPipeline()` on the first frame
    // that actually casts.
    expect(handles).toHaveLength(12);

    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const frame = test.recorder.transcript();
    for (const handle of handles) {
      expect(frame.some((line) => line.includes(handle))).toBe(false);
    }
  });

  it("allocates no shadow target for a scene that never casts (§83)", async () => {
    const test = await harness();
    shadowlessScene(test);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // Lazily, so a scene that does not ask pays nothing at all — not even the
    // megatexel a default map would report to §84's `textureMemory`.
    expect(test.recorder.countOf("createFramebuffer")).toBe(0);
    test.renderer.dispose();
  });
});

describe("R-18 — the shadow map reaches the GPU (§69)", () => {
  /** A caster above a floor, lit by a sun that casts. */
  function shadowedScene(test: Harness, mapSize = 64): DirectionalLight {
    const sun = new DirectionalLight({
      intensity: 2,
      castShadow: true,
      shadow: { mapSize, extent: 6, near: 0.5, far: 30 },
    });
    sun.transform.position.set(0, 8, 0);
    sun.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    test.scene.add(sun);

    const floor = new Renderable(planeGeometry(), new LitMaterial());
    floor.castShadow = false;
    test.scene.add(floor);
    test.scene.add(
      new Renderable(boxGeometry(), new StandardMaterial({ roughness: 0.6 })),
    );
    return sun;
  }

  it("renders a depth-only pass into a samplable attachment and samples it", async () => {
    const test = await harness();
    shadowedScene(test, 64);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // One framebuffer, with a DEPTH_COMPONENT24 texture rather than a
    // renderbuffer — R-4's staged residue, which is what §69 needed.
    expect(test.recorder.countOf("createFramebuffer")).toBe(1);
    expect(test.recorder.countOf("createRenderbuffer")).toBe(0);
    const depthUpload = test.recorder.callsOf("texImage2D")[1];
    expect(depthUpload.args[2]).toBe(0x81a6);
    expect([depthUpload.args[3], depthUpload.args[4]]).toEqual([64, 64]);

    // The caster pass runs at the map's size, before the view's own rectangle.
    const viewports = test.recorder
      .callsOf("viewport")
      .map((call) => call.args);
    expect(viewports[0]).toEqual([0, 0, 64, 64]);
    expect(viewports[1]).toEqual([0, 0, 256, 256]);

    // And the map is bound to a second texture unit for the shaded draws.
    const units = test.recorder
      .callsOf("activeTexture")
      .map((call) => call.args[0]);
    expect(units[0]).toBe(0x84c1);
  });

  it("takes the volume from the light's own node, so a rig aims it", async () => {
    // The value is asserted at the GL boundary by `packages/render-webgl`'s
    // unit suite, against a fake that does not share upload scratch (this
    // double records typed arrays by reference — see `FRAME_BEFORE_R18`). What
    // *this* suite proves is the cross-package claim: moving the light moves
    // the matrix that reaches the record a backend uploads.
    const test = await harness();
    const sun = shadowedScene(test);
    const out = createSceneLights();
    resolveWorldTransforms(test.scene);
    collectSceneLights(test.scene, out);
    const overhead = [...out.shadowMatrix.elements];
    expect(overhead).toEqual([
      ...sun.computeShadowMatrix(new Matrix4()).elements,
    ]);

    sun.transform.position.set(4, 8, -2);
    resolveWorldTransforms(test.scene);
    collectSceneLights(test.scene, out);
    expect([...out.shadowMatrix.elements]).not.toEqual(overhead);
    expect([...out.shadowMatrix.elements]).toEqual([
      ...sun.computeShadowMatrix(new Matrix4()).elements,
    ]);
  });

  it("honours §49's caster flag — an opted-out node is not in the map", async () => {
    const test = await harness();
    shadowedScene(test);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    // The floor is `castShadow: false`, the box is not: the caster pass issues
    // exactly one draw, the colour pass two.
    const draws = test.recorder.callsOf("drawElements");
    expect(draws).toHaveLength(3);
  });

  it("stops casting the moment the light's flag is cleared", async () => {
    const test = await harness();
    const sun = shadowedScene(test);
    const views = test.views;
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, views);

    sun.castShadow = false;
    test.recorder.reset();
    test.renderer.render(test.scene, views);

    // Back to the pre-R-18 frame shape: no pass, no framebuffer, no unit 1.
    expect(test.recorder.countOf("bindFramebuffer")).toBe(0);
    expect(test.recorder.countOf("activeTexture")).toBe(0);
  });

  it("keeps the light set and the shadow independent (§68, §69)", async () => {
    // The shadow attenuates the directional term only — the light set has no
    // maps at this tier — so a scene with both still collects both.
    const out = createSceneLights();
    const test = await harness();
    shadowedScene(test);
    resolveWorldTransforms(test.scene);

    collectSceneLights(test.scene, out);
    expect(out.hasDirectionalLight).toBe(true);
    expect(out.hasShadow).toBe(true);
    expect(out.punctualCount).toBe(0);
  });
});

describe("R-18 — §69's settings and R-4's residue", () => {
  it("refuses an unusable shadow setting rather than clamping it (§85)", () => {
    const shadow = new DirectionalLightShadow();
    expect(() => {
      shadow.mapSize = 0;
    }).toThrow(RangeError);
    expect(() => {
      shadow.normalBias = -1;
    }).toThrow(RangeError);
    expect(() => {
      shadow.near = 1000;
    }).toThrow(RangeError);
    // Nothing was written on the way out.
    expect([shadow.mapSize, shadow.normalBias, shadow.near]).toEqual([
      1024, 0, 0.1,
    ]);
  });

  it("gives an application the samplable depth R-4 staged", () => {
    // The residue, as public API: a target may now ask for a depth *texture*,
    // which is the attachment a shadow comparison samples.
    const target = new RenderTarget({
      width: 32,
      height: 32,
      depthTexture: true,
    });
    expect([target.depth, target.depthTexture]).toEqual([true, true]);
    expect(target.byteLength).toBe(32 * 32 * 8);
    target.dispose();
  });
});

describe("R-18 — a shadowed scene survives §79", () => {
  it("round-trips castShadow, the settings record, and both node flags", () => {
    const io = registerSceneNodeTypes({
      geometries: { keyOf: () => "geometry/box", get: () => boxGeometry() },
      materials: { keyOf: () => "material/lit", get: () => new LitMaterial() },
    });
    const scene = new Scene();
    const sun = new DirectionalLight({
      intensity: 3,
      castShadow: true,
      shadow: {
        mapSize: 2048,
        bias: 0.004,
        normalBias: 0.02,
        extent: 25,
        near: 1,
        far: 60,
      },
    });
    scene.add(sun);
    const floor = new Renderable(boxGeometry(), new LitMaterial(), {
      castShadow: false,
      receiveShadow: true,
    });
    scene.add(floor);

    const restored = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const [light, drawable] = restored.children as [
      DirectionalLight,
      Renderable,
    ];
    expect(light.castShadow).toBe(true);
    expect([light.shadow.mapSize, light.shadow.bias]).toEqual([2048, 0.004]);
    expect([light.shadow.normalBias, light.shadow.extent]).toEqual([0.02, 25]);
    expect([light.shadow.near, light.shadow.far]).toEqual([1, 60]);
    expect([drawable.castShadow, drawable.receiveShadow]).toEqual([
      false,
      true,
    ]);
  });

  it("loads a document written before §69 unchanged", () => {
    // Additive, exactly as R-17's `range` and cone angles were: the keys are
    // simply absent, and the light restores not casting with the documented
    // defaults — which is what that document meant.
    const io = registerSceneNodeTypes();
    const before: SceneDocument = {
      formatVersion: 1,
      nodes: [
        {
          type: "scene:directional-light",
          id: "node-sun",
          data: { color: [1, 1, 1], intensity: 2 },
        },
      ],
    };
    const restored = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(before)),
      io.components,
      io.read,
    );
    // `instantiateScene` returns the document's single root, which here *is*
    // the light.
    const light = restored as DirectionalLight;
    expect(light).toBeInstanceOf(DirectionalLight);
    expect(light.castShadow).toBe(false);
    expect(light.shadow.mapSize).toBe(1024);
    expect(light.intensity).toBe(2);
  });

  it("restores a default rather than failing on one corrupted number", () => {
    const io = registerSceneNodeTypes();
    const light = io.read.nodeFactory?.({
      type: "scene:directional-light",
      id: "node-sun",
      data: {
        castShadow: true,
        // Every one of these is refused by `DirectionalLightShadow`; the
        // document must restore a usable light rather than take the scene down.
        shadow: {
          mapSize: 12.5,
          normalBias: -3,
          extent: 0,
          near: 90,
          far: 10,
          bias: 0.01,
        },
      },
    }) as DirectionalLight | undefined;

    expect(light?.castShadow).toBe(true);
    expect(light?.shadow.mapSize).toBe(1024);
    expect(light?.shadow.normalBias).toBe(0);
    expect(light?.shadow.extent).toBe(10);
    expect([light?.shadow.near, light?.shadow.far]).toEqual([0.1, 100]);
    // The one legal field is kept.
    expect(light?.shadow.bias).toBe(0.01);
  });
});
