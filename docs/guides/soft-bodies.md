# Soft bodies

`@fourjs/physics-soft` (§35, RFC 0011) simulates ropes, cloth and pressure
bodies on the CPU with position-based dynamics. It is not a §37 solver
adapter: it runs beside a `PhysicsWorld`, not inside one.

## Attach a SoftBody

A `SoftBody` is a component (one per node) that exposes a dynamic geometry
for rendering. Lengths are metres, times are seconds.

```ts
import { Renderable } from "@fourjs/scene";
import { UnlitMaterial } from "@fourjs/materials";
import { SoftBody } from "@fourjs/physics-soft";

const cloth = new SoftBody({
  kind: "cloth",
  columns: 16,
  rows: 12,
  width: 2,
  height: 1.5,
  pinned: [0, 15], // top corners follow the node transform
  stiffness: 0.9,
});
const node = new Renderable(
  cloth.geometry,
  new UnlitMaterial({ color: [1, 1, 1, 1] }),
);
node.addComponent(cloth);
app.scene.add(node);
```

`"rope"` takes `segments` and `length` (pinned `[0]` by default); `"pressure"`
takes a closed triangle mesh plus `pressure` (target volume multiple).

## Register the system

```ts
import { SoftBodySystem } from "@fourjs/physics-soft";

const soft = new SoftBodySystem();
app.systems.register(soft); // fixedUpdate, priority 610
soft.track(cloth);
```

It runs after the rigid solve (`PRIORITY_PHYSICS_SOLVE + 10`). The system owns
the vertex geometry (§42); move pinned particles by moving the node.

## Couple to a PhysicsWorld

```ts
const soft = new SoftBodySystem({ world, particleRadius: 0.02 });
```

Gravity is then read from the world, and particles collide with its colliders
through `world.raycast`. Coupling is one-way: rigid bodies feel nothing. A
particle that starts a substep inside a collider is not detected, and
`raycast` allocates its result array.

## Snapshot

```ts
const snap = soft.createSnapshot(); // float64 positions, previous, velocities
const hash = soft.checksum(); // FNV-1a, same encoding as PhysicsWorld.checksum
// ... later, with the same bodies tracked in the same order ...
soft.restoreSnapshot(snap);
```

Determinism is `same-runtime` (§33). See `examples/soft-body` for a running
cloth and rope.
