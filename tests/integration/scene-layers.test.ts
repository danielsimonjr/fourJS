/**
 * R-38 — §46 symbolic layers, end to end across `scene`, `render`, and
 * `render-webgl` (2026-08-08).
 *
 * The layer model is one fact spread over three packages: `@fourjs/scene` owns
 * the registry and the three masks (`Node.layers`, §47's `Camera.layers`, §48's
 * `Viewport.layerMask`), `@fourjs/render` filters during §64 traversal and
 * snapshots each node's mask onto its item, and `@fourjs/render-webgl` resolves
 * the per-view mask and skips what it does not want. No unit test inside any
 * one of them can check the agreement, which is what this file is for.
 *
 * Four claims:
 *
 * 1. **Declaring layers costs nothing.** A scene that exercises every shipped
 *    pipeline emits the byte-identical GL sequence whether or not its nodes,
 *    cameras, and viewports carry masks — as long as no view narrows. This is
 *    the **ninth run** of the recorded-sequence method (R-4, R-5, R-6, F13,
 *    A-1, R-13, R-15, and the R-6/R-13 re-runs), and it is the property the
 *    pixel goldens and the browser gate depend on. The four transcripts pinned
 *    in sibling files (`render-to-texture`, `render-effects`,
 *    `frame-statistics`, `standard-material`) were all recorded at commits
 *    before layers existed and are all still asserted verbatim; this file adds
 *    the A/B those cannot express, because a *pinned* transcript cannot show
 *    that two live scenes agree.
 * 2. **Filtering an item out is indistinguishable from it never having been
 *    there.** The GL a masked view emits for a scene containing a UI panel is
 *    identical to the GL the same view emits for a scene with no panel in it —
 *    which is the honest statement of "the filter removes draws and nothing
 *    else", stronger than counting `drawElements`.
 * 3. **One camera, two viewports, no overdraw.** The §118 flagship's recorded
 *    workaround (a screen-space panel parented to the camera because a second
 *    viewport would draw the whole scene twice) is discharged: each item is
 *    drawn exactly once across two views that select disjoint layers.
 * 4. **Traversal order and determinism are untouched.** A masked render list is
 *    a *subsequence* of the unmasked one, not a permutation of a subset, and
 *    two builds of the same masked scene agree exactly.
 *
 * The scenes are real and only the GL context is a double, for the reason
 * `render-graph.test.ts` gives at length.
 */

import { BufferGeometry, boxGeometry, planeGeometry } from "@fourjs/geometry";
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
  viewLayerMask,
  type RenderItem,
} from "@fourjs/render";
import { WebglRenderer, registerStandardPipeline } from "@fourjs/render-webgl";
import {
  ALL_LAYERS,
  DEFAULT_LAYER_MASK,
  DEFAULT_LAYER_NAME,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  applyLayers,
  createFullscreenViewport,
  defineLayer,
  layerMask,
  layerMaskNames,
  layerNames,
  resetLayers,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    camera,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order — the
 * aliasing `render-effects.test.ts` introduced, and the reason it gives: two
 * renderers mint different serials for the same frame, so the *relative* order
 * of a frame's own handles is what can be compared across runs.
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

/** Positions, uvs and per-vertex colours — R-19's two unlit multipliers. */
function coloredQuad(): BufferGeometry {
  return new BufferGeometry({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    mode: "triangles",
  });
}

/**
 * One draw through every pipeline this engine ships — flat unlit, unlit with a
 * texture and vertex colours, Lambert-lit, lit + texture, metallic-roughness,
 * and a blended sprite — under one directional light.
 *
 * Deliberately not a minimal scene: the property under test is that a filter
 * with a permissive mask changes nothing for *anybody*, and "anybody" is every
 * pipeline with its texture, vertex-colour, and blend-state switches, which a
 * one-quad scene would leave untested.
 */
function everyPipeline(test: Harness, texture: Texture): void {
  const light = new DirectionalLight({ color: [1, 0.95, 0.9], intensity: 2 });
  light.transform.position.set(0, 3, 3);
  test.scene.add(light);

  test.scene.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ color: [1, 0, 0, 1] })),
  );
  test.scene.add(
    new Renderable(
      coloredQuad(),
      new UnlitMaterial({ map: texture, vertexColors: true }),
    ),
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
      new StandardMaterial({ metalness: 1, roughness: 0.25 }),
    ),
  );
  test.scene.add(new Sprite(new SpriteMaterial({ texture }), { width: 2 }));
}

