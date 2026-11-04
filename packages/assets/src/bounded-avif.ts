/**
 * Bounded AVIF → RGBA8 decoder (§96). Mirrors {@link createBoundedJpegDecoder}:
 * application-supplied wasm bytes, heap cap pinned before any codec code runs,
 * header preflight (`probeAvif`) before init-time allocation, finite
 * output/expansion limits, and fail-closed poisoning after a codec trap.
 *
 * Lineage: libavif, the codec behind `@jsquash/avif` — referenced WITHOUT a package
 * dependency and without a version pin, because no published package ships this ABI. jSquash ships Emscripten/embind glue, which
 * cannot be bounded host-side, so the application pins a build of the same
 * codec compiled to the glue-free raw ABI documented in
 * `bounded-raw-codec.ts`. Supply trusted bytes, never an asset-selected module.
 */
import {
  createBoundedRawDecoder,
  type BoundedRawCodecOptions,
} from "./bounded-raw-codec.js";
import { probeAvif } from "./image-probe.js";
import type { TexelDecodeLike } from "./texture.js";

export { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";

/** Options for the isolated, runtime-capped AVIF codec (§96). */
export type BoundedAvifDecoderOptions = BoundedRawCodecOptions;

/** Creates a AVIF → RGBA8 decoder with the same contract as the PNG/JPEG ones. */
export function createBoundedAvifDecoder(
  options: BoundedAvifDecoderOptions,
): Promise<TexelDecodeLike> {
  return createBoundedRawDecoder(
    {
      label: "AVIF",
      loader: "bounded-avif",
      pin: "libavif built to the raw ABI",
      probe: probeAvif,
    },
    options,
  );
}
