export const PACKAGE_NAME = "@fourjs/physics-box2d";

export {
  Box2dAdapter,
  BOX2D_CAPABILITIES,
  BOX2D_CORE_VERSION,
} from "./box2d-adapter.js";
export {
  createBox2dAdapter,
  isBox2dSupported,
  registerBox2dSolver,
} from "./register.js";
