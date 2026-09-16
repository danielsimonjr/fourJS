# Specification Review — Proposed Improvements

A technical review of [`SPECIFICATION.md`](SPECIFICATION.md) (parts I–XIII, §1–120), proposing
improvements as numbered items **R-1 … R-35**. Each item cites the sections involved, states
the problem, and proposes a concrete resolution.

> **Disposition (2026-07-28, owner-directed):** all 35 items were accepted and applied in
> specification **revision 1.1** — see the Amendments table at the top of `SPECIFICATION.md`.
> New material uses lettered sections (6a, 6b, 7a, 7b, 60a) and Appendices A–B so §1–120
> numbering is unchanged. R-25's payload budget (≤ 150 kB gzip, §86) was initially set
> provisionally and **confirmed by the owner 2026-07-29** (revision 1.2). One remaining
> caveat: R-32's shall/should audit was applied only where revised text was already being
> touched.

Citation convention: plain "§N" means `SPECIFICATION.md` numbering.

**Priority key** — **P1**: internal contradiction or a gap that will produce wrong or
incompatible code in early phases (Phases 0–5, §103–108). **P2**: underspecified design that
implementers will have to invent, risking later rework. **P3**: editorial/structural.

| #    | Priority | Area          | Summary                                                                            |
| ---- | -------- | ------------- | ---------------------------------------------------------------------------------- |
| R-1  | P1       | Physics       | §23 vs §26 force API signatures disagree                                           |
| R-2  | P1       | Motion        | §19 `MotionAuthority` vs §42 `TransformAuthority` overlap, undefined relationship  |
| R-3  | P1       | Time          | §9 `TimeState` interface missing fields its own prose requires                     |
| R-4  | P1       | Time          | §10 accumulator has no substep cap; death-spiral policy undefined                  |
| R-5  | P1       | Physics       | 2D gravity sign in §21 implies a Y-down convention never stated                    |
| R-6  | P1       | Scene         | Component model used everywhere, specified nowhere                                 |
| R-7  | P1       | Packages      | §52 requires an isolated tessellator package absent from §98                       |
| R-8  | P1       | Time          | Milliseconds (animation) vs seconds (physics) never reconciled                     |
| R-9  | P1       | Physics       | §37 adapter interface cannot support the API the spec promises                     |
| R-10 | P2       | Core          | No coordinate-system conventions section                                           |
| R-11 | P2       | Core          | Event system undefined despite pervasive use                                       |
| R-12 | P2       | Scene         | §7 transform composition, pivot, and dirty semantics undefined                     |
| R-13 | P2       | Math          | No mutability/allocation convention for math types                                 |
| R-14 | P2       | Physics       | 2D/3D typing strategy undecided                                                    |
| R-15 | P2       | Physics       | §23 `mass` vs `inverseMass` authority undefined                                    |
| R-16 | P2       | Determinism   | §33 ignores the actual sources of nondeterminism                                   |
| R-17 | P2       | Animation     | Timeline callback/scrub semantics and property binding undefined                   |
| R-18 | P2       | Serialization | Identity, asset references, snapshot compatibility unspecified                     |
| R-19 | P2       | All           | No defaults are normative                                                          |
| R-20 | P2       | Rendering     | GPU device/context loss not addressed anywhere                                     |
| R-21 | P2       | Rendering     | No color-management (linear workflow) section                                      |
| R-22 | P2       | Scope         | Audio referenced but has no section, package, or non-goal entry                    |
| R-23 | P2       | Scope         | Networking implied (§42 "network", §33 rollback) but unscoped                      |
| R-24 | P2       | Rendering     | No large-world / precision strategy for the digital-twin use case                  |
| R-25 | P2       | Packaging     | Umbrella import vs tree-shaking; no bundle-size budgets                            |
| R-26 | P3       | Platform      | §88 shared-memory modes need COOP/COEP deployment note                             |
| R-27 | P3       | Packages      | Camera rigs have no owning package; 20 of 24 packages lack responsibility lists    |
| R-28 | P3       | Accessibility | Reduced-motion only binds the UI module, not the animation system                  |
| R-29 | P3       | Rendering     | Runtime WebGPU failure/fallback policy unstated                                    |
| R-30 | P3       | Testing       | Per-backend visual baselines; headless backend is a test dependency scheduled last |
| R-31 | P3       | Structure     | Part VII is 53 sections — half the spec — with no internal structure               |
| R-32 | P3       | Structure     | Conformance language (shall/should/may) undefined and inconsistently used          |
| R-33 | P3       | Structure     | No glossary                                                                        |
| R-34 | P3       | Structure     | Spec has no version stamp or change log of its own                                 |
| R-35 | P3       | Typesetting   | §45 fence mixes example statements with an interface declaration                   |

