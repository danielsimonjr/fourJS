/**
 * The §58 paint-object tier — validation and paint-to-graph lowering behind
 * `registerShapePaints()` (2026-08-29; R-16's recorded follow-up, unblocked
 * by RFC 0001).
 *
 * ## What this module is
 *
 * `shape.ts` owns what a paint *is* — the {@link Paint} union, the two-tier
 * rule on `Shape2DOptions.material`, and the registration slot — and this
 * module is what fills the slot: §85 validation for the three object paints,
 * and a **lowering** that turns a resolved fill/stroke pair into a §60
 * `NodeMaterial` whose graph evaluates the paints per fragment. The two live
 * in separate modules for the same reason `gl-node-program.ts` lives behind
 * `node-pipeline-registry.ts`: everything `Shape2D` reaches statically rides
 * in every bundle that draws a shape, so the tier's whole cost sits behind an
 * explicit call and a bundle that never authors a gradient carries none of it
 * (A-3's rule — the thing that needs the feature is a module, so a
 * lazily-filled module `let` works).
 *
 * ## Where it lives, and why (§3.1, §98)
 *
 * §98 files "paints" under `@fourjs/materials`, but the paint *objects* belong
 * to §50's shape node — R-16's landed decision, restated by §50's own example
 * (`fill`/`stroke` are constructor options of the shape) — and `materials`
 * cannot see `ShapeFill` without inverting the frozen matrix (`render`
 * imports `materials`, never the reverse). So the lowering sits beside the
 * family that owns the paints, in `@fourjs/render`, and consumes the §60
 * builder through the `render → materials` edge that has existed since
 * wave 3. No §3.1 edge moves.
 *
 * ## The lowering, exactly
 *
 * - A **solid** paint is a `vec4` constant (opacity folded into alpha).
 * - A **linear gradient** reads the shape's local `position.xy` — the space
 *   the paint's own `from`/`to` are authored in — and computes
 *   `t = p · k + k₀` (the axis normal equation, precomputed in f64), then the
 *   stop ramp below.
 * - A **radial gradient** computes `t = |p − center| / radius`, then the
 *   ramp.
 * - A **conic gradient** computes
 *   `t = fract((angle(p − center) − startAngle) / 2π)` — polar angle of the
 *   local offset, RFC 0001's `angle` operator — then the same ramp. Offset 0
 *   sits on the `startAngle` ray from +X; the parameter increases
 *   counter-clockwise and wraps.
 * - The **stop ramp** is the exact per-fragment form
 *   `c(t) = c₀ + Σᵢ (cᵢ − cᵢ₋₁) · saturate((t − pᵢ₋₁) / (pᵢ − pᵢ₋₁))`,
 *   with a zero-width segment (a hard edge) contributing through
 *   `step(pᵢ, t)` instead — every operator in §60's closed set, no facet
 *   anywhere, and padding before the first stop and past the last falls out
 *   of the `saturate`s with no case of its own.
 * - A **pattern** samples its texture at the shape's uv (the `[0, 1]²`
 *   bounding-box parameterization every shape geometry carries), through an
 *   optional `uv × repeat + offset` transform; tiling is the texture's own
 *   `wrap` mode's business (§77).
 * - When fill and stroke draw **different** paints, the graph blends the two
 *   evaluations with `mix(fill, stroke, color.x)` over the selector stream
 *   the geometry bakes (`0` fill, `1` stroke — exact at both ends), and
 *   {@link ShapePaintPlan.selector} tells the shape to bake it.
 *
 * A **conic** gradient is the same lowering as the others once §60 carries
 * `"angle"` (RFC 0001's one-row closed-union amendment). It stays behind
 * `registerShapePaints()`, so a bundle that never opts in still emits the
 * pictures it always did.
 *
 * ## Determinism (§33) and sharing
 *
 * The lowering is a pure function of the resolved paint **values**: node
 * creation order is source order, every derived constant is computed in
 * f64 from the authored numbers, and no collection enumeration order is
 * consulted — so the same pair lowers to the same node array and therefore
 * the same emitted GLSL/WGSL bytes, which is what makes N shapes naming one
 * paint share **one** compiled program through the backend's source-keyed
 * cache (RFC 0001 §2) with no cache of this module's own. Paint values are
 * baked as graph *constants* — the recorded trade: a paint is program
 * identity, so re-authoring one per frame compiles per distinct value
 * (documented on {@link Paint}); values-as-uniforms is the staged upgrade if
 * a consumer ever needs animated stops.
 *
 * ## §57 render state on the derived material
 *
 * The lowering sets `transparent` from the paint values — any folded alpha
 * below 1, or any pattern (a texture's alpha is data the lowering cannot
 * see) — so a translucent gradient blends without a knob the author has no
 * material to turn. Everything else stays at §57's defaults; an author who
 * needs more writes it onto `shape.material` post-construction, knowing a
 * later paint assignment re-derives it.
 */

