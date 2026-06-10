/**
 * Item instancing and loot rolls. All randomness comes from rng.loot so drops
 * are reproducible. ilvl = the monster level / depth the item appeared at.
 */
import type { GameState, ItemInstance, MonsterDef, Rarity } from '../types';
import { chance, pick, pickWeighted, rand, randInt, type Rng } from '../core/rng';
import { AFFIX_COUNT, CHEST_ITEM_CHANCE, CHEST_POTION_CHANCE, chestGold, rarityWeights, tierForDepth } from '../balance';
import { ITEMS } from '../content';

export function allocId(state: GameState, prefix: string): string {
  return `${prefix}${(state.nextId++).toString(36)}`;
}

export function makeItem(state: GameState, defId: string, ilvl = 1, rarity: Rarity = 'common'): ItemInstance {
  return { id: allocId(state, 'i'), defId, rarity, affixes: rollAffixes(state.rng.loot, rarity, ilvl), ilvl };
}

/** Affix pool is intentionally tiny pre-M5; expanded with rarity content later. */
function rollAffixes(rng: Rng, rarity: Rarity, ilvl: number) {
  const [lo, hi] = AFFIX_COUNT[rarity];
  const count = lo === hi ? lo : randInt(rng, lo, hi);
  const out = [];
  const mag = Math.max(1, Math.floor(ilvl / 4) + 1);
  for (let i = 0; i < count; i++) {
    const roll = randInt(rng, 0, 3);
    if (roll === 0) out.push({ id: 'of_strength', name: 'of Strength', mods: [{ kind: 'attr', attr: 'str', add: mag } as const] });
    else if (roll === 1) out.push({ id: 'of_agility', name: 'of Agility', mods: [{ kind: 'attr', attr: 'dex', add: mag } as const] });
    else if (roll === 2) out.push({ id: 'of_wisdom', name: 'of Wisdom', mods: [{ kind: 'attr', attr: 'int', add: mag } as const] });
    else out.push({ id: 'of_vigor', name: 'of Vigor', mods: [{ kind: 'attr', attr: 'vit', add: mag } as const] });
  }
  return out;
}

export function rollRarity(rng: Rng, depth: number): Rarity {
  const w = rarityWeights(depth);
  const entries: [Rarity, number][] = [
    ['common', w.common],
    ['magic', w.magic],
    ['rare', w.rare],
    ['epic', w.epic],
  ];
  return pickWeighted(rng, entries, (e) => e[1])[0];
}

/** roll a monster's drop table; returns instanced items */
export function rollDrops(state: GameState, def: MonsterDef, level: number, guaranteeMagic: boolean): ItemInstance[] {
  const rng = state.rng.loot;
  const out: ItemInstance[] = [];
  for (const entry of def.drops) {
    if (!chance(rng, entry.chance)) continue;
    const qty = entry.qty ? randInt(rng, entry.qty[0], entry.qty[1]) : 1;
    for (let i = 0; i < qty; i++) {
      const itemDef = ITEMS[entry.item]!;
      const equipable = ['weapon', 'offhand', 'armor', 'trinket'].includes(itemDef.slot);
      const rarity = equipable ? rollRarity(rng, level) : 'common';
      out.push(makeItem(state, entry.item, level, rarity));
    }
  }
  if (guaranteeMagic && !out.some((i) => i.rarity !== 'common')) {
    const equipables = equipableDefsForTier(tierForDepth(level));
    if (equipables.length > 0) {
      out.push(makeItem(state, pick(rng, equipables), level, 'magic'));
    }
  }
  return out;
}

function equipableDefsForTier(tier: number): string[] {
  return Object.values(ITEMS)
    .filter((d) => ['weapon', 'offhand', 'armor', 'trinket'].includes(d.slot) && d.tier <= tier)
    .map((d) => d.id)
    .sort();
}

export interface ChestLoot {
  gold: number;
  items: ItemInstance[];
}

export function rollChestLoot(state: GameState, depth: number): ChestLoot {
  const rng = state.rng.loot;
  const gold = chestGold(depth, rand(rng));
  const items: ItemInstance[] = [];
  if (chance(rng, CHEST_ITEM_CHANCE)) {
    const defs = equipableDefsForTier(tierForDepth(depth));
    if (defs.length > 0) {
      items.push(makeItem(state, pick(rng, defs), depth, rollRarity(rng, depth)));
    }
  }
  if (chance(rng, CHEST_POTION_CHANCE)) {
    items.push(makeItem(state, chance(rng, 0.7) ? 'hp_potion_s' : 'mp_potion_s', depth));
  }
  return { gold, items };
}
