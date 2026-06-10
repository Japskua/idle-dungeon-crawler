/**
 * Deterministic RNG (mulberry32). State is a single u32 living in GameState,
 * so every roll is reproducible across save/load. The only randomness source
 * allowed inside src/game — the purity test enforces it.
 */
import type { Rng } from '../types';

export type { Rng };

export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** Next float in [0,1). Mutates r.s. */
export function rand(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max], inclusive. */
export function randInt(r: Rng, min: number, max: number): number {
  return min + Math.floor(rand(r) * (max - min + 1));
}

export function randRange(r: Rng, min: number, max: number): number {
  return min + rand(r) * (max - min);
}

export function chance(r: Rng, p: number): boolean {
  return rand(r) < p;
}

export function pick<T>(r: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rand(r) * arr.length)]!;
}

export function pickWeighted<T>(r: Rng, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let roll = rand(r) * total;
  for (const it of items) {
    roll -= weight(it);
    if (roll <= 0) return it;
  }
  return items[items.length - 1]!;
}

export function shuffle<T>(r: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(r, 0, i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Derive a u32 seed from two numbers (per-floor generation, daily stock, ...). */
export function hash2(a: number, b: number): number {
  let h = Math.imul((a >>> 0) + 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** Discrete roll in [center-spread, center+spread], weighted toward the center. */
export function triangularInt(r: Rng, center: number, spread: number): number {
  if (spread <= 0) return center;
  const a = randInt(r, -spread, spread);
  const b = randInt(r, -spread, spread);
  return center + Math.round((a + b) / 2);
}
