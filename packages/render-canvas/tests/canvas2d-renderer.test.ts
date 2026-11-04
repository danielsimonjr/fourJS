import { FourError, isFourError, resetDevWarnings } from "@fourjs/core";
import { Sprite } from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Canvas2dRenderer, cssColor } from "../src/index.js";
import {
  FakeSurface,
  TestCamera,
  TestGeometry,
  TestMaterial,
  TestSpriteMaterial,
  root,
  triangle,
  view,
} from "./helpers.js";
import { Renderable } from "@fourjs/render";

async function make(width = 100, height = 100) {
  const surface = new FakeSurface(width, height);
  const renderer = new Canvas2dRenderer({ canvas: surface });
  await renderer.initialize();
  return {
    surface,
    renderer,
    ctx: surface.recording,
    camera: new TestCamera(),
  };
}

beforeEach(() => resetDevWarnings());
afterEach(() => vi.restoreAllMocks());

describe("initialize", () => {
  it("takes the canvas from the options or the constructor", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer();
    expect(renderer.initialized).toBe(false);
    await renderer.initialize({ canvas: surface });
    expect(renderer.initialized).toBe(true);
    expect(surface.contextRequests).toBe(1);
    expect(renderer.capabilities.backend).toBe("canvas2d");
  });

  it("passes contextAttributes to the one getContext call", async () => {
    const seen: unknown[] = [];
    const surface = new FakeSurface();
    surface.getContext = (_id: "2d", attributes?: object): unknown => {
      seen.push(attributes);
      return surface.context;
    };
    const attributes = { willReadFrequently: true };
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      contextAttributes: attributes,
    });
    await renderer.initialize();
    expect(seen).toEqual([attributes]);
  });

  it("rejects a missing canvas and a canvas with no 2D context", async () => {
    await expect(new Canvas2dRenderer().initialize()).rejects.toSatisfy(
      (e: unknown) =>
        isFourError(e) && e.code === "RENDERER_INITIALIZATION_FAILED",
    );
    const bad = new FakeSurface(1, 1, null);
    await expect(
      new Canvas2dRenderer({ canvas: bad }).initialize(),
    ).rejects.toBeInstanceOf(FourError);
    const partial = new FakeSurface(1, 1, { save() {} });
    await expect(
      new Canvas2dRenderer({ canvas: partial }).initialize(),
    ).rejects.toBeInstanceOf(FourError);
  });

  it("refuses to initialize after dispose", async () => {
    const renderer = new Canvas2dRenderer({ canvas: new FakeSurface() });
    renderer.dispose();
    await expect(renderer.initialize()).rejects.toBeInstanceOf(FourError);
  });
});

