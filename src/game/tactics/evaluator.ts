/**
 * The tactics evaluator — the game's signature mechanic. A pure function:
 * given a hero, their derived stats, a battle view, and a priority-ordered
 * rule list, produce the action to take.
 *
 * Critical semantics (do not change casually — tests pin these):
 *  1. Rules scan top-down; a rule fires only if its trigger is TRUE and its
 *     action is FEASIBLE right now. Trigger-true-but-infeasible FALLS THROUGH
 *     to the next rule (a no-mana "heal ally" must not deadlock the healer).
 *  2. No rule fires -> null; the caller applies the default behavior
 *     (attack nearest / follow the route).
 *  3. Target ties break deterministically (nearest, then lowest id).
 *  4. While withdrawing, offensive actions are only feasible against ADJACENT
 *     enemies and offensive skills are filtered entirely — the party flees,
 *     it does not chase.
 */
import type { Hero, Id, PotionKind, SkillId, TacticSet, Trigger } from '../types';
import { SKILLS } from '../content';
import type { DerivedStats } from '../hero/derive';

export interface EnemyView {
  id: Id;
  level: number;
  dist2: number;
  adjacent: boolean;
  isBoss: boolean;
  isElite: boolean;
}

export interface AllyView {
  id: Id;
  hpFrac: number;
  dist2: number;
}

export interface BattleView {
  /** engaged hostile enemies, sorted by (dist2, id) */
  enemies: EnemyView[];
  /** standing allies including self, sorted by id */
  allies: AllyView[];
  /** downed allies nobody is carrying yet */
  downedAllies: Id[];
  selfHpFrac: number;
  selfMpFrac: number;
  carrying: boolean;
  withdrawing: boolean;
  /** living minions this hero has already summoned */
  myMinions: number;
}

export type ResolvedAction =
  | { kind: 'attack'; targetId: Id }
  | { kind: 'cast'; skillId: SkillId; targetId: Id | null }
  | { kind: 'potion'; potion: PotionKind }
  | { kind: 'bomb'; targetId: Id }
  | { kind: 'defend' }
  | { kind: 'retreat' }
  | { kind: 'carry'; targetId: Id }
  | { kind: 'wait' };

function triggerTrue(trigger: Trigger, hero: Hero, view: BattleView): boolean {
  switch (trigger.k) {
    case 'always':
      return true;
    case 'selfHpBelow':
      return view.selfHpFrac * 100 < trigger.pct;
    case 'selfMpAbove':
      return view.selfMpFrac * 100 > trigger.pct;
    case 'allyHpBelow':
      return view.allies.some((a) => a.id !== hero.id && a.hpFrac * 100 < trigger.pct);
    case 'allyDowned':
      return view.downedAllies.length > 0;
    case 'enemiesAtLeast':
      return view.enemies.length >= trigger.n;
    case 'enemyIsBoss':
      return view.enemies.some((e) => e.isBoss);
    case 'enemyIsElite':
      return view.enemies.some((e) => e.isElite);
    case 'enemyLevelAbove':
      return view.enemies.some((e) => e.level >= hero.level + trigger.delta);
    case 'inMeleeRange':
      return view.enemies.some((e) => e.adjacent);
    case 'skillReady':
      return hero.skills.includes(trigger.skillId) && (hero.cooldowns[trigger.skillId] ?? 0) <= 0;
  }
}

function nearestEnemy(enemies: EnemyView[]): EnemyView | null {
  let best: EnemyView | null = null;
  for (const e of enemies) {
    if (!best || e.dist2 < best.dist2 || (e.dist2 === best.dist2 && e.id < best.id)) best = e;
  }
  return best;
}

function attackTarget(view: BattleView): Id | null {
  if (view.withdrawing) {
    const adj = nearestEnemy(view.enemies.filter((e) => e.adjacent));
    return adj ? adj.id : null;
  }
  return nearestEnemy(view.enemies)?.id ?? null;
}

