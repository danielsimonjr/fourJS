# RFC 0002: Plugin system (§81)

- **Status:** accepted (owner, 2026-08-21 — "Continue with the remaining WPs and the RFCs"; the recommended dispositions of the flagged questions are adopted)
- **Date:** 2026-08-07
- **Owner decision:** accepted (2026-08-21)
- **Spec sections affected:** §81 (primary), §6a, §37, §39, §45, §62, §76, §79, §80, §85, §89, §90, §96, §98

## Context

Gap `A-3` is filed **SILENT / High / effort L**, and its opening finding is the uncomfortable one: _"`grep -rn \"FourPlugin|PluginContext\" packages/*/src` returns **one hit**, and it is prose: `packages/serialization/src/serializer.ts:12` cites §79's 'plugins register theirs (§81)' as the justification for the component-serializer registry."_ §79 is a shipped section that **references a system that does not exist**. §98's `core` charter line — _"eventing (§6b), component model (§6a), unit system (§40), plugin host (§81)"_ — is three-quarters implemented and one-quarter absent, and no phase §103–§113a scheduled the missing quarter. `docs/COMPATIBILITY.md` §5 consequently reads _"n/a — the §81 plugin system is not implemented (gap A-3)"_, which is the one row of §90's five tables with no content.

The gap doc also records the mitigating fact that shapes this RFC: _"the **shape** §81 needs already exists in several places, independently invented — `ComponentSerializerRegistry` (§79), `SceneMigrationRegistry` (§80), the injectable `AssetLoader` value, `WidgetSkin`. A plugin host is largely a matter of unifying these behind one registration surface, not of inventing eleven new seams."_ Two more registries arrived after that was written, on 2026-08-07: the §62 `RendererRegistry` and the §37 `SolverRegistry`. The summary line is exact: _the registries §81 needs already exist independently but are ordinary package APIs._

Two constraints from 2026-08-07 bind this design tightly.

**The explicit-registration rule.** _"Explicit registration calls, never side-effect imports — forced by `\"sideEffects\": false` on all 24 packages (a side-effect module is correctly deletable). **Applies to every future registry in this repo**."_ A plugin system is the single most likely place for that rule to be quietly broken, because "import the plugin and it installs itself" is the conventional shape. It is not available here, and this RFC says so at the type level.

**§96 was staged on this RFC.** `A-23` closed §96's untrusted-content half on 2026-08-07 and left _"safe shader/plugin boundaries"_ open with the note that it depends on `A-3`. §96's table row still reads _"absent — no plugin system at all (A-3)"_. This RFC therefore owes a statement of what a "safe plugin boundary" **is** in a library that ships as npm packages — and, more importantly, an honest statement of what it is not.

## Proposed decision

### 1. A plugin is a value the application installs; it is never named by a document

```ts
export interface FourPlugin {
  /** Stable identity; the key for dependency resolution. */
  readonly name: string;
  /** The plugin's own semver, reported by diagnostics and errors. */
  readonly version: string;
  /** Other plugins that must be installed first (§81). */
  readonly dependencies?: readonly PluginDependency[];
  /** Range this plugin accepts of `PLUGIN_API_VERSION` (§81, §90). */
  readonly engineRange?: string;
  install(context: PluginContext): void | Promise<void>;
  uninstall?(context: PluginContext): void;
}

export interface PluginDependency {
  readonly name: string;
  readonly range: string;
}
```

This is §81's interface, plus the two fields §81's closing sentence requires (_"plugins shall declare dependencies and compatibility ranges"_) and did not put in the code block.

### 2. `PluginContext` is a typed capability bag, not a fixed interface — because §3.1 leaves no alternative

This is the crux, and it is forced rather than chosen. The §3.1 matrix gives `core` **no dependencies**. Every registry §81 needs to hand a plugin lives downstream of `core`:

| Registry                                                           | Package         | §3.1 wave |
| ------------------------------------------------------------------ | --------------- | --------- |
| `ComponentRegistry` (§6a)                                          | `core`          | 1         |
| `SystemRegistry` (§39)                                             | `motion`        | 3         |
| `ComponentSerializerRegistry`, `SceneMigrationRegistry` (§79, §80) | `serialization` | 3         |
| `RendererRegistry` (§62)                                           | `render`        | 3         |
| `SolverRegistry` (§37)                                             | `physics`       | 4         |

