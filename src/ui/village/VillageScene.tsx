/**
 * The animated village: a pixel-art scene with clickable buildings, drifting
 * chimney smoke, and the roster's own heroes (plus a chicken) wandering about.
 * The canvas sizes itself to fill the viewport at the largest integer pixel
 * scale and pads the world with more grass — no letterboxing.
 * Pure presentation — all state changes go through the usual command flow.
 */
import { useEffect, useRef, useState } from 'react';
import { atlasDraw, getAtlas } from '../../render/spriteCompiler';
import { derive } from '../../game/hero/derive';
import { effectiveHireCost, tavernRecruits } from '../../game/village/shop';
import type { GameState } from '../../game/types';
import { setVillageView, useUi, type VillageView } from '../store';

/** design size of the village content; the canvas itself grows to fill */
const W = 480;
const H = 288;

interface BuildingSpot {
  id: string;
  name: string;
  /** one-line purpose shown in brackets under the name */
  desc: string;
  sprite: string;
  x: number;
  y: number;
  view: VillageView;
  smoke?: { x: number; y: number };
}

// back row (5, indices 0-4) get path stubs to the main street; front row (4) line the street.
const BUILDINGS: BuildingSpot[] = [
  { id: 'tavern', name: 'Tavern', desc: '(hire heroes)', sprite: 'village/bld_tavern', x: 20, y: 24, view: 'tavern', smoke: { x: 62, y: 14 } },
  { id: 'armorer', name: 'Armorer', desc: '(weapons & armor)', sprite: 'village/bld_armorer', x: 114, y: 24, view: 'armorer', smoke: { x: 156, y: 14 } },
  { id: 'store', name: 'General Store', desc: '(potions & sundries)', sprite: 'village/bld_store', x: 208, y: 24, view: 'store' },
  { id: 'guild', name: "Magician's Guild", desc: '(learn spells)', sprite: 'village/bld_guild', x: 302, y: 24, view: 'guild' },
  { id: 'cove', name: "Gambler's Cove", desc: '(games of chance)', sprite: 'village/bld_cove', x: 396, y: 24, view: 'cove' },
  { id: 'hall', name: 'Guild Hall', desc: '(manage heroes)', sprite: 'village/bld_hall', x: 24, y: 152, view: 'hall' },
  { id: 'hospital', name: 'Hospital', desc: '(treat injuries)', sprite: 'village/bld_hospital', x: 136, y: 152, view: 'hospital' },
  { id: 'graveyard', name: 'Graveyard', desc: '(honor the dead)', sprite: 'village/bld_graveyard', x: 248, y: 152, view: 'graveyard' },
  { id: 'gate', name: 'Dungeon Gate', desc: '(send the party down)', sprite: 'village/bld_gate', x: 360, y: 152, view: 'gate' },
];

const TREES = [
  { x: 2, y: 96 },
  { x: 458, y: 96 },
  { x: 218, y: 2 },
  { x: 110, y: 250 },
  { x: 330, y: 252 },
];

interface Critter {
  key: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  flip: boolean;
  pauseUntil: number;
}

function wanderTarget(): { tx: number; ty: number } {
  const band = Math.random() < 0.7 ? [100, 140] : [222, 256];
  return { tx: 30 + Math.random() * 420, ty: band[0]! + Math.random() * (band[1]! - band[0]!) };
}

function badges(game: GameState): Record<string, boolean> {
  const injured = game.rosterOrder.some((id) => {
    const hero = game.roster[id];
    if (!hero || hero.activity === 'party') return false;
    return hero.injuries.length > 0 || hero.hp < derive(hero).maxHp * 0.999;
  });
  const hireable = tavernRecruits(game).some(
    (r) => !game.village.hiredToday.includes(r.key) && game.village.gold >= effectiveHireCost(game, r),
  );
  const canEmbark = game.rosterOrder.some((id) => {
    const hero = game.roster[id];
    return hero && hero.activity !== 'party' && hero.hp > 0;
  });
  return { hospital: injured, tavern: hireable, gate: canEmbark };
}

