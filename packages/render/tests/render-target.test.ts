/**
 * Unit tests for `RenderTarget` (§61, §48, §63; R-4, 2026-08-07).
 *
 * Three things are under test, and only the first is about the class itself:
 *
 * 1. **The resource contract** — id, version, size, format, §85 validation,
 *    §83 disposal — which is the same contract `Texture` and `BufferGeometry`
 *    offer, so a backend cache written for any one of them works for this.
 * 2. **The texture seam.** `RenderTarget.colorTexture` has to satisfy
 *    `@fourjs/materials`' `MaterialTexture` — the contract `Texture` satisfies —
 *    or render-to-texture needs an adapter and R-5/R-6 inherit it. The typed
 *    `const asMaterialTexture: MaterialTexture = target.colorTexture`
 *    assignment below is a *compile-time* assertion of exactly that, checked
 *    again at runtime member by member. The cross-package half — that a real
 *    `UnlitMaterial.map` accepts it — is `tests/integration/render-to-texture`.
 * 3. **The `isRenderTargetTexture` guard**, which is the seam every backend
 *    uses to tell "sample the framebuffer" from "upload these bytes". It has to
 *    reject an ordinary `Texture`, and the real one is used to prove it rather
 *    than a double.
 */

import type { MaterialTexture } from "@fourjs/materials";
import { describe, expect, it } from "vitest";

import {
  RenderTarget,
  Texture,
  isRenderTargetTexture,
  type RenderTargetFormat,
  type RenderTargetOptions,
} from "../src/index.js";

/** The §85 message every size rejection carries. */
const SIZE_RULE = /must be a finite integer of at least 1/;

describe("RenderTarget — construction and defaults (§61, §85)", () => {
  it("assigns ascending `render-target-<n>` ids from a monotonic counter", () => {
    const first = new RenderTarget({ width: 4, height: 4 });
    const second = new RenderTarget({ width: 4, height: 4 });

    expect(first.id).toMatch(/^render-target-\d+$/);
    expect(second.id).toMatch(/^render-target-\d+$/);
    expect(first.id).not.toBe(second.id);
    const index = (id: string): number =>
      Number(id.slice("render-target-".length));
    expect(index(second.id)).toBe(index(first.id) + 1);
  });

  it("keeps the requested size and starts at version 0, undisposed", () => {
    const target = new RenderTarget({ width: 320, height: 240 });

    expect(target.width).toBe(320);
    expect(target.height).toBe(240);
    expect(target.version).toBe(0);
    expect(target.disposed).toBe(false);
  });

  it("defaults the format to rgba8 and the depth buffer to present", () => {
    const target = new RenderTarget({ width: 2, height: 2 });

    expect(target.format).toBe("rgba8");
    // Depth defaults *on* so an off-screen pass composites the same way the
    // on-screen one does — the argument is on `RenderTargetOptions.depth`.
    expect(target.depth).toBe(true);
  });

  it("defaults the colour space to linear and honours an explicit tag (§60a)", () => {
    // §60a's "render targets carry color-space metadata", at the default this
    // tier ships: an off-screen surface is an intermediate in a linear-light
    // pipeline until an author says it is a presentable image (R-15).
    expect(new RenderTarget({ width: 2, height: 2 }).colorSpace).toBe("linear");
    expect(
      new RenderTarget({ width: 2, height: 2, colorSpace: "srgb" }).colorSpace,
    ).toBe("srgb");
    expect(
      new RenderTarget({ width: 2, height: 2, colorSpace: "linear" })
        .colorSpace,
    ).toBe("linear");
  });

  it("reports the target's colour space through the colour texture (§60a)", () => {
    // One surface, one tag: a material sampling the attachment and the graph
    // validating an output transform read the same value.
    const linear = new RenderTarget({ width: 2, height: 2 });
    const encoded = new RenderTarget({
      width: 2,
      height: 2,
      colorSpace: "srgb",
    });

    expect(linear.colorTexture.colorSpace).toBe("linear");
    expect(encoded.colorTexture.colorSpace).toBe("srgb");
  });

  it("refuses a colour space outside the union (§60a, §85)", () => {
    expect(
      () =>
        new RenderTarget({
          width: 2,
          height: 2,
          colorSpace: "display-p3",
        } as unknown as { width: number; height: number }),
    ).toThrow(/RenderTarget colorSpace "display-p3"/);
  });

  it("honours an explicit depth: false", () => {
    expect(new RenderTarget({ width: 2, height: 2, depth: false }).depth).toBe(
      false,
    );
  });

  it("honours an explicit format: rgba8", () => {
    expect(
      new RenderTarget({ width: 2, height: 2, format: "rgba8" }).format,
    ).toBe("rgba8");
  });

  it("honours the rgba32float format (decision D7) and bills 16 bytes a texel", () => {
    const target = new RenderTarget({
      width: 2,
      height: 2,
      format: "rgba32float",
      depth: false,
    });
    expect(target.format).toBe("rgba32float");
    expect(target.byteLength).toBe(2 * 2 * 16);
  });

  it("rejects a non-integer, zero, negative, or non-finite size (§85)", () => {
    const bad: readonly (readonly [number, number])[] = [
      [0, 4],
      [4, 0],
      [-1, 4],
      [4, -1],
      [1.5, 4],
      [4, 1.5],
      [Number.NaN, 4],
      [Number.POSITIVE_INFINITY, 4],
    ];
    for (const [width, height] of bad) {
      expect(() => new RenderTarget({ width, height })).toThrow(SIZE_RULE);
    }
  });

  it("rejects an unsupported format (§62, §85)", () => {
    // A cast: `format: "rgba16f"` is a *compile* error, which is the first line
    // of defence (see `RenderTargetFormat`). This checks the second one, for a
    // value that arrived from JSON or an untyped caller.
    const options = {
      width: 2,
      height: 2,
      format: "rgba16f" as RenderTargetFormat,
    } satisfies RenderTargetOptions;

    expect(() => new RenderTarget(options)).toThrow(/is not supported/);
  });
});

