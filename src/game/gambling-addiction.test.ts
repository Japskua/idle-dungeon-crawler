import { describe, expect, test } from 'bun:test';
import type { GameEvent } from './types';
import { newGame } from './newGame';
import { villageUpkeep } from './run/runtime';
import { applyCommand } from './commands';
import { makeHero } from './hero/create';
import { ADDICT_GAMBLE_FLOOR } from './balance';

const NOW = 1_750_000_000_000;
const SEC = 1000;

function addict(seed: number, gold = 200, traits = ['gambling_addict', 'cheerful']) {
  const state = newGame(seed, NOW);
  const h = makeHero(state, 'knight', 'Bet', 5, [], traits, 'human');
  h.gold = gold;
  state.roster[h.id] = h;
  state.rosterOrder.push(h.id);
  state.village.lastChoreAccrualMs = NOW;
  return { state, h };
}

/** drive foreground village time forward in `step`-second beats, returning gamble events */
function idle(state: ReturnType<typeof newGame>, seconds: number, step = 20) {
  const events: GameEvent[] = [];
  for (let t = step; t <= seconds; t += step) villageUpkeep(state, NOW + t * SEC, events);
  return events.filter((e) => e.t === 'addictGamble') as Extract<GameEvent, { t: 'addictGamble' }>[];
}

describe('gambling addiction (idle auto-gamble)', () => {
  test('the ownership flag derives from the trait', () => {
    const { h } = addict(1);
    expect(h.ownership?.gamblingAddiction).toBe(true);
  });

  test('an idle addict bleeds their own purse over foreground time (house edge)', () => {
    const { state, h } = addict(3, 200);
    const bets = idle(state, 600); // ten minutes of idling
    expect(bets.length).toBeGreaterThan(5); // they kept betting
    expect(h.gold).toBeLessThan(200); // ...and the house won overall
    expect(h.gold).toBeGreaterThanOrEqual(0); // never goes negative
  });

  test('the same seed and the same time-steps reproduce the exact gold trajectory', () => {
    const a = addict(7, 300);
    const b = addict(7, 300);
    idle(a.state, 400);
    idle(b.state, 400);
    expect(a.h.gold).toBe(b.h.gold); // fully deterministic
  });

  test('an addict who runs low stops betting (no negative spiral)', () => {
    const { state, h } = addict(9, 12); // a thin purse
    idle(state, 2000); // a long idle
    expect(h.gold).toBeGreaterThanOrEqual(0);
    expect(h.gold).toBeLessThanOrEqual(ADDICT_GAMBLE_FLOOR + 50); // settled low, not runaway
  });

  test('a busy addict (in the dungeon or on a chore) does not gamble', () => {
    const { state, h } = addict(4, 200);
    h.activity = 'chore';
    h.choreId = 'librarian';
    const bets = idle(state, 600);
    expect(bets.length).toBe(0);
    expect(h.gold).toBe(200);
  });

  test('a non-addict idles without gambling', () => {
    const { state, h } = addict(4, 200, ['cheerful', 'scholarly']);
    const bets = idle(state, 600);
    expect(bets.length).toBe(0);
    expect(h.gold).toBe(200);
  });

  test('closed/backgrounded time does not accrue: re-anchoring skips the gap', () => {
    const { state, h } = addict(5, 200);
    const events: GameEvent[] = [];
    // simulate the app loop re-anchoring after a long background gap, then a small live beat
    state.village.lastChoreAccrualMs = NOW + 3600 * SEC; // loop re-anchored the clock forward
    villageUpkeep(state, NOW + 3600 * SEC + 20 * SEC, events); // only 20s of live time elapses
    const bets = events.filter((e) => e.t === 'addictGamble');
    expect(bets.length).toBeLessThanOrEqual(2); // a couple of bets at most — NOT an hour's worth
  });
});

describe('lone wolf (item hoarding)', () => {
  test('the ownership flag derives from the trait', () => {
    const { h } = addict(1, 0, ['lone_wolf', 'deadpan']);
    expect(h.ownership?.loneWolf).toBe(true);
  });

  test('a lone wolf sometimes refuses to stash their gear; a normal hero never does', () => {
    const refusals = (traits: string[]) => {
      const state = newGame(11, NOW);
      const h = makeHero(state, 'ranger', 'Solo', 5, [], traits, 'human');
      state.roster[h.id] = h;
      let refused = 0;
      for (let i = 0; i < 40; i++) {
        // hand them a fresh item, then try to stash it
        h.satchel.push({ id: `it${i}`, defId: 'bone', rarity: 'common', affixes: [], ilvl: 1 });
        const ev: GameEvent[] = [];
        applyCommand(state, { t: 'DEPOSIT_ITEM', heroId: h.id, itemId: `it${i}` }, NOW, ev);
        if (ev.some((e) => e.t === 'transferRefused')) refused++;
      }
      return refused;
    };
    expect(refusals(['lone_wolf', 'deadpan'])).toBeGreaterThan(0); // the wolf clings
    expect(refusals(['cheerful', 'scholarly'])).toBe(0); // the team player shares freely
  });
});
