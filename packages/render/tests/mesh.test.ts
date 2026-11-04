/**
 * `Mesh`, the §79 skeleton-reference seam, and the skinned render-item kinds
 * (§54; RFC 0003 — gaps PH-10 + R-22).
 *
 * The load-bearing claims: the joint limit is refused **at setup** (§61/§89);
 * a mesh draws skinned exactly when skeleton, attributes, and material family
 * agree — every mismatch either degrades or skips with a named warning, never
 * silently draws a different picture; the palette on the item is the
 * skeleton's own array, refreshed in the same build (the particle-repack
 * precedent); and a saved skeleton reference resolves against the reloaded
 * bones on first read.
 */

import { isFourError, resetDevWarnings } from "@fourjs/core";
import { planeGeometry } from "@fourjs/geometry";
import {
  LitMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  Bone,
  Group,
  MorphWeights,
  PoseBuffer,
  Scene,
  Skeleton,
  resolveWorldTransforms,
} from "@fourjs/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_SKINNING_JOINTS,
  MAX_TEXTURE_SKINNING_JOINTS,
  Mesh,
  Renderable,
  buildRenderList,
  buildInterpolatedRenderList,
  isSkinnedLitItem,
  isSkinnedUnlitItem,
  restoreMeshSkeleton,
  type RenderItem,
} from "../src/index.js";

/** A geometry carrying §53's full skin layout over one triangle. */
function skinnedTriangle(): ReturnType<typeof planeGeometry> {
  const geometry = planeGeometry();
  const vertexCount = geometry.vertexCount;
  geometry.joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    weights[i * 4] = 1;
  }
  geometry.weights = weights;
  return geometry;
}

function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return isFourError(error) ? error.code : error;
  }
  return undefined;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe("Mesh (§54)", () => {
  it("is a Renderable with §54's name, and unskinned by default", () => {
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    expect(mesh).toBeInstanceOf(Renderable);
    expect(mesh.skeleton).toBeNull();
    expect(mesh.morphTargetWeights).toBeUndefined();
  });

  it("accepts a skeleton at or under the joint limit", () => {
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    const skeleton = new Skeleton([new Bone()]);
    mesh.skeleton = skeleton;
    expect(mesh.skeleton).toBe(skeleton);
    mesh.skeleton = null;
    expect(mesh.skeleton).toBeNull();
  });

  it("refuses a rig over MAX_SKINNING_JOINTS at setup (§61, §89)", () => {
    const bones: Bone[] = [];
    for (let i = 0; i <= MAX_SKINNING_JOINTS; i += 1) {
      bones.push(new Bone());
    }
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    expect(
      codeOf(() => {
        mesh.skeleton = new Skeleton(bones);
      }),
    ).toBe("UNSUPPORTED_GPU_FEATURE");
    expect(mesh.skeleton).toBeNull();
  });

  it("reads §54's morphTargetWeights through the MorphWeights component", () => {
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    const component = mesh.addComponent(new MorphWeights(2));
    expect(mesh.morphTargetWeights).toBe(component.weights);
    mesh.morphTargetWeights![0] = 0.5;
    expect(component.weights[0]).toBe(0.5);
  });
});