/** returns the resolved action if feasible, else null (fall through) */
function feasible(
  action: { k: string; [key: string]: unknown },
  hero: Hero,
  d: DerivedStats,
  view: BattleView,
): ResolvedAction | null {
  switch (action.k) {
    case 'attack': {
      if (view.carrying) return null;
      const target = attackTarget(view);
      return target ? { kind: 'attack', targetId: target } : null;
    }
    case 'throwBomb': {
      // offensive and indiscriminate: never while carrying or fleeing
      if (view.carrying || view.withdrawing) return null;
      if (hero.bombs <= 0) return null;
      const target = nearestEnemy(view.enemies);
      return target ? { kind: 'bomb', targetId: target.id } : null;
    }
    case 'castSkill': {
      if (view.carrying) return null;
      const skillId = action.skillId as SkillId;
      const skill = SKILLS[skillId];
      if (!skill) return null;
      if (!hero.skills.includes(skillId)) return null;
      if ((hero.cooldowns[skillId] ?? 0) > 0) return null;
      if (hero.mp < skill.mpCost) return null;
      const offensive = skill.target === 'enemy' || skill.target === 'enemiesInRadius';
      if (offensive) {
        if (view.withdrawing) return null;
        const target = nearestEnemy(view.enemies);
        return target ? { kind: 'cast', skillId, targetId: target.id } : null;
      }
      if (skill.target === 'lowestHpAlly') {
        let best: AllyView | null = null;
        for (const ally of view.allies) {
          if (ally.hpFrac >= 0.999) continue;
          if (!best || ally.hpFrac < best.hpFrac || (ally.hpFrac === best.hpFrac && ally.id < best.id)) {
            best = ally;
          }
        }
        return best ? { kind: 'cast', skillId, targetId: best.id } : null;
      }
      if (skill.kind === 'summon') {
        // worth conjuring only with a fight on and room in the entourage
        if (view.withdrawing) return null;
        if (view.enemies.length === 0) return null;
        if (view.myMinions >= (skill.summon?.count ?? 1)) return null;
        return { kind: 'cast', skillId, targetId: null };
      }
      if (skill.target === 'self' && skill.kind === 'heal') {
        // no point mending at full health
        return view.selfHpFrac < 0.999 ? { kind: 'cast', skillId, targetId: null } : null;
      }
      if (skill.target === 'alliesInRadius') {
        if (skill.kind === 'heal') {
          // someone nearby must actually be hurt
          return view.allies.some((a) => a.hpFrac < 0.999) ? { kind: 'cast', skillId, targetId: null } : null;
        }
        // buffs only matter with a fight on
        return view.enemies.length > 0 ? { kind: 'cast', skillId, targetId: null } : null;
      }
      if (skill.target === 'self' && skill.kind === 'buff') {
        // rage/vanish out of combat is just embarrassing
        return view.enemies.length > 0 ? { kind: 'cast', skillId, targetId: null } : null;
      }
      return { kind: 'cast', skillId, targetId: null };
    }
    case 'usePotion': {
      const potion = action.potion as PotionKind;
      if (hero.potions[potion] <= 0) return null;
      if (potion === 'hp' && view.selfHpFrac >= 0.999) return null;
      if (potion === 'mp' && view.selfMpFrac >= 0.999) return null;
      return { kind: 'potion', potion };
    }
    case 'defend':
      return { kind: 'defend' };
    case 'retreat':
      return view.enemies.length > 0 ? { kind: 'retreat' } : null;
    case 'carryAlly': {
      if (view.carrying) return null;
      const target = view.downedAllies[0];
      return target ? { kind: 'carry', targetId: target } : null;
    }
    case 'wait':
      return { kind: 'wait' };
    default:
      return null;
  }
}

/**
 * Evaluate a tactic set. Returns null when no rule fires — the caller then
 * applies default behavior (attack nearest when engaged, else follow route).
 */
export function evaluate(hero: Hero, d: DerivedStats, view: BattleView, set: TacticSet): ResolvedAction | null {
  for (const rule of set.rules) {
    if (!rule.enabled) continue;
    if (!triggerTrue(rule.trigger, hero, view)) continue;
    const resolved = feasible(rule.action as never, hero, d, view);
    if (resolved) return resolved;
  }
  return null;
}

/** the built-in fallback when no rule fires */
export function defaultAction(view: BattleView): ResolvedAction | null {
  if (view.carrying) return null;
  const target = attackTarget(view);
  return target ? { kind: 'attack', targetId: target } : null;
}
