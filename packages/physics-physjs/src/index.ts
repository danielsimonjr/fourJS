/**
 * `@fourjs/physics-physjs` — the PhysJS solver adapters (RFC 0010, §37, §102).
 *
 * Skeleton (W9.1): capabilities and registration are real; every operation
 * throws `NOT_IMPLEMENTED` until W9.2-W9.4.
 */

export const PACKAGE_NAME = "@fourjs/physics-physjs";

export {
  PHYSJS_CAPABILITIES,
  PHYSJS_VERSION,
  PhysJSAdapter2D,
  PhysJSAdapter3D,
} from "./physjs-adapter.js";
export {
  createPhysJSAdapter,
  isPhysJSSupported,
  registerPhysJSSolver,
} from "./register.js";
