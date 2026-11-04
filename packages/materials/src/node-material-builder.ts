/**
 * The fluent authoring surface over `shader-graph.ts`'s IR (§60; RFC 0001).
 *
 * §60's own example must compile against this API — Part X's
 * example-compilation discipline (A-22/PH-18) applies to §60's snippet as
 * much as to §114's — and it does, one revision-1.11 spelling aside
 * (`NodeMaterialBuilder` is the authoring object; `NodeMaterial` is
 * {@link NodeMaterialBuilder.build}'s output):
 *
 * ```ts
 * const material = new NodeMaterialBuilder();
 * const albedo = material.texture(albedoTexture);
 * const pulse = material.sin(material.time().multiply(2));
 * material.output.color = albedo.multiply(pulse.add(1));
 * const built = material.build(); // NodeMaterial
 * ```
 *
 * The builder is sugar and nothing else: its output is a plain
 * {@link ShaderGraph} — nodes in creation order (§33), references always
 * backwards — and every rule is `analyzeShaderGraph`'s, applied when the
 * graph is built. Numbers passed where an expression is expected become
 * `float` constants; arrays become vector constants.
 */

import {
  analyzeShaderGraph,
  analyzeShaderNodeType,
  type ShaderAttributeName,
  type ShaderBinaryOp,
  type ShaderDomain,
  type ShaderGraph,
  type ShaderLightMember,
  type ShaderNode,
  type ShaderNodeId,
  type ShaderStorageElementType,
  type ShaderUnaryOp,
  type ShaderValueType,
} from "./shader-graph.js";
import { NodeMaterial, type NodeMaterialOptions } from "./node-material.js";
import type { MaterialTexture } from "./texture.js";

/**
 * What builder methods accept wherever a value flows: an expression from the
 * same builder, a number (a `float` constant), or an array of 2–4 numbers (a
 * vector constant).
 */
export type ShaderOperand = ShaderExpression | number | readonly number[];

/**
 * A handle to one node of one builder's graph-in-progress. Obtained from the
 * builder's source methods; combined with the fluent methods below. Handles
 * are builder-bound — mixing two builders' expressions is refused (§85).
 */
export class ShaderExpression {
  /** The node this handle names — its index in the built graph (§33). */
  readonly nodeId: ShaderNodeId;

  readonly #builder: ShaderGraphBuilder;

  /** @internal Created by {@link ShaderGraphBuilder} only. */
  constructor(builder: ShaderGraphBuilder, nodeId: ShaderNodeId) {
    this.#builder = builder;
    this.nodeId = nodeId;
  }

  /** Whether this expression belongs to `builder` — the §85 mixing check. */
  ownedBy(builder: ShaderGraphBuilder): boolean {
    return this.#builder === builder;
  }

  /** `this + other`. */
  add(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("add", this, other);
  }

  /** `this - other`. */
  subtract(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("subtract", this, other);
  }

  /** `this * other` (componentwise; matrices compose/transform). */
  multiply(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("multiply", this, other);
  }

  /** `this / other`. */
  divide(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("divide", this, other);
  }

  /** Componentwise minimum. */
  min(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("min", this, other);
  }

  /** Componentwise maximum. */
  max(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("max", this, other);
  }

  /** Dot product of two same-size vectors — a `float`. */
  dot(other: ShaderOperand): ShaderExpression {
    return this.#builder.binary("dot", this, other);
  }

  /** GLSL `step(this, x)`: 0 where `x < this`, 1 elsewhere (`this` is the edge). */
  step(x: ShaderOperand): ShaderExpression {
    return this.#builder.binary("step", this, x);
  }

  /** Linear blend to `b` by `t` — GLSL `mix(this, b, t)`. */
  mix(b: ShaderOperand, t: ShaderOperand): ShaderExpression {
    return this.#builder.mix(this, b, t);
  }

  /** Component selection — `"x"`, `"xy"`, `"zyx"`, … over `xyzw`. */
  swizzle(pattern: string): ShaderExpression {
    return this.#builder.swizzle(this, pattern);
  }

  /** `sin(this)`, componentwise. */
  sin(): ShaderExpression {
    return this.#unary("sin");
  }

  /** `cos(this)`, componentwise. */
  cos(): ShaderExpression {
    return this.#unary("cos");
  }

  /** `abs(this)`, componentwise. */
  abs(): ShaderExpression {
    return this.#unary("abs");
  }

  /** `floor(this)`, componentwise. */
  floor(): ShaderExpression {
    return this.#unary("floor");
  }

  /** `fract(this)`, componentwise. */
  fract(): ShaderExpression {
    return this.#unary("fract");
  }

  /** The unit vector along `this` (vectors only). */
  normalize(): ShaderExpression {
    return this.#unary("normalize");
  }

