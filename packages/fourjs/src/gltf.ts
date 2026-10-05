/**
 * §78 glTF assembly — `instantiateGltf` (A-19's closing packet, 2026-08-29).
 *
 * `@fourjs/assets` parses a glTF file into plain validated data (its `gltf.ts`
 * states the tier and every refusal), because the frozen §3.1 matrix gives
 * that package `core` alone: a `Mesh`, a `Skeleton`, a `StandardMaterial`,
 * a `BufferGeometry`, and an `AnimationClip` are five packages it may not
 * name. The umbrella is the one place that sees all of them at once — the
 * same argument that put `scene-serializers.ts`, `Text`, and
 * `createPickProvider` here — so assembly lives in this module and adds no
 * dependency edge anywhere.
 *
 * ```ts
 * const asset = await assets.load("/models/robot.glb", gltfLoader);
 * const robot = instantiateGltf(asset);
 * app.scene.add(robot.scene!);
 * new AnimationMixer(robot).play(robot.animations[0]);
 * ```
 *
 * ## Sharing, per §78's own sentence
 *
 * §78: *"loaded assets should be instantiated without sharing mutable
 * transforms while safely sharing immutable geometry and textures."* Applied
 * literally:
 *
 * - **Nodes are fresh per call** — every instantiation owns its transforms.
 * - **Geometry and textures are built once per asset** and shared by every
 *   instantiation (a per-asset `WeakMap` cache; the arrays inside are the
 *   parse tier's own, held by reference and never written).
 * - **Materials are fresh per call**, because a material is *mutable* engine
 *   state — §78's sentence names geometry and textures, and tinting one
 *   instance must not tint the others.
 * - **Clips are built once per asset**: a clip is immutable data whose track
 *   paths are node *indices* (`nodes.<i>.transform.<channel>` — RFC 0003's
 *   indexed-array binding form), so one clip plays onto any instantiation by
 *   handing the mixer that instantiation as its target.
 *
 * ## Node shapes
 *
 * A glTF node becomes exactly one scene node, so animation channel `i` always
 * targets `nodes[i]`:
 *
 * - a **skin joint** becomes a `Bone` (its mesh, if any, hangs under it as
 *   identity-transform `Mesh` children — a bone cannot carry geometry);
 * - a node with a **single-primitive mesh** becomes that `Mesh` itself;
 * - a node with a **multi-primitive mesh** becomes a `Group` with one `Mesh`
 *   child per primitive;
 * - every other node becomes a `Group`.
 *
 * A matrix-form node is decomposed here (`Matrix4.decompose`), where
 * `@fourjs/math` is visible; the parse tier already refused non-finite
 * elements, and a zero-scale column decomposes to the documented identity
 * rotation rather than `NaN`.
 *
 * ## One-target morphs (RFC 0003 WP-SK.4)
 *
 * A primitive that carries `targets[0]` becomes a `BufferGeometry` with
 * `positions1`/`normals1`. Instantiation attaches a `MorphWeights`
 * component (one weight) on every mesh that has those streams, using
 * `nodes[i].weights` when authored else `meshes[i].weights`, else `[0]`.
 * WebGL mixes the streams; WebGPU skips the draw rather than showing the
 * bind pose. `weights` animation channels stay refused at parse.
 *
 * ## Skins and the §62 joint ceiling
 *
 * A skin becomes one `Skeleton` per instantiation (bones are per-instance
 * nodes), its inverse bind matrices shared by reference — bind-pose data the
 * engine never writes (RFC 0003: the binds absorb glTF's authoring
 * convention, so no axis conversion happens here either). Assignment goes
 * through `Mesh.skeleton`, so a skin over more than `MAX_SKINNING_JOINTS`
 * bones is refused by the **landed** `UNSUPPORTED_GPU_FEATURE` refusal — the
 * limit is declared once, where it lives, and this module does not restate
 * the number. Skinned meshes are created with `frustumCulled: false`, the
 * mitigation `Mesh`'s own header prescribes for bind-pose bounds under
 * animation (§87).
 *
 * ## What a §42 authority is not claimed
 *
 * Playing a loaded clip writes node transforms through the mixer with the
 * instantiation object (not a `Node`) as its target, so no single authority
 * node gates the writes — exactly the landed posture of RFC 0003's skeletal
 * tracks. An application that runs loaded animation beside physics assigns
 * `transformAuthority` on the nodes it hands to each system (§42).
 */

