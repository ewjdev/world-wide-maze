-- Additive catalog: keep run metadata and audit records after artifact removal.
CREATE TABLE url_catalog (
  url TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX url_catalog_host ON url_catalog(host);
CREATE TABLE moderation_cases (
  run_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  cache_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('approved','pending_review','blocked')),
  reason TEXT NOT NULL,
  provider TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  artifacts_available INTEGER NOT NULL DEFAULT 1,
  refresh_requested INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX moderation_cases_url ON moderation_cases(url);
CREATE INDEX moderation_cases_host ON moderation_cases(host);
CREATE INDEX moderation_cases_status ON moderation_cases(status, updated_at);
CREATE INDEX moderation_cases_capture ON moderation_cases(capture_id, artifacts_available);
CREATE TABLE url_variants (
  cache_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE policy_rules (
  scope TEXT NOT NULL CHECK(scope IN ('url','domain')),
  target TEXT NOT NULL,
  blocked INTEGER NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope,target)
);
CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  url TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX moderation_events_run ON moderation_events(run_id,created_at);
CREATE TABLE capture_attempts (
  job_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  run_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX capture_attempts_url ON capture_attempts(url,updated_at);
-- URL host extraction for legacy HTTP(S) captures; runtime normalizes new entries.
INSERT OR IGNORE INTO url_catalog
SELECT url, lower(rtrim(substr(substr(url,instr(url,'://')+3),1,
  instr(substr(url,instr(url,'://')+3)||'/','/')-1),'.')), min(created_at), max(created_at)
FROM runs GROUP BY url;
INSERT INTO moderation_cases(run_id,url,host,capture_id,cache_key,status,reason,provider,policy_version,updated_at)
SELECT r.run_id,r.url,c.host,r.capture_id,NULL,
  CASE WHEN EXISTS(SELECT 1 FROM curated WHERE curated.run_id=r.run_id) THEN 'approved' ELSE 'pending_review' END,
  'Legacy migration: curated approval preserved; other captures require review','legacy','legacy-backfill-v1',r.created_at
FROM runs r JOIN url_catalog c ON c.url=r.url;
ALTER TABLE moderation_cases ADD COLUMN submitted_url TEXT;
UPDATE moderation_cases SET submitted_url=url;
CREATE TABLE build_claims(cache_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, expires_at INTEGER NOT NULL);

ALTER TABLE moderation_cases ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;

ALTER TABLE moderation_cases ADD COLUMN submitted_host TEXT;
UPDATE moderation_cases SET submitted_host=host;
CREATE INDEX moderation_cases_submitted_host ON moderation_cases(submitted_host);
CREATE INDEX moderation_cases_submitted_url ON moderation_cases(submitted_url);

CREATE INDEX moderation_cases_recent ON moderation_cases(updated_at DESC,run_id DESC);
CREATE INDEX capture_attempts_recent ON capture_attempts(updated_at DESC,job_id DESC);
