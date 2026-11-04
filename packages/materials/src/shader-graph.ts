/**
 * The shader graph (§60) — a backend-independent, JSON-serializable shader IR
 * (RFC 0001, accepted 2026-08-21; gap R-14).
 *
 * ## The unit of extension is a graph, not a source string
 *
 * Nothing in this module — or anywhere in the public surface — accepts GLSL
 * or WGSL text, at any tier. That is the RFC's whole argument, and §96's
 * requirement ("no arbitrary code execution from scene files; safe shader
 * boundaries") made binding by spec revision 1.11: a shader expressed as a
 * string is an opaque pass, and a shader expressed as a graph is a checkable
 * one. Every texture a graph samples is enumerable from the graph
 * ({@link analyzeShaderGraph}), which is what lets `RenderGraph.validate()`
 * run its feedback and ordering checks over a §70 graph effect exactly as it
 * runs them over a built-in one — the property a source string would destroy.
 *
 * ## Closed unions, closed on purpose
 *
 * {@link ShaderNode} is a closed discriminated union for exactly the reason
 * `ScreenEffect` and `RenderTargetFormat` are: an operator this repository has
 * not implemented must be a compile error, never a value a backend receives
 * and quietly drops. Widening the operator set is a versioned, reviewed act —
 * RFC 0001's deferred alternative E (a data-declared custom operator) is the
 * named follow-up, and until it lands the closed set *is* the §96 shader trust
 * boundary: shading is a graph of closed operators, and a scene document can
 * carry a picture but never a program.
 *
 * ## Where this lives, and why
 *
 * `@fourjs/materials` is the home §98 assigns ("material families, paints, node
 * materials"), and its §3.1 row is `core, math` — a pure data IR adds no
 * edge. Backends read the IR through the types and functions `@fourjs/render`
 * re-exports, so `@fourjs/render-webgl`'s frozen `core, math, render` row is
 * untouched (the same legality argument the §62 registry made).
 *
 * ## Determinism (§33)
 *
 * Everything here iterates `ShaderGraph.nodes` in array order — never
 * `Map`/`Set` enumeration order — so validation results, reflection order,
 * and the GLSL a backend emits from the same walk are pure functions of the
 * graph. That is what makes a backend's program cache keyable on the emitted
 * source and lets `tests/determinism/` pin the emission byte-for-byte.
 */

/** A node's identity inside one graph — its index in {@link ShaderGraph.nodes}. */
export type ShaderNodeId = number;

/** The value shape flowing along an edge (§60 "reflection metadata"). */
export type ShaderValueType =
  "float" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4";

/**
 * Which stage inputs a graph may name (§60 "vertex attributes"), and therefore
 * which emitter validates it. `"surface"` graphs shade a `Renderable`;
 * `"screen"` graphs shade a §70 full-screen pass and have no geometry at all.
 */
export type ShaderDomain = "surface" | "screen";

/**
 * The four attributes a `"surface"` graph may read — exactly R-19's four fixed
 * vertex locations (0 position, 1 normal, 2 uv, 3 colour). §53's remaining
 * standard attributes (tangent, secondary uv, joints/weights, instance
 * transform) are unnameable until the packets that add them land — the same
 * closed-union staging, applied to the attribute set.
 *
 * In the `"screen"` domain only `"uv"` is nameable, and it means the pass's
 * own normalized coordinate — `0..1` across the destination surface. This is
 * a recorded deviation from RFC 0001 §5, which rejected every attribute in
 * the screen domain: without a coordinate the domain cannot express even a
 * copy, a full-screen pass *does* have a uv (the one varying its triangle
 * already interpolates), and "the surface parameterization of the thing being
 * shaded" is what `"uv"` means in both domains. `"position"`, `"normal"` and
 * `"color"` stay rejected there — there is no mesh.
 */
export type ShaderAttributeName = "position" | "normal" | "uv" | "color";

/**
 * The unary operators (§60), closed — see the module header.
 *
 * `"angle"` is RFC 0001's one-row closed-union amendment: `atan2(y, x)` of a
 * `vec2`, in radians (right-handed, §7a), so a §58 conic gradient can be
 * expressed without opening the operator set any further.
 */
export type ShaderUnaryOp =
  | "sin"
  | "cos"
  | "abs"
  | "floor"
  | "fract"
  | "normalize"
  | "negate"
  | "saturate"
  | "length"
  | "angle";

/**
 * The binary operators (§60), closed. `"step"`'s left operand is the edge and
 * its right the value, matching GLSL's `step(edge, x)`.
 */
export type ShaderBinaryOp =
  "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "dot" | "step";

/**
 * One operator, as a closed discriminated union — closed for exactly the
 * reason the module header gives. Every reference is a {@link ShaderNodeId}
 * that must point at an **earlier** node (`id < index`), which is what makes
 * every well-formed graph acyclic by construction and lets a backend emit it
 * in one forward pass (§33).
 */
