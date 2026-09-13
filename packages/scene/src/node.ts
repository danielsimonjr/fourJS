/**
 * The unified node model (§6), its component delegation (§6a), and its event
 * surface (§6b).
 *
 * `Node` is the one base class of the scene graph: 2D shapes, 3D meshes, text,
 * UI, rigid-body hosts, and particle emitters are all nodes, and everything a
 * node *does* beyond hierarchy and transform arrives either as a subclass or —
 * preferably — as a component (§6a). The base class therefore stays
 * lightweight: hierarchy, transform, identity, visibility, tags, metadata,
 * components, events.
 *
 * ## Inheritance (plan D1)
 *
 * `abstract class Node extends EventEmitter<NodeEventMap>` — single
 * inheritance, no mixins. Components are **composed**, not inherited: every
 * node owns a private `ComponentRegistry` (`@fourjs/core`) and delegates
 * `addComponent` / `getComponent` / `removeComponent` to it, passing *itself*
 * as the registry's host. `@fourjs/core` cannot name `Node` (the dependency runs
 * the other way, plan §3.1), so it describes the host structurally as
 * `ComponentHost`; `Node` implements that interface, which is what makes
 * `component.host` the owning node at runtime. §6a's `Component.node` is that
 * same reference under core's package-neutral name.
 *
 * ## Events (§6b)
 *
 * Nodes emit through the shared `EventEmitter`, so all four §6b rules
 * (unsubscriber return, registration-order dispatch, mutation-takes-effect-next
 * -dispatch, no self re-entrancy) hold here without restatement. This packet
 * defines only the two structural events, `added` and `removed`; see
 * {@link NodeEventMap} for how later packets widen the map.
 */

import {
  ComponentRegistry,
  DEV_WARNING_PREFIX,
  EventEmitter,
  FourError,
  type Component,
  type ComponentHost,
  type ComponentType,
} from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";

import {
  DEFAULT_TRANSFORM_AUTHORITY,
  type TransformAuthority,
} from "./authority.js";
import { DEFAULT_LAYER_MASK, type LayerMask } from "./layers.js";
import { Transform } from "./transform.js";
import { resolveWorldTransform } from "./world-transforms.js";

/**
 * Payload of the `added` and `removed` events.
 *
 * `node` is the node whose parentage changed — always the emitter, since both
 * events fire on the child (see {@link Node.add}). `parent` is the node it was
 * added to, or the node it was removed from.
 */
export interface NodeHierarchyEvent {
  readonly node: Node;
  readonly parent: Node;
}

/**
 * Events every node emits.
 *
 * Deliberately minimal — this packet owns only the structural pair. The map is
 * an `interface` precisely so it is a **widening point**: later packets add
 * their keys here (or, for out-of-package events, by declaration merging), and
 * every `Node` subclass inherits the widened map because plan D1 fixes the base
 * class as `EventEmitter<NodeEventMap>` with no generic parameter of its own.
 * A subclass that needs private event types therefore adds them to this map
 * rather than re-parameterizing the emitter.
 */
export interface NodeEventMap {
  /** Fired on a node after it has been attached to a new parent. */
  added: NodeHierarchyEvent;
  /** Fired on a node after it has been detached from its parent. */
  removed: NodeHierarchyEvent;
}

/**
 * A node class usable with `instanceof` — the argument shape of
 * `Scene.findByType` (§46).
 *
 * `abstract new` so abstract bases (`Node` itself, and later `Camera`) can be
 * passed; `never` parameters so the type accepts any node class without
 * inviting anyone to construct one from it.
 */
export type NodeType<T extends Node> = abstract new (...args: never[]) => T;

/**
 * Source of engine-assigned node ids.
 *
 * Monotonic and process-wide: id assignment is part of the deterministic
 * construction order (§33 forbids `Math.random` and wall-clock derivation
 * outright, and a counter makes two identical construction sequences produce
 * identical ids). Never reset — a reused id would alias two nodes in
 * serialized references (§79).
 */
let nextNodeId = 1;

/** The shape of an engine-assigned id: `node-` and a decimal counter value. */
const ENGINE_NODE_ID = /^node-(\d+)$/;

/**
 * Default `up` reference for {@link Node.lookAt}: world +Y, because §7a makes
 * the world right-handed and +Y up **in both 2D and 3D**. Frozen shape by
 * convention — nothing writes into it, and `lookAt` only reads its components.
 */
const WORLD_UP = /* @__PURE__ */ new Vector3(0, 1, 0);

