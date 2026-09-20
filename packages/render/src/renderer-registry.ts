/**
 * The §62 backend registry — how a name becomes a renderer without this
 * package, or the `four` umbrella, ever importing a backend (R-2, A-8).
 *
 * §45 spells the application's renderer option
 * `"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`, and §62 says what
 * `"auto"` means: *"Automatic selection should prefer WebGPU, then WebGL 2,
 * then an appropriate 2D backend. If WebGPU initialization fails at runtime
 * under `"auto"`, selection falls back to WebGL 2 and emits a diagnostics
 * event; an explicit `renderer: "webgpu"` fails fast with
 * `RENDERER_INITIALIZATION_FAILED` (§89) rather than silently downgrading."*
 *
 * The obvious implementation — a `switch` over the string that constructs the
 * matching class — is the one this repository may not have. It would make the
 * module holding the switch import **every** backend package, so every program
 * that ever named `Application` would carry a WebGL renderer, a WebGPU
 * renderer, a Canvas renderer and an SVG renderer whether or not it drew a
 * single pixel; §91's tree-shaking requirement and the 14.88 kB example that
 * WP-3.6 measured are both spent in one line. That is the whole reason
 * `ApplicationOptions.renderer` has been an *instance* since Phase 3 (MEMORY,
 * 2026-08-01).
 *
 * So the dependency is inverted: **backends register themselves into this
 * neutral host**, and the name is resolved against whatever the application
 * actually imported.
 *
 * ```ts
 * import { registerWebglRenderer } from "@fourjs/render-webgl";
 *
 * registerWebglRenderer();                      // the app names its backends
 * const app = new Application({ renderer: "auto", canvas });
 * await app.initialize();                       // resolves against the registry
 * ```
 *
 * The §3.1 matrix is unchanged and no edge is added: `render-webgl` already
 * depends on `render`, and `four` already depends on `render`. Nothing here
 * imports a backend, at type level or at runtime.
 *
 * ## Explicit registration, never a side-effect import (decision, 2026-08-07)
 *
 * Registration is a **function the application calls**, not something an
 * `import "@fourjs/render-webgl/register"` performs on evaluation. Every package
 * in this workspace declares `"sideEffects": false`, which is precisely the
 * promise that importing a module and using nothing from it may be deleted —
 * a side-effect registration module would be *correctly* dropped by any
 * bundler that believes the manifest, and would then fail at runtime with
 * "nothing is registered". The two ways out are both worse than an explicit
 * call: carving an exception into every backend's `sideEffects` field defeats
 * the field's purpose, and dropping the field entirely un-shakes the whole
 * package. An explicit `registerWebglRenderer()` is a value the bundler can
 * see being used, so it survives for exactly the programs that want it and
 * disappears from the ones that do not.
 *
 * ## What an application that never selects by name pays: nothing
 *
 * {@link resolveRenderer} deliberately does **not** mention
 * {@link RendererRegistry}. It reads a module-level slot that only
 * {@link registerRenderer} ever writes, so a bundle whose application hands
 * `Application` a concrete instance retains the eight-line resolver and its
 * error text, and drops the registry class, the `Map`, the §62 preference
 * order, and every backend along with them. Measured on the four size-limited
 * examples: unchanged to the byte after minification except for that resolver
 * (see the packet's size proof).
 *
 * ## The diagnostics event of §62, and why it is a callback
 *
 * §62 asks for "a diagnostics event" when `"auto"` falls back. The frozen §3.1
 * matrix gives `@fourjs/render` no `@fourjs/diagnostics` edge — `render` is wave 3
 * beside `diagnostics`, not above it — and this packet may not add one. The
 * report is therefore delivered through
 * {@link RendererResolveOptions.onFallback}, a callback the caller supplies;
 * an application that wants it on a diagnostics channel forwards it in one
 * line, which is the same shape `PointerInput` uses to stay DOM-free. The
 * information §62 asks to be reported — which backend was skipped and why — is
 * carried in full by {@link RendererFallbackReport}.
 */

import { FourError } from "@fourjs/core";

import type {
  Renderer,
  RendererBackend,
  RendererCapabilities,
  RendererOptions,
} from "./renderer.js";

