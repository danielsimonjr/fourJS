# Particles

The §112 / §36 demonstration: a seeded CPU particle fountain under §27 force fields, bouncing
off a collision plane, drawn as **one instanced draw call** — plus a second system that fires
a burst when you click.

§112 asks for _"≥100,000 simple particles simulated and rendered at interactive rates on
suitable hardware"_. This page is deliberately **not** that number. Plan §6h splits the
criterion into the parts that can each be shown honestly, and this page is the visible one:

| half of §112                                          | where it is shown                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| 100 000 particles simulated on the CPU                | `benchmarks/particles-100k.mjs` — recorded ms/step, never CI-gated      |
| rendered as one batched draw per system               | `@fourjs/render`'s `particles.ts` + `@fourjs/render-webgl`'s instanced path |
| at interactive rates, on screen, responding to a user | **this page**, at ~1 800 particles — the size SwiftShader can sustain   |
| deterministically (plan P9-4)                         | `tests/determinism/phase9-particles.test.ts`                            |

A browser gate with no GPU cannot answer "100 000 particles at 60 fps"; it can answer "the
batched path reaches a real framebuffer, keeps moving, obeys its collision plane, and reacts
to a click", and that is what `tests/browser/particles.spec.ts` measures here.

R-33's **simulate / present split** is published on `#status` (`data-simulate` and
`data-present`, **seconds**, §7a) so a later run on non-SwiftShader hardware can fill the
two halves separately. The split has landed; §112's exit is **not** claimed on this host.

## Non-wasm, on purpose

There is no physics package on this page and therefore no WebAssembly image. It is the
`first-2d-scene` tier, not the `physics-playground` tier, which is the whole reason a **fifth**
Playwright web server was worth adding (plan §6h weighed it against a gated region in the
playground).

## Running it

```sh
bun run build                  # the packages the example imports as `four/…`
bun run particles-demo:build   # bundles to examples/particles-demo/dist
npx vite preview examples/particles-demo
```

or, for a dev server with hot reload:

```sh
npx vite examples/particles-demo
```

## The two systems

| node       | emitter                                                       | what it demonstrates                                  |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `fountain` | 900 particles/s, warm ramp, three §27 fields, collision plane | steady-state simulation, force fields, §36 collision  |
| `burst`    | rate 0, cool ramp, gravity only, fired by a click             | §36 bursts, lifetimes expiring, a second batched draw |

Two nodes rather than one, because that is what makes "one draw call **per system**" visible:
the render list carries exactly two particle items and the backend issues exactly two
`drawArraysInstanced`, whatever the particle counts are.

### The fountain

| option                            | value                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `maxParticles`                    | 2 600                                                                                                                           |
| `seed`                            | 90 401                                                                                                                          |
| `position`                        | `(0, −2.35, 0)`                                                                                                                 |
| `emissionRate`                    | 900 /s                                                                                                                          |
| `lifetime`                        | 1.6 … 2.4 s                                                                                                                     |
| `initialSpeed`                    | 5.4 … 7 units/s                                                                                                                 |
| `direction` / `spreadAngle`       | `+Y` / 0.3 rad (cone **half**-angle)                                                                                            |
| `size`                            | 0.075 → 0.02                                                                                                                    |
| `color`                           | `(1, 0.74, 0.28, 1)` → `(0.95, 0.22, 0.08, 0)`                                                                                  |
| fields (in order)                 | `uniformGravityField(0, −9.81, 0)`, `dragField(0.35)`, `vortexField(center (0,−0.4,0), axis +Z, strength 2.2, minDistance 0.6)` |
| `collisionPlaneY` / `restitution` | `−2.4` / 0.35                                                                                                                   |

Steady state is `emissionRate × mean lifetime = 900 × 2 = 1800` live particles, and the pool
has 800 slots of headroom above that, so **no spawn is ever dropped** — the page publishes the
drop count so that is checkable rather than assumed.

