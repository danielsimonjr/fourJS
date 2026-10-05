/**
 * `Mesh` (§54) — the renderable that can be skinned (RFC 0003 — gaps PH-10 +
 * R-22, 2026-08-28).
 *
 * §54 declares `class Mesh extends Renderable` with `geometry`, `skeleton`,
 * and `morphTargetWeights`, and this module is where the class finally lands —
 * it is "the carrier for everything else" in RFC 0003's row table. What each
 * §54 field resolves to here:
 *
 * - **`geometry`** is inherited: `Renderable` already owns the field, and a
 *   mesh's skin influences are the geometry's own `joints`/`weights`
 *   attributes (§53; `@fourjs/geometry`).
 * - **`skeleton`** is this class's field, validated at assignment — see
 *   {@link Mesh.skeleton}.
 * - **`morphTargetWeights`** is an **accessor over the `MorphWeights`
 *   component** (`@fourjs/scene`), not storage: §54's own placement was
 *   unimplementable under the frozen §3.1 matrix (`@fourjs/animation` may never
 *   see this package), so the storage moved to a §6a component and the
 *   spelling here is kept as a getter — the amendment §54 records (spec
 *   revision 1.8; RFC 0003 §1c).
 *
 * ## Which §54 rows this class carries, and which stay staged (RFC 0003 §7)
 *
 * **Ships:** the class itself; skeletal deformation (through the skinned
 * render-item kinds and `@fourjs/render-webgl`'s registered skinning pipeline);
 * the morph-target plumbing (component, §17 binding form, weights on the
 * render item) **and the one-target GPU morph path** (`positions1`/`normals1`
 * at attribute locations 6/7; WebGL mixes, WebGPU skips the draw rather than
 * showing bind pose). **Staged, deliberately:** a second morph target and
 * beyond; multiple material groups (R-12's follow-up — `material` stays
 * single here as on `Renderable`); hardware instancing (needs an
 * instance-transform attribute; the blocker for §86's 100 000-instance row);
 * indirect rendering (WebGPU); static-versus-dynamic GPU buffer usage (every
 * geometry uploads `STATIC_DRAW` today); level of detail, impostors,
 * billboards, and the merging tools (ordinary packets). CPU skinning is
 * available explicitly through `CpuSkinning` in `@fourjs/geometry`; bone
 * textures and dual-quaternion skinning remain deferred.
 *
 * ## Two known inaccuracies, entered deliberately (RFC 0003 §6)
 *
 * **GPU skinning is never read back into simulation.** For CPU vertex
 * positions, `CpuSkinning` provides a separate same-runtime deterministic
 * implementation; attach its output to an ordinary renderable to use deformed
 * geometry for CPU picking or bounds. Automatic GPU-skinned meshes retain two
 * documented consequences, recorded at this type because this is where a user
 * meets them:
 *
 * - **§71 picking against a skinned mesh uses bind-pose bounds**, and is
 *   therefore wrong whenever the pose differs materially from bind
 *   (`@fourjs/input`'s `pick.ts` already defers analytic picking; this is a
 *   second known inaccuracy of the same kind).
 * - **§87 frustum culling culls a skinned mesh by its bind-pose bounds**, so
 *   an animation that moves geometry outside them can pop; set
 *   `frustumCulled = false` on such a mesh, or wait for the authored
 *   bounds-expansion factor RFC 0003 names and defers. The same bind-pose
 *   caveat applies to a §67 `clip` on a skinned mesh (the mask is the
 *   bind-pose shape). The §69 WebGL caster pass deforms skinned casters
 *   when `registerSkinningPipeline()` is linked; without it the draw is
 *   skipped rather than casting a bind-pose shadow. WebGPU draws the
 *   skinned colour pair and the §69 caster behind the same
 *   registration (`acquireShadow`); unregistered or failed casters
 *   skip, never bind-pose. The RFC 0005 skinned id pass
 *   lives in `wgpu-picking.ts` behind `registerPickingPipeline()`.
 */

import { FourError } from "@fourjs/core";
import { CpuSkinning, type BufferGeometry } from "@fourjs/geometry";
import type { Material } from "@fourjs/materials";
import type { Matrix4 } from "@fourjs/math";
import { Bone, MorphWeights, Skeleton, type Node } from "@fourjs/scene";

