# Blending

The §110 demonstration: one articulated chain moving between **animated**, **kinematic** and
**physical** control on a click, with every pose on screen produced by §19's blend of an
animated target pose and a solved one.

§110 asks that "a character or machine can move between animated, kinematic, and physical
control without abrupt discontinuities". This page is that sentence, made clickable and
made measurable.

| mode           | §22 type             | §19 weights (physics / animation) | what owns the pose                                                   |
| -------------- | -------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **ANIMATED**   | `kinematic-position` | 0 / 1                             | a looping clip writes each link's `PoseTarget`; the solver is fed it |
| **RAGDOLL**    | `dynamic`            | 1 / 0                             | Rapier, entered with the velocity the animation had                  |
| **RECOVERING** | `dynamic`            | 1−w / w, `w = i/90`               | both, crossfading over 1.5 s — then re-typed kinematic               |

Nothing in `main.ts` ever writes a link's transform. The links declare `"blended"` transform
authority (§42), animation writes their `PoseTarget` (§19 step 1), and `PhysicsWorld`'s
publish pass performs the single authoritative write: `lerp`/`slerp` between the target pose
and the solver pose, weighted.

## The three systems, and the one an application must register itself

```text
299  createPoseTargetCaptureSystem(physics.worlds)   §19 history: previous ← current
300  AnimationSystem                                 the mixers write PoseTargets
600  PhysicsSystem                                   feed targets → solve → publish the blend
```

`Application` registers neither the animation system nor the capture system. The capture is
not optional here: `setBodyControlMode`'s velocity inheritance finite-differences
`PoseTarget.position` against `previousPosition` over one fixed step, and without the capture
that history never moves — the activation would divide the target's _total_ animated
displacement by one fixed delta (measured at 60 m/s from a 2 m/s animation, WP-7.5).

## Running it

```sh
bun run build            # the packages the example imports as `four/…`
bun run blending:build   # bundles to examples/blending/dist
npx vite preview examples/blending
```

or, for a dev server with hot reload:

```sh
npx vite examples/blending
```

The page shows "loading physics" until the Rapier WebAssembly image has decoded —
`PhysicsSolverAdapter.initialize` is asynchronous for exactly that reason (§37) — and then
starts the frame loop.

## Layout, in world units

One orthographic camera shows 16 × 9 world units over a 960 × 540 canvas: **60 CSS pixels per
world unit**, `px = (x + 8) × 60` and `py = (4.5 − y) × 60`. +Y is up, angles are radians,
times are seconds (§7a).

A link's node origin is its **proximal joint**, not its centre: the collider is pushed one
half-length down by its §24 offset, and so is the drawn quad. That is what lets the animation
be a pure rotation about each joint, which is what makes the animated pose satisfy every
hinge exactly (see below).

| element                      | world position (at wave time 0)      | size / extent                        | pixel centre   |
| ---------------------------- | ------------------------------------ | ------------------------------------ | -------------- |
| anchor block, static         | `(−5.6, 1.8)`                        | `0.6 × 0.6`, **no collider**         | `144, 162`     |
| link 0 (origin = its joint)  | `(−5.6, 1.8)`, `+90.000°`            | half-extents `0.17 × 0.8`            | `144, 162`     |
| link 1                       | `(−4.0, 1.8)`, `+81.322°`            | half-extents `0.17 × 0.8`            | `240, 162`     |
| link 2                       | `(−2.418318, 1.558582)`, `+80.622°`  | half-extents `0.17 × 0.8`            | `334.9, 176.5` |
| chain tip (free end, link 2) | `(−0.839702, 1.297872)`              | —                                    | `429.6, 192.1` |
| ground slab, static          | `(0, −3.45)`, top surface `y = −2.7` | half-extents `8.2 × 0.75`            | `480, 477`     |
| MODE plate                   | `(4.6, 3.2)`                         | `2.2 × 1.0` (px `690…822`, `48…108`) | `756, 78`      |
| plate mark                   | `(4.6, 3.2)`                         | disc `r = 0.22`                      | `756, 78`      |

