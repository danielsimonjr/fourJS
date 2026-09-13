/**
 * The `Collider` component (§6a, §24) and its §25 effective-material
 * resolution.
 *
 * §24 declares the collider's fields — shape, offset, friction, restitution,
 * density, sensor flag, groups, mask — and §6a makes it a *component* attached
 * with `node.addComponent(new Collider(...))`. This module is that class. Like
 * `RigidBody` it holds authored state only: no solver handle, no contact
 * bookkeeping, no per-frame work (§6a).
 *
 * ## Which body a collider belongs to (decision, WP-5.2)
 *
 * §37's `ColliderDescriptor.body` is required — a collider is always part of a
 * body — but the *component* is constructed without one
 * ({@link ColliderOptions} is the descriptor minus that field) and resolves it
 * from the scene graph:
 *
 * 1. the `RigidBody` on the same node, if there is one;
 * 2. otherwise the nearest ancestor node's `RigidBody`.
 *
 * Resolution is **lazy** — {@link Collider.body} looks it up on every read, and
 * `onAttach` does not throw. Attach order is therefore free: `addComponent(new
 * Collider(...))` before or after `addComponent(new RigidBody(...))` both work,
 * and so does attaching the collider's node under a body node afterwards. §6a
 * fixes no ordering between components, so a hard failure at attach time would
 * turn a legal §6a sequence into an error the user cannot see in the API. The
 * failure instead surfaces at world registration through
 * {@link Collider.requireBody}, which throws a `FourError` naming the node —
 * the point at which the missing body genuinely blocks progress (WP-5.3).
 *
 * ## Several colliders on one body (§6a versus §24)
 *
 * §6a allows at most one component of a given type per node, and a body
 * routinely needs more than one collider. The resolution, in the order a user
 * should reach for it:
 *
 * 1. **child nodes.** The body node carries one collider; each additional
 *    collider lives on a child node, which finds the body by the ancestor walk
 *    above and whose transform is the collider's offset. This is the general
 *    answer and it needs no new concept: the scene graph already expresses
 *    "several shapes rigidly attached to one body".
 * 2. **§24's `compound`.** It is the same answer as (1), not a second one:
 *    "several shapes on one body" *is* several colliders on one body, and
 *    since PH-5 `PhysicsWorld.addCollider` / `removeCollider` can assemble and
 *    take one apart while the world runs. There is deliberately no
 *    `{ type: "compound" }` shape tag (PH-22a, 2026-08-08).
 *
 * What is *not* the answer is relaxing §6a for this one component: a second
 * `Collider` on the same node replaces the first with a development warning,
 * exactly like every other component, so the failure is loud rather than a
 * silently ignored shape.
 *
 * ## Materials (§25)
 *
 * A collider may set `friction`, `restitution`, and `density` directly, point
 * at a shared {@link PhysicsMaterial}, or neither. The explicit field wins, the
 * material is the fallback, and a package default is the last resort — the rule
 * `ColliderDescriptor.material` states, implemented once in
 * {@link Collider.effectiveFriction}, {@link Collider.effectiveRestitution},
 * and {@link Collider.effectiveDensity} (the last through `resolveDensity`, so
 * §25's density sentence has exactly one implementation).
 *
 * ## Events (§29)
 *
 * `Collider` is an `EventEmitter` (§6b), so §29's `sensor.on("triggerenter",
 * …)` is literal. Collision events fire on the *body* (§29's `body.on(…)`);
 * trigger events fire on the sensor collider, which is the one the user
 * configured as a trigger volume. Emission is package-internal: `PhysicsSystem`
 * dispatches after the fixed step (§39 step 9), never during it.
 *
 * ## Dimension (§21, plan P5-3)
 *
 * A collider does not know which world it will join, so construction validates
 * the shape on its own (`validateCollisionShape` with no dimension) and the
 * remaining fields against the dimension the *shape* implies. The world's real
 * dimension is checked by {@link Collider.validateFor} at registration, which
 * is where a `"circle"` in a `"3d"` world is rejected.
 */

import {
  EventEmitter,
  FourError,
  type Component,
  type ComponentHost,
} from "@fourjs/core";
import { Node, Transform } from "@fourjs/scene";

