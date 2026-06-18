import { describe, expect, test } from 'bun:test';
import { newGame } from './newGame';
import { makeHero } from './hero/create';
import { applyCommand } from './commands';
import { advanceTick } from './run/runtime';
import { DUNGEON_EVENTS } from './content';

const NOW = 1_750_000_000_000;

function runWithPendingEvent() {
  const state = newGame(7, NOW);
  const h = makeHero(state, 'knight', 'Probe', 6, [], [], 'human');
  state.roster[h.id] = h;
  state.rosterOrder.push(h.id);
  advanceTick(state, [{ t: 'EMBARK', memberIds: [h.id], startDepth: 1 }], NOW, []);
  const run = state.run!;
  const eventId = Object.keys(DUNGEON_EVENTS)[0]!;
  const ev = DUNGEON_EVENTS[eventId]!;
  run.pendingEvent = {
    eventId,
    roomIndex: 0,
    choiceKeys: ev.choices.map((c) => c.key),
    defaultChoice: ev.choices[0]!.key,
    deadlineTick: state.tick + 50,
  };
  return { state, run, ev, eventId };
}

describe('dungeon event → outcome dialog flow', () => {
  test('choosing resolves the event and records the outcome for the dialog', () => {
    const { state, run, ev, eventId } = runWithPendingEvent();
    applyCommand(state, { t: 'EVENT_CHOICE', eventId, choiceKey: ev.choices[0]!.key }, NOW, []);
    expect(run.pendingEvent).toBeUndefined();
    expect(run.eventResult).toBeDefined();
    expect(run.eventResult!.eventId).toBe(eventId);
    expect(run.eventResult!.choiceLabel).toBe(ev.choices[0]!.label);
    expect(typeof run.eventResult!.text).toBe('string');
    expect(run.eventResult!.text.length).toBeGreaterThan(0);
  });

  test('acknowledging the outcome clears it so the world can unpause', () => {
    const { state, run, ev, eventId } = runWithPendingEvent();
    applyCommand(state, { t: 'EVENT_CHOICE', eventId, choiceKey: ev.choices[0]!.key }, NOW, []);
    expect(run.eventResult).toBeDefined();
    applyCommand(state, { t: 'ACK_EVENT_RESULT' }, NOW, []);
    expect(run.eventResult).toBeUndefined();
  });
});
