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
  MonsterInstance,
  Vec2,
} from '../types';
import { TILE, type Command } from '../types';
import { chance, pick, rand, randInt, randRange } from '../core/rng';
import {
  CARRY_MOVE_PENALTY,
  CRIT_MULT,
  DEFEND_ARMOR_BONUS,
  DMG_VARIANCE,
  ENGAGE_RADIUS,
  REVEAL_RADIUS,
  monsterDmg,
  monsterGoldMult,
  monsterXp,
  mitigate,
  physDamage,
  xpShare,
} from '../balance';
import { ITEMS, SKILLS, STATUSES, creatureDef } from '../content';
import { derive, type DerivedStats } from '../hero/derive';
import { addXp } from '../hero/leveling';
import { defaultAction, evaluate, type BattleView, type ResolvedAction } from '../tactics/evaluator';
import { spellAmount } from '../balance';
import { rollChestLoot, rollDrops, allocId } from '../items/factory';
import {
  astar,
  astarAdjacent,
  astarTo,
  bfsDistances,
  chebyshev,
  euclid2,
  flowStep,
  manhattan,
} from '../dungeon/pathfind';
import { explorationOrder, insideAnyRoom, revealAround } from '../dungeon/generate';
import { endRunWiped, endRunWithdrawn, enterFloor, chronicle } from './lifecycle';
import { applyCommand } from '../commands';
import { RECOVERY_HP_FRACTION_PER_SEC } from '../balance';

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

function hasStatus(statuses: { statusId: string }[], kind: 'taunt' | 'stun'): boolean {
  return statuses.some((s) => STATUSES[s.statusId]?.[kind]);
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
  villageUpkeep(state, nowMs);

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
  if (state.run && standingIds(run).length === 0) {
    endRunWiped(state, nowMs, events);
  }
  state.tick++;
}

// ---------- village upkeep (wall-clock, mode-independent) ----------
export function villageUpkeep(state: GameState, nowMs: number) {
  const last = state.village.lastChoreAccrualMs;
  if (nowMs < last) {
    state.village.lastChoreAccrualMs = nowMs; // clock went backwards: re-anchor
    return;
  }
  const dtMs = nowMs - last;
  if (dtMs < 1000) return;
  const dtSec = dtMs / 1000;
  for (const id of state.rosterOrder) {
    const hero = state.roster[id];
    if (!hero || hero.activity === 'party') continue;
    const d = derive(hero);
    if (hero.hp < d.maxHp) {
      hero.hp = Math.min(d.maxHp, hero.hp + d.maxHp * RECOVERY_HP_FRACTION_PER_SEC * dtSec);
    }
    if (hero.mp < d.maxMp) {
      hero.mp = Math.min(d.maxMp, hero.mp + d.maxMp * RECOVERY_HP_FRACTION_PER_SEC * 2 * dtSec);
    }
    if (hero.activity === 'recovering' && hero.hp >= d.maxHp) hero.activity = 'idle';
  }
  state.village.lastChoreAccrualMs = nowMs;
}

