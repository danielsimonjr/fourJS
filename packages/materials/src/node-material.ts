/**
 * `NodeMaterial` (§57, §60) — the material family member that carries a
 * shader graph (RFC 0001, accepted 2026-08-21; gap R-14).
 *
 * ## The family's sanctioned extension surface
 *
 * §57 listed both `ShaderMaterial` and `NodeMaterial`. Spec revision 1.11
 * records `ShaderMaterial` as **permanently unshipped** (RFC 0001 Q1, owner
 * decision): a source-string material would re-open §96 and §63's opacity for
 * one row, and this class is what closes it instead — its shading is a graph
 * of closed operators (`shader-graph.ts`), never text.
 *
 * ## Unlit at this tier, stated rather than softened
 *
 * A node material does not see §68's directional light or the scene ambient
 * term (RFC 0001 §6, the MVP's sharpest limitation): enough for §70 effects,
 * procedural colour, exact §58 gradients, UV animation and screen-space work
 * — not enough for R-13's PBR path. R-17's light-uniform contract landed
 * 2026-08-09; graphs read it through the `"light"` node family (RFC 0001
 * addendum, accepted 2026-11-04): the renderer binds the members, the graph
 * declares no uniform.
 *
 * ## Uniform ownership is per material (RFC 0001 Q3, decided)
 *
 * A thousand materials may share one graph — the backend compiles **one**
 * program for them, keyed on the graph's structure — and each material owns
 * its own uniform values and texture bindings, uploaded per draw. Per-*node*
 * values would need a per-drawable uniform block and are deferred with it.
 *
 * ## §79
 *
 * By RFC 0001's compatibility decision, this packet serializes nothing:
 * materials are not serialized as classes today — a `Renderable`'s material is
 * a **reference** resolved through the `SceneResourceCatalog` seam, which a
 * `NodeMaterial` already satisfies with zero new code. When a material
 * document form lands, a `ShaderGraph` is already JSON by construction and
 * carries its own `domain`, which is what makes it a safe §96 payload.
 */

import { Material, type MaterialOptions } from "./material.js";
import {
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  freezeShaderGraph,
  type ShaderGraph,
  type ShaderReflection,
  type ShaderValueType,
} from "./shader-graph.js";
import type { ShaderStorageBuffer } from "./shader-storage.js";
import type { MaterialTexture } from "./texture.js";

/**
 * Construction options: §57's shared render state plus initial uniform values
 * and texture bindings, validated against the graph exactly as the setters
 * validate later writes (F14's rule — one validation, wherever the value
 * arrives from).
 */
export interface NodeMaterialOptions extends MaterialOptions {
  /** Initial uniform values by `uniform`-node name (§85-validated). */
  uniforms?: Readonly<Record<string, number | readonly number[]>>;
  /** Initial texture bindings by `texture`-node name (§85-validated). */
  textures?: Readonly<Record<string, MaterialTexture>>;
}

/**
 * §57's node material: a frozen {@link ShaderGraph} plus this material's own
 * uniform values and texture bindings.
 *
 * ```ts
 * const builder = new NodeMaterialBuilder();
 * const uv = builder.attribute("uv");
 * builder.output.color = builder.vec4(uv.swizzle("x"), 0.2, 0.8, 1);
 * const material = builder.build();
 * ```
 *
 * The graph is **immutable** — frozen at construction. Changing shading means
 * building a new graph and a new material; that is what makes a backend's
 * program cache a pure function of the graph (RFC 0001 §2). Uniform values
 * and textures are the mutable half, and — like the rest of §57's render
 * state — writing them does **not** bump {@link Material.version}: a backend
 * reads them per draw and caches nothing against them.
 *
 * Rendering it requires the backend's node pipeline to be registered
 * (`registerNodeMaterialPipeline()` on WebGL 2); an unregistered node
 * material is **skipped** with a one-time §85 warning, never drawn flat — a
 * graph the author wrote is a specific picture, and drawing an unrelated one
 * would be R-6's "a JSON value must not become a different picture" in the
 * material domain.
 */