describe("restoreMeshSkeleton — the §79 reference seam", () => {
  it("refuses a malformed record loudly (§85)", () => {
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    expect(
      codeOf(() => restoreMeshSkeleton(mesh, [], new Float32Array())),
    ).toBe("INVALID_SCENE_GRAPH");
    expect(
      codeOf(() => restoreMeshSkeleton(mesh, ["a", "a"], new Float32Array(32))),
    ).toBe("INVALID_SCENE_GRAPH");
    expect(
      codeOf(() => restoreMeshSkeleton(mesh, ["a"], new Float32Array(15))),
    ).toBe("INVALID_SCENE_GRAPH");
  });

  it("resolves the bones by id on the first read, in the recorded order", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    const hip = new Bone({ id: "hip" });
    const knee = new Bone({ id: "knee" });
    hip.add(knee);
    scene.add(mesh, hip);
    // Recorded order is knee-first: the joint index follows the record, not
    // the tree's traversal order (§33 — the joint index is the ABI).
    restoreMeshSkeleton(mesh, ["knee", "hip"], new Float32Array(32).fill(0));
    // Malformed matrix contents are the Skeleton constructor's to refuse —
    // an all-zero bind array is finite and legal.
    const skeleton = mesh.skeleton;
    expect(skeleton).not.toBeNull();
    expect(skeleton?.bones.map((bone) => bone.id)).toEqual(["knee", "hip"]);
    // The next read answers from the resolved field, not a second traversal.
    expect(mesh.skeleton).toBe(skeleton);
  });

  it("stays pending while a bone is missing, and resolves once it exists", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    scene.add(mesh);
    restoreMeshSkeleton(mesh, ["late-bone"], new Float32Array(16));
    expect(mesh.skeleton).toBeNull();

    scene.add(new Bone({ id: "late-bone" }));
    expect(mesh.skeleton?.bones).toHaveLength(1);
  });

  it("refuses an id that names a node that is not a Bone (§85)", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    const impostor = new Group({ id: "impostor" });
    scene.add(mesh, impostor);
    restoreMeshSkeleton(mesh, ["impostor"], new Float32Array(16));
    expect(codeOf(() => mesh.skeleton)).toBe("INVALID_SCENE_GRAPH");
  });

  it("is discarded by an explicit skeleton assignment", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    const bone = new Bone({ id: "explicit-wins" });
    scene.add(mesh, bone);
    restoreMeshSkeleton(mesh, ["explicit-wins"], new Float32Array(16));
    const authored = new Skeleton([bone]);
    mesh.skeleton = authored;
    expect(mesh.skeleton).toBe(authored);
  });

  it("enforces the joint limit on a restored rig through the setter", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    scene.add(mesh);
    const ids: string[] = [];
    for (let i = 0; i <= MAX_SKINNING_JOINTS; i += 1) {
      const id = `restored-${String(i)}`;
      ids.push(id);
      scene.add(new Bone({ id }));
    }
    restoreMeshSkeleton(mesh, ids, new Float32Array(ids.length * 16));
    expect(codeOf(() => mesh.skeleton)).toBe("UNSUPPORTED_GPU_FEATURE");
  });
});

