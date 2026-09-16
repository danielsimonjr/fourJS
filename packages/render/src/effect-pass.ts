/**
 * §70's post-processing at the **full-screen effect tier** (R-6, 2026-08-07):
 * one render target's colour attachment drawn over another surface through a
 * fragment shader, described here with no backend types at all.
 *
 * ```ts
 * const sceneColor = new RenderTarget({ width: 512, height: 512 });
 *
 * const graph = new RenderGraph();
 * graph.addPass("world", { root: scene, views, target: sceneColor });
 * graph.addPass(
 *   "grade",
 *   {
 *     kind: "effect",
 *     source: sceneColor.colorTexture,
 *     effect: { kind: "grade", exposure: 1.2, saturation: 0.8 },
 *   },
 *   { inputs: ["world"] },
 * );
 *
 * graph.execute(renderer, { poseBuffer: poses, alpha: time.interpolationAlpha });
 * ```
 *
 * ## An effect is a graph pass, not a second orchestration mechanism
 *
 * This is the whole architectural point, and it is a recorded instruction
 * (R-5, 2026-08-07): §63 already owns "which pass runs when, writing what,
 * sampling what", so §70 gets a **third pass kind** rather than an `effects`
 * array on `Viewport`, a post-processing manager, or a chain object. An
 * {@link EffectRenderPass} is added, named, enabled, ordered, validated and
 * described by exactly the machinery `RenderGraph` already has, and — like a
 * {@link SceneRenderPass} — it becomes **one
 * renderer call**, which is what keeps R-5's "the graph is a driver, not a
 * backend" property true with two verbs instead of one.
 *
 * ### Why a first-class kind and not a `CustomRenderPass`
 *
 * `CustomRenderPass` is the escape hatch, and R-5 made it *report its own
 * opacity*: every custom pass emits an `"opaque"` issue because the graph
 * cannot see what it samples. An effect pass is the opposite case. Its sample
 * is not hidden inside a closure — it is the {@link EffectRenderPass.source}
 * field, right there in the descriptor — so the graph can check it **exactly**,
 * with no traversal at all, where a scene pass needs a whole render list built
 * to discover the same thing. Expressing §70 through the escape hatch would
 * have made every effect chain unvalidatable precisely where the two mistakes
 * it invites live: sampling the surface you are writing (`"feedback"`) and
 * consuming a target a later pass produces (`"order"`). A third member of a
 * union that was already discriminated (`kind`) costs one branch in `execute`,
 * one in `validate`, one in `describe`, and buys back the checking.
 *
 * ## What "the minimal tier" covers, effect by effect (§70)
 *
 * §70 lists ten effects and one composition rule. The ones that need nothing
 * but the source texel are shipped — the blit, the colour grade, and (since
 * R-15, 2026-08-08) the sRGB half of §60a's output transform; the rest each
 * need a *resource* this renderer does not have yet, and are named with the
 * packet that brings it rather than approximated.
 *
 * | §70 requirement                     | this tier                                                                                                                                                                                                                              |
 * | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | tone mapping                        | **half shipped** (R-15, 2026-08-08) — §60a defines the output transform as tone mapping *followed by sRGB encoding*, and {@link OutputTransformEffect} ships the encoding half as §60a's final render-graph pass. The operator itself stays staged for the reason this row always gave: it compresses an HDR range onto 0…1, every surface here is `rgba8` (R-4's one-member `RenderTargetFormat`), and there is no range to compress. It lands as a *field on that effect* when float targets do. |
 * | color grading                       | **shipped** — {@link ColorGradeEffect}: exposure, contrast, saturation                                                                                                                                                                    |
 * | bloom                               | **staged** — a bright-pass plus a separable blur is three passes over half-resolution surfaces, i.e. §63's *transient target pool*, which R-5 staged for a stated reason (it needs a size/format key and a lifetime analysis)              |
 * | anti-aliasing                       | **staged** — FXAA/SMAA are neighbourhood filters and need the source's texel size and a luma pass; MSAA is a *target* capability (`renderbufferStorageMultisample` plus a resolve blit), staged on R-4                                     |
 * | depth of field                      | **staged** — needs samplable depth; a target's depth buffer here is a renderbuffer, and depth *textures* are staged with §69                                                                                                              |
 * | motion blur                         | **staged** — needs a velocity buffer, hence multiple render targets (staged on R-4) and previous-frame matrices                                                                                                                           |
 * | screen-space ambient occlusion      | **staged** — samplable depth *and* normals: MRT plus depth textures, both above                                                                                                                                                           |
 * | outlines and selection highlighting | **staged** — needs a §71 GPU identifier buffer, a depth/normal edge pass, or §67's stencil (R-7). Named in the gap analysis as R-6's most-wanted consumer, and honestly still blocked on one of those three                                |
 * | distortion                          | **staged** — a screen-space displacement samples a second input (a flow map or a normal buffer); a pass here carries exactly one {@link EffectRenderPass.source}                                                                           |
 * | custom full-screen passes           | **shipped** (RFC 0001, 2026-08-28) — {@link GraphEffect}: a §60 shader graph in the `"screen"` domain, as data. The union stays closed; it gained one member whose payload is itself a closed structure, so `{ kind: "bloom" }` is still a compile error. No user shader *source* exists at any tier — that is the RFC's decision, made binding by spec revision 1.11 |
 * | "composable per viewport"           | **shipped** — composition is per *pass*: a chain of effect passes ping-ponging between two targets composes freely, a per-viewport chain is expressible by giving each viewport its own target, and {@link EffectRenderPass.rect} confines one effect to a destination-pixel rectangle (omitted = full surface, today's default) |
 *
 * ## The closed union is the point, not a placeholder
 *
 * {@link ScreenEffect} is a discriminated union of named effects rather than a
 * `string` or a shader source, for the reason `RenderTargetFormat` is a
 * one-member union: `{ kind: "bloom" }` has to be a **compile error** while
 * bloom is staged, not a value that reaches a backend which quietly copies
 * instead. Every entry in the table above that says *staged* is therefore
 * unwritable, and the day one ships it is the day the union grows a member.
 *
 * ## Where an effect is validated (§85)
 *
 * At **setup**, by {@link RenderGraph.addPass}, through
 * {@link validateEffectRenderPass} — the same stance R-5 took for the graph's
 * resource checks, and for the same reason: a backend may not throw from inside
 * a frame (§61), and an effect's parameters do not change between the frames
 * that would be worth re-checking. An application that hand-writes
 * `renderer.renderEffect(pass)` without a graph bypasses that check exactly as
 * a hand-written `renderer.render` bypasses {@link RenderGraph.validate}, and
 * may call {@link validateEffectRenderPass} itself.
 */