describe("RenderTarget — the colour texture seam (§77, R-4)", () => {
  it("is a MaterialTexture: every member the contract names, no CPU data", () => {
    const target = new RenderTarget({ width: 8, height: 4 });
    // The load-bearing line of this file: if `colorTexture` ever stops
    // satisfying the material contract, this stops compiling and
    // render-to-texture stops being expressible without an adapter.
    const asMaterialTexture: MaterialTexture = target.colorTexture;

    expect(asMaterialTexture.id).toBe(target.id);
    expect(asMaterialTexture.version).toBe(0);
    expect(asMaterialTexture.width).toBe(8);
    expect(asMaterialTexture.height).toBe(4);
    expect(asMaterialTexture.disposed).toBe(false);
    // There are no texels on the CPU — the pixels live in the framebuffer.
    expect(asMaterialTexture.data).toBeNull();
  });

  it("is one stable object for the target's lifetime", () => {
    const target = new RenderTarget({ width: 2, height: 2 });

    expect(target.colorTexture).toBe(target.colorTexture);
  });

  it("points back at its target, which is how a backend finds the framebuffer", () => {
    const target = new RenderTarget({ width: 2, height: 2 });

    expect(target.colorTexture.renderTarget).toBe(target);
    expect(target.colorTexture.isRenderTargetTexture).toBe(true);
  });

  it("delegates rather than copies, so a resize is visible through a captured reference", () => {
    const target = new RenderTarget({ width: 2, height: 2 });
    const captured = target.colorTexture;

    target.resize(64, 32);

    expect(captured.width).toBe(64);
    expect(captured.height).toBe(32);
    expect(captured.version).toBe(target.version);
  });

  it("reports disposal through the texture too", () => {
    const target = new RenderTarget({ width: 2, height: 2 });
    const captured = target.colorTexture;

    target.dispose();

    expect(captured.disposed).toBe(true);
  });
});

describe("RenderTarget — resize (§85, §83)", () => {
  it("applies the new size and bumps the version", () => {
    const target = new RenderTarget({ width: 2, height: 2 });

    target.resize(16, 8);

    expect(target.width).toBe(16);
    expect(target.height).toBe(8);
    expect(target.version).toBe(1);
  });

  it("bumps the version even for the size it already has", () => {
    // Deliberate: a no-op here would make "the version advanced" stop meaning
    // "something changed", which is the whole contract a backend caches on.
    const target = new RenderTarget({ width: 4, height: 4 });

    target.resize(4, 4);

    expect(target.version).toBe(1);
  });

  it("validates the new size and leaves the old one intact (§85)", () => {
    const target = new RenderTarget({ width: 4, height: 4 });

    expect(() => {
      target.resize(0, 4);
    }).toThrow(SIZE_RULE);
    expect(() => {
      target.resize(4, 2.5);
    }).toThrow(SIZE_RULE);
    expect(target.width).toBe(4);
    expect(target.height).toBe(4);
    expect(target.version).toBe(0);
  });

  it("throws after disposal — disposal is terminal (§83)", () => {
    const target = new RenderTarget({ width: 4, height: 4 });
    target.dispose();

    expect(() => {
      target.resize(8, 8);
    }).toThrow(/disposal is terminal/);
  });
});

describe("RenderTarget — disposal (§83)", () => {
  it("marks the target disposed and bumps the version once", () => {
    const target = new RenderTarget({ width: 4, height: 4 });

    target.dispose();

    expect(target.disposed).toBe(true);
    expect(target.version).toBe(1);
  });

  it("is idempotent: a second call changes nothing", () => {
    const target = new RenderTarget({ width: 4, height: 4 });

    target.dispose();
    target.dispose();

    expect(target.version).toBe(1);
  });

  it("keeps reporting its size, so a backend can still identify what it deletes", () => {
    const target = new RenderTarget({ width: 4, height: 6 });

    target.dispose();

    expect(target.width).toBe(4);
    expect(target.height).toBe(6);
    expect(target.format).toBe("rgba8");
    expect(target.depth).toBe(true);
  });
});

