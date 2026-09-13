/**
 * Dragging (§72, §120): press a node, move the pointer, get world-space deltas.
 *
 * ```ts
 * const drags = new DragManager({
 *   pointerInput,
 *   onDrag: (node, worldDelta) => {
 *     node.transform.position.add(worldDelta);   // the application writes, not input
 *   },
 * });
 * drags.makeDraggable(box);
 * ```
 *
 * ## Why the callback writes and this class does not (§42)
 *
 * §42 gives exactly one system authority over a node's transform, and conflicts
 * must warn rather than silently overwrite. Input is not on that list — there is
 * no `"input"` authority — and for good reason: what a drag *means* is the
 * application's decision. Dragging a `"manual"` node moves it; dragging a
 * `"physics"` node should apply a force or switch the body to kinematic for the
 * duration; dragging a node under an animation may be forbidden outright. A
 * drag manager that wrote `node.transform.position` directly would make that
 * choice for everyone and would silently fight the owning system.
 *
 * So this class computes the one thing only it can compute — the world-space
 * displacement corresponding to the pointer's motion — and hands it to
 * {@link DragManagerOptions.onDrag}. The callback runs under whatever authority
 * the application has arranged; {@link DragManagerOptions.onDragStart} and
 * {@link DragManagerOptions.onDragEnd} exist precisely so it can take and hand
 * back that authority around the gesture.
 *
 * ## How the world delta is computed
 *
 * A pointer moves on the screen; a node moves in the world. The mapping between
 * them needs a plane to move *on*, and the one that behaves the way people
 * expect — the object stays under the finger — is the plane through the grab
 * point, parallel to the camera's near plane.
 *
 * Both projections are handled by unprojecting the two pointer positions onto
 * the **near plane** (`createPickRay`'s origin is exactly that point) and
 * taking the difference:
 *
 * - **Orthographic — exact.** Rays are parallel, so a near-plane displacement
 *   *is* the world displacement at every depth. This is exact under any affine
 *   camera transform: rotation, non-uniform scale, a parented camera rig —
 *   because the unprojection goes through the camera's world matrix.
 * - **Perspective — distance-proportional (MVP).** Near-plane displacements
 *   grow with depth by similar triangles, so the delta is scaled by
 *   `depth / camera.near`, where `depth` is the grab point's distance along the
 *   view axis, measured **once at drag start**. That is exact while the node
 *   stays on its starting plane, which is what dragging on a plane means, and
 *   it drifts if the callback moves the node towards or away from the camera
 *   (the scale is not recomputed mid-gesture). It also assumes the camera's
 *   world matrix carries no scale — a scaled *perspective* camera mixes camera
 *   units into `near`. Both limits are MVP-tier and documented rather than
 *   guessed around; the exact treatment is a ray/plane intersection against a
 *   drag plane, which belongs with §71's analytic tier.
 *
 * The projection is classified from the projection matrix rather than by
 * `instanceof`: `m[15]` is `1` for an orthographic projection and `0` for a
 * perspective one, whatever the camera class — including the custom-projection
 * cameras §47 requires later.
 */

import type { Unsubscribe } from "@fourjs/core";
import { Vector3, type DepthRange } from "@fourjs/math";
import { resolveWorldTransform, type Camera, type Node } from "@fourjs/scene";

import { createPickRay } from "./pick.js";
import type { ScenePointerEvent } from "./pointer-events.js";
import type { PointerInput } from "./pointer-input.js";

/** Called with each increment of a drag. */
export type DragListener = (
  node: Node,
  worldDelta: Vector3,
  event: ScenePointerEvent,
) => void;

/** Construction options for {@link DragManager}. */
export interface DragManagerOptions {
  /**
   * The pointer source whose events drive drags. Its `setPointerCapture` is
   * what keeps a drag alive when the pointer leaves the node.
   */
  pointerInput: PointerInput;
  /**
   * Camera the drag maths run against. Defaults to the pointer input's camera,
   * which is what resolved the pointer in the first place — pass one only to
   * override that deliberately.
   */
  camera?: Camera;
  /**
   * Clip-space depth convention of that camera's projection (plan D8). Defaults
   * to `"negative-one-to-one"` via `createPickRay`. It cancels out of the delta
   * (both unprojections use it), so it matters only for the perspective depth
   * measurement.
   */
  depthRange?: DepthRange;
  /**
   * Receives the world-space displacement since the previous move of this drag.
   *
   * **The vector is reused** between calls (plan D7) — read it or copy it,
   * never keep it. The manager never writes a transform: see the module
   * documentation.
   */
  onDrag: DragListener;
  /** Called when a drag begins, before any {@link DragManagerOptions.onDrag}. */
  onDragStart?: (node: Node, event: ScenePointerEvent) => void;
  /**
   * Called when a drag ends — on release, on
   * {@link DragManager.releaseDrag}, and on disposal. Takes no event, because
   * a programmatic release has none.
   */
  onDragEnd?: (node: Node) => void;
}

