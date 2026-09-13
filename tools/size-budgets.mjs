/**
 * Size-limit budget rationale for §86 example bundles (2026-09-07).
 *
 * Limits live in `.size-limit.json`. JSON has no comment field, so A/B
 * justification is recorded here and referenced from that file by path.
 *
 * Measure after `bun run examples:build` with `bun run size`. The numbers
 * below are the CI measurement from `cursor/browser-gate-after-76-8caa`
 * (run 34068239028) after #76 — that PR never reached the size step.
 *
 * | Example            | Measured (gzip) | Prior limit | New limit | Rationale |
 * |--------------------|-----------------|-------------|-----------|-----------|
 * | first-3d-scene     | 42.1 kB         | 39 kB       | 43 kB     | +3.1 kB — #76 production path (gpu-timer getter, resource-memory helpers that DCE, render/particle follow-ups). A: hold at 39 → red; B: 43 kB → ~2 % headroom. |
 * | particles-demo     | 42.21 kB        | 37.5 kB     | 43 kB     | +4.71 kB — R-32 wide instance layout + trail/appearance in the demo graph. B keeps ~1.8 % margin. |
 * | ui-demo            | 48.47 kB        | 46 kB       | 49.5 kB   | +2.47 kB — A-13 a11y mirror + A-5 stats seams already in the retained-mode graph. B avoids toolchain-flake on Vite 8.2. |
 * | flagship           | 1.98 MB         | 1.65 MB     | 2.05 MB   | +328 kB — Rapier 0.20.0 ships larger wasm; this site registers both 2d and 3d adapters. |
 * | motor-digital-twin | 1.22 MB         | 1.00 MB     | 1.25 MB   | +219 kB — one Rapier 0.20 wasm image (directly constructed 3d adapter). |
 * | character-controller | 1.15 MB       | 0.95 MB     | 1.20 MB   | +203 kB — same single 0.20 wasm image as the twin. |
 *
 * first-2d-scene (56.23 / 150 kB) unchanged — still well under §86's
 * minimal-2D-app gate. `__FOUR_DEV__: false` on every production example
 * except the twin; the wasm deltas are the solver bump, not DEV leftovers.
 *
 * **2026-09-11 (after the register seams + dispose/emitter/WebGPU packets merged):**
 * shadow / effect / particle programs now compile only after `register*()`,
 * so light-free bundles shed them: first-2d 58.08 → 56.20, first-3d 43.42 →
 * 41.45 (limit 44 → 42), ui-demo 50.25 → 48.23 (limit 51 → 49). particles-demo
 * keeps its programs (it registers them) and measured 43.42 after the dispose
 * flags and the allocation-free emitter landed — 80 B under the 43.5 kB limit
 * set on 2026-09-09, which is not headroom; 44 kB restores the ~1.3 % the
 * other rows keep. The seams packet's own table follows.
 *
 * **2026-09-11 (after #92, measured locally on the rebased RFC-audit branch):**
 * #92's `HemisphereLight` (§68) grew **every** example bundle by ~480–520 B
 * gzip, light-free ones included — the A/B at 07d4eab (pre-#92) vs 318e6bd:
 * first-2d 57.60 → 58.08, first-3d 42.93 → 43.42, particles-demo 43.20 → 43.72,
 * ui-demo 49.75 → 50.25. Traced in the built bundles: the node class does
 * **not** ride (it tree-shakes); what does is the structural collector branch
 * + three `SceneLights` fields in `@fourjs/render`, and the GLSL chunk +
 * `HemisphereLightUniforms` spliced into the lit / standard / skinned-lit
 * programs the WebGL renderer compiles at init (the 0.75 kB law). Collapsing
 * the two GLSL helpers into one and compacting the uploader recovered
 * ~20–30 B (58.06 / 43.41 / 43.70 / 50.22); the rest is the feature. Three
 * budgets rose to keep ~1.4–2 % headroom; first-2d stays far under §86's gate.
 *
 * | Example        | Measured (gzip) | Prior limit | New limit | Rationale |
 * |----------------|-----------------|-------------|-----------|-----------|
 * | first-3d-scene | 43.41 kB        | 43 kB       | 44 kB     | +0.48 kB hemisphere in lit/standard programs compiled at init |
 * | particles-demo | 43.70 kB        | 43.5 kB     | 44.5 kB   | same mechanism |
 * | ui-demo        | 50.22 kB        | 50 kB       | 51 kB     | same mechanism (no lights in the demo; the programs still ship) |
 *
 * **2026-09-09 (#86 squash on main, run 34339266079):** PickProvider,
 * WebGL `ParticleIdProgram`, 192-byte `DrawUniforms`, and the particles-demo
 * simulate/present split pushed two gzip bundles over the 2026-09-07
 * ceilings. Browser tests were green (107/107). first-3d 42.74/43 kB holds.
 *
 * | Example        | Measured (gzip) | Prior limit | New limit | Rationale |
 * |----------------|-----------------|-------------|-----------|-----------|
 * | particles-demo | 43.04 kB        | 43 kB       | 43.5 kB   | +38 B over — id-pass / appearance already in the demo graph. A: hold at 43 → red; B: 43.5 kB. |
 * | ui-demo        | 49.51 kB        | 49.5 kB     | 50 kB     | +11 B over — PickProvider on `@fourjs/input` rides the retained-mode graph. B: 50 kB. |
 *
<<<<<<< HEAD
 * **2026-09-11 RFC packets:** clean A/B builds on the same Bun 1.4.2 /
 * Vite 8.2.2 toolchain, baseline main 318e6bd vs this branch. Main already
 * exceeded all three old limits; the new production Mesh skinning/texture
 * lifecycle and shaped UI paths account for the additional branch growth.
 * Optional HarfBuzz WASM remains outside default bundles.
 *
 * | Example        | Main gzip | Branch gzip | Prior limit | New limit |
 * |----------------|-----------|-------------|-------------|-----------|
 * | first-3d-scene | 43.42 kB  | 45.05 kB    | 43 kB       | 46 kB     |
 * | particles-demo| 43.72 kB  | 45.33 kB    | 43.5 kB     | 46 kB     |
 * | ui-demo       | 50.25 kB  | 53.60 kB    | 50 kB       | 54.5 kB   |
 *
 * These retain ~1.5–2.1% headroom. The normative first-2d limit remains
 * 150 kB (61.29 kB measured); all solver-bearing example limits remain.
=======
 * **2026-09-11 (registration seams for the shadow, effect and particle
 * pipelines):** `WebglRenderer` compiled eight programs at initialize, so
 * `ShadowProgram`, `EffectProgram`, `ParticleProgram` + `ParticleTrailProgram`
 * and both particle batch caches rode every bundle that carried the class.
 * They now sit behind `registerShadowPipeline()`, `registerEffectPipeline()`
 * and `registerParticlePipeline()` (the `registerSkinningPipeline()` shape:
 * a module `let`, resolved lazily on first use, fail-once, one dev warning)
 * and compile only in bundles that call them. Measured on this worktree
 * (`bun run examples:build && bun run size`, gzip), before → after:
 *
 * | Example              | Before   | After    | Delta    | Prior limit | New limit | Rationale |
 * |----------------------|----------|----------|----------|-------------|-----------|-----------|
 * | first-2d-scene       | 58.08 kB | 56.00 kB | −2.08 kB | 150 kB      | 150 kB    | §86's minimal-2D-app gate, not a measured ceiling — left alone. |
 * | first-3d-scene       | 43.42 kB | 41.28 kB | −2.14 kB | 43 kB       | 42 kB     | was 421 B over before this packet; 42 kB ≈ 1.7 % headroom. |
 * | particles-demo       | 43.72 kB | 43.24 kB | −0.48 kB | 43.5 kB     | 43.5 kB   | registers particles, so only shadows + effects left; was 220 B over, now 260 B under (0.6 %). Not lowered — 43.24 × 1.015 > 43.5. |
 * | ui-demo              | 50.25 kB | 48.16 kB | −2.09 kB | 50 kB       | 49 kB     | was 246 B over; 49 kB ≈ 1.7 % headroom. |
 * | flagship             | 1.98 MB  | 1.98 MB  | —        | 2.05 MB     | 2.05 MB   | registers particles; the wasm images dominate at this precision. |
 * | motor-digital-twin   | 1.22 MB  | 1.22 MB  | —        | 1.25 MB     | 1.25 MB   | unchanged at MB precision. |
 * | character-controller | 1.15 MB  | 1.15 MB  | —        | 1.20 MB     | 1.20 MB   | unchanged at MB precision. |
 *
 * No limit was raised. `StandardProgram` stayed compiled at initialize in
 * that packet — `StandardMaterial` is a core §57 family and making it opt-in
 * was an owner decision, taken the same day (below).
 *
 * **2026-09-11, follow-up (`registerStandardPipeline()` + audit A5/A6
 * mirrors):** the owner authorised moving `StandardProgram` behind the same
 * seam (init now compiles three programs: unlit, sprite, lit), and the WebGL
 * backend gained two CPU mirrors — a last-colour mirror in every
 * `setColor`/`setTint`/`setBaseColor` (skip an identical `uniform4fv`;
 * forgotten by `use()`) and a per-frame bound-texture mirror on the map unit
 * (skip a `bindTexture` of the handle unit 0 already holds under the same
 * pipeline). Measured on this worktree (same commands, gzip), the previous
 * row's "after" → this row's "after":
 *
 * | Example              | Before   | After    | Delta    | Prior limit | New limit | Rationale |
 * |----------------------|----------|----------|----------|-------------|-----------|-----------|
 * | first-2d-scene       | 56.00 kB | 55.03 kB | −0.97 kB | 150 kB      | 150 kB    | §86 gate, left alone. |
 * | first-3d-scene       | 41.28 kB | 40.23 kB | −1.05 kB | 42 kB       | 41 kB     | 40.23 × 1.015 = 40.83 → 41 kB (1.9 % headroom). |
 * | particles-demo       | 43.24 kB | 42.22 kB | −1.02 kB | 43.5 kB     | 43 kB     | 42.22 × 1.015 = 42.85 → 43 kB (1.8 % headroom). |
 * | ui-demo              | 48.16 kB | 47.05 kB | −1.11 kB | 49 kB       | 48 kB     | 47.05 × 1.015 = 47.76 → 48 kB (2.0 % headroom). |
 * | flagship             | 1.98 MB  | 1.98 MB  | —        | 2.05 MB     | 2.05 MB   | unchanged at MB precision. |
 * | motor-digital-twin   | 1.22 MB  | 1.22 MB  | —        | 1.25 MB     | 1.25 MB   | unchanged at MB precision. |
 * | character-controller | 1.15 MB  | 1.15 MB  | —        | 1.20 MB     | 1.20 MB   | unchanged at MB precision. |
 *
 * The ~1 kB per bundle is `StandardProgram` and its two shaders leaving
 * every example (none draws a `StandardMaterial`); the mirrors add a few
 * dozen bytes each. GL calls per frame on `benchmarks/render-batching.mjs`'s
 * scenes, through the counting-GL seam (`tests/integration/helpers/
 * recording-gl.ts`), steady-state second frame, before → after the mirrors:
 * 10 000 sprites over one atlas — `uniform4fv` 10 000 → 1, `bindTexture`
 * 10 001 → 2 (one bind, one end-of-frame unbind), all GL calls 50 015 →
 * 30 017; 5 000 rectangles over one `UnlitMaterial` — `uniform4fv` 5 000 → 1,
 * `bindTexture` 0 → 0, all GL calls 20 007 → 15 008. The first cut of the
 * colour mirror kept its four floats in a `Float32Array` and never matched a
 * double like `0.2` (5 000 → 5 000 on the shape row); the shipped mirror
 * holds doubles, and the unit test now uses `[0.2, 0.6, 1, 1]` for exactly
 * that reason. No limit was raised.
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
 */

export const SIZE_BUDGETS_DOC = "tools/size-budgets.mjs";
