import { describe, expect, test } from 'bun:test';
import type { GameEvent } from './types';
import { newGame } from './newGame';
import { advanceTick, lootBagWeight, partySpareCapacity } from './run/runtime';
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
    const mage = makeHero(state, 'mage', 'Twig', 1, []);
    state.roster[mage.id] = mage;
    state.rosterOrder.push(mage.id);
    // mage: baseCarry 12 + str 2*2 = 16; oak staff 3 equipped
    const mail = makeItem(state, 'chain_mail', 1); // 7 kg
    const shield = makeItem(state, 'iron_shield', 1); // 5.5 kg -> 15.5 total: fits
    const ring = makeItem(state, 'lucky_ring', 1); // 0.1 -> 15.6: fits
    const axe = makeItem(state, 'war_axe', 1); // swaps 3kg staff for 6kg axe -> 18.6: too heavy
    state.village.inventory.push(mail, shield, ring, axe);

    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: mail.id }], NOW, events);
    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: shield.id }], NOW, events);
    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: ring.id }], NOW, events);
    expect(mage.equipment.armor?.id).toBe(mail.id);
    expect(mage.equipment.offhand?.id).toBe(shield.id);
    expect(mage.equipment.trinket?.id).toBe(ring.id);

    advanceTick(state, [{ t: 'EQUIP', heroId: mage.id, itemId: axe.id }], NOW, events);
    expect(mage.equipment.weapon?.defId).toBe('oak_staff'); // refused, staff kept
    expect(state.village.inventory.some((i) => i.id === axe.id)).toBe(true);
  });

  test('a full party leaves heavy loot on the floor (and says so once)', () => {
    const state = newGame(24, NOW);
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
    const run = state.run!;
    // stuff the bag until nothing fits
    while (partySpareCapacity(state, run) > 0) {
      run.party.lootBag.push(makeItem(state, 'chain_mail', 1));
    }
    expect(lootBagWeight(run)).toBeGreaterThan(0);

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