The field order is part of the contract: floating-point addition is not associative, so
reordering those three lines changes the simulation.

`minDistance: 0.6` on the vortex is not decoration. A vortex's acceleration goes as
`strength / d`, so the default 0.01 floor would cap it at 220 units/s² and fling the particles
that spawn nearest the axis; 0.6 puts the cap at 3.7 units/s², which is a swirl.

### The burst

| option         | value                                                  |
| -------------- | ------------------------------------------------------ |
| `maxParticles` | 1 900 (two overlapping bursts fit)                     |
| `seed`         | 90 402                                                 |
| `position`     | `(0, 0.8, 0)`                                          |
| `emissionRate` | 0 — silent until `emit()`                              |
| per click      | 900 particles                                          |
| `lifetime`     | 1.6 … 2.4 s                                            |
| `initialSpeed` | 1.6 … 3.2 units/s                                      |
| `spreadAngle`  | `π` — a full sphere                                    |
| `size`         | 0.09 → 0.025                                           |
| `color`        | `(0.4, 0.86, 1, 1)` → `(0.16, 0.36, 1, 0)`             |
| `gravity`      | `(0, −3, 0)` — through the emitter option, not a field |

Two of those are chosen against the **instrument**, and they are worth stating because they
would otherwise look arbitrary:

- **Gravity is −3, not −9.81.** At −9.81 a 2-second burst falls 20 world units and leaves a
  6-unit-tall view within half a second.
- **The lifetime is 1.6–2.4 s.** One `canvas.screenshot()` costs about **284 ms** under
  SwiftShader at this size (measured, WP-9.4). A half-second burst would be a race between
  the effect and the camera rather than a test of the effect.

Gravity comes from the emitter's `gravity` option rather than a `uniformGravityField` because
there is exactly one constant acceleration here and the option costs no virtual call per
particle — a difference the benchmark measures at roughly 5 ms per field per 100 000
particles.

## The click, and what it deliberately does not do

A click fires the burst from a **fixed** world position, not from the pointer. That is an MVP
limitation stated rather than worked around: `ParticleEmitterOptions.position` is read once,
in the constructor (WP-9.1 stages runtime re-authoring — §36 gives no invalidation rules for
the derived cone basis or the burst schedule). Moving the _node_ to the pointer would work,
and would also drag every still-live burst particle with it, because particles simulate in the
node's local space; a rapid second click would teleport the first burst. Pointer picking has
its own demonstration in `examples/first-2d-scene` (§71/§72); this page demonstrates §36's
burst.

## Layout, in world units

One orthographic camera shows 8 × 6 world units over an 800 × 600 canvas: **100 CSS pixels per
world unit**, `px = (x + 4) × 100` and `py = (3 − y) × 100`. +Y is up, angles are radians,
times are seconds (§7a). The camera sits at `z = 10` with `near 0.1 / far 20` — a deep
orthographic frustum costs nothing and keeps the spherical burst's ±Z travel inside the view.

| element         | world                        | pixel            |
| --------------- | ---------------------------- | ---------------- |
| view bounds     | `x ∈ [−4, 4]`, `y ∈ [−3, 3]` | `0…800`, `0…600` |
| fountain mouth  | `(0, −2.35)`                 | `400, 535`       |
| collision plane | `y = −2.4`                   | row `540`        |
| vortex centre   | `(0, −0.4)`                  | `400, 340`       |
| burst origin    | `(0, 0.8)`                   | `400, 220`       |

## Colour discipline

The browser gate has to attribute a pixel to one system or the other from the outside, and §66
gives this tier no material state to label them with. So hue is the channel:

1. the **fountain** is warm — red leads blue by a wide margin at every point of its ramp;
2. the **burst** is cool — blue leads red by the same margin at every point of its ramp;
3. the **background** is `#0d0f14`, framebuffer bytes `13, 15, 20` (measured under
   SwiftShader at DPR 1) — dark, and with blue _ahead_ of red by 7, so no unlit pixel can be
   warm however a particle fades into it.