A `PluginContext` interface in `core` that names `RendererRegistry` would invert five edges of a frozen matrix. A `PluginContext` whose members are `unknown` types nothing. The resolution is a **capability token** declared by the package that owns the registry, with `core` owning only the token machinery:

```ts
// @fourjs/core — knows nothing about what T is.
declare const capabilityBrand: unique symbol;
export interface PluginCapability<T> {
  readonly name: string;
  readonly [capabilityBrand]?: T;
}
export function defineCapability<T>(name: string): PluginCapability<T>;

export interface PluginContext {
  /** The capability, or `undefined` when this host does not provide it. */
  get<T>(capability: PluginCapability<T>): T | undefined;
  /** The capability, or a §89 `INVALID_APPLICATION_STATE` naming it (§85). */
  require<T>(capability: PluginCapability<T>): T;
  /** Every capability name this host provides, in insertion order (§33). */
  readonly capabilities: readonly string[];
  /** Installed plugins, in install order. */
  readonly plugins: readonly FourPlugin[];
}
```

Each owning package exports its token beside its registry — one line each, no new edge anywhere:

```ts
// @fourjs/render
export const RENDERER_REGISTRY = defineCapability<RendererRegistry>(
  "fourJS:renderer-registry",
);
// @fourjs/physics
export const SOLVER_REGISTRY = defineCapability<SolverRegistry>(
  "fourJS:solver-registry",
);
// @fourjs/serialization
export const COMPONENT_SERIALIZERS =
  defineCapability<ComponentSerializerRegistry>("fourJS:component-serializers");
export const SCENE_MIGRATIONS = defineCapability<SceneMigrationRegistry>(
  "fourJS:scene-migrations",
);
// @fourjs/motion
export const SIMULATION_SYSTEMS = defineCapability<SystemRegistry>(
  "fourJS:simulation-systems",
);
```

A plugin gets exact types (`context.require(RENDERER_REGISTRY)` is a `RendererRegistry`, checked by the compiler) while `core` names nothing but a string and a phantom type parameter. A plugin that needs a capability the host does not provide fails **at install**, loudly, naming the capability — which is how the eleven extension points that are not yet real become honest staging rather than silent no-ops.

### 3. The eleven §81 extension points, against what exists today

This table is the substance of the RFC; the interface above is bookkeeping around it.

| §81 extension point        | Capability in the MVP host                              | State                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderer backends          | `RENDERER_REGISTRY` (§62)                               | **real** — shipped 2026-08-07; a plugin calls `registerRenderer` through it                                                                                                                                                 |
| physics solvers            | `SOLVER_REGISTRY` (§37)                                 | **real** — shipped 2026-08-07                                                                                                                                                                                               |
| serialization types        | `COMPONENT_SERIALIZERS` + `SCENE_MIGRATIONS` (§79, §80) | **real** — this is the point `serializer.ts:12` was already written against                                                                                                                                                 |
| animation systems          | `SIMULATION_SYSTEMS` (§39)                              | **real** — an animation system _is_ a `SimulationSystem`; `AnimationSystem` already registers there                                                                                                                         |
| diagnostics                | `SIMULATION_SYSTEMS` + the §84 stats seam               | **real, partial** — a plugin can register a system and read `FrameStats`; there is no diagnostics _provider_ registry, and `debugDrawStreams` is a duck-typed sink, not a registry                                          |
| asset formats              | —                                                       | **absent by design today** — `asset-manager.ts:262` states it: _"no registry, no side-effectful registration"_; a loader is an injected value. The token would have nothing to hand over                                    |
| render passes              | —                                                       | **absent** — `RenderGraph` (R-5) is an object the application builds per frame-configuration, not a registry of pass kinds. A `RENDER_GRAPH` token could hand over _the app's graph_, which is a different and weaker thing |
| materials and shader nodes | —                                                       | **absent** — RFC 0001 ships a node-material _graph_ (data a plugin can construct like any application) but keeps the operator union closed; supplying a new **node kind** is that RFC's deferred alternative E              |
| UI controls                | —                                                       | **absent** — §73 widgets are classes an application constructs; `WidgetSkin` is injectable but per-widget. There is nothing to register into                                                                                |
| editor tools               | —                                                       | **absent** — no editor exists                                                                                                                                                                                               |
| compute workloads          | —                                                       | **absent** — §82 is WebGPU-only and `render-webgpu` is a reserved stub                                                                                                                                                      |

