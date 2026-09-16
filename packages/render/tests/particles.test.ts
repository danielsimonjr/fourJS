/**
 * The batched particle render item and its structural contract (§36, §64, plan
 * P9-3).
 *
 * ## Why the drawable is a test double rather than the real class
 *
 * `@fourjs/particles`' `ParticleRenderable` is the production implementation, and
 * this package cannot import it: the frozen §3.1 dependency matrix has no edge
 * between `render` and `particles` in either direction (they are in the same
 * dispatch wave). That is the whole reason `ParticleDrawable` is a *structural*
 * contract, so exercising it with a double is not a shortcut here — the double
 * is exactly what any conforming node is, and these tests are the render-side
 * half of the pair that pins the contract. The other half lives in
 * `@fourjs/particles`' `tests/particle-renderable.test.ts` and asserts the same
 * member names and the same interleaved layout from the producing side.
 */

import { planeGeometry } from "@fourjs/geometry";
import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { SpriteMaterial, UnlitMaterial } from "@fourjs/materials";
import {
  DEFAULT_LAYER_MASK,
  Node,
  PoseBuffer,
  Scene,
  resolveWorldTransforms,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  NullRenderer,
  PARTICLE_COLOR_OFFSET,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_POSITION_OFFSET,
  PARTICLE_SIZE_OFFSET,
  Renderable,
  Sprite,
  Texture,
  buildInterpolatedRenderList,
  buildRenderList,
  isParticleDrawable,
  isParticlesItem,
  isSpriteItem,
  isUnlitItem,
  particleQuadGeometry,
  type ParticleDrawable,
  type RenderItem,
} from "../src/index.js";

/**
 * A conforming particle node: a real `Node` (so the scene graph, visibility,
 * and the §43 pose path are the real ones) implementing `ParticleDrawable`
 * structurally.
 *
 * `implements ParticleDrawable` is written out here — inside `@fourjs/render`,
 * where the interface is visible — precisely because `@fourjs/particles` cannot
 * write it. If this compiles and the member list matches the one the other
 * package's tests assert, the contract holds at both ends.
 */
class TestParticles extends Node implements ParticleDrawable {
  readonly isParticleDrawable = true;

  renderLayer = 0;

  renderOrder = 0;

  particleCount = 0;

  readonly particleInstances: Float32Array;

  updateCalls = 0;

  constructor(capacity: number, count = capacity) {
    super();
    this.particleInstances = new Float32Array(
      capacity * PARTICLE_INSTANCE_FLOATS,
    );
    this.particleCount = count;
  }

  updateParticleInstances(): void {
    this.updateCalls += 1;
    // A conforming node refreshes both here; this one only records the call and
    // stamps the first particle so a test can see the *repacked* value reach the
    // item.
    this.particleInstances[PARTICLE_POSITION_OFFSET] = this.updateCalls;
  }
}

/** The pooled item at `index`, narrowed to the particle arm. */
function particlesAt(list: readonly RenderItem[], index: number) {
  const item = list[index];
  if (!isParticlesItem(item)) {
    throw new Error(`item ${String(index)} is not a particle item`);
  }
  return item;
}

/** A scene holding `node`, for the one-liner cases. */
function sceneWith(node: Node): Scene {
  const scene = new Scene();
  scene.add(node);
  return scene;
}

describe("particleQuadGeometry (§53, plan P9-3)", () => {
  it("is one shared, non-indexed unit quad centred on the origin", () => {
    const quad = particleQuadGeometry();

    expect(particleQuadGeometry()).toBe(quad);
    expect(quad.mode).toBe("triangles");
    expect(quad.indices).toBeUndefined();
    expect(quad.drawCount).toBe(6);
    expect(Array.from(quad.positions)).toEqual([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ]);
  });

  it("spans one unit in x and y so a size-1 particle is one unit across", () => {
    const bounds = particleQuadGeometry().computeBounds();

    expect(bounds.min.x).toBe(-0.5);
    expect(bounds.min.y).toBe(-0.5);
    expect(bounds.max.x).toBe(0.5);
    expect(bounds.max.y).toBe(0.5);
    expect(bounds.max.z - bounds.min.z).toBe(0);
  });

  it("winds counter-clockwise seen from +Z, like every other builder (§7a)", () => {
    const p = particleQuadGeometry().positions;
    // Cross product of the first triangle's edges must point at +Z.
    const ax = p[3] - p[0];
    const ay = p[4] - p[1];
    const bx = p[6] - p[0];
    const by = p[7] - p[1];

    expect(ax * by - ay * bx).toBeGreaterThan(0);
  });
});

