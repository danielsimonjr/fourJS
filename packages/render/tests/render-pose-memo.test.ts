import { planeGeometry } from "@fourjs/geometry";
import { Matrix4, Quaternion, Vector3 } from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import {
  Bone,
  Group,
  PoseBuffer,
  Scene,
  Skeleton,
  type Node,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  Mesh,
  buildInterpolatedRenderList,
  type RenderItem,
} from "../src/index.js";

/** Oracle: the original un-memoized O(depth) composition. */
function oracle(
  node: Node,
  poses: PoseBuffer,
  alpha: number,
  out: Matrix4,
): void {
  const chain: Node[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) chain.push(n);
  const p = new Vector3();
  const q = new Quaternion();
  const scratch = new Matrix4();
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const c = chain[i];
    let local: Matrix4;
    if (poses.computeRenderPose(c, alpha, p, q)) {
      local = scratch.compose(p, q, c.transform.scale, c.transform.pivot);
    } else {
      c.transform.updateLocalMatrix();
      local = c.transform.localMatrix;
    }
    if (i === chain.length - 1) out.copy(local);
    else out.multiply(local);
  }
}

function skinned(): Mesh {
  const geometry = planeGeometry();
  const n = geometry.vertexCount;
  geometry.joints = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) w[i * 4] = 1;
  geometry.weights = w;
  return new Mesh(geometry, new UnlitMaterial());
}

function build() {
  const scene = new Scene();
  const g1 = new Group();
  const g2 = new Group();
  const g3 = new Group();
  const leaf = new Mesh(planeGeometry(), new UnlitMaterial());
  const skin = skinned();
  const bone = new Bone();
  scene.add(g1);
  g1.add(g2);
  g2.add(g3);
  g3.add(leaf);
  g1.add(skin);
  g3.add(bone);
  const bone2 = new Bone();
  bone.add(bone2);
  const skeleton = new Skeleton([bone, bone2]);
  skin.skeleton = skeleton;
  g1.transform.position.set(1, 2, 3);
  g2.transform.scale.set(2, 1, 1.5);
  g2.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
  g3.transform.position.set(0, 1, 0);
  leaf.transform.position.set(4, 0, 0);
  bone.transform.position.set(0, 0, 1);
  const poses = new PoseBuffer();
  const tracked = [g1, g2, g3, bone, bone2, skin];
  for (const t of tracked) poses.track(t);
  poses.capture();
  g1.transform.position.set(5, -2, 1);
  g2.transform.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
  g3.transform.position.set(2, 3, 0);
  bone.transform.position.set(1, 1, 1);
  bone2.transform.position.set(0, 2, 0);
  poses.capture();
  return { scene, leaf, skin, skeleton, bone, bone2, poses };
}

const snapshot = (list: RenderItem[]): number[][] =>
  list.map((i) => Array.from(i.worldMatrix.elements));

describe("interpolated render-pose memo", () => {
  it.each([0, 0.5, 1])(
    "matches the un-memoized composition at alpha %s",
    (alpha) => {
      const { scene, leaf, skin, skeleton, bone, bone2, poses } = build();
      const list = buildInterpolatedRenderList(scene, poses, alpha, []);
      const expected = new Matrix4();
      for (const item of list) {
        const node = item.geometry === leaf.geometry ? leaf : skin;
        oracle(node, poses, alpha, expected);
        expect(Array.from(item.worldMatrix.elements)).toEqual(
          Array.from(expected.elements),
        );
      }
      const ref = new Skeleton([bone, bone2]);
      const world = new Matrix4();
      ref.update(skin, (n: Node) => {
        oracle(n, poses, alpha, world);
        return world;
      });
      expect(Array.from(skeleton.jointMatrices)).toEqual(
        Array.from(ref.jointMatrices),
      );
    },
  );

  it("reuses pooled storage on a second build", () => {
    const { scene, poses } = build();
    const out: RenderItem[] = [];
    const first = buildInterpolatedRenderList(scene, poses, 0.5, out);
    const items = first.map((i) => i);
    const mats = first.map((i) => i.worldMatrix);
    const again = buildInterpolatedRenderList(scene, poses, 0.5, out);
    expect(again).toBe(out);
    again.forEach((it, k) => {
      expect(it).toBe(items[k]);
      expect(it.worldMatrix).toBe(mats[k]);
    });
  });

  it("does not leak memoised poses across alphas", () => {
    const { scene, poses } = build();
    const out: RenderItem[] = [];
    const a = snapshot(buildInterpolatedRenderList(scene, poses, 0, out));
    const b = snapshot(buildInterpolatedRenderList(scene, poses, 1, out));
    const a2 = snapshot(buildInterpolatedRenderList(scene, poses, 0, out));
    expect(b).not.toEqual(a);
    expect(a2).toEqual(a);
  });
});
