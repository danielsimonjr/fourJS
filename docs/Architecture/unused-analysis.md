# Unused Files and Exports Analysis

<<<<<<< HEAD
**Generated**: 2026-09-13
=======
**Generated**: 2026-09-11
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

## Summary

- **Potentially unused files**: 0
- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 4
  - **Orphaned (reachable from nothing — delete/wire candidates)**: 0
<<<<<<< HEAD
  - **Test-only (exercised by a test, ships nothing)**: 4
- **Potentially unused exports**: 5
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 5
=======
  - **Test-only (exercised by a test, ships nothing)**: 1
- **Potentially unused exports**: 6
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 6
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

## Dormant Files — Orphaned (delete/wire candidates)

Runtime source files reachable from NO root and NO test. Each is either dead code
to delete, or a root the tool cannot see (a new build/worker entry, a
`new URL()`-loaded script, or a side-effect-only module) — in which case wire it
or seed it. Verify before deleting.

_None._

## Dormant Files — Test-only (ships nothing, but exercised)

Not reachable from any package entry point, but imported by a test — deliberately
kept, standalone-tested code (e.g. legacy signal kernels) or a helper a test drives
directly. Not dead; not shipped. No action needed.

### `packages/diagnostics` (1)

- `packages/diagnostics/src/dev-warnings.ts`

### `packages/fourjs` (1)

- `packages/fourjs/src/text-harfbuzz.ts`

### `packages/text` (2)

- `packages/text/src/harfbuzz/harfbuzz-shaping-engine.ts`
- `packages/text/src/harfbuzz/index.ts`

## Potentially Unused Files

These files are not imported by any other file in the codebase:


## Unreferenced Anywhere (deletion candidates)

Not imported by any other file AND not referenced within their own module — the true dead-code candidates. Verify each isn't consumed by a mechanism the
parser can't see (dynamic access, docs examples, published-API contract) before deleting.


## Referenced In-Module (type contracts / helpers backing live exports)

Not imported cross-file, but referenced within their own module — they type or
support exports that ARE used, so they cannot be deleted in isolation. Mostly
interfaces typing live guards and per-package API completeness, not rot.

### `packages/geometry/src/path-boolean.ts`

- `ringsContain` (function) — 2 in-file refs

### `packages/geometry/src/geometry.ts`

- `nextGeometryIdentifier` (function) — 1 in-file ref

### `packages/render-webgpu/src/wgpu-pipeline-memo.ts`

- `WgpuPipelineRequest` (interface) — 1 in-file ref
- `MutableWgpuPipelineRequest` (interface) — 1 in-file ref

### `packages/fourjs/src/scene-serializers.ts`

- `CANVAS_VIEW_NODE_TYPE` (constant) — 3 in-file refs

### `packages/geometry/src/svg-document.ts`

- `parseTransform` (function) — 1 in-file ref

### `packages/text/src/shaping.ts`

- `validateShapingDirection` (function) — 1 in-file ref

