import { CanvasTexture } from "./raster.js";
/**
 * `RenderGraph` (§63) — an ordered list of passes, executed by one call, with
 * the dependency between "a pass writes a target" and "a later pass samples it"
 * checked rather than assumed.
 *
 * ```ts
 * const scenePass = new RenderTarget({ width: 512, height: 512 });
 *
 * const graph = new RenderGraph();
 * graph.addPass("world", { root: scene, views: [mirrorView], target: scenePass });
 * graph.addPass("composite", { root: scene, views: [mainView] }, { inputs: ["world"] });
 *
 * // Once, at setup — and in tests:
 * expect(graph.validate()).toEqual([]);
 *
 * // Per frame, in place of the two `renderer.render` calls:
 * graph.execute(renderer, { poseBuffer: poses, alpha: time.interpolationAlpha });
 * ```
 *
 * ## What this tier is, and what it deliberately is not (decision, R-5, 2026-08-07)
 *
 * §63 asks for "a directed acyclic graph of passes and resources" managing
 * seven things: pass dependencies, transient render targets, resource lifetime,
 * barriers and state transitions, pass enable/disable, viewport-specific
 * pipelines, and debug visualization. This module ships the **linear-pass
 * tier**: the passes are an ordered list, each pass is exactly one
 * `renderer.render(root, views, interpolation, target)` call over R-4's seam,
 * and dependencies are *validated* against that order instead of being used to
 * derive it. Concretely:
 *
 * | §63 requirement                | this tier                                                              |
 * | ------------------------------ | ---------------------------------------------------------------------- |
 * | pass dependencies              | **shipped** — declared `inputs`, plus the sampled-target check in {@link RenderGraph.validate} |
 * | pass enable/disable            | **shipped** — {@link RenderGraph.setPassEnabled}                        |
 * | viewport-specific pipelines    | **shipped** — every pass carries its own `views`                        |
 * | debug visualization            | **partial** — {@link RenderGraph.describe} is textual. §63 also wants the pass outputs *on screen*, which needed §70's full-screen blit; R-6 shipped it, so an on-screen view of any intermediate target is now one `{ kind: "effect", source, effect: COPY_EFFECT }` pass. Building that view — a viewport-tiled inspector — is this module's remaining follow-up, not a missing capability |
 * | transient render targets       | **shipped** (W6.1, 2026-11-04) — {@link AddPassOptions.transient}: a pass declares a size/format/depth instead of passing a `RenderTarget`; slots come from a backend-owned {@link TransientTargetPool}, aliased by first-fit over lifetimes (`transient-pool.ts`). Application-owned targets are untouched |
 * | resource lifetime              | **shipped** (W6.1) — a transient lives from its producing pass to the last pass naming it in `inputs`; slots persist across frames and are released by {@link RenderGraph.dispose}; pooled bytes are `RenderTarget.byteLength`s, so §83 already counts them |
 * | barriers and state transitions | **shipped** (W6.1) — {@link RenderGraph.usageTransitions} derives the per-target texture/attachment list; WebGPU consults it for slot usage flags (and its passes already end/begin at every transition), WebGL 2 emits nothing and only asserts in DEV that no target is sampled while attached |
 *
 * Two reasons the linear tier is the honest stopping point rather than a
 * shortcut. First, a topological sort over declared `inputs` would produce an
 * order the author cannot see, and §63's own example is already written in
 * execution order — so the sort would buy reordering nobody asked for and cost
 * the property that "the graph does what the list says". Second, transient
 * targets and barriers are both *backend* facts (a pool needs the allocator, a
 * barrier needs an API that has them), and this package is backend-free by
 * §98's assignment; building them here would mean guessing at both.
 *
 * ## The escape hatch, and why it is honest
 *
 * A {@link CustomRenderPass} hands the pass the {@link Renderer} and gets out of
 * the way — that is the seam for anything the declarative shape cannot say (a
 * pass that renders one view per target, a backend-specific trick, a chain
 * whose shape is computed per frame). §70's full-screen effects deliberately do
 * *not* go through it: they are a declarative pass kind of their own
 * ({@link EffectRenderPass}, R-6), because a pass whose sampling is stated in a
 * field can be checked, and one hidden behind a closure cannot — `effect-pass.ts`
 * argues that where the type lives. The graph does **not** pretend to
 * understand a custom pass:
 * {@link RenderGraph.validate} reports every custom pass as an `"opaque"` issue,
 * so a graph that silently stopped being checkable says so out loud instead of
 * reporting a clean bill of health it did not earn.
 *
 * ## Nothing here changes what a frame draws
 *
 * The graph is a driver, not a backend. A pass produces exactly the GL a
 * hand-written `renderer.render` with the same four arguments produces, in the
 * same order, and an application that never constructs a `RenderGraph` never
 * loads this module (it is a separate file with no side effects, so it
 * tree-shakes out). `tests/integration/render-graph.test.ts` asserts the first
 * half against a recording GL context, call for call.
 *
 * ## Sampling is discovered, not declared
 *
 * {@link RenderGraph.validate} finds what a pass *actually samples* by building
 * the pass's render list and looking for {@link isRenderTargetTexture} textures
 * on the materials — the same marker the WebGL backend reads to decide between
 * "bind the framebuffer" and "upload these texels", so the check sees exactly
 * what the backend will. That is a scene traversal per pass, which is why it is
 * a method you call at setup rather than a tax `execute` pays every frame: a
 * material's `map` can be reassigned between any two frames, so a cached result
 * would be unsound and a per-frame result would double the traversal cost of
 * every pass in the graph. Two consequences worth stating:
 *
 * 1. an invisible or disabled node contributes no render item, so a mirror
 *    toggled off is not reported until it is toggled back on;
 * 2. `validate()` reasons about the **enabled** passes only, because a disabled
 *    pass writes nothing this frame — which is precisely why a consumer of its
 *    target is reported as sampling an `"unwritten"` surface.
 */

