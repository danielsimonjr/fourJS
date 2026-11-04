# Box2D vs Rapier: per-step cost and capability differences

Recorded 2026-11-04 (W8.4) with `benchmarks/physics-step.mjs` on a shared CI
container (Intel Xeon 2.10 GHz x 4, node 22, no GPU), one run each. Run-to-run
spread on this host is large; nothing here is gated and none of it is a
verdict on either solver. The result JSON is intentionally not committed.

```sh
bun run build
node benchmarks/physics-step.mjs          # Rapier 3D
node benchmarks/physics-step.mjs box2d    # Box2D 2D
```

## The workloads are not the same

Both variants run `PhysicsWorld.step(1/60)` with sleeping disabled (every body
awake), a static floor, and N unit boxes dropped from a lattice, 60 warm-up and
120 measured steps. Box2D is 2D only, so its lattice is a single plane (about
`sqrt(2N)` columns by `sqrt(N/2)` layers); Rapier's is a 3D lattice. Per-body
cost and contact counts therefore differ for reasons that are not the solver.
Read the columns as "what does this adapter cost per body in its own
dimension", not as a head-to-head ranking.

## Mean ms per fixed step (60 Hz budget: 16.667 ms)

| Bodies | Box2D 2D piled | Box2D free fall | Rapier 3D piled | Rapier 3D free fall |
| -----: | -------------: | --------------: | --------------: | ------------------: |
|    500 |           4.43 |            2.16 |            4.50 |                1.07 |
|  1 000 |           6.78 |            4.37 |            3.92 |                1.66 |
|  2 500 |          20.18 |           12.34 |           13.11 |                4.95 |
|  5 000 |          42.12 |           25.77 |           32.69 |               13.26 |

p95 at 5 000 bodies: Box2D 74.4 ms, Rapier 48.7 ms. Both are over the 60 Hz
budget at 5 000 awake bodies on this host; §86's hardware clause is not
satisfied here, so that is a record, not a failed row. Box2D is a pure
TypeScript port with no wasm and no initialisation; Rapier runs as wasm.
The free-fall column (no contacts) is mostly per-body adapter and scene
write-back overhead, where Rapier's wasm is cheaper per body.

## Capability differences that matter

- **Dimensions.** Box2D: `2d` only. `solver: "auto"` for a 3D world skips it
  (reason `unsupported`) and names it in the failure message. Rapier: 2D and 3D.
- **Friction combine.** Box2D combines friction by `sqrt(a * b)`; Appendix A
  and Rapier use the average. A 0.8 floor under a 0.2 box is 0.4 on Box2D and
  0.5 on Rapier. Restitution combines by `max` on Box2D. The conformance suite
  pins this (`tests/integration/box2d-conformance.test.ts`).
- **Motor effort cap.** Box2D's `maxTorque` / `maxForce` are hard caps on the
  motor impulse (`jointMotorEffortCap: true`); Rapier applies a force-based
  gain. Joint reactions are reported (`reportsJointReactions`), so breakable
  joints work on Box2D and are refused on Rapier.
- **Warm-start and snapshots.** `capabilities.snapshots` is a plain boolean
  (`true`) and cannot express a weaker guarantee. Box2D snapshots hold float64
  body and joint state but not warm-start contact or joint impulses, so
  bit-identical continuation (`replayFromSnapshot`) is guaranteed only from a
  snapshot taken with no touching contacts and no loaded joints. A restore
  from a loaded state is a valid simulation state but may differ from the
  uninterrupted run in the first steps. Rapier's snapshots are whole-world.
- **Determinism.** Both declare `same-runtime`. Neither claims cross-platform.
- **Unsupported on Box2D.** Rolling / spinning friction and sleep thresholds
  (`tuning` flags are `false`), speculative CCD (only `disabled` / `swept`),
  3D-only joint types, and polygons over 8 vertices.
