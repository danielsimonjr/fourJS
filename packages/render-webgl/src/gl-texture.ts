/**
 * GPU-side textures for the WebGL 2 backend: one `WebGLTexture` per
 * `@fourjs/render` `Texture`, cached and invalidated by version (§77, §61, §55).
 *
 * The twin of `gl-geometry.ts`, and deliberately so — same key (`id`), same
 * validator (`version`), same lazy eviction, same loss-aware
 * {@link TextureCache.forget}. Reading one module tells you how the other
 * behaves, and both back the same claim: **GPU residency is a backend cache, not
 * an application concern.**
 *
 * ## Why there is no `Renderer.createTexture` (decision, WP-3a.3)
 *
 * §61's interface declares `createTexture(source: TextureSource): Texture`, and
 * `@fourjs/render`'s `renderer.ts` records it as a typed TODO. This packet leaves
 * it deferred and discovers textures from the render list instead: every sprite
 * item carries a `SpriteMaterial`, every sprite material names a texture, and
 * this cache uploads it the first time it is drawn.
 *
 * The alternative — a renderer-owned texture — would mean an application cannot
 * build a texture before it has a renderer, must build one per renderer, and
 * must re-create all of them by hand after a §61 context loss. None of that is
 * true of geometry today, and the geometry cache is the proof that it need not
 * be true of textures either. `createTexture` remains the right entry point for
 * the tier that has no CPU-side source to discover — render targets (§63),
 * compressed and GPU-only formats — and it lands with that tier. The deferral is
 * documented in `@fourjs/render`'s `texture.ts` as well, on the class it concerns.
 *
 * ## What one entry holds
 *
 * A texture object and the version it was uploaded from. Sampler state — filter
 * and wrap — is set on the texture object at upload time and never changed, so
 * the per-draw cost in `webgl-renderer.ts` is one `bindTexture` and nothing
 * else. Mipmaps and anisotropy (R-30b, below) are more of the same state, set
 * in the same place, read by nothing on the draw path.
 *
 * ## Filter and wrap became the texture's own (R-30, 2026-08-13)
 *
 * This module fixed the pair at **`LINEAR` + `CLAMP_TO_EDGE`** until
 * 2026-08-13, and the note that stood here called that "the only combination
 * that is correct for a sprite or a glyph atlas". It is the right *default* and
 * it is not the only correct choice: a bitmap glyph atlas drawn at or above 1:1
 * wants `NEAREST`, because a 5 × 7 letterform blurred across its neighbours is
 * exactly the soft, dirty look bitmap text is accused of, and a tiling ground
 * texture wants `REPEAT`. So the four `texParameteri` arguments are now read off
 * `texture.filter` / `texture.wrap` (§77, `@fourjs/render`'s `Texture`).
 *
 * **Byte-identity is structural, not numerical**: both fields resolve to the
 * previously hard-coded value when a source names neither, so a texture written
 * against any earlier build issues the same four calls with the same four
 * arguments in the same order. Nothing was added to the draw path — sampler
 * state is upload-time state, and the upload path is the one that grew two
 * table lookups.
 *
 * Because the state is written **at upload**, changing `filter` or `wrap` on a
 * texture already resident needs a version bump (`markDirty()`, or a new
 * `source`); the eviction rule below then re-uploads it with the new sampler
 * state, which is the same path an in-place texel edit takes.
 *
 * ## Mipmaps and anisotropy (R-30b, 2026-08-21)
 *
 * Three more upload-time decisions, and the same byte-identity claim, made
 * structurally rather than numerically:
 *
 * - `texture.mipmaps` adds **one** `generateMipmap` between the `texImage2D`
 *   and the sampler state — nothing for a texture that does not ask;
 * - the min filter is now `texture.minFilter` (which resolves to `filter` with
 *   no chain, so the two `texParameteri` calls stay the pair they were) while
 *   the mag filter is `texture.filter`, because magnification has no mip levels
 *   to choose between;
 * - `texture.anisotropy` above 1 adds **one** `texParameteri` after the wrap
 *   pair, and only after the device's ceiling has been resolved once
 *   ({@link TextureCache}'s private `#resolveAnisotropy`).
 *
 * So a texture naming none of the three issues the identical five calls in the
 * identical order it did on 2026-08-13, and a context that cannot generate
 * mipmaps at all degrades to a one-level upload with an in-level min filter
 * instead of leaving GL a texture it would sample as black.
 *
 * ## Eviction policy
 *
 * Identical to `GeometryCache`'s, for the identical reasons — see that module's
 * header for the full argument:
 *
 * - a **version bump** (an in-place texel edit plus `markDirty()`, or a new
 *   `source`) is detected on the next `acquire`, which deletes the stale texture
 *   and uploads a fresh one for a full update. A retained regional history
 *   with unchanged storage/sampler metadata instead uses texSubImage2D and
 *   refreshes the mip chain without replacing the allocation;
 * - **`texture.dispose()`** bumps the version and marks the texture disposed, so
 *   the next `acquire` deletes the GL object and returns `null` — the sprite is
 *   then skipped rather than drawn with undefined content (§83's "disposed
 *   resources still in use"). A texture disposed and never submitted again keeps
 *   its GL object until the renderer is disposed: the same documented leak
 *   window, with the same alternatives rejected for the same reasons;
 * - **context loss** is not eviction: {@link TextureCache.forget} drops the
 *   records without calling `deleteTexture`, because every handle is already
 *   invalid and the context must not be touched (§61).
 */

