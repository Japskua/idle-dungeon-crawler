/**
 * Compiles every pixel-grid sprite from content into one atlas canvas at boot.
 * Sprites with a single authored frame get an auto-generated second frame
 * (shifted up 1px) for the idle/walk bob. Missing sprites fall back to a
 * tinted silhouette at draw time (see atlasDraw) so the game never blocks on art.
 */
import { CLASSES, ITEMS, MONSTERS, NEUTRALS, PALETTE, TILES } from '../game/content';
import { VILLAGE_SPRITES } from '../game/content/gen/village.gen';
import type { SpriteData } from '../game/types';

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasSprite {
  frames: AtlasFrame[];
  frameTicks: number;
  size: number;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  sprites: Map<string, AtlasSprite>;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

let sharedAtlas: Atlas | null = null;

/** lazily-compiled singleton atlas, shared by the dungeon renderer and village scene */
export function getAtlas(): Atlas {
  if (!sharedAtlas) sharedAtlas = compileSprites();
  return sharedAtlas;
}

export function compileSprites(): Atlas {
  const entries: { key: string; sprite: SpriteData }[] = [];
  for (const [id, t] of Object.entries(TILES)) entries.push({ key: `tile/${id}`, sprite: t.sprite });
  for (const [id, m] of Object.entries(MONSTERS)) entries.push({ key: `mob/${id}`, sprite: m.sprite });
  for (const [id, m] of Object.entries(NEUTRALS)) entries.push({ key: `mob/${id}`, sprite: m.sprite });
  for (const [id, i] of Object.entries(ITEMS)) entries.push({ key: `item/${id}`, sprite: i.sprite });
  for (const [id, c] of Object.entries(CLASSES)) entries.push({ key: `hero/${id}`, sprite: c.sprite });
  for (const [id, v] of Object.entries(VILLAGE_SPRITES)) entries.push({ key: `village/${id}`, sprite: v.sprite });

  // expand: single authored frame -> [frame, 1px-up bob copy]
  const expanded: { key: string; size: number; grids: string[][]; frameTicks: number }[] = [];
  for (const { key, sprite } of entries) {
    const grids = [...sprite.frames];
    if (grids.length === 1) {
      const frame = grids[0]!;
      const bob = [...frame.slice(1), '.'.repeat(sprite.size)];
      grids.push(bob);
    }
    expanded.push({ key, size: sprite.size, grids, frameTicks: sprite.frameTicks ?? 4 });
  }

  // shelf packing
  const atlasW = 1024;
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placements: { key: string; frames: AtlasFrame[]; frameTicks: number; size: number }[] = [];
  for (const e of expanded) {
    const frames: AtlasFrame[] = [];
    for (let f = 0; f < e.grids.length; f++) {
      if (x + e.size > atlasW) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      frames.push({ x, y, w: e.size, h: e.size });
      x += e.size;
      rowH = Math.max(rowH, e.size);
    }
    placements.push({ key: e.key, frames, frameTicks: e.frameTicks, size: e.size });
  }
  const atlasH = y + rowH;

  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = Math.max(1, atlasH);
  const ctx = canvas.getContext('2d')!;

  const rgbCache = new Map<string, [number, number, number]>();
  for (const [ch, hex] of Object.entries(PALETTE)) rgbCache.set(ch, hexToRgb(hex));

  const sprites = new Map<string, AtlasSprite>();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const e = expanded[i]!;
    for (let f = 0; f < e.grids.length; f++) {
      const frame = p.frames[f]!;
      const img = ctx.createImageData(e.size, e.size);
      const grid = e.grids[f]!;
      for (let row = 0; row < e.size; row++) {
        const line = grid[row] ?? '';
        for (let col = 0; col < e.size; col++) {
          const ch = line[col] ?? '.';
          if (ch === '.') continue;
          const rgb = rgbCache.get(ch);
          if (!rgb) continue;
          const o = (row * e.size + col) * 4;
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, frame.x, frame.y);
    }
    sprites.set(p.key, { frames: p.frames, frameTicks: p.frameTicks, size: p.size });
  }

  return { canvas, sprites };
}

const fallbackColors = ['#d13b3b', '#4f7ad1', '#4fae4f', '#e8852e', '#7a4a8a', '#3fbfb4'];

/** Draw a sprite frame; unknown keys render as a letter-stamped silhouette. */
export function atlasDraw(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  key: string,
  frameIndex: number,
  dx: number,
  dy: number,
  flip = false,
  scale = 1,
) {
  const sprite = atlas.sprites.get(key);
  if (!sprite) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    ctx.fillStyle = fallbackColors[h % fallbackColors.length]!;
    ctx.fillRect(dx + 3, dy + 3, 10 * scale, 10 * scale);
    ctx.fillStyle = '#0d0a0f';
    ctx.font = '8px monospace';
    ctx.fillText((key.split('/')[1]?.[0] ?? '?').toUpperCase(), dx + 6, dy + 11);
    return;
  }
  const frame = sprite.frames[frameIndex % sprite.frames.length]!;
  const dw = frame.w * scale;
  const dh = frame.h * scale;
  if (flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
  }
}
