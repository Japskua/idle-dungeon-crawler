import { describe, expect, test } from 'bun:test';
import type { DebriefReport } from './debrief';
import { RunChronicler } from './debrief';
import { newGame } from '../game/newGame';
import { advanceTick } from '../game/run/runtime';
import type { GameEvent } from '../game/types';

const NOW = 1_750_000_000_000;

/** play full runs, feeding the chronicler tick by tick, until pred(report) */
function playUntil(seed: number, pred: (r: DebriefReport) => boolean): DebriefReport {
  const state = newGame(seed, NOW);
  const chronicler = new RunChronicler();
  for (let runIdx = 0; runIdx < 20; runIdx++) {
    const members = state.rosterOrder.filter((id) => state.roster[id]!.activity === 'idle').slice(0, 4);
    if (members.length === 0) {
      // everyone is recovering — let village time pass
      for (let i = 0; i < 50; i++) advanceTick(state, [], NOW + runIdx * 86_400_000 + i * 100, []);
      continue;
    }
    let report: DebriefReport | null = null;
    for (let t = 0; t < 60_000 && !report; t++) {
      const events: GameEvent[] = [];
      const cmds = t === 0 ? [{ t: 'EMBARK', memberIds: members, startDepth: 1 } as const] : [];
      advanceTick(state, cmds as never, NOW + runIdx * 86_400_000, events);
      report = chronicler.consume(state, events);
    }
    expect(report).not.toBeNull(); // a run that never ends is a movement deadlock
    if (pred(report!)) return report!;
  }
  throw new Error('predicate never satisfied across 20 runs');
}

describe('run chronicler', () => {
  test('debrief covers the whole party with sane per-hero numbers', () => {
    const report = playUntil(7, () => true);
    expect(report.heroes.length).toBeGreaterThan(0);
    expect(report.heroes.length).toBeLessThanOrEqual(4);
    expect(report.durationTicks).toBeGreaterThan(0);
    for (const h of report.heroes) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(h.levelAfter).toBeGreaterThanOrEqual(h.levelBefore);
      expect(h.xpGained).toBeGreaterThanOrEqual(0);
      expect(h.dmgDealt).toBeGreaterThanOrEqual(0);
      expect(['fine', 'carried', 'crawled', 'died']).toContain(h.outcome);
    }
    // somebody fought something
    expect(report.heroes.reduce((s, h) => s + h.dmgDealt, 0)).toBeGreaterThan(0);
    expect(report.monstersSlain).toBeGreaterThan(0);
  });

  test('a wipe produces a wipe debrief: causes for the dead, no rescues credited', () => {
    const report = playUntil(7, (r) => r.outcome === 'wiped');
    expect(report.goldLost).toBeGreaterThanOrEqual(0);
    for (const h of report.heroes) {
      expect(['crawled', 'died']).toContain(h.outcome); // nobody walks away from a wipe
      expect(h.carriedOut).toBeUndefined();
      if (h.outcome === 'died') expect(h.deathCause).toBeTruthy();
    }
  });

  test('a withdrawal with downed heroes credits the carriers', () => {
    const report = playUntil(11, (r) => r.outcome === 'withdrawn' && r.heroes.some((h) => h.outcome === 'carried'));
    const carried = report.heroes.filter((h) => h.outcome === 'carried');
    for (const h of carried) {
      expect(h.carriedBy).toBeTruthy();
      const rescuer = report.heroes.find((r) => r.name === h.carriedBy);
      expect(rescuer?.carriedOut).toBeDefined();
    }
  });
});
