/**
 * Offline catch-up: snapshot the state, run the single analytic accrual path
 * (villageUpkeep), and diff into a welcome-back report. Zero RNG, zero ticking,
 * capped at OFFLINE_CAP_MS.
 */
import type { GameEvent, GameState } from '../types';
import { OFFLINE_CAP_MS } from '../balance';
import { villageUpkeep } from '../run/runtime';
import { derive } from '../hero/derive';

export interface OfflineReport {
  awayMs: number;
  capped: boolean;
  goldEarned: number;
  heroes: { name: string; xpGained: number; levelsGained: number; recovered: boolean }[];
}

const MIN_REPORT_MS = 5 * 60 * 1000;

export function applyOfflineCatchUp(state: GameState, nowMs: number): OfflineReport | null {
  const awayMs = Math.max(0, nowMs - state.savedAtMs);

  const before = {
    gold: state.village.gold,
    heroes: new Map(
      state.rosterOrder.map((id) => {
        const hero = state.roster[id]!;
        return [id, { xp: hero.xp, level: hero.level, hpFrac: hero.hp / derive(hero).maxHp }] as const;
      }),
    ),
  };

  const events: GameEvent[] = [];
  villageUpkeep(state, nowMs, events);

  if (awayMs < MIN_REPORT_MS) return null;

  const heroes = state.rosterOrder
    .map((id) => {
      const hero = state.roster[id]!;
      const prev = before.heroes.get(id);
      if (!prev) return null;
      const levelsGained = hero.level - prev.level;
      const xpGained = levelsGained > 0 ? hero.xp : hero.xp - prev.xp;
      const recovered = prev.hpFrac < 1 && hero.hp >= derive(hero).maxHp;
      if (xpGained <= 0 && levelsGained <= 0 && !recovered) return null;
      return { name: hero.name, xpGained: Math.max(0, Math.round(xpGained)), levelsGained, recovered };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    awayMs,
    capped: awayMs > OFFLINE_CAP_MS,
    goldEarned: state.village.gold - before.gold,
    heroes,
  };
}