export type ShaderNode =
  | {
      readonly kind: "constant";
      readonly type: ShaderValueType;
      readonly value: readonly number[];
    }
  | {
      readonly kind: "uniform";
      readonly type: ShaderValueType;
      readonly name: string;
    }
  | { readonly kind: "attribute"; readonly name: ShaderAttributeName }
  | {
      readonly kind: "texture";
      readonly name: string;
      readonly uv: ShaderNodeId;
    }
  | { readonly kind: "time" }
  | {
      readonly kind: "compose";
      readonly type: ShaderValueType;
      readonly parts: readonly ShaderNodeId[];
    }
  | {
      readonly kind: "swizzle";
      readonly source: ShaderNodeId;
      readonly pattern: string;
    }
  | {
      readonly kind: "unary";
      readonly op: ShaderUnaryOp;
      readonly source: ShaderNodeId;
    }
  | {
      readonly kind: "binary";
      readonly op: ShaderBinaryOp;
      readonly left: ShaderNodeId;
      readonly right: ShaderNodeId;
    }
  | {
      readonly kind: "mix";
      readonly a: ShaderNodeId;
      readonly b: ShaderNodeId;
      readonly t: ShaderNodeId;
    }
  | {
      /**
       * A read-only storage buffer element (§82; RFC 0001 addendum, accepted
       * 2026-11-04): `name` binds a `ShaderStorageBuffer` of `count` elements
       * of `type`; `index` is a float node, floored and clamped into
       * `[0, count - 1]` at the read. Fragment stage, surface domain only.
       */
      readonly kind: "storage";
      readonly name: string;
      readonly type: ShaderStorageElementType;
      readonly count: number;
      readonly index: ShaderNodeId;
    }
  | {
      /**
       * Compile-time conditional: resolves to `then` when the graph's named
       * boolean define is true and to `otherwise` otherwise. The dead branch
       * is never emitted and reserves no resources.
       */
      readonly kind: "select";
      readonly define: string;
      readonly then: ShaderNodeId;
      readonly otherwise: ShaderNodeId;
    }
  | {
      /**
       * A member of the renderer's light block (§68), bound automatically —
       * the graph declares no uniform. Array members need `index`, a float
       * node clamped into `[0, SHADER_LIGHT_SLOTS - 1]`. Fragment stage,
       * surface domain only.
       */
      readonly kind: "light";
      readonly member: ShaderLightMember;
      readonly index?: ShaderNodeId;
    };

/** Element types a storage node may read (vec3 is excluded: its array stride is padded). */
export type ShaderStorageElementType = "float" | "vec2" | "vec4";

/** Scalar members of the light family and their types. */
export type ShaderLightScalarMember =
  | "ambient"
  | "directionalDirection"
  | "directionalColor"
  | "cameraPosition"
  | "punctualCount";

/** Array members of the light family (indexed by a float node). */
export type ShaderLightArrayMember =
  "punctualPosition" | "punctualColor" | "punctualDirection" | "punctualParams";

/** Every member the `"lights"` input family exposes. */
export type ShaderLightMember =
  ShaderLightScalarMember | ShaderLightArrayMember;

/**
 * A validated graph: nodes in insertion order (§33), plus its two outputs.
 *
 * `time` nodes read §9 **render** time, never simulation time: a graph is a
 * rendering artefact, and §42/§43's "render interpolation never feeds back
 * into physics state" means nothing downstream of a shader may become
 * simulation input. Backends receive the current render time from the
 * application (see `WebglRenderer.renderTime`).
 */
export interface ShaderGraph {
  /** Opt-in padded std140 on WebGL; WebGPU already transports uniforms in a block. */
  readonly uniformTransport?: "individual" | "std140";
  readonly domain: ShaderDomain;
  readonly nodes: readonly ShaderNode[];
  /**
   * Named boolean compile-time defines that `"select"` nodes read. A select
   * whose define is absent here resolves to `false`. Backends emit only the
   * live branch, so two define sets yielding identical source share one
   * compiled program. See {@link specializeShaderGraph}.
   */
  readonly defines?: Readonly<Record<string, boolean>>;
  /** `vec4`, required. The fragment result, in the domain's colour space (§60a). */
  readonly color: ShaderNodeId;
  /**
   * `vec3` object-space displacement added to `position`, or `undefined`.
   * `"screen"` graphs must omit it — a full-screen pass has no vertices to
   * move. A displacement is **not** a transform: §42's authority model is
   * untouched, nothing tells the physics world, and by decision (RFC 0001 Q4)
   * no §85 warning is raised when a displacing material sits on a collider.
   */
  readonly positionOffset?: ShaderNodeId;
}

/** One uniform a compiled shader exposes (§60 "reflection metadata"). */
export interface ShaderUniformReflection {
  readonly name: string;
  readonly type: ShaderValueType;
}

/** One sampler a compiled shader exposes (§60 "textures and samplers"). */
export interface ShaderTextureReflection {
  readonly name: string;
}

/**
 * What a compiled graph binds (§60 "reflection metadata") — derived from the
 * graph alone, before any backend exists, in first-appearance node order
 * (§33). Only nodes **reachable** from the graph's outputs appear: a dead
 * uniform is never declared by an emitter, so reflecting it would promise a
 * binding no program has.
 */
