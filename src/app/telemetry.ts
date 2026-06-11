/**
 * Anonymous gameplay telemetry. Design rules:
 *  - one random UUID per install, no accounts, no personal data (hero names
 *    are game-generated and only appear inside death causes)
 *  - cheap rows: one event per RUN, not per sword swing; high-frequency
 *    things aggregate into 5-minute heartbeat counters
 *  - batched: flushed at most every 30s (sendBeacon on tab close), silently
 *    dropped if the endpoint is missing or the player opted out
 *  - on localhost events log to the console instead of being sent
 */
import type { GameEvent, GameState } from '../game/types';
import { creatureDef } from '../game/content';
import { APP_VERSION } from './version';
import { loadGraveyard } from './graveyard';

const INSTALL_KEY = 'idc:install';
const OPTOUT_KEY = 'idc:telemetry-off';
const NOTICE_KEY = 'idc:telemetry-notice';
const SESSIONS_KEY = 'idc:sessions';
const PLAYMS_KEY = 'idc:playms';
const DEPTHS_KEY = 'idc:depths-reached';

const ENDPOINT = '/api/track';
const FLUSH_MS = 30_000;
const HEARTBEAT_MS = 5 * 60_000;
const MAX_QUEUE = 40;
const MAX_ERRORS_PER_SESSION = 5;

interface TrackedEvent {
  type: string;
  ts: number;
  depth?: number;
  cls?: string;
  value?: number;
  payload?: Record<string, unknown>;
}

const isDev =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // telemetry never throws at the player
  }
}

function installId(): string {
  let id = lsGet(INSTALL_KEY);
  if (!id) {
    id = crypto.randomUUID();
    lsSet(INSTALL_KEY, id);
  }
  return id;
}

export function telemetryEnabled(): boolean {
  return lsGet(OPTOUT_KEY) !== '1';
}

export function setTelemetryEnabled(on: boolean) {
  lsSet(OPTOUT_KEY, on ? '0' : '1');
}

export function telemetryNoticeSeen(): boolean {
  return lsGet(NOTICE_KEY) === '1';
}

export function dismissTelemetryNotice() {
  lsSet(NOTICE_KEY, '1');
}

class Telemetry {
  private queue: TrackedEvent[] = [];
  private counters: Record<string, number> = {};
  private speedMs: Record<string, number> = { 0: 0, 1: 0, 2: 0, 4: 0 };
  private visibleMs = 0;
  private longFrames = 0;
  private errorsSent = 0;
  private sessionId = crypto.randomUUID();
  private sessionStartMs = Date.now();
  private lastFlush = 0;
  private lastHeartbeat = Date.now();
  private newInstall = false;
  private wasNewGame = false;
  // run-in-progress bookkeeping
  private runParty: string[] = [];
  private runStartTick = 0;
  private runDowns = 0;
  private runPotions = 0;
  private runLoot = 0;
  private runManualWithdraw = false;

  markNewGame() {
    this.wasNewGame = true;
  }

  init(state: GameState) {
    const id = lsGet(INSTALL_KEY);
    this.newInstall = !id;
    installId();
    const sessionN = Number(lsGet(SESSIONS_KEY) ?? '0') + 1;
    lsSet(SESSIONS_KEY, String(sessionN));

    this.track('session_start', {
      payload: {
        newInstall: this.newInstall ? 1 : 0,
        newGame: this.wasNewGame ? 1 : 0,
        sessionN,
        rosterSize: state.rosterOrder.length,
        maxDepth: state.progress.maxDepthReached,
        graves: loadGraveyard().length,
        playMin: Math.round(Number(lsGet(PLAYMS_KEY) ?? '0') / 60000),
        screenW: Math.round((window.screen?.width ?? 0) / 100) * 100,
        screenH: Math.round((window.screen?.height ?? 0) / 100) * 100,
        dpr: window.devicePixelRatio ?? 1,
      },
    });
    if (this.wasNewGame) this.track('new_game');

    window.addEventListener('error', (e) => this.error(String(e.message ?? 'error')));
    window.addEventListener('unhandledrejection', (e) =>
      this.error(String((e as PromiseRejectionEvent).reason ?? 'rejection')),
    );
  }

  /** every rAF frame: accumulate watch-time, speed mix, perf signals */
  noteFrame(dtMs: number, speed: number) {
    if (document.visibilityState === 'visible') {
      this.visibleMs += dtMs;
      this.speedMs[String(speed)] = (this.speedMs[String(speed)] ?? 0) + dtMs;
      if (dtMs > 100) this.longFrames++;
    }
    const now = Date.now();
    if (now - this.lastHeartbeat >= HEARTBEAT_MS) this.heartbeat();
    if (now - this.lastFlush >= FLUSH_MS || this.queue.length >= MAX_QUEUE) this.flush();
  }

  bump(counter: string, n = 1) {
    this.counters[counter] = (this.counters[counter] ?? 0) + n;
  }

  track(type: string, fields: Partial<Omit<TrackedEvent, 'type' | 'ts'>> = {}) {
    if (!telemetryEnabled()) return;
    this.queue.push({ type, ts: Date.now(), ...fields });
  }

  error(message: string) {
    if (this.errorsSent >= MAX_ERRORS_PER_SESSION) return;
    this.errorsSent++;
    this.track('client_error', { payload: { msg: message.slice(0, 200) } });
  }

