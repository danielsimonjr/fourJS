/**
 * GPU-side render targets for the WebGL 2 backend: one framebuffer object per
 * `@fourjs/render` `RenderTarget`, cached and invalidated by version (§61, §48,
 * §63; R-4, 2026-08-07).
 *
 * The third member of the family `gl-geometry.ts` and `gl-texture.ts` started —
 * same key (`id`), same validator (`version`), same lazy eviction, same
 * loss-aware {@link RenderTargetCache.forget}, same "never throws inside
 * `render`" rule. Reading one module tells you how the other two behave, and
 * all three back the same claim: **GPU residency is a backend cache, not an
 * application concern.** That is also the answer to why §61's
 * `createRenderTarget` stays deferred; the argument is written out on
 * `@fourjs/render`'s `RenderTarget`, on the class it concerns.
 *
 * ## What one entry holds
 *
 * A framebuffer, the colour texture attached to it, and — unless the target was
 * built with `depth: false` — a depth attachment: a renderbuffer by default, or
 * a `DEPTH_COMPONENT24` **texture** when the target asked for the samplable
 * form (R-18, §69's shadow maps). Plus the size the three
 * were allocated at, because that is what the renderer resolves a normalized
 * viewport rectangle against: reading it off the *record* rather than off the
 * `RenderTarget` guarantees the `viewport` call and the allocation agree even
 * if the application resized the target after this frame began.
 *
 * The colour texture gets the same fixed sampler state every MVP-tier texture
 * gets — `LINEAR` filtering, `CLAMP_TO_EDGE` wrapping (`gl-texture.ts`) — so a
 * material sampling a target needs no special case anywhere in the draw path.
 * `texImage2D` with `null` pixels allocates zero-filled storage, which is what
 * makes sampling a target that has never been rendered into read as transparent
 * black rather than as undefined content.
 *
 * ## Completeness is checked, not assumed (§85, §89)
 *
 * `checkFramebufferStatus` runs once per allocation. A framebuffer that is not
 * `FRAMEBUFFER_COMPLETE` — an unsupported attachment combination, a size past
 * the device's limits, a driver out of memory — is deleted immediately and
 * reported as `null`, and the renderer skips the frame. It is emphatically not
 * drawn into: an incomplete framebuffer turns every subsequent draw into a
 * `GL_INVALID_FRAMEBUFFER_OPERATION`, which is a silent, per-call error nobody
 * reads.
 *
 * ## Eviction policy
 *
 * Identical to the other two caches':
 *
 * - a **version bump** — `RenderTarget.resize()` — is detected on the next
 *   `acquire`, which deletes all three objects and allocates them at the new
 *   size. The old contents are gone; that is the documented behaviour of
 *   `resize`, not a limitation of this cache;
 * - **`target.dispose()`** bumps the version and marks the target disposed, so
 *   the next `acquire` deletes the GL objects and returns `null` — the pass is
 *   then skipped rather than drawn into a released framebuffer (§83's "disposed
 *   resources still in use"). A target disposed and never submitted again keeps
 *   its objects until the renderer is disposed: the same documented leak window
 *   `GeometryCache` and `TextureCache` carry, with the same alternatives
 *   rejected for the same reasons;
 * - **context loss** is not eviction: {@link RenderTargetCache.forget} drops the
 *   records without deleting anything, because every handle is already invalid
 *   and the context must not be touched (§61). The next frame re-allocates,
 *   which is §61's "re-creates engine-owned GPU resources … render targets" —
 *   done lazily, because the cache cannot know which targets the next frame
 *   will use.
 *
 * ## Staged (2026-08-07, R-4)
 *
 * The public shape of each of these is on `@fourjs/render`'s `render-target.ts`;
 * what this module would additionally need is noted here:
 *
 * - ~~**Stencil attachments** (§67)~~ — **landed 2026-08-11 (R-7)**:
 *   `RenderTargetOptions.stencil` allocates the depth renderbuffer as packed
 *   `DEPTH24_STENCIL8` and attaches it to `DEPTH_STENCIL_ATTACHMENT`. The
 *   interplay with R-18's samplable depth is an exclusion rather than a
 *   precedence: a framebuffer has one depth attachment, the packed form is a
 *   renderbuffer and the samplable form is a `DEPTH_COMPONENT24` texture, so
 *   `@fourjs/render`'s constructor refuses `{ stencil: true, depthTexture: true }`
 *   (§85) and this cache never has to choose. `stencil: true` with
 *   `depth: false` is refused there too, because the stencil arrives *inside*
 *   the depth attachment.
 * - **Multiple render targets** (§63, §70) — a colour attachment per output
 *   plus `drawBuffers`, which is a new `WebglContext` entry point.
 * - **Multisampling** (§62) — `renderbufferStorageMultisample` into a
 *   colour *renderbuffer*, plus `blitFramebuffer` into a resolve texture, plus
 *   a `MAX_SAMPLES` query. Three entry points and a second framebuffer per
 *   target; deliberately not paid for by the minimal tier.
 * - ~~**`readPixels`**~~ (§61, §92) — **landed 2026-08-29**: `Rectangle2`
 *   arrived in `@fourjs/math` and `WebglRenderer.readPixels(target, region?)`
 *   reads a cached target's framebuffer through the optional `readPixels`
 *   entry point (the stalling form, wrapped in §61's promise shape — the
 *   method's own doc defends the choice against the picking fence path).
 */

