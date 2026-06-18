/**
 * The driver: fixed-timestep accumulator over rAF, speed multiplier, command
 * queue, renderer hookup, store publishing, autosave. The sim never sees wall
 * time except as the nowMs parameter (village accrual only).
 */
import type { Command, GameEvent, GameState } from '../game/types';
import { TICK_MS } from '../game/balance';
import { advanceTick } from '../game/run/runtime';
import { applyCommand } from '../game/commands';
import { Renderer } from '../render/renderer';
import { publish, pushBanter, setUiSpeed, showDebrief } from '../ui/store';
import { saveGame } from './saveManager';
import { RunChronicler } from './debrief';
import { BanterDirector } from './banter';
import { recordFallen } from './graveyard';
import { telemetry } from './telemetry';

const MAX_STEPS_PER_FRAME = 40;
const AUTOSAVE_MS = 30_000;

class GameApp {
  state!: GameState;
  renderer = new Renderer();
  private chronicler = new RunChronicler();
  private banter = new BanterDirector();
  speed = 1;
  private acc = 0;
  private lastTs: number | null = null;
  private lastNow: number | null = null;
  private queue: Command[] = [];
  private pendingEvents: GameEvent[] = [];
  private lastPublish = 0;
  private lastSave = 0;
  private started = false;
  private halted = false;

  boot(state: GameState) {
    this.state = state;
    if (this.started) return;
    this.started = true;
    requestAnimationFrame(this.frame);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && !this.halted) {
        saveGame(this.state);
        telemetry.flush(true);
      }
    });
    window.addEventListener('pagehide', () => {
      if (!this.halted) {
        saveGame(this.state);
        telemetry.sessionEnd();
      }
    });
    telemetry.init(this.state);
    publish(this.state, []);
  }

  /** another tab owns the save: freeze the sim and never write again */
  halt() {
    this.halted = true;
    this.speed = 0;
  }

  dispatch(cmd: Command) {
    this.queue.push(cmd);
  }

  setSpeed(speed: number) {
    this.speed = speed;
    setUiSpeed(speed);
  }

  replaceState(state: GameState) {
    this.state = state;
    this.acc = 0;
    publish(this.state, [{ t: 'descend', depth: 0 } as GameEvent].slice(0, 0));
  }

  private frame = (ts: number) => {
    if (this.halted) return;
    const dt = this.lastTs === null ? 16 : Math.min(ts - this.lastTs, 250);
    this.lastTs = ts;
    const events: GameEvent[] = [];
    const now = Date.now();
    // a big wall-clock gap between frames means the tab was inactive (background
    // or asleep): re-anchor the village clock so that idle time never accrues —
    // there is no offline progress, time only passes while the tab is foreground.
    if (this.lastNow !== null && now - this.lastNow > 1500) {
      this.state.village.lastChoreAccrualMs = now;
    }
    this.lastNow = now;

    // While a dungeon event awaits the player (choosing, or acknowledging the
    // outcome) the whole world freezes — no ticks, no accrual — and only the
    // player's event commands land. (The sim's own deadline auto-resolve still
    // exists for headless runs, but never fires here because we stop ticking.)
    const r = this.state.run;
    const awaitingInput = !!(r && (r.pendingEvent || r.eventResult));
    let steps = 0;
    if (awaitingInput) {
      this.acc = 0;
      this.state.village.lastChoreAccrualMs = now; // no chore/recovery accrual during the pause
      for (const cmd of this.queue.splice(0, this.queue.length)) applyCommand(this.state, cmd, now, events);
    } else {
      if (this.speed > 0) this.acc += dt * this.speed;
      while (this.acc >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        advanceTick(this.state, this.queue.splice(0, this.queue.length), now, events);
        this.acc -= TICK_MS;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0; // drop backlog after jank
      // paused (or village idle): commands still need to land
      if (this.queue.length > 0 && steps === 0) {
        advanceTick(this.state, this.queue.splice(0, this.queue.length), now, events);
      }
    }

    if (events.length > 0) {
      recordFallen(events, now);
      telemetry.consume(this.state, events);
      const debrief = this.chronicler.consume(this.state, events);
      if (debrief) showDebrief(debrief);
    }
    if (!awaitingInput && this.speed > 0) {
      for (const u of this.banter.consume(this.state, events, now)) {
        this.renderer.say(u.heroId, u.text, 2_600 + u.text.length * 45);
        pushBanter(this.state, u.heroId, u.text);
      }
    }
    telemetry.noteFrame(dt, this.speed);
    this.renderer.queueEvents(this.state, events);
    this.renderer.draw(this.state, Math.max(0, Math.min(1, this.acc / TICK_MS)));

    this.pendingEvents.push(...events);
    if (ts - this.lastPublish > 100 || this.pendingEvents.length > 0) {
      publish(this.state, this.pendingEvents);
      this.pendingEvents = [];
      this.lastPublish = ts;
    }

    if (now - this.lastSave > AUTOSAVE_MS) {
      saveGame(this.state);
      this.lastSave = now;
    }

    requestAnimationFrame(this.frame);
  };
}

export const app = new GameApp();
