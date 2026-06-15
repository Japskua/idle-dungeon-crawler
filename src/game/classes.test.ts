import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeHero } from './hero/create';
import { makeItem } from './items/factory';
import { derive } from './hero/derive';
import { canEquip } from './hero/equipment';
import { CLASSES, ITEMS, MONSTERS, NEUTRALS } from './content';
import { monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

function soloRun(seed: number, classId: string, level = 1) {
  const state = newGame(seed, NOW);
  const hero = makeHero(state, classId, `test_${classId}`, level, [], [], 'human');
  state.roster[hero.id] = hero;
  state.rosterOrder.push(hero.id);
  state.village.potions.hp = 0;
  advanceTick(state, [{ t: 'EMBARK', memberIds: [hero.id], startDepth: 1 }], NOW, []);
  return { state, hero };
}

function injectHostile(state: ReturnType<typeof newGame>, defId: string, pos: { x: number; y: number }): MonsterInstance {
  const def = MONSTERS[defId]!;
  const m: MonsterInstance = {
    id: 'foe1',
    defId,
    level: 1,
    elite: false,
    hp: monsterMaxHp(def.base.hp, 1, false, false),
    pos: { ...pos },
    move: null,
    targetId: null,
    aggro: true,
    packId: 555,
    action: null,
    statuses: [],
    cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

describe('the fourteen classes', () => {
  test('all class skill unlocks, starting items, and gear rules are coherent', () => {
    expect(Object.keys(CLASSES).length).toBe(14);
    for (const cls of Object.values(CLASSES)) {
      for (const item of cls.startingItems) {
        const def = ITEMS[item]!;
        expect(def).toBeDefined();
        if (['weapon', 'offhand', 'armor'].includes(def.slot)) {
          expect(canEquip(cls.id, def)).toBe(true);
        }
      }
    }
  });

  test('barbarian wears no armor at all — not even a shield', () => {
    expect(CLASSES['barbarian']!.armorKinds).toEqual([]);
    expect(canEquip('barbarian', ITEMS['cloth_tunic']!)).toBe(false);
    expect(canEquip('barbarian', ITEMS['wooden_shield']!)).toBe(false);
    expect(canEquip('barbarian', ITEMS['war_axe']!)).toBe(true);
  });

  test('monk refuses every weapon, and the fists grow with level', () => {
    expect(CLASSES['monk']!.weaponKinds).toEqual([]);
    for (const def of Object.values(ITEMS)) {
      if (def.slot === 'weapon') expect(canEquip('monk', def)).toBe(false);
    }
    const state = newGame(71, NOW);
    const novice = makeHero(state, 'monk', 'Novice', 1, [], [], 'human');
    const master = makeHero(state, 'monk', 'Master', 10, [], [], 'human');
    expect(derive(master).weaponDmg).toBeGreaterThan(derive(novice).weaponDmg + 9);
    expect(derive(novice).attackTicks).toBe(9); // fast fists
  });

  test('summoned minions never spawn naturally', () => {
    expect(NEUTRALS['skeleton_minion']!.summonOnly).toBe(true);
    expect(NEUTRALS['bee']!.summonOnly).toBe(true);
  });
});

describe('necromancy (and beekeeping)', () => {
  test('the necromancer raises skeletons that fight, then crumble', () => {
    const { state, hero } = soloRun(72, 'necromancer', 3);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const heroPos = run.party.pos[hero.id]!;
    const foe = injectHostile(state, 'zombie', { x: heroPos.x + 3, y: heroPos.y });

    const events: GameEvent[] = [];
    let summoned = 0;
    for (let i = 0; i < 400; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      events.push(...ev);
      const s = ev.find((e) => e.t === 'summon');
      if (s && s.t === 'summon') summoned = s.count;
      if (summoned > 0) break;
    }
    expect(summoned).toBe(2);
    const minions = run.monsterOrder.filter((id) => run.monsters[id]!.summonedBy === hero.id);
    expect(minions.length).toBe(2);
    expect(run.monsters[minions[0]!]!.level).toBe(hero.level); // scale with the caster

    // they fight: a minion lands a hit on the zombie
    let minionHit = false;
    for (let i = 0; i < 600 && !minionHit; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      minionHit = ev.some((e) => e.t === 'damage' && minions.includes(e.src) && e.dst === foe.id);
      if (foe.hp <= 0) break;
    }
    expect(minionHit || foe.hp <= 0).toBe(true);

    // and they expire: fast-forward past the TTL
    for (const id of minions) {
      const m = run.monsters[id];
      if (m) m.ttlTicks = 1;
    }
    const ev: GameEvent[] = [];
    advanceTick(state, [], NOW, ev);
    advanceTick(state, [], NOW, ev);
    expect(run.monsterOrder.filter((id) => run.monsters[id]?.summonedBy === hero.id).length).toBe(0);
    expect(ev.some((e) => e.t === 'minionDied')).toBe(true);
  });

  test('hostiles will turn on minions (bodyguards by design)', () => {
    const { state, hero } = soloRun(70, 'beekeeper', 2);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const heroPos = run.party.pos[hero.id]!;
    injectHostile(state, 'goblin', { x: heroPos.x + 2, y: heroPos.y });

    let beeTargeted = false;
    for (let i = 0; i < 500 && !beeTargeted; i++) {
      advanceTick(state, [], NOW, []);
      const goblin = run.monsters['foe1'];
      if (!goblin || goblin.hp <= 0) break;
      if (goblin.targetId && run.monsters[goblin.targetId]?.summonedBy) beeTargeted = true;
    }
    expect(beeTargeted).toBe(true);
  });

  test('no re-summoning while the entourage is full (evaluator cap)', () => {
    const { state, hero } = soloRun(74, 'necromancer', 3);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const heroPos = run.party.pos[hero.id]!;
    injectHostile(state, 'zombie', { x: heroPos.x + 4, y: heroPos.y });
    hero.cooldowns = {}; // ensure ready

    const events: GameEvent[] = [];
    for (let i = 0; i < 600; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      events.push(...ev);
      const m = run.monsters['foe1'];
      if (!m || m.hp <= 0) break;
      hero.cooldowns['raise_skeleton'] = 0; // even with no cooldown...
      hero.mp = 50;
    }
    const summons = events.filter((e) => e.t === 'summon');
    // ...the cap holds: one summon while both skeletons live
    expect(summons.length).toBeLessThanOrEqual(2);
  });
});
