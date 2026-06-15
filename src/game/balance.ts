/**
 * Every formula and tuning constant in one place. Retune here, re-run the
 * balance harness (`bun run balance`), commit. Nothing in this file may have
 * side effects or read state.
 */

// ---------- time ----------
export const TICK_MS = 100;
export const TICKS_PER_SECOND = 10;

// ---------- monster scaling (by rolled LEVEL, not depth) ----------
export function monsterMaxHp(baseHp: number, level: number, elite: boolean, boss: boolean): number {
  let hp = baseHp * Math.pow(1.15, level - 1);
  if (elite) hp *= ELITE_HP_MULT;
  if (boss) hp *= BOSS_HP_MULT;
  return Math.max(1, Math.round(hp));
}

export function monsterDmg(baseDmg: number, level: number, elite: boolean, boss: boolean): number {
  let dmg = baseDmg * Math.pow(1.12, level - 1);
  if (elite) dmg *= ELITE_DMG_MULT;
  if (boss) dmg *= BOSS_DMG_MULT;
  return dmg;
}

export function monsterXp(xpBase: number, level: number, elite: boolean, boss: boolean): number {
  let xp = xpBase * Math.pow(1.13, level - 1);
  if (elite) xp *= 2.5;
  if (boss) xp *= 10;
  return Math.max(1, Math.round(xp));
}

export function monsterGoldMult(level: number, boss: boolean): number {
  return Math.pow(1.1, level - 1) * (boss ? BOSS_GOLD_MULT : 1);
}

export const ELITE_HP_MULT = 3;
export const ELITE_DMG_MULT = 1.5;
export const ELITE_LEVEL_BONUS = 2;
export const BOSS_HP_MULT = 8;
export const BOSS_DMG_MULT = 2;
export const BOSS_GOLD_MULT = 15;

export function eliteChance(depth: number): number {
  return Math.min((2 + depth) / 100, 0.2);
}

// ---------- hero progression ----------
export function xpForNextLevel(level: number): number {
  return Math.round(25 * Math.pow(level, 1.55));
}

export function heroMaxHp(classBaseHp: number, vit: number): number {
  return Math.round(classBaseHp + vit * 6);
}

export function heroMaxMp(classBaseMp: number, int: number): number {
  return Math.round(classBaseMp + int * 4);
}

/** mana regenerated per tick while in the dungeon (village regen is wall-clock). */
export function manaRegenPerTick(int: number): number {
  return 0.04 + int * 0.005;
}

/** carry capacity in kg: class build plus raw strength. */
export function carryCapacity(classBaseCarry: number, str: number): number {
  return Math.round((classBaseCarry + str * 2) * 10) / 10;
}

export const POTION_WEIGHT = 0.5;

/** XP from a kill is split among living party members (each gets the share). */
export function xpShare(total: number, partySize: number): number {
  return Math.max(1, Math.ceil(total / partySize));
}

// ---------- combat ----------
export function physDamage(weaponDmg: number, str: number): number {
  return weaponDmg * (1 + str * 0.04);
}

export function spellAmount(power: number, int: number): number {
  return power * (1 + int * 0.05);
}

export function critChance(dex: number): number {
  return 0.05 + dex * 0.003;
}

export const CRIT_MULT = 1.5;
export const DMG_VARIANCE: [number, number] = [0.9, 1.1];

// ---------- morale ----------
export const MORALE_START = 10; // the optimism of a fresh contract
export const MORALE_MIN = -100;
export const MORALE_MAX = 100;
export const MORALE_BEAT_TICKS = 100; // ~10s between social cheer/jeer beats
export const MORALE_FREEZE_CHANCE = 0.15; // a Shaken hero hesitating
export const MORALE_RECOVERY_PER_SEC = 0.5; // village decay toward baseline (~30/min)
export const MORALE_RECOVERING_FLOOR = -40; // come home below this → rest your nerves

export type MoraleBand = 'panicked' | 'shaken' | 'steady' | 'confident' | 'inspired';

