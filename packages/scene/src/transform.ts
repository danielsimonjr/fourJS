import { Matrix4, Quaternion, Vector3 } from "@fourjs/math";

import {
  warnApplicationTransformWrite,
  type AuthorityNode,
} from "./authority.js";

/**
 * Local/world transform of a scene node (§7).
 *
 * The transform is authored as translation, rotation, scale, and pivot and is
 * composed into {@link Transform.localMatrix} as the §7 product
 * `T · Tp · R · S · Tp⁻¹` — translation, then rotation and scale **about the
 * pivot**. The pivot therefore affects rotation and scale but never
 * {@link Transform.position}: a node sits at `position` whatever its pivot is,
 * and the pivot only decides which point of the node stays fixed while it turns
 * or grows. See `Matrix4.compose`, which evaluates that product directly.
 *
 * ## The dirty channel (plan D3)
 *
 * Dependent systems cache against {@link Transform.version}, so every local
 * mutation has to be visible. There are exactly two ways to mutate a transform,
 * and both keep `version` correct:
 *
 * 1. **Method-based mutation** — the normal path. The constructor installs an
 *    `onChanged` hook on this transform's own `position`, `rotation`, `scale`,
 *    and `pivot`, so any math *method* call on them bumps `version` once:
 *
 *    ```ts
 *    transform.position.set(1, 2, 3); // version += 1
 *    transform.scale.scale(2);        // version += 1
 *    ```
 *
 *    One method call is one bump, including methods that write several
 *    components; `Vector3.copy` and `Quaternion.copy` deliberately do not copy
 *    the source's hook, so copying another vector in keeps this channel intact.
 *
 * 2. **Direct field writes** — legal, but they bypass the hook by design (the
 *    same rule the math types state for `v.x = 1`), so the caller must announce
 *    them:
 *
 *    ```ts
 *    transform.position.x = 5;
 *    transform.markDirty(); // version += 1
 *    ```
 *
 * The four math members are `readonly` for this reason: replacing one wholesale
 * (`transform.position = someVector`) would silently drop the hook and leave
 * `version` frozen while the transform kept moving. Write *into* them instead.
 *
 * {@link Transform.localMatrix} deliberately carries **no** hook — it is the
 * output of composition, and a hook there would mark the transform dirty every
 * time it was recomposed.
 *
 * ## Local matrix
 *
 * With `matrixAutoUpdate = true` (the default) the local matrix is owned by the
 * engine and {@link Transform.updateLocalMatrix} recomposes it from
 * position/rotation/scale/pivot — lazily: it recomposes only when `version` has
 * advanced since the last composition, so calling it repeatedly in a frame costs
 * one comparison.
 *
 * With `matrixAutoUpdate = false` the **user** owns the local matrix (§7):
 * `updateLocalMatrix()` becomes a no-op and position/rotation/scale are *not*
 * back-derived from the matrix — they simply go stale and stop describing the
 * node. Write the matrix through {@link Transform.setLocalMatrix} so `version`
 * still advances; writing `localMatrix.elements` directly needs a following
 * {@link Transform.markDirty} exactly like a direct field write.
 *
 * ## World matrix
 *
 * {@link Transform.worldMatrix} and {@link Transform.worldVersion} are storage
 * for the world-transform resolver, which walks the hierarchy and is the single
 * writer of both (§7: world matrices resolve lazily, once per fixed step before
 * physics synchronization, before render-item generation, and on demand for
 * queries). This class never touches them: a lone `Transform` has no parent and
 * so cannot know its own world matrix. Reading `worldMatrix` without having
 * resolved it yields whatever the last resolution left there.
 */
export class Transform {
  /**
   * Local-space translation. In 2D scenes `z` is normally left at 0 (§7); the
   * world is right-handed with +Y up in both 2D and 3D (§7a).
   */
  readonly position: Vector3;

  /** Local-space rotation as a unit quaternion. Angles are radians (§7a). */
  readonly rotation: Quaternion;

  /** Local-space scale; `(1, 1, 1)` by default. In 2D scenes `z` stays 1 (§7). */
  readonly scale: Vector3;

  /**
   * Point, in the node's own unscaled and unrotated local space, that rotation
   * and scale act about. `(0, 0, 0)` — the node origin — by default.
   */
  readonly pivot: Vector3;

  /**
   * Composed local transform. Engine-owned while
   * {@link Transform.matrixAutoUpdate} is true; user-owned when it is false.
   * The `Matrix4` instance is never replaced, so views onto its `elements` stay
   * valid for the transform's lifetime.
   */
  readonly localMatrix: Matrix4;

  /**
   * Local matrix concatenated with every ancestor's — written by the
   * world-transform resolver, never by this class. See the class documentation.
   */
  readonly worldMatrix: Matrix4;

  /**
   * When true (the default) {@link Transform.updateLocalMatrix} recomposes
   * {@link Transform.localMatrix} from position/rotation/scale/pivot. When
   * false the user owns the local matrix and nothing here recomposes or
   * back-derives it (§7).
   */
  matrixAutoUpdate = true;

  /**
   * Version stamp the resolver writes after resolving
   * {@link Transform.worldMatrix}, so callers can tell a resolved world matrix
   * from a stale one. Meaningless to this class, which never reads it; the
   * resolver defines what it counts.
   */
  worldVersion = 0;

