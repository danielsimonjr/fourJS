/**
 * The Canvas 2D backend (§62 backend 3) — a `Renderer` over `buildRenderList`.
 *
 * ```ts
 * const renderer = new Canvas2dRenderer();
 * await renderer.initialize({ canvas });
 * renderer.render(scene, [{ ...createFullscreenViewport(camera), clearColor }]);
 * ```
 *
 * ## What it draws
 *
 * - **Mesh items** (`unlit`, `lit`, `standard`, and skinned items in bind
 *   pose): every triangle is projected through `projection * view * world`
 *   and filled as one flat polygon in the material colour (linear-light in,
 *   sRGB out) with `opacity` as alpha. There is no depth buffer: items paint
 *   in render-list order and triangles in index order, so overlap is
 *   resolved by §64's sort alone. Triangles with a vertex at or behind the
 *   eye are skipped. No lighting, no vertex colours, no textures on meshes.
 * - **Sprites**, with `drawImage`, when the texture resolves to an image
 *   source (see {@link Canvas2dRendererOptions.imageOf}).
 * - **Everything else** (`node` materials, particles, line geometry, sprites
 *   without an image, render targets) is counted in
 *   {@link Canvas2dRenderer.skippedItems} and skipped with one §85 warning.
 *
 * Picking and `readPixels` are **omitted**, not emulated (RFC 0005 Q6).
 *
 * ## Contract kept
 *
 * Nothing in the scene is mutated; an empty `views` array draws and clears
 * nothing; a view without `clearColor` does not clear; the clear and every
 * draw are clipped to the viewport rectangle; `dispose()` is idempotent and
 * leaves no listeners on `events`.
 */

import { DEV, EventEmitter, FourError, devWarnOnce } from "@fourjs/core";
import { Matrix4, linearToSrgb } from "@fourjs/math";
import {
  buildInterpolatedRenderList,
  buildRenderList,
  createRenderStatistics,
  viewLayerMask,
  type RenderInterpolation,
  type RenderItem,
  type RenderStatistics,
  type RenderTarget,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
} from "@fourjs/render";
import type { Node, Viewport } from "@fourjs/scene";

import {
  canvasTop,
  projectPoint,
  resolveViewRect,
  type PixelRect,
  type ProjectedPoint,
} from "./project.js";

/** A drawable image: any host image with a size (`ImageBitmap`, canvas, ...). */
export interface Canvas2dImageLike {
  readonly width: number;
  readonly height: number;
}

/**
 * The 2D context calls this backend makes, described structurally so the
 * package compiles without `lib.dom` and Node tests drive a recording fake.
 */
export interface Canvas2dContextLike {
  fillStyle: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  drawImage(
    image: Canvas2dImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** The drawing surface (`HTMLCanvasElement` / `OffscreenCanvas` fit). */
export interface Canvas2dSurface {
  width: number;
  height: number;
  getContext(contextId: "2d", attributes?: object): unknown;
}

/** Construction options. */
export interface Canvas2dRendererOptions {
  /** The surface; alternatively pass `initialize({ canvas })`. */
  readonly canvas?: Canvas2dSurface;
  /**
   * Maps a sprite texture to a drawable image, or `null`. Default: the
   * texture's own `image` property when it has one. A result that **is the
   * surface being rendered** is refused (RFC 0004: feedback is refused, not
   * drawn).
   */
  readonly imageOf?: (texture: object) => Canvas2dImageLike | null;
  /**
   * Attributes for the one `getContext("2d", ...)` call, e.g.
   * `{ willReadFrequently: true }`. An application that reads pixels back
   * (`getImageData`) should pass it: Chromium otherwise migrates a
   * GPU-backed canvas to software after the first readbacks, which changes
   * antialiasing between frames and breaks §33's byte-identical output.
   */
  readonly contextAttributes?: object;
}

const REQUIRED_METHODS = [
  "save",
  "restore",
  "beginPath",
  "rect",
  "clip",
  "clearRect",
  "fillRect",
  "moveTo",
  "lineTo",
  "closePath",
  "fill",
  "setTransform",
  "drawImage",
] as const;

function isSurface(value: unknown): value is Canvas2dSurface {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Canvas2dSurface).getContext === "function"
  );
}

function isContext(value: unknown): value is Canvas2dContextLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED_METHODS.every(
    (name) => typeof candidate[name] === "function",
  );
}

function defaultImageOf(texture: object): Canvas2dImageLike | null {
  const image = (texture as { image?: unknown }).image;
  return typeof image === "object" && image !== null
    ? (image as Canvas2dImageLike)
    : null;
}

/** A linear-light RGBA tuple as a CSS colour, sRGB-encoded, deterministic. */
export function cssColor(r: number, g: number, b: number, a: number): string {
  const channel = (v: number): number =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
  const alpha = Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;
  return `rgba(${String(channel(r))},${String(channel(g))},${String(channel(b))},${String(alpha)})`;
}

interface TexturedMaterial {
  readonly map?: object | null;
  readonly texture?: object | null;
}

