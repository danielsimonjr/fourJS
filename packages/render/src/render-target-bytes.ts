/**
 * Per-texel byte accounting for {@link RenderTarget} attachments (§83, §84).
 *
 * The numbers are quoted from what the backends actually allocate — not guessed
 * from format names — so {@link RenderTarget.byteLength} moves with §67's
 * `DEPTH24_STENCIL8`, R-18's samplable depth, and the staged float colour
 * formats §62 widens {@link RenderTargetFormat} toward.
 *
 * `@fourjs/render-webgl`'s `gl-render-target.ts` is the reference for the depth
 * table: `DEPTH_COMPONENT16` (plain renderbuffer), `DEPTH_COMPONENT24`
 * (`depthTexture: true`), `DEPTH24_STENCIL8` (`stencil: true`). WebGPU's
 * `depth24plus` / `depth32float` / `depth24plus-stencil8` occupy the same
 * 32-bit texel slots for the samplable and stencilled forms; plain depth is
 * four bytes there and two on GL — a backend difference this module does not
 * try to unify, because §84's totals describe the descriptor the application
 * asked for, keyed on the GL allocation the first backend shipped.
 */

import type { RenderTargetFormat } from "./render-target.js";

/** Bytes per texel of an `"rgba8"` colour attachment. */
export const RENDER_TARGET_RGBA8_BYTES = 4;

/**
 * Bytes per texel of staged float colour formats — not yet members of
 * {@link RenderTargetFormat}, but wired here so widening the union updates
 * accounting in one place (§62, R-4).
 */
export const RENDER_TARGET_RGBA16F_BYTES = 8;

/** Bytes per texel of a staged `"rgba32f"` colour attachment. */
export const RENDER_TARGET_RGBA32F_BYTES = 16;

/**
 * Bytes per texel of a plain depth renderbuffer (`DEPTH_COMPONENT16` on GL;
 * `depth24plus` on WebGPU bills four — see the module header).
 */
export const RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES = 2;

/** Bytes per texel of a samplable depth texture (`DEPTH_COMPONENT24` / `depth32float`). */
export const RENDER_TARGET_DEPTH_TEXTURE_BYTES = 4;

/** Bytes per texel of a packed depth-stencil renderbuffer (`DEPTH24_STENCIL8`). */
export const RENDER_TARGET_DEPTH_STENCIL_BYTES = 4;

/** Maps each supported colour format to its per-texel byte cost. */
export const RENDER_TARGET_COLOR_BYTES: Readonly<
  Record<RenderTargetFormat, number>
> = {
  rgba8: RENDER_TARGET_RGBA8_BYTES,
  rgba32float: RENDER_TARGET_RGBA32F_BYTES,
};

/**
 * Per-texel byte cost of a render target's colour attachment.
 *
 * @param format — the target's {@link RenderTargetFormat}.
 */
export function colorAttachmentBytesPerTexel(
  format: RenderTargetFormat,
): number {
  return RENDER_TARGET_COLOR_BYTES[format];
}

/**
 * Per-texel byte cost of a render target's depth attachment, or `0` when
 * {@link RenderTargetOptions.depth} is off.
 *
 * The three option bits cannot conflict: the constructor refused
 * `{ stencil, depthTexture }` and `{ depth: false, … }` at §85 time.
 */
export function depthAttachmentBytesPerTexel(options: {
  readonly depth: boolean;
  readonly depthTexture: boolean;
  readonly stencil: boolean;
}): number {
  if (!options.depth) {
    return 0;
  }
  if (options.stencil) {
    return RENDER_TARGET_DEPTH_STENCIL_BYTES;
  }
  if (options.depthTexture) {
    return RENDER_TARGET_DEPTH_TEXTURE_BYTES;
  }
  return RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES;
}

/**
 * Total byte cost of a render target's attachments at a given size.
 *
 * Returns `0` when `disposed` — one rule with {@link Texture.byteLength}.
 */
export function renderTargetByteLength(
  width: number,
  height: number,
  format: RenderTargetFormat,
  depth: boolean,
  depthTexture: boolean,
  stencil: boolean,
  disposed: boolean,
): number {
  if (disposed) {
    return 0;
  }
  const colorBytes = colorAttachmentBytesPerTexel(format);
  const depthBytes = depthAttachmentBytesPerTexel({
    depth,
    depthTexture,
    stencil,
  });
  return width * height * (colorBytes + depthBytes);
}
