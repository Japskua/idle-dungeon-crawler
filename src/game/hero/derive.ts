/**
 * Effective stats: class attrs + equipment + perks + injuries + statuses.
 * Computed on demand — never stored in GameState.
 */
import type { Attributes, Hero, StatMod } from '../types';
import { CLASSES, INJURIES, PERKS, STATUSES, itemDef } from '../content';
import { HERO_MOVE_TICKS, UNARMED, critChance, heroMaxHp, heroMaxMp } from '../balance';

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
}

const EQUIP_SLOTS = ['weapon', 'offhand', 'armor', 'trinket'] as const;
const ATTR_KEYS = ['str', 'dex', 'int', 'vit'] as const;

export function derive(hero: Hero): DerivedStats {
  const cls = CLASSES[hero.classId]!;
  const attrs: Attributes = { ...hero.attrs };
  const mods: StatMod[] = [];

  let armor = 0;
  let weaponDmg = UNARMED.dmg;
  let attackTicks = UNARMED.attackTicks;
  let attackRange = UNARMED.range;

  for (const slot of EQUIP_SLOTS) {
    const inst = hero.equipment[slot];
    if (!inst) continue;
    const def = itemDef(inst.defId);
    armor += def.base?.armor ?? 0;
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

  for (const pid of hero.perks) mods.push(...(PERKS[pid]?.mods ?? []));
  for (const iid of hero.injuries) mods.push(...(INJURIES[iid]?.mods ?? []));
  for (const st of hero.statuses) mods.push(...(STATUSES[st.statusId]?.mods ?? []));

  let dmgMult = 1;
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
    weaponDmg,
    attackTicks,
    attackRange,
    armor,
    dmgMult,
    xpMult,
    goldMult,
    critChance: critChance(attrs.dex),
    moveTicks: Math.max(1, Math.round(HERO_MOVE_TICKS / speedMult)),
  };
}