/** Draws fourJS scenes with Canvas 2D (§62). */
export class Canvas2dRenderer implements Renderer {
  readonly capabilities: RendererCapabilities = {
    backend: "canvas2d",
    maxTextureSize: 4096,
  };
  readonly events = new EventEmitter<RendererEventMap>();
  statistics: RenderStatistics | null = createRenderStatistics();

  /** Items this backend could not draw, accumulated across frames. */
  skippedItems = 0;

  #surface: Canvas2dSurface | null;
  #context: Canvas2dContextLike | null = null;
  #disposed = false;
  #bufferWidth = 0;
  #bufferHeight = 0;
  readonly #imageOf: (texture: object) => Canvas2dImageLike | null;
  readonly #contextAttributes: object | undefined;
  readonly #items: RenderItem[] = [];
  readonly #rect: PixelRect = { x: 0, y: 0, width: 0, height: 0 };
  readonly #viewProjection = new Matrix4();
  readonly #matrix = new Matrix4();
  readonly #a: ProjectedPoint = { x: 0, y: 0, w: 0 };
  readonly #b: ProjectedPoint = { x: 0, y: 0, w: 0 };
  readonly #c: ProjectedPoint = { x: 0, y: 0, w: 0 };

  constructor(options: Canvas2dRendererOptions = {}) {
    this.#surface = options.canvas ?? null;
    this.#imageOf = options.imageOf ?? defaultImageOf;
    this.#contextAttributes = options.contextAttributes;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get initialized(): boolean {
    return this.#context !== null;
  }

