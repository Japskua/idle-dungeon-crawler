# Idle Dungeon Crawler — agent notes

Browser idle game: party of pixel-art heroes auto-crawls a procedural dungeon; the
player manages roster/economy in the village and programs per-hero **tactics**
(priority-ordered trigger→action rules). Bun + React 19 + Canvas 2D + Zustand.

## Commands

- `bun run dev` — gen content + dev server (HMR) on :3000
- `bun run test` — gen + full suite (49 tests). ALWAYS run via `bun run test`, not bare
  `bun test` (the gen step keeps `src/game/content/gen/` in sync with `content/`).
- `bun run typecheck` · `bun run build` · `bun run balance` (headless run simulator)

## Architecture — the one rule that matters

`src/game` is a **pure, deterministic, serializable simulation library**:

- No `Math.random`, `Date.now`, `performance.now`, DOM, react, or imports from
  `app/render/ui`. `src/game/purity.test.ts` greps for violations and will fail your PR.
- All randomness flows through seeded mulberry32 streams in `GameState.rng`
  (`combat`, `loot`, `village`); floor generation uses an ephemeral rng from
  `hash2(runSeed, depth)` so floors are pure functions of the seed.
- Wall-clock time enters only as the `nowMs` parameter (village chores/recovery);
  the dungeon sim runs on integer ticks (10/s, `TICK_MS`).
- UI mutates state ONLY by dispatching `Command`s (applied at tick boundaries).

Layers: `src/game` (sim) ← `src/render` (canvas, read-only) ← `src/app` (loop,
saves, command queue) ← `src/ui` (React; store + dispatch only).

## Determinism goldens

`src/game/determinism.test.ts` pins a golden-seed state/event hash. Any deliberate
sim/balance/content change breaks it — that's expected: re-run the snippet in that
file's comment (or the failing test prints the new hash) and re-baseline the two
constants in the same commit. An UNEXPECTED golden failure means non-determinism
crept in: hunt it, don't re-baseline.

## Content pipeline

All extensible content is JSON under `content/` (monsters, neutrals, items, perks,
names, tiles) — one file per thing, including its pixel-art sprite as palette-char
rows (`content/palette.json` holds the only palette). `tools/gen-content.ts`
validates (grid sizes, palette chars, drop/item refs, spawn coverage) and emits
committed typed modules into `src/game/content/gen/`. Classes/skills/statuses/
injuries/chores stay as TS data in `src/game/content/`. Sprite conventions: 16×16,
1px `0` outline, single frame (a bob frame is auto-generated), face RIGHT (renderer
flips), bosses are 16×16 drawn at 2×.

## Tuning

Every formula/constant lives in `src/game/balance.ts`. After tuning, run
`bun run balance` (expect: fresh party → depth ~3, ~5 min at 1×, mostly
`withdrawn` outcomes) and re-baseline goldens.

## Bun specifics

Use `bun` for everything (no node/vite/jest). HTML entrypoint imports TSX/CSS
directly. Tests colocate as `src/**/*.test.ts` via `bun:test`.
