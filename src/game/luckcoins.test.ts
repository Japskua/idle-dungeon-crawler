import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeHero } from './hero/create';
import { monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

function gamblerRun(seed: number, level = 6) {
  const state = newGame(seed, NOW);
  const hero = makeHero(state, 'gambler', 'Lucky', level, [], [], 'human');
  state.roster[hero.id] = hero;
  state.rosterOrder.push(hero.id);
  state.village.potions.hp = 0;
  advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
  return { state, hero };
}

function injectHostile(state: ReturnType<typeof newGame>, defId: string, pos: { x: number; y: number }, hp = 9999): MonsterInstance {
  const { MONSTERS } = require('./content');
  const def = MONSTERS[defId]!;
  const m: MonsterInstance = {
    id: 'foe1', defId, level: 1, elite: false, hp: hp || monsterMaxHp(def.base.hp, 1, false, false),
    pos: { ...pos }, move: null, targetId: null, aggro: true, packId: 555, action: null, statuses: [], cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

describe('gambler luck coins', () => {
  test('a gambler starts a floor with exactly one coin', () => {
    const { hero } = gamblerRun(3);
    expect(hero.luckCoins).toBe(1);
  });

  test('coins are spent and earned as the gambler flips (bounded 0..3)', () => {
    const { state, hero } = gamblerRun(8);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    injectHostile(state, 'zombie', { x: hp.x + 1, y: hp.y });

    let heads = 0;
    let tails = 0;
    const seenCoins = new Set<number>();
    for (let i = 0; i < 1200; i++) {
      const ev: GameEvent[] = [];
      hero.mp = 50; // never run dry; let cooldowns flow so flip skills actually fire
      advanceTick(state, [], NOW, ev);
      for (const e of ev) if (e.t === 'coinFlip') (e.heads ? heads++ : tails++);
      seenCoins.add(hero.luckCoins);
      const foe = run.monsters['foe1'];
      if (foe) foe.hp = 9999; // immortal sparring partner
    }
    expect(heads + tails).toBeGreaterThan(5); // it actually flipped
    expect(hero.luckCoins).toBeGreaterThanOrEqual(0);
    expect(hero.luckCoins).toBeLessThanOrEqual(3); // never exceeds the cap
    expect(Math.max(...seenCoins)).toBeGreaterThan(1); // a streak built past the starting coin
  });

  test('descending the stairs resets the coin streak to one', () => {
    const { state, hero } = gamblerRun(8);
    hero.luckCoins = 3; // pretend a hot streak
    const { enterFloor } = require('./run/lifecycle');
    enterFloor(state, state.run!, state.run!.depth + 1, []);
    expect(hero.luckCoins).toBe(1);
  });

  test('Jackpot with three coins is a guaranteed Heads (forces the big payout)', () => {
    // headsChance = 0.5 + 0.25*3 = 1.25 -> clamped to 1 -> every jackpot is Heads
    const { state, hero } = gamblerRun(2);
    hero.tactics.activeSetId = 'aggressive'; // the "High Roller" set leads with Jackpot
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    injectHostile(state, 'zombie', { x: hp.x + 1, y: hp.y });

    let jackpots = 0;
    let jackpotTails = 0;
    for (let i = 0; i < 2500; i++) {
      hero.mp = 50;
      hero.luckCoins = 3; // refill to a full purse before every cast
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      for (const e of ev) {
        if (e.t === 'coinFlip' && e.skillId === 'jackpot') {
          jackpots++;
          if (!e.heads) jackpotTails++;
        }
      }
      const foe = run.monsters['foe1'];
      if (foe) foe.hp = 9999;
    }
    expect(jackpots).toBeGreaterThan(0); // jackpot actually fired
    expect(jackpotTails).toBe(0); // ...and a 3-coin jackpot never busts
  });
});