import {
  NodeMaterialBuilder,
  type Material,
  type MaterialTexture,
  type ShaderExpression,
} from "@fourjs/materials";
import type { ColorRGBA } from "@fourjs/math";
import type { Point2D } from "@fourjs/geometry";

import {
  setShapePaintSupport,
  type GradientStop,
  type ConicGradientPaint,
  type LinearGradientPaint,
  type Paint,
  type PatternPaint,
  type RadialGradientPaint,
  type ResolvedConicGradientPaint,
  type ResolvedGradientStop,
  type ResolvedLinearGradientPaint,
  type ResolvedObjectPaint,
  type ResolvedPaint,
  type ResolvedPatternPaint,
  type ResolvedRadialGradientPaint,
  type ResolvedShapeFill,
  type ResolvedStrokeStyle,
  type ShapePaintPlan,
} from "./shape.js";

/**
 * Paints the lowering actually evaluates. Conic is authored and stored, but
 * kept off {@link ResolvedObjectPaint} so `@fourjs/four`'s existing paint
 * switch stays total without a serializer edit in this packet.
 */
type LoweredPaint = ResolvedPaint | ResolvedConicGradientPaint;

/** §85's refusal, uniformly cited — the solid tier's spelling, kept. */
function refuse(detail: string): never {
  throw new RangeError(`${detail} (§58, §85).`);
}

/** Rejects a non-finite number (§85), returning it. */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    refuse(`${name} must be finite; got ${String(value)}`);
  }
  return value;
}

/** Validates and copies a paint's point parameter (§85). */
function requirePoint(name: string, point: Point2D): Point2D {
  if (typeof point !== "object" || point === null) {
    refuse(`${name} must be a finite point; got ${String(point)}`);
  }
  return {
    x: requireFinite(`${name}.x`, point.x),
    y: requireFinite(`${name}.y`, point.y),
  };
}

/** Validates an opacity multiplier (§85) — finite, 0…1, defaulting to 1. */
function requireOpacity(name: string, value: number | undefined): number {
  const opacity = value ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    refuse(
      `${name}.opacity must be a finite number between 0 and 1; got ` +
        String(opacity),
    );
  }
  return opacity;
}

/**
 * Validates and copies a gradient's stop list (§85): at least two stops,
 * every offset finite in 0…1 and **non-decreasing** — an unsorted list is
 * refused rather than re-sorted, because re-ordering is a silent
 * reinterpretation of what the author wrote — and every colour channel
 * finite.
 */
function requireStops(
  name: string,
  stops: readonly GradientStop[],
): ResolvedGradientStop[] {
  if (stops.length < 2) {
    refuse(
      `${name}.stops needs at least 2 stops (one flat colour is a "solid" ` +
        `paint); got ${String(stops.length)}`,
    );
  }
  const resolved: ResolvedGradientStop[] = [];
  let previous = 0;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    const offset = requireFinite(
      `${name}.stops[${String(i)}].offset`,
      stop.offset,
    );
    if (offset < 0 || offset > 1) {
      refuse(
        `${name}.stops[${String(i)}].offset must be in 0…1; got ` +
          String(offset),
      );
    }
    if (i > 0 && offset < previous) {
      refuse(
        `${name}.stops must be sorted by offset — stop ${String(i)} at ` +
          `${String(offset)} follows ${String(previous)}; they are refused ` +
          "out of order rather than re-sorted",
      );
    }
    previous = offset;
    const color = stop.color;
    for (let channel = 0; channel < 4; channel += 1) {
      requireFinite(
        `${name}.stops[${String(i)}].color[${String(channel)}]`,
        color[channel],
      );
    }
    resolved.push({
      offset,
      color: [color[0], color[1], color[2], color[3]],
    });
  }
  return resolved;
}