export interface ShaderReflection {
  readonly uniforms: readonly ShaderUniformReflection[];
  readonly textures: readonly ShaderTextureReflection[];
  readonly attributes: readonly ShaderAttributeName[];
  /** Storage buffers the live graph reads, first-appearance order (§82). */
  readonly storage: readonly ShaderStorageReflection[];
  /** Light-block members the live graph reads, first-appearance order (§68). */
  readonly lights: readonly ShaderLightMember[];
}

/** One storage buffer a compiled shader reads (§82). */
export interface ShaderStorageReflection {
  readonly name: string;
  readonly type: ShaderStorageElementType;
  /** The compile-time element bound reads are clamped to. */
  readonly count: number;
}

/**
 * Everything {@link analyzeShaderGraph} learns in one validated walk — the
 * reflection, each node's value type, and which nodes each output reaches
 * (index-aligned with {@link ShaderGraph.nodes}). Backends use the masks for
 * dead-node elimination — the **only** transform RFC 0001 permits an MVP
 * compiler (reassociating float expressions changes pixels, and §92's
 * pixel-golden tier would then be gated on a compiler's mood).
 */
export interface ShaderGraphAnalysis {
  readonly reflection: ShaderReflection;
  readonly nodeTypes: readonly ShaderValueType[];
  readonly colorReachable: readonly boolean[];
  readonly offsetReachable: readonly boolean[];
}

/**
 * The most nodes a graph may carry — a §96 input bound (a graph is JSON a
 * scene document may some day carry) and a §85 sanity limit, far above any
 * authored shader's size.
 */
export const MAX_SHADER_GRAPH_NODES = 1024;

/**
 * The most distinct samplers a graph may bind. Eight, well inside WebGL 2's
 * guaranteed sixteen fragment texture units, leaving the backend's fixed
 * units (the albedo map's 0, the §69 shadow map's 1) untouched.
 */
export const MAX_SHADER_GRAPH_TEXTURES = 8;

/** The most distinct storage buffers a graph may read (§82). */
export const MAX_SHADER_GRAPH_STORAGE = 4;

/** The most elements one storage node may declare. */
export const MAX_SHADER_STORAGE_COUNT = 65536;

/** The most named defines a graph may carry. */
export const MAX_SHADER_GRAPH_DEFINES = 32;

/**
 * Slots in the light block's punctual arrays — equal to the renderer's
 * `MAX_LIGHT_SLOTS` (`@fourjs/render`; pinned by a render-webgpu test, since
 * materials cannot import render).
 */
export const SHADER_LIGHT_SLOTS = 11;

/** Value types of the scalar light members. */
export const SHADER_LIGHT_SCALAR_TYPES: Readonly<
  Record<ShaderLightScalarMember, ShaderValueType>
> = Object.freeze({
  ambient: "vec3",
  directionalDirection: "vec3",
  directionalColor: "vec3",
  cameraPosition: "vec3",
  punctualCount: "float",
});

/** Value types of the array light members. */
export const SHADER_LIGHT_ARRAY_TYPES: Readonly<
  Record<ShaderLightArrayMember, ShaderValueType>
> = Object.freeze({
  punctualPosition: "vec3",
  punctualColor: "vec3",
  punctualDirection: "vec3",
  punctualParams: "vec4",
});

/** Components per {@link ShaderValueType} — the arity table everything shares. */
export const SHADER_VALUE_COMPONENTS: Readonly<
  Record<ShaderValueType, number>
> = Object.freeze({
  float: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4,
  mat3: 9,
  mat4: 16,
});

/** The attribute types of {@link ShaderAttributeName} — R-19's four streams. */
export const SHADER_ATTRIBUTE_TYPES: Readonly<
  Record<ShaderAttributeName, ShaderValueType>
> = Object.freeze({
  position: "vec3",
  normal: "vec3",
  uv: "vec2",
  color: "vec4",
});

/**
 * Names a uniform or a sampler may carry: an identifier that survives the
 * emitter's `u_`/`s_` prefixing on every backend. Leading underscores and
 * double underscores are refused because GLSL reserves identifiers containing
 * `__`, and the prefix would manufacture one.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A swizzle pattern: one to four components of `xyzw`. */
const SWIZZLE_PATTERN = /^[xyzw]{1,4}$/;

/** The component index each swizzle letter selects. */
const SWIZZLE_INDEX: Readonly<Record<string, number>> = Object.freeze({
  x: 0,
  y: 1,
  z: 2,
  w: 3,
});

/** Is `type` a float or a vector (the componentwise family)? */
function isScalarOrVector(type: ShaderValueType): boolean {
  return type !== "mat3" && type !== "mat4";
}

/** Is `type` a vector? */
function isVector(type: ShaderValueType): boolean {
  return type === "vec2" || type === "vec3" || type === "vec4";
}

/** The result type of a swizzle, by pattern length (1-based at index 0). */
const SWIZZLE_RESULT_TYPES: readonly ShaderValueType[] = [
  "float",
  "vec2",
  "vec3",
  "vec4",
];

