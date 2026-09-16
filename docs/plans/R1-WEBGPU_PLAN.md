# R-1 — the WebGPU backend: tiered plan

**Status:** plan only, no implementation. Written 2026-08-21 against branch
`claude/tools-integration-rji2sr` (tip `aa8a706`).
**Scope:** gap `R-1` (§62 second backend), carrying `R-31` (§82 compute / GPU particles) and
entangled with RFC 0001 (`R-14`).
**Format:** the house work-packet format of
[`docs/plans/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §2. Ground rules §1 of that
file apply verbatim to every packet below.

`R-1` was filed when `packages/render/src/` held an interface and little else. It is re-read
here against the interface **as it stands today**: seven compiled pipelines, three resource
caches, a batching planner, a per-view list builder, a render graph, an effects pass, a
registry, and a statistics seam. The gap is no longer "write a renderer"; it is "satisfy a
seam that a first backend has already shaped", and the plan's first job is to say honestly
which parts of that seam are backend-independent (most of them) and which encode WebGL
(fewer than expected, but not zero).

---

## 1. Executive summary

|                             |                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Can CI run WebGPU?**      | **Yes.** Measured in this container: headless Chromium 141 (both the full binary and `headless_shell`) with the single flag `--enable-unsafe-webgpu` yields a SwiftShader adapter, a device, a WGSL render pipeline, render-to-texture, `mapAsync` readback (`[0,255,0,255]`), **and** a compute pipeline with storage buffers (`[0,2,4,6]`). §2 has the transcript. |
| **Honest evidence tier**    | Two tiers, both real: **unit** — a fake `GPUDevice` command-encoder transcript (the twin of `tests/integration/helpers/recording-gl.ts`); **browser** — a real SwiftShader WebGPU gate in `tests/browser`, with pixel goldens confined to a WebGPU-vs-WebGPU `visual` project.                                                                                       |
| **Determinism claim (§33)** | Pixel-identity between WebGL and WebGPU is **not claimable** and must never be asserted. The shared invariant is _render-list consumption_: both backends consume byte-identical render lists and batches. Transcript identity stays per-backend. §5.                                                                                                                |
| **Blocking dependency**     | RFC 0001 (`R-14`) is a **soft** blocker, not a hard one. Its own compatibility table defers WGSL generation _because_ there is no WebGPU backend — a circular wait. The resolution: W-1…W-7 hand-port the seven pipelines to WGSL (the same thing the GL backend did), and RFC 0001's emitter arrives afterwards as a **second** WGSL producer. §7.                  |
| **Total effort**            | **L**, ~9 packets, roughly the size of phases 3–7 of the original plan taken together. Do not attempt as one packet.                                                                                                                                                                                                                                                 |
| **Owner gates**             | four questions, §9. The sharpest: registering the backend at all silently changes `renderer: "auto"` for every application, because `AUTO_RENDERER_ORDER` already lists `"webgpu"` first.                                                                                                                                                                            |

---

## 2. Environment reality — the probe, and what it proves

### 2.1 What was run

A throwaway Node script under the session scratchpad (never committed) launched the
pre-installed browsers from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` via the repo's own
Playwright 1.57, navigated to a locally served `http://localhost` page, and executed a
minimal WebGPU workload in the page.

### 2.2 Results

| flags                                                                                               | binary           | `navigator.gpu` | adapter                            | WGSL draw + `mapAsync` | compute + storage buffer |
| --------------------------------------------------------------------------------------------------- | ---------------- | --------------- | ---------------------------------- | ---------------------- | ------------------------ |
| _(none)_                                                                                            | `chromium`       | present         | **null**                           | —                      | —                        |
| _(none)_                                                                                            | `headless_shell` | present         | **null**                           | —                      | —                        |
| `--enable-unsafe-webgpu`                                                                            | `chromium`       | present         | **yes** (`google` / `swiftshader`) | `[0,255,0,255]`        | `[0,2,4,6]`              |
| `--enable-unsafe-webgpu`                                                                            | `headless_shell` | present         | **yes**                            | `[0,255,0,255]`        | `[0,2,4,6]`              |
| `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --disable-vulkan-surface` | both             | present         | yes                                | pass                   | pass                     |
| repo's current `--use-gl=angle --use-angle=swiftshader` **plus** the above                          | both             | present         | yes                                | pass                   | pass                     |

Four facts fall out, each of which changes a decision below.

1. **`--enable-unsafe-webgpu` alone is sufficient.** The extra Vulkan/SwiftShader flags are
   redundant here — Dawn already resolves `libvk_swiftshader.so`, which ships inside both
   browser trees (`/opt/pw-browsers/chromium-1194/chrome-linux/libvk_swiftshader.so`). The
   plan's `launchOptions.args` addition is therefore **one flag**, not a flag soup.
2. **The flag is required.** Without it `navigator.gpu` exists but `requestAdapter()`
   resolves `null`. A backend probe (`isWebgpuSupported`) that only tests for
   `navigator.gpu` would answer `true` in a browser that cannot produce an adapter — see
   §6.2, this is a real design consequence.
3. **A real origin is required.** The first probe round ran against `about:blank` and
   reported `navigator.gpu` **absent**; the same browser on `http://localhost` reported it
   present and working. Any future probe page must be served, not `page.setContent`-ed into
   an opaque origin. (Recorded because it cost a probe round and will cost a packet a day.)
4. **Adding the flag does not disturb the WebGL gate.** With
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-webgpu` set together, a
   `webgl2` context still initialises and reports `WebGL 2.0 (OpenGL ES 3.0 Chromium)`.
   The existing nine browser sites are unaffected; the flag can be added globally in
   `playwright.config.ts` rather than per-project.

### 2.3 What it does **not** prove

- **Node has no WebGPU.** `globalThis.navigator.gpu` is `undefined` under Node 22.22. Every
  Vitest-tier test is therefore against a **double**, exactly as the WebGL backend's unit
  tests are against `WebglContext` implementations. There is no `@webgpu/...` polyfill in
  §3.2's pin set and none may be added (ground rule 7).
- **Nothing about a real GPU.** SwiftShader's Dawn backend is a software rasteriser with its
  own limits (no timestamp queries, conservative feature set). `RendererCapabilities` values
  read in CI are SwiftShader's, not a claim about hardware, and any test asserting a
  capability _value_ rather than its _shape_ is a test that will break on someone's laptop.
- **Nothing about performance.** `benchmarks/` rows that say "GPU-blocked" (`R-39`'s mesh
  instances, animated-glyph submission) do not unblock on SwiftShader; a software rasteriser
  measures the CPU path again, under a different name. Say so rather than harvesting a
  misleading number.

### 2.4 The CI shape this implies

```ts
// playwright.config.ts — use.launchOptions.args
args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-webgpu"],
```

plus a third Playwright project, `webgpu`, whose `testDir` is `tests/browser/webgpu` and
whose specs **skip themselves** when `requestAdapter()` returns null — so a contributor on a
machine or browser without WebGPU gets a skip, not a red suite. The
skip-when-absent shape is the only honest one for a gate that depends on a browser flag.

---

## 3. §62's promises, quoted, against what is achievable

§62 says, in full, of the backend list and selection:

> Supported backends: 1. WebGPU; 2. WebGL 2; 3. Canvas 2D; 4. SVG; 5. headless/software
> extension.
> `renderer: "auto"` — Automatic selection should prefer WebGPU, then WebGL 2, then an
> appropriate 2D backend. If WebGPU initialization fails at runtime under `"auto"`, selection
> falls back to WebGL 2 and emits a diagnostics event; an explicit `renderer: "webgpu"` fails
> fast with `RENDERER_INITIALIZATION_FAILED` (§89) rather than silently downgrading.

and of capabilities:

> Capability reporting shall include: maximum texture dimensions; texture formats;
> multisampling; floating-point targets; timestamp queries; storage buffers; compute shaders;
> indirect draw; compressed textures; shader precision; maximum uniforms and bindings.
> Applications may declare required and optional capabilities.

### 3.1 Promise-by-promise

| §62 promise                                                                                                                                                                              | Status against today's code                                                                                                                               | Verdict                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU is a supported backend                                                                                                                                                            | `packages/render-webgpu/src/index.ts` is one line: `export const PACKAGE_NAME`.                                                                           | **This plan.**                                                                                                                                                       |
| `"auto"` prefers WebGPU                                                                                                                                                                  | `AUTO_RENDERER_ORDER = ["webgpu","webgl2","canvas2d","svg"]` — **already written**, already tested against doubles.                                       | **Free.** Registering the backend is all that is needed — which is precisely the hazard (§9 Q1).                                                                     |
| Fallback on init failure + diagnostics event                                                                                                                                             | `RendererRegistry` already implements it: `RendererFallbackReport { backend, reason: "unsupported" \| "initialization-failed", error }` via `onFallback`. | **Free**, and its upper rungs finally get exercised by a real second backend (this is `R-2`'s open half).                                                            |
| Explicit `"webgpu"` fails fast with `RENDERER_INITIALIZATION_FAILED`                                                                                                                     | Registry throws for explicit selections.                                                                                                                  | **Free.**                                                                                                                                                            |
| maximum texture dimensions                                                                                                                                                               | `RendererCapabilities.maxTextureSize` exists.                                                                                                             | **Free** (`device.limits.maxTextureDimension2D`).                                                                                                                    |
| texture formats, multisampling, floating-point targets, timestamp queries, storage buffers, compute shaders, indirect draw, compressed textures, shader precision, max uniforms/bindings | **None of these exist on `RendererCapabilities`**, which today has exactly two members (`backend`, `maxTextureSize`).                                     | **Design work, shared-interface change.** See §3.3 — this is the single largest _interface_ consequence of R-1 and it lands in `@fourjs/render`, not in the backend. |
| "Applications may declare required and optional capabilities"                                                                                                                            | No `requiredCapabilities` / `optionalCapabilities` anywhere in `RendererOptions`.                                                                         | **Deferred by decision**, packet W-9. A declaration mechanism over a two-member capability record is theatre.                                                        |

### 3.2 What maps cleanly (backend-independent, no new design)

These are the parts a second backend gets for free, and the reason R-1 is L rather than XL:

- **Per-view render lists.** `buildRenderList` / `buildViewRenderList` /
  `sortRenderListByDepth` / `viewLayerMask` / `groupRenderListByPipeline` live in
  `@fourjs/render` and name no GL symbol. A WebGPU backend consumes the identical
  `RenderItem[]`.
- **The batching planner.** `RenderBatcher` (`packages/render/src/batch.ts`, 700 lines) is a
  pure planner producing `RenderBatch` records; `gl-batch.ts`'s `GlBatching` is only the
  _uploader_ behind the `RenderBatching` interface. **A `wgpu-batch.ts` is a twin of
  `gl-batch.ts`, not of `batch.ts`** — buffer creation and `queue.writeBuffer` replacing
  `bufferData`/`bufferSubData`. This is the single best-factored seam in the render tier.
- **Lights.** `collectSceneLights` / `SceneLights` / `MAX_PUNCTUAL_LIGHTS` are CPU-side
  collection; only the uniform _upload_ is per-backend, and WebGPU's is a uniform buffer
  rather than `uniform3fv` calls — strictly simpler.
- **Particles.** `particleQuadGeometry`, `PARTICLE_INSTANCE_FLOATS` and the instance-buffer
  layout constants are in `@fourjs/render`; the CPU simulation is `@fourjs/particles`.
- **Render targets and textures as CPU descriptors.** §61's recorded design —
  _"both `Texture` and `RenderTarget` exist as CPU-side descriptors carrying an id and a
  version, with GPU residency held in a backend-owned cache keyed by that id"_ — is the
  design that makes a second backend cheap. `GeometryCache`, `TextureCache`,
  `RenderTargetCache` are three instances of one pattern; W-2 writes the WebGPU instances.
- **Statistics.** `RenderStatisticsReporter` is optional-member-as-capability
  (`supportsRenderStatistics`); the WebGPU backend implements the same optional member.
- **Effects descriptors.** `ScreenEffect` is a closed union of `copy` / `grade` /
  `output-transform`; the descriptor is backend-independent, only the fragment stage is not.
- **Context/device loss.** §61 makes device loss first-class and names WebGPU explicitly.
  WebGPU's `device.lost` promise is a _better_ fit than WebGL's event pair, and the
  drop-the-cache recovery is already the recorded design.

### 3.3 What needs design (and where the design lands)

1. **`RendererCapabilities` widening (§62's eleven fields).** This is an _interface_ change
   in `@fourjs/render`, affecting `NullRenderer`, `WebglRenderer`, every test double and any
   third-party backend. It must be additive-with-defaults or it is a breaking change for
   implementors — the same hazard §61 already records about adding interface members.
   Recommended shape: a flat readonly record with conservative values that `NullRenderer`
   and `WebglRenderer` can answer honestly (`computeShaders: false`, `storageBuffers: false`,
   `timestampQueries: false` on WebGL 2 — all true statements). **Do this once, in W-1**,
   not incrementally; a capability record that grows a field per packet churns three
   implementors nine times.
2. **`initialize()` finally earns its `Promise`.** `Renderer.initialize` is typed
   `Promise<void>`; `WebglRenderer` fulfils it synchronously
   (`#initializeSynchronously`). WebGPU cannot: `requestAdapter` and `requestDevice` are
   genuinely async. The registry already `await`s. The consequence to check in W-1 is every
   _caller_ that assumed synchronous completion — notably any test that constructs a
   renderer and renders in the same tick.
3. **The §63 graph.** `RenderGraph` today executes passes eagerly in insertion order
   (`execute(renderer, interpolation?)` walks `#passes`), with `validate()` doing static
   feedback/resource checks. §63's _"barriers and state transitions"_ and _"transient render
   targets"_ are unimplemented on both backends. WebGPU makes barriers implicit (the
   command encoder infers them) and makes transient targets natural, so the temptation is to
   implement graph features _inside_ the WebGPU backend. **Refuse that.** A graph feature
   that exists on one backend is a scene that renders differently per backend, which is the
   one thing §62's tiers exist to prevent. Transient-target pooling is filed as a
   `@fourjs/render` follow-up (`R-5`'s territory), not part of R-1.
4. **Effects passes.** `renderEffect` is one full-screen triangle through one of three
   descriptors. On WebGPU this is a render pass with a `loadOp: "clear"`-free single draw —
   mechanically simpler than the GL version's state save/restore, because a WebGPU render
   pass has no ambient state to corrupt. The design question is only _pipeline caching_
   keyed by (effect kind × target format).
5. **`readPixels` / RFC 0005.** §61 types `readPixels?` and both backends stage it. WebGPU's
   answer is `copyTextureToBuffer` + `mapAsync` (probe-verified above), which is exactly what
   RFC 0005 §"asynchronous API" argues the public shape must be. **R-1 should ship
   `readPixels` on WebGPU** — it is ~40 lines against a probe-verified path, and it is the
   evidence RFC 0005's async-forever commitment is right rather than merely argued. It needs
   `Rectangle2` in `@fourjs/math` (RFC 0005's named prerequisite); if that has not landed,
   ship the whole-target form and leave `region` unimplemented rather than inventing a type.
6. **Stencil.** `RenderTargetOptions.stencil` is documented in terms of WebGL 2's packed
   `DEPTH24_STENCIL8` renderbuffer — _"the backend allocates the packed `DEPTH24_STENCIL8`
   renderbuffer WebGL 2 guarantees is framebuffer-complete"_, and stencil is made
   **mutually exclusive with `depthTexture`** for that reason. WebGPU's equivalent is
   `depth24plus-stencil8`, and the _same_ exclusivity holds (a combined aspect cannot be
   sampled as depth in the general case), so **the constraint survives the port for a
   different reason**. Record that: a constraint that two backends reach independently is a
   design, not an accident. `depthTexture` maps to `depth32float` / `depth24plus` per §62
   tier.
7. **Colour space.** §60a: _"lighting and blending run in linear space on WebGPU and WebGL 2;
   the output transform … is the final render-graph pass"_. WebGPU's canvas configuration
   takes an explicit `format` (`bgra8unorm` is the preferred canvas format on most hosts,
   **not** `rgba8unorm`). `RenderTargetFormat` today is the single-member union `"rgba8"`
   with a `validateFormat` that throws otherwise. The backend must not widen that union to
   describe its swapchain; the swapchain format is internal, and the descriptor stays
   `"rgba8"` meaning "eight-bit unsigned normalised colour", with channel order a backend
   detail. Write that sentence into the backend's module header — it is the kind of thing a
   later reader will otherwise "fix".
8. **Winding and clip space.** MEMORY records _"projection mirrors winding — free while the
   WebGL backend keeps `CULL_FACE` disabled"_. WebGPU's NDC depth range is **[0,1]**, not
   GL's [-1,1], and its framebuffer origin is top-left. Two consequences: the projection
   matrices produced by `@fourjs/math` are GL-convention and need a depth remap on WebGPU
   (either a fixed pre-multiply in the backend or a per-pipeline `clip-space` flag), and any
   future `CULL_FACE` enablement must be decided for both backends at once. **The depth
   remap belongs in the backend**, applied once when writing the view uniform buffer — the
   math package must not learn about backends (§3.1 matrix).

---

## 4. Pipeline inventory and WGSL port order

The GL backend's actual pipeline set, from source:

| #   | GL pipeline       | file              | what it draws                                                                |
| --- | ----------------- | ----------------- | ---------------------------------------------------------------------------- |
| 1   | `UnlitProgram`    | `gl-program.ts`   | §64 unlit items; `useMap` / `useVertexColors` variants folded in as uniforms |
| 2   | `SpriteProgram`   | `gl-program.ts`   | §55 sprites (and the batched sprite/glyph path)                              |
| 3   | `LitProgram`      | `gl-program.ts`   | §68 Lambert + punctual lights + shadow sampling                              |
| 4   | `StandardProgram` | `gl-standard.ts`  | §59 Cook-Torrance GGX/Smith/Schlick, base-colour-map tier                    |
| 5   | `ParticleProgram` | `gl-particles.ts` | §26 instanced quads                                                          |
| 6   | `ShadowProgram`   | `gl-shadow.ts`    | §69 depth-only shadow pass                                                   |
| 7   | `EffectProgram`   | `gl-effect.ts`    | §70 full-screen triangle                                                     |

Supporting: `GeometryCache`, `TextureCache`, `RenderTargetCache`, `GlBatching`,
`PunctualLightUniforms`, `ShadowUniforms`, and the CPU **state mirrors** in
`webgl-renderer.ts` seeded at GL-initial values.

### 4.1 Port order, and why

**unlit → sprite (text rides it) → shape/vertex-colour (rides unlit) → lit → standard →
particles → shadow → stencil parity → effects → compute.**

The order is dictated by three things, in this priority: (a) what the _fake-device transcript
harness_ can prove with least ceremony (unlit first — one pipeline, one uniform buffer, one
draw); (b) what the browser gate can _see_ (sprite/text next: a coloured quad in the corner
of a page is the cheapest non-trivial pixel evidence); (c) resource dependency (shadow needs
render targets, which need W-2's caches and W-6's target cache; stencil needs the
depth-stencil attachment).

Two order notes that differ from the naive reading:

- **Text does not get a packet.** `Text` draws through the sprite/unlit path with a glyph
  atlas texture; §65's glyph batching is `RenderBatcher` output, already backend-independent.
  Text is a _gate_ on W-3, not a pipeline.
- **Shapes do not get a pipeline.** `Shape2D` and its twelve subclasses compile to
  `RenderItem`s consumed by the unlit path with vertex colours; MEMORY's recorded
  byte-identity argument is exactly that _"a scene of shapes emits the identical GL transcript
  as a scene of plain `Renderable`s"_. On WebGPU this becomes the identical **command
  transcript** claim, and it is a cheap, high-value assertion — W-4 exists to make it.

### 4.2 The one structural difference to plan around

GL's programs are objects you mutate (`useProgram`, then set uniforms, then draw). WebGPU's
`GPURenderPipeline` is **immutable and combinatorial**: pipeline identity includes the
target format, the depth-stencil state, the blend state, the primitive topology and the
vertex layout. The seven GL programs therefore become a _pipeline cache_ keyed by a
descriptor tuple, not seven objects.

This interacts directly with MEMORY's **pipeline-cost law** (_"a fifth compiled-at-init
pipeline costs 0.75 kB gzip in every example bundle … nothing reachable from a class method
tree-shakes"_, later _"~1.9 kB for a seventh pipeline plus a pass"_). The law was about
_bundle_ cost of eagerly-constructed pipelines. On WebGPU the analogue is worse in one way
(a pipeline variant per format/blend combination) and better in another (WGSL source is one
string per family, and `createRenderPipeline` is lazy by construction if the cache is
lazy). **Rule for every packet: pipelines are created on first use, keyed by descriptor,
never in `initialize()`.** That is a deliberate departure from the GL backend's
compile-at-init, and the reason is measured, not aesthetic.

---

## 5. Determinism (§33) — what two backends can honestly claim

§33's tiers run `none` → `cross-platform`; the recorded target is same-runtime determinism.
Adding a second backend creates exactly one new temptation and one new obligation.

**Not claimable — never assert it:**

- **Pixel identity between WebGL and WebGL-rasterised and WebGPU-rasterised output.**
  Different rasterisers, different rounding, different depth-range convention (§3.3.8),
  possibly different canvas channel order. `playwright.config.ts` already records the
  principle for the GPU-vs-SwiftShader case (_"there are no golden images … every assertion is
  a threshold"_); the cross-backend case is the same argument with more force. Any
  `visual` golden for WebGPU must live in its own snapshot directory, compared
  WebGPU-to-WebGPU under the same SwiftShader build — the same narrow exception the existing
  `visual` project already justifies.
- **Command-transcript identity across backends.** A GL transcript and a WebGPU transcript
  are lists in different languages. Transcript identity remains a **per-backend, code-path**
  claim, exactly as MEMORY frames it (_"byte-identity is a code-path argument"_).

**Claimable, and the packet must make it a test — this is R-1's determinism deliverable:**

> **The render-list consumption contract.** For a given scene, view set and interpolation
> alpha, every backend receives the _same_ `RenderItem[]` and the same `RenderBatch[]`.

The strategy, concretely:

1. Add a shared harness under `tests/determinism/` (or `tests/integration/`, whichever the
   suite config already covers) that takes a scene builder and a list of renderers.
2. Drive each renderer through a **recording adapter that captures the render list and batch
   plan as they are handed to the backend**, not the backend's own commands.
3. Assert deep equality of those two captures across `NullRenderer`, `WebglRenderer` and
   `WebgpuRenderer`. Any divergence means a backend is re-sorting, re-culling or
   re-batching privately — which is the actual regression this guards against, and the one
   that would otherwise be discovered as "the WebGPU build draws transparency in a different
   order".
4. Keep the per-backend transcript tests separate and unchanged in kind: `recording-gl.ts`
   for GL, its new twin for WebGPU.

This is a stronger claim than it looks: it is what makes _"the logical scene shall remain
independent of the selected backend"_ (§61) testable rather than aspirational, and it is the
first time the project can test it at all, because until now there was one backend.

**Numeric determinism inside the backend.** Ground rule 5 applies unchanged: insertion-order
iteration only, no `Math.random`, no wall clock. The one new hazard is that a `Map` keyed by
a _pipeline descriptor object_ has nondeterministic-looking iteration unless the key is a
canonical string. Make pipeline-cache keys canonical strings built in a fixed field order.

---

## 6. Registry, packaging and budgets

### 6.1 Registration (the A-8 pattern)

`packages/render-webgpu/src/register.ts`, a verbatim structural copy of
`packages/render-webgl/src/register.ts`:

```ts
export function isWebgpuSupported(options?: RendererOptions): boolean;
export function registerWebgpuRenderer(
  registry?: RendererRegistry,
): RendererRegistry;
```

Non-negotiable properties, all inherited from the recorded decision _"explicit registration,
never a side-effect import"_ (forced by `"sideEffects": false` on all 24 packages):

- a **function call**, never `import "@fourjs/render-webgpu/register"`;
- `create()` constructs and does **not** initialize (the registry owns §62's fallback);
- registering a `"webgpu"` backend twice in one registry throws
  `RENDERER_INITIALIZATION_FAILED`.

### 6.2 The probe is genuinely harder than WebGL's

`isWebgl2Supported` is `typeof globalThis.WebGL2RenderingContext === "function"` and the
module header explains at length why it must not touch the canvas. WebGPU's honest
equivalent has a problem the probe interface cannot express: **`RendererRegistration.isSupported`
is synchronous, and the only reliable WebGPU support test (`requestAdapter()`) is async**
(§2.2 fact 2 — `navigator.gpu` exists in a browser where no adapter can be had).

Three options; the packet must pick one and record why:

- **(a) Optimistic sync probe.** `typeof navigator.gpu === "object"`, and let
  `initialize()` be the real gate. Costs one wasted `create()` + `initialize()` on a
  flagless browser before `"auto"` falls back to WebGL 2 — which is _exactly_ what the
  registration doc already says the real gate is (_"answering `true` optimistically is safe
  (initialization decides)"_). **Recommended.** No interface change, and the documented
  contract already anticipates it.
- **(b) Widen `isSupported` to return `boolean | Promise<boolean>`.** A breaking change to a
  published interface, for a case option (a) already handles. Reject.
- **(c) Cache an adapter probe at module load.** Side effects at import in a
  `"sideEffects": false` package. Reject.

### 6.3 Size budgets — verified, with one live hazard

`.size-limit.json` covers six _example bundles_; none imports `@fourjs/render-webgpu`
directly, and `pnpm run size` limits (34 kB for `first-3d-scene`, 31.5 kB for
`particles-demo`, 39.5 kB for `ui-demo`) are the tight ones.

**The hazard is real and must be a gate, not an assumption.** `packages/fourjs/src/index.ts`
carries `export * as renderWebgpu from "@fourjs/render-webgpu";`, and four examples import
from the umbrella `four` package (`import { Text } from "fourJS"`). Today that costs nothing
because the stub exports one string constant. A namespace re-export of a package containing
a renderer class is precisely the shape MEMORY warns about (_"nothing reachable from a class
method tree-shakes"_) — whether Rollup drops it depends on the namespace object being
provably unused, which is likely but **not** something to take on faith at 31.5 kB with
0.5 kB of headroom.

Therefore: **every packet's `Done` includes `pnpm run size`**, and W-1's `Done` includes it
specifically as the tree-shaking proof, before any pipeline exists to make the failure
expensive to diagnose. If a bundle moves, the fix is the registry split already filed as
owner question 14 in the gap doc's §5 register — not a budget bump.

The WebGPU package's own footprint is unbudgeted (no `.size-limit.json` row) and should
stay so until an example actually selects it; adding a row for a package nothing imports
measures nothing.

### 6.4 Packaging

`@fourjs/render-webgpu` is one of the five reserved stubs in the `A-25` packaging row (gap §5
question 10). **Implementation can proceed without that decision** — the row is about
whether stubs are published to npm and how the umbrella's subpaths behave, not about whether
code may be written. Landing a real renderer _improves_ that row's options (a package with
content is easier to publish honestly than a stub), but does not decide it. **npm packaging
stays owner-gated**; no packet below touches `.changeset/`, `package.json` publish config, or
the umbrella's exports map.

---

## 7. RFC-0001 entanglement

RFC 0001's compatibility table says WGSL generation **defers**, with the reason
_"there is no WebGPU backend (`render-webgpu` is a reserved stub, `R-1`). Emitting WGSL
nothing can run is untestable by construction"_. The gap doc says the opposite direction:
`R-14` gates `R-1`, because _"a second backend without a backend-independent shader model
duplicates all four pipelines by hand"_.

Both are true, and together they are a deadlock. The resolution:

- **Hand-written WGSL is the right first move, not a workaround.** The GL backend's seven
  pipelines are hand-written GLSL string constants; hand-written WGSL for the same seven is
  the _same_ amount of duplication the project already accepted once, and it is what makes
  RFC 0001's emitter testable ("emit WGSL and compare against the hand-written pipeline's
  behaviour" is a real test; "emit WGSL nothing can run" is not).
- **The duplication is bounded and known.** Seven shader families, each a few dozen lines.
  It is not the open-ended cost the gap row implies, because the _pipelines_ are already
  designed — the port is translation, not design.
- **W-1…W-7 are RFC-0001-independent.** They may proceed whatever the owner decides on
  RFC 0001.
- **RFC-0001-entangled packets: W-9 only** (a `wgsl-node-program.ts` emitter, the twin of
  RFC 0001's `gl-node-program.ts`), and it is explicitly _out of R-1's scope_ — filed here so
  the sequencing is recorded, dispatched with `R-14`'s follow-up wave.
- **One constraint R-1 owes RFC 0001**: the hand-written WGSL must keep its uniform/binding
  layout **declared as data** (a bind-group layout table in TypeScript, not implicit in the
  shader string), so the future emitter targets the same layout rather than inventing a
  second one. This costs nothing now and saves a rewrite later. Put it in W-1's steps.

---

## 8. Work packets

Format per `IMPLEMENTATION_PLAN.md` §2. All are **[S]** — every one of them makes a decision
a mechanical worker cannot. Effort uses the gap doc's S/M/L scale.

Every packet inherits these **standing gates**:

```
pnpm build && pnpm test && pnpm lint && pnpm run coverage   # ≥95% per-package
pnpm run size                                                # §6.3 tree-shaking guard
pnpm graph:check                                             # no new §3.1 edge
```

`@fourjs/render-webgpu`'s deps are already `core, math, render` — the §3.1 row the WebGL
backend has. **No packet below adds an edge.**

---

### WP-R1.1 [S] Device, context, registry, clear, unlit triangle — and the fake-device harness

**Depends:** —
**Reads:** `packages/render/src/renderer.ts`, `renderer-registry.ts`, `statistics.ts`;
`packages/render-webgl/src/{register.ts,webgl-renderer.ts,gl-program.ts}`;
`tests/integration/helpers/recording-gl.ts`; §61, §62, §89.
**Files:** `packages/render-webgpu/src/{index.ts,webgpu-device.ts,wgpu-pipeline-cache.ts,wgpu-unlit.ts,webgpu-renderer.ts,register.ts}`;
`packages/render-webgpu/tests/*`; `tests/integration/helpers/recording-gpu.ts`;
`packages/render/src/renderer.ts` (capability widening, §3.3.1);
`packages/render/src/{index.ts}`; `packages/render-webgl/src/webgl-renderer.ts` (answer the
new capability fields); `playwright.config.ts` (the one flag).

**Steps (abridged to the decisions):**

1. Define the **structural GPU surface** — a `WebgpuDevice`-style interface describing only
   the WebGPU entry points this backend uses, mirroring how `WebglContext` describes GL and
   for the same reason (the package compiles without `lib.dom`, and a structural interface is
   what makes a complete double possible). Do **not** depend on `@webgpu/types` (not in the
   §3.2 pin set; ground rule 7).
2. Write `recording-gpu.ts`: a fake device/queue/encoder recording every call in order, the
   twin of `recording-gl.ts`. Carry over its recorded gotcha verbatim — _retained
   typed-array arguments must be copied at record time_, or a transcript read after a later
   frame reports the later frame's values.
3. Widen `RendererCapabilities` **once**, with all eleven §62 fields, additively; make
   `NullRenderer` and `WebglRenderer` answer honestly.
4. `WebgpuRenderer.initialize` — `requestAdapter` → `requestDevice` → `configure` the
   canvas context; every failure path throws `FourError("RENDERER_INITIALIZATION_FAILED")`
   (§89). Wire `device.lost` to the existing `contextlost`/`contextrestored` events.
5. Lazy, descriptor-keyed pipeline cache (§4.2). Canonical string keys (§5).
6. Unlit pipeline in hand-written WGSL, with its bind-group layout declared as data (§7).
7. `registerWebgpuRenderer` per §6.1, probe option (a) per §6.2, with the reasoning in the
   module header.

**Gates / evidence:** unit — a recorded command transcript for a one-triangle frame, asserted
against a hand-written expectation; registry — `"auto"` selects webgpu when registered,
falls back with a `RendererFallbackReport` when `initialize` rejects; `pnpm run size`
unchanged on all six bundles (§6.3).
**Evidence tier:** transcript (byte). No pixels yet.
**Effort:** **M–L.** The harness and the capability widening are most of it.

---

### WP-R1.2 [S] Geometry, texture and buffer caches

**Depends:** R1.1
**Reads:** `packages/render-webgl/src/{gl-geometry.ts,gl-texture.ts}`; `packages/render/src/{texture.ts,resource-memory.ts}`; §77, §83.
**Files:** `packages/render-webgpu/src/{wgpu-geometry.ts,wgpu-texture.ts}` + tests.

Ports the id/version CPU-descriptor → GPU-cache pattern. `TextureSource` upload becomes
`queue.writeTexture` / `copyExternalImageToTexture`; samplers become cached `GPUSampler`s
keyed by (wrap × filter) — note that WebGPU makes the sampler a _separate_ object from the
texture, unlike GL's per-texture parameters, so `R-30`'s wrap/filter tier maps to a small
sampler cache rather than to `texParameteri` calls. Dispose semantics must feed
`liveTextureCount` / `textureMemoryBytes`.
**Evidence:** transcript + `resource-memory` counters. **Effort: M.**

---

### WP-R1.3 [S] Sprites, text and batching

**Depends:** R1.2
**Reads:** `packages/render/src/{batch.ts,sprite.ts}`; `packages/render-webgl/src/gl-batch.ts`; §55, §65.
**Files:** `packages/render-webgpu/src/{wgpu-sprite.ts,wgpu-batch.ts}` + tests; first browser spec.

`wgpu-batch.ts` implements the existing `RenderBatching` interface — the planner
(`RenderBatcher`) is untouched and unshared-code (§3.2). Persistent vertex/index buffers with
`queue.writeBuffer`; §65's _"persistent mapped or staged buffers"_ becomes reachable here for
the first time and should be **noted, not built** (a staging-ring is its own packet).
Text rides this path (§4.1).
**Evidence:** transcript for the batch plan; **first pixel evidence** — a browser spec in
`tests/browser/webgpu/` with the adapter-skip guard, asserting a non-blank canvas by
threshold, never by golden.
**Effort: M.**

---

### WP-R1.4 [S] Shapes and vertex colours

**Depends:** R1.3
**Reads:** `packages/render/src/shape.ts`; MEMORY's shape byte-identity entries.
**Files:** tests only, plus whatever unlit-variant plumbing R1.1 deferred.

The claim to prove: _a scene of `Shape2D`s emits the same WebGPU command transcript as the
equivalent scene of plain `Renderable`s_, the WebGPU restatement of the recorded GL claim.
Mostly a test packet — which is the point; if it needs new backend code, the unlit pipeline
was wrong.
**Evidence:** transcript identity. **Effort: S.**

---

### WP-R1.5 [S] Lit and standard pipelines, lights

**Depends:** R1.4
**Reads:** `packages/render/src/lights.ts`; `packages/render-webgl/src/{gl-program.ts (LitProgram, PunctualLightUniforms),gl-standard.ts}`; §59, §68, §60a.
**Files:** `packages/render-webgpu/src/{wgpu-lit.ts,wgpu-standard.ts,wgpu-lights.ts}` + tests.

Two WGSL ports (Lambert; Cook-Torrance GGX/Smith/Schlick with 1/π folded out of both lobes,
per the recorded R-13 decision). Punctual lights become **one uniform buffer** rather than
`uniform3fv` arrays — a genuine simplification, and the place to get `std140`-equivalent
alignment right once (WGSL `vec3<f32>` is 16-byte-aligned; a naive struct will silently
misread). Depth-range remap (§3.3.8) lands with the first depth-testing pipeline.
**Evidence:** transcript + a browser threshold spec (a lit cube is brighter facing the
light). **Effort: L.**

---

### WP-R1.6 [S] Render targets, effects, graph participation

**Depends:** R1.5
**Reads:** `packages/render/src/{render-target.ts,effect-pass.ts,render-graph.ts}`; `packages/render-webgl/src/{gl-render-target.ts,gl-effect.ts}`; §63, §70, RFC 0005.
**Files:** `packages/render-webgpu/src/{wgpu-render-target.ts,wgpu-effect.ts,wgpu-readback.ts}` + tests.

Off-screen colour + depth attachments; `depthTexture` → `depth32float`/`depth24plus`;
`renderEffect` for all three `ScreenEffect` kinds with a per-(kind × format) pipeline cache;
the R-4 feedback refusal restated (a pass whose destination is its source is **skipped**,
not drawn). Ships `readPixels` via `copyTextureToBuffer` + `mapAsync` (§3.3.5) — the
probe-verified path — degrading to whole-target if `Rectangle2` has not landed.
`RenderGraph` needs **no change**: it drives `Renderer`, and `supportsScreenEffects` already
gates the optional member.
**Evidence:** transcript; and here the browser gate can assert an actual readback value,
which is the strongest non-golden pixel evidence available.
**Effort: L.**

---

### WP-R1.7 [S] Shadows and stencil parity

**Depends:** R1.6
**Reads:** `packages/render-webgl/src/gl-shadow.ts`; `packages/render/src/render-target.ts` (stencil doc); `tests/browser/stencil.spec.ts`; §67, §69.
**Files:** `packages/render-webgpu/src/{wgpu-shadow.ts,wgpu-stencil.ts}` + tests; `tests/browser/webgpu/`.

Depth-only shadow pass and its comparison sampler (WebGPU's `sampler_comparison` is a
distinct binding type — the shadow bind-group layout differs structurally from GL's texture
unit, and the `SHADOW_TEXTURE_UNIT` constant has no analogue). Stencil per §3.3.6, including
the `depthTexture`-exclusivity restatement. §67's scissor is a render-pass call rather than
ambient state — simpler, and the mirror-state discipline mostly evaporates here, which
should be **recorded** as the one place the WebGPU backend is structurally safer than GL.
**Evidence:** transcript; browser parity spec mirroring `tests/browser/stencil.spec.ts`
by threshold. **Effort: L.**

---

### WP-R1.8 [S] Compute (§82) and GPU particles (R-31)

**Depends:** R1.7
**Reads:** §82, §26, §27, §36, §86, `packages/particles/src/*`, `packages/render/src/particles.ts`, `packages/render-webgl/src/gl-particles.ts`; gap row `R-31`.
**Files:** `packages/render-webgpu/src/{wgpu-particles.ts,wgpu-compute.ts}`; a `ComputePass` type — **placement is an owner question (§9 Q3)**.

Instanced particle draw first (a straight port of `gl-particles.ts`'s instance buffer), then
§82's `ComputePass`. Probe-verified: storage buffers and compute pipelines work under
SwiftShader in CI (§2.2), so this packet has real evidence available — which is what makes
`R-31` finally movable.

Three cautions the gap row's history demands:

- **Do not accept `simulation: "gpu"` before it works.** The recorded WP-9.1 decision —
  _"an option that silently does nothing is worse than one that does not exist yet"_ — means
  the option type widens in the same change that makes it function, never before.
- **§27's GPU fields and §36's `collisions: "depth-buffer"` ride here** and are each large
  enough to be their own follow-up packet. This packet ships §82's mechanism plus a GPU
  particle _integrator_; it does not promise the whole field/collision surface.
- **`R-31` closes only for the WebGPU backend.** WebGL 2 has no compute; the capability
  record (§3.3.1) is how an application asks, and the honest gap-row wording is
  "closed on WebGPU, absent on WebGL 2 by §62 tier".

**Evidence:** transcript for the dispatch; browser readback of a compute result (the probe
already demonstrates the exact mechanism). **Effort: L.**

---

### WP-R1.9 [S] Capability declaration, and the RFC-0001 seam _(out of R-1 scope; filed for sequencing)_

**Depends:** R1.8, and (for the second half) RFC 0001 acceptance.
Two separable pieces: §62's _"applications may declare required and optional capabilities"_
(a `RendererResolveOptions` extension that makes `"auto"` skip a backend lacking a required
capability — cheap once §3.3.1's record exists), and `wgsl-node-program.ts`, the WGSL twin of
RFC 0001's GLSL emitter. **Effort: M + L.** Dispatch with the `R-14` wave, not this one.

---

### 8.1 Dependency shape

```
R1.1 ──▶ R1.2 ──▶ R1.3 ──▶ R1.4 ──▶ R1.5 ──▶ R1.6 ──▶ R1.7 ──▶ R1.8 ──▶ R1.9
 │                                                                        ▲
 └── capability widening (@fourjs/render, touches NullRenderer + WebGL)      │
                                                        RFC 0001 (R-14) ──┘
```

Strictly serial. Every packet shares `packages/render-webgpu/src/`, so §2's parallelism rule
(disjoint `Files` sets) forbids concurrency; the only genuinely parallelisable work is
R1.9's first half, which touches `@fourjs/render` alone.

---

## 9. Owner questions — for the §5 register

| #      | Question                                                                                                                                                                                                                                                                      | Why it cannot be decided by a packet                                                                                                                                                         | Recommendation                                                                                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q1** | **Does landing R1.1 change `renderer: "auto"` for everyone?** `AUTO_RENDERER_ORDER` puts `"webgpu"` first, so the moment an application calls `registerWebgpuRenderer()` its rendering backend changes. And the umbrella `four` package may make that easy to do by accident. | A silent backend switch changes rasterisation, and therefore every application's output, on an upgrade. §62 mandates the _order_; it does not mandate _when a backend becomes registerable_. | **Ship behind an explicit opt-in for at least one release.** The registration call already is one — so the real content of the decision is: (i) do not add any convenience that registers all backends at once, and (ii) say in the changelog that calling `registerWebgpuRenderer()` moves you off WebGL 2. |
| **Q2** | **Is the widened `RendererCapabilities` (§62's eleven fields) an acceptable interface change now**, given it touches `NullRenderer`, `WebglRenderer`, every test double and any third-party backend?                                                                          | It is the one shared-interface change R-1 forces, and doing it incrementally is worse than doing it once.                                                                                    | **Yes, once, in W-1**, additive with honest conservative answers from the existing implementors.                                                                                                                                                                                                             |
| **Q3** | **Where does §82's `ComputePass` live** — `@fourjs/render` (backend-independent descriptor, matching every other render type) or `@fourjs/render-webgpu` (the only backend that can run it)?                                                                                  | It is a §3.1-adjacent placement call, and the spec's example writes `new Four.ComputePass({...})` — an umbrella-level name, which argues for `@fourjs/render`.                               | **`@fourjs/render`**, as a descriptor with `Renderer.compute?()` as the optional-member-is-the-capability seam — the third instance of the pattern `statistics` and `renderEffect` already use.                                                                                                              |
| **Q4** | **Packaging (`A-25`, existing register row 10).** Does a `render-webgpu` with real content change the publish answer for the remaining four stubs?                                                                                                                            | Owner-gated by prior decision; unchanged by this plan.                                                                                                                                       | **No change requested.** Implementation proceeds; npm packaging stays where it is. Note only that the recommendation on row 10 ("publish the stubs") gets easier for this one package and no harder for the other four.                                                                                      |

Secondary, packet-level, recorded so they are not re-litigated per packet: probe strategy
(§6.2, recommend (a)); pipelines lazy not eager (§4.2, recommended as a rule); WGSL bind-group
layouts declared as data (§7); depth remap in the backend, never in `@fourjs/math` (§3.3.8).

---

## 10. What this plan deliberately does not do

- **No transient-target pooling, no barrier scheduling** — §63 features that must land on
  both backends or neither (§3.3.3).
- **No performance claims.** SwiftShader is not a GPU; `benchmarks/`'s GPU-blocked rows stay
  blocked (§2.3).
- **No cross-backend pixel goldens.** Ever (§5).
- **No `@webgpu/types` dependency**, no new §3.2 pins, no new §3.1 edges (ground rules 7, 9).
- **No new packages** (§98 / E-3).
- **No spec edits.** Everything above lives inside §62's existing text; if the capability
  widening or `ComputePass` placement wants a spec sentence, it joins the batched amendments
  pass already filed as register row 13.