Both ramps end at alpha 0, so a particle fades rather than pops, and a half-faded particle
blends toward the background — which moves it _away_ from both classifiers rather than across
them. The gate's classifiers are `red ≥ 90 && red − blue ≥ 45` (fountain) and
`blue ≥ 90 && blue − red ≥ 45` (burst); they cannot both fire on one pixel.

## What the page mirrors onto the DOM

`#status` carries the live simulation as data attributes, so a test can read the engine's own
numbers instead of inferring everything from pixels:

| attribute       | value                                           |
| --------------- | ----------------------------------------------- |
| `data-state`     | `loading` → `running`, or `error`               |
| `data-fountain`  | live particles in the fountain pool             |
| `data-burst`     | live particles in the burst pool                |
| `data-bursts`    | clicks handled since load                       |
| `data-frames`    | host frames rendered                            |
| `data-dropped`   | spawns refused by either pool — should stay `0` |
| `data-simulate`  | **seconds** (§7a) — wall-clock cost of `ParticleSystem.fixedUpdate` for this host frame's fixed-step burst (R-33). `0` if the frame ran no fixed step. |
| `data-present`   | **seconds** (§7a) — wall-clock cost of `renderer.render` (list build + instance upload + draw) for this host frame (R-33). A separate attribute from `data-simulate`; never folded into one number. |

The visible sentence shows those two durations in **milliseconds**; the attributes stay in
seconds, matching `examples/first-2d-scene`'s `data-alpha` / `data-dropped` / `data-substeps`.
Neither attribute is a 16.6 ms / 60 fps claim — this host is SwiftShader.

They are written after `app.step` returns — once per host frame, after every fixed step *and*
the draw of that frame have run — because these are costs and counts a _frame_ observes, not
quantities a fixed step produces.

## Measured (WP-9.4 probe, headless Chromium + SwiftShader, 800 × 600 at DPR 1)

| quantity                                                                         | measurement                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ready after load (`data-state="running"` with particles alive)                   | `126 … 137 ms`                                                                                   |
| fountain steady-state population                                                 | `1 803 … 1 811` live particles                                                                   |
| dropped spawns, over a 15-second session                                         | `0`                                                                                              |
| fountain pixels, eight steady frames                                             | `21 972 … 22 608`                                                                                |
| fountain vertical extent                                                         | rows `298 … 543` (the plane is row `540`; a quad resting on it paints ~3 px below)               |
| fountain horizontal extent                                                       | columns `292 … 759`                                                                              |
| pixel change over 250 ms                                                         | `34 052` of 480 000 (7.1 %)                                                                      |
| burst pixels **before** any click                                                | `0`                                                                                              |
| burst pixels, first screenshot after a click (~500 ms, screenshot-latency bound) | `10 600`                                                                                         |
| burst pixels, peak                                                               | `33 191` at ~900 ms                                                                              |
| burst pool after a click                                                         | exactly `900`, holding for ~2 s                                                                  |
| burst fully expired                                                              | `0` live and `0` cool pixels by ~2.7 s                                                           |
| one `canvas.screenshot()`                                                        | `284 ms`                                                                                         |
| console errors                                                                   | none (Chromium's own `/favicon.ico` 404 is routed away by the spec, as in every other gate here) |

## Bundle size

Well inside the §86 payload budget (150 kB gzip for the built example), and the point of the
page being cheap enough to justify its own preview server: **59 908 B raw / 18 903 B gzip**
for the one JS chunk, plus 2 261 B (1 122 B gzip) of HTML — `gzip -9`, the measurement
`examples/mechanism` and `examples/blending` record. (Vite's own build log reports 59.91 kB /
19.35 kB for the same chunk; it gzips at a lower level.)

For scale: `examples/blending` is 674 667 B gzip, because it embeds a Rapier wasm image. This
page has none.