import { FourError } from "@fourjs/core";
import type { Node, Viewport } from "@fourjs/scene";

import {
  supportsScreenEffects,
  validateEffectRenderPass,
  type EffectRenderPass,
} from "./effect-pass.js";
import { buildRenderList, type RenderItem } from "./render-list.js";
import { isRenderTargetTexture, type RenderTarget } from "./render-target.js";
import { renderTargetByteLength } from "./render-target-bytes.js";
import type { RenderInterpolation, Renderer } from "./renderer.js";
import {
  RenderTargetPool,
  planTransientSlots,
  resolveTransientSpec,
  transientKeyString,
  type PassUsageRecord,
  type TransientRequest,
  type TransientSlot,
  type TransientTargetPool,
  type TransientTargetSpec,
  type UsageTransition,
} from "./transient-pool.js";

/**
 * The §89 code every structural failure in this module carries.
 *
 * `INVALID_RENDER_GRAPH` (R-5 follow-up, 2026-08-30). A duplicate pass name,
 * an unknown input, a removal that would orphan a consumer, and an execute of
 * an effect pass on a backend that has no `renderEffect` are all "the
 * application asked for a graph that cannot exist". The dedicated code lets a
 * host tell a graph authoring mistake from a lifecycle one without parsing
 * the message; §89's union lives in `@fourjs/core` (`errors.ts`) and this is
 * the packet that named the gap.
 */
const GRAPH_ERROR_CODE = "INVALID_RENDER_GRAPH";

/**
 * What a {@link CustomRenderPass} is handed besides the renderer.
 *
 * Deliberately small: a pass that needs more should close over it. The record
 * is **rebuilt per pass per frame**, so retaining it is safe but pointless —
 * `interpolation` inside it is the caller's per-frame scratch record and obeys
 * the same read-during-the-call rule {@link RenderInterpolation} states.
 */
export interface RenderPassContext {
  /** The name this pass was added under. */
  readonly name: string;

  /** The graph executing it, so a pass can reach its siblings' targets. */
  readonly graph: RenderGraph;

  /**
   * The §43 interpolation record for this frame, or `undefined` when the
   * caller passed none — forward it to `renderer.render` unchanged, or a
   * hand-written pass silently renders un-interpolated poses beside
   * interpolated ones.
   */
  readonly interpolation: RenderInterpolation | undefined;

  /** The pass's transient surface, or `null` when it declared none. */
  readonly target: RenderTarget | null;
}

/**
 * A pass the graph can drive itself: one `renderer.render` call (§63, §64).
 *
 * The three fields are R-4's `render` arguments minus the interpolation record,
 * which belongs to the frame rather than to the pass and is therefore supplied
 * by {@link RenderGraph.execute}. **Clear policy is not here** — it lives on
 * each `Viewport` (`clearColor`, §48), which is also what makes a compositing
 * pass expressible: a view with no `clearColor` draws over what an earlier pass
 * left in the same surface.
 */
export interface SceneRenderPass {
  /**
   * Present and `"scene"`, or absent — this is the default form. The
   * discriminant exists so {@link CustomRenderPass} can be told apart without a
   * structural guess.
   */
  readonly kind?: "scene";

  /** Subtree to draw; usually the `Scene` (§64 builds a list from any root). */
  readonly root: Node;

  /**
   * Views to draw it through, in order (§48) — this is §63's "viewport-specific
   * pipelines" at this tier: two passes over the same root with different views
   * are two pipelines.
   */
  readonly views: readonly Viewport[];

  /**
   * Off-screen surface to draw into (R-4), or absent/`null` for the backend's
   * default drawing buffer. A pass with no target is a screen pass; §63's
   * "Final Composite" is the usual one.
   */
  readonly target?: RenderTarget | null;
}

/**
 * A pass that drives the renderer itself — the escape hatch (see the module
 * header).
 *
 * ```ts
 * graph.addPass("ping-pong", {
 *   kind: "custom",
 *   target: back,
 *   execute: (renderer, context) => {
 *     renderer.render(scene, [view], context.interpolation, front);
 *     renderer.render(scene, [view], context.interpolation, back);
 *   },
 * });
 * ```
 *
 * Declaring {@link CustomRenderPass.target} is optional but recommended: it is
 * what lets a *later* pass's sampling of that surface be validated, and what
 * {@link RenderGraph.describe} prints. Nothing enforces that the function
 * actually writes it — the graph cannot see inside, which is exactly what the
 * `"opaque"` validation issue says.
 */
export interface CustomRenderPass {
  /** Required, and the only value — this is the discriminant. */
  readonly kind: "custom";

  /**
   * Runs the pass. Called once per {@link RenderGraph.execute} while the pass
   * is enabled, with the graph's renderer and the frame's context.
   */
  readonly execute: (renderer: Renderer, context: RenderPassContext) => void;

  /**
   * The surface this pass is *declared* to write, for validation and
   * {@link RenderGraph.describe}. Absent means "the screen, or unknown".
   */
  readonly target?: RenderTarget | null;
}

/**
 * One pass of a {@link RenderGraph} (§63): a scene draw, a §70 full-screen
 * effect, or the escape hatch.
 *
 * The first two are **declarative** — the graph knows what they write and what
 * they sample, and drives each as exactly one renderer call. The third is
 * opaque by construction, and says so (see {@link CustomRenderPass}).
 * `effect-pass.ts` records why §70 became a member of this union rather than a
 * mechanism beside it.
 */
export type RenderPass = SceneRenderPass | EffectRenderPass | CustomRenderPass;

