/**
 * The SVG backend (§62 rung `svg`) — a retained-mode vector renderer.
 *
 * ```ts
 * const renderer = new SvgRenderer();
 * await renderer.initialize({ canvas: svgElement });
 * renderer.render(scene, views);
 * ```
 *
 * Each frame the scene's unlit triangles are projected on the CPU and written
 * as `<polygon points="…" fill="…">` children of the surface, after one
 * background `<rect>` per view that has a `clearColor`. The elements are
 * **retained**: slot *n* of the frame reuses slot *n*'s element from the last
 * frame, and an attribute is written only when its text changed, so a static
 * scene costs no DOM mutation at all and two runs of one scene serialize
 * byte-identically (§33). The element count grows only when the draw count
 * does, and extras are removed.
 *
 * This package compiles without `lib.dom`; the surface is the structural
 * {@link SvgSurface}, so Node tests drive it with a recording fake.
 *
 * ## Scope (deliberate)
 *
 * Only `"unlit"` triangle items are drawn, flat-filled in painter's (list)
 * order with no depth test, no back-face culling, no per-view clipping and no
 * texture. Every other item kind is counted in {@link SvgRenderer.skippedItems}
 * and skipped, with one development warning per kind. Triangles with any
 * vertex at or behind the camera plane (`w <= 0`) are dropped.
 *
 * ## Coordinates (§7a, §48)
 *
 * The world is Y-up; SVG is Y-down. Projection maps NDC `(x, y)` to
 * `px = left + (x + 1) / 2 * width`, `py = top + (1 - y) / 2 * height`, where
 * `top = surfaceHeight - (view.y + view.height)` because view rectangles are
 * bottom-left-origin. `viewBox` is `0 0 W H` in drawing-buffer pixels.
 */

import { DEV, EventEmitter, FourError, devWarnOnce } from "@fourjs/core";
import { Matrix4 } from "@fourjs/math";
import {
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  type RenderInterpolation,
  type RenderItem,
  type RenderStatistics,
  type RenderTarget,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
} from "@fourjs/render";

// `@fourjs/scene` is outside this package's dependency matrix; the types are
// derived from the interface that already names them.
type Node = Parameters<Renderer["render"]>[0];
type Viewport = Parameters<Renderer["render"]>[1][number];

/** The SVG namespace, passed to `createElementNS`. */
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The slice of an SVG element the backend writes (a DOM `Element` satisfies it). */
export interface SvgElement {
  setAttribute(name: string, value: string): void;
  appendChild(child: never): unknown;
  removeChild(child: never): unknown;
}

/** A `createElementNS`-like element factory (a DOM `Document` satisfies it). */
export interface SvgElementFactory {
  createElementNS(namespace: string, name: string): SvgElement;
}

/**
 * The structural `<svg>` root: an element that also reaches a factory through
 * `ownerDocument`, exactly as a DOM `SVGSVGElement` does.
 */
export interface SvgSurface extends SvgElement {
  readonly ownerDocument: SvgElementFactory;
}

const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Whether `value` has the {@link SvgSurface} shape. */
export function isSvgSurface(value: unknown): value is SvgSurface {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const owner = candidate["ownerDocument"] as Record<string, unknown> | null;
  return (
    typeof candidate["setAttribute"] === "function" &&
    typeof candidate["appendChild"] === "function" &&
    typeof candidate["removeChild"] === "function" &&
    typeof owner === "object" &&
    owner !== null &&
    typeof owner["createElementNS"] === "function"
  );
}

interface Slot {
  readonly tag: "rect" | "polygon";
  readonly element: SvgElement;
  /** Last-written attribute text, so an unchanged attribute is not rewritten. */
  readonly v: string[];
  fill: string;
  fillOpacity: string;
}

const viewProjection = new Matrix4();

/** Deterministic, locale-free number text: 3 decimals, trailing zeros trimmed. */
function num(value: number): string {
  const text = value.toFixed(3);
  if (text.indexOf(".") < 0) return text;
  let end = text.length;
  while (text.charCodeAt(end - 1) === 48) end -= 1;
  if (text.charCodeAt(end - 1) === 46) end -= 1;
  const out = text.slice(0, end);
  return out === "-0" ? "0" : out;
}