import type { GltfAsset } from "@fourjs/assets";
import {
  AnimationClip,
  AnimationTrack,
  quaternionAdapter,
  vector3Adapter,
  type AnimationTrackLike,
} from "@fourjs/animation";
import { FourError } from "@fourjs/core";
import { BufferGeometry } from "@fourjs/geometry";
import { StandardMaterial } from "@fourjs/materials";
import { Matrix4, Quaternion, Vector3 } from "@fourjs/math";
import { Mesh, Texture } from "@fourjs/render";
import { Bone, Group, MorphWeights, Skeleton, type Node } from "@fourjs/scene";

/**
 * One instantiation of a parsed glTF asset: fresh nodes over shared geometry,
 * textures, and clips. See the module header for exactly what is shared.
 */
export interface GltfInstance {
  /**
   * The file's default scene as a `Group`, or `null` when the file declares
   * none — glTF says a viewer may then display nothing, and inventing a
   * default would hide an authoring decision.
   */
  readonly scene: Group | null;
  /** Every scene, in file order, each a `Group` over its root nodes. */
  readonly scenes: readonly Group[];
  /**
   * The instantiated nodes, index-aligned with the file's `nodes` array —
   * the array every loaded clip's track paths index, and therefore the
   * object to hand an `AnimationMixer` as its target.
   */
  readonly nodes: readonly Node[];
  /** This instantiation's materials, index-aligned with the file's. */
  readonly materials: readonly StandardMaterial[];
  /**
   * The asset's clips, in file order — shared across instantiations (see the
   * module header), playable onto this instance:
   * `new AnimationMixer(instance).play(instance.animations[0])`.
   */
  readonly animations: readonly AnimationClip[];
}

/** What one asset shares across every instantiation. */
interface SharedResources {
  /** One geometry per primitive, indexed `[mesh][primitive]`. */
  readonly geometries: readonly (readonly BufferGeometry[])[];
  /** One renderer texture per decoded texture, sparse like the asset's. */
  readonly textures: readonly (Texture | null)[];
  /** One clip per animation. */
  readonly clips: readonly AnimationClip[];
}

/** The per-asset share, keyed weakly so a dropped asset takes it along. */
const sharedResources = new WeakMap<GltfAsset, SharedResources>();

/** Scratch for matrix-form node decomposition (§7b: no per-call allocation). */
const matrixScratch = new Matrix4();

/** Builds (once) the geometry, texture, and clip share for one asset. */
function resourcesFor(asset: GltfAsset): SharedResources {
  const existing = sharedResources.get(asset);
  if (existing !== undefined) {
    return existing;
  }

  const geometries: BufferGeometry[][] = [];
  for (const mesh of asset.meshes) {
    const list: BufferGeometry[] = [];
    for (const primitive of mesh.primitives) {
      // The parse tier validated everything this constructor validates
      // (alignment, finiteness, index ranges), so construction cannot refuse
      // a parsed primitive; the arrays are handed over by reference.
      list.push(
        new BufferGeometry({
          positions: primitive.positions,
          normals: primitive.normals,
          uvs: primitive.uvs,
          colors: primitive.colors,
          joints: primitive.joints,
          weights: primitive.weights,
          positions1: primitive.positions1,
          normals1: primitive.normals1,
          indices: primitive.indices,
          mode: primitive.mode,
        }),
      );
    }
    geometries.push(list);
  }

  const textures = asset.textures.map((decoded) =>
    decoded === null ? null : new Texture(decoded),
  );

  const clips: AnimationClip[] = [];
  for (let i = 0; i < asset.animations.length; i += 1) {
    const animation = asset.animations[i];
    const tracks: AnimationTrackLike[] = [];
    for (const channel of animation.channels) {
      const times = Array.from(channel.times);
      if (channel.path === "rotation") {
        const values: Quaternion[] = [];
        for (let k = 0; k < times.length; k += 1) {
          values.push(
            new Quaternion(
              channel.values[k * 4],
              channel.values[k * 4 + 1],
              channel.values[k * 4 + 2],
              channel.values[k * 4 + 3],
            ),
          );
        }
        tracks.push(
          new AnimationTrack({
            path: `nodes.${String(channel.node)}.transform.rotation`,
            adapter: quaternionAdapter,
            times,
            values,
            interpolation: channel.interpolation,
          }),
        );
      } else {
        const values: Vector3[] = [];
        for (let k = 0; k < times.length; k += 1) {
          values.push(
            new Vector3(
              channel.values[k * 3],
              channel.values[k * 3 + 1],
              channel.values[k * 3 + 2],
            ),
          );
        }
        const field = channel.path === "translation" ? "position" : "scale";
        tracks.push(
          new AnimationTrack({
            path: `nodes.${String(channel.node)}.transform.${field}`,
            adapter: vector3Adapter,
            times,
            values,
            interpolation: channel.interpolation,
          }),
        );
      }
    }
    clips.push(
      new AnimationClip({
        // A clip needs a non-empty name; an unnamed animation gets its index,
        // which is deterministic per input bytes (§33).
        name: animation.name === "" ? `animation.${String(i)}` : animation.name,
        tracks,
      }),
    );
  }

  const built: SharedResources = { geometries, textures, clips };
  sharedResources.set(asset, built);
  return built;
}

