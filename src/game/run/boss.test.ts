import { describe, expect, test } from 'bun:test';
import type { GameEvent } from '../types';
import { TILE } from '../types';
import { newGame } from '../newGame';
import { advanceTick } from './runtime';
import { addXp } from '../hero/leveling';

const NOW = 1_750_000_000_000;

describe('boss floors', () => {
  test('a strong party enters depth 5, the arena seals, the boss falls, a checkpoint unlocks', () => {
    const state = newGame(99, NOW);
    // beef the founding duo up to ~level 14 so the outcome is not in doubt
    for (const id of state.rosterOrder) {
      addXp(state, state.roster[id]!, 60_000, []);
    }
    state.progress.checkpoints.push(5);
    state.village.potions.hp = 10;

    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 5 }], NOW, events);
    expect(state.run?.floor.isBossFloor).toBe(true);
    expect(state.run?.floor.bossDoors?.length).toBe(2);

    let bossSlain = false;
    let doorsEverClosed = false;
    let checkpointAfter = false;
    for (let i = 0; i < 60_000 && !bossSlain; i++) {
      const ev: GameEvent[] = [];
      advanceTick(state, [], NOW, ev);
      const run = state.run;
      if (run?.floor.bossDoors) {
        if (
          run.floor.bossDoors.some(
            (d) => run.floor.tiles[d.y * run.floor.w + d.x] === TILE.DOOR_CLOSED,
          )
        ) {
          doorsEverClosed = true;
        }
      }
      for (const e of ev) {
        if (e.t === 'bossSlain') {
          bossSlain = true;
          checkpointAfter = state.progress.checkpoints.includes(6);
        }
      }
      if (!state.run) break; // wiped — would fail the assertions below
    }

    expect(bossSlain).toBe(true);
    expect(doorsEverClosed).toBe(true);
    expect(checkpointAfter).toBe(true);
    // doors reopen once the boss is dead
    const run = state.run;
    if (run) {
      for (const d of run.floor.bossDoors!) {
        expect(run.floor.tiles[d.y * run.floor.w + d.x]).not.toBe(TILE.DOOR_CLOSED);
      }
    }
  });
});
