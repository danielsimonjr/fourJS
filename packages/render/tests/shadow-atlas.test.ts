import { resetDevWarnings } from "@fourjs/core";
import { Matrix4, Vector3 } from "@fourjs/math";
import {
  DirectionalLight,
  PerspectiveCamera,
  OrthographicCamera,
  PointLight,
  Scene,
  SpotLight,
} from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_SHADOWED_PUNCTUAL_LIGHTS,
  MAX_SHADOW_TILES,
  SHADOW_CUBE_FACES,
  SHADOW_KIND_POINT,
  SHADOW_KIND_SPOT,
  collectSceneLights,
  computeAtlasGrid,
  computeCascadeSplits,
  createSceneLights,
  fitDirectionalCascades,
  writeCubeFaceShadowMatrix,
  writeSpotShadowMatrix,
  type ShadowFitCamera,
} from "../src/index.js";

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

function project(m: Matrix4, x: number, y: number, z: number): number[] {
  const e = m.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [
    (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
    (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  ];
}

function sun(options: ConstructorParameters<typeof DirectionalLight>[0] = {}) {
  const light = new DirectionalLight({ castShadow: true, ...options });
  // Shine down −Y.
  light.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  return light;
}

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera({
    fieldOfView: Math.PI / 3,
    aspect: 1.5,
    near: 0.5,
    far: 200,
  });
  cam.transform.position.set(0, 5, 10);
  cam.updateProjectionMatrix();
  cam.updateViewMatrix();
  return cam;
}

describe("computeCascadeSplits", () => {
  it("blends logarithmic and uniform splits and ends exactly at far", () => {
    const out = new Float32Array(4);
    computeCascadeSplits(1, 100, 4, 0, out);
    expect([...out]).toEqual([25.75, 50.5, 75.25, 100]);
    computeCascadeSplits(1, 100, 4, 1, out);
    expect(out[0]).toBeCloseTo(100 ** 0.25, 4);
    expect(out[3]).toBe(100);
    computeCascadeSplits(1, 100, 2, 0.5, out);
    expect(out[0]).toBeCloseTo(0.5 * 10 + 0.5 * 50.5, 4);
    expect([out[2], out[3]]).toEqual([0, 0]);
  });
});

describe("computeAtlasGrid", () => {
  it("packs n tiles into ceil(sqrt n) columns", () => {
    const out: number[] = [0, 0, 0, 0];
    computeAtlasGrid(1, 512, out);
    expect(out).toEqual([1, 1, 512, 512]);
    computeAtlasGrid(4, 256, out);
    expect(out).toEqual([2, 2, 512, 512]);
    computeAtlasGrid(7, 100, out);
    expect(out).toEqual([3, 3, 300, 300]);
    computeAtlasGrid(0, 100, out);
    expect(out).toEqual([1, 1, 100, 100]);
  });
});

describe("fitDirectionalCascades", () => {
  it("fits nested volumes that contain the slice and are shimmer-stable", () => {
    const cam = camera();
    const matrices = Array.from({ length: 4 }, () => new Matrix4());
    const splits = new Float32Array(4);
    const row = new Float32Array(4);
    expect(
      fitDirectionalCascades(
        cam,
        0,
        -1,
        0,
        3,
        0.5,
        100,
        1024,
        100,
        splits,
        row,
        matrices,
      ),
    ).toBe(true);
    expect(splits[2]).toBe(100);
    // Camera forward is −Z: depth of a point 10 m ahead of the camera is 10.
    expect(row[0] * 0 + row[1] * 5 + row[2] * 10 + row[3]).toBeCloseTo(0, 5);
    expect(row[2]).toBeCloseTo(-1, 5);
    // A point on the optical axis at the middle of each slice lands in [-1,1]^3.
    let sliceNear = 0.5;
    for (let c = 0; c < 3; c += 1) {
      const d = (sliceNear + splits[c]) * 0.5;
      const p = project(matrices[c], 0, 5, 10 - d);
      expect(Math.abs(p[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(p[1])).toBeLessThanOrEqual(1);
      expect(p[2]).toBeGreaterThanOrEqual(-1);
      expect(p[2]).toBeLessThanOrEqual(1);
      sliceNear = splits[c];
    }
    // Deterministic: a second fit is bit-identical.
    const again = Array.from({ length: 4 }, () => new Matrix4());
    fitDirectionalCascades(
      cam,
      0,
      -1,
      0,
      3,
      0.5,
      100,
      1024,
      100,
      splits,
      row,
      again,
    );
    expect([...again[1].elements]).toEqual([...matrices[1].elements]);
  });

  it("handles a vertical sun, an orthographic camera and a degenerate one", () => {
    const matrices = Array.from({ length: 4 }, () => new Matrix4());
    const splits = new Float32Array(4);
    const row = new Float32Array(4);
    const ortho = new OrthographicCamera({
      left: -5,
      right: 5,
      bottom: -5,
      top: 5,
      near: 0.1,
      far: 50,
    });
    ortho.updateProjectionMatrix();
    ortho.updateViewMatrix();
    expect(
      fitDirectionalCascades(
        ortho,
        0,
        1,
        0,
        2,
        0,
        100,
        512,
        50,
        splits,
        row,
        matrices,
      ),
    ).toBe(true);
    const bad: ShadowFitCamera = {
      near: 1,
      far: 10,
      projectionMatrix: new Matrix4().identity(),
      viewMatrix: new Matrix4(),
    };
    bad.projectionMatrix.elements[0] = 0;
    expect(
      fitDirectionalCascades(
        bad,
        0,
        -1,
        0,
        2,
        0,
        100,
        512,
        50,
        splits,
        row,
        matrices,
      ),
    ).toBe(false);
    expect(
      fitDirectionalCascades(
        { ...bad, near: 5, far: 4 },
        0,
        -1,
        0,
        2,
        0,
        100,
        512,
        50,
        splits,
        row,
        matrices,
      ),
    ).toBe(false);
  });
});

describe("punctual shadow matrices", () => {
  it("projects a point in front of a spot into the unit cube", () => {
    const m = writeSpotShadowMatrix(
      new Matrix4(),
      0,
      4,
      0,
      0,
      -1,
      0,
      Math.PI / 6,
      0.1,
      20,
    );
    const p = project(m, 0, 0, 0);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeGreaterThan(-1);
    expect(p[2]).toBeLessThan(1);
    // Clamps absurd cones instead of producing a degenerate projection.
    const wide = writeSpotShadowMatrix(
      new Matrix4(),
      0,
      0,
      0,
      0,
      0,
      -1,
      3,
      0.1,
      10,
    );
    expect(Number.isFinite(wide.elements[0])).toBe(true);
  });

  it("builds six 90 degree faces whose axes agree with the table", () => {
    for (let face = 0; face < 6; face += 1) {
      const m = writeCubeFaceShadowMatrix(
        new Matrix4(),
        face,
        1,
        2,
        3,
        0.1,
        30,
      );
      const f = SHADOW_CUBE_FACES[face];
      const p = project(
        m,
        1 + f.forward[0] * 5,
        2 + f.forward[1] * 5,
        3 + f.forward[2] * 5,
      );
      expect(p[0]).toBeCloseTo(0, 6);
      expect(p[1]).toBeCloseTo(0, 6);
      // right = forward × up is +x in the face's clip space.
      const q = project(
        m,
        1 + f.forward[0] * 5 + f.right[0],
        2 + f.forward[1] * 5 + f.right[1],
        3 + f.forward[2] * 5 + f.right[2],
      );
      expect(q[0]).toBeGreaterThan(0);
    }
  });
});

describe("collectSceneLights — cascades and punctual shadows (W6.3)", () => {
  it("keeps cascades = 1 on the single-volume path", () => {
    const scene = new Scene();
    scene.add(sun());
    const out = collectSceneLights(scene, createSceneLights());
    expect(out.shadowCascadeCount).toBe(1);
    expect(out.shadowExtended).toBe(false);
    expect([
      out.shadowTileCount,
      out.shadowAtlasWidth,
      out.shadowAtlasHeight,
    ]).toEqual([1, 1024, 1024]);
    expect([...out.shadowTileMatrices[0].elements]).toEqual([
      ...out.shadowMatrix.elements,
    ]);
  });

  it("fits cascades to the camera and lays them out as a 2x2 atlas", () => {
    const scene = new Scene();
    const light = sun({ shadow: { cascades: 4, mapSize: 512 } });
    scene.add(light);
    const out = collectSceneLights(
      scene,
      createSceneLights(),
      undefined,
      camera(),
    );
    expect(out.shadowCascadeCount).toBe(4);
    expect(out.shadowExtended).toBe(true);
    expect([out.shadowAtlasColumns, out.shadowAtlasRows]).toEqual([2, 2]);
    expect([out.shadowAtlasWidth, out.shadowAtlasHeight]).toEqual([1024, 1024]);
    expect(out.shadowCascadeSplits[3]).toBe(100);
    expect([...out.shadowCascadeMatrices.subarray(16, 32)]).toEqual(
      [...out.shadowTileMatrices[1].elements].map((v) => Math.fround(v)),
    );
    expect([...out.shadowMatrix.elements]).toEqual([
      ...out.shadowTileMatrices[0].elements,
    ]);
  });

  it("falls back to one cascade without a usable camera", () => {
    const scene = new Scene();
    scene.add(sun({ shadow: { cascades: 3 } }));
    expect(
      collectSceneLights(scene, createSceneLights()).shadowCascadeCount,
    ).toBe(1);
    const bad: ShadowFitCamera = {
      near: 1,
      far: 2,
      projectionMatrix: new Matrix4(),
      viewMatrix: new Matrix4(),
    };
    bad.projectionMatrix.elements[0] = 0;
    expect(
      collectSceneLights(scene, createSceneLights(), undefined, bad)
        .shadowCascadeCount,
    ).toBe(1);
  });

  it("assigns spot and point tiles after the cascades in scene order", () => {
    const scene = new Scene();
    scene.add(sun({ shadow: { cascades: 2, mapSize: 256 } }));
    const spot = new SpotLight({
      castShadow: true,
      outerConeAngle: 0.5,
      shadow: { mapSize: 512 },
    });
    spot.transform.position.set(0, 4, 0);
    spot.transform.rotation.setFromAxisAngle(
      new Vector3(1, 0, 0),
      -Math.PI / 2,
    );
    const plain = new PointLight();
    const point = new PointLight({
      castShadow: true,
      shadow: { mapSize: 512, far: 20 },
    });
    point.transform.position.set(1, 2, 3);
    scene.add(spot);
    scene.add(plain);
    scene.add(point);
    const out = collectSceneLights(
      scene,
      createSceneLights(),
      undefined,
      camera(),
    );
    expect(out.shadowPunctualCount).toBe(2);
    expect(out.shadowPunctualSlot[0]).toBe(1);
    expect(out.shadowPunctualSlot[1]).toBe(0);
    expect(out.shadowPunctualSlot[2]).toBe(2);
    // 2 cascades + 1 spot tile + 6 point faces = 9 tiles of 512 in a 3x3 grid.
    expect(out.shadowTileCount).toBe(9);
    expect(out.shadowMapSize).toBe(512);
    expect([
      out.shadowAtlasColumns,
      out.shadowAtlasRows,
      out.shadowAtlasWidth,
    ]).toEqual([3, 3, 1536]);
    expect([...out.shadowPunctualParams.subarray(0, 8)]).toEqual([
      2,
      Math.fround(0.001),
      Math.fround(0.02),
      SHADOW_KIND_SPOT,
      3,
      Math.fround(0.001),
      Math.fround(0.02),
      SHADOW_KIND_POINT,
    ]);
    expect([...out.shadowPunctualRange.subarray(4, 6)]).toEqual([
      Math.fround(0.1),
      20,
    ]);
    expect(out.shadowSpotMatrices[0]).not.toBe(0);
    expect(out.shadowSpotMatrices[16]).toBe(0);
    // The spot's own axis projects to the middle of its map.
    const p = project(out.shadowTileMatrices[2], 0, 0, 0);
    expect(Math.abs(p[0])).toBeLessThan(1e-5);
  });

  it("casts from punctual lights alone, with no directional shadow", () => {
    const scene = new Scene();
    scene.add(new PointLight({ castShadow: true }));
    const out = collectSceneLights(scene, createSceneLights());
    expect(out.hasShadow).toBe(true);
    expect(out.shadowCascadeCount).toBe(0);
    expect(out.shadowExtended).toBe(true);
    expect(out.shadowTileCount).toBe(6);
    expect(out.shadowBias).toBe(0);
  });

  it("clears every atlas field between collections", () => {
    const scene = new Scene();
    const spot = new SpotLight({ castShadow: true });
    scene.add(spot);
    const out = createSceneLights();
    collectSceneLights(scene, out);
    expect(out.shadowTileCount).toBe(1);
    spot.visible = false;
    collectSceneLights(scene, out);
    expect(out.hasShadow).toBe(false);
    expect(out.shadowPunctualCount).toBe(0);
    expect(out.shadowTileCount).toBe(0);
    expect(out.shadowAtlasWidth).toBe(0);
    expect(out.shadowMapSize).toBe(0);
    expect([...out.shadowPunctualSlot].every((v) => v === 0)).toBe(true);
  });

  it("shadows only the first four casters and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scene = new Scene();
    for (let i = 0; i < MAX_SHADOWED_PUNCTUAL_LIGHTS + 2; i += 1) {
      scene.add(new SpotLight({ castShadow: true }));
    }
    const out = collectSceneLights(scene, createSceneLights());
    expect(out.shadowPunctualCount).toBe(MAX_SHADOWED_PUNCTUAL_LIGHTS);
    expect(out.shadowTileCount).toBe(4);
    collectSceneLights(scene, out);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("Shadow budget"))
        .length,
    ).toBe(1);
  });

  it("drops lights that would overflow the atlas edge", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scene = new Scene();
    scene.add(new PointLight({ castShadow: true, shadow: { mapSize: 4096 } }));
    scene.add(new PointLight({ castShadow: true, shadow: { mapSize: 4096 } }));
    const out = collectSceneLights(scene, createSceneLights());
    // 8192 / 4096 = 2 per edge → 4 tiles max; a point light needs 6.
    expect(out.shadowPunctualCount).toBe(0);
    expect(out.hasShadow).toBe(false);
    expect(MAX_SHADOW_TILES).toBe(28);
  });

  it("ignores a punctual double that offers no shadow record", () => {
    const scene = new Scene();
    const light = new PointLight({ castShadow: true });
    (light as unknown as { shadow: undefined }).shadow = undefined;
    scene.add(light);
    expect(collectSceneLights(scene, createSceneLights()).hasShadow).toBe(
      false,
    );
  });
});