/** §85's refusal, uniformly cited. */
function refuse(index: number | null, detail: string): never {
  const where =
    index === null ? "ShaderGraph" : `ShaderGraph node ${String(index)}`;
  throw new RangeError(`${where}: ${detail} (§60, §85; RFC 0001).`);
}

/** Checks one node reference: an integer pointing at an earlier node. */
function requireReference(id: ShaderNodeId, index: number, what: string): void {
  if (!Number.isInteger(id) || id < 0 || id >= index) {
    refuse(
      index,
      `${what} must reference an earlier node (an integer in [0, ${String(
        index,
      )})); got ${String(id)}`,
    );
  }
}

/**
 * Calls `visit` with every node id `node` references, in declaration order
 * (§33). Exported because the emitter's reachability walk and this module's
 * validation must agree on what "references" means, and one function cannot
 * drift from itself.
 */
export function forEachShaderNodeReference(
  node: ShaderNode,
  visit: (id: ShaderNodeId) => void,
): void {
  switch (node.kind) {
    case "texture":
      visit(node.uv);
      return;
    case "compose":
      for (const part of node.parts) {
        visit(part);
      }
      return;
    case "swizzle":
      visit(node.source);
      return;
    case "unary":
      visit(node.source);
      return;
    case "binary":
      visit(node.left);
      visit(node.right);
      return;
    case "mix":
      visit(node.a);
      visit(node.b);
      visit(node.t);
      return;
    case "storage":
      visit(node.index);
      return;
    case "select":
      // Structural walk: both branches. Liveness is define-aware elsewhere.
      visit(node.then);
      visit(node.otherwise);
      return;
    case "light":
      if (node.index !== undefined) {
        visit(node.index);
      }
      return;
    default:
      // constant, uniform, attribute, time: leaves.
      return;
  }
}

/** Type-checks a binary node; returns the result type or refuses. */
function binaryResultType(
  index: number,
  op: ShaderBinaryOp,
  left: ShaderValueType,
  right: ShaderValueType,
): ShaderValueType {
  if (
    ![
      "add",
      "subtract",
      "multiply",
      "divide",
      "min",
      "max",
      "dot",
      "step",
    ].includes(op)
  ) {
    refuse(index, `unknown binary operator ${JSON.stringify(op)}`);
  }
  if (op === "dot") {
    if (isVector(left) && left === right) {
      return "float";
    }
    refuse(index, `dot needs two vectors of one size; got ${left} · ${right}`);
  }
  if (op === "step") {
    if (isScalarOrVector(right) && (left === right || left === "float")) {
      return right;
    }
    refuse(
      index,
      `step needs a float or matching edge over a float/vector value; got ` +
        `step(${left}, ${right})`,
    );
  }
  if (op === "multiply") {
    if (
      (left === "mat3" && right === "mat3") ||
      (left === "mat4" && right === "mat4")
    ) {
      return left;
    }
    if (left === "mat3" && right === "vec3") {
      return "vec3";
    }
    if (left === "mat4" && right === "vec4") {
      return "vec4";
    }
  }
  if (isScalarOrVector(left) && isScalarOrVector(right)) {
    if (left === right) {
      return left;
    }
    if (left === "float") {
      return right;
    }
    if (right === "float") {
      return left;
    }
  }
  refuse(index, `${op} cannot combine ${left} with ${right}`);
}

/** Type-checks a unary node; returns the result type or refuses. */
function unaryResultType(
  index: number,
  op: ShaderUnaryOp,
  source: ShaderValueType,
): ShaderValueType {
  if (
    ![
      "sin",
      "cos",
      "abs",
      "floor",
      "fract",
      "normalize",
      "negate",
      "saturate",
      "length",
      "angle",
    ].includes(op)
  ) {
    refuse(index, `unknown unary operator ${JSON.stringify(op)}`);
  }
  if (op === "normalize") {
    if (isVector(source)) {
      return source;
    }
    refuse(index, `normalize needs a vector; got ${source}`);
  }
  if (op === "length") {
    if (isVector(source)) {
      return "float";
    }
    refuse(index, `length needs a vector; got ${source}`);
  }
  if (op === "angle") {
    if (source === "vec2") {
      return "float";
    }
    refuse(index, `angle needs a vec2; got ${source}`);
  }
  if (isScalarOrVector(source)) {
    return source;
  }
  refuse(index, `${op} needs a float or vector; got ${source}`);
}

/**
 * Validates `graph` against §60's IR rules and §85, and returns everything a
 * consumer needs to bind or emit it — see {@link ShaderGraphAnalysis}.
 *
 * Throws a `RangeError` on the first violation: out-of-range or forward
 * references, a type rule broken, an attribute the domain does not have, a
 * screen graph with a `positionOffset`, a texture reachable from
 * `positionOffset` (the MVP emits displacement in the vertex stage, where
 * implicit-derivative sampling does not exist), a non-`vec4` `color`, or the
 * two resource caps ({@link MAX_SHADER_GRAPH_NODES},
 * {@link MAX_SHADER_GRAPH_TEXTURES}).
 *
 * Pure, deterministic, allocation-light; `NodeMaterial` runs it at
 * construction (§85's setup-time stance — a backend never validates inside a
 * frame, §61), and `validateEffectRenderPass` runs it for a §70 graph effect.
 */
