import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeHero } from './hero/create';
import { MONSTERS } from './content';
import { monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

function robberRun(seed: number, level = 7) {
  const state = newGame(seed, NOW);
  const hero = makeHero(state, 'grave_robber', 'Sticky', level, [], [], 'human');
  state.roster[hero.id] = hero;
  state.rosterOrder.push(hero.id);
  state.village.potions.hp = 0;
  advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
  return { state, hero };
}

function inject(state: ReturnType<typeof newGame>, pos: { x: number; y: number }, hp = 1): MonsterInstance {
  const def = MONSTERS['rat']!;
  const m: MonsterInstance = {
    id: `f${Object.keys(state.run!.monsters).length}`, defId: 'rat', level: 1, elite: false,
    hp: hp || monsterMaxHp(def.base.hp, 1, false, false), pos: { ...pos },
    move: null, targetId: null, aggro: true, packId: 1, action: null, statuses: [], cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

describe('grave robber greed', () => {
  test('greed starts at zero on embark, even if the hero hoarded before', () => {
    const state = newGame(3, NOW);
    const hero = makeHero(state, 'grave_robber', 'Sticky', 7, [], [], 'human');
    hero.greed = 7; // a leftover from a previous run
    state.roster[hero.id] = hero;
    state.rosterOrder.push(hero.id);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
    expect(hero.greed).toBe(0);
  });

  test('killing feeds greed, and it never exceeds ten', () => {
    const { state, hero } = robberRun(8);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    let lastGreed = 0;
    for (let i = 0; i < 2000; i++) {
      hero.mp = 50;
      if (Object.keys(run.monsters).length === 0) inject(state, { x: hp.x + 1, y: hp.y }, 1);
      advanceTick(state, [], NOW, []);
      lastGreed = hero.greed;
    }
    expect(lastGreed).toBeGreaterThan(0); // it built
    expect(lastGreed).toBeLessThanOrEqual(10); // ...but capped
  });

  test('Pocket It cashes every stack into the robber’s own purse and empties greed', () => {
    const { state, hero } = robberRun(5);
    hero.tactics.activeSetId = 'aggressive'; // the set that leads with Pocket It
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    inject(state, { x: hp.x + 1, y: hp.y }, 9999); // immortal so the fight (and casts) continue

    let pocketed: Extract<GameEvent, { t: 'pocketIt' }> | null = null;
    for (let i = 0; i < 2000 && !pocketed; i++) {
      hero.mp = 50;
      hero.greed = 6; // keep a full purse to spend
      const goldBefore = hero.gold;
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      const p = ev.find((e) => e.t === 'pocketIt');
      if (p && p.t === 'pocketIt') {
        pocketed = p;
        expect(p.stacks).toBe(6);
        expect(p.gold).toBeGreaterThanOrEqual(6 * 8); // 8-15 per stack
        expect(p.gold).toBeLessThanOrEqual(6 * 15);
        expect(hero.gold).toBe(goldBefore + p.gold);
        expect(hero.greed).toBe(0); // spent it all (before the test refills next tick)
      }
    }
    expect(pocketed).not.toBeNull();
  });

  test('a hoard of greed lifts the whole party’s gold-find (+3% per stack)', () => {
    const goldFromKill = (greed: number) => {
      const { state, hero } = robberRun(4);
      const run = state.run!;
      run.monsters = {};
      run.monsterOrder = [];
      const hp = run.party.pos[hero.id]!;
      inject(state, { x: hp.x + 1, y: hp.y }, 1);
      let gold = 0;
      for (let i = 0; i < 600 && gold === 0; i++) {
        hero.mp = 50;
        hero.greed = greed; // pin the hoard before the kill resolves
        const ev: GameEvent[] = [];
        advanceTick(state, [], NOW, ev);
        const d = ev.find((e) => e.t === 'monsterDied');
        if (d && d.t === 'monsterDied') gold = d.gold;
      }
      return gold;
    };
    const plain = goldFromKill(0);
    const greedy = goldFromKill(10); // +30%
    expect(plain).toBeGreaterThan(0);
    expect(greedy).toBeGreaterThan(plain);
  });
});
