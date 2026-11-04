# RFC 0001 implementation addendum: safe shader composition

Date: 2026-09-11. Implements additional slices of the owner's request to finish
the RFCs. This records implementation choices; the storage-buffer, scene-light and
conditional-specialization contracts shipped later and are recorded in
"Acceptance (2026-11-04)" below.

## Decision and compatibility

Reusable operators are `ShaderFunction` data declarations containing an existing
validated `ShaderGraph`, a name, an ordered list of uniform parameters, and an
optional result node (default: colour output). The graph's ordinary colour output
still validates independently; a function can return any typed intermediate.
Calls inline the graph with remapped node IDs. Each call therefore has an isolated
emission scope without introducing a second shader language, recursion or raw
source. Repeated calls of the same function object with the same receiving builder
and argument node IDs reuse the result. Names and arguments are validated; the
constructor copies and freezes declarations, so later JSON mutation cannot change
existing operators. All uniforms must be explicit parameters; samplers keep their
explicit names so resource feedback remains checkable. Inlined graphs remain
subject to the existing 1,024-node limit.

`ShaderOperatorRegistry.registerDefinition()` adds this data-only route to the
existing `SHADER_OPERATORS` capability. `getDefinition()` returns the compiled
safe declaration. Native factory registration remains compatible, and either
registration route refuses an occupied name. No scene file can inject GLSL/WGSL.
Runtime validation now also rejects non-enumerated unary/binary operator strings:
TypeScript unions alone were insufficient protection for JSON input. Inherited
object properties are rejected as value types and attributes.

`ShaderVariantSet` provides bounded, immutable, named graph alternatives with
sorted keys and explicit selection. Each variant has its own complete graph and
reflection; inactive alternatives do not reserve resources. Existing backend
structural-source caches share equivalent variants and separate distinct ones.
This finite family is not an IR-level Boolean define/specialization system;
that arrived 2026-11-04 (see "Acceptance").

GLSL and WGSL emission results now expose frozen per-node source maps. Locations
are one-based generated lines/columns and identify the original graph node and
shader stage. Maps are extracted from deterministic local declarations, preserving
all pre-existing shader bytes and structural cache keys. WebGL compile errors
include the map alongside the existing driver error context. WGSL requests standard `getCompilationInfo()` when available and retains
source-map-enriched `FourError` records in
`WgpuNodePipelineStore.compilationErrors`, with development warnings. Late
reports after disposal are ignored and rejected diagnostic requests are contained.

## Opt-in std140 transport and measured tradeoff

`ShaderGraphBuilder.useUniformBlock()` sets `uniformTransport: "std140"` in the
serializable graph. WebGL emits a shared `FourNodeUniforms` block in both stages,
with identical field order. Scalars/vectors occupy one padded vec4 lane;
matrices occupy four lanes (mat3 is read from a padded mat4). This matches the
existing WebGPU packing philosophy and avoids cross-driver vec3 packing ambiguity.
Logical reflected types and `setUniform()` values do not change. WebGPU already
uses a uniform block and retains its established layout and emitted bytes.

A WebGL surface material packs and uploads the block once per draw. Screen-effect
`setUniform()` calls upload after each changed field, preserving that existing
immediate API. Each program owns its buffer, binds it explicitly when used, and
releases it on disposal or failed initialization. Missing WebGL 2 block APIs,
missing linked blocks, and allocation failures are explicit compilation errors.
The ordinary individual-uniform path stays the default and is byte-identical.

Reproduce with `node benchmarks/shader-uniform-block.mjs` after building packages.
The instrumented WebGL call measurement (16 scalar uniforms, 1,000 material draws,
excluding initial buffer allocation and opacity setup) reports:

| Transport     | Upload calls | Payload bytes |
| ------------- | -----------: | ------------: |
| Individual    |       16,000 |        64,000 |
| Padded std140 |        1,000 |       256,000 |

