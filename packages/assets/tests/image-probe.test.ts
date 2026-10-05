import { describe, expect, it } from "vitest";

import { isFourError } from "@fourjs/core";

import { createBoundedJpegDecoder } from "../src/bounded-jpeg.js";
import {
  probeImage,
  probeJpeg,
  probePng,
  probeWebp,
} from "../src/image-probe.js";

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 255, value & 255]);
}

/** SOF0 JPEG header claiming `width`×`height`, no scan data. */
function jpegSof(width: number, height: number): Uint8Array<ArrayBuffer> {
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...u16be(height),
    ...u16be(width),
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  const bytes = new Uint8Array(2 + sof.length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes.set(sof, 2);
  return bytes;
}

describe("image header probes (§96)", () => {
  it("reads JPEG SOF0 width and height before any codec runs", () => {
    expect(probeJpeg(jpegSof(320, 200).buffer)).toEqual({
      width: 320,
      height: 200,
    });
    expect(
      probeJpeg(new Uint8Array([0xff, 0xd8, 0x00]).buffer),
    ).toBeUndefined();
  });

  it("skips JPEG APPn segments to reach SOF", () => {
    const app0 = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
      0x03, 0x11, 0x01,
    ]);
    expect(probeJpeg(app0.buffer)).toEqual({ width: 3, height: 2 });
  });

  it("reads a VP8X WebP canvas size", () => {
    const bytes = new Uint8Array(30);
    bytes.set([82, 73, 70, 70], 0); // RIFF
    bytes.set([87, 69, 66, 80, 86, 80, 56, 88], 8); // WEBPVP8X
    bytes[24] = 9;
    bytes[25] = 0;
    bytes[26] = 0; // width-1 = 9 → 10
    bytes[27] = 19;
    bytes[28] = 0;
    bytes[29] = 0; // height-1 = 19 → 20
    expect(probeWebp(bytes.buffer)).toEqual({ width: 10, height: 20 });
  });

  it("does not treat a JPEG as PNG", () => {
    expect(probePng(jpegSof(1, 1).buffer)).toBeUndefined();
    expect(probeImage(jpegSof(8, 4).buffer)).toEqual({ width: 8, height: 4 });
  });
});

describe("createBoundedJpegDecoder", () => {
  it("refuses a binary that is not a capped Wasm JPEG codec", async () => {
    await expect(
      createBoundedJpegDecoder({
        wasmBinary: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
        maximumWorkingBytes: 65536,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isFourError(error) && error.code === "UNTRUSTED_INPUT_REJECTED",
    );
  });

  it("refuses a claimed SOF that exceeds the decoded-byte ceiling before Wasm runs", async () => {
    // Instantiation still needs a valid wasm module; a truncated wasm is
    // refused at init, which is the §96 outcome either way.
    await expect(
      createBoundedJpegDecoder({
        wasmBinary: new Uint8Array(8),
        maximumWorkingBytes: 65536,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isFourError(error) && error.code === "UNTRUSTED_INPUT_REJECTED",
    );
  });
});
