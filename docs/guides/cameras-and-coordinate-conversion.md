# Cameras and coordinate conversion

This guide covers the §47 camera system, §48 viewports, and every coordinate
conversion an application meets: CSS pixels → normalized device coordinates →
world space, and back. Picking (§71) and pointer input (§72) are the same
conversions packaged, so they are covered here too.

## Cameras are nodes (§47)

A camera is placed with its transform like any other node, and owns a
projection. Two projections ship: `OrthographicCamera` and
`PerspectiveCamera` (both in `four/scene`). Nothing recomputes implicitly —
after changing a projection parameter, call `updateProjectionMatrix()`:

```ts
import { OrthographicCamera, PerspectiveCamera } from "fourJS/scene";

const ortho = new OrthographicCamera({
  left: -8,
  right: 8,
  bottom: -4.5,
  top: 4.5,
  near: 0.1,
  far: 100,
});
ortho.transform.position.set(0, 0, 20);
ortho.updateProjectionMatrix();

const persp = new PerspectiveCamera({
  fieldOfView: Math.PI / 4, // radians, as everywhere (§7a)
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
});
```

`camera.projectionMatrix` and `camera.inverseProjectionMatrix` are plain
`Matrix4`s; the inverse is the first half of unprojecting a pointer position.
Projections are parameterized by depth range (`DepthRange`) so a future
zero-to-one backend needs no camera changes.

## Viewports (§48)

A viewport binds a camera to a region of the canvas and a clear colour.
`createFullscreenViewport(camera)` covers the whole surface; a second entry in
`app.views` is split-screen or a minimap:

```ts
const view = createFullscreenViewport(camera);
view.clearColor = [0.05, 0.06, 0.09, 1];
const app = new Application({ renderer, canvas, views: [view] });
```

## The conversion chain

With an orthographic camera showing `W × H` world units over a `w × h` CSS
pixel canvas, the mapping is affine and exact. The playground's camera shows
16 × 9 units over 960 × 540 pixels — 60 px per unit:

```text
px = (x + 8) × 60        py = (4.5 − y) × 60
```

The Y flip is the one conversion everyone forgets: platform pointer
coordinates grow **downward**, world Y grows **upward** (§7a). The pipeline
in `four/input` does it for you:

1. Platform pixels → NDC through the canvas's bounding rectangle (including
   the Y flip and the device pixel ratio).
2. NDC → a world-space ray through `createPickRay(camera, ndcX, ndcY,
outOrigin, outDirection)` — the camera's world transform composed with its
   inverse projection. Under an orthographic camera the ray is parallel to the
   view direction; under a perspective camera it fans out from the eye.
3. The ray is tested against pick candidates (§71) in each candidate's
   **local** space, so an oriented box is picked as an oriented box.

## Picking and pointer input, complete (§71, §72)

```ts
import { PointerInput, type Pickable } from "fourJS/input";

// The input package never reads geometry (its dependency matrix forbids it),
// so the layer that does states each node's local-space bounds:
const pickables: readonly Pickable[] = [disc, cube].map((node) => {
  const bounds = node.geometry.computeBounds();
  return { node, boundsMin: bounds.min, boundsMax: bounds.max };
});

// A real HTMLCanvasElement satisfies PointerSurface structurally.
const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
});

disc.on("click", (event) => {
  // `click` is synthesized: press + release on the same node, no drag between
  // (§72). event.worldPoint is the pick point in world space.
  console.log("hit at", event.worldPoint);
});
```

Pointer events propagate through the scene graph with capture-phase variants
(`"capture:pointerdown"` etc., §72). Passing `pickables` as a callback lets
you construct the input source before the scene exists.

That sample is the **synchronous ray/bounds path**. Nodes with
`hitTestMode = "gpu"` are skipped there on purpose — the id-buffer pass
answers them, and one pointer event must not resolve the same node twice.
The GPU/pixel seam is RFC 0005's `PickProvider`: two NDC numbers in, a
`Node.id` out, asynchronously. `@fourjs/input` never names a renderer;
the umbrella's `createPickProvider` is the four-line adapter between a
`PickingService` and that seam.

