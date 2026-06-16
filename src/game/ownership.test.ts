import { describe, expect, test } from 'bun:test';
import { newGame } from './newGame';
import { applyCommand } from './commands';
import { makeHero, ownershipFromTraits } from './hero/create';
import { derive } from './hero/derive';

const NOW = 1_750_000_000_000;

function hero(traits: string[]) {
  const state = newGame(4, NOW);
  const h = makeHero(state, 'knight', 'Coin', 5, [], traits, 'human');
  state.roster[h.id] = h;
  state.rosterOrder.push(h.id);
  return { state, h };
}

describe('ownership traits — greedy', () => {
  test('ownership flags derive from personality traits', () => {
    expect(ownershipFromTraits(['greedy', 'cheerful']).greedy).toBe(true);
    expect(ownershipFromTraits(['cheerful', 'gloomy']).greedy).toBeFalsy();
  });

  test('a freshly made greedy hero has the ownership flag set', () => {
    const { h } = hero(['greedy', 'cheerful']);
    expect(h.ownership?.greedy).toBe(true);
  });

  test('a greedy hero has a hustler’s gold-find bonus', () => {
    const greedy = hero(['greedy', 'cheerful']).h;
    const plain = hero(['cheerful', 'scholarly']).h;
    expect(derive(greedy).goldMult).toBeGreaterThan(derive(plain).goldMult);
    expect(derive(greedy).goldMult).toBeCloseTo(1.15, 5);
  });

  test('a greedy hero hoards — they refuse to bank their gold', () => {
    const { state, h } = hero(['greedy', 'cheerful']);
    h.gold = 100;
    const bankBefore = state.village.gold;
    applyCommand(state, { t: 'DEPOSIT_GOLD', heroId: h.id, amount: 100 }, NOW, []);
    expect(h.gold).toBe(100); // still on the hero
    expect(state.village.gold).toBe(bankBefore); // nothing reached the treasury
  });

  test('a non-greedy hero banks gold normally', () => {
    const { state, h } = hero(['cheerful', 'scholarly']);
    h.gold = 100;
    const bankBefore = state.village.gold;
    applyCommand(state, { t: 'DEPOSIT_GOLD', heroId: h.id, amount: 100 }, NOW, []);
    expect(h.gold).toBe(0);
    expect(state.village.gold).toBe(bankBefore + 100);
  });

  test('a greedy hero won’t hand gold directly to another', () => {
    const state = newGame(4, NOW);
    const a = makeHero(state, 'knight', 'A', 5, [], ['greedy', 'cheerful'], 'human');
    const b = makeHero(state, 'ranger', 'B', 5, [], ['cheerful', 'scholarly'], 'human');
    state.roster[a.id] = a;
    state.roster[b.id] = b;
    a.gold = 80;
    applyCommand(state, { t: 'TRANSFER_GOLD', fromHeroId: a.id, toHeroId: b.id, amount: 80 }, NOW, []);
    expect(a.gold).toBe(80); // kept it
    expect(b.gold).toBe(0);
  });
});