import {
  Renderable,
  type RenderableOptions,
  type SurfaceMaterial,
} from "./renderable.js";

/**
 * The most bones one skinned draw may use — the declared §62 capability behind
 * `RendererCapabilities.maximumSkinningJoints` (RFC 0003 §5).
 *
 * **48**, a portability floor rather than a device query, and the arithmetic
 * is the reason: the palette is `uniform mat4 jointMatrices[N]` in the vertex
 * stage, WebGL 2 guarantees only `MAX_VERTEX_UNIFORM_VECTORS ≥ 256` vec4s, a
 * mat4 is four of them, and the skinned programs' other uniforms (two
 * matrices, colours, §68's light set) need headroom — `48 × 4 = 192` vec4s
 * leaves 64 for everything else on the worst conformant device. A constant
 * rather than a `getParameter` read, deliberately: R-30b's recorded law binds
 * (*a capability query must be lazy if the alternative moves recorded
 * transcripts*), and a per-device limit is a negotiation the fixed-palette
 * tier does not need — the unbounded path is a bone **texture**, deferred
 * with its reasons in RFC 0003 (it needs the render-target format union
 * widened and vertex texture fetch checked per device).
 *
 * A `Skeleton` over more bones is refused **at setup** — {@link Mesh.skeleton}
 * throws `UNSUPPORTED_GPU_FEATURE` (§89) on assignment — following R-5/R-6's
 * setup-time validation stance (§61: a backend may not throw from inside a
 * frame). Splitting into per-palette submeshes and a CPU fallback are the
 * named, not-taken alternatives (RFC 0003 open question 5, adopted).
 */
export const MAX_SKINNING_JOINTS = 48;

/**
 * A restored-but-unresolved §79 skeleton reference — bone **ids** in
 * joint-index order plus the inverse bind matrices, exactly what the document
 * carries (§79: intra-file references are by id). See
 * {@link restoreMeshSkeleton}.
 */
interface PendingSkeleton {
  readonly boneIds: readonly string[];
  readonly inverseBindMatrices: Float32Array;
}

/**
 * §79 skeleton references awaiting their bones, keyed by mesh.
 *
 * A module-level `WeakMap` rather than a private field so that
 * {@link restoreMeshSkeleton} — a free function, following `restoreNodeId`'s
 * shape — can hand a reference over without the class exposing a public
 * restoration method every application would see. A discarded mesh takes its
 * pending reference with it.
 */
const pendingSkeletons = new WeakMap<Mesh<Material>, PendingSkeleton>();

/**
 * A drawable node with vertex geometry, an optional skeleton, and optional
 * morph-target weights (§49, §54).
 *
 * ```ts
 * const mesh = new Mesh(skinnedGeometry, new LitMaterial());
 * mesh.skeleton = new Skeleton([hip, knee, foot], inverseBinds);
 * scene.add(mesh, hip);          // bones are ordinary scene nodes (§42, §79)
 * ```
 *
 * A mesh draws **skinned** exactly when it has a skeleton *and* its geometry
 * carries both `joints` and `weights` (§53) *and* its material's family has a
 * skinned pipeline — `"unlit"` and `"lit"` at this tier (a development build
 * warns about each mismatch; see `render-list.ts`). The render list makes that
 * decision per frame and updates the skeleton's palette in the same pass the
 * way it repacks a particle system, so the uploaded matrices can never be a
 * step older than the item pointing at them. A mesh with no skeleton is an
 * ordinary `Renderable` with §54's name.
 */
export class Mesh<M extends Material = SurfaceMaterial> extends Renderable<M> {
  #skeleton: Skeleton | null = null;

  #skinningMode: "gpu" | "cpu" = "gpu";

  #cpuSkinning: CpuSkinning | null = null;

  /**
   * CPU mode supplies deformed geometry to rendering, bounds and picking.
   * It supports palettes larger than the GPU uniform tier. Set this before
   * assigning a large skeleton. CPU results belong to the same-runtime tier.
   */
  get skinningMode(): "gpu" | "cpu" {
    return this.#skinningMode;
  }

