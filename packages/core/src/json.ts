/**
 * JSON value typing and validation shared by every document format (§34, §79).
 *
 * Both persistence surfaces in the engine — `@fourjs/diagnostics`' §34 replay
 * envelope and `@fourjs/serialization`'s §79 scene document — are JSON on the
 * wire, and both need the same two things: a type that says "representable
 * JSON, nothing else" ({@link JsonValue}) and a validating deep-copy that
 * enforces it ({@link cloneJsonValue}). Each package originally carried its own
 * copy because the §3.1 dependency matrix puts them side by side with no edge
 * between them; both copies carried a dated note naming the hoist into
 * `@fourjs/core` as the fix. This module is that hoist (2026-08-04): one
 * definition, below every consumer, re-exported unchanged by both packages.
 *
 * The consolidated {@link cloneJsonValue} is `@fourjs/serialization`'s variant —
 * the diagnostics original **plus** the `__proto__` refusal — because the
 * strengthening is correct everywhere: `JSON.parse` makes `__proto__` an
 * ordinary own property, and copying it with `copy[key] = …` would run the
 * inherited setter and re-parent the fresh object instead of storing a key —
 * silently losing the value and handing the caller an object with a surprising
 * prototype. Nothing legitimate needs that key, so it is refused, and every
 * consumer downstream can assign keys without a guard.
 */

/**
 * A value `JSON.stringify` can represent losslessly.
 *
 * Document payloads are typed with this rather than `unknown`: replay
 * recordings and scene files are JSON, so a value that cannot survive
 * `JSON.stringify` unchanged (a `Date`, a `Map`, `undefined`, a function,
 * `NaN`) is not representable, and it is better to say so in the type than to
 * discover it as a silent `null` after a reload.
 */
import { FourError } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Validates a value as JSON and returns a deep-frozen copy of it.
 *
 * Values are copied rather than referenced because a caller usually hands over
 * a live object; a document that kept the reference would not be a snapshot.
 * `-0` is normalized to `0`. A `__proto__` own key is refused — see the module
 * note for why copying one would re-parent the copy instead of storing a key.
 *
 * @param value the value to validate and copy
 * @param path a dotted path used in error messages, e.g. `"metadata"`
 * @returns a frozen deep copy
 * @throws TypeError if the value is not representable JSON
 */
export function cloneJsonValue(value: unknown, path = "value"): JsonValue {
  return cloneJson(value, path, new Set<object>(), 1);
}

/**
 * Nesting ceiling for {@link cloneJsonValue} — the same figure
 * `parseUntrustedJson` enforces (`DEFAULT_MAXIMUM_DEPTH`, §96), restated here
 * because `json.ts` sits below `untrusted.ts`. A value that reaches this deep
 * is not a scene; the recursion below would otherwise be the stack-exhaustion
 * a document parsed by plain `JSON.parse` can force (the migration entry
 * point documents that pairing).
 */
const MAXIMUM_CLONE_DEPTH = 1024;

function cloneJson(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
): JsonValue {
  if (value === null) {
    return null;
  }
  if (depth > MAXIMUM_CLONE_DEPTH) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      `${path} is nested deeper than ${String(MAXIMUM_CLONE_DEPTH)} levels (§96).`,
      { context: { limitName: "maximumDepth", limit: MAXIMUM_CLONE_DEPTH, path } },
    );
  }
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `${path} is ${String(value)}, which JSON cannot represent (it would round-trip as null).`,
        );
      }
      return value === 0 ? 0 : value;
    case "object":
      break;
    default:
      throw new TypeError(
        `${path} is a ${typeof value}, which JSON cannot represent.`,
      );
  }
  // Narrowed to a non-null object by the switch above.
  const object = value;
  if (ancestors.has(object)) {
    throw new TypeError(`${path} is a circular reference.`);
  }
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const source = object as readonly unknown[];
      const copy: JsonValue[] = [];
      for (let i = 0; i < source.length; i += 1) {
        copy.push(
          cloneJson(source[i], `${path}[${String(i)}]`, ancestors, depth + 1),
        );
      }
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `${path} is ${Object.prototype.toString.call(object)}, not a plain object; JSON cannot represent it losslessly.`,
      );
    }
    const source = object as Record<string, unknown>;
    const copy: Record<string, JsonValue> = {};
    // Own enumerable string keys in insertion order (plan §1) — the same set
    // and order `JSON.stringify` would emit.
    for (const key of Object.keys(source)) {
      if (key === "__proto__") {
        throw new TypeError(
          `${path} has a "__proto__" key, which no fourJS document may carry (it would re-parent the object it was copied into).`,
        );
      }
      const entry = source[key];
      if (entry === undefined) {
        throw new TypeError(
          `${path}.${key} is undefined; JSON would drop the key.`,
        );
      }
      copy[key] = cloneJson(entry, `${path}.${key}`, ancestors, depth + 1);
    }
    return Object.freeze(copy);
  } finally {
    ancestors.delete(object);
  }
}
