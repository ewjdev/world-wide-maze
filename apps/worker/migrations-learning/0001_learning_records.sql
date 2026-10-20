-- Phase 31 M3 (contracts §10.5, CCR-31-3): the learning-records account index, in its own D1 database
-- `wwm-learning-records` (binding LEARNING_DB), separate from the game's `wwm` so it can be isolated, exported and
-- deleted on its own. A family's profiles and events live in its FamilyRecords Durable Object, not here.
-- Every secret (session, sign-in link, device token, pair code) is stored only as its SHA-256 hex digest.
-- Times are ISO-8601 UTC strings; they compare correctly as text.

-- One row per family: the parent who signs in. `id` is the family id (and the FamilyRecords object's name).
CREATE TABLE IF NOT EXISTS parents (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,       -- normalized: trimmed, lower case
  consent_version  TEXT NOT NULL,              -- CONSENT_VERSION the parent agreed to
  consent_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  last_active_at   TEXT NOT NULL               -- day precision is enough; drives the 24-month retention purge
);
CREATE INDEX IF NOT EXISTS parents_last_active ON parents (last_active_at);

-- WebAuthn credentials (public keys only).
CREATE TABLE IF NOT EXISTS passkeys (
  id            TEXT PRIMARY KEY,              -- credential id, base64url
  family_id     TEXT NOT NULL,
  public_key    TEXT NOT NULL,                 -- COSE public key, base64url
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_family ON passkeys (family_id);

-- Parent sessions (cookie wwm_learning_session), 30 days rolling.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_family ON sessions (family_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

-- One-use email sign-in links (15 minutes). `consent_version` is set when the request carried consent, which
-- is the only way a link can create a new family.
CREATE TABLE IF NOT EXISTS sign_in_links (
  token_hash       TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  consent_version  TEXT,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  used_at          TEXT
);
CREATE INDEX IF NOT EXISTS sign_in_links_email ON sign_in_links (email);
CREATE INDEX IF NOT EXISTS sign_in_links_expiry ON sign_in_links (expires_at);

-- WebAuthn challenges (5 minutes, one use). `family_id` is set for registration (a signed-in parent).
CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge   TEXT PRIMARY KEY,                -- base64url, as it appears in clientDataJSON
  kind        TEXT NOT NULL CHECK (kind IN ('register', 'login')),
  family_id   TEXT,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges (expires_at);

-- Pair codes for adding a child's device (10 minutes, one use).
CREATE TABLE IF NOT EXISTS pair_codes (
  code_hash   TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS pair_codes_family ON pair_codes (family_id);
CREATE INDEX IF NOT EXISTS pair_codes_expiry ON pair_codes (expires_at);

-- Paired child devices. Revoking deletes the row, so the bearer token stops working at once.
CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);
CREATE INDEX IF NOT EXISTS devices_family ON devices (family_id);
