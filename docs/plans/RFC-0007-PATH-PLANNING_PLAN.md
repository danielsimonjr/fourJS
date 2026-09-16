# RFC 0007 — path-planning adapters: subagent plan

**Status:** plan only, no implementation. Written 2026-09-10 against branch
`claude/rfc-review-planning-s2clzd`. **Gated on the owner accepting RFC 0007**
(`docs/rfcs/0007-path-planning-adapters.md`, corrected 2026-09-10). Do not start a
packet before the RFC header reads `accepted`.
**Format:** the house work-packet format of
[`docs/plans/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §2; its §1 ground rules
apply verbatim. **Crew:** at most **four** small-model (haiku-class) agents, each owning a
disjoint file set, dispatched in the two waves of §3.

---

## 1. What is being built (one paragraph, no interpretation left)

`@fourjs/motion` gains one new module, `packages/motion/src/path-planning.ts`, holding the
RFC's interfaces verbatim (`PathQuery`, `PlannedPath`, `PathPlannerDeterminism`,
`PathPlannerCapabilities`, `PathPlannerAdapter`, `PathPlannerRegistry`) and the opt-in
conversion `plannedPathToTrajectory`; one built-in planner,
`packages/motion/src/waypoint-graph-planner.ts` (`WaypointGraphPlanner`, A\* over an
insertion-ordered directed graph, binary heap, ties by insertion index); one new steering
behaviour appended to `packages/motion/src/steering.ts` (`followWaypoints`, plus the
`WaypointCursor` / `FollowWaypointsOptions` records); and one capability token
`PATH_PLANNERS` in `packages/motion/src/capabilities.ts`, re-exported by the umbrella's
`packages/fourjs/src/plugins.ts`. Nothing else in the tree changes except barrels, tests,
one benchmark, and the tracking files. **No grid or navmesh planner ships in this plan**
(RFC Q1's recommendation: waypoint only).

## 2. Facts every agent must read before writing a line (anti-hallucination sheet)

Each row is a fact an agent is likely to guess wrong. Read the file; do not rely on memory.

| Fact                                                                                                                                                                                                                              | Where it is pinned                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Imports use the `.js` suffix on relative paths (`./steering.js`), ESM, strict TS                                                                                                                                                  | any file in `packages/motion/src/`                                              |
| `@fourjs/motion` may import only `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` — **never** `@fourjs/physics` or `@fourjs/geometry`                                                                                              | `packages/motion/package.json`; plan §3.1                                       |
| `DeterminismLevel` lives in `packages/physics/src/types.ts` and is **unreachable** from motion; spell `PathPlannerDeterminism` locally (RFC §3)                                                                                   | RFC 0007 §3                                                                     |
| `Disposable` is `import type { Disposable } from "@fourjs/core"` (`packages/core/src/disposable.ts`)                                                                                                                              | that file                                                                       |
| `defineCapability(name, options?)` returns `{ name, revocable: options?.revocable ?? false }`                                                                                                                                     | `packages/core/src/plugin.ts:171`                                               |
| `SIMULATION_SYSTEMS` is declared `/* @__PURE__ */ defineCapability<SystemRegistry>("fourJS:simulation-systems", { revocable: true })` with a **type-only** import of the registry                                                 | `packages/motion/src/capabilities.ts`                                           |
| `Vector3` is mutable with `set/copy/clone/add/sub/scale/dot/cross/lengthSq/length/normalize/lerp/equalsApprox`; fields `x y z`                                                                                                    | `packages/math/src/vector3.ts`                                                  |
| `SteeringContext` = `{ position, velocity, maxSpeed, maxAcceleration }` (all readonly); behaviours write `out` **once** and allocate nothing                                                                                      | `packages/motion/src/steering.ts:113-148` and the module header                 |
| `seek(context, target, out)` and `arrive(context, target, slowRadius, out)` are the existing signatures to compose                                                                                                                | `packages/motion/src/steering.ts:243, 317`                                      |
| `assertFinite(value, what)` already exists (module-private) in `steering.ts`; reuse it, do not add a second                                                                                                                       | `packages/motion/src/steering.ts:543`                                           |
| `CatmullRomTrajectory` takes `{ points: readonly Vector3[] (≥ 2, copied), duration: number }` (seconds); `ParametricTrajectory` exists for the piecewise-linear form                                                              | `packages/motion/src/trajectories.ts:585-660, 1010-1060`                        |
| `interceptPoint` returns `null` and leaves `out` untouched on "no solution" — the miss policy to copy                                                                                                                             | `packages/motion/src/prediction.ts:333-355`                                     |
| `SeededRandom` is re-exported by motion from `./random.js`; a planner needing randomness takes one **at construction**                                                                                                            | `packages/motion/src/index.ts:120`                                              |
| All times are **seconds**; world is **Y-up** in 2D and 3D; a 2D planner keeps `z = 0`                                                                                                                                             | `CLAUDE.md`, spec §7a                                                           |
| §85 authoring errors are `RangeError` with a message ending in `(§85).`; engine failures are `new FourError(code, message, { context })`                                                                                          | `packages/motion/src/kinematic-controller.ts`, `packages/core/src/errors.ts:83` |
| Per-package tests live in `packages/<pkg>/tests/*.test.ts`, import from `../src/index.js`, Vitest `describe/it/expect`                                                                                                            | `packages/motion/tests/steering.test.ts`                                        |
| Coverage gate: ≥ 95 % per package, ≥ 80 % per file (`bun run coverage`)                                                                                                                                                           | `vitest.coverage.config.ts`                                                     |
| The umbrella's motion barrel is `export * from "@fourjs/motion"`; tokens are additionally re-exported (same object, `toBe`) from `packages/fourjs/src/plugins.ts` and asserted in `packages/fourjs/tests/plugins.test.ts:286-320` | those files                                                                     |
| Cross-package determinism suites: `tests/determinism/<name>.test.ts` + `tests/determinism/helpers/<name>-scenario.ts`; run with `bun run test:suites`                                                                             | `tests/determinism/phase2-motion.test.ts` as the model                          |
| Benchmarks: `benchmarks/<name>.mjs` importing `./harness.mjs` (`measure`, `summarize`, `writeResult`, `hostRecord`, `printReport`); results land in `benchmarks/results/<name>.json`; recorded, never gated                       | `benchmarks/pick-latency.mjs`, `benchmarks/harness.mjs`                         |
| Commands: `bun run build`, `bun run test`, `bun run test:suites`, `bun run lint`, `bun run coverage`, `bun run size` (after `bun run examples:build`), `bun run check-spec`, `node tools/check-docs.mjs`                          | root `package.json`                                                             |

**Never** invent an API not in this table or in the files it names. If something needed is
missing, stop and report it in the packet's _Blocked_ line rather than guessing.

## 3. Agent roster, file ownership, waves

| Agent                           | Owns (creates / edits)                                                                                                                                                                                                                                                                                                             | Wave                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **A1 — contract**               | `packages/motion/src/path-planning.ts` (new), `packages/motion/src/capabilities.ts` (edit: add token), `packages/motion/tests/path-planning.test.ts` (new), `packages/motion/tests/capabilities.test.ts` (edit)                                                                                                                    | 1                                           |
| **A2 — planner**                | `packages/motion/src/waypoint-graph-planner.ts` (new), `packages/motion/tests/waypoint-graph-planner.test.ts` (new)                                                                                                                                                                                                                | 2                                           |
| **A3 — steering fold**          | `packages/motion/src/steering.ts` (append only), `packages/motion/tests/steering.test.ts` (append only)                                                                                                                                                                                                                            | 2                                           |
| **A4 — integration & evidence** | `packages/motion/src/index.ts` (edit), `packages/fourjs/src/plugins.ts` (edit), `packages/fourjs/tests/plugins.test.ts` (edit), `tests/determinism/path-planning.test.ts` + `tests/determinism/helpers/path-planning-scenario.ts` (new), `benchmarks/path-planning.mjs` (new), `benchmarks/results/path-planning.json` (generated) | 2 (starts after A1; final step after A2+A3) |

Wave 1 is A1 alone (≈ 1 hour of work): every other agent imports A1's types. Wave 2 runs
A2, A3 and A4's first half in parallel. A4's second half (barrels, umbrella token identity,
determinism suite, benchmark) runs once A2 and A3 report done. The lead runs the full gate
(§6) and edits the tracking files.

## 4. Packets

### WP-PP.1 [S] Contract, conversion, registry, token — **A1**

**Reads first:** RFC 0007 §2, §3, §6, §7; `packages/motion/src/capabilities.ts`;
`packages/motion/src/prediction.ts:1-60`; `packages/motion/src/trajectories.ts:585-700`
(Catmull-Rom) and `1010-1100` (Parametric); `packages/core/src/plugin.ts:160-200`.

**Creates `packages/motion/src/path-planning.ts`** containing, verbatim from the RFC:

```ts
import type { Disposable } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";

import { CatmullRomTrajectory, type Trajectory } from "./trajectories.js";

export interface PlannedPath {
  /* RFC §2, verbatim */
}
export interface PathQuery {
  /* RFC §2, verbatim */
}
export type PathPlannerDeterminism =
  "none" | "same-runtime" | "same-platform" | "cross-platform";