import {
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  type ShaderGraph,
} from "@fourjs/materials";

import type { RenderTarget, RenderTargetTexture } from "./render-target.js";
import { isRenderTargetTexture } from "./render-target.js";

/**
 * A straight copy of the source texture — §70's blit, and the identity element
 * of an effect chain.
 *
 * The pass §63 calls "Final Composite" when nothing is being *changed*: an
 * off-screen frame put on screen, a ping-pong buffer moved, or the on-screen
 * debug view of an intermediate target that §63's "debug visualization" wants
 * and {@link RenderGraph.describe} could only print in text until now.
 *
 * Backends must make this **bit-exact**: same texels in, same texels out, with
 * no arithmetic between the sample and the fragment output (the WebGL 2 backend
 * does — its fragment stage assigns the sampled texel unchanged).
 */
export interface CopyEffect {
  /** Required, and the only value — the discriminant. */
  readonly kind: "copy";
}

/**
 * §70's "color grading": exposure, contrast, and saturation over the source,
 * in the order named here.
 *
 * ```ts
 * { kind: "grade", exposure: 1.2, contrast: 1.1, saturation: 0.85 }
 * ```
 *
 * Every field is optional and defaults to `1` — the *identity* value of its
 * operation — so `{ kind: "grade" }` is a copy with three multiplies, and a
 * grade that names one field leaves the other two exactly alone. See
 * {@link COLOR_GRADE_DEFAULTS}.
 *
 * ## What the numbers mean, precisely
 *
 * The pipeline is linear-light on the GPU backends (§60a), and these operate on
 * the values as stored — there is no perceptual curve in this tier, because the
 * output transform that would supply one is staged (see the module header).
 * Stated as arithmetic, per colour channel, with `a` untouched throughout:
 *
 * 1. **exposure** — `rgb *= exposure`. A linear-light scale, so `2` is one stop
 *    brighter, not "twice as bright" perceptually.
 * 2. **contrast** — `rgb = (rgb - 0.5) * contrast + 0.5`. The pivot is `0.5`
 *    *linear*, which is not perceptual mid-grey; the pivot moves to mid-grey
 *    when §60a's transform lands, and that is a deliberate difference recorded
 *    here rather than a rounding of it.
 * 3. **saturation** — `rgb = mix(vec3(luma), rgb, saturation)`, with `luma` the
 *    Rec. 709 linear-light weighted sum (`0.2126 R + 0.7152 G + 0.0722 B`);
 *    `0` is greyscale, `1` is unchanged, above `1` oversaturates.
 *
 * Nothing is clamped by the effect: the destination surface's format does the
 * clamping it does (`rgba8` saturates), and a float target — when R-4's format
 * union widens — will not. Alpha is never touched, so an effect pass over a
 * target with a transparent background composites afterwards exactly as the
 * source would have.
 */
