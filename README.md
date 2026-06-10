# Idle Dungeon Crawler

A browser idle game: hire a roster of quirky pixel-art heroes, send a party of up to
four into an endless procedurally generated dungeon, and manage everything from the
village above — gear, potions, injuries, chores, and the **tactics** that program how
your heroes fight while you watch (or don't).

![stack](https://img.shields.io/badge/bun-react%2019-blueviolet) ![tests](https://img.shields.io/badge/tests-49%20passing-brightgreen)

## Running it

```bash
bun install
bun run dev        # dev server with HMR → http://localhost:3000
bun test           # the full test suite
bun run build      # static production build into dist/
bun run balance    # headless balance harness (CSV of simulated runs)
```

## How to play

1. **Embark**: pick up to 4 heroes and descend. The party explores, fights, loots and
   descends on its own — bosses await every 5th floor.
2. **Tactics**: each hero runs a priority list of `IF trigger THEN action` rules
   ("ally HP below 65% → cast Heal", "enemies ≥ 2 → Taunt"). Edit them per hero, save
   multiple named sets, and switch sets mid-run.
3. **Withdraw**: order the party home any time — they stop chasing, fight only what
   blocks the way, and carry downed friends to the exit.
4. **Death**: a hero at 0 HP is *Downed*, and the party automatically falls back.
   Carried out → they live, but gain a random injury (lost eye, shaky hands, fear of
   chickens...). Abandoned or wiped → they may die for good. A wipe loses all gold
   carried in the run; XP, items and equipment are never lost.
5. **Village**: buy gear (stock rotates daily), hire recruits with generated names and
   random perks ("Grimbeard Souphands — Owns a Frying Pan"), treat injuries at the
   temple, and put benched heroes on **chores** — they keep earning gold and XP even
   while the tab is closed (up to 12 h).

## Adding content (no code required)

Every monster, neutral critter, item, perk and name bank is a JSON file under
`content/`. Drop a new file in, run `bun run dev`, and it's in the game — stats,
depth-based spawn weights, level distribution, loot table **and pixel art** all live
in the same file. Sprites are palette-indexed text grids (see `content/palette.json`):

```jsonc
// content/monsters/goblin_chef.json
{
  "id": "goblin_chef",
  "spawn": [{ "depths": [3, 9], "weight": 6 }],   // where & how often
  "level": { "offset": 1, "spread": 2 },           // level ≈ depth+1 ± 2
  "drops": [{ "item": "frying_pan", "chance": 0.5 }],
  "sprite": { "size": 16, "frames": [["...16 rows of palette chars..."]] }
}
```

`bun run gen` validates everything (grid sizes, palette characters, dangling item
references, spawn coverage) with file-and-field error messages.

## Architecture (the short version)

- `src/game` — a **pure, deterministic simulation**: fixed 10 Hz tick, seeded RNG
  streams, zero DOM/wall-clock/Math.random (a test enforces it). Same seed, same run.
- `src/render` — Canvas 2D at a fixed 480×288, integer-scaled, pixel-perfect. Floors
  are baked to an offscreen canvas once; entities interpolate between ticks.
- `src/ui` — React 19 + Zustand, re-rendered at ~10 Hz from store revision bumps.
- `src/app` — the loop driver, command queue, dual-slot localStorage saves.
- `content/` + `tools/gen-content.ts` — JSON content compiled into typed modules.

Saves are dual-slot with a meta pointer (a crash mid-write can't corrupt both), and
export/import as checksummed strings. Determinism is pinned by golden-seed hashes and
a save/load equivalence test.
