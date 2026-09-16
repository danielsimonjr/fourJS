/**
 * Uniform-grid spatial hash for radius neighbour queries (§12 flocking, §36
 * particles; plan WP-8.2 / P9).
 *
 * Steering's flocking behaviours take an `Iterable<SteeringNeighbor>` and
 * deliberately know nothing about how that set was built — brute force, a
 * physics broadphase, or this index. The hash lives here, beside steering, as
 * the optional **O(n)** neighbour source those behaviours were staged against.
 *
 * ```ts
 * const hash = new SpatialHash<SteeringNeighbor>({ cellSize: 4 });
 * for (let i = 0; i < agents.length; i += 1) {
 *   const agent = agents[i];
 *   hash.insert(i, agent.position.x, agent.position.y, agent.position.z, agent);
 * }
 *
 * const neighbors: SteeringNeighbor[] = [];
 * hash.query(agent.position.x, agent.position.y, agent.position.z, 8, neighbors, i);
 * separation(agent, neighbors, acceleration);
 * ```
 *
 * ## Cell size (decision, WP-8.2)
 *
 * {@link SpatialHashOptions.cellSize} is the edge length of each cubic cell in
 * world units. It must be **finite and strictly positive**; there is no default
 * because the right value depends on neighbour radius and density (steering
 * typically sets it to roughly the query radius; particle workloads may tune it
 * per emitter). Cells are addressed with `floor(coordinate / cellSize)` so
 * negative coordinates behave predictably.
 *
 * ## Rebuild policy (decision, WP-8.2)
 *
 * The index is **explicit**: callers {@link SpatialHash.clear} and re-
 * {@link SpatialHash.insert} each frame, or call {@link SpatialHash.update} when
 * only positions move. There is no automatic subscription to a scene graph or
 * particle pool — that would freeze ownership and rebuild timing before §112
 * workloads exist to size them against.
 *
 * ## Query order and determinism (§33, plan P8-3)
 *
 * {@link SpatialHash.query} returns matches in **insertion order** — the order
 * of successful `insert` calls since the last `clear`, with re-inserting the
 * same key preserving its original slot. Cell traversal during a query is fixed
 * (ascending `x`, then `y`, then `z` cell indices), but ties are broken by that
 * insertion order, not by key or distance, so two runs with the same insert
 * sequence and positions produce bit-identical neighbour lists for steering.
 *
 * ## Allocation (§7b, plan D7)
 *
 * After construction, `insert`, `update`, `remove`, and `query` allocate nothing
 * on the hot path when the caller supplies reusable `out` arrays. `clear` retains
 * bucket storage for reuse. The constructor may allocate from `capacityHint`.
 */

/** Options for {@link SpatialHash}. */
export interface SpatialHashOptions {
  /**
   * Cubic cell edge length in world units. Must be finite and strictly positive.
   */
  cellSize: number;
  /**
   * Hint for the initial number of entries. Optional; defaults to `0`.
   */
  capacityHint?: number;
}

/** One indexed entry stored in a {@link SpatialHash}. */
export interface SpatialHashEntry<T> {
  /** Caller-owned key; typically a pool index or agent id. */
  readonly key: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Payload stored at insert time — often the agent record itself. */
  readonly data: T;
}

/** Internal record backing a stored entry. */
interface StoredEntry<T> {
  key: number;
  x: number;
  y: number;
  z: number;
  data: T;
  /** Monotonic insertion sequence used for deterministic query ordering. */
  order: number;
}

function assertCellSize(cellSize: number): void {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError(
      `SpatialHash cellSize must be finite and > 0, got ${cellSize}`,
    );
  }
}

function cellIndex(coordinate: number, cellSize: number): number {
  return Math.floor(coordinate / cellSize);
}

function cellKey(ix: number, iy: number, iz: number): string {
  return `${ix}\0${iy}\0${iz}`;
}

/**
 * Fixed-capacity uniform grid for radius neighbour queries.
 *
 * Generic over the payload type stored at each key — {@link SteeringNeighbor}
 * for flocking, a pool index wrapper for particles, or `undefined` when only
 * positions matter.
 */
export class SpatialHash<T> {
  /** Cubic cell edge length in world units. */
  readonly cellSize: number;

  /** Entries keyed by caller id. */
  readonly #entries = new Map<number, StoredEntry<T>>();

  /** Grid buckets mapping cell coordinates to entry keys. */
  readonly #buckets = new Map<string, number[]>();

  /** Next insertion-order ticket. */
  #nextOrder = 0;

  constructor(options: SpatialHashOptions) {
    assertCellSize(options.cellSize);
    this.cellSize = options.cellSize;
    const hint = options.capacityHint ?? 0;
    if (hint > 0) {
      this.#entries = new Map<number, StoredEntry<T>>();
    }
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.#entries.size;
  }

  /** Remove every entry and bucket while retaining allocated bucket arrays. */
  clear(): void {
    this.#entries.clear();
    for (const bucket of this.#buckets.values()) {
      bucket.length = 0;
    }
    this.#nextOrder = 0;
  }

  /**
   * Insert or replace an entry.
   *
   * A fresh key receives the next insertion-order ticket. Replacing an existing
   * key keeps the original ticket so steering order stays stable when positions
   * are updated in place via {@link SpatialHash.update}.
   */
  insert(key: number, x: number, y: number, z: number, data: T): void {
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      this.#removeFromBucket(existing);
      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.data = data;
      this.#addToBucket(existing);
      return;
    }

