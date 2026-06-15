/**
 * Regressions and semantics for the combat fixes:
 *  - the corridor swap dance (heroes yanking busy allies, never attacking)
 *  - explosions hurt everyone (attack-kind AoE friendly fire), buffs/debuffs pick sides
 *  - bombs: thrown via tactics, indiscriminate blast
 */
import { describe, expect, test } from 'bun:test';
import type { GameEvent, GameState, MonsterInstance } from '../types';
import { TILE } from '../types';
import { newGame } from '../newGame';
import { advanceTick } from './runtime';
import { makeHero } from '../hero/create';
import { evaluate, type BattleView } from '../tactics/evaluator';
import { derive } from '../hero/derive';
import { MONSTERS } from '../content';

const NOW = 1_750_000_000_000;

/** carve the floor down to walls, then open exactly the given cells */
function carve(state: GameState, cells: { x: number; y: number }[]) {
  const floor = state.run!.floor;
  floor.tiles.fill(TILE.WALL);
  for (const c of cells) floor.tiles[c.y * floor.w + c.x] = TILE.FLOOR;
}

function placeMonster(state: GameState, defId: string, pos: { x: number; y: number }, packId: number): MonsterInstance {
  const def = MONSTERS[defId]!;
  const m: MonsterInstance = {
    id: `tm${state.nextId++}`,
    defId,
    level: 1,
    elite: false,
    hp: def.base.hp,
    pos: { ...pos },
    move: null,
    targetId: null,
    aggro: true,
    packId,
    action: null,
    statuses: [],
    cooldowns: {},
  };
  state.run!.monsters[m.id] = m;
  state.run!.monsterOrder.push(m.id);
  return m;
}

/** 3 melee knights in a 1-wide corridor, 2 slimes guarding the room below */
function corridorScenario(): GameState {
  const state = newGame(99, NOW);
  // roster: exactly three knights
  for (const id of [...state.rosterOrder]) {
    delete state.roster[id];
  }
  state.rosterOrder = [];
  for (let i = 0; i < 3; i++) {
    const hero = makeHero(state, 'knight', `K${i}`, 2, []);
    state.roster[hero.id] = hero;
    state.rosterOrder.push(hero.id);
  }
  const events: GameEvent[] = [];
  advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
  const run = state.run!;
  // sealed map: vertical corridor x=5,y=2..6 into a 3x2 room y=7..8
  carve(state, [
    ...[2, 3, 4, 5, 6].map((y) => ({ x: 5, y })),
    ...[4, 5, 6].flatMap((x) => [{ x, y: 7 }, { x, y: 8 }]),
  ]);
  // wipe the generated monster population; place two slimes flanking the mouth
  run.monsterOrder = [];
  run.monsters = {};
  placeMonster(state, 'slime', { x: 4, y: 8 }, 1);
  placeMonster(state, 'slime', { x: 6, y: 8 }, 1);
  // heroes stacked in the corridor
  const [a, b, c] = run.party.memberIds;
  run.party.pos[a!] = { x: 5, y: 4 };
  run.party.pos[b!] = { x: 5, y: 3 };
  run.party.pos[c!] = { x: 5, y: 2 };
  for (const id of run.party.memberIds) {
    run.party.move[id] = undefined as never;
    delete run.party.move[id];
    run.party.action[id] = null;
    run.party.targetId[id] = null;
  }
  return state;
}

describe('corridor swap dance (the screen-recording bug)', () => {
  test('jammed melee heroes fight instead of swapping forever', () => {
    const state = corridorScenario();
    let heroHits = 0;
    let slimesDead = 0;
    for (let i = 0; i < 1500 && state.run; i++) {
      const events: GameEvent[] = [];
      advanceTick(state, [], NOW, events);
      for (const e of events) {
        if (e.t === 'damage' && state.roster[e.src] && state.run?.monsters[e.dst]) heroHits++;
        if (e.t === 'monsterDied') slimesDead++;
      }
      if (slimesDead >= 2) break;
    }
    // before the fix this scenario produced an endless swap dance: zero hero
    // damage while the slimes chipped the party down
    expect(heroHits).toBeGreaterThan(3);
    expect(slimesDead).toBe(2);
  });
});

