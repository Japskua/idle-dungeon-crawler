/**
 * Procedural floor generation: scattered rooms connected by an MST of L-shaped
 * corridors (+15% loop edges). Pure function of (runSeed, depth) — the same
 * floor always generates identically, independent of combat history.
 */
import { TILE, type Chest, type Floor, type MonsterInstance, type Room, type Vec2 } from '../types';
import { chance, hash2, makeRng, pickWeighted, randInt, rand, triangularInt, type Rng } from '../core/rng';
import {
  BOSS_EVERY,
  CHESTS_PER_FLOOR,
  ELITE_LEVEL_BONUS,
  EXTRA_EDGE_CHANCE,
  FLOOR_H,
  FLOOR_W,
  NEUTRALS_PER_FLOOR,
  PACK_SIZE,
  ROOM_COUNT,
  ROOM_H,
  ROOM_TRIES,
  ROOM_W,
  eliteChance,
  monsterMaxHp,
  packCount,
} from '../balance';
import { MONSTERS, NEUTRALS } from '../content';
import { bfsDistances, idx } from './pathfind';

export interface GeneratedFloor {
  floor: Floor;
  monsters: MonsterInstance[];
}

function roomCenter(r: Room): Vec2 {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    b.x - margin < a.x + a.w &&
    a.y - margin < b.y + b.h &&
    b.y - margin < a.y + a.h
  );
}

function carveRoom(tiles: Uint8Array, w: number, room: Room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      tiles[y * w + x] = TILE.FLOOR;
    }
  }
}

function carveCorridor(tiles: Uint8Array, w: number, from: Vec2, to: Vec2, horizontalFirst: boolean) {
  let { x, y } = from;
  const stepX = () => {
    while (x !== to.x) {
      x += Math.sign(to.x - x);
      if (tiles[y * w + x] === TILE.WALL) tiles[y * w + x] = TILE.FLOOR;
    }
  };
  const stepY = () => {
    while (y !== to.y) {
      y += Math.sign(to.y - y);
      if (tiles[y * w + x] === TILE.WALL) tiles[y * w + x] = TILE.FLOOR;
    }
  };
  if (horizontalFirst) {
    stepX();
    stepY();
  } else {
    stepY();
    stepX();
  }
}

/** mark corridor tiles sitting on a room's wall ring as doors (cosmetic) */
function markDoors(tiles: Uint8Array, w: number, h: number, rooms: Room[]) {
  for (const room of rooms) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      for (const y of [room.y - 1, room.y + room.h]) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (tiles[y * w + x] === TILE.FLOOR && !insideAnyRoom(rooms, x, y)) {
          tiles[y * w + x] = TILE.DOOR;
        }
      }
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      for (const x of [room.x - 1, room.x + room.w]) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (tiles[y * w + x] === TILE.FLOOR && !insideAnyRoom(rooms, x, y)) {
          tiles[y * w + x] = TILE.DOOR;
        }
      }
    }
  }
}

export function insideAnyRoom(rooms: Room[], x: number, y: number): number | -1 {
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]!;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}

