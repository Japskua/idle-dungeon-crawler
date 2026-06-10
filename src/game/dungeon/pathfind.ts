/**
 * Grid pathfinding on a Floor. Everything here is deterministic: fixed
 * neighbor order, stable tie-breaking by insertion order in the open heap.
 */
import { TILE, type Floor, type Vec2 } from '../types';

/** Fixed neighbor order (E, W, S, N) — part of the determinism contract. */
export const DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function idx(floor: Floor, x: number, y: number): number {
  return y * floor.w + x;
}

export function inBounds(floor: Floor, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < floor.w && y < floor.h;
}

export function isPassable(floor: Floor, x: number, y: number): boolean {
  return inBounds(floor, x, y) && floor.tiles[idx(floor, x, y)] !== TILE.WALL;
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function euclid2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** BFS distances from a source over passable tiles. -1 = unreachable. */
export function bfsDistances(floor: Floor, from: Vec2): Int32Array {
  const dist = new Int32Array(floor.w * floor.h).fill(-1);
  const queue: number[] = [idx(floor, from.x, from.y)];
  dist[queue[0]!] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const cx = cur % floor.w;
    const cy = (cur - cx) / floor.w;
    const d = dist[cur]!;
    for (const dir of DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!isPassable(floor, nx, ny)) continue;
      const ni = idx(floor, nx, ny);
      if (dist[ni] === -1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

/** Step from `pos` along decreasing distance in a BFS field (flow field). */
export function flowStep(floor: Floor, field: Int32Array, pos: Vec2): Vec2 | null {
  const here = field[idx(floor, pos.x, pos.y)]!;
  if (here <= 0) return null;
  for (const dir of DIRS) {
    const nx = pos.x + dir.x;
    const ny = pos.y + dir.y;
    if (!inBounds(floor, nx, ny)) continue;
    const d = field[idx(floor, nx, ny)]!;
    if (d !== -1 && d < here) return { x: nx, y: ny };
  }
  return null;
}

interface HeapNode {
  i: number;
  f: number;
  order: number;
}

class MinHeap {
  private a: HeapNode[] = [];
  private counter = 0;
  push(i: number, f: number) {
    const n = { i, f, order: this.counter++ };
    const a = this.a;
    a.push(n);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.less(a[c]!, a[p]!)) {
        const tmp = a[c]!;
        a[c] = a[p]!;
        a[p] = tmp;
        c = p;
      } else break;
    }
  }
  pop(): HeapNode | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < a.length && this.less(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!)) m = r;
        if (m === c) break;
        const tmp = a[c]!;
        a[c] = a[m]!;
        a[m] = tmp;
        c = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
  private less(x: HeapNode, y: HeapNode): boolean {
    return x.f !== y.f ? x.f < y.f : x.order < y.order;
  }
}

/**
 * A* from start to a goal predicate. Returns the path as tile steps
 * (excluding start, ending at the first goal tile), or null.
 * `blocked` marks tiles that cannot be entered (occupied by other entities);
 * goal tiles are exempt from `blocked`.
 */
export function astar(
  floor: Floor,
  start: Vec2,
  goalHeuristicTarget: Vec2,
  isGoal: (x: number, y: number) => boolean,
  blocked?: (x: number, y: number) => boolean,
  maxExpansions = 4000,
): Vec2[] | null {
  if (isGoal(start.x, start.y)) return [];
  const W = floor.w;
  const came = new Int32Array(W * floor.h).fill(-1);
  const g = new Int32Array(W * floor.h).fill(-1);
  const startI = idx(floor, start.x, start.y);
  g[startI] = 0;
  const open = new MinHeap();
  open.push(startI, manhattan(start, goalHeuristicTarget));
  let expansions = 0;
  while (open.size > 0 && expansions < maxExpansions) {
    const node = open.pop()!;
    const cur = node.i;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    expansions++;
    if (isGoal(cx, cy)) {
      const path: Vec2[] = [];
      let i = cur;
      while (i !== startI) {
        const x = i % W;
        const y = (i - x) / W;
        path.push({ x, y });
        i = came[i]!;
      }
      path.reverse();
      return path;
    }
    for (const dir of DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (!isPassable(floor, nx, ny)) continue;
      if (blocked && blocked(nx, ny) && !isGoal(nx, ny)) continue;
      const ni = idx(floor, nx, ny);
      const ng = g[cur]! + 1;
      if (g[ni] === -1 || ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + Math.abs(nx - goalHeuristicTarget.x) + Math.abs(ny - goalHeuristicTarget.y));
      }
    }
  }
  return null;
}

/** A* to the exact tile. */
export function astarTo(floor: Floor, start: Vec2, goal: Vec2, blocked?: (x: number, y: number) => boolean): Vec2[] | null {
  return astar(floor, start, goal, (x, y) => x === goal.x && y === goal.y, blocked);
}

/** A* to any tile adjacent (4-dir) to `goal` — for melee approach. */
export function astarAdjacent(floor: Floor, start: Vec2, goal: Vec2, blocked?: (x: number, y: number) => boolean): Vec2[] | null {
  return astar(
    floor,
    start,
    goal,
    (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y) === 1,
    blocked,
  );
}