**Five real, one partial, five absent.** The MVP host provides the five-and-a-partial and provides _no token at all_ for the rest, so a plugin asking for them gets a precise refusal. Adding a token later is additive and needs no change here — which is the main practical argument for the token design over a fixed interface, where each absent point would have to be an `undefined`-valued member from day one.

### 4. `PluginHost`: ordering, lifecycle, and the honest limits of `uninstall`

```ts
export class PluginHost {
  constructor(capabilities?: PluginCapabilityMap);
  provide<T>(capability: PluginCapability<T>, value: T): this;
  add(plugin: FourPlugin): this;
  /** Resolves order, checks ranges, then awaits each `install` in order. */
  install(): Promise<void>;
  uninstall(name: string): void;
  readonly context: PluginContext;
}
```

- **Install order is topological over `dependencies`, ties broken by `add` order.** A cycle raises `INVALID_APPLICATION_STATE` naming the cycle. Uninstall order is the reverse.
- **`install` may be async**, which is exactly why it cannot run in a constructor — §81 types it `void | Promise<void>` and §45's lifecycle has `initialize` for precisely this. Installation happens there.
- **Registration is only legal during `install`.** The context is a live object, so nothing can _mechanically_ stop a plugin holding it and registering later; this is stated as the contract and checked where it is cheap (the host marks the context sealed after `install()` completes and registries that gained an `isSealed`-aware wrapper refuse writes). The MVP ships the contract plus one wrapper (`SIMULATION_SYSTEMS`) and does not claim more.

**Uninstall is not symmetric, and the design says so instead of pretending.** The registries that exist have different removal stories: `SystemRegistry.register` returns an idempotent `Unregister`; `registerRenderer`/`registerSolver` return the registry and offer **no** unregister; `ComponentSerializerRegistry.register` _throws on duplicate_ deliberately, because _"a silent overwrite would make the shape of a document depend on module evaluation order"_, and has no removal at all. Making every registry revocable is a large retrofit that would also re-open the exact hazard the duplicate-throw exists to close.

Decision: **capabilities declare revocability, and a plugin that wrote into a non-revocable capability cannot be uninstalled.**

```ts
export function defineCapability<T>(
  name: string,
  options?: { readonly revocable?: boolean }, // default false
): PluginCapability<T>;
```

`uninstall(name)` on such a plugin raises `INVALID_APPLICATION_STATE` naming the capability that pins it, rather than running the plugin's `uninstall` and leaving a half-removed registration behind. This follows the repository's own contrast rule (`removeCollider` returns `false`, `addCollider` throws — _"a silent no-op refresh is invisible"_). It also means §81's `uninstall?` is optional in practice as well as in the type: for most plugins the honest lifecycle is install-once.

### 5. Compatibility ranges, and the §90 row they fill

`@fourjs/core` exports a `PLUGIN_API_VERSION` constant, versioned **independently of package semver**, in the way §80 makes the scene format version independent of it. `FourPlugin.engineRange` is matched against it at install; a mismatch refuses the plugin with both numbers in `context`.

The matcher is **deliberately restricted**: `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z`, `X.Y.Z`, and `*`. Anything else is rejected at install with a message saying the grammar is restricted. Taking a semver dependency into `@fourjs/core` — the package every other package depends on — to serve a feature nothing uses yet is not a trade worth making, and silently mis-parsing a range a user believed was supported is worse than refusing it. This is the same stance `A-23` took on limits (_"a limit defaulting to `Infinity` is documentation, not a limit"_): say what is enforced.

This closes `docs/COMPATIBILITY.md` §5, replacing _"n/a"_ with a real row: plugin API version, the packages that participate, and the restricted range grammar.

### 6. §96 "safe shader/plugin boundaries", stated exactly

