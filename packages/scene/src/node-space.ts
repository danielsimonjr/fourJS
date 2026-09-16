/**
 * §8's node-level space declaration — {@link NodeSpace} (PH-12 remainder).
 *
 * §8 sits beside §7's transform and reads as a property of a *node*, not of a
 * body: a screen-space panel is in screen space whether or not anyone ever
 * gives it a `RigidBody`. The §6a spelling is this one-field component.
 *
 * A component class carries a `static typeName`, which is §79's serialization
 * key, and a component with no registered serializer makes `serializeScene`
 * throw. This module ships the class **and** {@link NODE_SPACE_SERIALIZER}
 * together (the one-packet rule). The umbrella's `registerSceneNodeTypes`
 * registers the pair so a scene that carries one can be saved.
 *
 * This component is the **declaration**. Physics already honours `"world"` and
 * `"local-plane"` on `RigidBody.space`. The four presentation modes
 * (`screen` / `viewport` / `camera` / `billboard`) become meaningful when a
 * render/UI consumer reads this component; until then they are sayable and
 * persistable rather than silently dropped.
 */

import {
  DEFAULT_SPACE_MODE,
  SPACE_MODES,
  type Component,
  type ComponentHost,
  type JsonValue,
  type SpaceMode,
} from "@fourjs/core";
import { Vector3 } from "@fourjs/math";

/**
 * The structural shape of `@fourjs/serialization`'s `ComponentSerializer<T>` —
 * declared here rather than imported because the frozen §3.1 matrix has no
 * scene → serialization edge. Same duck-typing move as
 * {@link MORPH_WEIGHTS_SERIALIZER}.
 */
export interface NodeSpaceSerializerShape<T> {
  serialize(component: T): JsonValue;
  deserialize(data: JsonValue, node?: unknown): T;
}

export interface NodeSpaceOptions {
  /** §8 mode. Default `"world"`. */
  readonly space?: SpaceMode;
  /**
   * Optional plane normal for `"local-plane"` / `"billboard"`.
   * Copied on construction; the component owns the vector.
   */
  readonly planeNormal?: Vector3;
}

/**
 * Node-level §8 space mode. One per node (§6a).
 */
export class NodeSpace implements Component {
  static readonly typeName = "NodeSpace";

  host: ComponentHost | null = null;

  #space: SpaceMode;
  readonly planeNormal: Vector3;

  constructor(options: NodeSpaceOptions = {}) {
    this.#space = options.space ?? DEFAULT_SPACE_MODE;
    this.planeNormal = options.planeNormal?.clone() ?? new Vector3(0, 0, 1);
  }

  get space(): SpaceMode {
    return this.#space;
  }

  set space(value: SpaceMode) {
    if (!SPACE_MODES.includes(value)) {
      throw new RangeError(
        `NodeSpace.space must be one of ${SPACE_MODES.join(", ")}; got ${String(value)} (§8).`,
      );
    }
    this.#space = value;
  }
}

function isSpaceMode(value: unknown): value is SpaceMode {
  return (
    typeof value === "string" &&
    (SPACE_MODES as readonly string[]).includes(value)
  );
}

function readVector(value: JsonValue | undefined, fallback: Vector3): Vector3 {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const x: unknown = value[0];
  const y: unknown = value[1];
  const z: unknown = value[2];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return fallback;
  }
  return new Vector3(x, y, z);
}

/**
 * §79 serializer for {@link NodeSpace}. `space` is omitted when it is the
 * `"world"` default so an unset scene stays small. `planeNormal` is omitted
 * when it is `+Z`.
 */
export const NODE_SPACE_SERIALIZER: NodeSpaceSerializerShape<NodeSpace> = {
  serialize(component: NodeSpace): JsonValue {
    const payload: Record<string, JsonValue> = {};
    if (component.space !== DEFAULT_SPACE_MODE) {
      payload.space = component.space;
    }
    const n = component.planeNormal;
    if (n.x !== 0 || n.y !== 0 || n.z !== 1) {
      payload.planeNormal = [n.x, n.y, n.z];
    }
    return payload;
  },

  deserialize(data: JsonValue): NodeSpace {
    const record =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as {
            readonly space?: JsonValue;
            readonly planeNormal?: JsonValue;
          })
        : {};
    return new NodeSpace({
      space: isSpaceMode(record.space) ? record.space : DEFAULT_SPACE_MODE,
      planeNormal: readVector(record.planeNormal, new Vector3(0, 0, 1)),
    });
  },
};
