import {
  analyzeShaderGraph,
  freezeShaderGraph,
  forEachShaderNodeReference,
  type ShaderGraph,
  type ShaderNodeId,
  type ShaderValueType,
} from "./shader-graph.js";
import type {
  ShaderExpression,
  ShaderGraphBuilder,
  ShaderOperand,
} from "./node-material-builder.js";

/** Serializable named subgraph: parameters refer to named uniform nodes. */
export interface ShaderFunctionDefinition {
  readonly name: string;
  readonly graph: ShaderGraph;
  readonly parameters: readonly string[];
  /** Defaults to graph.color; may select a scalar/vector/matrix intermediate. */
  readonly result?: ShaderNodeId;
}

/**
 * A reusable, data-declared operator lowered to the existing closed IR. No
 * source strings, dynamic code evaluation, or backend-specific operators.
 * Parameters substitute uniform nodes; all uniforms must be parameters so
 * separate calls cannot accidentally share mutable values. Samplers remain
 * explicit named resources and preserve render-graph feedback validation.
 */
export class ShaderFunction {
  readonly definition: ShaderFunctionDefinition;
  readonly resultType: ShaderValueType;
  readonly #parameterTypes: readonly ShaderValueType[];
  readonly #reachable: readonly boolean[];
  readonly #calls = new WeakMap<
    ShaderGraphBuilder,
    Map<string, ShaderExpression>
  >();

  constructor(definition: ShaderFunctionDefinition) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(definition.name) ||
      definition.name.includes("__")
    ) {
      throw new RangeError("ShaderFunction: invalid name (§60, §96).");
    }
    const graph = structuredClone(definition.graph);
    const analysis = analyzeShaderGraph(graph);
    const result = definition.result ?? graph.color;
    if (
      !Number.isInteger(result) ||
      result < 0 ||
      result >= graph.nodes.length
    ) {
      throw new RangeError(
        "ShaderFunction: result must reference a graph node.",
      );
    }
    const reachable = graph.nodes.map(() => false);
    reachable[result] = true;
    for (let index = result; index >= 0; index -= 1) {
      if (reachable[index])
        forEachShaderNodeReference(graph.nodes[index], (id) => {
          reachable[id] = true;
        });
    }
    this.#reachable = reachable;
    const uniforms = new Map<string, ShaderValueType>();
    for (const node of graph.nodes) {
      if (node.kind === "uniform") uniforms.set(node.name, node.type);
    }
    const parameters = [...definition.parameters];
    if (
      new Set(parameters).size !== parameters.length ||
      parameters.length !== uniforms.size ||
      parameters.some((name) => !uniforms.has(name))
    ) {
      throw new RangeError(
        "ShaderFunction: parameters must name every uniform exactly once.",
      );
    }
    this.#parameterTypes = parameters.map((name) => uniforms.get(name)!);
    this.resultType = analysis.nodeTypes[result];
    this.definition = Object.freeze({
      name: definition.name,
      graph: freezeShaderGraph(graph),
      parameters: Object.freeze(parameters),
      result,
    });
  }

  /**
   * Inline one call in the receiving builder's scope. Repeating a call with
   * the same argument node IDs returns the same expression (call-site cache).
   * Node IDs are remapped at every new call, including intermediate results.
   */
  call(
    builder: ShaderGraphBuilder,
    ...operands: readonly ShaderOperand[]
  ): ShaderExpression {
    const { graph, parameters, result } = this.definition;
    if (graph.domain !== builder.domain) {
      throw new RangeError(
        "ShaderFunction: function and caller domains must match.",
      );
    }
    if (operands.length !== parameters.length) {
      throw new RangeError(
        "ShaderFunction: argument count must match parameters.",
      );
    }
    const args = operands.map((operand) => builder.expression(operand));
    for (let index = 0; index < args.length; index += 1) {
      if (builder.typeOf(args[index]) !== this.#parameterTypes[index]) {
        throw new RangeError(
          `ShaderFunction ${this.definition.name}: argument ${String(index)} must be ${this.#parameterTypes[index]}.`,
        );
      }
    }
    const key = args.map((arg) => arg.nodeId).join(",");
    let calls = this.#calls.get(builder);
    if (calls === undefined) {
      calls = new Map();
      this.#calls.set(builder, calls);
    }
    const cached = calls.get(key);
    if (cached !== undefined) return cached;
    const bindings = new Map(
      parameters.map((name, index) => [name, args[index]]),
    );
    const values: ShaderExpression[] = [];
    for (let index = 0; index < graph.nodes.length; index += 1) {
      if (!this.#reachable[index]) continue;
      const node = graph.nodes[index];
      switch (node.kind) {
        case "constant":
          values[index] = builder.constant(
            node.type === "float" ? node.value[0] : node.value,
          );
          break;
        case "uniform":
          values[index] = bindings.get(node.name)!;
          break;
        case "attribute":
          values[index] = builder.attribute(node.name);
          break;
        case "texture":
          values[index] = builder.sampler(node.name, values[node.uv]);
          break;
        case "time":
          values[index] = builder.time();
          break;
        case "compose": {
          const parts = node.parts.map((id) => values[id]);
          values[index] =
            node.type === "vec2"
              ? builder.vec2(...parts)
              : node.type === "vec3"
                ? builder.vec3(...parts)
                : builder.vec4(...parts);
          break;
        }
        case "swizzle":
          values[index] = builder.swizzle(values[node.source], node.pattern);
          break;
        case "unary":
          values[index] = builder.unary(node.op, values[node.source]);
          break;
        case "binary":
          values[index] = builder.binary(
            node.op,
            values[node.left],
            values[node.right],
          );
          break;
        case "mix":
          values[index] = builder.mix(
            values[node.a],
            values[node.b],
            values[node.t],
          );
          break;
        case "storage":
          values[index] = builder.storage(
            node.name,
            node.type,
            node.count,
            values[node.index],
          );
          break;
        case "select":
          // Defines are caller-owned: the function's own `defines` are not
          // copied, so the receiving builder's set decides the branch.
          values[index] = builder.select(
            node.define,
            values[node.then],
            values[node.otherwise],
          );
          break;
        case "light":
          values[index] = builder.light(
            node.member,
            node.index === undefined ? undefined : values[node.index],
          );
          break;
      }
    }
    const expression = values[result!];
    calls.set(key, expression);
    return expression;
  }
}