/** One drag in progress. */
interface DragState {
  /** The node being dragged. */
  readonly node: Node;
  /** NDC of the previous move; the delta is measured from here. */
  ndcX: number;
  ndcY: number;
  /** Perspective depth factor, `depth / near`; `1` for an orthographic camera. */
  readonly scale: number;
}

/** Scratch for the two near-plane unprojections and their difference. */
const originNow = new Vector3();
const originPrevious = new Vector3();
const direction = new Vector3();
const worldDelta = new Vector3();
const cameraForward = new Vector3();
const cameraPosition = new Vector3();
const toGrabPoint = new Vector3();

export class DragManager {
  readonly #pointerInput: PointerInput;
  readonly #camera: Camera | undefined;
  readonly #depthRange: DepthRange | undefined;
  readonly #onDrag: DragListener;
  readonly #onDragStart:
    ((node: Node, event: ScenePointerEvent) => void) | undefined;
  readonly #onDragEnd: ((node: Node) => void) | undefined;

  /** Active drags, keyed by `pointerId` — two fingers drag two nodes. */
  readonly #drags = new Map<number, DragState>();

  /** Node subscriptions, so `makeDraggable` is idempotent and disposable. */
  readonly #draggables = new Map<Node, Unsubscribe>();

  constructor(options: DragManagerOptions) {
    this.#pointerInput = options.pointerInput;
    this.#camera = options.camera;
    this.#depthRange = options.depthRange;
    this.#onDrag = options.onDrag;
    this.#onDragStart = options.onDragStart;
    this.#onDragEnd = options.onDragEnd;
  }

  /**
   * Makes `node` draggable and returns an unsubscriber that undoes it (ending
   * any drag of that node in progress).
   *
   * Calling it twice for the same node is a no-op that returns the same
   * unsubscriber — a node subscribed twice would drag at double speed.
   *
   * It subscribes to `node`'s own pointer events, so it inherits their
   * propagation (§72): a press on a *child* of `node` bubbles up and starts a
   * drag of `node`, which is how a group is dragged by any of its parts. A
   * child that must not drag its parent stops propagation in its own listener.
   */
  makeDraggable(node: Node): Unsubscribe {
    const existing = this.#draggables.get(node);
    if (existing !== undefined) {
      return existing;
    }

    const unsubscribers = [
      node.on("pointerdown", (event) => {
        this.#begin(node, event);
      }),
      node.on("pointermove", (event) => {
        this.#move(node, event);
      }),
      node.on("pointerup", (event) => {
        this.#finish(node, event.pointerId);
      }),
      // A cancelled pointer ends the drag exactly as a release does
      // (2026-08-06, A-9). It has to: `pointercancel` is the *only* event a
      // gesture the system took away will ever get, so a manager that listened
      // for `pointerup` alone would keep the drag — and its pointer capture —
      // alive forever. `onDragEnd` still runs, because the application's
      // authority hand-back (§42) is owed whether or not the gesture completed;
      // a caller that must tell a cancel from a release listens for
      // `pointercancel` itself.
      node.on("pointercancel", (event) => {
        this.#finish(node, event.pointerId);
      }),
      // Belt and braces: a capture suppresses hover changes, so a leave during
      // a drag should be impossible — but a drag whose capture was released
      // out from under it must still end rather than follow the pointer.
      node.on("pointerleave", (event) => {
        this.#finish(node, event.pointerId);
      }),
    ];

    const unsubscribe = (): void => {
      if (this.#draggables.delete(node)) {
        for (const off of unsubscribers) {
          off();
        }
        this.#endDragsOf(node);
      }
    };
    this.#draggables.set(node, unsubscribe);
    return unsubscribe;
  }

  /** Whether `pointerId` is currently dragging something. */
  isDragging(pointerId: number): boolean {
    return this.#drags.has(pointerId);
  }

  /** The node `pointerId` is dragging, or `null`. */
  getDragged(pointerId: number): Node | null {
    return this.#drags.get(pointerId)?.node ?? null;
  }

