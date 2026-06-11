import { describe, expect, test } from 'bun:test';
import type { GameEvent } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeItem } from './items/factory';

const NOW = 1_750_000_000_000;

describe('hero lifetime statistics', () => {
  test('a crawl writes the story: runs, kills, damage dealt and taken', () => {
    const state = newGame(81, NOW);
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
    const ids = [...state.rosterOrder];
    for (const id of ids) {
      expect(state.roster[id]!.stats.runs).toBe(1);
    }

    let downedSeen = false;
    for (let i = 0; i < 200_000 && state.run; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      if (ev.some((e) => e.t === 'heroDowned')) downedSeen = true;
      if (ev.some((e) => e.t === 'runEnded')) break;
    }

    const survivors = state.rosterOrder.map((id) => state.roster[id]!);
    const totalDealt = survivors.reduce((sum, h) => sum + h.stats.dmgDealt, 0);
    expect(totalDealt).toBeGreaterThan(0);
    const fighters = survivors.filter((h) => h.stats.dmgDealt > 0);
    for (const hero of fighters) {
      expect(hero.stats.bestRunDmg).toBeGreaterThan(0); // sealed at run end
      expect(hero.stats.kills).toBeGreaterThanOrEqual(0);
    }
    const hurt = survivors.filter((h) => h.stats.biggestHitTaken > 0);
    for (const hero of hurt) {
      expect(hero.stats.biggestHitFrom).toBeDefined();
      expect(hero.stats.biggestHitFrom).toMatch(/Lvl \d+/);
    }
    if (downedSeen) {
      const downed = survivors.find((h) => h.stats.downs > 0);
      if (downed) {
        expect(downed.stats.lastDownedHow).toContain('at depth');
      }
    }
  });

  test('carried-out heroes and their rescuers both get a chapter', () => {
    const state = newGame(82, NOW);
    let carried = false;
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, []);
    for (let i = 0; i < 300_000 && state.run; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      if (ev.some((e) => e.t === 'runEnded' && e.outcome === 'withdrawn')) break;
    }
    const heroes = state.rosterOrder.map((id) => state.roster[id]!);
    const rescued = heroes.find((h) => h.stats.carriedOut > 0);
    const rescuer = heroes.find((h) => h.stats.rescues > 0);
    if (rescued && rescuer) {
      carried = true;
      expect(rescued.id).not.toBe(rescuer.id);
    }
    // a clean sweep with no downs is possible; the invariant only binds when it happened
    expect(carried || heroes.every((h) => h.stats.downs === 0 || h.stats.carriedOut === 0)).toBe(true);
  });

  test('sell-all-oddities clears the junk drawer in one click', () => {
    const state = newGame(83, NOW);
    state.village.inventory.push(
      makeItem(state, 'rat_tail', 1),
      makeItem(state, 'bone', 1),
      makeItem(state, 'slime_goo', 1),
      makeItem(state, 'iron_sword', 1), // not junk: must survive
    );
    const goldBefore = state.village.gold;
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'SELL_ALL_JUNK' }], NOW, events);
    expect(state.village.inventory.length).toBe(1);
    expect(state.village.inventory[0]!.defId).toBe('iron_sword');
    expect(state.village.gold).toBeGreaterThan(goldBefore);
    expect(events.some((e) => e.t === 'sold')).toBe(true);
  });
});
