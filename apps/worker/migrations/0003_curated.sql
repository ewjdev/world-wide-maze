-- Phase 10: the curated collection. Items are RUNS (all slices of one page), each with difficulty stars.
-- Phase 07 reads `run_id, title, url, thumb, stars` ordered by `position, run_id` (GET /api/curated) and
-- exempts these runs from the retention sweep. Rows are inserted only after the user approves
-- content/curated-proposal.md (see content/README.md). This migration creates the empty table.

CREATE TABLE IF NOT EXISTS curated (
  run_id      TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  thumb       TEXT NOT NULL,             -- card image URL (/api/share/<stageId>/card)
  stars       INTEGER NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 5),  -- Phase 09 difficulty stars
  position    INTEGER NOT NULL DEFAULT 0
);
-- Exactly the six columns Phase 07 assumes. Licence/permission notes live in content/curated.json (by run).
CREATE INDEX IF NOT EXISTS curated_position ON curated (position, run_id);