  /**
   * Ends `pointerId`'s drag, releasing its pointer capture and calling
   * `onDragEnd`. Ending a pointer that is not dragging is a no-op.
   */
  releaseDrag(pointerId: number): void {
    const state = this.#drags.get(pointerId);
    if (state === undefined) {
      return;
    }
    this.#drags.delete(pointerId);
    this.#pointerInput.releasePointerCapture(pointerId);
    this.#onDragEnd?.(state.node);
  }

  /**
   * Ends every drag and unsubscribes from every draggable node. Idempotent; the
   * manager is reusable afterwards (nothing about it is one-shot).
   *
   * **A deliberate exception to §83's "disposal is terminal"** (kept on the
   * 2026-09-11 stability audit): there is no disposed flag and nothing is
   * refused afterwards, because the manager owns no GPU or solver resource —
   * only node subscriptions and pointer captures, both of which
   * {@link DragManager.makeDraggable} re-establishes. `dispose` here means
   * "release everything now", not "never again"; a manager that must not be
   * reused is simply dropped.
   */
  dispose(): void {
    for (const pointerId of [...this.#drags.keys()]) {
      this.releaseDrag(pointerId);
    }
    for (const unsubscribe of [...this.#draggables.values()]) {
      unsubscribe();
    }
  }

  // --- internals ------------------------------------------------------------

  #begin(node: Node, event: ScenePointerEvent): void {
    if (this.#drags.has(event.pointerId)) {
      return;
    }
    const camera = this.#camera ?? this.#pointerInput.camera;
    this.#drags.set(event.pointerId, {
      node,
      ndcX: event.ndcX,
      ndcY: event.ndcY,
      scale: dragScale(camera, node, event.worldPoint),
    });
    // Subsequent moves and the release come to `node` whatever the pointer is
    // over — without this, a fast drag outruns the node and stalls.
    this.#pointerInput.setPointerCapture(node, event.pointerId);
    this.#onDragStart?.(node, event);
  }

  #move(node: Node, event: ScenePointerEvent): void {
    const state = this.#drags.get(event.pointerId);
    if (state === undefined || state.node !== node) {
      return;
    }
    const camera = this.#camera ?? this.#pointerInput.camera;

    createPickRay(
      camera,
      event.ndcX,
      event.ndcY,
      originNow,
      direction,
      this.#depthRange,
    );
    createPickRay(
      camera,
      state.ndcX,
      state.ndcY,
      originPrevious,
      direction,
      this.#depthRange,
    );
    worldDelta.copy(originNow).sub(originPrevious).scale(state.scale);

    state.ndcX = event.ndcX;
    state.ndcY = event.ndcY;
    this.#onDrag(node, worldDelta, event);
  }

  /** Ends `pointerId`'s drag if it belongs to `node`. */
  #finish(node: Node, pointerId: number): void {
    if (this.#drags.get(pointerId)?.node === node) {
      this.releaseDrag(pointerId);
    }
  }

  #endDragsOf(node: Node): void {
    for (const [pointerId, state] of [...this.#drags]) {
      if (state.node === node) {
        this.releaseDrag(pointerId);
      }
    }
  }
}

/**
 * Factor converting a near-plane displacement into a world displacement at the
 * grab point's depth: `1` for an orthographic camera, `depth / near` for a
 * perspective one (see the module documentation).
 *
 * `worldPoint` is the picked grab point when there was one; without it — a
 * capture already in force, a target with no hit — the node's own world origin
 * is used, which is the same plane for anything small and the object's centre
 * for anything large. A grab point behind the camera, or a zero `near`, yields
 * a scale of `1` rather than a negative or infinite one: a degenerate camera
 * should make a drag useless, not explosive.
 */
function dragScale(
  camera: Camera,
  node: Node,
  worldPoint: Vector3 | undefined,
): number {
  const elements = camera.projectionMatrix.elements;
  const orthographic = elements[15] !== 0;
  if (orthographic) {
    return 1;
  }

  const cameraWorld = resolveWorldTransform(camera).elements;
  // Cameras look down their own −Z (§7a, D8); the third basis column is +Z.
  cameraForward
    .set(-cameraWorld[8], -cameraWorld[9], -cameraWorld[10])
    .normalize();

  if (worldPoint === undefined) {
    const nodeWorld = resolveWorldTransform(node).elements;
    toGrabPoint.set(nodeWorld[12], nodeWorld[13], nodeWorld[14]);
  } else {
    toGrabPoint.copy(worldPoint);
  }
  toGrabPoint.sub(
    cameraPosition.set(cameraWorld[12], cameraWorld[13], cameraWorld[14]),
  );

  const depth = toGrabPoint.dot(cameraForward);
  if (!(depth > 0) || !(camera.near > 0)) {
    return 1;
  }
  return depth / camera.near;
}