export function analyzeShaderGraph(graph: ShaderGraph): ShaderGraphAnalysis {
  return analyzeGraph(graph, true);
}

/** @internal Validates an authoring expression without requiring a vec4 output. */
export function analyzeShaderNodeType(
  nodes: readonly ShaderNode[],
  domain: ShaderDomain,
  nodeId: ShaderNodeId,
): ShaderValueType {
  return analyzeGraph({ nodes, domain, color: nodeId }, false).nodeTypes[
    nodeId
  ];
}

function analyzeGraph(
  graph: ShaderGraph,
  requireColor: boolean,
): ShaderGraphAnalysis {
  const nodes = graph.nodes;
  if (
    graph.uniformTransport !== undefined &&
    graph.uniformTransport !== "individual" &&
    graph.uniformTransport !== "std140"
  ) {
    refuse(null, "unknown uniform transport");
  }
  if (graph.domain !== "surface" && graph.domain !== "screen") {
    refuse(null, `unknown domain ${JSON.stringify(graph.domain)}`);
  }
  // The alias is `unknown` so `Array.isArray` cannot narrow `nodes` itself to
  // `any[]` (its guard type erases a `readonly` element type).
  const rawNodes: unknown = nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    refuse(null, "a graph needs at least one node");
  }
  if (nodes.length > MAX_SHADER_GRAPH_NODES) {
    refuse(
      null,
      `${String(nodes.length)} nodes exceed the limit of ` +
        String(MAX_SHADER_GRAPH_NODES),
    );
  }

  validateDefines(graph.defines);
  const defines = graph.defines;
  const types: ShaderValueType[] = [];
  const uniformTypes = new Map<string, ShaderValueType>();
  const storageDeclarations = new Map<
    string,
    Extract<ShaderNode, { kind: "storage" }>
  >();

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    switch (node.kind) {
      case "constant": {
        const components = SHADER_VALUE_COMPONENTS[node.type];
        if (typeof components !== "number") {
          refuse(index, `unknown type ${JSON.stringify(node.type)}`);
        }
        if (node.value.length !== components) {
          refuse(
            index,
            `a ${node.type} constant needs ${String(components)} components; ` +
              `got ${String(node.value.length)}`,
          );
        }
        for (const component of node.value) {
          if (!Number.isFinite(component)) {
            refuse(
              index,
              `constant components must be finite; got ${String(component)}`,
            );
          }
        }
        types.push(node.type);
        break;
      }
      case "uniform": {
        if (typeof SHADER_VALUE_COMPONENTS[node.type] !== "number") {
          refuse(index, `unknown type ${JSON.stringify(node.type)}`);
        }
        if (
          !IDENTIFIER_PATTERN.test(node.name) ||
          node.name.includes("__") ||
          node.name.length > 64
        ) {
          refuse(
            index,
            `uniform name ${JSON.stringify(node.name)} must be an identifier ` +
              "(letter first, no double underscore, at most 64 characters)",
          );
        }
        const declared = uniformTypes.get(node.name);
        if (declared !== undefined && declared !== node.type) {
          refuse(
            index,
            `uniform ${JSON.stringify(node.name)} is declared ${declared} ` +
              `and ${node.type}; one name has one type`,
          );
        }
        uniformTypes.set(node.name, node.type);
        types.push(node.type);
        break;
      }
      case "attribute": {
        const attributeType = SHADER_ATTRIBUTE_TYPES[node.name];
        if (typeof attributeType !== "string") {
          refuse(index, `unknown attribute ${JSON.stringify(node.name)}`);
        }
        if (graph.domain === "screen" && node.name !== "uv") {
          refuse(
            index,
            `a "screen" graph has no mesh, so attribute ` +
              `${JSON.stringify(node.name)} does not exist there (only "uv" — ` +
              "the pass's own normalized coordinate — may be read)",
          );
        }
        types.push(attributeType);
        break;
      }
      case "texture": {
        if (
          !IDENTIFIER_PATTERN.test(node.name) ||
          node.name.includes("__") ||
          node.name.length > 64
        ) {
          refuse(
            index,
            `texture name ${JSON.stringify(node.name)} must be an identifier ` +
              "(letter first, no double underscore, at most 64 characters)",
          );
        }
        requireReference(node.uv, index, "texture uv");
        if (types[node.uv] !== "vec2") {
          refuse(index, `texture uv must be vec2; got ${types[node.uv]}`);
        }
        types.push("vec4");
        break;
      }
      case "time": {
        types.push("float");
        break;
      }
      case "compose": {
        if (!isVector(node.type)) {
          refuse(
            index,
            `compose builds vectors; got ${JSON.stringify(node.type)}`,
          );
        }
        const components = SHADER_VALUE_COMPONENTS[node.type];
        let total = 0;
        for (const part of node.parts) {
          requireReference(part, index, "compose part");
          const partType = types[part];
          if (!isScalarOrVector(partType)) {
            refuse(
              index,
              `compose parts must be floats or vectors; got ${partType}`,
            );
          }
          total += SHADER_VALUE_COMPONENTS[partType];
        }
        // An empty part list needs no clause of its own: zero components can
        // never equal a vector's size.
        if (total !== components) {
          refuse(
            index,
            `a ${node.type} composes exactly ${String(components)} components; ` +
              `got ${String(total)}`,
          );
        }
        types.push(node.type);
        break;
      }
      case "swizzle": {
        requireReference(node.source, index, "swizzle source");
        const sourceType = types[node.source];
        if (!isVector(sourceType)) {
          refuse(index, `swizzle needs a vector source; got ${sourceType}`);
        }
        if (!SWIZZLE_PATTERN.test(node.pattern)) {
          refuse(
            index,
            `swizzle pattern ${JSON.stringify(node.pattern)} must be 1–4 ` +
              "components of xyzw",
          );
        }
        const size = SHADER_VALUE_COMPONENTS[sourceType];
        for (const letter of node.pattern) {
          if (SWIZZLE_INDEX[letter] >= size) {
            refuse(
              index,
              `swizzle component "${letter}" is outside a ${sourceType}`,
            );
          }
        }
        // Total over the pattern regex: 1–4 components.
        types.push(SWIZZLE_RESULT_TYPES[node.pattern.length - 1]);
        break;
      }
      case "unary": {
        requireReference(node.source, index, "unary source");
        types.push(unaryResultType(index, node.op, types[node.source]));
        break;
      }
      case "binary": {
        requireReference(node.left, index, "binary left");
        requireReference(node.right, index, "binary right");
        types.push(
          binaryResultType(index, node.op, types[node.left], types[node.right]),
        );
        break;
      }
      case "mix": {
        requireReference(node.a, index, "mix a");
        requireReference(node.b, index, "mix b");
        requireReference(node.t, index, "mix t");
        const aType = types[node.a];
        if (!isScalarOrVector(aType) || types[node.b] !== aType) {
          refuse(
            index,
            `mix blends two values of one float/vector type; got ` +
              `${types[node.a]} and ${types[node.b]}`,
          );
        }
        const tType = types[node.t];
        if (tType !== "float" && tType !== aType) {
          refuse(index, `mix t must be float or ${aType}; got ${tType}`);
        }
        types.push(aType);
        break;
      }
      case "storage": {
        if (
          !IDENTIFIER_PATTERN.test(node.name) ||
          node.name.includes("__") ||
          node.name.length > 64
        ) {
          refuse(
            index,
            `storage name ${JSON.stringify(node.name)} must be an identifier ` +
              "(letter first, no double underscore, at most 64 characters)",
          );
        }
        if (
          node.type !== "float" &&
          node.type !== "vec2" &&
          node.type !== "vec4"
        ) {
          refuse(
            index,
            `storage element type must be float, vec2 or vec4; got ${JSON.stringify(node.type)}`,
          );
        }
        if (
          !Number.isInteger(node.count) ||
          node.count < 1 ||
          node.count > MAX_SHADER_STORAGE_COUNT
        ) {
          refuse(
            index,
            `storage count must be an integer in [1, ${String(MAX_SHADER_STORAGE_COUNT)}]; got ${String(node.count)}`,
          );
        }
        if (graph.domain === "screen") {
          refuse(
            index,
            'storage buffers need the "surface" domain at this tier',
          );
        }
        requireReference(node.index, index, "storage index");
        if (types[node.index] !== "float") {
          refuse(
            index,
            `storage index must be float; got ${types[node.index]}`,
          );
        }
        const declared = storageDeclarations.get(node.name);
        if (
          declared !== undefined &&
          (declared.type !== node.type || declared.count !== node.count)
        ) {
          refuse(
            index,
            `storage ${JSON.stringify(node.name)} is declared twice with ` +
              "different element types or counts; one name has one shape",
          );
        }
        storageDeclarations.set(node.name, node);
        types.push(node.type);
        break;
      }
      case "select": {
        if (!IDENTIFIER_PATTERN.test(node.define) || node.define.length > 64) {
          refuse(
            index,
            `define name ${JSON.stringify(node.define)} must be an identifier`,
          );
        }
        requireReference(node.then, index, "select then");
        requireReference(node.otherwise, index, "select otherwise");
        if (types[node.then] !== types[node.otherwise]) {
          refuse(
            index,
            `select branches must share a type; got ${types[node.then]} and ` +
              types[node.otherwise],
          );
        }
        types.push(types[node.then]);
        break;
      }
      case "light": {
        if (graph.domain === "screen") {
          refuse(index, 'the "lights" family needs the "surface" domain');
        }
        const scalar = Object.hasOwn(SHADER_LIGHT_SCALAR_TYPES, node.member);
        const array = Object.hasOwn(SHADER_LIGHT_ARRAY_TYPES, node.member);
        if (!scalar && !array) {
          refuse(index, `unknown light member ${JSON.stringify(node.member)}`);
        }
        if (scalar) {
          if (node.index !== undefined) {
            refuse(index, `light member ${node.member} takes no index`);
          }
          types.push(
            SHADER_LIGHT_SCALAR_TYPES[node.member as ShaderLightScalarMember],
          );
        } else {
          if (node.index === undefined) {
            refuse(index, `light member ${node.member} needs an index`);
          }
          requireReference(node.index, index, "light index");
          if (types[node.index] !== "float") {
            refuse(
              index,
              `light index must be float; got ${types[node.index]}`,
            );
          }
          types.push(
            SHADER_LIGHT_ARRAY_TYPES[node.member as ShaderLightArrayMember],
          );
        }
        break;
      }
      default:
        refuse(
          index,
          `unknown node kind ${JSON.stringify((node as { kind: unknown }).kind)}`,
        );
    }
  }

  // The outputs.
  const color = graph.color;
  if (!Number.isInteger(color) || color < 0 || color >= nodes.length) {
    refuse(null, `color must name a node; got ${String(color)}`);
  }
  if (requireColor && types[color] !== "vec4") {
    refuse(null, `color must be vec4; got ${types[color]}`);
  }
  const offset = graph.positionOffset;
  if (offset !== undefined) {
    if (graph.domain === "screen") {
      refuse(
        null,
        'a "screen" graph has no vertices to move; omit positionOffset',
      );
    }
    if (!Number.isInteger(offset) || offset < 0 || offset >= nodes.length) {
      refuse(null, `positionOffset must name a node; got ${String(offset)}`);
    }
    if (types[offset] !== "vec3") {
      refuse(null, `positionOffset must be vec3; got ${types[offset]}`);
    }
  }

  // Reachability, one back-to-front pass per output: every reference points at
  // an earlier node, so marking from high indices to low is complete in one
  // sweep (§33: array order, never collection enumeration).
  const colorReachable = markReachable(nodes, color, defines);
  const offsetReachable =
    offset === undefined
      ? nodes.map(() => false)
      : markReachable(nodes, offset, defines);

  // The MVP emits `positionOffset` in the vertex stage, where a texture
  // sample has no implicit derivatives — rejected here, at setup, rather than
  // left to a driver's discretion inside a frame.
  for (let index = 0; index < nodes.length; index += 1) {
    if (offsetReachable[index] && nodes[index].kind === "texture") {
      refuse(
        index,
        "texture nodes cannot feed positionOffset at this tier (the " +
          "displacement runs in the vertex stage)",
      );
    }
    if (
      offsetReachable[index] &&
      (nodes[index].kind === "storage" || nodes[index].kind === "light")
    ) {
      refuse(
        index,
        `${nodes[index].kind} nodes are fragment-stage only and cannot feed ` +
          "positionOffset",
      );
    }
  }

  // Reflection, over reachable nodes only, in first-appearance order (§33).
  const uniforms: ShaderUniformReflection[] = [];
  const textures: ShaderTextureReflection[] = [];
  const attributes: ShaderAttributeName[] = [];
  const seenUniforms = new Set<string>();
  const seenTextures = new Set<string>();
  const seenAttributes = new Set<ShaderAttributeName>();
  const storage: ShaderStorageReflection[] = [];
  const lights: ShaderLightMember[] = [];
  const seenStorage = new Set<string>();
  const seenLights = new Set<ShaderLightMember>();
  for (let index = 0; index < nodes.length; index += 1) {
    if (!colorReachable[index] && !offsetReachable[index]) {
      continue;
    }
    const node = nodes[index];
    if (node.kind === "uniform" && !seenUniforms.has(node.name)) {
      seenUniforms.add(node.name);
      uniforms.push({ name: node.name, type: node.type });
    } else if (node.kind === "texture" && !seenTextures.has(node.name)) {
      seenTextures.add(node.name);
      textures.push({ name: node.name });
    } else if (node.kind === "attribute" && !seenAttributes.has(node.name)) {
      seenAttributes.add(node.name);
      attributes.push(node.name);
    } else if (node.kind === "storage" && !seenStorage.has(node.name)) {
      seenStorage.add(node.name);
      storage.push({ name: node.name, type: node.type, count: node.count });
    } else if (node.kind === "light" && !seenLights.has(node.member)) {
      seenLights.add(node.member);
      lights.push(node.member);
    }
  }
  if (storage.length > MAX_SHADER_GRAPH_STORAGE) {
    refuse(
      null,
      `${String(storage.length)} storage buffers exceed the limit of ` +
        String(MAX_SHADER_GRAPH_STORAGE),
    );
  }
  if (textures.length > MAX_SHADER_GRAPH_TEXTURES) {
    refuse(
      null,
      `${String(textures.length)} textures exceed the limit of ` +
        String(MAX_SHADER_GRAPH_TEXTURES),
    );
  }

  return {
    reflection: { uniforms, textures, attributes, storage, lights },
    nodeTypes: types,
    colorReachable,
    offsetReachable,
  };
}