import type { ColliderDescriptor } from "./descriptors.js";
import type { CollisionEvent, TriggerEvent } from "./events.js";
import type { PhysicsMaterial } from "./material.js";
import {
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  resolveDensity,
} from "./material.js";
import { ALL_COLLISION_GROUPS } from "./queries.js";
import { RigidBody } from "./rigid-body.js";
import type { CollisionShape } from "./shapes.js";
import { shapeSupportsDimension, validateCollisionShape } from "./shapes.js";
import type { PhysicsBodyHandle, PhysicsDimension } from "./types.js";
import { validateColliderDescriptor } from "./validation.js";

/**
 * How a {@link Collider} is constructed: §37's collider descriptor minus the
 * body handle, which the component resolves from the scene graph instead (see
 * the module header).
 */
export type ColliderOptions = Omit<ColliderDescriptor, "body">;

/**
 * Stand-in body handle used while validating a collider that has not been
 * registered with a world yet.
 *
 * `validateColliderDescriptor` never reads `body` — it checks the shape, the
 * material coefficients, the bit sets, and the offset — so validation does not
 * need a real handle, and inventing one would mean minting a solver reference
 * that no solver issued. The sentinel never leaves this module.
 */
const UNRESOLVED_BODY = {} as PhysicsBodyHandle;

/**
 * The dimension a shape implies on its own: `"3d"` unless the shape is
 * 2D-only.
 *
 * Used for construction-time validation, where the world's dimension is not
 * known yet. A capsule is legal in both dimensions and resolves to `"3d"`, the
 * permissive choice — the §21 plane constraints it would face in a `"2d"` world
 * are re-checked by {@link Collider.validateFor} at registration.
 */
function impliedDimension(shape: CollisionShape): PhysicsDimension {
  return shapeSupportsDimension(shape, "3d") ? "3d" : "2d";
}

/** §29's trigger payload as it reaches a sensor's listeners. */
export type ColliderTriggerEvent = TriggerEvent<RigidBody, Collider>;

/**
 * §29's collision payload as it reaches a node's listeners.
 *
 * Declared here rather than in `rigid-body.ts` — where the emitting class
 * lives — because the alias names {@link Collider}, and a type import of it
 * from `rigid-body.ts` would close an import cycle (this module already
 * imports {@link RigidBody} at runtime to resolve {@link Collider.body}).
 * The augmentation below merges the three collision names into
 * `RigidBodyEventMap`, so the body's emitter surface is unchanged.
 */
export type RigidBodyCollisionEvent = CollisionEvent<RigidBody, Collider>;

declare module "./rigid-body.js" {
  // The three §29 collision names of `RigidBodyEventMap`, merged in from
  // collider.ts (see `RigidBodyCollisionEvent` above for why they are declared
  // here). Deliberately NOT a doc comment: TypeDoc warns when two declarations
  // of one merged interface both carry one, and `rigid-body.ts`'s declaration
  // is the documented one.
  interface RigidBodyEventMap {
    /** Two colliders began touching (§29). */
    collisionstart: RigidBodyCollisionEvent;
    /** Two colliders are still touching (§29). */
    collisionstay: RigidBodyCollisionEvent;
    /** Two colliders stopped touching (§29); `contacts` is empty. */
    collisionend: RigidBodyCollisionEvent;
  }
}

/**
 * What a {@link Collider} emits (§29) — the two sensor names. Collision events
 * belong to the body (`RigidBodyEventMap`).
 */
export interface ColliderEventMap {
  /** A collider entered this sensor (§29). */
  triggerenter: ColliderTriggerEvent;
  /** A collider left this sensor (§29). */
  triggerexit: ColliderTriggerEvent;
}

/**
 * A collision shape attached to a node, belonging to that node's (or an
 * ancestor's) {@link RigidBody} (§24).
 *
 * ```ts
 * const node = new Group();
 * node.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
 * const collider = node.addComponent(
 *   new Collider({ shape: { type: "sphere", radius: 0.5 }, restitution: 0.6 }),
 * );
 *
 * collider.body;                 // the RigidBody above
 * collider.effectiveFriction;    // §25 resolution
 *
 * const zone = new Group();
 * zone.addComponent(new RigidBody({ type: "static" }));
 * const sensor = zone.addComponent(
 *   new Collider({ shape: { type: "box", halfExtents: extents }, sensor: true }),
 * );
 * sensor.on("triggerenter", (event) => console.log(event.other));
 * ```
 *
 * One per node (§6a); see the module header for how a body carries several.
 */
