import { createBoundedPngDecoder, createTextureDecoder } from "@fourjs/assets";

declare global {
  interface Window {
    fourBoundedPng?: (
      wasm: number[],
      encoded: number[],
      working: number,
    ) => Promise<number[] | string>;
  }
}

window.fourBoundedPng = async (wasm, encoded, working) => {
  try {
    const decode = await createBoundedPngDecoder({
      wasmBinary: Uint8Array.from(wasm),
      maximumWorkingBytes: working,
    });
    const load = createTextureDecoder({ decode, maximumWorkingBytes: working });
    const texture = await load(Uint8Array.from(encoded).buffer, "test.png");
    const pixels = Array.from(texture.data);
    texture.dispose();
    return pixels;
  } catch (error) {
    return (error as { code: string }).code;
  }
};
document.body.dataset.boundedPngReady = "1";