describe("the skinned render-item kinds (§54, §64; RFC 0003)", () => {
  const out: RenderItem[] = [];

  function buildOne(root: Scene): RenderItem[] {
    resolveWorldTransforms(root);
    return buildRenderList(root, out);
  }

  it("emits skinned-unlit for a skinned mesh over an UnlitMaterial", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);

    const items = buildOne(scene);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe("skinned-unlit");
    expect(isSkinnedUnlitItem(item)).toBe(true);
    expect(isSkinnedLitItem(item)).toBe(false);
    if (isSkinnedUnlitItem(item)) {
      // The palette is the skeleton's own array — reference, not copy.
      expect(item.jointMatrices).toBe(mesh.skeleton?.jointMatrices);
      expect(item.jointCount).toBe(1);
    }
  });

  it("emits skinned-lit for a LitMaterial, refreshed in the same build", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new LitMaterial());
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);

    const first = buildOne(scene);
    expect(first[0].kind).toBe("skinned-lit");
    const palette = mesh.skeleton?.jointMatrices;
    expect(palette[13]).toBe(0);

    // Move the bone; the *next build* refreshes the palette in the same pass
    // that emits the item — the particle-repack precedent.
    bone.transform.position.set(0, 2, 0);
    buildOne(scene);
    expect(palette[13]).toBe(2);
  });

  it("skips a skinned mesh whose material family has no skinned pipeline", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new StandardMaterial());
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    const witness = new Renderable(planeGeometry(), new UnlitMaterial());
    scene.add(mesh, bone, witness);

    const items = buildOne(scene);
    // The skinned standard draw is absent — not shown in bind pose — and the
    // rest of the scene is untouched.
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("unlit");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/no skinned pipeline/);

    // Once per node, not once per frame.
    buildOne(scene);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("draws unskinned, with a warning, when the geometry has no influences", () => {
    const scene = new Scene();
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);

    const items = buildOne(scene);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("unlit");
    expect(String(warn.mock.calls[0][0])).toMatch(/no joints\/weights/);
  });

  it("draws a jointed geometry without a skeleton as an ordinary surface", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    scene.add(mesh);
    const items = buildOne(scene);
    expect(items[0].kind).toBe("unlit");
    expect(warn).not.toHaveBeenCalled();
  });

  it("snapshots the MorphWeights component onto the item, and null without one", () => {
    const scene = new Scene();
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    const weights = mesh.addComponent(new MorphWeights([0.25, 0.75]));
    const plain = new Renderable(planeGeometry(), new UnlitMaterial());
    scene.add(mesh, plain);

    const items = buildOne(scene);
    expect(items[0].morphWeights).toBe(weights.weights);
    expect(items[1].morphWeights).toBeNull();
  });

  it("resets a pooled slot's morph weights when its occupant changes", () => {
    const scene = new Scene();
    const mesh = new Mesh(planeGeometry(), new UnlitMaterial());
    mesh.addComponent(new MorphWeights(1));
    scene.add(mesh);
    expect(buildOne(scene)[0].morphWeights).not.toBeNull();

    scene.remove(mesh);
    const plain = new Renderable(planeGeometry(), new UnlitMaterial());
    scene.add(plain);
    expect(buildOne(scene)[0].morphWeights).toBeNull();
  });

  it("masks a clipped skinned mesh with its bind-pose shape, unskinned (§67)", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial(), {
      clip: true,
    });
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);

    const items = buildOne(scene);
    // The mask draw sorts first and is not a skinned kind; the content draw
    // is. A mask is not content (R-23), and the bind-pose caveat is `Mesh`'s
    // documented §67 consequence.
    expect(items).toHaveLength(2);
    expect(items[0].clip?.maskPass).toBe(true);
    expect(items[0].kind).toBe("unlit");
    expect(items[0].morphWeights).toBeNull();
    expect(items[1].kind).toBe("skinned-unlit");
  });
});

describe("CPU mesh skinning", () => {
  it("feeds deformed geometry and bounds to the ordinary render pipeline", () => {
    const scene = new Scene();
    const bone = new Bone();
    const bind = skinnedTriangle();
    const mesh = new Mesh(bind, new StandardMaterial());
    mesh.skinningMode = "cpu";
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);
    bone.transform.position.x = 10;
    const items = buildRenderList(scene, []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("standard");
    expect(items[0].geometry.positions[0]).toBe(bind.positions[0] + 10);
    items[0].geometry.computeBounds();
    expect(items[0].geometry.bounds.min.x).toBe(bind.bounds.min.x + 10);
    expect(mesh.bindGeometry).toBe(bind);
    expect(mesh.geometry).toBe(items[0].geometry);
    mesh.dispose();
    expect(bind.disposed).toBe(false);
  });

  it("uses interpolated bones for rendering without overwriting the simulation pose", () => {
    const scene = new Scene();
    const bone = new Bone();
    const bind = skinnedTriangle();
    const mesh = new Mesh(bind, new UnlitMaterial());
    mesh.skinningMode = "cpu";
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);
    const poses = new PoseBuffer();
    poses.track(bone);
    poses.capture();
    bone.transform.position.x = 10;
    poses.capture();
    const items = buildInterpolatedRenderList(scene, poses, 0.25, []);
    expect(items[0].geometry.positions[0]).toBe(bind.positions[0] + 2.5);
    expect(bone.transform.position.x).toBe(10);
    expect(mesh.geometry.positions[0]).toBe(bind.positions[0] + 10);
  });

  it("permits large CPU rigs while refusing a switch to the fixed GPU tier", () => {
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "cpu";
    mesh.skeleton = new Skeleton(Array.from({ length: 49 }, () => new Bone()));
    expect(mesh.geometry.positions.length).toBeGreaterThan(0);
    expect(() => {
      mesh.skinningMode = "gpu";
    }).toThrow();
    expect(mesh.skinningMode).toBe("cpu");
    mesh.skeleton = null;
    mesh.skinningMode = "gpu";
    expect(mesh.geometry).toBe(mesh.bindGeometry);
    expect(() => {
      mesh.skinningMode = "invalid" as "cpu";
    }).toThrow(TypeError);
  });

  it("releases generated geometry on source replacement and GPU switching", () => {
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "cpu";
    mesh.skeleton = new Skeleton([new Bone()]);
    const generated = mesh.geometry;
    const replacement = skinnedTriangle();
    mesh.geometry = replacement;
    expect(generated.disposed).toBe(true);
    const next = mesh.geometry;
    expect(next).not.toBe(generated);
    mesh.skinningMode = "gpu";
    expect(next.disposed).toBe(true);
    expect(mesh.geometry).toBe(replacement);
    mesh.dispose();
    mesh.dispose();
  });
});