/** Extras for {@link RenderGraph.addPass} — §63's `{ inputs: [...] }`. */
export interface AddPassOptions {
  /**
   * Names of passes this one consumes, exactly as §63 writes them
   * (`graph.addPass("bloom", bloomPass, { inputs: ["world"] })`).
   *
   * Every name must already have been added, which is what makes a cycle and a
   * forward reference *unconstructable* rather than merely diagnosed — the list
   * is in execution order, so "already added" and "runs earlier" are the same
   * statement. Removing a pass another pass names is refused for the same
   * reason.
   *
   * Inputs are a **declaration of intent**: they document the graph, they gate
   * removal, and they print in {@link RenderGraph.describe}. What a pass really
   * samples is discovered by {@link RenderGraph.validate}, which is why a
   * correct `inputs` list does not by itself make a graph valid — and why an
   * absent one does not make it invalid.
   */
  readonly inputs?: readonly string[];

  /**
   * Whether the pass runs. Defaults to `true`; see
   * {@link RenderGraph.setPassEnabled} for §63's enable/disable.
   */
  readonly enabled?: boolean;

  /**
   * Declares a **transient** output (§63): the graph, not the application,
   * owns the surface this pass draws into. Mutually exclusive with the pass's
   * own `target`. Read the physical surface with
   * {@link RenderGraph.transientTarget} after {@link RenderGraph.compile}.
   */
  readonly transient?: TransientTargetSpec;

  /**
   * For an effect pass: name of an earlier pass whose transient output is
   * this effect's source. Must also appear in `inputs`. The pass's own
   * `source` is then ignored (supply any {@link RenderTargetTexture}); the
   * graph substitutes the slot's colour texture at execute time.
   */
  readonly sourceTransient?: string;
}

/**
 * A pass as the graph holds it: the pass, the name it was added under, its
 * declared inputs, and whether it runs (§63).
 *
 * `enabled` is readonly here on purpose — {@link RenderGraph.setPassEnabled} is
 * the one way to change it, so an unknown pass name is an error instead of a
 * silent write to an object that was never in the graph.
 */
export interface RenderGraphPass {
  /** Name this pass was added under; unique within the graph. */
  readonly name: string;

  /** The pass itself, as the caller supplied it (not copied). */
  readonly pass: RenderPass;

  /** Names given as {@link AddPassOptions.inputs}; empty when none were. */
  readonly inputs: readonly string[];

  /** Whether {@link RenderGraph.execute} runs it. */
  readonly enabled: boolean;

  /** The declared transient output, or `undefined`. */
  readonly transient: TransientTargetSpec | undefined;
}

/** Mutable form of {@link RenderGraphPass}; never leaves this module. */
interface MutableGraphPass {
  readonly name: string;
  readonly pass: RenderPass;
  readonly inputs: readonly string[];
  readonly transient: TransientTargetSpec | undefined;
  readonly sourceTransient: string | undefined;
  enabled: boolean;
}

/** A compiled transient plan, valid for one (structure, renderer, size). */
interface CompiledPlan {
  readonly version: number;
  readonly renderer: Renderer;
  readonly width: number;
  readonly height: number;
  readonly pool: TransientTargetPool;
  readonly slots: readonly TransientSlot[];
  readonly slotTargets: readonly RenderTarget[];
  readonly byName: ReadonlyMap<string, RenderTarget>;
  readonly records: readonly PassUsageRecord[];
}

/** Public view of {@link RenderGraph.compile}. */
export interface TransientPlan {
  readonly slots: readonly TransientSlot[];
  /** Transient name to physical slot index. */
  readonly assignment: ReadonlyMap<string, number>;
  /** Bytes of the physical slots (what the pool holds for this graph). */
  readonly byteLength: number;
  /** Bytes the same transients would cost without aliasing. */
  readonly unaliasedByteLength: number;
}

/**
 * What {@link RenderGraph.validate} can find (§63's "pass dependencies").
 *
 * String literals rather than an enum, matching `RendererBackend` and
 * `TransformAuthority`: they serialize, log, and compare as themselves.
 *
 * - `"feedback"` — the pass samples the target it is drawing into. Reading and
 *   writing one surface in a single pass is undefined behaviour on every
 *   backend, so R-4's rule is that the *sample* is refused rather than
 *   attempted; what the author gets instead depends on the pipeline (the WebGL
 *   backend drops a sprite draw entirely, and draws a surface material
 *   untextured), and in no case is it the picture that was authored. Ping-pong
 *   between two targets.
 * - `"order"` — the pass samples a target that only a **later** enabled pass
 *   writes. The frame draws stale contents: whatever the previous frame left,
 *   or transparent black on the first one. This is the inter-pass rule the
 *   graph exists to enforce; move the producer earlier.
 * - `"unwritten"` — the pass samples a target **no** enabled pass writes.
 *   Either the producer is missing, or it is disabled (§63's enable/disable
 *   toggled a producer off but not its consumer). A warning rather than an
 *   error: the first frame of a ping-pong legitimately samples an
 *   uninitialised target, which R-4 defines as transparent black.
 * - `"opaque"` — the pass is a {@link CustomRenderPass}; the graph cannot see
 *   what it samples and has skipped every resource check for it. Informational,
 *   and the reason an all-custom graph does not get to report zero issues.
 */
export type RenderGraphIssueCode =
  "feedback" | "order" | "unwritten" | "opaque";

/** How much a {@link RenderGraphIssue} matters. */
export type RenderGraphIssueSeverity = "error" | "warning" | "info";

/**
 * One finding from {@link RenderGraph.validate}.
 *
 * Structured rather than a string so a test can assert on the code and a tool
 * can group by pass; `message` is for humans and its exact wording is not a
 * contract.
 */
export interface RenderGraphIssue {
  /** What was found. */
  readonly code: RenderGraphIssueCode;

  /** Severity: `"error"` for `"feedback"`/`"order"`, `"warning"` for
   * `"unwritten"`, `"info"` for `"opaque"`. */
  readonly severity: RenderGraphIssueSeverity;