  /** the big mapping: sim events -> stats */
  consume(state: GameState, events: GameEvent[]) {
    if (!telemetryEnabled()) return;
    for (const e of events) {
      switch (e.t) {
        case 'embark': {
          this.runParty = e.memberIds
            .map((id) => state.roster[id]?.classId ?? '?')
            .sort();
          this.runStartTick = state.tick;
          this.runDowns = 0;
          this.runPotions = 0;
          this.runLoot = 0;
          this.runManualWithdraw = false;
          this.bump('embarks');
          this.bump(`party_size:${e.memberIds.length}`);
          break;
        }
        case 'descend': {
          const reached: number[] = JSON.parse(lsGet(DEPTHS_KEY) ?? '[]');
          if (!reached.includes(e.depth)) {
            reached.push(e.depth);
            lsSet(DEPTHS_KEY, JSON.stringify(reached));
            const playMin = Math.round((Number(lsGet(PLAYMS_KEY) ?? '0') + this.visibleMs) / 60000);
            this.track('depth_milestone', { depth: e.depth, value: playMin });
          }
          break;
        }
        case 'runEnded': {
          // the heroes' per-run damage is still warm — startRun resets it later
          let dmgDealt = 0;
          for (const id of state.rosterOrder) {
            const hero = state.roster[id];
            if (hero && hero.stats.runDmg > 0) dmgDealt += hero.stats.runDmg;
          }
          this.track('run_end', {
            depth: e.depth,
            value: e.outcome === 'wiped' ? e.goldLost : e.goldKept,
            payload: {
              outcome: e.outcome,
              party: this.runParty.join('+'),
              durTicks: state.tick - this.runStartTick,
              dmgDealt: Math.round(dmgDealt),
              downs: this.runDowns,
              potions: this.runPotions,
              loot: this.runLoot,
              manualWithdraw: this.runManualWithdraw ? 1 : 0,
              goldLost: e.goldLost,
            },
          });
          break;
        }
        case 'heroDowned':
          this.runDowns++;
          break;
        case 'heroDied':
          this.track('hero_death', {
            depth: e.depth,
            cls: e.classId,
            value: e.level,
            payload: { cause: e.cause },
          });
          break;
        case 'bossSlain':
          this.track('boss_kill', { depth: e.depth, cls: e.defId });
          break;
        case 'withdrawOrdered':
          if (this.pendingManualWithdraw) {
            this.runManualWithdraw = true;
            this.pendingManualWithdraw = false;
            this.bump('withdraw_manual');
          } else {
            this.bump('withdraw_auto');
          }
          break;
        case 'hire':
          this.track('hire', { cls: state.roster[e.heroId]?.classId ?? '?', value: e.cost });
          break;
        case 'purchase':
          if (e.category) this.bump(`gold:${e.category}`, e.cost);
          if (e.category === 'training' && e.refId) this.track('spell_learned', { cls: e.refId, value: e.cost });
          if (e.category === 'healing' && e.refId) this.bump(`injury_treated:${e.refId}`);
          break;
        case 'sold':
          this.bump('gold:junk_sold', e.gold);
          break;
        case 'potionUsed':
          this.runPotions++;
          break;
        case 'lootPicked':
          this.runLoot++;
          break;
        case 'lootTooHeavy':
          this.bump('loot_too_heavy');
          break;
        case 'injury':
          this.bump(`injury:${e.injuryId}`);
          break;
        case 'summon':
          this.bump(`summon:${e.defId}`, e.count);
          break;
        case 'neutralKilled':
          this.bump(`neutral_killed:${e.defId}`);
          break;
        case 'neutralSighted':
          this.bump(`neutral_seen:${e.defId}`);
          break;
        case 'levelUp':
          if (e.level % 5 === 0) {
            this.track('level_milestone', { cls: state.roster[e.heroId]?.classId, value: e.level });
          }
          break;
        case 'monsterDied': {
          const def = creatureDef(e.defId);
          if (def.tier === 'elite') this.bump('elite_kills');
          break;
        }
        default:
          break;
      }
    }
  }

  private pendingManualWithdraw = false;

  /** the Withdraw BUTTON was pressed (auto-withdraw never calls this) */
  noteManualWithdraw() {
    this.pendingManualWithdraw = true;
  }

  private heartbeat() {
    this.lastHeartbeat = Date.now();
    // bank watch-time for the lifetime play clock
    lsSet(PLAYMS_KEY, String(Number(lsGet(PLAYMS_KEY) ?? '0') + this.visibleMs));
    if (Object.keys(this.counters).length === 0 && this.visibleMs < 1000) return;
    this.track('heartbeat', {
      payload: {
        counters: this.counters,
        speedMs: this.speedMs,
        visibleMs: Math.round(this.visibleMs),
        longFrames: this.longFrames,
      },
    });
    this.counters = {};
    this.speedMs = { 0: 0, 1: 0, 2: 0, 4: 0 };
    this.visibleMs = 0;
    this.longFrames = 0;
  }

  sessionEnd() {
    this.heartbeat();
    this.track('session_end', { value: Math.round((Date.now() - this.sessionStartMs) / 60000) });
    this.flush(true);
  }

  flush(useBeacon = false) {
    this.lastFlush = Date.now();
    if (this.queue.length === 0) return;
    const batch = {
      installId: installId(),
      sessionId: this.sessionId,
      version: APP_VERSION,
      events: this.queue.splice(0, 50),
    };
    if (isDev) {
      console.debug('[telemetry]', batch.events);
      return;
    }
    const body = JSON.stringify(batch);
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // never let stats hurt the game
    }
  }
}

export const telemetry = new Telemetry();
