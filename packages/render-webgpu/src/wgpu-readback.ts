/**
 * `readPixels`' mechanism: `copyTextureToBuffer` + `mapAsync` (WP-R1.6; §61,
 * §92, RFC 0005).
 *
 * This is the probe-verified path the R-1 plan names (§3.3.5), and it is the
 * evidence RFC 0005's asynchronous-forever commitment is right rather than
 * merely argued: WebGPU has **no synchronous readback at all** — a texture's
 * bytes reach the CPU only through a copy recorded on the queue and a map that
 * resolves when the GPU is done — so a `readPixels` that pretended to be
 * synchronous could not be implemented here honestly. §61's own sketch already
 * concedes the point (`readPixels?(…): Promise<ArrayBuffer>`), and
 * `WebgpuRenderer.readPixels` implements exactly that sketch. WP-R1.6 shipped
 * the whole-target form (shipping it rather than inventing a rectangle type
 * was the plan's explicit instruction); the `region` form arrived 2026-08-29
 * with `Rectangle2` in `@fourjs/math` (RFC 0005's named prerequisite, cleared).
 * A region copies only its own rectangle — `copyTextureToBuffer`'s `origin` —
 * and rides the very same alignment, strip, and flip machinery: a region's
 * rows are simply shorter, so the repack below never distinguishes the cases.
 * A whole-target call records exactly the calls it recorded before the region
 * form existed (no `origin` member at all), which is what keeps WP-R1.6's
 * transcripts byte-identical.
 *
 * ## The 256-byte row (§62's alignment, owned here)
 *
 * `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256
 * (WebGPU's `COPY_BYTES_PER_ROW_ALIGNMENT`), so a 100-texel-wide target's
 * 400-byte rows are copied 512 bytes apart and the buffer holds padding no
 * texel wrote. {@link readbackBytesPerRow} is that arithmetic, and the repack
 * below strips the padding while copying out of the mapped range — which has
 * to be copied regardless, because `unmap` detaches the `ArrayBuffer` the map
 * handed out.
 *
 * ## Row order: bottom-to-top, by decision
 *
 * §61's sketch says nothing about row order, so the first implementation gets
 * to fix it, and fixes it to **§7a's convention: row 0 of the result is the
 * bottom row of the image**, rows ascending upward. That is the order GL's
 * `readPixels` produces natively, so the byte layout is already the one the
 * WebGL backend will return when it lands the member — the cross-backend
 * agreement is decided here once instead of discovered as a flip later.
 * WebGPU's copy emits rows top-first (its framebuffer origin is top-left), so
 * the repack loop writes them in reverse; the flip rides the padding strip
 * this function performs anyway and costs no extra pass.
 */

import { FourError } from "@fourjs/core";
import type { Rectangle2 } from "@fourjs/math";

import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  type GpuDevice,
  type GpuTexture,
} from "./webgpu-device.js";

/**
 * WebGPU's `COPY_BYTES_PER_ROW_ALIGNMENT`: what `copyTextureToBuffer`'s
 * `bytesPerRow` must be a multiple of. A normative constant, written out for
 * the reason every `GPU_*` table in `webgpu-device.ts` is.
 */
export const READBACK_ROW_ALIGNMENT = 256;

/** Bytes per texel of the one colour format this tier reads back (rgba8). */
const BYTES_PER_TEXEL = 4;

/**
 * The aligned `bytesPerRow` for a `width`-texel row of rgba8 texels — the
 * smallest multiple of {@link READBACK_ROW_ALIGNMENT} that holds the row.
 */
export function readbackBytesPerRow(width: number): number {
  return (
    Math.ceil((width * BYTES_PER_TEXEL) / READBACK_ROW_ALIGNMENT) *
    READBACK_ROW_ALIGNMENT
  );
}

/**
 * Copies `texture`'s texels — or `region`'s rectangle of them — into a
 * tightly packed RGBA8 `ArrayBuffer`, rows bottom-to-top (module header):
 * `width * height * 4` bytes for the whole texture,
 * `region.width * region.height * 4` with a region.
 *
 * `region` is measured in texels from the texture's **bottom-left** corner
 * (§7a, the space the result's rows are defined in) and must already be
 * validated against `width` × `height` — `validateReadbackRegion` in
 * `@fourjs/render` is the shared §85 check, and `WebgpuRenderer.readPixels`
 * runs it before calling here. The conversion to WebGPU's top-first `origin`
 * happens in exactly one place, below.
 *
 * Resolves `null` when the device surface does not carry the readback entry
 * points (`copyTextureToBuffer`, `mapAsync` — optional members whose presence
 * is the capability); the caller turns that into `UNSUPPORTED_GPU_FEATURE`.
 * The staging buffer is created per call and destroyed before resolving: a
 * readback is a diagnostic-tier operation (§92's visual tier, RFC 0005's
 * fallback path), and pooling a buffer that is mapped across an `await` would
 * trade a transient allocation for a reentrancy hazard.
 */
export async function readTexturePixels(
  device: GpuDevice,
  texture: GpuTexture,
  width: number,
  height: number,
  region?: Rectangle2,
): Promise<ArrayBuffer | null> {
  const encoder = device.createCommandEncoder({ label: "fourJS:readback" });
  if (encoder.copyTextureToBuffer === undefined) {
    return null;
  }
  const readWidth = region === undefined ? width : region.width;
  const readHeight = region === undefined ? height : region.height;
  const bytesPerRow = readbackBytesPerRow(readWidth);
  const buffer = device.createBuffer({
    label: "fourJS:readback",
    size: bytesPerRow * readHeight,
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  });
  if (
    buffer.mapAsync === undefined ||
    buffer.getMappedRange === undefined ||
    buffer.unmap === undefined
  ) {
    buffer.destroy();
    return null;
  }

  encoder.copyTextureToBuffer(
    // §7a's bottom-origin `region.y` becomes WebGPU's top-first origin here,
    // and nowhere else. A whole-texture copy passes no `origin` at all, so
    // the call is byte-for-byte the one WP-R1.6's transcripts recorded.
    region === undefined
      ? { texture }
      : { texture, origin: [region.x, height - region.y - region.height] },
    { buffer, bytesPerRow, rowsPerImage: readHeight },
    [readWidth, readHeight],
  );
  device.queue.submit([encoder.finish()]);

  try {
    try {
      await buffer.mapAsync(GPU_MAP_MODE.READ);
    } catch (error) {
      // A device lost (or a buffer destroyed) while the map is in flight
      // rejects with the browser's own `DOMException`; the §61 contract is
      // one `FourError` code for that condition, with the original as `cause`.
      throw new FourError(
        "DEVICE_LOST",
        "readPixels: the device was lost (or the staging buffer destroyed) " +
          "while the read-back map was in flight (§61).",
        { cause: error },
      );
    }
    const mapped = new Uint8Array(buffer.getMappedRange());
    const rowBytes = readWidth * BYTES_PER_TEXEL;
    const packed = new Uint8Array(rowBytes * readHeight);
    for (let row = 0; row < readHeight; row += 1) {
      const source = row * bytesPerRow;
      // Top-first copy rows written bottom-first into the result — the §7a
      // order the module header fixes.
      packed.set(
        mapped.subarray(source, source + rowBytes),
        (readHeight - 1 - row) * rowBytes,
      );
    }
    buffer.unmap();
    return packed.buffer;
  } finally {
    buffer.destroy();
  }
}