// ---------- statuses & cooldowns ----------
function tickStatuses(state: GameState, run: DungeonRun) {
  for (const id of run.party.memberIds) {
    const hero = state.roster[id];
    if (!hero || id in run.party.downed) continue;
    for (const st of hero.statuses) {
      st.ticksLeft--;
      const def = STATUSES[st.statusId];
      if (def?.hpPerTick) hero.hp += def.hpPerTick;
    }
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
    for (const hid of standing) {
      if (euclid2(m.pos, run.party.pos[hid]!) <= ENGAGE_RADIUS * ENGAGE_RADIUS) {
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
  // 2. next unvisited room in BFS order
  for (const ri of roomOrder(run)) {
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
  return {
    enemies,
    allies,
    downedAllies,
    selfHpFrac: hero.hp / d.maxHp,
    selfMpFrac: d.maxMp > 0 ? hero.mp / d.maxMp : 1,
    carrying: !!run.party.carrying[heroId],
    withdrawing: run.intent === 'withdraw',
  };
}

/** act on an evaluator decision; returns true if the hero's turn is consumed */
function performResolved(
  state: GameState,
  run: DungeonRun,
  heroId: Id,
  d: DerivedStats,
  resolved: ResolvedAction,
  moveTicks: number,
  isBlocked: (x: number, y: number) => boolean,
  carriedBy: Map<Id, Id>,
  events: GameEvent[],
): boolean {
  const hero = state.roster[heroId]!;
  const myPos = run.party.pos[heroId]!;

  switch (resolved.kind) {
    case 'attack': {
      const target = run.monsters[resolved.targetId];
      if (!target || target.hp <= 0) return false;
      const melee = d.attackRange <= 1;
      const inRange = melee
        ? manhattan(myPos, target.pos) <= 1
        : euclid2(myPos, target.pos) <= d.attackRange * d.attackRange;
      if (inRange) {
        run.party.targetId[heroId] = resolved.targetId;
        run.party.action[heroId] = {
          kind: 'attack',
          targetId: resolved.targetId,
          ticksLeft: d.attackTicks,
          total: d.attackTicks,
        };
        return true;
      }
      if (run.intent === 'withdraw') return false;
      const path = melee
        ? astarAdjacent(run.floor, myPos, target.pos, isBlocked)
        : astar(
            run.floor,
            myPos,
            target.pos,
            (x, y) => euclid2({ x, y }, target.pos) <= d.attackRange * d.attackRange,
            isBlocked,
          );
      if (path && path.length > 0) {
        startHeroMove(run, heroId, path[0]!, moveTicks);
        return true;
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
      if (inRange) {
        hero.mp -= skill.mpCost;
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
      const path = astar(
        run.floor,
        myPos,
        targetPos!,
        (x, y) => euclid2({ x, y }, targetPos!) <= range * range,
        isBlocked,
      );
      if (path && path.length > 0) {
        startHeroMove(run, heroId, path[0]!, moveTicks);
        return true;
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
      // step to the free neighbor farthest from the nearest enemy
      const engagedNow = engagedMonsterIds(state, run);
      if (engagedNow.length === 0) return false;
      const nearest = nearestOf(myPos, engagedNow, (mid) => run.monsters[mid]!.pos)!;
      const ePos = run.monsters[nearest]!.pos;
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
        if (nx < 0 || ny < 0 || nx >= run.floor.w || ny >= run.floor.h) continue;
        if (run.floor.tiles[ny * run.floor.w + nx] === TILE.WALL) continue;
        if (isBlocked(nx, ny)) continue;
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
        return true;
      }
      const path = astarTo(run.floor, myPos, tPos, isBlocked);
      if (path && path.length > 0) {
        startHeroMove(run, heroId, path[0]!, moveTicks);
        return true;
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
  const carriedBy = new Map<Id, Id>(); // downedId -> carrierId
  for (const [carrier, carried] of Object.entries(run.party.carrying)) carriedBy.set(carried, carrier);

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
    const blocked = monsterOccupancy(run);
    const isBlocked = (x: number, y: number) => blocked.has(`${x},${y}`);

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
        continue;
      }
      const path = astarTo(run.floor, myPos, tPos, isBlocked);
      if (path && path.length > 0) {
        startHeroMove(run, id, path[0]!, moveTicks);
        continue;
      }
    }

    // 2. tactics: the player's rules decide (default set ships per class)
    const view = buildBattleView(state, run, id, d, engaged, carriedBy);
    const activeSet =
      hero.tactics.sets.find((s) => s.id === hero.tactics.activeSetId) ?? hero.tactics.sets[0];
    const resolved = (activeSet ? evaluate(hero, d, view, activeSet) : null) ?? defaultAction(view);
    if (resolved && performResolved(state, run, id, d, resolved, moveTicks, isBlocked, carriedBy, events)) {
      continue;
    }

    // 3. travel toward the party objective (next room / chest / stairs / exit)
    if (run.intent === 'withdraw') {
      const step = flowStep(run.floor, entranceField(run), myPos);
      if (step && !isBlocked(step.x, step.y)) {
        startHeroMove(run, id, step, moveTicks);
      } else if (step) {
        // monster in the doorway: attack it if adjacent
        const blocker = run.monsterOrder.find((mid) => {
          const m = run.monsters[mid]!;
          return m.hp > 0 && m.pos.x === step.x && m.pos.y === step.y;
        });
        if (blocker && manhattan(myPos, step) <= 1 && creatureDef(run.monsters[blocker]!.defId).disposition === 'hostile') {
          run.party.action[id] = { kind: 'attack', targetId: blocker, ticksLeft: d.attackTicks, total: d.attackTicks };
        }
      }
      continue;
    }
    const objective = computeObjective(run);
    if (objective.x !== myPos.x || objective.y !== myPos.y) {
      const path = astarTo(run.floor, myPos, objective, isBlocked);
      if (path && path.length > 0) {
        startHeroMove(run, id, path[0]!, moveTicks);
      }
    }
  }
}

// ---------- monster decisions ----------
function monsterDecisions(state: GameState, run: DungeonRun) {
  const standing = standingIds(run);
  const heroPos = (hid: Id) => run.party.pos[hid]!;

  for (const id of run.monsterOrder) {
    const m = run.monsters[id]!;
    if (m.hp <= 0 || m.action || m.move) continue;
    if (hasStatus(m.statuses, 'stun')) continue;
    const def = creatureDef(m.defId);

    if (def.disposition === 'neutral') {
      neutralBehavior(state, run, m);
      continue;
    }

    // aggro check
    if (!m.aggro && standing.length > 0) {
      const r2 = def.base.aggroRadius * def.base.aggroRadius;
      for (const hid of standing) {
        if (euclid2(m.pos, heroPos(hid)) <= r2) {
          aggroPack(run, m.packId);
          break;
        }
      }
    }
    if (!m.aggro || standing.length === 0) continue;

    // target: taunt source if valid, else nearest standing hero
    let targetId: Id | null = null;
    const taunt = m.statuses.find((s) => STATUSES[s.statusId]?.taunt);
    if (taunt && standing.includes(taunt.sourceId)) targetId = taunt.sourceId;
    if (!targetId) targetId = nearestOf(m.pos, standing, heroPos);
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

    const tPos = heroPos(targetId);
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

  if (def.behavior === 'flee' && standing.length > 0) {
    const nearest = nearestOf(m.pos, standing, (hid) => run.party.pos[hid]!)!;
    const hp = run.party.pos[nearest]!;
    if (euclid2(m.pos, hp) <= 25) {
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
    const crit = chance(state.rng.combat, d.critChance);
    let dmg = physDamage(d.weaponDmg, d.attrs.str) * d.dmgMult * variance * (crit ? CRIT_MULT : 1);
    dmg = Math.max(1, Math.round(mitigate(dmg, def.base.armor)));
    target.hp -= dmg;
    target.lastHitBy = hero.id;
    if (def.disposition === 'hostile') aggroPack(run, target.packId);
    events.push({ t: 'damage', src: hero.id, dst: target.id, amount: dmg, crit, pos: { ...target.pos } });
    return;
  }

  if (action.kind === 'cast' && action.skillId) {
    const skill = SKILLS[action.skillId];
    if (!skill) return;
    const power = skill.physical
      ? physDamage(d.weaponDmg, d.attrs.str) * skill.power * d.dmgMult
      : spellAmount(skill.power, d.attrs.int) * (skill.kind === 'heal' ? 1 : d.dmgMult);

    const applyStatuses = (targetStatuses: { statusId: string; ticksLeft: number; sourceId: Id }[]) => {
      for (const ap of skill.applies ?? []) {
        if (chance(state.rng.combat, ap.chance)) {
          targetStatuses.push({ statusId: ap.statusId, ticksLeft: ap.duration, sourceId: hero.id });
        }
      }
    };

    const hitMonster = (m: import('../types').MonsterInstance) => {
      const def = creatureDef(m.defId);
      if (power > 0) {
        const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
        const crit = skill.physical ? chance(state.rng.combat, d.critChance) : false;
        const dmg = Math.max(1, Math.round(mitigate(power * variance * (crit ? CRIT_MULT : 1), def.base.armor)));
        m.hp -= dmg;
        m.lastHitBy = hero.id;
        events.push({ t: 'damage', src: hero.id, dst: m.id, amount: dmg, crit, pos: { ...m.pos } });
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
      for (const mid of [...run.monsterOrder]) {
        const m = run.monsters[mid]!;
        // AoE is indiscriminate: neutral bystanders are very much in the blast
        if (m.hp > 0 && euclid2(center, m.pos) <= r2) hitMonster(m);
      }
      return;
    }
    if (skill.target === 'lowestHpAlly' && action.targetId) {
      const ally = state.roster[action.targetId];
      if (!ally || action.targetId in run.party.downed || !run.party.memberIds.includes(action.targetId)) return;
      const ad = derive(ally);
      const amount = Math.max(1, Math.round(power));
      ally.hp = Math.min(ad.maxHp, ally.hp + amount);
      const pos = run.party.pos[action.targetId]!;
      events.push({ t: 'heal', src: hero.id, dst: ally.id, amount, pos: { ...pos } });
      applyStatuses(ally.statuses);
      return;
    }
    if (skill.target === 'self' || skill.target === 'alliesInRadius') {
      applyStatuses(hero.statuses);
      return;
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
  const d = derive(hero);
  const defending = run.party.action[heroId]?.kind === 'defend';
  const armor = d.armor + (defending ? DEFEND_ARMOR_BONUS : 0);
  const variance = randRange(state.rng.combat, DMG_VARIANCE[0], DMG_VARIANCE[1]);
  const raw = power * Math.pow(1.12, m.level - 1) * variance;
  const dmg = Math.max(1, Math.round(mitigate(raw, armor)));
  hero.hp -= dmg;
  const pos = run.party.pos[heroId]!;
  events.push({ t: 'damage', src: m.id, dst: heroId, amount: dmg, crit: false, pos: { ...pos } });
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
  if (action.targetId in run.party.downed) return;
  if (!run.party.memberIds.includes(action.targetId)) return;
  const hero = state.roster[action.targetId];
  if (!hero) return;
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
  events.push({ t: 'damage', src: m.id, dst: hero.id, amount: dmg, crit: false, pos: { ...hPos } });
}

// ---------- deaths ----------
function processDeaths(state: GameState, run: DungeonRun, nowMs: number, events: GameEvent[]) {
  // monsters
  for (const id of [...run.monsterOrder]) {
    const m = run.monsters[id]!;
    if (m.hp > 0) continue;
    const def = creatureDef(m.defId);
    const standing = standingIds(run);

    if (def.disposition === 'neutral') {
      events.push({ t: 'neutralKilled', defId: m.defId, pos: { ...m.pos } });
      chronicle(state, nowMs, `The party feels bad about the ${def.name.toLowerCase()}.`, run.depth);
    } else {
      const goldRoll = randInt(state.rng.loot, def.gold[0], def.gold[1]);
      const killer = m.lastHitBy ? state.roster[m.lastHitBy] : undefined;
      const goldMult = killer ? derive(killer).goldMult : 1;
      const gold = Math.round(goldRoll * monsterGoldMult(m.level, def.tier === 'boss') * goldMult);
      run.party.goldCarried += gold;
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
    hero.hp = 0;
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
  }
}

// ---------- party logic: loot, chests, rooms, descend, withdraw exit ----------
function partyLogic(state: GameState, run: DungeonRun, nowMs: number, events: GameEvent[]) {
  run.ticksOnFloor++;
  const standing = standingIds(run);

  // loot pickup (same tile)
  if (run.groundLoot.length > 0) {
    const keep: typeof run.groundLoot = [];
    for (const loot of run.groundLoot) {
      const taker = standing.find((hid) => {
        const p = run.party.pos[hid]!;
        return p.x === loot.pos.x && p.y === loot.pos.y;
      });
      if (taker) {
        run.party.lootBag.push(loot.item);
        events.push({ t: 'lootPicked', defId: loot.item.defId, by: taker });
      } else {
        keep.push(loot);
      }
    }
    run.groundLoot = keep;
  }

  // chests (adjacent or same tile)
  for (const chest of run.floor.chests) {
    if (chest.opened) continue;
    const opener = standing.find((hid) => manhattan(run.party.pos[hid]!, chest.pos) <= 1);
    if (!opener) continue;
    chest.opened = true;
    const loot = rollChestLoot(state, run.depth);
    run.party.goldCarried += loot.gold;
    run.party.lootBag.push(...loot.items);
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
        if (def.disposition === 'neutral' && insideAnyRoom(run.floor.rooms, m.pos.x, m.pos.y) === ri) {
          events.push({ t: 'neutralSighted', defId: m.defId, pos: { ...m.pos } });
          chronicle(state, nowMs, sightingText(def.name), run.depth);
        }
      }
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

  const unCarried = Object.keys(run.party.downed).filter(
    (did) => !Object.values(run.party.carrying).includes(did),
  );

  // descend: everyone (carrying included) grouped on the stairs, nobody left behind
  if (run.intent === 'explore' && unCarried.length === 0 && standing.length > 0) {
    const allAtStairs = standing.every((hid) => chebyshev(run.party.pos[hid]!, run.floor.stairs) <= 1);
    if (allAtStairs) {
      enterFloor(state, run, run.depth + 1, events);
      return;
    }
  }

  // withdraw exit: all standing heroes grouped on the entrance
  if (run.intent === 'withdraw' && standing.length > 0) {
    const allAtExit = standing.every((hid) => chebyshev(run.party.pos[hid]!, run.floor.entrance) <= 1);
    if (allAtExit) {
      endRunWithdrawn(state, nowMs, events);
    }
  }
}

function sightingText(name: string): string {
  return `The party encountered a ${name.toLowerCase()}. It seems unbothered.`;
}
