import { describe, expect, test } from 'bun:test';
import type { GameEvent } from '../types';
import { newGame } from '../newGame';
import { advanceTick } from '../run/runtime';
import { addXp } from '../hero/leveling';
import { learnSkillCost } from '../balance';

const NOW = 1_750_000_000_000;

function learn(state: ReturnType<typeof newGame>, heroId: string, skillId: string) {
  const events: GameEvent[] = [];
  advanceTick(state, [{ t: 'LEARN_SKILL', heroId, skillId }], NOW, events);
  return events;
}

describe("magician's guild", () => {
  test('learning a future class skill costs gold and grants the skill', () => {
    const state = newGame(11, NOW);
    const knight = state.roster[state.rosterOrder[0]!]!; // level 1 knight
    state.village.gold = 10_000;
    const goldBefore = state.village.gold;
    expect(knight.skills).not.toContain('taunt'); // unlocks at level 4

    learn(state, knight.id, 'taunt');
    expect(knight.skills).toContain('taunt');
    expect(state.village.gold).toBe(goldBefore - learnSkillCost(4, 3));
  });

  test('earlier = pricier; learning at the unlock level is cheapest', () => {
    expect(learnSkillCost(4, 3)).toBeGreaterThan(learnSkillCost(4, 0));
  });

  test('cannot learn other-class skills, duplicates, or with empty pockets', () => {
    const state = newGame(12, NOW);
    const knight = state.roster[state.rosterOrder[0]!]!;

    learn(state, knight.id, 'fireball'); // mage skill
    expect(knight.skills).not.toContain('fireball');

    state.village.gold = 0;
    learn(state, knight.id, 'taunt');
    expect(knight.skills).not.toContain('taunt');

    state.village.gold = 10_000;
    learn(state, knight.id, 'shield_bash');
    const goldAfterFirst = state.village.gold;
    learn(state, knight.id, 'shield_bash'); // duplicate: no-op
    expect(state.village.gold).toBe(goldAfterFirst);
    expect(knight.skills.filter((s) => s === 'shield_bash').length).toBe(1);
  });

  test('level-ups keep guild-taught skills (merge, not replace)', () => {
    const state = newGame(13, NOW);
    const knight = state.roster[state.rosterOrder[0]!]!;
    state.village.gold = 10_000;
    learn(state, knight.id, 'taunt');
    expect(knight.skills).toContain('taunt');

    addXp(state, knight, 200, []); // level a couple of times
    expect(knight.level).toBeGreaterThan(1);
    expect(knight.skills).toContain('taunt');
    expect(knight.skills.filter((s) => s === 'taunt').length).toBe(1);
  });
});
