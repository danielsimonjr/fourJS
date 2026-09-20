# The scene graph and transforms

Everything in fourJS lives in one scene graph: 2D shapes, 3D meshes, cameras,
sprites, text glyphs, UI widgets, and the nodes that carry rigid bodies and
particle emitters. There is no separate "2D layer" — a flat circle and a solid
box are siblings in the same right-handed, Y-up world (§6, §7a).

## Nodes, groups, and scenes

`Node` is the base type (§6). It extends the typed `EventEmitter` (§6b), owns a
`Transform`, a parent, and an ordered child list. `Group` is a plain container;
`Scene` is the root the application owns; `Renderable` (from `fourJS/render`)
is a node with a geometry and a material.

```ts
import { Application } from "fourJS/application";
import { boxGeometry, circleGeometry2D } from "fourJS/geometry";
import { UnlitMaterial } from "fourJS/materials";
import { Vector3 } from "fourJS/math";
import { MotionComponent, MotionSystem } from "fourJS/motion";
import { Renderable } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";
import {
  Group,
  OrthographicCamera,
  createFullscreenViewport,
} from "fourJS/scene";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("no canvas");

const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
// `createFullscreenViewport` deliberately sets no `clearColor`: a full-surface
// view that never clears is usually a bug, and a default colour would hide it.
// Without this line every frame draws on top of the last and movers smear.
view.clearColor = [0.05, 0.06, 0.09, 1];
const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });
renderer.resize(800, 600, window.devicePixelRatio);
app.scene.add(camera);

// A group of two shapes. Children inherit the group's transform, so moving
// the assembly is one write (§7).
const assembly = new Group();
assembly.name = "assembly";
assembly.transform.position.set(-1, 0.5, 0);

const disc = new Renderable(
  circleGeometry2D({ radius: 0.4, segments: 48 }),
  new UnlitMaterial({ color: [1, 0.5, 0.2, 1] }),
);
disc.transform.position.set(0.8, 0, 0);

const cube = new Renderable(
  boxGeometry({ width: 0.6, height: 0.6, depth: 0.6 }),
  new UnlitMaterial({ color: [0.25, 0.7, 1, 1] }),
);

assembly.add(disc);
assembly.add(cube);
app.scene.add(assembly);

// A component gives the node behaviour state; a system does the per-step work.
cube.transformAuthority = "kinematic"; // §42 — see the transform-authority guide
cube.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0, 1, 0.5) }),
);
const motion = new MotionSystem();
app.systems.register(motion);
motion.track(cube);
app.poses.track(cube); // §43: draw interpolated poses for movers

let last: number | null = null;
function frame(now: number): void {
  if (last !== null) app.step((now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
}
app.initialize().then(() => {
  app.start();
  requestAnimationFrame(frame);
});
```

This is `examples/first-2d-scene` reduced to its skeleton; read that file for
the fully commented version.

## Transforms (§7, §7b)

Every node's `transform` holds `position` (`Vector3`), `rotation`
(`Quaternion`), and `scale` (`Vector3`). The conventions:

- **Mutable math types, in place.** `position.set(x, y, z)`, `.copy(v)`,
  `.add(v)` mutate and announce the change — mutators advance the transform's
  dirty version, so no manual `markDirty()` is needed for ordinary writes.
- **Radians, seconds, Y-up** (§7a). Rotations are quaternions; build them with
  `new Quaternion().setFromAxisAngle(axis, angleRadians)`.
- **World matrices are resolved per fixed step**, lazily and version-checked
  (`resolveWorldTransform` / `resolveWorldTransforms` in `four/scene` do it on
  demand). A node's world pose is its local transform composed with every
  ancestor's — which is why the glyphs of a text label can be children of one
  `Group` and the whole label moves with a single write.

Reparenting is `parent.add(child)` / `parent.remove(child)`; setting a new
parent detaches from the old one. Hierarchy changes emit typed events
(`NodeHierarchyEvent`) on the nodes involved (§6b).

## Components (§6a)

Behaviour attaches to nodes as _components_: `RigidBody`, `Collider`,
`MotionComponent`, `KinematicController`, `PoseTarget`. The rules:

- `node.addComponent(component)` returns the component; **one component per
  type per node** — adding a second of the same type does not throw, it
  **replaces** the first (detaching it, running its `onDetach`) and warns once:
  `A component of type "motion" is already attached; replacing it (§6a…)`.
  Adding a node to itself or to one of its own descendants _does_ throw
  (`FourError`, §85); component replacement is the quieter case, so treat that
  warning as a wiring bug rather than as noise.
- Components are state; **systems** (registered on `app.systems`, §39) do the
  per-fixed-step work. A `MotionComponent` does nothing until a
  `MotionSystem` tracks its node.
- Components never write transforms behind the owner's back — that is §42's
  job to police (see the transform-authority guide).

## Events (§6b)

One typed emitter API serves nodes and the application alike:

```ts
disc.on("click", (event) => {
  // pointer events propagate through the graph; see the cameras guide
});
app.on("fixedUpdate", (time) => {
  // after every fixed step; time.fixedDeltaTime is in seconds
});
```

Listeners return an unsubscribe function. Physics events (`collisionenter`,
`triggerenter`, …) dispatch **after** each fixed step, never inside it (§29,
§39 step 9), so a listener may freely mutate the scene.

## Cross-references

- §6, §6a, §6b, §7, §7a, §7b — the normative text.
- `examples/first-2d-scene` — hierarchy, components, events, and a text label
  built from child nodes.
- Next: [cameras and coordinate conversion](cameras-and-coordinate-conversion.md),
  [fixed-step simulation](fixed-step-simulation.md).
