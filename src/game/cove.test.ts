import { describe, expect, test } from 'bun:test';
import { newGame } from './newGame';
import { applyCommand } from './commands';
import { COVE_GAMES } from './content';
import type { GameEvent } from './types';

const NOW = 1_750_000_000_000;

function gamble(seed: number, gold: number, gameId: string, stake: number, times = 1) {
  const s = newGame(seed, NOW);
  s.village.gold = gold;
  const events: GameEvent[] = [];
  for (let i = 0; i < times; i++) applyCommand(s, { t: 'GAMBLE', gameId, stake }, NOW, events);
  return { s, events: events.filter((e) => e.t === 'gamble') as Extract<GameEvent, { t: 'gamble' }>[] };
}

describe("the gambler's cove", () => {
  test('a wager is deterministic: same seed, same outcomes', () => {
    const a = gamble(5, 100000, 'coin_flip', 100, 12).events.map((e) => e.won);
    const b = gamble(5, 100000, 'coin_flip', 100, 12).events.map((e) => e.won);
    expect(a).toEqual(b);
    expect(a.length).toBe(12);
  });

  test('every game keeps a house edge (return-to-player < 1 over many rolls)', () => {
    for (const g of Object.values(COVE_GAMES)) {
      const { s } = gamble(42, 5_000_000, g.id, 10, 20000);
      const rtp = 1 + (s.village.gold - 5_000_000) / (20000 * 10);
      // EV is winChance*payoutMult by construction; the realized RTP should sit near it and below 1
      expect(rtp).toBeLessThan(1);
      expect(Math.abs(rtp - g.winChance * g.payoutMult)).toBeLessThan(0.05);
    }
  });

  test('a win pays the stake’s profit; a loss forfeits the stake', () => {
    const { events } = gamble(5, 100000, 'coin_flip', 100, 12);
    for (const e of events) {
      expect(e.delta).toBe(e.won ? 100 : -100); // coin_flip is 2× → profit == stake
    }
  });

  test('stake clamps to the bank and the table max; never goes negative', () => {
    // bank below the table max → bet only what you have
    const tiny = gamble(1, 30, 'kraken_pot', 99999, 1);
    expect(tiny.events[0]!.stake).toBe(30);
    // a long losing streak can empty the bank but never overdraw it
    const many = gamble(3, 200, 'kraken_pot', 50, 50);
    expect(many.s.village.gold).toBeGreaterThanOrEqual(0);
  });

  test('the table minimum is enforced: a near-empty bank cannot bet', () => {
    const broke = gamble(7, 3, 'coin_flip', 100, 1); // min stake is 5
    expect(broke.events.length).toBe(0);
    expect(broke.s.village.gold).toBe(3);
  });

  test('gambling is a village-only action (no-op mid-run)', () => {
    const s = newGame(9, NOW);
    s.village.gold = 1000;
    advanceToDungeon(s);
    const before = s.village.gold;
    const events: GameEvent[] = [];
    applyCommand(s, { t: 'GAMBLE', gameId: 'coin_flip', stake: 100 }, NOW, events);
    expect(events.length).toBe(0);
    expect(s.village.gold).toBe(before);
  });
});

function advanceToDungeon(s: ReturnType<typeof newGame>) {
  const { advanceTick } = require('./run/runtime');
  advanceTick(s, [{ t: 'EMBARK', memberIds: s.rosterOrder.slice(0, 2), startDepth: 1 }], NOW, []);
}