Four numbers are authored — the anchor at `(−5.6, 1.8)`, the link half-length `0.8`, three
links, and the ground's top at `−2.7` — and the rest follows:

- the chain's reach is `3 × 2 × 0.8 = 4.8 m`, so a chain hanging straight down would reach
  `1.8 − 4.8 = −3.0`, which is **0.3 m below the floor**. The collapsed chain therefore
  drapes against the slab and rests on it rather than swinging free forever; the floor is a
  real §24 collider that the ragdoll actually lands on, not scenery.
- the plate sits at `x ≥ 3.5`, and the chain can never reach past its own starting extent
  (`x ≈ −0.84`), so the two regions never overlap in a frame.

## The wave

Each link's `PoseTarget` is driven by an `AnimationMixer` playing a looping `AnimationClip`
with a `position` track and a `rotation` track — the ordinary §16/§17 path, aimed at a
`PoseTarget` instead of a transform, which is the only thing §19 changes about animating
something.

| parameter          | value                       |
| ------------------ | --------------------------- |
| base angle         | `π/2` (the chain points +X) |
| amplitude          | `0.18 rad` (10.3°)          |
| period             | `3.6 s`                     |
| phase lag per link | `1.0 rad`                   |
| keys per period    | `48` per track              |

The keys are sampled from the chain's own forward kinematics,

```text
aᵢ(t) = π/2 + 0.18 · sin(ωt − i)          ω = 2π / 3.6 = 1.745329 rad/s
p₀ = (−5.6, 1.8),  pᵢ₊₁ = pᵢ + 1.6 · (sin aᵢ, −cos aᵢ)
```

so **every hinge is exactly satisfied at every key**: joint `i + 1` is placed one link-length
along link `i`'s own axis, which is precisely what a hinge constrains. The rig therefore
contributes no constraint error of its own, and any jump the measurement below sees is a jump
the blend produced.

The one inexactness is _between_ keys: a `position` track interpolates linearly along the
chord while the `rotation` track slerps, so a mid-key pose sits inside the arc by
`r · Δa² / 8` — under 0.3 mm at 48 keys and this amplitude. That is why the key count is 48
and not 8. (WP-7.5's door made the same point the other way round: a centre-origin rig
animated along a chord violates its own hinge by millimetres.)

## Interaction

One click plate, picked through §71/§72 (`PointerInput` → local-bounds pick →
`node.on("click", …)`), at world `(4.6, 3.2)` / pixel `756, 78`:

| clicked in     | what happens                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **ANIMATED**   | `setBodyControlMode(node, "dynamic", { inheritVelocityFrom: target })` on every link, weights → physics 1                              |
| **RAGDOLL**    | the 1.5 s weight sweep begins: `physicsWeight = 1 − w`, `animationWeight = w`, one notch of `1/90` per fixed step                      |
| **RECOVERING** | ignored — the sweep is a timed transition, and interrupting it half-way would be a fourth mode this page does not claim to demonstrate |

The sweep ends by itself: one step after `w = 1`, every link is re-typed
`"kinematic-position"` and the cycle counter increments. That ordering is load-bearing — by
then a step has already published at full animation weight, so the node is following the
target alone and the re-type can only move the _solver_ body.

Both weights are written during the sweep, not just the animation one: `normalizedWeights`
divides by their sum, so leaving `physicsWeight` at 1 would ramp the published animation
share as `w / (1 + w)` and reach only ½ at `w = 1`.

### Where this deviates from the integration rig, deliberately

`tests/integration/helpers/blending-scenarios.ts` re-seeds each `PoseTarget` from the pose the
ragdoll landed in before sweeping, which keeps the crossfade short by construction. This page
does not: the wave keeps playing throughout the ragdoll (invisible at animation weight 0, but
running), so the chain blends from where it fell back onto a wave that never stopped. That is
a genuine metres-wide crossfade — you can watch it against the target ghosts — and it costs a
larger per-step displacement during the sweep, which is measured below.

