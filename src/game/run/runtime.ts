/**
 * The per-tick dungeon simulation. System order is fixed and part of the
 * determinism contract:
 *   commands -> village upkeep -> statuses -> cooldowns -> hero decisions ->
 *   monster decisions -> movement -> action resolution -> deaths -> party logic -> wipe check
 */
import type {
  DungeonRun,
  EntityAction,
  GameEvent,
  GameState,
  Hero,
  Id,
  MonsterDefId,
  MonsterInstance,
  Vec2,
} from '../types';
import { TILE, type Command } from '../types';
import { chance, hash2, makeRng, pick, pickWeighted, rand, randInt, randRange, shuffle } from '../core/rng';
import {
  AUTO_WITHDRAW_ON_DOWNED,
  CARRY_MOVE_PENALTY,
  CRIT_MULT,
  DEFEND_ARMOR_BONUS,
  DMG_VARIANCE,
  ENGAGE_RADIUS,
  REVEAL_RADIUS,
  manaRegenPerTick,
  monsterDmg,
  monsterGoldMult,
  monsterMaxHp,
  monsterXp,
  mitigate,
  physDamage,
  xpShare,
  BOMB_DAMAGE,
  BOMB_RADIUS,
  BOMB_RANGE,
  BOMB_THROW_TICKS,
  EVENT_ROOM_CHANCE,
  EVENT_TIMEOUT_TICKS,
  MORALE_BEAT_TICKS,
  MORALE_FREEZE_CHANCE,
  MORALE_RECOVERY_PER_SEC,
  MORALE_RECOVERING_FLOOR,
  moraleBand,
  moraleBehavior,
  moraleBaseline,
  moraleCombatMods,
  favorTier,
  resurrectP,
  undeadBudget,
  REANIMATE_STAT_FRAC,
  CORPSE_POOL_CAP,
  CORPSE_REACH,
  LUCK_COINS_MAX,
  LUCK_COIN_HEADS_PER,
  DEVOTION_MAX,
  DEVOTION_GRACE,
  DEVOTION_HEAL_GAIN,
  DEVOTION_SMITE_GAIN,
  DEVOTION_PIETY_TICKS,
  DEVOTION_DECAY_TICKS,
  GRACE_POWER_MULT,
  SMITE_UNCLEAN_MULT,
  DIVINE_INTERVENTION_COST,
} from '../balance';
import { BANTER, CHORES, DUNGEON_EVENTS, ITEMS, RELIGIONS, SKILLS, STATUSES, creatureDef } from '../content';
import type { EventEffect } from '../types';
import { dayIndexFor } from '../village/shop';
import { behaviorKnobs } from '../tactics/behaviors';
import { applyMorale } from '../hero/morale';
import { applyFavor } from '../hero/faith';
import { derive, type DerivedStats } from '../hero/derive';
import { addXp } from '../hero/leveling';
import { defaultAction, evaluate, type BattleView, type ResolvedAction } from '../tactics/evaluator';
import { spellAmount } from '../balance';
import { rollChestLoot, rollDrops, allocId } from '../items/factory';
import {
  DIRS,
  astar,
  astarAdjacent,
  astarTo,
  bfsDistances,
  chebyshev,
  euclid2,
  flowStep,
  isPassable,
  manhattan,
} from '../dungeon/pathfind';
import { explorationOrder, insideAnyRoom, revealAround } from '../dungeon/generate';
import { endRunWiped, endRunWithdrawn, enterFloor, chronicle } from './lifecycle';
import { applyCommand } from '../commands';
import { RECOVERY_HP_FRACTION_PER_SEC } from '../balance';

// ---------- priest: devotion (state of grace) ----------
/** undead and cultist (demon-adjacent) foes the holy hate */
function isUnclean(defId: string): boolean {
  const fam = BANTER.families[defId];
  return fam === 'undead' || fam === 'cultist';
}
/** the single funnel for priest Devotion changes — clamps 0..100 */
function gainDevotion(hero: Hero, amount: number): void {
  if (hero.classId !== 'priest') return;
  hero.devotion = Math.max(0, Math.min(DEVOTION_MAX, hero.devotion + amount));
}
/** at or above the threshold a priest's heals/buffs are stronger and free */
function inStateOfGrace(hero: Hero): boolean {
  return hero.classId === 'priest' && hero.devotion >= DEVOTION_GRACE;
}

// ---------- derived caches (recomputed, never saved — keyed by object identity) ----------
const flowFieldCache = new WeakMap<object, { doorsKey: number; field: Int32Array }>();
const exploreOrderCache = new WeakMap<object, number[]>();

function doorsKeyOf(run: DungeonRun): number {
  if (!run.floor.bossDoors) return 0;
  let key = 0;
  for (const d of run.floor.bossDoors) {
    key = key * 2 + (run.floor.tiles[d.y * run.floor.w + d.x] === TILE.DOOR_CLOSED ? 1 : 0);
  }
  return key;
}

function entranceField(run: DungeonRun): Int32Array {
  const doorsKey = doorsKeyOf(run);
  let entry = flowFieldCache.get(run.floor);
  if (!entry || entry.doorsKey !== doorsKey) {
    entry = { doorsKey, field: bfsDistances(run.floor, run.floor.entrance) };
    flowFieldCache.set(run.floor, entry);
  }
  return entry.field;
}

function roomOrder(run: DungeonRun): number[] {
  let order = exploreOrderCache.get(run.floor);
  if (!order) {
    order = explorationOrder(run.floor);
    exploreOrderCache.set(run.floor, order);
  }
  return order;
}

const wanderOrderCache = new WeakMap<object, number[]>();
/** a deterministic per-floor shuffle of the room order (stable across ticks) */
function wanderOrder(run: DungeonRun): number[] {
  let order = wanderOrderCache.get(run.floor);
  if (!order) {
    const rng = makeRng(hash2(run.runSeed, run.depth * 2654435761) ^ 0x5bd1e995);
    order = shuffle(rng, [...roomOrder(run)]);
    wanderOrderCache.set(run.floor, order);
  }
  return order;
}

// ---------- helpers ----------
export function standingIds(run: DungeonRun): Id[] {
  return run.party.memberIds.filter((id) => !(id in run.party.downed));
}

function heroesByPos(state: GameState, run: DungeonRun): Map<string, Id> {
  const map = new Map<string, Id>();
  for (const id of standingIds(run)) {
    const p = run.party.pos[id]!;
    map.set(`${p.x},${p.y}`, id);
  }
  return map;
}

function monsterOccupancy(run: DungeonRun, exceptId?: Id): Set<string> {
  const set = new Set<string>();
  for (const id of run.monsterOrder) {
    if (id === exceptId) continue;
    const m = run.monsters[id]!;
    if (m.hp > 0) set.add(`${m.pos.x},${m.pos.y}`);
  }
  return set;
}

function hasStatus(statuses: { statusId: string }[], kind: 'taunt' | 'stun' | 'stealth'): boolean {
  return statuses.some((s) => STATUSES[s.statusId]?.[kind]);
}

function isStealthed(hero: Hero): boolean {
  return hasStatus(hero.statuses, 'stealth');
}

/** any hostile action drops the act */
function breakStealth(hero: Hero) {
  hero.statuses = hero.statuses.filter((s) => !STATUSES[s.statusId]?.stealth);
}

function startHeroMove(run: DungeonRun, id: Id, step: Vec2, ticks: number) {
  run.party.move[id] = { from: { ...run.party.pos[id]! }, t: 0, total: Math.max(1, ticks) };
  run.party.pos[id] = { ...step };
}

function startMonsterMove(m: MonsterInstance, step: Vec2, ticks: number) {
  m.move = { from: { ...m.pos }, t: 0, total: Math.max(1, ticks) };
  m.pos = { ...step };
}

function aggroPack(run: DungeonRun, packId: number) {
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (m.packId === packId && creatureDef(m.defId).disposition === 'hostile') m.aggro = true;
  }
}

// ---------- main entry ----------
export function advanceTick(state: GameState, commands: Command[], nowMs: number, events: GameEvent[]) {
  for (const cmd of commands) applyCommand(state, cmd, nowMs, events);
  villageUpkeep(state, nowMs, events);

  const run = state.run;
  if (state.mode !== 'dungeon' || !run) return;

  tickStatuses(state, run);
  tickCooldowns(state, run);
  heroDecisions(state, run, events);
  monsterDecisions(state, run);
  advanceMovement(state, run);
  resolveActions(state, run, events);
  processDeaths(state, run, nowMs, events);
  if (state.run) partyLogic(state, run, nowMs, events);
  if (state.run && run.pendingEvent) tickPendingEvent(state, run, events);
  if (state.run) moraleStep(state, run, events);
  if (state.run) devotionStep(state, run);
  if (state.run && standingIds(run).length === 0) {
    endRunWiped(state, nowMs, events);
  }
  state.tick++;
}

// ---------- village upkeep (wall-clock, mode-independent) ----------
/**
 * Pure analytic accrual for recovery + chores, anchored on wall-clock time. It
 * accrues exactly the elapsed time it is handed — there is NO offline catch-up:
 * the app loop only ever feeds it foreground time (it re-anchors the clock on
 * boot and whenever the tab was inactive), so closed/backgrounded time never
 * counts. Game speed never touches this — no 4x-idle exploit.
 */
export function villageUpkeep(state: GameState, nowMs: number, events: GameEvent[]) {
  const last = state.village.lastChoreAccrualMs;
  if (nowMs < last) {
    state.village.lastChoreAccrualMs = nowMs; // clock went backwards: re-anchor
    return;
  }
  const dtMs = nowMs - last;
  if (dtMs < 1000) return;
  state.village.lastChoreAccrualMs = nowMs;
  const dtSec = dtMs / 1000;
  const dtHours = dtMs / 3_600_000;

  // daily shop/tavern rotation bookkeeping
  const day = dayIndexFor(nowMs);
  if (day !== state.village.dayIndex) {
    state.village.dayIndex = day;
    state.village.purchasedToday = [];
    state.village.hiredToday = [];
  }

  let goldDelta = state.village.choreGoldCarry ?? 0;
  for (const id of state.rosterOrder) {
    const hero = state.roster[id];
    if (!hero || hero.activity === 'party') continue;
    const d = derive(hero);

    // recovery (temple assistants heal twice as fast)
    const recoveryMult = hero.choreId === 'temple_assistant' ? 2 : 1;
    if (hero.hp < d.maxHp) {
      hero.hp = Math.min(d.maxHp, hero.hp + d.maxHp * RECOVERY_HP_FRACTION_PER_SEC * recoveryMult * dtSec);
    }
    if (hero.mp < d.maxMp) {
      hero.mp = Math.min(d.maxMp, hero.mp + d.maxMp * RECOVERY_HP_FRACTION_PER_SEC * 2 * dtSec);
    }
    if (hero.activity === 'recovering' && hero.hp >= d.maxHp && hero.morale >= MORALE_RECOVERING_FLOOR) {
      hero.activity = 'idle';
    }
    // morale decays toward the hero's trait baseline while resting in the village
    const base = moraleBaseline(hero.traits);
    if (hero.morale !== base) {
      const drift = MORALE_RECOVERY_PER_SEC * dtSec;
      hero.morale += Math.sign(base - hero.morale) * Math.min(drift, Math.abs(base - hero.morale));
    }

    // chores
    if (hero.activity === 'chore' && hero.choreId) {
      const chore = CHORES[hero.choreId];
      if (chore) {
        goldDelta += chore.goldPerHour * dtHours;
        const carry = (hero.choreXpCarry ?? 0) + chore.xpPerHour * dtHours;
        const whole = Math.floor(carry);
        hero.choreXpCarry = carry - whole;
        if (whole > 0) addXp(state, hero, whole, events);
      }
    }
  }
  const wholeGold = Math.trunc(goldDelta);
  state.village.choreGoldCarry = goldDelta - wholeGold;
  state.village.gold = Math.max(0, state.village.gold + wholeGold);
}

