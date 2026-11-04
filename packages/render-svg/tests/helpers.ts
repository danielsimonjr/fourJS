import { Matrix4 } from "@fourjs/math";
import { Renderable, type Renderer } from "@fourjs/render";

import type { SvgElement, SvgSurface } from "../src/index.js";

export class FakeElement implements SvgElement {
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  writes = 0;

  constructor(readonly tag: string) {}

  setAttribute(name: string, value: string): void {
    this.writes += 1;
    this.attrs.set(name, value);
  }

  appendChild(child: never): unknown {
    this.children.push(child);
    return child;
  }

  removeChild(child: never): unknown {
    this.children.splice(this.children.indexOf(child), 1);
    return child;
  }

  get outerHTML(): string {
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.tag}${attrs}>${this.children.map((c) => c.outerHTML).join("")}</${this.tag}>`;
  }
}

export class FakeSurface extends FakeElement implements SvgSurface {
  created = 0;
  readonly ownerDocument = {
    createElementNS: (_ns: string, name: string): FakeElement => {
      this.created += 1;
      return new FakeElement(name);
    },
  };

  constructor() {
    super("svg");
  }
}

type Root = Parameters<Renderer["render"]>[0];
type Views = Parameters<Renderer["render"]>[1];

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
  mode: "triangles" | "lines" = "triangles";
  constructor(
    public positions: Float32Array,
    public indices?: Uint16Array,
  ) {}
  get vertexCount(): number {
    return this.positions.length / 3;
  }
}

export interface TestMaterial {
  color: [number, number, number, number];
  opacity?: number;
}

/** A triangle at world (-1,-1) (1,-1) (0,1), z = 0. */
export function triangle(
  material: TestMaterial = { color: [1, 0, 0, 1] },
  geometry = new TestGeometry(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0])),
): Renderable {
  return new Renderable(geometry as never, material as never);
}

/** Parent holding `children`, world matrices resolved. */
export function sceneOf(...children: Renderable[]): Renderable {
  const root = new Renderable(
    new TestGeometry(new Float32Array(0)) as never,
    { color: [1, 1, 1, 1] } as never,
  );
  for (const child of children) root.add(child);
  return root;
}

export function camera(): never {
  // Orthographic, [-2,2]^2: NDC = world / 2.
  const projection = new Matrix4();
  projection.elements[0] = 0.5;
  projection.elements[5] = 0.5;
  return {
    projectionMatrix: projection,
    viewMatrix: new Matrix4(),
    transform: { worldMatrix: new Matrix4() },
    layers: undefined,
    updateViewMatrix(): void {},
  } as never;
}

export function views(
  clearColor?: [number, number, number, number],
  extra: Record<string, unknown> = {},
): Views {
  return [
    {
      id: "main",
      camera: camera(),
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      ...(clearColor === undefined ? {} : { clearColor }),
      ...extra,
    },
  ] as never;
}

export type { Root };
