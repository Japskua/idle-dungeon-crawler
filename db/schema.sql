-- Telemetry schema for Cloudflare D1 (free tier).
-- One flexible events table: typed columns for the things we always filter by,
-- JSON payload for everything else. Apply with:
--   bunx wrangler d1 execute idc-stats --remote --file=db/schema.sql

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  install_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  -- client wall-clock ms when the event happened
  ts INTEGER NOT NULL,
  -- event type: session_start, heartbeat, session_end, new_game, reset,
  -- run_end, hero_death, boss_kill, depth_milestone, hire, spell_learned,
  -- tactics_saved, client_error, ...
  type TEXT NOT NULL,
  -- dungeon depth, when relevant
  depth INTEGER,
  -- class id / monster id / skill id, when relevant
  cls TEXT,
  -- a single numeric value (level, gold, minutes), when relevant
  value REAL,
  -- everything else, JSON
  payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (type, received_at);
CREATE INDEX IF NOT EXISTS idx_events_install_time ON events (install_id, received_at);