// ---------- statuses & cooldowns ----------
function tickStatuses(state: GameState, run: DungeonRun) {
  for (const id of run.party.memberIds) {
    const hero = state.roster[id];
    if (!hero || id in run.party.downed) continue;
    const d = derive(hero);
    // mana trickles back each tick, faster for clever heads
    if (hero.mp < d.maxMp) {
      hero.mp = Math.min(d.maxMp, hero.mp + manaRegenPerTick(d.attrs.int));
    }
    for (const st of hero.statuses) {
      st.ticksLeft--;
      const def = STATUSES[st.statusId];
      if (def?.hpPerTick) hero.hp += def.hpPerTick;
    }
    if (hero.hp > d.maxHp) hero.hp = d.maxHp; // regrowth must not overheal
    hero.statuses = hero.statuses.filter((s) => s.ticksLeft > 0);
  }
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    for (const st of m.statuses) {
      st.ticksLeft--;
      const def = STATUSES[st.statusId];
      if (def?.hpPerTick) m.hp += def.hpPerTick;
    }
    m.statuses = m.statuses.filter((s) => s.ticksLeft > 0);
    // borrowed time: summons crumble when it runs out
    if (m.ttlTicks !== undefined && m.hp > 0) {
      m.ttlTicks--;
      if (m.ttlTicks <= 0) m.hp = 0;
    }
  }
}

function tickCooldowns(state: GameState, run: DungeonRun) {
  for (const id of run.party.memberIds) {
    const hero = state.roster[id];
    if (!hero) continue;
    for (const k of Object.keys(hero.cooldowns)) {
      if (hero.cooldowns[k]! > 0) hero.cooldowns[k]!--;
    }
  }
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    for (const k of Object.keys(m.cooldowns)) {
      if (m.cooldowns[k]! > 0) m.cooldowns[k]!--;
    }
  }
}

