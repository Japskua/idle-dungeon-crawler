/**
 * Run lifecycle: embark from the village, descend between floors, and the
 * three ways home — withdrawing, wiping, or (later) victory. Death rules:
 * carried-out heroes always survive (+1 injury), abandoned/wiped heroes roll
 * permadeath, the run's carried gold is lost on a wipe, XP/items never are.
 */
import type { DungeonRun, GameEvent, GameState, Hero, Id } from '../types';
import { generateFloor } from '../dungeon/generate';
import { isPassable, DIRS } from '../dungeon/pathfind';
import { chance, pickWeighted, rand } from '../core/rng';
import {
  INJURIES_ON_CARRIED_OUT,
  INJURIES_ON_WIPE,
  PERMADEATH_ON_ABANDON,
  permadeathChanceOnWipe,
} from '../balance';
import { INJURIES, classDef } from '../content';
import { derive } from '../hero/derive';

export function chronicle(state: GameState, nowMs: number, text: string, depth?: number) {
  state.chronicle.push({ atMs: nowMs, depth, text });
  if (state.chronicle.length > 100) state.chronicle.splice(0, state.chronicle.length - 100);
}

export function startRun(
  state: GameState,
  memberIds: Id[],
  startDepth: number,
  nowMs: number,
  events: GameEvent[],
  behavior: import('../types').PartyBehavior = 'balanced',
) {
  const members = memberIds
    .filter((id) => state.roster[id] && state.roster[id]!.activity !== 'party')
    .slice(0, 4);
  if (members.length === 0 || state.run) return;

  const runSeed = Math.floor(rand(state.rng.village) * 4294967296);
  const run: DungeonRun = {
    runSeed,
    depth: startDepth,
    floor: undefined as never, // set by enterFloor
    intent: 'explore',
    behavior,
    party: {
      memberIds: members,
      pos: {},
      move: {},
      action: {},
      targetId: {},
      downed: {},
      carrying: {},
    },
    monsters: {},
    monsterOrder: [],
    groundLoot: [],
    visitedRooms: [],
    ticksOnFloor: 0,
  };
  state.run = run;
  state.mode = 'dungeon';

  for (const id of members) {
    const hero = state.roster[id]!;
    hero.activity = 'party';
    hero.statuses = [];
    hero.cooldowns = {};
    hero.stats.runs++;
    hero.stats.runDmg = 0;
    hero.stats.runGold = 0;
    // top up to 3 hp / 2 mp from the village pool; bigger gate loadouts are kept
    const takeHp = Math.min(Math.max(0, 3 - hero.potions.hp), state.village.potions.hp);
    const takeMp = Math.min(Math.max(0, 2 - hero.potions.mp), state.village.potions.mp);
    state.village.potions.hp -= takeHp;
    state.village.potions.mp -= takeMp;
    hero.potions = { hp: hero.potions.hp + takeHp, mp: hero.potions.mp + takeMp };
  }

  enterFloor(state, run, startDepth, events);
  events.push({ t: 'embark', depth: startDepth, memberIds: members });
  chronicle(state, nowMs, `The party descends into the dungeon (depth ${startDepth}).`, startDepth);
}

export function enterFloor(state: GameState, run: DungeonRun, depth: number, events: GameEvent[]) {
  const { floor, monsters } = generateFloor(run.runSeed, depth);
  run.depth = depth;
  run.floor = floor;
  run.monsters = {};
  run.monsterOrder = [];
  for (const m of monsters) {
    run.monsters[m.id] = m;
    run.monsterOrder.push(m.id);
  }
  run.groundLoot = [];
  run.visitedRooms = [0];
  run.ticksOnFloor = 0;

  // party spawns around the entrance, one hero per tile (BFS for unique cells)
  const spots: { x: number; y: number }[] = [];
  const seen = new Set<string>([`${floor.entrance.x},${floor.entrance.y}`]);
  const queue = [floor.entrance];
  while (queue.length > 0 && spots.length < run.party.memberIds.length) {
    const cur = queue.shift()!;
    spots.push(cur);
    for (const d of DIRS) {
      const x = cur.x + d.x;
      const y = cur.y + d.y;
      const key = `${x},${y}`;
      if (!seen.has(key) && isPassable(floor, x, y)) {
        seen.add(key);
        queue.push({ x, y });
      }
    }
  }
  run.party.memberIds.forEach((id, i) => {
    const spot = spots[Math.min(i, spots.length - 1)] ?? floor.entrance;
    run.party.pos[id] = { ...spot };
    run.party.move[id] = null;
    run.party.action[id] = null;
    run.party.targetId[id] = null;
  });
  // carried/downed heroes arrive with the party (descending with a body is allowed, brave)
  for (const downedId of Object.keys(run.party.downed)) {
    run.party.downed[downedId] = { pos: { ...floor.entrance } };
  }

  if (depth > state.progress.maxDepthReached) state.progress.maxDepthReached = depth;
  events.push({ t: 'descend', depth });
}

