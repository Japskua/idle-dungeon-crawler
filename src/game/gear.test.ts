import { describe, expect, test } from 'bun:test';
import type { GameEvent, MonsterInstance } from './types';
import { newGame } from './newGame';
import { advanceTick } from './run/runtime';
import { makeHero } from './hero/create';
import { makeItem } from './items/factory';
import { derive } from './hero/derive';
import { canEquip } from './hero/equipment';
import { ITEMS, MONSTERS } from './content';
import { monsterMaxHp } from './balance';

const NOW = 1_750_000_000_000;

describe('class gear rules', () => {
  test('weapon and armor kinds are class-locked', () => {
    expect(canEquip('knight', ITEMS['warhammer']!)).toBe(true);
    expect(canEquip('knight', ITEMS['wand']!)).toBe(false);
    expect(canEquip('knight', ITEMS['plate_armor']!)).toBe(true);
    expect(canEquip('mage', ITEMS['plate_armor']!)).toBe(false);
    expect(canEquip('mage', ITEMS['wand']!)).toBe(true);
    expect(canEquip('mage', ITEMS['mage_robe']!)).toBe(true);
    expect(canEquip('ranger', ITEMS['crossbow']!)).toBe(true);
    expect(canEquip('ranger', ITEMS['plate_armor']!)).toBe(false);
    expect(canEquip('thief', ITEMS['dagger']!)).toBe(true);
    expect(canEquip('thief', ITEMS['warhammer']!)).toBe(false);
    expect(canEquip('cleric', ITEMS['iron_shield']!)).toBe(true);
  });

  test('EQUIP command refuses cross-class gear', () => {
    const state = newGame(61, NOW);
    const mage = makeHero(state, 'mage', 'Twig', 1, []);
    state.roster[mage.id] = mage;
    state.rosterOrder.push(mage.id);
    const hammer = makeItem(state, 'warhammer', 1);
    const wandItem = makeItem(state, 'wand', 1);
    state.village.inventory.push(hammer, wandItem);

    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: hammer.id }], NOW, []);
    expect(mage.equipment.weapon?.defId).toBe('oak_staff'); // refused

    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: wandItem.id }], NOW, []);
    expect(mage.equipment.weapon?.defId).toBe('wand'); // mages may wield wands
    expect(derive(mage).attackRange).toBe(4); // and they shoot
  });

  test('mages and archers have ranged weapons; weapon speeds differ', () => {
    expect(ITEMS['wand']!.base!.range!).toBeGreaterThan(1);
    expect(ITEMS['longbow']!.base!.range!).toBeGreaterThan(1);
    expect(ITEMS['dagger']!.base!.attackTicks!).toBeLessThan(ITEMS['warhammer']!.base!.attackTicks!);
    expect(ITEMS['shortbow']!.base!.attackTicks!).toBeLessThan(ITEMS['crossbow']!.base!.attackTicks!);
  });

  test('heavy armor raises armor rating but slows movement', () => {
    const state = newGame(62, NOW);
    const knight = makeHero(state, 'knight', 'Tank', 1, []);
    const before = derive(knight);
    knight.equipment.armor = makeItem(state, 'plate_armor', 1);
    const after = derive(knight);
    expect(after.armor).toBeGreaterThan(before.armor);
    expect(after.moveTicks).toBe(before.moveTicks + 2);
  });

  test("a thief can't keep the inherited frying pan equipped — it goes to storage", () => {
    const state = newGame(63, NOW);
    const thief = makeHero(state, 'thief', 'Fingers', 1, ['frying_pan_owner']);
    expect(thief.equipment.weapon?.defId).toBe('dagger');
    expect(state.village.inventory.some((i) => i.defId === 'frying_pan')).toBe(true);
  });
});

