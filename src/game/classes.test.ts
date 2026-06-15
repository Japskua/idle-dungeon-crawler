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

describe('the eighteen classes', () => {
  test('all class skill unlocks, starting items, and gear rules are coherent', () => {
    expect(Object.keys(CLASSES).length).toBe(18);
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
  test('killing an enemy near the necromancer drops a corpse into the pool', () => {
    const { state, hero } = soloRun(73, 'necromancer', 3);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    run.corpses = [];
    const heroPos = run.party.pos[hero.id]!;
    const foe = injectHostile(state, 'zombie', { x: heroPos.x + 2, y: heroPos.y });
    foe.hp = 1; // one poke and it's a corpse

    for (let i = 0; i < 200; i++) {
      advanceTick(state, [], NOW, []);
      if ((run.corpses?.length ?? 0) > 0) break;
    }
    expect((run.corpses?.length ?? 0)).toBeGreaterThan(0);
    expect(run.corpses![0]!.defId).toBe('zombie');
  });

  test('reanimate raises the fallen (strongest first, within budget), who fight then crumble', () => {
    const { state, hero } = soloRun(72, 'necromancer', 3); // budget = 6 undead-levels
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const heroPos = run.party.pos[hero.id]!;
    const foe = injectHostile(state, 'zombie', { x: heroPos.x + 3, y: heroPos.y });
    // a pool with more corpse-levels than the budget can hold (6): highest fit first
    run.corpses = [
      { defId: 'rat', level: 1, elite: false },
      { defId: 'zombie', level: 5, elite: false },
      { defId: 'skeleton', level: 4, elite: false },
    ];

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
    expect(summoned).toBeGreaterThan(0);
    const minions = run.monsterOrder.filter((id) => run.monsters[id]!.summonedBy === hero.id);
    // budget 6: takes the L5 corpse (cost 5), the L4 won't fit (5+4>6), L1 fits (5+1=6)
    const cost = minions.reduce((s, id) => s + (run.monsters[id]!.summonCost ?? 0), 0);
    expect(cost).toBeLessThanOrEqual(6);
    expect(run.monsters[minions[0]!]!.summonCost).toBe(5); // strongest corpse raised first

    // they fight: a minion lands a hit on the zombie (or finishes it)
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

  test('the undead budget holds: raised levels never exceed 2× the necromancer level', () => {
    const { state, hero } = soloRun(74, 'necromancer', 3); // budget = 6
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const heroPos = run.party.pos[hero.id]!;
    const foe = injectHostile(state, 'zombie', { x: heroPos.x + 4, y: heroPos.y });
    foe.hp = 9999; // never dies — keep the fight on so reanimate stays feasible

    let maxCost = 0;
    for (let i = 0; i < 600; i++) {
      advanceTick(state, [], NOW, []);
      // keep an overflowing corpse pool and the skill always ready
      run.corpses = [
        { defId: 'rat', level: 1, elite: false },
        { defId: 'rat', level: 1, elite: false },
        { defId: 'zombie', level: 3, elite: false },
        { defId: 'skeleton', level: 2, elite: false },
      ];
      hero.cooldowns['reanimate_fallen'] = 0;
      hero.mp = 50;
      const cost = run.monsterOrder
        .filter((id) => run.monsters[id]!.summonedBy === hero.id)
        .reduce((s, id) => s + (run.monsters[id]!.summonCost ?? 0), 0);
      maxCost = Math.max(maxCost, cost);
    }
    expect(maxCost).toBeGreaterThan(0); // it did raise an army
    expect(maxCost).toBeLessThanOrEqual(6); // ...but never past the budget
  });
});