/**
 * Scratch for {@link Node.lookAt}: the world-space aim, the world rotation it
 * implies, and the parent's world rotation it is expressed relative to. Three
 * objects for the process, allocated at module load, mutated forever after —
 * `lookAt` allocates nothing per call (§7b), and none of them carries a change
 * hook, so writing them marks nothing dirty.
 *
 * Safe as module state because `lookAt` is synchronous, non-re-entrant, and
 * fully writes each scratch before reading it (the same rule the render
 * package's frame scratch follows).
 */
const aimScratch = /* @__PURE__ */ new Vector3();
const worldRotationScratch = /* @__PURE__ */ new Quaternion();
const parentRotationScratch = /* @__PURE__ */ new Quaternion();
const decomposeScratch = /* @__PURE__ */ new Vector3();

/** Once-per-node §83 detached-listener warn — see `#detach`. */
const detachedListenerWarned = new WeakSet<Node>();

/**
 * Builds {@link Node.lookAt}'s refusal (§85, §89) — one function for both
 * degenerate cases so the shared code and the shared error code live in one
 * place rather than twice inside the method.
 *
 * `reason` completes the sentence "Node.lookAt was refused because …". The
 * offending values are not repeated in `context`: the node id locates the
 * call, and the caller already holds the `target` and `up` it passed.
 */
function refuseLookAt(node: Node, reason: string): FourError {
  return new FourError(
    "INVALID_SCENE_GRAPH",
    `Node.lookAt was refused because ${reason} (§85: singular transforms).`,
    { context: { node: node.id } },
  );
}

/**
 * Records that `id` is taken, so the counter never issues it again (§79,
 * 2026-08-06 A-17).
 *
 * §79 requires a deserialized node to keep the id it was saved with, and the
 * ids this module issues are `node-<n>` — so a load can hand back ids the
 * counter has not reached yet, and the *next* node constructed in that process
 * would be given one a loaded node already holds. `Scene.findById` would then
 * return whichever came first in traversal order, silently. Restoring into a
 * fresh process was always safe (the counter starts below every id it ever
 * issued); the in-process reload — an editor, a level restart, a replay seek —
 * is exactly the case a scene format exists to serve, and it was not.
 *
 * So every restored id is inspected: one shaped like an engine id advances the
 * counter past it, and one shaped like anything else (an application's own
 * `"player"`, a GUID) is left alone, because it can never collide with a
 * generated id in the first place. This is collision **avoidance**, not
 * detection — a document may still name the same id twice, which
 * `instantiateScene` refuses separately.
 *
 * ## The saturation guard (2026-08-07)
 *
 * `value` must be **strictly below** `Number.MAX_SAFE_INTEGER`, not merely a
 * safe integer: `node-9007199254740991` would otherwise set the counter to
 * `2 ** 53`, where `+= 1` is a no-op — every node constructed afterwards would
 * be handed the *same* id, which is the exact aliasing this function exists to
 * prevent. A document naming that id keeps it (ids are opaque strings, §79) and
 * the counter is simply left where it is, so generated ids stay distinct from
 * it and from each other.
 */
const MAXIMUM_RESERVED_NODE_ID = 2 ** 52;

function reserveNodeId(id: string): void {
  const match = ENGINE_NODE_ID.exec(id);
  if (match === null) {
    return;
  }
  const value = Number(match[1]);
  // Reservation ceiling (2026-09-11): a document naming `node-<2^52>` would
  // otherwise park the counter one increment from the saturation the guard
  // above describes, so every later auto id collides. Ids at or above the
  // ceiling are kept verbatim (opaque strings, §79) and simply not reserved —
  // a generated id cannot reach 2^52 in any process.
  if (
    Number.isSafeInteger(value) &&
    value >= nextNodeId &&
    value < MAXIMUM_RESERVED_NODE_ID
  ) {
    nextNodeId = value + 1;
  }
}

function assignNodeId(id?: string): string {
  if (id !== undefined) {
    reserveNodeId(id);
    return id;
  }
  const assigned = `node-${String(nextNodeId)}`;
  nextNodeId += 1;
  return assigned;
}

/**
 * §71's hit-test strategy selector — the value set of {@link Node.hitTestMode}.
 *
 * Four of §71's five spelled values: `"bounds"` (the box test alone),
 * `"geometry"` (exact ray/triangle against the candidate's tessellated
 * triangles — A-11's analytic tier), `"pixel"` (a hit must land on a present
 * texel of the candidate's alpha mask — RFC 0005 alternative D), and `"gpu"`
 * (RFC 0005's id-buffer pass answers; the ray tier stands aside). `"custom"`
 * is absent until a custom-callback strategy exists — see the field's own
 * documentation. "No mode chosen" is spelled `null` on the field, not a fifth
 * string, so this union stays exactly §71's.
 */