  set skinningMode(value: "gpu" | "cpu") {
    if (value !== "gpu" && value !== "cpu") {
      throw new TypeError("Mesh skinningMode must be gpu or cpu.");
    }
    if (
      value === "gpu" &&
      (this.skeleton?.jointCount ?? 0) > MAX_SKINNING_JOINTS
    ) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "The skeleton exceeds the GPU uniform palette limit.",
      );
    }
    this.#skinningMode = value;
    if (value === "gpu") {
      this.#cpuSkinning?.dispose();
      this.#cpuSkinning = null;
    }
  }

  /** Authored geometry, kept in bind pose even when CPU deformation is active. */
  get bindGeometry(): BufferGeometry {
    return super.geometry;
  }

  override get geometry(): BufferGeometry {
    return this.updateCpuGeometry();
  }

  /** Updates the CPU pose; render interpolation may supply render-only worlds. */
  updateCpuGeometry(worldOf?: (node: Node) => Matrix4): BufferGeometry {
    const source = super.geometry;
    const skeleton = this.skeleton;
    if (this.#skinningMode !== "cpu" || skeleton === null) {
      return source;
    }
    const deformation = (this.#cpuSkinning ??= new CpuSkinning(source));
    skeleton.update(this, worldOf);
    return deformation.update(skeleton.jointMatrices);
  }

  override set geometry(value: BufferGeometry) {
    this.#cpuSkinning?.dispose();
    this.#cpuSkinning = null;
    super.geometry = value;
  }

  /** Releases only generated CPU geometry; shared authored resources remain alive. */
  dispose(): void {
    this.#cpuSkinning?.dispose();
    this.#cpuSkinning = null;
  }

  /**
   * Builds a mesh for `geometry` and `material` — `Renderable`'s constructor,
   * inherited unchanged. The skeleton is assigned afterwards, because a §79
   * factory and a model loader both meet the bones after the mesh.
   */
  constructor(
    geometry: Renderable["geometry"],
    material: M,
    options: RenderableOptions = {},
  ) {
    super(geometry, material, options);
  }

  /**
   * The rig this mesh deforms against, or `null` for an unskinned mesh (§54).
   *
   * Assignment is **setup-time validation** (§85; RFC 0003 §5): a skeleton
   * whose bone count exceeds {@link MAX_SKINNING_JOINTS} is refused here with
   * `UNSUPPORTED_GPU_FEATURE` (§89), because §61 forbids a backend from
   * throwing inside a frame and a silent clamp would deform against half a
   * rig. Assigning also discards any unresolved §79 reference — an explicit
   * skeleton outranks a document's.
   *
   * Reading resolves a pending §79 reference first — see
   * {@link restoreMeshSkeleton} for why resolution waits for the first read.
   */
  get skeleton(): Skeleton | null {
    const pending = pendingSkeletons.get(this);
    if (pending !== undefined) {
      this.#resolvePendingSkeleton(pending);
    }
    return this.#skeleton;
  }

  set skeleton(value: Skeleton | null) {
    if (
      this.#skinningMode === "gpu" &&
      value !== null &&
      value.bones.length > MAX_SKINNING_JOINTS
    ) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        `Mesh ${this.id} was given a skeleton of ` +
          `${String(value.bones.length)} bones, but one skinned draw may use ` +
          `at most ${String(MAX_SKINNING_JOINTS)} ` +
          "(§62 maximumSkinningJoints; RFC 0003 — refused at setup, §61).",
        { context: { node: this.id, bones: value.bones.length } },
      );
    }
    pendingSkeletons.delete(this);
    this.#skeleton = value;
  }

  /**
   * §54's `morphTargetWeights` — the `MorphWeights` component's array, or
   * `undefined` when the node carries no component (RFC 0003 §1c).
   *
   * An accessor, not storage: the weights live in a §6a component on this
   * node, which is what lets `@fourjs/animation` bind a §17 morph-weight track
   * to them (it can see `@fourjs/scene`, never this package) and what makes them
   * serializable through the existing §79 component registry. Attach the
   * component to give a mesh weights:
   *
   * ```ts
   * mesh.addComponent(new MorphWeights(2));
   * mesh.morphTargetWeights![0] = 0.5;   // §54's spelling still works
   * ```
   *
   * Read-only by design — replacing the array would orphan every §16 binding
   * resolved against it (resolved once, at creation); write *into* it.
   */
  get morphTargetWeights(): Float32Array | undefined {
    return this.getComponent(MorphWeights)?.weights;
  }

  /**
   * Resolves a §79 skeleton reference against the tree this mesh now lives in.
   *
   * Walks to this node's root and traverses once, collecting the named bones;
   * the traversal is the scene's depth-first order, but the *skeleton's* bone
   * order is the recorded id order, so the joint-index ABI (§33) survives the
   * round trip whatever the document's node order was.
   *
   * A referenced id that is missing leaves the reference pending and the
   * skeleton `null` — the tree may simply not be assembled yet (a §79 factory
   * runs before the instantiator attaches children), and the next read
   * retries; the first read after instantiation is the earliest moment the
   * mesh and its bones are guaranteed to share a tree. An id that resolves to
   * a node that is **not a `Bone`** is a malformed document and is refused
   * loudly (§85), because retrying cannot fix it.
   */
  #resolvePendingSkeleton(pending: PendingSkeleton): void {
    const rootOf = (node: Node): Node =>
      node.parent === null ? node : rootOf(node.parent);
    const root = rootOf(this);
    const wanted = new Set(pending.boneIds);
    const found = new Map<string, Node>();
    root.traverse((node) => {
      if (wanted.has(node.id)) {
        found.set(node.id, node);
      }
    });
    if (found.size !== pending.boneIds.length) {
      return;
    }
    const bones: Bone[] = [];
    for (const id of pending.boneIds) {
      const node = found.get(id) as Node;
      if (!(node instanceof Bone)) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          `Mesh ${this.id} restores a skeleton naming node "${id}", which ` +
            "is not a Bone; a document's joints index bones and only bones " +
            "(§54, §79, §85).",
          { context: { node: this.id, bone: id } },
        );
      }
      bones.push(node);
    }
    pendingSkeletons.delete(this);
    // Through the setter, so the joint limit is enforced on a restored rig
    // exactly as on an authored one.
    this.skeleton = new Skeleton(bones, pending.inverseBindMatrices);
  }
}