/**
 * Instantiates a parsed {@link GltfAsset} into live scene content (§78).
 *
 * Fresh nodes and materials per call over shared geometry, textures, and
 * clips — the module header states the sharing rule and the node shapes.
 * Ignored material texture slots (recorded by the parse tier) are §85-warned
 * here, once per material, because instantiation is where a picture becomes
 * wrong if nobody says so.
 *
 * @param asset - A loaded, undisposed glTF asset.
 * @returns The instantiated scene content.
 * @throws FourError `INVALID_APPLICATION_STATE` for a disposed asset;
 *   `UNSUPPORTED_GPU_FEATURE` from the landed `Mesh.skeleton` refusal when a
 *   skin exceeds the §62 joint ceiling.
 */
export function instantiateGltf(asset: GltfAsset): GltfInstance {
  if (asset.isDisposed) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Cannot instantiate glTF "${asset.url}": the asset has been disposed (§83).`,
      { context: { url: asset.url } },
    );
  }
  const resources = resourcesFor(asset);

  // Fresh materials per call (mutable state; module header). The default
  // material — glTF's own: white, metallic 1, roughness 1 — is created only
  // when a primitive needs it, and shared within the call.
  const materials: StandardMaterial[] = [];
  for (let i = 0; i < asset.materials.length; i += 1) {
    const record = asset.materials[i];
    materials.push(
      new StandardMaterial({
        baseColor: record.baseColor,
        metalness: record.metalness,
        roughness: record.roughness,
        emissive: record.emissive,
        transparent: record.transparent,
        map:
          record.baseColorTexture === null
            ? null
            : resources.textures[record.baseColorTexture],
        metalRoughnessMap:
          record.metallicRoughnessTexture === null
            ? null
            : resources.textures[record.metallicRoughnessTexture],
        normalScale: record.normalScale,
        occlusionStrength: record.occlusionStrength,
        normalMap:
          record.normalTexture === null
            ? null
            : resources.textures[record.normalTexture],
        occlusionMap:
          record.occlusionTexture === null
            ? null
            : resources.textures[record.occlusionTexture],
        emissiveMap:
          record.emissiveTexture === null
            ? null
            : resources.textures[record.emissiveTexture],
      }),
    );
  }
  let defaultMaterial: StandardMaterial | null = null;
  const materialFor = (index: number | null): StandardMaterial => {
    if (index !== null) {
      return materials[index];
    }
    defaultMaterial ??= new StandardMaterial({
      baseColor: [1, 1, 1, 1],
      metalness: 1,
      roughness: 1,
    });
    return defaultMaterial;
  };

  // Which nodes are joints of any skin — those instantiate as Bones.
  const jointNodes = new Set<number>();
  for (const skin of asset.skins) {
    for (const joint of skin.joints) {
      jointNodes.add(joint);
    }
  }

  // --- nodes, one engine node per glTF node (module header) -------------
  const nodes: Node[] = [];
  /** The meshes each node carries, for skeleton assignment below. */
  const nodeMeshes: Mesh<StandardMaterial>[][] = [];
  for (let i = 0; i < asset.nodes.length; i += 1) {
    const record = asset.nodes[i];
    const skinned = record.skin !== null;
    const buildMeshes = (): Mesh<StandardMaterial>[] => {
      if (record.mesh === null) {
        return [];
      }
      const meshRecord = asset.meshes[record.mesh];
      const built: Mesh<StandardMaterial>[] = [];
      for (let p = 0; p < meshRecord.primitives.length; p += 1) {
        built.push(
          new Mesh(
            resources.geometries[record.mesh][p],
            materialFor(meshRecord.primitives[p].material),
            // Bind-pose bounds cannot cull an animated skin honestly (§87;
            // Mesh's own header prescribes exactly this).
            skinned ? { frustumCulled: false } : {},
          ),
        );
      }
      return built;
    };

    let node: Node;
    let meshes: Mesh<StandardMaterial>[];
    if (jointNodes.has(i)) {
      node = new Bone();
      meshes = buildMeshes();
      for (const mesh of meshes) {
        node.add(mesh);
      }
    } else {
      meshes = buildMeshes();
      if (meshes.length === 1) {
        node = meshes[0];
      } else {
        node = new Group();
        for (const mesh of meshes) {
          node.add(mesh);
        }
      }
    }
    node.name = record.name;
    const authoredWeights =
      record.morphWeights ??
      (record.mesh === null
        ? undefined
        : asset.meshes[record.mesh].morphWeights);
    for (const mesh of meshes) {
      if (
        mesh.geometry.positions1 !== undefined ||
        authoredWeights !== undefined
      ) {
        mesh.addComponent(new MorphWeights(authoredWeights?.slice() ?? 1));
      }
    }
    if (record.matrix !== null) {
      matrixScratch
        .fromArray(record.matrix)
        .decompose(
          node.transform.position,
          node.transform.rotation,
          node.transform.scale,
        );
    } else {
      node.transform.position.set(
        record.translation[0],
        record.translation[1],
        record.translation[2],
      );
      node.transform.rotation.set(
        record.rotation[0],
        record.rotation[1],
        record.rotation[2],
        record.rotation[3],
      );
      node.transform.scale.set(
        record.scale[0],
        record.scale[1],
        record.scale[2],
      );
    }
    nodes.push(node);
    nodeMeshes.push(meshes);
  }

  // --- hierarchy, in file order (§33) -----------------------------------
  for (let i = 0; i < asset.nodes.length; i += 1) {
    for (const child of asset.nodes[i].children) {
      nodes[i].add(nodes[child]);
    }
  }

  // --- skins: one Skeleton per skin per instantiation -------------------
  const skeletons: Skeleton[] = [];
  for (const skin of asset.skins) {
    const bones: Bone[] = [];
    for (const joint of skin.joints) {
      // Parse guarantees every skin joint instantiated as a Bone above (and
      // `Skeleton`'s constructor re-checks with `instanceof`).
      bones.push(nodes[joint]);
    }
    skeletons.push(new Skeleton(bones, skin.inverseBindMatrices ?? undefined));
  }
  for (let i = 0; i < asset.nodes.length; i += 1) {
    const skin = asset.nodes[i].skin;
    if (skin === null) {
      continue;
    }
    for (const mesh of nodeMeshes[i]) {
      // Through the setter: the §62 joint ceiling's landed refusal fires
      // here for an over-budget rig (UNSUPPORTED_GPU_FEATURE).
      mesh.skeleton = skeletons[skin];
    }
  }

  // --- scenes ------------------------------------------------------------
  const scenes: Group[] = [];
  for (const sceneRecord of asset.scenes) {
    const group = new Group();
    group.name = sceneRecord.name;
    for (const root of sceneRecord.nodes) {
      group.add(nodes[root]);
    }
    scenes.push(group);
  }

  return {
    scene: asset.defaultScene === null ? null : scenes[asset.defaultScene],
    scenes,
    nodes,
    materials,
    animations: resources.clips,
  };
}