export type HitTestMode = "bounds" | "geometry" | "pixel" | "gpu";

/**
 * Construction options every node accepts (§6).
 *
 * Subclass option interfaces extend this, so `id` is available wherever a node
 * is constructed; a subclass whose constructor takes no options at all
 * inherits `Node`'s signature and accepts it unchanged.
 */
export interface NodeOptions {
  /**
   * The node's {@link Node.id}, for a node being **restored** rather than
   * created (§79: "the engine assigns ids only to newly created objects").
   *
   * Omit it — which is what every ordinary construction does — and the engine
   * assigns the next counter value. Supply one and it is used verbatim *and*
   * reserved, so no later node can be given the same id (2026-08-06, A-17).
   * Ids are opaque strings: the format does not require them to look like the
   * engine's own.
   */
  readonly id?: string;
}

/**
 * Writes a restored id onto an already-constructed node (§79, 2026-08-06
 * A-17) — the seam for a `nodeFactory` that built the node itself and so could
 * not pass {@link NodeOptions.id} to a constructor.
 *
 * Prefer the constructor option: it is checked, it needs no mutation of a
 * `readonly` field, and it is available to every node class. This function
 * exists because `@fourjs/serialization`'s `nodeFactory` contract lets an
 * application construct its own classes with no id parameter at all, and §79
 * still requires those nodes to reload under their saved ids.
 *
 * It lives **here**, in the module that owns the field, rather than in the
 * package that needs it: `Node.id` is `readonly` in the type system and an
 * ordinary writable own property at runtime (a class field under
 * `useDefineForClassFields`), so writing it is a cast — and a cast at a foreign
 * class's field is exactly what a package boundary should not contain. The id
 * is reserved on the way through, so the counter cannot re-issue it.
 */
export function restoreNodeId(node: Node, id: string): void {
  reserveNodeId(id);
  (node as unknown as { id: string }).id = id;
}

