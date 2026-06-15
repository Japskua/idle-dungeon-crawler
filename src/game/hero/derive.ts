/**
 * Effective stats: class attrs + equipment + perks + injuries + statuses.
 * Computed on demand — never stored in GameState.
 */
import type { Attributes, Hero, StatMod } from '../types';
import { CLASSES, INJURIES, PERKS, RACES, STATUSES, itemDef } from '../content';
import {
  BOMB_WEIGHT, HERO_MOVE_TICKS, POTION_WEIGHT, UNARMED, carryCapacity, critChance, heroMaxHp, heroMaxMp,
  moraleBand, moraleCombatMods,
} from '../balance';

export interface DerivedStats {
  attrs: Attributes;
  maxHp: number;
  maxMp: number;
  weaponDmg: number;
  attackTicks: number;
  attackRange: number;
  armor: number;
  dmgMult: number;
  xpMult: number;
  goldMult: number;
  critChance: number;
  moveTicks: number;
  /** kg the hero can carry (class build + strength) */
  carryMax: number;
  /** kg currently on their back: equipment + carried potions */
  carryUsed: number;
}

const EQUIP_SLOTS = ['weapon', 'offhand', 'armor', 'trinket'] as const;
const ATTR_KEYS = ['str', 'dex', 'int', 'vit'] as const;

export function derive(hero: Hero): DerivedStats {
  const cls = CLASSES[hero.classId]!;
  const attrs: Attributes = { ...hero.attrs };
  const mods: StatMod[] = [];

  let armor = 0;
  // weaponless classes (monks, mimes) grow their fists with every level
  let weaponDmg = cls.unarmed ? cls.unarmed.baseDmg + cls.unarmed.dmgPerLevel * hero.level : UNARMED.dmg;
  let attackTicks = cls.unarmed ? cls.unarmed.attackTicks : UNARMED.attackTicks;
  let attackRange = UNARMED.range;
  let carryUsed = (hero.potions.hp + hero.potions.mp) * POTION_WEIGHT + hero.bombs * BOMB_WEIGHT;
  for (const it of hero.satchel) carryUsed += itemDef(it.defId).weight ?? 0;
  let gearMoveTicks = 0;

  for (const slot of EQUIP_SLOTS) {
    const inst = hero.equipment[slot];
    if (!inst) continue;
    const def = itemDef(inst.defId);
    armor += def.base?.armor ?? 0;
    carryUsed += def.weight ?? 0;
    gearMoveTicks += def.base?.moveTicks ?? 0; // heavy armor protects but slows
    if (slot === 'weapon') {
      weaponDmg = def.base?.dmg ?? UNARMED.dmg;
      attackTicks = def.base?.attackTicks ?? UNARMED.attackTicks;
      attackRange = def.base?.range ?? UNARMED.range;
    }
    const stats = def.base?.stats;
    if (stats) {
      for (const k of ATTR_KEYS) attrs[k] += stats[k] ?? 0;
    }
    for (const affix of inst.affixes) mods.push(...affix.mods);
  }

  const race = RACES[hero.raceId];
  if (race) mods.push(...race.mods);
  if (race?.armorFlat) armor += race.armorFlat;
  for (const pid of hero.perks) mods.push(...(PERKS[pid]?.mods ?? []));
  for (const iid of hero.injuries) mods.push(...(INJURIES[iid]?.mods ?? []));
  for (const st of hero.statuses) mods.push(...(STATUSES[st.statusId]?.mods ?? []));

  const mm = moraleCombatMods(moraleBand(hero.morale, hero.traits));
  let dmgMult = mm.dmgMult;
  let xpMult = 1;
  let goldMult = 1;
  let maxhpMult = 1;
  let speedMult = 1;
  for (const m of mods) {
    if (m.kind === 'attr') {
      attrs[m.attr] += m.add;
    } else {
      switch (m.what) {
        case 'dmg': dmgMult *= m.mul; break;
        case 'xp': xpMult *= m.mul; break;
        case 'gold': goldMult *= m.mul; break;
        case 'maxhp': maxhpMult *= m.mul; break;
        case 'speed': speedMult *= m.mul; break;
      }
    }
  }
  for (const k of ATTR_KEYS) attrs[k] = Math.max(0, attrs[k]);

  return {
    attrs,
    maxHp: Math.max(1, Math.round(heroMaxHp(cls.baseHp, attrs.vit) * maxhpMult)),
    maxMp: Math.max(0, heroMaxMp(cls.baseMp, attrs.int)),
    weaponDmg: Math.round(weaponDmg * 10) / 10,
    attackTicks,
    attackRange,
    armor: Math.round(armor * mm.armorMult),
    dmgMult,
    xpMult,
    goldMult,
    critChance: Math.max(0, critChance(attrs.dex) + (race?.critBonus ?? 0) + mm.critAdd),
    moveTicks: Math.max(1, Math.round(HERO_MOVE_TICKS / speedMult) + gearMoveTicks),
    carryMax: carryCapacity(cls.baseCarry, attrs.str) * (race?.carryMult ?? 1),
    carryUsed: Math.round(carryUsed * 10) / 10,
  };
}
