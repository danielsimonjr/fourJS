# §120 MVP audit

**Audited 2026-08-02** against the tree on `claude/specification-improvements-iug6pi`
(Phase 11 in progress; WP-11.1 serialization and WP-11.2 assets committed, WP-11.3 UI and
WP-11.4 benchmarks landing with this document).

**Amended 2026-08-04:** the lighting packet landed (owner-directed; see S-5 for the tier),
so the one **staged** row moved to **shipped (MVP tier)**. The verdict table and the
rendering table below reflect the amendment; S-5 keeps the original staging record and
carries the shipped note.

**Corrected 2026-08-05** (doc-truth sweep; no code changed, three claims in this file were
false when written and are corrected in place with the original wording quoted):

- the tooling **examples** row claimed "10 example applications … incl. the five §93 guide
  scenes and the flagship"; six exist and the rest are `.gitkeep`-only directories. The row
  said six until 2026-08-07 and says eight since (`first-3d-scene`, then §118's
  `flagship/one-scene-everything-moves`, were written); the remaining shortfall is staged as
  **S-8**;
- the same table said `tests/visual/` "is an empty placeholder"; a golden-image suite
  landed there 2026-08-04;
- the Rendering table's **sprites** note, and S-4's first sentence, said sprites are
  "batched"; the WebGL backend draws one sprite per draw call.

These are corrections to the audit's prose, not status changes: no row's verdict moved,
and the 43-of-43 census below is unaffected. `tools/check-docs.mjs` now greps for all
three so they cannot return.

This is the exit artefact of **plan §6j, P11-5**: _"audit §120 against reality; anything
unshipped gets a dated staged note — the exit's 'complete' reads as
'shipped-or-staged-with-note', consistent with every prior phase."_ §113a closes Phase 11
on, among other things, _"the §120 tooling list is complete"_, and this file is the
evidence for that clause and for the rest of §120 with it.

It is an audit, not a plan. It records what exists, points at the file or command that
proves it, and says plainly where something does not exist. Nothing here is a commitment
to build anything; the staged lines below are dated statements of absence, which is what
§6j asked for.

## Verdict

|                                                                                     |  items |       |
| ----------------------------------------------------------------------------------- | -----: | ----- |
| **Shipped** — implemented, exported, and covered by tests                           | **37** | of 43 |
| **Shipped at a pinned MVP tier** — usable, with a §-level widening staged and dated |  **6** | of 43 |
| **Staged** — not shipped; dated line below                                          |  **0** | of 43 |

**43 of §120's 43 items ship** (since the 2026-08-04 lighting packet; 42 of 43 at the
original 2026-08-02 audit). Lighting was the one never-scheduled item — Phase 3's pinned
MVP tier was _"unlit colored geometry, WebGL 2 only"_ (plan §6a) and no later phase widened
it until the owner directed the lighting packet; it now ships at the pinned tier S-5
records (one directional light, Lambert + scene ambient).

Counting note: the 43 items are §120's own bullets, one row each, in §120's order. Rows
are not weighted — "Node" and "one solver adapter" count the same — so the totals are a
coverage census, not a measure of effort or of risk.

### How to read the status column

- **shipped** — the named thing exists in a package's public exports and is exercised by
  the test suites; nothing about it is deferred.
- **shipped (MVP tier)** — the named thing exists and works at the tier the plan pinned
  for it. The specification asks for more in a numbered section, and that widening is
  staged with a date in the notes below. An application can use these today.
- **staged** — not shipped. A dated line says so and says where the decision was made.

---

## Scene

| §120 item | status             | evidence                                                                                  | note                                                                         |
| --------- | ------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node      | shipped            | `packages/scene/src/node.ts`; `packages/scene/tests/node.test.ts`                         | §6, D1: extends `EventEmitter`, single inheritance                           |
| Group     | shipped            | `packages/scene/src/group.ts`                                                             |                                                                              |
| Scene     | shipped            | `packages/scene/src/scene.ts`                                                             |                                                                              |
| Transform | shipped            | `packages/scene/src/transform.ts`, `world-transforms.ts`                                  | §7; world matrices resolved per fixed step and before render-item generation |
| Cameras   | shipped            | `packages/scene/src/camera.ts` (`PerspectiveCamera`, `OrthographicCamera`), `viewport.ts` | §47–48; cameras and viewports live in `@fourjs/scene` per spec rev 1.3       |
| Layers    | shipped (MVP tier) | `packages/render/src/renderable.ts` (`renderLayer`), `render-list.ts` (primary sort key)  | numeric layers only — see **S-1**                                            |