A plugin is JavaScript the application imported. It runs with the application's authority. **This RFC does not propose a sandbox, and no part of it should be read as providing one.** Isolation would mean Workers or realms plus a serialisable message boundary for every registry above, which is a project in itself and would change every capability's shape.

What §96 actually demands here is narrower and fully achievable, and it is the rule this RFC enforces:

> **Untrusted content can never become a plugin.** `PluginHost.add` accepts a plugin _object_ only — never a URL, never a module specifier, never a name resolved out of a document. No deserialization path may reach the plugin host.

Concretely: §79's _"components (§6a) serialize under registered type names; plugins register theirs (§81)"_ means a document names a **type name that is already registered**, and the unknown-component path stays data-only (`unknownComponents: "skip"` / preserve). A document that names an unregistered type gets the existing error; it does not trigger a load.

This is mechanically enforceable and must be enforced, in the style `A-23` established for the CSP claim (_"the CSP claim is enforced, not asserted"_) and `A-2` for the units allowlist (a test that forbids any package outside `@fourjs/core` from importing it). The packet ships `tests/integration/plugin-boundary.test.ts` asserting that no module reachable from `@fourjs/serialization` or `@fourjs/assets` imports the plugin host, and that `PluginHost.add`'s parameter type admits no string.

The second half of §96's phrase — _safe **shader** boundaries_ — is answered by RFC 0001, not here: shading is a graph of closed operators, so a plugin supplying shading supplies data, and a plugin supplying a _new operator_ is explicitly out of scope in both RFCs. That pairing is what lets `docs/GAP ANALYSIS v0.md`'s §96 table row move from _absent_ to _addressed_.

### 7. What the MVP packet ships and what it defers

**Ships.** `packages/core/src/plugin.ts` (`FourPlugin`, `PluginCapability`, `defineCapability`, `PluginContext`, `PluginHost`, `PLUGIN_API_VERSION`, the restricted range matcher); five capability tokens exported from their owning packages; `Application` growing plugin installation in `initialize()` (see Open question 1); the §90 compatibility row; the §96 boundary test; the sealing wrapper for `SIMULATION_SYSTEMS`.

**Defers.** Any sandbox. Tokens for the five absent extension points — each arrives with the registry it needs, and the absence is the honest signal that the registry is missing. Hot reload / re-install. Making the renderer, solver, and serializer registries revocable. A plugin _manifest_ format (a plugin is a value; a manifest is a document, and documents are the thing §96 keeps away from the host).

## Alternatives

**A. A fixed `PluginContext` interface in `@fourjs/core` naming each registry.** The shape §81's own code block implies. It loses on §3.1: `core` has no dependencies and five of the six registries live downstream. Working around it (`unknown` members, structural duck types, or a `core`-side re-declaration of each registry's shape) either destroys the typing that makes a plugin worth writing or creates five duck-typed contracts to maintain — and the repository already tracks five such contracts as a known cost, deliberately, one at a time.

**B. Move the registries into `@fourjs/core`.** Makes A work. It loses immediately: `RendererRegistry` exists to hold `RendererRegistration`s whose `create` returns a `Renderer` — a `render` type. Hoisting the registry hoists the type, and the whole §62 design (_"nothing here imports a backend, at type level or at runtime"_) depends on the registry living where the interface lives. The same argument holds for `SolverRegistry` and `PhysicsCapabilities`.

**C. Side-effect registration: `import "@fourjs/some-plugin/install"`.** Conventional and ergonomic. It is **unavailable**, not merely disfavoured: all 24 packages declare `"sideEffects": false`, so a side-effect module is _correctly_ deletable by any bundler that believes the manifest, and the plugin would fail at runtime with "nothing is registered". The two escapes — carving exceptions into every plugin's `sideEffects` field, or dropping the field — were both examined and rejected on 2026-08-07 for the §62 registry, and the reasoning transfers unchanged.

**D. Plugins named in the scene document (`"plugins": ["@vendor/thing"]`), resolved at load.** The feature users eventually ask for, and the thing §96 exists to forbid: it is arbitrary code execution from a scene file, in the plainest possible form. Rejected without a staging note, because staging it would imply it is coming.