## The target ghosts

Behind each link is a narrower bar in the same hue at 60% brightness, drawn at the link's
`PoseTarget`. While the chain is animated the target _is_ the published pose, so each ghost is
exactly hidden behind its link; the ghosts appear precisely when the two diverge — during the
ragdoll (the wave the chain is no longer following) and during the sweep (the pose it is
blending back onto). They are plain scene nodes with no components; this file copies each
target onto one once per frame.

## Colour discipline

§66 gives this tier no blending, so hue is the channel, and a browser gate has to be able to
attribute a frame part by part:

1. everything static or scenery is dark and near-neutral (max channel < 0.2, channels within
   0.04 of each other);
2. every link is bright (max channel > 0.94) and any two links differ by ≥ 0.35 in some
   channel;
3. a link's ghost is that link's colour at 0.6 — same hue, so whose target it is is obvious;
   0.6, so it differs from its own link by ≥ 0.35 in some channel and from every scenery
   colour by ≥ 0.35 in some channel. A classifier separates the two tiers by max channel
   alone (bodies > 0.94, ghosts < 0.6);
4. the three mode colours differ pairwise by ≥ 0.5 in **two** channels, and each differs from
   every link and ghost colour by ≥ 0.35 in some channel.

The background is the one deliberate exception to rule 1's separability: it is darker than the
scenery but not by 0.35, and nothing measured needs to tell the backdrop from the floor.

Colours as framebuffer bytes (measured, SwiftShader, DPR 1):

| element          | bytes        | element      | bytes         |
| ---------------- | ------------ | ------------ | ------------- |
| link 0           | `250,224,56` | ghost 0      | `150,135,34`  |
| link 1           | `66,184,250` | ghost 1      | `40,110,150`  |
| link 2           | `242,89,217` | ghost 2      | `145,54,130`  |
| plate ANIMATED   | `51,230,89`  | plate mark   | `235,240,250` |
| plate RAGDOLL    | `242,64,76`  | anchor block | `31,31,33`    |
| plate RECOVERING | `89,77,250`  | ground slab  | `48,48,48`    |
| background       | `13,15,23`   |              |               |

## What the page mirrors onto the DOM

`#status` carries the chain's state as data attributes, so a test can read it without decoding
pixels:

| attribute      | value                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| `data-state`   | `loading` → `running`, or `error`                                                  |
| `data-mode`    | `animated` / `ragdoll` / `recovering`                                              |
| `data-cycles`  | completed ANIMATED → RAGDOLL → RECOVERING → ANIMATED cycles                        |
| `data-weight`  | the live §19 animation weight, three decimals                                      |
| `data-tip-y`   | the chain's free end, in metres                                                    |
| `data-chain-y` | the mean Y of the three link origins, in metres                                    |
| `data-entry`   | the per-step displacement of the **first fixed step of the current mode** (metres) |
| `data-step`    | the largest per-fixed-step displacement since this mode began (metres)             |
| `data-worst`   | the largest per-fixed-step displacement since the page loaded (metres)             |

The last three are §110's own measurement, taken from the `fixedUpdate` event — after every
§39 system has run, so the pose read is the one the blend just published and never a §43 render
interpolation of it. A per-_frame_ number would fold several fixed steps together and could not
see a teleport at all.

## Measured (WP-7.6 probe, headless Chromium + SwiftShader, 960 × 540 at DPR 1)

