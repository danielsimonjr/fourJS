# Physics playground

The §108 demonstration: **one** application, **one** canvas, **one** renderer, **one**
`PhysicsSystem` — and **two** physics worlds, a `"2d"` one on the left and a `"3d"` one on
the right, each driving its own Rapier solver through the same `@fourjs/physics` API.

Both halves are built by the same function over the same helpers. Everything that differs
between a plane simulation and a volume simulation is confined to two small records (a
solver, a §24 shape and a geometry per dimension) — which is §20's promise, that "users
should not need to write solver-specific application code", stated as a program rather
than as prose.

## What it shows

| §108 verb      | in the playground                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gravity**    | every dynamic body starts in the air and falls at −9.81 m/s² on **Y**, in _both_ dimensions (§7a: Y-up in 2D as in 3D)                                                 |
| **collisions** | the bodies land on a static floor between two walls, stack, settle, and then §32-sleep                                                                                 |
| **impulses**   | **click a body** — the picked world point becomes an off-centre `applyImpulseAtPoint`, sized `mass × Δv`, so it lifts and spins                                        |
| **sensors**    | the slab at the bottom of each half is a §24 sensor: it exerts no force, and `triggerenter`/`triggerexit` (§29) on its collider flip its colour while a body is inside |

Alongside those, the example exercises the §43 interpolation path (each world is handed
`app.poses`, and the frame draws interpolated poses while the solver steps at a fixed
1/60 s), §42 authority (`"physics"` on every dynamic node and nothing else writing them),
and §23's **density-derived mass** — no body in the scene authors a mass.

## Running it

```sh
bun run build              # the packages the example imports as `four/…`
bun run playground:build   # bundles to examples/physics-playground/dist
npx vite preview examples/physics-playground
```

or, for a dev server with hot reload:

```sh
npx vite examples/physics-playground
```

The page shows "loading physics" until both Rapier WebAssembly images have decoded —
`PhysicsSolverAdapter.initialize` is asynchronous for exactly that reason (§37) — and then
starts the frame loop.

## Layout, in world units

One orthographic camera shows 16 × 9 world units over a 960 × 540 canvas: **60 CSS pixels
per world unit**, `px = (x + 8) × 60` and `py = (4.5 − y) × 60`. The 2D half is centred at
x = −4 and the 3D half at x = +4; each world's own coordinates _are_ these coordinates, so
a picked world point can be handed straight to the solver.

| per half (centre `cx`) | centre            | half-extents         |
| ---------------------- | ----------------- | -------------------- |
| floor                  | `(cx, −3.25)`     | `3.4 × 0.25 (× 3.4)` |
| walls                  | `(cx ∓ 3.15, −1)` | `0.25 × 2 (× 3.4)`   |
| sensor zone            | `(cx, −2.25)`     | `1.2 × 0.65 (× 1.2)` |

The five dynamic bodies of each half start between y = −0.6 and y = 2.6 and settle on the
floor, whose top surface is y = −3.

## Bundle size

Not covered by the §86 payload budget: the two Rapier wasm images are embedded as base64
by `rapier2d-compat`/`rapier3d-compat`, and §86's budget covers engine payload (MEMORY,
Rapier strategy). Recorded anyway, WP-5.7: **4,048,508 B raw / 1,498,218 B gzip** for the
one JS chunk, plus 1,981 B of HTML — almost all of it the two wasm images, which is why
this example has no `size-limit` entry while `first-2d-scene` does.