export interface ColorGradeEffect {
  /** Required, and the only value — the discriminant. */
  readonly kind: "grade";

  /** Linear-light multiplier; defaults to `1`. Finite and `>= 0` (§85). */
  readonly exposure?: number;

  /** Contrast about a linear `0.5` pivot; defaults to `1`. Finite, `>= 0`. */
  readonly contrast?: number;

  /** `0` greyscale … `1` unchanged … above oversaturates. Finite, `>= 0`. */
  readonly saturation?: number;
}

/**
 * §60a's **output transform**: the linear-light source encoded as sRGB on the
 * way to a presentable surface (R-15, 2026-08-08).
 *
 * ```ts
 * graph.addPass("world", { root: scene, views, target: sceneColor });
 * graph.addPass(
 *   "present",
 *   { kind: "effect", source: sceneColor.colorTexture, effect: OUTPUT_TRANSFORM_EFFECT },
 *   { inputs: ["world"] },
 * );
 * ```
 *
 * ## Why this is a pass and not a step in every shader
 *
 * Because §60a says so, in one sentence: "the output transform — tone mapping
 * (§68) followed by sRGB encoding — **is the final render-graph pass** (§63)".
 * The alternative — an encode appended to the unlit, lit, standard, sprite and
 * particle fragment stages — would encode *five times* into one framebuffer,
 * make every blend between two draws happen in the wrong space, and multiply
 * the backend's shader variants by two. As a pass it runs exactly once, after
 * everything has been composited in linear light, which is the property that
 * makes the transform correct rather than merely present.
 *
 * ## Opt-in, and what that costs (the dated deviation)
 *
 * §60a describes the transform as *the* final pass, i.e. always present. Here
 * it is a pass an application **adds**, and a scene that does not add it renders
 * exactly the frame it rendered before this existed — byte-identical GL,
 * byte-identical pixels. That is deliberate (R-15, 2026-08-08): every scene,
 * example and pixel golden in this repository was authored against an untagged
 * pipeline whose *output* happened to be its working space, and an
 * on-by-default encode would relight all of them at once. Making it default is
 * an owner decision, and the honest sequence is: ship the transform, let a
 * scene opt in, move the goldens deliberately rather than as a side effect.
 *
 * ## Tone mapping is the half that is still staged
 *
 * §60a's transform is *tone mapping then encoding*, and this effect performs
 * the encoding only. The reason is unchanged from R-6 and is a resource, not a
 * preference: an operator compresses an HDR range onto 0…1, every surface in
 * this tier is `rgba8` (R-4's one-member {@link RenderTargetFormat}), and there
 * is no range to compress. When float targets land, tone mapping arrives as a
 * field on **this** effect — the two halves belong to one pass — rather than as
 * a sixth member of the union.
 *
 * ## What an `rgba8` intermediate costs, stated rather than hidden
 *
 * The source of this pass is a linear-light `rgba8` surface, so the frame is
 * quantized to 256 linear steps *before* it is encoded. sRGB spends more of its
 * code space on darks than linear does, so re-encoding an 8-bit linear buffer
 * can band in shadow gradients in a way a directly-encoded framebuffer would
 * not. The fix is a wider intermediate (`rgba16f`), which is the same staged
 * {@link RenderTargetFormat} widening tone mapping waits on — not a change to
 * this pass. Named here because it is the one visible difference between this
 * tier and a complete §60a pipeline.
 *
 * ## The arithmetic, exactly
 *
 * Per colour channel, `@fourjs/math`'s `linearToSrgb`: the IEC 61966-2-1
 * piecewise curve, odd-extended below zero. **Alpha is not encoded** — it is a
 * coverage fraction, not a light quantity — which is the same rule
 * `srgbToLinearRGBA` follows on the way in. Nothing is clamped by the effect;
 * the `rgba8` destination saturates on write, as it does for a grade.
 */
