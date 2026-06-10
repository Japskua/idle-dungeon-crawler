/**
 * The two tests that keep the whole architecture honest:
 *  1. Golden-seed: a scripted headless run hashes to a committed constant.
 *     If this breaks unexpectedly, something non-deterministic crept in.
 *     (After deliberate balance/sim changes, re-baseline the constant.)
 *  2. Save/load equivalence: ticking N then load(save(state)) then M more
 *     equals ticking N+M straight through.
 */
import { describe, expect, test } from 'bun:test';
import type { Command, GameEvent, GameState } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { deserialize, serialize } from './save/serialize';

const NOW = 1_750_000_000_000; // frozen wall clock: no village accrual drift

function freshEmbarkedGame(seed: number): GameState {
  const state = newGame(seed, NOW);
  const events: GameEvent[] = [];
  const embark: Command = { t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 };
  advanceTick(state, [embark], NOW, events);
  return state;
}

function runTicks(state: GameState, n: number): string[] {
  const eventTypes: string[] = [];
  for (let i = 0; i < n; i++) {
    const events: GameEvent[] = [];
    advanceTick(state, [], NOW, events);
    for (const e of events) eventTypes.push(e.t);
  }
  return eventTypes;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Re-baseline deliberately when sim/balance/content changes: bun test --rerun
// prints the new value in the failure message.
const GOLDEN_STATE_HASH = 'f988f9e';
const GOLDEN_EVENT_HASH = '2571da44';

describe('determinism', () => {
  test('golden seed 42: 5000 ticks hash to the committed baseline', () => {
    const state = freshEmbarkedGame(42);
    const eventTypes = runTicks(state, 5000);
    const stateHash = fnv1a(serialize(state));
    const eventHash = fnv1a(eventTypes.join(','));
    expect(`state:${stateHash}`).toBe(`state:${GOLDEN_STATE_HASH}`);
    expect(`events:${eventHash}`).toBe(`events:${GOLDEN_EVENT_HASH}`);
  });

  test('save/load equivalence: 5000 straight == 2500 + save/load + 2500', () => {
    const a = freshEmbarkedGame(777);
    runTicks(a, 5000);

    const b = freshEmbarkedGame(777);
    runTicks(b, 2500);
    const reloaded = deserialize(serialize(b));
    runTicks(reloaded, 2500);

    expect(serialize(reloaded)).toBe(serialize(a));
  });

  test('two identical games diverge nowhere over 3000 ticks', () => {
    const a = freshEmbarkedGame(1001);
    const b = freshEmbarkedGame(1001);
    const evA = runTicks(a, 3000);
    const evB = runTicks(b, 3000);
    expect(evA.join(',')).toBe(evB.join(','));
    expect(serialize(a)).toBe(serialize(b));
  });
});

describe('full loop (headless)', () => {
  test('a fresh party crawls, fights, descends, and eventually wipes — losing gold but keeping loot and xp', () => {
    const state = freshEmbarkedGame(2024);
    const goldBefore = state.village.gold;
    let wiped = false;
    let descended = false;
    let dealtDamage = false;
    let maxGoldCarried = 0;

    for (let i = 0; i < 300_000 && !wiped; i++) {
      const events: GameEvent[] = [];
      advanceTick(state, [], NOW, events);
      if (state.run) maxGoldCarried = Math.max(maxGoldCarried, state.run.party.goldCarried);
      for (const e of events) {
        if (e.t === 'descend' && e.depth > 1) descended = true;
        if (e.t === 'damage') dealtDamage = true;
        if (e.t === 'runEnded' && e.outcome === 'wiped') wiped = true;
      }
    }

    expect(dealtDamage).toBe(true);
    expect(descended).toBe(true);
    expect(wiped).toBe(true);
    expect(state.mode).toBe('village');
    expect(state.run).toBeNull();
    // gold carried in the run is gone: village gold unchanged by the wipe
    expect(state.village.gold).toBe(goldBefore);
    expect(maxGoldCarried).toBeGreaterThan(0);
    // xp was kept by any survivor
    for (const id of state.rosterOrder) {
      const hero = state.roster[id]!;
      expect(hero.level > 1 || hero.xp > 0).toBe(true);
    }
    // survivors carry injuries home
    const survivors = state.rosterOrder.length;
    if (survivors > 0) {
      const injured = state.rosterOrder.filter((id) => state.roster[id]!.injuries.length > 0);
      expect(injured.length).toBeGreaterThan(0);
    }
    expect(state.progress.maxDepthReached).toBeGreaterThanOrEqual(2);
  });
});