  /** Name of the pass the finding is about — the *consumer*, when there is one. */
  readonly pass: string;

  /**
   * Name of the pass that writes the target, or `null` when none does
   * (`"unwritten"`) or the finding is not about a target (`"opaque"`).
   */
  readonly producer: string | null;

  /** The surface concerned, or `null` for `"opaque"`. */
  readonly target: RenderTarget | null;

  /** Human-readable explanation. Wording is not part of the contract. */
  readonly message: string;
}

/** The target a pass writes, whichever form it is. */
function targetOf(pass: RenderPass): RenderTarget | null {
  return pass.target ?? null;
}

/** True for the escape-hatch form; narrows the union. */
function isCustomPass(pass: RenderPass): pass is CustomRenderPass {
  return pass.kind === "custom";
}

/** True for §70's full-screen effect form (R-6); narrows the union. */
function isEffectPass(pass: RenderPass): pass is EffectRenderPass {
  return pass.kind === "effect";
}

/**
 * Adds every render target `root`'s subtree samples to `out`.
 *
 * Uses the real {@link buildRenderList}, not a bespoke walk, so the traversal
 * filtering (visibility, enablement, drawability) is exactly the one the frame
 * will use — a check that disagreed with the render list would report on draws
 * that never happen and miss ones that do.
 */
function collectSampledTargets(root: Node, out: Set<RenderTarget>): void {
  const items: RenderItem[] = [];
  buildRenderList(root, items);
  for (const item of items) {
    // A particle item has no material at all (§36 puts colour on the
    // particle) and samples nothing.
    if (item.kind === "particles") {
      continue;
    }
    // §60's node materials sample by name, several at a time, and their whole
    // sample set is enumerable from the material's reflection (RFC 0001 —
    // exactly the checkability the graph form exists to preserve, and what a
    // shader source string would have hidden from this scan).
    if (item.kind === "node") {
      for (const sampler of item.material.reflection.textures) {
        const bound = item.material.getTexture(sampler.name);
        if (isRenderTargetTexture(bound)) {
          out.add(bound.renderTarget);
        } else if (
          bound instanceof CanvasTexture &&
          bound.readbackTarget !== null
        ) {
          out.add(bound.readbackTarget);
        }
      }
      continue;
    }
    // Every material texture slot can carry a delayed readback dependency.
    // Validation is authoring-time; enumerate all sampled standard-map slots,
    // not only albedo (RFC 0009 feedback applies to every sampler).
    const material = item.material;
    for (const key of [
      "texture",
      "map",
      "metalRoughnessMap",
      "emissiveMap",
      "normalMap",
      "occlusionMap",
    ] as const) {
      const texture: unknown =
        key in material
          ? (material as unknown as Record<string, unknown>)[key]
          : null;
      if (isRenderTargetTexture(texture)) out.add(texture.renderTarget);
      else if (
        texture instanceof CanvasTexture &&
        texture.readbackTarget !== null
      )
        out.add(texture.readbackTarget);
    }
  }
}

/**
 * §63's render graph at the linear-pass tier: an ordered, named, individually
 * enableable list of passes that one {@link RenderGraph.execute} call drives
 * through a {@link Renderer}.
 *
 * ```ts
 * const graph = new RenderGraph();
 * graph.addPass("world", { root: scene, views: [worldView], target: sceneColor });
 * graph.addPass("bloom", bloomPass, { inputs: ["world"] });
 * graph.addPass("ui", { root: overlay, views: [uiView] });
 * graph.addPass("composite", compositePass, { inputs: ["bloom", "ui"] });
 * ```
 *
 * Read the module header before reaching for this: it tabulates which of §63's
 * seven requirements are shipped here and which are staged, and why.
 *
 * ## Ownership
 *
 * A graph owns **nothing**. Passes, roots, viewports, and render targets all
 * belong to whoever created them, and the graph holds references — so it has no
 * `dispose`, disposing a target does not remove its pass, and two graphs may
 * name the same target. This is the same rule a material follows towards its
 * texture (§83), applied one level up.
 */
export class RenderGraph {
  readonly #passes: MutableGraphPass[] = [];

  readonly #byName = new Map<string, MutableGraphPass>();

  #version = 0;

  #compiled: CompiledPlan | null = null;

  #fallbackPool: RenderTargetPool | null = null;

  #lastViewSize: { width: number; height: number } | undefined;

  /**
   * The passes, in execution order (§63). A live view of the graph's own array
   * — read it, do not retain it across an {@link RenderGraph.addPass} or
   * {@link RenderGraph.removePass}, and never mutate it.
   */
  get passes(): readonly RenderGraphPass[] {
    return this.#passes;
  }

