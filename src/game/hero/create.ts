/** Hero construction: classes, levels, starting gear, perks, generated names. */
import type { GameState, Hero } from '../types';
import { CLASSES, NAME_BANKS, PERKS, RACES, itemDef } from '../content';
import { allocId, makeItem } from '../items/factory';
import { chance, pick, pickWeighted, rand, randInt, type Rng } from '../core/rng';
import { heroMaxHp, heroMaxMp, MORALE_START, LUCK_COINS_START, DEVOTION_START } from '../balance';
import { canEquip } from './equipment';
import { defaultTactics } from '../tactics/defaults';

export function emptyStats() {
  return {
    runs: 0,
    kills: 0,
    dmgDealt: 0,
    runDmg: 0,
    runGold: 0,
    bestRunDmg: 0,
    biggestHitTaken: 0,
    downs: 0,
    carriedOut: 0,
    rescues: 0,
  };
}

export function unlockedSkills(classId: string, level: number): string[] {
  const cls = CLASSES[classId]!;
  return cls.skillUnlocks.filter((u) => u.level <= level).map((u) => u.skillId);
}

/** the trait ids heroes can roll; kept in sync with content/banter/traits.json */
export const TRAIT_IDS = [
  'boastful',
  'gloomy',
  'cheerful',
  'greedy',
  'cowardly',
  'poetic',
  'deadpan',
  'bloodthirsty',
  'superstitious',
  'hungry',
  'motherly',
  'scholarly',
] as const;

/** typed economy flags derived from personality traits (greedy hoards their gold) */
export function ownershipFromTraits(traits: string[]): import('../types').OwnershipTraits {
  return { greedy: traits.includes('greedy') };
}

/** 2-3 distinct personality traits; loud ones are rarer by weight elsewhere */
export function rollTraits(rng: Rng): string[] {
  const pool = [...TRAIT_IDS];
  const count = 2 + (randInt(rng, 0, 99) < 40 ? 1 : 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = randInt(rng, 0, pool.length - 1);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

/** pick a race weighted by rarity off the village stream (frozen draw order) */
export function rollRace(rng: Rng): string {
  return pickWeighted(rng, Object.values(RACES), (r) => r.rarity).id;
}

export function makeHero(
  state: GameState,
  classId: string,
  name: string,
  level = 1,
  perks: string[] = [],
  traits?: string[],
  raceId?: string,
): Hero {
  const cls = CLASSES[classId]!;
  // rolled FIRST so the village-stream draw order stays reproducible
  const race = raceId ?? rollRace(state.rng.village);
  const attrs = {
    str: cls.base.str + cls.growth.str * (level - 1),
    dex: cls.base.dex + cls.growth.dex * (level - 1),
    int: cls.base.int + cls.growth.int * (level - 1),
    vit: cls.base.vit + cls.growth.vit * (level - 1),
  };
  const heroTraits = traits ?? rollTraits(state.rng.village);
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
    bombs: 0,
    gold: 0,
    satchel: [],
    raceId: race,
    morale: MORALE_START,
    faith: null,
    luckCoins: LUCK_COINS_START,
    devotion: DEVOTION_START,
    greed: 0,
    frenzyTicks: 0,
    traits: heroTraits,
    ownership: ownershipFromTraits(heroTraits),
    skills: unlockedSkills(classId, level),
    perks,
    injuries: [],
    statuses: [],
    cooldowns: {},
    activity: 'idle',
    tactics: {
      sets: defaultTactics(classId),
      activeSetId: 'default',
    },
    stats: emptyStats(),
  };
  // starting gear (auto-equipped)
  for (const defId of cls.startingItems) {
    const inst = makeItem(state, defId, level);
    const slot = itemDef(defId).slot;
    if (slot === 'weapon' || slot === 'offhand' || slot === 'armor' || slot === 'trinket') {
      hero.equipment[slot] = inst;
    }
  }
  // perk starting items go to hero equipment if the slot is free AND the class
  // can actually use them, else village inventory (the mage pawns the frying pan)
  for (const pid of perks) {
    const perk = PERKS[pid];
    if (perk?.kind === 'startingItem' && perk.item) {
      const inst = makeItem(state, perk.item, level);
      const def = itemDef(perk.item);
      const slot = def.slot;
      if (
        (slot === 'weapon' || slot === 'offhand' || slot === 'armor' || slot === 'trinket') &&
        !hero.equipment[slot] &&
        canEquip(classId, def)
      ) {
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