/**
 * What an application may ask for (§45, §62): `"auto"` for §62's ordered
 * preference, or one {@link RendererBackend} by name.
 *
 * §45's literal union omits `"null"`; this one keeps it, because the headless
 * tier is a real §62 backend and naming it is how a determinism or CI run asks
 * for "a renderer that draws nothing" without importing one. It is never
 * chosen by `"auto"` — see {@link AUTO_RENDERER_ORDER}.
 */
export type RendererSelection = "auto" | RendererBackend;

/**
 * The order `"auto"` tries registered backends in — §62's "prefer WebGPU, then
 * WebGL 2, then an appropriate 2D backend", written out.
 *
 * `"null"` is absent on purpose. A headless renderer would "succeed" for every
 * application whose real backend was unavailable, turning a blank screen into
 * the automatic outcome; §62's fallback ladder ends at a 2D backend that
 * genuinely draws, and running headless is an explicit choice
 * (`renderer: "null"`, or no renderer at all).
 *
 * Registration order is deliberately **not** consulted: §62 fixes the
 * preference, so two applications that register the same backends in different
 * orders must still resolve `"auto"` the same way (§33).
 *
 * ## `"canvas2d"` and `"svg"` are rungs no fourJS package can fill — kept on purpose
 *
 * `@fourjs/render-canvas` and `@fourjs/render-svg` are §102 reserved stubs (one
 * export each, no `Renderer`), so from fourJS packages alone these two rungs are
 * unreachable and `"auto"` stops at WebGPU/WebGL 2. **The rungs stay**, because
 * they are not decoration: they are the published contract an **application's
 * own** backend registers into. `registerRenderer({ backend: "canvas2d", … })`
 * from consumer code makes `resolveRenderer("auto")` select it exactly as it
 * would a first-party backend — measured end to end in dogfood cycle 9A, which
 * wrote a Canvas 2D backend against published exports only (~120 lines,
 * **35,851 lit pixels / 3 draw calls / 82 triangles** against a 0-pixel control)
 * and an SVG one beside it (**83 elements** against a 1-element control).
 * Dropping the rungs to tidy the cosmetic gap would remove a working extension
 * point; a stub package shipping later fills its own rung with no change here.
 * The recipe is `docs/guides/custom-renderer-backends.md`.
 */
export const AUTO_RENDERER_ORDER = [
  "webgpu",
  "webgl2",
  "canvas2d",
  "svg",
] as const satisfies readonly RendererBackend[];

/**
 * One backend's entry in a {@link RendererRegistry} — everything the registry
 * needs to decide whether to try it, and how to build it.
 */
export interface RendererRegistration {
  /** Which §62 backend this builds. One registration per backend per registry. */
  readonly backend: RendererBackend;

  /**
   * A **cheap, side-effect-free** answer to "could this environment run this
   * backend at all?" (§62 capability tiers).
   *
   * This is a pre-filter, not the real gate: the real gate is
   * {@link Renderer.initialize}, which is the only code that can tell a blocked
   * GPU from a working one, and whose failure `"auto"` already recovers from by
   * moving to the next backend. So a probe must not acquire a context, must not
   * allocate a device, and above all must not touch the caller's canvas — a
   * canvas hands out one context per type, so a probe that called
   * `getContext("webgl2")` with its own attributes would silently fix the
   * attributes of the context the backend later acquires.
   *
   * Answering `true` optimistically is safe (initialization decides);
   * answering `false` is a promise that trying would be pointless.
   */
  isSupported(options?: RendererOptions): boolean;

  /**
   * Constructs the backend. Must not initialize it — the registry calls
   * {@link Renderer.initialize} itself, because §62's fallback is defined in
   * terms of *initialization* failing.
   */
  create(options?: RendererOptions): Renderer | Promise<Renderer>;
}

/**
 * The §62 capabilities an application may **declare** — the boolean members of
 * {@link RendererCapabilities}, by their field names.
 *
 * A closed union rather than `string`, for the closed-union house reason: a
 * capability this record cannot answer must be a compile error, never a name
 * the resolver quietly fails to find. The numeric members
 * (`maxTextureSize`, `maxUniformBufferBytes`, `maxBindings`,
 * `maximumSkinningJoints`) and the format lists are deliberately not
 * declarable at this tier — a requirement over a *quantity* needs a threshold
 * grammar, and inventing one before a consumer asks would be §62 guessed at
 * rather than implemented. Widening this union is additive.
 */