// ---------- religion (favor) ----------
export const FAVOR_MIN = -100;
export const FAVOR_MAX = 100;
export type FavorTier = 'forsaken' | 'scorned' | 'wary' | 'faithful' | 'exalted';
export function favorTier(favor: number): FavorTier {
  if (favor <= -61) return 'forsaken';
  if (favor <= -21) return 'scorned';
  if (favor <= 20) return 'wary';
  if (favor <= 60) return 'faithful';
  return 'exalted';
}
/** divine-intervention chance: a religion's base at +61, scaling up toward +100 */
export function resurrectP(base: number, favor: number): number {
  return base + (Math.max(61, favor) - 61) / 39 * 0.08;
}

/** per-trait morale tuning: baseline shift, gain/loss mults, band shift (sums) */
export const MORALE_TRAIT_MODS: Record<string, { baseline?: number; gainMult?: number; lossMult?: number; bandShift?: number }> = {
  cowardly: { lossMult: 1.4, bandShift: -15 }, // first to break
  bloodthirsty: { gainMult: 2.0, bandShift: 15 }, // killing streak → unstoppable
  boastful: { gainMult: 1.3, lossMult: 1.3 }, // mercurial
  gloomy: { baseline: -10, gainMult: 0.7 }, // idles a little down
  cheerful: { baseline: 10, gainMult: 1.3, lossMult: 0.8 }, // the party's engine
  deadpan: { gainMult: 0.6, lossMult: 0.6 }, // a stable anchor
  superstitious: { lossMult: 1.2 }, // rattled by omens
  motherly: { gainMult: 1.1 },
};

function moraleTraitSum(traits: string[], key: 'baseline' | 'bandShift'): number {
  let v = 0;
  for (const t of traits) v += MORALE_TRAIT_MODS[t]?.[key] ?? 0;
  return v;
}
function moraleTraitMult(traits: string[], key: 'gainMult' | 'lossMult'): number {
  let v = 1;
  for (const t of traits) v *= MORALE_TRAIT_MODS[t]?.[key] ?? 1;
  return v;
}

export function moraleBaseline(traits: string[]): number {
  return moraleTraitSum(traits, 'baseline');
}

/** the hero's current band — pure, recomputed on demand (never stored) */
export function moraleBand(morale: number, traits: string[] = []): MoraleBand {
  const m = morale + moraleTraitSum(traits, 'bandShift'); // cowardly lowers, bloodthirsty raises
  if (m < -60) return 'panicked';
  if (m < -25) return 'shaken';
  if (m <= 25) return 'steady';
  if (m <= 60) return 'confident';
  return 'inspired';
}

/** combat levers keyed off the band: additive crit, dodge chance, dmg & armor mult */
export function moraleCombatMods(band: MoraleBand): { critAdd: number; dodge: number; dmgMult: number; armorMult: number } {
  switch (band) {
    case 'panicked': return { critAdd: -0.05, dodge: 0, dmgMult: 0.8, armorMult: 0.85 };
    case 'shaken': return { critAdd: -0.02, dodge: 0, dmgMult: 0.92, armorMult: 0.95 };
    case 'confident': return { critAdd: 0.04, dodge: 0.04, dmgMult: 1.08, armorMult: 1 };
    case 'inspired': return { critAdd: 0.08, dodge: 0.08, dmgMult: 1.15, armorMult: 1.05 };
    case 'steady':
    default: return { critAdd: 0, dodge: 0, dmgMult: 1, armorMult: 1 };
  }
}

export function moraleBehavior(band: MoraleBand): { panic: boolean; timid: boolean; fearless: boolean } {
  return { panic: band === 'panicked', timid: band === 'shaken', fearless: band === 'inspired' };
}

/** scale a raw morale delta by the hero's trait gain/loss mults (and Inspired damping) */
export function scaleMorale(base: number, traits: string[], fearless: boolean): number {
  const mult = base >= 0 ? moraleTraitMult(traits, 'gainMult') : moraleTraitMult(traits, 'lossMult');
  const damp = fearless && base < 0 ? 0.6 : 1; // momentum resists loss
  return base * mult * damp;
}

export function mitigate(dmg: number, armor: number): number {
  return (dmg * 100) / (100 + Math.max(0, armor));
}

export const DEFEND_ARMOR_BONUS = 60;
export const DEFEND_TICKS = 10;
export const UNARMED = { dmg: 2, attackTicks: 12, range: 1 };