describe('bone-texture skinning mode ("texture", decision D7)', () => {
  const bones = (n: number): Bone[] =>
    Array.from({ length: n }, () => new Bone());

  it("accepts a rig past the 48-joint uniform tier and flags the item", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "texture";
    expect(mesh.skinningMode).toBe("texture");
    const rig = bones(MAX_SKINNING_JOINTS + 10);
    mesh.skeleton = new Skeleton(rig);
    scene.add(mesh, ...rig);
    resolveWorldTransforms(scene);
    const items = buildRenderList(scene, []);
    expect(items[0].kind).toBe("skinned-unlit");
    expect((items[0] as { paletteTexture?: boolean }).paletteTexture).toBe(
      true,
    );
    expect((items[0] as { jointCount?: number }).jointCount).toBe(58);
  });

  it("leaves the uniform item unflagged", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    const bone = new Bone();
    mesh.skeleton = new Skeleton([bone]);
    scene.add(mesh, bone);
    resolveWorldTransforms(scene);
    const items = buildRenderList(scene, []);
    expect((items[0] as { paletteTexture?: boolean }).paletteTexture).toBe(
      false,
    );
  });

  it("refuses the uniform tier for a large texture rig, and a rig over the cap", () => {
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "texture";
    mesh.skeleton = new Skeleton(bones(MAX_SKINNING_JOINTS + 1));
    expect(() => {
      mesh.skinningMode = "gpu";
    }).toThrow();
    expect(mesh.skinningMode).toBe("texture");
    mesh.skeleton = null;
    mesh.skinningMode = "gpu";
    expect(mesh.skinningMode).toBe("gpu");
    expect(MAX_TEXTURE_SKINNING_JOINTS).toBe(65535);
  });

  it("refuses a skeleton over the texture cap (setter and mode switch)", () => {
    const big = {
      bones: { length: MAX_TEXTURE_SKINNING_JOINTS + 1 },
      jointCount: MAX_TEXTURE_SKINNING_JOINTS + 1,
    };
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "texture";
    expect(
      codeOf(() => {
        mesh.skeleton = big as unknown as Skeleton;
      }),
    ).toBe("UNSUPPORTED_GPU_FEATURE");
    const cpu = new Mesh(skinnedTriangle(), new UnlitMaterial());
    cpu.skinningMode = "cpu";
    cpu.skeleton = big as unknown as Skeleton;
    expect(
      codeOf(() => {
        cpu.skinningMode = "texture";
      }),
    ).toBe("UNSUPPORTED_GPU_FEATURE");
  });

  it("switching texture to cpu then back releases nothing it should keep", () => {
    const mesh = new Mesh(skinnedTriangle(), new UnlitMaterial());
    mesh.skinningMode = "texture";
    mesh.skinningMode = "cpu";
    mesh.skeleton = new Skeleton([new Bone()]);
    expect(mesh.geometry).not.toBe(mesh.bindGeometry);
    mesh.skinningMode = "texture";
    expect(mesh.geometry).toBe(mesh.bindGeometry);
    expect(() => {
      mesh.skinningMode = "bogus" as "cpu";
    }).toThrow(/gpu, cpu or texture/);
  });
});
