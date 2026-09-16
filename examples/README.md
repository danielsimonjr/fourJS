# Examples

Runnable examples planned by the documentation plan (§93) and the flagship demonstrations
(§118–119). Every major feature should have a runnable example (§93).

**Thirteen examples are implemented** (six until 2026-08-07, when `first-3d-scene` and then
the §118 flagship were written; nine on 2026-08-08, when §119's motor digital twin was
written; ten on 2026-08-29, when the §12 character-controller example was written; thirteen
on 2026-09-06, when the three remaining §93 names gained a thin `main.ts` that re-exports
an existing scene). Until 2026-08-05 the missing rows were described only as "scaffold
only" in this paragraph while reading like a catalogue of demos in the list. **S-8** in
`docs/AUDIT-120.md` is now closed: the directories are real sites, not independently
authored ones.

## Running one

```sh
bunx vite examples/first-2d-scene     # dev server; open the URL it prints
bun run example:build                 # production build into examples/first-2d-scene/dist
```

Every entry below names its own `bun run …:build` script. Those **build** an example —
they write a `dist/` and open nothing. To _look_ at one, use the `bunx vite` form above
with that example's directory; nested examples take their full path, as in
`bunx vite examples/flagship/motor-digital-twin`.

A built `dist/` cannot be opened as a `file://` page: Vite emits absolute asset paths,
so it has to be served (`bunx vite preview examples/<name>`, which is what the browser
gates in `playwright.config.ts` do).

- [`first-2d-scene/`](first-2d-scene/) — **Implemented.** First 2D scene (§93) grown into
  the interactive demo: shapes, motion, picking, dragging, text, animation
  (`bun run example:build`).
- [`blending/`](blending/) — **Implemented.** The §110 Phase 7 demonstration: an articulated
  chain cycling between animated, ragdoll and blended-recovery control on a click — pose
  targets, §19 weights, velocity inheritance, live continuity measurement
  (`bun run blending:build`).
- [`particles-demo/`](particles-demo/) — **Implemented.** The §112 Phase 9 demonstration: a
  seeded CPU particle fountain under §27 force fields (gravity, drag, vortex), bouncing off a
  §36 collision plane, plus a click burst — each system drawn as one instanced draw call
  (`bun run particles-demo:build`). Non-wasm and ~19 kB gzip; the 100 000-particle half of
  §112 is measured headlessly by `benchmarks/particles-100k.mjs`.
- [`mechanism/`](mechanism/) — **Implemented.** The §109 Phase 6 demonstration: a
  motor-driven slider–crank — rotating shaft, hinges, limited slider, spring buffer,
  limit-switch lamps, click-to-coast motor with speed controls
  (`bun run mechanism:build`).
- [`physics-playground/`](physics-playground/) — **Implemented.** The §108 Phase 5 exit
  demonstration: a 2D world and a 3D world stepping side by side through one API —
  gravity, collisions, click impulses, sensor zones (`bun run playground:build`).
  Since 2026-08-29 it is also the worked example of §39's steps 8 and 9: dispatch split
  to `PhysicsEventSystem` at 900 (PH-21), with a `ZoneTallySystem` at
  `PRIORITY_SENSOR_UPDATE` (800) re-measuring each zone through a §30 overlap query that
  the step-9 listeners consume for the repaint.
  Fulfils the role sketched for `first-physics-scene/` (that directory is now a thin
  re-export of this page, 2026-09-06).
- [`ui-demo/`](ui-demo/) — **Implemented.** §73–§75's retained-mode UI: a `@fourjs/ui` panel of
  buttons and labels laid out by the package and skinned by the application, driven by real
  pointer and keyboard input, with a drawn focus ring (`bun run ui-demo:build`). Listed
  here from 2026-08-05; it shipped earlier and this file had never mentioned it.
- [`gltf-model/`](gltf-model/) — **Implemented.** §78's loader, end to end: `createGltfLoader`
  handed to `AssetManager.load`, then `instantiateGltf` into live nodes
  (`bun run gltf-model:build`). It exists because §78 shipped tested but undemonstrated, and it
  shows the two things a first attempt gets wrong — the entry point is `createGltfLoader` rather
  than a `loadGltf`, and a `.gltf` naming an external buffer needs `{ fetch }` or the load fails
  on the `.bin` the manager never sees.