/** Validates a {@link LinearGradientPaint} (§85), copying every field. */
function resolveLinearGradient(
  name: string,
  paint: LinearGradientPaint,
): ResolvedLinearGradientPaint {
  const from = requirePoint(`${name}.from`, paint.from);
  const to = requirePoint(`${name}.to`, paint.to);
  if (from.x === to.x && from.y === to.y) {
    refuse(
      `${name} needs a gradient axis: from and to are both ` +
        `(${String(from.x)}, ${String(from.y)}) — a zero-length axis has no ` +
        "direction",
    );
  }
  return {
    kind: "linear-gradient",
    from,
    to,
    stops: requireStops(name, paint.stops),
    opacity: requireOpacity(name, paint.opacity),
  };
}

/** Validates a {@link RadialGradientPaint} (§85), copying every field. */
function resolveRadialGradient(
  name: string,
  paint: RadialGradientPaint,
): ResolvedRadialGradientPaint {
  const radius = requireFinite(`${name}.radius`, paint.radius);
  if (radius <= 0) {
    refuse(`${name}.radius must be positive; got ${String(radius)}`);
  }
  return {
    kind: "radial-gradient",
    center: requirePoint(`${name}.center`, paint.center),
    radius,
    stops: requireStops(name, paint.stops),
    opacity: requireOpacity(name, paint.opacity),
  };
}

/** Validates a {@link ConicGradientPaint} (§85), copying every field. */
function resolveConicGradient(
  name: string,
  paint: ConicGradientPaint,
): ResolvedConicGradientPaint {
  return {
    kind: "conic-gradient",
    center: requirePoint(`${name}.center`, paint.center),
    startAngle: requireFinite(`${name}.startAngle`, paint.startAngle ?? 0),
    stops: requireStops(name, paint.stops),
    opacity: requireOpacity(name, paint.opacity),
  };
}

/** Validates a {@link PatternPaint} (§85). The texture is held by reference. */
function resolvePattern(
  name: string,
  paint: PatternPaint,
): ResolvedPatternPaint {
  // Structural presence only: what makes a texture drawable is the backend's
  // business (§77), and a whitelist here would refuse a consumer's own
  // MaterialTexture — the same stance NodeMaterial.setTexture takes.
  if (
    typeof (paint.texture as unknown) !== "object" ||
    (paint.texture as unknown) === null
  ) {
    refuse(
      `${name}.texture must be a §77 texture; got ` +
        typeof (paint.texture as unknown),
    );
  }
  const repeat =
    paint.repeat === undefined
      ? { x: 1, y: 1 }
      : requirePoint(`${name}.repeat`, paint.repeat);
  if (repeat.x === 0 || repeat.y === 0) {
    refuse(
      `${name}.repeat must be non-zero per axis — a zero repeat collapses ` +
        "the pattern's coordinate; negative values mirror",
    );
  }
  return {
    kind: "pattern",
    texture: paint.texture,
    repeat,
    offset:
      paint.offset === undefined
        ? { x: 0, y: 0 }
        : requirePoint(`${name}.offset`, paint.offset),
    opacity: requireOpacity(name, paint.opacity),
  };
}

/** See {@link ShapePaintSupport.resolvePaint}. */
function resolvePaint(name: string, paint: Paint): ResolvedObjectPaint {
  switch (paint.kind) {
    case "linear-gradient":
      return resolveLinearGradient(name, paint);
    case "radial-gradient":
      return resolveRadialGradient(name, paint);
    case "conic-gradient":
      // Stored on the shape; the serializer packet that names conic widens
      // {@link ResolvedObjectPaint}. Until then the cast is this module's.
      return resolveConicGradient(
        name,
        paint,
      ) as unknown as ResolvedObjectPaint;
    case "pattern":
      return resolvePattern(name, paint);
    default: {
      const kind = (paint as { kind: unknown }).kind;
      refuse(
        `${name} must be a §58 paint; got kind ${JSON.stringify(kind)} — ` +
          'this tier draws "solid", "linear-gradient", "radial-gradient", ' +
          '"conic-gradient" and "pattern"',
      );
    }
  }
}

/** The paint an absent half draws — white, `UnlitMaterial`'s own default. */
const WHITE: ResolvedPaint = {
  kind: "solid",
  color: [1, 1, 1, 1],
  opacity: 1,
};

/**
 * Identity keys for {@link paintKey}'s pattern arm, assigned per texture
 * object on first sight. Compared for equality within one process and never
 * emitted anywhere, so the counter is §33-safe; a `WeakMap` so the key
 * pins nothing.
 */
const textureIdentities = new WeakMap<MaterialTexture, number>();

/** The next {@link textureIdentities} value. */
let nextTextureIdentity = 1;