describe('explosions hurt everyone', () => {
  function aoeScenario() {
    const state = newGame(7, NOW);
    const events: GameEvent[] = [];
    advanceTick(state, [{ t: 'EMBARK', memberIds: [...state.rosterOrder], startDepth: 1 }], NOW, events);
    const run = state.run!;
    carve(state, [3, 4, 5, 6, 7].flatMap((x) => [3, 4, 5, 6, 7].map((y) => ({ x, y }))));
    run.monsterOrder = [];
    run.monsters = {};
    return state;
  }

  test('attack-kind AoE singes allies in the blast (but never the caster)', () => {
    const state = aoeScenario();
    const run = state.run!;
    const [casterId, allyId] = run.party.memberIds;
    const caster = state.roster[casterId!]!;
    const ally = state.roster[allyId!]!;
    const rat = placeMonster(state, 'rat', { x: 5, y: 5 }, 1);
    run.party.pos[casterId!] = { x: 5, y: 4 }; // inside its own blast radius
    run.party.pos[allyId!] = { x: 4, y: 5 }; // adjacent to the rat: in the blast
    caster.skills = [...caster.skills, 'firestorm'];
    caster.mp = 999;
    run.party.action[casterId!] = { kind: 'cast', skillId: 'firestorm', targetId: rat.id, ticksLeft: 1, total: 1 };
    const allyHpBefore = ally.hp;
    const casterHpBefore = caster.hp;
    advanceTick(state, [], NOW, []);
    expect(ally.hp).toBeLessThan(allyHpBefore); // friendly fire is real
    expect(caster.hp).toBe(casterHpBefore); // the caster is the eye of the storm
    expect(rat.hp).toBeLessThan(MONSTERS['rat']!.base.hp);
  });

  test('the AI refuses to start an attack-AoE with an ally in the blast', () => {
    const state = aoeScenario();
    const run = state.run!;
    const [casterId, allyId] = run.party.memberIds;
    const caster = state.roster[casterId!]!;
    const rat = placeMonster(state, 'rat', { x: 5, y: 5 }, 1);
    run.party.pos[casterId!] = { x: 7, y: 7 };
    run.party.pos[allyId!] = { x: 4, y: 5 }; // in the would-be blast
    caster.skills = [...caster.skills, 'firestorm'];
    caster.mp = 999;
    caster.tactics.sets[0]!.rules = [
      { id: 'r1', enabled: true, trigger: { k: 'always' }, action: { k: 'castSkill', skillId: 'firestorm' } },
    ];
    caster.tactics.activeSetId = caster.tactics.sets[0]!.id;
    for (let i = 0; i < 30; i++) advanceTick(state, [], NOW, []);
    // the cast never committed — no mana was spent on torching the ally
    // (the rat may still get hit: with firestorm gated, heroes fall back to
    // ordinary weapon attacks, which is exactly the point)
    expect(caster.mp).toBe(999);
    expect(rat.id in run.monsters ? run.monsters[rat.id]!.statuses.length : 0).toBe(0);
  });

  test('a bomb blast spares no one, the thrower included', () => {
    const state = aoeScenario();
    const run = state.run!;
    const [throwerId, allyId] = run.party.memberIds;
    const thrower = state.roster[throwerId!]!;
    const ally = state.roster[allyId!]!;
    const rat = placeMonster(state, 'rat', { x: 5, y: 5 }, 1);
    run.party.pos[throwerId!] = { x: 5, y: 4 };
    run.party.pos[allyId!] = { x: 4, y: 5 };
    thrower.bombs = 1;
    run.party.action[throwerId!] = {
      kind: 'bomb',
      targetId: rat.id,
      at: { x: 5, y: 5 },
      ticksLeft: 1,
      total: 1,
    };
    const tBefore = thrower.hp;
    const aBefore = ally.hp;
    advanceTick(state, [], NOW, []);
    expect(thrower.bombs).toBe(0);
    expect(rat.hp).toBeLessThan(MONSTERS['rat']!.base.hp);
    expect(thrower.hp).toBeLessThan(tBefore); // stood too close to their own bomb
    expect(ally.hp).toBeLessThan(aBefore);
  });
});

describe('throwBomb tactic feasibility', () => {
  function view(partial: Partial<BattleView>): BattleView {
    return {
      enemies: [],
      allies: [],
      downedAllies: [],
      selfHpFrac: 1,
      selfMpFrac: 1,
      carrying: false,
      withdrawing: false,
      myMinions: 0,
      myMinionCost: 0,
      corpseCount: 0,
      ...partial,
    };
  }

  test('fires with bombs in the pack, falls through without', () => {
    const state = newGame(3, NOW);
    const hero = state.roster[state.rosterOrder[0]!]!;
    const d = derive(hero);
    const set = {
      id: 's',
      name: 's',
      rules: [{ id: 'r', enabled: true, trigger: { k: 'always' as const }, action: { k: 'throwBomb' as const } }],
    };
    const enemies = [{ id: 'm1', level: 1, dist2: 4, adjacent: false, isBoss: false, isElite: false }];
    hero.bombs = 0;
    expect(evaluate(hero, d, view({ enemies }), set)).toBeNull();
    hero.bombs = 2;
    expect(evaluate(hero, d, view({ enemies }), set)).toEqual({ kind: 'bomb', targetId: 'm1' });
    // never while fleeing
    expect(evaluate(hero, d, view({ enemies, withdrawing: true }), set)).toBeNull();
  });
});