function rollInjury(state: GameState, hero: Hero, depth: number, events: GameEvent[]) {
  const pool = Object.values(INJURIES)
    .filter((inj) => inj.minDepth <= depth && !hero.injuries.includes(inj.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return;
  const injury = pickWeighted(state.rng.loot, pool, (i) => i.weight);
  hero.injuries.push(injury.id);
  events.push({ t: 'injury', heroId: hero.id, injuryId: injury.id });
}

function heroReturnsToVillage(state: GameState, hero: Hero, hpFraction: number) {
  hero.stats.bestRunDmg = Math.max(hero.stats.bestRunDmg, hero.stats.runDmg);
  const d = derive(hero);
  hero.hp = Math.max(1, Math.min(hero.hp, Math.ceil(d.maxHp * hpFraction)));
  hero.mp = Math.min(hero.mp, d.maxMp);
  hero.statuses = [];
  hero.cooldowns = {};
  hero.activity = hero.hp < d.maxHp ? 'recovering' : 'idle';
  // leftover carried potions go back to the village pool
  state.village.potions.hp += hero.potions.hp;
  state.village.potions.mp += hero.potions.mp;
  hero.potions = { hp: 0, mp: 0 };
}

function killHero(state: GameState, hero: Hero, depth: number, nowMs: number, events: GameEvent[], cause: string) {
  // their pack passes to the village; the gold dies with them (the dungeon keeps it)
  state.village.inventory.push(...hero.satchel);
  delete state.roster[hero.id];
  state.rosterOrder = state.rosterOrder.filter((id) => id !== hero.id);
  state.progress.totalPermadeaths++;
  events.push({ t: 'heroDied', heroId: hero.id, name: hero.name, classId: hero.classId, level: hero.level, depth, cause });
  chronicle(
    state,
    nowMs,
    `${hero.name} the ${classDef(hero.classId).name} died at depth ${depth}. The dungeon keeps what it takes.`,
    depth,
  );
}

/** All standing heroes reached the entrance with intent=withdraw. */
export function endRunWithdrawn(state: GameState, nowMs: number, events: GameEvent[]) {
  const run = state.run;
  if (!run) return;
  const party = run.party;
  const carriedIds = new Set(Object.values(party.carrying));

  // rescuers get their chapter too
  for (const [carrierId, carriedId] of Object.entries(party.carrying)) {
    const carrier = state.roster[carrierId];
    if (carrier && party.downed[carriedId]) carrier.stats.rescues++;
  }

  for (const id of [...party.memberIds]) {
    const hero = state.roster[id];
    if (!hero) continue;
    if (id in party.downed) {
      if (carriedIds.has(id)) {
        // carried out: survives, gains an injury
        hero.stats.carriedOut++;
        for (let i = 0; i < INJURIES_ON_CARRIED_OUT; i++) rollInjury(state, hero, run.depth, events);
        heroReturnsToVillage(state, hero, 0.15);
        chronicle(state, nowMs, `${hero.name} was carried out of the dungeon, alive but worse for wear.`, run.depth);
      } else {
        // left behind at the exit: a grim roll
        if (chance(state.rng.loot, PERMADEATH_ON_ABANDON)) {
          killHero(state, hero, run.depth, nowMs, events, 'left behind at the exit, never seen again');
          continue;
        }
        for (let i = 0; i < INJURIES_ON_WIPE; i++) rollInjury(state, hero, run.depth, events);
        heroReturnsToVillage(state, hero, 0.05);
        chronicle(state, nowMs, `${hero.name} crawled back to the village days later. Nobody asks about it.`, run.depth);
      }
    } else {
      heroReturnsToVillage(state, hero, 1);
    }
  }

  const goldKept = party.memberIds.reduce((sum, id) => sum + (state.roster[id]?.stats.runGold ?? 0), 0);
  events.push({
    t: 'runEnded',
    outcome: 'withdrawn',
    depth: run.depth,
    goldKept,
    goldLost: 0,
  });
  chronicle(state, nowMs, `The party returned from depth ${run.depth} with ${goldKept} gold.`, run.depth);
  state.progress.runsCompleted++;
  state.run = null;
  state.mode = 'village';
}

/** Everyone is down. Gold is lost; XP, loot and equipment are not. */
export function endRunWiped(state: GameState, nowMs: number, events: GameEvent[]) {
  const run = state.run;
  if (!run) return;
  const party = run.party;
  const goldLost = party.memberIds.reduce((sum, id) => sum + (state.roster[id]?.stats.runGold ?? 0), 0);

  events.push({ t: 'wipe', depth: run.depth, goldLost });
  for (const id of [...party.memberIds]) {
    const hero = state.roster[id];
    if (!hero) continue;
    if (chance(state.rng.loot, permadeathChanceOnWipe(run.depth))) {
      const cause = hero.stats.lastHitByName
        ? `slain by ${hero.stats.lastHitByName} in a party wipe`
        : 'lost when the whole party fell';
      killHero(state, hero, run.depth, nowMs, events, cause);
      continue;
    }
    // the gold found this run is lost in the dark; the satchel rides home
    hero.gold = Math.max(0, hero.gold - hero.stats.runGold);
    for (let i = 0; i < INJURIES_ON_WIPE; i++) rollInjury(state, hero, run.depth, events);
    heroReturnsToVillage(state, hero, 0.1);
  }

  state.progress.totalWipes++;
  events.push({ t: 'runEnded', outcome: 'wiped', depth: run.depth, goldKept: 0, goldLost });
  chronicle(
    state,
    nowMs,
    `The party was wiped out at depth ${run.depth}. ${goldLost} gold was left in the dark.`,
    run.depth,
  );
  state.progress.runsCompleted++;
  state.run = null;
  state.mode = 'village';
}