## Time and Motion

| §120 item            | status  | evidence                                                                                              | note                                                                                                                                                        |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clock                | shipped | `packages/motion/src/clock.ts` (`TimeState`, `createTimeState`), `packages/fourjs/src/application.ts` | §9's five time domains. There is no class literally named `Clock`; §9's model is `TimeState` plus the application's own clock, and that is the shipped form |
| fixed-step scheduler | shipped | `packages/motion/src/scheduler.ts`, `packages/fourjs/src/application.ts`                              | §10; accumulator, `maximumSubSteps` clamp, `droppedTime`, `interpolationAlpha`                                                                              |
| MotionComponent      | shipped | `packages/motion/src/motion-component.ts`                                                             | §6a component, one per node                                                                                                                                 |
| velocity             | shipped | `packages/motion/src/motion-component.ts`                                                             | linear and angular                                                                                                                                          |
| acceleration         | shipped | `packages/motion/src/motion-component.ts`, `integrators.ts`                                           | semi-implicit Euler; acceleration callback                                                                                                                  |
| path motion          | shipped | `packages/motion/src/kinematic-controller.ts` (`PathFollowOptions`), `trajectories.ts`                | §14; nine trajectory types                                                                                                                                  |
| interpolation        | shipped | `packages/scene/src/interpolation.ts` (`PoseBuffer`, `createSnapshotSystem`)                          | §43; render interpolation never feeds back into physics state                                                                                               |

## Animation

| §120 item        | status  | evidence                                                 | note                                                                    |
| ---------------- | ------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tween            | shipped | `packages/animation/src/tween.ts`                        | §15; seconds throughout (§7a)                                           |
| easing           | shipped | `packages/animation/src/easing.ts`                       | the full §15 table, plus spring/bounce/elastic                          |
| Timeline         | shipped | `packages/animation/src/timeline.ts`                     | §16 incl. markers and replay/restore semantics                          |
| transform tracks | shipped | `packages/animation/src/track.ts`, `clip.ts`, `mixer.ts` | §17; number/vector/quaternion/color/discrete adapters, §42-gated writes |

## Physics

| §120 item                             | status             | evidence                                                                                | note                                                                                                                    |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PhysicsWorld                          | shipped            | `packages/physics/src/world.ts`                                                         | §20                                                                                                                     |
| 2D and 3D world descriptors           | shipped            | `packages/physics/src/descriptors.ts`                                                   | §21; Y-up in both, 2D gravity is negative Y                                                                             |
| static, dynamic, and kinematic bodies | shipped            | `packages/physics/src/rigid-body.ts`                                                    | §22–23 incl. both kinematic modes                                                                                       |
| basic colliders                       | shipped (MVP tier) | `packages/physics/src/shapes.ts`, `collider.ts`                                         | §24's remaining shapes SHIPPED 2026-08-02 (PH-22a) — **S-2 resolved**; re-verified 2026-09-07                           |
| gravity                               | shipped            | `packages/physics/src/descriptors.ts` (`resolveGravity`)                                | Appendix A default `(0, −9.81, 0)`                                                                                      |
| forces                                | shipped            | `packages/physics/src/rigid-body.ts` (`applyForce`, `applyForceAtPoint`, `applyTorque`) | §26; commands buffered and drained at the top of the step                                                               |
| impulses                              | shipped            | `packages/physics/src/rigid-body.ts` (`applyImpulse`, `applyImpulseAtPoint`)            | §26                                                                                                                     |
| collision events                      | shipped            | `packages/physics/src/events.ts`, `world.ts` (`dispatchEvents`)                         | §29; dispatched after each fixed step (§39 step 9)                                                                      |
| ray casting                           | shipped            | `packages/physics/src/queries.ts`, `world.raycast`                                      | §30; plus shape casts, overlaps and point queries                                                                       |
| one solver adapter                    | shipped            | `packages/physics-rapier/src/rapier2d-adapter.ts`, `rapier3d-adapter.ts`                | §37; two adapters, one per §21 dimension. `physics-box2d` and `physics-soft` are scaffolds, which is what §120 asks for |
| debug drawing                         | shipped (MVP tier) | `packages/diagnostics/src/debug-draw.ts`                                                | data providers ship; the render wiring is staged — see **S-3**                                                          |

