import { Quaternion, Vector3 } from "@fourjs/math";

import type { Box2dAdapter } from "../src/index.js";

/** §33's checksum, recomputed over `forEachBody` (ascending id). */
export function fnv(a: Box2dAdapter): number {
  let state = 0x811c9dc5;
  const absorb = (v: number): void => {
    const q = BigInt(Math.round(v * 1e6));
    const word = BigInt.asUintN(64, q);
    for (const w of [Number(word & 0xffffffffn), Number(word >> 32n)]) {
      for (let i = 0; i < 4; i += 1) {
        state ^= (w >>> (8 * i)) & 0xff;
        state = Math.imul(state, 0x01000193) >>> 0;
      }
    }
  };
  const p = new Vector3();
  const r = new Quaternion();
  const l = new Vector3();
  const w = new Vector3();
  a.forEachBody((h) => {
    a.getBodyTransform(h, p, r);
    a.getBodyVelocities(h, l, w);
    for (const v of [
      p.x,
      p.y,
      p.z,
      r.x,
      r.y,
      r.z,
      r.w,
      l.x,
      l.y,
      l.z,
      w.x,
      w.y,
      w.z,
    ]) {
      absorb(v);
    }
  });
  return state >>> 0;
}