function channel(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function rgb(color: ArrayLike<number>): string {
  return `rgb(${String(channel(color[0]))},${String(channel(color[1]))},${String(channel(color[2]))})`;
}

/** Retained-mode SVG implementation of {@link Renderer} (§61, §62). */
export class SvgRenderer implements Renderer {
  readonly capabilities: RendererCapabilities = Object.freeze({
    backend: "svg",
    maxTextureSize: 0,
    multisampling: false,
    floatRenderTargets: false,
    computeShaders: false,
    shaderPrecision: "none",
  } satisfies RendererCapabilities);

  readonly events = new EventEmitter<RendererEventMap>();

  /** §84 counters: `drawCalls` and `triangles` count polygons written. */
  statistics: RenderStatistics | null = null;

  /** Render items skipped for want of support, cumulative. */
  skippedItems = 0;

  #surface: SvgSurface | null;
  #slots: Slot[] = [];
  #list: RenderItem[] = [];
  #viewList: RenderItem[] = [];
  #width = 0;
  #height = 0;
  #viewBox = "";
  #disposed = false;

  constructor(surface?: SvgSurface) {
    this.#surface = surface ?? null;
  }

  /** Number of elements this renderer currently owns on the surface. */
  get elementCount(): number {
    return this.#slots.length;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  initialize(options?: RendererOptions): Promise<void> {
    this.#assertUsable("initialize");
    const candidate = options?.canvas ?? this.#surface;
    if (!isSvgSurface(candidate)) {
      return Promise.reject(
        new FourError(
          "RENDERER_INITIALIZATION_FAILED",
          'SvgRenderer needs an <svg> surface (pass it as options.canvas or to the constructor); the "svg" backend cannot draw without one (§62).',
          { context: { backend: "svg" } },
        ),
      );
    }
    this.#surface = candidate;
    return Promise.resolve();
  }

  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.#setSize(
      Math.round(width * resolution),
      Math.round(height * resolution),
    );
    const surface = this.#surface;
    if (surface !== null) {
      surface.setAttribute("width", num(width));
      surface.setAttribute("height", num(height));
    }
  }

  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void {
    this.#assertUsable("render");
    void target;
    const surface = this.#surface;
    if (surface === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "SvgRenderer.render() was called before initialize() gave it a surface (§83).",
        { context: { method: "render" } },
      );
    }
    if (views.length === 0) return;
    if (this.#width === 0 || this.#height === 0) this.#sizeFromViews(views);
    const width = this.#width;
    const height = this.#height;
    const stats = this.statistics;

    const items =
      interpolation === undefined
        ? buildRenderList(root, this.#list)
        : buildInterpolatedRenderList(
            root,
            interpolation.poseBuffer,
            interpolation.alpha,
            this.#list,
          );

    let used = 0;
    for (const view of views) {
      const scaleX = view.normalized === true ? width : 1;
      const scaleY = view.normalized === true ? height : 1;
      const vx = view.x * scaleX;
      const vw = view.width * scaleX;
      const vh = view.height * scaleY;
      const top = height - (view.y * scaleY + vh);
      const clear = view.clearColor;
      if (clear !== undefined) {
        const slot = this.#slot(used, "rect");
        used += 1;
        this.#write(slot, 0, "x", num(vx));
        this.#write(slot, 1, "y", num(top));
        this.#write(slot, 2, "width", num(vw));
        this.#write(slot, 3, "height", num(vh));
        this.#fill(slot, clear);
      }
      const camera = view.camera;
      camera.updateViewMatrix();
      viewProjection.copy(camera.projectionMatrix).multiply(camera.viewMatrix);
      const m = viewProjection.elements;
      const viewItems = buildViewRenderList(items, view, this.#viewList);
      for (const item of viewItems) {
        if (item.kind !== "unlit" || item.geometry.mode !== "triangles") {
          this.skippedItems += 1;
          if (DEV) {
            devWarnOnce(
              `render-svg:skip:${item.kind}:${item.geometry.mode}`,
              `SvgRenderer draws unlit triangles only; skipped a "${item.kind}" item with mode "${item.geometry.mode}" (§62).`,
            );
          }
          continue;
        }
        const w = item.worldMatrix.elements;
        const pos = item.geometry.positions;
        const idx = item.geometry.indices;
        const triCount = Math.floor(
          (idx === undefined ? pos.length / 3 : idx.length) / 3,
        );
        const color = item.material.color;
        const opacity = (item.material.opacity ?? 1) * color[3];
        for (let t = 0; t < triCount; t += 1) {
          let points = "";
          let ok = true;
          for (let k = 0; k < 3; k += 1) {
            const v = idx === undefined ? t * 3 + k : idx[t * 3 + k];
            const px = pos[v * 3];
            const py = pos[v * 3 + 1];
            const pz = pos[v * 3 + 2];
            const wx = w[0] * px + w[4] * py + w[8] * pz + w[12];
            const wy = w[1] * px + w[5] * py + w[9] * pz + w[13];
            const wz = w[2] * px + w[6] * py + w[10] * pz + w[14];
            const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
            if (!(cw > 0)) {
              ok = false;
              break;
            }
            const cx = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
            const cy = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
            points += `${k === 0 ? "" : " "}${num(vx + ((cx + 1) / 2) * vw)},${num(top + ((1 - cy) / 2) * vh)}`;
          }
          if (!ok) continue;
          const slot = this.#slot(used, "polygon");
          used += 1;
          this.#write(slot, 0, "points", points);
          this.#fill(slot, color, opacity);
          if (stats !== null) {
            stats.drawCalls += 1;
            stats.triangles += 1;
          }
        }
      }
    }
    this.#truncate(used);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#truncate(0);
    this.#surface = null;
    this.events.removeAllListeners();
  }

  #setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    const viewBox = `0 0 ${String(width)} ${String(height)}`;
    if (viewBox !== this.#viewBox && this.#surface !== null) {
      this.#viewBox = viewBox;
      this.#surface.setAttribute("viewBox", viewBox);
    }
  }

  #sizeFromViews(views: readonly Viewport[]): void {
    let w = 0;
    let h = 0;
    for (const view of views) {
      if (view.normalized === true) continue;
      w = Math.max(w, view.x + view.width);
      h = Math.max(h, view.y + view.height);
    }
    this.#setSize(Math.round(w) || 1, Math.round(h) || 1);
  }

  /** The element for slot `index`, created/replaced only when needed. */
  #slot(index: number, tag: "rect" | "polygon"): Slot {
    const slots = this.#slots;
    const existing = slots[index] as Slot | undefined;
    if (existing !== undefined) {
      if (existing.tag === tag) return existing;
      this.#truncate(index);
    }
    const surface = this.#surface as SvgSurface;
    const element = surface.ownerDocument.createElementNS(SVG_NAMESPACE, tag);
    surface.appendChild(element as never);
    const slot: Slot = {
      tag,
      element,
      v: ["", "", "", ""],
      fill: "",
      fillOpacity: "1",
    };
    slots.push(slot);
    return slot;
  }

  #write(slot: Slot, field: 0 | 1 | 2 | 3, name: string, value: string): void {
    if (slot.v[field] !== value) {
      slot.v[field] = value;
      slot.element.setAttribute(name, value);
    }
  }

  #fill(slot: Slot, color: ArrayLike<number>, opacity = color[3]): void {
    const element = slot.element;
    const fill = rgb(color);
    if (slot.fill !== fill) {
      slot.fill = fill;
      element.setAttribute("fill", fill);
    }
    const o = num(Math.min(1, Math.max(0, opacity)));
    if (slot.fillOpacity !== o) {
      slot.fillOpacity = o;
      element.setAttribute("fill-opacity", o);
    }
  }

  #truncate(keep: number): void {
    const surface = this.#surface;
    const slots = this.#slots;
    while (slots.length > keep) {
      const slot = slots.pop() as Slot;
      surface?.removeChild(slot.element as never);
    }
  }

  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `SvgRenderer.${method}() was called on a disposed renderer; disposal is terminal (§83).`,
        { context: { method, disposed: true } },
      );
    }
  }
}
