/**
 * The node-material pipeline (§60, §62; RFC 0001 — gap R-14): a GLSL ES 3.00
 * emitter over `@fourjs/materials`' shader-graph IR, a program class, and the
 * per-context structural program cache — reached only through
 * {@link registerNodeMaterialPipeline}.
 *
 * ## No user shader source, at any tier
 *
 * Nothing here accepts GLSL text from outside this repository. The emitter's
 * input is the closed-operator graph (`ShaderGraph`, read through the types
 * `@fourjs/render` re-exposes — the frozen §3.1 row is untouched), and its
 * output is a pure, deterministic function of that graph: nodes are visited
 * in **array order** (§33 — the rule is written for simulation, and applying
 * it here is what makes the emitted source, and therefore the program-cache
 * key, a function of the graph rather than of construction history), and the
 * MVP compiler performs **no algebraic optimisation** — dead-node elimination
 * (unreachable from `color`/`positionOffset`) is the only transform, because
 * reassociating float expressions changes pixels and §92's pixel-golden tier
 * would then be gated on a compiler's mood (RFC 0001 §3).
 *
 * ## One program per graph structure, not per material
 *
 * {@link GlNodeProgramCache} keys compiled programs on the emitted source —
 * the structural key: two graphs that emit the same GLSL are the same program
 * — with a `WeakMap` identity fast path per graph object. A thousand
 * `NodeMaterial`s sharing one graph therefore share one program; their
 * uniform values differ per draw (`setMaterial`). This is the same
 * CPU-descriptor/GPU-cache split `GeometryCache`, `TextureCache` and
 * `RenderTargetCache` already use — the fourth instance, as the RFC counted.
 *
 * ## Lazy in both directions (the pipeline-cost law)
 *
 * Nothing here is reachable from `WebglRenderer` — the renderer imports only
 * the registry slot (`node-pipeline-registry.ts`), and this module links into
 * a bundle only when the application calls
 * {@link registerNodeMaterialPipeline}. And registration compiles nothing:
 * programs compile per graph on the renderer's first draw that needs them,
 * inside the frame's `try` — a driver refusal costs that graph's draws (§61,
 * latched per context by the cache), never the frame — so a scene with no
 * node material issues the byte-identical GL sequence it always did
 * (RFC 0001's acceptance gate, asserted by transcript in
 * `tests/integration/node-materials.test.ts`).
 *
 * ## Uniform transport (a deliberate padding rule)
 *
 * This backend's GL budget (`WebglContext`) has `uniformMatrix3fv` for the
 * lit/standard normal-matrix hoist; it still has no `uniform2fv`. A `vec2`
 * uniform is **declared `vec4`** and read `.xy`, and a node-material `mat3`
 * uniform is still **declared `mat4`** and read `mat3(...)` so this pipeline's
 * transcripts stay padded rather than growing a second 3×3 upload path.
 * Uploads pad with zeroes (identity in the mat4's last column). The IR type,
 * the reflection, and `setUniform`'s validation all stay `vec2`/`mat3`; only
 * the GLSL declaration and the upload widen. Deterministic, driver-portable,
 * and invisible to authors.
 */

import { DEV, FourError, devWarnOnce, type Disposable } from "@fourjs/core";
import type { Matrix4 } from "@fourjs/math";
import {
  analyzeShaderGraph,
  resolveShaderSelect,
  SHADER_LIGHT_ARRAY_TYPES,
  SHADER_LIGHT_SLOTS,
  type SceneLights,
  type ShaderLightMember,
  createShaderSourceMap,
  type ShaderSourceMap,
  type ShaderAttributeName,
  type ShaderDomain,
  type ShaderGraph,
  type ShaderGraphAnalysis,
  type ShaderNode,
  type ShaderUniformReflection,
  type ShaderValueType,
} from "@fourjs/render";