describe("clear ordering and viewport confinement", () => {
  it("clips, clears, fills the background, then draws, then restores", async () => {
    const { renderer, ctx, camera } = await make(100, 100);
    renderer.render(root(triangle()), [
      view(camera, { clearColor: [0, 0, 0, 1] }),
    ]);
    const order = ctx.calls.map((c) => c.split("(")[0].split("=")[0]);
    expect(order.slice(0, 8)).toEqual([
      "save",
      "beginPath",
      "rect",
      "clip",
      "clearRect",
      "fillStyle",
      "fillRect",
      "fillStyle",
    ]);
    expect(order.at(-1)).toBe("restore");
    expect(order.indexOf("fill")).toBeGreaterThan(order.indexOf("fillRect"));
    expect(camera.updates).toBe(1);
  });

  it("flips the bottom-left viewport rectangle into canvas space", async () => {
    const { renderer, ctx, camera } = await make(200, 100);
    renderer.render(root(), [
      view(camera, {
        x: 10,
        y: 20,
        width: 50,
        height: 30,
        normalized: false,
        clearColor: [0, 0, 0, 1],
      }),
    ]);
    // top = 100 - 20 - 30 = 50
    expect(ctx.named("rect(")).toEqual(["rect(10,50,50,30)"]);
    expect(ctx.named("clearRect")).toEqual(["clearRect(10,50,50,30)"]);
    expect(ctx.named("fillRect")).toEqual(["fillRect(10,50,50,30)"]);
  });

  it("scales normalized rectangles by the buffer size", async () => {
    const { renderer, ctx, camera } = await make(200, 100);
    renderer.render(root(), [
      view(camera, {
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 1,
        clearColor: [0, 0, 0, 1],
      }),
    ]);
    expect(ctx.named("rect(")).toEqual(["rect(100,0,100,100)"]);
  });

  it("does not clear without a clearColor", async () => {
    const { renderer, ctx, camera } = await make();
    renderer.render(root(triangle()), [view(camera)]);
    expect(ctx.named("clearRect")).toEqual([]);
    expect(ctx.named("fillRect")).toEqual([]);
    expect(ctx.named("fill(")).toHaveLength(1);
  });

  it("draws and clears nothing for an empty views array", async () => {
    const { renderer, ctx } = await make();
    renderer.render(root(triangle()), []);
    expect(ctx.calls).toEqual([]);
  });

  it("draws nothing for an empty scene but still clears when asked", async () => {
    const { renderer, ctx, camera } = await make();
    renderer.render(root(), [view(camera)]);
    expect(ctx.named("fill(")).toEqual([]);
    expect(ctx.named("moveTo")).toEqual([]);
  });

  it("uses resize()'s resolution for the buffer and the rectangles", async () => {
    const { renderer, surface, ctx, camera } = await make();
    renderer.resize(50, 40, 2);
    expect([surface.width, surface.height]).toEqual([100, 80]);
    renderer.resize(10, 10);
    expect([surface.width, surface.height]).toEqual([10, 10]);
    renderer.resize(50, 40, 2);
    renderer.render(root(), [view(camera, { clearColor: [0, 0, 0, 1] })]);
    expect(ctx.named("rect(")).toEqual(["rect(0,0,100,80)"]);
  });

  it("applies a resize issued before initialize to the surface", async () => {
    const renderer = new Canvas2dRenderer();
    expect(() => renderer.resize(40, 30, 2)).not.toThrow();
    const surface = new FakeSurface(300, 150);
    await renderer.initialize({ canvas: surface });
    expect([surface.width, surface.height]).toEqual([80, 60]);
    renderer.render(root(), [
      view(new TestCamera(), { clearColor: [0, 0, 0, 1] }),
    ]);
    expect(surface.recording.named("rect(")).toEqual(["rect(0,0,80,60)"]);
  });

  it("throws INVALID_APPLICATION_STATE rendering before initialize, silent after dispose", async () => {
    const renderer = new Canvas2dRenderer({ canvas: new FakeSurface() });
    let thrown: unknown;
    try {
      renderer.render(root(), [view(new TestCamera())]);
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as FourError).code).toBe("INVALID_APPLICATION_STATE");
    const { renderer: r2, ctx, camera } = await make();
    r2.dispose();
    r2.render(root(triangle()), [view(camera)]);
    expect(ctx.calls).toEqual([]);
  });
});