export abstract class Node
  extends EventEmitter<NodeEventMap>
  implements ComponentHost
{
  /**
   * Stable identity (§6). Engine-assigned at construction from a monotonic
   * counter, formatted `node-<n>`; ids are unique within a process and
   * ascending in construction order.
   *
   * `readonly`, as §6 requires. §79 additionally requires that a *deserialized*
   * node keep the id it was saved with ("the engine assigns ids only to newly
   * created objects"): pass {@link NodeOptions.id} to restore one, which also
   * reserves it against the counter (2026-08-06, A-17 — the note that used to
   * stand here deferred this to the serialization packet, which shipped without
   * it).
   */
  readonly id: string;

  /** Human-readable name (§6); not unique and not an identity. Empty by default. */
  name = "";

  /** Local transform (§7). Never replaced — write into it. */
  readonly transform: Transform = new Transform();

  /** Whether this node renders (§6). Default `true`. */
  visible = true;

  /** Whether this node participates in simulation and updates (§6). Default `true`. */
  enabled = true;

  /** Opacity in [0, 1] (§6). Default `1`. Not clamped here. */
  opacity = 1;

  /** Free-form tags, queried by `Scene.findByTag` (§46). Empty by default. */
  tags: Set<string> = new Set<string>();

  /**
   * Which §46 layers this node belongs to, as a bit mask (R-38, 2026-08-08).
   *
   * Defaults to {@link DEFAULT_LAYER_MASK} — the layer named `"default"`, and
   * nothing else — so a scene that never mentions layers is seen by every
   * camera and every viewport, whose own masks default to `ALL_LAYERS`.
   *
   * ```ts
   * node.layers = layerMask("ui");            // one layer
   * node.layers = layerMask("ui", "debug");   // two
   * applyLayers(panel, layerMask("ui"));      // this node *and* its subtree
   * ```
   *
   * **The mask gates this node only**, not its subtree: a child on another
   * layer is unaffected by what its parent is on, which is the opposite of
   * `visible`/`enabled` and is a recorded decision — see `layers.ts` for the
   * reasoning and for the subtree spelling.
   *
   * A plain field, like `visible` and `tags`, rather than a validated accessor:
   * the render list reads it once per node per frame, and §85's checks are made
   * where a mask is *built* ({@link layerMask}) and where one is *accepted* from
   * an author (`assertLayerMask`), not on every read of a hot field.
   *
   * Not to be confused with `Renderable.renderLayer` (§49), which is §66's sort
   * ordinal rather than a membership mask.
   */
  layers: LayerMask = DEFAULT_LAYER_MASK;

  /**
   * Whether this node's own drawn shape **clips its subtree** (§67; R-23,
   * 2026-08-21). Default `false`.
   *
   * ```ts
   * panel.clip = true;          // children are masked to the panel's shape
   * panel.add(content);         // …including everything below them
   * ```
   *
   * The mask is the node's *own geometry*, drawn with colour writes off, so a
   * §50 `Shape` clips to its path, a rectangle clips to a rectangle, and a
   * `Sprite` clips to its quad — §67's "path masks" and "UI overflow clipping"
   * with no second authoring surface and nothing new to build a region out of.
   * `@fourjs/render`'s `clip.ts` states the tier and what it deliberately leaves
   * to a later packet (alpha masks, 3D clipping planes, true scissor
   * rectangles).
   *
   * **The clip gates this node's descendants and not this node**, which is the
   * exact mirror of `layers` above (§46 gates the node and not its subtree).
   * That is what a UI panel needs — it paints its own background and border and
   * then contains its children — and it is why the two fields sit next to each
   * other with opposite scopes rather than sharing a spelling.
   *
   * Nested clips **intersect**: a clipped subtree that contains another clip
   * draws only where both shapes cover. Eight clips can be live in one frame,
   * because a stencil bit plane is spent on each and every stencil buffer WebGL
   * 2 can allocate is eight bits deep; the ninth is dropped with a §67
   * diagnostic, and its subtree spills rather than vanishing (see
   * `ClipPlaneAllocator`).
   *
   * Two conditions make this field inert, both warned about in a development
   * build and both failing toward *drawing* rather than toward an empty screen:
   * a node with no geometry to draw (a plain `Group`) has no shape to mask
   * with, and a renderer whose drawing buffer carries no stencil buffer
   * (`new WebglRenderer({ stencil: true })`, R-7) has nothing to write a mask
   * into.
   *
   * A plain field, like `visible` and `layers` and for the same reason: the
   * render list reads it once per node per frame and there is no value it can
   * hold that §85 would refuse.
   */
  clip = false;

  /**
   * Which §71 hit-test strategy answers for this node, or `null` — the
   * default — for §71's own default rule: *"the engine should select the
   * cheapest valid method"* (A-11; the field ships with the analytic tier per
   * the adopted RFC 0005 Q3, 2026-08-29).
   *
   * ```ts
   * mesh.hitTestMode = "geometry";   // exact ray/triangle, never just the box
   * decal.hitTestMode = "pixel";     // a hit must land on a present texel
   * hull.hitTestMode = "bounds";     // the box alone, whatever data is attached
   * boid.hitTestMode = "gpu";        // the id-buffer pass answers, not the ray
   * ```
   *
   * The node carries only the **choice**; the data each strategy needs rides
   * the `Pickable` candidate (`@fourjs/input` may not import `@fourjs/geometry` or
   * a render type, plan §3.1 — the recorded reason picking takes a structural
   * candidate list). Under `null`, `pick()` runs the bounding-volume test and
   * refines it by whatever the candidate carries — triangles, an alpha mask,
   * or nothing — which is the cheapest method that is *valid* for that
   * candidate, and is byte-for-byte the pre-field behaviour. An explicit mode
   * selects exactly one strategy and **requires** its data (§85: a candidate
   * that asked for precision and silently fell back would pick where the
   * author said not to); `"gpu"` excludes the node from the ray tier
   * altogether, because RFC 0005's id-buffer pass is that strategy's
   * implementation and one pointer event must not resolve the node twice.
   *
   * **The mode gates this node only, not its subtree** — the `layers` scope,
   * not the `clip` scope: every descendant is its own picking candidate with
   * its own mode, exactly as it is its own layer member.
   *
   * §71's `"custom"` value is deliberately absent from the union: no
   * custom-callback strategy exists yet, and a selector value with nothing
   * behind it would be a silent no-op. It joins {@link HitTestMode} with that
   * strategy.
   *
   * A plain field, like `visible`, `layers` and `clip`, and for their reason:
   * `pick()` reads it once per candidate per pick, and the union is the check —
   * there is no assignable value §85 would refuse (a §79 document's value is
   * filtered on read instead, restoring `null` for anything unrecognized).
   */
  hitTestMode: HitTestMode | null = null;

  /** Free-form user data (§6). Its own object per node. */
  metadata: Record<string, unknown> = {};

  #parent: Node | null = null;

  /** Insertion-ordered children; the array instance is never replaced. */
  readonly #children: Node[] = [];

  /**
   * Components attached to this node (§6a). The registry receives `this` as its
   * host, so `component.host` — §6a's `Component.node` — is this node.
   */
  readonly #components: ComponentRegistry = new ComponentRegistry(this);

  /**
   * Constructs a node (§6).
   *
   * The only base-class option is {@link NodeOptions.id}, and it is only for
   * restoring a saved node — everything else about a node is a field you assign
   * afterwards, which is what keeps `class Group extends Node {}` a complete
   * class. Subclasses that take options of their own extend
   * {@link NodeOptions} and pass the whole object up, so `new Sprite({ id })`
   * works for the same reason `new Group({ id })` does.
   */
  constructor(options: NodeOptions = {}) {
    super();
    this.id = assignNodeId(options.id);
  }

  /**
   * This node's parent, or `null` when it is a root (§6).
   *
   * Assignment is supported and is defined in terms of the hierarchy methods:
   * `node.parent = other` is `other.add(node)` (including its cycle check and
   * its detach-from-the-old-parent step) and `node.parent = null` is
   * `oldParent.remove(node)`. It is never a bare field write, because a bare
   * write could not keep the two children arrays consistent.
   */
  get parent(): Node | null {
    return this.#parent;
  }

  set parent(value: Node | null) {
    if (value === this.#parent) {
      return;
    }
    if (value === null) {
      this.#parent?.remove(this);
      return;
    }
    value.add(this);
  }

  /**
   * Children in insertion order (§6).
   *
   * The live array is returned as a `readonly` view rather than a copy, so
   * reading children allocates nothing on hot paths. It is a view, not a
   * snapshot: it reflects later mutations, and casting the `readonly` away to
   * mutate it corrupts the parent pointers this class maintains.
   */
  get children(): readonly Node[] {
    return this.#children;
  }

  // --- Transform aliases (§15/§97 idiom) ------------------------------------

  /**
   * Alias for `this.transform.position` — the same live {@link Vector3}, never
   * a copy, so `node.position.set(1, 2, 3)` and
   * `node.transform.position.set(1, 2, 3)` are one and the same write and both
   * run the transform's change hook (plan D3: the version bumps, dependent
   * caches invalidate).
   *
   * The spec writes this spelling throughout — `Four.animate(node.position)`
   * (§15), `camera.position.set(0, 2, 6)` and `label.position.set(0, 1.2, 0)`
   * (§97) — while `Transform` is where the value actually lives (§7). This
   * getter makes both spellings work, resolving the WP-3.1 ergonomics flag
   * (TODO: `Node.position/rotation/scale` aliases onto `transform.*`).
   *
   * Getter only, deliberately: `Transform.position` is a `readonly` property
   * holding a mutable vector — replacing the instance would silently drop the
   * change hook — and the alias mirrors exactly that contract. Assignment
   * (`node.position = v`) is not the API; write *into* the vector with
   * `.set(...)` / `.copy(...)`.
   *
   * Transform authority (§42) is unmoved by the spelling: a write through this
   * alias is a write to the node's transform, and a system that is not the
   * node's {@link Node.transformAuthority} must not make it either way.
   */
  get position(): Vector3 {
    return this.transform.position;
  }

  /**
   * Alias for `this.transform.rotation` — the same live {@link Quaternion},
   * never a copy. Radians semantics per §7a; getter only, for the reasons
   * documented on {@link Node.position} (mutate via quaternion methods, never
   * by assignment). Writes through it bump the transform version exactly as
   * `transform.rotation` writes do, and §42 authority applies unchanged.
   */
  get rotation(): Quaternion {
    return this.transform.rotation;
  }

  /**
   * Alias for `this.transform.scale` — the same live {@link Vector3}, never a
   * copy. Getter only, for the reasons documented on {@link Node.position}
   * (mutate via `.set(...)` / `.copy(...)`, never by assignment). Writes
   * through it bump the transform version exactly as `transform.scale` writes
   * do, and §42 authority applies unchanged.
   */
  get scale(): Vector3 {
    return this.transform.scale;
  }

  // --- Orientation helpers (§44, §47) ---------------------------------------

  /**
   * Writes the world-space unit vector this node faces — its **−Z axis** — into
   * `out` and returns it (§7b's `out`-parameter convention; nothing allocates).
   *
   * −Z is the engine's one forward direction, for every node rather than for
   * cameras alone: a camera looks down it (`Camera.viewMatrix`,
   * `Matrix4.setPerspective`), a directional or spot light shines along it
   * (§68), and {@link Node.lookAt} aims it. The inverse of `lookAt`, and the
   * cheapest way to ask where something ended up pointing.
   *
   * World transforms are resolved on demand (`resolveWorldTransform(this)`),
   * exactly as `Camera.updateViewMatrix` resolves — O(depth), version-cached,
   * so the render path's prior resolve pass makes this a few comparisons. The
   * basis column is normalized, so ancestor scale does not stretch the
   * direction.
   *
   * A degenerate node — zero scale somewhere up the chain — yields the zero
   * vector rather than `NaN` (`Vector3.normalize`'s documented zero-length
   * behaviour): like a degenerate camera (§47), it poisons nothing downstream
   * and raises no error on a per-frame path.
   */
  getWorldDirection(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    // Column-major Matrix4 (§7b): column 2 — elements 8, 9, 10 — is this
    // node's local +Z axis in world space; the node faces along −Z.
    out.set(-elements[8], -elements[9], -elements[10]);
    return out.normalize();
  }

  /**
   * Turns this node so that its **−Z axis points at `target`**, with its +Y
   * axis as close to `up` as the aim allows (§44/§47's orientation helper —
   * "aiming a camera or a light" without hand-composing quaternions). Returns
   * `this`.
   *
   * ```ts
   * camera.position.set(0, 2, 6);
   * camera.lookAt(new Vector3(0, 0.5, 0));   // §7a's world +Y is the default up
   * sun.lookAt(target, new Vector3(0, 0, 1)); // a light is aimed the same way
   * ```
   *
   * ## `target` is in **world space**
   *
   * Always, whatever this node is parented to (decision, R-36). A world-space
   * target is the contract that makes the call mean the same thing when a node
   * is later reparented onto a moving rig — the case §44's follow rigs and
   * spring arms exist for — and it is the only one under which "point the
   * camera at the player" is a single call. The local rotation is derived from
   * it: this node's world position comes from its resolved world matrix, the
   * world rotation is built from the aim, and the parent's world rotation is
   * divided out
   *
   * ```text
   * localRotation = conjugate(parentWorldRotation) · worldRotation
   * ```
   *
   * so a node under a rotated, translated, or uniformly scaled parent aims
   * correctly. A parent with **non-uniform** scale has no exact rotation to
   * divide out; `Matrix4.decompose`'s closest-rotation reading is used, with
   * the shear it cannot represent left in — the same documented limitation
   * every decomposition in the engine carries. A parent with a **zero** scale
   * component decomposes to the identity, so the aim lands in world terms.
   *
   * The node's own scale and pivot are irrelevant to the result: only the
   * rotation is written, through `transform.rotation.copy(...)`, so the version
   * bumps exactly once (plan D3) and dependent caches invalidate exactly as
   * they do for any other transform write.
   *
   * ## Transform authority (§42)
   *
   * This is an ordinary **manual** transform write, identical in every respect
   * to `node.rotation.setFromAxisAngle(...)`, and like every direct write it
   * neither checks nor warns about {@link Node.transformAuthority} (decision,
   * R-36). §42's enforcement is deliberately *writer-side* — a system tests
   * ownership once per node per step, immediately before it would write (see
   * `warnAuthorityConflict`) — and `Node.lookAt` is not a system: it is the
   * application, i.e. the `"manual"` authority itself. Warning here would make
   * this the only transform write in the engine that self-polices, and it would
   * fire on the most ordinary setup there is — aiming a `"physics"`-owned body
   * or a `"kinematic"`-driven turret at its starting pose before the owning
   * system has stepped. A rig that wants to aim a node *every frame* under a
   * non-manual authority has the same obligation as any other writer: claim the
   * authority, or let the owner do the writing.
   *
   * ## Degenerate aims are refused (§85)
   *
   * `FourError("INVALID_SCENE_GRAPH")` is thrown, and nothing is written, when
   *
   * - `target` coincides with this node's world position (or either is
   *   non-finite): there is no direction to face; and
   * - `up` is zero, parallel to the aim, or non-finite: the aim leaves the roll
   *   about it completely undetermined — the top-down `lookAt` from directly
   *   above with the default +Y `up` is exactly this case, and wants an
   *   explicit `up` such as world −Z.
   *
   * Refusing rather than substituting is §85's "detect singular transforms"
   * applied at the point of authoring, reported under the same code
   * {@link Node.add} uses for §85's scene-graph rule so one `catch` covers both.
   * Silently picking a fallback `up` — the usual engine behaviour — would
   * rewrite the orientation the caller asked for and hide the mistake behind a
   * plausible-looking roll; leaving the node unturned would be indistinguishable
   * from a frozen rig. A rig that can reach a degenerate configuration (an orbit
   * at zero radius, a follow target that catches its camera) must guard the
   * call, exactly as it must guard a division by its own radius.
   *
   * Allocates nothing: the aim, the world rotation, and the parent's rotation
   * live in module scratch.
   */
  lookAt(target: Vector3, up: Vector3 = WORLD_UP): this {
    const world = resolveWorldTransform(this).elements;
    const aimX = target.x - world[12];
    const aimY = target.y - world[13];
    const aimZ = target.z - world[14];
    if (!(aimX * aimX + aimY * aimY + aimZ * aimZ > 0)) {
      throw refuseLookAt(
        this,
        "the target coincides with the node's own world position, or is " +
          "not finite",
      );
    }

    // up × aim vanishes exactly when `up` is zero or parallel to the aim —
    // the same test `Quaternion.setFromLookDirection` makes on the negated
    // aim, so a node never reaches that method's silent branch.
    const crossX = up.y * aimZ - up.z * aimY;
    const crossY = up.z * aimX - up.x * aimZ;
    const crossZ = up.x * aimY - up.y * aimX;
    if (!(crossX * crossX + crossY * crossY + crossZ * crossZ > 0)) {
      throw refuseLookAt(
        this,
        "`up` is zero, not finite, or parallel to the aim, so the roll is " +
          "undetermined; aiming straight up or down needs an explicit `up`",
      );
    }

    aimScratch.set(aimX, aimY, aimZ);
    worldRotationScratch.setFromLookDirection(aimScratch, up);

    const parent = this.#parent;
    if (parent === null) {
      this.transform.rotation.copy(worldRotationScratch);
      return this;
    }

    // The chain above this node is already resolved (`resolveWorldTransform`
    // walks it), so the parent's world matrix is current. One Vector3 serves
    // as both decompose outs: neither is read back, and `decompose` reads its
    // scale from locals rather than from the vector it wrote.
    parent.transform.worldMatrix.decompose(
      decomposeScratch,
      parentRotationScratch,
      decomposeScratch,
    );
    this.transform.rotation.copy(
      parentRotationScratch.conjugate().multiply(worldRotationScratch),
    );
    return this;
  }

  // --- Transform authority (§42) --------------------------------------------

  /**
   * Which system owns this node's transform (§42). Default `"manual"`.
   *
   * §42 spells this as a plain assignable field —
   * `node.transformAuthority = "physics"` — and that is exactly what it is:
   * read it, write it, one value at a time. **Every** value of
   * {@link TransformAuthority} assigns, `"blended"` included: it was guarded
   * by a `FourError("NOT_IMPLEMENTED")` between WP-2.3 and WP-7.3, because
   * nothing implemented §19's physics-animation pipeline and a node claiming
   * it would have been owned by a system that did not exist. `PhysicsWorld`
   * now runs that pipeline (`@fourjs/physics`, plan P7-4), so the guard is gone
   * and the value means what §42 says it means.
   *
   * A `"blended"` node is driven by §19's pipeline, which needs two more things
   * this field cannot check for — a `RigidBody` registered with a
   * `PhysicsWorld` and a `PoseTarget` on the node. The first step that
   * tries to blend a node with no target throws `FourError` naming it; see
   * `PhysicsWorld.step`. Assigning the authority is never itself an error,
   * exactly as `"kinematic"` on a node no controller drives is not.
   *
   * Enforcement lives in the writing systems (see `warnAuthorityConflict`), not
   * here: `Node` records ownership, systems honour it.
   */
  transformAuthority: TransformAuthority = DEFAULT_TRANSFORM_AUTHORITY;

  /**
   * Attaches `nodes` as children, in argument order, appending each to the end
   * of {@link Node.children}. Returns `this`.
   *
   * Rules:
   * - **Cycles (§85).** Adding a node to itself, or to any of its own
   *   descendants, throws `FourError("INVALID_SCENE_GRAPH")`. Nothing is
   *   attached for that argument.
   * - **Reparenting.** A node that already has a parent is detached from it
   *   first, which fires `removed` on the node before `added` fires.
   * - **Re-adding.** Adding a node that is already a child of this node is a
   *   no-op: it keeps its current index and fires no event. (Decision — the
   *   alternative, move-to-end, would make `add` silently reorder siblings and
   *   emit a spurious `removed`/`added` pair; callers that want a new index can
   *   `remove` then `add`.)
   * - **Partial application.** Arguments are validated and attached one at a
   *   time, so a throw on the third argument leaves the first two attached.
   *   The graph is always left consistent; it is not rolled back.
   */
  add(...nodes: Node[]): this {
    for (const node of nodes) {
      if (node === this) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          "A node cannot be added to itself (§85: scene graph cycles).",
          { context: { node: node.id } },
        );
      }
      if (node.#isAncestorOf(this)) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          "A node cannot be added to one of its own descendants " +
            "(§85: scene graph cycles).",
          { context: { node: node.id, parent: this.id } },
        );
      }
      if (node.#parent === this) {
        continue;
      }
      const previousParent = node.#parent;
      if (previousParent !== null) {
        previousParent.#detach(node);
      }
      this.#children.push(node);
      node.#parent = this;
      node.emit("added", { node, parent: this });
    }
    return this;
  }

  /**
   * Detaches `nodes` from this node, in argument order. Returns `this`.
   *
   * Removing a node that is not a child of this node is a no-op — no throw, no
   * event (decision: removal is idempotent, so teardown paths can call it
   * without first testing parentage).
   */
  remove(...nodes: Node[]): this {
    for (const node of nodes) {
      if (node.#parent === this) {
        this.#detach(node);
      }
    }
    return this;
  }

  /**
   * Calls `visitor` on this node, then on every descendant, depth-first in
   * insertion order (§6).
   *
   * Children are read live by index rather than from a snapshot, so the walk
   * allocates nothing; the price is that structurally mutating the hierarchy
   * from inside `visitor` is not supported (removing the current node's
   * successor skips it). Collect first, mutate after.
   *
   * Recursive, so depth is bounded by the JS stack — scene graphs thousands of
   * levels deep are out of scope.
   */
  traverse(visitor: (node: Node) => void): void {
    visitor(this);
    for (let i = 0; i < this.#children.length; i += 1) {
      this.#children[i].traverse(visitor);
    }
  }

  // --- Components (§6a, ComponentHost) -------------------------------------

  /**
   * The components attached to this node, in attach order (§6a, 2026-08-06
   * A-15).
   *
   * A live iterator over the registry's own map, so reading it allocates
   * nothing and reflects the node's current state; do not attach or detach
   * while iterating (the underlying `Map` would be mutated mid-walk). Copy it
   * first — `[...node.components]` — for a snapshot.
   *
   * Enumeration exists for §79. Without it a serializer cannot walk what a node
   * *has*; it can only probe for what it knows about, and a component whose
   * type has no registered serializer is then dropped from the document with
   * nobody able to notice — a save that silently loses state, which is the one
   * failure mode that design could not warn about. `@fourjs/serialization` walks
   * this getter and refuses an unserializable component by name.
   *
   * `ComponentHost` (§6a, `@fourjs/core`) does not declare it: the host contract
   * is what a *component* sees of its owner, and a component enumerating its
   * siblings is not something §6a sanctions.
   */
  get components(): IterableIterator<Component> {
    return this.#components.components;
  }

  /**
   * Attaches `component` to this node (§6a), replacing any component of the
   * same type (with a development warning) and running `onAttach` with this
   * node as the host. Returns the component.
   */
  addComponent<T extends Component>(component: T): T {
    return this.#components.add(component);
  }

  /** The attached component of `type`, or `undefined` (§6a). */
  getComponent<T extends Component>(type: ComponentType<T>): T | undefined {
    return this.#components.get(type);
  }

  /**
   * Detaches `component`, running its `onDetach`; returns `false` when it is
   * not the component currently attached for its type. Detaching does not
   * dispose (§6a).
   */
  removeComponent(component: Component): boolean {
    return this.#components.remove(component);
  }

  // --- internals ------------------------------------------------------------

  /**
   * True when this node is `candidate` or one of its ancestors — the cycle
   * test of {@link Node.add}, walking up from `candidate` so the cost is the
   * candidate's depth rather than the subtree size.
   */
  #isAncestorOf(candidate: Node): boolean {
    for (let n: Node | null = candidate; n !== null; n = n.#parent) {
      if (n === this) {
        return true;
      }
    }
    return false;
  }

  /**
   * Removes `child` (assumed to be a child of this node) and fires `removed`
   * **on the child**, after the mutation is complete: a listener always
   * observes the final `parent`/`children` state, never an intermediate one.
   *
   * Neither `added` nor `removed` is re-emitted on ancestors (decision, §6b:
   * "all other events fire on their emitter only" — only input events
   * propagate through the graph, §72). A listener that needs to watch a whole
   * subtree subscribes per node.
   */
  #detach(child: Node): void {
    const index = this.#children.indexOf(child);
    if (index === -1) {
      return;
    }
    this.#children.splice(index, 1);
    child.#parent = null;
    const listeners = child.listenerCountAll();
    if (listeners > 0 && !detachedListenerWarned.has(child)) {
      detachedListenerWarned.add(child);
      // Unconditional: `@fourjs/scene` is a §33 simulation package and must not
      // import DEV / `devWarnOnce` (`dev-build-mode.test.ts`). The WeakSet is
      // the once-per-node suppress; production prints the first detach.
      console.warn(
        `${DEV_WARNING_PREFIX} §83: node "${child.id}" was detached with ${String(listeners)} event ` +
          "listener(s) still registered; call the unsubscribers from on() or " +
          "removeAllListeners() so the subtree is not retained (§6b).",
      );
    }
    child.emit("removed", { node: child, parent: this });
  }
}
