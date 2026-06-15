/**
 * Shop & tavern stock are pure functions of (seed, dayIndex, progress) —
 * nothing is stored, daily rotation falls out of the date, and "restocked
 * while you were away" needs zero special code. The tavern crowd also keys
 * on runsCompleted, so fresh faces wander in after every dungeon crawl.
 */
import type { GameState } from '../types';
import { hash2, makeRng, pick, randInt, shuffle } from '../core/rng';
import { SHOP_STOCK_SIZE, TAVERN_RECRUITS, hireCost, tierForDepth } from '../balance';
import { CLASSES, ITEMS } from '../content';
import { generateName, perkValueAdjust, rollPerks, rollRace, rollTraits } from '../hero/create';

export function dayIndexFor(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000);
}

export interface StockEntry {
  key: string;
  defId: string;
  price: number;
}

export function shopStock(state: GameState): StockEntry[] {
  const dayIndex = state.village.dayIndex;
  const rng = makeRng(hash2(state.seed, dayIndex * 2 + 1));
  const maxTier = tierForDepth(Math.max(1, state.progress.maxDepthReached));
  const pool = Object.values(ITEMS)
    .filter(
      (d) =>
        ['weapon', 'offhand', 'armor', 'trinket'].includes(d.slot) &&
        d.tier >= Math.max(1, maxTier - 1) &&
        d.tier <= maxTier,
    )
    .map((d) => d.id)
    .sort();
  const picks = shuffle(rng, [...pool]).slice(0, SHOP_STOCK_SIZE);
  return picks.map((defId, i) => {
    const def = ITEMS[defId]!;
    const price = Math.round(def.value * (1 + randInt(rng, 0, 20) / 100));
    return { key: `d${dayIndex}s${i}:${defId}`, defId, price };
  });
}

export interface Recruit {
  key: string;
  classId: string;
  name: string;
  level: number;
  perks: string[];
  /** personality trait ids — shown in the tavern, kept on hire */
  traits: string[];
  /** ancestry — shown in the tavern, kept on hire */
  raceId: string;
  cost: number;
}

export function tavernRecruits(state: GameState): Recruit[] {
  const dayIndex = state.village.dayIndex;
  const crawl = state.progress.runsCompleted;
  const rng = makeRng(hash2(state.seed ^ 0x51c0ffee, hash2(dayIndex, crawl)));
  const classIds = Object.keys(CLASSES).sort();
  const out: Recruit[] = [];
  for (let i = 0; i < TAVERN_RECRUITS; i++) {
    const classId = pick(rng, classIds);
    const maxLevel = 1 + Math.floor(state.progress.maxDepthReached * 0.6);
    const level = randInt(rng, 1, Math.max(1, maxLevel));
    const name = generateName(rng);
    const perks = rollPerks(rng);
    const traits = rollTraits(rng);
    const raceId = rollRace(rng);
    const cost = hireCost(CLASSES[classId]!.hireCostBase, level, perkValueAdjust(perks));
    out.push({ key: `d${dayIndex}c${crawl}r${i}`, classId, name, level, perks, traits, raceId, cost });
  }
  return out;
}

/** the village never lets you go extinct: hiring is free with an empty roster */
export function effectiveHireCost(state: GameState, recruit: Recruit): number {
  return state.rosterOrder.length === 0 ? 0 : recruit.cost;
}