export interface OutputTransformEffect {
  /** Required, and the only value — the discriminant. */
  readonly kind: "output-transform";
}

/**
 * A shared, frozen {@link OutputTransformEffect} — the effect has no parameters
 * (tone mapping is staged; see its documentation), so one instance serves every
 * pass and presenting a frame allocates nothing.
 */
export const OUTPUT_TRANSFORM_EFFECT: OutputTransformEffect = Object.freeze({
  kind: "output-transform",
});

/**
 * §70's "custom full-screen passes", **as data** (§60; RFC 0001, R-14) — a
 * shader graph in the `"screen"` domain over the pass's declared inputs.
 *
 * ```ts
 * const screen = new ShaderGraphBuilder("screen");
 * const texel = screen.sampler("source");
 * screen.output.color = texel.multiply(screen.uniform("gain", "float"));
 * graph.addPass("warm", {
 *   kind: "effect",
 *   source: sceneColor.colorTexture,
 *   effect: { kind: "graph", graph: screen.graph(), uniforms: { gain: 1.2 } },
 * });
 * ```
 *
 * ## The graph keeps the pass checkable — the whole point
 *
 * A `texture` node names its sampler, and every name resolves against the
 * pass's declared inputs: `"source"` is {@link EffectRenderPass.source}, and
 * any other name must appear in {@link GraphEffect.textures}. **Every texture
 * a graph samples is therefore enumerable from the pass**, which is what lets
 * `RenderGraph.validate()` run its feedback and ordering checks over a graph
 * effect exactly as over a built-in one — so a `GraphEffect` pass does *not*
 * emit the `"opaque"` info issue a `CustomRenderPass` does. That asymmetry is
 * R-5/R-6's recorded principle applied in the affirmative: the escape hatch
 * reports its opacity because the graph cannot see inside it; a node graph
 * does not, because the graph can. A shader *source string* is what would
 * have destroyed this, and none exists at any tier (§96; RFC 0001).
 *
 * The graph must be `"screen"`-domain: it may read `"uv"` (the pass's own
 * normalized coordinate), `uniform` nodes (valued per pass, below), `texture`
 * nodes, and `time` (§9 render time) — and nothing of a mesh, which a
 * full-screen pass does not have.
 */
