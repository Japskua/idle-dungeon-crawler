/**
 * One entity per tile, always. Heroes swap with idle allies, shoo neutrals
 * aside, and bump-attack hostiles — but two living things never share a cell.
 */
import { describe, expect, test } from 'bun:test';
import type { GameEvent } from '../types';
import { newGame } from '../newGame';
import { advanceTick } from './runtime';
import { makeHero } from '../hero/create';

const NOW = 1_750_000_000_000;

function fourHeroGame(seed: number) {
  const state = newGame(seed, NOW);
  for (const cls of ['ranger', 'mage']) {
    const hero = makeHero(state, cls, `extra_${cls}`, 1, []);
    state.roster[hero.id] = hero;
    state.rosterOrder.push(hero.id);
  }
  const events: GameEvent[] = [];
  advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
  return state;
}

function occupiedCells(state: ReturnType<typeof newGame>): { key: string; who: string }[] {
  const run = state.run!;
  const out: { key: string; who: string }[] = [];
  for (const id of run.party.memberIds) {
    if (id in run.party.downed) continue;
    const p = run.party.pos[id]!;
    out.push({ key: `${p.x},${p.y}`, who: `hero ${id}` });
  }
  for (const mid of run.monsterOrder) {
    const m = run.monsters[mid]!;
    if (m.hp <= 0) continue;
    out.push({ key: `${m.pos.x},${m.pos.y}`, who: `${m.defId} ${mid}` });
  }
  return out;
}

describe('one entity per tile', () => {
  test('a full party spawns on distinct tiles', () => {
    const state = fourHeroGame(41);
    const cells = occupiedCells(state);
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
  });

  test('no two living entities ever share a tile across a whole run (2 seeds x 6000 ticks)', () => {
    for (const seed of [41, 137]) {
      const state = fourHeroGame(seed);
      for (let i = 0; i < 6000 && state.run; i++) {
        advanceTick(state, [], NOW, []);
        if (!state.run) break;
        const cells = occupiedCells(state);
        const seen = new Map<string, string>();
        for (const c of cells) {
          const prior = seen.get(c.key);
          if (prior) {
            throw new Error(`tick ${i} (seed ${seed}): ${c.who} stacked on ${prior} at ${c.key}`);
          }
          seen.set(c.key, c.who);
        }
      }
      expect(true).toBe(true);
    }
  });

  test('the party still makes progress with collision rules on (no new deadlocks)', () => {
    const state = fourHeroGame(53);
    let descended = false;
    let ended = false;
    for (let i = 0; i < 120_000 && !ended; i++) {
      const events: GameEvent[] = [];
      advanceTick(state, [], NOW, events);
      for (const e of events) {
        if (e.t === 'descend' && e.depth > 1) descended = true;
        if (e.t === 'runEnded') ended = true;
      }
    }
    expect(descended).toBe(true);
    expect(ended).toBe(true); // the run resolves — nobody is wedged in a doorway forever
  });
});