interface SceneDims {
  scale: number;
  iw: number;
  ih: number;
  ox: number;
  oy: number;
  dpr: number;
}

export function VillageScene() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<SceneDims>({ scale: 2, iw: W, ih: H, ox: 0, oy: 0, dpr: 1 });
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const hoverRef = useRef<string | null>(null);
  const crittersRef = useRef<Critter[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const cw = Math.max(64, el.clientWidth);
      const ch = Math.max(64, el.clientHeight);
      // largest integer scale that still fits the village content...
      const scale = Math.max(1, Math.floor(Math.min(cw / W, ch / H)));
      // ...then grow the canvas itself to swallow the leftover space with grass
      const iw = Math.max(W, Math.ceil(cw / scale));
      const ih = Math.max(H, Math.ceil(ch / scale));
      const dpr = window.devicePixelRatio || 1;
      setDims({ scale, iw, ih, ox: Math.floor((iw - W) / 2), oy: Math.floor((ih - H) / 2), dpr });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const atlas = getAtlas();
    let raf = 0;

    const draw = (nowMs: number) => {
      const ctx = canvas.getContext('2d')!;
      const { iw, ih, ox, oy, scale, dpr } = dimsRef.current;
      // draw in internal coords, scaled up to real device pixels: pixel art stays
      // crisp (smoothing off) and label fonts rasterize sharp instead of muddy.
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const game = useUi.getState().game;
      const t = nowMs / 1000;

      // ground fills the whole canvas, village content sits centered at (ox, oy)
      for (let y = 0; y < ih; y += 16) {
        for (let x = 0; x < iw; x += 16) {
          atlasDraw(ctx, atlas, 'village/grass', 0, x, y);
        }
      }
      // path: main street spans the full width; stubs lead to the back-row doors
      for (let x = 0; x < iw; x += 16) {
        atlasDraw(ctx, atlas, 'village/path', 0, x, oy + 120);
        atlasDraw(ctx, atlas, 'village/path', 0, x, oy + 136);
      }
      for (const b of BUILDINGS.slice(0, 5)) {
        atlasDraw(ctx, atlas, 'village/path', 0, ox + b.x + 24, oy + 88);
        atlasDraw(ctx, atlas, 'village/path', 0, ox + b.x + 24, oy + 104);
      }
      for (const tree of TREES) atlasDraw(ctx, atlas, 'village/tree', 0, ox + tree.x, oy + tree.y);

      // buildings
      const hovered = hoverRef.current;
      for (const b of BUILDINGS) {
        atlasDraw(ctx, atlas, b.sprite, 0, ox + b.x, oy + b.y, false, 2);
        if (b.smoke) {
          const frame = Math.floor(t * 1.6) % 2;
          atlasDraw(ctx, atlas, 'village/smoke', frame, ox + b.smoke.x, oy + b.smoke.y - Math.floor((t * 4) % 3), false, 2);
        }
      }

      // badges & labels
      const badge = game ? badges(game) : {};
      ctx.textAlign = 'center';
      for (const b of BUILDINGS) {
        const bx = ox + b.x;
        const by = oy + b.y;
        const isHover = hovered === b.id;
        if (isHover) {
          ctx.strokeStyle = '#f2c94c';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx - 1.5, by - 1.5, 67, 67);
        }
        ctx.font = isHover ? 'bold 9px monospace' : '8px monospace';
        const ly = by + 74;
        const tw = ctx.measureText(b.name).width;
        ctx.fillStyle = 'rgba(13,10,15,0.65)';
        ctx.fillRect(bx + 32 - tw / 2 - 3, ly - 8, tw + 6, 11);
        ctx.fillStyle = isHover ? '#f2c94c' : '#cfcde0';
        ctx.fillText(b.name, bx + 32, ly);
        ctx.font = '7px monospace';
        const dw = ctx.measureText(b.desc).width;
        ctx.fillStyle = 'rgba(13,10,15,0.65)';
        ctx.fillRect(bx + 32 - dw / 2 - 2, ly + 2, dw + 4, 9);
        ctx.fillStyle = isHover ? '#f2c94c' : '#8a87a8';
        ctx.fillText(b.desc, bx + 32, ly + 9);
        if (badge[b.id] && Math.floor(t * 2) % 2 === 0) {
          ctx.fillStyle = '#f2c94c';
          ctx.fillRect(bx + 56, by - 4, 9, 9);
          ctx.fillStyle = '#0d0a0f';
          ctx.font = 'bold 8px monospace';
          ctx.fillText('!', bx + 60.5, by + 3);
        }
      }

      // wandering souls: a couple of benched heroes + the village chicken
      const wanted: { key: string; speed: number }[] = [{ key: 'mob/chicken', speed: 10 }];
      if (game) {
        const idle = game.rosterOrder
          .map((id) => game.roster[id])
          .filter((h) => h && h.activity !== 'party')
          .slice(0, 2);
        for (const hero of idle) wanted.push({ key: `hero/${hero!.classId}`, speed: 16 });
      }
      const critters = crittersRef.current;
      while (critters.length < wanted.length) {
        const spec = wanted[critters.length]!;
        const start = wanderTarget();
        critters.push({
          key: spec.key,
          x: start.tx,
          y: start.ty,
          ...wanderTarget(),
          speed: spec.speed,
          flip: false,
          pauseUntil: 0,
        });
      }
      critters.length = wanted.length;
      for (let i = 0; i < critters.length; i++) {
        const c = critters[i]!;
        c.key = wanted[i]!.key;
        if (nowMs > c.pauseUntil) {
          const dx = c.tx - c.x;
          const dy = c.ty - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) {
            Object.assign(c, wanderTarget());
            c.pauseUntil = nowMs + 1500 + Math.random() * 3500;
          } else {
            const step = (c.speed * 16) / 1000 / 60 + c.speed / 60 / 16;
            c.x += (dx / dist) * step * 4;
            c.y += (dy / dist) * step * 4;
            if (Math.abs(dx) > 1) c.flip = dx < 0;
          }
        }
        const frame = nowMs > c.pauseUntil ? Math.floor(t * 4) % 2 : 0;
        atlasDraw(ctx, atlas, c.key, frame, ox + Math.round(c.x), oy + Math.round(c.y), c.flip);
      }

      // chronicle ticker pinned to the bottom of the real viewport
      if (game && game.chronicle.length > 0) {
        const last = game.chronicle[game.chronicle.length - 1]!;
        ctx.font = '8px monospace';
        const tw = ctx.measureText(last.text).width;
        ctx.fillStyle = 'rgba(13,10,15,0.7)';
        ctx.fillRect(iw / 2 - tw / 2 - 4, ih - 13, tw + 8, 12);
        ctx.fillStyle = '#8a87a8';
        ctx.fillText(last.text, iw / 2, ih - 4);
      }
      ctx.textAlign = 'left';

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toLocal = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { scale, ox, oy } = dimsRef.current;
    return { x: (e.clientX - rect.left) / scale - ox, y: (e.clientY - rect.top) / scale - oy };
  };

  const hit = (x: number, y: number) =>
    BUILDINGS.find((b) => x >= b.x && x < b.x + 64 && y >= b.y && y < b.y + 64) ?? null;

  return (
    <div className="village-scene-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        width={Math.round(dims.iw * dims.scale * dims.dpr)}
        height={Math.round(dims.ih * dims.scale * dims.dpr)}
        className="game-canvas"
        style={{ width: dims.iw * dims.scale, height: dims.ih * dims.scale }}
        onMouseMove={(e) => {
          const { x, y } = toLocal(e);
          const b = hit(x, y);
          hoverRef.current = b?.id ?? null;
          e.currentTarget.style.cursor = b ? 'pointer' : 'default';
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
        }}
        onClick={(e) => {
          const { x, y } = toLocal(e);
          const b = hit(x, y);
          if (b) setVillageView(b.view);
        }}
      />
    </div>
  );
}
