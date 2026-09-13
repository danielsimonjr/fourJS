# Mechanism

The §109 demonstration: one engineering mechanism — a **motor-driven slider–crank with a
spring and limit switches** — assembled entirely from §28's joint classes and run in a
browser at a fixed 1/60 s step.

§109 asks that constraints "remain stable under expected real-time loads" and names the
parts an engineering mechanism is made of. All six are here, in one chain:

| §109 part          | in this example                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **rotating shaft** | the crank: a bar pinned to a static block by a `HingeJoint` and turning about it continuously    |
| **motor**          | that hinge's §28 motor, commanded in rad/s — the only thing in the scene that puts energy in     |
| **hinge**          | two more `HingeJoint`s: crank→rod (the crank pin) and rod→carriage (the wrist pin)               |
| **slider**         | a `SliderJoint` with §28 limits — this is where rotation becomes reciprocation                   |
| **spring**         | a `SpringJoint` from the carriage to a static post, stretched and compressed once per revolution |
| **limit switches** | two lamps that latch when the carriage reaches either end of its travel, with hit counters       |

The chain is a **slider–crank**: three revolute constraints and one prismatic constraint
over three dynamic bodies, a closed kinematic loop with exactly one degree of freedom. That
loop is the point — it is the hardest thing §28's joints are asked to hold together here,
and it is what makes the six parts _one mechanism_ rather than five demos side by side.

## One world, and it is `"2d"`

One `Application`, one canvas, one `WebglRenderer`, one `PhysicsSystem`, one `PhysicsWorld`
— and that world's dimension is `"2d"`, because everything §109 lists is planar. The 3D
solver is exercised elsewhere and deliberately: `examples/physics-playground` runs a `"3d"`
world beside a `"2d"` one (§108), and `tests/integration/physics-joints.test.ts` builds
every joint used here in **both** dimensions, plus the 3D-only spherical joint.

## Running it

```sh
bun run build             # the packages the example imports as `four/…`
bun run mechanism:build   # bundles to examples/mechanism/dist
npx vite preview examples/mechanism
```

or, for a dev server with hot reload:

```sh
npx vite examples/mechanism
```

The page shows "loading physics" until the Rapier WebAssembly image has decoded —
`PhysicsSolverAdapter.initialize` is asynchronous for exactly that reason (§37) — and then
starts the frame loop.

## Layout, in world units

One orthographic camera shows 16 × 9 world units over a 960 × 540 canvas: **60 CSS pixels
per world unit**, `px = (x + 8) × 60` and `py = (4.5 − y) × 60`. +Y is up, angles are
radians, times are seconds (§7a).

Five numbers are authored — the shaft at `(−5.4, 0.6)`, crank radius `0.85`, rod length
`2.4`, start angle `π/2`, spring post at `x = 0.4` — and everything else is **derived**,
because in a closed loop the coordinates are not independent: a rod whose ends do not reach
its two pins is a joint that starts violated.

| element             | world position (at the start angle)   | size / extent              |
| ------------------- | ------------------------------------- | -------------------------- |
| shaft block, static | `(−5.4, 0.6)`                         | `0.42 × 0.42`              |
| crank               | `(−5.4, 0.6)`, rotated `+π/2`         | half-extents `1.0 × 0.11`  |
| crank pin           | `(−5.4, 1.45)`                        | marker disc `r = 0.16`     |
| connecting rod      | `(−4.277781, 1.025)`, `−0.362023` rad | half-extents `1.2 × 0.075` |
| carriage            | `(−3.155562, 0.6)`                    | half-extents `0.26 × 0.26` |
| rail block, static  | `(−3.0, 0.6)`                         | `0.3 × 0.3`                |
| spring post, static | `(0.4, 0.6)`                          | `0.3 × 1.0`                |
| left limit lamp     | `(−3.85, 1.9)`                        | `0.44 × 0.44`              |
| right limit lamp    | `(−2.15, 1.9)`                        | `0.44 × 0.44`              |
| motor plate         | `(1.6, 2.6)`                          | `1.4 × 0.9`                |
| `−` plate           | `(3.4, 2.6)`                          | `1.0 × 0.9`                |
| `+` plate           | `(4.8, 2.6)`                          | `1.0 × 0.9`                |

