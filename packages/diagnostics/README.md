# @fourjs/diagnostics

Diagnostics, determinism checksums, replay, and debug-draw data. Part of [fourJS](../../README.md).

Implements §33–34 (checksums, snapshots, replay) and the data side of §41/§84–85 (debug visualization) from [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phases 1 and 10.

## What's here

- **Checksums (§33)** — `createChecksum` / `Checksum` / `hashFloats`, the FNV-1a digest used by the determinism golden tests.
- **Replay (§34)** — `ReplayRecorder` and `ReplayPlayer` over a duck-typed `ReplayTarget` (any `PhysicsWorld`-shaped host; `applyInput` optional), plus the versioned recording envelope: `encodeReplayRecording` / `decodeReplayRecording` / `validateReplayRecording`, `isReplayCompatible` / `assertReplayCompatible`, `MINIMUM_REPLAY_FORMAT_VERSION` / `LATEST_REPLAY_FORMAT_VERSION` / `SUPPORTED_REPLAY_FORMAT_VERSIONS` (a document declares the _lowest_ version that can express it, so the version it carries is not always the latest — `REPLAY_FORMAT_VERSION` survives as a deprecated alias of `LATEST_…`), and strict canonical base64 (`encodeBase64` / `decodeBase64`). Recording is non-perturbing; replays are checksum-verified bit-identical.
- **§96 untrusted text** — `decodeReplayRecording(text, limits?)` takes `UntrustedJsonLimits` (`maximumTextLength`, `maximumDepth`; finite defaults) and refuses an over-budget or over-deep recording with `UNTRUSTED_INPUT_REJECTED` before `cloneJsonValue` recurses into it. `validateReplayRecording` is deliberately unguarded — recorders hand it live values.
- **Debug draw (§41)** — `DebugDrawBuffer` (world-space line list, 7 floats per vertex) fed by duck-typed collectors: `collectBodyOrigins`, `collectBodyVelocities`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`.
- **Debug draw → render (§84/§113, R-35)** — `debugDrawStreams(buffer, out?)` de-interleaves the buffer into `positions` + `colors` `Float32Array`s sized exactly as `BufferGeometry` requires (this package has no `geometry` edge in the frozen §3.1 matrix, so it emits arrays, not a geometry); `applyDebugDrawStreams(streams, geometry)` re-points or `markDirty()`s a duck-typed sink. With `mode: "lines"` and `UnlitMaterial({ vertexColors: true })` the whole overlay is **one draw call** at any segment count.
- **Solver statistics** — `solverStatistics` / `solverJointStatistics` over the adapter access seams.
- **§84 frame statistics** — `createFrameStats` / `copyFrameStats` / `resetFrameStats` plus the recorders `recordRenderStatistics` and `recordResourceMemory`, which is what `Application.stats` is assembled from.
- **§83/§85 development warnings and validation** — the opt-in, caller-driven family: `auditFrameAllocations`, `auditResourceLeaks` / `auditFinalizedLeaks`, the disposal tracker (`trackDisposable` / `trackedDisposableId` / `disposeTracked` / `reportFinalized` / `resetLeakRegistry`), the assertions (`assertFinite`, `assertFiniteVec3`, `assertNoSceneGraphCycle`), the scene validators (`validateSceneNode` / `validateSceneSubtree`) and the numerical-stability warnings (`warnCoordinateEnvelope`, `warnUnstableScale`, `warnSingularScale`, `warnImpossibleMass`, `warnImpossibleInertia`, `warnVersionMismatch`). Every one of them returns its production no-op without touching its arguments when `DEV` is `false`.
- **Rollback** — `RollbackBuffer`, the §34 state ring the replay path rewinds through.

## Staged / not yet implemented

Read the exported `DEBUG_DRAW_STAGED` list for dated, per-item reasons: joint-anchor/constraint visualization and applied-force vectors are staged. (Center-of-mass display landed 2026-08-04 and per-segment-colored drawing 2026-08-07; both entries are gone from the list.) Replay compatibility checks compare adapter name/version only — world _configuration_ mismatches are not refused.

_Corrected 2026-09-19 (dogfood cycle 9): this paragraph ended "The §84 `app.stats.*` overlay surface is not implemented." It shipped on 2026-08-08 with the dev/production build split. `Application.stats` is a `FrameStats | null` — `null` unless `new Application({ stats: true })` asked for it, and always `null` in a production build, so a program reading `app.stats?.drawCalls` compiles and runs in both. Measured from a consumer seat in Chrome against the staged, packed, installed packages: `app.stats.drawCalls` was **4** and `app.stats.triangles` **4620** for a four-draw scene. What is genuinely absent is a **drawn** overlay widget; the numbers are there._

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/diagnostics`; publishes as `@danielsimonjr/fourjs-diagnostics`.
