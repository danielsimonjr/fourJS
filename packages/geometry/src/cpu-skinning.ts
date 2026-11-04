import { BufferGeometry } from "./buffer-geometry.js";

/**
 * Reusable CPU linear-blend skinning (§54, RFC 0003).
 *
 * Update with `Skeleton.jointMatrices` after updating the skeleton. The output
 * is independent geometry suitable for bounds, picking, and CPU renderers; it
 * has no joint attributes, preventing a second deformation by GPU skinning.
 * Source vertices remain in bind pose. Changes to source topology require a
 * new instance. Other attributes are copied once at construction.
 *
 * Determinism is **same-runtime**: vertices, influences and matrix elements
 * are accumulated in ascending index order using JavaScript arithmetic, then
 * rounded to Float32 on output. This is not a GPU readback and does not modify
 * simulation transforms. Weights are used as authored, never normalized.
 *
 * **Skip when unchanged:** a copy of the last palette and the source geometry
 * `version` are kept; an `update` with an identical palette (element-wise,
 * early exit) and unchanged source version returns the output untouched, so
 * its version is not bumped and renderers skip re-upload. Bind matrices are
 * folded into the palette (`Skeleton.jointMatrices`), so a bind change shows
 * up as a palette difference. Edits to the source must `markDirty()` to be seen.
 */
export class CpuSkinning {
  readonly geometry: BufferGeometry;

  readonly #source: BufferGeometry;

  readonly #matrix = new Float64Array(16);

  #lastPalette: Float32Array | null = null;

  #lastSourceVersion = -1;

  constructor(source: BufferGeometry) {
    if (source.joints === undefined || source.weights === undefined) {
      throw new TypeError("CPU skinning requires joints and weights.");
    }
    this.#source = source;
    this.geometry = source.clone();
    this.geometry.joints = undefined;
    this.geometry.weights = undefined;
  }

  /** Deforms in place without allocating; returns the same output geometry. */
  update(palette: Float32Array): BufferGeometry {
    const source = this.#source;
    const output = this.geometry;
    const joints = source.joints;
    const weights = source.weights;
    const normals = source.normals;
    const outNormals = output.normals;
    if (
      source.disposed ||
      output.disposed ||
      source.positions.length !== output.positions.length ||
      (normals === undefined) !== (outNormals === undefined) ||
      joints === undefined ||
      weights === undefined ||
      palette.length === 0 ||
      palette.length % 16 !== 0
    ) {
      throw new TypeError("CPU skinning topology or palette is invalid.");
    }
    // Validate before writing so a bad input cannot leave a partially updated mesh.
    for (let i = 0; i < palette.length; i += 1) {
      if (!Number.isFinite(palette[i])) {
        throw new TypeError("CPU skinning palette must be finite.");
      }
    }
    for (let i = 0; i < joints.length; i += 1) {
      if (joints[i] >= palette.length / 16 || !Number.isFinite(weights[i])) {
        throw new TypeError(
          "CPU skinning influence is outside the palette or nonfinite.",
        );
      }
    }
    const last = this.#lastPalette;
    if (
      last !== null &&
      last.length === palette.length &&
      this.#lastSourceVersion === source.version
    ) {
      let same = true;
      for (let i = 0; i < palette.length; i += 1) {
        if (last[i] !== palette[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return output;
      }
    }
    const m = this.#matrix;
    for (let vertex = 0; vertex < source.vertexCount; vertex += 1) {
      m.fill(0);
      for (let influence = 0; influence < 4; influence += 1) {
        const index = vertex * 4 + influence;
        const offset = joints[index] * 16;
        const weight = weights[index];
        for (let element = 0; element < 16; element += 1) {
          m[element] = m[element] + palette[offset + element] * weight;
        }
      }
      const p = vertex * 3;
      const x = source.positions[p];
      const y = source.positions[p + 1];
      const z = source.positions[p + 2];
      output.positions[p] = m[0] * x + m[4] * y + m[8] * z + m[12];
      output.positions[p + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      output.positions[p + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (normals !== undefined && outNormals !== undefined) {
        // Cofactor matrix / determinant is the inverse transpose. A singular
        // blend has no normal transform: use zero instead of propagating NaN.
        const a = m[0],
          b = m[4],
          c = m[8];
        const d = m[1],
          e = m[5],
          f = m[9];
        const g = m[2],
          h = m[6],
          i = m[10];
        const determinant =
          a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        const inverse = determinant === 0 ? 0 : 1 / determinant;
        const nx = normals[p],
          ny = normals[p + 1],
          nz = normals[p + 2];
        const tx =
          ((e * i - f * h) * nx + (f * g - d * i) * ny + (d * h - e * g) * nz) *
          inverse;
        const ty =
          ((c * h - b * i) * nx + (a * i - c * g) * ny + (b * g - a * h) * nz) *
          inverse;
        const tz =
          ((b * f - c * e) * nx + (c * d - a * f) * ny + (a * e - b * d) * nz) *
          inverse;
        const length = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const scale = length === 0 ? 0 : 1 / length;
        outNormals[p] = tx * scale;
        outNormals[p + 1] = ty * scale;
        outNormals[p + 2] = tz * scale;
      }
    }
    if (last === null || last.length !== palette.length) {
      this.#lastPalette = new Float32Array(palette.length);
    }
    (this.#lastPalette as Float32Array).set(palette);
    this.#lastSourceVersion = source.version;
    output.markDirty();
    return output;
  }

  /** Releases the owned output; the caller retains ownership of the source. */
  dispose(): void {
    this.geometry.dispose();
  }
}