## Rendering

| §120 item       | status             | evidence                                                                                                                                                                                                                           | note                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGL 2         | shipped            | `packages/render-webgl/src/webgl-renderer.ts`; `tests/browser/*.spec.ts` under Chromium/SwiftShader                                                                                                                                | §62; the other four backends are scaffolds, per §120's "WebGL 2 only"                                                                                                                                                                                                                                            |
| 2D primitives   | shipped (MVP tier) | `packages/geometry/src/primitives.ts` (`circleGeometry2D`, `planeGeometry`), `packages/render/src/sprite.ts`                                                                                                                       | §50's shape catalogue and §51's `Path` are staged — see **S-4**                                                                                                                                                                                                                                                  |
| basic 3D meshes | shipped            | `packages/geometry/src/primitives.ts` (`boxGeometry`), `primitives-3d.ts` (`sphere`, `cylinder`, `cone`, `capsule`, `torus`, `lathe`, `extrude`, `tube`, `heightField`), `buffer-geometry.ts`, `packages/render/src/renderable.ts` | §53–54. Qualified 2026-09-07: this row read as box-only because the evidence column named only `boxGeometry`. Nine further 3D primitives ship in `primitives-3d.ts`; what remains staged is skinning/morph (RFC 0003) and §52 tessellation, which lifts the concave-extrude restriction — not the primitive set. |
| lighting        | shipped (MVP tier) | `packages/scene/src/light.ts`, `packages/materials/src/lit-material.ts`, `packages/render/src/lights.ts`, `packages/render-webgl/src/gl-program.ts` (`LitProgram`)                                                                 | §68's MVP tier (2026-08-04): one directional light + scene ambient, Lambert. Widening staged — see **S-5**                                                                                                                                                                                                       |
| sprites         | shipped            | `packages/render/src/sprite.ts`, `packages/materials/src/sprite-material.ts`                                                                                                                                                       | §55. Atlas cells are authored `geometry.uvs` from `Sprite.frame` (2026-09-09); there is no `quad` uniform. Default path is still one draw per sprite (`setModel`/`setTint` + `drawElements`); §65 sprite batching is **opt-in** (`renderer.batching = createGlBatching()`).                                      |
| text            | shipped (MVP tier) | `packages/text/src/{bitmap-font,glyph-atlas,text-layout}.ts`                                                                                                                                                                       | §56's MVP tier: a built-in 6 × 12 bitmap ASCII face, atlas and layout. Shaping and SDF staged — see **S-6**                                                                                                                                                                                                      |

## Interaction

| §120 item      | status  | evidence                                                                | note                                                                      |
| -------------- | ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| pointer events | shipped | `packages/input/src/pointer-events.ts`, `pointer-input.ts`              | §71–72                                                                    |
| 2D picking     | shipped | `packages/input/src/pick.ts`                                            | §72                                                                       |
| 3D ray casting | shipped | `packages/input/src/pick.ts` (`createPickRay`) + `PhysicsWorld.raycast` | picking ray and solver ray are separate paths, both shipped               |
| dragging       | shipped | `packages/input/src/drag.ts` (`DragManager`)                            | §120's own description: down on node → move deltas in world → up releases |

## Tooling — §113a's named exit clause

