/** Insertion-ordered directed waypoint A* (RFC 0007). No callbacks during search. */
import { FourError } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import {
  freezePlannedPath,
  validatePathQuery,
  type PathPlannerAdapter,
  type PathPlannerCapabilities,
  type PathQuery,
  type PlannedPath,
} from "./path-planning.js";
/** Heuristic weight in [0, 1]; zero selects Dijkstra. */
export interface WaypointGraphOptions {
  readonly heuristicWeight?: number;
}
interface Edge {
  to: number;
  cost: number;
}
interface Entry {
  node: number;
  g: number;
  f: number;
  order: number;
}
function before(a: Entry, b: Entry): boolean {
  return a.f < b.f || (a.f === b.f && a.order < b.order);
}
function distance(a: Vector3, b: Vector3): number {
  const value = a.distanceTo(b);
  if (!Number.isFinite(value))
    throw new RangeError("Waypoint distance exceeds finite precision (§85).");
  return value;
}
/** A binary heap with an explicit insertion sequence tie-break. */
class Heap {
  readonly entries: Entry[] = [];
  push(value: Entry): void {
    let i = this.entries.length;
    this.entries.push(value);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!before(value, this.entries[parent])) break;
      this.entries[i] = this.entries[parent]!;
      i = parent;
    }
    this.entries[i] = value;
  }
  pop(): Entry {
    const result = this.entries[0],
      last = this.entries.pop()!;
    if (this.entries.length > 0) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.entries.length &&
          before(this.entries[child + 1], this.entries[child])
        )
          child++;
        if (!before(this.entries[child], last)) break;
        this.entries[i] = this.entries[child]!;
        i = child;
      }
      this.entries[i] = last;
    }
    return result;
  }
}
/** Nearest-node snapping followed by optimal A*, with insertion-order ties. */
export class WaypointGraphPlanner implements PathPlannerAdapter {
  readonly name = "fourJS:waypoint-graph";
  readonly version = "0.1.0";
  readonly capabilities: PathPlannerCapabilities = Object.freeze({
    families: ["waypoint"] as const,
    dimensions: ["2d", "3d"] as const,
    determinism: "same-runtime",
  });
  readonly #nodes: Vector3[] = [];
  readonly #edges: Edge[][] = [];
  readonly #weight: number;
  #scale = 1;
  #disposed = false;
  constructor(options: WaypointGraphOptions = {}) {
    this.#weight = options.heuristicWeight ?? 1;
    if (!Number.isFinite(this.#weight) || this.#weight < 0 || this.#weight > 1)
      throw new RangeError("heuristicWeight must be in [0, 1] (§85).");
  }
  /** Copy a point and return its stable insertion index. */
  addNode(position: Vector3): number {
    this.#assertLive();
    validatePathQuery({ start: position, goal: position });
    this.#nodes.push(position.clone());
    this.#edges.push([]);
    return this.#nodes.length - 1;
  }
  /** Add a directed edge. Arbitrary non-negative costs remain admissible. */
  addEdge(from: number, to: number, cost?: number): void {
    this.#assertLive();
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < 0 ||
      from >= this.#nodes.length ||
      to >= this.#nodes.length
    )
      throw new RangeError("Edge indices must name existing nodes (§85).");
    const length = distance(this.#nodes[from], this.#nodes[to]);
    const value = cost ?? length;
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Edge cost must be finite and non-negative (§85).");
    // Euclidean distance alone overestimates cheap authored edges. This global
    // lower cost-per-distance bound preserves A* optimality, including zero costs.
    if (length > 0) this.#scale = Math.min(this.#scale, value / length);
    this.#edges[from].push({ to, cost: value });
  }
  plan(query: PathQuery): PlannedPath | null {
    validatePathQuery(query);
    this.#assertLive();
    const start = this.#nearest(query.start),
      goal = this.#nearest(query.goal);
    if (start === goal) return null;
    const scores = new Float64Array(this.#nodes.length).fill(Infinity);
    const parents = new Int32Array(this.#nodes.length).fill(-1);
    const heap = new Heap();
    let order = 0,
      pops = 0;
    const heuristic = (node: number): number =>
      this.#weight *
      this.#scale *
      distance(this.#nodes[node], this.#nodes[goal]);
    scores[start] = 0;
    heap.push({ node: start, g: 0, f: heuristic(start), order: order++ });
    while (heap.entries.length > 0) {
      if (pops++ >= (query.maxExpansions ?? Infinity)) return null;
      const entry = heap.pop();
      if (entry.g !== scores[entry.node]) continue;
      if (entry.node === goal) {
        const points: Vector3[] = [];
        let node = goal;
        while (node !== -1) {
          points.push(this.#nodes[node]);
          node = parents[node]!;
        }
        points.reverse();
        return freezePlannedPath(this.name, entry.g, points);
      }
      for (const edge of this.#edges[entry.node]) {
        const g = entry.g + edge.cost;
        if (g < scores[edge.to]) {
          scores[edge.to] = g;
          parents[edge.to] = entry.node;
          heap.push({
            node: edge.to,
            g,
            f: g + heuristic(edge.to),
            order: order++,
          });
        }
      }
    }
    return null;
  }
  dispose(): void {
    this.#disposed = true;
    this.#nodes.length = 0;
    this.#edges.length = 0;
  }
  #assertLive(): void {
    if (this.#disposed)
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Waypoint planner is disposed.",
      );
  }
  #nearest(point: Vector3): number {
    let best = -1,
      nearest = Infinity;
    for (let i = 0; i < this.#nodes.length; i++) {
      const d = distance(point, this.#nodes[i]);
      if (d < nearest) {
        nearest = d;
        best = i;
      }
    }
    return best;
  }
}
