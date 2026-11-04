export const PACKAGE_NAME = "@fourjs/particles";

export type { ParticleEmitterOptions } from "./emitter.js";
export {
  DEFAULT_PARTICLE_LIFETIME_SECONDS,
  DEFAULT_PARTICLE_RESTITUTION,
  DEFAULT_PARTICLE_SEED,
  DEFAULT_PARTICLE_SIZE,
  PARTICLE_DRAWS_PER_SPAWN,
  ParticleEmitter,
} from "./emitter.js";
export { ParticlePool } from "./pool.js";
// --- WP-9.2: §27 force fields (begin) ---
export type {
  BoxFieldVolume,
  FieldVolume,
  RadialFieldOptions,
  SphereFieldVolume,
  TurbulenceFieldOptions,
  VortexFieldOptions,
} from "./fields.js";
export {
  DEFAULT_GRAVITY_Y,
  DEFAULT_RADIAL_MIN_DISTANCE,
  DEFAULT_TURBULENCE_AMPLITUDE,
  DEFAULT_TURBULENCE_FREQUENCY,
  DEFAULT_VORTEX_MIN_DISTANCE,
  TURBULENCE_DIFFERENCE_CELLS,
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
} from "./fields.js";
// --- WP-9.2: §27 force fields (end) ---
// --- WP-9.3: batched particle rendering (begin) ---
export type { ParticleRenderableOptions } from "./particle-renderable.js";
export {
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_ROTATION_OFFSET,
  PARTICLE_SOFTNESS_OFFSET,
  PARTICLE_TRAIL_VERTEX_FLOATS,
  PARTICLE_WIDE_INSTANCE_FLOATS,
  ParticleRenderable,
} from "./particle-renderable.js";
// --- WP-9.3: batched particle rendering (end) ---
// --- WP-9.4: §39 particle simulation system (begin) ---
export type {
  ParticleFixedUpdateContext,
  ParticleStepTime,
  ParticleSystemOptions,
  SteppableEmitter,
} from "./particle-system.js";
export { PRIORITY_PARTICLES, ParticleSystem } from "./particle-system.js";
// --- WP-9.4: §39 particle simulation system (end) ---
export { SeededRandom } from "./random.js";
export type { ParticleTrailOptions } from "./trail.js";
export {
  DEFAULT_TRAIL_LENGTH,
  DEFAULT_TRAIL_MIN_DISTANCE,
  DEFAULT_TRAIL_TAIL_WIDTH_FACTOR,
  DEFAULT_TRAIL_WIDTH,
  ParticleTrailStore,
  TRAIL_VERTEX_FLOATS,
  buildTrailRibbonMesh,
  resolveTrailOptions,
} from "./trail.js";
export type {
  ParticleBurst,
  ParticleCollisionMode,
  ParticleColor,
  ParticleForceField,
  ParticleGpuIntegrateExtras,
  ParticleGpuDragField,
  ParticleGpuField,
  ParticleGpuRadialField,
  ParticleGpuTurbulenceField,
  ParticleGpuUniformField,
  ParticleGpuVolume,
  ParticleGpuVortexField,
  ParticleGpuWindField,
  ParticleGpuSimulation,
  MutableParticleColor,
  ParticleLifetimeRamp,
  ParticleLifetimeStop,
  ParticleRange,
  ParticleSimulationMode,
  ParticleTexture,
} from "./types.js";
export {
  MAX_GPU_FIELDS,
  evaluateLifetimeRampColor,
  evaluateLifetimeRampColorInto,
  evaluateLifetimeRampNumber,
} from "./types.js";
