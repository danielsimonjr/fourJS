import { describe, expect, it, vi } from "vitest";

import { EventEmitter } from "../src/events.js";

interface TestEventMap {
  ping: { readonly value: number };
  pong: { readonly value: number };
}

class TestEmitter extends EventEmitter<TestEventMap> {}

describe("EventEmitter (§6b)", () => {
  it("delivers typed events to registered listeners", () => {
    const emitter = new TestEmitter();
    const received: number[] = [];
    emitter.on("ping", (event) => received.push(event.value));

    emitter.emit("ping", { value: 7 });

    expect(received).toEqual([7]);
  });

  it("ignores events with no listeners", () => {
    const emitter = new TestEmitter();
    expect(() => emitter.emit("ping", { value: 1 })).not.toThrow();
  });

  describe("rule 1 — unsubscribe function and once", () => {
    it("`on` returns an unsubscriber that removes the listener", () => {
      const emitter = new TestEmitter();
      const listener = vi.fn();
      const unsubscribe = emitter.on("ping", listener);

      emitter.emit("ping", { value: 1 });
      unsubscribe();
      emitter.emit("ping", { value: 2 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ value: 1 });
    });

    it("the unsubscriber is idempotent and removes only its own registration", () => {
      const emitter = new TestEmitter();
      const listener = vi.fn();
      const unsubscribeFirst = emitter.on("ping", listener);
      emitter.on("ping", listener);

      unsubscribeFirst();
      unsubscribeFirst();
      emitter.emit("ping", { value: 1 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(emitter.listenerCount("ping")).toBe(1);
    });

    it("totalListenerCount sums every event type", () => {
      const emitter = new TestEmitter();
      emitter.on("ping", () => undefined);
      emitter.on("pong", () => undefined);
      emitter.on("pong", () => undefined);
      expect(emitter.totalListenerCount()).toBe(3);
      emitter.removeAllListeners("ping");
      expect(emitter.totalListenerCount()).toBe(2);
    });

    it("`once` removes the listener after exactly one delivery", () => {
      const emitter = new TestEmitter();
      const listener = vi.fn();
      emitter.once("ping", listener);

      emitter.emit("ping", { value: 1 });
      emitter.emit("ping", { value: 2 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ value: 1 });
      expect(emitter.listenerCount("ping")).toBe(0);
    });

    it("`once` can be cancelled before it fires", () => {
      const emitter = new TestEmitter();
      const listener = vi.fn();
      const unsubscribe = emitter.once("ping", listener);

      unsubscribe();
      emitter.emit("ping", { value: 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    it("`off` removes a registered listener and tolerates unknown ones", () => {
      const emitter = new TestEmitter();
      const listener = vi.fn();
      emitter.on("ping", listener);

      emitter.off("ping", listener);
      emitter.off("ping", listener);
      emitter.off("pong", listener);
      emitter.emit("ping", { value: 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    it("removeAllListeners clears one type or every type", () => {
      const emitter = new TestEmitter();
      emitter.on("ping", vi.fn());
      emitter.on("pong", vi.fn());

      emitter.removeAllListeners("ping");
      expect(emitter.listenerCount("ping")).toBe(0);
      expect(emitter.listenerCount("pong")).toBe(1);

      emitter.removeAllListeners();
      expect(emitter.listenerCount("pong")).toBe(0);
    });
  });

  describe("rule 2 — registration order", () => {
    it("fires listeners in registration order", () => {
      const emitter = new TestEmitter();
      const order: string[] = [];
      emitter.on("ping", () => order.push("first"));
      emitter.once("ping", () => order.push("second"));
      emitter.on("ping", () => order.push("third"));

      emitter.emit("ping", { value: 1 });

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("keeps registration order after a middle listener is removed", () => {
      const emitter = new TestEmitter();
      const order: string[] = [];
      emitter.on("ping", () => order.push("first"));
      const unsubscribe = emitter.on("ping", () => order.push("second"));
      emitter.on("ping", () => order.push("third"));

      unsubscribe();
      emitter.on("ping", () => order.push("fourth"));
      emitter.emit("ping", { value: 1 });

      expect(order).toEqual(["first", "third", "fourth"]);
    });
  });

  describe("rule 3 — mutations during dispatch take effect next dispatch", () => {
    it("does not deliver to a listener added during dispatch", () => {
      const emitter = new TestEmitter();
      const added = vi.fn();
      emitter.on("ping", () => {
        emitter.on("ping", added);
      });

      emitter.emit("ping", { value: 1 });
      expect(added).not.toHaveBeenCalled();

      emitter.emit("ping", { value: 2 });
      expect(added).toHaveBeenCalledTimes(1);
    });

    it("does not call a listener removed earlier in the same dispatch", () => {
      const emitter = new TestEmitter();
      const later = vi.fn();
      // The remover runs first, so `later` is removed before its turn in the
      // snapshot: "removed" must mean "will not be called again".
      emitter.on("ping", () => {
        emitter.off("ping", later);
      });
      emitter.on("ping", later);

      emitter.emit("ping", { value: 1 });
      expect(later).not.toHaveBeenCalled();

      emitter.emit("ping", { value: 2 });
      expect(later).not.toHaveBeenCalled();
    });

    it("iterates a snapshot: self-removal does not skip the next listener", () => {
      const emitter = new TestEmitter();
      const order: string[] = [];
      const unsubscribeFirst = emitter.on("ping", () => {
        order.push("first");
        unsubscribeFirst();
      });
      emitter.on("ping", () => order.push("second"));

      emitter.emit("ping", { value: 1 });

      expect(order).toEqual(["first", "second"]);
      expect(emitter.listenerCount("ping")).toBe(1);
    });
  });

  describe("rule 4 — an event does not re-enter its own dispatch", () => {
    it("defers a same-type emit until the in-flight dispatch completes", () => {
      const emitter = new TestEmitter();
      const seen: string[] = [];
      let reEmitted = false;
      emitter.on("ping", (event) => {
        seen.push(`a:${String(event.value)}`);
        if (!reEmitted) {
          reEmitted = true;
          emitter.emit("ping", { value: 2 });
          // Not delivered yet: the outer dispatch is still running.
          seen.push("a:after-emit");
        }
      });
      emitter.on("ping", (event) => {
        seen.push(`b:${String(event.value)}`);
      });

      emitter.emit("ping", { value: 1 });

      expect(seen).toEqual(["a:1", "a:after-emit", "b:1", "a:2", "b:2"]);
    });

    it("delivers several deferred events in emission order", () => {
      const emitter = new TestEmitter();
      const values: number[] = [];
      let done = false;
      emitter.on("ping", (event) => {
        values.push(event.value);
        if (!done) {
          done = true;
          emitter.emit("ping", { value: 2 });
          emitter.emit("ping", { value: 3 });
        }
      });

      emitter.emit("ping", { value: 1 });

      expect(values).toEqual([1, 2, 3]);
    });

    it("does not recurse infinitely when a listener always re-emits", () => {
      const emitter = new TestEmitter();
      let count = 0;
      emitter.on("ping", (event) => {
        count += 1;
        if (event.value < 4) {
          emitter.emit("ping", { value: event.value + 1 });
        }
      });

      emitter.emit("ping", { value: 1 });

      expect(count).toBe(4);
    });

    it("delivers a different type immediately (nesting is not re-entrancy)", () => {
      const emitter = new TestEmitter();
      const order: string[] = [];
      emitter.on("ping", () => {
        order.push("ping:start");
        emitter.emit("pong", { value: 9 });
        order.push("ping:end");
      });
      emitter.on("pong", (event) => order.push(`pong:${String(event.value)}`));

      emitter.emit("ping", { value: 1 });

      expect(order).toEqual(["ping:start", "pong:9", "ping:end"]);
    });

    it("queues an outer type re-emitted from a nested dispatch", () => {
      const emitter = new TestEmitter();
      const order: string[] = [];
      let nested = false;
      emitter.on("ping", (event) => {
        order.push(`ping:${String(event.value)}`);
        if (!nested) {
          nested = true;
          emitter.emit("pong", { value: 1 });
        }
      });
      emitter.on("pong", () => {
        order.push("pong");
        // `ping` is still dispatching in the outer frame: must be deferred.
        emitter.emit("ping", { value: 2 });
        order.push("pong:end");
      });

      emitter.emit("ping", { value: 1 });

      expect(order).toEqual(["ping:1", "pong", "pong:end", "ping:2"]);
    });

    it("unwinds dispatch state when a listener throws", () => {
      const emitter = new TestEmitter();
      const after = vi.fn();
      emitter.on("ping", () => {
        throw new Error("listener failure");
      });
      emitter.on("ping", after);

      expect(() => emitter.emit("ping", { value: 1 })).toThrow(
        "listener failure",
      );
      expect(after).not.toHaveBeenCalled();

      // The emitter is still usable and not stuck "dispatching".
      emitter.off("ping", after);
      const recovered = vi.fn();
      emitter.on("pong", recovered);
      emitter.emit("pong", { value: 2 });
      expect(recovered).toHaveBeenCalledTimes(1);
    });

    it("drops events deferred by a dispatch that a listener aborted", () => {
      const emitter = new TestEmitter();
      const seen: number[] = [];
      emitter.on("ping", (event) => {
        seen.push(event.value);
        if (event.value === 1) {
          emitter.emit("ping", { value: 2 }); // deferred (rule 4)
          throw new Error("listener failure");
        }
      });

      expect(() => emitter.emit("ping", { value: 1 })).toThrow(
        "listener failure",
      );
      expect(seen).toEqual([1]);

      // The deferred `2` must not surface at the start of an unrelated emit,
      // nor at the next `ping`.
      const late = vi.fn();
      emitter.on("pong", late);
      emitter.emit("pong", { value: 9 });
      emitter.emit("ping", { value: 3 });
      expect(late).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([1, 3]);
    });

    it("keeps the deferred queue when an outer listener catches a nested throw", () => {
      const emitter = new TestEmitter();
      const seen: number[] = [];
      emitter.on("pong", () => {
        throw new Error("nested failure");
      });
      emitter.on("ping", (event) => {
        seen.push(event.value);
        if (event.value === 1) {
          emitter.emit("ping", { value: 2 }); // deferred (rule 4)
          try {
            emitter.emit("pong", { value: 0 });
          } catch {
            // swallowed: the outer ping dispatch completes normally
          }
        }
      });

      emitter.emit("ping", { value: 1 });
      expect(seen).toEqual([1, 2]);
    });
  });

  describe("removeAllListeners and the deferred queue", () => {
    it("discards every deferred event on a full teardown", () => {
      const emitter = new TestEmitter();
      const seen: number[] = [];
      emitter.on("ping", (event) => {
        seen.push(event.value);
        emitter.emit("ping", { value: event.value + 1 }); // deferred
        emitter.removeAllListeners();
      });
      emitter.emit("ping", { value: 1 });
      expect(seen).toEqual([1]);

      // Nothing leaks to a listener registered after teardown.
      const late = vi.fn();
      emitter.on("ping", late);
      emitter.emit("pong", { value: 0 });
      expect(late).not.toHaveBeenCalled();
    });

    it("discards only that type's deferred events on a per-type teardown", () => {
      const emitter = new TestEmitter();
      const pings: number[] = [];
      const pongs: number[] = [];
      emitter.on("pong", (event) => pongs.push(event.value));
      emitter.on("ping", (event) => {
        pings.push(event.value);
        if (event.value === 1) {
          emitter.emit("ping", { value: 2 }); // deferred, then discarded
          emitter.once("pong", () => emitter.emit("pong", { value: 8 })); // defers
          emitter.emit("pong", { value: 7 });
          emitter.removeAllListeners("ping");
        }
      });
      emitter.emit("ping", { value: 1 });
      expect(pings).toEqual([1]);
      expect(pongs).toEqual([7, 8]);
    });
  });

  it("is usable through inheritance (plan D1: Node extends EventEmitter)", () => {
    interface CountedEvents {
      changed: { readonly count: number };
    }
    class Counter extends EventEmitter<CountedEvents> {
      count = 0;

      increment(): void {
        this.count += 1;
        this.emit("changed", { count: this.count });
      }
    }

    const counter = new Counter();
    const seen: number[] = [];
    counter.on("changed", (event) => seen.push(event.count));

    counter.increment();
    counter.increment();

    expect(seen).toEqual([1, 2]);
  });

  it("keeps listener lists per emitter instance", () => {
    const first = new TestEmitter();
    const second = new TestEmitter();
    const listener = vi.fn();
    first.on("ping", listener);

    second.emit("ping", { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  describe("listenerCountAll (§83)", () => {
    it("counts live registrations across every event type", () => {
      const emitter = new TestEmitter();
      expect(emitter.listenerCountAll()).toBe(0);
      const onPing = (): void => undefined;
      emitter.on("ping", onPing);
      emitter.on("pong", () => undefined);
      expect(emitter.listenerCountAll()).toBe(2);
      emitter.off("ping", onPing);
      expect(emitter.listenerCountAll()).toBe(1);
    });
  });
});

describe("dispatch without a snapshot (2026-09-11)", () => {
  it("compacts records removed during dispatch once the dispatch ends, keeping counts and order honest", () => {
    const emitter = new EventEmitter<{ ping: number }>();
    const seen: string[] = [];
    const offA = emitter.on("ping", () => {
      seen.push("a");
      offA();
    });
    emitter.on("ping", () => seen.push("b"));
    emitter.on("ping", () => seen.push("c"));
    emitter.emit("ping", 1);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(emitter.listenerCount("ping")).toBe(2);
    emitter.emit("ping", 2);
    expect(seen).toEqual(["a", "b", "c", "b", "c"]);
  });

  it("removeAllListeners during dispatch stops delivery and leaves the type empty", () => {
    const emitter = new EventEmitter<{ ping: number }>();
    const seen: string[] = [];
    emitter.on("ping", () => {
      seen.push("a");
      emitter.removeAllListeners("ping");
    });
    emitter.on("ping", () => seen.push("b"));
    emitter.emit("ping", 1);
    expect(seen).toEqual(["a"]);
    expect(emitter.listenerCount("ping")).toBe(0);
    expect(emitter.totalListenerCount()).toBe(0);
  });
});
