# Development warnings

§83 asks for leak and allocation warnings. §85 asks for a validation catalogue
(NaN, singular transforms, graph cycles, impossible mass, version mismatches).
Both families are **opt-in, caller-driven, and silent in production**. They
live in `fourJS/diagnostics` and `fourJS/core`; they are not an ambient
overlay that turns itself on.

Until 2026-10-05 the family was only mentioned in
[performance-optimization](performance-optimization.md) (`devWarnOnce`,
`auditFrameAllocations`). This guide teaches the whole set, including the
label that dogfood cycle 10C misread.

## When anything prints

| Gate                                 | What it does                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| `DEV` (`__FOUR_DEV__`)               | Production bundles fold it false. Unbundled tests default true.    |
| `app.stats` / an explicit audit call | Allocation and leak audits run only when something asks.           |
| `devWarnOnce(key, message)`          | First time per process for that key; `resetDevWarnings()` re-arms. |

A headless app with a scene, a camera, and a registered system allocates
**zero** math objects per step and prints **nothing** over 120 steps. That was
measured from a consumer seat (cycle 10C, Node and Chrome).

`@fourjs/scene` is a §33 simulation package and **must not import `DEV`**.
System-vs-system authority conflicts (`warnAuthorityConflict`) are therefore
unconditional `console.warn`, once per node per writer. Application-write
warnings on a system-owned transform are a separate DEV-gated hook — see
[transform authority](transform-authority.md).

## §83 — leaks and allocations

### Frame allocations

`auditFrameAllocations(before, after, { label, threshold? })` samples the
math package's process-wide construction count around a span. `Application.step`
calls it when `DEV && stats` is on:

```
§83: 4 math object(s) were constructed while "Application.step" was running
(threshold 0). "Application.step" is the measurement window, not necessarily
the allocator: the count is every math object constructed anywhere in the
process during it, including the application's own code.
```

**The label names the window, not the culprit.** Four `new Vector3(…)` in the
application's own `fixedUpdate` produce that string. Engine systems that reuse
out-parameters do not. There is no per-object owner; the count is every math
object constructed in the process during the span.

```ts
import { constructionCount } from "fourJS/math";
import { auditFrameAllocations } from "fourJS/diagnostics";

const before = constructionCount();
work();
auditFrameAllocations(before, constructionCount(), {
  label: "my-pass",
  threshold: 0,
});
```

### Resource leaks

`auditResourceLeaks` compares two readings of live texture/buffer/geometry
counts and, by default, warns once when the delta is not empty:

```
[fourJS] §83: 3 textures (786432 B) survived "level teardown" without dispose().
```

`auditFinalizedLeaks` is the FinalizationRegistry half: objects that died
without `dispose()`. Pair `trackDisposable` / `disposeTracked` around a
lifetime you control. An ambient timer that polled this would itself be a
diagnostic that never turns off; the engine does not install one.

## §85 — the validation catalogue

Import from `fourJS/diagnostics`. Every helper no-ops when `DEV` is false
without reading its arguments.

| Helper                                         | What it catches                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `assertFinite` / `assertFiniteVec3`            | NaN / ±Infinity on a number or `{ x, y, z }`                                               |
| `assertNoSceneGraphCycle`                      | adding a node to itself or an ancestor                                                     |
| `warnCoordinateEnvelope`                       | a position farther than `COORDINATE_ENVELOPE` (1e5) from the origin                        |
| `warnSingularScale`                            | a zero scale component (world matrix will not invert)                                      |
| `warnUnstableScale`                            | components differing by more than `UNSTABLE_SCALE_RATIO` (1e4):1, or a near-zero component |
| `warnImpossibleMass` / `warnImpossibleInertia` | negative or non-finite mass/inertia (`mass === 0` is quiet: static bodies)                 |
| `warnVersionMismatch`                          | `expected !== actual` on a document/format pair                                            |
| `validateSceneNode` / `validateSceneSubtree`   | the finite + envelope + scale checks, walking children                                     |

`validateSceneSubtree` is the one-call walk. It returns the warning count;
assertions still throw (`INVALID_SCENE_GRAPH`, `INVALID_APPLICATION_STATE`).

```ts
import { validateSceneSubtree } from "fourJS/diagnostics";

const warnings = validateSceneSubtree(scene);
```

## Authority conflicts are not this catalogue

A `"physics"` system asked to write a `"kinematic"` node is §42, not §85. The
writing **system** refuses and warns once (`warnAuthorityConflict`). A direct
application write to a system-owned node **lands**; in a DEV build it also
warns once, naming the owner, and does not lock the write. Production
(`__FOUR_DEV__ === false`) stays silent. Details:
[transform authority](transform-authority.md).

## What this family will not do

- It will not attribute a process-wide construction count to a named system.
- It will not run unless `DEV` is on **and** something called it (or
  `Application` had `stats` on).
- It will not replace `RangeError` on geometry factories or `FourError` on
  refused API calls — those are always-on.
- Simulation packages (`math`, `scene`, `motion`, `physics`, `animation`,
  `particles`) still must not import `DEV`; their own warnings stay
  unconditional `console.warn` with once-per-key suppression.
