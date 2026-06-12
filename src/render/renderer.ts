/**
 * Canvas 2D renderer. The internal resolution tracks the window at the
 * chunkiest integer pixel scale that keeps >= MIN_VIEW tiles visible (no
 * letterboxing — the canvas always fills its container edge to edge). Reads
 * GameState directly every rAF (bypassing React) and interpolates entity
 * movement with the loop's accumulator alpha. All animation/FX state lives
 * here, never in GameState.
 */
import { TILE, type GameEvent, type GameState, type Id, type Vec2 } from '../game/types';
import { creatureDef } from '../game/content';
import { derive } from '../game/hero/derive';
import { monsterMaxHp } from '../game/balance';
import { getAtlas, atlasDraw, type Atlas } from './spriteCompiler';
import { bakeFloor, TILE_PX } from './floorLayer';

/** initial size before the first measure */
export const VIEW_W = 480;
export const VIEW_H = 288;
/** the smallest playable viewport (20x12 tiles) — the scale picker guarantees this much stays visible */
export const MIN_VIEW_W = 320;
export const MIN_VIEW_H = 192;
/** sprites larger than 4x get comical */
export const MAX_PIXEL_SCALE = 4;

interface FxText {
  x: number;
  y: number;
  text: string;
  color: string;
  ttlMs: number;
  big: boolean;
}

interface FxFlash {
  entityId: Id;
  ttlMs: number;
}

interface FxProjectile {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ttlMs: number;
  totalMs: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private atlas: Atlas | null = null;
  private floorCanvas: HTMLCanvasElement | null = null;
  private floorKey = '';
  private cam: Vec2 = { x: 0, y: 0 };
  private camSnapped = false;
  private lastFloorId = '';
  private fxTexts: FxText[] = [];
  private fxFlashes: FxFlash[] = [];
  private fxProjectiles: FxProjectile[] = [];
  /** one speech bubble per hero, word-wrapped, fades at the end */
  private bubbles = new Map<Id, { lines: string[]; ttlMs: number }>();
  private facing = new Map<Id, number>(); // 1 = right, -1 = left
  private lastDrawMs = 0;