// ---------- hero decisions ----------
function engagedMonsterIds(state: GameState, run: DungeonRun): Id[] {
  const standing = standingIds(run);
  const out: Id[] = [];
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (m.hp <= 0) continue;
    if (creatureDef(m.defId).disposition !== 'hostile') continue;
    if (m.aggro) {
      out.push(id);
      continue;
    }
    const r = ENGAGE_RADIUS * behaviorKnobs(run.behavior).engageMult;
    const r2 = r * r;
    for (const hid of standing) {
      if (euclid2(m.pos, run.party.pos[hid]!) <= r2) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}

function nearestOf(pos: Vec2, ids: Id[], getPos: (id: Id) => Vec2): Id | null {
  let best: Id | null = null;
  let bestD = Infinity;
  for (const id of ids) {
    const d = euclid2(pos, getPos(id));
    if (d < bestD || (d === bestD && best !== null && id < best)) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * The first `count` walkable cells around an anchor, BFS order — one per hero.
 * Spreading the party over distinct cells (instead of everyone wanting the
 * same tile) is what makes regrouping converge in 1-wide corridors.
 */
function regroupCells(run: DungeonRun, anchor: Vec2, count: number): Vec2[] {
  const cells: Vec2[] = [];
  const seen = new Set<string>([`${anchor.x},${anchor.y}`]);
  const queue: Vec2[] = [anchor];
  while (queue.length > 0 && cells.length < count) {
    const cur = queue.shift()!;
    cells.push(cur);
    for (const dir of DIRS) {
      const x = cur.x + dir.x;
      const y = cur.y + dir.y;
      const key = `${x},${y}`;
      if (!seen.has(key) && isPassable(run.floor, x, y)) {
        seen.add(key);
        queue.push({ x, y });
      }
    }
  }
  return cells;
}

/** everyone standing has settled onto one of the party's regroup cells */
function partyRegrouped(run: DungeonRun, anchor: Vec2): boolean {
  const standing = standingIds(run);
  if (standing.length === 0) return false;
  const cells = regroupCells(run, anchor, standing.length);
  return standing.every((hid) => {
    const p = run.party.pos[hid]!;
    return cells.some((c) => c.x === p.x && c.y === p.y);
  });
}

function computeObjective(run: DungeonRun): Vec2 {
  if (run.intent === 'withdraw') return run.floor.entrance;
  const leader = standingIds(run)[0];
  const leaderPos = leader ? run.party.pos[leader]! : run.floor.entrance;
  // 1. unopened chest in a visited room
  let bestChest: Vec2 | null = null;
  let bestD = Infinity;
  for (const chest of run.floor.chests) {
    if (chest.opened) continue;
    const room = insideAnyRoom(run.floor.rooms, chest.pos.x, chest.pos.y);
    if (room === -1 || !run.visitedRooms.includes(room)) continue;
    const d = euclid2(leaderPos, chest.pos);
    if (d < bestD) {
      bestD = d;
      bestChest = chest.pos;
    }
  }
  if (bestChest) return bestChest;
  // 2. next unvisited room — in BFS order, or a shuffled wander order
  for (const ri of behaviorKnobs(run.behavior).wander ? wanderOrder(run) : roomOrder(run)) {
    if (!run.visitedRooms.includes(ri)) {
      const room = run.floor.rooms[ri]!;
      return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
    }
  }
  // 3. stairs
  return run.floor.stairs;
}

function buildBattleView(
  state: GameState,
  run: DungeonRun,
  heroId: Id,
  d: DerivedStats,
  engaged: Id[],
  carriedBy: Map<Id, Id>,
): BattleView {
  const myPos = run.party.pos[heroId]!;
  const hero = state.roster[heroId]!;
  const enemies = engaged
    .map((mid) => {
      const m = run.monsters[mid]!;
      const def = creatureDef(m.defId);
      return {
        id: mid,
        level: m.level,
        dist2: euclid2(myPos, m.pos),
        adjacent: manhattan(myPos, m.pos) <= 1,
        isBoss: def.tier === 'boss',
        isElite: m.elite,
      };
    })
    .sort((a, b) => a.dist2 - b.dist2 || (a.id < b.id ? -1 : 1));
  const allies = standingIds(run)
    .map((aid) => {
      const ally = state.roster[aid]!;
      const ad = aid === heroId ? d : derive(ally);
      return { id: aid, hpFrac: ally.hp / ad.maxHp, dist2: euclid2(myPos, run.party.pos[aid]!) };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const downedAllies = Object.keys(run.party.downed)
    .filter((did) => !carriedBy.has(did))
    .sort();
  let myMinions = 0;
  let myMinionCost = 0;
  for (const mid of run.monsterOrder) {
    const m = run.monsters[mid]!;
    if (m.hp > 0 && m.summonedBy === heroId) {
      myMinions++;
      myMinionCost += m.summonCost ?? 0;
    }
  }
  return {
    enemies,
    allies,
    downedAllies,
    selfHpFrac: hero.hp / d.maxHp,
    selfMpFrac: d.maxMp > 0 ? hero.mp / d.maxMp : 1,
    carrying: !!run.party.carrying[heroId],
    withdrawing: run.intent === 'withdraw',
    myMinions,
    myMinionCost,
    corpseCount: run.corpses?.length ?? 0,
  };
}

/**
 * Hero pathing prefers routing AROUND allies (they hard-block the first A*
 * attempt); only when no such route exists do we fall back to a path through
 * them, which the swap rule in stepOrFight then resolves. Routing-first kills
 * the priority-inversion dance where an early-order hero keeps swap-yanking a
 * later one off its course; swap-as-fallback still breaks head-on corridor jams.
 */
function heroRoute(
  run: DungeonRun,
  heroId: Id,
  compute: (blocked?: (x: number, y: number) => boolean) => Vec2[] | null,
): Vec2[] | null {
  const allyCells = new Set<string>();
  for (const aid of run.party.memberIds) {
    if (aid === heroId || aid in run.party.downed) continue;
    const p = run.party.pos[aid]!;
    allyCells.add(`${p.x},${p.y}`);
  }
  const around = compute((x, y) => allyCells.has(`${x},${y}`));
  if (around && around.length > 0) return around;
  return compute(undefined);
}

/**
 * Resolve a hero's next step against whoever actually stands on it — strict
 * one-entity-per-tile:
 *  - hostile  -> bump-attack (and provoke the pack); no deadlock at doorways
 *  - neutral  -> shoo it: swap places (the chicken is gently relocated)
 *  - ally     -> swap places if they're standing still, otherwise hold a beat
 *  - empty    -> walk
 */
function stepOrFight(run: DungeonRun, heroId: Id, d: DerivedStats, step: Vec2, moveTicks: number): boolean {
  const blockerId = run.monsterOrder.find((mid) => {
    const m = run.monsters[mid]!;
    return m.hp > 0 && m.pos.x === step.x && m.pos.y === step.y;
  });
  if (blockerId) {
    const blocker = run.monsters[blockerId]!;
    if (creatureDef(blocker.defId).disposition === 'hostile') {
      aggroPack(run, blocker.packId);
      run.party.targetId[heroId] = blockerId;
      run.party.action[heroId] = { kind: 'attack', targetId: blockerId, ticksLeft: d.attackTicks, total: d.attackTicks };
      return true;
    }
    // neutral: swap places so a parked chicken can never wall off a corridor
    const myPos = { ...run.party.pos[heroId]! };
    blocker.move = { from: { ...blocker.pos }, t: 0, total: Math.max(1, creatureDef(blocker.defId).base.moveTicks) };
    blocker.pos = myPos;
    startHeroMove(run, heroId, step, moveTicks);
    return true;
  }

  const allyId = run.party.memberIds.find(
    (aid) =>
      aid !== heroId &&
      !(aid in run.party.downed) &&
      run.party.pos[aid]!.x === step.x &&
      run.party.pos[aid]!.y === step.y,
  );
  if (allyId) {
    if (run.party.move[allyId]) return true; // they're vacating or arriving — wait a beat
    // an ally mid-swing/cast/sip is BUSY: yanking them out of position wastes
    // their action and (in a corridor) sets off an endless swap dance
    if (run.party.action[allyId]) return true;
    const myPos = { ...run.party.pos[heroId]! };
    run.party.move[allyId] = { from: { ...run.party.pos[allyId]! }, t: 0, total: Math.max(1, moveTicks) };
    run.party.pos[allyId] = myPos;
    startHeroMove(run, heroId, step, moveTicks);
    return true;
  }

  startHeroMove(run, heroId, step, moveTicks);
  return true;
}

/** the nearest living hostile this hero could hit without moving */
function nearestHostileInRange(run: DungeonRun, myPos: Vec2, d: DerivedStats): Id | null {
  const melee = d.attackRange <= 1;
  let best: Id | null = null;
  let bestD = Infinity;
  for (const mid of run.monsterOrder) {
    const m = run.monsters[mid]!;
    if (m.hp <= 0 || m.summonedBy) continue;
    if (creatureDef(m.defId).disposition !== 'hostile') continue;
    const inRange = melee
      ? manhattan(myPos, m.pos) <= 1
      : euclid2(myPos, m.pos) <= d.attackRange * d.attackRange;
    if (!inRange) continue;
    const dist = euclid2(myPos, m.pos);
    if (dist < bestD || (dist === bestD && (best === null || mid < best))) {
      bestD = dist;
      best = mid;
    }
  }
  return best;
}

/** act on an evaluator decision; returns true if the hero's turn is consumed */
function performResolved(
  state: GameState,
  run: DungeonRun,
  heroId: Id,
  d: DerivedStats,
  resolved: ResolvedAction,
  moveTicks: number,
  carriedBy: Map<Id, Id>,
  events: GameEvent[],
): boolean {
  const hero = state.roster[heroId]!;
  const myPos = run.party.pos[heroId]!;

  switch (resolved.kind) {
    case 'attack': {
      const target = run.monsters[resolved.targetId];
      if (!target || target.hp <= 0) return false;
      // moving against a monster provokes its whole pack — it closes the
      // distance instead of letting heroes dither at the engagement boundary
      if (creatureDef(target.defId).disposition === 'hostile') aggroPack(run, target.packId);
      run.party.targetId[heroId] = resolved.targetId;
      const melee = d.attackRange <= 1;
      const inRange = melee
        ? manhattan(myPos, target.pos) <= 1
        : euclid2(myPos, target.pos) <= d.attackRange * d.attackRange;
      if (inRange) {
        run.party.action[heroId] = {
          kind: 'attack',
          targetId: resolved.targetId,
          ticksLeft: d.attackTicks,
          total: d.attackTicks,
        };
        return true;
      }
      // the chosen target is out of reach — but if ANYTHING hostile is in
      // range right now, swing at it instead of shuffling for position
      // (three melee heroes in a corridor used to dance forever here)
      const alt = nearestHostileInRange(run, myPos, d);
      if (alt) {
        aggroPack(run, run.monsters[alt]!.packId);
        run.party.targetId[heroId] = alt;
        run.party.action[heroId] = { kind: 'attack', targetId: alt, ticksLeft: d.attackTicks, total: d.attackTicks };
        return true;
      }
      if (run.intent === 'withdraw') return false;
      const path = heroRoute(run, heroId, (blocked) =>
        melee
          ? astarAdjacent(run.floor, myPos, target.pos, blocked)
          : astar(
              run.floor,
              myPos,
              target.pos,
              (x, y) => euclid2({ x, y }, target.pos) <= d.attackRange * d.attackRange,
              blocked,
            ),
      );
      if (path && path.length > 0) {
        return stepOrFight(run, heroId, d, path[0]!, moveTicks);
      }
      return false;
    }
    case 'cast': {
      const skill = SKILLS[resolved.skillId];
      if (!skill) return false;
      // resolve the cast position: enemy / ally / self
      let targetPos: Vec2 | null = null;
      if (resolved.targetId) {
        if (run.monsters[resolved.targetId]) targetPos = run.monsters[resolved.targetId]!.pos;
        else if (run.party.pos[resolved.targetId] && !(resolved.targetId in run.party.downed)) {
          targetPos = run.party.pos[resolved.targetId]!;
        } else {
          return false;
        }
      }
      const range = Math.max(0, skill.range);
      const inRange = !targetPos || range === 0 || euclid2(myPos, targetPos) <= range * range;
      // explosions hurt friends too now — the AI refuses to light one with
      // an ally standing in the predicted blast (players can still cause
      // chaos by moving in during the cast)
      if (skill.kind === 'attack' && skill.target === 'enemiesInRadius') {
        const center = targetPos ?? myPos;
        const r2 = (skill.radius ?? 1) * (skill.radius ?? 1);
        for (const hid of run.party.memberIds) {
          if (hid === heroId || hid in run.party.downed) continue;
          if (euclid2(center, run.party.pos[hid]!) <= r2) return false;
        }
      }
      if (inRange) {
        // State of Grace: a devout priest channels heals & buffs for free
        const graceFree = inStateOfGrace(hero) && (skill.kind === 'heal' || skill.kind === 'buff');
        hero.mp -= graceFree ? 0 : skill.mpCost;
        hero.cooldowns[skill.id] = skill.cooldown + skill.castTicks;
        run.party.action[heroId] = {
          kind: 'cast',
          skillId: skill.id,
          targetId: resolved.targetId ?? undefined,
          ticksLeft: skill.castTicks,
          total: skill.castTicks,
        };
        events.push({ t: 'skillCast', src: heroId, skillId: skill.id });
        return true;
      }
      const path = heroRoute(run, heroId, (blocked) =>
        astar(run.floor, myPos, targetPos!, (x, y) => euclid2({ x, y }, targetPos!) <= range * range, blocked),
      );
      if (path && path.length > 0) {
        return stepOrFight(run, heroId, d, path[0]!, moveTicks);
      }
      return false;
    }
    case 'bomb': {
      if (hero.bombs <= 0) return false;
      const target = run.monsters[resolved.targetId];
      if (!target || target.hp <= 0) return false;
      if (creatureDef(target.defId).disposition === 'hostile') aggroPack(run, target.packId);
      run.party.targetId[heroId] = resolved.targetId;
      if (euclid2(myPos, target.pos) <= BOMB_RANGE * BOMB_RANGE) {
        // never lob explosives onto your own friends
        const r2 = BOMB_RADIUS * BOMB_RADIUS;
        for (const hid of run.party.memberIds) {
          if (hid === heroId || hid in run.party.downed) continue;
          if (euclid2(target.pos, run.party.pos[hid]!) <= r2) return false;
        }
        run.party.action[heroId] = {
          kind: 'bomb',
          targetId: resolved.targetId,
          at: { ...target.pos },
          ticksLeft: BOMB_THROW_TICKS,
          total: BOMB_THROW_TICKS,
        };
        return true;
      }
      if (run.intent === 'withdraw') return false;
      const path = heroRoute(run, heroId, (blocked) =>
        astar(run.floor, myPos, target.pos, (x, y) => euclid2({ x, y }, target.pos) <= BOMB_RANGE * BOMB_RANGE, blocked),
      );
      if (path && path.length > 0) {
        return stepOrFight(run, heroId, d, path[0]!, moveTicks);
      }
      return false;
    }
    case 'potion': {
      run.party.action[heroId] = { kind: 'potion', potion: resolved.potion, ticksLeft: 4, total: 4 };
      return true;
    }
    case 'defend': {
      run.party.action[heroId] = { kind: 'defend', ticksLeft: 10, total: 10 };
      return true;
    }
    case 'retreat': {
      // step to the unoccupied neighbor farthest from the nearest enemy
      const engagedNow = engagedMonsterIds(state, run);
      if (engagedNow.length === 0) return false;
      const nearest = nearestOf(myPos, engagedNow, (mid) => run.monsters[mid]!.pos)!;
      const ePos = run.monsters[nearest]!.pos;
      const occupied = monsterOccupancy(run);
      const heroCells = heroesByPos(state, run);
      let best: Vec2 | null = null;
      let bestD = euclid2(myPos, ePos);
      for (const dir of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const nx = myPos.x + dir.x;
        const ny = myPos.y + dir.y;
        if (!isPassable(run.floor, nx, ny)) continue;
        if (occupied.has(`${nx},${ny}`) || heroCells.has(`${nx},${ny}`)) continue;
        const dd = euclid2({ x: nx, y: ny }, ePos);
        if (dd > bestD) {
          bestD = dd;
          best = { x: nx, y: ny };
        }
      }
      if (best) {
        startHeroMove(run, heroId, best, moveTicks);
        return true;
      }
      return false;
    }
    case 'carry': {
      const tPos = run.party.downed[resolved.targetId]?.pos;
      if (!tPos || run.party.carrying[heroId]) return false;
      if (manhattan(myPos, tPos) <= 1) {
        run.party.carrying[heroId] = resolved.targetId;
        carriedBy.set(resolved.targetId, heroId);
        run.party.downed[resolved.targetId]!.pos = { ...myPos };
        events.push({ t: 'heroCarried', carrier: heroId, carried: resolved.targetId });
        applyMorale(hero, 4, 'rescue', events);
        { const c = state.roster[resolved.targetId]; if (c) applyMorale(c, 3, 'rescued', events); }
        return true;
      }
      const path = heroRoute(run, heroId, (blocked) => astarTo(run.floor, myPos, tPos, blocked));
      if (path && path.length > 0) {
        return stepOrFight(run, heroId, d, path[0]!, moveTicks);
      }
      return false;
    }
    case 'wait': {
      run.party.action[heroId] = { kind: 'wait', ticksLeft: 5, total: 5 };
      return true;
    }
  }
}

function heroDecisions(state: GameState, run: DungeonRun, events: GameEvent[]) {
  const engaged = engagedMonsterIds(state, run);
  const knobs = behaviorKnobs(run.behavior);
  const carriedBy = new Map<Id, Id>(); // downedId -> carrierId
  for (const [carrier, carried] of Object.entries(run.party.carrying)) carriedBy.set(carried, carrier);

  // Focus Fire: the whole party piles onto one foe — the weakest engaged hostile
  // (tie-break lowest id), so targets drop fast and stay shared across heroes.
  let focusId: Id | null = null;
  if (knobs.focus && run.intent !== 'withdraw') {
    for (const mid of engaged) {
      const m = run.monsters[mid];
      if (!m || m.hp <= 0 || m.summonedBy) continue;
      const best = focusId ? run.monsters[focusId] : undefined;
      if (!best || m.hp < best.hp || (m.hp === best.hp && mid < focusId!)) focusId = mid;
    }
  }

  for (const id of run.party.memberIds) {
    if (id in run.party.downed) continue;
    const hero = state.roster[id];
    if (!hero) continue;
    if (run.party.action[id] || run.party.move[id]) continue;
    if (hasStatus(hero.statuses, 'stun')) continue;

    const d = derive(hero);
    const myPos = run.party.pos[id]!;
    const carrying = run.party.carrying[id];
    const moveTicks = d.moveTicks + (carrying ? CARRY_MOVE_PENALTY : 0);

    // morale: a routed hero flees the fight; a rattled one sometimes freezes
    const beh = moraleBehavior(moraleBand(hero.morale, hero.traits));
    if (beh.panic && engaged.length > 0) {
      const step = flowStep(run.floor, entranceField(run), myPos);
      if (step) stepOrFight(run, id, d, step, moveTicks);
      continue;
    }
    if (beh.timid && engaged.length > 0 && chance(state.rng.combat, MORALE_FREEZE_CHANCE)) {
      run.party.action[id] = { kind: 'wait', ticksLeft: 5, total: 5 };
      continue;
    }

    // 1. built-in rescue (party cohesion): pick up a downed, un-carried ally —
    //    always during withdraw, during exploration only when nothing is engaged
    const unCarried = Object.keys(run.party.downed).filter((did) => !carriedBy.has(did));
    if (!carrying && unCarried.length > 0 && (run.intent === 'withdraw' || engaged.length === 0)) {
      const target = nearestOf(myPos, unCarried, (did) => run.party.downed[did]!.pos)!;
      const tPos = run.party.downed[target]!.pos;
      if (manhattan(myPos, tPos) <= 1) {
        run.party.carrying[id] = target;
        carriedBy.set(target, id);
        run.party.downed[target]!.pos = { ...myPos };
        events.push({ t: 'heroCarried', carrier: id, carried: target });
        applyMorale(hero, 4, 'rescue', events);
        { const c = state.roster[target]; if (c) applyMorale(c, 3, 'rescued', events); }
        continue;
      }
      const path = heroRoute(run, id, (blocked) => astarTo(run.floor, myPos, tPos, blocked));
      if (path && path.length > 0) {
        stepOrFight(run, id, d, path[0]!, moveTicks);
        continue;
      }
    }

    // 2. tactics: the player's rules decide (default set ships per class)
    const view = buildBattleView(state, run, id, d, engaged, carriedBy);
    const activeSet =
      hero.tactics.sets.find((s) => s.id === hero.tactics.activeSetId) ?? hero.tactics.sets[0];
    let resolved = (activeSet ? evaluate(hero, d, view, activeSet) : null) ?? defaultAction(view);
    // Stay Healthy: top off with a potion the moment HP dips below the floor
    // (only mid-fight, only if a potion is on hand) — keeps the party topped up.
    if (
      knobs.healthFloor > 0 &&
      engaged.length > 0 &&
      view.selfHpFrac < knobs.healthFloor &&
      hero.potions.hp > 0 &&
      hero.hp < d.maxHp
    ) {
      resolved = { kind: 'potion', potion: 'hp' };
    }
    // target stickiness: keep hammering the same foe while it lives and stays
    // within leash range — prevents re-targeting flip-flop at radius boundaries
    if (resolved?.kind === 'attack' && run.intent !== 'withdraw') {
      const stickyId = run.party.targetId[id];
      const sticky = stickyId ? run.monsters[stickyId] : undefined;
      if (
        sticky &&
        sticky.hp > 0 &&
        creatureDef(sticky.defId).disposition === 'hostile' &&
        euclid2(myPos, sticky.pos) <= knobs.leash
      ) {
        resolved = { kind: 'attack', targetId: stickyId! };
      }
    }
    // Focus Fire overrides the target: converge on the shared focus foe
    if (focusId && resolved?.kind === 'attack' && run.monsters[focusId]) {
      resolved = { kind: 'attack', targetId: focusId };
    }
    if (resolved && performResolved(state, run, id, d, resolved, moveTicks, carriedBy, events)) {
      continue;
    }

    // 3. travel toward the party objective (next room / chest / stairs / exit).
    //    Near the goal each hero claims their OWN regroup cell — one per tile,
    //    so four people never fight over the same flagstone.
    const standing = standingIds(run);
    const myIndex = Math.max(0, standing.indexOf(id));
    if (run.intent === 'withdraw') {
      const entrance = run.floor.entrance;
      if (chebyshev(myPos, entrance) <= 4) {
        const cells = regroupCells(run, entrance, standing.length);
        const myCell = cells[Math.min(myIndex, cells.length - 1)] ?? entrance;
        if (myPos.x !== myCell.x || myPos.y !== myCell.y) {
          const path = heroRoute(run, id, (blocked) => astarTo(run.floor, myPos, myCell, blocked));
          if (path && path.length > 0) stepOrFight(run, id, d, path[0]!, moveTicks);
        }
      } else {
        const step = flowStep(run.floor, entranceField(run), myPos);
        if (step) stepOrFight(run, id, d, step, moveTicks);
      }
      continue;
    }
    // an open event pauses exploration: heroes hold position and wait for the
    // player's choice (they still fight/heal above; only wandering off is paused)
    if (run.pendingEvent) continue;
    const objective = computeObjective(run);
    const cells = regroupCells(run, objective, standing.length);
    const myCell = cells[Math.min(myIndex, cells.length - 1)] ?? objective;
    if (myPos.x !== myCell.x || myPos.y !== myCell.y) {
      const path = heroRoute(run, id, (blocked) => astarTo(run.floor, myPos, myCell, blocked));
      if (path && path.length > 0) {
        stepOrFight(run, id, d, path[0]!, moveTicks);
      }
    }
  }
}

// ---------- monster decisions ----------
function monsterDecisions(state: GameState, run: DungeonRun) {
  const standing = standingIds(run);
  const heroPos = (hid: Id) => run.party.pos[hid]!;

  // living friendly minions are valid targets for hostiles (and shields for heroes)
  const minionIds = run.monsterOrder.filter((mid) => {
    const mm = run.monsters[mid]!;
    return mm.hp > 0 && mm.summonedBy;
  });

  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (m.hp <= 0 || m.action || m.move) continue;
    if (hasStatus(m.statuses, 'stun')) continue;
    const def = creatureDef(m.defId);

    if (m.summonedBy) {
      minionBehavior(state, run, m, def);
      continue;
    }

    if (def.disposition === 'neutral') {
      neutralBehavior(state, run, m);
      continue;
    }

    // stealthed heroes are invisible to monsters: no aggro, no targeting
    const visible = standing.filter((hid) => {
      const hero = state.roster[hid];
      return hero && !isStealthed(hero);
    });
    const targetPosOf = (tid: Id) => (run.monsters[tid] ? run.monsters[tid]!.pos : heroPos(tid));
    const targetables = [...visible, ...minionIds];

    // aggro check (minions provoke just like heroes)
    if (!m.aggro && targetables.length > 0) {
      const r2 = def.base.aggroRadius * def.base.aggroRadius;
      for (const tid of targetables) {
        if (euclid2(m.pos, targetPosOf(tid)) <= r2) {
          aggroPack(run, m.packId);
          break;
        }
      }
    }
    if (!m.aggro || targetables.length === 0) continue;

    // target: taunt source if valid (and visible), else nearest visible hero/minion
    let targetId: Id | null = null;
    const taunt = m.statuses.find((s) => STATUSES[s.statusId]?.taunt);
    if (taunt && visible.includes(taunt.sourceId)) targetId = taunt.sourceId;
    if (!targetId) targetId = nearestOf(m.pos, targetables, targetPosOf);
    if (!targetId) continue;
    m.targetId = targetId;

    // skills (bosses & casters): first ready skill with a target in reach
    let casted = false;
    for (const skillId of def.skills) {
      const skill = SKILLS[skillId];
      if (!skill || (m.cooldowns[skillId] ?? 0) > 0) continue;
      if (skill.target === 'enemiesInRadius') {
        const r2 = (skill.radius ?? 1) * (skill.radius ?? 1);
        if (standing.some((hid) => euclid2(m.pos, heroPos(hid)) <= r2)) {
          m.cooldowns[skillId] = skill.cooldown + skill.castTicks;
          m.action = { kind: 'cast', skillId, ticksLeft: skill.castTicks, total: skill.castTicks };
          casted = true;
          break;
        }
      } else if (skill.target === 'enemy') {
        if (euclid2(m.pos, heroPos(targetId)) <= skill.range * skill.range) {
          m.cooldowns[skillId] = skill.cooldown + skill.castTicks;
          m.action = { kind: 'cast', skillId, targetId, ticksLeft: skill.castTicks, total: skill.castTicks };
          casted = true;
          break;
        }
      }
    }
    if (casted) continue;

    const tPos = targetPosOf(targetId);
    if (manhattan(m.pos, tPos) <= def.base.range) {
      m.action = { kind: 'attack', targetId, ticksLeft: def.base.attackTicks, total: def.base.attackTicks };
      continue;
    }
    // approach: blocked by other monsters AND heroes (body-blocking)
    const occupied = monsterOccupancy(run, id);
    const heroCells = heroesByPos(state, run);
    const isBlocked = (x: number, y: number) => occupied.has(`${x},${y}`) || heroCells.has(`${x},${y}`);
    const path = astarAdjacent(run.floor, m.pos, tPos, isBlocked);
    if (path && path.length > 0) {
      const step = path[0]!;
      // strict one-per-tile: A* exempts goal cells from blocking, so re-check
      if (!isBlocked(step.x, step.y)) {
        startMonsterMove(m, step, def.base.moveTicks);
      }
    }
  }
}

/** summoned creatures: fight the party's enemies, heel near the summoner otherwise */
function minionBehavior(state: GameState, run: DungeonRun, m: MonsterInstance, def: ReturnType<typeof creatureDef>) {
  const hostiles = run.monsterOrder.filter((mid) => {
    const mm = run.monsters[mid]!;
    if (mm.hp <= 0 || mm.summonedBy) return false;
    if (creatureDef(mm.defId).disposition !== 'hostile') return false;
    return mm.aggro || euclid2(m.pos, mm.pos) <= 64;
  });
  const occupied = monsterOccupancy(run, m.id);
  const heroCells = heroesByPos(state, run);
  const isBlocked = (x: number, y: number) => occupied.has(`${x},${y}`) || heroCells.has(`${x},${y}`);

  const targetId = nearestOf(m.pos, hostiles, (mid) => run.monsters[mid]!.pos);
  if (targetId) {
    const tPos = run.monsters[targetId]!.pos;
    if (manhattan(m.pos, tPos) <= def.base.range) {
      m.targetId = targetId;
      m.action = { kind: 'attack', targetId, ticksLeft: def.base.attackTicks, total: def.base.attackTicks };
      return;
    }
    const path = astarAdjacent(run.floor, m.pos, tPos, isBlocked);
    if (path && path.length > 0 && !isBlocked(path[0]!.x, path[0]!.y)) {
      startMonsterMove(m, path[0]!, def.base.moveTicks);
    }
    return;
  }
  // nothing to fight: shamble after the summoner
  const owner = m.summonedBy && !(m.summonedBy in run.party.downed) ? run.party.pos[m.summonedBy] : undefined;
  if (owner && euclid2(m.pos, owner) > 9) {
    const path = astarTo(run.floor, m.pos, owner, isBlocked);
    if (path && path.length > 0 && !isBlocked(path[0]!.x, path[0]!.y)) {
      startMonsterMove(m, path[0]!, def.base.moveTicks);
    }
  }
}

function neutralBehavior(state: GameState, run: DungeonRun, m: MonsterInstance) {
  const def = creatureDef(m.defId);
  const standing = standingIds(run);
  const occupied = monsterOccupancy(run, m.id);
  const heroCells = heroesByPos(state, run);
  const freeNeighbors: Vec2[] = [];
  for (const d of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]) {
    const x = m.pos.x + d.x;
    const y = m.pos.y + d.y;
    if (
      x >= 0 &&
      y >= 0 &&
      x < run.floor.w &&
      y < run.floor.h &&
      run.floor.tiles[y * run.floor.w + x] !== TILE.WALL &&
      !occupied.has(`${x},${y}`) &&
      !heroCells.has(`${x},${y}`)
    ) {
      freeNeighbors.push({ x, y });
    }
  }
  if (freeNeighbors.length === 0) return;

  if (standing.length > 0) {
    const nearest = nearestOf(m.pos, standing, (hid) => run.party.pos[hid]!)!;
    const hp = run.party.pos[nearest]!;
    // shoo: any neutral steps aside when a hero crowds it (flee-types from further out)
    const panicR2 = def.behavior === 'flee' ? 25 : 2;
    if (euclid2(m.pos, hp) <= panicR2) {
      let best = freeNeighbors[0]!;
      let bestD = -1;
      for (const n of freeNeighbors) {
        const d = euclid2(n, hp);
        if (d > bestD) {
          bestD = d;
          best = n;
        }
      }
      startMonsterMove(m, best, def.base.moveTicks);
      return;
    }
  }
  if (chance(state.rng.combat, 0.15)) {
    startMonsterMove(m, pick(state.rng.combat, freeNeighbors), def.base.moveTicks);
  }
}

// ---------- movement ----------
function advanceMovement(state: GameState, run: DungeonRun) {
  for (const id of run.party.memberIds) {
    const mv = run.party.move[id];
    if (!mv) continue;
    mv.t++;
    if (mv.t >= mv.total) {
      run.party.move[id] = null;
      const pos = run.party.pos[id]!;
      revealAround(run.floor, pos, REVEAL_RADIUS);
      const carried = run.party.carrying[id];
      if (carried && run.party.downed[carried]) {
        run.party.downed[carried]!.pos = { ...pos };
      }
    }
  }
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (!m.move) continue;
    m.move.t++;
    if (m.move.t >= m.move.total) m.move = null;
  }
}

// ---------- action resolution ----------
function resolveActions(state: GameState, run: DungeonRun, events: GameEvent[]) {
  // heroes first (memberIds order), then monsters (monsterOrder)
  for (const id of run.party.memberIds) {
    const action = run.party.action[id];
    if (!action || id in run.party.downed) continue;
    action.ticksLeft--;
    if (action.ticksLeft > 0) continue;
    run.party.action[id] = null;
    const hero = state.roster[id];
    if (!hero) continue;
    resolveHeroAction(state, run, hero, action, events);
  }
  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (!m.action || m.hp <= 0) continue;
    m.action.ticksLeft--;
    if (m.action.ticksLeft > 0) continue;
    const action = m.action;
    m.action = null;
    resolveMonsterAttack(state, run, m, action, events);
  }
}

function resolveHeroAction(state: GameState, run: DungeonRun, hero: Hero, action: EntityAction, events: GameEvent[]) {
  const d = derive(hero);
  const myPos = run.party.pos[hero.id]!;

  if (action.kind === 'attack' && action.targetId) {
    const target = run.monsters[action.targetId];
    if (!target || target.hp <= 0) return;
    const melee = d.attackRange <= 1;
    const inRange = melee
      ? manhattan(myPos, target.pos) <= 1
      : euclid2(myPos, target.pos) <= d.attackRange * d.attackRange;
    if (!inRange) return; // target moved away mid-swing
    const def = creatureDef(target.defId);
    const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
    // a strike from the shadows always finds the gap — and ends the act
    const fromStealth = isStealthed(hero);
    const crit = fromStealth || chance(state.rng.combat, d.critChance);
    if (fromStealth) breakStealth(hero);
    let dmg = physDamage(d.weaponDmg, d.attrs.str) * d.dmgMult * variance * (crit ? CRIT_MULT : 1);
    dmg = Math.max(1, Math.round(mitigate(dmg, def.base.armor)));
    target.hp -= dmg;
    target.lastHitBy = hero.id;
    hero.stats.dmgDealt += dmg;
    hero.stats.runDmg += dmg;
    if (def.disposition === 'hostile') aggroPack(run, target.packId);
    events.push({ t: 'damage', src: hero.id, dst: target.id, amount: dmg, crit, pos: { ...target.pos }, srcPos: { ...myPos } });
    return;
  }

  if (action.kind === 'cast' && action.skillId) {
    const skill = SKILLS[action.skillId];
    if (!skill) return;

    // summons: conjure friendly minions on free cells around the caster
    if (skill.kind === 'summon') {
      // build the list of units to raise: reanimation pulls from the corpse pool;
      // a normal summon tops the conjured count up to the skill's count.
      const toSpawn: { defId: MonsterDefId; level: number; hp: number; summonCost: number }[] = [];
      if (skill.reanimate) {
        const pool = run.corpses ?? [];
        let used = 0;
        for (const mid of run.monsterOrder) {
          const m = run.monsters[mid]!;
          if (m.hp > 0 && m.summonedBy === hero.id) used += m.summonCost ?? 0;
        }
        let budget = undeadBudget(hero.level) - used;
        // highest-level corpses first, FIFO among ties (pool order is the kill order)
        const order = pool.map((c, i) => ({ c, i })).sort((a, b) => b.c.level - a.c.level || a.i - b.i);
        const consumed = new Set<number>();
        for (const { c, i } of order) {
          if (c.level > budget) continue;
          const spawnLevel = Math.max(1, Math.round(c.level * REANIMATE_STAT_FRAC));
          const def = creatureDef(c.defId);
          toSpawn.push({
            defId: c.defId,
            level: spawnLevel,
            hp: monsterMaxHp(def.base.hp, spawnLevel, c.elite, false),
            summonCost: c.level,
          });
          budget -= c.level;
          consumed.add(i);
        }
        if (consumed.size > 0) run.corpses = pool.filter((_, i) => !consumed.has(i));
      } else if (skill.summon) {
        const def = creatureDef(skill.summon.defId);
        const alive = run.monsterOrder.filter((mid) => {
          const m = run.monsters[mid]!;
          return m.hp > 0 && m.summonedBy === hero.id;
        }).length;
        const want = Math.max(0, skill.summon.count - alive);
        for (let i = 0; i < want; i++) {
          toSpawn.push({
            defId: def.id,
            level: hero.level,
            hp: monsterMaxHp(def.base.hp, hero.level, false, false),
            summonCost: skill.summonCost ?? 0,
          });
        }
      }
      if (toSpawn.length === 0) return;

      const ttl = skill.reanimate ? 400 : skill.summon!.durationTicks;
      let spawned = 0;
      const seen = new Set<string>([`${myPos.x},${myPos.y}`]);
      const queue: Vec2[] = [myPos];
      const heroCells = heroesByPos(state, run);
      const occupied = monsterOccupancy(run);
      while (queue.length > 0 && spawned < toSpawn.length) {
        const cur = queue.shift()!;
        const key = `${cur.x},${cur.y}`;
        if (cur !== myPos && !heroCells.has(key) && !occupied.has(key)) {
          const u = toSpawn[spawned]!;
          const minion: MonsterInstance = {
            id: allocId(state, 'mn'),
            defId: u.defId,
            level: u.level,
            elite: false,
            hp: u.hp,
            pos: { ...cur },
            move: null,
            targetId: null,
            aggro: false,
            packId: 0,
            action: null,
            statuses: [],
            cooldowns: {},
            summonedBy: hero.id,
            ttlTicks: ttl,
            summonCost: u.summonCost,
          };
          run.monsters[minion.id] = minion;
          run.monsterOrder.push(minion.id);
          occupied.add(key);
          spawned++;
        }
        for (const dir of DIRS) {
          const x = cur.x + dir.x;
          const y = cur.y + dir.y;
          const nkey = `${x},${y}`;
          if (!seen.has(nkey) && isPassable(run.floor, x, y)) {
            seen.add(nkey);
            queue.push({ x, y });
          }
        }
      }
      if (spawned > 0) {
        events.push({ t: 'summon', heroId: hero.id, defId: toSpawn[0]!.defId, count: spawned });
      }
      return;
    }
    let power = skill.physical
      ? physDamage(d.weaponDmg, d.attrs.str) * skill.power * d.dmgMult
      : spellAmount(skill.power, d.attrs.int) * (skill.kind === 'heal' ? 1 : d.dmgMult);
    // State of Grace: a devout priest's heals (and buffs) hit 25% harder
    if (inStateOfGrace(hero) && (skill.kind === 'heal' || skill.kind === 'buff')) power *= GRACE_POWER_MULT;
    // Gambler's coin flip: a seeded draw nudges the swing to boom or bust, and
    // LUCK COINS let a hot streak snowball, buy back a bad beat, or force a win.
    if (skill.flip) {
      const jackpot = skill.id === 'jackpot';
      let headsChance = 0.5;
      let spentAll = false;
      if (jackpot && hero.luckCoins > 0) {
        // bet it all: 50% + 25%/coin (three coins → guaranteed Heads)
        headsChance = Math.min(1, 0.5 + LUCK_COIN_HEADS_PER * hero.luckCoins);
        hero.luckCoins = 0;
        spentAll = true;
      }
      let heads = chance(state.rng.combat, headsChance);
      let rerolled = false;
      if (!heads && !spentAll && hero.luckCoins > 0) {
        // spend a coin to buy back the bad beat — one re-roll
        hero.luckCoins -= 1;
        rerolled = true;
        heads = chance(state.rng.combat, headsChance);
      }
      power *= heads ? skill.flip.heads : skill.flip.tails;
      if (heads && !rerolled) {
        // a natural (or jackpot) Heads pays a coin back — the streak builds
        hero.luckCoins = Math.min(LUCK_COINS_MAX, hero.luckCoins + 1);
      }
      if (!heads) hero.statuses.push({ statusId: 'fumbled', ticksLeft: 30, sourceId: hero.id });
      events.push({ t: 'coinFlip', heroId: hero.id, heads, coins: hero.luckCoins, skillId: skill.id });
    }
    const offensive = skill.kind === 'attack' || skill.kind === 'debuff';
    const fromStealth = offensive && isStealthed(hero);
    if (fromStealth) breakStealth(hero);

    const applyStatuses = (targetStatuses: { statusId: string; ticksLeft: number; sourceId: Id }[]) => {
      for (const ap of skill.applies ?? []) {
        if (chance(state.rng.combat, ap.chance)) {
          targetStatuses.push({ statusId: ap.statusId, ticksLeft: ap.duration, sourceId: hero.id });
        }
      }
    };

    const hitMonster = (m: import('../types').MonsterInstance) => {
      const def = creatureDef(m.defId);
      // Searing Judgment scourges the unclean dead especially hard
      const unclean = skill.id === 'searing_judgment' && isUnclean(m.defId);
      const effPower = unclean ? power * SMITE_UNCLEAN_MULT : power;
      if (effPower > 0) {
        const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
        const crit = skill.physical ? fromStealth || chance(state.rng.combat, d.critChance) : false;
        const dmg = Math.max(1, Math.round(mitigate(effPower * variance * (crit ? CRIT_MULT : 1), def.base.armor)));
        m.hp -= dmg;
        m.lastHitBy = hero.id;
        hero.stats.dmgDealt += dmg;
        hero.stats.runDmg += dmg;
        // holy damage that fells an unclean foe feeds the priest's faith
        if (m.hp <= 0 && unclean) gainDevotion(hero, DEVOTION_SMITE_GAIN);
        events.push({ t: 'damage', src: hero.id, dst: m.id, amount: dmg, crit, pos: { ...m.pos }, srcPos: { ...myPos } });
      }
      applyStatuses(m.statuses);
      if (def.disposition === 'hostile') aggroPack(run, m.packId);
    };

    if (skill.target === 'enemy' && action.targetId) {
      const m = run.monsters[action.targetId];
      if (m && m.hp > 0 && euclid2(myPos, m.pos) <= Math.max(2, skill.range * skill.range + 2)) hitMonster(m);
      return;
    }
    if (skill.target === 'enemiesInRadius') {
      const center = action.targetId && run.monsters[action.targetId] ? run.monsters[action.targetId]!.pos : myPos;
      const r2 = (skill.radius ?? 1) * (skill.radius ?? 1);
      const explosive = skill.kind === 'attack';
      for (const mid of [...run.monsterOrder]) {
        const m = run.monsters[mid]!;
        // debuff clouds pick sides; explosions don't — own summons included
        if (!explosive && m.summonedBy) continue;
        // AoE is otherwise indiscriminate: neutral bystanders are very much in it
        if (m.hp > 0 && euclid2(center, m.pos) <= r2) hitMonster(m);
      }
      // friendly fire: an explosion singes everyone in it except the caster
      // (they are the eye of their own storm — whirlwinds don't cut the spinner)
      if (explosive && power > 0) {
        for (const hid of standingIds(run)) {
          if (hid === hero.id) continue;
          const ally = state.roster[hid];
          if (!ally) continue;
          const aPos = run.party.pos[hid]!;
          if (euclid2(center, aPos) > r2) continue;
          const ad = derive(ally);
          const defending = run.party.action[hid]?.kind === 'defend';
          const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
          const dmg = Math.max(1, Math.round(mitigate(power * variance, ad.armor + (defending ? DEFEND_ARMOR_BONUS : 0))));
          ally.hp -= dmg;
          recordHitTaken(ally, dmg, `${hero.name}'s ${skill.name}`);
          applyMorale(ally, -6, 'friendly_fire', events);
          applyMorale(hero, -3, 'careless', events);
          events.push({ t: 'damage', src: hero.id, dst: hid, amount: dmg, crit: false, pos: { ...aPos }, srcPos: { ...myPos } });
        }
      }
      return;
    }
    if (skill.target === 'lowestHpAlly' && action.targetId) {
      const ally = state.roster[action.targetId];
      if (!ally || action.targetId in run.party.downed || !run.party.memberIds.includes(action.targetId)) return;
      const ad = derive(ally);
      const wasWounded = ally.hp < ad.maxHp * 0.5;
      const amount = Math.max(1, Math.round(power));
      ally.hp = Math.min(ad.maxHp, ally.hp + amount);
      const pos = run.party.pos[action.targetId]!;
      events.push({ t: 'heal', src: hero.id, dst: ally.id, amount, pos: { ...pos } });
      applyStatuses(ally.statuses);
      // a heal that catches an ally below half feeds the priest's faith
      if (wasWounded) gainDevotion(hero, DEVOTION_HEAL_GAIN);
      return;
    }
    if (skill.target === 'self') {
      if (skill.kind === 'heal' && power > 0) {
        const amount = Math.max(1, Math.round(power));
        hero.hp = Math.min(d.maxHp, hero.hp + amount);
        events.push({ t: 'heal', src: hero.id, dst: hero.id, amount, pos: { ...myPos } });
      }
      applyStatuses(hero.statuses);
      return;
    }
    if (skill.target === 'alliesInRadius') {
      // Divine Intervention: the miracle is paid for in faith, spent on cast
      if (skill.id === 'divine_intervention') gainDevotion(hero, -DIVINE_INTERVENTION_COST);
      const r2 = (skill.radius ?? 1) * (skill.radius ?? 1);
      for (const hid of standingIds(run)) {
        const ally = state.roster[hid];
        if (!ally) continue;
        if (euclid2(myPos, run.party.pos[hid]!) > r2) continue;
        if (skill.kind === 'heal' && power > 0) {
          const ad = hid === hero.id ? d : derive(ally);
          const amount = Math.max(1, Math.round(power));
          ally.hp = Math.min(ad.maxHp, ally.hp + amount);
          events.push({ t: 'heal', src: hero.id, dst: hid, amount, pos: { ...run.party.pos[hid]! } });
        }
        applyStatuses(ally.statuses);
      }
      return;
    }
    return;
  }

  if (action.kind === 'bomb') {
    if (hero.bombs <= 0) return;
    hero.bombs--;
    // explode where the target stood when the throw began (bombs don't track)
    const target = action.targetId ? run.monsters[action.targetId] : undefined;
    const center = action.at ?? target?.pos ?? myPos;
    const r2 = BOMB_RADIUS * BOMB_RADIUS;
    events.push({ t: 'bombThrown', heroId: hero.id, pos: { ...center } });
    // every creature in the blast — hostile, neutral, summoned, no exceptions
    for (const mid of [...run.monsterOrder]) {
      const m = run.monsters[mid]!;
      if (m.hp <= 0 || euclid2(center, m.pos) > r2) continue;
      const def = creatureDef(m.defId);
      const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
      const dmg = Math.max(1, Math.round(mitigate(BOMB_DAMAGE * variance, def.base.armor)));
      m.hp -= dmg;
      m.lastHitBy = hero.id;
      hero.stats.dmgDealt += dmg;
      hero.stats.runDmg += dmg;
      if (def.disposition === 'hostile') aggroPack(run, m.packId);
      events.push({ t: 'damage', src: hero.id, dst: m.id, amount: dmg, crit: false, pos: { ...m.pos }, srcPos: { ...myPos } });
    }
    // ...and every hero, the thrower very much included if they're standing in it
    for (const hid of standingIds(run)) {
      const ally = state.roster[hid];
      if (!ally) continue;
      const aPos = run.party.pos[hid]!;
      if (euclid2(center, aPos) > r2) continue;
      const ad = derive(ally);
      const defending = run.party.action[hid]?.kind === 'defend';
      const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
      const dmg = Math.max(1, Math.round(mitigate(BOMB_DAMAGE * variance, ad.armor + (defending ? DEFEND_ARMOR_BONUS : 0))));
      ally.hp -= dmg;
      recordHitTaken(ally, dmg, hid === hero.id ? 'their own bomb' : `${hero.name}'s bomb`);
      if (hid !== hero.id) {
        applyMorale(ally, -6, 'friendly_fire', events);
        applyMorale(hero, -3, 'careless', events);
      }
      events.push({ t: 'damage', src: hero.id, dst: hid, amount: dmg, crit: false, pos: { ...aPos }, srcPos: { ...myPos } });
    }
    return;
  }

  if (action.kind === 'potion' && action.potion) {
    let kind = action.potion;
    if (hero.potions[kind] <= 0) return;
    // color blindness: 10% chance to grab the wrong bottle
    if (hero.injuries.includes('color_blind') && chance(state.rng.combat, 0.1)) {
      const other = kind === 'hp' ? 'mp' : 'hp';
      if (hero.potions[other] > 0) kind = other;
    }
    hero.potions[kind]--;
    const def = ITEMS[kind === 'hp' ? 'hp_potion_s' : 'mp_potion_s']!;
    const amount = def.potion?.amount ?? 10;
    if (kind === 'hp') hero.hp = Math.min(d.maxHp, hero.hp + amount);
    else hero.mp = Math.min(d.maxMp, hero.mp + amount);
    events.push({ t: 'potionUsed', heroId: hero.id, potion: kind, amount, pos: { ...myPos } });
  }
}

function monsterSkillDamage(state: GameState, run: DungeonRun, m: MonsterInstance, power: number, heroId: Id, events: GameEvent[]) {
  const hero = state.roster[heroId];
  if (!hero || heroId in run.party.downed) return;
  if (isStealthed(hero)) return; // can't hit what you can't see
  if (tryMoraleDodge(state, run, hero, m, events)) return;
  const d = derive(hero);
  const defending = run.party.action[heroId]?.kind === 'defend';
  const armor = d.armor + (defending ? DEFEND_ARMOR_BONUS : 0);
  const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
  const raw = power * Math.pow(1.12, m.level - 1) * variance;
  const dmg = Math.max(1, Math.round(mitigate(raw, armor)));
  hero.hp -= dmg;
  recordHitTaken(hero, dmg, monsterHitSource(m, creatureDef(m.defId).name));
  const pos = run.party.pos[heroId]!;
  events.push({ t: 'damage', src: m.id, dst: heroId, amount: dmg, crit: false, pos: { ...pos }, srcPos: { ...m.pos } });
}

function resolveMonsterCast(state: GameState, run: DungeonRun, m: MonsterInstance, action: EntityAction, events: GameEvent[]) {
  const skill = action.skillId ? SKILLS[action.skillId] : undefined;
  if (!skill) return;
  const applyStatuses = (heroId: Id) => {
    const hero = state.roster[heroId];
    if (!hero) return;
    for (const ap of skill.applies ?? []) {
      if (chance(state.rng.combat, ap.chance)) {
        hero.statuses.push({ statusId: ap.statusId, ticksLeft: ap.duration, sourceId: m.id });
      }
    }
  };
  if (skill.target === 'enemiesInRadius') {
    const r2 = (skill.radius ?? 1) * (skill.radius ?? 1);
    for (const hid of standingIds(run)) {
      if (euclid2(m.pos, run.party.pos[hid]!) <= r2) {
        if (skill.power > 0) monsterSkillDamage(state, run, m, skill.power, hid, events);
        applyStatuses(hid);
      }
    }
    // explosions don't pick sides for monsters either: the rest of the pack
    // (and any unlucky neutral) is in the blast too — debuffs stay targeted
    if (skill.kind === 'attack' && skill.power > 0) {
      for (const mid of [...run.monsterOrder]) {
        if (mid === m.id) continue;
        const other = run.monsters[mid]!;
        if (other.hp <= 0 || euclid2(m.pos, other.pos) > r2) continue;
        const otherDef = creatureDef(other.defId);
        const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
        const raw = skill.power * Math.pow(1.12, m.level - 1) * variance;
        const dmg = Math.max(1, Math.round(mitigate(raw, otherDef.base.armor)));
        other.hp -= dmg;
        other.lastHitBy = m.id;
        events.push({ t: 'damage', src: m.id, dst: other.id, amount: dmg, crit: false, pos: { ...other.pos }, srcPos: { ...m.pos } });
      }
    }
    return;
  }
  if (skill.target === 'enemy' && action.targetId) {
    if (!(action.targetId in run.party.downed) && run.party.memberIds.includes(action.targetId)) {
      const hPos = run.party.pos[action.targetId]!;
      if (euclid2(m.pos, hPos) <= Math.max(4, skill.range * skill.range + 2)) {
        if (skill.power > 0) monsterSkillDamage(state, run, m, skill.power, action.targetId, events);
        applyStatuses(action.targetId);
      }
    }
  }
}

function resolveMonsterAttack(state: GameState, run: DungeonRun, m: MonsterInstance, action: EntityAction, events: GameEvent[]) {
  if (action.kind === 'cast') {
    resolveMonsterCast(state, run, m, action, events);
    return;
  }
  if (action.kind !== 'attack' || !action.targetId) return;

  // creature-on-creature: minions striking hostiles, hostiles striking minions
  const creatureTarget = run.monsters[action.targetId];
  if (creatureTarget) {
    if (creatureTarget.hp <= 0) return;
    const def = creatureDef(m.defId);
    if (manhattan(m.pos, creatureTarget.pos) > def.base.range) return;
    const targetDef = creatureDef(creatureTarget.defId);
    const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
    const raw = monsterDmg(def.base.dmg, m.level, m.elite, def.tier === 'boss') * variance;
    const dmg = Math.max(1, Math.round(mitigate(raw, targetDef.base.armor)));
    creatureTarget.hp -= dmg;
    creatureTarget.lastHitBy = m.id;
    if (m.summonedBy && targetDef.disposition === 'hostile') aggroPack(run, creatureTarget.packId);
    events.push({ t: 'damage', src: m.id, dst: creatureTarget.id, amount: dmg, crit: false, pos: { ...creatureTarget.pos }, srcPos: { ...m.pos } });
    return;
  }

  if (action.targetId in run.party.downed) return;
  if (!run.party.memberIds.includes(action.targetId)) return;
  const hero = state.roster[action.targetId];
  if (!hero) return;
  if (isStealthed(hero)) return; // vanished mid-swing: the blade finds only shadow
  if (tryMoraleDodge(state, run, hero, m, events)) return;
  const def = creatureDef(m.defId);
  const hPos = run.party.pos[hero.id]!;
  if (manhattan(m.pos, hPos) > def.base.range) return;

  const d = derive(hero);
  const defending = run.party.action[hero.id]?.kind === 'defend';
  const armor = d.armor + (defending ? DEFEND_ARMOR_BONUS : 0);
  const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
  const raw = monsterDmg(def.base.dmg, m.level, m.elite, def.tier === 'boss') * variance;
  const dmg = Math.max(1, Math.round(mitigate(raw, armor)));
  hero.hp -= dmg;
  recordHitTaken(hero, dmg, monsterHitSource(m, def.name));
  events.push({ t: 'damage', src: m.id, dst: hero.id, amount: dmg, crit: false, pos: { ...hPos }, srcPos: { ...m.pos } });
}

/** the story arc remembers who hurt you, and how badly */
function recordHitTaken(hero: Hero, dmg: number, source: string) {
  hero.stats.lastHitByName = source;
  if (dmg > hero.stats.biggestHitTaken) {
    hero.stats.biggestHitTaken = dmg;
    hero.stats.biggestHitFrom = source;
  }
}

function monsterHitSource(m: MonsterInstance, defName: string): string {
  return `${m.elite ? 'Elite ' : ''}Lvl ${m.level} ${defName}`;
}

// ---------- deaths ----------
function processDeaths(state: GameState, run: DungeonRun, nowMs: number, events: GameEvent[]) {
  // monsters
  for (const id of [...run.monsterOrder]) {
    const m = run.monsters[id]!;
    if (m.hp > 0) continue;
    const def = creatureDef(m.defId);
    const standing = standingIds(run);

    if (m.summonedBy) {
      // summons crumble quietly: no loot, no xp, no mourning
      events.push({ t: 'minionDied', defId: m.defId, pos: { ...m.pos } });
      delete run.monsters[id];
      run.monsterOrder = run.monsterOrder.filter((mid) => mid !== id);
      for (const hid of run.party.memberIds) {
        if (run.party.targetId[hid] === id) run.party.targetId[hid] = null;
      }
      continue;
    }

    if (def.disposition === 'neutral') {
      events.push({ t: 'neutralKilled', defId: m.defId, pos: { ...m.pos } });
      chronicle(state, nowMs, `The party feels bad about the ${def.name.toLowerCase()}.`, run.depth);
      if (m.defId === 'chicken') {
        // a vengeful hen-goddess does not forgive this
        for (const hid of standingIds(run)) {
          const h = state.roster[hid];
          if (h) applyFavor(h, 'chickenKilled', events);
        }
      }
    } else {
      const goldRoll = randInt(state.rng.loot, def.gold[0], def.gold[1]);
      const killer = m.lastHitBy ? state.roster[m.lastHitBy] : undefined;
      const goldMult = killer ? derive(killer).goldMult : 1;
      const gold = Math.round(goldRoll * monsterGoldMult(m.level, def.tier === 'boss') * goldMult);
      // gold goes to the killer's own purse; a minion/absent killer falls back
      // to the first standing hero (deterministic by rosterOrder, weightless gold)
      const goldTaker = killer ?? (standing[0] ? state.roster[standing[0]] : undefined);
      if (goldTaker) {
        goldTaker.gold += gold;
        goldTaker.stats.runGold += gold;
      }
      if (killer) killer.stats.kills++;
      // morale: the slayer is heartened (more for elites/bosses), the party cheered
      const killMorale = def.tier === 'boss' ? 12 : m.elite ? 6 : 3;
      if (killer) applyMorale(killer, killMorale, 'kill', events);
      for (const hid of standing) {
        const h = state.roster[hid];
        if (h && h !== killer) applyMorale(h, 1, 'witnessed_kill', events);
      }
      // religion: the slayer earns favor with their god (melee/elite/boss bonuses)
      if (killer) {
        applyFavor(killer, 'kill', events);
        if (derive(killer).attackRange <= 1) applyFavor(killer, 'killMelee', events);
        if (m.elite) applyFavor(killer, 'killElite', events);
        if (def.tier === 'boss') applyFavor(killer, 'killBoss', events);
      }
      const xp = monsterXp(def.xpBase, m.level, m.elite, def.tier === 'boss');
      const share = xpShare(xp, Math.max(1, standing.length));
      for (const hid of standing) {
        const hero = state.roster[hid];
        if (hero) addXp(state, hero, share, events);
      }
      events.push({ t: 'monsterDied', id: m.id, defId: m.defId, level: m.level, xp, gold, pos: { ...m.pos } });
      if (def.tier === 'boss') {
        events.push({ t: 'bossSlain', defId: m.defId, depth: run.depth });
        if (!state.progress.bossesSlain.includes(m.defId)) state.progress.bossesSlain.push(m.defId);
        const checkpoint = run.depth + 1;
        if (!state.progress.checkpoints.includes(checkpoint)) state.progress.checkpoints.push(checkpoint);
        chronicle(state, nowMs, `${def.name} has been slain at depth ${run.depth}!`, run.depth);
      }
      // Necromancer corpse pool: a fresh body for any living necromancer nearby
      const necroNear = standing.some((hid) => {
        const h = state.roster[hid];
        const hp = run.party.pos[hid];
        return h?.classId === 'necromancer' && hp && manhattan(hp, m.pos) <= CORPSE_REACH;
      });
      if (necroNear) {
        if (!run.corpses) run.corpses = [];
        run.corpses.push({ defId: m.defId, level: m.level, elite: m.elite });
        if (run.corpses.length > CORPSE_POOL_CAP) run.corpses.shift();
      }
    }
    const drops = rollDrops(state, def, m.level, m.elite);
    for (const item of drops) {
      run.groundLoot.push({ id: allocId(state, 'g'), pos: { ...m.pos }, item });
      events.push({ t: 'lootDropped', defId: item.defId, pos: { ...m.pos } });
    }
    delete run.monsters[id];
    run.monsterOrder = run.monsterOrder.filter((mid) => mid !== id);
    for (const hid of run.party.memberIds) {
      if (run.party.targetId[hid] === id) run.party.targetId[hid] = null;
    }
  }

  // heroes
  for (const id of run.party.memberIds) {
    if (id in run.party.downed) continue;
    const hero = state.roster[id];
    if (!hero || hero.hp > 0) continue;
    // DIVINE INTERVENTION: an Exalted believer may be hauled back from the brink
    if (hero.faith) {
      const rel = RELIGIONS[hero.faith.religionId];
      if (rel && favorTier(hero.faith.favor) === 'exalted' && chance(state.rng.combat, resurrectP(rel.resurrectChance, hero.faith.favor))) {
        const d = derive(hero);
        hero.hp = Math.max(1, Math.round(d.maxHp * 0.5));
        hero.faith.favor -= 25; // the blessing is spent — it cannot chain
        applyMorale(hero, 20, 'divine_intervention', events);
        events.push({ t: 'divineIntervention', heroId: id, religionId: hero.faith.religionId });
        continue;
      }
    }
    hero.hp = 0;
    hero.stats.downs++;
    hero.stats.lastDownedHow = `at depth ${run.depth}, struck down by ${hero.stats.lastHitByName ?? 'sheer misadventure'}`;
    run.party.downed[id] = { pos: { ...run.party.pos[id]! } };
    run.party.action[id] = null;
    run.party.move[id] = null;
    run.party.targetId[id] = null;
    // a downed carrier drops their cargo on the spot
    const carried = run.party.carrying[id];
    if (carried) {
      delete run.party.carrying[id];
      if (run.party.downed[carried]) run.party.downed[carried]!.pos = { ...run.party.pos[id]! };
    }
    events.push({ t: 'heroDowned', heroId: id, pos: { ...run.party.pos[id]! } });
    applyMorale(hero, -15, 'downed', events); // they'll start next run shaken
    for (const oid of standingIds(run)) {
      const other = state.roster[oid];
      if (other) applyMorale(other, -10, 'ally_down', events); // the headline trauma
    }
  }
}

/** kg this hero can still haul (their satchel weight is already in carryUsed) */
export function heroSpareCapacity(hero: Hero): number {
  const d = derive(hero);
  return Math.round(Math.max(0, d.carryMax - d.carryUsed) * 10) / 10;
}

/** kg the standing party can still haul, summed across members */
export function partySpareCapacity(state: GameState, run: DungeonRun): number {
  let spare = 0;
  for (const id of standingIds(run)) {
    const hero = state.roster[id];
    if (hero) spare += heroSpareCapacity(hero);
  }
  return Math.round(spare * 10) / 10;
}

// ---------- party logic: loot, chests, rooms, descend, withdraw exit ----------
// ---------- morale ----------
/** Confident/Inspired heroes can fully dodge a hit. Determinism: the die is
 * drawn ONLY when dodge > 0, so any party that never leaves Steady consumes the
 * identical rng stream — do not 'tidy' this into an unconditional roll. */
function tryMoraleDodge(state: GameState, run: DungeonRun, hero: Hero, m: MonsterInstance, events: GameEvent[]): boolean {
  const dodge = moraleCombatMods(moraleBand(hero.morale, hero.traits)).dodge;
  if (dodge <= 0 || !chance(state.rng.combat, dodge)) return false;
  events.push({ t: 'damage', src: m.id, dst: hero.id, amount: 0, crit: false, pos: { ...run.party.pos[hero.id]! } });
  return true;
}

/** periodic social cheer/jeer (banter voices it app-side) + the party-morale readout */
function moraleStep(state: GameState, run: DungeonRun, events: GameEvent[]) {
  const standing = standingIds(run);
  if (state.tick % MORALE_BEAT_TICKS === 0 && !run.pendingEvent && standing.length >= 2 && chance(state.rng.combat, 0.35)) {
    const heroes = standing.map((id) => state.roster[id]!).filter(Boolean);
    let speaker = heroes[0]!;
    let target = heroes[0]!;
    for (const h of heroes) {
      if (h.morale > speaker.morale) speaker = h;
      if (h.morale < target.morale) target = h;
    }
    if (speaker.id !== target.id) {
      const jeers = speaker.traits.includes('gloomy') || speaker.traits.includes('deadpan');
      const valence: 'cheer' | 'jeer' = jeers ? 'jeer' : 'cheer';
      applyMorale(target, valence === 'cheer' ? 4 : -3, 'social', events);
      events.push({ t: 'moraleBeat', from: speaker.id, to: target.id, valence });
    }
  }
  if (standing.length > 0) {
    let sum = 0;
    for (const id of standing) sum += state.roster[id]?.morale ?? 0;
    run.morale = Math.round(sum / standing.length);
  }
  // favor drifts gently toward neutral so the extremes need tending
  if (state.tick % 600 === 0) {
    for (const id of standing) {
      const h = state.roster[id];
      if (h?.faith && h.faith.favor !== 0) h.faith.favor -= Math.sign(h.faith.favor);
    }
  }
}

/** Priest Devotion drifts each tick: +1 in combat (piety under fire), −1 out of it. */
function devotionStep(state: GameState, run: DungeonRun) {
  const inCombat = run.monsterOrder.some((id) => {
    const m = run.monsters[id]!;
    return m.hp > 0 && !m.summonedBy && m.aggro && creatureDef(m.defId).disposition === 'hostile';
  });
  const piety = inCombat && state.tick % DEVOTION_PIETY_TICKS === 0;
  const decay = !inCombat && state.tick % DEVOTION_DECAY_TICKS === 0;
  if (!piety && !decay) return;
  for (const id of standingIds(run)) {
    const h = state.roster[id];
    if (h?.classId === 'priest') gainDevotion(h, piety ? 1 : -1);
  }
}

// ---------- interactive dungeon events ----------
function maybeTriggerEvent(state: GameState, run: DungeonRun, ri: number, events: GameEvent[]) {
  if (run.intent !== 'explore' || run.pendingEvent) return;
  if (Object.keys(run.party.downed).length > 0) return;
  // pure function of (seed, depth, room): re-deriving never double-fires
  const r = makeRng(hash2(run.runSeed, 0xe7e7 ^ (run.depth * 131 + ri)));
  if (!chance(r, EVENT_ROOM_CHANCE)) return;
  const pool = Object.values(DUNGEON_EVENTS).filter((e) => run.depth >= e.minDepth);
  if (pool.length === 0) return;
  const ev = pickWeighted(r, pool, (e) => e.rarity);
  const def = ev.choices.find((c) => c.default) ?? ev.choices[ev.choices.length - 1]!;
  run.pendingEvent = {
    eventId: ev.id,
    roomIndex: ri,
    choiceKeys: ev.choices.map((c) => c.key),
    defaultChoice: def.key,
    deadlineTick: state.tick + EVENT_TIMEOUT_TICKS,
  };
  events.push({ t: 'eventOpened', eventId: ev.id });
}

/** deadline reached with no player choice → the cautious default fires */
function tickPendingEvent(state: GameState, run: DungeonRun, events: GameEvent[]) {
  const pe = run.pendingEvent;
  if (pe && state.tick >= pe.deadlineTick) resolveEvent(state, run, pe.defaultChoice, events);
}

/** BFS the nearest free, passable, unoccupied tile from `from` and drop a monster there */
function placeMonsterNear(
  state: GameState,
  run: DungeonRun,
  from: Vec2,
  defId: string,
  level: number,
  elite: boolean,
  aggro: boolean,
  summonedBy?: Id,
  ttl?: number,
): void {
  const def = creatureDef(defId);
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Vec2[] = [from];
  const heroCells = heroesByPos(state, run);
  const occupied = monsterOccupancy(run);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = `${cur.x},${cur.y}`;
    if (!(cur.x === from.x && cur.y === from.y) && !heroCells.has(key) && !occupied.has(key)) {
      const m: MonsterInstance = {
        id: allocId(state, summonedBy ? 'mn' : 'm'),
        defId,
        level,
        elite,
        hp: monsterMaxHp(def.base.hp, level, elite, false),
        pos: { ...cur },
        move: null,
        targetId: null,
        aggro,
        packId: 0,
        action: null,
        statuses: [],
        cooldowns: {},
        ...(summonedBy ? { summonedBy, ttlTicks: ttl } : {}),
      };
      run.monsters[m.id] = m;
      run.monsterOrder.push(m.id);
      return;
    }
    for (const dir of DIRS) {
      const x = cur.x + dir.x;
      const y = cur.y + dir.y;
      const nk = `${x},${y}`;
      if (!seen.has(nk) && isPassable(run.floor, x, y)) {
        seen.add(nk);
        queue.push({ x, y });
      }
    }
  }
}