export interface GraphEffect {
  /** Required, and the only value — the discriminant. */
  readonly kind: "graph";

  /** The `"screen"`-domain §60 graph — validated at `addPass` (§85). */
  readonly graph: ShaderGraph;

  /**
   * Values for the graph's `uniform` nodes, by name — the per-pass analogue
   * of `NodeMaterial.setUniform`. Optional per uniform: an unset uniform
   * reads as zeroes on every backend (GL's own initial value). Validated
   * against the graph's reflection at `addPass` (§85).
   */
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;

  /**
   * Additional sampled inputs, by the sampler names the graph uses —
   * `EffectRenderPass.source` carries exactly one surface, and it is bound to
   * the graph's `"source"` sampler; a graph naming more declares each here,
   * which is precisely what keeps the pass's full sample set visible to
   * `RenderGraph.validate()`.
   */
  readonly textures?: Readonly<Record<string, RenderTargetTexture>>;
}

/**
 * One §70 effect, as a closed discriminated union — see the module header for
 * why it is closed and what widening it means.
 */
export type ScreenEffect =
  CopyEffect | ColorGradeEffect | OutputTransformEffect | GraphEffect;

/** {@link ScreenEffect}'s discriminant, for a caller switching over it. */
export type ScreenEffectKind = ScreenEffect["kind"];

/**
 * The value every omitted {@link ColorGradeEffect} field takes: `1`, the
 * identity of each of the three operations.
 *
 * Exported and frozen so a backend, a test, and a tool all read the same
 * numbers rather than each writing `?? 1` and hoping. A backend applies these
 * itself — the descriptor is handed to it as the application wrote it, never
 * normalized in between, so nothing allocates per frame.
 */
export const COLOR_GRADE_DEFAULTS: {
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
} = Object.freeze({ exposure: 1, contrast: 1, saturation: 1 });

/**
 * A shared, frozen {@link CopyEffect} — the effect has no parameters, so one
 * instance serves every pass and a blit allocates nothing.
 *
 * ```ts
 * graph.addPass("present", {
 *   kind: "effect",
 *   source: sceneColor.colorTexture,
 *   effect: COPY_EFFECT,
 * });
 * ```
 */
export const COPY_EFFECT: CopyEffect = Object.freeze({ kind: "copy" });

/**
 * §70's full-screen effect, as a {@link RenderGraph} pass and as the argument
 * of {@link Renderer.renderEffect} (R-6).
 *
 * One object serves both because the graph *forwards it unchanged* — R-5's
 * "one pass, one renderer call", kept literal. That is also why the
 * destination lives on the pass rather than being a separate argument the way
 * `Renderer.render`'s `target` is: a pass is a complete description of one
 * step, and a hand-written call needs no argument order to remember.
 *
 * ## What it draws
 *
 * The whole of the destination surface — the target's full size, or the
 * drawing buffer's — with no depth test, no blending, and no clear: an effect
 * *replaces* what the destination held rather than compositing over it, which
 * is what makes a chain of them predictable. Viewport rectangles do not appear
 * here; see the module header's note on §70's "composable per viewport".
 *
 * ## What it refuses
 *
 * Drawing into the surface it samples is a read-write feedback loop on one
 * surface — undefined behaviour on every backend. R-4's rule applies unchanged:
 * the *draw* is refused rather than attempted, {@link RenderGraph.validate}
 * reports it statically as `"feedback"`, and ping-pong between two targets is
 * the supported form. A disposed source or destination is skipped for the same
 * reason a disposed texture is (§83).
 */
/**
 * Destination-pixel rectangle for an {@link EffectRenderPass} (R-6 follow-up).
 *
 * Origin is the destination surface's bottom-left, +Y up (§7a), in the
 * surface's own pixels — a render target's width/height, or the drawing
 * buffer when the pass has no `target`. Omitted on the pass means the
 * whole destination, which is the pre-follow-up behaviour.
 */
