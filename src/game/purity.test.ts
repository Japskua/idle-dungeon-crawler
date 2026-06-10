/**
 * The architecture guard: src/game must stay a pure, deterministic library.
 * No wall clock, no Math.random, no DOM, no imports from app/render/ui.
 */
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';

const GAME_DIR = join(import.meta.dir);

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /Math\.random/, why: 'use the seeded rng streams' },
  { pattern: /Date\.now/, why: 'wall time must be passed in as a parameter' },
  { pattern: /new Date\(/, why: 'wall time must be passed in as a parameter' },
  { pattern: /performance\.now/, why: 'wall time must be passed in as a parameter' },
  { pattern: /from ['"]react/, why: 'game must not depend on react' },
  { pattern: /from ['"].*\/(render|ui|app)\//, why: 'game must not import outer layers' },
  { pattern: /\bdocument\./, why: 'game must not touch the DOM' },
  { pattern: /\bwindow\./, why: 'game must not touch the DOM' },
  { pattern: /\blocalStorage\b/, why: 'persistence lives in src/app' },
];

describe('purity guard', () => {
  test('src/game contains no impure constructs', async () => {
    const glob = new Glob('**/*.ts');
    const problems: string[] = [];
    for await (const file of glob.scan({ cwd: GAME_DIR })) {
      if (file.endsWith('.test.ts')) continue;
      const text = await Bun.file(join(GAME_DIR, file)).text();
      for (const { pattern, why } of BANNED) {
        const match = text.match(pattern);
        if (match) problems.push(`src/game/${file}: '${match[0]}' (${why})`);
      }
    }
    expect(problems).toEqual([]);
  });
});
