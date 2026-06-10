/** Class gear rules: a mage holding a warhammer is a comedy, not a build. */
import type { ItemDef } from '../types';
import { CLASSES } from '../content';

export function canEquip(classId: string, def: ItemDef): boolean {
  const cls = CLASSES[classId];
  if (!cls) return false;
  if (def.slot === 'weapon') return cls.weaponKinds.includes(def.kind);
  if (def.slot === 'armor' || def.slot === 'offhand') return cls.armorKinds.includes(def.kind);
  if (def.slot === 'trinket') return true;
  return false;
}
