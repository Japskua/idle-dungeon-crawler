import { describe, expect, test } from 'bun:test';
import { TILE } from '../types';
import { generateFloor } from './generate';
import { astarTo, bfsDistances, idx } from './pathfind';
import { creatureDef } from '../content';

const DEPTHS = [1, 2, 5, 7, 10, 25];
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 13);

describe('procgen invariants', () => {
  test('floors are connected, traversable, and populated (40 seeds x 6 depths)', () => {
    for (const seed of SEEDS) {
      for (const depth of DEPTHS) {
        const { floor, monsters } = generateFloor(seed, depth);

        // at least 5 rooms, entrance != stairs
        expect(floor.rooms.length).toBeGreaterThanOrEqual(5);
        expect(floor.entrance).not.toEqual(floor.stairs);

        // all walkable tiles are one flood-fill component (reachable from entrance)
        const dist = bfsDistances(floor, floor.entrance);
        let walkable = 0;
        let reached = 0;
        for (let i = 0; i < floor.tiles.length; i++) {
          if (floor.tiles[i] !== TILE.WALL) {
            walkable++;
            if (dist[i] !== -1) reached++;
          }
        }
        expect(reached).toBe(walkable);

        // a path entrance -> stairs exists
        expect(astarTo(floor, floor.entrance, floor.stairs)).not.toBeNull();

        // monsters spawn on walkable tiles, never in the entrance room
        const entranceRoom = floor.rooms[0]!;
        for (const m of monsters) {
          expect(floor.tiles[idx(floor, m.pos.x, m.pos.y)]).not.toBe(TILE.WALL);
          const inEntrance =
            m.pos.x >= entranceRoom.x &&
            m.pos.x < entranceRoom.x + entranceRoom.w &&
            m.pos.y >= entranceRoom.y &&
            m.pos.y < entranceRoom.y + entranceRoom.h;
          expect(inEntrance).toBe(false);
        }

        // hostiles exist on every floor
        const hostiles = monsters.filter((m) => creatureDef(m.defId).disposition === 'hostile');
        expect(hostiles.length).toBeGreaterThan(0);

        // chests exist and sit on walkable tiles
        expect(floor.chests.length).toBeGreaterThanOrEqual(1);
        for (const chest of floor.chests) {
          expect(floor.tiles[idx(floor, chest.pos.x, chest.pos.y)]).not.toBe(TILE.WALL);
        }
      }
    }
  });

  test('generation is a pure function of (seed, depth)', () => {
    const a = generateFloor(12345, 3);
    const b = generateFloor(12345, 3);
    expect(JSON.stringify(a.floor.tiles)).toBe(JSON.stringify(b.floor.tiles));
    expect(JSON.stringify(a.monsters)).toBe(JSON.stringify(b.monsters));
  });

  test('monster levels follow the depth-centered distribution', () => {
    const levels: number[] = [];
    for (const seed of SEEDS) {
      const { monsters } = generateFloor(seed, 10);
      for (const m of monsters) {
        const def = creatureDef(m.defId);
        if (def.disposition !== 'hostile' || m.elite) continue;
        const spread = def.level.spread;
        expect(m.level).toBeGreaterThanOrEqual(10 + def.level.offset - spread);
        expect(m.level).toBeLessThanOrEqual(10 + def.level.offset + spread);
        levels.push(m.level);
      }
    }
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    expect(Math.abs(avg - 10)).toBeLessThan(0.5);
  });

  test('the same monster spawns at very different levels by depth', () => {
    const shallow = generateFloor(1, 2).monsters.filter((m) => m.defId === 'skeleton' && !m.elite);
    const deep = generateFloor(1, 14).monsters.filter((m) => m.defId === 'skeleton' && !m.elite);
    if (shallow.length > 0 && deep.length > 0) {
      expect(Math.max(...shallow.map((m) => m.level))).toBeLessThan(Math.min(...deep.map((m) => m.level)));
      expect(deep[0]!.hp).toBeGreaterThan(shallow[0]!.hp * 3);
    }
  });
});
