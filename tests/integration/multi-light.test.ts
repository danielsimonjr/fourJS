/**
 * R-17 — §68's light set, across the four packages that have to agree on it
 * (2026-08-09).
 *
 * §68 lists six light types; the tree had two of them (ambient, directional)
 * and could shade a frame with exactly one lamp. This packet adds the two
 * *positional* ones — `PointLight` and `SpotLight` — as scene nodes, collects
 * them into a bounded uniform-array light set, and teaches both shaded
 * pipelines to loop over it. No unit test inside one package can check that
 * agreement: `@fourjs/scene` owns the nodes, `@fourjs/render` owns the packing and
 * the ordering rule, and `@fourjs/render-webgl` is the only place any of it
 * becomes GL.
 *
 * Four claims:
 *
 * 1. **A scene with no point or spot light is byte-identical.** The whole
 *    feature is gated on an `int` uniform seeded at GL's own initial `0`, so a
 *    frame drawn through every pre-R-17 pipeline — unlit, lit, sprite *and*
 *    §59's standard — emits the GL sequence recorded before the light set
 *    existed, call for call. This is the claim the pixel goldens and every
 *    browser test rest on, and it is why `FRAME_BEFORE_R17` below is a
 *    recording rather than a wish.
 * 2. **One lamp reaches both shaded pipelines**, packed the way the shader
 *    reads it: a world position, a colour premultiplied by intensity, a range,
 *    and a cone word that is zero for a point light.
 * 3. **The bound is enforced deterministically.** Past
 *    `MAX_PUNCTUAL_LIGHTS` the first lights in scene-graph order win, the rest
 *    are skipped, and the scene says so once.
 * 4. **A lit scene survives §79** — the two new node types round-trip through
 *    the umbrella's serializers with their photometry, their cones, and their
 *    placement intact.
 */

import { boxGeometry, planeGeometry } from "@fourjs/geometry";
import { Vector3 } from "@fourjs/math";
import {
  LitMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  MAX_PUNCTUAL_LIGHTS,
  Renderable,
  Sprite,
  Texture,
  collectSceneLights,
  createSceneLights,
} from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  PointLight,
  Scene,
  SpotLight,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@fourjs/serialization";
import { registerSceneNodeTypes } from "fourJS";
import { afterEach, describe, expect, it, vi } from "vitest";

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
 * aliasing `render-effects.test.ts` introduced; see it, or
 * `standard-material.test.ts`, for why raw serials cannot be compared across
 * builds while the relative order of a frame's own handles can.
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
 * The scene `FRAME_BEFORE_R17` was recorded from: one draw through **every**
 * pipeline that can be shaded or textured, under the lighting every scene
 * before this packet could have — an ambient term and one directional light.
 *
 * Deliberately not a minimal scene, for `standard-material.test.ts`'s reason
 * one packet on: the property R-17 has to prove is that a light *set* changes
 * nothing for a scene that does not use one, and "nothing" has to be shown
 * across the two pipelines that grew new uniforms (lit, standard) as well as
 * the two that did not (unlit, sprite).
 */
function directionalOnlyScene(test: Harness): void {
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
 * The GL a steady-state frame of {@link directionalOnlyScene} emitted on
 * **2026-08-09**, at the last build before §68's light set existed.
 *
 * Recorded, not written. Do not "fix" a failure here by re-recording: this
 * list is the regression guard for every pixel golden and every browser test,
 * and a change to it is a change to what a frame that uses no point or spot
 * light draws. Updated 2026-09-09: lit/standard `setModel` now also uploads
 * `uniform mat3 normalMatrix` (identity for these identity models) — sequence
 * only; shading of non-singular models is the same inverse-transpose.
 *
 * The same caveat `standard-material.test.ts` states applies: the double
 * records typed-array arguments **by reference** and every upload in this
 * backend goes through shared scratch, so the numbers inside `[...]` are the
 * scratch's final contents rather than each call's own. This transcript is a
 * proof about the **sequence** — which calls, in which order, with which
 * handles. Per-draw uniform *values* are asserted by the unit tests in
 * `packages/render-webgl`.
 */
const FRAME_BEFORE_R17: readonly string[] = [
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

describe("R-17 — a scene without a point or spot light is byte-identical (§68)", () => {
  it("emits the GL sequence recorded before the light set existed", async () => {
    const test = await harness();
    directionalOnlyScene(test);

    // Warm every cache — programs, geometry buffers, textures, and the lazy
    // sampler uploads — so the comparison is about a steady-state frame, as it
    // was when the expected transcript was recorded.
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R17);
  });

  it("never touches a light-set uniform location in that frame", async () => {
    // The stronger, handle-level form of the same claim. The double mints
    // handles as `{ kind, serial }` with one shared counter, so the tape can be
    // replayed to recover exactly which objects the five light-set names
    // resolved to — and then the frame checked for any mention of them.
    const test = await harness();
    directionalOnlyScene(test);
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
        String(call.args[1]).startsWith("punctual")
      ) {
        handles.push(JSON.stringify({ kind: "getUniformLocation", serial }));
      }
    }
    // Five names each, in the two shaded pipelines — resolved once, at
    // initialization, which is the whole cost of R-17 to a scene without lamps.
    expect(handles).toHaveLength(10);

    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const frame = test.recorder.transcript();
    for (const handle of handles) {
      expect(frame.some((line) => line.includes(handle))).toBe(false);
    }
  });
});