export type RendererCapabilityName =
  | "multisampling"
  | "floatRenderTargets"
  | "timestampQueries"
  | "storageBuffers"
  | "computeShaders"
  | "indirectDraw";

/** Every declarable name, in {@link RendererCapabilities}' field order (§33). */
export const RENDERER_CAPABILITY_NAMES = [
  "multisampling",
  "floatRenderTargets",
  "timestampQueries",
  "storageBuffers",
  "computeShaders",
  "indirectDraw",
] as const satisfies readonly RendererCapabilityName[];

/**
 * §62's *"applications may declare required and optional capabilities"*, as
 * the declaration {@link resolveRenderer} accepts (WP-R1.9).
 *
 * - **`required`** gates selection. `"auto"` skips a backend that does not
 *   answer every required name `true` (reported through
 *   {@link RendererResolveOptions.onFallback} with reason
 *   `"missing-capability"`), and an explicitly named backend that cannot
 *   fails fast with `RENDERER_INITIALIZATION_FAILED` — §62's own
 *   "rather than silently downgrading", extended from *starting* to
 *   *sufficing*.
 * - **`optional`** never gates selection. Each optional name the selected
 *   backend does not answer `true` is reported through
 *   {@link RendererResolveOptions.onCapabilityShortfall}, so an application
 *   configures its fallback path from one report instead of probing fields.
 *
 * ## The tri-state honesty rule
 *
 * {@link RendererCapabilities} answers each member `true`, `false`, or
 * `undefined` — and `undefined` means *"this backend has not been taught to
 * answer"*, which is not a yes. A required capability is therefore satisfied
 * **only by an affirmative `true`**: treating silence as satisfaction would
 * hand an application a backend on the strength of a question never answered,
 * which is precisely the confident wrong answer the record's documentation
 * warns costs a crash. The shortfall report distinguishes the two non-answers
 * (`answer: false` vs `answer: undefined`) so a diagnostics channel can tell
 * "cannot" from "did not say".
 *
 * The check runs **after** {@link Renderer.initialize}, because §61 lets a
 * backend publish its real record only once it has queried a device; under
 * `"auto"` a backend skipped for a missing capability is disposed exactly as
 * one whose initialization rejected.
 */
export interface RendererCapabilityDeclaration {
  /** Capabilities the application cannot run without. */
  readonly required?: readonly RendererCapabilityName[];
  /** Capabilities the application would use, and will adapt without. */
  readonly optional?: readonly RendererCapabilityName[];
}

/**
 * One declared capability a backend did not affirm, as
 * {@link RendererResolveOptions.onCapabilityShortfall} sees it (§62's
 * diagnostics report, capability half).
 */
export interface RendererCapabilityShortfall {
  /** The backend whose record fell short. */
  readonly backend: RendererBackend;
  /** The declared capability. */
  readonly capability: RendererCapabilityName;
  /**
   * The record's actual answer: `false` — the backend reports it cannot — or
   * `undefined` — the backend has not been taught to answer (the tri-state's
   * third value, never silently promoted to satisfaction).
   */
  readonly answer: false | undefined;
  /** Which half of the declaration named it. */
  readonly requirement: "required" | "optional";
}

/** Why `"auto"` moved past a registered backend (§62's "diagnostics event"). */
export type RendererFallbackReason =
  /** {@link RendererRegistration.isSupported} answered `false`. */
  | "unsupported"
  /** The backend was built, and {@link Renderer.initialize} rejected. */
  | "initialization-failed"
  /**
   * The backend initialized, but did not answer every
   * {@link RendererCapabilityDeclaration.required} capability `true`
   * (WP-R1.9); it was disposed and the walk moved on.
   */
  | "missing-capability";

