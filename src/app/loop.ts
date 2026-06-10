/**
 * The driver: fixed-timestep accumulator over rAF, speed multiplier, command
 * queue, renderer hookup, store publishing, autosave. The sim never sees wall
 * time except as the nowMs parameter (village accrual only).
 */
import type { Command, GameEvent, GameState } from '../game/types';
import { TICK_MS } from '../game/balance';
import { advanceTick } from '../game/run/runtime';
import { Renderer } from '../render/renderer';
import { publish, setUiSpeed } from '../ui/store';
import { saveGame } from './saveManager';

const MAX_STEPS_PER_FRAME = 40;
const AUTOSAVE_MS = 30_000;

class GameApp {
  state!: GameState;
  renderer = new Renderer();
  speed = 1;
  private acc = 0;
  private lastTs: number | null = null;
  private queue: Command[] = [];
  private pendingEvents: GameEvent[] = [];
  private lastPublish = 0;
  private lastSave = 0;
  private started = false;

  boot(state: GameState) {
    this.state = state;
    if (this.started) return;
    this.started = true;
    requestAnimationFrame(this.frame);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveGame(this.state);
    });
    window.addEventListener('pagehide', () => saveGame(this.state));
    publish(this.state, []);
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
    const dt = this.lastTs === null ? 16 : Math.min(ts - this.lastTs, 250);
    this.lastTs = ts;
    const events: GameEvent[] = [];
    const now = Date.now();

    if (this.speed > 0) this.acc += dt * this.speed;
    let steps = 0;
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