/**
 * Hands a `Mesh` its saved §79 skeleton reference — bone ids in joint-index
 * order plus the inverse bind matrices — to be resolved on the first
 * {@link Mesh.skeleton} read (RFC 0003; §79: intra-file references are by id).
 *
 * The seam exists for the reason `restoreNodeId` does: a §79 node factory runs
 * while the tree is still being assembled, so the bones a reference names may
 * not exist yet, and the earliest moment the mesh and its bones are guaranteed
 * to share a tree is the first read after instantiation — which is exactly
 * when the serializer's writer, the render list, or the application asks.
 * `packages/fourjs/src/scene-serializers.ts` is the caller; an application's own
 * factory may call it for the same purpose. Any previously assigned or pending
 * skeleton is replaced.
 *
 * @throws FourError `INVALID_SCENE_GRAPH` (§85) when the record is malformed —
 * no bones, a duplicate id, or a matrix array that is not 16 floats per bone.
 * The matrix *contents* are validated by `Skeleton`'s constructor at
 * resolution, and the bone count by {@link Mesh.skeleton}'s setter.
 */
export function restoreMeshSkeleton(
  mesh: Mesh<Material>,
  boneIds: readonly string[],
  inverseBindMatrices: Float32Array,
): void {
  if (boneIds.length === 0) {
    throw new FourError(
      "INVALID_SCENE_GRAPH",
      `Mesh ${mesh.id} restores a skeleton with no bones (§54, §79, §85).`,
      { context: { node: mesh.id } },
    );
  }
  if (new Set(boneIds).size !== boneIds.length) {
    throw new FourError(
      "INVALID_SCENE_GRAPH",
      `Mesh ${mesh.id} restores a skeleton naming a bone id twice; the ` +
        "joint index is the position in the bone list (§33, §79, §85).",
      { context: { node: mesh.id } },
    );
  }
  if (inverseBindMatrices.length !== boneIds.length * 16) {
    throw new FourError(
      "INVALID_SCENE_GRAPH",
      `Mesh ${mesh.id} restores a skeleton with ` +
        `${String(inverseBindMatrices.length)} bind floats for ` +
        `${String(boneIds.length)} bones; 16 per bone are required (§79, §85).`,
      { context: { node: mesh.id, bones: boneIds.length } },
    );
  }
  mesh.skeleton = null;
  pendingSkeletons.set(mesh, {
    boneIds: [...boneIds],
    inverseBindMatrices,
  });
}
