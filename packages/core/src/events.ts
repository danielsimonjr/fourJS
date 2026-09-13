/**
 * Typed event emitter (§6b).
 *
 * One event API serves nodes and the application. `EventEmitter` is the shared
 * implementation: `@fourjs/scene`'s `Node` extends it (plan D1), and the
 * application composition root re-emits `fixedUpdate` / `update` / `render`
 * through the same contract (§10).
 *
 * The four emitter-local rules of §6b, and how they are implemented here:
 *
 * 1. `on` returns an unsubscribe function; `once` removes the listener after
 *    exactly one delivery. The unsubscriber is idempotent.
 * 2. Listeners fire in registration order.
 * 3. Listeners added or removed during a dispatch take effect from the next
 *    dispatch: `emit` iterates a snapshot of the listener list taken before the
 *    first listener runs. A listener removed during the dispatch is still
 *    skipped (its record is flagged), because "removed" must mean "will not be
 *    called again"; a listener *added* during the dispatch is not called until
 *    the next dispatch of that type.
 * 4. An event does not re-enter its own dispatch. Emitting the *same* type
 *    while that type is dispatching does not recurse: the event is queued and
 *    delivered after the in-flight dispatch of that type completes, in emission
 *    order. (Decision, WP-1.4: queue-and-defer rather than throw or drop —
 *    §6b forbids re-entrancy but the spec describes no error, and dropping the
 *    event would silently lose state changes. Emitting a *different* type from
 *    within a dispatch is not re-entrancy and is delivered immediately.)
 */

/** A listener for a single event type. */
export type EventListener<Event> = (event: Event) => void;

/** Removes the listener that returned it. Calling it more than once is a no-op. */
export type Unsubscribe = () => void;

/**
 * Internal listener bookkeeping.
 *
 * The stored listener is typed with a `never` parameter so that records of
 * different event types can share one array type; the public API narrows it
 * back at the single call site inside the private dispatch routine.
 */
interface ListenerRecord {
  readonly listener: EventListener<never>;
  readonly once: boolean;
  /** Set when the listener is removed, so an in-flight snapshot skips it. */
  removed: boolean;
}

interface QueuedEvent {
  readonly type: PropertyKey;
  readonly event: unknown;
}

export class EventEmitter<EventMap> {
  /** Registration-ordered listener records, keyed by event type. */
  readonly #listeners = new Map<PropertyKey, ListenerRecord[]>();

  /** Event types with a dispatch in progress (rule 4). */
  readonly #dispatching = new Set<PropertyKey>();

  /** Events deferred by rule 4, in emission order. */
  readonly #deferred: QueuedEvent[] = [];

  /**
   * Registers `listener` for `type`. Returns a function that removes it.
   *
   * The same listener may be registered more than once; each registration is
   * independent and is delivered once per dispatch.
   */
  on<K extends keyof EventMap>(
    type: K,
    listener: EventListener<EventMap[K]>,
  ): Unsubscribe {
    return this.#add(type, listener, false);
  }

  /** Registers `listener` for a single delivery. Returns an unsubscriber. */
  once<K extends keyof EventMap>(
    type: K,
    listener: EventListener<EventMap[K]>,
  ): Unsubscribe {
    return this.#add(type, listener, true);
  }

  /**
   * Removes the earliest still-registered registration of `listener` for
   * `type`. Removing a listener that is not registered is a no-op.
   */
  off<K extends keyof EventMap>(
    type: K,
    listener: EventListener<EventMap[K]>,
  ): void {
    const records = this.#listeners.get(type);
    if (records === undefined) {
      return;
    }
    const index = records.findIndex(
      (record) => !record.removed && record.listener === listener,
    );
    if (index === -1) {
      return;
    }
    this.#remove(type, records[index]);
  }

