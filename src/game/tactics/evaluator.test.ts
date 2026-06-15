/**
 * Table-driven tests pinning the evaluator semantics:
 * feasibility fall-through, defaults, withdraw filtering, deterministic targeting.
 */
import { describe, expect, test } from 'bun:test';
import { newGame } from '../newGame';
import { makeHero } from '../hero/create';
import { derive } from '../hero/derive';
import { defaultAction, evaluate, type BattleView } from './evaluator';
import type { Hero, TacticRule, TacticSet } from '../types';

const NOW = 1_750_000_000_000;

function hero(classId: string, mods?: (h: Hero) => void): { h: Hero; d: ReturnType<typeof derive> } {
  const state = newGame(5, NOW);
  const h = makeHero(state, classId, 'Testy', 5, []);
  mods?.(h);
  return { h, d: derive(h) };
}

function view(partial?: Partial<BattleView>): BattleView {
  return {
    enemies: [],
    allies: [],
    downedAllies: [],
    selfHpFrac: 1,
    selfMpFrac: 1,
    carrying: false,
    withdrawing: false,
    myMinions: 0,
    myMinionCost: 0,
    corpseCount: 0,
    ...partial,
  };
}

const enemy = (id: string, dist2 = 9, adjacent = false, level = 5, isElite = false, isBoss = false) => ({
  id,
  level,
  dist2,
  adjacent,
  isElite,
  isBoss,
});

let rid = 0;
const rule = (trigger: TacticRule['trigger'], action: TacticRule['action'], enabled = true): TacticRule => ({
  id: `t${rid++}`,
  enabled,
  trigger,
  action,
});
const set = (...rules: TacticRule[]): TacticSet => ({ id: 's', name: 'S', rules });

