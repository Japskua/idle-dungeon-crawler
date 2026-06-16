import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance, TacticRule, TacticSet } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeHero } from './hero/create';
import { derive } from './hero/derive';
import { evaluate, type BattleView } from './tactics/evaluator';
import { MONSTERS } from './content';
import { menagerieCap, monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

function summonerRun(seed: number, level = 8) {
  const state = newGame(seed, NOW);
  const hero = makeHero(state, 'summoner', 'Conjuro', level, [], [], 'human');
  state.roster[hero.id] = hero;
  state.rosterOrder.push(hero.id);
  state.village.potions.hp = 0;
  advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
  return { state, hero };
}

function addMinion(state: ReturnType<typeof newGame>, ownerId: string, id: string, cost: number): MonsterInstance {
  const def = MONSTERS['rat']!;
  const m: MonsterInstance = {
    id, defId: 'imp_minion', level: 4, elite: false, hp: monsterMaxHp(def.base.hp, 4, false, false),
    pos: { x: 5, y: 5 }, move: null, targetId: null, aggro: false, packId: 0, action: null,
    statuses: [], cooldowns: {}, summonedBy: ownerId, ttlTicks: 9999, summonCost: cost,
  };
  state.run!.monsters[id] = m;
  state.run!.monsterOrder.push(id);
  return m;
}

const view = (partial: Partial<BattleView>): BattleView => ({
  enemies: [], allies: [], downedAllies: [], selfHpFrac: 1, selfMpFrac: 1,
  carrying: false, withdrawing: false, myMinions: 0, myMinionCost: 0, corpseCount: 0, ...partial,
});
const oneRule = (skillId: string): TacticSet => ({
  id: 's', name: 's',
  rules: [{ id: 'r0', enabled: true, trigger: { k: 'always' }, action: { k: 'castSkill', skillId } } as TacticRule],
});

describe('summoner menagerie unleashed (frenzy)', () => {
  test('a summon at the normal cap is refused — unless the menagerie is unleashed', () => {
    const { hero } = summonerRun(3); // L8: normal cap 12, frenzy cap 20
    const v = view({
      enemies: [{ id: 'm1', level: 1, dist2: 9, adjacent: false, isBoss: false, isElite: false }],
      myMinionCost: menagerieCap(hero.level), // already full at the normal cap
    });
    hero.frenzyTicks = 0;
    expect(evaluate(hero, derive(hero), v, oneRule('conjure_imps'))).toBeNull(); // cap holds
    hero.frenzyTicks = 100;
    expect(evaluate(hero, derive(hero), v, oneRule('conjure_imps'))).not.toBeNull(); // over-summon allowed
  });

  test('Menagerie Unleashed opens the frenzy window', () => {
    const { state, hero } = summonerRun(5);
    hero.tactics.activeSetId = 'aggressive'; // "Open Every Cage" leads toward the unleash
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    for (let i = 0; i < 3; i++) {
      const def = MONSTERS['rat']!;
      const m: MonsterInstance = {
        id: `e${i}`, defId: 'rat', level: 1, elite: false, hp: 9999, pos: { x: hp.x + 2 + i, y: hp.y },
        move: null, targetId: null, aggro: true, packId: 7, action: null, statuses: [], cooldowns: {},
      };
      void def;
      run.monsters[m.id] = m;
      run.monsterOrder.push(m.id);
    }
    let frenzied = false;
    for (let i = 0; i < 1500 && !frenzied; i++) {
      hero.mp = 60;
      advanceTick(state, [], NOW, []);
      if (hero.frenzyTicks > 0) frenzied = true;
      for (let k = 0; k < 3; k++) { const e = run.monsters[`e${k}`]; if (e) e.hp = 9999; }
    }
    expect(frenzied).toBe(true);
  });

  test('when the frenzy ends, over-cap minions wink out (back to the normal cap)', () => {
    const { state, hero } = summonerRun(6); // L8 → normal cap 12
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    // pack the menagerie to 18 cost (over the normal 12), as if mid-frenzy
    addMinion(state, hero.id, 'mn1', 6);
    addMinion(state, hero.id, 'mn2', 6);
    addMinion(state, hero.id, 'mn3', 6);
    hero.frenzyTicks = 1; // about to expire

    advanceTick(state, [], NOW, []); // frenzyStep ticks it to 0 and culls

    const cost = run.monsterOrder
      .map((id) => run.monsters[id])
      .filter((m) => m && m.hp > 0 && m.summonedBy === hero.id)
      .reduce((s, m) => s + (m!.summonCost ?? 0), 0);
    expect(cost).toBeLessThanOrEqual(menagerieCap(hero.level)); // culled to the normal cap
    expect(cost).toBeGreaterThan(0); // ...but not wiped out entirely
  });
});