describe("isRenderTargetTexture (R-4)", () => {
  it("accepts a real render target's colour texture", () => {
    const target = new RenderTarget({ width: 2, height: 2 });

    expect(isRenderTargetTexture(target.colorTexture)).toBe(true);
  });

  it("rejects an ordinary Texture — the case that matters", () => {
    // The whole point of the guard: an uploaded texture and a framebuffer
    // attachment reach the backend through the same material field.
    const texture = new Texture({ width: 1, height: 1 });

    expect(isRenderTargetTexture(texture)).toBe(false);
  });

  it("rejects non-objects and partially formed impostors", () => {
    expect(isRenderTargetTexture(null)).toBe(false);
    expect(isRenderTargetTexture(undefined)).toBe(false);
    expect(isRenderTargetTexture("render-target-1")).toBe(false);
    expect(isRenderTargetTexture({})).toBe(false);
    // The marker without the pointer the caller will reach for.
    expect(isRenderTargetTexture({ isRenderTargetTexture: true })).toBe(false);
    expect(
      isRenderTargetTexture({
        isRenderTargetTexture: true,
        renderTarget: null,
      }),
    ).toBe(false);
    // The pointer without the marker.
    expect(isRenderTargetTexture({ renderTarget: {} })).toBe(false);
  });
});

describe("RenderTarget — samplable depth (§69, R-18)", () => {
  it("defaults to a renderbuffer depth attachment", () => {
    const target = new RenderTarget({ width: 8, height: 8 });

    expect(target.depth).toBe(true);
    expect(target.depthTexture).toBe(false);
  });

  it("asks for a depth texture when told to", () => {
    const target = new RenderTarget({
      width: 1024,
      height: 1024,
      depthTexture: true,
    });

    expect([target.depth, target.depthTexture]).toEqual([true, true]);
  });

  it("refuses a samplable copy of a buffer the target does not have (§85)", () => {
    expect(
      () =>
        new RenderTarget({
          width: 8,
          height: 8,
          depth: false,
          depthTexture: true,
        }),
    ).toThrow(/depthTexture requires depth/);
  });

  it("accounts a depth texture at four bytes per texel, not two (§83)", () => {
    const size = 64 * 64;
    expect(new RenderTarget({ width: 64, height: 64 }).byteLength).toBe(
      size * 6,
    );
    expect(
      new RenderTarget({ width: 64, height: 64, depth: false }).byteLength,
    ).toBe(size * 4);
    // `DEPTH_COMPONENT24` occupies a 32-bit texel — the backend's actual
    // format, quoted rather than guessed (`gl-render-target.ts`).
    expect(
      new RenderTarget({ width: 64, height: 64, depthTexture: true })
        .byteLength,
    ).toBe(size * 8);
  });

  it("keeps the attachment choice across a resize and reports 0 once disposed", () => {
    const target = new RenderTarget({
      width: 16,
      height: 16,
      depthTexture: true,
    });
    target.resize(32, 32);
    expect(target.depthTexture).toBe(true);
    expect(target.byteLength).toBe(32 * 32 * 8);

    target.dispose();
    expect(target.byteLength).toBe(0);
    expect(target.depthTexture).toBe(true);
  });
});

describe("RenderTarget — the stencil attachment (§67, R-7)", () => {
  it("defaults to no stencil, which is what every target had before R-7", () => {
    const target = new RenderTarget({ width: 8, height: 8 });

    expect(target.stencil).toBe(false);
  });

  it("asks for one when told to, packed into the depth attachment", () => {
    const target = new RenderTarget({ width: 8, height: 8, stencil: true });

    expect([target.depth, target.stencil, target.depthTexture]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("refuses a stencil with no depth to pack it into (§85)", () => {
    expect(
      () =>
        new RenderTarget({
          width: 8,
          height: 8,
          depth: false,
          stencil: true,
        }),
    ).toThrow(/stencil requires depth/);
  });

  it("refuses a stencil beside R-18's samplable depth texture (§85)", () => {
    // A framebuffer has one depth attachment; the packed stencil form is a
    // renderbuffer and the samplable form is a texture, so this is a
    // contradiction rather than a preference — refused where the mistake is.
    expect(
      () =>
        new RenderTarget({
          width: 8,
          height: 8,
          stencil: true,
          depthTexture: true,
        }),
    ).toThrow(/mutually exclusive/);
  });

  it("accounts DEPTH24_STENCIL8 at four bytes per texel (§83, §84)", () => {
    const size = 64 * 64;
    expect(
      new RenderTarget({ width: 64, height: 64, stencil: true }).byteLength,
    ).toBe(size * 8);
  });

  it("keeps the choice across a resize and reports 0 once disposed", () => {
    const target = new RenderTarget({ width: 16, height: 16, stencil: true });
    target.resize(32, 32);

    expect(target.stencil).toBe(true);
    expect(target.byteLength).toBe(32 * 32 * 8);
    target.dispose();
    expect(target.byteLength).toBe(0);
    expect(target.stencil).toBe(true);
  });
});