describe('tactics evaluator', () => {
  test('first matching feasible rule wins (priority order)', () => {
    const { h, d } = hero('knight');
    const v = view({ enemies: [enemy('m1', 1, true)], selfHpFrac: 0.2 });
    h.potions.hp = 2;
    const result = evaluate(h, d, v, set(
      rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
      rule({ k: 'always' }, { k: 'attack' }),
    ));
    expect(result).toEqual({ kind: 'potion', potion: 'hp' });
  });

  test('CRITICAL: trigger-true but infeasible action falls through (no-mana healer must not deadlock)', () => {
    const { h, d } = hero('cleric', (x) => {
      x.mp = 0;
    });
    const v = view({
      enemies: [enemy('m1', 4)],
      allies: [
        { id: h.id, hpFrac: 1, dist2: 0 },
        { id: 'ally2', hpFrac: 0.3, dist2: 4 },
      ],
    });
    const result = evaluate(h, derive(h), v, set(
      rule({ k: 'allyHpBelow', pct: 65 }, { k: 'castSkill', skillId: 'heal' }), // no mana -> skip
      rule({ k: 'always' }, { k: 'attack' }),
    ));
    expect(result).toEqual({ kind: 'attack', targetId: 'm1' });
    void d;
  });

  test('out-of-stock potion falls through', () => {
    const { h, d } = hero('knight', (x) => {
      x.potions.hp = 0;
    });
    const v = view({ enemies: [enemy('m1', 1, true)], selfHpFrac: 0.1 });
    const result = evaluate(h, d, v, set(
      rule({ k: 'selfHpBelow', pct: 50 }, { k: 'usePotion', potion: 'hp' }),
      rule({ k: 'always' }, { k: 'defend' }),
    ));
    expect(result).toEqual({ kind: 'defend' });
  });

  test('full-health potion rule is infeasible (no wasted bottles)', () => {
    const { h, d } = hero('knight', (x) => {
      x.potions.hp = 5;
    });
    const v = view({ selfHpFrac: 1 });
    const result = evaluate(h, d, v, set(rule({ k: 'always' }, { k: 'usePotion', potion: 'hp' })));
    expect(result).toBeNull();
  });

  test('disabled rules are skipped', () => {
    const { h, d } = hero('knight');
    const v = view({ enemies: [enemy('m1', 1, true)] });
    const result = evaluate(h, d, v, set(
      rule({ k: 'always' }, { k: 'defend' }, false),
      rule({ k: 'always' }, { k: 'attack' }),
    ));
    expect(result).toEqual({ kind: 'attack', targetId: 'm1' });
  });

  test('no rule matches -> null -> default attacks nearest', () => {
    const { h, d } = hero('knight');
    const v = view({ enemies: [enemy('far', 25), enemy('near', 4)] });
    expect(evaluate(h, d, v, set(rule({ k: 'selfHpBelow', pct: 10 }, { k: 'usePotion', potion: 'hp' })))).toBeNull();
    expect(defaultAction(v)).toEqual({ kind: 'attack', targetId: 'near' });
  });

  test('withdrawing: offensive skills are filtered, attack only adjacent', () => {
    const { h, d } = hero('mage');
    const vFar = view({ enemies: [enemy('m1', 16)], withdrawing: true });
    expect(
      evaluate(h, d, vFar, set(
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'fireball' }),
        rule({ k: 'always' }, { k: 'attack' }),
      )),
    ).toBeNull();
    const vAdj = view({ enemies: [enemy('m1', 1, true)], withdrawing: true });
    expect(evaluate(h, d, vAdj, set(rule({ k: 'always' }, { k: 'attack' })))).toEqual({
      kind: 'attack',
      targetId: 'm1',
    });
  });

  test('heal targets the lowest-hp ally, ties broken by id', () => {
    const { h, d } = hero('cleric');
    const v = view({
      allies: [
        { id: 'a2', hpFrac: 0.5, dist2: 1 },
        { id: 'a1', hpFrac: 0.5, dist2: 9 },
        { id: h.id, hpFrac: 1, dist2: 0 },
      ],
    });
    const result = evaluate(h, d, v, set(rule({ k: 'always' }, { k: 'castSkill', skillId: 'heal' })));
    expect(result).toEqual({ kind: 'cast', skillId: 'heal', targetId: 'a1' });
  });

  test('heal with everyone full is infeasible', () => {
    const { h, d } = hero('cleric');
    const v = view({ allies: [{ id: h.id, hpFrac: 1, dist2: 0 }, { id: 'a2', hpFrac: 1, dist2: 1 }] });
    expect(evaluate(h, d, v, set(rule({ k: 'always' }, { k: 'castSkill', skillId: 'heal' })))).toBeNull();
  });

  test('skill on cooldown falls through; unknown/unlearned skill falls through', () => {
    const { h, d } = hero('mage', (x) => {
      x.cooldowns['fireball'] = 20;
    });
    const v = view({ enemies: [enemy('m1', 4)] });
    const result = evaluate(h, derive(h), v, set(
      rule({ k: 'always' }, { k: 'castSkill', skillId: 'fireball' }),
      rule({ k: 'always' }, { k: 'castSkill', skillId: 'meteor_storm' }),
      rule({ k: 'always' }, { k: 'attack' }),
    ));
    expect(result).toEqual({ kind: 'attack', targetId: 'm1' });
    void d;
  });

  test('carrying a friend disables attacks and casts', () => {
    const { h, d } = hero('knight');
    const v = view({ enemies: [enemy('m1', 1, true)], carrying: true });
    expect(evaluate(h, d, v, set(rule({ k: 'always' }, { k: 'attack' })))).toBeNull();
    expect(defaultAction(v)).toBeNull();
  });

  test('carryAlly picks the first downed ally; infeasible while already carrying', () => {
    const { h, d } = hero('knight');
    const v = view({ downedAllies: ['d1', 'd2'] });
    expect(evaluate(h, d, v, set(rule({ k: 'allyDowned' }, { k: 'carryAlly' })))).toEqual({
      kind: 'carry',
      targetId: 'd1',
    });
    const carryingView = view({ downedAllies: ['d1'], carrying: true });
    expect(evaluate(h, d, carryingView, set(rule({ k: 'allyDowned' }, { k: 'carryAlly' })))).toBeNull();
  });

  test('condition triggers: enemiesAtLeast / enemyIsElite / enemyLevelAbove / inMeleeRange / selfMpAbove', () => {
    const { h, d } = hero('knight');
    const mk = (v: BattleView, trigger: TacticRule['trigger']) =>
      evaluate(h, d, v, set(rule(trigger, { k: 'defend' })));

    expect(mk(view({ enemies: [enemy('a'), enemy('b')] }), { k: 'enemiesAtLeast', n: 3 })).toBeNull();
    expect(mk(view({ enemies: [enemy('a'), enemy('b'), enemy('c')] }), { k: 'enemiesAtLeast', n: 3 })).toEqual({ kind: 'defend' });
    expect(mk(view({ enemies: [enemy('a', 9, false, 5, true)] }), { k: 'enemyIsElite' })).toEqual({ kind: 'defend' });
    expect(mk(view({ enemies: [enemy('a', 9, false, 9)] }), { k: 'enemyLevelAbove', delta: 3 })).toEqual({ kind: 'defend' });
    expect(mk(view({ enemies: [enemy('a', 9, false, 7)] }), { k: 'enemyLevelAbove', delta: 3 })).toBeNull();
    expect(mk(view({ enemies: [enemy('a', 1, true)] }), { k: 'inMeleeRange' })).toEqual({ kind: 'defend' });
    expect(mk(view({ selfMpFrac: 0.6 }), { k: 'selfMpAbove', pct: 50 })).toEqual({ kind: 'defend' });
    expect(mk(view({ selfMpFrac: 0.4 }), { k: 'selfMpAbove', pct: 50 })).toBeNull();
  });

  test('retreat needs an enemy', () => {
    const { h, d } = hero('ranger');
    expect(evaluate(h, d, view(), set(rule({ k: 'always' }, { k: 'retreat' })))).toBeNull();
    expect(evaluate(h, d, view({ enemies: [enemy('m1', 2)] }), set(rule({ k: 'always' }, { k: 'retreat' })))).toEqual({
      kind: 'retreat',
    });
  });
});
