/**
 * Layered / additive animation (PH-9, §18, §100).
 *
 * One {@link AnimationController} writes one pose. A stack evaluates several
 * controllers in declaration order onto the same target: the first layer
 * *replaces*, and each later layer either lerps over that pose or — when
 * `additive` — adds through {@link ValueAdapter.add}.
 *
 * ## Claims
 *
 * The stack holds **one** §16 claim per channel and is the writer. Inner
 * controllers are {@link AnimationController.adoptByStack adopted} before
 * play so they evaluate into scratches and never claim. Track the stack with
 * `AnimationSystem`, not the child controllers — advancing both would step
 * the children twice.
 *
 * ## Determinism (§33)
 *
 * Layers run in the array's declaration order. No clock, no RNG; time enters
 * only through {@link AnimationLayerStack.advance}.
 */

import { FourError } from "@fourjs/core";
import {
  Node,
  runOwnedTransformWrite,
  warnAuthorityConflict,
} from "@fourjs/scene";
import type { TransformAuthority } from "@fourjs/scene";

import type { Advanceable } from "./animation-system.js";
import { createBinding, type PropertyBinding } from "./binding.js";
import type {
  AnimationController,
  ControllerPlaybackState,
} from "./controller.js";
import {
  claimProperty,
  isTransformOwner,
  releaseProperty,
  requireNonNegativeSeconds,
  type PropertyClaim,
} from "./tween.js";
import { detectAdapter, type ValueAdapter } from "./values.js";

const STACK_AUTHORITY: TransformAuthority = "animation";
const STACK_WRITER_KIND = "animation layer stack";

/** One layer of an {@link AnimationLayerStack}. */
export interface AnimationLayer {
  /** Controller that produces this layer's pose. */
  readonly controller: AnimationController;
  /**
   * Blend or add weight. Default `1`. Finite; values outside `[0, 1]`
   * extrapolate the same way {@link ValueAdapter.lerp} does.
   */
  readonly weight?: number;
  /**
   * When true on a layer *after* the first, the pose is added through
   * {@link ValueAdapter.add}. The first layer always replaces,
   * even if this is set. Default `false` (weighted lerp over the pose so far).
   */
  readonly additive?: boolean;
}

/** Construction inputs for {@link AnimationLayerStack}. */
export interface AnimationLayerStackOptions {
  /** Root object every layer writes. Every child controller must target it. */
  readonly target: object;
  /** Layers in evaluation order; must be non-empty. */
  readonly layers: readonly AnimationLayer[];
  /**
   * Node whose §42 authority gates transform writes. Inferred when `target`
   * *is* a `Node`.
   */
  readonly authority?: Node;
}

interface StackChannel {
  readonly path: string;
  readonly adapter: ValueAdapter<unknown>;
  readonly binding: PropertyBinding;
  readonly scratch: unknown;
  readonly mixScratch: unknown;
  readonly baseline: unknown;
  readonly isTransform: boolean;
  readonly notifyChange: boolean;
  readonly claim: PropertyClaim;
  /** Child-controller channel index per layer, or `-1` if that layer omits it. */
  readonly layerIndices: readonly number[];
}

