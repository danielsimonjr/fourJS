import { Matrix4, Vector3, srgbToLinear } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  DirectionalLight,
  DirectionalLightShadow,
  Group,
  HemisphereLight,
  PointLight,
  PunctualLight,
  Scene,
  SpotLight,
} from "../src/index.js";

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;

describe("DirectionalLight (§68)", () => {
  it("defaults to white at intensity 1", () => {
    const light = new DirectionalLight();

    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
  });

  it("carries the structural brand @fourjs/render recognises", () => {
    expect(new DirectionalLight().isDirectionalLight).toBe(true);
  });

  it("is an ordinary scene node", () => {
    const scene = new Scene();
    const light = new DirectionalLight();
    scene.add(light);

    expect(light.parent).toBe(scene);
    // §46 lookups see it like any node.
    expect(scene.findByType(DirectionalLight)).toBe(light);
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number] = [0.25, 0.5, 0.75];
    const light = new DirectionalLight({ color: source, intensity: 3 });

    expect(light.color).toEqual(source);
    expect(light.color).not.toBe(source);
    expect(light.intensity).toBe(3);

    source[0] = 1;
    expect(light.color[0]).toBe(0.25);
  });

  it("accepts a CSS hex string and stores linear RGB (§60a)", () => {
    const light = new DirectionalLight({ color: "#ff0000" });
    expect(light.color).toEqual([1, 0, 0]);
  });

  it("accepts rgb() and decodes sRGB to linear-light", () => {
    const light = new DirectionalLight({ color: "rgb(0,128,255)" });
    expect(light.color[0]).toBe(0);
    expect(light.color[1]).toBeCloseTo(srgbToLinear(128 / 255), 12);
    expect(light.color[2]).toBe(1);
  });

  it("still accepts a numeric linear RGB tuple", () => {
    expect(new DirectionalLight({ color: [0.2, 0.4, 0.6] }).color).toEqual([
      0.2, 0.4, 0.6,
    ]);
  });

  it("rejects a CSS string this tier does not parse", () => {
    expect(() => new DirectionalLight({ color: "hsl(0 0% 0%)" })).toThrow(
      TypeError,
    );
  });

  it("rejects non-finite parameters (§85)", () => {
    expect(() => new DirectionalLight({ color: [Number.NaN, 0, 0] })).toThrow(
      RangeError,
    );
    expect(
      () => new DirectionalLight({ color: [0, Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/must be finite/);
    expect(() => new DirectionalLight({ intensity: Number.NaN })).toThrow(
      RangeError,
    );
  });

  describe("getWorldDirection", () => {
    it("shines along -Z when unrotated", () => {
      const light = new DirectionalLight();
      const out = new Vector3();

      expect(light.getWorldDirection(out)).toBe(out);
      // Negated zeroes: the method negates the matrix's +Z column.
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -1]);
    });

    it("follows the node's rotation — -π/2 about X shines down -Y", () => {
      const light = new DirectionalLight();
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(-1, 12);
      expect(out.z).toBeCloseTo(0, 12);
    });

    it("composes through ancestors and resolves on demand", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new DirectionalLight();
      scene.add(rig);
      rig.add(light);

      // Two quarter-turns about Y compose to a half-turn: -Z becomes +Z.
      rig.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
      light.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

      // No resolveWorldTransforms pass has run — the method resolves its own
      // ancestor chain, the Camera.updateViewMatrix guarantee.
      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(0, 12);
      expect(out.z).toBeCloseTo(1, 12);
    });

    it("stays unit length under ancestor scale", () => {
      const rig = new Group();
      const light = new DirectionalLight();
      rig.add(light);
      rig.transform.scale.set(10, 10, 10);

      const out = light.getWorldDirection(new Vector3());
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
    });

    it("yields the zero vector for a degenerate (zero-scale) chain", () => {
      const rig = new Group();
      const light = new DirectionalLight();
      rig.add(light);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldDirection(new Vector3(9, 9, 9));
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -0]);
    });
  });
});

describe("Scene.ambientLight (§68)", () => {
  it("defaults to black — an unconfigured scene adds no light", () => {
    expect(new Scene().ambientLight).toEqual([0, 0, 0]);
  });

  it("is written into, never replaced", () => {
    const scene = new Scene();
    const ambient = scene.ambientLight;

    scene.ambientLight[0] = 0.2;
    scene.ambientLight[1] = 0.3;
    scene.ambientLight[2] = 0.4;

    expect(scene.ambientLight).toBe(ambient);
    expect(scene.ambientLight).toEqual([0.2, 0.3, 0.4]);
  });
});