**E. Do nothing; keep the registries as ordinary package APIs.** Defensible on cost — the registries _work_, and an application can call all five today. It loses on three counts: §79 already promises §81 in shipped prose; §90's plugin-API row cannot be filled without an API to version; and there is no cross-cutting identity, ordering, or compatibility check, so two extensions that must install in a particular order have no way to say so. It is, however, the alternative with the best cost-to-value ratio if the owner's answer to Open question 1 is "not yet" — and that should be said plainly rather than argued away.

**F. Make `uninstall` work by retrofitting every registry with removal.** Cleanest semantics. It loses on scope (five registries, each with its own duplicate/ordering rules) and on one real hazard: `ComponentSerializerRegistry`'s duplicate-throw exists so document shape cannot depend on evaluation order, and adding removal re-opens the door to a document written by one registry state and read by another.

## Consequences

**Easier.** `A-23`'s remaining §96 row gets an answer. `docs/COMPATIBILITY.md`'s one empty table gets content. §79's forward reference stops being a promise the repository cannot keep. A third-party backend or solver acquires a documented way to ship as one installable unit with a compatibility declaration, rather than as five call sites in an application's bootstrap.

**Harder.** `@fourjs/core` grows a module that every package transitively carries; the host must earn its bytes, and the packet must measure the delta for an application that installs no plugins (the target is that `PluginHost` tree-shakes entirely out of such a bundle, by the same discipline `resolveRenderer` uses — nothing on the hot path may statically reference it). The capability-token indirection is one more concept for a reader, and its payoff is invisible until the second capability. And the RFC commits to saying "absent" eleven times in a public table, which is the correct state and an awkward first impression.

**Committed to.** A plugin is a value; documents never name modules; registration happens during `install`; install order is deterministic; and a plugin whose registrations cannot be revoked cannot be uninstalled.

## Compatibility analysis

- **Plugin API versions (§90/§81).** This RFC _creates_ the row. `PLUGIN_API_VERSION` starts at `1.0.0` and is versioned independently of the packages, like the §79 scene format.
- **Public API (§90).** Additive: new exports from `@fourjs/core` and one capability token from each of `render`, `physics`, `serialization`, `motion`. `ApplicationOptions` gains one optional member (Open question 1). No existing signature changes; **minor** throughout.
- **Scene format versions (§79).** Unmoved, and deliberately: this RFC's §96 rule is precisely that the format gains nothing plugin-shaped.
- **Solver adapters.** Untouched — `physics-rapier` continues to call `registerRapierSolver()`; whether it _also_ ships a `FourPlugin` wrapper is an application-facing convenience, not an adapter change. No regeneration of the generated block in `docs/COMPATIBILITY.md` is needed.
- **Browser support / feature tiers.** Unmoved.

**Determinism (§33).** The non-obvious implication, and the one worth stating loudly: **install-order nondeterminism becomes simulation-order nondeterminism.** A plugin registers a `SimulationSystem`, and `SystemRegistry` sorts by `(priority, registration order)` — so two plugins registering systems at equal priority produce different fixed-step orders depending on which installed first. Therefore install order is a _specified_ property, not an emergent one: topological over declared dependencies, ties broken by `add` order, never by `Map` enumeration or by name sort. §33's rule (_"must not derive behavior from object-key enumeration or `Set`/`Map` ordering beyond insertion order"_) applies to the host's own bookkeeping, and the packet must include a determinism test that installs the same plugin set in two orders and asserts the resulting fixed-step transcript differs **only** where declared dependencies permit it. Capability lookup is by key and never enumerated for behaviour; `PluginContext.capabilities` is provided in insertion order for diagnostics only.

## Prototype / benchmark

None run. What the packet must measure:

1. **Zero cost when unused.** An application that installs no plugins must not carry `PluginHost`; prove it by grep over the example bundles, as the §62 registry packet did. If `Application.initialize` statically references the host, this fails — the resolver must be the same lazily-created-module-`let` shape.
2. **Install-order determinism**, as above: two orders, one transcript comparison.
3. **The §96 boundary test** is a gate, not a benchmark, and is listed under Ships.

## Open questions

