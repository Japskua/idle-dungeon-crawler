import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance, TacticRule, TacticSet } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { enterFloor } from './run/lifecycle';
import { makeHero } from './hero/create';
import { derive } from './hero/derive';
import { evaluate, type BattleView } from './tactics/evaluator';
import { MONSTERS } from './content';
import { monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

function priestRun(seed: number, level = 6) {
  const state = newGame(seed, NOW);
  const hero = makeHero(state, 'priest', 'Father Test', level, [], [], 'human');
  state.roster[hero.id] = hero;
  state.rosterOrder.push(hero.id);
  state.village.potions.hp = 0;
  advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
  return { state, hero };
}

function inject(state: ReturnType<typeof newGame>, defId: string, pos: { x: number; y: number }, hp?: number): MonsterInstance {
  const def = MONSTERS[defId]!;
  const m: MonsterInstance = {
    id: 'foe1', defId, level: 1, elite: false, hp: hp ?? monsterMaxHp(def.base.hp, 1, false, false),
    pos: { ...pos }, move: null, targetId: null, aggro: true, packId: 555, action: null, statuses: [], cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
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

describe('priest devotion & state of grace', () => {
  test('a priest carries 20 devotion into each floor', () => {
    const { state, hero } = priestRun(3);
    hero.devotion = 88; // pretend a holy run
    enterFloor(state, state.run!, state.run!.depth + 1, []);
    expect(hero.devotion).toBe(20);
  });

  test('Divine Intervention is gated behind 70 devotion', () => {
    const { hero } = priestRun(4);
    const v = view({
      enemies: [{ id: 'm1', level: 1, dist2: 4, adjacent: false, isBoss: false, isElite: false }],
      allies: [{ id: hero.id, hpFrac: 1, dist2: 0 }, { id: 'a2', hpFrac: 0.3, dist2: 4 }],
    });
    hero.devotion = 50;
    expect(evaluate(hero, derive(hero), v, oneRule('divine_intervention'))).toBeNull(); // not enough faith
    hero.devotion = 80;
    expect(evaluate(hero, derive(hero), v, oneRule('divine_intervention'))).not.toBeNull(); // the miracle fires
  });

  test('State of Grace lets a priest heal with an empty mana pool', () => {
    const { hero } = priestRun(4);
    hero.mp = 0;
    const v = view({
      enemies: [{ id: 'm1', level: 1, dist2: 9, adjacent: false, isBoss: false, isElite: false }],
      allies: [{ id: hero.id, hpFrac: 1, dist2: 0 }, { id: 'a2', hpFrac: 0.4, dist2: 4 }],
    });
    hero.devotion = 40;
    expect(evaluate(hero, derive(hero), v, oneRule('sanctify'))).toBeNull(); // no mana, no grace
    hero.devotion = 80;
    expect(evaluate(hero, derive(hero), v, oneRule('sanctify'))).not.toBeNull(); // grace channels it free
  });

  test('smiting an unclean foe to death feeds the priest’s faith', () => {
    const { state, hero } = priestRun(7);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const hp = run.party.pos[hero.id]!;
    hero.devotion = 30;
    const before = hero.devotion;
    inject(state, 'skeleton', { x: hp.x + 3, y: hp.y }, 1); // an undead at death's door, in Judgment range

    let killed = false;
    for (let i = 0; i < 400 && !killed; i++) {
      hero.mp = 50;
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      if (ev.some((e) => e.t === 'monsterDied')) killed = true;
    }
    expect(killed).toBe(true);
    // +4 from the smite kill (piety/decay are small over a few hundred ticks, but the kill bonus lands)
    expect(hero.devotion).toBeGreaterThan(before);
  });

  test('devotion decays when the priest is out of combat', () => {
    const { state, hero } = priestRun(9);
    state.run!.monsters = {}; // no enemies → out of combat
    state.run!.monsterOrder = [];
    hero.devotion = 60;
    for (let i = 0; i < 120; i++) advanceTick(state, [], NOW, []);
    expect(hero.devotion).toBeLessThan(60);
  });
});