  /** `-this`, componentwise. */
  negate(): ShaderExpression {
    return this.#unary("negate");
  }

  /** `clamp(this, 0, 1)`, componentwise. */
  saturate(): ShaderExpression {
    return this.#unary("saturate");
  }

  /** The Euclidean length of `this` (vectors only) — a `float`. */
  length(): ShaderExpression {
    return this.#unary("length");
  }

  /**
   * Polar angle of a `vec2`, in radians: `atan2(this.y, this.x)` (§7a,
   * RFC 0001's angle operator). Other types are refused at build (§85).
   */
  angle(): ShaderExpression {
    return this.#unary("angle");
  }

  #unary(op: ShaderUnaryOp): ShaderExpression {
    return this.#builder.unary(op, this);
  }
}

/**
 * The two output slots of a graph under construction — assigned, RFC 0001's
 * spelling, as properties: `builder.output.color = expr`.
 */
export class ShaderGraphOutput {
  readonly #builder: ShaderGraphBuilder;

  #color: ShaderExpression | null = null;

  #positionOffset: ShaderExpression | null = null;

  /** @internal Created by {@link ShaderGraphBuilder} only. */
  constructor(builder: ShaderGraphBuilder) {
    this.#builder = builder;
  }

  /** The fragment result — `vec4`, required before the graph can build. */
  get color(): ShaderExpression | null {
    return this.#color;
  }

  set color(value: ShaderExpression | null) {
    this.#color = value === null ? null : this.#builder.own(value);
  }

  /**
   * Object-space `vec3` displacement added to `position` — surface graphs
   * only, optional. Not a transform: §42's authority model is untouched and
   * the physics world is not told (RFC 0001 Q4, decided).
   */
  get positionOffset(): ShaderExpression | null {
    return this.#positionOffset;
  }

  set positionOffset(value: ShaderExpression | null) {
    this.#positionOffset = value === null ? null : this.#builder.own(value);
  }
}

/**
 * Builds a {@link ShaderGraph} node by node — the domain-agnostic base.
 * `"surface"` authors normally use {@link NodeMaterialBuilder}, which adds
 * texture-value collection and {@link NodeMaterialBuilder.build}; `"screen"`
 * authors build a §70 `GraphEffect`'s graph here:
 *
 * ```ts
 * const screen = new ShaderGraphBuilder("screen");
 * const texel = screen.sampler("source");
 * screen.output.color = texel.multiply([0.5, 0.5, 0.5, 1]);
 * const effect = { kind: "graph", graph: screen.graph() } as const;
 * ```
 */
export class ShaderGraphBuilder {
  /** Which stage inputs this graph may name — fixed at construction. */
  readonly domain: ShaderDomain;

  /** The output slots — `builder.output.color = …` (RFC 0001's spelling). */
  readonly output: ShaderGraphOutput = new ShaderGraphOutput(this);

  readonly #nodes: ShaderNode[] = [];
  #uniformBlock = false;

  readonly #defines: Record<string, boolean> = {};

  /** Auto-named textures created so far — `texture0`, `texture1`, …. */
  #textureCount = 0;

  /** Texture values collected by {@link ShaderGraphBuilder.texture}. */
  protected readonly collectedTextures: Record<string, MaterialTexture> = {};

  /** The cached default-uv attribute node, created on first need. */
  #uvNode: ShaderExpression | null = null;

  constructor(domain: ShaderDomain = "surface") {
    this.domain = domain;
  }

  /** Opt into one padded std140 uniform upload per material draw on WebGL 2. */
  useUniformBlock(): this {
    this.#uniformBlock = true;
    return this;
  }

  /** How many nodes the graph holds so far. */
  get nodeCount(): number {
    return this.#nodes.length;
  }