export class NodeMaterial extends Material {
  /** Pipeline discriminant (§57, §64): the render list maps it to `"node"`. */
  readonly kind = "node" as const;

  /** The graph, frozen at construction — see the class documentation. */
  readonly graph: ShaderGraph;

  /**
   * What the compiled graph binds (§60 "reflection metadata"), derived once
   * at construction from the graph alone — uniform names and types, sampler
   * names, and the attributes read, all in first-appearance node order (§33).
   */
  readonly reflection: ShaderReflection;

  /** Uniform storage, keyed by name; every reflected uniform has an entry. */
  readonly #uniforms = new Map<
    string,
    { readonly type: ShaderValueType; readonly value: Float32Array }
  >();

  /** Texture bindings, keyed by name; every reflected sampler has an entry. */
  readonly #textures = new Map<string, MaterialTexture | null>();

  /** Storage bindings (§82), keyed by name; every reflected buffer has an entry. */
  readonly #storage = new Map<string, ShaderStorageBuffer | null>();

  /**
   * Validates `graph` (§85, at setup — the one place a bad graph may throw;
   * a backend never validates inside a frame, §61), freezes it, and seeds
   * every reflected uniform with zeroes — GL's own initial value, so an unset
   * uniform means the same thing on every backend — and every reflected
   * sampler with `null`.
   *
   * @throws RangeError when the graph breaks §60's IR rules, when an option
   * names a uniform or texture the graph does not reach, or when a uniform
   * value's shape does not match its declared type.
   */
  constructor(graph: ShaderGraph, options: NodeMaterialOptions = {}) {
    super("node-material", options);
    const analysis = analyzeShaderGraph(graph);
    this.graph = freezeShaderGraph(graph);
    this.reflection = analysis.reflection;
    for (const uniform of analysis.reflection.uniforms) {
      this.#uniforms.set(uniform.name, {
        type: uniform.type,
        value: new Float32Array(SHADER_VALUE_COMPONENTS[uniform.type]),
      });
    }
    for (const texture of analysis.reflection.textures) {
      this.#textures.set(texture.name, null);
    }
    for (const buffer of analysis.reflection.storage) {
      this.#storage.set(buffer.name, null);
    }
    if (options.uniforms !== undefined) {
      // Sorted for §33: seeding order must not depend on a record's key order.
      for (const name of Object.keys(options.uniforms).sort()) {
        this.setUniform(name, options.uniforms[name]);
      }
    }
    if (options.textures !== undefined) {
      for (const name of Object.keys(options.textures).sort()) {
        this.setTexture(name, options.textures[name]);
      }
    }
  }

  /**
   * Writes uniform `name` — validated against the graph's reflection (§85):
   * the name must be a reachable `uniform` node's, the value's component
   * count must match its declared type, and every component must be finite. A
   * scalar is accepted for a `float` uniform. The value is **copied**; later
   * mutation of a passed array is not observed.
   *
   * Does not bump {@link Material.version} — uniform values are per-draw
   * state a backend re-reads, exactly like the §57 render-state fields.
   */
  setUniform(name: string, value: number | readonly number[]): this {
    const record = this.#uniforms.get(name);
    if (record === undefined) {
      throw new RangeError(
        `NodeMaterial has no uniform ${JSON.stringify(name)}; the graph ` +
          "declares (reachably) only: " +
          `${this.reflection.uniforms.map((u) => u.name).join(", ") || "none"} ` +
          "(§60, §85).",
      );
    }
    const { type, value: target } = record;
    const components = SHADER_VALUE_COMPONENTS[type];
    if (typeof value === "number") {
      if (components !== 1) {
        throw new RangeError(
          `NodeMaterial uniform ${JSON.stringify(name)} is a ${type}; a ` +
            "single number only fits a float (§85).",
        );
      }
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `NodeMaterial uniform ${JSON.stringify(name)} must be finite; got ` +
            `${String(value)} (§85).`,
        );
      }
      target[0] = value;
      return this;
    }
    if (value.length !== components) {
      throw new RangeError(
        `NodeMaterial uniform ${JSON.stringify(name)} is a ${type} and needs ` +
          `${String(components)} components; got ${String(value.length)} (§85).`,
      );
    }
    for (const component of value) {
      if (!Number.isFinite(component)) {
        throw new RangeError(
          `NodeMaterial uniform ${JSON.stringify(name)} components must be ` +
            `finite; got ${String(component)} (§85).`,
        );
      }
    }
    target.set(value);
    return this;
  }

  /**
   * Binds texture `name`, or unbinds it with `null` (§60 "textures and
   * samplers"; §85-validated name). A `RenderTarget.colorTexture` is a valid
   * value — R-4's seam, so a graph can sample an off-screen pass with no
   * adapter. A draw whose graph samples a name still bound to `null` (or to a
   * disposed texture) is **skipped**, never drawn with undefined content.
   */
  setTexture(name: string, texture: MaterialTexture | null): this {
    if (!this.#textures.has(name)) {
      throw new RangeError(
        `NodeMaterial has no texture ${JSON.stringify(name)}; the graph ` +
          "samples (reachably) only: " +
          `${this.reflection.textures.map((t) => t.name).join(", ") || "none"} ` +
          "(§60, §85).",
      );
    }
    this.#textures.set(name, texture);
    return this;
  }

  /**
   * Binds storage buffer `name` (§82), or unbinds it with `null`. The buffer's
   * element type must equal the node's and hold at least the node's `count`
   * elements, so a clamped read can never leave the allocation. A draw whose
   * graph reads a name bound to `null` or to a disposed buffer is skipped.
   */
  setStorage(name: string, buffer: ShaderStorageBuffer | null): this {
    if (!this.#storage.has(name)) {
      throw new RangeError(
        `NodeMaterial has no storage buffer ${JSON.stringify(name)}; the ` +
          "graph reads (reachably) only: " +
          `${this.reflection.storage.map((b) => b.name).join(", ") || "none"} ` +
          "(§82, §85).",
      );
    }
    if (buffer !== null) {
      const declared = this.reflection.storage.find((b) => b.name === name)!;
      if (buffer.type !== declared.type || buffer.count < declared.count) {
        throw new RangeError(
          `NodeMaterial storage ${JSON.stringify(name)} needs at least ` +
            `${String(declared.count)} ${declared.type} elements; got ` +
            `${String(buffer.count)} ${buffer.type} (§82, §85).`,
        );
      }
    }
    this.#storage.set(name, buffer);
    return this;
  }

  /** The buffer bound to `name`, or `null` — the backend's per-draw read. */
  getStorage(name: string): ShaderStorageBuffer | null {
    const value = this.#storage.get(name);
    if (value === undefined) {
      throw new RangeError(
        `NodeMaterial has no storage buffer ${JSON.stringify(name)} (§82, §85).`,
      );
    }
    return value;
  }

  /**
   * The stored value of uniform `name` — the backend's per-draw read. A
   * **live view** of this material's storage: treat it as read-only and do
   * not retain it. Throws on a name the graph does not reach (§85).
   */
  getUniform(name: string): Float32Array {
    const record = this.#uniforms.get(name);
    if (record === undefined) {
      throw new RangeError(
        `NodeMaterial has no uniform ${JSON.stringify(name)} (§60, §85).`,
      );
    }
    return record.value;
  }

  /**
   * The texture bound to `name`, or `null` — the backend's per-draw read.
   * Throws on a name the graph does not sample (§85).
   */
  getTexture(name: string): MaterialTexture | null {
    const value = this.#textures.get(name);
    if (value === undefined) {
      throw new RangeError(
        `NodeMaterial has no texture ${JSON.stringify(name)} (§60, §85).`,
      );
    }
    return value;
  }
}