export class Collider
  extends EventEmitter<ColliderEventMap>
  implements Component
{
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "collider";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * The collider's geometry (§24). Held by reference — shapes are plain,
   * shareable data — and re-validated by {@link Collider.validateFor} when the
   * collider is registered, so replacing it before registration is free.
   */
  shape: CollisionShape;

  /**
   * Pose of the shape in the body's local frame (§24). Owned by the component
   * and never replaced; only `position` and `rotation` are read, because a
   * collider has no scale and no pivot (§37 `ColliderDescriptor.offset`).
   */
  readonly offset: Transform = new Transform();

  /**
   * Shared surface properties (§25), or `undefined`. A fallback only: the
   * explicit fields below win where both are set.
   */
  material?: PhysicsMaterial;

  /** Coulomb friction coefficient (§24), or `undefined` to fall back to §25. */
  friction?: number;

  /** Restitution (§24), or `undefined` to fall back to §25. */
  restitution?: number;

  /** Mass per unit volume in kg/m³ (§24), or `undefined` to fall back to §25. */
  density?: number;

  /**
   * Whether this collider reports overlaps without exerting forces (§24). A
   * sensor emits `"triggerenter"` / `"triggerexit"` instead of collision events
   * (§29).
   */
  sensor: boolean;

  /** Bit set of the groups this collider belongs to (§24). */
  collisionGroups: number;

  /** Bit set of the groups this collider collides with (§24). */
  collisionMask: number;

  /**
   * Builds a collider from `options`, validated against §24, §25, and §85.
   *
   * The shape is checked on its own terms (parameters, convexity) and the
   * remaining fields against the dimension the shape implies; the world's
   * dimension is checked later by {@link Collider.validateFor}. The offset
   * transform is **copied** (position and rotation only), so the caller keeps
   * ownership of whatever it passes in.
   */
  constructor(options: ColliderOptions) {
    super();
    validateCollisionShape(options.shape);

    this.shape = options.shape;
    if (options.offset !== undefined) {
      this.offset.position.copy(options.offset.position);
      this.offset.rotation.copy(options.offset.rotation);
    }
    if (options.material !== undefined) {
      this.material = options.material;
    }
    if (options.friction !== undefined) {
      this.friction = options.friction;
    }
    if (options.restitution !== undefined) {
      this.restitution = options.restitution;
    }
    if (options.density !== undefined) {
      this.density = options.density;
    }
    this.sensor = options.sensor ?? false;
    this.collisionGroups = options.collisionGroups ?? ALL_COLLISION_GROUPS;
    this.collisionMask = options.collisionMask ?? ALL_COLLISION_GROUPS;

    validateColliderDescriptor(
      this.toDescriptor(UNRESOLVED_BODY),
      impliedDimension(this.shape),
    );
  }

  // --- body resolution ------------------------------------------------------

  /**
   * The body this collider belongs to, or `undefined` while it has none.
   *
   * Resolved on every read: the `RigidBody` on this collider's own node, else
   * the nearest ancestor's. See the module header for why resolution is lazy
   * and why the ancestor walk is what lets one body carry several colliders.
   *
   * The walk needs a scene graph, so it runs only when the host is a
   * `@fourjs/scene` `Node`; a bare `ComponentRegistry` host resolves against
   * itself alone.
   */
  get body(): RigidBody | undefined {
    const host = this.host;
    if (host === null) {
      return undefined;
    }
    const own = host.getComponent(RigidBody);
    if (own !== undefined) {
      return own;
    }
    if (!(host instanceof Node)) {
      return undefined;
    }
    for (
      let ancestor = host.parent;
      ancestor !== null;
      ancestor = ancestor.parent
    ) {
      const body = ancestor.getComponent(RigidBody);
      if (body !== undefined) {
        return body;
      }
    }
    return undefined;
  }

  /**
   * {@link Collider.body}, or a `FourError` explaining that the collider has no
   * body (§23: every collider belongs to one).
   *
   * `INVALID_SCENE_GRAPH` because the fault is an arrangement of nodes and
   * components, not a bad value. Called by `PhysicsWorld` at registration
   * (WP-5.3).
   */
  requireBody(): RigidBody {
    const body = this.body;
    if (body === undefined) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        "A Collider needs a RigidBody: attach one to the same node with " +
          "node.addComponent(new RigidBody({ type: … })), or place this node " +
          "under a node that has one (§23, §24). Static level geometry is a " +
          '"static" body carrying colliders, never a body-less collider.',
        { context: { attached: this.host !== null, shape: this.shape.type } },
      );
    }
    return body;
  }

  // --- §25 material resolution ----------------------------------------------

  /**
   * The friction a contact with this collider uses (§24, §25): the explicit
   * {@link Collider.friction}, else the material's, else
   * {@link DEFAULT_FRICTION}.
   *
   * Combine it with the other collider's value through `combineFriction` /
   * `combineValues` to get the coefficient of a contact (§25, Appendix A).
   */
  get effectiveFriction(): number {
    return this.friction ?? this.material?.friction ?? DEFAULT_FRICTION;
  }

  /**
   * The restitution a contact with this collider uses (§24, §25): the explicit
   * {@link Collider.restitution}, else the material's, else
   * {@link DEFAULT_RESTITUTION}.
   */
  get effectiveRestitution(): number {
    return (
      this.restitution ?? this.material?.restitution ?? DEFAULT_RESTITUTION
    );
  }

  /**
   * The density used to derive mass from this collider (§23, §25) — §25's rule
   * exactly, through `resolveDensity`: the collider's own density is
   * authoritative, the material's is the fallback, and `DEFAULT_DENSITY` is the
   * last resort.
   */
  get effectiveDensity(): number {
    return resolveDensity(this.density, this.material);
  }

  // --- world registration ---------------------------------------------------

  /**
   * Re-validates this collider against a world of `dimension` (§21, §24, §85).
   *
   * The check a component cannot make on its own: whether its shape belongs to
   * the world it is joining (a `"circle"` is not a `"3d"` shape) and whether
   * its offset lies in the plane a `"2d"` world simulates. Called at
   * registration (WP-5.3); not a per-step path.
   */
  validateFor(dimension: PhysicsDimension): void {
    this.#requireLive();
    validateColliderDescriptor(this.toDescriptor(UNRESOLVED_BODY), dimension);
  }

  /**
   * The descriptor an adapter would be handed for this collider (§37
   * `createCollider`), attached to `body`.
   *
   * `friction`, `restitution`, and `density` are the **effective** values: §25's
   * fallback chain is resolved here, once, so an adapter receives numbers and
   * never has to re-implement the material rule. The material itself is still
   * passed through for adapters that model §25's optional rolling and spinning
   * friction. The shape and the offset are references to this component's live
   * state; the adapter reads them during `createCollider` and must not retain
   * them.
   */
  toDescriptor(body: PhysicsBodyHandle): ColliderDescriptor {
    this.#requireLive();
    const descriptor: ColliderDescriptor = {
      shape: this.shape,
      body,
      offset: this.offset,
      friction: this.effectiveFriction,
      restitution: this.effectiveRestitution,
      density: this.effectiveDensity,
      sensor: this.sensor,
      collisionGroups: this.collisionGroups,
      collisionMask: this.collisionMask,
    };
    if (this.material !== undefined) {
      descriptor.material = this.material;
    }
    return descriptor;
  }

  /** Set by {@link Collider.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link Collider.dispose} has run. Disposal is terminal (§83): a
   * disposed component refuses world registration with
   * `INVALID_APPLICATION_STATE` (§89) rather than silently working.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** §83's "disposed resource still in use", made loud (§89). */
  #requireLive(): void {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Collider is disposed; registering a disposed collider is a " +
          "lifetime mistake (§83), and a new collider is a new Collider.",
        { context: { component: "Collider" } },
      );
    }
  }

  // --- §6a lifecycle --------------------------------------------------------

  /**
   * Drops every listener (§6a, §83). Detaching does not dispose (§6a), so this
   * runs only from an explicit `dispose()` or `ComponentRegistry.disposeAll`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.removeAllListeners();
  }
}
