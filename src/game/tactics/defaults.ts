/**
 * Default tactic sets per class. A fresh hero behaves believably with zero
 * configuration — the editor is an optimization tool, not homework. Every class
 * ships at least THREE named sets the player can switch between on the fly:
 * a balanced signature, an Aggressive all-out, and a defensive Cautious;
 * healers/supports get a fourth Triage set that puts allies first.
 */
import type { TacticRule, TacticSet } from '../types';

let n = 0;
function rule(trigger: TacticRule['trigger'], action: TacticRule['action']): TacticRule {
  return { id: `dr${n++}`, enabled: true, trigger, action };
}

function set(id: string, name: string, rules: TacticRule[]): TacticSet {
  return { id, name, rules };
}

/** the balanced signature set — how the class plays by default */
function mainSet(classId: string): TacticSet {
  switch (classId) {
    case 'knight':
      return set('default', 'Frontline', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'taunt' }),
        rule({ k: 'inMeleeRange' }, { k: 'castSkill', skillId: 'shield_bash' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'cleric':
      return set('default', 'Shepherd', [
        rule({ k: 'selfHpBelow', pct: 30 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 65 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'selfHpBelow', pct: 70 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'smite' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'ranger':
      return set('default', 'Skirmisher', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'inMeleeRange' }, { k: 'retreat' }),
        rule({ k: 'skillReady', skillId: 'power_shot' }, { k: 'castSkill', skillId: 'power_shot' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'mage':
      return set('default', 'Artillery', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'inMeleeRange' }, { k: 'retreat' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'fireball' }),
        rule({ k: 'selfMpAbove', pct: 25 }, { k: 'castSkill', skillId: 'fireball' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'thief':
      return set('default', 'Cutpurse', [
        rule({ k: 'selfHpBelow', pct: 40 }, { k: 'castSkill', skillId: 'vanish' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'skillReady', skillId: 'backstab' }, { k: 'castSkill', skillId: 'backstab' }),
        rule({ k: 'enemiesAtLeast', n: 3 }, { k: 'castSkill', skillId: 'vanish' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'necromancer':
      return set('default', 'Gravecaller', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'reanimate_fallen' }),
        rule({ k: 'inMeleeRange' }, { k: 'retreat' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'soul_bolt' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'priest':
      return set('default', 'Devout', [
        rule({ k: 'selfHpBelow', pct: 30 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyDowned' }, { k: 'castSkill', skillId: 'divine_intervention' }),
        rule({ k: 'allyHpBelow', pct: 60 }, { k: 'castSkill', skillId: 'sanctify' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'blessing_of_faith' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'searing_judgment' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'grave_robber':
      return set('default', 'Tomb Raider', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'tomb_sense' }),
        rule({ k: 'skillReady', skillId: 'smash_and_grab' }, { k: 'castSkill', skillId: 'smash_and_grab' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'gambler':
      return set('default', 'Card Sharp', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'loaded_dice' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'all_in' }),
        rule({ k: 'skillReady', skillId: 'double_or_nothing' }, { k: 'castSkill', skillId: 'double_or_nothing' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'summoner':
      return set('default', 'Menagerist', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'spirit_wolves' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'summon_stone_golem' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'conjure_imps' }),
        rule({ k: 'inMeleeRange' }, { k: 'retreat' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'barbarian':
      return set('default', 'Headfirst', [
        rule({ k: 'selfHpBelow', pct: 30 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'rage' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'whirlwind' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'monk':
      return set('default', 'Open Palm', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemyIsElite' }, { k: 'castSkill', skillId: 'iron_palm' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'flurry' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'paladin':
      return set('default', 'Bulwark', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 50 }, { k: 'castSkill', skillId: 'holy_light' }),
        rule({ k: 'selfHpBelow', pct: 60 }, { k: 'castSkill', skillId: 'holy_light' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'smite' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'druid':
      return set('default', 'Verdant', [
        rule({ k: 'selfHpBelow', pct: 30 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 70 }, { k: 'castSkill', skillId: 'regrowth' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'thorn_lash' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'bard':
      return set('default', 'Headliner', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'blessing' }),
        rule({ k: 'allyHpBelow', pct: 50 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'chef':
      return set('default', 'Service!', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 60 }, { k: 'castSkill', skillId: 'soup_toss' }),
        rule({ k: 'enemiesAtLeast', n: 3 }, { k: 'castSkill', skillId: 'flambe' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'mime':
      return set('default', 'In the Box', [
        rule({ k: 'selfHpBelow', pct: 40 }, { k: 'castSkill', skillId: 'invisible_box' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'mock_swing' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'beekeeper':
      return set('default', 'The Hive', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'release_the_bees' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'smoke_puff' }),
        rule({ k: 'inMeleeRange' }, { k: 'retreat' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    default:
      return set('default', 'Balanced', [
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
  }
}

/** all-out: hoard potions to the brink, lead with the biggest hits, never flee */
function aggressiveSet(classId: string): TacticSet {
  const a = (name: string, rules: TacticRule[]) => set('aggressive', name, rules);
  const lastDitch = rule({ k: 'selfHpBelow', pct: 20 }, { k: 'usePotion', potion: 'hp' });
  switch (classId) {
    case 'knight':
      return a('No Quarter', [
        lastDitch,
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'taunt' }),
        rule({ k: 'inMeleeRange' }, { k: 'castSkill', skillId: 'shield_bash' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'cleric':
      return a('Wrath of the Flock', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 35 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'smite' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'ranger':
      return a('Hawkeye', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'skillReady', skillId: 'power_shot' }, { k: 'castSkill', skillId: 'power_shot' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'mage':
      return a('Glass Cannon', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'fireball' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'thief':
      return a('Throat-Cutter', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'skillReady', skillId: 'backstab' }, { k: 'castSkill', skillId: 'backstab' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'necromancer':
      return a('Bone Storm', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'reanimate_fallen' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'soul_bolt' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'priest':
      return a('Holy Wrath', [
        rule({ k: 'selfHpBelow', pct: 22 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyDowned' }, { k: 'castSkill', skillId: 'divine_intervention' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'blessing_of_faith' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'searing_judgment' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'grave_robber':
      return a('Smash and Grab', [
        lastDitch,
        rule({ k: 'skillReady', skillId: 'smash_and_grab' }, { k: 'castSkill', skillId: 'smash_and_grab' }),
        rule({ k: 'skillReady', skillId: 'pocket_it' }, { k: 'castSkill', skillId: 'pocket_it' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'gambler':
      return a('High Roller', [
        lastDitch,
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'loaded_dice' }),
        rule({ k: 'skillReady', skillId: 'jackpot' }, { k: 'castSkill', skillId: 'jackpot' }),
        rule({ k: 'skillReady', skillId: 'all_in' }, { k: 'castSkill', skillId: 'all_in' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'double_or_nothing' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'summoner':
      return a('Open Every Cage', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'spirit_wolves' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'conjure_imps' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'menagerie_unleashed' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'barbarian':
      return a('Bloodrage', [
        lastDitch,
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'rage' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'whirlwind' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'monk':
      return a('Thunderfist', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'skillReady', skillId: 'iron_palm' }, { k: 'castSkill', skillId: 'iron_palm' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'flurry' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'paladin':
      return a('Avenger', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 35 }, { k: 'castSkill', skillId: 'holy_light' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'smite' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'druid':
      return a('Wild Fury', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'allyHpBelow', pct: 40 }, { k: 'castSkill', skillId: 'regrowth' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'thorn_lash' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'bard':
      return a('Crescendo', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'blessing' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'chef':
      return a('Flambé Everything', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'flambe' }),
        rule({ k: 'allyHpBelow', pct: 40 }, { k: 'castSkill', skillId: 'soup_toss' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'mime':
      return a('Silent Fury', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'mock_swing' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'beekeeper':
      return a('Swarm Assault', [
        rule({ k: 'selfHpBelow', pct: 25 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'enemiesAtLeast', n: 1 }, { k: 'castSkill', skillId: 'release_the_bees' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'smoke_puff' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    default:
      return a('All-Out', [lastDitch, rule({ k: 'always' }, { k: 'attack' })]);
  }
}

/** allies first — heal/support over offense (only for classes that can) */
function triageSet(classId: string): TacticSet | null {
  const t = (name: string, rules: TacticRule[]) => set('triage', name, rules);
  switch (classId) {
    case 'cleric':
      return t('Triage', [
        rule({ k: 'allyHpBelow', pct: 75 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'selfHpBelow', pct: 60 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'paladin':
      return t('Lay on Hands', [
        rule({ k: 'allyHpBelow', pct: 70 }, { k: 'castSkill', skillId: 'holy_light' }),
        rule({ k: 'selfHpBelow', pct: 55 }, { k: 'castSkill', skillId: 'holy_light' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'druid':
      return t('Grove Tender', [
        rule({ k: 'allyHpBelow', pct: 80 }, { k: 'castSkill', skillId: 'regrowth' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'castSkill', skillId: 'thorn_lash' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'bard':
      return t('Backup Singer', [
        rule({ k: 'allyHpBelow', pct: 70 }, { k: 'castSkill', skillId: 'heal' }),
        rule({ k: 'enemiesAtLeast', n: 2 }, { k: 'castSkill', skillId: 'blessing' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'chef':
      return t('Soup Kitchen', [
        rule({ k: 'allyHpBelow', pct: 75 }, { k: 'castSkill', skillId: 'soup_toss' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    case 'priest':
      return t('Shepherd of the Fallen', [
        rule({ k: 'allyDowned' }, { k: 'castSkill', skillId: 'divine_intervention' }),
        rule({ k: 'allyHpBelow', pct: 80 }, { k: 'castSkill', skillId: 'sanctify' }),
        rule({ k: 'selfHpBelow', pct: 60 }, { k: 'castSkill', skillId: 'sanctify' }),
        rule({ k: 'selfHpBelow', pct: 35 }, { k: 'usePotion', potion: 'hp' }),
        rule({ k: 'always' }, { k: 'attack' }),
      ]);
    default:
      return null;
  }
}

export function defaultTactics(classId: string): TacticSet[] {
  n = 0;
  const cautious = set('cautious', 'Cautious', [
    rule({ k: 'selfHpBelow', pct: 55 }, { k: 'usePotion', potion: 'hp' }),
    rule({ k: 'allyDowned' }, { k: 'carryAlly' }),
    rule({ k: 'enemiesAtLeast', n: 3 }, { k: 'defend' }),
    rule({ k: 'enemyLevelAbove', delta: 3 }, { k: 'defend' }),
    rule({ k: 'always' }, { k: 'attack' }),
  ]);
  const triage = triageSet(classId);
  return [mainSet(classId), aggressiveSet(classId), ...(triage ? [triage] : []), cautious];
}
