/** Fresh profile: a village, some gold, two volunteers, and a hole in the ground. */
import type { GameState } from './types';
import { hash2, makeRng } from './core/rng';
import { STARTING_GOLD } from './balance';
import { makeHero, generateName } from './hero/create';
import { dayIndexFor } from './village/shop';

export const SAVE_VERSION = 1;

export function newGame(seed: number, nowMs: number): GameState {
  const state: GameState = {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    tick: 0,
    savedAtMs: nowMs,
    nextId: 1,
    rng: {
      combat: makeRng(hash2(seed, 0xc0)),
      loot: makeRng(hash2(seed, 0x10)),
      village: makeRng(hash2(seed, 0x71)),
    },
    mode: 'village',
    village: {
      gold: STARTING_GOLD,
      inventory: [],
      potions: { hp: 2, mp: 0 },
      bombs: 0,
      chores: {},
      lastChoreAccrualMs: nowMs,
      purchasedToday: [],
      hiredToday: [],
      dayIndex: dayIndexFor(nowMs),
    },
    roster: {},
    rosterOrder: [],
    run: null,
    progress: {
      maxDepthReached: 0,
      bossesSlain: [],
      checkpoints: [],
      totalWipes: 0,
      totalPermadeaths: 0,
      runsCompleted: 0,
    },
    chronicle: [],
  };

  // the founding duo: a knight to get hit and a cleric to complain about it
  const knight = makeHero(state, 'knight', generateName(state.rng.village));
  const cleric = makeHero(state, 'cleric', generateName(state.rng.village));
  for (const hero of [knight, cleric]) {
    state.roster[hero.id] = hero;
    state.rosterOrder.push(hero.id);
  }
  state.chronicle.push({
    atMs: nowMs,
    text: `${knight.name} and ${cleric.name} arrive at the village above the dungeon, broke and optimistic.`,
  });
  return state;
}