function invalidStack(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Weighted stack of {@link AnimationController}s over one target.
 *
 * See the module header for the replace-then-add rule and the claim policy.
 */
export class AnimationLayerStack implements Advanceable {
  readonly #target: object;
  readonly #controllers: readonly AnimationController[];
  readonly #additive: readonly boolean[];
  readonly #weights: number[];
  readonly #declaredNode: Node | undefined;
  #channels: readonly StackChannel[] = [];
  #authorityNode: Node | undefined;
  #hasTransformChannels = false;
  #state: ControllerPlaybackState = "idle";

  constructor(options: AnimationLayerStackOptions) {
    this.#target = options.target;
    this.#declaredNode = options.authority;
    if (options.layers.length === 0) {
      invalidStack("AnimationLayerStack needs at least one layer.", {});
    }
    const controllers: AnimationController[] = [];
    const additive: boolean[] = [];
    const weights: number[] = [];
    for (let index = 0; index < options.layers.length; index += 1) {
      const layer = options.layers[index];
      if (layer.controller.target !== options.target) {
        invalidStack(
          `AnimationLayerStack layer ${String(index)} targets a different object than the stack.`,
          { index },
        );
      }
      const weight = layer.weight ?? 1;
      if (!Number.isFinite(weight)) {
        invalidStack(
          `AnimationLayerStack layer ${String(index)} weight must be finite; received ${String(weight)}.`,
          { index, weight },
        );
      }
      controllers.push(layer.controller);
      additive.push(layer.additive === true);
      weights.push(weight);
    }
    this.#controllers = controllers;
    this.#additive = additive;
    this.#weights = weights;
  }

  get target(): object {
    return this.#target;
  }

  get state(): ControllerPlaybackState {
    return this.#state;
  }

  get finished(): boolean {
    return false;
  }

  /** Number of layers, in declaration order. */
  get layerCount(): number {
    return this.#controllers.length;
  }

  /** Current weight of layer `index`. */
  layerWeight(index: number): number {
    this.#requireLayer(index);
    return this.#weights[index];
  }

  /**
   * Sets the weight of layer `index`. Finite; not clamped.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — bad index or non-finite weight.
   */
  setLayerWeight(index: number, weight: number): this {
    this.#requireLayer(index);
    if (!Number.isFinite(weight)) {
      invalidStack(
        `AnimationLayerStack layer ${String(index)} weight must be finite; received ${String(weight)}.`,
        { index, weight },
      );
    }
    this.#weights[index] = weight;
    return this;
  }

  /**
   * Adopts every child, claims the union of their channels, and writes the
   * initial composed pose.
   */
  play(): this {
    if (this.#state !== "idle") {
      return this;
    }
    for (const controller of this.#controllers) {
      controller.adoptByStack();
      controller.play();
    }

    const node =
      this.#declaredNode ??
      (this.#target instanceof Node ? this.#target : undefined);

    const specs: {
      path: string;
      adapter: ValueAdapter<unknown>;
      layerIndices: number[];
    }[] = [];
    const specIndex = new Map<string, number>();
    for (let layer = 0; layer < this.#controllers.length; layer += 1) {
      const controller = this.#controllers[layer];
      for (let channel = 0; channel < controller.channelCount; channel += 1) {
        const path = controller.channelPath(channel);
        let index = specIndex.get(path);
        if (index === undefined) {
          index = specs.length;
          specIndex.set(path, index);
          const layerIndices = new Array<number>(this.#controllers.length).fill(
            -1,
          );
          specs.push({
            path,
            adapter: controller.channelAdapter(channel),
            layerIndices,
          });
        } else if (
          specs[index].adapter.kind !== controller.channelAdapter(channel).kind
        ) {
          invalidStack(
            `AnimationLayerStack channel "${path}" has mixed value kinds across layers.`,
            {
              path,
              expected: specs[index].adapter.kind,
              received: controller.channelAdapter(channel).kind,
            },
          );
        }
        specs[index].layerIndices[layer] = channel;
      }
    }

    const channels: StackChannel[] = [];
    let hasTransformChannels = false;
    for (const spec of specs) {
      const adapter = spec.adapter;
      const binding = createBinding(this.#target, spec.path, adapter);
      const detected = detectAdapter(binding.get());
      if (
        adapter.kind !== "discrete" &&
        (detected === undefined || detected.kind !== adapter.kind)
      ) {
        invalidStack(
          `AnimationLayerStack has a ${adapter.kind} channel on "${spec.path}", but that property holds ${detected === undefined ? "a value of no known type" : `a ${detected.kind}`}.`,
          { path: spec.path, expected: adapter.kind, received: detected?.kind },
        );
      }
      const isTransform =
        node !== undefined && isTransformOwner(node, binding.owner);
      hasTransformChannels = hasTransformChannels || isTransform;
      const current = binding.get();
      const claim: PropertyClaim = {
        writerKind: STACK_WRITER_KIND,
        held: false,
      };
      channels.push({
        path: spec.path,
        adapter,
        binding,
        scratch: adapter.clone(current),
        mixScratch: adapter.clone(current),
        baseline: adapter.clone(current),
        isTransform,
        notifyChange: !adapter.mutatesInPlace,
        claim,
        layerIndices: spec.layerIndices,
      });
    }

    this.#channels = channels;
    this.#hasTransformChannels = hasTransformChannels;
    this.#authorityNode = hasTransformChannels ? node : undefined;
    for (const channel of channels) {
      claimProperty(
        channel.binding.owner,
        channel.binding.key,
        channel.path,
        channel.claim,
      );
    }
    this.#state = "running";
    this.#writePose();
    return this;
  }

  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
      for (const controller of this.#controllers) {
        controller.pause();
      }
    }
    return this;
  }

  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
      for (const controller of this.#controllers) {
        controller.resume();
      }
    }
    return this;
  }

  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    for (const channel of this.#channels) {
      releaseProperty(
        channel.binding.owner,
        channel.binding.key,
        channel.claim,
      );
      channel.claim.held = false;
    }
    for (const controller of this.#controllers) {
      controller.stop();
    }
    this.#state = "stopped";
    return this;
  }

  /**
   * Advances every child controller, then writes the composed pose.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — negative or non-finite delta.
   */
  advance(deltaSeconds: number): this {
    requireNonNegativeSeconds(
      deltaSeconds,
      "AnimationLayerStack advance delta",
    );
    if (this.#state !== "running") {
      return this;
    }
    for (const controller of this.#controllers) {
      controller.advance(deltaSeconds);
    }
    this.#writePose();
    return this;
  }

  #requireLayer(index: number): void {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.#weights.length
    ) {
      invalidStack(`AnimationLayerStack has no layer ${String(index)}.`, {
        index,
      });
    }
  }

  #writePose(): void {
    let allowTransform = true;
    if (this.#hasTransformChannels) {
      const node = this.#authorityNode as Node;
      if (node.transformAuthority !== STACK_AUTHORITY) {
        warnAuthorityConflict(node, STACK_AUTHORITY);
        allowTransform = false;
      }
    }
    const writeChannels = (): void => {
      const channels = this.#channels;
      for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index];
        const value = this.#compose(channel);
        if (!channel.claim.held || (channel.isTransform && !allowTransform)) {
          continue;
        }
        channel.binding.set(value);
        if (channel.notifyChange) {
          (channel.binding.owner as { onChanged?: () => void }).onChanged?.();
        }
      }
    };
    if (allowTransform) {
      runOwnedTransformWrite(writeChannels);
    } else {
      writeChannels();
    }
  }

  #compose(channel: StackChannel): unknown {
    let have = false;
    let value: unknown = channel.baseline;
    for (let layer = 0; layer < this.#controllers.length; layer += 1) {
      const childIndex = channel.layerIndices[layer];
      if (childIndex < 0) {
        continue;
      }
      const pose = this.#controllers[layer].evaluatedChannel(childIndex);
      if (!have) {
        value = channel.adapter.copy(pose, channel.scratch);
        have = true;
        continue;
      }
      if (this.#additive[layer]) {
        value = channel.adapter.add(
          value,
          pose,
          this.#weights[layer],
          channel.mixScratch,
        );
      } else {
        value = channel.adapter.lerp(
          value,
          pose,
          this.#weights[layer],
          channel.mixScratch,
        );
      }
    }
    return have ? value : channel.baseline;
  }
}