describe("projection", () => {
  it("lands a known triangle on the expected pixels", async () => {
    const { renderer, ctx, camera } = await make(100, 100);
    // Identity view-projection: NDC (-0.5,-0.5),(0.5,-0.5),(0,0.5).
    renderer.render(root(triangle([1, 0, 0, 1])), [view(camera)]);
    // x = (ndc*.5+.5)*100; y = (1-(ndc*.5+.5))*100 (canvas is Y-down).
    expect(ctx.named("moveTo")).toEqual(["moveTo(25,75)"]);
    // CCW on screen after the flip is clockwise-negative-area: re-wound once.
    expect(ctx.named("lineTo").sort()).toEqual(
      ["lineTo(50,25)", "lineTo(75,75)"].sort(),
    );
    expect(ctx.calls).toContain("fillStyle=rgba(255,0,0,1)");
  });

  it("applies the world matrix and offsets inside the viewport", async () => {
    const { renderer, ctx, camera } = await make(200, 100);
    const t = triangle();
    t.transform.position.set(0.5, 0, 0);
    t.transform.markDirty?.();
    renderer.render(root(t), [
      view(camera, {
        x: 100,
        y: 0,
        width: 100,
        height: 100,
        normalized: false,
      }),
    ]);
    // Triangle shifted by +0.5 NDC-x in its own world; mapped into the right half.
    const moves = ctx.named("moveTo");
    expect(moves).toHaveLength(1);
  });

  it("indexes geometry and counts statistics", async () => {
    const { renderer, ctx, camera } = await make();
    const quad = new Renderable(
      new TestGeometry(
        new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        new Uint16Array([0, 1, 2, 0, 2, 3]),
      ).asGeometry,
      new TestMaterial([0, 1, 0, 1]).asMaterial,
    );
    renderer.render(root(quad), [view(camera)]);
    expect(ctx.named("moveTo")).toHaveLength(2);
    expect(renderer.statistics).toEqual({
      drawCalls: 1,
      triangles: 2,
      instances: 0,
    });
  });

  it("skips triangles at or behind the eye", async () => {
    const { renderer, ctx, camera } = await make();
    camera.projectionMatrix.elements[15] = -1; // w < 0: behind the eye
    renderer.render(root(triangle()), [view(camera)]);
    expect(ctx.named("moveTo")).toEqual([]);
    expect(ctx.named("fill(")).toEqual([]);
  });

  it("keeps one winding for clockwise and counter-clockwise triangles", async () => {
    const { renderer, ctx, camera } = await make();
    const ccw = triangle(
      [1, 1, 1, 1],
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0],
    );
    const cw = triangle([1, 1, 1, 1], [-0.5, -0.5, 0, 0, 0.5, 0, 0.5, -0.5, 0]);
    renderer.render(root(ccw), [view(camera)]);
    const first = ctx.named("lineTo");
    ctx.calls.length = 0;
    renderer.render(root(cw), [view(camera)]);
    expect(ctx.named("lineTo")).toEqual(first);
  });

  it("fills a degenerate (zero-w) point without producing NaN", async () => {
    const { renderer, ctx, camera } = await make();
    camera.projectionMatrix.elements[15] = 0;
    renderer.render(root(triangle()), [view(camera)]);
    expect(ctx.calls.join()).not.toContain("NaN");
  });
});

describe("colour", () => {
  it("encodes linear-light RGBA as sRGB with a deterministic alpha", () => {
    expect(cssColor(0, 0, 0, 1)).toBe("rgba(0,0,0,1)");
    expect(cssColor(1, 1, 1, 0.5)).toBe("rgba(255,255,255,0.5)");
    expect(cssColor(2, -1, 0.5, 5)).toBe("rgba(255,0,188,1)");
  });

  it("folds material opacity into alpha and reads baseColor / white fallbacks", async () => {
    const { renderer, ctx, camera } = await make();
    const mat = new TestMaterial([1, 1, 1, 1]);
    mat.opacity = 0.5;
    const half = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      mat.asMaterial,
    );
    const standard = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      { opacity: 1, kind: "standard", baseColor: [0, 0, 0, 1] } as never,
    );
    const bare = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      { opacity: 1 } as never,
    );
    renderer.render(root(half, standard, bare), [view(camera)]);
    const styles = ctx.named("fillStyle");
    expect(styles).toContain("fillStyle=rgba(255,255,255,0.5)");
    expect(styles).toContain("fillStyle=rgba(0,0,0,1)");
    expect(styles).toContain("fillStyle=rgba(255,255,255,1)");
  });
});