/** The branch a `"select"` node resolves to under `defines` (absent = false). */
export function resolveShaderSelect(
  node: Extract<ShaderNode, { kind: "select" }>,
  defines: Readonly<Record<string, boolean>> | undefined,
): ShaderNodeId {
  return defines !== undefined &&
    Object.hasOwn(defines, node.define) &&
    defines[node.define]
    ? node.then
    : node.otherwise;
}

/** Marks every live node reachable from `root` (references point backwards). */
function markReachable(
  nodes: readonly ShaderNode[],
  root: ShaderNodeId,
  defines: Readonly<Record<string, boolean>> | undefined,
): boolean[] {
  const reachable = nodes.map(() => false);
  reachable[root] = true;
  for (let index = root; index >= 0; index -= 1) {
    if (!reachable[index]) {
      continue;
    }
    const node = nodes[index];
    if (node.kind === "select") {
      reachable[resolveShaderSelect(node, defines)] = true;
      continue;
    }
    forEachShaderNodeReference(node, (id) => {
      reachable[id] = true;
    });
  }
  return reachable;
}

function validateDefines(
  defines: Readonly<Record<string, boolean>> | undefined,
): void {
  if (defines === undefined) {
    return;
  }
  const raw: unknown = defines;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    refuse(null, "defines must be an object of named booleans");
  }
  const names = Object.keys(defines);
  if (names.length > MAX_SHADER_GRAPH_DEFINES) {
    refuse(
      null,
      `${String(names.length)} defines exceed the limit of ` +
        String(MAX_SHADER_GRAPH_DEFINES),
    );
  }
  for (const name of names) {
    if (!IDENTIFIER_PATTERN.test(name) || name.length > 64) {
      refuse(null, `define name ${JSON.stringify(name)} must be an identifier`);
    }
    if (typeof defines[name] !== "boolean") {
      refuse(null, `define ${JSON.stringify(name)} must be a boolean`);
    }
  }
}

