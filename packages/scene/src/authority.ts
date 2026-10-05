/**
 * Transform authority (§42).
 *
 * §42's rule is short and absolute: **exactly one system owns a node's
 * transform at a time**, and "the engine must prevent multiple systems from
 * silently overwriting the same transform". This module holds the vocabulary
 * for that ownership ({@link TransformAuthority}) and the enforcement primitive
 * every writing system shares ({@link warnAuthorityConflict}); the field itself
 * lives on `Node` (§42 writes `node.transformAuthority = "physics"`), see
 * `Node.transformAuthority`.
 *
 * ## What enforcement means here (decision, WP-2.3)
 *
 * §42 says conflicts "should produce development warnings" and that a warning
 * "fires whenever a system writes a transform it does not own". A warning alone
 * would still leave the transform overwritten — the very thing §42's first
 * sentence forbids — so the engine pairs the two halves: **the owner keeps the
 * transform and the non-owner's write is refused**. A refused write is loud
 * (a `console.warn`) and lossless in the other direction: nothing about the
 * owner's state is touched, so authority conflicts can never corrupt a
 * simulation, only stall the system that mis-declared itself.
 *
 * The check belongs to the *writer*, not to `Transform`: transforms are written
 * through plain math methods on hot paths (`transform.position.set(...)`,
 * plan D3), and gating every one of those on an ownership test would put a
 * branch inside the innermost loop in the engine and still be trivially
 * bypassable. Each system instead tests once per node per step, immediately
 * before it would write — the shape {@link warnAuthorityConflict} is built for.
 *
 * ## Deduplication (§42: *development* warnings)
 *
 * A conflicting system conflicts every fixed step — 60 identical lines per
 * second per node is noise that hides the first one. Warnings are therefore
 * emitted **once per node per writing authority** and suppressed afterwards,
 * tracked in a module-level `WeakMap` keyed by node so the bookkeeping dies
 * with the node and holds nothing alive. Two different authorities fighting
 * over one node produce two warnings, which is the point: each names a distinct
 * mis-configured system.
 *
 * `writer` is a {@link TransformAuthority} rather than a free-form system name
 * (decision, WP-2.3) because §42 identifies writers by the authority they claim
 * — `MotionSystem` writes as `"kinematic"`, a solver as `"physics"` — which
 * keeps the value typo-checked and makes the suppression key the same
 * vocabulary as the field being violated. Two systems that both claim
 * `"kinematic"` over one node therefore share a suppression slot; they are, by
 * §42's model, the same writer.
 *
 * The message is unconditional `console.warn` — not `DEV` / `devWarnOnce`.
 * `@fourjs/scene` is a §33 simulation package: `dev-build-mode.test.ts`
 * forbids any build-flag import here (the same reason a DEV-gated
 * `new Node()` warn was reverted). The WeakMap is the once-per-pair
 * suppress; production prints the first conflict and then stays quiet.
 *
 * Application writes on a system-owned node are a different contract (2026-10-05):
 * they **land**, and a DEV build warns once. That hook lives on
 * `Transform.markDirty` and is skipped inside
 * {@link runOwnedTransformWrite}, which every writing system wraps its owned
 * pose with. The DEV test is inlined (`typeof __FOUR_DEV__`) so this module
 * still does not import `DEV`.
 */

/**
 * The slice of `Node` this module reads — identity for the warning text plus
 * the owning {@link TransformAuthority} (§42).
 *
 * Structural rather than `import type { Node }` on purpose: `node.ts` imports
 * this module at runtime (for {@link DEFAULT_TRANSFORM_AUTHORITY}), so naming
 * the class here — even type-only — would close an import cycle between the
 * two files. Every `Node` satisfies this shape, and TypeScript's structural
 * typing means callers pass their nodes exactly as before.
 */
import { DEV_WARNING_PREFIX } from "@fourjs/core";

export interface AuthorityNode {
  /** `Node.id` — stable identity for the warning and its suppression. */
  readonly id: string;
  /** `Node.name` — empty when unnamed; used only to label the warning. */
  readonly name: string;
  /** `Node.transformAuthority` — the §42 owner being violated. */
  readonly transformAuthority: TransformAuthority;
}

/**
 * Which system owns a node's transform (§42).
 *
 * Listed in §42's order. Meanings, per §42 and §19:
 *
 * - `"manual"` — application code owns it; the default for a new node.
 * - `"animation"` — an animation clip or timeline drives it.
 * - `"kinematic"` — a kinematic/procedural controller drives it
 *   (`MotionSystem`, and the §12 controller of WP-2.5).
 * - `"physics"` — a solver drives it; the transform follows the rigid body.
 * - `"blended"` — the §19 physics-animation pipeline is the single owner; blend
 *   weights vary *inside* that pipeline without changing ownership. Assignable
 *   since WP-7.3, which built that pipeline into `PhysicsWorld`
 *   (`@fourjs/physics`, plan P7-4); between WP-2.3 and WP-7.3 assigning it threw
 *   `FourError("NOT_IMPLEMENTED")`, because no system could have driven such a
 *   node. A `"blended"` node needs two more things `@fourjs/scene` cannot see: a
 *   `RigidBody` registered with a `PhysicsWorld`, and a `PoseTarget` for
 *   animation to write. The world raises the first step that finds the target
 *   missing; a node registered with no world at all is simply a node nothing
 *   drives, which is true of every authority whose system was never wired up.
 * - `"constraint"` — a constraint/IK solve owns the final pose.
 * - `"network"` — the transform is externally replicated. §42 makes this an
 *   enabler only; transport and replication protocols are out of scope (§5).
 */
