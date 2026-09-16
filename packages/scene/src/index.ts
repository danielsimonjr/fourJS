export const PACKAGE_NAME = "@fourjs/scene";

export type { AuthorityNode, TransformAuthority } from "./authority.js";
export {
  DEFAULT_TRANSFORM_AUTHORITY,
  TRANSFORM_AUTHORITIES,
  warnAuthorityConflict,
} from "./authority.js";
export type {
  OrthographicCameraOptions,
  PerspectiveCameraOptions,
} from "./camera.js";
export { Camera, OrthographicCamera, PerspectiveCamera } from "./camera.js";
export type {
  ScreenCameraOptions,
  ScreenOrigin,
  ScreenUnits,
  SurfaceSizedCamera,
} from "./screen-camera.js";
export {
  DEFAULT_SCREEN_FAR,
  DEFAULT_SCREEN_NEAR,
  DEFAULT_SCREEN_ORIGIN,
  DEFAULT_SCREEN_UNITS,
  SCREEN_ORIGINS,
  SCREEN_UNITS,
  ScreenCamera,
} from "./screen-camera.js";
export type { TrackballRigOptions } from "./trackball.js";
export { DEFAULT_TRACKBALL_RADIUS, TrackballRig } from "./trackball.js";
export { Group } from "./group.js";
export type {
  NodeSpaceOptions,
  NodeSpaceSerializerShape,
} from "./node-space.js";
export { NODE_SPACE_SERIALIZER, NodeSpace } from "./node-space.js";
export type { LayerMask, LayeredNode } from "./layers.js";
export {
  ALL_LAYERS,
  DEFAULT_LAYER,
  DEFAULT_LAYER_MASK,
  DEFAULT_LAYER_NAME,
  LAYER_COUNT,
  NO_LAYERS,
  applyLayers,
  assertLayerMask,
  defineLayer,
  isLayerMask,
  layerIndex,
  layerMask,
  layerMaskNames,
  layerName,
  layerNames,
  layersMatch,
  resetLayers,
} from "./layers.js";
export type {
  ColorRGB,
  DirectionalLightOptions,
  HemisphereLightOptions,
  LightColorInput,
  DirectionalLightShadowOptions,
  PunctualLightOptions,
  SpotLightOptions,
} from "./light.js";
export {
  DirectionalLight,
  DirectionalLightShadow,
  HemisphereLight,
  PointLight,
  PunctualLight,
  SpotLight,
} from "./light.js";
export type {
  PoseSnapshotSystem,
  SnapshotSystemOptions,
} from "./interpolation.js";
export {
  POSE_SNAPSHOT_PRIORITY,
  PoseBuffer,
  createSnapshotSystem,
} from "./interpolation.js";
export type {
  HitTestMode,
  NodeEventMap,
  NodeHierarchyEvent,
  NodeOptions,
  NodeType,
} from "./node.js";
export { Node, restoreNodeId } from "./node.js";
export { PoseTarget } from "./pose-target.js";
export type { MorphWeightsSerializerShape } from "./skeleton.js";
export {
  Bone,
  MORPH_WEIGHTS_SERIALIZER,
  MorphWeights,
  Skeleton,
} from "./skeleton.js";
export { Scene } from "./scene.js";
export { Transform } from "./transform.js";
export type { Viewport } from "./viewport.js";
export { createFullscreenViewport } from "./viewport.js";
export type { WorldTransformStats } from "./world-transforms.js";
export {
  resolveWorldTransform,
  resolveWorldTransforms,
} from "./world-transforms.js";