/**
 * The canonical, sorted define-set key (`"A=1,B=0"`) that joins the structural
 * cache key: the same set always yields the same string, whatever the
 * insertion order. Absent defines yield `""`.
 */
export function shaderDefineKey(
  defines: Readonly<Record<string, boolean>> | undefined,
): string {
  if (defines === undefined) {
    return "";
  }
  return Object.keys(defines)
    .sort()
    .map((name) => `${name}=${defines[name] ? "1" : "0"}`)
    .join(",");
}

const specializations = new WeakMap<ShaderGraph, Map<string, ShaderGraph>>();

/**
 * Resolves a graph's compile-time defines: returns a frozen graph with
 * `overrides` merged over the graph's own defines (names must be read by a
 * `"select"` node — a typo is refused). Memoised per source graph on the
 * sorted define key, so equal define sets return the identical object and a
 * backend's identity fast path hits; sets whose emitted source is equal then
 * share one program through the backend's source cache.
 */
export function specializeShaderGraph(
  graph: ShaderGraph,
  overrides: Readonly<Record<string, boolean>>,
): ShaderGraph {
  analyzeShaderGraph(graph);
  freezeShaderGraph(graph);
  const used = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "select") {
      used.add(node.define);
    }
  }
  const merged: Record<string, boolean> = { ...graph.defines };
  for (const name of Object.keys(overrides).sort()) {
    if (!used.has(name)) {
      refuse(null, `define ${JSON.stringify(name)} is read by no select node`);
    }
    merged[name] = overrides[name];
  }
  validateDefines(merged);
  const sorted: Record<string, boolean> = {};
  for (const name of Object.keys(merged).sort()) {
    sorted[name] = merged[name];
  }
  const key = shaderDefineKey(sorted);
  let cache = specializations.get(graph);
  if (cache === undefined) {
    cache = new Map();
    specializations.set(graph, cache);
  }
  let result = cache.get(key);
  if (result === undefined) {
    result = freezeShaderGraph({ ...graph, defines: Object.freeze(sorted) });
    cache.set(key, result);
  }
  return result;
}

/**
 * Freezes `graph` in place — the object, its node array, every node, and
 * every node's component array — and returns it. RFC 0001: *the graph is
 * immutable*; a `NodeMaterial` freezes what it is handed, so the program a
 * backend caches on the graph can never drift from the graph that keyed it,
 * and `Material.version` keeps meaning what it means (render state is read
 * per draw, never cached — a mutable graph would make the *program* cacheable
 * on a counter that deliberately does not move).
 */
export function freezeShaderGraph(graph: ShaderGraph): ShaderGraph {
  for (const node of graph.nodes) {
    if (node.kind === "constant") {
      Object.freeze(node.value);
    } else if (node.kind === "compose") {
      Object.freeze(node.parts);
    }
    Object.freeze(node);
  }
  Object.freeze(graph.nodes);
  if (graph.defines !== undefined) {
    Object.freeze(graph.defines);
  }
  return Object.freeze(graph);
}
