/**
 * Bakes a whole floor (tiles + walls + doors + stairs) to an offscreen canvas
 * once per floor — per frame the floor is a single drawImage blit.
 */
import { TILE, type Floor } from '../game/types';
import { atlasDraw, type Atlas } from './spriteCompiler';

export const TILE_PX = 16;

const FLOOR_VARIANTS = ['tile/floor_a', 'tile/floor_b', 'tile/floor_c'];

function isFloorish(floor: Floor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.w || y >= floor.h) return false;
  return floor.tiles[y * floor.w + x] !== TILE.WALL;
}

export function bakeFloor(atlas: Atlas, floor: Floor): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = floor.w * TILE_PX;
  canvas.height = floor.h * TILE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0d0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const t = floor.tiles[y * floor.w + x]!;
      const dx = x * TILE_PX;
      const dy = y * TILE_PX;
      if (t === TILE.WALL) {
        // only draw wall faces that border walkable space; deep rock stays black
        if (isFloorish(floor, x, y + 1)) {
          atlasDraw(ctx, atlas, 'tile/wall_front', 0, dx, dy);
        } else if (
          isFloorish(floor, x, y - 1) ||
          isFloorish(floor, x - 1, y) ||
          isFloorish(floor, x + 1, y) ||
          isFloorish(floor, x - 1, y - 1) ||
          isFloorish(floor, x + 1, y - 1) ||
          isFloorish(floor, x - 1, y + 1) ||
          isFloorish(floor, x + 1, y + 1)
        ) {
          atlasDraw(ctx, atlas, 'tile/wall_top', 0, dx, dy);
        }
        continue;
      }
      const variant = FLOOR_VARIANTS[(x * 7 + y * 13) % FLOOR_VARIANTS.length]!;
      atlasDraw(ctx, atlas, variant, 0, dx, dy);
      if (t === TILE.DOOR) atlasDraw(ctx, atlas, 'tile/door', 0, dx, dy);
      else if (t === TILE.DOOR_CLOSED) atlasDraw(ctx, atlas, 'tile/wall_front', 0, dx, dy);
      else if (t === TILE.STAIRS_DOWN) atlasDraw(ctx, atlas, 'tile/stairs_down', 0, dx, dy);
      else if (t === TILE.ENTRANCE) atlasDraw(ctx, atlas, 'tile/stairs_up', 0, dx, dy);
    }
  }
  return canvas;
}