export interface EffectDestinationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EffectRenderPass {
  /** Required, and the only value — this is the discriminant. */
  readonly kind: "effect";

  /**
   * The surface to sample: a {@link RenderTarget}'s
   * `colorTexture`.
   *
   * Typed as {@link RenderTargetTexture}
   * rather than as a `RenderTarget` because it is a *texture* the pass reads,
   * and because that is the type R-4 made assignable to every material slot —
   * so the same expression feeds an effect pass and a textured quad, and the
   * day a target grows several colour attachments the source names which one.
   */
  readonly source: RenderTargetTexture;

  /** Which §70 effect to apply. {@link COPY_EFFECT} is the blit. */
  readonly effect: ScreenEffect;

  /**
   * Where to draw, or absent/`null` for the backend's default drawing buffer.
   * The last pass of a chain usually has none — that is the pass that puts the
   * post-processed frame on screen.
   */
  readonly target?: RenderTarget | null;

  /**
   * Optional destination-pixel rectangle (R-6 follow-up). Omitted or
   * `undefined` covers the whole destination — today's default, so a graph
   * that never names a rectangle stays transcript-identical. See
   * {@link EffectDestinationRect}.
   */
  readonly rect?: EffectDestinationRect;
}

/**
 * A renderer that can draw §70 effect passes — the structural capability
 * (R-6).
 *
 * Written as its own interface, and as an **optional** member of
 * {@link Renderer}, for the reasons `statistics.ts`
 * gives for `RenderStatisticsReporter`: adding a required member to a published
 * interface breaks every implementor, and a backend with no shader stage to run
 * an effect in (§62's SVG tier draws DOM nodes) should be able to say so by
 * omission rather than by silently copying.
 */
export interface ScreenEffectRenderer {
  /**
   * Draws `pass` — see {@link EffectRenderPass} for what that means and what it
   * refuses.
   *
   * Bound by the same three rules `Renderer.render` is: the destination is
   * bound for the call and unbound before it returns even if the call throws,
   * nothing is left bound behind, and a lost context, a disposed surface or an
   * allocation the device refused **skips the effect** rather than throwing
   * (§61).
   */
  renderEffect(pass: EffectRenderPass): void;
}

/**
 * Whether `renderer` can draw §70 effect passes, narrowing it so
 * {@link ScreenEffectRenderer.renderEffect} can be called.
 *
 * A property test rather than an `instanceof`: backends are separate packages
 * and `@fourjs/render` must not name any of them (§61) — the same duck-typed
 * discipline as {@link supportsRenderStatistics}, `isParticleDrawable`, and
 * `isRenderTargetTexture`. {@link RenderGraph.execute} uses it to fail loudly
 * on the first frame instead of drawing nothing forever.
 */
export function supportsScreenEffects<TRenderer extends object>(
  renderer: TRenderer,
): renderer is TRenderer & ScreenEffectRenderer {
  return (
    typeof (renderer as Partial<ScreenEffectRenderer>).renderEffect ===
    "function"
  );
}

/** §85 check for {@link EffectRenderPass.rect}. Throws on a bad value. */
function validateDestinationRect(
  rect: EffectDestinationRect | undefined,
): void {
  if (rect === undefined) {
    return;
  }
  validateRectComponent("rect.x", rect.x);
  validateRectComponent("rect.y", rect.y);
  validateRectComponent("rect.width", rect.width);
  validateRectComponent("rect.height", rect.height);
  if (rect.width < 0 || rect.height < 0) {
    throw new RangeError(
      "EffectRenderPass rect width and height must be >= 0 (§70, §85).",
    );
  }
}

function validateRectComponent(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `EffectRenderPass ${name} must be a finite number; got ${value} (§70, §85).`,
    );
  }
}

/** Runs the §85 check for one grading coefficient. Throws on a bad value. */
function validateCoefficient(name: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `ColorGradeEffect ${name} must be a finite number of at least 0; got ` +
        `${String(value)} (§70, §85).`,
    );
  }
}