export function generateFloor(runSeed: number, depth: number): GeneratedFloor {
  const rng = makeRng(hash2(runSeed, depth));
  const w = FLOOR_W;
  const h = FLOOR_H;

  // --- rooms ---
  let rooms: Room[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    rooms = [];
    const target = randInt(rng, ROOM_COUNT[0], ROOM_COUNT[1]);
    for (let i = 0; i < ROOM_TRIES && rooms.length < target; i++) {
      const rw = randInt(rng, ROOM_W[0], ROOM_W[1]);
      const rh = randInt(rng, ROOM_H[0], ROOM_H[1]);
      const room: Room = {
        x: randInt(rng, 1, w - rw - 2),
        y: randInt(rng, 1, h - rh - 2),
        w: rw,
        h: rh,
      };
      if (rooms.every((other) => !overlaps(room, other, 2))) rooms.push(room);
    }
    if (rooms.length >= 5) break;
  }

  const tiles = new Uint8Array(w * h).fill(TILE.WALL);
  for (const room of rooms) carveRoom(tiles, w, room);

  // --- connect: Prim's MST over room centers + a few loop edges ---
  const centers = rooms.map(roomCenter);
  const edges: [number, number][] = [];
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of connected) {
      for (let b = 0; b < rooms.length; b++) {
        if (connected.has(b)) continue;
        const d =
          Math.abs(centers[a]!.x - centers[b]!.x) + Math.abs(centers[a]!.y - centers[b]!.y);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    edges.push(best!);
    connected.add(best![1]);
  }
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      const already = edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (!already && chance(rng, EXTRA_EDGE_CHANCE)) edges.push([a, b]);
    }
  }
  for (const [a, b] of edges) {
    carveCorridor(tiles, w, centers[a]!, centers[b]!, chance(rng, 0.5));
  }
  markDoors(tiles, w, h, rooms);

  const roomGraph: number[][] = rooms.map(() => []);
  for (const [a, b] of edges) {
    roomGraph[a]!.push(b);
    roomGraph[b]!.push(a);
  }

  // --- entrance & stairs: stairs in the room farthest (by graph BFS) from room 0 ---
  const graphDist = new Array<number>(rooms.length).fill(-1);
  graphDist[0] = 0;
  const q = [0];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of roomGraph[cur]!) {
      if (graphDist[nb] === -1) {
        graphDist[nb] = graphDist[cur]! + 1;
        q.push(nb);
      }
    }
  }
  let stairsRoom = 0;
  for (let i = 1; i < rooms.length; i++) {
    if (graphDist[i]! > graphDist[stairsRoom]!) stairsRoom = i;
  }
  const entrance = roomCenter(rooms[0]!);
  const stairs = roomCenter(rooms[stairsRoom]!);
  tiles[entrance.y * w + entrance.x] = TILE.ENTRANCE;
  tiles[stairs.y * w + stairs.x] = TILE.STAIRS_DOWN;

  // --- chests: prefer dead-end rooms (graph degree 1), never the entrance room ---
  const chestCount = randInt(rng, CHESTS_PER_FLOOR[0], CHESTS_PER_FLOOR[1]);
  const chestRooms = rooms
    .map((_, i) => i)
    .filter((i) => i !== 0)
    .sort((a, b) => roomGraph[a]!.length - roomGraph[b]!.length || a - b)
    .slice(0, chestCount);
  const chests: Chest[] = chestRooms.map((ri, n) => {
    const room = rooms[ri]!;
    const pos = {
      x: randInt(rng, room.x, room.x + room.w - 1),
      y: randInt(rng, room.y, room.y + room.h - 1),
    };
    return { id: `d${depth}c${n}`, pos, opened: false };
  });

  const floor: Floor = {
    depth,
    w,
    h,
    tiles,
    rooms,
    roomGraph,
    entrance,
    stairs,
    chests,
    explored: new Uint8Array(w * h),
    isBossFloor: depth % BOSS_EVERY === 0,
  };

  // --- monsters (same ephemeral rng => same floor always has the same inhabitants) ---
  const monsters = spawnCreatures(rng, floor, depth);

  // entrance room starts revealed
  revealRoom(floor, 0);

  return { floor, monsters };
}

export function revealRoom(floor: Floor, roomIndex: number) {
  const room = floor.rooms[roomIndex];
  if (!room) return;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (x >= 0 && y >= 0 && x < floor.w && y < floor.h) {
        floor.explored[y * floor.w + x] = 1;
      }
    }
  }
}

export function revealAround(floor: Floor, pos: Vec2, radius: number) {
  for (let y = pos.y - radius; y <= pos.y + radius; y++) {
    for (let x = pos.x - radius; x <= pos.x + radius; x++) {
      if (x >= 0 && y >= 0 && x < floor.w && y < floor.h) {
        floor.explored[y * floor.w + x] = 1;
      }
    }
  }
}

