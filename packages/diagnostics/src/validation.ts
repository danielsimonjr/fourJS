/**
 * §85's validation catalogue (A-4 remainder step 2, 2026-09-06).
 */

import { DEV, devAssert, devWarnOnce } from "@fourjs/core";

export const COORDINATE_ENVELOPE = 1e5;
export const UNSTABLE_SCALE_RATIO = 1e4;
export const NEAR_ZERO_SCALE = 1e-6;

export interface ValidationCheckOptions {
  readonly enabled?: boolean;
}

export interface ValidationCatalogueOptions {
  readonly finite?: ValidationCheckOptions;
  readonly coordinateEnvelope?: ValidationCheckOptions;
  readonly singularTransform?: ValidationCheckOptions;
  readonly unstableScale?: ValidationCheckOptions;
  readonly sceneGraphCycle?: ValidationCheckOptions;
  readonly impossibleMass?: ValidationCheckOptions;
  readonly versionMismatch?: ValidationCheckOptions;
}

export interface ValidationNodeLike {
  readonly id: string;
  readonly parent: ValidationNodeLike | null;
  readonly children: readonly ValidationNodeLike[];
}

export interface ValidationTransformLike {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly scale: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

function checkEnabled(
  options: ValidationCheckOptions | undefined,
  defaultEnabled: boolean,
): boolean {
  if (!DEV) return false;
  return options?.enabled ?? defaultEnabled;
}

export function warnCoordinateEnvelope(
  position: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  const farthest = Math.max(
    Math.abs(position.x),
    Math.abs(position.y),
    Math.abs(position.z),
  );
  if (farthest <= COORDINATE_ENVELOPE) return false;
  return devWarnOnce(
    `coordinate-envelope:${context}`,
    `§41/§85: ${context} is ${String(farthest)} units from the origin; ` +
      `32-bit float positions lose sub-millimetre fidelity beyond roughly ` +
      `${String(COORDINATE_ENVELOPE)} units. Keep the simulated region within ` +
      "that envelope, or re-centre the world.",
  );
}

export function warnSingularScale(
  scale: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  if (scale.x !== 0 && scale.y !== 0 && scale.z !== 0) return false;
  return devWarnOnce(
    `singular-scale:${context}`,
    `§85: ${context} has a zero scale component (${String(scale.x)}, ` +
      `${String(scale.y)}, ${String(scale.z)}), so its world matrix is ` +
      "singular and inversion will refuse.",
  );
}

export function warnUnstableScale(
  scale: { readonly x: number; readonly y: number; readonly z: number },
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  const ax = Math.abs(scale.x);
  const ay = Math.abs(scale.y);
  const az = Math.abs(scale.z);
  const max = Math.max(ax, ay, az);
  const min = Math.min(ax, ay, az);
  if (min > 0 && max / min > UNSTABLE_SCALE_RATIO) {
    return devWarnOnce(
      `unstable-scale:${context}`,
      `§85: ${context} scale components differ by more than ` +
        `${String(UNSTABLE_SCALE_RATIO)}:1 (${String(scale.x)}, ${String(scale.y)}, ` +
        `${String(scale.z)}). Extreme ratios amplify floating-point error in ` +
        "world-matrix composition.",
    );
  }
  if (max > 0 && min < NEAR_ZERO_SCALE) {
    return devWarnOnce(
      `near-zero-scale:${context}`,
      `§85: ${context} has a near-zero scale component (${String(scale.x)}, ` +
        `${String(scale.y)}, ${String(scale.z)}). Treat world units consistently ` +
        "rather than mixing large and microscopic scales on one node.",
    );
  }
  return false;
}

export function assertFinite(
  value: number,
  field: string,
  options?: ValidationCheckOptions,
): void {
  if (!checkEnabled(options, true)) return;
  devAssert(
    Number.isFinite(value),
    "INVALID_APPLICATION_STATE",
    `${field} must be a finite number; got ${String(value)} (§85).`,
    { field, value },
  );
}

/**
 * §85 NaN/infinity check for a structural `{ x, y, z }`. Does not import
 * `@fourjs/math` — callers pass any vec3-shaped record.
 */
export function assertFiniteVec3(
  value: { readonly x: number; readonly y: number; readonly z: number },
  field: string,
  options?: ValidationCheckOptions,
): void {
  if (!checkEnabled(options, true)) return;
  assertFinite(value.x, `${field}.x`, options);
  assertFinite(value.y, `${field}.y`, options);
  assertFinite(value.z, `${field}.z`, options);
}

/**
 * §85 impossible-mass check. Warns when `mass` is negative or not finite
 * (NaN / ±Infinity). `mass === 0` is quiet here: static/kinematic bodies
 * express non-simulated mass through body type (§23), and this helper is a
 * structural number check, not a body-type rule.
 */
export function warnImpossibleMass(
  mass: number,
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  if (Number.isFinite(mass) && mass >= 0) return false;
  return devWarnOnce(
    `impossible-mass:${context}`,
    `§85: ${context} has an impossible mass (${String(mass)}); ` +
      "mass must be a finite non-negative number.",
  );
}

/**
 * §85 impossible-inertia check. Same predicate as {@link warnImpossibleMass}:
 * negative or non-finite. Accepts a scalar (2D Z-inertia, or one tensor
 * diagonal) so physics packages can call it without this module importing them.
 */
export function warnImpossibleInertia(
  inertia: number,
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  if (Number.isFinite(inertia) && inertia >= 0) return false;
  return devWarnOnce(
    `impossible-inertia:${context}`,
    `§85: ${context} has an impossible inertia (${String(inertia)}); ` +
      "inertia must be a finite non-negative number.",
  );
}

/**
 * §85 serialization / document version mismatch. Structural: any
 * `expected` / `actual` pair the caller already compared.
 */
export function warnVersionMismatch(
  expected: string | number,
  actual: string | number,
  context: string,
  options?: ValidationCheckOptions,
): boolean {
  if (!checkEnabled(options, true)) return false;
  if (expected === actual) return false;
  return devWarnOnce(
    `version-mismatch:${context}:${String(expected)}:${String(actual)}`,
    `§85: ${context} version mismatch: expected ${String(expected)}, ` +
      `got ${String(actual)}.`,
  );
}

export function assertNoSceneGraphCycle(
  node: ValidationNodeLike,
  candidate: ValidationNodeLike,
  options?: ValidationCheckOptions,
): void {
  if (!checkEnabled(options, true)) return;
  devAssert(
    candidate !== node,
    "INVALID_SCENE_GRAPH",
    "A node cannot be added to itself (§85: scene graph cycles).",
    { node: node.id, candidate: candidate.id },
  );
  let walk: ValidationNodeLike | null = node;
  while (walk !== null) {
    devAssert(
      walk !== candidate,
      "INVALID_SCENE_GRAPH",
      "A node cannot be added to one of its own descendants " +
        "(§85: scene graph cycles).",
      { node: node.id, candidate: candidate.id, ancestor: walk.id },
    );
    walk = walk.parent;
  }
}

export function validateSceneNode(
  node: ValidationNodeLike & { readonly transform: ValidationTransformLike },
  options: ValidationCatalogueOptions = {},
): number {
  if (!DEV) return 0;
  const context = `node ${node.id}`;
  assertFiniteVec3(
    node.transform.position,
    `${context}.position`,
    options.finite,
  );
  assertFiniteVec3(node.transform.scale, `${context}.scale`, options.finite);
  let warnings = 0;
  if (
    warnCoordinateEnvelope(
      node.transform.position,
      context,
      options.coordinateEnvelope,
    )
  ) {
    warnings += 1;
  }
  if (
    warnSingularScale(node.transform.scale, context, options.singularTransform)
  ) {
    warnings += 1;
  }
  if (warnUnstableScale(node.transform.scale, context, options.unstableScale)) {
    warnings += 1;
  }
  return warnings;
}

export function validateSceneSubtree(
  root: ValidationNodeLike & { readonly transform: ValidationTransformLike },
  options: ValidationCatalogueOptions = {},
): number {
  if (!DEV) return 0;
  const visited = new Set<ValidationNodeLike>();
  const walk = (
    node: ValidationNodeLike & { readonly transform: ValidationTransformLike },
  ): number => {
    if (visited.has(node)) {
      if (checkEnabled(options.sceneGraphCycle, true)) {
        devAssert(
          false,
          "INVALID_SCENE_GRAPH",
          `Scene graph cycle detected at node ${node.id} (§85).`,
          { node: node.id },
        );
      }
      return 0;
    }
    visited.add(node);
    let warnings = validateSceneNode(node, options);
    for (const child of node.children) {
      warnings += walk(
        child as ValidationNodeLike & {
          readonly transform: ValidationTransformLike;
        },
      );
    }
    return warnings;
  };
  return walk(root);
}