  /**
   * Delivers `event` to the listeners registered for `type` in registration
   * order. Re-entrant emission of `type` is deferred (rule 4).
   */
  emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    if (this.#dispatching.has(type)) {
      this.#deferred.push({ type, event });
      return;
    }
    this.#dispatch(type, event);
    this.#drain();
  }

  /** Number of live registrations for `type` (diagnostics, §83). */
  listenerCount<K extends keyof EventMap>(type: K): number {
    const records = this.#listeners.get(type);
    if (records === undefined) {
      return 0;
    }
    let count = 0;
    for (const record of records) {
      if (!record.removed) {
        count += 1;
      }
    }
    return count;
  }

  totalListenerCount(): number {
    let count = 0;
    for (const records of this.#listeners.values()) {
      for (const record of records) {
        if (!record.removed) count += 1;
      }
    }
    return count;
  }

  /**
   * Number of live listener registrations across every event type (§83).
   *
   * Used by teardown diagnostics — a detached node that still holds listeners
   * pins its subtree until those listeners are removed.
   */
  listenerCountAll(): number {
    let count = 0;
    for (const records of this.#listeners.values()) {
      for (const record of records) {
        if (!record.removed) {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * Removes every listener, or every listener of one type. Used by teardown
   * paths that must not leave detached nodes retaining listeners (§83).
   */
  removeAllListeners<K extends keyof EventMap>(type?: K): void {
    if (type === undefined) {
      for (const records of this.#listeners.values()) {
        for (const record of records) {
          record.removed = true;
        }
      }
      this.#listeners.clear();
      return;
    }
    const records = this.#listeners.get(type);
    if (records === undefined) {
      return;
    }
    for (const record of records) {
      record.removed = true;
    }
    this.#listeners.delete(type);
  }

  /**
   * Delivers one event to a snapshot of the current listener list (rule 3).
   * A listener that throws aborts the remaining listeners of this dispatch, but
   * the dispatch bookkeeping is always unwound so the emitter stays usable.
   */
  #dispatch(type: PropertyKey, event: unknown): void {
    const records = this.#listeners.get(type);
    if (records === undefined || records.length === 0) {
      return;
    }
    // No per-emit copy (2026-09-11): the loop captures `length` now, so a
    // listener added during dispatch (pushed past it) is not delivered — rule
    // 3 unchanged — and `#remove` defers its splice while `type` is being
    // dispatched (see `#remove`), so indices stay stable; `removed` is the
    // per-record skip either way. Physics emits each contact on two bodies,
    // which made the old `slice()` hundreds of allocations per fixed step.
    const length = records.length;
    this.#dispatching.add(type);
    try {
      for (let i = 0; i < length; i += 1) {
        const record = records[i];
        if (record.removed) {
          continue;
        }
        if (record.once) {
          // Remove before delivery so a listener that re-emits (deferred) or
          // inspects the emitter never observes a spent `once` registration.
          this.#remove(type, record);
        }
        (record.listener as EventListener<unknown>)(event);
      }
    } finally {
      this.#dispatching.delete(type);
      this.#compact(type);
    }
  }

  /** Drops the records `#remove` left in place during a dispatch of `type`. */
  #compact(type: PropertyKey): void {
    const records = this.#listeners.get(type);
    if (records === undefined) {
      return;
    }
    let write = 0;
    for (let read = 0; read < records.length; read += 1) {
      const record = records[read];
      if (!record.removed) {
        records[write] = record;
        write += 1;
      }
    }
    records.length = write;
    if (write === 0) {
      this.#listeners.delete(type);
    }
  }

  #add(
    type: PropertyKey,
    listener: EventListener<never>,
    once: boolean,
  ): Unsubscribe {
    const record: ListenerRecord = { listener, once, removed: false };
    const records = this.#listeners.get(type);
    if (records === undefined) {
      this.#listeners.set(type, [record]);
    } else {
      records.push(record);
    }
    return () => {
      this.#remove(type, record);
    };
  }

  #remove(type: PropertyKey, record: ListenerRecord): void {
    if (record.removed) {
      return;
    }
    record.removed = true;
    const records = this.#listeners.get(type);
    if (records === undefined) {
      return;
    }
    if (this.#dispatching.has(type)) {
      // Splicing under a live index loop would skip the next listener;
      // `#dispatch` compacts once the loop is done.
      return;
    }
    const index = records.indexOf(record);
    if (index !== -1) {
      records.splice(index, 1);
    }
    if (records.length === 0) {
      this.#listeners.delete(type);
    }
  }

  /**
   * Delivers events deferred by rule 4. An event whose type is still being
   * dispatched by an outer frame stays queued; the outer frame drains it.
   */
  #drain(): void {
    for (;;) {
      const index = this.#deferred.findIndex(
        (queued) => !this.#dispatching.has(queued.type),
      );
      if (index === -1) {
        return;
      }
      const queued = this.#deferred.splice(index, 1)[0];
      this.#dispatch(queued.type, queued.event);
    }
  }
}
