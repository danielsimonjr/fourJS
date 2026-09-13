/**
 * §96 applied to the §34 replay envelope: a recording arrives from a bug
 * report, a CI artifact, or a stranger's disk, and `decodeReplayRecording` is
 * where the engine decides how much of it it is willing to look at.
 */

import { FourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  REPLAY_FORMAT_VERSION,
  decodeReplayRecording,
  encodeBase64,
  encodeReplayRecording,
  validateReplayRecording,
  type ReplayRecording,
} from "../src/replay-format.js";

/** A minimal valid recording, with `metadata` grafted on if supplied. */
function recording(metadata?: unknown): ReplayRecording {
  return validateReplayRecording({
    formatVersion: REPLAY_FORMAT_VERSION,
    adapterName: "rapier2d",
    adapterVersion: "0.1.0",
    fixedDeltaTime: 1 / 60,
    initialSnapshot: encodeBase64(new Uint8Array([1, 2, 3]).buffer),
    inputs: [],
    frames: [],
    finalChecksum: 2166136261,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

/** Raw text for a recording whose `metadata.deep` nests `levels` arrays deep. */
function hostileMetadataText(levels: number): string {
  const inner = `${"[".repeat(levels)}${"]".repeat(levels)}`;
  return JSON.stringify({
    formatVersion: 1,
    adapterName: "rapier2d",
    adapterVersion: "0.1.0",
    fixedDeltaTime: 1 / 60,
    initialSnapshot: "AQID",
    inputs: [],
    frames: [],
    finalChecksum: 2166136261,
    metadata: { deep: "PLACEHOLDER" },
  }).replace('"PLACEHOLDER"', inner);
}

describe("decodeReplayRecording treats its text as untrusted (§96)", () => {
  it("decodes an ordinary recording exactly as it did before the guard", () => {
    const text = encodeReplayRecording(recording({ run: "nightly" }));
    expect(decodeReplayRecording(text)).toEqual(recording({ run: "nightly" }));
    // Byte-identical round trip — what every determinism golden pins.
    expect(encodeReplayRecording(decodeReplayRecording(text))).toBe(text);
  });

  it("refuses text longer than maximumTextLength", () => {
    const text = encodeReplayRecording(recording());
    try {
      decodeReplayRecording(text, { maximumTextLength: 32 });
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(failure.message).toContain("Replay recording");
      expect(failure.context).toMatchObject({
        document: "Replay recording",
        limitName: "maximumTextLength",
        limit: 32,
        observed: text.length,
      });
    }
  });

  it("refuses metadata that nests deeper than maximumDepth", () => {
    const text = hostileMetadataText(8);
    expect(() => decodeReplayRecording(text, { maximumDepth: 6 })).toThrow(
      /nests deeper/,
    );
    expect(decodeReplayRecording(text, { maximumDepth: 64 })).toMatchObject({
      adapterName: "rapier2d",
    });
  });

  it("refuses the payload cloneJsonValue's recursion would die on", () => {
    const text = hostileMetadataText(50_000);
    // The parser copes. Until 2026-09-11 the recursive copy in
    // `validateReplayRecording` died with a `RangeError` (stack exhaustion);
    // `cloneJsonValue` now carries its own 1024-level ceiling (§96), so the
    // unguarded path refuses by name too — and `decodeReplayRecording` still
    // refuses *before* any recursion, which is the point of this file.
    expect(() => {
      JSON.parse(text);
    }).not.toThrow();
    expect(() => validateReplayRecording(JSON.parse(text))).toThrow(
      expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }) as Error,
    );
    try {
      decodeReplayRecording(text);
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(failure.context).toMatchObject({ limitName: "maximumDepth" });
    }
  });

  it("leaves validateReplayRecording unguarded — recorders hand it live values", () => {
    expect(validateReplayRecording(recording()).adapterName).toBe("rapier2d");
  });

  it("still reports a SyntaxError for text that is not JSON", () => {
    expect(() => decodeReplayRecording("{not json")).toThrow(SyntaxError);
  });
});