/** One skipped backend, as {@link RendererResolveOptions.onFallback} sees it. */
export interface RendererFallbackReport {
  /** The backend that was not used. */
  readonly backend: RendererBackend;
  /** Why it was not used. */
  readonly reason: RendererFallbackReason;
  /** The rejection, for `"initialization-failed"`; absent otherwise. */
  readonly error?: unknown;
  /**
   * The required capabilities the backend did not affirm, in declaration
   * order — present exactly for `"missing-capability"` (WP-R1.9).
   */
  readonly missing?: readonly RendererCapabilityName[];
}

/**
 * {@link RendererOptions} plus the §62 fallback report — what
 * {@link resolveRenderer} takes, and what it forwards to both
 * {@link RendererRegistration.create} and {@link Renderer.initialize}.
 */
export interface RendererResolveOptions extends RendererOptions {
  /**
   * Called once per backend `"auto"` skips, in the order they were tried
   * (§62's diagnostics event; see the module header for why it is a callback).
   *
   * Never called for an explicit selection: naming a backend means it must
   * work, so its failure is thrown rather than reported. A throwing listener
   * propagates — this is the application's own code.
   */
  onFallback?: (report: RendererFallbackReport) => void;

  /**
   * §62's required/optional capability declaration (WP-R1.9) — see
   * {@link RendererCapabilityDeclaration} for the selection rule and the
   * tri-state honesty rule. Validated per §85 before anything is constructed;
   * an unknown name, a non-array half, or a name declared in both halves is
   * refused with a `RangeError` at the resolve call, never discovered as a
   * capability that silently matched nothing.
   */
  capabilities?: RendererCapabilityDeclaration;

  /**
   * Called once per declared capability a tried backend did not answer `true`
   * (WP-R1.9): for every **required** shortfall of a backend `"auto"` skips —
   * beside its {@link RendererResolveOptions.onFallback} report — and for
   * every **optional** shortfall of the backend actually selected, whichever
   * way it was selected. Required shortfalls of an *explicitly named* backend
   * are thrown rather than reported, {@link RendererResolveOptions.onFallback}'s
   * rule. A throwing listener propagates — this is the application's own code.
   */
  onCapabilityShortfall?: (report: RendererCapabilityShortfall) => void;
}

/** §89's code for every failure in this module. */
const SELECTION_ERROR_CODE = "RENDERER_INITIALIZATION_FAILED";

/** Renders a backend list for the §85 failure messages. */
function describeBackends(backends: readonly RendererBackend[]): string {
  return backends.length === 0
    ? "none"
    : backends.map((backend) => JSON.stringify(backend)).join(", ");
}

/**
 * The registration sentence to print for a backend nobody registered.
 *
 * The registry knows which backend was asked for, so the message names *that*
 * backend's register call rather than always naming `registerWebglRenderer()`
 * — advice that was right for one of the four `"auto"` rungs and wrong for the
 * other three (dogfood cycle 9A: asking for `"canvas2d"` was told to call the
 * WebGL registrar).
 *
 * `"canvas2d"` and `"svg"` are §102 reserved stubs: `@fourjs/render-canvas`
 * and `@fourjs/render-svg` export a package name and nothing else, so there is
 * no register function to point at and pretending otherwise sends a reader to
 * an import that does not exist. Those rungs say so plainly — they are
 * reachable, but only through an application's own {@link registerRenderer}
 * (which cycle 9A proved works). `"null"` is the same shape: the headless tier
 * is whatever the caller registers.
 *
 * Selection is untouched by any of this; only the text changes.
 */
function registrationAdvice(backend: RendererBackend): string {
  switch (backend) {
    case "webgpu":
      return "Call `registerWebgpuRenderer()` from the render-webgpu package first, or pass a Renderer instance (§45).";
    case "webgl2":
      return "Call `registerWebglRenderer()` from the render-webgl package first, or pass a Renderer instance (§45).";
    case "canvas2d":
    case "svg":
      return `No fourJS package implements the ${JSON.stringify(backend)} backend yet — it is a reserved §102 stub — so nothing exports a register function for it. Register your own implementation with registerRenderer({ backend: ${JSON.stringify(backend)}, isSupported, create }), or pass a Renderer instance (§45).`;
    case "null":
      return 'The headless tier has no package of its own: register your own implementation with registerRenderer({ backend: "null", isSupported, create }), or pass a Renderer instance (§45).';
  }
}