export interface PathPlannerCapabilities {
  /* RFC §3 */
}
export interface PathPlannerAdapter extends Disposable {
  /* RFC §3 */
}

/** Shared §85 guard every adapter calls first; exported so adapters do not re-spell it. */
export function validatePathQuery(query: PathQuery): void;
// - start/goal components finite, else RangeError "… (§85)."
// - radius, if present, finite and ≥ 0
// - maxExpansions, if present, finite and > 0 — non-positive is a RangeError (RFC §2)

/** Deep-copies waypoints (and radii) so a planner never leaks its scratch vectors (RFC §2). */
export function freezePlannedPath(
  planner: string,
  cost: number,
  waypoints: readonly Vector3[],
  radii?: readonly number[],
): PlannedPath;
// - fewer than two waypoints → RangeError (§85); non-finite cost → RangeError
// - radii, if given, must have waypoints.length − 1 entries, each finite ≥ 0

export interface PlannedPathToTrajectoryOptions {
  /** Total travel time in seconds (> 0). Required — a path has no clock (RFC alt. E). */
  readonly duration: number;
  /** `"catmull-rom"` (default) or `"linear"`. */
  readonly form?: "catmull-rom" | "linear";
}
export function plannedPathToTrajectory(
  path: PlannedPath,
  options: PlannedPathToTrajectoryOptions,
): Trajectory;
// catmull-rom → new CatmullRomTrajectory({ points: path.waypoints, duration })
// linear → a ParametricTrajectory (or a small local class implementing Trajectory) that
//          walks segments at constant speed: t in [0, duration] maps to arc-length fraction.
//          Read Trajectory's interface in trajectories.ts:77-88 before choosing; do not
//          change trajectories.ts.