  private viewW = VIEW_W;
  private viewH = VIEW_H;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = this.viewW;
    canvas.height = this.viewH;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    if (!this.atlas) this.atlas = getAtlas();
    this.camSnapped = false;
  }

  /** internal resolution follows the window so nothing letterboxes */
  resize(w: number, h: number) {
    this.viewW = Math.max(MIN_VIEW_W, Math.floor(w));
    this.viewH = Math.max(MIN_VIEW_H, Math.floor(h));
    if (this.canvas) {
      this.canvas.width = this.viewW;
      this.canvas.height = this.viewH;
      if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    }
  }

  detach() {
    this.canvas = null;
    this.ctx = null;
  }

  queueEvents(state: GameState, events: GameEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'damage':
          this.fxTexts.push({
            x: e.pos.x * TILE_PX + 8,
            y: e.pos.y * TILE_PX - 2,
            text: String(e.amount),
            color: e.crit ? '#f2c94c' : '#e8e6f0',
            ttlMs: 700,
            big: e.crit,
          });
          this.fxFlashes.push({ entityId: e.dst, ttlMs: 90 });
          // a hit from afar flies: arrows, bolts, spells
          if (e.srcPos) {
            const dx = e.srcPos.x - e.pos.x;
            const dy = e.srcPos.y - e.pos.y;
            if (dx * dx + dy * dy > 2) {
              this.fxProjectiles.push({
                x1: e.srcPos.x * TILE_PX + 8,
                y1: e.srcPos.y * TILE_PX + 6,
                x2: e.pos.x * TILE_PX + 8,
                y2: e.pos.y * TILE_PX + 8,
                ttlMs: 130,
                totalMs: 130,
              });
            }
          }
          break;
        case 'heal':
        case 'potionUsed':
          this.fxTexts.push({
            x: e.pos.x * TILE_PX + 8,
            y: e.pos.y * TILE_PX - 2,
            text: '+' + e.amount,
            color: e.t === 'potionUsed' && e.potion === 'mp' ? '#7ec8e8' : '#95d65a',
            ttlMs: 700,
            big: false,
          });
          break;
        case 'chestOpened':
          this.fxTexts.push({
            x: e.pos.x * TILE_PX + 8,
            y: e.pos.y * TILE_PX - 4,
            text: `+${e.gold}g`,
            color: '#f2c94c',
            ttlMs: 900,
            big: false,
          });
          break;
        case 'monsterDied':
          if (e.gold > 0) {
            this.fxTexts.push({
              x: e.pos.x * TILE_PX + 8,
              y: e.pos.y * TILE_PX,
              text: `+${e.gold}g`,
              color: '#f2c94c',
              ttlMs: 800,
              big: false,
            });
          }
          break;
        case 'levelUp': {
          const pos = state.run?.party.pos[e.heroId];
          if (pos) {
            this.fxTexts.push({
              x: pos.x * TILE_PX + 8,
              y: pos.y * TILE_PX - 6,
              text: 'LEVEL UP!',
              color: '#f2c94c',
              ttlMs: 1200,
              big: true,
            });
          }
          break;
        }
        case 'heroDowned': {
          this.fxTexts.push({
            x: e.pos.x * TILE_PX + 8,
            y: e.pos.y * TILE_PX - 4,
            text: 'DOWN!',
            color: '#d13b3b',
            ttlMs: 1200,
            big: true,
          });
          break;
        }
        default:
          break;
      }
    }
  }

  /** alpha: fraction of the next tick already accumulated (0..1) */
  /** show a speech bubble above a hero (banter is render-side only) */
  say(heroId: Id, text: string, durationMs: number) {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 24 && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    }
    if (cur) lines.push(cur);
    this.bubbles.set(heroId, { lines: lines.slice(0, 5), ttlMs: durationMs });
  }

  draw(state: GameState, alpha: number) {
    const ctx = this.ctx;
    if (!ctx || !this.canvas || !this.atlas) return;
    const nowMs = performance.now();
    const dtMs = this.lastDrawMs ? Math.min(100, nowMs - this.lastDrawMs) : 16;
    this.lastDrawMs = nowMs;

    ctx.fillStyle = '#0d0a0f';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const run = state.run;
    if (!run || !run.floor) {
      this.fxTexts = [];
      this.fxFlashes = [];
      return;
    }
    const floor = run.floor;
    const atlas = this.atlas;

    // bake floor once per (runSeed, depth, boss-door state)
    const doorsClosed =
      floor.bossDoors?.filter((d) => floor.tiles[d.y * floor.w + d.x] === TILE.DOOR_CLOSED).length ?? 0;
    const key = `${run.runSeed}:${run.depth}:${doorsClosed}`;
    if (this.floorKey !== key) {
      this.floorCanvas = bakeFloor(atlas, floor);
      this.floorKey = key;
    }
    const floorId = `${run.runSeed}:${run.depth}`;
    if (this.lastFloorId !== floorId) {
      this.camSnapped = false;
      this.lastFloorId = floorId;
    }

    // entity draw positions (pixels), interpolated
    const heroPx = new Map<Id, Vec2>();
    for (const id of run.party.memberIds) {
      if (id in run.party.downed) continue;
      heroPx.set(id, this.entityPx(run.party.pos[id]!, run.party.move[id], alpha));
    }

    // camera: follow standing-party centroid (or entrance after a wipe frame)
    let cx = 0;
    let cy = 0;
    if (heroPx.size > 0) {
      for (const p of heroPx.values()) {
        cx += p.x + 8;
        cy += p.y + 8;
      }
      cx /= heroPx.size;
      cy /= heroPx.size;
    } else {
      cx = floor.entrance.x * TILE_PX + 8;
      cy = floor.entrance.y * TILE_PX + 8;
    }
    const floorPxW = floor.w * TILE_PX;
    const floorPxH = floor.h * TILE_PX;
    // floors smaller than the window sit centered; bigger ones clamp the camera
    cx = floorPxW <= this.viewW ? floorPxW / 2 : Math.max(this.viewW / 2, Math.min(floorPxW - this.viewW / 2, cx));
    cy = floorPxH <= this.viewH ? floorPxH / 2 : Math.max(this.viewH / 2, Math.min(floorPxH - this.viewH / 2, cy));
    if (!this.camSnapped) {
      this.cam = { x: cx, y: cy };
      this.camSnapped = true;
    } else {
      const k = 1 - Math.pow(0.001, dtMs / 1000);
      this.cam.x += (cx - this.cam.x) * k;
      this.cam.y += (cy - this.cam.y) * k;
    }
    const ox = Math.round(this.viewW / 2 - this.cam.x);
    const oy = Math.round(this.viewH / 2 - this.cam.y);

    // floor blit
    if (this.floorCanvas) ctx.drawImage(this.floorCanvas, ox, oy);

    // chests & ground loot
    for (const chest of floor.chests) {
      atlasDraw(ctx, atlas, chest.opened ? 'tile/chest_open' : 'tile/chest_closed', 0, ox + chest.pos.x * TILE_PX, oy + chest.pos.y * TILE_PX);
    }
    for (const loot of run.groundLoot) {
      atlasDraw(ctx, atlas, `item/${loot.item.defId}`, 0, ox + loot.pos.x * TILE_PX, oy + loot.pos.y * TILE_PX);
    }

    // entities, y-sorted
    interface Drawable {
      y: number;
      draw: () => void;
    }
    const drawables: Drawable[] = [];

    for (const id of run.monsterOrder) {
      const m = run.monsters[id]!;
      if (m.hp <= 0) continue;
      const def = creatureDef(m.defId);
      const isBoss = def.tier === 'boss';
      const px = this.entityPx(m.pos, m.move, alpha);
      this.updateFacing(id, m.move ? Math.sign(m.pos.x - m.move.from.x) : 0);
      const flash = this.fxFlashes.some((f) => f.entityId === id);
      drawables.push({
        y: px.y,
        draw: () => {
          const frame = Math.floor(state.tick / 4 + this.hashId(id)) % 2;
          if (isBoss) {
            // bosses render at 2x, bottom-anchored on their tile
            atlasDraw(ctx, atlas, `mob/${m.defId}`, frame, ox + px.x - 8, oy + px.y - 16, this.facing.get(id) === -1, 2);
          } else {
            atlasDraw(ctx, atlas, `mob/${m.defId}`, frame, ox + px.x, oy + px.y, this.facing.get(id) === -1);
          }
          if (m.elite) {
            ctx.fillStyle = '#f2c94c';
            ctx.fillRect(ox + px.x + 7, oy + px.y - 2, 2, 2);
          }
          if (m.summonedBy) {
            ctx.fillStyle = '#95d65a'; // friendly marker: the party's own conjuration
            ctx.fillRect(ox + px.x + 7, oy + px.y - 2, 2, 2);
          }
          if (flash) this.drawFlash(ctx, atlas, `mob/${m.defId}`, ox + px.x, oy + px.y);
          const maxHp = this.monsterMaxHpCache(m.defId, m.level, m.elite);
          if (m.hp < maxHp) {
            if (isBoss) this.drawHpBar(ctx, ox + px.x - 8, oy + px.y - 19, m.hp / maxHp, '#d13b3b', 32);
            else this.drawHpBar(ctx, ox + px.x, oy + px.y - 3, m.hp / maxHp, m.summonedBy ? '#4fae4f' : '#d13b3b');
          }
        },
      });
    }

    // downed heroes (lying flat)
    for (const [downedId, info] of Object.entries(run.party.downed)) {
      const hero = state.roster[downedId];
      if (!hero) continue;
      const carried = Object.values(run.party.carrying).includes(downedId);
      if (carried) continue; // drawn on the carrier
      const px = { x: info.pos.x * TILE_PX, y: info.pos.y * TILE_PX };
      drawables.push({
        y: px.y - 1,
        draw: () => {
          ctx.save();
          ctx.translate(ox + px.x + 8, oy + px.y + 12);
          ctx.rotate(-Math.PI / 2);
          ctx.globalAlpha = 0.85;
          atlasDraw(ctx, atlas, `hero/${hero.classId}`, 0, -8, -8);
          ctx.restore();
          ctx.globalAlpha = 1;
        },
      });
    }

    for (const id of run.party.memberIds) {
      if (id in run.party.downed) continue;
      const hero = state.roster[id];
      if (!hero) continue;
      const px = heroPx.get(id)!;
      const mv = run.party.move[id];
      this.updateFacing(id, mv ? Math.sign(run.party.pos[id]!.x - mv.from.x) : 0);
      const flash = this.fxFlashes.some((f) => f.entityId === id);
      const carriedId = run.party.carrying[id];
      const stealthed = hero.statuses.some((s) => s.statusId === 'stealthed');
      drawables.push({
        y: px.y + 0.5,
        draw: () => {
          const frame = Math.floor(state.tick / 4 + this.hashId(id)) % 2;
          if (stealthed) ctx.globalAlpha = 0.45;
          atlasDraw(ctx, atlas, `hero/${hero.classId}`, frame, ox + px.x, oy + px.y, this.facing.get(id) === -1);
          if (stealthed) ctx.globalAlpha = 1;
          if (flash) this.drawFlash(ctx, atlas, `hero/${hero.classId}`, ox + px.x, oy + px.y);
          if (carriedId) {
            const carriedHero = state.roster[carriedId];
            if (carriedHero) {
              ctx.save();
              ctx.globalAlpha = 0.9;
              ctx.translate(ox + px.x + 13, oy + px.y - 3);
              ctx.rotate(Math.PI / 2);
              atlasDraw(ctx, atlas, `hero/${carriedHero.classId}`, 0, -8, -8);
              ctx.restore();
              ctx.globalAlpha = 1;
            }
          }
          const d = derive(hero);
          if (hero.hp < d.maxHp) this.drawHpBar(ctx, ox + px.x, oy + px.y - 3, hero.hp / d.maxHp, '#4fae4f');
        },
      });
    }

    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    // fog: unexplored tiles are blacked out (only the visible window)
    const x0 = Math.max(0, Math.floor(-ox / TILE_PX));
    const y0 = Math.max(0, Math.floor(-oy / TILE_PX));
    const x1 = Math.min(floor.w - 1, Math.ceil((this.viewW - ox) / TILE_PX));
    const y1 = Math.min(floor.h - 1, Math.ceil((this.viewH - oy) / TILE_PX));
    ctx.fillStyle = '#0d0a0f';
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!floor.explored[ty * floor.w + tx]) {
          ctx.fillRect(ox + tx * TILE_PX, oy + ty * TILE_PX, TILE_PX, TILE_PX);
        }
      }
    }

    // projectiles: a bright dot streaking from shooter to victim
    for (const p of this.fxProjectiles) {
      p.ttlMs -= dtMs;
      const t = Math.max(0, Math.min(1, 1 - p.ttlMs / p.totalMs));
      const x = p.x1 + (p.x2 - p.x1) * t;
      const y = p.y1 + (p.y2 - p.y1) * t;
      ctx.strokeStyle = 'rgba(232,230,240,0.35)';
      ctx.beginPath();
      ctx.moveTo(ox + p.x1 + (p.x2 - p.x1) * Math.max(0, t - 0.25), oy + p.y1 + (p.y2 - p.y1) * Math.max(0, t - 0.25));
      ctx.lineTo(ox + x, oy + y);
      ctx.stroke();
      ctx.fillStyle = '#e8e6f0';
      ctx.fillRect(Math.round(ox + x) - 1, Math.round(oy + y) - 1, 2, 2);
    }
    this.fxProjectiles = this.fxProjectiles.filter((p) => p.ttlMs > 0);

    // floating texts
    ctx.textAlign = 'center';
    for (const fx of this.fxTexts) {
      fx.ttlMs -= dtMs;
      fx.y -= dtMs * 0.018;
      ctx.globalAlpha = Math.max(0, Math.min(1, fx.ttlMs / 300));
      ctx.font = fx.big ? 'bold 9px monospace' : '8px monospace';
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, ox + fx.x, oy + fx.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    this.fxTexts = this.fxTexts.filter((f) => f.ttlMs > 0);
    for (const f of this.fxFlashes) f.ttlMs -= dtMs;
    this.fxFlashes = this.fxFlashes.filter((f) => f.ttlMs > 0);

    // speech bubbles, above everything but the HUD
    ctx.textAlign = 'center';
    ctx.font = '7px monospace';
    for (const [id, b] of this.bubbles) {
      b.ttlMs -= dtMs;
      const px = heroPx.get(id);
      if (b.ttlMs <= 0 || !px) {
        this.bubbles.delete(id);
        continue;
      }
      const w = Math.max(...b.lines.map((l) => l.length)) * 4.3 + 8;
      const h = b.lines.length * 8 + 4;
      let bx = ox + px.x + 8;
      let by = oy + px.y - 8 - h;
      bx = Math.max(w / 2 + 2, Math.min(this.viewW - w / 2 - 2, bx));
      by = Math.max(2, by);
      ctx.globalAlpha = Math.max(0, Math.min(1, b.ttlMs / 300));
      ctx.fillStyle = 'rgba(13,10,15,0.88)';
      ctx.fillRect(bx - w / 2, by, w, h);
      ctx.strokeStyle = '#8a87a8';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - w / 2 + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = '#e8e6f0';
      b.lines.forEach((l, i) => ctx.fillText(l, bx, by + 8 + i * 8));
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';

    // depth tag
    ctx.fillStyle = 'rgba(13,10,15,0.7)';
    ctx.fillRect(4, 4, 86, 12);
    ctx.fillStyle = '#e8e6f0';
    ctx.font = '8px monospace';
    ctx.fillText(`DEPTH ${run.depth}${floor.isBossFloor ? ' (BOSS)' : ''}`, 8, 13);

    this.drawMinimap(ctx, state);
  }

  /** explored-tiles minimap, top-right corner (2px per tile) */
  private drawMinimap(ctx: CanvasRenderingContext2D, state: GameState) {
    const run = state.run!;
    const floor = run.floor;
    const s = 2;
    const mw = floor.w * s;
    const mh = floor.h * s;
    const mx = this.viewW - mw - 4;
    const my = 4;
    ctx.fillStyle = 'rgba(13,10,15,0.75)';
    ctx.fillRect(mx - 1, my - 1, mw + 2, mh + 2);
    for (let ty = 0; ty < floor.h; ty++) {
      for (let tx = 0; tx < floor.w; tx++) {
        const i = ty * floor.w + tx;
        if (!floor.explored[i]) continue;
        const t = floor.tiles[i]!;
        if (t === TILE.WALL) continue;
        if (t === TILE.STAIRS_DOWN) ctx.fillStyle = '#f2c94c';
        else if (t === TILE.ENTRANCE) ctx.fillStyle = '#3fbfb4';
        else if (t === TILE.DOOR_CLOSED) ctx.fillStyle = '#d13b3b';
        else ctx.fillStyle = '#3e3554';
        ctx.fillRect(mx + tx * s, my + ty * s, s, s);
      }
    }
    ctx.fillStyle = '#f2c94c';
    for (const chest of floor.chests) {
      if (!chest.opened && floor.explored[chest.pos.y * floor.w + chest.pos.x]) {
        ctx.fillRect(mx + chest.pos.x * s, my + chest.pos.y * s, s, s);
      }
    }
    ctx.fillStyle = '#95d65a';
    for (const id of run.party.memberIds) {
      if (id in run.party.downed) continue;
      const p = run.party.pos[id]!;
      ctx.fillRect(mx + p.x * s, my + p.y * s, s, s);
    }
  }

  private entityPx(pos: Vec2, move: { from: Vec2; t: number; total: number } | null | undefined, alpha: number): Vec2 {
    if (!move) return { x: pos.x * TILE_PX, y: pos.y * TILE_PX };
    const progress = Math.max(0, Math.min(1, (move.t + alpha) / move.total));
    return {
      x: Math.round((move.from.x + (pos.x - move.from.x) * progress) * TILE_PX),
      y: Math.round((move.from.y + (pos.y - move.from.y) * progress) * TILE_PX),
    };
  }

  private updateFacing(id: Id, dir: number) {
    if (dir !== 0) this.facing.set(id, dir);
  }

  private hashId(id: Id): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 4;
  }

  private drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, frac: number, color: string, width = 16) {
    ctx.fillStyle = '#0d0a0f';
    ctx.fillRect(x, y, width, 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(1, Math.round(width * Math.max(0, frac))), 2);
  }

  private flashCache = new Map<string, HTMLCanvasElement>();

  private drawFlash(ctx: CanvasRenderingContext2D, atlas: Atlas, key: string, dx: number, dy: number) {
    let white = this.flashCache.get(key);
    if (!white) {
      const sprite = atlas.sprites.get(key);
      if (!sprite) return;
      const frame = sprite.frames[0]!;
      white = document.createElement('canvas');
      white.width = frame.w;
      white.height = frame.h;
      const wctx = white.getContext('2d')!;
      wctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      wctx.globalCompositeOperation = 'source-in';
      wctx.fillStyle = '#ffffff';
      wctx.fillRect(0, 0, frame.w, frame.h);
      this.flashCache.set(key, white);
    }
    ctx.globalAlpha = 0.7;
    ctx.drawImage(white, dx, dy);
    ctx.globalAlpha = 1;
  }

  private monsterMaxHpMemo = new Map<string, number>();

  private monsterMaxHpCache(defId: string, level: number, elite: boolean): number {
    const key = `${defId}:${level}:${elite ? 1 : 0}`;
    let v = this.monsterMaxHpMemo.get(key);
    if (v === undefined) {
      const def = creatureDef(defId);
      v = monsterMaxHp(def.base.hp, level, elite, def.tier === 'boss');
      this.monsterMaxHpMemo.set(key, v);
    }
    return v;
  }
}