/** The declarable-name set, for {@link validateCapabilityDeclaration}. */
const CAPABILITY_NAME_SET: ReadonlySet<string> = new Set(
  RENDERER_CAPABILITY_NAMES,
);

/** Checks one half of a declaration; returns the validated list. */
function requireCapabilityNames(
  half: "required" | "optional",
  names: readonly RendererCapabilityName[] | undefined,
): readonly RendererCapabilityName[] {
  if (names === undefined) {
    return [];
  }
  // The alias is `unknown` so `Array.isArray` cannot narrow the parameter
  // itself to `any[]` (`analyzeShaderGraph`'s note, same reason).
  const raw: unknown = names;
  if (!Array.isArray(raw)) {
    throw new RangeError(
      `RendererCapabilityDeclaration.${half} must be an array of capability ` +
        `names; got ${typeof names} (§62, §85).`,
    );
  }
  for (const name of names) {
    if (!CAPABILITY_NAME_SET.has(name)) {
      throw new RangeError(
        `RendererCapabilityDeclaration.${half} names ${JSON.stringify(name)}, ` +
          "which is not a declarable §62 capability; the declarable set is " +
          `${RENDERER_CAPABILITY_NAMES.map((known) => JSON.stringify(known)).join(", ")} (§85).`,
      );
    }
  }
  return names;
}

/**
 * Validates a {@link RendererCapabilityDeclaration} (§62, §85) — the one
 * validation, run by {@link RendererRegistry.resolve} before any backend is
 * constructed, and exported so an application layer forwarding a declaration
 * (§45) can refuse it at *its* setup edge with the same rule.
 *
 * @throws RangeError for a half that is not an array, a name outside
 * {@link RENDERER_CAPABILITY_NAMES}, or a name declared in both halves — a
 * requirement already implies the interest an optional declaration states, so
 * the duplicate is a contradiction in the caller's intent, refused rather
 * than resolved by precedence.
 */
export function validateCapabilityDeclaration(
  declaration: RendererCapabilityDeclaration | undefined,
): void {
  if (declaration === undefined) {
    return;
  }
  const required = requireCapabilityNames("required", declaration.required);
  const optional = requireCapabilityNames("optional", declaration.optional);
  for (const name of optional) {
    if (required.includes(name)) {
      throw new RangeError(
        `RendererCapabilityDeclaration declares ${JSON.stringify(name)} both ` +
          "required and optional; a requirement already implies the " +
          "interest, so declare it once (§62, §85).",
      );
    }
  }
}

/**
 * The declared `names` that `capabilities` does not answer `true`, in
 * declaration order (§33) — the tri-state honesty rule as a pure function:
 * `false` and `undefined` are both shortfalls, and the report tells them
 * apart. Exported so the rule is testable — and quotable — without a registry.
 */
export function missingCapabilities(
  capabilities: RendererCapabilities,
  names: readonly RendererCapabilityName[] | undefined,
): RendererCapabilityName[] {
  const missing: RendererCapabilityName[] = [];
  if (names !== undefined) {
    for (const name of names) {
      if (capabilities[name] !== true) {
        missing.push(name);
      }
    }
  }
  return missing;
}

/** Renders one shortfall for the fail-fast message, tri-state spelled out. */
function describeShortfall(
  capabilities: RendererCapabilities,
  name: RendererCapabilityName,
): string {
  return capabilities[name] === false
    ? `${JSON.stringify(name)} (reports it cannot)`
    : `${JSON.stringify(name)} (does not report it — not an affirmative answer)`;
}

/**
 * The backends an application has opted into, and the §62 selection rule over
 * them (R-2).
 *
 * Applications normally use the shared registry through
 * {@link registerRenderer} and {@link resolveRenderer} and never name this
 * class. Construct one directly to keep a selection scope to itself — a test
 * that must not see another test's registrations, or a host embedding two
 * independent engines:
 *
 * ```ts
 * const registry = new RendererRegistry();
 * registerWebglRenderer(registry);
 * const renderer = await resolveRenderer("auto", { canvas }, registry);
 * ```
 */
