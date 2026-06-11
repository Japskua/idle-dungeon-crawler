-- Starter pack of analytics queries. Run any of these with:
--   bunx wrangler d1 execute idc-stats --remote --command "..."

-- ============ engagement ============

-- daily actives & new installs
SELECT date(received_at) AS day,
       COUNT(DISTINCT install_id) AS actives,
       SUM(CASE WHEN type = 'session_start' AND json_extract(payload, '$.newInstall') = 1 THEN 1 ELSE 0 END) AS new_installs
FROM events GROUP BY day ORDER BY day DESC LIMIT 30;

-- session length distribution (minutes, from session_end)
SELECT CAST(value AS INT) / 10 * 10 AS minutes_bucket, COUNT(*) AS sessions
FROM events WHERE type = 'session_end' GROUP BY minutes_bucket ORDER BY minutes_bucket;

-- speed mix: how much real time is watched at each game speed (hours)
SELECT ROUND(SUM(json_extract(payload, '$.speedMs.0')) / 3600000.0, 1) AS paused_h,
       ROUND(SUM(json_extract(payload, '$.speedMs.1')) / 3600000.0, 1) AS x1_h,
       ROUND(SUM(json_extract(payload, '$.speedMs.2')) / 3600000.0, 1) AS x2_h,
       ROUND(SUM(json_extract(payload, '$.speedMs.4')) / 3600000.0, 1) AS x4_h
FROM events WHERE type = 'heartbeat';

-- ============ progression ============

-- THE funnel: how many installs ever reached each depth
SELECT depth, COUNT(DISTINCT install_id) AS installs
FROM events WHERE type = 'depth_milestone' GROUP BY depth ORDER BY depth;

-- minutes of play to first reach a depth (median-ish: eyeball the distribution)
SELECT depth, ROUND(AVG(value), 1) AS avg_minutes, COUNT(*) AS n
FROM events WHERE type = 'depth_milestone' GROUP BY depth ORDER BY depth;

-- run outcomes by depth reached
SELECT depth, json_extract(payload, '$.outcome') AS outcome, COUNT(*) AS runs,
       ROUND(AVG(value), 0) AS avg_gold
FROM events WHERE type = 'run_end' GROUP BY depth, outcome ORDER BY depth;

-- THE killer leaderboard: what actually ends heroes
SELECT json_extract(payload, '$.cause') AS cause, COUNT(*) AS kills
FROM events WHERE type = 'hero_death' GROUP BY cause ORDER BY kills DESC LIMIT 25;

-- boss kill counts
SELECT cls AS boss, COUNT(*) AS kills, COUNT(DISTINCT install_id) AS by_installs
FROM events WHERE type = 'boss_kill' GROUP BY cls;

-- ============ classes & parties ============

-- class hire popularity
SELECT cls, COUNT(*) AS hires FROM events WHERE type = 'hire' GROUP BY cls ORDER BY hires DESC;

-- party compositions that go deepest
SELECT json_extract(payload, '$.party') AS party, MAX(depth) AS best_depth, COUNT(*) AS runs
FROM events WHERE type = 'run_end' GROUP BY party ORDER BY best_depth DESC LIMIT 20;

-- deaths per class
SELECT cls, COUNT(*) AS deaths FROM events WHERE type = 'hero_death' GROUP BY cls ORDER BY deaths DESC;

-- ============ tactics engagement ============

-- what % of installs ever open the tactics editor
SELECT (SELECT COUNT(DISTINCT install_id) FROM events
        WHERE type = 'heartbeat' AND json_extract(payload, '$.counters.tactics_editor_opened') > 0) * 100.0
     / (SELECT COUNT(DISTINCT install_id) FROM events) AS pct_opened_editor;

-- which triggers/actions humans actually write
SELECT json_each.value AS trigger_kind, COUNT(*) AS uses
FROM events, json_each(events.payload, '$.triggers')
WHERE type = 'tactics_saved' GROUP BY trigger_kind ORDER BY uses DESC;

-- ============ economy ============

-- gold sinks (from heartbeat counters; keys look like gold:gear, gold:potion, ...)
SELECT j.key AS sink, SUM(j.value) AS gold
FROM events, json_each(events.payload, '$.counters') AS j
WHERE type = 'heartbeat' AND j.key LIKE 'gold:%' GROUP BY j.key ORDER BY gold DESC;

-- spells learned
SELECT cls AS spell, COUNT(*) AS learned FROM events WHERE type = 'spell_learned' GROUP BY cls ORDER BY learned DESC;

-- ============ whimsy ============

-- the chicken murder report (and other neutral casualties)
SELECT j.key, SUM(j.value) AS total
FROM events, json_each(events.payload, '$.counters') AS j
WHERE type = 'heartbeat' AND (j.key LIKE 'neutral_killed:%' OR j.key LIKE 'neutral_seen:%')
GROUP BY j.key ORDER BY total DESC;

-- ============ health ============

-- client errors by version
SELECT version, json_extract(payload, '$.msg') AS msg, COUNT(*) AS n
FROM events WHERE type = 'client_error' GROUP BY version, msg ORDER BY n DESC LIMIT 20;
