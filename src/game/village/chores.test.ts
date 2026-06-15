import { describe, expect, test } from 'bun:test';
import type { GameEvent } from '../types';
import { newGame } from '../newGame';
import { villageUpkeep } from '../run/runtime';
import { derive } from '../hero/derive';

const NOW = 1_750_000_000_000;
const HOUR = 3_600_000;

function gameWithChore(choreId: string) {
  const state = newGame(7, NOW);
  const heroId = state.rosterOrder[0]!;
  const hero = state.roster[heroId]!;
  hero.activity = 'chore';
  hero.choreId = choreId;
  return { state, hero };
}

describe('village chore accrual (no offline progress — only the time the loop feeds it)', () => {
  test('farmhand: 2 hours = 60 gold and 20 xp', () => {
    const { state, hero } = gameWithChore('farmhand');
    const gold0 = state.village.gold;
    const events: GameEvent[] = [];
    villageUpkeep(state, NOW + 2 * HOUR, events);
    expect(state.village.gold - gold0).toBe(60);
    expect(hero.xp).toBe(20);
  });

  test('accrual is purely additive over many small steps (no double counting)', () => {
    const a = gameWithChore('farmhand');
    const b = gameWithChore('farmhand');
    const events: GameEvent[] = [];
    villageUpkeep(a.state, NOW + 1 * HOUR, events);
    for (let i = 1; i <= 3600; i++) {
      villageUpkeep(b.state, NOW + i * 1000, events);
    }
    expect(Math.abs(a.state.village.gold - b.state.village.gold)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.hero.xp - b.hero.xp)).toBeLessThanOrEqual(1);
  });

  test('accrual is uncapped — the loop, not this function, decides what time counts', () => {
    const { state } = gameWithChore('farmhand');
    const gold0 = state.village.gold;
    // a 30h delta would only reach here if the loop allowed it; the math is linear
    villageUpkeep(state, NOW + 30 * HOUR, []);
    expect(state.village.gold - gold0).toBe(30 * 30);
  });

  test('clock moving backwards re-anchors and grants nothing', () => {
    const { state, hero } = gameWithChore('farmhand');
    const gold0 = state.village.gold;
    villageUpkeep(state, NOW - 5 * HOUR, []);
    expect(state.village.gold).toBe(gold0);
    expect(hero.xp).toBe(0);
    expect(state.village.lastChoreAccrualMs).toBe(NOW - 5 * HOUR);
  });

  test('training yard drains gold (clamped at 0) while granting xp', () => {
    const { state, hero } = gameWithChore('training_yard');
    state.village.gold = 30;
    villageUpkeep(state, NOW + 4 * HOUR, []);
    expect(state.village.gold).toBe(0); // 4h x -20g/h = -80, clamped
    expect(hero.xp > 0 || hero.level > 1).toBe(true);
  });

  test('temple assistant recovers twice as fast', () => {
    const state = newGame(8, NOW);
    const [aId, bId] = state.rosterOrder as [string, string];
    const a = state.roster[aId]!;
    const b = state.roster[bId]!;
    a.hp = 1;
    b.hp = 1;
    a.activity = 'chore';
    a.choreId = 'temple_assistant';
    b.activity = 'recovering';
    villageUpkeep(state, NOW + 10_000, []);
    const aFrac = a.hp / derive(a).maxHp;
    const bFrac = b.hp / derive(b).maxHp;
    expect(aFrac).toBeGreaterThan(bFrac);
  });

  test('daily rotation: purchasedToday clears when the day index rolls over', () => {
    const { state } = gameWithChore('farmhand');
    state.village.purchasedToday.push('something');
    state.village.hiredToday.push('someone');
    villageUpkeep(state, NOW + 25 * HOUR, []);
    expect(state.village.purchasedToday).toEqual([]);
    expect(state.village.hiredToday).toEqual([]);
  });
});