describe("isParticleDrawable (the structural contract)", () => {
  it("accepts a node carrying the brand and the repack method", () => {
    expect(isParticleDrawable(new TestParticles(4))).toBe(true);
  });

  it("rejects everything else, including the other two drawables", () => {
    expect(isParticleDrawable(null)).toBe(false);
    expect(isParticleDrawable(undefined)).toBe(false);
    expect(isParticleDrawable(7)).toBe(false);
    expect(isParticleDrawable({})).toBe(false);
    expect(
      isParticleDrawable(new Renderable(planeGeometry(), new UnlitMaterial())),
    ).toBe(false);
  });

  it("rejects a node that claims the brand without implementing the shape", () => {
    // The failure mode a structural contract has and a base class does not: a
    // node that brands itself but has no repack method must degrade to "does
    // not draw", never to a TypeError inside the render loop.
    const liar = new Renderable(
      planeGeometry(),
      new UnlitMaterial(),
    ) as unknown as Record<string, unknown>;
    liar.isParticleDrawable = true;

    expect(isParticleDrawable({ isParticleDrawable: true })).toBe(false);
    expect(isParticleDrawable(liar)).toBe(false);
    expect(
      buildRenderList(sceneWith(liar as unknown as Node), []),
    ).toHaveLength(1);
  });
});

describe("buildRenderList — particles (§64, plan P9-3)", () => {
  it("emits exactly ONE item for a whole system", () => {
    const scene = new Scene();
    const particles = new TestParticles(1000, 750);
    scene.add(particles);

    const list = buildRenderList(scene, []);

    expect(list).toHaveLength(1);
    const item = particlesAt(list, 0);
    expect(item.kind).toBe("particles");
    expect(item.count).toBe(750);
    expect(item.instances).toBe(particles.particleInstances);
    expect(item.geometry).toBe(particleQuadGeometry());
    expect(item.id).toBe(particles.id);
    expect(item.worldMatrix).toBe(particles.transform.worldMatrix);
  });

  it("carries no material, and says so readably", () => {
    const scene = new Scene();
    scene.add(new TestParticles(2));

    const [item] = buildRenderList(scene, []);

    expect(item.material).toBeUndefined();
    expect(isParticlesItem(item)).toBe(true);
    expect(isUnlitItem(item)).toBe(false);
    expect(isSpriteItem(item)).toBe(false);
  });

  it("copies the §66 sort keys off the node", () => {
    const scene = new Scene();
    const particles = new TestParticles(2);
    particles.renderLayer = 3;
    particles.renderOrder = -2;
    scene.add(particles);

    const item = particlesAt(buildRenderList(scene, []), 0);

    expect(item.renderLayer).toBe(3);
    expect(item.renderOrder).toBe(-2);
    // §66 key 2: §36 carries no material to declare `transparent`, and the
    // pipeline blends by construction, so the item classifies **opaque** —
    // which is what keeps a particle scene in the order it drew in before the
    // key existed (2026-08-06).
    expect(item.transparent).toBe(false);
  });

  it("repacks exactly once per build, before the item is read", () => {
    const scene = new Scene();
    const particles = new TestParticles(4);
    scene.add(particles);

    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    expect(particles.updateCalls).toBe(1);
    expect(particlesAt(out, 0).instances[PARTICLE_POSITION_OFFSET]).toBe(1);

    buildRenderList(scene, out);
    expect(particles.updateCalls).toBe(2);
    expect(particlesAt(out, 0).instances[PARTICLE_POSITION_OFFSET]).toBe(2);
  });

  it("honours §6 visibility and enablement like any other drawable", () => {
    const scene = new Scene();
    const particles = new TestParticles(2);
    scene.add(particles);

    particles.visible = false;
    expect(buildRenderList(scene, [])).toHaveLength(0);
    particles.visible = true;
    particles.enabled = false;
    expect(buildRenderList(scene, [])).toHaveLength(0);
    expect(particles.updateCalls).toBe(0);
  });

  it("sorts against the other kinds by layer, then render order, then scene order", () => {
    const scene = new Scene();
    const back = new TestParticles(1);
    back.renderLayer = 0;
    const front = new TestParticles(1);
    front.renderLayer = 2;
    const mesh = new Renderable(planeGeometry(), new UnlitMaterial(), {
      renderLayer: 1,
    });
    scene.add(front, mesh, back);

    const kinds = buildRenderList(scene, []).map((item) => item.kind);

    expect(kinds).toEqual(["particles", "unlit", "particles"]);
  });

  it("clears a material the pooled slot carried for an earlier frame's mesh", () => {
    const scene = new Scene();
    const mesh = new Renderable(planeGeometry(), new UnlitMaterial());
    scene.add(mesh);

    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    expect(out[0].material).toBe(mesh.material);

    // The same pooled slot now serves a particle system.
    scene.remove(mesh);
    scene.add(new TestParticles(2));
    buildRenderList(scene, out);

    expect(out[0].kind).toBe("particles");
    expect(out[0].material).toBeUndefined();
  });

  it("reuses the pooled item across rebuilds and allocates nothing", () => {
    const scene = new Scene();
    scene.add(new TestParticles(64, 8), new TestParticles(64, 8));

    const out: RenderItem[] = [];
    const first = buildRenderList(scene, out)[0];

    resetConstructionCount();
    for (let frame = 0; frame < 10; frame += 1) {
      buildRenderList(scene, out);
    }

    expect(constructionCount()).toBe(0);
    expect(out[0]).toBe(first);
    expect(out).toHaveLength(2);
  });

  it("does not confuse a particle node with the geometry-bearing drawables", () => {
    const scene = new Scene();
    scene.add(
      new TestParticles(2),
      new Renderable(planeGeometry(), new UnlitMaterial()),
    );
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);

    expect(list.map((item) => item.kind)).toEqual(["particles", "unlit"]);
    expect(list.filter(isParticlesItem)).toHaveLength(1);
  });
});

