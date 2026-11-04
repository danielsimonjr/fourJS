/**
 * The §79 serializer for {@link SoftBody} (PH-17 policy: every shipped component
 * class registers one).
 *
 * A document carries the **descriptor and tuning only** — rope, cloth, or
 * pressure (whose `positions` / `indices` typed arrays are written as plain
 * number arrays). Simulation state (particle positions, velocities, the solve)
 * is deliberately NOT serialized: that is the {@link SoftBodySnapshot}'s job
 * (§34), and §79 keeps simulation state out of scene documents. A reloaded body
 * starts at rest.
 *
 * The reader refuses malformed input with `UNTRUSTED_INPUT_REJECTED`; range and
 * topology checks are the {@link SoftBody} constructor's, re-surfaced under that
 * code. Nothing here imports `@fourjs/serialization`; the structural
 * {@link ComponentSerializerShape} from `@fourjs/motion` is used instead.
 */
import { FourError, type JsonValue } from "@fourjs/core";
import type { ComponentSerializerShape } from "@fourjs/motion";

import { SoftBody, type SoftBodyDescriptor } from "./soft-body.js";

/** Upper bound on pressure-mesh array length accepted from a document. */
export const MAXIMUM_SOFT_BODY_ARRAY_LENGTH = 1_048_576;

type Json = { readonly [key: string]: JsonValue };

function reject(message: string): never {
  throw new FourError("UNTRUSTED_INPUT_REJECTED", `SoftBody: ${message}`);
}

const TUNING = [
  "substeps",
  "iterations",
  "stiffness",
  "bendingStiffness",
  "damping",
  "mass",
] as const;
const ROPE = ["segments", "length"] as const;
const CLOTH = ["columns", "rows", "width", "height"] as const;
const PRESSURE = ["pressure", "pressureStiffness"] as const;

function numberArray(name: string, v: JsonValue | undefined): number[] {
  if (!Array.isArray(v)) return reject(`${name} must be an array of numbers`);
  if (v.length > MAXIMUM_SOFT_BODY_ARRAY_LENGTH) {
    return reject(`${name} length ${v.length} is over the limit`);
  }
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) {
      return reject(`${name} must hold only finite numbers`);
    }
  }
  return v as number[];
}

/** Copies the listed numeric keys that are present; a non-number is rejected. */
function copyNumbers(
  source: Json,
  keys: readonly string[],
  out: Record<string, unknown>,
  required: boolean,
): void {
  for (const key of keys) {
    const v = source[key];
    if (v === undefined) {
      if (required) reject(`missing "${key}"`);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      reject(`"${key}" must be a finite number`);
    }
    out[key] = v;
  }
}

function descriptorJson(d: SoftBodyDescriptor): JsonValue {
  const out: Record<string, JsonValue> = { kind: d.kind };
  const src = d as unknown as Record<string, number | undefined>;
  const keys: readonly string[] =
    d.kind === "rope"
      ? [...ROPE, ...TUNING]
      : d.kind === "cloth"
        ? [...CLOTH, ...TUNING]
        : [...PRESSURE, ...TUNING];
  for (const key of keys) {
    const v = src[key];
    if (v !== undefined) out[key] = v;
  }
  if (d.kind === "pressure") {
    out.positions = Array.from(d.positions);
    out.indices = Array.from(d.indices);
  } else if (d.pinned !== undefined) {
    out.pinned = [...d.pinned];
  }
  return out;
}

function readDescriptor(data: JsonValue): SoftBodyDescriptor {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return reject("payload must be an object");
  }
  const record = data as Json;
  const kind = record.kind;
  const out: Record<string, unknown> = {};
  copyNumbers(record, TUNING, out, false);
  if (kind === "rope" || kind === "cloth") {
    out.kind = kind;
    copyNumbers(record, kind === "rope" ? ROPE : CLOTH, out, true);
    if (record.pinned !== undefined) {
      out.pinned = numberArray("pinned", record.pinned);
    }
  } else if (kind === "pressure") {
    out.kind = kind;
    copyNumbers(record, PRESSURE, out, false);
    out.positions = Float32Array.from(
      numberArray("positions", record.positions),
    );
    out.indices = Uint32Array.from(numberArray("indices", record.indices));
  } else {
    return reject(`unknown kind ${JSON.stringify(kind)}`);
  }
  return out as unknown as SoftBodyDescriptor;
}

/** §79 serializer for {@link SoftBody}: descriptor and tuning, never simulation state. */
export const SOFT_BODY_SERIALIZER: ComponentSerializerShape<SoftBody> = {
  serialize(component: SoftBody): JsonValue {
    return descriptorJson(component.descriptor);
  },
  deserialize(data: JsonValue): SoftBody {
    const descriptor = readDescriptor(data);
    try {
      return new SoftBody(descriptor);
    } catch (e) {
      if (e instanceof FourError) return reject(e.message);
      throw e;
    }
  },
};
