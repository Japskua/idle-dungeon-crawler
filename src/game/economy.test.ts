import { describe, expect, test } from 'bun:test';
import { newGame } from './newGame';
import { makeHero } from './hero/create';
import { spendGold, spendableGold } from './village/shop';

const NOW = 1_750_000_000_000;

function setup() {
  const state = newGame(3, NOW);
  state.roster = {};
  state.rosterOrder = [];
  state.village.gold = 10;
  const a = makeHero(state, 'knight', 'Aldo', 5, [], [], 'human');
  a.gold = 30;
  a.ownership = { greedy: false };
  const b = makeHero(state, 'cleric', 'Bex', 5, [], [], 'human');
  b.gold = 50;
  b.ownership = { greedy: true }; // a hoarder — keeps their coin
  state.roster[a.id] = a;
  state.roster[b.id] = b;
  state.rosterOrder.push(a.id, b.id);
  return { state, a, b };
}

describe('party-purse spending', () => {
  test('spendable gold = treasury + non-greedy purses (greedy excluded)', () => {
    const { state } = setup();
    expect(spendableGold(state)).toBe(40); // 10 treasury + 30 (Aldo); Bex's 50 hoarded
  });

  test('spendGold drains the treasury first, then non-greedy purses', () => {
    const { state, a, b } = setup();
    expect(spendGold(state, 25)).toBe(true); // 10 from treasury + 15 from Aldo
    expect(state.village.gold).toBe(0);
    expect(a.gold).toBe(15);
    expect(b.gold).toBe(50); // greedy hero untouched
  });

  test('a purely-treasury purchase leaves purses alone', () => {
    const { state, a } = setup();
    expect(spendGold(state, 8)).toBe(true);
    expect(state.village.gold).toBe(2);
    expect(a.gold).toBe(30);
  });

  test('spendGold refuses and changes nothing when unaffordable', () => {
    const { state, a, b } = setup();
    expect(spendGold(state, 999)).toBe(false);
    expect(state.village.gold).toBe(10);
    expect(a.gold).toBe(30);
    expect(b.gold).toBe(50);
  });
});
