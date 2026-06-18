import { expect, test } from 'bun:test';
import { newGame } from './newGame';
import { makeHero } from './hero/create';
import { heroLifetimeSnapshot } from './run/lifecycle';

const NOW = 1_750_000_000_000;

test('heroLifetimeSnapshot captures lifetime stats and the most-slain nemesis', () => {
  const state = newGame(5, NOW);
  const h = makeHero(state, 'knight', 'Fallen', 4, [], [], 'human');
  h.stats.kills = 17;
  h.stats.dmgDealt = 1234;
  h.stats.runs = 3;
  h.stats.downs = 2;
  h.stats.rescues = 1;
  h.stats.biggestHitTaken = 40;
  h.stats.biggestHitFrom = 'Cave Slime';
  h.gold = 88;
  h.stats.killsByDef = { rat: 3, skeleton: 9, goblin: 5 };

  const snap = heroLifetimeSnapshot(h);
  expect(snap.kills).toBe(17);
  expect(snap.dmgDealt).toBe(1234);
  expect(snap.runs).toBe(3);
  expect(snap.gold).toBe(88);
  expect(snap.biggestHitFrom).toBe('Cave Slime');
  expect(snap.nemesis?.count).toBe(9); // the skeleton was slain most
  expect(typeof snap.nemesis?.name).toBe('string');
});

test('heroLifetimeSnapshot has no nemesis when nothing was ever slain', () => {
  const state = newGame(6, NOW);
  const h = makeHero(state, 'cleric', 'Pacifist', 2, [], [], 'human');
  expect(heroLifetimeSnapshot(h).nemesis).toBeUndefined();
});