export type TransformAuthority =
  | "manual"
  | "animation"
  | "kinematic"
  | "physics"
  | "blended"
  | "constraint"
  | "network";

/**
 * Every {@link TransformAuthority} value, in §42's declaration order.
 *
 * Exported so validation, serialization (§79), and tests can enumerate the
 * authorities without restating the union. `satisfies` makes every entry a
 * checked member of {@link TransformAuthority} — an invented value is a compile
 * error — while `as const` keeps the literal types; completeness and ordering
 * are asserted in `tests/authority.test.ts` against §42.
 */
export const TRANSFORM_AUTHORITIES = [
  "manual",
  "animation",
  "kinematic",
  "physics",
  "blended",
  "constraint",
  "network",
] as const satisfies readonly TransformAuthority[];

/**
 * The authority a node has until something claims it: `"manual"`, i.e. owned by
 * application code. A node nobody has claimed is not owned by a *system*, so
 * direct writes from user code are always legal. Writes to a *system*-owned
 * node still land; a DEV build warns once ({@link warnApplicationTransformWrite}).
 */
export const DEFAULT_TRANSFORM_AUTHORITY: TransformAuthority = "manual";

/**
 * Depth of {@link runOwnedTransformWrite}. Transform.markDirty consults this
 * so an owning system's pose write does not look like an application write.
 */
let ownedWriteDepth = 0;

/**
 * True while an owning system is writing a transform it has already checked
 * against {@link AuthorityNode.transformAuthority}.
 */
export function isOwnedTransformWrite(): boolean {
  return ownedWriteDepth > 0;
}

/**
 * Runs `fn` as an owned transform write: {@link Transform.markDirty} will not
 * emit the application-write warning. Nesting is counted. The write still
 * lands — this is a warning skip, not a lock.
 *
 * Call this **after** the existing `transformAuthority === writer` check, around
 * the body that actually mutates the transform. Conflicting systems that skip
 * the write never need it.
 */
export function runOwnedTransformWrite<T>(fn: () => T): T {
  ownedWriteDepth += 1;
  try {
    return fn();
  } finally {
    ownedWriteDepth -= 1;
  }
}

const warnedApplicationWrites = new WeakSet<AuthorityNode>();

/**
 * Reports that application code wrote a transform owned by a system. The write
 * **already happened** — this function only reports. Once per node.
 *
 * Inlined DEV test: do not import `DEV` into this simulation package.
 */
export function warnApplicationTransformWrite(node: AuthorityNode): boolean {
  if (node.transformAuthority === DEFAULT_TRANSFORM_AUTHORITY) {
    return false;
  }
  if (ownedWriteDepth > 0) {
    return false;
  }
  if (warnedApplicationWrites.has(node)) {
    return false;
  }
  warnedApplicationWrites.add(node);
  const label = node.name === "" ? node.id : `${node.id} ("${node.name}")`;
  console.warn(
    `${DEV_WARNING_PREFIX} Application code wrote the transform of node ` +
      `${label}, which is owned by "${node.transformAuthority}" authority; ` +
      "the write was applied (§42 warns in development, it does not lock " +
      'application writes). Set node.transformAuthority = "manual" if the ' +
      "application should own it. Further application writes on this node " +
      "are suppressed.",
  );
  return true;
}

/**
 * Nodes already warned about, per writing authority. `WeakMap` so a node that
 * goes away takes its suppression record with it, and `Set` values so the
 * per-writer granularity survives.
 */
const warnedWriters = new WeakMap<AuthorityNode, Set<TransformAuthority>>();

/**
 * Reports that `writer` tried to write the transform of `node`, which it does
 * not own (§42), and returns whether a warning was actually printed — `true`
 * the first time this `node`/`writer` pair conflicts, `false` for every
 * suppressed repeat.
 *
 * The caller is expected to **skip its write**; this function only reports.
 *
 * ```ts
 * if (node.transformAuthority !== "kinematic") {
 *   warnAuthorityConflict(node, "kinematic");
 *   continue; // the owner keeps the transform
 * }
 * ```
 */
export function warnAuthorityConflict(
  node: AuthorityNode,
  writer: TransformAuthority,
): boolean {
  let warned = warnedWriters.get(node);
  if (warned === undefined) {
    warned = new Set<TransformAuthority>();
    warnedWriters.set(node, warned);
  }
  if (warned.has(writer)) {
    return false;
  }
  warned.add(writer);

  const label = node.name === "" ? node.id : `${node.id} ("${node.name}")`;
  console.warn(
    `${DEV_WARNING_PREFIX} A "${writer}" system tried to write the transform of node ` +
      `${label}, which is owned by "${node.transformAuthority}" authority; ` +
      "the write was refused (§42: exactly one system owns a node's " +
      `transform). Set node.transformAuthority = "${writer}" if that system ` +
      "should own it. Further conflicts from this writer on this node are " +
      "suppressed.",
  );
  return true;
}