/** One texture object's stable in-process identity. */
function textureIdentity(texture: MaterialTexture): number {
  let id = textureIdentities.get(texture);
  if (id === undefined) {
    id = nextTextureIdentity;
    nextTextureIdentity += 1;
    textureIdentities.set(texture, id);
  }
  return id;
}

/** A colour's canonical key fragment. */
function colorKey(color: ColorRGBA): string {
  return `${String(color[0])},${String(color[1])},${String(color[2])},${String(
    color[3],
  )}`;
}

/**
 * A resolved paint's canonical **value** key — used only to decide whether
 * two halves draw the same paint (no selector, one evaluation) or different
 * ones (selector + `mix`). Patterns key on texture object identity plus
 * their transform: two texture objects are two paints even if their pixels
 * agree, which is the honest answer available without reading pixels.
 */
function paintKey(paint: LoweredPaint): string {
  switch (paint.kind) {
    case "solid":
      return `s:${colorKey(paint.color)}:${String(paint.opacity)}`;
    case "linear-gradient":
      return (
        `l:${String(paint.from.x)},${String(paint.from.y)}:` +
        `${String(paint.to.x)},${String(paint.to.y)}:${stopsKey(paint.stops)}` +
        `:${String(paint.opacity)}`
      );
    case "radial-gradient":
      return (
        `r:${String(paint.center.x)},${String(paint.center.y)}:` +
        `${String(paint.radius)}:${stopsKey(paint.stops)}` +
        `:${String(paint.opacity)}`
      );
    case "conic-gradient":
      return (
        `c:${String(paint.center.x)},${String(paint.center.y)}:` +
        `${String(paint.startAngle)}:${stopsKey(paint.stops)}` +
        `:${String(paint.opacity)}`
      );
    default:
      return (
        `p:${String(textureIdentity(paint.texture))}:` +
        `${String(paint.repeat.x)},${String(paint.repeat.y)}:` +
        `${String(paint.offset.x)},${String(paint.offset.y)}:` +
        `${String(paint.opacity)}`
      );
  }
}

/** The stops' key fragment. */
function stopsKey(stops: readonly ResolvedGradientStop[]): string {
  return stops
    .map((stop) => `${String(stop.offset)}@${colorKey(stop.color)}`)
    .join(";");
}

/** A stop's drawn RGBA — its colour with the paint's opacity folded in. */
function drawnColor(color: ColorRGBA, opacity: number): ColorRGBA {
  return [color[0], color[1], color[2], color[3] * opacity];
}

/**
 * Whether a paint can produce a fragment with alpha below 1 — what sets the
 * derived material's §57 `transparent`. A pattern always can: its alpha is
 * texture data the lowering cannot see, and classifying it opaque would clip
 * authored translucency, where classifying it transparent only re-sorts a
 * fully opaque one (§66) without changing its pixels.
 */
function isTranslucent(paint: LoweredPaint | undefined): boolean {
  if (paint === undefined) {
    return false;
  }
  switch (paint.kind) {
    case "solid":
      return paint.color[3] * paint.opacity < 1;
    case "pattern":
      return true;
    default:
      return paint.stops.some((stop) => stop.color[3] * paint.opacity < 1);
  }
}

/**
 * Appends the exact per-fragment stop ramp over `t` — see the module header
 * for the formula and why a zero-width segment becomes a `step`.
 */
function stopRamp(
  builder: NodeMaterialBuilder,
  t: ShaderExpression,
  stops: readonly ResolvedGradientStop[],
  opacity: number,
): ShaderExpression {
  let color = builder.constant(drawnColor(stops[0].color, opacity));
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const stop = stops[i];
    const width = stop.offset - previous.offset;
    const weight =
      width > 0
        ? t
            .subtract(previous.offset)
            .multiply(1 / width)
            .saturate()
        : builder.constant(stop.offset).step(t);
    const from = drawnColor(previous.color, opacity);
    const to = drawnColor(stop.color, opacity);
    color = color.add(
      builder
        .constant([
          to[0] - from[0],
          to[1] - from[1],
          to[2] - from[2],
          to[3] - from[3],
        ])
        .multiply(weight),
    );
  }
  return color;
}

/**
 * Appends one paint's per-fragment evaluation to `builder` — the lowering's
 * core, one arm per §58 kind this tier draws.
 */
