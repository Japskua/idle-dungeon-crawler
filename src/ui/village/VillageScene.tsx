/**
 * The animated village: a pixel-art scene with clickable buildings, drifting
 * chimney smoke, and the roster's own heroes (plus a chicken) wandering about.
 * Pure presentation — all state changes go through the usual command flow.
 */
import { useEffect, useRef, useState } from 'react';
import { atlasDraw, getAtlas } from '../../render/spriteCompiler';
import { derive } from '../../game/hero/derive';
import { effectiveHireCost, tavernRecruits } from '../../game/village/shop';
import type { GameState } from '../../game/types';
import { setVillageView, useUi, type VillageView } from '../store';

const W = 480;
const H = 288;

interface BuildingSpot {
  id: string;
  name: string;
  sprite: string;
  x: number;
  y: number;
  view: VillageView;
  smoke?: { x: number; y: number };
}

const BUILDINGS: BuildingSpot[] = [
  { id: 'tavern', name: 'Tavern', sprite: 'village/bld_tavern', x: 24, y: 24, view: 'tavern', smoke: { x: 66, y: 14 } },
  { id: 'armorer', name: 'Armorer', sprite: 'village/bld_armorer', x: 136, y: 24, view: 'armorer', smoke: { x: 178, y: 14 } },
  { id: 'store', name: 'General Store', sprite: 'village/bld_store', x: 248, y: 24, view: 'store' },
  { id: 'guild', name: "Magician's Guild", sprite: 'village/bld_guild', x: 360, y: 24, view: 'guild' },
  { id: 'hall', name: 'Guild Hall', sprite: 'village/bld_hall', x: 24, y: 152, view: 'hall' },
  { id: 'hospital', name: 'Hospital', sprite: 'village/bld_hospital', x: 136, y: 152, view: 'hospital' },
  { id: 'graveyard', name: 'Graveyard', sprite: 'village/bld_graveyard', x: 248, y: 152, view: 'graveyard' },
  { id: 'gate', name: 'Dungeon Gate', sprite: 'village/bld_gate', x: 360, y: 152, view: 'gate' },
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

export function VillageScene() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(2);
  const hoverRef = useRef<string | null>(null);
  const crittersRef = useRef<Critter[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setScale(Math.max(1, Math.floor(Math.min(el.clientWidth / W, el.clientHeight / H))));
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const atlas = getAtlas();
    let raf = 0;

    const draw = (nowMs: number) => {
      const game = useUi.getState().game;
      const t = nowMs / 1000;

      // ground
      for (let y = 0; y < H; y += 16) {
        for (let x = 0; x < W; x += 16) {
          atlasDraw(ctx, atlas, 'village/grass', 0, x, y);
        }
      }
      // path: horizontal main street + stubs to the back-row doors
      for (let x = 0; x < W; x += 16) {
        atlasDraw(ctx, atlas, 'village/path', 0, x, 120);
        atlasDraw(ctx, atlas, 'village/path', 0, x, 136);
      }
      for (const b of BUILDINGS.slice(0, 4)) {
        atlasDraw(ctx, atlas, 'village/path', 0, b.x + 24, 88);
        atlasDraw(ctx, atlas, 'village/path', 0, b.x + 24, 104);
      }
      for (const tree of TREES) atlasDraw(ctx, atlas, 'village/tree', 0, tree.x, tree.y);

      // buildings
      const hovered = hoverRef.current;
      for (const b of BUILDINGS) {
        atlasDraw(ctx, atlas, b.sprite, 0, b.x, b.y, false, 2);
        if (b.smoke) {
          const frame = Math.floor(t * 1.6) % 2;
          atlasDraw(ctx, atlas, 'village/smoke', frame, b.smoke.x, b.smoke.y - Math.floor((t * 4) % 3), false, 2);
        }
      }

      // badges & labels
      const badge = game ? badges(game) : {};
      ctx.textAlign = 'center';
      for (const b of BUILDINGS) {
        const isHover = hovered === b.id;
        if (isHover) {
          ctx.strokeStyle = '#f2c94c';
          ctx.lineWidth = 1;
          ctx.strokeRect(b.x - 1.5, b.y - 1.5, 67, 67);
        }
        ctx.font = isHover ? 'bold 9px monospace' : '8px monospace';
        ctx.fillStyle = isHover ? '#f2c94c' : '#cfcde0';
        const ly = b.y + 74;
        ctx.fillStyle = 'rgba(13,10,15,0.65)';
        const tw = ctx.measureText(b.name).width;
        ctx.fillRect(b.x + 32 - tw / 2 - 3, ly - 8, tw + 6, 11);
        ctx.fillStyle = isHover ? '#f2c94c' : '#cfcde0';
        ctx.fillText(b.name, b.x + 32, ly);
        if (badge[b.id] && Math.floor(t * 2) % 2 === 0) {
          ctx.fillStyle = '#f2c94c';
          ctx.fillRect(b.x + 56, b.y - 4, 9, 9);
          ctx.fillStyle = '#0d0a0f';
          ctx.font = 'bold 8px monospace';
          ctx.fillText('!', b.x + 60.5, b.y + 3);
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
        atlasDraw(ctx, atlas, c.key, frame, Math.round(c.x), Math.round(c.y), c.flip);
      }

      // chronicle ticker
      if (game && game.chronicle.length > 0) {
        const last = game.chronicle[game.chronicle.length - 1]!;
        ctx.font = '8px monospace';
        ctx.fillStyle = 'rgba(13,10,15,0.7)';
        const tw = ctx.measureText(last.text).width;
        ctx.fillRect(W / 2 - tw / 2 - 4, H - 13, tw + 8, 12);
        ctx.fillStyle = '#8a87a8';
        ctx.fillText(last.text, W / 2, H - 4);
      }
      ctx.textAlign = 'left';

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toLocal = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const hit = (x: number, y: number) =>
    BUILDINGS.find((b) => x >= b.x && x < b.x + 64 && y >= b.y && y < b.y + 64) ?? null;

  return (
    <div className="village-scene-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="game-canvas"
        style={{ width: W * scale, height: H * scale, cursor: hoverRef.current ? 'pointer' : 'default' }}
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
