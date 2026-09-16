# @fourjs/scene

Scene graph — the shared model all four pillars act on. Part of [fourJS](../../README.md).

Implements §6–8, §42–43, and §46–48 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 1–3 and 7. Right-handed Y-up transforms, radians.

## What's here

- **Hierarchy** — `Node` (single inheritance over `@fourjs/core`'s `EventEmitter`, typed `NodeEventMap`, component host), `Group`, `Scene`, and `NodeSpace` (§8 mode on the node, with `NODE_SPACE_SERIALIZER`).
- **`Transform`** — position/rotation/scale with a dirty channel driven by math change-hooks, plus `resolveWorldTransform` / `resolveWorldTransforms` (world matrices resolve per fixed step; staleness tracking includes parent identity).
- **Transform authority (§42)** — `TransformAuthority` (`manual`, `animation`, `kinematic`, `physics`, `blended`, `constraint`, `network`), `DEFAULT_TRANSFORM_AUTHORITY`, and `warnAuthorityConflict` (conflicts warn, never silently overwrite; takes a structural `AuthorityNode`).
- **Cameras and viewport (§47–48)** — `PerspectiveCamera` / `OrthographicCamera` / `ScreenCamera` with depth-range-parameterized projection, `Viewport` / `createFullscreenViewport`. Camera _rigs/controls_ belong to `@fourjs/motion` (`OrbitRig`, `FollowRig`, `LookAtConstraint`; `TrackballRig` lives here because it is defined over a viewport in screen space).
- **Render interpolation (§43)** — `PoseBuffer` (lerp/slerp between physics poses), `PoseSnapshotSystem` / `createSnapshotSystem`, and `PoseTarget` (position + rotation history; the §19 blending input captured by `@fourjs/physics`'s capture system).
- **Bones and skeletons (§54)** — `Bone` is a node; `Skeleton.update(skinRoot, worldOf?)` writes the joint palette. Omit `worldOf` for resolved worlds; the interpolated render list supplies a provider that composes §43 local poses, then runs the palette product. Palettes are never matrix-lerped.

## Staged / not yet implemented

- A render/UI consumer that _places_ a node from `NodeSpace`'s presentation modes (`screen` / `viewport` / `camera` / `billboard`). The declaration and §79 pair ship; placement is still §47/§48/§74.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/scene`; publishes as `@danielsimonjr/fourjs-scene`.
