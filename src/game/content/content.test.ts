import { describe, expect, test } from 'bun:test';
import { CLASSES, MONSTERS, NEUTRALS, PALETTE, validateContent } from './index';

describe('content integrity', () => {
  test('all cross-references resolve and spawn bands cover depths 1..30', () => {
    expect(validateContent()).toEqual([]);
  });

  test('TS-module sprites use only palette characters with square grids', () => {
    const sprites = [
      ...Object.values(CLASSES).map((c) => ({ id: c.id, sprite: c.sprite })),
    ];
    for (const { id, sprite } of sprites) {
      for (const frame of sprite.frames) {
        expect(frame.length).toBe(sprite.size);
        for (const row of frame) {
          expect(row.length).toBe(sprite.size);
          for (const ch of row) {
            if (ch !== '.') expect(PALETTE[ch], `class ${id} uses unknown palette char '${ch}'`).toBeDefined();
          }
        }
      }
    }
  });

  test('neutrals never deal damage and never aggro', () => {
    for (const n of Object.values(NEUTRALS)) {
      expect(n.disposition).toBe('neutral');
      expect(n.base.aggroRadius).toBe(0);
    }
  });

  test('every hostile has at least one drop or gold', () => {
    for (const m of Object.values(MONSTERS)) {
      expect(m.drops.length > 0 || m.gold[1] > 0).toBe(true);
    }
  });
});