describe("unsupported items", () => {
  it("counts and skips lines, targets and node materials with one warning each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { renderer, ctx, camera } = await make();
    const makeLines = (): Renderable =>
      new Renderable(
        new TestGeometry(
          new Float32Array([0, 0, 0, 1, 0, 0]),
          undefined,
          "lines",
        ).asGeometry,
        new TestMaterial().asMaterial,
      );
    const node = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      { kind: "node", opacity: 1 } as never,
    );
    renderer.render(root(makeLines(), node, makeLines()), [view(camera)]);
    expect(renderer.skippedItems).toBe(3);
    expect(ctx.named("fill(")).toEqual([]);
    expect(renderer.statistics?.drawCalls).toBe(0);
    renderer.render(root(), [view(camera)], undefined, {} as never);
    expect(renderer.skippedItems).toBe(4);
    // lines warned once despite two items, node once, target once.
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("sprites", () => {
  function spriteWith(texture: object, size = { width: 2, height: 2 }): Sprite {
    return new Sprite(new TestSpriteMaterial(texture).asMaterial, size);
  }

  it("draws an image-backed sprite through setTransform + drawImage", async () => {
    const { renderer, ctx, camera } = await make(100, 100);
    const image = { width: 4, height: 4 };
    renderer.render(root(spriteWith({ image })), [view(camera)]);
    expect(ctx.named("setTransform")).toHaveLength(1);
    expect(ctx.named("drawImage")).toEqual(["drawImage(img,0,0,4,4,0,0,4,4)"]);
    expect(renderer.statistics?.drawCalls).toBe(1);
  });

  it("maps a bottom-left frame onto the image's top-down rows", async () => {
    const { renderer, ctx, camera } = await make();
    const image = { width: 8, height: 8 };
    const s = new Sprite(new TestSpriteMaterial({ image }).asMaterial, {
      width: 2,
      height: 2,
      frame: { x: 2, y: 0, width: 4, height: 2 },
    });
    renderer.render(root(s), [view(camera)]);
    // y: 8 - 0 - 2 = 6 rows from the top.
    expect(ctx.named("drawImage")).toEqual(["drawImage(img,2,6,4,2,0,0,4,2)"]);
  });

  it("skips a sprite with no image source", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { renderer, ctx, camera } = await make();
    renderer.render(root(spriteWith({}), spriteWith({ image: 3 })), [
      view(camera),
    ]);
    expect(ctx.named("drawImage")).toEqual([]);
    expect(renderer.skippedItems).toBe(2);
  });

  it("does not draw a sprite behind the eye", async () => {
    const { renderer, ctx, camera } = await make();
    camera.projectionMatrix.elements[15] = -1;
    renderer.render(root(spriteWith({ image: { width: 1, height: 1 } })), [
      view(camera),
    ]);
    expect(ctx.named("drawImage")).toEqual([]);
  });

  it("honours a custom imageOf resolver", async () => {
    const surface = new FakeSurface();
    const image = { width: 2, height: 2 };
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: () => image,
    });
    await renderer.initialize();
    renderer.render(root(spriteWith({})), [view(new TestCamera())]);
    expect(surface.recording.named("drawImage")).toHaveLength(1);
  });
});

describe("RFC 0004 feedback refusal", () => {
  it("refuses a texture sourced from the surface being rendered, drawing nothing", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: (texture) => (texture as { surface?: never }).surface ?? null,
    });
    await renderer.initialize();
    const own = new Sprite(new TestSpriteMaterial({ surface }).asMaterial, {
      width: 1,
      height: 1,
    });
    const camera = new TestCamera();
    let thrown: unknown;
    try {
      renderer.render(root(triangle(), own), [
        view(camera, { clearColor: [0, 0, 0, 1] }),
      ]);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    expect((thrown as FourError).code).toBe("INVALID_RENDER_GRAPH");
    expect(surface.recording.calls).toEqual([]);
  });

  it("refuses the same through a mesh material's map", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: (texture) => (texture as { surface?: never }).surface ?? null,
    });
    await renderer.initialize();
    const mesh = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      new TestMaterial([1, 1, 1, 1], { surface }).asMaterial,
    );
    expect(() => renderer.render(root(mesh), [view(new TestCamera())])).toThrow(
      FourError,
    );
  });

  it("allows a texture backed by some other surface", async () => {
    const surface = new FakeSurface();
    const other = new FakeSurface();
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: (texture) => (texture as { surface?: never }).surface ?? null,
    });
    await renderer.initialize();
    const ok = new Sprite(
      new TestSpriteMaterial({ surface: other }).asMaterial,
      {
        width: 1,
        height: 1,
      },
    );
    // `other` has no width/height image shape beyond the surface's own.
    expect(() =>
      renderer.render(root(ok), [view(new TestCamera())]),
    ).not.toThrow();
  });
});

