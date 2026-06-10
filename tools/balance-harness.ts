/**
 * Headless balance harness: simulate fresh parties across seeds and report
 * how deep they get, how long they last, and what they bring home.
 * Run before/after tuning balance.ts:  bun run balance
 */
import type { Command, GameEvent, GameState } from '../src/game/types';
import { newGame } from '../src/game/newGame';
import { advanceTick } from '../src/game/run/runtime';

const SEEDS = Number(process.env.SEEDS ?? 12);
const MAX_TICKS = 400_000;
const NOW = 1_750_000_000_000;

interface RunStats {
  seed: number;
  outcome: string;
  maxDepth: number;
  ticks: number;
  goldLost: number;
  lootKept: number;
  permadeaths: number;
  heroLevels: string;
}

function simulate(seed: number): RunStats {
  const state: GameState = newGame(seed, NOW);
  const embark: Command = { t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 };
  const events: GameEvent[] = [];
  advanceTick(state, [embark], NOW, events);

  let outcome = 'timeout';
  let goldLost = 0;
  let ticks = 0;
  for (; ticks < MAX_TICKS; ticks++) {
    const ev: GameEvent[] = [];
    advanceTick(state, [], NOW, ev);
    const ended = ev.find((e) => e.t === 'runEnded');
    if (ended && ended.t === 'runEnded') {
      outcome = ended.outcome;
      goldLost = ended.goldLost;
      break;
    }
  }
  return {
    seed,
    outcome,
    maxDepth: state.progress.maxDepthReached,
    ticks,
    goldLost,
    lootKept: state.village.inventory.length,
    permadeaths: state.progress.totalPermadeaths,
    heroLevels: state.rosterOrder.map((id) => state.roster[id]!.level).join('/'),
  };
}

console.log('seed,outcome,maxDepth,minutes(1x),goldLost,lootKept,permadeaths,heroLevels');
const all: RunStats[] = [];
for (let i = 0; i < SEEDS; i++) {
  const stats = simulate(1000 + i * 17);
  all.push(stats);
  console.log(
    [
      stats.seed,
      stats.outcome,
      stats.maxDepth,
      (stats.ticks / 600).toFixed(1),
      stats.goldLost,
      stats.lootKept,
      stats.permadeaths,
      stats.heroLevels,
    ].join(','),
  );
}
const avgDepth = all.reduce((a, s) => a + s.maxDepth, 0) / all.length;
const avgMinutes = all.reduce((a, s) => a + s.ticks, 0) / all.length / 600;
console.log(
  `\nfirst-run summary: avg depth ${avgDepth.toFixed(1)}, avg duration ${avgMinutes.toFixed(1)} min at 1x, ` +
    `${all.filter((s) => s.permadeaths > 0).length}/${all.length} runs with permadeath`,
);
