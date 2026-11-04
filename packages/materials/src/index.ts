export const PACKAGE_NAME = "@fourjs/materials";

// §81's materials / shader-node token (RFC 0002): declared here;
// `@fourjs/four`'s `plugins.ts` re-exports the same object.
export { SHADER_OPERATORS } from "./capabilities.js";
export type { ShaderOperatorFactory } from "./shader-operators.js";
export { ShaderOperatorRegistry } from "./shader-operators.js";

export type { LitMaterialOptions } from "./lit-material.js";
export { LitMaterial } from "./lit-material.js";
export type { BlendMode, MaterialOptions } from "./material.js";
export { Material } from "./material.js";
export type { NodeMaterialOptions } from "./node-material.js";
export { NodeMaterial } from "./node-material.js";
export type { ShaderOperand } from "./node-material-builder.js";
export {
  NodeMaterialBuilder,
  ShaderExpression,
  ShaderGraphBuilder,
  ShaderGraphOutput,
} from "./node-material-builder.js";
export type {
  ShaderAttributeName,
  ShaderBinaryOp,
  ShaderDomain,
  ShaderGraph,
  ShaderGraphAnalysis,
  ShaderNode,
  ShaderNodeId,
  ShaderLightArrayMember,
  ShaderLightMember,
  ShaderLightScalarMember,
  ShaderReflection,
  ShaderStorageElementType,
  ShaderStorageReflection,
  ShaderTextureReflection,
  ShaderUnaryOp,
  ShaderUniformReflection,
  ShaderValueType,
} from "./shader-graph.js";
export {
  MAX_SHADER_GRAPH_NODES,
  MAX_SHADER_GRAPH_DEFINES,
  MAX_SHADER_GRAPH_STORAGE,
  MAX_SHADER_GRAPH_TEXTURES,
  MAX_SHADER_STORAGE_COUNT,
  SHADER_ATTRIBUTE_TYPES,
  SHADER_LIGHT_ARRAY_TYPES,
  SHADER_LIGHT_SCALAR_TYPES,
  SHADER_LIGHT_SLOTS,
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  forEachShaderNodeReference,
  freezeShaderGraph,
  resolveShaderSelect,
  shaderDefineKey,
  specializeShaderGraph,
} from "./shader-graph.js";
export { ShaderStorageBuffer } from "./shader-storage.js";
export type {
  SpriteMaterialOptions,
  SpriteTexture,
} from "./sprite-material.js";
export { SpriteMaterial } from "./sprite-material.js";
export type {
  StencilFunc,
  StencilOp,
  StencilStateOptions,
} from "./stencil-state.js";
export { MAX_STENCIL_VALUE, StencilState } from "./stencil-state.js";
export type { ColorRGB, StandardMaterialOptions } from "./standard-material.js";
export { StandardMaterial } from "./standard-material.js";
export type {
  MaterialTexture,
  MaterialTextureFilter,
  MaterialTextureMinFilter,
  MaterialTextureWrap,
} from "./texture.js";
export type { ColorRGBA, UnlitMaterialOptions } from "./unlit-material.js";
export { UnlitMaterial } from "./unlit-material.js";
export { liveMaterialCount } from "./resource-memory.js";
export { ShaderFunction } from "./shader-function.js";
export type { ShaderFunctionDefinition } from "./shader-function.js";
export { ShaderVariantSet } from "./shader-variants.js";
export { createShaderSourceMap } from "./shader-source-map.js";
export type {
  ShaderSourceLocation,
  ShaderSourceMap,
} from "./shader-source-map.js";