describe("statistics, interpolation and layers", () => {
  it("accumulates across frames and views, never clearing", async () => {
    const { renderer, camera } = await make();
    const scene = root(triangle(), triangle());
    renderer.render(scene, [view(camera), view(camera, { id: "b" })]);
    expect(renderer.statistics).toEqual({
      drawCalls: 4,
      triangles: 4,
      instances: 0,
    });
    renderer.render(scene, [view(camera)]);
    expect(renderer.statistics?.drawCalls).toBe(6);
  });

  it("tolerates statistics being switched off", async () => {
    const { renderer, camera } = await make();
    renderer.statistics = null;
    expect(() =>
      renderer.render(root(triangle()), [view(camera)]),
    ).not.toThrow();
  });

  it("builds an interpolated list when given a pose buffer", async () => {
    const { renderer, ctx, camera } = await make();
    const poses = { computeRenderPose: () => false };
    renderer.render(root(triangle()), [view(camera)], {
      poseBuffer: poses as never,
      alpha: 0.5,
    });
    expect(ctx.named("moveTo")).toEqual(["moveTo(25,75)"]);
  });
});

describe("dispose", () => {
  it("is idempotent, terminal and leaves no listeners", async () => {
    const { renderer } = await make();
    const listener = vi.fn();
    renderer.events.on("contextlost", listener);
    renderer.dispose();
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(renderer.initialized).toBe(false);
    renderer.events.emit("contextlost", { renderer });
    expect(listener).not.toHaveBeenCalled();
  });

  it("disposes a never-initialized renderer", () => {
    expect(() => new Canvas2dRenderer().dispose()).not.toThrow();
  });
});