function injectMonster(state: ReturnType<typeof newGame>, defId: string, pos: { x: number; y: number }, aggro: boolean): MonsterInstance {
  const def = MONSTERS[defId]!;
  const m: MonsterInstance = {
    id: 'test_m1',
    defId,
    level: 1,
    elite: false,
    hp: monsterMaxHp(def.base.hp, 1, false, false),
    pos: { ...pos },
    move: null,
    targetId: null,
    aggro,
    packId: 999,
    action: null,
    statuses: [],
    cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

function waitTactics(hero: { tactics: { sets: unknown[]; activeSetId: string } }) {
  hero.tactics = {
    sets: [{ id: 'w', name: 'Wait', rules: [{ id: 'r', enabled: true, trigger: { k: 'always' }, action: { k: 'wait' } }] }],
    activeSetId: 'w',
  } as never;
}

describe('stealth', () => {
  test('a stealthed hero is invisible: no aggro, no targeting, swings whiff', () => {
    const state = newGame(64, NOW);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, []);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    for (const id of run.party.memberIds) {
      const hero = state.roster[id]!;
      waitTactics(hero);
      hero.statuses.push({ statusId: 'stealthed', ticksLeft: 400, sourceId: id });
    }
    const heroPos = run.party.pos[run.party.memberIds[0]!]!;
    const goblin = injectMonster(state, 'goblin', { x: heroPos.x + 1, y: heroPos.y }, true);

    const events: GameEvent[] = [];
    for (let i = 0; i < 60; i++) advanceTick(state, [], NOW, events);
    expect(goblin.action).toBeNull(); // nothing to swing at
    expect(events.some((e) => e.t === 'damage' && e.dst.startsWith('h'))).toBe(false);
  });

  test('attacking from the shadows always crits and breaks stealth', () => {
    const state = newGame(65, NOW);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [state.rosterOrder[0]!], startDepth: 1 }], NOW, []);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const knight = state.roster[run.party.memberIds[0]!]!;
    knight.statuses.push({ statusId: 'stealthed', ticksLeft: 4000, sourceId: knight.id });
    const heroPos = run.party.pos[knight.id]!;
    injectMonster(state, 'zombie', { x: heroPos.x + 1, y: heroPos.y }, false);

    const events: GameEvent[] = [];
    for (let i = 0; i < 200; i++) {
      advanceTick(state, [], NOW, events);
      if (events.some((e) => e.t === 'damage' && e.src === knight.id)) break;
    }
    const first = events.find((e) => e.t === 'damage' && e.src === knight.id);
    expect(first).toBeDefined();
    expect(first!.t === 'damage' && first!.crit).toBe(true); // shadow strike
    expect(knight.statuses.some((s) => s.statusId === 'stealthed')).toBe(false); // act is over
  });
});

describe('ranged enemies', () => {
  test('archers shoot from a distance (damage arrives with a far-away srcPos)', () => {
    const state = newGame(66, NOW);
    advanceTick(state, [{ t: 'EMBARK', memberIds: [state.rosterOrder[0]!], startDepth: 1 }], NOW, []);
    const run = state.run!;
    run.monsters = {};
    run.monsterOrder = [];
    const knight = state.roster[run.party.memberIds[0]!]!;
    waitTactics(knight);
    const heroPos = run.party.pos[knight.id]!;
    // place the archer 4 tiles away inside the entrance room (rooms are open floor)
    const room = run.floor.rooms[0]!;
    const spot = { x: Math.min(room.x + room.w - 1, heroPos.x + 4), y: heroPos.y };
    injectMonster(state, 'goblin_archer', spot, true);

    const events: GameEvent[] = [];
    for (let i = 0; i < 300; i++) advanceTick(state, [], NOW, events);
    const hit = events.find((e) => e.t === 'damage' && e.dst === knight.id && e.srcPos);
    expect(hit).toBeDefined();
    if (hit && hit.t === 'damage' && hit.srcPos) {
      const dist = Math.abs(hit.srcPos.x - hit.pos.x) + Math.abs(hit.srcPos.y - hit.pos.y);
      expect(dist).toBeGreaterThan(1); // shot, not stabbed
    }
  });
});
