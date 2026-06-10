import { describe, expect, test } from 'bun:test';
import { hash2, makeRng, pickWeighted, rand, randInt, triangularInt } from './rng';

describe('rng', () => {
  test('same seed, same sequence', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    for (let i = 0; i < 100; i++) expect(rand(a)).toBe(rand(b));
  });

  test('serializable mid-stream', () => {
    const a = makeRng(42);
    for (let i = 0; i < 10; i++) rand(a);
    const b = { s: a.s };
    for (let i = 0; i < 50; i++) expect(rand(a)).toBe(rand(b));
  });

  test('randInt stays in bounds and hits both ends', () => {
    const r = makeRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = randInt(r, 2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  test('hash2 is stable and order-sensitive', () => {
    expect(hash2(1, 2)).toBe(hash2(1, 2));
    expect(hash2(1, 2)).not.toBe(hash2(2, 1));
  });

  test('triangularInt is center-heavy and bounded', () => {
    const r = makeRng(99);
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const v = triangularInt(r, 10, 2);
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(12);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect(counts.get(10)!).toBeGreaterThan(counts.get(8) ?? 0);
    expect(counts.get(10)!).toBeGreaterThan(counts.get(12) ?? 0);
  });

  test('pickWeighted respects weights roughly', () => {
    const r = makeRng(5);
    let heavy = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickWeighted(r, ['a', 'b'], (x) => (x === 'a' ? 9 : 1)) === 'a') heavy++;
    }
    expect(heavy).toBeGreaterThan(800);
    expect(heavy).toBeLessThan(980);
  });
});