describe("R-17 — the light set reaches the GPU (§68)", () => {
  /** A scene with one lit and one standard draw, plus whatever `extra` adds. */
  async function shadedScene(extra: (scene: Scene) => void): Promise<Harness> {
    const test = await harness();
    test.scene.add(new DirectionalLight());
    extra(test.scene);
    test.scene.add(
      new Renderable(boxGeometry(), new LitMaterial({ color: [1, 1, 1, 1] })),
    );
    test.scene.add(new Renderable(boxGeometry(), new StandardMaterial()));

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    return test;
  }

  /** How many uniform uploads of each entry point a steady frame issued. */
  function uploads(test: Harness): Record<string, number> {
    return {
      uniform1i: test.recorder.countOf("uniform1i"),
      uniform3fv: test.recorder.countOf("uniform3fv"),
      uniform4fv: test.recorder.countOf("uniform4fv"),
    };
  }

  it("costs a lampless frame nothing and a lamped frame exactly five uploads per pipeline", async () => {
    const without = await shadedScene(() => {});
    const with_ = await shadedScene((scene) => {
      const lamp = new PointLight({ color: [1, 0.5, 0.25], intensity: 4 });
      lamp.transform.position.set(2, 3, -1);
      scene.add(lamp);
    });

    const before = uploads(without);
    const after = uploads(with_);
    // Per shaded pipeline: three `vec3` arrays, one `vec4` array, and the
    // `int` count — and there are two shaded pipelines in this frame.
    expect(after.uniform3fv - before.uniform3fv).toBe(6);
    expect(after.uniform4fv - before.uniform4fv).toBe(2);
    // The count is *not* among them: this is a steady-state frame, and the
    // CPU mirror settled on the first frame that had a lamp.
    expect(after.uniform1i - before.uniform1i).toBe(0);
  });

  it("uploads the count once per pipeline, on the frame it changes", async () => {
    const test = await harness();
    test.scene.add(new PointLight());
    test.scene.add(
      new Renderable(boxGeometry(), new LitMaterial({ color: [1, 1, 1, 1] })),
    );
    test.scene.add(new Renderable(boxGeometry(), new StandardMaterial()));
    resolveWorldTransforms(test.scene);

    // First frame: every cache is cold, so the two `useMap` switches and the
    // two counts are the `uniform1i` traffic. Isolate the counts by taking the
    // difference against the *second* frame, where only the arrays repeat.
    test.renderer.render(test.scene, test.views);
    const first = uploads(test);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const second = uploads(test);

    // The arrays go up again — a lamp may have moved — but the count is
    // mirrored on the CPU and re-uploaded only on change: once per pipeline,
    // on the first frame, and never again.
    expect(second.uniform3fv).toBe(first.uniform3fv);
    expect(second.uniform4fv).toBe(first.uniform4fv);
    expect(first.uniform1i - second.uniform1i).toBe(2);
  });

  it("packs the world position, the premultiplied colour, and no cone", () => {
    // The arithmetic half, asserted on the record rather than through the
    // shared GL scratch (which the recorder can only snapshot by reference).
    const scene = new Scene();
    const lamp = new PointLight({
      color: [1, 0.5, 0.25],
      intensity: 4,
      range: 12,
    });
    lamp.transform.position.set(2, 3, -1);
    scene.add(lamp);
    resolveWorldTransforms(scene);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.punctualCount).toBe(1);
    expect([...lights.punctualPositions.slice(0, 3)]).toEqual([2, 3, -1]);
    expect([...lights.punctualColors.slice(0, 3)]).toEqual([4, 2, 1]);
    expect([...lights.punctualParams.slice(0, 4)]).toEqual([12, 0, 0, 0]);
  });

  it("aims a spot light along the same -Z axis a directional light uses", () => {
    const scene = new Scene();
    const sun = new DirectionalLight();
    const spot = new SpotLight({ outerConeAngle: Math.PI / 6 });
    // One rig orientation, two kinds of light: the axes must agree.
    const axisX = new Vector3(1, 0, 0);
    sun.transform.rotation.setFromAxisAngle(axisX, -Math.PI / 2);
    spot.transform.rotation.setFromAxisAngle(axisX, -Math.PI / 2);
    scene.add(sun, spot);
    resolveWorldTransforms(scene);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.direction.y).toBeCloseTo(-1, 12);
    expect(lights.punctualDirections[1]).toBeCloseTo(-1, 6);
    expect(lights.punctualParams[3]).toBe(1);
  });
});