/**
 * Warms every cache — programs, geometry buffers, textures, the lazy sampler
 * uploads — then records exactly one steady-state frame.
 */
function steadyFrame(test: Harness, views = test.views): string[] {
  resolveWorldTransforms(test.scene);
  test.renderer.render(test.scene, views);
  test.renderer.render(test.scene, views);

  test.recorder.reset();
  resolveWorldTransforms(test.scene);
  test.renderer.render(test.scene, views);
  return aliasHandles(test.recorder.transcript());
}

beforeEach(() => {
  resetLayers();
});

afterEach(() => {
  resetLayers();
});

describe("R-38 — declaring layers is byte-identical in GL (§46)", () => {
  it("emits the same frame whether or not the scene mentions layers", async () => {
    // A: the scene as it would have been written before §46 existed.
    const plain = await harness();
    everyPipeline(plain, checkerTexture());
    const before = steadyFrame(plain);

    // B: the same scene, every node placed on a named layer, the camera aimed
    // at all of them, and the viewport asking for all of them explicitly.
    const layered = await harness();
    everyPipeline(layered, checkerTexture());
    defineLayer("world");
    defineLayer("ui");
    applyLayers(layered.scene, layerMask("world", "ui"));
    layered.camera.layers = layerMask("world", "ui");
    const views = [
      {
        ...createFullscreenViewport(layered.camera),
        layerMask: layerMask("world", "ui"),
      },
    ];
    const after = steadyFrame(layered, views);

    expect(after).toEqual(before);
    // And the frame is not trivially empty: six draws went through it.
    expect(before.filter((line) => line.startsWith("draw"))).toHaveLength(6);
  });

  it("costs nothing when the camera and viewport keep their defaults", async () => {
    const plain = await harness();
    everyPipeline(plain, checkerTexture());
    const before = steadyFrame(plain);

    const layered = await harness();
    everyPipeline(layered, checkerTexture());
    applyLayers(layered.scene, layerMask("world"));
    // Nothing else touched: a default camera sees ALL_LAYERS and a fullscreen
    // viewport declares no mask, so the filter is a no-op on the existing path.
    layered.camera.layers = ALL_LAYERS;
    const after = steadyFrame(layered);

    expect(after).toEqual(before);
    expect(viewLayerMask(layered.views[0])).toBe(ALL_LAYERS);
  });
});

describe("R-38 — a filtered item draws exactly as an absent one (§48)", () => {
  /**
   * The same world content, with and without a UI panel that a
   * `layerMask("world")` view must not draw.
   */
  async function worldWithOptionalPanel(withPanel: boolean): Promise<Harness> {
    const test = await harness();
    const texture = checkerTexture();
    everyPipeline(test, texture);
    if (withPanel) {
      const panel = new Sprite(new SpriteMaterial({ texture }), { width: 1 });
      panel.layers = layerMask("ui");
      const label = new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [0, 1, 0, 1] }),
      );
      label.layers = layerMask("ui");
      panel.add(label);
      test.scene.add(panel);
    }
    return test;
  }

  it("emits the GL of the panel-free scene when the view excludes the panel", async () => {
    defineLayer("world");
    defineLayer("ui");
    applyLayers(new Scene(), DEFAULT_LAYER_MASK); // keep bit order deterministic

    const absent = await worldWithOptionalPanel(false);
    const withoutPanel = steadyFrame(absent, [
      {
        ...createFullscreenViewport(absent.camera),
        layerMask: layerMask(DEFAULT_LAYER_NAME),
      },
    ]);

    const present = await worldWithOptionalPanel(true);
    const filtered = steadyFrame(present, [
      {
        ...createFullscreenViewport(present.camera),
        layerMask: layerMask(DEFAULT_LAYER_NAME),
      },
    ]);

    expect(filtered).toEqual(withoutPanel);
  });

  it("draws the panel — and only the panel — into the view that selects it", async () => {
    defineLayer("ui");
    const test = await worldWithOptionalPanel(true);
    const uiOnly = steadyFrame(test, [
      {
        ...createFullscreenViewport(test.camera, "ui"),
        layerMask: layerMask("ui"),
      },
    ]);

    // Two drawables on the `ui` layer, and nothing else in a scene of eight.
    expect(uiOnly.filter((line) => line.startsWith("draw"))).toHaveLength(2);
  });
});