  /**
   * Appends a pass under `name` (§63's `graph.addPass(name, pass, options)`)
   * and returns the graph, so calls chain.
   *
   * Throws a {@link @fourjs/core!FourError | FourError} carrying
   * `INVALID_APPLICATION_STATE` when `name` is empty, when it is already taken,
   * or when an entry of `options.inputs` names a pass this graph does not have.
   * The last of those is what makes the graph acyclic by construction: an input
   * must already be in the list, and the list is the execution order.
   *
   * An {@link EffectRenderPass} is additionally checked against §85 here, by
   * {@link validateEffectRenderPass} — setup is the one place an effect's
   * parameters can be rejected loudly, since a backend may not throw from
   * inside a frame (§61). It raises a `RangeError`, not a `FourError`: a
   * non-finite grading coefficient is a *value* violation, the same class
   * `RenderTarget`'s size check reports, where everything else this method
   * refuses is a graph that cannot exist.
   *
   * The pass object is **not copied**. Mutating its `views` array between
   * frames is therefore visible to the next `execute`, which is the same
   * arrangement `renderer.render` already has with the array it is handed.
   */
  addPass(name: string, pass: RenderPass, options?: AddPassOptions): this {
    if (name === "") {
      throw new FourError(
        GRAPH_ERROR_CODE,
        "RenderGraph.addPass() requires a non-empty pass name (§63).",
        { context: { name } },
      );
    }
    if (this.#byName.has(name)) {
      throw new FourError(
        GRAPH_ERROR_CODE,
        `RenderGraph already has a pass named ${JSON.stringify(name)}; pass ` +
          "names are unique within a graph (§63).",
        { context: { name } },
      );
    }
    const inputs = options?.inputs ?? [];
    for (const input of inputs) {
      if (!this.#byName.has(input)) {
        throw new FourError(
          GRAPH_ERROR_CODE,
          `RenderGraph pass ${JSON.stringify(name)} declares input ` +
            `${JSON.stringify(input)}, which is not a pass of this graph. An ` +
            "input must be added before the pass that consumes it — that is " +
            "what keeps the graph acyclic (§63).",
          { context: { name, input } },
        );
      }
    }
    if (isEffectPass(pass)) {
      validateEffectRenderPass(pass);
    }
    if (options?.transient !== undefined && targetOf(pass) !== null) {
      throw new FourError(
        GRAPH_ERROR_CODE,
        `RenderGraph pass ${JSON.stringify(name)} declares both a target and a ` +
          "transient output; choose one (§63).",
        { context: { name } },
      );
    }
    const sourceTransient = options?.sourceTransient;
    if (sourceTransient !== undefined) {
      if (!isEffectPass(pass) || !inputs.includes(sourceTransient)) {
        throw new FourError(
          GRAPH_ERROR_CODE,
          `RenderGraph pass ${JSON.stringify(name)}: sourceTransient is only ` +
            "valid on an effect pass and must also be listed in inputs (§63).",
          { context: { name, sourceTransient } },
        );
      }
      if (this.#byName.get(sourceTransient)?.transient === undefined) {
        throw new FourError(
          GRAPH_ERROR_CODE,
          `RenderGraph pass ${JSON.stringify(name)}: sourceTransient ` +
            `${JSON.stringify(sourceTransient)} has no transient output (§63).`,
          { context: { name, sourceTransient } },
        );
      }
    }
    const entry: MutableGraphPass = {
      name,
      pass,
      inputs: [...inputs],
      transient: options?.transient,
      sourceTransient,
      enabled: options?.enabled ?? true,
    };
    this.#passes.push(entry);
    this.#byName.set(name, entry);
    this.#version += 1;
    return this;
  }

  /**
   * The pass added under `name`, or `undefined` when the graph has none.
   */
  getPass(name: string): RenderGraphPass | undefined {
    return this.#byName.get(name);
  }

  /**
   * Removes the pass added under `name` and returns whether there was one.
   *
   * Refused with a {@link @fourjs/core!FourError | FourError} while another pass
   * declares it as an input: silently dropping a producer would leave its
   * consumers sampling a surface nothing writes, and the graph knows that now
   * rather than at {@link RenderGraph.validate} time. Drop the consumers first,
   * or disable the producer with {@link RenderGraph.setPassEnabled}.
   */
  removePass(name: string): boolean {
    const entry = this.#byName.get(name);
    if (entry === undefined) {
      return false;
    }
    for (const other of this.#passes) {
      if (other.inputs.includes(name)) {
        throw new FourError(
          GRAPH_ERROR_CODE,
          `RenderGraph pass ${JSON.stringify(name)} cannot be removed while ` +
            `${JSON.stringify(other.name)} declares it as an input (§63). ` +
            "Remove the consumer first, or disable this pass instead.",
          { context: { name, consumer: other.name } },
        );
      }
    }
    this.#passes.splice(this.#passes.indexOf(entry), 1);
    this.#byName.delete(name);
    this.#version += 1;
    return true;
  }

  /**
   * Turns a pass on or off — §63's "pass enable/disable" — and returns the
   * graph, so calls chain.
   *
   * A disabled pass is skipped entirely by {@link RenderGraph.execute}: no
   * render call, no clear, nothing bound. Its consumers keep running and keep
   * sampling whatever its target last held, which {@link RenderGraph.validate}
   * reports as `"unwritten"`.
   *
   * Throws a {@link @fourjs/core!FourError | FourError} when the graph has no
   * pass under `name`, rather than doing nothing: a typo that silently fails to
   * disable a pass costs a frame's worth of work per frame, invisibly.
   */
  setPassEnabled(name: string, enabled: boolean): this {
    const entry = this.#byName.get(name);
    if (entry === undefined) {
      throw new FourError(
        GRAPH_ERROR_CODE,
        `RenderGraph has no pass named ${JSON.stringify(name)} to enable or ` +
          "disable (§63).",
        { context: { name, enabled } },
      );
    }
    entry.enabled = enabled;
    return this;
  }