export class PathPlannerRegistry {
  register(adapter: PathPlannerAdapter): void; // duplicate name → FourError INVALID_APPLICATION_STATE
  resolve(name: string): PathPlannerAdapter | null;
  list(): readonly PathPlannerAdapter[]; // registration order (§33)
}
```

**Edits `packages/motion/src/capabilities.ts`:** add, below `SIMULATION_SYSTEMS`, with a
doc comment that names RFC 0007 §6 and states _not revocable_ (the `defineCapability`
default):

```ts
import type { PathPlannerRegistry } from "./path-planning.js";
export const PATH_PLANNERS =
  /* @__PURE__ */ defineCapability<PathPlannerRegistry>("fourJS:path-planners");
```

**Tests (`packages/motion/tests/path-planning.test.ts`)**, each an `it(...)`:

1. `validatePathQuery` accepts a finite query, rejects NaN start, negative radius,
   `maxExpansions: 0` — each `toThrow(RangeError)` with a message containing `§85`.
2. `freezePlannedPath` copies: mutating the input `Vector3` after the call leaves the path
   untouched; one waypoint → `RangeError`; wrong `radii` length → `RangeError`.
3. `plannedPathToTrajectory` (catmull-rom): `sample(0, out)` equals the first waypoint and
   `sample(duration, out)` equals the last (`equalsApprox`, epsilon 1e-9); (linear): the
   midpoint of a two-point path at `duration / 2` is the segment midpoint exactly.
4. `PathPlannerRegistry`: `list()` preserves registration order; `resolve` of an unknown
   name is `null`; a duplicate `name` throws a `FourError` whose `code` is
   `"INVALID_APPLICATION_STATE"` (use `isFourError` from `@fourjs/core`).

**Edits `packages/motion/tests/capabilities.test.ts`:** add a `describe("PATH_PLANNERS")`
mirroring the existing one: `toEqual({ name: "fourJS:path-planners", revocable: false })`,
and `bindCapability(PATH_PLANNERS, new PathPlannerRegistry())` compiles and round-trips.

**Done when:** `cd packages/motion && bun run build && bun run test` are green, the file
has a module header in the house style (what ships, what is staged, RFC citation), and A1
posts the exact export names to the lead for A4.

### WP-PP.2 [S] `WaypointGraphPlanner` — **A2**

**Reads first:** RFC 0007 §3, §5, §7; A1's `path-planning.ts`; `packages/motion/src/spatial-hash.ts`
(house style for a small data structure with insertion-order guarantees).

**Creates `packages/motion/src/waypoint-graph-planner.ts`:**

```ts
export interface WaypointGraphOptions {
  /** Optional §33 heuristic scale; default 1 (admissible Euclidean). Fixed at construction (RFC §3). */
  readonly heuristicWeight?: number;
}
export class WaypointGraphPlanner implements PathPlannerAdapter {
  readonly name = "fourJS:waypoint-graph";
  readonly version = "0.1.0";
  readonly capabilities: PathPlannerCapabilities = {
    families: ["waypoint"],
    dimensions: ["2d", "3d"],
    determinism: "same-runtime",
  };
  constructor(options?: WaypointGraphOptions);
  /** Returns the node index (insertion order). Position is copied. */
  addNode(position: Vector3): number;
  /** Directed edge; `cost` defaults to Euclidean length; non-finite/negative → RangeError (§85). */
  addEdge(from: number, to: number, cost?: number): void;
  /** Snaps `start`/`goal` to the nearest node (ties → lowest index), runs A*, returns the polyline. */
  plan(query: PathQuery): PlannedPath | null;
  dispose(): void;
}
```

Algorithm rules (each is a test):

- Binary min-heap keyed on `f = g + h`; **tie-break on insertion sequence number** (a
  monotonically increasing counter per push), never on node index alone and never on
  object identity.
- Neighbour expansion in **edge insertion order**.
- `maxExpansions` (if given) caps pops; exceeding it returns `null` (a reported miss).
- Start node === goal node → `null` (RFC §2: coincident start/goal is a miss).
- Output waypoints: `start` snapped node position … `goal` snapped node position, built
  with A1's `freezePlannedPath(this.name, gCost, …)`; the query's own `start`/`goal` are
  **not** prepended/appended (the path is graph-space; steering seeks the first node).
- `plan` calls `validatePathQuery` first; touches no clock, no `Math.random`.
- After `dispose()`, `plan` throws `FourError` `INVALID_APPLICATION_STATE`.

**Tests (`packages/motion/tests/waypoint-graph-planner.test.ts`):**

1. Diamond graph `A→B→D`, `A→C→D` with `A→C` cheaper: path is `[A, C, D]`, cost equals the
   sum of edge costs exactly (`toBe`, not approx — integer costs).
2. Disconnected goal → `null`; `maxExpansions: 1` on a 3-hop path → `null`.
3. Same query twice → `JSON.stringify` of both paths identical (bit-identity, §33).
4. Tie-break: two equal-cost routes inserted in order X then Y → X is returned; re-insert in
   order Y then X → Y is returned (proves insertion-order ties, not index ties).
5. Independent oracle: a 30-node random graph built from `new SeededRandom(7)` (import from
   `../src/index.js`), compared against a Dijkstra written inline in the test — costs equal
   for 20 seeded queries.
6. Directed edges are directed (`A→B` does not imply `B→A`).

**Done when:** build + test green in `packages/motion`; file ≤ ~250 lines; no import outside
`@fourjs/math` and sibling modules.

### WP-PP.3 [S] `followWaypoints` — **A3**

**Reads first:** RFC 0007 §4 (the corrected signature); `steering.ts` header (allocation and
single-write rules), `seek`/`arrive`/`seekPoint`/`steerTowardVelocity` at lines 189-340,
`assertFinite` at 543.

**Appends to `packages/motion/src/steering.ts`** (do not reorder existing code):

```ts
export interface WaypointCursor {
  index: number;
}
export interface FollowWaypointsOptions {
  readonly agentRadius: number;
  readonly slowRadius?: number;
}
export function followWaypoints(
  context: SteeringContext,
  path: PlannedPath,
  cursor: WaypointCursor,
  options: FollowWaypointsOptions,
  out: Vector3,
): Vector3;
```

Import `PlannedPath` **type-only** from `./path-planning.js`. Behaviour, exactly RFC §4:

1. `assertFinite(options.agentRadius, "agentRadius")`; negative → `RangeError` (§85);
   `path.waypoints.length < 2` → `RangeError`.
2. Let `last = path.waypoints.length - 1`. While `cursor.index < last` and the agent is
   within `max(agentRadius, path.radii?.[cursor.index] ?? 0)` of
   `path.waypoints[cursor.index]` (compare squared distances), increment `cursor.index`.
3. If `cursor.index < last`: return `seek(context, path.waypoints[cursor.index], out)`.
4. Else: `cursor.index = last`; `slowRadius = options.slowRadius ?? max(agentRadius, path.radii?.[last - 1] ?? 0)`.
   **Require `slowRadius > 0`**: when the computed default is `0`, throw a `RangeError`
   telling the caller to pass `slowRadius` (§85; no silent constant such as `1e-6`).
   Return `arrive(context, path.waypoints[last], slowRadius, out)`.

Single write of `out` is preserved because `seek`/`arrive` each write once and nothing else
touches `out`.

**Appends tests to `packages/motion/tests/steering.test.ts`** under
`describe("followWaypoints (RFC 0007 §4)")`:

1. From rest at the first waypoint with `agentRadius` covering it, the cursor advances to 1
   and the acceleration points toward waypoint 1 (componentwise sign check).
2. Consecutive waypoints inside the radius are skipped in one call (cursor jumps by 2).
3. Integration loop (explicit Euler, `dt = 1/60`, 2000 steps, `maxSpeed 2`, `maxAcceleration 4`)
   along a 4-point L-shaped path: the agent ends within `agentRadius` of the last waypoint
   with speed < 1e-3, and never leaves the loop early.
4. Two identical runs produce bit-identical position arrays (`toEqual` on `Float64Array`
   contents) — the §33 claim.
5. `agentRadius: -1`, NaN, and a one-waypoint path each `toThrow(RangeError)`.
6. `slowRadius` default of `0` (path without radii, `agentRadius 0`) throws `RangeError`
   naming `slowRadius`.

**Done when:** build + test green; `steering.ts` header's "what is still staged" list
updated to strike _path following_; no new allocation in the hot path (a test may assert
`out` identity: the returned vector `toBe(out)`).

### WP-PP.4 [S] Barrels, umbrella token, determinism suite, benchmark — **A4**

**Reads first:** `packages/motion/src/index.ts` (export style), `packages/fourjs/src/plugins.ts`,
`packages/fourjs/tests/plugins.test.ts:286-330`, `tests/determinism/phase2-motion.test.ts` +
its helper, `benchmarks/pick-latency.mjs`, `benchmarks/harness.mjs`.

**First half (after A1):**

- `packages/motion/src/index.ts`: add `export type { … }` / `export { … }` blocks for
  every A1 name and `PATH_PLANNERS`; leave placeholders commented for A2/A3 names until
  they land, then fill them (this is the only file two waves touch, and A4 owns it).
- `packages/fourjs/src/plugins.ts`: `export { PATH_PLANNERS, SIMULATION_SYSTEMS } from "@fourjs/motion";`
  and extend the table in its header.
- `packages/fourjs/tests/plugins.test.ts`: add `expect(PATH_PLANNERS).toBe(motion.PATH_PLANNERS)`
  and add the token to the "names every token once" list with `revocable: false`.

**Second half (after A2 + A3):**

- `tests/determinism/helpers/path-planning-scenario.ts`: build a fixed 12-node graph,
  plan `A→L`, run `followWaypoints` for 1200 steps at `1/60` s, return the
  `Float64Array` of positions plus the path's `cost`.
- `tests/determinism/path-planning.test.ts`: (a) two scenario runs are bit-identical
  (`toEqual`); (b) the golden — first run's positions hashed with the same helper the
  sibling suites use (read `tests/determinism/phase2-motion.test.ts` for the hashing
  helper name; if none is shared, compare against a `JSON.stringify` of 8 sampled
  positions written into the test as a literal on first run and marked `// recorded 2026-…`).
