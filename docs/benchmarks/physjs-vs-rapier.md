# PhysJS vs Rapier: fixed-step cost and capability differences

Recorded 2026-11-04 (wave 9, RFC 0010) with `benchmarks/physics-step.mjs`:

```text
node benchmarks/physics-step.mjs                                              # Rapier3dAdapter
PHYSICS_SOLVER=physjs PHYSICS_BODY_COUNTS=25,50,100,200 node benchmarks/physics-step.mjs   # PhysJSAdapter3D
```

Scene: static floor plus N dynamic 1 m boxes on a lattice, density-derived mass, friction 0.5,
restitution 0, sleeping disabled, 3D. The timed region is `PhysicsWorld.step(1/60)`; 60 warm-up
and 120 measured steps. Host: Intel Xeon 2.1 GHz x 4 CI container, node 22.23, linux x64. Timings
are noisy on this shared host (the 25-body PhysJS row measured 34 ms in an earlier uncontended
run and 60 ms here); read orders of magnitude, not decimals. Recorded, never gated.

## Measured (mean ms per fixed step, piled scene)

| Bodies | Rapier 3D | PhysJS 3D | PhysJS / Rapier | PhysJS free fall (no contacts) |
| -----: | --------: | --------: | --------------: | -----------------------------: |
|     25 |      1.81 |     59.60 |            ~33x |                           0.63 |
|     50 |      0.90 |    116.46 |           ~130x |                           1.21 |
|    100 |      0.84 |    179.82 |           ~214x |                           0.92 |
|    200 |      2.58 |    423.94 |           ~164x |                           1.11 |
|    500 |      2.91 |        -- |              -- |                             -- |

PhysJS was not measured above 200 bodies: a 500-body run did not finish inside eight minutes.
The 60 Hz budget is 16.7 ms, so on this host PhysJS is over budget from 25 piled bodies, while
Rapier is at 17% of budget for 500. PhysJS free fall (integration and write-back only) is cheap
(about 1 ms); 99% of its piled cost is contact generation and solving, which grows faster than
linearly with body count. Rapier's figures include its wasm warm-up (the 25-body row is
dominated by it). The 5 000-body section 86 row is therefore Rapier-only; PhysJS cannot be
measured against it.

## Capability differences (do not treat PhysJS as a drop-in)

| Feature                                     | Rapier adapters                                     | PhysJS adapters                              |
| ------------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Dimensions                                  | 2D, 3D                                              | 2D, 3D                                       |
| Sensors (trigger volumes)                   | yes                                                 | refused                                      |
| Collider local offsets                      | yes                                                 | refused                                      |
| Collision group/mask filtering              | yes                                                 | refused (all-ones only)                      |
| Shape cast                                  | yes                                                 | refused                                      |
| CCD                                         | disabled/speculative/swept                          | disabled/speculative                         |
| Joints                                      | fixed, spring, revolute, spherical, prismatic, rope | fixed, spring, revolute, spherical           |
| Joint limits and motors                     | yes                                                 | refused                                      |
| Joint reactions / breakable joints          | no (refused)                                        | no (refused)                                 |
| Shapes                                      | full set                                            | sphere/circle, box, capsule, centred polygon |
| Rolling/spinning friction, sleep thresholds | yes                                                 | no                                           |
| Friction combine rule                       | per Appendix A                                      | geometric mean                               |
| Joint stiffness                             | rigid (~4 um drift)                                 | soft (~2.3 cm drift over 4 s)                |
| Collision event contacts                    | contact points                                      | none (`contacts: []`)                        |
| Determinism tier                            | same-runtime                                        | same-runtime                                 |
| Runtime                                     | WebAssembly                                         | pure TypeScript                              |

Refusals throw `FourError("NOT_IMPLEMENTED")`; nothing is emulated. The conformance suites
(`tests/integration/physics-solvers.test.ts`, `tests/determinism/solver-determinism.test.ts`)
run the same solver-invariant scenarios on both and skip, with the reason in the test title,
whatever the PhysJS record rules out.