import { FourError } from "@fourjs/core";
import type { SpriteRenderItem } from "@fourjs/render";
import { warnDisposedInUse } from "@fourjs/render";

import { GL, type GlTexture, type WebglContext } from "./gl-program.js";

/**
 * The texture type this cache stores, taken from `@fourjs/render`'s sprite render
 * item rather than imported by name.
 *
 * `@fourjs/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen), so `@fourjs/render`'s `Texture` *could* be imported directly.
 * Deriving it from `SpriteRenderItem["material"]["texture"]` instead is the
 * choice `CacheableGeometry` already makes in `gl-geometry.ts`: it types the
 * cache against **what the render list actually hands it**, which is
 * `@fourjs/materials`' `SpriteTexture` read contract — so this module keeps
 * working unchanged if a second texture implementation ever satisfies that
 * contract, and it cannot accidentally reach for state a render item does not
 * carry.
 */
export type CacheableTexture = SpriteRenderItem["material"]["texture"];

/**
 * `texture.filter` (§77, R-30) as a GL enum.
 *
 * A function of one comparison rather than a `Record` lookup, for the reason
 * §33 gives everywhere in this backend: no object-key iteration, no `Map`, and
 * an unknown value cannot reach here — `Texture` refuses one (§85) — so the
 * fallback arm is the *default*, which is the value this tier hard-coded before
 * the field existed.
 */
function glFilter(filter: string | undefined): number {
  return filter === "nearest" ? GL.NEAREST : GL.LINEAR;
}

/** `texture.wrap` (§77, R-30) as a GL enum; see {@link glFilter}. */
function glWrap(wrap: string | undefined): number {
  if (wrap === "repeat") return GL.REPEAT;
  if (wrap === "mirrored-repeat") return GL.MIRRORED_REPEAT;
  return GL.CLAMP_TO_EDGE;
}

/**
 * `texture.minFilter` (§77, R-30b) as a GL enum, given whether this upload
 * actually built a mip chain.
 *
 * `hasMipmaps` is not a formality: `Texture` refuses a mip-choosing minFilter
 * without `mipmaps: true` (§85), but a *context* can still be one that cannot
 * generate a chain (`generateMipmap` is optional on `WebglContext`), and
 * writing `LINEAR_MIPMAP_LINEAR` on a one-level texture leaves it **incomplete
 * — sampled as opaque black**. So the mip-choosing values collapse to their
 * in-level halves exactly when no chain exists, which degrades the *quality* of
 * a frame that would otherwise have failed outright.
 *
 * The fallback arm is `LINEAR`, this tier's pre-R-30 default, so a texture that
 * names no minFilter and no mipmaps reaches the identical enum it always did.
 */