---

## A. Internal contradictions and inconsistencies (P1)

### R-1 — Force API signatures disagree between §23 and §26

§23 `RigidBody` declares `applyForce(force: Vector3, point?: Vector3)` and
`applyImpulse(impulse: Vector3, point?: Vector3)`. §26 instead requires separate methods:
`applyForce(force)` + `applyForceAtPoint(force, worldPoint)` and likewise for impulses. An
implementer cannot satisfy both as written.

**Proposal:** pick the §26 style (explicit `…AtPoint` methods). Separate names make the
world-space-point contract visible at the call site and avoid an optional parameter whose
frame (world vs local) is otherwise ambiguous. Update §23 accordingly, and state in §26 that
`point` is a world-space position.

### R-2 — `MotionAuthority` (§19) vs `TransformAuthority` (§42)

Two overlapping enums govern who moves a node:

- §19: `type MotionAuthority = "animation" | "kinematic" | "physics" | "blended"`
- §42: `type TransformAuthority = "manual" | "animation" | "kinematic" | "physics" | "constraint" | "network"`

Their relationship is never defined. §42 lacks `"blended"`, so the §19 blending feature
(`physicsWeight` / `animationWeight`) has no representation in the authority model that §42
says must warn on conflicts. §93 and §110 refer to "motion authority" as if it were one
concept.

**Proposal:** merge into a single `TransformAuthority` owned by §42, adding `"blended"`.
Define: exactly one authority per node; `"blended"` designates the §19 pipeline (animation
pose → kinematic modification → physics solve → weighted combine) as the single authority;
conflict warnings fire when a _second_ system writes a transform it does not own. Rewrite §19
to reference §42 rather than declaring its own enum.

### R-3 — `TimeState` (§9) omits fields its own prose requires

The §9 prose requires six time domains including _animation time_, _scaled time_, and
_unscaled time_, and the example uses `app.time.scale` / `app.time.paused` — but the
`TimeState` interface has no `animationTime`, no scaled/unscaled pair, no `timeScale`, no
`paused`, and no `unscaledDeltaTime`.

**Proposal:** extend the interface to match the prose, e.g. add `timeScale: number`,
`paused: boolean`, `unscaledDeltaTime: number`, and either `animationTime: number` or an
explicit note that animation time is clip-local and lives on players/timelines rather than in
the global `TimeState` (the likelier design — but say so).

### R-4 — Accumulator loop (§10) has no substep cap

The recommended algorithm loops `while (accumulator >= fixedDeltaTime)` unbounded. A long
frame (tab restored from background, debugger pause, GC hitch) makes simulation work grow with
elapsed time, which makes the next frame longer — the classic spiral of death. §45 already
defines `maximumSubSteps` in `ApplicationOptions`, but §10 never uses it, and the policy for
overflow time is undefined (drop it? carry it? slow simulation time relative to real time?).

**Proposal:** amend the §10 algorithm to clamp iterations at `maximumSubSteps`, state the
default (see R-19), and define the overflow policy explicitly. Recommended: drop the excess
accumulator time (simulation time falls behind real time rather than freezing the app), emit a
diagnostics warning (§84), and expose the drop in `TimeState` so replay tooling (§113) can see
it. Note the interaction with pause/step controls and with `interpolationAlpha` (alpha must
remain in [0, 1] after clamping).

### R-5 — 2D gravity sign implies an unstated Y-down convention

§21 constructs `world2D` with `gravity: new Vector2(0, 9.81)` (positive Y) while `world3D`
uses `(0, -9.81, 0)`. That is only consistent if 2D space is Y-down (screen-style) while 3D is
Y-up — a fundamental convention the spec never states, and which contradicts §7's claim that
2D nodes are ordinary 3D transforms with `position.z = 0` (one node hierarchy cannot be Y-down
and Y-up at once).