- [`first-3d-scene/`](first-3d-scene/) — **Implemented (2026-08-07).** §93's first 3D
  scene, and the first example of any kind to use a `PerspectiveCamera`: two identical
  spheres at different depths (the projection measured in pixels, not asserted by class
  name), a tumbling torus, a bobbing capsule and a ground plane, all `LitMaterial` under one
  `DirectionalLight` plus scene ambient (§47, §53, §57, §68).
  Build it with `bun run first-3d-scene:build`; it is non-wasm and ~23 kB gzip.
  This entry read "**not yet written; directory is a placeholder** … the one placeholder
  with no stand-in" until that date.
- [`character-controller/`](character-controller/) — **Implemented (2026-08-29).** The
  §12 controller family in one first-person page (the PH-11/PH-11b follow-up): a
  `SweptCharacterController` capsule walked with WASD through §30 shape casts — walls
  slide it, three stair risers are climbed by the step-up, Space jumps — with
  `FirstPersonLook` on a child eye node (§44's yaw ∘ pitch decomposition, mouse-drag and
  arrow-key look) and a plane-tier `CharacterController` patrolling a circle with no
  physics body at all, all under the §39 input → kinematics → solve ordering. Build it
  with `bun run character:build`; it carries **one** Rapier wasm image (a
  directly-constructed `Rapier3dAdapter`) and is ~0.90 MB gzip.
- [`first-animated-scene/`](first-animated-scene/) — **Implemented (2026-09-06) as a thin
  entry.** §93's first animated scene: `main.ts` imports `first-2d-scene/`, which already
  runs the tweens, clip and timeline. No dedicated Playwright project — it shares
  `first-2d-scene`'s browser gate. Built on Pages by `docs.yml`.
- [`first-physics-scene/`](first-physics-scene/) — **Implemented (2026-09-06) as a thin
  entry.** §93's first physics scene: `main.ts` imports `physics-playground/`. Shares that
  page's browser gate. Built on Pages by `docs.yml`.
- [`mixed-scene/`](mixed-scene/) — **Implemented (2026-09-06) as a thin entry.** §93's
  mixed 2D/3D/physics example: `main.ts` imports `physics-playground/`, which steps a 2D
  and a 3D world side by side. Shares that page's browser gate. Built on Pages by
  `docs.yml`.
- [`flagship/one-scene-everything-moves/`](flagship/one-scene-everything-moves/) —
  **Implemented (2026-08-07).** §118's flagship, "One Scene, Everything Moves": every item
  on §118's list in one scene, one fixed-step loop and one frame — a textured lit cube spun
  by a `MotionComponent`, a 2D vector orbit, a `SpringJoint` pendulum, a bouncing body whose
  §29 landings fire a particle burst and a re-launch impulse, a motorised `HingeJoint`, two
  world-space labels (one rides the bouncing body), a `@fourjs/ui` panel drawn by a second,
  screen-space viewport under §47's `ScreenCamera` (it was parented to the camera until
  2026-08-21, when R-37's camera landed and the workaround was retired), a §16 `Timeline`,
  and pause / slow-motion / single-step controls that are keyboard-operable. It is also the first example to select its backend _and_ its solver
  through the §62/§37 registries (`renderer: "auto"`, `solver: "auto"`), and the first to
  assemble the §113 debug overlay from `@fourjs/diagnostics` streams.
  Build it with `bun run flagship:build`; it carries **both** Rapier wasm images (the cost
  of `registerRapierSolver()`, measured) and is ~1.54 MB gzip. This entry read "**not yet
  written; directory is a placeholder**" until that date.
- [`flagship/motor-digital-twin/`](flagship/motor-digital-twin/) —
  **Implemented (2026-08-08).** §119's engineering flagship, "Electric Motor Digital
  Twin": a motorised shaft on two coaxial bearing `HingeJoint`s inside a stator that
  hangs on a §28 slider-and-spring mount, so a deliberate rotor unbalance produces real
  vibration; a `PIDController` closing the speed loop on the shaft's measured
  `angularVelocity`; two physical faults (a bearing rub driven by a §28 **slider** motor,
  and a supply sag expressed as a derated actuator); a lumped thermal model with a trip;
  two scrolling waveform charts drawn as one `"lines"` draw call; and a §34 record / seek /
  replay audit paired with a §79 save-and-reload that round-trips byte-identically.
  It is the first example to read §84's `app.stats`, the first to use §40's unit-conversion
  helpers (RPM, degrees, millimetres, milliseconds at the display edge only), and the only
  one built in **development** mode, because §84's statistics path is gated on
  `__FOUR_DEV__` (A-4). Build it with `bun run twin:build`; it carries **one** Rapier wasm
  image (a directly-constructed `Rapier3dAdapter`) and is ~0.93 MB gzip. This entry read
  "**not yet written; directory is a placeholder**" until that date.