function spendPartyGold(state: GameState, run: DungeonRun, amount: number) {
  let left = amount;
  for (const hid of standingIds(run)) {
    if (left <= 0) break;
    const h = state.roster[hid];
    if (!h) continue;
    const take = Math.min(h.gold, left);
    h.gold -= take;
    left -= take;
  }
}

function applyEventEffect(state: GameState, run: DungeonRun, eff: EventEffect, events: GameEvent[]) {
  const standing = standingIds(run);
  const leader = standing[0] ? state.roster[standing[0]] : undefined;
  const leaderPos = (standing[0] ? run.party.pos[standing[0]] : undefined) ?? run.floor.entrance;
  switch (eff.k) {
    case 'loot': {
      const loot = rollChestLoot(state, run.depth + (eff.depthBonus ?? 0));
      if (leader) {
        leader.gold += loot.gold;
        leader.stats.runGold += loot.gold;
      }
      for (const item of loot.items) {
        const weight = ITEMS[item.defId]?.weight ?? 0;
        if (leader && weight <= heroSpareCapacity(leader)) leader.satchel.push(item);
        else run.groundLoot.push({ id: allocId(state, 'g'), pos: { ...leaderPos }, item, heavy: true });
      }
      events.push({ t: 'chestOpened', gold: loot.gold, items: loot.items.map((i) => i.defId), pos: { ...leaderPos } });
      break;
    }
    case 'gold':
      if (leader) {
        if (eff.amount >= 0) {
          leader.gold += eff.amount;
          leader.stats.runGold += eff.amount;
        } else spendPartyGold(state, run, -eff.amount);
      }
      break;
    case 'goldDepth':
      if (leader) {
        const v = Math.round(run.depth * eff.mult);
        leader.gold += v;
        leader.stats.runGold += v;
      }
      break;
    case 'spendGold':
      spendPartyGold(state, run, eff.amount);
      break;
    case 'trap': {
      const targets = eff.selfOnly && leader ? [leader.id] : standing;
      for (const hid of targets) {
        const h = state.roster[hid];
        if (!h) continue;
        const d = derive(h);
        const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
        const dmg = Math.max(1, Math.round(mitigate(monsterDmg(eff.dmgBase, run.depth, false, false) * variance, d.armor)));
        h.hp -= dmg;
        recordHitTaken(h, dmg, 'a dungeon hazard');
        events.push({ t: 'damage', src: hid, dst: hid, amount: dmg, crit: false, pos: { ...run.party.pos[hid]! } });
        if (eff.status) h.statuses.push({ statusId: eff.status, ticksLeft: eff.statusTicks ?? 50, sourceId: hid });
      }
      break;
    }
    case 'spawnEnemy': {
      const n = eff.count ?? 1;
      for (let i = 0; i < n; i++) placeMonsterNear(state, run, leaderPos, eff.defId, run.depth, !!eff.elite, true);
      break;
    }
    case 'spawnAlly':
      if (leader) placeMonsterNear(state, run, leaderPos, eff.defId, leader.level, false, false, leader.id, eff.ttl);
      break;
    case 'heal':
      for (const hid of standing) {
        const h = state.roster[hid];
        if (!h) continue;
        const d = derive(h);
        h.hp = Math.min(d.maxHp, h.hp + eff.amount);
        events.push({ t: 'heal', src: hid, dst: hid, amount: eff.amount, pos: { ...run.party.pos[hid]! } });
      }
      break;
    case 'grantPotion':
      if (leader) leader.potions[eff.kind] += eff.n;
      break;
    case 'spendPotion': {
      const h = standing.map((id) => state.roster[id]).find((x) => !!x && x.potions[eff.kind] > 0);
      if (h) h.potions[eff.kind]--;
      break;
    }
    case 'bless':
      for (const hid of standing) {
        const h = state.roster[hid];
        if (h) h.statuses.push({ statusId: 'blessed', ticksLeft: eff.ticks, sourceId: hid });
      }
      break;
    case 'morale':
      for (const hid of standing) {
        const h = state.roster[hid];
        if (h) applyMorale(h, eff.delta, 'event', events);
      }
      break;
    case 'favor':
      run.favor += eff.delta;
      break;
  }
}