| quantity                                                       | measurement                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ready after load                                               | `232 ms`                                                                                                                                     |
| animated: chain tip band over a full period                    | `1.203 … 2.397 m` (identical to 3 dp across every later cycle)                                                                               |
| animated: mean link-origin Y band                              | `1.545 … 2.055 m`                                                                                                                            |
| animated: largest per-fixed-step displacement                  | `0.0146 m` (0.88 m/s — the wave's own speed)                                                                                                 |
| animated: pixel change over 200 ms, chain region               | mean `6.34` / 255 per channel, max `237`                                                                                                     |
| animated: pixel change over 200 ms, plate / floor / right half | **0.0**, max 0                                                                                                                               |
| **switch 1 (animated → ragdoll), first step**                  | `0.0015 … 0.0148 m` over 8 clicks at different wave phases                                                                                   |
| ragdoll: tip falls from                                        | `≈ +2.2 m` to `−2.6 m`; the chain then swings (up to `+0.74 m` at 2 s)                                                                       |
| ragdoll: settled by                                            | `≈ 3 s`; tip stays in `−2.626 … −2.588 m` after 3 s, `≤ −2.598` after 5 s                                                                    |
| ragdoll: largest per-fixed-step displacement                   | `0.127 … 0.142 m` over 7 collapses (the swing's own speed)                                                                                   |
| ragdoll: link-pixel centroid                                   | moves from `(286, 146)` to `(160…173, 296)`; lowest link pixel `py 431`, on the floor (`py 432`)                                             |
| ragdoll: ghost pixels appear                                   | `0–1 px` while animated → `1090 / 1174 / 1174 px` while collapsed                                                                            |
| **switch 2a (ragdoll → recovering), first step**               | `0.0068 m` — still at the previous weight (see the note below)                                                                               |
| sweep: duration                                                | `1459–1545 ms` wall clock for the 1.5 s of simulated sweep                                                                                   |
| sweep: weight ramp                                             | `0.022 → 1.000`, linear, `1/90` per fixed step                                                                                               |
| sweep: largest per-fixed-step displacement                     | `0.0487 m` — the crossfade, `gap / 90`                                                                                                       |
| sweep: tip lift                                                | monotone `−2.667 → +2.185 m`                                                                                                                 |
| **switch 2b (re-type kinematic), first step**                  | `0.0037 … 0.0146 m` over 8 cycles — bounded by the wave's own step                                                                           |
| resumed: tip band                                              | `1.203 … 2.397 m`, byte-for-byte the pre-ragdoll band                                                                                        |
| resumed: largest per-fixed-step displacement                   | `0.0146 m` — back to the animated figure exactly                                                                                             |
| cycle counter                                                  | one per full cycle; 7 cycles run with no drift in any band                                                                                   |
| a click during the sweep                                       | ignored; the mode stays `recovering` and completes normally                                                                                  |
| console errors                                                 | none from the page; Chromium's own `/favicon.ico` 404 is the only entry, identical to `examples/mechanism` and `examples/physics-playground` |

Three of those numbers are the §110 verdict, and they say the same thing three ways: the
switch into the ragdoll moves the chain by no more than the animated wave was already moving
it plus one fixed step of gravity (`g·Δt² = 0.0027 m`); the switch back moves it by no more
than the animation's own step; and the crossfade between them is a steady `gap / 90` per step
rather than a jump. The largest per-step displacement anywhere in the page — `0.142 m` — is
the ragdoll swinging at 8.5 m/s under gravity, which is motion, not discontinuity.

**Why switch 2a is measured at the previous weight.** The sweep's weights are written from the
`fixedUpdate` listener, which runs _after_ the step, so each weight applies to the next step;
the first step of `"recovering"` therefore still publishes at animation weight 0 and shows the
settled chain's residual motion (`0.0068 m`). It costs one fixed step of latency at the start
of a 90-step sweep and keeps the whole transition in one place.

## Bundle size

Not covered by the §86 payload budget: the Rapier wasm image is embedded as base64 by
`rapier2d-compat`, and §86's budget covers engine payload (MEMORY, Rapier strategy). Recorded
anyway, WP-7.6: **1,833,243 B raw / 674,667 B gzip** for the one JS chunk, plus 1,971 B
(977 B gzip) of HTML — `gzip -9`, the measurement `examples/mechanism` records. That is 1.2%
raw and 1.0% gzip above the mechanism's: the same single wasm image and the same renderer,
plus `@fourjs/animation`, which the mechanism does not pull in. (Vite's own build log reports
681.24 kB for the same chunk; it gzips at a lower level.)