    const entry: StoredEntry<T> = {
      key,
      x,
      y,
      z,
      data,
      order: this.#nextOrder,
    };
    this.#nextOrder += 1;
    this.#entries.set(key, entry);
    this.#addToBucket(entry);
  }

  /** Move an existing entry to a new position. Throws if the key is absent. */
  update(key: number, x: number, y: number, z: number): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      throw new RangeError(`SpatialHash.update: unknown key ${key}`);
    }
    if (entry.x === x && entry.y === y && entry.z === z) {
      return;
    }
    this.#removeFromBucket(entry);
    entry.x = x;
    entry.y = y;
    entry.z = z;
    this.#addToBucket(entry);
  }

  /** Remove an entry. Returns `false` when the key was not present. */
  remove(key: number): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return false;
    }
    this.#removeFromBucket(entry);
    this.#entries.delete(key);
    return true;
  }

  /** Whether `key` is currently stored. */
  has(key: number): boolean {
    return this.#entries.has(key);
  }

  /** Lookup by key, or `undefined` when absent. */
  get(key: number): SpatialHashEntry<T> | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    return {
      key: entry.key,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      data: entry.data,
    };
  }

  /**
   * Collect payloads of every entry within `radius` of `(cx, cy, cz)`.
   *
   * `out` is cleared, then filled in insertion order. Pass `excludeKey` to omit
   * self-neighbours (typical when the query centre is an agent's own position).
   * Returns `out` for chaining.
   */
  query(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    out: T[],
    excludeKey?: number,
  ): readonly T[] {
    out.length = 0;
    if (radius < 0 || this.#entries.size === 0) {
      return out;
    }

    const radiusSq = radius * radius;
    const cellSize = this.cellSize;
    const centerIx = cellIndex(cx, cellSize);
    const centerIy = cellIndex(cy, cellSize);
    const centerIz = cellIndex(cz, cellSize);
    const cellRadius = radius === 0 ? 0 : Math.ceil(radius / cellSize);

    const matches: StoredEntry<T>[] = [];
    for (let iz = centerIz - cellRadius; iz <= centerIz + cellRadius; iz += 1) {
      for (
        let iy = centerIy - cellRadius;
        iy <= centerIy + cellRadius;
        iy += 1
      ) {
        for (
          let ix = centerIx - cellRadius;
          ix <= centerIx + cellRadius;
          ix += 1
        ) {
          const bucket = this.#buckets.get(cellKey(ix, iy, iz));
          if (bucket === undefined) {
            continue;
          }
          for (let i = 0; i < bucket.length; i += 1) {
            const key = bucket[i];
            if (key === excludeKey) {
              continue;
            }
            const entry = this.#entries.get(key);
            if (entry === undefined) {
              continue;
            }
            const dx = entry.x - cx;
            const dy = entry.y - cy;
            const dz = entry.z - cz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq <= radiusSq) {
              matches.push(entry);
            }
          }
        }
      }
    }

    matches.sort((a, b) => a.order - b.order);
    for (let i = 0; i < matches.length; i += 1) {
      out.push(matches[i].data);
    }
    return out;
  }

  /**
   * Collect keys of every entry within `radius` of `(cx, cy, cz)`.
   *
   * Same ordering rules as {@link SpatialHash.query}. Useful when payloads are
   * looked up elsewhere (for example a parallel SoA particle pool).
   */
  queryKeys(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    out: number[],
    excludeKey?: number,
  ): readonly number[] {
    out.length = 0;
    if (radius < 0 || this.#entries.size === 0) {
      return out;
    }

    const radiusSq = radius * radius;
    const cellSize = this.cellSize;
    const centerIx = cellIndex(cx, cellSize);
    const centerIy = cellIndex(cy, cellSize);
    const centerIz = cellIndex(cz, cellSize);
    const cellRadius = radius === 0 ? 0 : Math.ceil(radius / cellSize);

    const matches: StoredEntry<T>[] = [];
    for (let iz = centerIz - cellRadius; iz <= centerIz + cellRadius; iz += 1) {
      for (
        let iy = centerIy - cellRadius;
        iy <= centerIy + cellRadius;
        iy += 1
      ) {
        for (
          let ix = centerIx - cellRadius;
          ix <= centerIx + cellRadius;
          ix += 1
        ) {
          const bucket = this.#buckets.get(cellKey(ix, iy, iz));
          if (bucket === undefined) {
            continue;
          }
          for (let i = 0; i < bucket.length; i += 1) {
            const key = bucket[i];
            if (key === excludeKey) {
              continue;
            }
            const entry = this.#entries.get(key);
            if (entry === undefined) {
              continue;
            }
            const dx = entry.x - cx;
            const dy = entry.y - cy;
            const dz = entry.z - cz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq <= radiusSq) {
              matches.push(entry);
            }
          }
        }
      }
    }

    matches.sort((a, b) => a.order - b.order);
    for (let i = 0; i < matches.length; i += 1) {
      out.push(matches[i].key);
    }
    return out;
  }

  #bucketFor(entry: StoredEntry<T>): number[] {
    const ix = cellIndex(entry.x, this.cellSize);
    const iy = cellIndex(entry.y, this.cellSize);
    const iz = cellIndex(entry.z, this.cellSize);
    const key = cellKey(ix, iy, iz);
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.#buckets.set(key, bucket);
    }
    return bucket;
  }

  #addToBucket(entry: StoredEntry<T>): void {
    this.#bucketFor(entry).push(entry.key);
  }

  #removeFromBucket(entry: StoredEntry<T>): void {
    const ix = cellIndex(entry.x, this.cellSize);
    const iy = cellIndex(entry.y, this.cellSize);
    const iz = cellIndex(entry.z, this.cellSize);
    const bucket = this.#buckets.get(cellKey(ix, iy, iz));
    if (bucket === undefined) {
      return;
    }
    const index = bucket.indexOf(entry.key);
    if (index === -1) {
      return;
    }
    const last = bucket.length - 1;
    if (index !== last) {
      bucket[index] = bucket[last];
    }
    bucket.length = last;
  }
}
