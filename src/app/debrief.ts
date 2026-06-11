/**
 * The run chronicler: watches the sim's event stream from embark to run end
 * and assembles a debrief — who leveled, who bled, who fell, who carried whom
 * home. Pure event bookkeeping (no DOM), so it's unit-testable.
 */
import type { GameEvent, GameState, Id } from '../game/types';

export interface HeroDebrief {
  heroId: Id;
  name: string;
  classId: string;
  levelBefore: number;
  levelAfter: number;
  xpGained: number;
  dmgDealt: number;
  /** injury ids picked up on this run */
  injuriesGained: string[];
  outcome: 'fine' | 'carried' | 'crawled' | 'died';
  /** name of the friend who hauled them out */
  carriedBy?: string;
  /** name of the friend they hauled out */
  carriedOut?: string;
  deathCause?: string;
}

export interface DebriefReport {
  outcome: 'withdrawn' | 'wiped';
  depth: number;
  goldKept: number;
  goldLost: number;
  durationTicks: number;
  monstersSlain: number;
  bossesSlain: string[];
  lootCount: number;
  heroes: HeroDebrief[];
}

interface Snapshot {
  name: string;
  classId: string;
  level: number;
}

export class RunChronicler {
  private snapshot = new Map<Id, Snapshot>();
  private startTick = 0;
  private xpGained = new Map<Id, number>();
  private levelUps = new Map<Id, number>();
  private dmgDealt = new Map<Id, number>();
  private injuries = new Map<Id, string[]>();
  private downed = new Set<Id>();
  private carriers = new Map<Id, Id>(); // carriedId -> last carrierId
  private deaths = new Map<Id, string>(); // heroId -> cause
  private monstersSlain = 0;
  private bosses: string[] = [];
  private lootCount = 0;

  /** feed every tick's events; returns a report exactly when a run ends */
  consume(state: GameState, events: GameEvent[]): DebriefReport | null {
    let report: DebriefReport | null = null;
    for (const e of events) {
      switch (e.t) {
        case 'embark': {
          this.reset();
          this.startTick = state.tick;
          for (const id of e.memberIds) {
            const hero = state.roster[id];
            if (hero) {
              this.snapshot.set(id, { name: hero.name, classId: hero.classId, level: hero.level });
            }
          }
          break;
        }
        case 'xpGain':
          if (this.snapshot.has(e.heroId)) {
            this.xpGained.set(e.heroId, (this.xpGained.get(e.heroId) ?? 0) + e.amount);
          }
          break;
        case 'levelUp':
          if (this.snapshot.has(e.heroId)) {
            this.levelUps.set(e.heroId, (this.levelUps.get(e.heroId) ?? 0) + 1);
          }
          break;
        case 'damage':
          if (this.snapshot.has(e.src)) {
            this.dmgDealt.set(e.src, (this.dmgDealt.get(e.src) ?? 0) + e.amount);
          }
          break;
        case 'injury':
          if (this.snapshot.has(e.heroId)) {
            const list = this.injuries.get(e.heroId) ?? [];
            list.push(e.injuryId);
            this.injuries.set(e.heroId, list);
          }
          break;
        case 'heroDowned':
          this.downed.add(e.heroId);
          break;
        case 'heroCarried':
          this.carriers.set(e.carried, e.carrier);
          break;
        case 'heroDied':
          this.deaths.set(e.heroId, e.cause);
          break;
        case 'monsterDied':
          this.monstersSlain++;
          break;
        case 'bossSlain':
          this.bosses.push(e.defId);
          break;
        case 'lootPicked':
          this.lootCount++;
          break;
        case 'runEnded':
          report = this.buildReport(state, e.outcome, e.depth, e.goldKept, e.goldLost);
          this.reset();
          break;
        default:
          break;
      }
    }
    return report;
  }

  private buildReport(
    state: GameState,
    outcome: 'withdrawn' | 'wiped',
    depth: number,
    goldKept: number,
    goldLost: number,
  ): DebriefReport {
    const heroes: HeroDebrief[] = [];
    for (const [id, snap] of this.snapshot) {
      const died = this.deaths.has(id);
      const wasDowned = this.downed.has(id);
      const carrierId = this.carriers.get(id);
      const carrierName = carrierId ? this.snapshot.get(carrierId)?.name : undefined;

      let heroOutcome: HeroDebrief['outcome'] = 'fine';
      if (died) heroOutcome = 'died';
      else if (wasDowned) {
        heroOutcome = outcome === 'withdrawn' && carrierId && !this.deaths.has(carrierId) ? 'carried' : 'crawled';
      }

      const entry: HeroDebrief = {
        heroId: id,
        name: snap.name,
        classId: snap.classId,
        levelBefore: snap.level,
        levelAfter: snap.level + (this.levelUps.get(id) ?? 0),
        xpGained: this.xpGained.get(id) ?? 0,
        dmgDealt: Math.round(this.dmgDealt.get(id) ?? 0),
        injuriesGained: this.injuries.get(id) ?? [],
        outcome: heroOutcome,
        carriedBy: heroOutcome === 'carried' ? carrierName : undefined,
        deathCause: this.deaths.get(id),
      };
      heroes.push(entry);
    }
    // credit the rescuers
    if (outcome === 'withdrawn') {
      for (const [carriedId, carrierId] of this.carriers) {
        if (this.deaths.has(carriedId) || this.deaths.has(carrierId)) continue;
        if (!this.downed.has(carriedId)) continue;
        const carrier = heroes.find((h) => h.heroId === carrierId);
        const carried = this.snapshot.get(carriedId);
        if (carrier && carried) carrier.carriedOut = carried.name;
      }
    }
    return {
      outcome,
      depth,
      goldKept,
      goldLost,
      durationTicks: Math.max(0, state.tick - this.startTick),
      monstersSlain: this.monstersSlain,
      bossesSlain: this.bosses,
      lootCount: this.lootCount,
      heroes,
    };
  }

  private reset() {
    this.snapshot.clear();
    this.xpGained.clear();
    this.levelUps.clear();
    this.dmgDealt.clear();
    this.injuries.clear();
    this.downed.clear();
    this.carriers.clear();
    this.deaths.clear();
    this.monstersSlain = 0;
    this.bosses = [];
    this.lootCount = 0;
  }
}