import type { RenderTarget } from "@fourjs/render";
import {
  RenderTargetPool,
  warnDisposedInUse,
  type PassUsageRecord,
} from "@fourjs/render";
import { DEV, devWarnOnce } from "@fourjs/core";

import {
  GL,
  type GlFramebuffer,
  type GlRenderbuffer,
  type GlTexture,
  type WebglContext,
} from "./gl-program.js";

/**
 * The render-target type this cache stores.
 *
 * Imported by name, unlike `CacheableGeometry` and `CacheableTexture`, which
 * are derived from the render item that carries them. The reason is that the
 * two are genuinely different situations rather than an inconsistency: a
 * geometry or a texture reaches the backend *through a material*, as a
 * structural read contract that more than one class can satisfy, whereas a
 * render target reaches it as the fourth argument of `Renderer.render`, typed
 * as this one class — `@fourjs/render` is already a dependency (plan §3.1), the
 * class carries private state and so cannot be satisfied structurally anyway,
 * and naming it is what lets `render-webgl`'s tests drive this cache with the
 * real thing (decision, R-4).
 */
export type CacheableRenderTarget = RenderTarget;

/** Everything one cached render target needs at bind time. */
export interface RenderTargetRecord {
  /** The framebuffer object to bind for drawing. */
  readonly framebuffer: GlFramebuffer;

  /** The colour attachment, bound when a material samples this target. */
  readonly texture: GlTexture;

  /**
   * The depth renderbuffer, or `null` — for a target built with `depth: false`
   * *or* one that asked for the samplable form, which allocates
   * {@link RenderTargetRecord.depthTexture} instead. At most one of the two is
   * ever non-`null`.
   *
   * When {@link RenderTargetRecord.stencil} is set this is the **packed**
   * `DEPTH24_STENCIL8` renderbuffer, attached to `DEPTH_STENCIL_ATTACHMENT`
   * rather than `DEPTH_ATTACHMENT` — one object serving both buffers, which is
   * what makes the mutual exclusion with `depthTexture` a fact about the
   * framebuffer rather than a policy (R-7, §67).
   */
  readonly depthBuffer: GlRenderbuffer | null;

  /**
   * Whether {@link RenderTargetRecord.depthBuffer} is the packed
   * depth-plus-stencil form (§67, R-7) — i.e. whether a frame drawing into this
   * target may run a stencil test, and must clear the stencil buffer.
   *
   * A boolean rather than a second handle: the packed renderbuffer *is* the
   * depth buffer, so a `stencilBuffer` field would be an alias of
   * `depthBuffer` that a reader could mistake for a second allocation.
   */
  readonly stencil: boolean;

  /**
   * The depth attachment as a **texture**, for a target built with
   * `depthTexture: true` (R-18, §69) — what a later pass binds and samples.
   * `null` for every other target.
   */
  readonly depthTexture: GlTexture | null;

  /** `RenderTarget.version` this record was allocated from. */
  readonly version: number;

  /** Width the attachments were allocated at, in texels. */
  readonly width: number;

  /** Height the attachments were allocated at, in texels. */
  readonly height: number;
}

/**
 * Per-context store of allocated framebuffers (§61, §48, §63).
 *
 * One cache belongs to one GL context: the renderer builds it during
 * `initialize` and builds a *new* one on context restore, since every handle
 * the old one held died with the context.
 *
 * ```ts
 * const cache = new RenderTargetCache(gl);
 * const record = cache.acquire(target);
 * if (record !== null) {
 *   gl.bindFramebuffer(GL.FRAMEBUFFER, record.framebuffer);
 *   // draw…
 *   gl.bindFramebuffer(GL.FRAMEBUFFER, null);
 * }
 * ```
 */