  /**
   * Snapshots the built graph — nodes in creation order, outputs resolved —
   * and validates it (`analyzeShaderGraph`, §85: a broken graph is refused
   * here, where the code that built it is on the stack).
   *
   * @throws RangeError when no colour output was assigned, or when the graph
   * breaks any §60 IR rule.
   */
  graph(): ShaderGraph {
    const color = this.output.color;
    if (color === null) {
      throw new RangeError(
        "ShaderGraphBuilder: assign output.color before building (§60, §85).",
      );
    }
    const offset = this.output.positionOffset;
    const graph: ShaderGraph = {
      domain: this.domain,
      ...(this.#uniformBlock ? { uniformTransport: "std140" as const } : {}),
      nodes: [...this.#nodes],
      ...(Object.keys(this.#defines).length === 0
        ? {}
        : { defines: this.#sortedDefines() }),
      color: color.nodeId,
      ...(offset === null ? {} : { positionOffset: offset.nodeId }),
    };
    analyzeShaderGraph(graph);
    return graph;
  }

  /**
   * A constant. A number is a `float`; an array of 2–4 numbers is the
   * matching vector; 9 or 16 numbers are `mat3`/`mat4` (column-major, as
   * `Matrix4.elements` is laid out).
   */
  constant(value: number | readonly number[]): ShaderExpression {
    if (typeof value === "number") {
      return this.push({ kind: "constant", type: "float", value: [value] });
    }
    const type = CONSTANT_TYPES.get(value.length);
    if (type === undefined) {
      throw new RangeError(
        `ShaderGraphBuilder.constant: no shader type has ` +
          `${String(value.length)} components (§60, §85).`,
      );
    }
    return this.push({ kind: "constant", type, value: [...value] });
  }

  /** `vec2(...)` — parts' components must total 2. */
  vec2(...parts: readonly ShaderOperand[]): ShaderExpression {
    return this.#compose("vec2", parts);
  }

  /** `vec3(...)` — parts' components must total 3. */
  vec3(...parts: readonly ShaderOperand[]): ShaderExpression {
    return this.#compose("vec3", parts);
  }

  /** `vec4(...)` — parts' components must total 4. */
  vec4(...parts: readonly ShaderOperand[]): ShaderExpression {
    return this.#compose("vec4", parts);
  }

  /**
   * A named uniform of `type` (§60 "uniforms"). One name has one type; the
   * value lives on each `NodeMaterial` (`setUniform`) or, for a screen graph,
   * on the §70 pass (`GraphEffect.uniforms`).
   */
  uniform(name: string, type: ShaderValueType): ShaderExpression {
    return this.push({ kind: "uniform", type, name });
  }

  /**
   * A vertex attribute (§60 "vertex attributes") — R-19's four fixed streams
   * in a `"surface"` graph; in a `"screen"` graph only `"uv"`, the pass's own
   * normalized coordinate (see `ShaderAttributeName`).
   */
  attribute(name: ShaderAttributeName): ShaderExpression {
    return this.push({ kind: "attribute", name });
  }

  /** Shorthand for `attribute("uv")`, cached — the texture default. */
  uv(): ShaderExpression {
    this.#uvNode ??= this.attribute("uv");
    return this.#uvNode;
  }

  /**
   * Samples `texture` (§60's example spelling): registers the value under an
   * auto-generated sampler name (`texture0`, `texture1`, …) that
   * {@link NodeMaterialBuilder.build} binds on the material, and samples it
   * at `uv` — the mesh's uv stream by default. A `RenderTarget.colorTexture`
   * works here with no adapter (R-4's seam).
   */
  texture(texture: MaterialTexture, uv?: ShaderOperand): ShaderExpression {
    const name = `texture${String(this.#textureCount)}`;
    this.#textureCount += 1;
    this.collectedTextures[name] = texture;
    return this.sampler(name, uv);
  }

  /**
   * Samples the named sampler at `uv` (the default uv stream when omitted)
   * without binding a value: a surface material binds one later with
   * `setTexture(name, …)`; a `"screen"` graph's names resolve against the §70
   * pass's declared inputs (`"source"` plus `GraphEffect.textures`).
   */
  sampler(name: string, uv?: ShaderOperand): ShaderExpression {
    const coordinate = uv === undefined ? this.uv() : this.expression(uv);
    return this.push({ kind: "texture", name, uv: coordinate.nodeId });
  }

  /**
   * §9 **render** time, in seconds — never simulation time (§42/§43: nothing
   * downstream of a shader may become simulation input). The application
   * feeds it to the backend (`WebglRenderer.renderTime`).
   */
  time(): ShaderExpression {
    return this.push({ kind: "time" });
  }

  /**
   * Sets the named compile-time boolean that {@link select} nodes read
   * (RFC 0001 addendum). Undeclared defines read as `false`.
   */
  define(name: string, value = true): this {
    this.#defines[name] = value;
    return this;
  }

  /**
   * A compile-time conditional: `then` when define `name` is true, else
   * `otherwise`. The dead branch is not emitted and binds nothing.
   */
  select(
    name: string,
    then: ShaderOperand,
    otherwise: ShaderOperand,
  ): ShaderExpression {
    const a = this.expression(then);
    const b = this.expression(otherwise);
    return this.push({
      kind: "select",
      define: name,
      then: a.nodeId,
      otherwise: b.nodeId,
    });
  }

  /** Reads element `index` (a float) of a read-only storage buffer (§82). */
  storage(
    name: string,
    type: ShaderStorageElementType,
    count: number,
    index: ShaderOperand,
  ): ShaderExpression {
    return this.push({
      kind: "storage",
      name,
      type,
      count,
      index: this.expression(index).nodeId,
    });
  }

  /**
   * A member of the renderer's light block (§68). Array members
   * (`punctualPosition`, `punctualColor`, `punctualDirection`,
   * `punctualParams`) take an `index`.
   */
  light(member: ShaderLightMember, index?: ShaderOperand): ShaderExpression {
    return this.push(
      index === undefined
        ? { kind: "light", member }
        : { kind: "light", member, index: this.expression(index).nodeId },
    );
  }

  /** `sin(x)` — the builder-level spelling §60's example uses. */
  sin(x: ShaderOperand): ShaderExpression {
    return this.expression(x).sin();
  }

  /** `cos(x)`. */
  cos(x: ShaderOperand): ShaderExpression {
    return this.expression(x).cos();
  }

  /** Polar angle of a `vec2`, in radians — see {@link ShaderExpression.angle}. */
  angle(x: ShaderOperand): ShaderExpression {
    return this.expression(x).angle();
  }

  /** Blends `a` toward `b` by `t` — GLSL `mix`. */
  mix(a: ShaderOperand, b: ShaderOperand, t: ShaderOperand): ShaderExpression {
    const blendA = this.expression(a);
    const blendB = this.expression(b);
    const blendT = this.expression(t);
    return this.push({
      kind: "mix",
      a: blendA.nodeId,
      b: blendB.nodeId,
      t: blendT.nodeId,
    });
  }

  /** @internal The binary-op factory the expression methods call. */
  binary(
    op: ShaderBinaryOp,
    left: ShaderExpression,
    right: ShaderOperand,
  ): ShaderExpression {
    const l = this.own(left);
    const r = this.expression(right);
    return this.push({ kind: "binary", op, left: l.nodeId, right: r.nodeId });
  }

  /** @internal The unary-op factory the expression methods call. */
  unary(op: ShaderUnaryOp, source: ShaderExpression): ShaderExpression {
    return this.push({ kind: "unary", op, source: this.own(source).nodeId });
  }

  /** @internal The swizzle factory `ShaderExpression.swizzle` calls. */
  swizzle(source: ShaderExpression, pattern: string): ShaderExpression {
    return this.push({
      kind: "swizzle",
      source: this.own(source).nodeId,
      pattern,
    });
  }

  /** Value type of an expression, validated with the graph's normal rules. */
  typeOf(expression: ShaderExpression): ShaderValueType {
    const id = this.own(expression).nodeId;
    return analyzeShaderNodeType(this.#nodes, this.domain, id);
  }

  /** @internal Lifts an operand into this builder's graph (§85 on mixing). */
  expression(operand: ShaderOperand): ShaderExpression {
    if (operand instanceof ShaderExpression) {
      return this.own(operand);
    }
    return this.constant(operand);
  }

  /** @internal Refuses an expression built by another builder (§85). */
  own(expression: ShaderExpression): ShaderExpression {
    if (!expression.ownedBy(this)) {
      throw new RangeError(
        "ShaderGraphBuilder: this expression belongs to a different builder; " +
          "a graph references only its own nodes (§60, §85).",
      );
    }
    return expression;
  }

  /** @internal Appends `node` and returns its handle. */
  protected push(node: ShaderNode): ShaderExpression {
    this.#nodes.push(node);
    return new ShaderExpression(this, this.#nodes.length - 1);
  }

  #sortedDefines(): Record<string, boolean> {
    const sorted: Record<string, boolean> = {};
    for (const name of Object.keys(this.#defines).sort()) {
      sorted[name] = this.#defines[name];
    }
    return sorted;
  }

  #compose(
    type: ShaderValueType,
    parts: readonly ShaderOperand[],
  ): ShaderExpression {
    const ids = parts.map((part) => this.expression(part).nodeId);
    return this.push({ kind: "compose", type, parts: ids });
  }
}

/** Component count → constant type, for {@link ShaderGraphBuilder.constant}. */
const CONSTANT_TYPES: ReadonlyMap<number, ShaderValueType> = new Map([
  [2, "vec2"],
  [3, "vec3"],
  [4, "vec4"],
  [9, "mat3"],
  [16, "mat4"],
]);

/**
 * The `"surface"` builder whose output is a ready {@link NodeMaterial} —
 * §60's authoring surface (see the module header for the example).
 */
export class NodeMaterialBuilder extends ShaderGraphBuilder {
  constructor() {
    super("surface");
  }

  /**
   * Builds the graph ({@link ShaderGraphBuilder.graph} — validated, §85) and
   * wraps it in a {@link NodeMaterial}, binding every texture collected by
   * {@link ShaderGraphBuilder.texture}. `options` may add §57 render state,
   * initial uniform values, and bindings for named
   * {@link ShaderGraphBuilder.sampler} slots; an explicit
   * `options.textures` entry wins over a collected one of the same name.
   */
  build(options: NodeMaterialOptions = {}): NodeMaterial {
    return new NodeMaterial(this.graph(), {
      ...options,
      textures: { ...this.collectedTextures, ...options.textures },
    });
  }
}