describe("R-17 — past the bound (§68, §33)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the first lights in scene-graph order and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const test = await harness();
    for (let i = 0; i < MAX_PUNCTUAL_LIGHTS + 2; i += 1) {
      test.scene.add(new PointLight({ intensity: i }));
    }
    test.scene.add(
      new Renderable(boxGeometry(), new LitMaterial({ color: [1, 1, 1, 1] })),
    );

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    // A drawn frame warns once, not once per frame and not once per pipeline.
    expect(warn).toHaveBeenCalledTimes(1);

    const lights = collectSceneLights(test.scene, createSceneLights());
    expect(lights.punctualCount).toBe(MAX_PUNCTUAL_LIGHTS);
    for (let i = 0; i < MAX_PUNCTUAL_LIGHTS; i += 1) {
      expect(lights.punctualColors[i * 3]).toBe(i);
    }
  });
});

describe("R-17 — the new nodes survive §79", () => {
  it("round-trips a point and a spot light through a document", () => {
    const io = registerSceneNodeTypes();
    const scene = new Scene();
    const lamp = new PointLight({
      color: [1, 0.85, 0.6],
      intensity: 4,
      range: 12,
    });
    lamp.transform.position.set(2, 3, -1);
    const spot = new SpotLight({
      intensity: 9,
      innerConeAngle: Math.PI / 10,
      outerConeAngle: Math.PI / 6,
    });
    scene.add(lamp, spot);

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const [restoredLamp, restoredSpot] = reloaded.children as [
      PointLight,
      SpotLight,
    ];
    expect(restoredLamp).toBeInstanceOf(PointLight);
    expect([...restoredLamp.color]).toEqual([1, 0.85, 0.6]);
    expect([restoredLamp.intensity, restoredLamp.range]).toEqual([4, 12]);
    expect(restoredLamp.transform.position.z).toBe(-1);

    expect(restoredSpot).toBeInstanceOf(SpotLight);
    expect([restoredSpot.innerConeAngle, restoredSpot.outerConeAngle]).toEqual([
      Math.PI / 10,
      Math.PI / 6,
    ]);

    // And the reloaded scene lights exactly as the authored one did.
    resolveWorldTransforms(scene);
    resolveWorldTransforms(reloaded);
    const authored = collectSceneLights(scene, createSceneLights());
    const restored = collectSceneLights(reloaded, createSceneLights());
    expect([...restored.punctualPositions]).toEqual([
      ...authored.punctualPositions,
    ]);
    expect([...restored.punctualParams]).toEqual([...authored.punctualParams]);
  });
});

describe("hemisphere light (§68)", () => {
  it("does not touch hemisphere uniforms on a directional-only frame", async () => {
    const test = await harness();
    directionalOnlyScene(test);
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
        String(call.args[1]).toLowerCase().includes("hemisphere")
      ) {
        handles.push(JSON.stringify({ kind: "getUniformLocation", serial }));
      }
    }
    // Four names each, in the two shaded pipelines — resolved at
    // initialization, never uploaded on a scene that has no hemisphere.
    expect(handles).toHaveLength(8);

    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const frame = test.recorder.transcript();
    for (const handle of handles) {
      expect(frame.some((line) => line.includes(handle))).toBe(false);
    }
  });

  it("collects and round-trips a hemisphere beside the sun", () => {
    const io = registerSceneNodeTypes();
    const scene = new Scene();
    scene.add(
      new HemisphereLight({
        color: [0.5, 0.6, 1],
        groundColor: [0.25, 0.15, 0.1],
        intensity: 0.8,
      }),
    );
    scene.add(new DirectionalLight({ intensity: 2 }));

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.hasHemisphereLight).toBe(true);
    expect(lights.hasDirectionalLight).toBe(true);
    expect(lights.hemisphereSky[2]).toBeCloseTo(0.8, 12);

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );
    const restored = collectSceneLights(reloaded, createSceneLights());
    expect(restored.hasHemisphereLight).toBe(true);
    expect(restored.hemisphereSky).toEqual(lights.hemisphereSky);
    expect(restored.hemisphereGround).toEqual(lights.hemisphereGround);
  });
});