export class RenderTargetCache {
  readonly #gl: WebglContext;

  /** Records by `RenderTarget.id`; see the module header for eviction. */
  readonly #records = new Map<string, RenderTargetRecord>();

  #disposed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  /** Number of framebuffers currently allocated. Diagnostics and tests (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link RenderTargetCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the framebuffer for `target`, allocating it on first use and
   * re-allocating it whenever `target.version` has advanced.
   *
   * Returns `null` — and creates no entry — when the target has been disposed,
   * when GL refuses to allocate an object, or when the assembled framebuffer is
   * not complete. **Never throws**: this runs inside `Renderer.render`, and §61
   * forbids throwing there for a lost context; a failed allocation is the same
   * class of asynchronous, driver-scheduled event, so it skips the pass rather
   * than unwinding the frame.
   */
  acquire(target: CacheableRenderTarget): RenderTargetRecord | null {
    const existing = this.#records.get(target.id);
    if (existing !== undefined) {
      if (existing.version === target.version) {
        return existing;
      }
      this.#destroy(existing);
      this.#records.delete(target.id);
    }

    if (target.disposed) {
      warnDisposedInUse("render-target", target.id);
      return null;
    }

    const record = this.#allocate(target);
    if (record === null) {
      return null;
    }
    this.#records.set(target.id, record);
    return record;
  }

  /**
   * Drops every record **without touching the context** — the context-loss path
   * (§61). The handles are already invalid; deleting them would be a GL call
   * against a lost context for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every framebuffer, colour texture and depth buffer this cache
   * created (§83). Idempotent.
   *
   * Only valid on a live context — the renderer calls
   * {@link RenderTargetCache.forget} instead when the context is lost. The
   * *application's* `RenderTarget` objects are untouched: the renderer did not
   * create them, so it does not dispose them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#destroy(record);
    }
    this.#records.clear();
  }

  /**
   * Allocates the colour texture, the optional depth buffer, and the
   * framebuffer that binds them together, or returns `null` if any step fails.
   *
   * Nothing is left bound: the texture binding is cleared as `TextureCache`
   * clears its own (an allocation triggered mid-frame must not displace the
   * texture being drawn with), the renderbuffer binding is cleared for the same
   * reason, and the framebuffer goes back to the default drawing buffer — the
   * renderer binds the target explicitly when it starts the pass, so leaving it
   * bound here would make the bind order depend on whether this frame happened
   * to be the allocating one.
   */
  #allocate(target: CacheableRenderTarget): RenderTargetRecord | null {
    const gl = this.#gl;
    const width = target.width;
    const height = target.height;