| §120 item                      | status             | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests                          | shipped            | 113 package unit suites, root suites in `tests/` (`tests/integration` 6 scenario suites + 1 example-build coverage suite, `tests/determinism` 8), 9 Playwright specs (`tests/browser`), 1 visual spec with 2 committed goldens (`tests/visual`)                                                                                                                                                                                                                                                                                       | §92; `pnpm test`, `pnpm test:suites`, `pnpm test:browser`. This row said `tests/visual/` "is an empty placeholder" until 2026-08-05; a SwiftShader-to-SwiftShader golden suite landed there 2026-08-04 (`tests/visual/ui-demo.spec.ts`, Playwright project `visual`). Per-backend perceptual baselines still wait on a second backend                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| examples                       | shipped (MVP tier) | **14** runnable example applications under `examples/`: `first-2d-scene`, `first-3d-scene`, `first-animated-scene`, `first-physics-scene`, `mixed-scene`, `physics-playground`, `mechanism`, `blending`, `particles-demo`, `ui-demo`, `flagship/one-scene-everything-moves`, `flagship/motor-digital-twin`, `character-controller`, and `gltf-model` — each with a `main.ts` and a Vite config. The eleven authored sites have a browser spec; the three §93 names added 2026-09-06 are thin re-exports and share the stand-in's gate | This row said "10 example applications … incl. the five §93 guide scenes and the flagship" until 2026-08-05. It was never true: `examples/{first-3d-scene,first-animated-scene,first-physics-scene,mixed-scene}` and both `examples/flagship/*` directories contained only a `.gitkeep` (verify with `git ls-files examples/`). The count read **6** until 2026-08-07, when `first-3d-scene` was written, **7** until later the same day, when §118's flagship `flagship/one-scene-everything-moves` was written, **8** until 2026-08-08 (`flagship/motor-digital-twin`), **10** until 2026-08-29 (`character-controller`), and **13** since 2026-09-06, when the three remaining §93 names gained a thin `main.ts` (see **S-8**). §120 asks for "examples" without a count |
| API documentation              | shipped            | `typedoc.json` → `docs/api/`; `pnpm run docs` (CI job from Phase 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | §93's reference half. The guides/website half is in-repo documentation per §6j                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| benchmark harness              | shipped            | `benchmarks/harness.mjs` + `math-ops`, `scene-propagation`, `physics-step`, `animation-sampling`, `particles-100k`; records in `benchmarks/results/`                                                                                                                                                                                                                                                                                                                                                                                  | §92's performance tests, §86's targets where honestly measurable. **Recorded, never gated** — see `benchmarks/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| deterministic simulation tests | shipped            | `tests/determinism/*.test.ts` with 8 committed goldens (`golden/phase{1,2,4,5,6,7,9,10}.json`)                                                                                                                                                                                                                                                                                                                                                                                                                                        | §33–34 at the `same-runtime` tier; fresh-process double runs vs committed hashes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## Staged lines (dated)

Each line states what is absent, on what date, and where the decision that left it absent
was made. None of them is a promise.

**S-1 — Named layers (§46). Staged 2026-08-02.**
`Renderable.renderLayer` is a plain `number` and is the render list's primary sort key.
§46 requires human-readable layer _names_ that "compile to efficient masks internally",
shared between render, camera visibility, physics interaction groups and picking. That
shared mapping is a packet of its own and was never scheduled; the numeric field is the
slot it will resolve to. Recorded in `packages/render/src/renderable.ts`.

**S-2 — §24's remaining collider shapes. Staged 2026-08-02 — RESOLVED (PH-22a, 2026-08-02;
re-verified 2026-09-07).** The staging record below is kept as history; **its "Staged:" list
and its compile-error claim are no longer true.** All eight shipped: they are defined in
`packages/physics/src/shapes.ts` and wired into BOTH Rapier converters
(`physics-rapier/src/conversions3d.ts`, `conversions2d.ts`) — a type with no converter would
not have counted. `compound` was never a shape tag: it is multiple colliders by design.
(Original record, pre-existing; carried from the Phase 5 backlog, `TODO.md`.)
Shipped: `circle`, `rectangle`, `polygon` (convex, validated) and `capsule` in 2D;
`sphere`, `box` and `capsule` in 3D. Staged: polyline, chain, cylinder, cone, convex hull,
trimesh, heightfield, compound — `{ type: "cylinder" }` is deliberately a compile error
rather than a runtime surprise. Cut by plan P5-6 and never widened.