/** resolve the player's (or default) choice for the open event — exported for commands */
export function resolveEvent(state: GameState, run: DungeonRun, choiceKey: string, events: GameEvent[]) {
  const pe = run.pendingEvent;
  if (!pe) return;
  const ev = DUNGEON_EVENTS[pe.eventId];
  run.pendingEvent = undefined;
  if (!ev) return;
  const choice =
    ev.choices.find((c) => c.key === choiceKey) ?? ev.choices.find((c) => c.default) ?? ev.choices[ev.choices.length - 1]!;
  const outcome = pickWeighted(state.rng.combat, choice.outcomes, (o) => o.weight);
  for (const eff of outcome.effects) applyEventEffect(state, run, eff, events);
  events.push({ t: 'eventResolved', eventId: ev.id, choiceKey: choice.key, resultText: outcome.text });
}

function partyLogic(state: GameState, run: DungeonRun, nowMs: number, events: GameEvent[]) {
  run.ticksOnFloor++;
  const standing = standingIds(run);

  // loot pickup (same tile) — limited by what the party can still carry
  if (run.groundLoot.length > 0) {
    const keep: typeof run.groundLoot = [];
    for (const loot of run.groundLoot) {
      const takerId = standing.find((hid) => {
        const p = run.party.pos[hid]!;
        return p.x === loot.pos.x && p.y === loot.pos.y;
      });
      const taker = takerId ? state.roster[takerId] : undefined;
      if (taker && takerId) {
        const weight = ITEMS[loot.item.defId]?.weight ?? 0;
        if (weight <= heroSpareCapacity(taker)) {
          taker.satchel.push(loot.item); // loot stays with the hero who grabbed it
          events.push({ t: 'lootPicked', defId: loot.item.defId, by: takerId });
          continue;
        }
        if (!loot.heavy) {
          loot.heavy = true;
          events.push({ t: 'lootTooHeavy', defId: loot.item.defId });
        }
      }
      keep.push(loot);
    }
    run.groundLoot = keep;
  }

  // chests (adjacent incl. diagonals — travel parks heroes at chebyshev 1)
  for (const chest of run.floor.chests) {
    if (chest.opened) continue;
    const openerId = standing.find((hid) => chebyshev(run.party.pos[hid]!, chest.pos) <= 1);
    if (!openerId) continue;
    chest.opened = true;
    const opener = state.roster[openerId];
    const loot = rollChestLoot(state, run.depth);
    if (opener) {
      opener.gold += loot.gold;
      opener.stats.runGold += loot.gold;
    }
    for (const item of loot.items) {
      const weight = ITEMS[item.defId]?.weight ?? 0;
      if (opener && weight <= heroSpareCapacity(opener)) {
        opener.satchel.push(item);
      } else {
        run.groundLoot.push({ id: allocId(state, 'g'), pos: { ...chest.pos }, item, heavy: true });
      }
    }
    if (opener) applyFavor(opener, 'chest', events);
    events.push({ t: 'chestOpened', gold: loot.gold, items: loot.items.map((i) => i.defId), pos: { ...chest.pos } });
  }

  // room discovery + neutral sightings
  for (const hid of standing) {
    const p = run.party.pos[hid]!;
    const ri = insideAnyRoom(run.floor.rooms, p.x, p.y);
    if (ri >= 0 && !run.visitedRooms.includes(ri)) {
      run.visitedRooms.push(ri);
      for (const mid of run.monsterOrder) {
        const m = run.monsters[mid]!;
        const def = creatureDef(m.defId);
        if (def.disposition === 'neutral' && !m.summonedBy && insideAnyRoom(run.floor.rooms, m.pos.x, m.pos.y) === ri) {
          events.push({ t: 'neutralSighted', defId: m.defId, pos: { ...m.pos } });
          chronicle(state, nowMs, sightingText(def.name), run.depth);
        }
      }
      maybeTriggerEvent(state, run, ri, events);
    }
  }

  // boss arena doors: slam shut while the boss lives and the party stands inside
  if (run.floor.isBossFloor && run.floor.bossDoors) {
    const arena = run.floor.rooms[1];
    const boss = run.monsterOrder
      .map((mid) => run.monsters[mid]!)
      .find((m) => m.hp > 0 && creatureDef(m.defId).tier === 'boss');
    const inArena = (p: Vec2) =>
      !!arena && p.x >= arena.x && p.x < arena.x + arena.w && p.y >= arena.y && p.y < arena.y + arena.h;
    const shouldClose =
      !!boss &&
      boss.aggro &&
      run.intent !== 'withdraw' &&
      standing.length > 0 &&
      standing.every((hid) => inArena(run.party.pos[hid]!));
    for (const door of run.floor.bossDoors) {
      run.floor.tiles[door.y * run.floor.w + door.x] = shouldClose ? TILE.DOOR_CLOSED : TILE.DOOR;
    }
  }

  // a downed friend means the expedition is over: grab them and head home
  if (AUTO_WITHDRAW_ON_DOWNED && run.intent === 'explore' && Object.keys(run.party.downed).length > 0) {
    run.intent = 'withdraw';
    events.push({ t: 'withdrawOrdered' });
    chronicle(state, nowMs, 'A hero is down — the party falls back toward the surface.', run.depth);
  }

  const unCarried = Object.keys(run.party.downed).filter(
    (did) => !Object.values(run.party.carrying).includes(did),
  );

  // descend: everyone (carrying included) settled around the stairs, nobody left behind
  if (run.intent === 'explore' && unCarried.length === 0 && standing.length > 0) {
    if (partyRegrouped(run, run.floor.stairs)) {
      enterFloor(state, run, run.depth + 1, events);
      return;
    }
  }

  // withdraw exit: all standing heroes settled around the entrance
  if (run.intent === 'withdraw' && standing.length > 0) {
    if (partyRegrouped(run, run.floor.entrance)) {
      endRunWithdrawn(state, nowMs, events);
    }
  }
}

function sightingText(name: string): string {
  return `The party encountered a ${name.toLowerCase()}. It seems unbothered.`;
}
