/**
 * WP-W4.2: the standard family's normal / occlusion / emissive maps — the
 * surface bind-group layout, the WGSL variants and their defaults.
 */

import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  SURFACE_EMISSIVE_BINDING,
  SURFACE_MR_BINDING,
  SURFACE_NORMAL_BINDING,
  SURFACE_OCCLUSION_BINDING,
  SURFACE_SAMPLER_BINDING,
  createSurfaceBindGroupLayout,
} from "../src/wgpu-bindings.js";
import {
  NO_SURFACE_MAPS,
  SURFACE_DEFAULT_TEXELS,
  standardShaderSource,
  surfaceBindingWgsl,
} from "../src/wgpu-standard.js";

const ALL = { normal: true, occlusion: true, emissive: true };

describe("surface bind-group layout", () => {
  it("declares mr, one shared sampler and the three detail textures", () => {
    const gpu = createRecordingGpu();
    createSurfaceBindGroupLayout(gpu.device as never);
    const desc = gpu.callsOf("device.createBindGroupLayout")[0]?.args[0] as {
      label: string;
      entries: { binding: number; texture?: unknown; sampler?: unknown }[];
    };
    expect(desc.label).toBe("fourJS:surface");
    expect(desc.entries.map((e) => e.binding)).toEqual([
      SURFACE_MR_BINDING,
      SURFACE_SAMPLER_BINDING,
      SURFACE_NORMAL_BINDING,
      SURFACE_OCCLUSION_BINDING,
      SURFACE_EMISSIVE_BINDING,
    ]);
    expect(desc.entries.filter((e) => e.sampler !== undefined)).toHaveLength(1);
  });

  it("declares defaults: white identities, flat normal", () => {
    expect(SURFACE_DEFAULT_TEXELS.normal).toEqual([128, 128, 255, 255]);
    expect(SURFACE_DEFAULT_TEXELS.occlusion).toEqual([255, 255, 255, 255]);
    expect(SURFACE_DEFAULT_TEXELS.emissive).toEqual([255, 255, 255, 255]);
    expect(SURFACE_DEFAULT_TEXELS.metalRoughness).toEqual([255, 255, 255, 255]);
  });
});

describe("standardShaderSource surface variants", () => {
  it("is unchanged when no detail map is requested", () => {
    const base = standardShaderSource(true, true, false, true);
    expect(standardShaderSource(true, true, false, true, NO_SURFACE_MAPS)).toBe(
      base,
    );
    expect(base).not.toContain("normalTexture");
    expect(base).not.toContain("occlusion");
    expect(base).not.toContain("surfaceSampler");
  });

  it("declares only the requested bindings", () => {
    expect(surfaceBindingWgsl(2, { ...NO_SURFACE_MAPS, normal: true }, false))
      .toBe(`@group(2) @binding(1) var surfaceSampler : sampler;
@group(2) @binding(2) var normalTexture : texture_2d<f32>;`);
    const all = surfaceBindingWgsl(3, ALL, true);
    for (const name of [
      "mrTexture",
      "normalTexture",
      "occlusionTexture",
      "emissiveTexture",
    ]) {
      expect(all).toContain(name);
    }
    expect(
      surfaceBindingWgsl(2, { ...NO_SURFACE_MAPS, emissive: true }, false),
    ).not.toContain("occlusionTexture");
  });

  it("places the surface group at 3 with albedo and 2 without", () => {
    expect(standardShaderSource(true, true, false, false, ALL)).toContain(
      "@group(3) @binding(2) var normalTexture",
    );
    expect(standardShaderSource(true, false, false, false, ALL)).toContain(
      "@group(2) @binding(2) var normalTexture",
    );
    // With mr, the widened group replaces (not duplicates) the 2-entry mr decl.
    const mr = standardShaderSource(true, true, false, true, ALL);
    expect(mr.match(/var mrTexture/g)).toHaveLength(1);
    expect(mr).toContain("textureSample(mrTexture, surfaceSampler, input.uv)");
    expect(
      standardShaderSource(true, true, false, true, {
        ...NO_SURFACE_MAPS,
        emissive: true,
      }),
    ).toContain("surfaceSampler");
  });

  it("applies GL's normal map math", () => {
    const src = standardShaderSource(true, false, false, false, {
      ...NO_SURFACE_MAPS,
      normal: true,
    });
    expect(src).toContain("fn mappedNormal");
    expect(src).toContain("textureSampleGrad(normalTexture");
    expect(src).toContain("* (1.0 + draw.surface.z)");
    expect(src).toContain("1e-20");
    expect(src).toContain("dpdx(input.worldPosition)");
    expect(src).toContain("let n = nHemi;");
    expect(src).toContain("hemisphereAmbient(normalLength, nHemi)");
    expect(src).not.toContain("occlusionTexture");
  });

  it("applies occlusion to the ambient term and emissive last", () => {
    const occ = standardShaderSource(true, false, false, false, {
      ...NO_SURFACE_MAPS,
      occlusion: true,
    });
    expect(occ).toContain("1.0 + draw.surface.w");
    expect(occ).toContain("* diffuseColor * occlusion;");
    expect(occ).not.toContain("mappedNormal");
    const emi = standardShaderSource(false, false, false, false, {
      ...NO_SURFACE_MAPS,
      emissive: true,
    });
    expect(emi).toContain(
      "draw.emissive.xyz * textureSample(emissiveTexture, surfaceSampler, input.uv).rgb",
    );
  });
});