import {
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";
import {
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  setNodeMaterialPipelineFactory,
  type NodeItemMaterial,
  type NodeMaterialProgram,
  type NodeMaterialPrograms,
} from "./node-pipeline-registry.js";

import { GlNodeUniformBlock } from "./gl-node-uniform-block.js";

/** What the emitter hands the program class — source plus binding metadata. */
export interface EmittedNodeShader {
  readonly domain: ShaderDomain;
  readonly uniformBlock?: boolean;
  readonly vertex: string;
  readonly fragment: string;
  readonly sourceMap: {
    readonly vertex: ShaderSourceMap;
    readonly fragment: ShaderSourceMap;
  };
  /** Whether any reachable node reads §9 render time. */
  readonly usesTime: boolean;
  /** Reachable uniforms, reflection order (§33). */
  readonly uniforms: readonly ShaderUniformReflection[];
  /** Reachable sampler names, reflection order (§33). */
  readonly textures: readonly string[];
  /** The §68 light-block members the fragment stage reads, reflection order. */
  readonly lights: readonly ShaderLightMember[];
}

/** How each attribute is declared in the vertex stage (R-19's four slots). */
const ATTRIBUTE_DECLARATIONS: Readonly<Record<ShaderAttributeName, string>> = {
  position: "layout(location = 0) in vec3 position;",
  normal: "layout(location = 1) in vec3 normal;",
  uv: "layout(location = 2) in vec2 uv;",
  color: "layout(location = 3) in vec4 vertexColor;",
};

/** The vertex-stage expression each attribute reads. */
const VERTEX_ATTRIBUTE_REFERENCES: Readonly<
  Record<ShaderAttributeName, string>
> = {
  position: "position",
  normal: "normal",
  uv: "uv",
  color: "vertexColor",
};

/** The varying each attribute travels to the fragment stage in. */
const VARYING_NAMES: Readonly<Record<ShaderAttributeName, string>> = {
  position: "v_position",
  normal: "v_normal",
  uv: "v_uv",
  color: "v_color",
};

/** The varying types, matching {@link ATTRIBUTE_DECLARATIONS}. */
const VARYING_TYPES: Readonly<Record<ShaderAttributeName, string>> = {
  position: "vec3",
  normal: "vec3",
  uv: "vec2",
  color: "vec4",
};

/** Fixed attribute order — declaration order is location order, always. */
const ATTRIBUTE_ORDER: readonly ShaderAttributeName[] = [
  "position",
  "normal",
  "uv",
  "color",
];

/**
 * The full-screen-triangle vertex stage every `"screen"` program shares —
 * `gl-effect.ts`'s idiom with this pipeline's varying name: three corners
 * from `gl_VertexID`, uv running 0..1 across the visible surface, `v = 0` the
 * bottom edge (§7a Y-up; no flip anywhere).
 */
const SCREEN_VERTEX_SHADER_SOURCE = `#version 300 es
out vec2 v_uv;

void main() {
  v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** A number as a GLSL float literal — deterministic, exact for every finite value. */
function glslNumber(value: number): string {
  const text = String(value);
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

/** The GLSL type a uniform of `type` is declared as — the padding rule. */
function uniformDeclarationType(type: ShaderValueType): string {
  if (type === "vec2") {
    return "vec4";
  }
  if (type === "mat3") {
    return "mat4";
  }
  return type;
}

/** The expression that reads uniform `name` back at its IR type. */
function uniformReadExpression(name: string, type: ShaderValueType): string {
  if (type === "vec2") {
    return `u_${name}.xy`;
  }
  if (type === "mat3") {
    return `mat3(u_${name})`;
  }
  return `u_${name}`;
}

/** GLSL operator/function per binary op. */
const BINARY_OPERATORS: Readonly<Record<string, string>> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

/** The GLSL expression computing `node`, referencing locals `n<id>`. */
function nodeExpression(
  node: ShaderNode,
  stage: "vertex" | "fragment",
  uniformBlock: boolean,
  defines: Readonly<Record<string, boolean>> | undefined,
): string {
  switch (node.kind) {
    case "constant":
      return node.value.length === 1
        ? glslNumber(node.value[0])
        : `${node.type}(${node.value.map(glslNumber).join(", ")})`;
    case "uniform":
      if (uniformBlock && node.type === "float") return `u_${node.name}.x`;
      if (uniformBlock && node.type === "vec3") return `u_${node.name}.xyz`;
      return uniformReadExpression(node.name, node.type);
    case "attribute":
      return stage === "vertex"
        ? VERTEX_ATTRIBUTE_REFERENCES[node.name]
        : VARYING_NAMES[node.name];
    case "texture":
      return `texture(s_${node.name}, n${String(node.uv)})`;
    case "time":
      return "time";
    case "compose":
      return `${node.type}(${node.parts
        .map((part) => `n${String(part)}`)
        .join(", ")})`;
    case "swizzle":
      return `n${String(node.source)}.${node.pattern}`;
    case "unary": {
      const source = `n${String(node.source)}`;
      if (node.op === "negate") {
        return `(-${source})`;
      }
      if (node.op === "saturate") {
        return `clamp(${source}, 0.0, 1.0)`;
      }
      if (node.op === "angle") {
        // GLSL ES 3.00 two-argument `atan(y, x)` is atan2; there is no `angle`.
        return `atan(${source}.y, ${source}.x)`;
      }
      return `${node.op}(${source})`;
    }
    case "binary": {
      const operator = BINARY_OPERATORS[node.op];
      const left = `n${String(node.left)}`;
      const right = `n${String(node.right)}`;
      return operator === undefined
        ? `${node.op}(${left}, ${right})`
        : `(${left} ${operator} ${right})`;
    }
    case "mix":
      return `mix(n${String(node.a)}, n${String(node.b)}, n${String(node.t)})`;
    case "select":
      // The dead branch was never marked reachable, so it has no local.
      return `n${String(resolveShaderSelect(node, defines))}`;
    case "storage":
      // Unreachable through `emitShaderGraphGlsl`, which refuses storage
      // first; kept so the switch is total over the closed union.
      throw new RangeError(STORAGE_REFUSAL);
    default:
      // "light" — the union's last member. Scalar members read their
      // uniform; array members clamp the float index into the slot range.
      return node.index === undefined
        ? LIGHT_UNIFORM_NAMES[node.member]
        : `${LIGHT_UNIFORM_NAMES[node.member]}[clamp(int(n${String(node.index)}), 0, ${String(SHADER_LIGHT_SLOTS - 1)})]`;
  }
}

/** §82's WebGL answer: GLSL ES 3.00 has no storage buffers (capability absent). */
const STORAGE_REFUSAL =
  "§82: storage-buffer nodes need WebGPU; WebGL 2 has no storage buffers, " +
  "so this graph is not emitted on this backend.";

/** The fragment uniform each `"light"` member reads (§68). */
const LIGHT_UNIFORM_NAMES: Readonly<Record<ShaderLightMember, string>> = {
  ambient: "l_ambient",
  directionalDirection: "l_direction",
  directionalColor: "l_color",
  cameraPosition: "l_camera",
  punctualCount: "l_count",
  punctualPosition: "l_positions",
  punctualColor: "l_colors",
  punctualDirection: "l_directions",
  punctualParams: "l_params",
};

/** GLSL declarations for the light members a graph reads, reflection order. */
function emitLightDeclarations(members: readonly ShaderLightMember[]): string {
  let out = "";
  for (const member of members) {
    const name = LIGHT_UNIFORM_NAMES[member];
    if (member === "punctualCount") {
      out += `uniform float ${name};\n`;
    } else if (Object.hasOwn(SHADER_LIGHT_ARRAY_TYPES, member)) {
      const type = member === "punctualParams" ? "vec4" : "vec3";
      out += `uniform ${type} ${name}[${String(SHADER_LIGHT_SLOTS)}];\n`;
    } else {
      out += `uniform vec3 ${name};\n`;
    }
  }
  return out;
}

/** One `T nK = expr;` line per reachable node, in array order (§33). */
function emitLocals(
  graph: ShaderGraph,
  analysis: ShaderGraphAnalysis,
  reachable: readonly boolean[],
  stage: "vertex" | "fragment",
): string {
  let out = "";
  for (let index = 0; index < graph.nodes.length; index += 1) {
    if (!reachable[index]) {
      continue;
    }
    const expression = nodeExpression(
      graph.nodes[index],
      stage,
      graph.uniformTransport === "std140",
      graph.defines,
    );
    out += `  ${analysis.nodeTypes[index]} n${String(index)} = ${expression};\n`;
  }
  return out;
}

/** The `uniform` declarations one stage needs, node order, deduplicated. */
function emitUniformDeclarations(
  graph: ShaderGraph,
  reachable: readonly boolean[],
): string {
  if (graph.uniformTransport === "std140") {
    const uniforms = analyzeShaderGraph(graph).reflection.uniforms;
    if (uniforms.length === 0) return "";
    return (
      "layout(std140) uniform FourNodeUniforms {\n" +
      uniforms
        .map(
          ({ name, type }) =>
            `  ${type === "mat3" || type === "mat4" ? "mat4" : "vec4"} u_${name};\n`,
        )
        .join("") +
      "};\n"
    );
  }
  let out = "";
  const seen = new Set<string>();
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    if (!reachable[index] || node.kind !== "uniform" || seen.has(node.name)) {
      continue;
    }
    seen.add(node.name);
    out += `uniform ${uniformDeclarationType(node.type)} u_${node.name};\n`;
  }
  return out;
}

/** `uniform float time;` where the stage's subgraph reads it, else nothing. */
function emitTimeDeclaration(
  graph: ShaderGraph,
  reachable: readonly boolean[],
): string {
  for (let index = 0; index < graph.nodes.length; index += 1) {
    if (reachable[index] && graph.nodes[index].kind === "time") {
      return "uniform float time;\n";
    }
  }
  return "";
}

/** The attributes one subgraph reads, in fixed location order. */
function attributesUsed(
  graph: ShaderGraph,
  reachable: readonly boolean[],
): ShaderAttributeName[] {
  const seen = new Set<ShaderAttributeName>();
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    if (reachable[index] && node.kind === "attribute") {
      seen.add(node.name);
    }
  }
  return ATTRIBUTE_ORDER.filter((name) => seen.has(name));
}

/**
 * Emits GLSL ES 3.00 for `graph` — both stages plus the binding metadata the
 * program class resolves locations from.
 *
 * Pure and deterministic: the same graph emits the same bytes, every time, on
 * every platform (§33 — pinned by `tests/determinism/`'s golden). Validation
 * is `analyzeShaderGraph`'s and throws its `RangeError` for a malformed
 * graph; a graph that validates always emits.
 */
export function emitShaderGraphGlsl(graph: ShaderGraph): EmittedNodeShader {
  const analysis = analyzeShaderGraph(graph);
  if (analysis.reflection.storage.length > 0) {
    throw new RangeError(STORAGE_REFUSAL);
  }
  const usesTime = graph.nodes.some(
    (node, index) =>
      node.kind === "time" &&
      (analysis.colorReachable[index] || analysis.offsetReachable[index]),
  );
  const textures = analysis.reflection.textures.map((record) => record.name);

  if (graph.domain === "screen") {
    const varyingLine =
      attributesUsed(graph, analysis.colorReachable).length > 0
        ? "in vec2 v_uv;\n"
        : "";
    const fragment =
      "#version 300 es\nprecision highp float;\n\n" +
      varyingLine +
      emitTimeDeclaration(graph, analysis.colorReachable) +
      emitUniformDeclarations(graph, analysis.colorReachable) +
      textures.map((name) => `uniform sampler2D s_${name};\n`).join("") +
      "\nout vec4 fragColor;\n\nvoid main() {\n" +
      emitLocals(graph, analysis, analysis.colorReachable, "fragment") +
      `  fragColor = n${String(graph.color)};\n}\n`;
    return {
      domain: "screen",
      ...(graph.uniformTransport === "std140" &&
      analysis.reflection.uniforms.length > 0
        ? { uniformBlock: true }
        : {}),
      vertex: SCREEN_VERTEX_SHADER_SOURCE,
      sourceMap: {
        vertex: createShaderSourceMap(SCREEN_VERTEX_SHADER_SOURCE),
        fragment: createShaderSourceMap(fragment, "fragment"),
      },
      fragment,
      usesTime,
      uniforms: analysis.reflection.uniforms,
      textures,
      lights: [],
    };
  }

  // Surface domain. The vertex stage evaluates the (optional) displacement
  // subgraph and forwards a varying for every attribute the colour subgraph
  // reads; the fragment stage evaluates the colour subgraph.
  const fragmentAttributes = attributesUsed(graph, analysis.colorReachable);
  const vertexAttributes = attributesUsed(graph, analysis.offsetReachable);
  const declared = new Set<ShaderAttributeName>(["position"]);
  for (const name of [...vertexAttributes, ...fragmentAttributes]) {
    declared.add(name);
  }

  let vertex = "#version 300 es\n";
  for (const name of ATTRIBUTE_ORDER) {
    if (declared.has(name)) {
      vertex += `${ATTRIBUTE_DECLARATIONS[name]}\n`;
    }
  }
  vertex += "\nuniform mat4 viewProjection;\nuniform mat4 model;\n";
  vertex += emitTimeDeclaration(graph, analysis.offsetReachable);
  vertex += emitUniformDeclarations(graph, analysis.offsetReachable);
  for (const name of fragmentAttributes) {
    vertex += `out ${VARYING_TYPES[name]} ${VARYING_NAMES[name]};\n`;
  }
  vertex += "\nvoid main() {\n";
  for (const name of fragmentAttributes) {
    vertex += `  ${VARYING_NAMES[name]} = ${VERTEX_ATTRIBUTE_REFERENCES[name]};\n`;
  }
  const offset = graph.positionOffset;
  if (offset === undefined) {
    vertex +=
      "  gl_Position = viewProjection * model * vec4(position, 1.0);\n}\n";
  } else {
    vertex += emitLocals(graph, analysis, analysis.offsetReachable, "vertex");
    vertex += `  gl_Position = viewProjection * model * vec4(position + n${String(
      offset,
    )}, 1.0);\n}\n`;
  }

  let fragment = "#version 300 es\nprecision highp float;\n\n";
  for (const name of fragmentAttributes) {
    fragment += `in ${VARYING_TYPES[name]} ${VARYING_NAMES[name]};\n`;
  }
  // §57's opacity multiplies the graph's alpha — the family rule, uploaded
  // per draw and mirrored at GL's initial 0 by the program class.
  fragment += "uniform float opacity;\n";
  fragment += emitTimeDeclaration(graph, analysis.colorReachable);
  fragment += emitUniformDeclarations(graph, analysis.colorReachable);
  fragment += emitLightDeclarations(analysis.reflection.lights);
  fragment += textures.map((name) => `uniform sampler2D s_${name};\n`).join("");
  fragment += "\nout vec4 fragColor;\n\nvoid main() {\n";
  fragment += emitLocals(graph, analysis, analysis.colorReachable, "fragment");
  fragment += `  vec4 c = n${String(graph.color)};\n`;
  fragment += "  fragColor = vec4(c.rgb, c.a * opacity);\n}\n";

  return {
    domain: "surface",
    ...(graph.uniformTransport === "std140" &&
    analysis.reflection.uniforms.length > 0
      ? { uniformBlock: true }
      : {}),
    sourceMap: {
      vertex: createShaderSourceMap(vertex),
      fragment: createShaderSourceMap(fragment, "fragment"),
    },
    vertex,
    fragment,
    usesTime,
    uniforms: analysis.reflection.uniforms,
    textures,
    lights: analysis.reflection.lights,
  };
}

/** Scratch for scalar/vector/matrix uniform uploads — `matrixScratch`'s rule. */
const vec3Scratch = new Float32Array(3);
const vec4Scratch = new Float32Array(4);

/** One uniform's resolved binding. */
interface LightBinding {
  readonly member: ShaderLightMember;
  readonly location: GlUniformLocation;
}

interface UniformBinding {
  readonly name: string;
  readonly type: ShaderValueType;
  readonly location: GlUniformLocation;
}

/**
 * One compiled node program (§60) — see `node-pipeline-registry.ts` for the
 * contract each member serves. Constructed by {@link GlNodeProgramCache}
 * only; owns its GL program and nothing else.
 */
export class GlNodeProgram implements NodeMaterialProgram, Disposable {
  viewStamp = -1;

  readonly textures: readonly string[];

  readonly unitBase: number;

  /** Whether the graph reads the §68 light block (the renderer then calls {@link setLights}). */
  readonly usesLights: boolean;

  readonly #lightBindings: readonly LightBinding[];

  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation | null;

  readonly #modelLocation: GlUniformLocation | null;

  readonly #opacityLocation: GlUniformLocation | null;

  readonly #timeLocation: GlUniformLocation | null;

  readonly #uniforms: readonly UniformBinding[];
  readonly #block: GlNodeUniformBlock | null;
  readonly #uniformRecords: readonly ShaderUniformReflection[];

  readonly #uniformsByName: ReadonlyMap<string, UniformBinding>;

  readonly #samplerLocations: readonly GlUniformLocation[];

  /** CPU mirrors at GL's initial values — the family's byte-identity move. */
  #opacity = 0;

  #time = 0;

  #samplersUploaded = false;

  #disposed = false;

  private constructor(gl: WebglContext, emitted: EmittedNodeShader) {
    let program: GlProgramHandle;
    try {
      program = createLinkedProgram(
        gl,
        "node-material",
        emitted.vertex,
        emitted.fragment,
      );
    } catch (error: unknown) {
      if (error instanceof FourError) {
        throw new FourError(error.code, error.message, {
          cause: error,
          context: { ...error.context, sourceMap: emitted.sourceMap },
        });
      }
      throw error;
    }
    try {
      this.#gl = gl;
      this.#uniformRecords = emitted.uniforms;
      this.#program = program;
      const surface = emitted.domain === "surface";
      this.unitBase = surface ? NODE_SURFACE_TEXTURE_UNIT_BASE : 0;
      this.#viewProjectionLocation = surface
        ? requireUniform(gl, program, "viewProjection", "node-material")
        : null;
      this.#modelLocation = surface
        ? requireUniform(gl, program, "model", "node-material")
        : null;
      this.#opacityLocation = surface
        ? requireUniform(gl, program, "opacity", "node-material")
        : null;
      this.#timeLocation = emitted.usesTime
        ? requireUniform(gl, program, "time", "node-material")
        : null;
      this.#uniforms = (
        emitted.uniformBlock === true ? [] : emitted.uniforms
      ).map((record) => ({
        name: record.name,
        type: record.type,
        location: requireUniform(
          gl,
          program,
          `u_${record.name}`,
          "node-material",
        ),
      }));
      this.#uniformsByName = new Map(
        this.#uniforms.map((binding) => [binding.name, binding] as const),
      );
      this.textures = emitted.textures;
      this.#samplerLocations = emitted.textures.map((name) =>
        requireUniform(gl, program, `s_${name}`, "node-material"),
      );
      this.#lightBindings = emitted.lights.map((member) => ({
        member,
        location: requireUniform(
          gl,
          program,
          LIGHT_UNIFORM_NAMES[member],
          "node-material",
        ),
      }));
      this.usesLights = this.#lightBindings.length > 0;
      this.#block =
        emitted.uniformBlock === true
          ? new GlNodeUniformBlock(gl, program, emitted.uniforms)
          : null;
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Compiles and links `emitted` — `UnlitProgram.create`'s contract (§89). */
  static create(gl: WebglContext, emitted: EmittedNodeShader): GlNodeProgram {
    return new GlNodeProgram(gl, emitted);
  }

  /** Whether {@link GlNodeProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
    this.#block?.bind();
    if (!this.#samplersUploaded) {
      // Once per program lifetime, and only with the program current
      // (`uniform1i` writes into the bound program — the `setSampler` rule).
      for (let index = 0; index < this.#samplerLocations.length; index += 1) {
        this.#gl.uniform1i(
          this.#samplerLocations[index],
          this.unitBase + index,
        );
      }
      this.#samplersUploaded = true;
    }
  }

  setViewProjection(matrix: Matrix4): void {
    if (this.#viewProjectionLocation === null) {
      return;
    }
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  setModel(matrix: Matrix4): void {
    if (this.#modelLocation === null) {
      return;
    }
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  setLights(
    lights: SceneLights,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
  ): void {
    const gl = this.#gl;
    for (const { member, location } of this.#lightBindings) {
      switch (member) {
        case "ambient":
          vec3Scratch.set(lights.ambientColor);
          gl.uniform3fv(location, vec3Scratch);
          break;
        case "directionalDirection":
          vec3Scratch[0] = lights.direction.x;
          vec3Scratch[1] = lights.direction.y;
          vec3Scratch[2] = lights.direction.z;
          gl.uniform3fv(location, vec3Scratch);
          break;
        case "directionalColor":
          vec3Scratch.set(lights.directionalColor);
          gl.uniform3fv(location, vec3Scratch);
          break;
        case "cameraPosition":
          vec3Scratch[0] = eyeX;
          vec3Scratch[1] = eyeY;
          vec3Scratch[2] = eyeZ;
          gl.uniform3fv(location, vec3Scratch);
          break;
        case "punctualCount":
          gl.uniform1f(location, lights.punctualCount);
          break;
        case "punctualPosition":
          gl.uniform3fv(location, lights.punctualPositions);
          break;
        case "punctualColor":
          gl.uniform3fv(location, lights.punctualColors);
          break;
        case "punctualDirection":
          gl.uniform3fv(location, lights.punctualDirections);
          break;
        default:
          // "punctualParams" — the union's last member.
          gl.uniform4fv(location, lights.punctualParams);
      }
    }
  }

  setTime(seconds: number): void {
    if (this.#timeLocation === null || seconds === this.#time) {
      return;
    }
    this.#gl.uniform1f(this.#timeLocation, seconds);
    this.#time = seconds;
  }

  setMaterial(material: NodeItemMaterial): void {
    // Defensive, like every §57 read in the backend: a structural double that
    // predates the field reports `undefined`, which must mean the default.
    const opacity = material.opacity ?? 1;
    if (this.#opacityLocation !== null && opacity !== this.#opacity) {
      this.#gl.uniform1f(this.#opacityLocation, opacity);
      this.#opacity = opacity;
    }
    if (this.#block !== null) {
      for (const uniform of this.#uniformRecords) {
        this.#block.set(uniform.name, material.getUniform(uniform.name));
      }
      this.#block.upload();
    } else {
      for (const binding of this.#uniforms)
        this.#upload(binding, material.getUniform(binding.name));
    }
  }

  setUniform(name: string, value: ArrayLike<number>): void {
    if (this.#block !== null) {
      if (this.#block.set(name, value)) this.#block.upload();
      return;
    }
    const binding = this.#uniformsByName.get(name);
    if (binding === undefined) {
      // §61: inside a frame nothing throws; `validateEffectRenderPass`
      // already refused unknown names at setup.
      return;
    }
    this.#upload(binding, value);
  }

  /** Uploads one value through the padding rule (module header). */
  #upload(binding: UniformBinding, value: ArrayLike<number>): void {
    const gl = this.#gl;
    switch (binding.type) {
      case "float":
        gl.uniform1f(binding.location, value[0]);
        return;
      case "vec2":
        // Declared vec4, read `.xy` — the padding rule.
        vec4Scratch[0] = value[0];
        vec4Scratch[1] = value[1];
        vec4Scratch[2] = 0;
        vec4Scratch[3] = 0;
        gl.uniform4fv(binding.location, vec4Scratch);
        return;
      case "vec3":
        vec3Scratch[0] = value[0];
        vec3Scratch[1] = value[1];
        vec3Scratch[2] = value[2];
        gl.uniform3fv(binding.location, vec3Scratch);
        return;
      case "vec4":
        vec4Scratch[0] = value[0];
        vec4Scratch[1] = value[1];
        vec4Scratch[2] = value[2];
        vec4Scratch[3] = value[3];
        gl.uniform4fv(binding.location, vec4Scratch);
        return;
      case "mat3": {
        // Declared mat4, read `mat3(...)` — columns padded, w column identity.
        for (let column = 0; column < 3; column += 1) {
          matrixScratch[column * 4] = value[column * 3];
          matrixScratch[column * 4 + 1] = value[column * 3 + 1];
          matrixScratch[column * 4 + 2] = value[column * 3 + 2];
          matrixScratch[column * 4 + 3] = 0;
        }
        matrixScratch[12] = 0;
        matrixScratch[13] = 0;
        matrixScratch[14] = 0;
        matrixScratch[15] = 1;
        gl.uniformMatrix4fv(binding.location, false, matrixScratch);
        return;
      }
      default: {
        // "mat4" — the type union's last member.
        for (let index = 0; index < 16; index += 1) {
          matrixScratch[index] = value[index];
        }
        gl.uniformMatrix4fv(binding.location, false, matrixScratch);
      }
    }
  }

  /** Deletes the GL program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#block?.dispose();
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * One context's node-program cache — the structural split the module header
 * describes. Created per renderer by the registered factory; forgotten on
 * context loss (the renderer drops its reference), disposed with the
 * renderer.
 */
export class GlNodeProgramCache implements NodeMaterialPrograms {
  readonly #gl: WebglContext;

  /**
   * The identity fast path plus the per-graph failure latch: `null` means
   * "this graph failed on this context — do not ask the driver again every
   * frame" (the skinning latch, per graph).
   */
  readonly #byGraph = new WeakMap<ShaderGraph, GlNodeProgram | null>();

  /** The structural cache: emitted source → the one compiled program. */
  readonly #bySource = new Map<string, GlNodeProgram>();

  /** Distinguishes the one-time warnings of distinct failed graphs. */
  #failureSerial = 0;

  #disposed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  get programCount(): number {
    return this.#bySource.size;
  }

  acquire(graph: ShaderGraph): GlNodeProgram | null {
    const cached = this.#byGraph.get(graph);
    if (cached !== undefined) {
      return cached;
    }
    let emitted: EmittedNodeShader;
    try {
      emitted = emitShaderGraphGlsl(graph);
    } catch (error: unknown) {
      // A malformed graph reached the frame without passing through
      // `NodeMaterial`'s constructor (a hand-built item, a structural
      // double). §61: skipped, latched, warned once — never a throw.
      this.#latchFailure(graph, error);
      return null;
    }
    const key = `${emitted.vertex}\u0000${emitted.fragment}`;
    const existing = this.#bySource.get(key);
    if (existing !== undefined) {
      this.#byGraph.set(graph, existing);
      return existing;
    }
    let program: GlNodeProgram;
    try {
      program = GlNodeProgram.create(this.#gl, emitted);
    } catch (error: unknown) {
      // The driver refused the compile — §89's SHADER_COMPILATION_FAILED,
      // with the emitted source and the driver log in its context.
      this.#latchFailure(graph, error);
      return null;
    }
    this.#bySource.set(key, program);
    this.#byGraph.set(graph, program);
    return program;
  }

  #latchFailure(graph: ShaderGraph, error: unknown): void {
    this.#byGraph.set(graph, null);
    if (DEV) {
      this.#failureSerial += 1;
      devWarnOnce(
        `webgl-node-material-failed:${String(this.#failureSerial)}`,
        "§60: a node-material graph failed to compile on this context; its " +
          `draws are skipped (§61, §89). ${String(error)}`,
      );
    }
  }

  /** Deletes every compiled program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const program of this.#bySource.values()) {
      program.dispose();
    }
    this.#bySource.clear();
  }
}

/**
 * Opts this process's `WebglRenderer`s into §60 node materials and §70 graph
 * effects (RFC 0001).
 *
 * ```ts
 * import { registerNodeMaterialPipeline } from "@fourjs/render-webgl";
 * registerNodeMaterialPipeline();      // once, at application setup
 * ```
 *
 * Calling it is what links this module — the GLSL emitter and the program
 * cache — into the bundle; a build that never calls it carries none of it
 * (grep-proven in the packet's A/B). Programs still compile **lazily, per
 * distinct graph, on each renderer's first draw that needs one** — never here
 * and never at renderer initialize — so registration alone changes no GL
 * transcript. Idempotent; calling it twice re-installs the same factory.
 */
export function registerNodeMaterialPipeline(): void {
  setNodeMaterialPipelineFactory({
    create(gl: WebglContext): NodeMaterialPrograms {
      return new GlNodeProgramCache(gl);
    },
  });
}
