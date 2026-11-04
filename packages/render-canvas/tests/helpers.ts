/**
 * Test doubles for the Canvas 2D backend. `@fourjs/render-canvas` depends on
 * core, math and render only (plan §3.1), so cameras, geometry and materials
 * are structural doubles typed from the very types the renderer consumes.
 */

import { Matrix4 } from "@fourjs/math";
import { Renderable, Sprite, type RenderItem } from "@fourjs/render";
import type { Viewport } from "@fourjs/scene";

import type {
  Canvas2dContextLike,
  Canvas2dImageLike,
  Canvas2dSurface,
} from "../src/index.js";

type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = Extract<RenderItem, { kind: "unlit" }>["material"];

/** Records every call as `name(args…)` and every `fillStyle` write. */
export class RecordingContext implements Canvas2dContextLike {
  readonly calls: string[] = [];
  #fillStyle = "";
  #globalAlpha = 1;

  get globalAlpha(): number {
    return this.#globalAlpha;
  }

  set globalAlpha(value: number) {
    this.#globalAlpha = value;
    this.calls.push(`globalAlpha=${String(value)}`);
  }

  get fillStyle(): string {
    return this.#fillStyle;
  }

  set fillStyle(value: string) {
    this.#fillStyle = value;
    this.calls.push(`fillStyle=${value}`);
  }

  #log(name: string, args: readonly unknown[]): void {
    this.calls.push(
      `${name}(${args
        .map((a) =>
          typeof a === "number" ? String(Math.round(a * 1000) / 1000) : "img",
        )
        .join(",")})`,
    );
  }

  save(): void {
    this.#log("save", []);
  }
  restore(): void {
    this.#log("restore", []);
  }
  beginPath(): void {
    this.#log("beginPath", []);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.#log("rect", [x, y, w, h]);
  }
  clip(): void {
    this.#log("clip", []);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.#log("clearRect", [x, y, w, h]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.#log("fillRect", [x, y, w, h]);
  }
  moveTo(x: number, y: number): void {
    this.#log("moveTo", [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.#log("lineTo", [x, y]);
  }
  closePath(): void {
    this.#log("closePath", []);
  }
  fill(): void {
    this.#log("fill", []);
  }
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#log("setTransform", [a, b, c, d, e, f]);
  }
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
  ): void {
    this.#log("drawImage", [image, sx, sy, sw, sh, dx, dy, dw, dh]);
  }

  /** Calls with the given name prefix. */
  named(prefix: string): string[] {
    return this.calls.filter((c) => c.startsWith(prefix));
  }
}

export class FakeSurface implements Canvas2dSurface {
  width: number;
  height: number;
  readonly context: unknown;
  contextRequests = 0;

  constructor(
    width = 100,
    height = 100,
    context: unknown = new RecordingContext(),
  ) {
    this.width = width;
    this.height = height;
    this.context = context;
  }

  getContext(): unknown {
    this.contextRequests += 1;
    return this.context;
  }

  get recording(): RecordingContext {
    return this.context as RecordingContext;
  }
}

export class TestGeometry {
  id = "g";
  version = 0;
  normals = undefined;
  uvs = undefined;
  colors = undefined;
  joints = undefined;
  weights = undefined;
  positions1 = undefined;
  normals1 = undefined;
  constructor(
    public positions: Float32Array,
    public indices?: Uint16Array,
    public mode: "triangles" | "lines" = "triangles",
  ) {}
  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

export class TestMaterial {
  opacity = 1;
  constructor(
    public color: [number, number, number, number] = [1, 1, 1, 1],
    public map: object | null = null,
  ) {}
  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

export class TestSpriteMaterial {
  readonly kind = "sprite" as const;
  opacity = 1;
  constructor(public texture: object) {}
  get asMaterial(): ConstructorParameters<typeof Sprite>[0] {
    return this as unknown as ConstructorParameters<typeof Sprite>[0];
  }
}

/** An orthographic-style camera double: identity projection, identity view. */
export class TestCamera {
  readonly projectionMatrix = new Matrix4();
  readonly viewMatrix = new Matrix4();
  readonly transform = { worldMatrix: new Matrix4() };
  updates = 0;
  updateViewMatrix(): void {
    this.updates += 1;
  }
  get asCamera(): Viewport["camera"] {
    return this as unknown as Viewport["camera"];
  }
}

export function view(
  camera: TestCamera,
  overrides: Partial<Viewport> = {},
): Viewport {
  return {
    id: "main",
    camera: camera.asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

export function triangle(
  color: [number, number, number, number] = [1, 0, 0, 1],
  positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0],
): Renderable {
  return new Renderable(
    new TestGeometry(new Float32Array(positions)).asGeometry,
    new TestMaterial(color).asMaterial,
  );
}

export function root(...children: Renderable[]): Renderable {
  const node = new Renderable(
    new TestGeometry(new Float32Array(0)).asGeometry,
    new TestMaterial().asMaterial,
  );
  for (const child of children) node.add(child);
  return node;
}