function evaluatePaint(
  builder: NodeMaterialBuilder,
  paint: LoweredPaint,
): ShaderExpression {
  switch (paint.kind) {
    case "solid":
      return builder.constant(drawnColor(paint.color, paint.opacity));
    case "linear-gradient": {
      // t = p · k + k₀ with k = d/|d|², k₀ = −(from · d)/|d|² — the affine
      // form of "signed fraction along the axis", precomputed in f64 so the
      // graph carries two constants instead of per-fragment vector algebra.
      const dx = paint.to.x - paint.from.x;
      const dy = paint.to.y - paint.from.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = builder
        .attribute("position")
        .swizzle("xy")
        .dot([dx / lengthSquared, dy / lengthSquared])
        .add(-(paint.from.x * dx + paint.from.y * dy) / lengthSquared);
      return stopRamp(builder, t, paint.stops, paint.opacity);
    }
    case "radial-gradient": {
      const t = builder
        .attribute("position")
        .swizzle("xy")
        .subtract([paint.center.x, paint.center.y])
        .length()
        .multiply(1 / paint.radius);
      return stopRamp(builder, t, paint.stops, paint.opacity);
    }
    case "conic-gradient": {
      // t = fract((angle(p − center) − startAngle) / 2π) — wraps, so a
      // stop at 0 and a stop at 1 meet on the start-angle ray.
      const t = builder
        .attribute("position")
        .swizzle("xy")
        .subtract([paint.center.x, paint.center.y])
        .angle()
        .subtract(paint.startAngle)
        .multiply(1 / (Math.PI * 2))
        .fract();
      return stopRamp(builder, t, paint.stops, paint.opacity);
    }
    default: {
      let uv = builder.uv();
      if (
        paint.repeat.x !== 1 ||
        paint.repeat.y !== 1 ||
        paint.offset.x !== 0 ||
        paint.offset.y !== 0
      ) {
        uv = uv
          .multiply([paint.repeat.x, paint.repeat.y])
          .add([paint.offset.x, paint.offset.y]);
      }
      const sample = builder.texture(paint.texture, uv);
      return paint.opacity === 1
        ? sample
        : sample.multiply([1, 1, 1, paint.opacity]);
    }
  }
}

/** See {@link ShapePaintSupport.plan} and the module header. */
function plan(
  fill: ResolvedShapeFill,
  stroke: ResolvedStrokeStyle | null,
): ShapePaintPlan {
  // The absent-paint defaults restate the material tier's picture: "inherit"
  // and a paintless stroke draw the material's own colour there, and the one
  // material a derived shape would have worn is `UnlitMaterial`'s white.
  const fillPaint =
    fill === "none" ? undefined : fill === "inherit" ? WHITE : fill;
  const strokePaint = stroke === null ? undefined : (stroke.paint ?? WHITE);
  const selector =
    fillPaint !== undefined &&
    strokePaint !== undefined &&
    paintKey(fillPaint) !== paintKey(strokePaint);
  const builder = new NodeMaterialBuilder();
  if (selector) {
    const fillColor = evaluatePaint(builder, fillPaint);
    const strokeColor = evaluatePaint(builder, strokePaint);
    builder.output.color = builder.mix(
      fillColor,
      strokeColor,
      builder.attribute("color").swizzle("x"),
    );
  } else {
    builder.output.color = evaluatePaint(
      builder,
      fillPaint ?? strokePaint ?? WHITE,
    );
  }
  const material: Material = builder.build({
    transparent: isTranslucent(fillPaint) || isTranslucent(strokePaint),
  });
  return { material, selector };
}

/**
 * Installs the §58 paint-object tier: after this call, `Shape2D` accepts
 * {@link LinearGradientPaint}, {@link RadialGradientPaint},
 * {@link ConicGradientPaint} and {@link PatternPaint} in `fill`/`stroke` on
 * shapes constructed without a `material`, and the §79 shape readers restore
 * the same forms from documents. Idempotent; call it once at startup, beside the
 * `registerNodeMaterialPipeline()` call that lets the backend *draw* what
 * this lets the author *say*.
 *
 * ```ts
 * import { registerShapePaints } from "@fourjs/render";
 * import { registerNodeMaterialPipeline } from "@fourjs/render-webgl";
 *
 * registerShapePaints();
 * registerNodeMaterialPipeline();
 * const sun = new Circle({
 *   radius: 1,
 *   fill: {
 *     kind: "radial-gradient",
 *     center: { x: 0, y: 0 },
 *     radius: 1,
 *     stops: [
 *       { offset: 0, color: [1, 0.9, 0.4, 1] },
 *       { offset: 1, color: [1, 0.4, 0, 1] },
 *     ],
 *   },
 * });
 * ```
 */
export function registerShapePaints(): void {
  setShapePaintSupport({ resolvePaint, plan });
}
