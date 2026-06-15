import { describe, expect, test } from 'bun:test';
import type { GameEvent } from './types';
import { newGame } from './newGame';
import { advanceTick, heroSpareCapacity } from './run/runtime';
import { makeHero } from './hero/create';
import { makeItem } from './items/factory';
import { derive } from './hero/derive';
import { carryCapacity, manaRegenPerTick } from './balance';

const NOW = 1_750_000_000_000;

describe('carry weight', () => {
  test('fighters out-haul wizards, and strength raises the cap', () => {
    const state = newGame(21, NOW);
    const knight = makeHero(state, 'knight', 'Tank', 1, []);
    const mage = makeHero(state, 'mage', 'Twig', 1, []);
    expect(derive(knight).carryMax).toBeGreaterThan(derive(mage).carryMax);
    expect(carryCapacity(30, 10)).toBeGreaterThan(carryCapacity(30, 7));
  });

  test('equipment and potions weigh the pack down', () => {
    const state = newGame(22, NOW);
    const knight = makeHero(state, 'knight', 'Tank', 1, []);
    const base = derive(knight).carryUsed; // rusty sword 4 + cloth tunic 2
    expect(base).toBeCloseTo(6, 1);
    knight.potions = { hp: 3, mp: 2 };
    expect(derive(knight).carryUsed).toBeCloseTo(base + 2.5, 1);
  });

  test('EQUIP refuses loads beyond capacity (swapped item counts as freed)', () => {
    const state = newGame(23, NOW);
    const knight = makeHero(state, 'knight', 'Tank', 1, []);
    state.roster[knight.id] = knight;
    state.rosterOrder.push(knight.id);
    // knight: baseCarry 30 + str 7*2 = 44; rusty sword 4 + cloth 2 = 6 used.
    // a comical potion hoard eats most of the headroom: 60 x 0.5 = 30kg -> 36 used
    knight.potions = { hp: 60, mp: 0 };
    const shield = makeItem(state, 'iron_shield', 1); // 5.5 -> 41.5: fits
    const plate = makeItem(state, 'plate_armor', 1); // swaps cloth 2 for 12 -> 51.5: too heavy
    const ring = makeItem(state, 'lucky_ring', 1); // 0.1: fits
    state.village.inventory.push(shield, plate, ring);

    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EQUIP', heroId: knight.id, itemId: shield.id }], NOW, events);
    expect(knight.equipment.offhand?.id).toBe(shield.id);

    advanceTick(state, [{ t: 'EQUIP', heroId: knight.id, itemId: plate.id }], NOW, events);
    expect(knight.equipment.armor?.defId).toBe('cloth_tunic'); // refused, tunic kept
    expect(state.village.inventory.some((i) => i.id === plate.id)).toBe(true);

    advanceTick(state, [{ t: 'EQUIP', heroId: knight.id, itemId: ring.id }], NOW, events);
    expect(knight.equipment.trinket?.id).toBe(ring.id);
  });

  test('a full party leaves heavy loot on the floor (and says so once)', () => {
    const state = newGame(24, NOW);
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
    const run = state.run!;
    // stuff every hero's pack until nothing more fits
    for (const id of run.party.memberIds) {
      const hero = state.roster[id]!;
      while (heroSpareCapacity(hero) > 0) hero.satchel.push(makeItem(state, 'chain_mail', 1));
    }
    expect(state.roster[run.party.memberIds[0]!]!.satchel.length).toBeGreaterThan(0);

    const heroId = run.party.memberIds[0]!;
    const heavy = makeItem(state, 'war_axe', 1);
    run.groundLoot.push({ id: 'gtest', pos: { ...run.party.pos[heroId]! }, item: heavy });

    const tickEvents: GameEvent[] = [];
    advanceTick(state, [], NOW, tickEvents);
    expect(run.groundLoot.some((g) => g.item.id === heavy.id)).toBe(true); // still on the floor
    expect(tickEvents.some((e) => e.t === 'lootTooHeavy')).toBe(true);

    const again: GameEvent[] = [];
    advanceTick(state, [], NOW, again);
    expect(again.some((e) => e.t === 'lootTooHeavy')).toBe(false); // reported only once
  });
});

describe('mana regeneration', () => {
  test('mana trickles back each dungeon tick, scaling with INT', () => {
    expect(manaRegenPerTick(10)).toBeGreaterThan(manaRegenPerTick(2));
    const state = newGame(25, NOW);
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
    const run = state.run!;
    const cleric = run.party.memberIds
      .map((id) => state.roster[id]!)
      .find((h) => h.classId === 'cleric')!;
    cleric.mp = 0;
    for (let i = 0; i < 100; i++) advanceTick(state, [], NOW, []);
    const expected = manaRegenPerTick(derive(cleric).attrs.int) * 100;
    expect(cleric.mp).toBeGreaterThan(expected * 0.5); // regen happened (casts may spend some)
    expect(cleric.mp).toBeLessThanOrEqual(derive(cleric).maxMp);
  });
});