describe("PointLight (§68, R-17)", () => {
  it("defaults to white, intensity 1, unbounded range", () => {
    const light = new PointLight();

    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
    // `0` is "no cut-off", which is the honest default — see the class header.
    expect(light.range).toBe(0);
    expect(light.lightType).toBe("point");
  });

  it("carries the structural brand @fourjs/render recognises", () => {
    expect(new PointLight().isPunctualLight).toBe(true);
  });

  it("is an ordinary scene node", () => {
    const scene = new Scene();
    const light = new PointLight();
    scene.add(light);

    expect(light.parent).toBe(scene);
    expect(scene.findByType(PointLight)).toBe(light);
    expect(light).toBeInstanceOf(PunctualLight);
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number] = [0.25, 0.5, 0.75];
    const light = new PointLight({ color: source, intensity: 4, range: 12 });

    expect(light.color).toEqual(source);
    expect(light.color).not.toBe(source);
    expect(light.intensity).toBe(4);
    expect(light.range).toBe(12);

    source[0] = 1;
    expect(light.color[0]).toBe(0.25);
  });

  it("accepts #ff0000 and rgb(0,128,255) as CSS colours (§60a)", () => {
    expect(new PointLight({ color: "#ff0000" }).color).toEqual([1, 0, 0]);
    const cool = new PointLight({ color: "rgb(0,128,255)" });
    expect(cool.color[0]).toBe(0);
    expect(cool.color[1]).toBeCloseTo(srgbToLinear(128 / 255), 12);
    expect(cool.color[2]).toBe(1);
  });

  it("rejects non-finite parameters (§85)", () => {
    expect(() => new PointLight({ color: [Number.NaN, 0, 0] })).toThrow(
      RangeError,
    );
    expect(
      () => new PointLight({ color: [0, Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/must be finite/);
    expect(() => new PointLight({ color: [0, 0, Number.NaN] })).toThrow(
      RangeError,
    );
    expect(() => new PointLight({ intensity: Number.NaN })).toThrow(RangeError);
    expect(() => new PointLight({ range: Number.POSITIVE_INFINITY })).toThrow(
      /must be finite/,
    );
  });

  it("rejects a negative range, and only the range (§85)", () => {
    expect(() => new PointLight({ range: -1 })).toThrow(/must not be negative/);
    // Negative intensity and colour components pass through un-clamped, the
    // no-silent-rewrites rule every authored colour in this engine follows.
    expect(new PointLight({ intensity: -2 }).intensity).toBe(-2);
    expect(new PointLight({ color: [-1, 0, 0] }).color[0]).toBe(-1);
  });

  describe("getWorldPosition", () => {
    it("reads the node's own translation", () => {
      const light = new PointLight();
      light.transform.position.set(1, 2, 3);
      const out = new Vector3();

      expect(light.getWorldPosition(out)).toBe(out);
      expect([out.x, out.y, out.z]).toEqual([1, 2, 3]);
    });

    it("composes through ancestors and resolves on demand", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new PointLight();
      scene.add(rig);
      rig.add(light);

      rig.transform.position.set(0, 5, 0);
      rig.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
      light.transform.position.set(2, 0, 0);

      // No frame-wide resolve pass has run; the light resolves its own chain.
      const out = light.getWorldPosition(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(5, 12);
      expect(out.z).toBeCloseTo(-2, 12);
    });

    it("still has a position under a zero-scale ancestor", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new PointLight();
      scene.add(rig);
      rig.add(light);
      rig.transform.position.set(3, 0, 0);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldPosition(new Vector3());
      expect([out.x, out.y, out.z]).toEqual([3, 0, 0]);
    });
  });
});

describe("SpotLight (§68, R-17)", () => {
  it("defaults to glTF's cone: inner 0, outer π/4", () => {
    const light = new SpotLight();

    expect(light.lightType).toBe("spot");
    expect(light.innerConeAngle).toBe(0);
    expect(light.outerConeAngle).toBe(Math.PI / 4);
    expect(light.range).toBe(0);
  });

  it("is a PunctualLight with the point light's whole surface", () => {
    const light = new SpotLight({
      color: [1, 0.5, 0],
      intensity: 8,
      range: 20,
      innerConeAngle: Math.PI / 8,
      outerConeAngle: Math.PI / 6,
    });

    expect(light).toBeInstanceOf(PunctualLight);
    expect(light.isPunctualLight).toBe(true);
    expect(light.color).toEqual([1, 0.5, 0]);
    expect(light.intensity).toBe(8);
    expect(light.range).toBe(20);
    expect(light.getWorldPosition(new Vector3()).x).toBe(0);
  });

  it("accepts a CSS colour string the same way a point light does", () => {
    expect(new SpotLight({ color: "#ff0000" }).color).toEqual([1, 0, 0]);
    expect(new SpotLight({ color: [0.1, 0.2, 0.3] }).color).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });

  it("rejects non-finite cone angles (§85)", () => {
    expect(() => new SpotLight({ innerConeAngle: Number.NaN })).toThrow(
      /must be finite/,
    );
    expect(
      () => new SpotLight({ outerConeAngle: Number.POSITIVE_INFINITY }),
    ).toThrow(/must be finite/);
  });

  it("accepts an inverted cone rather than rewriting it", () => {
    // `inner >= outer` is a hard-edged cone, not an error — the renderer's
    // `max(cos inner − cos outer, 1e-6)` is what keeps it finite.
    const light = new SpotLight({
      innerConeAngle: Math.PI / 2,
      outerConeAngle: Math.PI / 8,
    });

    expect(light.innerConeAngle).toBe(Math.PI / 2);
    expect(light.outerConeAngle).toBe(Math.PI / 8);
  });

  describe("getWorldDirection", () => {
    it("aims along -Z when unrotated, exactly as a directional light does", () => {
      const out = new SpotLight().getWorldDirection(new Vector3());

      expect([out.x, out.y, out.z]).toEqual([-0, -0, -1]);
    });

    it("follows the node's rotation — -π/2 about X aims down -Y", () => {
      const light = new SpotLight();
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(-1, 12);
      expect(out.z).toBeCloseTo(0, 12);
    });

    it("yields the zero vector for a degenerate (zero-scale) chain", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new SpotLight();
      scene.add(rig);
      rig.add(light);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldDirection(new Vector3());
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -0]);
    });
  });
});