function glMinFilter(
  minFilter: string | undefined,
  filter: string | undefined,
  hasMipmaps: boolean,
): number {
  if (minFilter === undefined) {
    // A texture — or a test double — that names no minFilter samples both
    // directions with `filter`, which is what R-30's single field meant and
    // what this module wrote before this function existed.
    return hasMipmaps
      ? glMinFilter(
          filter === "nearest"
            ? "nearest-mipmap-nearest"
            : "linear-mipmap-linear",
          filter,
          true,
        )
      : glFilter(filter);
  }
  if (!hasMipmaps) {
    return minFilter.startsWith("nearest") ? GL.NEAREST : GL.LINEAR;
  }
  if (minFilter === "nearest") return GL.NEAREST;
  if (minFilter === "nearest-mipmap-nearest") return GL.NEAREST_MIPMAP_NEAREST;
  if (minFilter === "linear-mipmap-nearest") return GL.LINEAR_MIPMAP_NEAREST;
  if (minFilter === "nearest-mipmap-linear") return GL.NEAREST_MIPMAP_LINEAR;
  if (minFilter === "linear-mipmap-linear") return GL.LINEAR_MIPMAP_LINEAR;
  return GL.LINEAR;
}

/** Everything one cached texture needs at draw time. */
export interface TextureRecord {
  /** The GL texture object to bind. */
  readonly texture: GlTexture;

  /** `Texture.version` this record was uploaded from. */
  readonly version: number;

  /** The GL bind target: `TEXTURE_2D`, `TEXTURE_CUBE_MAP`, `TEXTURE_2D_ARRAY` or `TEXTURE_3D`. */
  readonly target: number;
}

/** The GL bind target for a texture's §77 dimension. */
function glTarget(dimension: string | undefined): number {
  if (dimension === "cube") return GL.TEXTURE_CUBE_MAP;
  if (dimension === "array") return GL.TEXTURE_2D_ARRAY;
  if (dimension === "3d") return GL.TEXTURE_3D;
  return GL.TEXTURE_2D;
}

/**
 * Per-context store of uploaded textures (§77, §61).
 *
 * One cache belongs to one GL context: the renderer builds it during
 * `initialize` and builds a *new* one on context restore, since every handle the
 * old one held died with the context.
 *
 * ```ts
 * const cache = new TextureCache(gl);
 * const record = cache.acquire(item.material.texture);
 * if (record !== null) {
 *   gl.bindTexture(GL.TEXTURE_2D, record.texture);
 *   // draw…
 * }
 * ```
 */
export class TextureCache {
  readonly #gl: WebglContext;

  /** Records by `Texture.id`; see the module header for eviction. */
  readonly #records = new Map<string, TextureRecord>();

  #disposed = false;

  readonly #states = new WeakMap<TextureRecord, string>();

  /**
   * The device's anisotropy ceiling (§62, §77; R-30b), or `0` while it has
   * never been asked for.
   *
   * `0` is the "not yet queried" state rather than a separate boolean: every
   * legal ceiling is ≥ 1, so one number carries both facts and the query runs
   * at most once per cache. A device without
   * `EXT_texture_filter_anisotropic` resolves to `1`, which is GL's isotropic
   * default and therefore writes nothing at all.
   */
  #maxAnisotropy = 0;

  #generation = 0;
  readonly #pending = new WeakMap<TextureRecord, number>();

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  /** Number of textures currently uploaded. Diagnostics and tests (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link TextureCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the GL texture for `texture`, uploading it on first use and
   * re-uploading it whenever `texture.version` has advanced.
   *
   * Returns `null` — and creates no entry — when the texture has been disposed
   * or when GL refuses to allocate an object. **Never throws**: this runs inside
   * `Renderer.render`, and §61 forbids throwing there for a lost context; a
   * failed allocation is the same class of asynchronous, driver-scheduled event,
   * so it skips the object rather than unwinding the frame.
   */
  acquire(texture: CacheableTexture): TextureRecord | null {
    return this.#acquire(texture, false);
  }

