/**
 * Banter: pure-helper tests plus a director smoke test. The director's
 * randomness is injected so the tests stay deterministic.
 */
import { describe, expect, test } from 'bun:test';
import type { GameEvent } from '../game/types';
import { newGame } from '../game/newGame';
import { advanceTick } from '../game/run/runtime';
import { makeRng, randInt } from '../game/core/rng';
import { TRAIT_IDS, rollTraits } from '../game/hero/create';
import { BANTER, CLASSES, MONSTERS } from '../game/content';
import {
  BanterDirector,
  decorate,
  fillTemplate,
  linePool,
  memoryPool,
  pairExchange,
  tauntPool,
} from './banter';

const NOW = 1_750_000_000_000;

describe('banter helpers', () => {
  test('fillTemplate replaces known placeholders, defuses unknown ones', () => {
    expect(fillTemplate('Take that, {enemy}!', { enemy: 'Skeleton' })).toBe('Take that, Skeleton!');
    expect(fillTemplate('{ally} and {nonsense}', { ally: 'Bob' })).toBe('Bob and someone');
  });

  test('decorate never touches mime stage directions', () => {
    const seq = [0.1, 0, 0]; // would normally add an interjection
    let i = 0;
    const rand = () => seq[i++ % seq.length]!;
    expect(decorate('*mimes a door*', ['boastful'], rand)).toBe('*mimes a door*');
  });

  test('rollTraits always yields 2-3 distinct known traits', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const traits = rollTraits(rng);
      expect(traits.length).toBeGreaterThanOrEqual(2);
      expect(traits.length).toBeLessThanOrEqual(3);
      expect(new Set(traits).size).toBe(traits.length);
      for (const t of traits) expect(TRAIT_IDS).toContain(t as never);
    }
    void randInt; // referenced to keep import meaningful if helpers change
  });
});

describe('dictionary coverage', () => {
  test('every trait covers every context', () => {
    expect(BANTER.traits.length).toBeGreaterThanOrEqual(10);
    for (const trait of BANTER.traits) {
      for (const ctx of ['kill', 'hurt', 'lowHp', 'allyDown', 'rescue', 'loot', 'boss', 'descend', 'idle', 'friendlyFire'] as const) {
        expect(trait.lines[ctx]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  test('every class has a voice and can taunt every monster', () => {
    for (const classId of Object.keys(CLASSES)) {
      expect(BANTER.voices[classId]).toBeDefined();
      const hero = { classId, traits: [], perks: [] } as never;
      for (const defId of Object.keys(MONSTERS)) {
        expect(tauntPool(hero, defId).length).toBeGreaterThan(0);
      }
    }
  });

  test('any two classes can hold a conversation (role fallback)', () => {
    const ids = Object.keys(CLASSES);
    const rand = () => 0.49;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const ha = { id: 'a', name: 'A', classId: a, traits: [] } as never;
        const hb = { id: 'b', name: 'B', classId: b, traits: [] } as never;
        const ex = pairExchange(ha, hb, rand);
        expect(ex).not.toBeNull();
        expect(ex!.lines[0].length).toBeGreaterThan(0);
        expect(ex!.lines[1].length).toBeGreaterThan(0);
      }
    }
  });

  test('mime never speaks: every mime line is a stage direction', () => {
    const mime = BANTER.voices['mime']!;
    const all = [...mime.kill, ...mime.idle, ...Object.values(mime.taunts).flat()];
    for (const line of all) expect(line.startsWith('*')).toBe(true);
  });

  test('memory lines exist for the whole story arc', () => {
    const hero = {
      classId: 'knight',
      traits: ['gloomy'],
      perks: [],
      stats: { runs: 20, kills: 250, downs: 5, carriedOut: 2, rescues: 3, biggestHitFrom: 'Lvl 4 Skeleton' },
    } as never;
    expect(memoryPool(hero).length).toBeGreaterThan(10);
  });

  test('line pools are non-empty for armed contexts', () => {
    const hero = { classId: 'chef', traits: ['hungry', 'cheerful'], perks: ['collects_spoons'] } as never;
    for (const ctx of ['kill', 'lowHp', 'allyDown', 'rescue', 'loot', 'boss', 'descend', 'idle', 'friendlyFire']) {
      expect(linePool(hero, ctx).length).toBeGreaterThan(0);
    }
  });
});

describe('banter director', () => {
  test('descend can trigger a line; cooldowns then hold the silence', () => {
    const state = newGame(11, NOW);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, []);
    const director = new BanterDirector(() => 0); // every die roll passes
    const descend: GameEvent[] = [{ t: 'descend', depth: 2 }];
    const first = director.consume(state, descend, NOW);
    expect(first.length).toBe(1);
    expect(first[0]!.text.length).toBeGreaterThan(0);
    // immediately again: the global gap silences it
    const second = director.consume(state, descend, NOW + 1000);
    expect(second.length).toBe(0);
    // well past the cooldowns it may speak again
    const third = director.consume(state, descend, NOW + 60_000);
    expect(third.length).toBe(1);
  });

  test('a quiet stretch produces an idle exchange with a delayed reply', () => {
    const state = newGame(11, NOW);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, []);
    const director = new BanterDirector(() => 0.2); // passes idle chance, picks pair branch
    let t = NOW + 100_000;
    const first = director.consume(state, [], t);
    expect(first.length).toBe(1); // the opener
    const reply = director.consume(state, [], t + 2_000);
    expect(reply.length).toBe(1); // the scheduled answer
    expect(reply[0]!.heroId).not.toBe(first[0]!.heroId);
  });
});