/** `m · (x, y, z, 1)`, as the shadow-map clip coordinate after the divide. */
function project(m: Matrix4, x: number, y: number, z: number): Vector3 {
  const e = m.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return new Vector3(
    (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
    (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  );
}

describe("DirectionalLightShadow (§69, R-18)", () => {
  it("carries the recorded defaults", () => {
    const shadow = new DirectionalLightShadow();

    // §69 states no numbers and Appendix A pins none, so these are the
    // decisions `light.ts` records — asserted here so a change to one of them
    // is a change to a test rather than a silent change to every shadow.
    expect([shadow.mapSize, shadow.bias, shadow.normalBias]).toEqual([
      1024, 0.0015, 0,
    ]);
    expect([shadow.extent, shadow.near, shadow.far]).toEqual([10, 0.1, 100]);
  });

  it("takes every option and re-validates on every write (F14)", () => {
    const shadow = new DirectionalLightShadow({
      mapSize: 2048,
      bias: 0.002,
      normalBias: 0.05,
      extent: 12,
      near: 1,
      far: 50,
    });
    expect([shadow.mapSize, shadow.bias, shadow.normalBias]).toEqual([
      2048, 0.002, 0.05,
    ]);
    expect([shadow.extent, shadow.near, shadow.far]).toEqual([12, 1, 50]);

    shadow.mapSize = 512;
    shadow.bias = -0.001;
    shadow.normalBias = 0;
    shadow.extent = 4;
    shadow.near = 0.5;
    shadow.far = 20;
    expect([shadow.mapSize, shadow.bias, shadow.extent]).toEqual([
      512, -0.001, 4,
    ]);
    expect([shadow.near, shadow.far]).toEqual([0.5, 20]);
  });

  it("refuses a map size that is not a positive integer (§85)", () => {
    expect(() => new DirectionalLightShadow({ mapSize: 0 })).toThrow(
      RangeError,
    );
    expect(() => new DirectionalLightShadow({ mapSize: 1024.5 })).toThrow(
      /finite integer of at least 1/,
    );
    expect(() => new DirectionalLightShadow({ mapSize: Number.NaN })).toThrow(
      RangeError,
    );
    const shadow = new DirectionalLightShadow();
    expect(() => {
      shadow.mapSize = -1;
    }).toThrow(RangeError);
    expect(shadow.mapSize).toBe(1024);
  });

  it("refuses a negative normal bias but accepts a negative constant bias", () => {
    // The asymmetry is the recorded one: a negative *depth* bias is a
    // deliberate over-occlusion; a negative *normal* bias is the artefact.
    expect(new DirectionalLightShadow({ bias: -1 }).bias).toBe(-1);
    expect(() => new DirectionalLightShadow({ normalBias: -0.01 })).toThrow(
      /must not be negative/,
    );
    expect(() => new DirectionalLightShadow({ bias: Number.NaN })).toThrow(
      /must be finite/,
    );
    const shadow = new DirectionalLightShadow();
    expect(() => {
      shadow.normalBias = -1;
    }).toThrow(RangeError);
    expect(() => {
      shadow.bias = Number.POSITIVE_INFINITY;
    }).toThrow(RangeError);
  });

  it("refuses a non-positive extent (§85)", () => {
    expect(() => new DirectionalLightShadow({ extent: 0 })).toThrow(
      /must be positive/,
    );
    const shadow = new DirectionalLightShadow();
    expect(() => {
      shadow.extent = -3;
    }).toThrow(RangeError);
    expect(shadow.extent).toBe(10);
  });

  it("refuses a volume whose planes do not bound anything (§85)", () => {
    expect(() => new DirectionalLightShadow({ near: 0 })).toThrow(
      /must be positive/,
    );
    expect(() => new DirectionalLightShadow({ far: -1 })).toThrow(
      /must be positive/,
    );
    expect(() => new DirectionalLightShadow({ near: 10, far: 10 })).toThrow(
      /must be less than far/,
    );
    expect(() => new DirectionalLightShadow({ near: 20, far: 5 })).toThrow(
      /must be less than far/,
    );

    // And on write, in both directions — the check is a relation, so either
    // setter can break it and neither may leave the object half-updated.
    const shadow = new DirectionalLightShadow();
    expect(() => {
      shadow.near = 200;
    }).toThrow(/must be less than far/);
    expect(shadow.near).toBe(0.1);
    expect(() => {
      shadow.far = 0.05;
    }).toThrow(/must be less than far/);
    expect(shadow.far).toBe(100);
  });
});

describe("DirectionalLight — §69 shadows (R-18)", () => {
  it("does not cast by default, and carries settings either way", () => {
    const light = new DirectionalLight();

    expect(light.castShadow).toBe(false);
    // Always present, so configuring before switching on needs no null check.
    expect(light.shadow).toBeInstanceOf(DirectionalLightShadow);
    expect(light.shadow.mapSize).toBe(1024);
  });

  it("takes castShadow and the shadow settings from its options", () => {
    const light = new DirectionalLight({
      castShadow: true,
      shadow: { mapSize: 512, extent: 4 },
    });

    expect(light.castShadow).toBe(true);
    expect([light.shadow.mapSize, light.shadow.extent]).toEqual([512, 4]);
    // Unmentioned fields keep their documented defaults.
    expect(light.shadow.bias).toBe(0.0015);
  });

  it("refuses an invalid shadow setting at light construction (§85)", () => {
    expect(() => new DirectionalLight({ shadow: { mapSize: 0.5 } })).toThrow(
      RangeError,
    );
  });

  describe("computeShadowMatrix", () => {
    it("is the orthographic volume times the light's inverse world matrix", () => {
      const light = new DirectionalLight({
        shadow: { extent: 8, near: 1, far: 40 },
      });
      light.transform.position.set(2, 5, -3);
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const actual = light.computeShadowMatrix(new Matrix4());

      const view = new Matrix4().copy(light.transform.worldMatrix).invert();
      const expected = new Matrix4()
        .setOrthographic(-8, 8, -8, 8, 1, 40)
        .multiply(view);
      expect([...actual.elements]).toEqual([...expected.elements]);
    });

    it("writes into `out` and returns it (§7b)", () => {
      const out = new Matrix4();
      expect(new DirectionalLight().computeShadowMatrix(out)).toBe(out);
    });

    it("maps the volume onto WebGL 2's [-1, 1] clip cube", () => {
      // Unrotated: the light looks down -Z from the origin, so the volume runs
      // from z = -near to z = -far and spans ±extent in x and y.
      const light = new DirectionalLight({
        shadow: { extent: 10, near: 1, far: 101 },
      });
      const matrix = light.computeShadowMatrix(new Matrix4());

      const near = project(matrix, 0, 0, -1);
      const far = project(matrix, 0, 0, -101);
      expect(near.z).toBeCloseTo(-1, 12);
      expect(far.z).toBeCloseTo(1, 12);

      const corner = project(matrix, 10, -10, -51);
      expect(corner.x).toBeCloseTo(1, 12);
      expect(corner.y).toBeCloseTo(-1, 12);
      // Halfway in depth is *not* halfway in clip space only for perspective;
      // an orthographic volume is linear, so the midpoint lands at 0.
      expect(corner.z).toBeCloseTo(0, 12);
    });

    it("follows the node's placement — a raised, aimed light sees below it", () => {
      const light = new DirectionalLight({
        shadow: { extent: 5, near: 0.5, far: 20 },
      });
      light.transform.position.set(0, 10, 0);
      // Aim down -Y, the way §7a aims a sun.
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const matrix = light.computeShadowMatrix(new Matrix4());
      const ground = project(matrix, 0, 0, 0);
      expect(ground.x).toBeCloseTo(0, 12);
      expect(ground.y).toBeCloseTo(0, 12);
      // 10 m below a light whose volume runs 0.5…20.5 m: just past the middle.
      expect(ground.z).toBeGreaterThan(-1);
      expect(ground.z).toBeLessThan(1);
    });

    it("collapses rather than throwing or NaN-ing for a degenerate chain", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new DirectionalLight();
      scene.add(rig);
      rig.add(light);
      rig.transform.scale.set(0, 0, 0);

      const matrix = light.computeShadowMatrix(new Matrix4());
      // `Matrix4.invert` leaves a singular matrix alone, so every element is
      // finite and the volume is one nothing can be inside — an empty map, and
      // every receiver lit. The frame loses its shadow, not its existence.
      expect([...matrix.elements].every(Number.isFinite)).toBe(true);
      const projected = project(matrix, 1, 2, -3);
      expect(Number.isFinite(projected.x)).toBe(true);
    });

    it("allocates no matrix of its own across repeated calls", () => {
      const light = new DirectionalLight();
      const first = light.computeShadowMatrix(new Matrix4());
      const second = light.computeShadowMatrix(new Matrix4());

      // The module scratch is rewritten, never handed out: two calls agree.
      expect([...first.elements]).toEqual([...second.elements]);
    });
  });
});

describe("HemisphereLight (§68)", () => {
  it("defaults to white sky, black ground, intensity 1", () => {
    const light = new HemisphereLight();
    expect(light.color).toEqual([1, 1, 1]);
    expect(light.groundColor).toEqual([0, 0, 0]);
    expect(light.intensity).toBe(1);
    expect(light.isHemisphereLight).toBe(true);
    expect("castShadow" in light).toBe(false);
  });

  it("is an ordinary scene node", () => {
    const scene = new Scene();
    const light = new HemisphereLight();
    scene.add(light);
    expect(light.parent).toBe(scene);
    expect(scene.findByType(HemisphereLight)).toBe(light);
  });

  it("copies supplied colours instead of holding the caller's arrays", () => {
    const sky: [number, number, number] = [0.6, 0.7, 1];
    const ground: [number, number, number] = [0.3, 0.2, 0.1];
    const light = new HemisphereLight({
      color: sky,
      groundColor: ground,
      intensity: 0.4,
    });
    expect(light.color).toEqual(sky);
    expect(light.color).not.toBe(sky);
    expect(light.groundColor).toEqual(ground);
    expect(light.groundColor).not.toBe(ground);
    sky[0] = 1;
    expect(light.color[0]).toBe(0.6);
  });

  it("accepts CSS strings and stores linear RGB (§60a)", () => {
    const light = new HemisphereLight({
      color: "#ff0000",
      groundColor: "rgb(0,128,0)",
    });
    expect(light.color).toEqual([1, 0, 0]);
    expect(light.groundColor[1]).toBeCloseTo(srgbToLinear(128 / 255), 12);
  });

  it("rejects non-finite parameters (§85)", () => {
    expect(() => new HemisphereLight({ color: [Number.NaN, 0, 0] })).toThrow(
      RangeError,
    );
    expect(
      () =>
        new HemisphereLight({ groundColor: [0, Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/must be finite/);
    expect(() => new HemisphereLight({ intensity: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("orients sky along +Y when unrotated", () => {
    const out = new HemisphereLight().getWorldUp(new Vector3());
    expect([out.x, out.y, out.z]).toEqual([0, 1, 0]);
  });

  it("follows the node's rotation — −π/2 about X puts sky on −Z", () => {
    const light = new HemisphereLight();
    light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);
    const out = light.getWorldUp(new Vector3());
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(-1, 12);
  });
});

describe("PointLight and SpotLight carry no castShadow (§69)", () => {
  it("is absent rather than accepted-and-ignored", () => {
    // §69's answer for a positional light is a cube map or a per-light shadow
    // index; neither exists at this tier, so neither class offers the field.
    expect("castShadow" in new PointLight()).toBe(false);
    expect("castShadow" in new SpotLight()).toBe(false);
    expect("shadow" in new PointLight()).toBe(false);
  });
});