function spawnCreatures(rng: Rng, floor: Floor, depth: number): MonsterInstance[] {
  const out: MonsterInstance[] = [];
  const occupied = new Set<number>();
  let packId = 0;
  let n = 0;

  const hostileTable = Object.values(MONSTERS)
    .map((def) => {
      const band = def.spawn.find((b) => b.depths[0] <= depth && depth <= b.depths[1]);
      return band ? { def, weight: band.weight } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.def.id.localeCompare(b.def.id));

  const make = (defId: string, level: number, elite: boolean, pos: Vec2, pack: number): MonsterInstance => {
    const def = MONSTERS[defId] ?? NEUTRALS[defId]!;
    return {
      id: `d${depth}m${n++}`,
      defId,
      level: Math.max(1, level),
      elite,
      hp: monsterMaxHp(def.base.hp, Math.max(1, level), elite, def.tier === 'boss'),
      pos,
      move: null,
      targetId: null,
      aggro: false,
      packId: pack,
      action: null,
      statuses: [],
      cooldowns: {},
    };
  };

  const freeCellIn = (roomIndex: number): Vec2 | null => {
    const room = floor.rooms[roomIndex]!;
    for (let tries = 0; tries < 30; tries++) {
      const pos = {
        x: randInt(rng, room.x, room.x + room.w - 1),
        y: randInt(rng, room.y, room.y + room.h - 1),
      };
      const i = idx(floor, pos.x, pos.y);
      const t = floor.tiles[i];
      if (t !== TILE.FLOOR) continue;
      if (occupied.has(i)) continue;
      if (floor.chests.some((c) => c.pos.x === pos.x && c.pos.y === pos.y)) continue;
      occupied.add(i);
      return pos;
    }
    return null;
  };

  if (hostileTable.length > 0) {
    for (let ri = 1; ri < floor.rooms.length; ri++) {
      const room = floor.rooms[ri]!;
      const packs = packCount(room.w * room.h);
      for (let p = 0; p < packs; p++) {
        const def = pickWeighted(rng, hostileTable, (e) => e.weight).def;
        const size = randInt(rng, PACK_SIZE[0], Math.min(PACK_SIZE[1], def.tier === 'minion' ? 4 : 3));
        packId++;
        for (let s = 0; s < size; s++) {
          const pos = freeCellIn(ri);
          if (!pos) break;
          const elite = chance(rng, eliteChance(depth));
          const level = triangularInt(rng, depth + def.level.offset, def.level.spread) + (elite ? ELITE_LEVEL_BONUS : 0);
          out.push(make(def.id, level, elite, pos, packId));
        }
      }
    }
  }

  // --- neutrals: small separate budget, anywhere but the entrance room ---
  const neutralTable = Object.values(NEUTRALS)
    .map((def) => {
      const band = def.spawn.find((b) => b.depths[0] <= depth && depth <= b.depths[1]);
      return band ? { def, weight: band.weight } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.def.id.localeCompare(b.def.id));

  if (neutralTable.length > 0) {
    const count = randInt(rng, NEUTRALS_PER_FLOOR[0], NEUTRALS_PER_FLOOR[1]);
    for (let i = 0; i < count; i++) {
      const def = pickWeighted(rng, neutralTable, (e) => e.weight).def;
      const ri = randInt(rng, 1, floor.rooms.length - 1);
      const pos = freeCellIn(ri);
      if (!pos) continue;
      packId++;
      const level = Math.max(1, depth + def.level.offset);
      out.push(make(def.id, level, false, pos, packId));
    }
  }

  return out;
}

/** exploration order: BFS over the room graph from the entrance room */
export function explorationOrder(floor: Floor): number[] {
  const order: number[] = [];
  const seen = new Set<number>([0]);
  const q = [0];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    const neighbors = [...floor.roomGraph[cur]!].sort((a, b) => a - b);
    for (const nb of neighbors) {
      if (!seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
    }
  }
  for (let i = 0; i < floor.rooms.length; i++) {
    if (!seen.has(i)) order.push(i);
  }
  return order;
}

export { bfsDistances };