1. **`ApplicationOptions.plugins`: addition or invention?** `A-3`'s closure plan says _"`Application` grows `plugins` and installs during `initialize()`"_. But on the same day, the §40 packet recorded the opposite instinct as a decision: _"**No `ApplicationOptions.units`, no `PhysicsWorldOptions.units`** — §45's record lists neither; adding one would be inventing API."_ §45's `ApplicationOptions` block does not list `plugins`. These cannot both stand. Three ways out, and the owner picks: (a) amend §45's record to include `plugins?: readonly FourPlugin[]` (a spec amendment, recorded in the amendments table); (b) keep `PluginHost` standalone and let applications call it before `initialize()`, adding nothing to §45 — cheapest, and leaves §81's async-install lifecycle to the application; (c) accept the departure with a dated note. **Recommendation: (a).** §81 is a spec section that requires an install lifecycle, §45 owns the lifecycle, and the units precedent turned on `units` being _absent from the spec's own list for §45_ — whereas §81 exists and has nowhere else to live. But this is exactly the kind of consistency call the owner should make rather than an agent.
2. **Is `A-3` worth doing now at all?** Alternative E is real. Five extension points work today as ordinary APIs; the plugin layer adds identity, ordering, and versioning, and defers five of eleven points as absent. If the answer is "not until two of the absent points are real", say so and this RFC becomes a recorded deferral with the capability design already decided — which is still worth having.
3. **Revocability defaults.** This RFC defaults capabilities to non-revocable and makes `uninstall` refuse. The alternative default (revocable, with each registry gaining removal) is more useful and much more work. Confirm the conservative default.
4. **Does the `RENDER_GRAPH` token belong in the MVP?** Handing a plugin the application's `RenderGraph` is not the same as §81's "render passes" extension point (there is no pass _registry_), but it is the only useful thing available and is what a post-processing plugin would actually want. Include it as a real-but-differently-shaped capability, or leave "render passes" absent until a pass registry exists?
5. **Plugin API version starting point and cadence.** `1.0.0` implies a stability promise for a surface with five of eleven points unimplemented. `0.1.0` is more honest and makes every range in the wild `^0.1`, which under semver means "no compatible range at all". Owner call.

## Post-acceptance corrections (2026-09-10 review pass)

Decision text left as accepted (2026-08-21; implemented 2026-08-28). Verified
against the tree 2026-09-10:

- **§2's token table ("five real, one partial, five absent").** As of
  2026-09-06 **all eleven** §81 points have a token: the six of the landing
  packet (`RENDER_GRAPH` included — Q4 adopted "include") plus
  `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS`,
  `COMPUTE_WORKLOADS` with minimal registries (`packages/fourjs/src/plugins.ts:13-25`).
  The "Defers: tokens for the five absent points" line is closed; the
  revocability deferral (only `SIMULATION_SYSTEMS` is revocable) still holds.
- **`constructor(capabilities?: PluginCapabilityMap)`.** Shipped as an
  **ordered list**, `readonly PluginCapabilityBinding[]` built with
  `bindCapability()` (`packages/core/src/plugin.ts:181-199`), so the order
  capabilities are provided is a property of the value (§33).
- **"`PLUGIN_API_VERSION` starts at `1.0.0`".** Q5's recommendation was
  adopted: it starts at **`0.1.0`** (`plugin.ts:60`; `docs/COMPATIBILITY.md`
  §5), where a caret range is minor-locked.
- **"five capability tokens exported from their owning packages".** Six at
  landing, eleven now. Tokens moved to their owning packages 2026-08-29; the
  umbrella's `plugins.ts` re-exports the same objects.
- **"one capability token from each of render, physics, serialization,
  motion".** `serialization` always had two (`COMPONENT_SERIALIZERS`,
  `SCENE_MIGRATIONS`), as this RFC's own list says.
- **Boundary test.** `tests/integration/plugin-boundary.test.ts` now splits
  host machinery (banned outside core/umbrella) from token *declaration*
  (`defineCapability`, allowed in owning packages, dated).
- Verified consistent: token name strings (`fourJS:…`), the restricted range
  grammar, `defineCapability`'s non-revocable default, `ApplicationOptions.plugins`
  (Q1 option a), spec revision 1.9.