```ts
import { PointerInput, type Pickable } from "fourJS/input";
import { registerPickingPipeline } from "fourJS/render-webgl";
import { createPickProvider } from "fourJS";

registerPickingPipeline(); // once, at setup — links the id program
const picking = renderer.createPickingService();
const provider = createPickProvider(picking, view);

hull.hitTestMode = "gpu"; // ray tier stands aside; the id pass answers

const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
  pickProvider: provider, // omit this and every handler stays fully sync
});

// per frame that wants pixel picking (opt-in — the pass costs a frame):
picking.update(scene, view);
```

Without `pickProvider`, `PointerInput` is byte-identical to the sample
above: no `await`, no microtask. A provider miss (`undefined`, or an id
not in `pickables`) falls back to the ray tier. Capture still skips
picking.

Particle systems join the id pass as **one candidate for the whole
emitter** (`ParticleIdProgram` instances the shared unit quad with the
emitter's table index). That is not a per-particle id; trails are not
drawn; a zero-count system issues no instanced draw and still has no
bounds (`ParticleRenderable.computeBounds` returns `false` when nothing
is alive). `hitTestMode = "bounds"` keeps the AABB path for a live
system; `"gpu"` is what selects the id pass. WebGPU declares the same
`registerPickingPipeline` / `createPickingService` seam
(`fourJS/render-webgpu`); its id pass draws one id per particle emitter
(CPU 8-float billboard) and skinned meshes through a private skinned id
pipeline (`skinMatrix()`, never bind pose). WebGL draws skinned meshes
through `SkinnedIdProgram` (deformed silhouette, same palette the colour
pass uploads).

## Dragging: pixels to world deltas

`DragManager` converts pointer motion into a **world-space displacement** —
exact under an orthographic camera, via near-plane unprojection under a
perspective one — and hands it to the application. It never writes a
transform; what a drag _means_ is your decision, and writing the transform
needs a §42 authority handover:

```ts
import { DragManager } from "fourJS/input";

const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    motion.untrack(node);
    node.transformAuthority = "manual";
  },
  onDrag: (node, worldDelta) => {
    const p = node.transform.position;
    p.set(p.x + worldDelta.x, p.y + worldDelta.y, p.z);
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motion.track(node);
  },
});
drags.makeDraggable(cube);
```

See the [transform authority guide](transform-authority.md) for why the
handover is untrack + authority write, in that order.

## Camera rigs (§44)

§44 lists seven camera controls; most ship as components in `@fourjs/motion`
(`OrbitRig`, `FollowRig`, `LookAtConstraint` + `ConstraintSystem` at §39 step 7) or as composition (path animation, physics attachment — see
`tests/integration/camera-rigs.test.ts`). Rigs never read input: they take
**numbers the application feeds in** so sensitivity and replay stay yours.

### Orbit and follow

```ts
import { ConstraintSystem, LookAtConstraint, OrbitRig } from "fourJS/motion";

const rig = camera.addComponent(new OrbitRig({ target: player, distance: 6 }));
camera.addComponent(new LookAtConstraint({ target: player }));
camera.transformAuthority = "constraint";
constraints.track(camera);

// From your pointer handler (units are application policy):
rig.orbit(pointerDeltaX * 0.005, -pointerDeltaY * 0.005);
rig.dolly(-wheelDelta * 0.01);
```

`FollowRig` switches between a follow target and a spring arm with its
`frame` option; see `@fourjs/motion`'s README and `packages/motion/tests/camera-rigs.test.ts`.

### Trackball (`@fourjs/scene`)

`TrackballRig` shipped with R-37 (2026-08-21). It is defined over a viewport in
**screen space**, so it lives in `@fourjs/scene` rather than `@fourjs/motion`, and
it is event-driven — call `applyTo` from the pointer handler under §42's
`"manual"` authority, not from `ConstraintSystem`:

```ts
import { TrackballRig } from "fourJS/scene";

const trackball = new TrackballRig({ width: 960, height: 540, distance: 6 });
camera.transformAuthority = "manual";

// Viewport pixels, from wherever your pointer events live:
trackball.drag(previous.x, previous.y, current.x, current.y);
trackball.applyTo(camera);
```

Tests: `packages/scene/tests/trackball.test.ts`.

### Fly (application snippet)

§44's fly control deliberately has **no class** — it reuses
`OrbitRig`'s `orbit()` surface for yaw/pitch state and writes the camera under
`"manual"` authority. Once pointer deltas are fed in, aim and move are two lines
over the same spherical direction `OrbitRig` uses for placement:

```ts
import { OrbitRig } from "fourJS/motion";
import { PerspectiveCamera } from "fourJS/scene";
import { Vector3 } from "fourJS/math";

const camera = new PerspectiveCamera({
  fieldOfView: Math.PI / 4,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
});
const rig = new OrbitRig(); // state only — no target, no ConstraintSystem
camera.transformAuthority = "manual";

// Pointer → rig (application policy on the scale factors):
rig.orbit(pointerDeltaX * 0.005, -pointerDeltaY * 0.005);

// Each step, after reading WASD as `forward` metres per second (§7a):
const cp = Math.cos(rig.pitch),
  sp = Math.sin(rig.pitch);
const sy = Math.sin(rig.yaw),
  cy = Math.cos(rig.yaw);
const p = camera.transform.position;
camera.lookAt(new Vector3(p.x + cp * sy, p.y + sp, p.z + cp * cy));
p.x += cp * sy * forward * dt;
p.y += sp * forward * dt;
p.z += cp * cy * forward * dt;
```

Strafe is the same pattern with the horizontal right vector
`(cy, 0, −sy)`.

### Shake

`CameraShake` (shake/impulse) ships. It is a component, so `ConstraintSystem`
advances it **after** the placement rigs: the rig writes the camera's position,
then the shake offsets it.

```ts
import { CameraShake } from "fourJS/motion";

const shake = camera.addComponent(
  new CameraShake({
    amplitude: new Vector3(0.08, 0.08, 0.04),
    frequency: 12,
    seed: 7,
    traumaDecay: 1.5,
  }),
);
camera.transformAuthority = "constraint";
constraints.track(camera);
shake.impulse(1);
```

`trauma` is a unitless 0–1 envelope and the sampled offset is scaled by
`trauma²`. `impulse()` raises it; `traumaDecay` is the drop per second, and its
default is `0` — a shake with no decay runs at full amplitude until the
application turns it down. The offset is interpolated hash value noise sampled
at `simulationTime · frequency`, so two shakes that share a seed and a time are
bit-identical (§33).

## Honest state

- Camera **rigs** ship in `@fourjs/motion` (`OrbitRig`, `FollowRig`,
  `LookAtConstraint`, `FirstPersonLook` + `CharacterController`) and
  `TrackballRig` in `@fourjs/scene`. Fly is the application snippet above;
  `CameraShake` ships as the component shown above (2026-09-06).
- `PerspectiveCamera` is exercised by exactly one example,
  `examples/first-3d-scene` (written 2026-08-07); every other shipped example
  uses an orthographic camera. This bullet claimed the same example did until
  2026-08-05, when the claim was **false** — the directory then held only a
  `.gitkeep` — and it read "no example exercises it … the perspective path has
  no browser-level demonstration" from that date until the example was written.
  The projection is now measured in a browser rather than asserted:
  `tests/browser/first-3d-scene.spec.ts` compares the on-screen area of two
  identical spheres at different depths (`docs/AUDIT-120.md`, **S-8**).

## Cross-references

- §47 (cameras), §48 (viewports), §71 (picking), §72 (input), §7a (Y-up).
- `examples/first-2d-scene` (picking + dragging), `examples/mechanism`
  (click plates), `examples/physics-playground` (world-point impulses from
  clicks).
