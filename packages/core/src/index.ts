export const PACKAGE_NAME = "@fourjs/core";

export { DEFAULT_GRAVITY_Y } from "./conventions.js";
export type { JsonValue } from "./json.js";
export { cloneJsonValue } from "./json.js";
export { SeededRandom } from "./random.js";
export type {
  Component,
  ComponentHost,
  ComponentHostBinding,
  ComponentType,
} from "./component.js";
export { ComponentRegistry } from "./component.js";
export type { Disposable } from "./disposable.js";
export { disposeAll } from "./disposable.js";
// §83 FinalizationRegistry leak bookkeeping (A-4 remainder, 2026-09-06).
// Lives here so geometry / render / materials can register at construction
// without importing `@fourjs/diagnostics`. Production: every function is a no-op.
export {
  auditFinalizedLeaks,
  disposeTracked,
  reportFinalized,
  resetLeakRegistry,
  trackDisposable,
  trackedDisposableId,
} from "./leak-registry.js";
// §85 build mode (A-4, 2026-08-07). `DEV` is the flag every other package
// gates author-facing work behind; see `dev.ts` for the §33 rule that keeps it
// out of anything the simulation computes.
export {
  DEV,
  DEV_WARNING_PREFIX,
  devAssert,
  devWarn,
  devWarnOnce,
  resetDevWarnings,
} from "./dev.js";
export type { FourErrorCode, FourErrorOptions } from "./errors.js";
export { FourError, isFourError } from "./errors.js";
export type { EventListener, Unsubscribe } from "./events.js";
export { EventEmitter } from "./events.js";
// §81 plugin system (RFC 0002, A-3, 2026-08-28). `core` owns the machinery and
// names no registry: the capability tokens live in the packages that own what
// they hand over (each package's `capabilities.ts`; the `fourJS` umbrella's
// `plugins.ts` re-exports the same objects). See `plugin.ts` for the §96 posture
// — a plugin is a value the application installs, never a name from a document.
export type {
  DefineCapabilityOptions,
  FourPlugin,
  PluginCapability,
  PluginCapabilityBinding,
  PluginContext,
  PluginDependency,
} from "./plugin.js";
export {
  PLUGIN_API_VERSION,
  PluginHost,
  bindCapability,
  defineCapability,
  installPlugins,
  satisfiesPluginRange,
} from "./plugin.js";
// §8 space modes (PH-12, 2026-08-09). The vocabulary lives here because §8's
// two halves belong to two pillars that may not import each other; see
// `space.ts` for what declaring a mode does and does not do today.
export type { SpaceMode } from "./space.js";
export {
  DEFAULT_SPACE_MODE,
  SPACE_MODES,
  isSimulationSpaceMode,
} from "./space.js";
export type {
  AngleUnit,
  LengthUnit,
  MassUnit,
  TimeUnit,
  UnitQuantity,
  UnitScale,
  UnitSystem,
  UnitSystemInit,
} from "./units.js";
export {
  SI_UNITS,
  angleFromDisplay,
  angleToDisplay,
  formatAngle,
  formatLength,
  formatMass,
  formatTime,
  kilogramsToWorldMass,
  lengthFromDisplay,
  lengthToDisplay,
  massFromDisplay,
  massToDisplay,
  metersToWorldLength,
  resolveUnitSystem,
  timeFromDisplay,
  timeToDisplay,
  unitSymbol,
  worldLengthToMeters,
  worldMassToKilograms,
} from "./units.js";
export type { UntrustedJsonLimits } from "./untrusted.js";
export {
  DEFAULT_MAXIMUM_DEPTH,
  DEFAULT_MAXIMUM_TEXT_LENGTH,
  parseUntrustedJson,
} from "./untrusted.js";