describe("buildInterpolatedRenderList — particles (§43)", () => {
  it("interpolates the system's transform, not its particles", () => {
    const scene = new Scene();
    const particles = new TestParticles(8, 4);
    scene.add(particles);
    const poses = new PoseBuffer();
    poses.track(particles);
    poses.capture(); // seeds both poses from the current transform
    particles.transform.position.set(4, 0, 0);
    poses.capture(); // previous = origin, current = (4, 0, 0)

    const item = particlesAt(
      buildInterpolatedRenderList(scene, poses, 0.25, []),
      0,
    );

    // The node's pose is blended…
    expect(item.worldMatrix.elements[12]).toBeCloseTo(1, 12);
    expect(item.worldMatrix).not.toBe(particles.transform.worldMatrix);
    // …and the particle data is whatever the last repack produced, unblended.
    expect(item.instances).toBe(particles.particleInstances);
    expect(item.count).toBe(4);
  });

  it("allocates nothing once its matrix pool is warm", () => {
    const scene = new Scene();
    scene.add(new TestParticles(8, 4));
    const poses = new PoseBuffer();

    const out: RenderItem[] = [];
    buildInterpolatedRenderList(scene, poses, 0.5, out);

    resetConstructionCount();
    for (let frame = 0; frame < 10; frame += 1) {
      buildInterpolatedRenderList(scene, poses, frame / 10, out);
    }

    expect(constructionCount()).toBe(0);
  });
});

describe("NullRenderer — particles (§62 headless tier)", () => {
  it("accepts a scene containing a particle system", async () => {
    const renderer = new NullRenderer();
    await renderer.initialize();
    const scene = new Scene();
    scene.add(new TestParticles(4));

    renderer.render(scene, []);

    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastRenderRoot).toBe(scene);
  });
});