  /**
   * Like {@link TextureCache.acquire}, but also uploads `"cube"`, `"array"`
   * and `"3d"` textures (§77, R-30c); the record's `target` says what to bind.
   * `acquire` stays 2D-only because its callers bind `TEXTURE_2D` and a cube
   * bound there would be a GL error. Returns `null` when the context lacks
   * `texImage3D` for an array or volume.
   */
  acquireResource(texture: CacheableTexture): TextureRecord | null {
    return this.#acquire(texture, true);
  }

  #acquire(texture: CacheableTexture, any: boolean): TextureRecord | null {
    if (this.#disposed) return null;
    if (!any && glTarget(texture.dimension) !== GL.TEXTURE_2D) return null;
    const existing = this.#records.get(texture.id);
    if (existing !== undefined) {
      if (existing.version === texture.version) {
        return existing;
      }
      const region = texture.getDirtyRegion?.(existing.version);
      if (
        !texture.disposed &&
        texture.data !== null &&
        region != null &&
        this.#gl.texSubImage2D !== undefined &&
        this.#states.get(existing) === textureState(texture)
      ) {
        const gl = this.#gl;
        const pixels = new Uint8Array(region.width * region.height * 4);
        for (let row = 0; row < region.height; row += 1) {
          const start = ((region.y + row) * texture.width + region.x) * 4;
          pixels.set(
            texture.data.subarray(start, start + region.width * 4),
            row * region.width * 4,
          );
        }
        gl.bindTexture(GL.TEXTURE_2D, existing.texture);
        gl.texSubImage2D?.(
          GL.TEXTURE_2D,
          0,
          region.x,
          region.y,
          region.width,
          region.height,
          GL.RGBA,
          GL.UNSIGNED_BYTE,
          pixels,
        );
        if (texture.mipmaps === true) gl.generateMipmap?.(GL.TEXTURE_2D);
        gl.bindTexture(GL.TEXTURE_2D, null);
        const updated = { ...existing, version: texture.version };
        this.#states.set(updated, textureState(texture));
        this.#records.set(texture.id, updated);
        return updated;
      }
      this.#gl.deleteTexture(existing.texture);
      this.#records.delete(texture.id);
    }

    if (texture.disposed) {
      warnDisposedInUse("texture", texture.id);
      return null;
    }

    const record = this.#upload(texture);
    if (record === null) {
      return null;
    }
    this.#states.set(record, textureState(texture));
    this.#records.set(texture.id, record);
    return record;
  }

  /** Residency of the submitted version; async preparation exposes in-flight work. */
  residency(
    texture: CacheableTexture,
  ): "absent" | "stale" | "uploading" | "resident" {
    const record = this.#records.get(texture.id);
    if (record === undefined || texture.disposed) return "absent";
    if (record.version !== texture.version) return "stale";
    return this.#pending.has(record) ? "uploading" : "resident";
  }

