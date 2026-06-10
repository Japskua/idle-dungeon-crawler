import { describe, expect, test } from 'bun:test';
import { mitigate, monsterMaxHp, monsterXp, physDamage, xpForNextLevel } from './balance';
import { newGame } from './newGame';
import { makeHero } from './hero/create';
import { derive } from './hero/derive';
import { addXp } from './hero/leveling';
import type { GameEvent } from './types';

const NOW = 1_750_000_000_000;

describe('combat math', () => {
  test('mitigation is smooth and never zeroes damage', () => {
    expect(mitigate(100, 0)).toBe(100);
    expect(mitigate(100, 100)).toBe(50);
    expect(mitigate(100, 300)).toBe(25);
    expect(mitigate(10, 100000)).toBeGreaterThan(0);
  });

  test('physical damage scales with strength', () => {
    expect(physDamage(10, 0)).toBe(10);
    expect(physDamage(10, 25)).toBe(20);
  });

  test('xp curve is increasing and reasonable', () => {
    let prev = 0;
    for (let level = 1; level <= 30; level++) {
      const next = xpForNextLevel(level);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
    expect(xpForNextLevel(1)).toBe(25);
  });

  test('monster scaling: a level 15 skeleton dwarfs a level 1 skeleton', () => {
    expect(monsterMaxHp(18, 15, false, false)).toBeGreaterThan(monsterMaxHp(18, 1, false, false) * 6);
    expect(monsterXp(6, 15, false, false)).toBeGreaterThan(monsterXp(6, 1, false, false) * 4);
  });
});

describe('heroes', () => {
  test('equipment, perks and injuries all flow into derived stats', () => {
    const state = newGame(1, NOW);
    const hero = makeHero(state, 'knight', 'Testy', 1, []);
    const base = derive(hero);
    expect(base.weaponDmg).toBe(4); // rusty sword
    expect(base.armor).toBe(2); // cloth tunic

    hero.perks = ['brave']; // +1 str
    expect(derive(hero).attrs.str).toBe(base.attrs.str + 1);

    hero.injuries = ['lost_arm']; // -3 str
    expect(derive(hero).attrs.str).toBe(base.attrs.str + 1 - 3);

    hero.injuries = ['lost_leg']; // speed x0.75 -> slower movement
    expect(derive(hero).moveTicks).toBeGreaterThan(base.moveTicks);
  });

  test('level-ups apply growth, unlock skills, and heal to full', () => {
    const state = newGame(2, NOW);
    const hero = makeHero(state, 'knight', 'Testy', 1, []);
    hero.hp = 5;
    const events: GameEvent[] = [];
    addXp(state, hero, 10_000, events);
    expect(hero.level).toBeGreaterThan(3);
    expect(hero.skills).toContain('shield_bash');
    expect(hero.skills).toContain('taunt');
    expect(hero.hp).toBe(derive(hero).maxHp);
    expect(events.some((e) => e.t === 'levelUp')).toBe(true);
  });

  test('xp multiplier perk grants more xp', () => {
    const state = newGame(3, NOW);
    const plain = makeHero(state, 'knight', 'Plain', 1, []);
    const learner = makeHero(state, 'knight', 'Learner', 1, ['fast_learner']);
    const ev: GameEvent[] = [];
    addXp(state, plain, 100, ev);
    addXp(state, learner, 100, ev);
    expect(learner.xp + (learner.level - 1) * 1000).toBeGreaterThan(plain.xp);
  });
});
