import { describe, expect, test } from 'bun:test';
import { newGame } from './newGame';
import { makeHero } from './hero/create';
import { applyCommand } from './commands';
import { favorTier, SWITCH_FAITH_FAVOR } from './balance';
import { PALETTE, RELIGIONS } from './content';
import { GOD_PORTRAITS } from './content/godPortraits';

const NOW = 1_750_000_000_000;

function villageHero() {
  const state = newGame(1, NOW);
  const h = makeHero(state, 'knight', 'Convert', 5, [], [], 'human');
  state.roster[h.id] = h;
  state.rosterOrder.push(h.id);
  return { state, h };
}

describe('deity dedication & switching penalty', () => {
  test('first dedication is free and starts at neutral favor', () => {
    const { state, h } = villageHero();
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: 'war_god' }, NOW, []);
    expect(h.faith).toEqual({ religionId: 'war_god', favor: 0 });
  });

  test('re-selecting the same god preserves favor (no-op, no penalty)', () => {
    const { state, h } = villageHero();
    h.faith = { religionId: 'war_god', favor: 42 };
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: 'war_god' }, NOW, []);
    expect(h.faith).toEqual({ religionId: 'war_god', favor: 42 });
  });

  test('switching gods wipes favor and brands the hero Forsaken', () => {
    const { state, h } = villageHero();
    h.faith = { religionId: 'war_god', favor: 80 }; // exalted with the old god
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: 'money_god' }, NOW, []);
    expect(h.faith).toEqual({ religionId: 'money_god', favor: SWITCH_FAITH_FAVOR });
    expect(favorTier(h.faith!.favor)).toBe('forsaken');
  });

  test('faith is a lifelong commitment — a null (renounce) target is ignored', () => {
    const { state, h } = villageHero();
    h.faith = { religionId: 'war_god', favor: 30 };
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: null }, NOW, []);
    expect(h.faith).toEqual({ religionId: 'war_god', favor: 30 }); // unchanged
  });

  test('the switch penalty cannot be dodged by renouncing first', () => {
    const { state, h } = villageHero();
    h.faith = { religionId: 'war_god', favor: 90 };
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: null }, NOW, []); // ignored
    applyCommand(state, { t: 'SET_HERO_FAITH', heroId: h.id, religionId: 'sun_god' }, NOW, []);
    expect(h.faith).toEqual({ religionId: 'sun_god', favor: SWITCH_FAITH_FAVOR });
    expect(favorTier(h.faith!.favor)).toBe('forsaken');
  });
});

describe('god portraits', () => {
  const pal = new Set(Object.keys(PALETTE as Record<string, string>));
  test('every religion has a 32×32 portrait using only palette chars', () => {
    for (const id of Object.keys(RELIGIONS)) {
      const rows = GOD_PORTRAITS[id];
      expect(rows, `missing portrait for ${id}`).toBeDefined();
      expect(rows!.length).toBe(32);
      for (const row of rows!) {
        expect(row.length).toBe(32);
        for (const ch of row) {
          if (ch !== '.') expect(pal.has(ch), `bad palette char '${ch}' in ${id}`).toBe(true);
        }
      }
    }
  });
});