**Proposal:** decide and document. Recommended: one world convention, Y-up, right-handed, for
both 2D and 3D (the §7 "2D is 3D with z = 0" model then holds), with Y-down available only as
a camera/viewport presentation concern (§47 `ScreenCamera` already supports top-left origins).
Fix the §21 example to `new Vector2(0, -9.81)`. This belongs in the new conventions section
proposed as R-10.

### R-6 — The component model is load-bearing and unspecified

`node.addComponent(...)` appears in §11, `cube.getComponent(Four.RigidBody)` in §97,
`scene.findByComponent(RigidBody)` in §46, and §115 attaches `RigidBody` and colliders as
components — yet §6's `Node` declares no component API, and no section defines what a
component is: lifecycle (attach/detach/dispose), one-per-type or many, update participation
(§39 system ordering vs per-component callbacks), typed lookup, serialization (§79), or how
component state interacts with transform authority (§42). It is also unresolved whether
`RigidBody` (§23, declared as a `class`) is a component, a `Node` subclass, or both.

**Proposal:** add a "Component Model" section to Part I: `Node.addComponent` /
`getComponent(type)` / `removeComponent`, single-instance-per-type, explicit lifecycle hooks,
the rule that components hold behavior/state while systems (§39) drive updates, and the
statement that `RigidBody` and `Collider` are components. This is Phase 1 (§104) surface area;
it should be specified before any implementation starts.

### R-7 — Required tessellator package missing from the monorepo

§52: "The tessellator shall be an isolated package with a stable interface so implementations
can be replaced without changing the scene API." No such package exists in the §98 tree, and
the scaffold (per ERRATA E-3 discipline) must match §98.

**Proposal:** either amend §52 to "an isolated _module_ with a stable interface inside
`@fourjs/geometry`" (recommended — avoids growing the package count for the MVP), or amend §98
to add `packages/tessellate/`. Either way the two sections must agree, same class of defect as
E-3.

### R-8 — Animation milliseconds vs physics seconds

Tween and timeline durations are milliseconds (§15 `.to({...}, 1000)`, §16 `.at(250, …)`),
while `fixedTimeStep` is seconds (§45, `1 / 60`) and §40's recommended physics unit is the
second. `Trajectory.samplePosition(time)` (§13) and `AnimationClip.duration` (§17) don't say
which they use. A unified engine whose two halves disagree on the unit of time invites
thousand-fold errors at every seam (e.g. physics-animation blending, §19).

**Proposal:** state a single rule. Recommended: seconds everywhere internally (including clip
and timeline durations); if the familiar milliseconds-style tween API is kept for ergonomics,
make the unit explicit in the API (`durationMs` or an options object `{ duration: 1, unit: "s" }`)
rather than positional convention. Amend §13, §15, §16, §17, §40 to say which unit applies.

### R-9 — `PhysicsSolverAdapter` (§37) cannot support the promised API

Gaps between the adapter interface and the features built on top of it:

- **No removal**: `createBody/createCollider/createJoint` exist but there is no
  `destroyBody/destroyCollider/destroyJoint` — only whole-world `dispose()`. Dynamic scenes
  cannot be built on this.
- **Queries**: only `raycast` is present, but §30 requires `shapeCast`, `overlapSphere`,
  `overlapBox`, `pointQuery` with filtering.
- **Events**: §29's `collisionstart/stay/end` and sensor events have no delivery path — the
  adapter has no event pump, callback registration, or "drain contact events after `step`"
  method.
- **Sync direction ambiguous**: `syncToScene()` vs `syncFromScene()` — the subject is unclear
  (does "to scene" mean adapter→scene?). Name them from the adapter's perspective and document
  when the physics package calls each relative to §39's ordering, including how kinematic
  targets flow in and interpolation state (previous transforms, §43) is captured.
- **`PhysicsCapabilities` is never defined** anywhere, though §37 and §102 both depend on it.

**Proposal:** extend §37 with destroy methods, the §30 query set (or a single generic
`query(desc)`), and an explicit event-drain contract (e.g. `drainEvents(): PhysicsEvent[]`
called after `step`, which the physics package normalizes per §101). Define
`PhysicsCapabilities` with at least: dimensions supported, joint types (§28), CCD modes
(§31), determinism tier achievable (§33), snapshot support, and query features — so `"auto"`
solver selection (§20) and §90's compatibility tables have something to key on.

