/**
 * Repo-wide declarations for runtime globals that are NOT DOM APIs but which
 * TypeScript only ships inside `lib.dom.d.ts` / `lib.webworker.d.ts`.
 *
 * WHY THIS EXISTS, and why it is not `"lib": ["ES2022", "DOM"]`.
 *
 * `tsconfig.base.json` pins `lib` to `["ES2022"]` because this engine is
 * deliberately DOM-free at the library layer (RFC 0004 specifies a DOM-free
 * frame-arrival signal for video textures). That decision is load-bearing: it
 * keeps genuinely browser-only APIs from typechecking by accident in packages
 * that must also run under Node.
 *
 * `WebAssembly` and `BufferSource`, however, are present in every JS host -
 * browser, worker and Node alike. TypeScript's placement of them inside the DOM
 * lib is an accident of packaging, not a statement about where they exist. So
 * four packages (`assets`, `text`, `physics`, `physics-rapier`) referenced them
 * and failed to compile: `TS2503: Cannot find namespace 'WebAssembly'`,
 * `TS2304: Cannot find name 'BufferSource'`. That broke `bun run build`, every
 * typecheck resolving workspace packages through built declarations, and all
 * three CI workflows.
 *
 * Declaring them here - once, loaded through `typeRoots` + `types` in
 * `tsconfig.base.json` - fixes the cause for every package at the same time,
 * rather than scattering a copy of this file into each `src/` and waiting for
 * the copies to drift.
 *
 * Keep it MINIMAL. Every member here is an unverified claim about the runtime,
 * and nothing in this repo tests these declarations against a real host.
 */

/** Binary input accepted by the WebAssembly entry points. DOM's own alias. */
type BufferSource = ArrayBufferView | ArrayBuffer;

declare namespace WebAssembly {
  /** One entry of `Module.imports()`; used to reject unexpected imports. */
  interface ModuleImportDescriptor {
    readonly module: string;
    readonly name: string;
    readonly kind: string;
  }

  class Module {
    constructor(bytes: BufferSource);
    /** Static reflection over a compiled module's declared imports. */
    static imports(module: Module): ModuleImportDescriptor[];
  }

  class Memory {
    constructor(descriptor: { initial: number; maximum?: number });
    /** The guest heap. */
    readonly buffer: ArrayBuffer;
    /** Grows the heap by `delta` pages; bounded by the declared maximum. */
    grow(delta: number): number;
  }

  /**
   * A class, not an interface: `harfbuzz-shaping-engine.ts` names
   * `WebAssembly.Instance` in a VALUE position, so a type-only declaration
   * yields "Property 'Instance' does not exist on type 'typeof WebAssembly'".
   */
  class Instance {
    constructor(module: Module, imports?: Imports);
    readonly exports: Record<string, unknown>;
  }

  interface WebAssemblyInstantiatedSource {
    readonly module: Module;
    readonly instance: Instance;
  }

  type Imports = Record<string, Record<string, unknown>>;

  function compile(bytes: BufferSource): Promise<Module>;
  function instantiate(module: Module, imports?: Imports): Promise<Instance>;
  function instantiate(
    bytes: BufferSource,
    imports?: Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  /** Structural validation of a module binary. */
  function validate(bytes: BufferSource): boolean;
}
