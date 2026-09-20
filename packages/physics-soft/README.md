# @fourjs/physics-soft

Soft bodies and deformables — **a reserved stub. This package contains no implementation today.** Part of [fourJS](../../README.md).

What a consumer gets by installing it: **one export, `PACKAGE_NAME`, and nothing else** — measured from a consumer seat on 2026-09-19 (dogfood cycle 9) against installed tarballs, in Node and in Chrome. `fourJS/physics-soft` imports cleanly and provides no cloth, rope or pressure model. **There is no shipped soft-body capability anywhere else in fourJS**: §35 has no implementation phase scheduled, and rigid-body simulation through [`@fourjs/physics-rapier`](../physics-rapier/README.md) is the nearest thing that exists. This package is not a solver adapter either (ERRATA E-3), so writing a §37 adapter would not fill it.

Reserved for soft-body and deformable simulation (cloth, rope, pressure/volume models) per §35 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). It is not a solver adapter — see ERRATA E-3; the §102 solver packages are `physics-rapier` and `physics-box2d`.

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. No implementation phase has been scheduled for §35 yet.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/physics-soft`; publishes as `@danielsimonjr/fourjs-physics-soft`.
