export const PACKAGE_NAME = "@fourjs/geometry";

export type {
  BufferGeometryOptions,
  GeometryBounds,
  GeometryDrawMode,
  GeometryIndexArray,
  MorphTargetStreams,
} from "./buffer-geometry.js";
export { BufferGeometry, MAX_MORPH_TARGETS } from "./buffer-geometry.js";
// --- R-21: §53 geometry base + bounding volume (begin) ---
export type { BoundingVolume } from "./geometry.js";
export { Geometry } from "./geometry.js";
// --- R-21: §53 geometry base + bounding volume (end) ---
export type {
  CapsuleGeometryOptions,
  ExtrudeGeometryOptions,
  HeightFieldGeometryOptions,
  LatheGeometryOptions,
  Point3D,
  SphereGeometryOptions,
  TaperedGeometryOptions,
  TorusGeometryOptions,
  TubeGeometryOptions,
} from "./primitives-3d.js";
export {
  capsuleGeometry,
  coneGeometry,
  cylinderGeometry,
  extrudeGeometry,
  heightFieldGeometry,
  latheGeometry,
  sphereGeometry,
  torusGeometry,
  tubeGeometry,
} from "./primitives-3d.js";
export type {
  BooleanOp,
  FillRule,
  PathArcCommand,
  PathClosestPoint,
  PathCloseCommand,
  PathCommand,
  PathCubicCommand,
  PathFillRings,
  PathLineCommand,
  PathMoveCommand,
  PathOptions,
  PathQuadraticCommand,
  PathSegmentCommand,
} from "./path.js";
export {
  DEFAULT_FLATTEN_TOLERANCE,
  MAX_SUBDIVISION_DEPTH,
  Path,
  booleanOp,
} from "./path.js";
export type {
  SvgDocument,
  SvgDocumentParseOptions,
  SvgDocumentPath,
  SvgViewBox,
} from "./svg-document.js";
export {
  DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH,
  parseSvgDocument,
} from "./svg-document.js";
export type { SvgPathFormatOptions, SvgPathParseOptions } from "./svg-path.js";
export {
  DEFAULT_MAXIMUM_PATH_DATA_LENGTH,
  formatSvgPathData,
  parseSvgPathData,
} from "./svg-path.js";
export type {
  BoxGeometryOptions,
  CircleGeometry2DOptions,
  PlaneGeometryOptions,
  PolygonGeometry2DOptions,
} from "./primitives.js";
export {
  boxGeometry,
  circleGeometry2D,
  planeGeometry,
  polygonGeometry2D,
} from "./primitives.js";
export { geometryMemoryBytes, liveGeometryCount } from "./resource-memory.js";
export type {
  Point2D,
  PolygonTessellator,
  Polyline2D,
  StrokeAlignment,
  StrokeGeometryOptions,
  StrokeLineCap,
  StrokeLineJoin,
  StrokeMesh,
} from "./tessellation.js";
export {
  DEFAULT_MITER_LIMIT,
  earClippingTessellator,
  expandStroke,
  triangulatePolygon,
} from "./tessellation.js";

export { CpuSkinning } from "./cpu-skinning.js";