  /** Upload and wait for GPU completion without a blocking client wait. */
  async acquireAsync(
    texture: CacheableTexture,
    poll: () => Promise<void> = textureUploadTick,
    maximumPolls = 4096,
  ): Promise<TextureRecord | null> {
    const gl = this.#gl;
    if (this.#disposed || texture.disposed) return null;
    if (!Number.isSafeInteger(maximumPolls) || maximumPolls < 1)
      throw new RangeError("maximumPolls must be a positive safe integer.");
    if (
      gl.fenceSync === undefined ||
      gl.clientWaitSync === undefined ||
      gl.deleteSync === undefined
    )
      throw new FourError(
        "NOT_IMPLEMENTED",
        "Asynchronous texture preparation requires WebGL sync objects.",
      );
    const record = this.#acquire(texture, true);
    if (record === null) return null;
    const sync = gl.fenceSync(0x9117, 0);
    if (sync === null)
      throw new FourError(
        "CONTEXT_LOST",
        "Could not allocate a texture upload fence.",
      );
    const generation = this.#generation;
    this.#pending.set(record, (this.#pending.get(record) ?? 0) + 1);
    try {
      for (let attempt = 0; attempt < maximumPolls; attempt++) {
        if (
          this.#disposed ||
          texture.disposed ||
          texture.version !== record.version ||
          this.#records.get(texture.id) !== record
        )
          return null;
        const status = gl.clientWaitSync(sync, attempt === 0 ? 1 : 0, 0);
        if (status === 0x911a || status === 0x911c) return record;
        if (status !== 0x911b)
          throw new FourError("CONTEXT_LOST", "Texture upload fence failed.");
        await poll();
      }
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Texture upload fence polling limit exceeded.",
      );
    } catch (error) {
      if (
        generation === this.#generation &&
        this.#records.get(texture.id) === record
      ) {
        this.#records.delete(texture.id);
        gl.deleteTexture(record.texture);
      }
      throw error;
    } finally {
      if (generation === this.#generation) gl.deleteSync(sync);
      const count = this.#pending.get(record) ?? 1;
      if (count <= 1) this.#pending.delete(record);
      else this.#pending.set(record, count - 1);
    }
  }

  /**
   * Drops every record **without touching the context** — the context-loss path
   * (§61). The handles are already invalid; calling `deleteTexture` on them
   * would be a GL call against a lost context for no benefit.
   */
  forget(): void {
    this.#generation += 1;
    this.#records.clear();
  }

  /**
   * Deletes every texture this cache created (§83). Idempotent.
   *
   * Only valid on a live context — the renderer calls
   * {@link TextureCache.forget} instead when the context is lost. The
   * *application's* `Texture` objects are untouched: the renderer did not create
   * them, so it does not dispose them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#gl.deleteTexture(record.texture);
    }
    this.#records.clear();
  }

  /**
   * Clamps a texture's anisotropy request to what this device offers (§62,
   * §77; R-30b, 2026-08-21).
   *
   * ## Why the query is lazy, and why the answer is a clamp
   *
   * **Lazy** because a texture that asks for nothing must cost nothing: the
   * extension is fetched on the first request above 1, so a context that never
   * meets one issues no `getExtension` and no `getParameter`, and every GL
   * transcript recorded before this packet is byte-for-byte what it was. That
   * is this repository's pipeline-cost rule applied to a capability query.
   *
   * **A clamp, not a refusal**, because `EXT_texture_filter_anisotropic` is an
   * *extension*: `anisotropy: 16` is a correct request that a conformant device
   * may be unable to fill, which is §62's capability tiering and not §85's
   * invalid value. The frame draws with the sharpness the device has. §85 still
   * refuses a request that no device could fill — a non-integer, or one below 1
   * — and it does so in `@fourjs/render`'s `Texture`, at authoring time.
   *
   * `getExtension` itself is optional on `WebglContext`, so a double that does
   * not declare it reports a ceiling of 1 and every anisotropy request is
   * silently dropped, exactly as on a device without the extension.
   */
  #resolveAnisotropy(requested: number): number {
    if (requested <= 1) {
      return 1;
    }
    if (this.#maxAnisotropy === 0) {
      const gl = this.#gl;
      const extension = gl.getExtension?.("EXT_texture_filter_anisotropic");
      const limit =
        extension === undefined || extension === null
          ? 1
          : gl.getParameter(GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      this.#maxAnisotropy =
        typeof limit === "number" && limit >= 1 ? Math.floor(limit) : 1;
    }
    return Math.min(requested, this.#maxAnisotropy);
  }

  /**
   * Uploads `texture` into a fresh GL texture object, or returns `null` if GL
   * would not allocate one.
   *
   * `data === null` uploads `null` pixels, which allocates zero-filled storage
   * of the requested size (WebGL initializes it): the sampler stays valid and
   * the sprite draws as transparent black, which is a defined outcome rather
   * than the undefined content an unallocated texture would sample.
   *
   * The binding is cleared afterwards so an upload triggered mid-frame cannot
   * leave a texture other than the one being drawn bound to unit 0.
   *
   * ## Colour space (§60a, R-15, 2026-08-08)
   *
   * A texture tagged `colorSpace: "srgb"` is allocated `SRGB8_ALPHA8` instead of
   * `RGBA8`, so the GPU decodes every sample to linear-light before filtering
   * and before the fragment stage sees it — which is what makes §60a's
   * "lighting and blending run in linear space" true for a textured surface and
   * not only for an untextured one. The tag is read defensively
   * (`?? "linear"`): `MaterialTexture.colorSpace` is optional, so every texture
   * written before the field existed, and every test double, keeps uploading
   * `RGBA8` and issuing the byte-identical call it always did.
   */
  #upload(texture: CacheableTexture): TextureRecord | null {
    const gl = this.#gl;
    const handle = gl.createTexture();
    if (handle === null) {
      return null;
    }

    const target = glTarget(texture.dimension);
    if (
      (target === GL.TEXTURE_2D_ARRAY || target === GL.TEXTURE_3D) &&
      gl.texImage3D === undefined
    ) {
      gl.deleteTexture(handle);
      return null;
    }

    const mipmaps = texture.mipmaps === true && gl.generateMipmap !== undefined;

    gl.bindTexture(target, handle);
    const internal =
      (texture.colorSpace ?? "linear") === "srgb" ? GL.SRGB8_ALPHA8 : GL.RGBA8;
    if (target === GL.TEXTURE_2D) {
      gl.texImage2D(
        GL.TEXTURE_2D,
        0,
        internal,
        texture.width,
        texture.height,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        texture.data,
      );
    } else if (target === GL.TEXTURE_CUBE_MAP) {
      // Six faces, +X -X +Y -Y +Z -Z, each a `width * height * 4` slice.
      const faceBytes = texture.width * texture.height * 4;
      for (let face = 0; face < 6; face += 1) {
        gl.texImage2D(
          GL.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          0,
          internal,
          texture.width,
          texture.height,
          0,
          GL.RGBA,
          GL.UNSIGNED_BYTE,
          texture.data === null
            ? null
            : texture.data.subarray(face * faceBytes, (face + 1) * faceBytes),
        );
      }
    } else {
      gl.texImage3D?.(
        target,
        0,
        internal,
        texture.width,
        texture.height,
        texture.depth ?? 1,
        0,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        texture.data,
      );
    }
    // R-30: the arguments are the texture's own, defaulting to the pair this
    // module hard-coded before 2026-08-13 — the same four calls in the same
    // order with the same enums for every texture that names neither.
    if (mipmaps) {
      // R-30b: before the sampler state, because the chain has to exist by the
      // time a mip-choosing min filter is written — and because `generateMipmap`
      // reads the level-0 image this call just uploaded.
      gl.generateMipmap?.(target);
    }
    const wrap = glWrap(texture.wrap);
    gl.texParameteri(
      target,
      GL.TEXTURE_MIN_FILTER,
      glMinFilter(texture.minFilter, texture.filter, mipmaps),
    );
    gl.texParameteri(target, GL.TEXTURE_MAG_FILTER, glFilter(texture.filter));
    gl.texParameteri(target, GL.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(target, GL.TEXTURE_WRAP_T, wrap);
    if (target === GL.TEXTURE_CUBE_MAP || target === GL.TEXTURE_3D) {
      gl.texParameteri(target, GL.TEXTURE_WRAP_R, wrap);
    }
    const anisotropy = this.#resolveAnisotropy(texture.anisotropy ?? 1);
    if (anisotropy > 1) {
      gl.texParameteri(target, GL.TEXTURE_MAX_ANISOTROPY_EXT, anisotropy);
    }
    gl.bindTexture(target, null);

    return { texture: handle, version: texture.version, target };
  }
}

/** Storage and sampler identity; a metadata edit requires a full upload. */
function textureState(texture: CacheableTexture): string {
  return [
    texture.width,
    texture.height,
    texture.dimension,
    texture.depth,
    texture.colorSpace,
    texture.filter,
    texture.minFilter,
    texture.wrap,
    texture.mipmaps,
    texture.anisotropy,
  ].join("|");
}

/** Let the browser process GPU work between zero-timeout fence polls. */
function textureUploadTick(): Promise<void> {
  const host = globalThis as {
    setTimeout?: (callback: () => void, delay: number) => unknown;
  };
  if (host.setTimeout === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    host.setTimeout?.(resolve, 0);
  });
}