export class RendererRegistry {
  /** `Map` preserves insertion order; `backends` reports it (ground rule 5). */
  readonly #entries = new Map<RendererBackend, RendererRegistration>();

  /**
   * Adds `registration`. Returns `this` so registrations chain.
   *
   * @throws FourError `RENDERER_INITIALIZATION_FAILED` if that backend is
   * already registered. A silent overwrite would make which renderer `"auto"`
   * builds depend on module evaluation order, which is the class of bug §33
   * exists to prevent. Use a second registry, or
   * {@link RendererRegistry.unregister}.
   */
  register(registration: RendererRegistration): this {
    const backend = registration.backend;
    if (this.#entries.has(backend)) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `A ${JSON.stringify(backend)} renderer is already registered (§62); registering a second one would make selection depend on import order. Unregister it first, or use a separate RendererRegistry.`,
        { context: { backend, registered: this.backends } },
      );
    }
    this.#entries.set(backend, registration);
    return this;
  }

  /** Removes `backend`'s registration; `true` if there was one. */
  unregister(backend: RendererBackend): boolean {
    return this.#entries.delete(backend);
  }

  /** Whether `backend` is registered. */
  has(backend: RendererBackend): boolean {
    return this.#entries.has(backend);
  }

  /** The registration for `backend`, or `undefined`. */
  get(backend: RendererBackend): RendererRegistration | undefined {
    return this.#entries.get(backend);
  }

  /** Number of registered backends. */
  get size(): number {
    return this.#entries.size;
  }

  /** The registered backends, in registration order. */
  get backends(): RendererBackend[] {
    return [...this.#entries.keys()];
  }

  /**
   * Builds and initializes the renderer `selection` names (§62).
   *
   * **An explicit backend fails fast.** §62 requires it: `renderer: "webgpu"`
   * on a machine without WebGPU must say so, not quietly hand back WebGL 2 and
   * leave an application wondering why its compute pass never ran. So an
   * unregistered name, an unsupported environment, and a rejected
   * `initialize` all reject here, unchanged and uncaught.
   *
   * **`"auto"` walks {@link AUTO_RENDERER_ORDER}** and takes the first backend
   * that is registered, answers {@link RendererRegistration.isSupported}, and
   * initializes. Every backend it passes over is reported through
   * {@link RendererResolveOptions.onFallback} — §62's diagnostics event — and a
   * backend whose `initialize` rejected is disposed before the walk continues,
   * so a half-acquired context is not left behind. When nothing works the
   * rejection names every backend that was tried and why each one was not used;
   * when *nothing is registered* it says that instead, which is the mistake
   * this API is most likely to produce.
   *
   * The renderer comes back **initialized**. That is forced by §62 — falling
   * back on initialization failure is only possible if the registry is the one
   * calling `initialize` — and callers must not call it again (backends treat a
   * second call as an error).
   */
  async resolve(
    selection: RendererSelection,
    options?: RendererResolveOptions,
  ): Promise<Renderer> {
    // §62's declaration, validated once, before any backend is constructed
    // (§85's setup-time stance): a typo must be a refusal at this line, never
    // a requirement that silently matched nothing.
    validateCapabilityDeclaration(options?.capabilities);
    if (selection !== "auto") {
      return this.#resolveExplicit(selection, options);
    }

    const reports: RendererFallbackReport[] = [];
    for (const backend of AUTO_RENDERER_ORDER) {
      const registration = this.#entries.get(backend);
      if (registration === undefined) {
        continue;
      }
      if (!registration.isSupported(options)) {
        this.#report(reports, { backend, reason: "unsupported" }, options);
        continue;
      }
      const renderer = await registration.create(options);
      try {
        await renderer.initialize(options);
      } catch (error: unknown) {
        // The backend acquired nothing it can keep; releasing it is this
        // walk's job, and a disposal that itself fails must not mask the
        // initialization failure that caused it (§83).
        try {
          renderer.dispose();
        } catch {
          // Intentionally ignored: see above.
        }
        this.#report(
          reports,
          { backend, reason: "initialization-failed", error },
          options,
        );
        continue;
      }
      // §62's required declaration (WP-R1.9), answered against the record the
      // backend published at initialize — the only moment it is authoritative
      // (§61). A shortfall disposes the renderer exactly as a rejected
      // initialize does, reports each capability with its tri-state answer,
      // and moves the walk on.
      const missing = missingCapabilities(
        renderer.capabilities,
        options?.capabilities?.required,
      );
      if (missing.length > 0) {
        for (const capability of missing) {
          this.#shortfall(renderer, capability, "required", options);
        }
        try {
          renderer.dispose();
        } catch {
          // Intentionally ignored: the disposal-must-not-mask rule above.
        }
        this.#report(
          reports,
          { backend, reason: "missing-capability", missing },
          options,
        );
        continue;
      }
      // The selected backend's optional shortfalls (§62's optional half):
      // reported, never gating — that is what "optional" means.
      for (const capability of missingCapabilities(
        renderer.capabilities,
        options?.capabilities?.optional,
      )) {
        this.#shortfall(renderer, capability, "optional", options);
      }
      return renderer;
    }

    throw new FourError(
      SELECTION_ERROR_CODE,
      `renderer: "auto" found no usable backend (§62). Registered: ${describeBackends(this.backends)}.${
        reports.length === 0
          ? " Call a backend's register function — for example `registerWebglRenderer()` from the render-webgl package — before selecting by name."
          : ` Tried, in §62 order: ${reports
              .map(
                (report) =>
                  `${JSON.stringify(report.backend)} (${report.reason})`,
              )
              .join(", ")}.`
      }`,
      {
        context: {
          selection,
          registered: this.backends,
          tried: reports.map((report) => ({
            backend: report.backend,
            reason: report.reason,
          })),
        },
        cause: reports.find((report) => report.error !== undefined)?.error,
      },
    );
  }

  /** {@link RendererRegistry.resolve} for a named backend; §62's fail-fast half. */
  async #resolveExplicit(
    backend: RendererBackend,
    options?: RendererResolveOptions,
  ): Promise<Renderer> {
    const registration = this.#entries.get(backend);
    if (registration === undefined) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `No ${JSON.stringify(backend)} renderer is registered (§62). Registered: ${describeBackends(this.backends)}. A backend is available only once the application registers it. ${registrationAdvice(backend)}`,
        { context: { selection: backend, registered: this.backends } },
      );
    }
    if (!registration.isSupported(options)) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `The ${JSON.stringify(backend)} renderer is registered but reports that this environment cannot run it (§62). An explicitly named backend fails fast rather than downgrading; use renderer: "auto" to fall back.`,
        { context: { selection: backend, registered: this.backends } },
      );
    }
    const renderer = await registration.create(options);
    await renderer.initialize(options);
    // §62's required declaration, fail-fast form (WP-R1.9): a named backend
    // that initialized but cannot affirm a required capability is disposed
    // and refused — handing it back would be the silent downgrade §62
    // forbids, one sentence later than it forbids it at initialization. The
    // tri-state rule holds here too: `undefined` ("not taught to answer") is
    // not an affirmative answer, and the message says which non-answer each
    // capability gave.
    const missing = missingCapabilities(
      renderer.capabilities,
      options?.capabilities?.required,
    );
    if (missing.length > 0) {
      const detail = missing
        .map((name) => describeShortfall(renderer.capabilities, name))
        .join(", ");
      try {
        renderer.dispose();
      } catch {
        // Intentionally ignored: disposal must not mask the refusal (§83).
      }
      throw new FourError(
        SELECTION_ERROR_CODE,
        `The ${JSON.stringify(backend)} renderer initialized but does not ` +
          `affirm required capabilities: ${detail} (§62). An explicitly ` +
          'named backend fails fast rather than downgrading; use renderer: "auto" ' +
          "to fall back, or drop the requirement.",
        { context: { selection: backend, missing } },
      );
    }
    for (const capability of missingCapabilities(
      renderer.capabilities,
      options?.capabilities?.optional,
    )) {
      this.#shortfall(renderer, capability, "optional", options);
    }
    return renderer;
  }

  /** Records a skipped backend and forwards it to the §62 report callback. */
  #report(
    reports: RendererFallbackReport[],
    report: RendererFallbackReport,
    options?: RendererResolveOptions,
  ): void {
    reports.push(report);
    options?.onFallback?.(report);
  }

  /** Forwards one capability shortfall to the §62 report callback (WP-R1.9). */
  #shortfall(
    renderer: Renderer,
    capability: RendererCapabilityName,
    requirement: "required" | "optional",
    options?: RendererResolveOptions,
  ): void {
    options?.onCapabilityShortfall?.({
      backend: renderer.capabilities.backend,
      capability,
      // The record's own value, narrowed by the shortfall's definition: not
      // `true` means `false` or `undefined`, and the report keeps which.
      answer: renderer.capabilities[capability] === false ? false : undefined,
      requirement,
    });
  }
}

