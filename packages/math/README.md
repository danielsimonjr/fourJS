# @fourjs/math

Math primitives. Part of [fourJS](../../README.md).

Implements §7 and the §7b math conventions of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 1 (§104). Mutable types, radians everywhere, right-handed Y-up.

On the §7b out-parameter policy, as shipped: instance methods mutate in place and return `this`, and `clone()` is the only allocation on a type. Where a result is _not_ `this` the caller owns the storage and the `out` parameter is **required** — `Quaternion.rotateVector3`, `Matrix4.decompose`, and every color conversion. `parseColor` / `parseColorRGB` are the only `out?` on the surface, because parsing a string is setup-time work. This package ships no static factories.

## What's here

- **Vectors** — `Vector2`, `Vector3`, `Vector4`.
- **`Quaternion`** — with shortest-arc slerp (decision D8).
- **Matrices** — `Matrix3` and `Matrix4`, including depth-range-parameterized projections (`DepthRange`).
- **`Rectangle2`** — an axis-aligned 2D rectangle (`isEmpty`, `containsPoint`, `equalsApprox`).
- **`Frustum` (§87)** — the six clip planes of a view-projection matrix, with `setFromViewProjection` (both `DepthRange` conventions) and a conservative `intersectsSphere`. The one culling primitive; the world bounds it tests come from `@fourjs/render`.
- **Color (§60a)** — the shared tuple types `ColorRGB` / `ColorRGBA` used by materials, animation, and particles, the sRGB transfer functions (`srgbToLinear`, `linearToSrgb`, and their `RGB` / `RGBA` in-place forms), and `parseColor` / `parseColorRGB`. Every conversion takes a required `out` tuple, is aliasing-safe, and allocates nothing; nothing clamps (odd extension, so out-of-gamut values survive).
- **Allocation counter** — `constructionCount` / `resetConstructionCount`, the test hook that keeps hot paths allocation-free. `noteConstruction` is internal: the constructors call it, and it is deliberately **not** exported from the barrel, so a consumer cannot move the gauge.

## Determinism (§33)

Measured from a consumer seat against the shipped tarballs, dogfood cycle 10: the same trace run in Node 24.19.0 and in Chrome 153.0.8010.48 (real browser, Playwright, `channel: "chrome"`), values compared as raw IEEE-754 bit patterns.

- **Bit-identical across the two runtimes** (38,336 bytes of trace, FNV-1a `8ae80b30` on both): `normalize`, `length`, `cross`, `add`, `scale`, `Matrix4.determinant` / `invert` / `fromArray` / `setOrthographic`, `Quaternion.normalize` / `rotateVector3`, `Frustum.setFromViewProjection` / `intersectsSphere`. These paths use `+ - * /` and `Math.sqrt` only, and `Math.sqrt` is correctly rounded by IEEE-754.
- **Not bit-identical across the two runtimes** (34,258 bytes, `e653d62a` on Node against `a3b63ba9` in Chrome): `Quaternion.setFromAxisAngle` (`Math.sin`/`Math.cos`), `Quaternion.slerp` (`Math.acos`/`Math.sin`), `Matrix4.setPerspective` (`Math.tan`). ECMA-262 does not specify the results of those functions, so two engines may legally disagree.

So this package is `same-runtime` in §33's terms, and the three operations above are precisely what stops it being `same-platform`. Both traces repeated byte-for-byte within each runtime. `srgbToLinear` / `linearToSrgb` (`Math.pow`) and `Quaternion.setFromLookDirection` agreed on these two engines, but `Math.pow` is unspecified too — treat that agreement as an observation, not a guarantee.

## Notes

- `Transform` (position/rotation/scale with the dirty channel) lives in `@fourjs/scene`, not here.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/math`; publishes as `@danielsimonjr/fourjs-math`.