  /**
   * Draws every enabled pass in order through `renderer`, and returns how many
   * ran.
   *
   * Each {@link SceneRenderPass} becomes exactly one
   * `renderer.render(root, views, interpolation, target)` call — R-4's seam,
   * with the frame's `interpolation` record threaded through unchanged — and
   * each {@link EffectRenderPass} becomes exactly one
   * `renderer.renderEffect(pass)` call, with the pass object forwarded
   * unchanged (R-6). So a graph produces the same backend calls, in the same
   * order, as the hand-written sequence it replaces. A
   * {@link CustomRenderPass} is called instead, and whatever it does with the
   * renderer is its own.
   *
   * Nothing here interprets a disposed or unallocatable target: R-4 already
   * defines both as "the backend skips the frame", and re-deciding that here
   * would give the engine two policies for one situation.
   *
   * ## The one thing this method refuses
   *
   * An effect pass met by a renderer that does not implement
   * {@link ScreenEffectRenderer} throws a
   * {@link @fourjs/core!FourError | FourError} carrying
   * `INVALID_APPLICATION_STATE`. That is a deliberate exception to "a frame
   * never throws": the mismatch is a *permanent* property of the backend the
   * application selected (§62 selects one at the edge, once), not the
   * transient, driver-scheduled condition §61's no-throw rule protects
   * against — so it can only ever fail on the very first frame, loudly, where
   * the alternative is a post-processed image that silently never appears.
   * {@link supportsScreenEffects} answers the same question without a frame.
   *
   * Allocates one context record per custom pass per call and nothing else; a
   * graph of scene and effect passes allocates nothing at all.
   */
  execute(
    renderer: Renderer,
    interpolation?: RenderInterpolation,
    viewSize?: { readonly width: number; readonly height: number },
  ): number {
    const plan = this.#hasTransients()
      ? this.#ensureCompiled(renderer, viewSize)
      : null;
    let executed = 0;
    for (const [index, entry] of this.#passes.entries()) {
      if (!entry.enabled) {
        continue;
      }
      const pass = entry.pass;
      const slot = plan === null ? null : (plan.byName.get(entry.name) ?? null);
      if (plan !== null) {
        plan.pool.beginPass?.(plan.records[index]);
      }
      if (isCustomPass(pass)) {
        pass.execute(renderer, {
          name: entry.name,
          graph: this,
          interpolation,
          target: slot,
        });
      } else if (isEffectPass(pass)) {
        if (!supportsScreenEffects(renderer)) {
          throw new FourError(
            GRAPH_ERROR_CODE,
            `RenderGraph pass ${JSON.stringify(entry.name)} is a §70 effect ` +
              "pass, and this renderer does not implement renderEffect(). " +
              "Select a backend that supports full-screen effects, or test " +
              "with supportsScreenEffects(renderer) before executing (§70).",
            { context: { name: entry.name } },
          );
        }
        if (
          plan !== null &&
          (slot !== null || entry.sourceTransient !== undefined)
        ) {
          const source =
            entry.sourceTransient === undefined
              ? pass.source
              : (plan.byName.get(entry.sourceTransient)?.colorTexture ??
                pass.source);
          renderer.renderEffect({
            ...pass,
            source,
            target: slot ?? pass.target,
          });
        } else {
          renderer.renderEffect(pass);
        }
      } else {
        renderer.render(
          pass.root,
          pass.views,
          interpolation,
          slot ?? pass.target ?? null,
        );
      }
      executed += 1;
    }
    return executed;
  }

  /**
   * Computes (or reuses) the transient plan against `renderer`'s pool and
   * returns it, or `null` when the graph declares no transient. Idempotent:
   * the slots persist while the pass structure, renderer and resolved sizes
   * are unchanged, so calling it per frame allocates nothing. {@link
   * RenderGraph.execute} calls it for you; call it directly to read
   * {@link RenderGraph.transientTarget} before the first frame (e.g. to point
   * a scene material at a transient's colour texture).
   */
  compile(
    renderer: Renderer,
    viewSize?: { readonly width: number; readonly height: number },
  ): TransientPlan | null {
    if (!this.#hasTransients()) {
      return null;
    }
    const compiled = this.#ensureCompiled(renderer, viewSize);
    return this.#describePlan(compiled.slots, compiled.byName);
  }

  /**
   * The physical surface a transient pass draws into, valid after
   * {@link RenderGraph.compile}/{@link RenderGraph.execute}; `undefined`
   * before, or when `name` has no transient. Aliased passes may return the
   * same surface — by construction never while both are live.
   */
  transientTarget(name: string): RenderTarget | undefined {
    return this.#compiled?.byName.get(name);
  }

  /** Bytes of the pooled slots this graph currently holds (§83); 0 if none. */
  get transientByteLength(): number {
    const compiled = this.#compiled;
    if (compiled === null) {
      return 0;
    }
    let total = 0;
    for (const target of compiled.slotTargets) {
      total += target.byteLength;
    }
    return total;
  }

  /**
   * Per-pass declared resource use: targets sampled as textures (the
   * `inputs`' outputs and an effect's source) and the target drawn into. Ids
   * of transients read `transient:<pass>` until compiled, then the physical
   * target id.
   */
  usagePlan(): readonly PassUsageRecord[] {
    return this.#usageRecords(this.#compiled?.byName ?? null);
  }

  /**
   * The explicit usage-transition list (§63 barriers): walking enabled passes
   * in order, every change of one target between attachment and texture use.
   * WebGPU consults it; WebGL 2 uses it only for the DEV assertion.
   */
  usageTransitions(): readonly UsageTransition[] {
    const state = new Map<string, "attachment" | "texture">();
    const out: UsageTransition[] = [];
    for (const record of this.usagePlan()) {
      if (!this.#passes[record.index].enabled) {
        continue;
      }
      const step = (target: string, to: "attachment" | "texture"): void => {
        const from = state.get(target) ?? "none";
        if (from !== to) {
          out.push({ pass: record.pass, target, from, to });
          state.set(target, to);
        }
      };
      for (const read of record.reads) {
        step(read, "texture");
      }
      if (record.writes !== null) {
        step(record.writes, "attachment");
      }
    }
    return out;
  }

  /** Releases this graph's pooled slots; the graph stays usable (recompiles). */
  dispose(): void {
    this.#releaseCompiled();
    this.#fallbackPool?.dispose();
    this.#fallbackPool = null;
  }