/**
 * Runs the §60a checks for an output-transform pass: what it reads must be
 * linear, and what it writes must not already be encoded.
 *
 * This is the whole reason §60a's colour-space metadata exists on a render
 * target. Both mistakes it catches are invisible in code review and unmistakable
 * on screen — a double encode washes the frame out, and encoding an already-sRGB
 * source encodes it twice — and both are *setup*-time facts about which surfaces
 * the graph wired together, which is exactly what {@link RenderGraph.addPass}
 * can check before a frame runs.
 *
 * The default drawing buffer (`target` absent or `null`) is sRGB by definition —
 * a browser presents it as sRGB — so it is the expected destination and passes.
 */
function validateOutputTransform(pass: EffectRenderPass): void {
  const source = pass.source.renderTarget;
  if (source.colorSpace !== "linear") {
    throw new RangeError(
      "An output-transform effect encodes a linear-light source, but its " +
        `source render target is tagged ${JSON.stringify(source.colorSpace)}; ` +
        "encoding it again would double-encode the frame (§60a, §85).",
    );
  }
  const destination = pass.target ?? null;
  if (destination !== null && destination.colorSpace !== "srgb") {
    throw new RangeError(
      "An output-transform effect writes sRGB-encoded texels, but its " +
        `destination render target is tagged ` +
        `${JSON.stringify(destination.colorSpace)}; tag it ` +
        '`colorSpace: "srgb"`, or present to the drawing buffer by leaving ' +
        "the pass's target absent (§60a, §85).",
    );
  }
}

/**
 * Runs the §60/§85 checks for a {@link GraphEffect} pass: the graph is a
 * valid `"screen"`-domain graph, every sampler it reaches is a declared input
 * of the pass, every declared input is really a render-target texture (and is
 * actually sampled), and every supplied uniform value names a reachable
 * uniform with the right shape. Setup-time, like every other check here — a
 * backend never validates inside a frame (§61) and skips, rather than draws,
 * anything this would have refused.
 */
function validateGraphEffect(effect: GraphEffect): void {
  const graph = effect.graph;
  if (graph.domain !== "screen") {
    throw new RangeError(
      `A GraphEffect's graph must be "screen"-domain; got ` +
        `${JSON.stringify(graph.domain)} — a full-screen pass has no mesh ` +
        "(§60, §70, §85).",
    );
  }
  // Throws on any §60 IR violation; what remains is the pass wiring.
  const reflection = analyzeShaderGraph(graph).reflection;

  const declared = effect.textures ?? {};
  const sampled = new Set<string>();
  for (const texture of reflection.textures) {
    sampled.add(texture.name);
    if (texture.name === "source") {
      continue;
    }
    const input = declared[texture.name];
    if (input === undefined) {
      throw new RangeError(
        `GraphEffect samples ${JSON.stringify(texture.name)}, which the pass ` +
          'does not declare; "source" is the pass\'s source and every other ' +
          "sampler needs an entry in effect.textures (§60, §70, §85).",
      );
    }
    if (!isRenderTargetTexture(input)) {
      throw new RangeError(
        `GraphEffect input ${JSON.stringify(texture.name)} must be a ` +
          "RenderTarget's colorTexture (§70, §85).",
      );
    }
  }
  // Sorted so the first refusal is a deterministic function of the pass, not
  // of a record's key order (§33).
  for (const name of Object.keys(declared).sort()) {
    if (!sampled.has(name)) {
      throw new RangeError(
        `GraphEffect declares texture ${JSON.stringify(name)}, which the ` +
          "graph never samples — an input nothing reads is an authoring " +
          "mistake, not head-room (§85).",
      );
    }
  }

  const uniforms = effect.uniforms ?? {};
  const uniformTypes = new Map(
    reflection.uniforms.map((uniform) => [uniform.name, uniform.type] as const),
  );
  for (const name of Object.keys(uniforms).sort()) {
    const type = uniformTypes.get(name);
    if (type === undefined) {
      throw new RangeError(
        `GraphEffect values uniform ${JSON.stringify(name)}, which the graph ` +
          "does not (reachably) declare (§60, §85).",
      );
    }
    const value = uniforms[name];
    const components = SHADER_VALUE_COMPONENTS[type];
    if (typeof value === "number") {
      if (components !== 1) {
        throw new RangeError(
          `GraphEffect uniform ${JSON.stringify(name)} is a ${type}; a ` +
            "single number only fits a float (§85).",
        );
      }
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `GraphEffect uniform ${JSON.stringify(name)} must be finite; got ` +
            `${String(value)} (§85).`,
        );
      }
      continue;
    }
    if (value.length !== components) {
      throw new RangeError(
        `GraphEffect uniform ${JSON.stringify(name)} is a ${type} and needs ` +
          `${String(components)} components; got ${String(value.length)} (§85).`,
      );
    }
    for (const component of value) {
      if (!Number.isFinite(component)) {
        throw new RangeError(
          `GraphEffect uniform ${JSON.stringify(name)} components must be ` +
            `finite; got ${String(component)} (§85).`,
        );
      }
    }
  }
}