  initialize(options?: RendererOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#initialize(options);
      resolve();
    });
  }

  #initialize(options?: RendererOptions): void {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Canvas2dRenderer.initialize() called after dispose().",
      );
    }
    const candidate = options?.canvas ?? this.#surface;
    if (!isSurface(candidate)) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The Canvas 2D backend needs a canvas: pass one as " +
          "`initialize({ canvas })` (§61, §45).",
        { context: { received: typeof candidate } },
      );
    }
    const context = candidate.getContext("2d", this.#contextAttributes);
    if (!isContext(context)) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The canvas did not hand out a 2D context (it may already hold " +
          "another context type).",
      );
    }
    this.#surface = candidate;
    this.#context = context;
    this.#bufferWidth = candidate.width;
    this.#bufferHeight = candidate.height;
  }

  resize(width: number, height: number, resolution = 1): void {
    const surface = this.#surface;
    this.#bufferWidth = Math.round(width * resolution);
    this.#bufferHeight = Math.round(height * resolution);
    if (surface !== null) {
      surface.width = this.#bufferWidth;
      surface.height = this.#bufferHeight;
    }
  }

  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void {
    const context = this.#context;
    if (context === null || this.#disposed || views.length === 0) return;
    if (target != null) {
      this.#skip("render-target", "off-screen render targets");
      return;
    }
    for (const view of views) {
      const mask = viewLayerMask(view);
      const items =
        interpolation === undefined
          ? buildRenderList(root, this.#items, mask)
          : buildInterpolatedRenderList(
              root,
              interpolation.poseBuffer,
              interpolation.alpha,
              this.#items,
              mask,
            );
      // Refuse before the first mark is made: a refused frame draws nothing.
      this.#assertNoFeedback(items);
      this.#drawView(context, view, items);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#context = null;
    this.#surface = null;
    this.#items.length = 0;
    this.events.removeAllListeners();
  }

  #skip(key: string, what: string): void {
    this.skippedItems += 1;
    if (DEV) {
      devWarnOnce(
        `render-canvas:${key}`,
        `The Canvas 2D backend does not draw ${what}; skipped (§62).`,
      );
    }
  }

  #assertNoFeedback(items: readonly RenderItem[]): void {
    const surface = this.#surface;
    for (const item of items) {
      const material = item.material as TexturedMaterial | undefined;
      const texture = material?.texture ?? material?.map;
      if (texture == null) continue;
      if ((this.#imageOf(texture) as unknown) === surface) {
        throw new FourError(
          "INVALID_RENDER_GRAPH",
          "A texture sourced from the surface being rendered would sample " +
            "its own output: feedback loops are refused, not drawn " +
            "(RFC 0004).",
          { context: { materialId: item.materialId } },
        );
      }
    }
  }

  #drawView(
    context: Canvas2dContextLike,
    view: Viewport,
    items: readonly RenderItem[],
  ): void {
    const rect = resolveViewRect(
      view,
      this.#bufferWidth,
      this.#bufferHeight,
      this.#rect,
    );
    const top = canvasTop(rect, this.#bufferHeight);
    context.save();
    // Everything below, clear included, is confined to the view rectangle.
    context.beginPath();
    context.rect(rect.x, top, rect.width, rect.height);
    context.clip();
    const clear = view.clearColor;
    if (clear !== undefined) {
      context.clearRect(rect.x, top, rect.width, rect.height);
      context.fillStyle = cssColor(clear[0], clear[1], clear[2], clear[3]);
      context.fillRect(rect.x, top, rect.width, rect.height);
    }
    if (items.length > 0) {
      const camera = view.camera;
      camera.updateViewMatrix();
      this.#viewProjection
        .copy(camera.projectionMatrix)
        .multiply(camera.viewMatrix);
      for (const item of items) {
        this.#drawItem(context, item, rect, top);
      }
    }
    context.restore();
  }

  #drawItem(
    context: Canvas2dContextLike,
    item: RenderItem,
    rect: PixelRect,
    top: number,
  ): void {
    switch (item.kind) {
      case "unlit":
      case "lit":
      case "standard":
      case "skinned-unlit":
      case "skinned-lit": {
        // A container node carries an empty geometry: nothing to draw.
        if (item.geometry.positions.length === 0) return;
        if (item.geometry.mode !== "triangles") {
          this.#skip("lines", "line geometry");
          return;
        }
        const m = item.material;
        const color = (m as { color?: readonly number[] }).color ??
          (m as { baseColor?: readonly number[] }).baseColor ?? [1, 1, 1, 1];
        context.fillStyle = cssColor(
          color[0],
          color[1],
          color[2],
          color[3] * m.opacity,
        );
        this.#fillMesh(context, item, rect, top);
        return;
      }
      case "sprite": {
        const texture = item.material.texture;
        const image = this.#imageOf(texture);
        if (image === null) {
          this.#skip("sprite-no-image", "sprites without an image source");
          return;
        }
        this.#drawSprite(context, item, image, rect, top);
        return;
      }
      case "particles":
        this.#skip("particles", "particle systems");
        return;
      case "node":
        this.#skip("node", "node materials");
        return;
    }
  }

  #fillMesh(
    context: Canvas2dContextLike,
    item: RenderItem,
    rect: PixelRect,
    top: number,
  ): void {
    const geometry = item.geometry;
    const positions = geometry.positions;
    const indices = geometry.indices;
    const count = indices === undefined ? positions.length / 3 : indices.length;
    const triangles = Math.floor(count / 3);
    const mvp = this.#matrix
      .copy(this.#viewProjection)
      .multiply(item.worldMatrix).elements;
    const a = this.#a;
    const b = this.#b;
    const c = this.#c;
    context.beginPath();
    for (let t = 0; t < triangles; t += 1) {
      const i0 = indices === undefined ? t * 3 : indices[t * 3];
      const i1 = indices === undefined ? t * 3 + 1 : indices[t * 3 + 1];
      const i2 = indices === undefined ? t * 3 + 2 : indices[t * 3 + 2];
      projectPoint(
        mvp,
        positions[i0 * 3],
        positions[i0 * 3 + 1],
        positions[i0 * 3 + 2],
        rect,
        top,
        a,
      );
      projectPoint(
        mvp,
        positions[i1 * 3],
        positions[i1 * 3 + 1],
        positions[i1 * 3 + 2],
        rect,
        top,
        b,
      );
      projectPoint(
        mvp,
        positions[i2 * 3],
        positions[i2 * 3 + 1],
        positions[i2 * 3 + 2],
        rect,
        top,
        c,
      );
      if (a.w <= 0 || b.w <= 0 || c.w <= 0) continue;
      // One winding for every triangle: with the non-zero rule, a front and a
      // back face of opposite winding would otherwise cancel where they overlap.
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      context.moveTo(a.x, a.y);
      if (area >= 0) {
        context.lineTo(b.x, b.y);
        context.lineTo(c.x, c.y);
      } else {
        context.lineTo(c.x, c.y);
        context.lineTo(b.x, b.y);
      }
      context.closePath();
    }
    context.fill();
    if (this.statistics !== null) {
      this.statistics.drawCalls += 1;
      this.statistics.triangles += triangles;
    }
  }

  #drawSprite(
    context: Canvas2dContextLike,
    item: RenderItem,
    image: Canvas2dImageLike,
    rect: PixelRect,
    top: number,
  ): void {
    const positions = item.geometry.positions;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
    }
    const mvp = this.#matrix
      .copy(this.#viewProjection)
      .multiply(item.worldMatrix).elements;
    const origin = projectPoint(mvp, minX, maxY, 0, rect, top, this.#a);
    const right = projectPoint(mvp, maxX, maxY, 0, rect, top, this.#b);
    const down = projectPoint(mvp, minX, minY, 0, rect, top, this.#c);
    if (origin.w <= 0 || right.w <= 0 || down.w <= 0) return;
    // Frame is bottom-left-origin texels (§55); images are top-down.
    const frame = (
      item as {
        frame?: { x: number; y: number; width: number; height: number } | null;
      }
    ).frame;
    const sw = frame?.width ?? image.width;
    const sh = frame?.height ?? image.height;
    const sx = frame?.x ?? 0;
    const sy =
      frame === null || frame === undefined
        ? 0
        : image.height - frame.y - frame.height;
    context.save();
    context.setTransform(
      (right.x - origin.x) / sw,
      (right.y - origin.y) / sw,
      (down.x - origin.x) / sh,
      (down.y - origin.y) / sh,
      origin.x,
      origin.y,
    );
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    context.restore();
    if (this.statistics !== null) {
      this.statistics.drawCalls += 1;
      this.statistics.triangles += 2;
    }
  }
}