  /** Backing store for {@link Transform.version}; only {@link Transform.markDirty} writes it. */
  #version = 0;

  /**
   * Weak back-pointer to the node that owns this transform, used only for the
   * DEV application-write warning. Weak so `Node` ↔ `Transform` is not a GC
   * cycle. Absent on a free-standing `Transform` (tests, pose scratches).
   */
  #host: WeakRef<AuthorityNode> | null = null;

  /**
   * Called from `Node`'s constructor so {@link Transform.markDirty} can name
   * the owner. Not public API.
   */
  attachAuthorityHost(node: AuthorityNode): void {
    this.#host = new WeakRef(node);
  }

  /**
   * Value of {@link Transform.version} at the last composition of
   * {@link Transform.localMatrix}. Starts at -1 — never a legal version — so
   * the first {@link Transform.updateLocalMatrix} always composes.
   */
  #composedVersion = -1;

  /**
   * Builds the identity transform: position and pivot at the origin, identity
   * rotation, unit scale, identity local and world matrices, `matrixAutoUpdate`
   * on, `version` 0.
   */
  constructor() {
    this.position = new Vector3(0, 0, 0);
    this.rotation = new Quaternion(0, 0, 0, 1);
    this.scale = new Vector3(1, 1, 1);
    this.pivot = new Vector3(0, 0, 0);
    this.localMatrix = new Matrix4();
    this.worldMatrix = new Matrix4();

    // Plan D3: one shared hook across the four authored members — each math
    // mutator fires it exactly once, so one method call is one version bump.
    const markDirty = (): void => {
      this.markDirty();
    };
    this.position.onChanged = markDirty;
    this.rotation.onChanged = markDirty;
    this.scale.onChanged = markDirty;
    this.pivot.onChanged = markDirty;
  }

  /**
   * Counter incremented on every local mutation (§7), so dependent systems —
   * world-transform resolution, physics synchronization, render-item caches —
   * can skip work by comparing against the value they last saw. Only the
   * ordering matters: treat it as opaque and compare for inequality, never
   * subtract two stamps.
   *
   * The counter is monotonic and never wraps. At one bump per mutation it would
   * take on the order of a million years of continuous 60 Hz mutation to reach
   * `Number.MAX_SAFE_INTEGER`, which is where distinct increments would stop
   * being distinct.
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Announces a mutation the change hooks could not see — a direct field write
   * (`transform.position.x = 5`), or a direct write into
   * `transform.localMatrix.elements` under `matrixAutoUpdate = false`. Bumps
   * {@link Transform.version} by one.
   *
   * Calling it after a method-based mutation is harmless but counts as a second
   * mutation: the version advances again and the local matrix is recomposed
   * once more. It is never *wrong* to call this, only wasteful.
   */
  markDirty(): void {
    this.#version += 1;
    // Inlined DEV: `@fourjs/scene` must not import `DEV`. Production bundles
    // fold this false and delete the warning path.
    if (typeof __FOUR_DEV__ !== "undefined" ? __FOUR_DEV__ : true) {
      const host = this.#host?.deref();
      if (host !== undefined) {
        warnApplicationTransformWrite(host);
      }
    }
  }

  /**
   * Brings {@link Transform.localMatrix} up to date with the authored
   * position/rotation/scale/pivot, composing `T · Tp · R · S · Tp⁻¹` (§7) via
   * `Matrix4.compose`. Allocates nothing.
   *
   * Lazy: it recomposes only if {@link Transform.version} advanced since the
   * last composition, so callers may call it as often as they like — the
   * resolver calls it on every node it visits.
   *
   * A no-op while `matrixAutoUpdate` is false: the matrix is then the user's
   * (§7). Turning `matrixAutoUpdate` back on does not restore the user's matrix
   * — the next mutation-and-update recomposes over it from the authored
   * position/rotation/scale/pivot, which were never back-derived.
   */
  updateLocalMatrix(): void {
    if (!this.matrixAutoUpdate) {
      return;
    }
    if (this.#composedVersion === this.#version) {
      return;
    }
    this.localMatrix.compose(
      this.position,
      this.rotation,
      this.scale,
      this.pivot,
    );
    this.#composedVersion = this.#version;
  }

  /**
   * Copies `m` into {@link Transform.localMatrix} and bumps
   * {@link Transform.version} — the supported way to author a matrix directly
   * under `matrixAutoUpdate = false` (§7). Nothing is back-derived: the
   * authored position/rotation/scale/pivot are left exactly as they were and no
   * longer describe the node.
   *
   * Set `matrixAutoUpdate = false` first. With it left on, this write is
   * transient — it marks the transform dirty, so the next
   * {@link Transform.updateLocalMatrix} recomposes over it from the authored
   * values. That is deliberate: with auto-update on, composition is the
   * definition of the local matrix, and silently keeping a hand-written matrix
   * would make the two disagree. No error is raised, because §7 states the
   * requirement and detecting it here would cost a branch on a path the
   * resolver runs per node.
   */
  setLocalMatrix(m: Matrix4): void {
    this.localMatrix.copy(m);
    this.markDirty();
  }
}
