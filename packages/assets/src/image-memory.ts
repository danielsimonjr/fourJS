import { FourError } from "@fourjs/core";

// Only decoder implementations that establish the runtime's memory ceiling
// register here. A public property on a host callback is not proof of a cap.
const boundedDecoders = new WeakMap<object, number>();

function validateWorkingBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 65_536 || value > 4_294_967_296) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      "maximumWorkingBytes must be a safe integer from 64 KiB through 4 GiB.",
      { context: { limitName: "maximumWorkingBytes", found: value } },
    );
  }
}

/** Internal capability registration; never exported by the assets entrypoint. */
export function registerBoundedImageDecoder<T extends object>(
  decode: T,
  maximumWorkingBytes: number,
): T {
  validateWorkingBytes(maximumWorkingBytes);
  const previous = boundedDecoders.get(decode);
  if (previous !== undefined && previous !== maximumWorkingBytes) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      "A decoder's established memory ceiling cannot be changed.",
    );
  }
  boundedDecoders.set(decode, maximumWorkingBytes);
  return decode;
}

/** Refuse an unsupported hard limit before calling the decoder or fetching. */
export function assertImageDecoderMemory(
  decode: object | undefined,
  requested: number | undefined,
  context: Readonly<Record<string, unknown>> = {},
): void {
  if (requested === undefined) return;
  validateWorkingBytes(requested);
  // A texture-free glTF needs no image decoder. Its configured limit still
  // receives validation; a later image cannot load without a decoder.
  if (decode === undefined) return;
  const established = boundedDecoders.get(decode);
  if (established === undefined || established > requested) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      established === undefined
        ? "This image decoder has no enforceable working-memory limit. Use a bounded decoder directly; native platform callbacks and wrappers cannot satisfy maximumWorkingBytes."
        : "The image decoder's memory ceiling exceeds maximumWorkingBytes. Configure a decoder with a smaller ceiling.",
      {
        context: {
          ...context,
          limitName: "maximumWorkingBytes",
          requested,
          established,
        },
      },
    );
  }
}