describe("R-38 — one camera, two viewports, no overdraw (§48; the §118 follow-up)", () => {
  it("draws each item exactly once across two disjoint views", async () => {
    defineLayer("ui");
    const test = await harness();
    const texture = checkerTexture();
    everyPipeline(test, texture);

    const panel = new Sprite(new SpriteMaterial({ texture }), { width: 1 });
    panel.layers = layerMask("ui");
    test.scene.add(panel);

    const world: Viewport = {
      ...createFullscreenViewport(test.camera, "world"),
      layerMask: layerMask(DEFAULT_LAYER_NAME),
      clearColor: [0, 0, 0, 1],
    };
    const ui: Viewport = {
      ...createFullscreenViewport(test.camera, "ui"),
      layerMask: layerMask("ui"),
    };

    const transcript = steadyFrame(test, [world, ui]);
    const draws = transcript.filter((line) => line.startsWith("draw"));

    // Seven drawables, two views, seven draws — not fourteen. That is the
    // arithmetic the §118 flagship's camera-parented panel existed to avoid.
    expect(draws).toHaveLength(7);
    // Both views ran: two viewport rectangles, two depth clears.
    expect(transcript.filter((line) => line.startsWith("clearDepth"))).toEqual([
      "clearDepth(1)",
      "clearDepth(1)",
    ]);
  });

  it("resolves each view's mask from §48's fallback rule", async () => {
    defineLayer("ui");
    const test = await harness();
    test.camera.layers = layerMask(DEFAULT_LAYER_NAME, "ui");

    const inherits = createFullscreenViewport(test.camera, "inherits");
    const narrows: Viewport = {
      ...createFullscreenViewport(test.camera, "narrows"),
      layerMask: layerMask("ui"),
    };

    expect(viewLayerMask(inherits)).toBe(layerMask(DEFAULT_LAYER_NAME, "ui"));
    expect(viewLayerMask(narrows)).toBe(layerMask("ui"));
  });
});

describe("R-38 — determinism and ordering (§33, §64)", () => {
  it("makes a masked list a subsequence of the unmasked one", async () => {
    defineLayer("ui");
    const test = await harness();
    const texture = checkerTexture();
    everyPipeline(test, texture);
    // Put the third and fifth drawables on `ui`, so the survivors are not a
    // contiguous run and a permutation would be visible.
    const drawables = test.scene.children.filter(
      (node) => node instanceof Renderable,
    );
    drawables[2].layers = layerMask("ui");
    drawables[4].layers = layerMask("ui");
    resolveWorldTransforms(test.scene);

    const all: RenderItem[] = [];
    buildRenderList(test.scene, all);
    const allGeometries = all.map((item) => item.geometry);

    const masked: RenderItem[] = [];
    buildRenderList(test.scene, masked, layerMask(DEFAULT_LAYER_NAME));
    const maskedGeometries = masked.map((item) => item.geometry);

    expect(maskedGeometries).toHaveLength(allGeometries.length - 2);
    expect(
      allGeometries.filter((geometry) => maskedGeometries.includes(geometry)),
    ).toEqual(maskedGeometries);
  });

  it("builds the same masked list twice", async () => {
    defineLayer("ui");
    const test = await harness();
    everyPipeline(test, checkerTexture());
    test.scene.children[2].layers = layerMask("ui");
    resolveWorldTransforms(test.scene);

    const describeList = (mask: number): string[] => {
      const list: RenderItem[] = [];
      buildRenderList(test.scene, list, mask);
      return list.map(
        (item) =>
          `${item.kind}:${String(item.renderLayer)}:${String(item.renderOrder)}:` +
          `${String(item.transparent)}:${String(item.layers)}`,
      );
    };

    expect(describeList(layerMask(DEFAULT_LAYER_NAME))).toEqual(
      describeList(layerMask(DEFAULT_LAYER_NAME)),
    );
  });
});

describe("R-38 — §46's names survive the round trip a scene file needs", () => {
  it("restores a document's exact bit assignment by replaying its names", () => {
    defineLayer("ui");
    defineLayer("debug");
    const saved = layerNames();
    const savedNodeMask = layerMaskNames(layerMask("debug", "ui"));
    expect(saved).toEqual([DEFAULT_LAYER_NAME, "ui", "debug"]);
    expect(savedNodeMask).toEqual(["ui", "debug"]);

    // A reader in a fresh process — or after a reset — replays the names in
    // saved order and gets the same bits, which is why §46 requires the names
    // in the file and never the number.
    resetLayers();
    for (const name of saved) {
      defineLayer(name);
    }
    expect(layerNames()).toEqual(saved);

    let restored = 0;
    for (const name of savedNodeMask) {
      restored |= layerMask(name);
    }
    expect(layerMaskNames(restored >>> 0)).toEqual(savedNodeMask);
  });
});