---

## B. Underspecified load-bearing designs (P2)

### R-10 — Add a coordinate-conventions section

Nowhere does the spec state: handedness, up axis, 2D Y direction (see R-5), front-face
winding, NDC depth range policy across backends (WebGPU [0,1] vs WebGL [-1,1]), rotation
order/representation for Euler input (only quaternions are stored, §7 — good, but authoring
APIs will take Eulers), or angle units in APIs (§40 permits degree config; §28 uses radians).
For a framework whose whole premise is that 2D, 3D, UI, and physics share one scene, this is
the single highest-leverage missing section.

**Proposal:** add "§7a Coordinate and Unit Conventions" (or fold into Part I): right-handed,
Y-up world; counter-clockwise front faces; radians in all APIs (§40's degree option is
display-only); backend NDC differences hidden behind the projection matrix (§47); screen/
viewport spaces defined with origin and pixel-unit rules (§8, §47 `ScreenCamera`).

### R-11 — Define the event system

`body.on(...)` (§29), `app.on(...)` (§10, §45), `impulseButton.on("click", ...)` (§97),
DOM-style capture/target/bubble (§72), and `robot.on("impact", ...)` (§117) all assume an
event API that no section defines. `EventEmitter` appears once, as a Phase 1 component name
(§104). Undefined: typed event maps, `off`/`once`/abort-signal unsubscription, listener
ordering, whether scene-graph propagation applies only to input events or to all events, and
_when_ physics events dispatch (during `step`, after each fixed step, or coalesced per render
frame — §39 step 8 hints but doesn't bind it to the event API).

**Proposal:** add an "Eventing" section to Part I: a typed `EventEmitter` mixin on `Node` and
`Application`; input events propagate through the graph per §72; physics events dispatch after
each fixed step in §39 order; document `once`, unsubscription, and re-entrancy rules
(mutating listeners during dispatch).

### R-12 — Transform semantics (§7)

Unspecified: local matrix composition order and where `pivot` enters it (the classic
`T · P · R · S · P⁻¹`?), whether setting `localMatrix` directly back-propagates to TRS,
when `worldMatrix` becomes valid (§104 says "dirty transform propagation" — but is the update
eager, on-read, or once per frame stage?), and what `version` counts.

**Proposal:** specify composition as `T · P · R · S · P⁻¹` (pivot-relative rotation/scale),
lazy world-matrix update with per-frame resolve before render-item generation (§64) and
before physics sync (§37), `version` increments on any local mutation, and `matrixAutoUpdate:
false` meaning the user owns `localMatrix`.

### R-13 — Math type mutability and allocation policy

Only §13's `Trajectory` shows `out?` parameters. Everything else returns/accepts vectors with
no stated convention, while §83 warns diagnostics should flag "excessive per-frame
allocations". Whether `Vector3` is mutable, whether operations are in-place, chainable, or
allocating, and whether hot APIs take `out` parameters determines every signature in
`@fourjs/math` — Phase 1 code.

**Proposal:** add a convention subsection to Part I or §91: mutable math types; instance
methods mutate in place and return `this`; static/`*.clone()` variants allocate; all sampling
and query hot paths accept an optional `out`. (This matches the three.js idiom the audience
knows.)

### R-14 — 2D/3D typing strategy for the physics API

§21 promises "parallel naming and semantics", and its example passes `Vector2` gravity — but
`RigidBody` (§23), `Collider` groups, `CollisionEvent` (§29), and force APIs (§26) are typed
exclusively with `Vector3`/`Matrix3` (`inertiaTensor` has no 2D meaning; 2D inertia is a
scalar). Options — a single 3D-typed API where 2D constrains z, generics parameterized by
dimension, or parallel 2D/3D types — have very different ergonomics and costs, and the spec
must pick one before Phase 5 (§108).

**Proposal:** decide in §21. Recommended: one 3D-typed public API; a `"2d"` world constrains
motion to the XY plane and rotation to Z (documented as equivalent to a plane constraint), and
accepts `Vector2` as a convenience that widens to `Vector3`. `inertiaTensor` documented as
diagonal-Z-only in 2D. Amend §23/§26/§29 with a note on 2D interpretation, and give §30's
overlap queries dimension-neutral naming or 2D counterparts.

### R-15 — `mass` vs `inverseMass` (§23)

Both are plain mutable fields. Which is authoritative? How is infinite mass expressed
(`inverseMass = 0`)? Is `mass` derived from collider `density` (§24 has `density`, §25 too)
or explicit — and which wins when both are set? Is `sleeping` writable as a command or
read-only state?

**Proposal:** `mass` is authoritative and settable; `inverseMass` is derived/read-only;
`mass: 0` on a dynamic body is invalid (validation, §85) — static/kinematic types express
non-simulated mass; mass defaults to density × volume when omitted, explicit `mass` overrides;
`sleeping` read-only with `wake()`/`sleep()` methods (§32 already implies explicit wake).

### R-16 — Determinism section (§33) doesn't name the real hazards

The conditions listed (same solver/timestep/inputs, no multithreading) are necessary but not
sufficient, and the actual JS-specific hazards go unmentioned: `Math.sin/cos/pow` results
vary across engines (relevant to `same-runtime` vs `same-platform` tier definitions), Wasm
solvers (Rapier) are deterministic where JS math may not be, iteration order of
`Set`/`Map`/object keys must be insertion-stable in simulation code, and event/callback
ordering must be deterministic. "Checksums" (§33, §92, §113) are never defined — checksum of
what state, at what precision?

**Proposal:** expand §33: define each tier by what may vary (engine version, OS, hardware);
require solver adapters to declare their achievable tier in `PhysicsCapabilities` (R-9);
require deterministic iteration order in all simulation-path collections; specify the checksum
(e.g. FNV-1a over quantized body transforms + velocities each fixed step, quantization stated)
so §92's determinism tests are implementable as written.

### R-17 — Timeline and tween semantics (§15–§16)

§16 requires both "scrubbing" and "deterministic evaluation" _and_ arbitrary callbacks
(`.at(1000, () => …)`). Undefined: do callbacks fire on seek/scrub across their time, on
reverse, exactly-once per crossing? Property binding is by example only (`Four.tween(node,
{ opacity: 0.5 })`) — string paths, typed accessors, or property objects? What happens when
two active tweens target the same property (last-write-wins, priority, or an authority warning
per §42)?

**Proposal:** specify: evaluation is a pure function of timeline time for value tracks;
callbacks are _event markers_ with defined semantics (fire on forward crossing during `play`;
on `seek`, either suppressed or replayed per a per-marker policy — pick suppressed as
default); binding is typed property references with string-path convenience resolved at
creation; same-target conflicts resolve last-started-wins with a dev warning. Cross-reference
§42.

### R-18 — Serialization identity and references (§79–§80)

Unspecified: are node `id`s stable across save/load (they're `readonly` per §6 — so how does
deserialization set them)? How are components serialized (depends on R-6)? How do scene files
reference assets — URL, content hash (§76 mentions hashing), or logical key — and how do
cross-node references (e.g. a joint's `bodyA`/`bodyB`, a camera target) serialize? Also state
explicitly that §34 snapshots (`ArrayBuffer` from the adapter) are opaque and only valid for
the same adapter + version, and that the replay format (§34) must record adapter identity.

**Proposal:** add these rules to §79: ids are stable and serialized; intra-file references are
by id; assets referenced by logical key with a manifest mapping key → URL + content hash;
components serialize under a registered type name (ties into §81 plugin serialization types).
Amend §34 with snapshot compatibility rules.

### R-19 — Make defaults normative

The spec shows many values only in examples: `fixedTimeStep: 1/60` (§45), gravity −9.81
(§20), sleeping thresholds (§32), combine modes (§25 lists the enum but no default), CCD off
(§31), renderer `"auto"` order (§62). Implementers and users both need a single authoritative
defaults table; examples are not normative.

**Proposal:** add a "Defaults" appendix: `fixedTimeStep = 1/60 s`, `maximumSubSteps` (propose
5, per R-4), gravity `(0, −9.81, 0)` / 2D `(0, −9.81)` (per R-5), friction/restitution
combine = `average`/`maximum` (state it), sleeping thresholds = §32's example values, CCD
`"disabled"`, `renderer: "auto"` = WebGPU → WebGL 2 → Canvas 2D.

### R-20 — GPU device and context loss

Not mentioned anywhere: WebGL context loss/restore, WebGPU device loss, or what happens to
textures, buffers, pipelines, and render targets when it happens. For a framework targeting
long-running dashboards and digital twins (§119), this is a first-class failure mode, not an
edge case.

**Proposal:** amend §61 (Renderer Interface) with a loss/restore contract (event + automatic
resource re-creation policy for engine-owned resources; documented re-upload hooks for
user-owned ones), add `CONTEXT_LOST` / `DEVICE_LOST` to §89's error codes, and add a
context-loss integration test to §92.

### R-21 — Color management

§59 specifies PBR and §68/§70 mention tone mapping and exposure, but the spec never states the
color pipeline: sRGB-encoded textures decoded to linear, lighting in linear space, tone map +
encode at output, color-space metadata on render targets, or how Canvas 2D/SVG backends (which
are sRGB-native) fit the model. §77 mentions "color-space metadata" for textures only. Getting
this wrong is the most common class of renderer bug reports.

**Proposal:** add a "Color Management" section to Part VII: linear-light internal rendering
for WebGPU/WebGL 2; textures tagged sRGB/linear (default sRGB for color, linear for data
maps); output transform = tone map → sRGB encode as the final pass (§63); 2D backends operate
sRGB-native with documented divergence; CSS-style color strings (used throughout, e.g. §50,
§59) are sRGB by definition.

### R-22 — Audio is referenced but unscoped

§6 lists "audio" as a node participation; §76 lists "audio files through optional module". No
audio section, no package in §98, no non-goal in §5.

**Proposal:** pick one: (a) add "audio engine" to §5 non-goals with a note that the plugin
system (§81) is the extension point, or (b) reserve `@fourjs/audio` in §98 with a stub
responsibilities section. Recommended: (a) for 1.0 — matches the E-3 discipline of keeping
§98 authoritative over the scaffold.

### R-23 — Networking is implied but unscoped

§42 includes `"network"` transform authority; §33 lists rollback; §34 lists "network rollback"
as a snapshot use case. There is no networking section and no non-goal entry, leaving it
ambiguous whether 1.0 has any transport, replication, or clock-sync obligations.

**Proposal:** add to §5 non-goals: "a networking/replication layer". Keep `"network"`
authority and rollback as _enablers_ with one sentence each stating that transport and
protocol are out of scope and belong to plugins.

### R-24 — Large-world precision strategy

§119's digital-twin ambitions (plant models, long-running simulations) collide with 32-bit
float precision at large coordinates or long times. §41 explains _why_ extreme scales are
problematic but the spec offers no mitigation and reserves no design space (camera-relative
rendering, floating origin, double-precision transform option, or emitter-local particle
spaces).

**Proposal:** add a short subsection to §41 or Part VII: document the supported coordinate
magnitude envelope for 1.0; reserve camera-relative rendering as the intended extension
(affects §64 render-item generation — worth one sentence now so the design doesn't preclude
it); note `TimeState.realTime` precision over multi-day sessions.

### R-25 — Tree-shaking vs the umbrella package; bundle budgets

§91 requires tree-shakable modules, but every example does `import * as Four from "fourJS"`
(§97, §114) through the umbrella package — the pattern most hostile to dead-code elimination,
and the one users will copy. Separately, §86 sets runtime targets but the spec sets no payload
targets, which for a web framework is a primary adoption criterion.

**Proposal:** amend §98/§91: umbrella `four` re-exports via subpath exports
(`four/physics`, …) and side-effect-free packages; examples show scoped imports at least once;
add a payload row set to §86 (e.g. "core + math + scene + render-webgl minimal 2D app ≤ X kB
gzip" — owner to pick X; even a generous number makes regressions visible in CI per §92's
performance tracking).

---

## C. Smaller gaps and structural improvements (P3)

### R-26 — Shared-memory deployment constraints (§88)

Split-simulation mode with `SharedArrayBuffer` requires cross-origin isolation (COOP/COEP
headers). Add a deployment note to §88 and to the documentation plan (§93), so worker modes
don't silently fail on unconfigured hosts.

### R-27 — Package responsibility coverage (§98–§102)

Part VIII gives responsibility lists for only 3 of 24 packages (motion, animation, physics)
plus the solver packages. Notably homeless: camera rigs/controls (§44, §47 — `@fourjs/scene`?
`@fourjs/input`? a future `@fourjs/controls`?), tessellation (R-7), units (§101 puts "units" in
physics, but §40 is engine-wide). **Proposal:** add one-line responsibility entries for the
remaining packages (the scaffold's per-package READMEs already exist and could be the source),
and assign camera rigs and units explicitly.

### R-28 — Reduced motion beyond UI (§75)

`prefers-reduced-motion` is listed only as a UI-module requirement. Decorative motion comes
from the animation system. **Proposal:** add an application-level `reducedMotion` policy
(auto-detected, overridable) that animation APIs can consult, with UI required to honor it and
non-UI animation opted in by the developer.

### R-29 — Runtime WebGPU failure and fallback (§62)

`"auto"` prefers WebGPU, but adapter/device request can fail or be lost mid-session (see
R-20). **Proposal:** specify that `"auto"` falls back to WebGL 2 on WebGPU initialization
failure (with a diagnostics event), and that an explicit `renderer: "webgpu"` fails fast with
`RENDERER_INITIALIZATION_FAILED` instead of silently downgrading.

### R-30 — Visual-test baselines and the headless backend (§62, §92)

Visual regression across WebGPU/WebGL/Canvas will never be pixel-identical; §92 doesn't say
whether baselines are per-backend or shared, nor the comparison tolerance model. Also, §62
ranks "headless/software" last as an extension, but §92's determinism tests and CI (§91) need
headless execution from Phase 1. **Proposal:** per-backend baselines with perceptual-diff
tolerance; clarify that _headless simulation_ (no renderer — already implied by §104's exit
criterion) is Phase 1, and headless _rendering_ is the later extension.

### R-31 — Part VII structure

Part VII spans §45–§97 (53 sections, ~45 % of the spec) under one heading. Renumbering
sections is off the table (the E-1/E-2 history makes § stability valuable), but uncounted
sub-part headings are safe. **Proposal:** insert unnumbered subheadings inside Part VII —
e.g. Application & Scene Services (§45–48), 2D Vector Graphics (§49–52), Geometry & Materials
(§53–60), Renderer Core (§61–67), Lighting & Post (§68–70), Interaction & UI (§71–75), Assets
& Serialization (§76–81), Platform (§82–90), Process & Quality (§91–96), Example (§97) — and
mirror them in the TOC.

### R-32 — Conformance language

"shall", "should", "must", "may", and "recommended" are used throughout without definition,
and sometimes interchangeably (§4 "shall" vs §20 "should" for equally core requirements).
**Proposal:** add an RFC-2119/BCP-14 conformance note after §5 and audit Part I–VI usage in
the same pass (Part VII+ can be audited opportunistically).

### R-33 — Glossary

Motion vs animation vs kinematics vs dynamics (§3), authority (§42), determinism tiers (§33),
logical vs physical pixels (§47, §74), sensor vs collider (§24), world vs local-plane space
(§8) — the spec defines these in passing, scattered. **Proposal:** add a glossary appendix;
one line each, citing the defining section.

### R-34 — Spec self-versioning

The document has a status line but no version number, date, or change log; ERRATA.md carries
the correction history but future amendments (e.g. any adopted from this review) need a home.
**Proposal:** add a version/date stamp under the title and a short "Amendments" table (date,
sections touched, one-line summary), with ERRATA.md reserved for extraction-defect history.

### R-35 — §45 code fence typesetting

The §45 fence mixes runnable statements (`await app.initialize(); app.start();`) with the
`interface ApplicationOptions` declaration in one block. Split into two fences (example vs
interface). Typesetting only; no wording change.

---

## Suggested disposition order

1. **Before Phase 1 (§104):** R-6 (components), R-11 (events), R-12 (transforms), R-13 (math
   conventions), R-10/R-5 (coordinate conventions), R-3/R-4/R-8 (time), R-32 (conformance
   language — cheapest while auditing the above).
2. **Before Phase 5 (§108):** R-1, R-2, R-9, R-14, R-15, R-16, R-19.
3. **Before renderer work beyond the MVP backend:** R-20, R-21, R-29, R-30.
4. **Scope decisions (any time, owner call):** R-7, R-22, R-23, R-24, R-25, R-27.
5. **Editorial batch:** R-26, R-28, R-31, R-33, R-34, R-35.