**S-3 — Debug-overlay render wiring. Staged 2026-08-02** (pre-existing; carried from the
Phase 10 backlog, `TODO.md`).
The §113 debug-draw _data_ path ships — `DebugDrawSource` providers emit line and point
primitives for contacts, joint anchors, centre of mass and velocity vectors, and the
determinism and unit suites cover them. Drawing them through the WebGL backend needs a
per-segment vertex-colour attribute that the `GL.LINES` path does not yet carry, so the
overlay is not demonstrated end-to-end in a browser. §120's "debug drawing" is therefore
honest as _data_, not yet as _pixels_.

**S-4 — §50's 2D shape catalogue and §51's `Path`. Staged 2026-08-02.**
Shipped: circle and rectangle geometry, and sprites — this line read "and the batching
that draws them" until 2026-08-05, which was wrong in both places it appeared (see the
Rendering table's sprites row): the WebGL backend draws one sprite per draw call. Staged:
ellipse, rounded rectangle, regular and arbitrary polygon, star, line, polyline, arc,
sector, ring, and the whole §51 path model (Bézier construction, flatten/subdivide/
simplify, offset, boolean operations) together with §52's stroke generation — joins, caps,
dashes, stroke alignment. Phase 3's pinned MVP tier is unlit colored geometry and no phase
scheduled §50–52; a tessellation packet is the natural home.

**S-5 — Lighting. Staged 2026-08-02; shipped at the MVP tier 2026-08-04
(owner-directed).** The tier decision the last paragraph below asked for was made: **one
directional light with Lambert shading plus a scene ambient term** — the small packet, not
§59's PBR. What shipped: `DirectionalLight` in `@fourjs/scene` (a node, like cameras; −Z
world-axis direction; `Scene.ambientLight` carries §68's "ambient" as a scene-wide term);
`LitMaterial` in `@fourjs/materials` (color-only, mirroring `UnlitMaterial`, with a `kind`
pipeline discriminant on both); an optional `normals` vertex attribute on `BufferGeometry`
with per-face normals generated by `boxGeometry` (now 24 vertices) and `planeGeometry`
(2D shapes stay unlit and position-only); a backend-independent `collectSceneLights` in
`@fourjs/render` plus the `"lit"` render-item kind; and a fourth GL program (`LitProgram`)
in `@fourjs/render-webgl`. Still staged, dated 2026-08-04 in `packages/scene/src/light.ts`:
point/spot/hemisphere/area lights and multi-light (needs uniform arrays and §68's
clustered path), shadows (§69), §59 PBR / `StandardMaterial`, §60a color management and
tone mapping, CSS color strings on lights, and light layers. The original staging record
follows, kept for the audit trail.

**(Original text, superseded 2026-08-04:)**
`@fourjs/materials` publishes `UnlitMaterial` and `SpriteMaterial` and nothing else: there
is no light type, no light list on the scene, no lit shading path in
`@fourjs/render-webgl`, and no §59 PBR tier. The cause is traceable and is not an oversight
in a packet — Phase 3's scope was pinned as _"MVP tier: unlit colored geometry, WebGL 2
only"_ (plan §6a, whose WP-3.3 and WP-3.5 pinned `UnlitMaterial` and one shader pair), and
Phases 4–11 never revisited it, so §120's "lighting" bullet was never assigned to a phase
at all. The seams a lighting packet would build on already exist — the material and
GL-program abstractions, the render list, `BufferGeometry`'s attribute model — but the
geometry primitives are **positions only** and generate no normals
(`packages/geometry/src/primitives.ts` says so explicitly, and a box with per-face normals
needs 24 vertices rather than 8), so a lighting packet has to widen the vertex layouts too.
It is a scheduling gap rather than a design one, but it is not a one-line gap. Shipping it
also needs a decision about the tier — a single directional light with Lambert shading is a
small packet; §57's unified material model and §59's PBR are not — and that decision is the
owner's, not this audit's.