  #hasTransients(): boolean {
    return this.#passes.some((entry) => entry.transient !== undefined);
  }

  #releaseCompiled(): void {
    const compiled = this.#compiled;
    if (compiled !== null) {
      for (const target of compiled.slotTargets) {
        compiled.pool.release(target);
      }
      this.#compiled = null;
    }
  }

  #requests(
    viewSize: { readonly width: number; readonly height: number } | undefined,
  ): TransientRequest[] {
    const requests: TransientRequest[] = [];
    for (const [index, entry] of this.#passes.entries()) {
      if (entry.transient === undefined) {
        continue;
      }
      let last = index;
      for (const [other, consumer] of this.#passes.entries()) {
        if (other > last && consumer.inputs.includes(entry.name)) {
          last = other;
        }
      }
      requests.push({
        name: entry.name,
        key: resolveTransientSpec(
          entry.transient,
          viewSize,
          entry.name,
          GRAPH_ERROR_CODE,
        ),
        first: index,
        last,
      });
    }
    return requests;
  }

  #ensureCompiled(
    renderer: Renderer,
    viewSize: { readonly width: number; readonly height: number } | undefined,
  ): CompiledPlan {
    const size = viewSize ?? this.#lastViewSize;
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    const current = this.#compiled;
    if (
      current !== null &&
      current.version === this.#version &&
      current.renderer === renderer &&
      current.width === width &&
      current.height === height
    ) {
      return current;
    }
    this.#releaseCompiled();
    if (viewSize !== undefined) {
      this.#lastViewSize = { width: viewSize.width, height: viewSize.height };
    }
    const requests = this.#requests(size);
    const { slots, assignment } = planTransientSlots(requests);
    const pool =
      renderer.transientTargetPool?.() ??
      (this.#fallbackPool ??= new RenderTargetPool());
    const sampledNames = new Set<string>();
    for (const entry of this.#passes) {
      for (const input of entry.inputs) {
        sampledNames.add(input);
      }
    }
    const slotTargets = slots.map((slot) =>
      pool.acquire(slot.key, {
        sampled: slot.names.some((name) => sampledNames.has(name)),
        attachment: true,
      }),
    );
    const byName = new Map<string, RenderTarget>();
    for (const [name, slotIndex] of assignment) {
      byName.set(name, slotTargets[slotIndex]);
    }
    const compiled: CompiledPlan = {
      version: this.#version,
      renderer,
      width,
      height,
      pool,
      slots,
      slotTargets,
      byName,
      records: this.#usageRecords(byName),
    };
    this.#compiled = compiled;
    return compiled;
  }

  #describePlan(
    slots: readonly TransientSlot[],
    byName: ReadonlyMap<string, RenderTarget>,
  ): TransientPlan {
    const assignment = new Map<string, number>();
    let byteLength = 0;
    let unaliased = 0;
    for (const slot of slots) {
      const bytes = renderTargetByteLength(
        slot.key.width,
        slot.key.height,
        slot.key.format,
        slot.key.depth,
        slot.key.depthTexture,
        false,
        false,
      );
      byteLength += bytes;
      unaliased += bytes * slot.names.length;
      for (const name of slot.names) {
        assignment.set(name, slot.index);
      }
    }
    void byName;
    return { slots, assignment, byteLength, unaliasedByteLength: unaliased };
  }

  #usageRecords(
    byName: ReadonlyMap<string, RenderTarget> | null,
  ): PassUsageRecord[] {
    const outputId = (entry: MutableGraphPass): string | null => {
      if (entry.transient !== undefined) {
        return byName?.get(entry.name)?.id ?? `transient:${entry.name}`;
      }
      return targetOf(entry.pass)?.id ?? null;
    };
    return this.#passes.map((entry, index) => {
      const reads: string[] = [];
      for (const input of entry.inputs) {
        const id = outputId(this.#byName.get(input) as MutableGraphPass);
        if (id !== null && !reads.includes(id)) {
          reads.push(id);
        }
      }
      if (isEffectPass(entry.pass) && entry.sourceTransient === undefined) {
        const id = entry.pass.source.renderTarget.id;
        if (!reads.includes(id)) {
          reads.push(id);
        }
      }
      return { pass: entry.name, index, reads, writes: outputId(entry) };
    });
  }

  /**
   * Checks the enabled passes against what they actually sample, and returns
   * every finding in pass order (§63's "pass dependencies").
   *
   * An empty array means: no enabled pass samples the target it writes, none
   * samples a target only a later pass writes, none samples a target nothing
   * writes, and none is opaque to the check. See {@link RenderGraphIssueCode}
   * for what each finding means and {@link RenderGraphIssue.severity} for how
   * much it matters.
   *
   * ```ts
   * const errors = graph.validate().filter((issue) => issue.severity === "error");
   * expect(errors).toEqual([]);
   * ```
   *
   * **Call it at setup, not per frame.** It builds a render list per scene pass
   * to discover what that pass samples (the module header explains why the
   * result cannot be cached), so it costs a scene traversal per pass. Every
   * finding it reports is a *static* property of the graph plus the materials
   * currently attached; re-run it when either changes.
   */
  validate(): readonly RenderGraphIssue[] {
    const issues: RenderGraphIssue[] = [];
    const enabled = this.#passes.filter((entry) => entry.enabled);

    // Which enabled pass most recently wrote which target, as the scan walks
    // forward. A target written by two passes (a depth prepass and the opaque
    // pass, say) is satisfied by either, so presence is the whole question.
    const sampled = new Set<RenderTarget>();
    const writtenBefore = new Map<RenderTarget, string>();

    for (const entry of enabled) {
      const pass = entry.pass;
      const written = targetOf(pass);
      if (isCustomPass(pass)) {
        issues.push({
          code: "opaque",
          severity: "info",
          pass: entry.name,
          producer: null,
          target: null,
          message:
            `RenderGraph pass ${JSON.stringify(entry.name)} is a custom pass; ` +
            "the graph cannot see what it samples, so its resource checks " +
            "were skipped (§63).",
        });
      } else {
        // What this pass samples. A scene pass has to be *discovered* — its
        // materials decide, so the render list is the only honest source (the
        // module header argues that at length). A §70 effect pass declares it
        // structurally, in one field, and needs no traversal at all: that
        // asymmetry is the reason effects are a pass kind here rather than
        // custom passes, which would have been reported `"opaque"` and checked
        // for nothing (R-6).
        sampled.clear();
        if (isEffectPass(pass)) {
          sampled.add(pass.source.renderTarget);
          // §60's graph effect (RFC 0001): the graph's additional inputs are
          // declared on the pass — that declaration is the whole reason a
          // graph effect stays checkable, so the feedback and ordering scans
          // below see the pass's **full** sample set, exactly as they see a
          // built-in effect's one field. Keys are sorted so the issue order
          // is a function of the graph, not of a record's key order (§33).
          const effect = pass.effect;
          if (effect.kind === "graph" && effect.textures !== undefined) {
            const inputs = effect.textures;
            for (const name of Object.keys(inputs).sort()) {
              sampled.add(inputs[name].renderTarget);
            }
          }
        } else {
          collectSampledTargets(pass.root, sampled);
        }
        for (const target of sampled) {
          if (target === written) {
            issues.push({
              code: "feedback",
              severity: "error",
              pass: entry.name,
              producer: entry.name,
              target,
              message:
                `RenderGraph pass ${JSON.stringify(entry.name)} samples the ` +
                `render target it draws into (${target.id}). A backend ` +
                "refuses that sample rather than painting undefined content " +
                "(R-4); ping-pong between two targets instead.",
            });
            continue;
          }
          const producer = writtenBefore.get(target);
          if (producer !== undefined) {
            continue;
          }
          const later = this.#laterWriterOf(target, entry.name, enabled);
          issues.push(
            later === null
              ? {
                  code: "unwritten",
                  severity: "warning",
                  pass: entry.name,
                  producer: null,
                  target,
                  message:
                    `RenderGraph pass ${JSON.stringify(entry.name)} samples ` +
                    `render target ${target.id}, which no enabled pass of this ` +
                    "graph writes. It reads whatever the surface last held — " +
                    "transparent black if nothing ever has (§63, R-4).",
                }
              : {
                  code: "order",
                  severity: "error",
                  pass: entry.name,
                  producer: later,
                  target,
                  message:
                    `RenderGraph pass ${JSON.stringify(entry.name)} samples ` +
                    `render target ${target.id}, which is written by ` +
                    `${JSON.stringify(later)} — a *later* pass. Move the ` +
                    "producer before the consumer (§63: passes are executed in " +
                    "the order they were added).",
                },
          );
        }
      }
      // A pass's target counts as written from here on — including a custom
      // pass's *declared* one, which is what declaring it is for.
      if (written !== null) {
        writtenBefore.set(written, entry.name);
      }
    }
    return issues;
  }

  /**
   * Renders the graph as text — §63's "debug visualization" at the tier this
   * package can honestly reach without a backend (the module header says what
   * the full requirement needs).
   *
   * ```text
   * RenderGraph: 4 passes, 3 enabled
   * 1. world [scene] -> render-target-1
   * 2. grade [effect grade] -> render-target-2 <- world
   * 3. ui [scene, disabled] -> screen
   * 4. composite [custom] -> screen <- grade, ui
   * ```
   *
   * An effect pass prints its §70 effect beside its kind, because "which
   * effect" is the only thing that distinguishes two otherwise identical
   * passes in a chain. `-> screen` is a pass with no target — the default
   * drawing buffer. The
   * output is deterministic (§33: no clock, no identity hashes) and is meant to
   * be logged or snapshotted; its exact layout is not a contract.
   */
  describe(): string {
    const total = this.#passes.length;
    const enabled = this.#passes.reduce(
      (count, entry) => (entry.enabled ? count + 1 : count),
      0,
    );
    const lines = [
      `RenderGraph: ${String(total)} passes, ${String(enabled)} enabled`,
    ];
    for (const [index, entry] of this.#passes.entries()) {
      const kind = isCustomPass(entry.pass)
        ? "custom"
        : isEffectPass(entry.pass)
          ? `effect ${entry.pass.effect.kind}`
          : "scene";
      const tags = entry.enabled ? kind : `${kind}, disabled`;
      const target =
        entry.transient === undefined
          ? (targetOf(entry.pass)?.id ?? "screen")
          : `transient:${entry.name}`;
      const inputs =
        entry.inputs.length === 0 ? "" : ` <- ${entry.inputs.join(", ")}`;
      lines.push(
        `${String(index + 1)}. ${entry.name} [${tags}] -> ${target}${inputs}`,
      );
    }
    if (this.#hasTransients()) {
      this.#describeTransients(lines);
    }
    return lines.join("\n");
  }

  #describeTransients(lines: string[]): void {
    let requests: TransientRequest[];
    try {
      requests = this.#requests(this.#lastViewSize);
    } catch {
      lines.push(
        "transients: unresolved (view-relative size needs a view size)",
      );
      return;
    }
    const { slots } = planTransientSlots(requests);
    const plan = this.#describePlan(slots, new Map());
    lines.push(
      `transients: ${String(requests.length)} targets -> ${String(slots.length)} slots, ` +
        `${String(plan.byteLength)} bytes (${String(plan.unaliasedByteLength)} unaliased)`,
    );
    for (const slot of slots) {
      lines.push(
        `  slot ${String(slot.index)} [${transientKeyString(slot.key)}] <- ${slot.names.join(", ")}`,
      );
    }
  }

  /**
   * Name of the first enabled pass **after** `consumer` that writes `target`,
   * or `null` when none does.
   */
  #laterWriterOf(
    target: RenderTarget,
    consumer: string,
    enabled: readonly MutableGraphPass[],
  ): string | null {
    let seen = false;
    for (const entry of enabled) {
      if (!seen) {
        seen = entry.name === consumer;
        continue;
      }
      if (targetOf(entry.pass) === target) {
        return entry.name;
      }
    }
    return null;
  }
}