/**
 * The process-wide registry, created by the first {@link registerRenderer}
 * call and `undefined` until then.
 *
 * A `let` rather than an eagerly constructed instance so that a program which
 * never registers a backend never references {@link RendererRegistry} at all,
 * and the class — with the `Map`, the §62 walk, and the messages — leaves the
 * bundle. See the module header.
 */
let sharedRegistry: RendererRegistry | undefined;

/**
 * Opts `registration` into the shared registry (or into `registry`), and
 * returns the registry it went into (§62).
 *
 * Called by a backend package's own `register…` function, which is what an
 * application calls:
 *
 * ```ts
 * export function registerWebglRenderer(registry?: RendererRegistry): RendererRegistry {
 *   return registerRenderer({ backend: "webgl2", isSupported, create }, registry);
 * }
 * ```
 */
export function registerRenderer(
  registration: RendererRegistration,
  registry?: RendererRegistry,
): RendererRegistry {
  const target = registry ?? (sharedRegistry ??= new RendererRegistry());
  target.register(registration);
  return target;
}

/**
 * The backends registered in the shared registry (or in `registry`), in
 * registration order. Empty when nothing has registered.
 */
export function registeredRenderers(
  registry?: RendererRegistry,
): RendererBackend[] {
  return (registry ?? sharedRegistry)?.backends ?? [];
}

