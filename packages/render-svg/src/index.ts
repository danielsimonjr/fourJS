export const PACKAGE_NAME = "@fourjs/render-svg";

export { isSvgSupported, registerSvgRenderer } from "./register.js";
export type {
  SvgElement,
  SvgElementFactory,
  SvgSurface,
} from "./svg-renderer.js";
export { SVG_NAMESPACE, SvgRenderer, isSvgSurface } from "./svg-renderer.js";
