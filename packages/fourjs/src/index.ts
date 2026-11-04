// The umbrella package (§98): one namespace per workspace package, plus the
// §45 composition root, which is the only API `four` owns rather than re-exports.
export * as core from "@fourjs/core";
export * as math from "@fourjs/math";
export * as scene from "@fourjs/scene";
export * as geometry from "@fourjs/geometry";
export * as materials from "@fourjs/materials";
export * as assets from "@fourjs/assets";
export * as motion from "@fourjs/motion";
export * as input from "@fourjs/input";
export * as serialization from "@fourjs/serialization";
export * as diagnostics from "@fourjs/diagnostics";
export * as particles from "@fourjs/particles";
export * as text from "@fourjs/text";
export * as render from "@fourjs/render";
export * as animation from "@fourjs/animation";
export * as physics from "@fourjs/physics";
export * as renderWebgpu from "@fourjs/render-webgpu";
export * as renderWebgl from "@fourjs/render-webgl";
export * as renderCanvas from "@fourjs/render-canvas";
export * as renderSvg from "@fourjs/render-svg";
export * as ui from "@fourjs/ui";
export * as physicsRapier from "@fourjs/physics-rapier";
export * as physicsBox2d from "@fourjs/physics-box2d";
export * as physicsSoft from "@fourjs/physics-soft";
export * as physicsPhysjs from "@fourjs/physics-physjs";

export type {
  ApplicationEventMap,
  ApplicationOptions,
  PhysicsWorldContext,
  PhysicsWorldFactory,
  SurfaceObserver,
  SurfaceResize,
} from "./application.js";
export { Application } from "./application.js";
export { readLiveResourceCounts } from "./live-resource-counts.js";

// §81's capability tokens (RFC 0002, A-3). Declared by their owning packages
// since 2026-08-29 (RFC 0002 §2's spelling) and re-exported here as the very
// same objects, so every import that predates the move keeps working —
// `plugins.ts` records the history and the identity argument.
export {
  ASSET_LOADERS,
  COMPONENT_SERIALIZERS,
  COMPUTE_WORKLOADS,
  EDITOR_TOOLS,
  RENDERER_REGISTRY,
  RENDER_GRAPH,
  SCENE_MIGRATIONS,
  SHADER_OPERATORS,
  SIMULATION_SYSTEMS,
  PATH_PLANNERS,
  SOLVER_REGISTRY,
  UI_CONTROLS,
} from "./plugins.js";
export type { EditorToolFactory } from "./plugins.js";
export { EditorToolRegistry } from "./plugins.js";

// §79 support for the engine's own node classes and components (A-14, PH-17,
// and the drawing tier — A-16, 2026-08-07). It lives here rather than in
// `@fourjs/serialization` for the reason that package's own header gives: the
// §3.1 matrix lets it see `core`/`math`/`scene` only, and the umbrella is the
// one place that may see `ui`, `render`, and `motion` too.
//
// Every `*_NODE_TYPE` the module writes is re-exported, so an application can
// name any type it may meet in a document (the six A-12 control names were
// missed when they shipped, 2026-08-07).
export type {
  SceneNodeTypeOptions,
  SceneNodeTypeSupport,
  SceneResourceCatalog,
  SceneSerializationSupport,
  UnknownResourcePolicy,
} from "./scene-serializers.js";
export {
  BUTTON_NODE_TYPE,
  CHECKBOX_NODE_TYPE,
  CIRCLE_NODE_TYPE,
  DIRECTIONAL_LIGHT_NODE_TYPE,
  HEMISPHERE_LIGHT_NODE_TYPE,
  ELLIPSE_NODE_TYPE,
  IMAGE_NODE_TYPE,
  LABEL_NODE_TYPE,
  ORTHOGRAPHIC_CAMERA_NODE_TYPE,
  PANEL_NODE_TYPE,
  PATH_SHAPE_NODE_TYPE,
  PERSPECTIVE_CAMERA_NODE_TYPE,
  POINT_LIGHT_NODE_TYPE,
  POLYGON_NODE_TYPE,
  PROGRESS_NODE_TYPE,
  RADIO_BUTTON_NODE_TYPE,
  RECTANGLE_NODE_TYPE,
  REGULAR_POLYGON_NODE_TYPE,
  RENDERABLE_NODE_TYPE,
  RING_NODE_TYPE,
  SECTOR_NODE_TYPE,
  SLIDER_NODE_TYPE,
  SPOT_LIGHT_NODE_TYPE,
  SPRITE_NODE_TYPE,
  STAR_NODE_TYPE,
  TEXT_NODE_TYPE,
  TOGGLE_NODE_TYPE,
  composeSceneNodeTypes,
  registerPhysicsSerializers,
  registerRenderSerializers,
  registerSceneNodeTypes,
  registerShapeSerializers,
  registerTextSerializers,
  registerUISerializers,
  resourceCatalog,
  restoreNodeId,
} from "./scene-serializers.js";

// §49/§56's `Text` node (R-28, 2026-08-13) — the second API this package owns
// rather than re-exports, and `text-node.ts` records why the frozen §3.1 matrix
// leaves the umbrella as its only legal home.
export type { TextOptions } from "./text-node.js";
export { Text } from "./text-node.js";

// §82's `Four.ComputePass` (the Q3 promotion, 2026-08-29) — the named-map
// sugar over `@fourjs/render`'s ordered `ComputePassDescriptor`, in the
// umbrella because the spec's example spells it `Four.*` and the recorded
// WP-R1.8 decision assigns the named-map spelling here. Tree-shakes when
// unused; owns no device resource.
export type {
  ComputePassBindingEntry,
  ComputePassBindings,
  ComputePassOptions,
} from "./compute-pass.js";
export { ComputePass } from "./compute-pass.js";

// §78's glTF assembly (A-19, 2026-08-29): `@fourjs/assets` parses a glTF file
// into plain data (its §3.1 row is `core` alone), and the umbrella — the one
// package that sees geometry, materials, render, scene, and animation at
// once — assembles it into live nodes. `gltf.ts` records the argument and
// §78's sharing rule. Never referenced by `Application`; tree-shakes when
// unused.
export type { GltfInstance } from "./gltf.js";
export { instantiateGltf } from "./gltf.js";

// §71's picking adapter (RFC 0005): a render-side `PickingService` presented
// as `@fourjs/input`'s render-free `PickProvider` seam. It lives here because
// the umbrella is the one layer that may name both sides — `pick-provider.ts`
// records the argument. Never referenced by `Application`; tree-shakes when
// unused.
export { createPickProvider } from "./pick-provider.js";

// A-16's remaining half: a §79 manifest is asynchronous (verified bytes),
// while `SceneResourceCatalog.get` is synchronous (deserialization is).
// `preloadManifestIntoCatalog` is the preload-then-catalog walk so callers
// do not write it by hand. `manifest-catalog.ts` records the argument.
// Never referenced by `Application`; tree-shakes when unused.
export type { PreloadManifestIntoCatalogOptions } from "./manifest-catalog.js";
export { preloadManifestIntoCatalog } from "./manifest-catalog.js";