/**
 * Checks an {@link EffectRenderPass} against §85, throwing a `RangeError` on
 * the first violation and returning nothing when the pass is well formed.
 *
 * Called by {@link RenderGraph.addPass} for every effect pass, which is where
 * an application normally meets it; exported because an application that hand
 * -writes `renderer.renderEffect` has no graph to do it (module header).
 *
 * Five things are checked, and deliberately nothing else:
 *
 * 1. **`source` really is a render-target texture** — the marker guard, not the
 *    type, because a JavaScript caller can hand over anything and a backend
 *    that met a plain `Texture` here would silently draw a black screen;
 * 2. **`effect.kind` is a member of the closed union** — a value TypeScript
 *    would have rejected, arriving from JSON or from JavaScript;
 * 3. **each declared grading coefficient is finite and non-negative** — a
 *    `NaN` reaching a `uniform3fv` produces an entire black frame with no
 *    error anywhere, which is the failure this function exists to prevent;
 * 4. **an output-transform pass reads linear and writes sRGB** — §60a's
 *    colour-space metadata, checked where a double encode is still a wiring
 *    mistake rather than a washed-out frame;
 * 5. **`rect`, when named, is finite and non-negative in width/height** — a
 *    `NaN` scissor is a GL error and a negative extent is clamped-to-empty
 *    at draw time; refusing here keeps the mistake at setup.
 *
 * Not checked: whether the source is disposed, and whether it is the same
 * surface as `target`. Both are *frame*-time facts (a target may be disposed
 * long after the pass was added), both are already handled where they belong —
 * {@link RenderGraph.validate} reports the second statically as `"feedback"`
 * and every backend refuses both at draw time (§83, R-4).
 */
export function validateEffectRenderPass(pass: EffectRenderPass): void {
  if (!isRenderTargetTexture(pass.source)) {
    throw new RangeError(
      "EffectRenderPass source must be a RenderTarget's colorTexture; got " +
        `${typeof pass.source} (§70, §85).`,
    );
  }
  validateDestinationRect(pass.rect);
  const effect = pass.effect;
  switch (effect.kind) {
    case "copy":
      return;
    case "grade":
      validateCoefficient("exposure", effect.exposure);
      validateCoefficient("contrast", effect.contrast);
      validateCoefficient("saturation", effect.saturation);
      return;
    case "output-transform":
      validateOutputTransform(pass);
      return;
    case "graph":
      validateGraphEffect(effect);
      return;
    default:
      throw new RangeError(
        `Unknown ScreenEffect kind ${JSON.stringify(
          (effect as { kind: unknown }).kind,
        )}; this tier ships "copy", "grade", "output-transform" and "graph" ` +
          "(§70, §60, §60a, §85).",
      );
  }
}
