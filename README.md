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
   ("ally HP below 65% → cast Heal", "enemies ≥ 2 → Taunt", "enemies ≥ 3 → Throw
   bomb"). Edit them per hero, save multiple named sets, and switch sets mid-run.
   Mind the area damage: explosions and storms hurt **everyone** in the blast —
   heroes included. Buffs and debuffs stay polite and pick sides. Bombs are sold at
   the General Store and packed per hero at the Dungeon Gate.
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

## Deploying (Cloudflare Pages)

The production build is fully static — no backend, saves live in the player's
browser. Three ways to ship it:

1. **GitHub Actions (already wired)**: every push to `main` runs typecheck + tests +
   build, then deploys to Cloudflare Pages *if* two repo secrets exist:
   - `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → My Profile → API
     Tokens, using the **"Edit Cloudflare Workers"** template or a custom token with
     `Account · Cloudflare Pages · Edit` permission
   - `CLOUDFLARE_ACCOUNT_ID` — shown on the right of any Cloudflare dashboard page

   Add both under GitHub repo → Settings → Secrets and variables → Actions. The
   first deploy auto-creates the Pages project (`idle-dungeon-crawler`); the game
   then lives at `https://idle-dungeon-crawler.pages.dev`. Without the secrets the
   deploy job skips itself harmlessly.

2. **One-liner from your machine**: `bunx wrangler login` once, then `bun run deploy`.

3. **Cloudflare Git integration**: connect the repo in the Pages dashboard with
   build command `bun run build` and output directory `dist` (their build image has
   Bun preinstalled). If you choose this, delete the deploy job from
   `.github/workflows/deploy.yml` so you don't deploy twice.

Heads-up: saves are origin-scoped localStorage, so moving from `*.pages.dev` to a
custom domain later means players migrate via the in-game export/import strings.

## Gameplay telemetry (optional, Cloudflare D1)

The client collects **anonymous** gameplay statistics (random install UUID, no
accounts, no personal data) — runs with outcomes and party compositions, depth
milestones, hero deaths with causes, class hires, spells learned, tactics-editor
engagement, gold sinks, chicken murders, client errors. Players see a one-time
notice and can switch it off any time ("stats: on/off" in the top bar). Events
batch every 30s into `POST /api/track` (a Pages Function) which writes to D1.
On `localhost` nothing is sent — batches log to the browser console instead.

One-time setup (free tier: 5 GB, 100k row-writes/day ≈ thousands of daily players):

```bash
bunx wrangler d1 create idc-stats          # 1. create the database
# 2. paste the printed database_id into wrangler.jsonc (uncomment the d1_databases block)
bunx wrangler d1 execute idc-stats --remote --file=db/schema.sql   # 3. create the table
```

Until you do this, `/api/track` answers 503 and the game simply doesn't report.
Query from your terminal — `db/queries.sql` is a starter pack (depth funnel,
killer leaderboard, class popularity, gold sinks, speed mix, the chicken report):

```bash
bunx wrangler d1 execute idc-stats --remote --command \
  "SELECT depth, COUNT(DISTINCT install_id) FROM events WHERE type='depth_milestone' GROUP BY depth"
```

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