Two derived facts do most of the work:

- the stroke centre is `shaftX + rodLength = −3.0` and the half-stroke is the crank radius,
  because a slider–crank's extremes are `shaftX ± r + √(L² − r²sin²θ)` at `θ = 0` and
  `θ = π`, where the sine vanishes. So the carriage runs between `x = −3.85` and
  `x = −2.15`, and the rail, the lamps and the spring's rest length are all placed from the
  crank rather than measured off a drawing;
- the mechanism is assembled at a crank angle of **90°, not 0°**: at 0° the crank and the
  rod are collinear (dead centre), which a driven crank passes through happily but is a
  needlessly delicate place to _begin_.

## Joint parameters

| joint                           | §28 type    | parameters                                                                |
| ------------------------------- | ----------- | ------------------------------------------------------------------------- |
| shaft hinge (static → crank)    | `revolute`  | anchor `(−5.4, 0.6)`, motor `{ targetVelocity: 6 rad/s, maxTorque: 400 }` |
| crank pin (crank → rod)         | `revolute`  | anchor `(−5.4, 1.45)`                                                     |
| wrist pin (rod → carriage)      | `revolute`  | anchor `(−3.155562, 0.6)`                                                 |
| rail (static → carriage)        | `prismatic` | axis `+X`, anchors `(−3.0, 0.6)` / `(−3.155562, 0.6)`, limits `±0.95 m`   |
| spring (static post → carriage) | `spring`    | rest `3.4 m`, stiffness `25 N/m`, damping `0.8 N·s/m`                     |

None of the hinges names an axis: a hinge in a `"2d"` world has exactly one possible one
(+Z, §21) and the joint fills it in. No body authors a mass — each collider carries the
default density of 1 and the solver derives mass from density × area (§23, §25).

Three things about those numbers are worth stating plainly.

- **`maxTorque` is a gain here, not a clamp.** Rapier 0.19.3's bindings expose no motor
  force limit, so the adapter maps §28's `maxTorque` to the motor's stiffness in its
  force-based model: the effort exerted equals `maxTorque` at one rad/s of velocity error
  (WP-6.2). A bigger number is a stronger motor — §28's monotone intent — but it is not a
  ceiling, and the example names the constant `MOTOR_GAIN` rather than pretend otherwise.
- **The slider's limits are wider than the crank's throw**, by 0.1 m on each side. They are
  the mechanical end stops; a closed loop whose stops sat _inside_ the throw would be
  over-constrained, with the crank commanding a position the slider is forbidden to take.
  Measured over a minute of running, the carriage's travel never leaves ±0.851 m.
- **Nothing in this scene collides.** The static blocks carry no collider at all, and the
  three dynamic bodies only ever overlap at pins whose joints have §28 collision disabled
  (the default). Every number on screen is a constraint's, never a contact's.

## The limit switches are sampled, and say so

A real limit switch is a sensor at a fixed point of the travel. §24 sensors are collider
volumes and the carriage has no contact geometry to trip one with, so the switches here are
**position samples in application code**: once per frame the carriage's travel is compared
with ±0.78 m, and the open→closed transition latches a lamp and increments a counter. That
is an honest switch — it is what an encoder-fed limit switch does — but it is application
logic, not a physics event, and this example does not dress it up as one.

The trip points sit 0.07 m inside each end of the throw, where the carriage is reversing
and therefore slow: it stays inside the trip zone for roughly 0.13 s per revolution at the
default speed, which is many frames at any frame rate the page will see.

## Interaction

Three click plates, picked through §71/§72 (`PointerInput` → local-bounds pick →
`node.on("click", …)`):

