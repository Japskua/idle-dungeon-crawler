import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance } from './types';
import { newGame } from './newGame';
import { advanceTick, applyManifestation } from './run/runtime';
import { makeHero } from './hero/create';
import { RELIGIONS } from './content';
import { derive } from './hero/derive';

const NOW = 1_750_000_000_000;

function believerRun(seed: number, religionId = 'war_god', favor = 100, classId = 'knight') {
  const state = newGame(seed, NOW);
  const h = makeHero(state, classId, 'Devout', 8, [], [], 'human');
  h.faith = { religionId, favor };
  state.roster[h.id] = h;
  state.rosterOrder.push(h.id);
  advanceTick(state, [{ t: 'EMBARK', memberIds: [h.id], startDepth: 1 }], NOW, []);
  return { state, h };
}

function injectHostile(state: ReturnType<typeof newGame>, pos: { x: number; y: number }, hp = 300): MonsterInstance {
  const m: MonsterInstance = {
    id: 'foe', defId: 'zombie', level: 5, elite: false, hp, pos: { ...pos },
    move: null, targetId: null, aggro: true, packId: 0, action: null, statuses: [], cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

describe('divine manifestations — effects', () => {
  test('smite scours every hostile in the room', () => {
    const { state, h } = believerRun(2);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const foe = injectHostile(state, { x: run.party.pos[h.id]!.x + 1, y: run.party.pos[h.id]!.y }, 300);
    applyManifestation(state, run, h, RELIGIONS['war_god']!, 'smite', []);
    expect(foe.hp).toBeLessThan(300);
  });

  test('bless heals the party to full and blesses them', () => {
    const { state, h } = believerRun(2, 'moon_god');
    h.hp = 1;
    applyManifestation(state, state.run!, h, RELIGIONS['moon_god']!, 'bless', []);
    expect(h.hp).toBe(derive(h).maxHp);
    expect(h.statuses.some((s) => s.statusId === 'blessed')).toBe(true);
  });

  test('bounty showers gold and a blessed item', () => {
    const { state, h } = believerRun(3, 'money_god');
    h.gold = 0;
    h.satchel = [];
    applyManifestation(state, state.run!, h, RELIGIONS['money_god']!, 'bounty', []);
    expect(h.gold).toBeGreaterThan(0);
  });

  test('revive hauls a fallen ally back up', () => {
    const { state, h } = believerRun(4, 'death_god');
    const run = state.run!;
    // a second hero, downed
    const ally = makeHero(state, 'cleric', 'Fallen', 8, [], [], 'human');
    state.roster[ally.id] = ally;
    run.party.memberIds.push(ally.id);
    run.party.pos[ally.id] = { ...run.party.pos[h.id]! };
    run.party.downed[ally.id] = { pos: { ...run.party.pos[h.id]! } };
    ally.hp = 0;
    applyManifestation(state, run, h, RELIGIONS['death_god']!, 'revive', []);
    expect(ally.id in run.party.downed).toBe(false);
    expect(ally.hp).toBeGreaterThan(0);
  });

  test('host conjures a flock of allied servants', () => {
    const { state, h } = believerRun(5, 'poultry_god');
    applyManifestation(state, state.run!, h, RELIGIONS['poultry_god']!, 'host', []);
    const mine = Object.values(state.run!.monsters).filter((m) => m.summonedBy === h.id);
    expect(mine.length).toBeGreaterThanOrEqual(3);
  });

  test('scourge savages the apostate but never outright kills them', () => {
    const { state, h } = believerRun(6, 'sun_god');
    h.hp = 200;
    applyManifestation(state, state.run!, h, RELIGIONS['sun_god']!, 'scourge', []);
    expect(h.hp).toBeLessThan(200);
    expect(h.hp).toBeGreaterThanOrEqual(1);
  });

  test('curse hexes the apostate', () => {
    const { state, h } = believerRun(7, 'moon_god');
    applyManifestation(state, state.run!, h, RELIGIONS['moon_god']!, 'curse', []);
    expect(h.statuses.some((s) => s.statusId === 'cursed')).toBe(true);
  });

  test('avatar manifests a hostile elite enforcer', () => {
    const { state, h } = believerRun(8, 'death_god');
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    applyManifestation(state, run, h, RELIGIONS['death_god']!, 'avatar', []);
    const enforcers = Object.values(run.monsters).filter((m) => !m.summonedBy && m.elite && m.aggro);
    expect(enforcers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('divine manifestations — gating & rarity', () => {
  test('a faithless hero never manifests (so the golden party stays untouched)', () => {
    const { state, h } = believerRun(3);
    h.faith = null; // renounce
    const run = state.run!;
    let count = 0;
    for (let i = 0; i < 6000 && state.run; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      count += ev.filter((e) => e.t === 'divineManifestation').length;
    }
    expect(count).toBe(0);
    void h;
  });

  test('a believer at a MIDDLING tier never manifests — only the extremes provoke a god', () => {
    const { state } = believerRun(3, 'war_god', 0); // Wary
    let count = 0;
    for (let i = 0; i < 6000 && state.run; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      count += ev.filter((e) => e.t === 'divineManifestation').length;
    }
    expect(count).toBe(0);
  });

  test('at most ONE manifestation per believer per run — and it does fire for the devoted', () => {
    let totalAcrossSeeds = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const state = newGame(seed, NOW);
      const ids: string[] = [];
      for (const c of ['knight', 'cleric', 'ranger', 'mage']) {
        const h = makeHero(state, c, c, 8, [], [], 'human');
        h.faith = { religionId: 'war_god', favor: 100 };
        state.roster[h.id] = h;
        state.rosterOrder.push(h.id);
        ids.push(h.id);
      }
      advanceTick(state, [{ t: 'EMBARK', memberIds: ids, startDepth: 1 }], NOW, []);
      const perHero: Record<string, number> = {};
      let t = 0;
      while (state.run && t < 8000) {
        for (const id of ids) {
          const h = state.roster[id];
          if (h?.faith) h.faith.favor = 100; // keep them pinned Exalted
        }
        const ev: GameEvent[] = [];
        advanceTick(state, [], NOW, ev);
        for (const e of ev) if (e.t === 'divineManifestation') perHero[e.heroId] = (perHero[e.heroId] ?? 0) + 1;
        t++;
      }
      for (const id of ids) expect(perHero[id] ?? 0).toBeLessThanOrEqual(1); // the once-per-run cap holds
      totalAcrossSeeds += Object.values(perHero).reduce((a, b) => a + b, 0);
    }
    expect(totalAcrossSeeds).toBeGreaterThan(0); // ...but the devoted DO get their rare moment
  });
});