// ---------- movement ----------
export const HERO_MOVE_TICKS = 4;
export const CARRY_MOVE_PENALTY = 3;
export const RETREAT_COMMIT_TICKS = 10;

// ---------- dungeon ----------
export const FLOOR_W = 48;
export const FLOOR_H = 48;
export const BOSS_EVERY = 5;
export const ROOM_TRIES = 200;
export const ROOM_COUNT: [number, number] = [7, 11];
export const ROOM_W: [number, number] = [4, 10];
export const ROOM_H: [number, number] = [4, 7];
export const EXTRA_EDGE_CHANCE = 0.15;
export const ENGAGE_RADIUS = 7;
export const REVEAL_RADIUS = 4;
export const NEUTRALS_PER_FLOOR: [number, number] = [0, 2];
export const CHESTS_PER_FLOOR: [number, number] = [1, 3];

export function packCount(roomArea: number): number {
  return 1 + Math.floor(roomArea / 48);
}

export const PACK_SIZE: [number, number] = [1, 4];

// ---------- loot ----------
export function chestGold(depth: number, roll01: number): number {
  return Math.round((8 + depth * 6) * (0.6 + roll01 * 0.8));
}

export const CHEST_ITEM_CHANCE = 0.65;
export const CHEST_POTION_CHANCE = 0.5;

/** which item tier drops around a given depth */
export function tierForDepth(depth: number): number {
  return 1 + Math.floor(depth / 5);
}

// ---------- death, injuries, recovery ----------
export function permadeathChanceOnWipe(depth: number): number {
  return Math.min((25 + depth) / 100, 0.5);
}

export const PERMADEATH_ON_ABANDON = 0.5;
export const INJURIES_ON_WIPE = 2;
export const INJURIES_ON_CARRIED_OUT = 1;

/** the party automatically falls back when a member goes down (idle-friendly default) */
export const AUTO_WITHDRAW_ON_DOWNED = true;

/** village HP recovery: fraction of maxHp per second of wall-clock time. */
export const RECOVERY_HP_FRACTION_PER_SEC = 1 / 60;

// ---------- village economy ----------
export const STARTING_GOLD = 60;
export const POTION_PRICES: Record<'hp' | 'mp', number> = { hp: 12, mp: 15 };

// ---------- bombs ----------
// ---------- dungeon events ----------
export const EVENT_ROOM_CHANCE = 0.16;    // chance a freshly-entered room sparks an event
export const EVENT_TIMEOUT_TICKS = 150;   // 15s for the player to choose before the default auto-fires

export const BOMB_PRICE = 25;
export const BOMB_WEIGHT = 1.0;
/** raw blast damage before armor; explosions spare NO ONE in the radius */
export const BOMB_DAMAGE = 26;
export const BOMB_RADIUS = 2;
export const BOMB_RANGE = 4;
export const BOMB_THROW_TICKS = 8;
export const SELL_VALUE_FRACTION = 0.4;
export const SHOP_STOCK_SIZE = 6;
export const TAVERN_RECRUITS = 6;

export function hireCost(baseCost: number, level: number, perkValueAdjust: number): number {
  return Math.max(10, Math.round(baseCost * Math.pow(1.4, level - 1) * (1 + perkValueAdjust)));
}

export function healInjuryCost(healCostBase: number, severity: number, heroLevel: number): number {
  return Math.round(healCostBase * severity * (1 + heroLevel * 0.25));
}

/** Magician's Guild: pay to learn a class skill before its unlock level. */
export function learnSkillCost(unlockLevel: number, levelsEarly: number): number {
  return Math.round(30 * unlockLevel * (1 + 0.5 * Math.max(0, levelsEarly)));
}

export function instantHealCost(missingHp: number): number {
  return Math.max(1, Math.round(missingHp * 0.3));
}


// ---------- rarity ----------
export function rarityWeights(depth: number): { common: number; magic: number; rare: number; epic: number } {
  return {
    common: 100,
    magic: 18 + depth * 2,
    rare: 4 + depth,
    epic: Math.max(0, depth - 4) * 0.6,
  };
}

export const AFFIX_COUNT: Record<'common' | 'magic' | 'rare' | 'epic', [number, number]> = {
  common: [0, 0],
  magic: [1, 1],
  rare: [1, 2],
  epic: [2, 3],
};