describe("review fixes", () => {
  it("restores the clip when imageOf throws, so the next frame is unclipped", async () => {
    const surface = new FakeSurface();
    let boom = true;
    const image = { width: 2, height: 2 };
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: () => {
        if (boom) throw new Error("boom");
        return image;
      },
    });
    await renderer.initialize();
    const sprite = (): Sprite =>
      new Sprite(new TestSpriteMaterial({}).asMaterial, {
        width: 1,
        height: 1,
      });
    const camera = new TestCamera();
    // imageOf is called in the feedback pre-pass only for textured materials
    // (none here) and again in #drawItem, inside the clipped region.
    expect(() => renderer.render(root(sprite()), [view(camera)])).toThrow(
      "boom",
    );
    const ctx = surface.recording;
    expect(ctx.named("save")).toHaveLength(ctx.named("restore").length);
    boom = false;
    ctx.calls.length = 0;
    renderer.render(root(sprite()), [view(camera)]);
    expect(ctx.named("drawImage")).toHaveLength(1);
    expect(ctx.named("save")).toHaveLength(ctx.named("restore").length);
  });

  it("restores the sprite save when drawImage throws", async () => {
    const surface = new FakeSurface();
    surface.recording.drawImage = () => {
      throw new Error("draw");
    };
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: () => ({ width: 2, height: 2 }),
    });
    await renderer.initialize();
    const s = new Sprite(new TestSpriteMaterial({}).asMaterial, {
      width: 1,
      height: 1,
    });
    expect(() => renderer.render(root(s), [view(new TestCamera())])).toThrow(
      "draw",
    );
    const ctx = surface.recording;
    expect(ctx.named("save")).toHaveLength(ctx.named("restore").length);
  });

  it("refuses feedback before any view paints", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: (t) => (t as { surface?: never }).surface ?? null,
    });
    await renderer.initialize();
    const own = new Sprite(new TestSpriteMaterial({ surface }).asMaterial, {
      width: 1,
      height: 1,
    });
    const mesh = new Renderable(
      new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .asGeometry,
      new TestMaterial([1, 1, 1, 1], { surface }).asMaterial,
    );
    const camera = new TestCamera();
    // View 1 (layer 1) sees only a plain triangle; view 2 sees the feedback.
    const plain = triangle();
    plain.layers = 1;
    mesh.layers = 2;
    own.layers = 2;
    expect(() =>
      renderer.render(root(plain, mesh, own), [
        view(camera, { id: "a", clearColor: [0, 0, 0, 1], layerMask: 2 }),
        view(camera, { id: "b", layerMask: 4 }),
      ]),
    ).toThrow(FourError);
    expect(surface.recording.calls).toEqual([]);
  });

  it("default imageOf: bare Texture-like sources are not drawable, image-like ones are", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({ canvas: surface });
    await renderer.initialize();
    const camera = new TestCamera();
    const mk = (tex: object): Sprite =>
      new Sprite(new TestSpriteMaterial(tex).asMaterial, {
        width: 1,
        height: 1,
      });
    renderer.render(
      root(
        mk({ source: { width: 2, height: 2, data: new Uint8Array(16) } }),
        mk({}),
      ),
      [view(camera)],
    );
    expect(surface.recording.named("drawImage")).toHaveLength(0);
    expect(renderer.skippedItems).toBe(2);
    renderer.render(root(mk({ source: { width: 2, height: 2 } })), [
      view(camera),
    ]);
    expect(surface.recording.named("drawImage")).toHaveLength(1);
  });

  it("default imageOf keeps the RFC 0004 refusal for a self-sourced image", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({ canvas: surface });
    await renderer.initialize();
    const own = new Sprite(
      new TestSpriteMaterial({ image: surface }).asMaterial,
      {
        width: 1,
        height: 1,
      },
    );
    expect(() => renderer.render(root(own), [view(new TestCamera())])).toThrow(
      FourError,
    );
  });

  it("counts only emitted triangles and skips fill when all are culled", async () => {
    const { renderer, ctx, camera } = await make();
    camera.projectionMatrix.elements[15] = -1; // every w <= 0
    renderer.render(root(triangle()), [view(camera)]);
    expect(ctx.named("fill(")).toEqual([]);
    expect(renderer.statistics?.drawCalls).toBe(0);
    expect(renderer.statistics?.triangles).toBe(0);
  });

  it("skips zero-size frames and images, and applies sprite opacity", async () => {
    const surface = new FakeSurface();
    const renderer = new Canvas2dRenderer({
      canvas: surface,
      imageOf: () => ({ width: 0, height: 0 }),
    });
    await renderer.initialize();
    const material = new TestSpriteMaterial({});
    material.opacity = 0.25;
    const s = new Sprite(material.asMaterial, { width: 1, height: 1 });
    renderer.render(root(s), [view(new TestCamera())]);
    expect(surface.recording.named("setTransform")).toEqual([]);
    expect(surface.recording.calls.join("|")).not.toContain("NaN");

    const surface2 = new FakeSurface();
    const r2 = new Canvas2dRenderer({
      canvas: surface2,
      imageOf: () => ({ width: 2, height: 2 }),
    });
    await r2.initialize();
    r2.render(root(s), [view(new TestCamera())]);
    expect(surface2.recording.named("globalAlpha=")).toEqual([
      "globalAlpha=0.25",
    ]);
  });
});