This measures a 16-fold call reduction at a 4-fold scalar payload increase, not a
GPU speedup. No hardware-dependent performance claim follows from a mock driver.
The opt-in choice keeps small materials and current application bundles stable.
Per-renderable uniform overrides are a separate API and are not implied here.

## Validation and remaining work

Tests cover parameter typing and scope, deterministic call caching, every closed
IR node form, safe registry collisions, immutable variants, both source maps,
all six uniform packing types, upload counts, cleanup and allocation/driver
failures, empty blocks, and unsupported contexts. Existing shader generation
stays unchanged without opt-in transport.

Storage-buffer bindings for graph shaders, automatic scene-light uniforms, and
IR-level conditional specialization are not implemented by this addendum.

## Acceptance (2026-11-04)

Decision D4: this addendum is accepted for the three items it had left open.
Each ships with the contract below; no raw GLSL/WGSL enters at any point, so the
RFC's trust boundary is unchanged, and `ShaderVariantSet` is untouched.

1. **Storage-buffer node (§82).** `ShaderNode` gains `{ kind: "storage", name,
type: "float" | "vec2" | "vec4", count, index }`: element `index` (a float
   node, truncated and clamped to `[0, count - 1]`) of a read-only buffer.
   Validation matches the other resource nodes: identifier name (no `__`, at
   most 64 chars), element type, integer `count` in `[1, 65536]`, earlier float
   index, one name one shape, at most `MAX_SHADER_GRAPH_STORAGE = 4` buffers,
   `"surface"` domain and fragment stage only (a storage node reachable from
   `positionOffset` is refused). `ShaderReflection.storage` lists
   `{ name, type, count }` for live nodes. `NodeMaterial.setStorage()` binds a
   `ShaderStorageBuffer` of equal type and at least `count` elements. WGSL emits
   `var<storage, read> st_<name> : array<T>` in the group after the textures
   (binding = reflection order); the store allocates `STORAGE | COPY_DST`
   buffers, re-uploads on `version` change and releases disposed ones. WebGL 2
   has no storage buffers and no texture-backed seam exists, so the GLSL emitter
   refuses the graph (capability absent: latched, one warning, no draw). The
   node-kind union is closed-widened; `ShaderGraph` stays plain JSON, and the
   unit tests round-trip it through `JSON`. (No `NodeMaterial` serializer exists
   in `scene-serializers.ts`, so no §79 document change was needed.)
2. **IR-level conditional variants.** `ShaderNode` gains `{ kind: "select",
define, then, otherwise }` and `ShaderGraph` gains `defines?: Record<string,
boolean>` (at most 32; an absent define is `false`). Reachability follows the
   live branch only, so the dead branch is not emitted and reserves no uniform,
   sampler or buffer; both branches are still type-checked. The structural cache
   key includes the sorted define set (`shaderDefineKey`);
   `specializeShaderGraph(graph, overrides)` memoises one frozen graph per key
   (overrides must name a define some `select` reads). Backends keep keying
   programs on emitted source, so two define sets producing identical source
   share one compiled program (tested in both backends).
3. **Automatic lighting-aware inputs.** `ShaderNode` gains `{ kind: "light",
member, index? }` with members `ambient`, `directionalDirection`,
   `directionalColor`, `cameraPosition`, `punctualCount` (scalars) and
   `punctualPosition`, `punctualColor`, `punctualDirection`, `punctualParams`
   (array members, float index clamped to `SHADER_LIGHT_SLOTS - 1 = 10`, equal
   to `MAX_LIGHT_SLOTS`). Values are those of `SceneLights`. Use in the vertex
   stage or the `"screen"` domain is refused. WebGPU appends the renderer's own
   `LightUniforms` member layout (`LIGHT_UNIFORM_BYTES`, packed by
   `writeLightUniforms`) to the node block rather than adding a bind group;
   WebGL declares `l_*` uniforms and uploads them once per view. Lights are
   collected only when a rendered node material reads a member; the eye is the
   view camera's world translation. Packing reuses scratch buffers (no per-frame
   allocation).