- `benchmarks/path-planning.mjs`: `WaypointGraphPlanner` on a 256×256 4-neighbour lattice
  built as a waypoint graph (65 536 nodes, ~262 000 edges) — open field and a serpentine
  maze; report microseconds and expansions via `measure`/`summarize`/`writeResult`.
  Register it in the `SUITE` list in `benchmarks/harness.mjs` (that is what
  `benchmarks/run-all.mjs` iterates; the runner imports built `dist`, so build first).
  Commit `benchmarks/results/path-planning.json`.
- Bundle A/B: `bun run examples:build && bun run size` — every limit in `.size-limit.json`
  must still pass **without edits** (RFC prototype item 4: zero delta on examples that do
  not name the planner). If any example grew, the token or planner leaked into a bundle —
  find the non-type import and fix it; do not raise a limit.

**Done when:** `bun run test:suites`, `bun run size`, and `packages/fourjs` tests are green.

## 5. Lead's closing packet (not an agent)

1. Run the full gate (§6).
2. `docs/COMPATIBILITY.md` §5: add `PATH_PLANNERS` (`fourJS:path-planners`, non-revocable,
   owner `@fourjs/motion`) to the token list; `PLUGIN_API_VERSION` unchanged (RFC
   compatibility section).
3. Spec: no §-text change is required by this plan (RFC Q3: the token ships without a §81
   bullet). If the owner opts to list planners in §81, that is an amendments-table row
   (`bun run check-spec` afterwards).
