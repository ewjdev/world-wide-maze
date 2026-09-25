-- Phase 18: score permalinks for share cards (`/s/<stageId>/r/<scoreId>`, `/r/<scoreId>`).
-- `share_id` is random (base64url, 16 chars), so entries can't be enumerated by counting ids. Rows from before
-- this migration have none and simply have no permalink.
-- `detail_json` = the server's own breakdown of a VERIFIED replay: {"small":n,"large":n,"timeBonus":n}. NULL for
-- unverified entries, so a card never shows client-claimed item counts.

ALTER TABLE scores ADD COLUMN share_id TEXT;
ALTER TABLE scores ADD COLUMN detail_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS scores_share ON scores (share_id);

ALTER TABLE run_scores ADD COLUMN share_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS run_scores_share ON run_scores (share_id);