**S-6 — Text beyond the bitmap tier (§56). Staged 2026-07-29** (pre-existing; spec
revision 1.5, for the shaping half).
`@fourjs/text` ships §56's MVP tier as a **bitmap** face: a dependency-free 6 × 12 monospace
ASCII font in source, a glyph atlas packed to one RGBA8 buffer, and world-space quad
layout. Two things are absent and are worth separating. **Shaping** — complex scripts,
bidi, ligatures, kerning from a real font file — is staged in the specification itself
behind a shaping-engine decision (HarfBuzz-wasm the likely route). **SDF** rendering, which
plan §7's phase table named as Phase 3a's likely seam, did not ship either: the atlas is
straight bitmap coverage, so text does not stay crisp when scaled up. Neither is a defect
against §56's MVP tier as written; both are what "MVP tier" costs here.

**S-7 — glTF asset pipeline (§76–78). Staged 2026-08-02** (plan §6j, P11-2).
Not a §120 row — §120's MVP asset list is silent on glTF — but it is the other dated
staged note Phase 11 produced, and a reader auditing MVP coverage will look for it. A real
glTF pipeline needs the §55 texture tier and materials beyond unlit (see **S-5**), so
`@fourjs/assets` ships JSON, text, binary and image loaders and stages glTF rather than
shipping a stub.

**S-8 — The §93 guide scenes. Staged 2026-08-05; partially closed twice on 2026-08-07,
closed for §118–119 on 2026-08-08, closed for the three remaining names on 2026-09-06.**
Until 2026-09-06 **three** directories under `examples/` contained a `.gitkeep` and
nothing else: `first-animated-scene`, `first-physics-scene` and `mixed-scene`. They were
created by the Phase 0 tree scaffold (see `CHANGELOG.md`, which announced them as if they
had content) and no packet in Phases 1–11 was scoped to write them; the plan's per-phase
demonstrations went to `physics-playground` (§108), `mechanism` (§109), `blending`
(§110), `particles-demo` (§112) and `ui-demo`, and `first-2d-scene` grew into the §93
quick-start scene.

This paragraph said "**Six** directories … and both §118–119 flagships have no
implementation" when it was written, "**Five** …" after `first-3d-scene` landed, and
"**Four** … and `flagship/motor-digital-twin`" until 2026-08-08.

**What changed on 2026-08-07.** This paragraph said "**Six** directories … `first-3d-scene`,
`first-animated-scene`, …" and closed on "one real hole: **no example exercises a
perspective camera or a lit 3D mesh end-to-end in a browser**". That hole is now filled:
`examples/first-3d-scene/` is a real example (a `PerspectiveCamera` over `LitMaterial`
meshes built from the §53 3D primitives, under a `DirectionalLight` plus scene ambient),
built by `pnpm examples:build`, previewed on the seventh Playwright web server and asserted
by `tests/browser/first-3d-scene.spec.ts` — which measures the projection in pixels (the
near sphere covers ≈ 4× the area of an identical far one; an orthographic camera would
score 1.0) and the Lambert gradient in luminance, rather than asserting a class name. The
examples row above moved 6 → 7 with it.

**What changed again on 2026-08-07: §118's flagship.**
`examples/flagship/one-scene-everything-moves` is now a real example, and the examples row
moved 7 → 8. It is the demonstration §118 specifies, item by item: a rotating textured 3D
cube, a 2D vector orbit, a spring-connected pendulum, a bouncing rigid body, world-space
labels, a screen-space control panel, a §16 timeline, a motorised hinge, §29 collision
events, and pause / slow-motion / single-step controls — in one scene graph, one
`Application`, one `PhysicsWorld` and one frame. `tests/browser/one-scene-everything-moves.spec.ts`
measures it on the eighth Playwright web server rather than asserting its parts by name:
six objects counted by hue in one screenshot, ~27 000 changed pixels while running against
**0** while paused, one single step advancing simulated time by exactly 1/60 s, and
simulated time accumulating 20× slower at the slider's minimum. It is also the first
example to take the §62 renderer and §37 solver registries' `"auto"` paths, and the first to
assemble the §113 debug overlay from `@fourjs/diagnostics` streams in a browser.

§118's _success criterion_ is a judgement ("it must feel like one motion-capable engine"),
and no gate can settle it; what the audit records is that the demonstration exists, builds,
and is measured.