4. `MEMORY.md` decision entry; `TODO.md` — strike the P8-1 / PH-22 "path-planning adapters
   (RFC)" residues and the `prediction.ts` / `ik.ts` staging notes (edit those two headers
   too); `CHANGELOG.md` _Unreleased_ entry.

## 6. Gate (run in this order, all must pass)

```
bun run build
bun run lint
bun run test
bun run test:suites
bun run coverage            # ≥ 95 % motion aggregate, ≥ 80 % per file
bun run examples:build && bun run size
node tools/check-docs.mjs
bun run graph:check         # no new §3.1 edge
```

## 7. Hallucination traps specific to this RFC

- There is **no** `Curve` type; the path abstraction is `Trajectory` (`kinematic-controller.ts:27-29`).
- `arrive` needs a `slowRadius` argument — the RFC's first draft omitted it; the corrected
  §4 supplies it through `FollowWaypointsOptions`.
- `KinematicController.followPath` takes a `Trajectory`; the planner never calls it.
- Do not add `packages/navigation` or any `@fourjs/physics` import (RFC alternatives B, C).
- Do not implement grid A\* or a navmesh in this plan (RFC §8 _Deferred_).
- `SIMULATION_SYSTEMS` is revocable; `PATH_PLANNERS` is **not** — copy the pattern, not the option.
