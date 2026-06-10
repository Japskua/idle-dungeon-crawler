/** Hero construction: classes, levels, starting gear, perks, generated names. */
import type { GameState, Hero } from '../types';
import { CLASSES, NAME_BANKS, PERKS, itemDef } from '../content';
import { allocId, makeItem } from '../items/factory';
import { chance, pick, pickWeighted, rand, type Rng } from '../core/rng';
import { heroMaxHp, heroMaxMp } from '../balance';

export function unlockedSkills(classId: string, level: number): string[] {
  const cls = CLASSES[classId]!;
  return cls.skillUnlocks.filter((u) => u.level <= level).map((u) => u.skillId);
}

export function makeHero(state: GameState, classId: string, name: string, level = 1, perks: string[] = []): Hero {
  const cls = CLASSES[classId]!;
  const attrs = {
    str: cls.base.str + cls.growth.str * (level - 1),
    dex: cls.base.dex + cls.growth.dex * (level - 1),
    int: cls.base.int + cls.growth.int * (level - 1),
    vit: cls.base.vit + cls.growth.vit * (level - 1),
  };
  const hero: Hero = {
    id: allocId(state, 'h'),
    name,
    classId,
    level,
    xp: 0,
    hp: 0,
    mp: 0,
    attrs,
    equipment: {},
    potions: { hp: 0, mp: 0 },
    skills: unlockedSkills(classId, level),
    perks,
    injuries: [],
    statuses: [],
    cooldowns: {},
    activity: 'idle',
    tactics: {
      sets: [{ id: 'default', name: 'Default', rules: [] }],
      activeSetId: 'default',
    },
  };
  // starting gear (auto-equipped)
  for (const defId of cls.startingItems) {
    const inst = makeItem(state, defId, level);
    const slot = itemDef(defId).slot;
    if (slot === 'weapon' || slot === 'offhand' || slot === 'armor' || slot === 'trinket') {
      hero.equipment[slot] = inst;
    }
  }
  // perk starting items go to hero equipment if the slot is free, else village inventory
  for (const pid of perks) {
    const perk = PERKS[pid];
    if (perk?.kind === 'startingItem' && perk.item) {
      const inst = makeItem(state, perk.item, level);
      const slot = itemDef(perk.item).slot;
      if ((slot === 'weapon' || slot === 'offhand' || slot === 'armor' || slot === 'trinket') && !hero.equipment[slot]) {
        hero.equipment[slot] = inst;
      } else {
        state.village.inventory.push(inst);
      }
    }
  }
  hero.hp = heroMaxHp(cls.baseHp, attrs.vit);
  hero.mp = heroMaxMp(cls.baseMp, attrs.int);
  return hero;
}

export function generateName(rng: Rng): string {
  const banks = NAME_BANKS;
  if (chance(rng, banks.funnyChance) && banks.funnyNames.length > 0) {
    return pick(rng, banks.funnyNames);
  }
  let name = pick(rng, banks.firstSyllables) + pick(rng, banks.lastSyllables);
  if (chance(rng, banks.epithetChance) && banks.epithets.length > 0) {
    name += ' ' + pick(rng, banks.epithets);
  }
  return name;
}

/** perk roll for tavern recruits: {0: 25%, 1: 45%, 2: 25%, 3: 5%}, no duplicates */
export function rollPerks(rng: Rng): string[] {
  const r = rand(rng);
  const count = r < 0.25 ? 0 : r < 0.7 ? 1 : r < 0.95 ? 2 : 3;
  const pool = Object.values(PERKS).sort((a, b) => a.id.localeCompare(b.id));
  const out: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const perk = pickWeighted(rng, pool.filter((p) => !out.includes(p.id)), (p) => p.weight);
    out.push(perk.id);
  }
  return out;
}

/** net perk value: positive perks make a recruit pricier, negative cheaper */
export function perkValueAdjust(perks: string[]): number {
  let adj = 0;
  for (const pid of perks) {
    const perk = PERKS[pid];
    if (!perk) continue;
    if (perk.polarity === 'positive') adj += perk.kind === 'startingItem' ? 0.1 : 0.15;
    if (perk.polarity === 'negative') adj -= 0.15;
  }
  return adj;
}