/**
 * Empties the shared registry — a **test** affordance (§92), and the reason
 * {@link RendererRegistry} exists as a constructible class for anything that
 * needs isolation in production code.
 *
 * Drops the registry itself rather than its entries, so the post-condition is
 * exactly the pre-condition of a fresh process: nothing registered, and no
 * registry.
 */
export function clearRegisteredRenderers(): void {
  sharedRegistry = undefined;
}

/**
 * Resolves `selection` against the shared registry (or `registry`) and returns
 * an **initialized** renderer (§45, §62).
 *
 * ```ts
 * registerWebglRenderer();
 * const renderer = await resolveRenderer("auto", { canvas });
 * ```
 *
 * See {@link RendererRegistry.resolve} for the selection rule; this function
 * adds only the "nothing has registered" case, which is the mistake worth its
 * own message.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` (§89) when no backend is
 * registered, when a named backend is not registered or reports itself
 * unusable, or when `"auto"` exhausts §62's order.
 */
export async function resolveRenderer(
  selection: RendererSelection,
  options?: RendererResolveOptions,
  registry?: RendererRegistry,
): Promise<Renderer> {
  const target = registry ?? sharedRegistry;
  if (target === undefined) {
    // Deliberately the shortest *actionable* message in this module. Every
    // *other* failure here is reported by `RendererRegistry`, which only
    // exists in a bundle that registered something; this one is the branch
    // every application carries, so it says the one thing that is actionable
    // and stops (§85). "Actionable" is per selection: the advice names the
    // register call for the backend that was actually asked for, because a
    // fixed `registerWebglRenderer()` is the wrong instruction for three of
    // the four rungs (cycle 9A).
    throw new FourError(
      SELECTION_ERROR_CODE,
      `Cannot select renderer ${JSON.stringify(selection)}: no backend is registered (§62). ${
        selection === "auto"
          ? "Call a backend's register function — for example `registerWebglRenderer()` from the render-webgl package — first, or pass a Renderer instance (§45)."
          : registrationAdvice(selection)
      }`,
      { context: { selection, registered: [] } },
    );
  }
  return target.resolve(selection, options);
}