describe("the interleaved instance layout (the cross-package contract)", () => {
  it("pins the stride and the channel offsets", () => {
    expect(PARTICLE_INSTANCE_FLOATS).toBe(8);
    expect(PARTICLE_POSITION_OFFSET).toBe(0);
    expect(PARTICLE_SIZE_OFFSET).toBe(3);
    expect(PARTICLE_COLOR_OFFSET).toBe(4);
    // Position (3) + size (1) + colour (4) fill the stride exactly.
    expect(PARTICLE_COLOR_OFFSET + 4).toBe(PARTICLE_INSTANCE_FLOATS);
  });

  it("is 32 bytes per particle — 3.2 MB for §112's 100 000-particle budget", () => {
    const bytes =
      PARTICLE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT * 100_000;

    expect(bytes).toBe(3_200_000);
  });

  it("keeps a sprite item's own fields intact alongside the new arm", () => {
    const scene = new Scene();
    const sprite = new Sprite(
      new SpriteMaterial({
        texture: new Texture({ width: 1, height: 1, data: new Uint8Array(4) }),
      }),
    );
    scene.add(sprite);

    const [item] = buildRenderList(scene, []);

    expect(item.kind).toBe("sprite");
    expect(item.material).toBe(sprite.material);
    expect(isParticlesItem(item)).toBe(false);
  });
});

describe("§46 layer filtering of a particle system (R-38)", () => {
  it("snapshots the emitter's mask onto its batched item", () => {
    const node = new TestParticles(2);
    node.layers = 0b10;
    const list = buildRenderList(sceneWith(node), []);

    expect(list).toHaveLength(1);
    expect(particlesAt(list, 0).layers).toBe(0b10);
  });

  it("drops the system — and skips its repack — when no view wants its layer", () => {
    const node = new TestParticles(2);
    node.layers = 0b10;
    const scene = sceneWith(node);

    const list = buildRenderList(scene, [], 0b01);

    expect(list).toHaveLength(0);
    // `updateParticleInstances` is the emitter's own per-build work (plan
    // P9-3); a filtered system must not pay it.
    expect(node.updateCalls).toBe(0);
  });

  it("keeps drawing at the default mask", () => {
    const node = new TestParticles(2);
    const list = buildRenderList(sceneWith(node), []);

    expect(list).toHaveLength(1);
    expect(particlesAt(list, 0).layers).toBe(DEFAULT_LAYER_MASK);
    expect(node.updateCalls).toBe(1);
  });
});

describe("particle items and §69 shadows (R-18)", () => {
  it("neither casts nor receives, whatever occupied the pooled slot before", () => {
    // §36's billboards are camera-facing quads: no surface to project into a
    // map, no lighting term to attenuate. Written rather than left, so a slot
    // that carried a `Renderable` last frame cannot hand its flags on.
    const out: RenderItem[] = [];
    const mesh = new Scene();
    mesh.add(new Renderable(planeGeometry(), new UnlitMaterial()));
    resolveWorldTransforms(mesh);
    buildRenderList(mesh, out);
    expect([out[0].castShadow, out[0].receiveShadow]).toEqual([true, true]);

    const scene = sceneWith(new TestParticles(4));
    resolveWorldTransforms(scene);
    buildRenderList(scene, out);
    const item = particlesAt(out, 0);
    expect([item.castShadow, item.receiveShadow]).toEqual([false, false]);
  });
});

describe("buildRenderList — live particle bounds (R-8 follow-up b)", () => {
  it("leaves frustumCulled false when the emitter publishes no AABB", () => {
    const [item] = buildRenderList(sceneWith(new TestParticles(4)), []);

    expect(item.frustumCulled).toBe(false);
    expect(item.worldBounds).toBeNull();
  });

  it("copies a published local AABB onto the item as a world sphere", () => {
    class BoundedParticles extends TestParticles {
      computeBounds(outMin: Vector3, outMax: Vector3): boolean {
        outMin.set(-2, -1, -0.5);
        outMax.set(2, 1, 0.5);
        return true;
      }
    }
    const node = new BoundedParticles(4);
    node.transform.position.set(10, 0, 0);
    const scene = sceneWith(node);
    resolveWorldTransforms(scene);

    const [item] = buildRenderList(scene, []);

    expect(item.frustumCulled).toBe(true);
    expect(item.worldBounds).not.toBeNull();
    expect(item.worldBounds?.center.x).toBeCloseTo(10, 12);
    expect(item.worldBounds?.radius).toBeGreaterThan(2);
  });

  it("stays un-culled when computeBounds returns false (empty / GPU)", () => {
    class EmptyParticles extends TestParticles {
      computeBounds(): boolean {
        return false;
      }
    }

    const [item] = buildRenderList(sceneWith(new EmptyParticles(4)), []);

    expect(item.frustumCulled).toBe(false);
    expect(item.worldBounds).toBeNull();
  });
});