**What changed on 2026-08-08: §119's flagship.**
`examples/flagship/motor-digital-twin` is now a real example, and the examples row moved
8 → 9. It is §119's engineering demonstration: a 3D motor model built from §53 primitives,
a rotor turned by a §28 hinge motor between **two coaxial bearing hinges**, a stator hung
on a §28 slider-and-spring mount so that a deliberate rotor unbalance (a second, offset
collider on the same body) produces real vibration, a `PIDController` closing the speed
loop, two physical fault injections — a bearing rub driven by a §28 _slider_ motor, and a
supply sag expressed as a derated actuator — a lumped thermal model with a trip, two
scrolling waveform charts, a §113 vector overlay, and pause / single-step / record / seek /
replay. `tests/browser/motor-digital-twin.spec.ts` measures it on the ninth Playwright web
server: the machine's rotation in changed pixels, the PID within 4 rpm of a 200 rpm
setpoint, **identical §33 checksums from two independent page loads at the same simulation
step**, a §34 seek that reproduces the live run's checksum bit for bit after re-simulating
fewer than 60 steps, a verified replay, and a §79 save/reload/re-save that is
byte-identical.

It is also the first example to read §84's `app.stats` (and therefore the only one built
with `__FOUR_DEV__` left at its default `true`, since A-4 gates that path on it), the first
to use §40's unit-conversion helpers, and the first to take the _cheaper_ solver path —
`new Rapier3dAdapter()` directly rather than §37's `"auto"` registry — which is one wasm
image instead of two: 0.93 MB gzip against the §118 flagship's 1.54 MB.

Three of §119's twelve features ship with a stated boundary rather than in full, each
against a row of `docs/GAP ANALYSIS v1.md`: the **waveform charts** are a `"lines"`
`BufferGeometry` with per-vertex colours because there is no `Path` or 2D shape node
(`R-24`/`R-23`), so they have no stroke, width, axis or grid primitive; the **instrument
column** draws through a second viewport under §47's `ScreenCamera` since 2026-08-21
(`R-37` closed; the camera-parenting workaround is retired); and the **torque and mount-reaction glyphs** are drawn
from the application's own model, because no `PhysicsSolverAdapter` here reports joint
reactions (both Rapier adapters declare `reportsJointReactions: false`) — the example says
so in its header rather than presenting an estimate as a measurement. The **motor model is
procedural** because glTF is staged (**S-7**).

**What changed on 2026-09-06: the three remaining §93 names.** Each directory now has a
`main.ts`, a Vite config and an `index.html`. They are **thin re-exports**, not
independently authored scenes: `first-animated-scene` imports `first-2d-scene` (tweens,
clip, timeline); `first-physics-scene` and `mixed-scene` import `physics-playground`
(gravity, collisions, impulses; 2D and 3D side by side). No packages were edited. They
are built onto Pages by `.github/workflows/docs.yml` and are **not** in
`examples:build` / the Playwright `webServer` list — they share the stand-in's browser
gate. `tools/check-docs.mjs` now counts them as real examples (a tracked `main.ts`).
This staged note is closed. Not a §120 row — §120's tooling bullet says "examples"
without a count — so no verdict above depends on it.

---

## What this audit does not cover

- **Anything outside §120.** The specification is much larger than its MVP list; §113a's
  exit is about §120, and widening the audit would turn a coverage census into a spec
  review. The whole-plan completion audit is **WP-11.6**, not this file.
- **Quality.** Every row above is a presence-and-tests statement. "Shipped" does not mean
  "fast", "beautiful", or "complete against its own § section" — where a § section asks
  for more, the MVP-tier rows say so and the staged lines name the gap.
- **Performance targets.** §86 is measured, not gated, by `benchmarks/`. Two of its rows
  now have recorded numbers on this host (100 000 CPU particles; 5 000 active rigid
  bodies) and both are over the 60 Hz fixed-step budget _on a shared CI container that is
  not §86's "suitable modern desktop hardware"_. That is a recorded measurement and is not
  a §120 verdict; see `benchmarks/README.md` before quoting either number.
- **Uncommitted work.** WP-11.3's `@fourjs/ui` sources were present in the working tree when
  this audit was written and are expected to land with it; `@fourjs/ui` is not a §120 row, so
  no row above depends on that commit.
