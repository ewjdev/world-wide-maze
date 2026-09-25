-- Phase 07: capture runs and their stages. (Phase 10 adds its own *_scores.sql / *_curated.sql.)
-- A run = all slices of one page capture built with one seed/builder/difficulty (contracts §3, §7).

CREATE TABLE IF NOT EXISTS runs (
  run_id          TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL,
  capture_id      TEXT NOT NULL,
  slice_count     INTEGER NOT NULL,
  difficulty      TEXT NOT NULL,
  seed            INTEGER NOT NULL,
  builder_version TEXT NOT NULL,
  -- 'building' until every slice is stored, then 'complete' (or 'partial' if a later slice failed).
  status          TEXT NOT NULL DEFAULT 'building',
  -- User-URL runs are unlisted (reachable only by id). Curation is Phase 10's `curated` table.
  listed          INTEGER NOT NULL DEFAULT 0,
  timings_json    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_created_at ON runs (created_at);

CREATE TABLE IF NOT EXISTS stages (
  stage_id        TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
  slice_index     INTEGER NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL,
  capture_id      TEXT NOT NULL,
  builder_version TEXT NOT NULL,
  texture_key     TEXT NOT NULL,
  islands         INTEGER NOT NULL,
  bridges         INTEGER NOT NULL,
  elevators       INTEGER NOT NULL,
  items           INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (run_id, slice_index)
);
CREATE INDEX IF NOT EXISTS stages_run ON stages (run_id, slice_index);