    const texture = gl.createTexture();
    if (texture === null) {
      return null;
    }
    gl.bindTexture(GL.TEXTURE_2D, texture);
    gl.texImage2D(
      GL.TEXTURE_2D,
      0,
      GL.RGBA8,
      width,
      height,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    gl.bindTexture(GL.TEXTURE_2D, null);

    // The depth attachment, in one of its two forms (R-18). A renderbuffer is
    // what a pass writes and nothing reads; a texture is the samplable form
    // §69's shadow comparison needs. Exactly one is allocated, so the rest of
    // this cache — and the record it returns — carries two nullable handles of
    // which at most one is live, rather than a discriminated union for a
    // two-case choice fixed at the target's construction.
    let depthBuffer: GlRenderbuffer | null = null;
    let depthTexture: GlTexture | null = null;
    if (target.depth && target.depthTexture) {
      depthTexture = gl.createTexture();
      if (depthTexture === null) {
        gl.deleteTexture(texture);
        return null;
      }
      gl.bindTexture(GL.TEXTURE_2D, depthTexture);
      gl.texImage2D(
        GL.TEXTURE_2D,
        0,
        GL.DEPTH_COMPONENT24,
        width,
        height,
        0,
        GL.DEPTH_COMPONENT,
        GL.UNSIGNED_INT,
        null,
      );
      // `NEAREST`, not the `LINEAR` every colour texture gets: a
      // `DEPTH_COMPONENT` texture is not filterable in GLES 3.0, and a
      // filterable-mode sampler over one makes the texture *incomplete* — it
      // would sample as opaque black and every receiver would be in shadow.
      // The percentage-closer filter is explicit taps instead (`gl-shadow.ts`).
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
      // Clamped for the reason every texture here is, and one more: a receiver
      // outside the shadow volume samples the border, and clamping makes that
      // the nearest edge texel rather than a wrap-around of the far side.
      // The shader rejects out-of-volume coordinates before it ever samples,
      // so this is the second line of defence, not the first.
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
      gl.bindTexture(GL.TEXTURE_2D, null);
    } else if (target.depth) {
      depthBuffer = gl.createRenderbuffer();
      if (depthBuffer === null) {
        gl.deleteTexture(texture);
        return null;
      }
      gl.bindRenderbuffer(GL.RENDERBUFFER, depthBuffer);
      // Packed depth-plus-stencil when the target asked for a stencil (R-7,
      // §67), plain 16-bit depth otherwise — the storage a target with no
      // stencil has always been given, unchanged, so its allocation is the
      // identical call sequence it was before this branch existed.
      gl.renderbufferStorage(
        GL.RENDERBUFFER,
        target.stencil ? GL.DEPTH24_STENCIL8 : GL.DEPTH_COMPONENT16,
        width,
        height,
      );
      gl.bindRenderbuffer(GL.RENDERBUFFER, null);
    }

    const framebuffer = gl.createFramebuffer();
    if (framebuffer === null) {
      gl.deleteTexture(texture);
      if (depthBuffer !== null) {
        gl.deleteRenderbuffer(depthBuffer);
      }
      if (depthTexture !== null) {
        gl.deleteTexture(depthTexture);
      }
      return null;
    }

    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT0,
      GL.TEXTURE_2D,
      texture,
      0,
    );
    if (depthBuffer !== null) {
      gl.framebufferRenderbuffer(
        GL.FRAMEBUFFER,
        // The packed renderbuffer attaches to the combined point, which is what
        // gives the framebuffer both buffers from one object (R-7).
        target.stencil ? GL.DEPTH_STENCIL_ATTACHMENT : GL.DEPTH_ATTACHMENT,
        GL.RENDERBUFFER,
        depthBuffer,
      );
    }
    if (depthTexture !== null) {
      gl.framebufferTexture2D(
        GL.FRAMEBUFFER,
        GL.DEPTH_ATTACHMENT,
        GL.TEXTURE_2D,
        depthTexture,
        0,
      );
    }
    const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
    gl.bindFramebuffer(GL.FRAMEBUFFER, null);

    if (status !== GL.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      if (depthBuffer !== null) {
        gl.deleteRenderbuffer(depthBuffer);
      }
      if (depthTexture !== null) {
        gl.deleteTexture(depthTexture);
      }
      return null;
    }

    return {
      framebuffer,
      texture,
      depthBuffer,
      // Read off the record rather than off the target at frame time: a target
      // whose `stencil` could not be honoured (no renderbuffer at all) must not
      // make the frame clear a buffer that is not there.
      stencil: target.stencil && depthBuffer !== null,
      depthTexture,
      version: target.version,
      width,
      height,
    };
  }

  /** Deletes the three GL objects one record owns. Live contexts only. */
  #destroy(record: RenderTargetRecord): void {
    const gl = this.#gl;
    gl.deleteFramebuffer(record.framebuffer);
    gl.deleteTexture(record.texture);
    if (record.depthBuffer !== null) {
      gl.deleteRenderbuffer(record.depthBuffer);
    }
    if (record.depthTexture !== null) {
      gl.deleteTexture(record.depthTexture);
    }
  }
}

/**
 * WebGL 2's §63 transient pool (W6.1). GL has no explicit barriers, so this
 * emits nothing; it only uses the graph's usage records to assert, in DEV,
 * that a target is never sampled by the pass that draws into it (a feedback
 * loop GL leaves undefined).
 */
export class GlTransientTargetPool extends RenderTargetPool {
  /** Number of feedback violations seen (DEV only). */
  feedbackViolations = 0;

  beginPass(record: PassUsageRecord): void {
    if (!DEV) {
      return;
    }
    if (record.writes !== null && record.reads.includes(record.writes)) {
      this.feedbackViolations += 1;
      devWarnOnce(
        `gl-transient-feedback:${record.pass}`,
        `RenderGraph pass ${JSON.stringify(record.pass)} samples ${record.writes} while attached to it; WebGL 2 leaves that undefined (§63).`,
      );
    }
  }
}
