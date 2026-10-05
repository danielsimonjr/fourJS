# 3D geometry generators

§53 names eleven 3D primitives. Two of them — `boxGeometry` and `planeGeometry`
— shipped with the MVP renderer. The other nine live in `fourJS/geometry` as
factory functions that return a `BufferGeometry` with **positions, analytic
normals, and uvs**. They are not Node subclasses and they are not colliders: a
mesh draws the geometry; a `Collider` on the same node is a separate component
with its own descriptor.

Until 2026-10-05 no guide mentioned any of the nine (cycle 8 and cycle 9 both
counted the gap). Package README and TypeDoc already named the symbols; this
guide teaches the conventions they share so a first call is not a winding or
axis surprise.

## Import

```ts
import { Mesh } from "fourJS/render";
import { LitMaterial } from "fourJS/materials";
import {
  capsuleGeometry,
  coneGeometry,
  cylinderGeometry,
  extrudeGeometry,
  heightFieldGeometry,
  latheGeometry,
  sphereGeometry,
  torusGeometry,
  tubeGeometry,
} from "fourJS/geometry";
```

Every builder returns a `BufferGeometry`. Hand it to a `Mesh` (or keep it for
picking bounds / CPU skinning). Dispose the geometry when the mesh is gone —
`BufferGeometry` is a §83 resource.

## Conventions every builder shares

- **Right-handed, Y-up** (§7a). Surfaces of revolution revolve about **+Y** and
  are centred on the node origin. An upright cylinder is the default; a shaft
  that must lie along +Z is a node rotation, not a builder option.
  `extrudeGeometry` is the exception: its outline sits in XY and the depth
  runs along **Z**.
- **Front faces wind counter-clockwise** seen from outside. The shared grid
  stitcher emits every quad; winding tests recompute face normals from
  positions and check them against the authored vertex normals.
- **Angles are radians.** Segment counts are integers.
- **Uv is `u` around, `v` along.** `u` advances with the revolution or sweep
  and wraps at the duplicated seam column; `v` advances along the axis with
  `v = 0` at the −Y (or path-start) end. A texture painted for a cylinder is
  not upside-down on a capsule.
- **Normals are analytic** — from the surface parameterization, not averaged
  faces — so a cone tip and a capsule seam stay sharp.
- **`colors`, tangents, and joints/weights are not emitted.** Those are
  per-instance or per-authoring data.

Extents must be finite and positive; segment counts must be finite integers at
or above the minimum that can make a surface. Violations throw `RangeError`
(not `FourError` — see `buffer-geometry.ts`).

## The nine builders

| Function                                                                       | What it is                                      | Axis / parameter                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| `sphereGeometry({ radius, widthSegments, heightSegments })`                    | UV sphere                                       | meridians around +Y; parallels −Y to +Y                              |
| `cylinderGeometry({ radius, height, radialSegments, heightSegments, capped })` | tube about +Y                                   | `capped: false` omits both discs                                     |
| `coneGeometry({ radius, height, … })`                                          | tapered cylinder, tip at +Y                     | same options as the cylinder                                         |
| `capsuleGeometry({ radius, height, … })`                                       | cylinder plus hemispherical caps                | physics capsule collider uses the same radius/height about +Y        |
| `torusGeometry({ radius, tube, radialSegments, tubularSegments })`             | ring in the XZ plane                            | major radius in XZ; tube radius                                      |
| `latheGeometry({ points, segments })`                                          | profile in the (r, y) half-plane swept about +Y | `points[i].x` is radius (≥ 0); `x = 0` is a pole                     |
| `extrudeGeometry({ shape, depth, capped })`                                    | closed XY outline extruded along **Z**          | `shape` is `{ x, y }[]` (≥ 3); the solid spans `[-depth/2, depth/2]` |
| `tubeGeometry({ path, radius, tubularSegments, radialSegments })`              | circle swept along a 3D polyline                | `path` is `{ x, y, z }[]`                                            |
| `heightFieldGeometry({ columns, rows, width, depth, heights })`                | sampled Y height over XZ                        | `heights.length === rows * columns`; open grid, no seam              |

A first call that looks like a scene:

```ts
const pillar = new Mesh({
  geometry: cylinderGeometry({ radius: 0.25, height: 2 }),
  material: new LitMaterial({ color: [0.75, 0.75, 0.8] }),
});
pillar.position.set(1, 1, 0);

const ball = new Mesh({
  geometry: sphereGeometry({ radius: 0.4 }),
  material: new LitMaterial({ color: [0.9, 0.4, 0.3] }),
});
ball.position.set(-1, 0.4, 0);
```

`boxGeometry` and `planeGeometry` remain the other two of the eleven; they live
in the same module family (`primitives.ts`) and follow the same Y-up / CCW
rules. 2D helpers (`circleGeometry2D`, `polygonGeometry2D`) are fill/stroke
meshes, not these revolution builders.

## Physics is a sibling, not a result

`@fourjs/physics` ships sphere, capsule, cylinder, and height-field
**colliders**. Drawing a `capsuleGeometry` does not attach a collider; attaching
a capsule collider does not create a mesh. A mixed scene that wants both puts
a `Mesh` and a `Collider` on the same node (or a child), with matching radius
and height about +Y.

## What this guide does not cover

Path booleans, SVG import, tessellation of concave holes, and CPU skinning
each have their own module. The nine builders never self-intersect a ring and
never emit a second UV set. Instancing, morph streams, and LOD sit on `Mesh`,
not on these factories.
