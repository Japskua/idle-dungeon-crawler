/**
 * The React-facing store. The sim mutates GameState in place; the loop bumps
 * `rev` ~10x/s so selectors re-read the mutated tree. Selectors must return
 * primitives or small fresh objects compared with `useShallow` — never
 * interior mutable references.
 */
import { create } from 'zustand';
import type { GameEvent, GameState } from '../game/types';
import type { DebriefReport } from '../app/debrief';
import { CLASSES, INJURIES, ITEMS, creatureDef } from '../game/content';

export interface LogEntry {
  id: number;
  text: string;
  cls: 'dmg' | 'heal' | 'loot' | 'gold' | 'level' | 'bad' | 'info' | 'say';
}

export type VillageView =
  | 'scene'
  | 'tavern'
  | 'armorer'
  | 'store'
  | 'guild'
  | 'hall'
  | 'hospital'
  | 'graveyard'
  | 'gate';

interface UiState {
  game: GameState | null;
  rev: number;
  log: LogEntry[];
  speed: number;
  lockedByOtherTab: boolean;
  villageView: VillageView;
  /** post-run debrief; stays up until the player acknowledges it */
  debrief: DebriefReport | null;
  /** first-steps explainer, shown when a brand-new game starts */
  welcome: boolean;
}

export const useUi = create<UiState>(() => ({
  game: null,
  rev: 0,
  log: [],
  speed: 1,
  lockedByOtherTab: false,
  villageView: 'scene',
  debrief: null,
  welcome: false,
}));

export function showDebrief(report: DebriefReport) {
  useUi.setState({ debrief: report });
}

export function setVillageView(view: VillageView) {
  useUi.setState({ villageView: view });
}

let logId = 1;

function heroName(game: GameState, id: string): string {
  return game.roster[id]?.name ?? 'A hero';
}

function mobName(id: string): string {
  try {
    return creatureDef(id).name;
  } catch {
    return id;
  }
}

function formatEvent(game: GameState, e: GameEvent): LogEntry | null {
  const entry = (text: string, cls: LogEntry['cls']): LogEntry => ({ id: logId++, text, cls });
  switch (e.t) {
    case 'damage': {
      const srcHero = game.roster[e.src];
      const dstHero = game.roster[e.dst];
      if (srcHero && dstHero) {
        return entry(`${srcHero.name} catches ${dstHero.name} in the blast for ${e.amount}!`, 'bad');
      }
      if (srcHero) {
        const target = game.run?.monsters[e.dst];
        return entry(
          `${srcHero.name} hits ${target ? `${mobName(target.defId)} (L${target.level})` : 'a foe'} for ${e.amount}${e.crit ? ' (CRIT!)' : ''}`,
          'dmg',
        );
      }
      if (dstHero) {
        const src = game.run?.monsters[e.src];
        return entry(`${src ? mobName(src.defId) : 'Something'} hits ${dstHero.name} for ${e.amount}`, 'dmg');
      }
      return null;
    }
    case 'bombThrown':
      return entry(`💣 ${heroName(game, e.heroId)} lobs a bomb!`, 'level');
    case 'potionUsed':
      return entry(`${heroName(game, e.heroId)} drinks a ${e.potion === 'hp' ? 'healing' : 'mana'} potion (+${e.amount})`, 'heal');
    case 'heal':
      return entry(`${heroName(game, e.dst)} is healed for ${e.amount}`, 'heal');
    case 'monsterDied':
      return entry(`${mobName(e.defId)} (L${e.level}) dies. +${e.xp} xp, +${e.gold}g`, 'gold');
    case 'lootPicked':
      return entry(`${heroName(game, e.by)} picks up ${ITEMS[e.defId]?.name ?? e.defId}`, 'loot');
    case 'lootTooHeavy':
      return entry(`The party's bags are too full for ${ITEMS[e.defId]?.name ?? e.defId} — left behind.`, 'info');
    case 'chestOpened':
      return entry(`Chest opened: +${e.gold}g${e.items.length ? ', ' + e.items.map((i) => ITEMS[i]?.name ?? i).join(', ') : ''}`, 'loot');
    case 'levelUp':
      return entry(`${heroName(game, e.heroId)} reaches level ${e.level}!`, 'level');
    case 'heroDowned':
      return entry(`${heroName(game, e.heroId)} is DOWN!`, 'bad');
    case 'heroCarried':
      return entry(`${heroName(game, e.carrier)} picks up ${heroName(game, e.carried)}`, 'info');
    case 'heroDied':
      return entry(`☠ ${e.name} has died at depth ${e.depth}. Permanently.`, 'bad');
    case 'injury': {
      const injury = INJURIES[e.injuryId];
      return entry(`${heroName(game, e.heroId)} suffers: ${injury?.name ?? e.injuryId}`, 'bad');
    }
    case 'descend':
      return entry(`The party descends to depth ${e.depth}.`, 'info');
    case 'withdrawOrdered':
      return entry('Withdraw ordered — the party heads for the exit.', 'info');
    case 'wipe':
      return entry(`PARTY WIPE. ${e.goldLost} gold lost in the dark.`, 'bad');
    case 'runEnded':
      return e.outcome === 'withdrawn'
        ? entry(`The party returns from depth ${e.depth} with ${e.goldKept} gold.`, 'gold')
        : null;
    case 'summon':
      return entry(`${heroName(game, e.heroId)} summons ${e.count}x ${mobName(e.defId)}!`, 'level');
    case 'minionDied':
      return entry(`A ${mobName(e.defId).toLowerCase()} crumbles away.`, 'info');
    case 'neutralSighted':
      return entry(`A wild ${mobName(e.defId)} minds its own business nearby.`, 'info');
    case 'neutralKilled':
      return entry(`The ${mobName(e.defId)} did not survive the crossfire. Shame falls on the party.`, 'bad');
    case 'bossSlain':
      return entry(`BOSS SLAIN: ${mobName(e.defId)}! A checkpoint is unlocked.`, 'level');
    case 'embark':
      return entry(`The party embarks (depth ${e.depth}).`, 'info');
    case 'hire':
      return entry(`${e.name} hired${e.cost > 0 ? ` for ${e.cost}g` : ' (free — the village insists)'}.`, 'info');
    case 'purchase':
      return entry(`Bought: ${e.what} (−${e.cost}g)`, 'info');
    case 'sold':
      return entry(`Sold ${e.what} (+${e.gold}g)`, 'gold');
    default:
      return null;
  }
}

export function publish(game: GameState, events: GameEvent[]) {
  useUi.setState((s) => {
    let log = s.log;
    if (events.length > 0) {
      const fresh = events
        .map((e) => formatEvent(game, e))
        .filter((x): x is LogEntry => x !== null);
      if (fresh.length > 0) {
        log = [...log, ...fresh];
        if (log.length > 200) log = log.slice(log.length - 200);
      }
    }
    // coming home from a run always lands on the village overview
    const cameHome = events.some((e) => e.t === 'runEnded');
    return { game, rev: s.rev + 1, log, ...(cameHome ? { villageView: 'scene' as const } : {}) };
  });
}

/** banter lines come from the app-side director, not GameEvents */
export function pushBanter(game: GameState, heroId: string, text: string) {
  const name = game.roster[heroId]?.name ?? 'Someone';
  const line = text.startsWith('*') ? `${name} ${text}` : `${name}: “${text}”`;
  useUi.setState((s) => {
    let log = [...s.log, { id: logId++, text: line, cls: 'say' as const }];
    if (log.length > 200) log = log.slice(log.length - 200);
    return { log };
  });
}

export function setUiSpeed(speed: number) {
  useUi.setState({ speed });
}
