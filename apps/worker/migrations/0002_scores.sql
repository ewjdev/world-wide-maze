-- Phase 10: leaderboards (contracts §7, CD-8).
-- Per-stage boards (N) and the global run board of session totals (E: 2013 kept one global top 10).

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    TEXT NOT NULL,
  name        TEXT NOT NULL,             -- [a-z0-9_]{1,32} (E: 2013 name entry)
  score       INTEGER NOT NULL,
  time_ms     INTEGER NOT NULL,
  -- R2 key of the submitted replay (`replays/<stageId>/<uuid>.json`, {physicsVersion, inputs}), or NULL.
  replay_key  TEXT,
  -- 1 = the replay was re-simulated with @wwm/physics and reproduced the score; 0 = not verified.
  verified    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  -- sha256(day | ip), truncated: lets us rate-limit and purge abuse without storing addresses.
  ip_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (stage_id, score DESC, time_ms ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS scores_name ON scores (stage_id, name);

CREATE TABLE IF NOT EXISTS run_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT,                     -- optional: a session may span several runs (sites)
  name         TEXT NOT NULL,
  total_score  INTEGER NOT NULL,
  time_ms      INTEGER NOT NULL,         -- sum of the stage times
  stages_json  TEXT NOT NULL,            -- [{stageId, score, timeMs}]
  created_at   TEXT NOT NULL,
  ip_hash      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_scores_board ON run_scores (total_score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS run_scores_name ON run_scores (name);
