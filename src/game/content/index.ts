/**
 * Content registry: merges codegen output (content/*.json) with TS data modules.
 * All lookups go through here; validateContent() cross-checks every reference
 * and is asserted empty by a test.
 */
import { BANTER } from './gen/banter.gen';
import { MONSTERS } from './gen/monsters.gen';
import { NEUTRALS } from './gen/neutrals.gen';
import { ITEMS } from './gen/items.gen';
import { PERKS } from './gen/perks.gen';
import { TILES } from './gen/tiles.gen';
import { NAME_BANKS } from './gen/names.gen';
import { PALETTE } from './gen/palette.gen';
import { CLASSES } from './classes';
import { RACES } from './races';
import { DUNGEON_EVENTS } from './events';
import { SKILLS } from './skills';
import { STATUSES } from './statuses';
import { INJURIES } from './injuries';
import { CHORES } from './chores';
import type { ClassDef, ItemDef, MonsterDef, SkillDef, InjuryDef, PerkDef, ChoreDef, StatusDef, RaceDef } from '../types';

export { MONSTERS, NEUTRALS, ITEMS, PERKS, TILES, NAME_BANKS, PALETTE, CLASSES, SKILLS, STATUSES, INJURIES, CHORES, BANTER, RACES, DUNGEON_EVENTS };

function lookup<T>(table: Record<string, T>, id: string, kind: string): T {
  const def = table[id];
  if (!def) throw new Error(`unknown ${kind} def: ${id}`);
  return def;
}

/** hostile monsters and neutrals share the MonsterDef shape and instance pool */
export function creatureDef(id: string): MonsterDef {
  const def = MONSTERS[id] ?? NEUTRALS[id];
  if (!def) throw new Error(`unknown creature def: ${id}`);
  return def;
}

export const itemDef = (id: string): ItemDef => lookup(ITEMS, id, 'item');
export const classDef = (id: string): ClassDef => lookup(CLASSES, id, 'class');
export const skillDef = (id: string): SkillDef => lookup(SKILLS, id, 'skill');
export const statusDef = (id: string): StatusDef => lookup(STATUSES, id, 'status');
export const injuryDef = (id: string): InjuryDef => lookup(INJURIES, id, 'injury');
export const perkDef = (id: string): PerkDef => lookup(PERKS, id, 'perk');
export const choreDef = (id: string): ChoreDef => lookup(CHORES, id, 'chore');

export function validateContent(): string[] {
  const problems: string[] = [];
  for (const c of Object.values(CLASSES)) {
    for (const it of c.startingItems) {
      if (!ITEMS[it]) problems.push(`class ${c.id}: starting item '${it}' missing`);
    }
    for (const u of c.skillUnlocks) {
      if (!SKILLS[u.skillId]) problems.push(`class ${c.id}: skill '${u.skillId}' missing`);
    }
  }
  for (const m of [...Object.values(MONSTERS), ...Object.values(NEUTRALS)]) {
    for (const s of m.skills) if (!SKILLS[s]) problems.push(`creature ${m.id}: skill '${s}' missing`);
    for (const d of m.drops) if (!ITEMS[d.item]) problems.push(`creature ${m.id}: drop '${d.item}' missing`);
  }
  for (const p of Object.values(PERKS)) {
    if (p.kind === 'startingItem' && (!p.item || !ITEMS[p.item])) {
      problems.push(`perk ${p.id}: starting item '${p.item}' missing`);
    }
  }
  for (const s of Object.values(SKILLS)) {
    for (const a of s.applies ?? []) {
      if (!STATUSES[a.statusId]) problems.push(`skill ${s.id}: status '${a.statusId}' missing`);
    }
    if (s.summon) {
      const def = MONSTERS[s.summon.defId] ?? NEUTRALS[s.summon.defId];
      if (!def) problems.push(`skill ${s.id}: summon def '${s.summon.defId}' missing`);
      else if (!def.summonOnly) problems.push(`skill ${s.id}: summon def '${s.summon.defId}' must be summonOnly`);
    }
  }
  for (let depth = 1; depth <= 30; depth++) {
    const any = Object.values(MONSTERS).some((m) =>
      m.spawn.some((b) => b.depths[0] <= depth && depth <= b.depths[1]),
    );
    if (!any) problems.push(`no hostile spawns cover depth ${depth}`);
  }
  const ids = new Set<string>();
  for (const table of [MONSTERS, NEUTRALS, ITEMS, PERKS, INJURIES, CLASSES, SKILLS, CHORES]) {
    for (const id of Object.keys(table)) {
      if (ids.has(id)) problems.push(`duplicate content id across kinds: ${id}`);
      ids.add(id);
    }
  }
  return problems;
}