| plate         | at world / at pixel       | what it does                                                                                     |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| green (motor) | `(1.6, 2.6)` / `576, 114` | `enableMotor(false)` releases the drive — the mechanism **coasts**; clicking again re-engages it |
| `−`           | `(3.4, 2.6)` / `684, 114` | `setMotor(…)` with a target 2 rad/s lower, floor 2 rad/s                                         |
| `+`           | `(4.8, 2.6)` / `768, 114` | `setMotor(…)` with a target 2 rad/s higher, ceiling 12 rad/s                                     |

Both are §28's live reconfiguration path: they queue a command that the world drains into
the solver at the **next fixed step**, never mid-step. Releasing the motor does not brake —
the adapter reconfigures it to a measured-inert gain (WP-6.2-fix1), so the mechanism keeps
going and slows only as the spring's damper takes the energy out. It does not glide evenly
to a halt either: the spring gives its stored energy back, so the crank rocks and reverses
a few times before settling. That is what a spring-loaded crank with no flywheel does.

## What the page mirrors onto the DOM

`#status` carries the mechanism's state as data attributes, so a test can read it without
decoding pixels:

| attribute           | value                                                 |
| ------------------- | ----------------------------------------------------- |
| `data-state`        | `loading` → `running`, or `error`                     |
| `data-motor`        | `on` / `off`                                          |
| `data-target`       | commanded shaft speed in rad/s, one decimal           |
| `data-spin`         | the crank's measured angular velocity about +Z, rad/s |
| `data-travel`       | the carriage's travel from the stroke centre, metres  |
| `data-left-hits`    | how often the left limit switch has closed            |
| `data-right-hits`   | how often the right limit switch has closed           |
| `data-switch-left`  | `open` / `closed`                                     |
| `data-switch-right` | `open` / `closed`                                     |

## Measured (WP-6.5 probe, headless Chromium + SwiftShader, 960 × 540 at DPR 1)

| quantity                                                   | measurement                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| steady shaft speed at a 6 rad/s command                    | mean `5.976`, range `5.915 … 6.032` rad/s                                                                                             |
| limit-switch cadence, per switch                           | `0.876` / `0.974` Hz over 10.3 s (0.955 rev/s commanded)                                                                              |
| carriage travel envelope                                   | `−0.848 … +0.845` m, against ±0.85 m of throw and ±0.95 m of joint limit                                                              |
| pixel change over 200 ms, mechanism region                 | mean 19.5 / 255 per channel, max 237                                                                                                  |
| pixel change over 200 ms, spring region                    | mean 44.4 / 255 per channel, max 204                                                                                                  |
| pixel change over 200 ms, panel / background / spring post | **0.0**, max 0                                                                                                                        |
| coast after release                                        | 1 limit hit in 4.0 s, against ~1.96 Hz driven                                                                                         |
| shaft speed 2 s after re-engaging                          | `6.015` rad/s; cadence back to `1.98` Hz (both switches)                                                                              |
| `+` twice → 10 rad/s                                       | mean `9.965` rad/s, cadence `3.23` Hz, travel `±0.85` m                                                                               |
| `−` six times → 2 rad/s                                    | mean `1.982` rad/s, travel `±0.845` m                                                                                                 |
| after ~60 s of running and 100 switch hits                 | `data-state="running"`, `data-spin="5.993"`, no drift                                                                                 |
| console errors                                             | none from the page; Chromium's own `/favicon.ico` 404 is the only entry, and `examples/physics-playground` produces the identical one |

Colours, as framebuffer bytes: crank `250,92,41`; rod `250,204,61`; carriage `76,204,250`;
spring `89,219,133`; crank pin `224,230,242`; rail `56,61,79`; static blocks `41,46,61`;
limit lamp open `46,51,71` and closed `255,74,158`; motor plate on `61,217,115` and off
`107,82,76`; speed plates `112,102,184`; background `13,15,23`.

## Bundle size

Not covered by the §86 payload budget: the Rapier wasm image is embedded as base64 by
`rapier2d-compat`, and §86's budget covers engine payload (MEMORY, Rapier strategy).
Recorded anyway, WP-6.5: **1,811,176 B raw / 668,094 B gzip** for the one JS chunk, plus
1,972 B (976 B gzip) of HTML. About 45% of the playground's, which carries two wasm images
to this one's one.
